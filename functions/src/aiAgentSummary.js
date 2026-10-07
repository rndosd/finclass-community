"use strict";
const { readMissionDocsStudentStates } = require("../utils/missionStudentState");

const admin = require("../firebaseAdminCompat");
const crypto = require("crypto");
const { defineSecret } = require("firebase-functions/params");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const { formatDateKeyInKST, startOfDayInKST } = require("../utils/dateUtils");
const {
    AGENT_ACTION_REGISTRY,
    createAgentActionHelpers,
} = require("./aiAgent/actionPolicy");
const { createAgentRoutineHelpers } = require("./aiAgent/routinePolicy");
const {
    DAILY_CONTEXT_SCHEMA_VERSION,
    buildAgentDailyContext,
    buildAgentDailyContextCards,
} = require("./aiAgent/dailyContext");
const {
    answerStudentCashChangeQuestion,
} = require("../utils/aiAssistantCashChange");
const {
    AI_ASSISTANT_SERVER_POLICY,
    createAssistantRequestLimiter,
    createTtlReadCache,
    evaluateAssistantRequestBudget,
    getEvidenceBudgetForCapability,
} = require("../utils/aiAssistantEvidenceBudget");

const db = admin.firestore();
const { readRealEstateLayout } = require("../utils/realEstateStorage");
const FieldValue = admin.firestore.FieldValue;
const REGION = "asia-northeast3";
const SUMMARY_VERSION = 2;
const AGENT_ANALYTICS_SCHEMA_VERSION = 1;
const AI_PRO_PLAN = "AI_PRO";
const googleApiKey = defineSecret("GOOGLE_API_KEY");
// Teacher-facing advice needs better judgment than Lite, with Lite kept as a cost/availability fallback.
const AGENT_CHAT_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite",
];

const shouldTryNextAgentChatModel = (error) => {
    const messageText = String(error?.message || "").toLowerCase();
    return (
        error?.status === 429 ||
        error?.status === 404 ||
        messageText.includes("429") ||
        messageText.includes("quota") ||
        messageText.includes("rate limit") ||
        messageText.includes("not found") ||
        messageText.includes("not supported")
    );
};

const notificationSummaryPath = (classId, key) =>
    `classes/${classId}/notificationSummary/${key}`;

const dashboardSummaryPath = (classId, key) =>
    `classes/${classId}/dashboardSummary/${key}`;

const analyticsDailyPath = (classId, dateKey) =>
    `classes/${classId}/analyticsDaily/${dateKey}`;

const onDemandAnalysisCachePath = (classId, cacheKey) =>
    `classes/${classId}/aiAgentAnalysisCache/${cacheKey}`;

const ON_DEMAND_ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000;
const assistantRequestLimiter = createAssistantRequestLimiter();
const cashChangeEvidenceBudget = getEvidenceBudgetForCapability(
    "assets.explain_cash_change",
);
const assistantStudentRosterCache = createTtlReadCache({
    ttlMs: cashChangeEvidenceBudget.rosterCacheTtlMs,
    maxEntries: 100,
});
const assistantCashEventCache = createTtlReadCache({
    ttlMs: cashChangeEvidenceBudget.eventCacheTtlMs,
    maxEntries: 300,
});

const hashAssistantBudgetSubject = (value) => crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 40);

const consumePersistentAssistantRequestBudget = async ({ classId, userId }) => {
    const userRef = db.doc(
        `aiAssistantRequestBudgets/user_${hashAssistantBudgetSubject(userId)}`,
    );
    const classRef = db.doc(
        `aiAssistantRequestBudgets/class_${hashAssistantBudgetSubject(classId)}`,
    );
    const nowMs = Date.now();
    let transactionAttempts = 0;
    let result;
    try {
        result = await db.runTransaction(async (transaction) => {
            transactionAttempts += 1;
            const [userSnap, classSnap] = await Promise.all([
                transaction.get(userRef),
                transaction.get(classRef),
            ]);
            const evaluation = evaluateAssistantRequestBudget({
                userState: userSnap.exists ? userSnap.data() : null,
                classState: classSnap.exists ? classSnap.data() : null,
                nowMs,
            });
            if (!evaluation.allowed) return evaluation;

            const updatedAt = FieldValue.serverTimestamp();
            transaction.set(userRef, {
                ...evaluation.nextUserState,
                updatedAt,
            });
            transaction.set(classRef, {
                ...evaluation.nextClassState,
                updatedAt,
            });
            return evaluation;
        }, {
            maxAttempts: AI_ASSISTANT_SERVER_POLICY.rateLimitTransactionMaxAttempts,
        });
    } catch (error) {
        error.evidenceUsage = {
            source: "assistant_request_budget",
            documentReads: transactionAttempts * 2,
            documentWrites: 0,
            cacheHit: false,
            failed: true,
            costUnknown: transactionAttempts === 0,
            transactionAttempts,
        };
        throw error;
    }
    return {
        ...result,
        usage: {
            source: "assistant_request_budget",
            documentReads: transactionAttempts * 2,
            documentWrites: result.allowed ? 2 : 0,
            cacheHit: false,
            transactionAttempts,
        },
    };
};

const assertAiProTeacher = async (request, { classId }) => {
    let ctx;
    try {
        ctx = assertTeacherOrAdminFromClaims(request, { classId });
    } catch (error) {
        error.evidenceUsage = {
            source: "class_permission_context",
            documentReads: 0,
            cacheHit: false,
            failed: true,
        };
        throw error;
    }
    if (ctx.role !== "teacher") {
        const error = new HttpsError(
            "permission-denied",
            "AI assistant is available only to teachers.",
        );
        error.evidenceUsage = {
            source: "class_permission_context",
            documentReads: 0,
            cacheHit: false,
            failed: true,
        };
        throw error;
    }

    let classSnap;
    try {
        classSnap = await db.doc(`classes/${classId}`).get();
    } catch (error) {
        error.evidenceUsage = {
            source: "class_permission_context",
            documentReads: 0,
            cacheHit: false,
            failed: true,
            costUnknown: true,
        };
        throw error;
    }
    if (!classSnap.exists) {
        const error = new HttpsError("not-found", "Class not found.");
        error.evidenceUsage = {
            source: "class_permission_context",
            documentReads: 1,
            cacheHit: false,
            failed: true,
        };
        throw error;
    }

    const planType = String(classSnap.data()?.planType || "FREE").toUpperCase();
    if (planType !== AI_PRO_PLAN) {
        const error = new HttpsError(
            "permission-denied",
            "AI assistant requires the AI_PRO plan.",
        );
        error.evidenceUsage = {
            source: "class_permission_context",
            documentReads: 1,
            cacheHit: false,
            failed: true,
        };
        throw error;
    }

    return { ctx, classData: classSnap.data() || {}, planType };
};

const toCount = (value) => {
    const count = Number(value || 0);
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
};

const toFiniteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const isMonetaryAggregateExcluded = (student) =>
    student?.statsExclusion?.monetaryAggregates === true;

const roundMetric = (value, digits = 0) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    const multiplier = 10 ** digits;
    return Math.round(number * multiplier) / multiplier;
};

const percentChange = (current, previous, digits = 3) => {
    const currentNumber = Number(current);
    const previousNumber = Number(previous);
    if (!Number.isFinite(currentNumber) || !Number.isFinite(previousNumber)) {
        return null;
    }
    if (previousNumber === 0) return currentNumber === 0 ? 0 : null;
    return roundMetric((currentNumber - previousNumber) / Math.abs(previousNumber), digits);
};

const parseDateKeyMs = (dateKey) => {
    const millis = new Date(`${dateKey}T00:00:00+09:00`).getTime();
    return Number.isFinite(millis) ? millis : null;
};

const daysBetweenDateKeys = (latestDateKey, comparisonDateKey) => {
    const latestMs = parseDateKeyMs(latestDateKey);
    const comparisonMs = parseDateKeyMs(comparisonDateKey);
    if (!Number.isFinite(latestMs) || !Number.isFinite(comparisonMs)) return null;
    return Math.floor((latestMs - comparisonMs) / (24 * 60 * 60 * 1000));
};

const pickComparisonHistory = (historyItems, latestDateKey, daysAgo) =>
    historyItems.find((item) => {
        const diffDays = daysBetweenDateKeys(latestDateKey, item.date);
        return Number.isFinite(diffDays) && diffDays >= daysAgo;
    }) || null;

const AGENT_CARD_LIMITS = {
    pendingWork: 8,
    economyHealth: 10,
    routineCandidates: 6,
    evidence: 6,
    recommendations: 6,
    affectedStudents: 10,
    suggestedQuestions: 6,
    draftItems: 8,
};

const VALID_AGENT_DOMAINS = new Set([
    "missions",
    "bank",
    "tax",
    "store",
    "police",
    "realestate",
    "credentials",
    "marketplace",
    "dashboard",
    "economy",
    "credit",
    "payroll",
]);

const VALID_CARD_STATUSES = new Set(["attention", "watch", "stable", "high", "medium", "low"]);
const VALID_CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);

const cleanString = (value, fallback = "") => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text || fallback;
};

const {
    buildAgentActionIdempotencyKey,
    buildAgentActionPreview,
    buildAgentActionTypePolicies,
    sanitizeAgentActionInput,
} = createAgentActionHelpers({
    crypto,
    formatDateKeyInKST,
    HttpsError,
    cleanString,
});

const cleanId = (value, fallback) =>
    cleanString(value, fallback).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || fallback;

const cleanStringList = (value, { limit = 6, maxLength = 180 } = {}) => {
    const raw = Array.isArray(value) ? value : [];
    return raw
        .map((item) => cleanString(item))
        .filter(Boolean)
        .map((item) => item.slice(0, maxLength))
        .slice(0, limit);
};

const cleanStudentRefs = (value, { limit = AGENT_CARD_LIMITS.affectedStudents } = {}) => {
    const raw = Array.isArray(value) ? value : [];
    return raw
        .filter(Boolean)
        .slice(0, limit)
        .map((student) => ({
            uid: cleanString(student.uid || student.studentUid || student.id, ""),
            name: cleanString(student.name || student.displayName || student.studentName, "학생"),
            studentNumber: student.studentNumber ?? null,
            reason: cleanString(student.reason || student.summary || "", ""),
            count: Number.isFinite(Number(student.count)) ? Number(student.count) : undefined,
            amount: Number.isFinite(Number(student.amount)) ? roundMetric(student.amount) : undefined,
            cash: Number.isFinite(Number(student.cash)) ? roundMetric(student.cash) : undefined,
            creditScore: Number.isFinite(Number(student.creditScore)) ? Number(student.creditScore) : undefined,
        }))
        .map((student) => Object.fromEntries(
            Object.entries(student).filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== ""),
        ));
};

const normalizeSuggestedDraft = (draft, fallbackTitle) => {
    const raw = draft && typeof draft === "object" ? draft : {};
    const type = raw.type === "messageDraft" ? "messageDraft" : "checklist";
    const items = cleanStringList(raw.items, {
        limit: AGENT_CARD_LIMITS.draftItems,
        maxLength: 220,
    });
    if (items.length === 0) return null;
    return {
        type,
        title: cleanString(raw.title, fallbackTitle).slice(0, 80),
        items,
    };
};

const normalizeResolutionBuckets = (buckets, totalCount = 0) => {
    const input = Array.isArray(buckets) ? buckets : [];
    return input
        .map((bucket, index) => {
            const raw = bucket && typeof bucket === "object" ? bucket : {};
            const rawCount = Number.isFinite(Number(raw.count)) ? toCount(raw.count) : 0;
            const count = totalCount > 0 ? Math.min(rawCount, toCount(totalCount)) : rawCount;
            const label = cleanString(raw.label || raw.title || "검토 항목").slice(0, 60);
            if (!label) return null;
            return {
                id: cleanId(raw.id, "resolution-" + (index + 1)),
                label,
                count,
                description: cleanString(raw.description || raw.summary || "").slice(0, 180),
                actionType: raw.actionType ? cleanString(raw.actionType).slice(0, 80) : null,
                canPrepareWithAi: raw.canPrepareWithAi === true,
                requiresTeacherReview: raw.requiresTeacherReview !== false,
                reviewOnly: true,
            };
        })
        .filter(Boolean)
        .slice(0, 4);
};

const normalizeAgentCard = (item, { kind, index }) => {
    const raw = item && typeof item === "object" ? item : {};
    const title = cleanString(raw.title || raw.label || raw.nextPrompt, kind + " " + (index + 1))
        .slice(0, 90);
    const id = cleanId(raw.id, kind + "-" + (index + 1));
    const domain = VALID_AGENT_DOMAINS.has(raw.domain) ? raw.domain : "dashboard";
    const statusSource = raw.priority || raw.status || raw.severity || raw.confidence || "low";
    const status = VALID_CARD_STATUSES.has(statusSource) ? statusSource : "low";
    const confidence = VALID_CONFIDENCE_VALUES.has(raw.confidence) ? raw.confidence : null;
    const suggestedDraft = normalizeSuggestedDraft(raw.suggestedDraft, title + " 초안");

    return {
        ...raw,
        id,
        domain,
        type: cleanString(raw.type, kind).slice(0, 80),
        title,
        label: cleanString(raw.label || title, title).slice(0, 90),
        count: Number.isFinite(Number(raw.count)) ? toCount(raw.count) : 0,
        priority: VALID_CARD_STATUSES.has(raw.priority) ? raw.priority : status,
        severity: VALID_CARD_STATUSES.has(raw.severity) ? raw.severity : status,
        status,
        confidence,
        whyItMatters: cleanString(raw.whyItMatters || raw.summary || raw.detectedPattern, "선생님 확인이 필요한 항목입니다.").slice(0, 260),
        summary: cleanString(raw.summary || raw.whyItMatters || raw.detectedPattern, "선생님 확인이 필요한 항목입니다.").slice(0, 260),
        detectedPattern: raw.detectedPattern ? cleanString(raw.detectedPattern).slice(0, 300) : null,
        suggestedNextStep: cleanString(
            raw.suggestedNextStep ||
            raw.nextPrompt ||
            raw.recommendations?.[0] ||
            "관련 페이지에서 세부 내용을 확인하세요.",
        ).slice(0, 220),
        nextPrompt: raw.nextPrompt ? cleanString(raw.nextPrompt).slice(0, 160) : null,
        evidence: cleanStringList(raw.evidence, {
            limit: AGENT_CARD_LIMITS.evidence,
            maxLength: 180,
        }),
        recommendations: cleanStringList(raw.recommendations, {
            limit: AGENT_CARD_LIMITS.recommendations,
            maxLength: 180,
        }),
        reasonCodes: cleanStringList(raw.reasonCodes, { limit: 8, maxLength: 80 }),
        resolutionBuckets: normalizeResolutionBuckets(raw.resolutionBuckets, raw.count),
        affectedStudents: cleanStudentRefs(raw.affectedStudents),
        suggestedQuestions: cleanStringList(raw.suggestedQuestions || raw.askPrompts, {
            limit: AGENT_CARD_LIMITS.suggestedQuestions,
            maxLength: 120,
        }),
        suggestedDraft,
        deepLink: cleanString(raw.deepLink || "", ""),
        detailTool: cleanString(raw.detailTool || "", ""),
        actionType: null,
        executable: false,
        requiresConfirmation: true,
    };
};

const normalizeAgentCardList = (items, { kind, limit }) => {
    const issues = [];
    const rawItems = Array.isArray(items) ? items : [];
    const normalized = rawItems
        .map((item, index) => normalizeAgentCard(item, { kind, index }))
        .filter((item) => {
            const isValid = item.id && item.title;
            if (!isValid) issues.push(kind + ": invalid card removed");
            return isValid;
        })
        .slice(0, limit);

    if (rawItems.length > limit) {
        issues.push(kind + ": " + (rawItems.length - limit) + " cards truncated");
    }

    return { items: normalized, issues };
};

const normalizeAgentDailySummaryCards = ({ pendingWork, economyHealth, routineCandidates }) => {
    const pending = normalizeAgentCardList(pendingWork, {
        kind: "pendingWork",
        limit: AGENT_CARD_LIMITS.pendingWork,
    });
    const health = normalizeAgentCardList(economyHealth, {
        kind: "economyHealth",
        limit: AGENT_CARD_LIMITS.economyHealth,
    });
    const routines = normalizeAgentCardList(routineCandidates, {
        kind: "routineCandidates",
        limit: AGENT_CARD_LIMITS.routineCandidates,
    });

    return {
        pendingWork: pending.items,
        economyHealth: health.items,
        routineCandidates: routines.items,
        validation: {
            schemaVersion: 1,
            checkedAt: new Date().toISOString(),
            issueCount: pending.issues.length + health.issues.length + routines.issues.length,
            issues: [...pending.issues, ...health.issues, ...routines.issues].slice(0, 20),
        },
    };
};

const createPendingAction = ({
    id,
    domain,
    type,
    label,
    count,
    severity = "low",
    deepLink,
    detailTool,
    suggestedQuestions = [],
}) => ({
    id,
    domain,
    type,
    label,
    count,
    severity,
    risk: severity === "high" ? "medium" : "low",
    executable: false,
    requiresConfirmation: true,
    actionType: null,
    deepLink,
    detailTool,
    detailParams: {},
    suggestedQuestions,
});

const PENDING_WORK_GUIDANCE = {
    "missions-pending-review": {
        title: (count) => `승인 대기 미션 ${count}건 점검`,
        priority: (count) => count >= 10 ? "high" : "medium",
        reasonCodes: ["teacher_approval_pending"],
        whyItMatters: "승인형 미션이 밀리면 학생 보상과 참여 흐름이 늦어질 수 있습니다.",
        suggestedNextStep: "오래된 제출부터 확인하고, 제출물이 있는 미션은 AI에게 요약을 요청하세요.",
    },
    "bank-pending-approval": {
        title: (count) => `은행 승인 대기 ${count}건 확인`,
        priority: (count) => count >= 8 ? "medium" : "low",
        reasonCodes: ["financial_request_pending"],
        whyItMatters: "예금/대출 요청이 밀리면 학생의 경제 활동 계획이 지연될 수 있습니다.",
        suggestedNextStep: "금액이 큰 요청과 오래 기다린 요청부터 확인하세요.",
    },
    "police-pending-review": {
        title: (count) => `생활 규칙 미처리 ${count}건 우선 확인`,
        priority: () => "high",
        reasonCodes: ["behavior_report_pending", "classroom_rule_risk"],
        whyItMatters: "신고나 반성문 처리가 늦어지면 생활 규칙의 신뢰도가 떨어질 수 있습니다.",
        suggestedNextStep: "반복 발생 학생이 있는지 먼저 확인하고, 필요한 경우 안내문 초안을 만드세요.",
    },
    "store-pending-redemptions": {
        title: (count) => `스토어 사용/수령 대기 ${count}건 정리`,
        priority: (count) => count >= 10 ? "medium" : "low",
        reasonCodes: ["store_redemption_pending"],
        whyItMatters: "구매 후 처리가 늦어지면 학생이 상점 보상을 체감하기 어렵습니다.",
        suggestedNextStep: "오래 기다린 요청과 같은 학생의 중복 요청을 먼저 묶어 확인하세요.",
    },
    "marketplace-pending-review": {
        title: (count) => `마켓 거래 확인 ${count}건 검토`,
        priority: () => "low",
        reasonCodes: ["marketplace_review_pending"],
        whyItMatters: "학생 간 거래가 오래 대기하면 물품 흐름과 신뢰에 영향을 줄 수 있습니다.",
        suggestedNextStep: "경매와 일반 거래를 나누고, 문제 가능성이 있는 거래만 먼저 확인하세요.",
    },
    "credentials-pending-review": {
        title: (count) => `칭호/자격 요청 ${count}건 확인`,
        priority: () => "low",
        reasonCodes: ["credential_request_pending"],
        whyItMatters: "칭호와 자격 승인은 학생의 역할 동기와 연결됩니다.",
        suggestedNextStep: "승인 기준이 명확한 요청부터 처리하고, 애매한 요청은 기준을 다시 확인하세요.",
    },
    "realestate-rent-due": {
        title: (count) => `자리세/임대료 미납 ${count}건 확인`,
        priority: (count) => count >= 5 ? "high" : "medium",
        reasonCodes: ["rent_due", "penalty_candidate"],
        whyItMatters: "자리세나 임대료 미납은 경제 규칙과 페널티 운영의 기준점이 됩니다.",
        suggestedNextStep: "반복 미납 학생인지 확인하고, 납부 안내 또는 자리 규칙 점검을 준비하세요.",
    },
};

const buildPendingWorkResolutionBuckets = (item, count) => {
    const baseCount = Math.max(1, toCount(count));
    const makeBucket = ({ id, label, description, actionType = null, canPrepareWithAi = false }) => ({
        id,
        label,
        count: baseCount,
        description,
        actionType,
        canPrepareWithAi,
        requiresTeacherReview: true,
        reviewOnly: true,
    });

    switch (item.id) {
    case "missions-pending-review":
        return [
            makeBucket({
                id: "ai_submission_summary",
                label: "AI 요약 가능",
                description: "제출물과 오래 기다린 항목을 묶어 승인 판단용 요약을 만들 수 있습니다.",
                actionType: "prepare_checklist",
                canPrepareWithAi: true,
            }),
            makeBucket({
                id: "teacher_final_approval",
                label: "교사 최종 승인",
                description: "보상 지급과 승인 처리는 선생님이 직접 확인해야 합니다.",
            }),
        ];
    case "police-pending-review":
        return [
            makeBucket({
                id: "ai_notice_draft",
                label: "AI 안내문 준비 가능",
                description: "반복 발생 학생과 신고/반성문을 묶어 안내문을 준비할 수 있습니다.",
                actionType: "prepare_police_review",
                canPrepareWithAi: true,
            }),
            makeBucket({
                id: "teacher_behavior_judgement",
                label: "교사 생활 판단",
                description: "생활지도 판단과 최종 처리는 선생님 확인이 필요합니다.",
            }),
        ];
    case "store-pending-redemptions":
        return [
            makeBucket({
                id: "ai_queue_summary",
                label: "AI 대기열 정리 가능",
                description: "오래 기다린 요청, 중복 학생, 처리 우선순위를 묶어 볼 수 있습니다.",
                actionType: "prepare_store_review",
                canPrepareWithAi: true,
            }),
            makeBucket({
                id: "offline_fulfillment",
                label: "오프라인 지급 확인",
                description: "실물 보상 전달이나 사용 처리는 실제 확인 뒤 직접 해야 합니다.",
            }),
        ];
    case "bank-pending-approval":
        return [
            makeBucket({
                id: "amount_review",
                label: "금액 확인 필요",
                description: "은행 요청은 금액과 사유를 선생님이 직접 확인해야 합니다.",
            }),
        ];
    case "credentials-pending-review":
        return [
            makeBucket({
                id: "ai_criteria_checklist",
                label: "AI 기준 점검 가능",
                description: "요청 사유와 승인 기준을 묶어 검토 체크리스트를 준비할 수 있습니다.",
                actionType: "prepare_checklist",
                canPrepareWithAi: true,
            }),
            makeBucket({
                id: "teacher_final_approval",
                label: "교사 최종 승인",
                description: "칭호와 자격 부여는 선생님이 최종 기준을 확인해야 합니다.",
            }),
        ];
    case "realestate-rent-due":
        return [
            makeBucket({
                id: "ai_penalty_candidate",
                label: "AI 연체자 분류 가능",
                description: "반복 미납과 일시 미납 학생을 나눠 안내/페널티 후보를 준비할 수 있습니다.",
                actionType: "prepare_tax_reminder",
                canPrepareWithAi: true,
            }),
            makeBucket({
                id: "teacher_policy_check",
                label: "자리 규칙 기준 확인",
                description: "페널티 적용이나 자리 변경 기준은 선생님 판단이 필요합니다.",
            }),
        ];
    default:
        return [
            makeBucket({
                id: "teacher_review",
                label: "교사 검토 필요",
                description: "이 업무는 상세 내용을 확인한 뒤 직접 처리해야 합니다.",
            }),
        ];
    }
};
const enrichPendingWorkItem = (item) => {
    const guidance = PENDING_WORK_GUIDANCE[item.id] || {};
    const count = toCount(item.count);
    const priority = typeof guidance.priority === "function" ?
        guidance.priority(count) :
        item.priority || item.severity || "low";
    const title = typeof guidance.title === "function" ?
        guidance.title(count) :
        guidance.title || item.title || item.label;

    return {
        ...item,
        title,
        label: item.label || title,
        priority,
        severity: item.severity || priority,
        reasonCodes: guidance.reasonCodes || item.reasonCodes || [],
        resolutionBuckets: buildPendingWorkResolutionBuckets(item, count),
        whyItMatters: guidance.whyItMatters || item.whyItMatters || "선생님 확인이 필요한 업무입니다.",
        suggestedNextStep: guidance.suggestedNextStep || item.suggestedNextStep || "관련 페이지에서 세부 내용을 확인하세요.",
        affectedStudents: Array.isArray(item.affectedStudents) ? item.affectedStudents : [],
        executable: false,
        requiresConfirmation: true,
    };
};

const buildInitialEconomyHealth = ({
    policePendingCount,
    rentDueCount,
    pendingStoreCount,
    pendingWorkCount,
    pendingWorkGroupCount,
    studentEconomySignals = null,
    analyticsDaily = null,
}) => {
    const health = [];
    const signalSource = analyticsDaily?.studentEconomySignals || studentEconomySignals || {};
    const cashDistribution = signalSource.cashDistribution || {};
    const credit = analyticsDaily?.credit || signalSource.credit || {};
    const monetary = analyticsDaily?.monetary || {};
    const consumption = analyticsDaily?.consumption || {};
    const storeAffordability = analyticsDaily?.storeAffordability || {};
    const payrollSignals = analyticsDaily?.payrollSignals || {};
    const operationalRisks = analyticsDaily?.operationalRisks || {};
    const taxRisks = operationalRisks.tax || {};
    const policeRisks = operationalRisks.police || {};
    const studentChangeSignals = analyticsDaily?.studentChangeSignals || {};
    const largestNetWorthDrops = Array.isArray(studentChangeSignals.largestNetWorthDrops) ?
        studentChangeSignals.largestNetWorthDrops :
        [];
    const largestCashDrops = Array.isArray(studentChangeSignals.largestCashDrops) ?
        studentChangeSignals.largestCashDrops :
        [];
    const largestCreditDrops = Array.isArray(studentChangeSignals.largestCreditDrops) ?
        studentChangeSignals.largestCreditDrops :
        [];
    const activeStudentCount = toCount(signalSource.activeStudentCount);

    if (taxRisks.overdueBillCount > 0) {
        health.push({
            id: "tax-overdue-pressure",
            domain: "tax",
            type: "overdueTaxSignal",
            status: taxRisks.overdueBillCount >= 5 ? "attention" : "watch",
            title: "세금/고지서 연체를 확인하세요",
            summary: "납부 기한이 지난 미납 고지서가 있어 경제 규칙 안내나 페널티 기준을 점검할 필요가 있습니다.",
            evidence: [
                `연체 고지서 ${taxRisks.overdueBillCount}건`,
                `연체 금액 ${formatNumberForReport(taxRisks.totalOverdueAmount || 0)}`,
            ],
            recommendations: [
                "잔액이 충분한 학생과 부족한 학생을 나눠 안내하세요.",
                "반복 연체 학생은 급여/직업 상태와 함께 확인하세요.",
            ],
            deepLink: "/tax",
            suggestedQuestions: [
                "연체 학생을 유형별로 나눠줘",
                "세금 안내문 초안을 만들어줘",
            ],
        });
    }

    if (
        policeRisks.repeatReportStudents?.length > 0 ||
        policeRisks.repeatFineStudents?.length > 0
    ) {
        health.push({
            id: "repeated-rule-friction",
            domain: "police",
            type: "repeatedBehaviorSignal",
            status: "attention",
            title: "반복 생활 규칙 신호가 있습니다",
            summary: "최근 신고나 벌금이 일부 학생에게 반복되어 생활 규칙 상담이나 회복 과제를 검토할 만합니다.",
            evidence: [
                `반복 신고 학생 ${policeRisks.repeatReportStudents?.length || 0}명`,
                `반복 벌금 학생 ${policeRisks.repeatFineStudents?.length || 0}명`,
            ],
            recommendations: [
                "같은 학생에게 신고/벌금이 반복되는지 먼저 보세요.",
                "벌금만 누적하기보다 안내, 반성문, 회복 과제를 함께 검토하세요.",
            ],
            deepLink: "/police",
            suggestedQuestions: [
                "반복 발생 학생을 알려줘",
                "생활 규칙 상담 순서를 정해줘",
            ],
        });
    }
    if (
        analyticsDaily?.windows?.hasHistoryComparison30d &&
        monetary.liquidMoneyChangeRate30d >= 0.15 &&
        consumption.netSpendChangeRate30d !== null &&
        consumption.netSpendChangeRate30d <= -0.1
    ) {
        health.push({
            id: "liquidity-consumption-gap",
            domain: "economy",
            type: "liquidityConsumptionGap",
            status: "attention",
            title: "현금은 늘었는데 소비는 줄고 있습니다",
            summary: "최근 30일 비교에서 유동성은 증가했지만 스토어 소비 흐름은 약해졌습니다.",
            evidence: [
                `유동성 ${roundMetric(monetary.liquidMoneyChangeRate30d * 100, 1)}% 변화`,
                `스토어 순소비 ${roundMetric(consumption.netSpendChangeRate30d * 100, 1)}% 변화`,
            ],
            recommendations: [
                "세금이나 벌금을 먼저 올리기보다 소비처와 가격 매력을 점검하세요.",
                "고가 상품, 기간 한정 상품, 사용형 아이템을 늘릴지 검토하세요.",
            ],
            deepLink: "/store",
            suggestedQuestions: [
                "소비가 줄어든 이유를 추정해줘",
                "물가나 상품 조정 방향을 제안해줘",
            ],
        });
    }

    if (
        storeAffordability.activeItemCount > 0 &&
        storeAffordability.medianItemPrice > 0 &&
        (
            storeAffordability.affordableStudentRateForMedianItem < 0.4 ||
            storeAffordability.medianCashToMedianPriceRatio < 1
        )
    ) {
        health.push({
            id: "store-affordability-gap",
            domain: "store",
            type: "affordabilitySignal",
            status: storeAffordability.affordableStudentRateForMedianItem < 0.25 ?
                "attention" :
                "watch",
            title: "대표 상품 가격이 부담될 수 있습니다",
            summary: "활성 스토어 상품의 중간 가격과 학생 현금 분포를 비교했을 때 구매 가능한 학생 비율이 낮습니다.",
            evidence: [
                `활성 상품 ${storeAffordability.activeItemCount || 0}개`,
                `중간 상품 가격 ${formatNumberForReport(storeAffordability.medianItemPrice || 0)}`,
                `중간 가격 상품 구매 가능 학생 ${roundMetric((storeAffordability.affordableStudentRateForMedianItem || 0) * 100, 1)}%`,
            ],
            recommendations: [
                "저가/중가 상품을 보강하거나 일부 상품 가격을 낮출지 검토하세요.",
                "급여 인상보다 먼저 대표 상품 가격대가 학생 현금 분포와 맞는지 확인하세요.",
            ],
            deepLink: "/store",
            suggestedQuestions: [
                "스토어 가격대를 어떻게 조정할까?",
                "구매력 기준으로 상품을 나눠줘",
            ],
        });
    }

    if (
        analyticsDaily?.windows?.hasHistoryComparison30d &&
        consumption.redeemedCountChangeRate30d !== null &&
        consumption.redeemedCountChangeRate30d <= -0.25
    ) {
        health.push({
            id: "store-consumption-drop",
            domain: "store",
            type: "consumptionTrend",
            status: "attention",
            title: "스토어 참여가 줄어드는 흐름입니다",
            summary: "최근 스토어 사용/구매 건수가 30일 전보다 눈에 띄게 줄었습니다.",
            evidence: [
                `스토어 사용 건수 ${roundMetric(consumption.redeemedCountChangeRate30d * 100, 1)}% 변화`,
                `최근 7일 사용 ${consumption.storeMetrics7d?.redeemedCount || 0}건`,
            ],
            recommendations: [
                "가격이 높아서 구매가 줄었는지, 살 만한 상품이 부족한지 나눠 보세요.",
                "학생들이 가진 현금 대비 대표 상품 가격을 비교해보세요.",
            ],
            deepLink: "/store",
            suggestedQuestions: [
                "스토어 소비를 살리는 이벤트를 추천해줘",
                "가격 조정 아이디어를 줘",
            ],
        });
    }

    if (
        payrollSignals.activeStudentCount > 0 &&
        (payrollSignals.unassignedStudentCount > 0 || payrollSignals.targetShortageJobs?.length > 0)
    ) {
        health.push({
            id: "payroll-coverage-gap",
            domain: "payroll",
            type: "payrollCoverageSignal",
            status: payrollSignals.unassignedStudentCount >= 3 ? "attention" : "watch",
            title: "직업/급여 배정 상태를 확인하세요",
            summary: "직업이 없는 학생이나 목표 인원보다 부족한 직업이 있어 급여 흐름이 일부 학생에게 닿지 않을 수 있습니다.",
            evidence: [
                `직업 없는 학생 ${payrollSignals.unassignedStudentCount || 0}명`,
                `직업 정의 ${payrollSignals.jobDefinitionCount || 0}개`,
                `주간 예상 급여 총액 ${formatNumberForReport(payrollSignals.weeklyPayrollLiability || 0)}`,
            ],
            recommendations: [
                "잔액이 낮은 학생 중 직업이 없는 학생을 먼저 확인하세요.",
                "목표 인원보다 부족한 직업은 모집이나 배정이 필요한지 보세요.",
            ],
            affectedStudents: payrollSignals.unassignedStudents || [],
            deepLink: "/labor",
            suggestedQuestions: [
                "직업 없는 학생을 어떻게 처리할까?",
                "급여와 스토어 가격이 맞는지 봐줘",
            ],
        });
    }

    if (activeStudentCount > 0 && cashDistribution.zeroOrNegativeCashCount > 0) {
        health.push({
            id: "cash-balance-floor",
            domain: "economy",
            type: "liquiditySignal",
            status: cashDistribution.zeroOrNegativeCashCount >= 3 ? "attention" : "watch",
            title: "잔액이 부족한 학생을 확인하세요",
            summary: "현금 잔액이 0 이하인 학생이 있어 급여, 보상, 소비 흐름을 함께 볼 필요가 있습니다.",
            evidence: [
                `잔액 0 이하 학생 ${cashDistribution.zeroOrNegativeCashCount}명`,
                `평균 현금 ${roundMetric(cashDistribution.averageCash).toLocaleString("ko-KR")}`,
            ],
            recommendations: [
                "급여나 직업 배정이 누락된 학생이 있는지 확인하세요.",
                "벌금/세금 때문에 활동이 막힌 학생은 안내를 먼저 준비하세요.",
            ],
            deepLink: "/admin",
            suggestedQuestions: [
                "잔액이 부족한 학생을 어떻게 볼까?",
                "경제 활동이 막힐 학생이 있는지 알려줘",
            ],
        });
    }

    if (activeStudentCount >= 5 && cashDistribution.top20Share >= 0.45) {
        health.push({
            id: "cash-concentration",
            domain: "economy",
            type: "assetConcentration",
            status: cashDistribution.top20Share >= 0.6 ? "attention" : "watch",
            title: "현금이 일부 학생에게 집중되어 있습니다",
            summary: "상위권 학생의 현금 비중이 높아 가격, 보상, 소비처 조정이 필요한지 볼 만합니다.",
            evidence: [
                `상위 ${cashDistribution.topCashStudentCount}명 현금 비중 ${roundMetric(cashDistribution.top20Share * 100, 1)}%`,
                `전체 현금 ${roundMetric(cashDistribution.totalCash).toLocaleString("ko-KR")}`,
            ],
            recommendations: [
                "고가 상품이나 투자성 소비처가 부족한지 확인하세요.",
                "급여 인상보다 소비처/세금/가격 조정을 먼저 검토하세요.",
            ],
            deepLink: "/admin",
            suggestedQuestions: [
                "자산 집중도가 왜 문제인지 설명해줘",
                "가격 조정 방향을 제안해줘",
            ],
        });
    }

    if (
        largestNetWorthDrops.length > 0 ||
        largestCashDrops.length > 0 ||
        largestCreditDrops.length > 0
    ) {
        const topNetWorthDrop = largestNetWorthDrops[0];
        const topCashDrop = largestCashDrops[0];
        const topCreditDrop = largestCreditDrops[0];
        health.push({
            id: "student-change-watch",
            domain: "economy",
            type: "studentChangeSignal",
            status: largestNetWorthDrops.length + largestCashDrops.length >= 3 ?
                "attention" :
                "watch",
            title: "변화가 큰 학생을 확인하세요",
            summary: "최근 30일 기준 순자산, 현금, 신용 변화가 큰 학생이 있어 원인을 확인할 만합니다.",
            evidence: [
                `순자산 감소 후보 ${largestNetWorthDrops.length}명`,
                `현금 감소 후보 ${largestCashDrops.length}명`,
                `신용 하락 후보 ${largestCreditDrops.length}명`,
            ].filter(Boolean),
            recommendations: [
                topNetWorthDrop ?
                    `${topNetWorthDrop.name} 학생의 순자산 변화 원인을 먼저 확인하세요.` :
                    "순자산 감소 학생의 최근 거래/벌금/구매 내역을 확인하세요.",
                topCashDrop ?
                    `${topCashDrop.name} 학생은 현금 흐름을 급여, 세금, 스토어 사용과 함께 보세요.` :
                    "현금 감소 학생은 소비와 페널티를 함께 확인하세요.",
                topCreditDrop ?
                    `${topCreditDrop.name} 학생은 신용 하락 사유와 회복 기회를 같이 검토하세요.` :
                    "신용 하락 학생은 벌금보다 회복 과제 안내가 필요한지 보세요.",
            ],
            affectedStudents: [
                ...largestNetWorthDrops,
                ...largestCashDrops,
                ...largestCreditDrops,
            ].slice(0, 5),
            deepLink: "/admin",
            suggestedQuestions: [
                "변화가 큰 학생을 유형별로 나눠줘",
                "어떤 순서로 확인하면 좋을까?",
            ],
        });
    }

    if (activeStudentCount > 0 && credit.lowCreditCount > 0) {
        health.push({
            id: "credit-watch",
            domain: "credit",
            type: "creditSignal",
            status: credit.lowCreditCount >= 3 ? "attention" : "watch",
            title: "신용 점수가 낮은 학생을 살펴보세요",
            summary: "신용 점수가 낮은 학생은 벌금, 신고, 상환 흐름과 함께 확인하는 편이 좋습니다.",
            evidence: [
                `신용 600 미만 학생 ${credit.lowCreditCount}명`,
                `최저 신용 ${credit.lowestCreditScore}점`,
            ],
            recommendations: [
                "최근 벌금이나 신고가 반복된 학생인지 확인하세요.",
                "회복 과제나 보상 기회를 함께 제안할지 검토하세요.",
            ],
            deepLink: "/admin",
            suggestedQuestions: [
                "신용 주의 학생을 어떻게 도와줄까?",
                "벌금/신고와 같이 볼 점을 알려줘",
            ],
        });
    }

    if (policePendingCount + rentDueCount > 0) {
        health.push({
            id: "penalty-pressure",
            domain: policePendingCount > 0 ? "police" : "realestate",
            type: "penaltySignal",
            status: policePendingCount + rentDueCount >= 5 ? "attention" : "watch",
            title: "생활 규칙/페널티 점검이 필요합니다",
            summary: "신고, 반성문, 자리세 미납처럼 규칙 신뢰도와 연결되는 일이 남아 있습니다.",
            evidence: [
                `미처리 신고 ${policePendingCount}건`,
                `자리세/임대료 확인 ${rentDueCount}건`,
            ],
            recommendations: [
                "반복 발생 학생이 있는지 먼저 확인하세요.",
                "페널티보다 안내가 먼저 필요한 학생을 구분하세요.",
            ],
            deepLink: policePendingCount > 0 ? "/police" : "/realestate",
            suggestedQuestions: [
                "규칙 관련해서 먼저 볼 학생을 알려줘",
                "안내문 초안을 만들어줘",
            ],
        });
    }

    if (pendingStoreCount > 0) {
        health.push({
            id: "store-fulfillment-flow",
            domain: "store",
            type: "storeFlow",
            status: pendingStoreCount >= 10 ? "attention" : "watch",
            title: "스토어 보상 체감 흐름을 확인하세요",
            summary: "구매나 사용 후 처리 대기가 남아 있어 학생이 보상을 체감하는 속도를 확인할 필요가 있습니다.",
            evidence: [`스토어 처리 대기 ${pendingStoreCount}건`],
            recommendations: [
                "오래 기다린 요청을 먼저 정리하세요.",
                "다음 단계에서는 구매량 변화와 인기/비인기 상품 분석을 붙이는 것이 좋습니다.",
            ],
            deepLink: "/store",
            suggestedQuestions: [
                "스토어 대기를 어떻게 정리할까?",
                "상점 운영에서 볼 점을 알려줘",
            ],
        });
    }

    if (pendingWorkCount >= 10) {
        health.push({
            id: "operation-load",
            domain: "dashboard",
            type: "operationLoad",
            status: "attention",
            title: "오늘 처리 대기 업무가 많은 편입니다",
            summary: "처리 대기 업무가 여러 영역에 걸쳐 있어 우선순위를 정하는 것이 좋습니다.",
            evidence: [
                `전체 처리 후보 ${pendingWorkCount}건`,
                `업무 묶음 ${pendingWorkGroupCount}개`,
            ],
            recommendations: [
                "생활 규칙과 미납처럼 운영 신뢰도에 영향을 주는 항목을 먼저 보세요.",
                "금액/보상 관련 요청은 오래 기다린 항목부터 정리하세요.",
            ],
            deepLink: "/dashboard",
            suggestedQuestions: [
                "오늘 처리 순서를 정해줘",
                "5분 안에 볼 것만 골라줘",
            ],
        });
    }

    return health;
};

const briefText = (value, fallback = "") => {
    const text = cleanString(value || fallback);
    if (!text) return "";
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
};

const getCardBriefText = (card) =>
    briefText(card?.whyItMatters || card?.summary || card?.detectedPattern || "");

const getCardActionText = (card) =>
    briefText(card?.suggestedNextStep || card?.nextPrompt || card?.recommendations?.[0] || "");

const buildOpeningBrief = ({ pendingWork, economyHealth, routineCandidates }) => {
    const highPriorityWork = pendingWork.find((item) => item.priority === "high") || null;
    const mediumPriorityWork = pendingWork.find((item) => item.priority === "medium") || null;
    const firstPendingWork = pendingWork[0] || null;
    const attentionHealth = economyHealth.find((item) => item.status === "attention") || null;
    const firstHealth = economyHealth[0] || null;
    const routine = routineCandidates[0] || null;
    const primary = highPriorityWork || attentionHealth || mediumPriorityWork || firstPendingWork || routine || firstHealth;

    if (!primary) {
        return {
            schemaVersion: 1,
            title: "오늘 먼저 볼 운영 포인트",
            message:
                "오늘은 급하게 처리해야 할 운영 신호가 많지 않습니다. 경제교실 흐름을 가볍게 확인하고, 필요하면 최근 자산/소비 변화나 반복 업무 후보를 물어보세요.",
            priorityCardIds: [],
            suggestedQuestions: [
                "오늘 경제교실에서 볼 만한 변화가 있어?",
                "최근 자산이나 신용 변화가 큰 학생을 알려줘",
                "이번 주 반복 업무 후보를 정리해줘",
            ],
            generatedForDate: formatDateKeyInKST(new Date()),
        };
    }

    const supportingCards = [highPriorityWork, mediumPriorityWork, firstPendingWork, attentionHealth, firstHealth, routine]
        .filter(Boolean)
        .filter((item, index, items) => item.id !== primary.id && items.findIndex((other) => other.id === item.id) === index)
        .slice(0, 2);
    const primaryReason = getCardBriefText(primary);
    const primaryAction = getCardActionText(primary);
    const supportLines = supportingCards
        .map((item) => {
            const title = briefText(item.title || item.label || item.nextPrompt || "확인할 항목");
            const reason = getCardBriefText(item);
            return reason ? `- ${title}: ${reason}` : `- ${title}`;
        });

    const messageParts = [
        `오늘은 ${briefText(primary.title || primary.label || "운영 포인트")}을 먼저 보는 게 좋습니다.`,
    ];
    if (primaryReason) {
        messageParts.push("", "왜 중요한가", primaryReason);
    }
    if (supportLines.length > 0) {
        messageParts.push("", "함께 볼 신호", ...supportLines);
    }
    if (primaryAction) {
        messageParts.push("", "추천 행동", primaryAction);
    }

    const suggestedQuestions = [
        primary.nextPrompt || "오늘 먼저 처리할 일을 순서대로 알려줘",
        "안내문이나 체크리스트 초안을 만들어줘",
        attentionHealth?.nextPrompt || "경제교실 건강 진단을 더 자세히 설명해줘",
    ]
        .map((item) => cleanString(item))
        .filter(Boolean)
        .slice(0, 3);

    return {
        schemaVersion: 1,
        title: "오늘 먼저 볼 운영 포인트",
        message: messageParts.join("\n"),
        priorityCardIds: [primary, ...supportingCards]
            .map((item) => item?.id)
            .filter(Boolean),
        primaryDomain: primary.domain || null,
        primaryPriority: primary.priority || primary.status || null,
        suggestedQuestions,
        generatedForDate: formatDateKeyInKST(new Date()),
    };
};
const addDaysToDateKey = (dateKey, days) => {
    const baseMs = parseDateKeyMs(dateKey);
    if (!Number.isFinite(baseMs)) return null;
    const next = new Date(baseMs + (days * 24 * 60 * 60 * 1000));
    const year = next.getUTCFullYear();
    const month = String(next.getUTCMonth() + 1).padStart(2, "0");
    const day = String(next.getUTCDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
};

const buildPreparedWorkDedupeKey = (item = {}) => [
    item.actionType || "prepare_checklist",
    item.sourceKind || "unknown",
    item.sourceCardId || item.id || "no-source",
    item.domain || "dashboard",
    cleanString(item.title || "").slice(0, 80),
].join("|");

const normalizePreparedWorkList = (items = [], { dateKey = formatDateKeyInKST(new Date()), limit = 8 } = {}) => {
    const expiresOnDate = addDaysToDateKey(dateKey, 7);
    const cooldownUntilDate = addDaysToDateKey(dateKey, 1);
    const seen = new Set();

    return items
        .filter(Boolean)
        .map((item, index) => {
            const dedupeKey = item.dedupeKey || buildPreparedWorkDedupeKey(item);
            return {
                ...item,
                id: item.id || `prepared-${index}`,
                dedupeKey,
                preparedForDate: item.preparedForDate || dateKey,
                expiresOnDate: item.expiresOnDate || expiresOnDate,
                cooldownUntilDate: item.cooldownUntilDate || cooldownUntilDate,
                status: item.status || "ready",
                statusLabel: item.statusLabel || "검토 대기",
                stale: false,
                reviewOnly: true,
                executable: false,
                requiresConfirmation: true,
            };
        })
        .filter((item) => {
            if (seen.has(item.dedupeKey)) return false;
            seen.add(item.dedupeKey);
            return true;
        })
        .slice(0, limit);
};

const inferPreparedDraftType = (card = {}) => {
    if (["tax", "realestate", "police", "store"].includes(card.domain)) return "messageDraft";
    return "checklist";
};

const buildPreparedDraftItems = (card = {}) => {
    const items = [];
    const reason = getCardBriefText(card);
    const action = getCardActionText(card);
    if (reason) items.push(`확인 근거: ${reason}`);
    if (action) items.push(`추천 행동: ${action}`);
    if (Array.isArray(card.affectedStudents) && card.affectedStudents.length > 0) {
        items.push(`대상 학생 ${card.affectedStudents.length}명 확인`);
    }
    if (Array.isArray(card.recommendations)) {
        card.recommendations.slice(0, 2).forEach((item) => {
            const text = briefText(item);
            if (text) items.push(text);
        });
    }
    if (items.length === 0) {
        items.push("관련 학생과 처리 대상을 먼저 확인하세요.");
        items.push("필요한 항목만 선택한 뒤 선생님이 최종 실행하세요.");
    }
    return items.slice(0, 5);
};

const formatPreparedWorkTitle = (title) => {
    if (title.endsWith("준비")) return title;
    if (title.endsWith("가 있습니다")) return title.replace(/가 있습니다$/, " 점검");
    if (title.endsWith("이 있습니다")) return title.replace(/이 있습니다$/, " 점검");
    if (title.endsWith("를 확인하세요")) return title.replace(/를 확인하세요$/, " 확인");
    if (title.endsWith("을 확인하세요")) return title.replace(/을 확인하세요$/, " 확인");
    if (title.endsWith("확인하세요")) return title.replace(/확인하세요$/, "확인");
    return `${title} 준비`;
};

const buildPreparedWork = ({ pendingWork, economyHealth, routineCandidates }) => {
    const sourceCards = [
        ...pendingWork.slice(0, 3).map((item) => ({ ...item, sourceKind: "pendingWork" })),
        ...economyHealth.slice(0, 2).map((item) => ({ ...item, sourceKind: "economyHealth" })),
        ...routineCandidates.slice(0, 2).map((item) => ({ ...item, sourceKind: "routineCandidates" })),
    ];
    const seen = new Set();

    return sourceCards
        .filter((card) => {
            const key = card.id || `${card.domain}-${card.title || card.label || card.nextPrompt}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 5)
        .map((card, index) => {
            const title = briefText(card.title || card.label || card.nextPrompt || "확인할 업무");
            const draftType = inferPreparedDraftType(card);
            const actionType = draftType === "messageDraft" ? "prepare_notice_draft" : "prepare_checklist";
            const preparedTitle = formatPreparedWorkTitle(title);
            return {
                id: `prepared-${card.id || index}`,
                dedupeKey: buildPreparedWorkDedupeKey({
                    actionType,
                    sourceKind: card.sourceKind,
                    sourceCardId: card.id || null,
                    domain: card.domain || "dashboard",
                    title,
                }),
                domain: card.domain || "dashboard",
                type: "preparedWork",
                sourceKind: card.sourceKind,
                sourceCardId: card.id || null,
                actionType,
                riskLevel: "low",
                status: "ready",
                statusLabel: "검토 대기",
                title: preparedTitle,
                summary: getCardActionText(card) || getCardBriefText(card) || "선생님 확인 전에 필요한 초안을 준비합니다.",
                whyItMatters: getCardBriefText(card),
                suggestedNextStep: "검토 버튼으로 초안을 확인하고, 필요한 항목만 남긴 뒤 직접 실행하세요.",
                deepLink: card.deepLink || null,
                nextPrompt: card.nextPrompt || `${title}에 필요한 안내문이나 체크리스트를 만들어줘`,
                suggestedQuestions: [
                    `${title} 처리 대상을 정리해줘`,
                    `${title} 안내문이나 체크리스트 초안을 만들어줘`,
                    "실행 전에 제외할 학생이 있는지 확인해줘",
                ],
                suggestedDraft: {
                    type: draftType,
                    title: `${title} 준비 초안`,
                    items: buildPreparedDraftItems(card),
                },
                executable: false,
                requiresConfirmation: true,
            };
        });
};
const buildScheduledRoutinePreparedWork = (routineSettings = {}, dateKey = formatDateKeyInKST(new Date())) => {
    const templates = Array.isArray(routineSettings.templates) ? routineSettings.templates : [];
    return templates
        .filter((template) => template?.enabled === true && template.rule?.lastPreparedForDate === dateKey)
        .slice(0, 5)
        .map((template) => ({
            id: `routine-prepared-${template.id}`,
            dedupeKey: buildPreparedWorkDedupeKey({
                actionType: template.actionType || "prepare_routine_work",
                sourceKind: "routineSettings",
                sourceCardId: template.id,
                domain: template.domain || "dashboard",
                title: template.title,
            }),
            domain: template.domain || "dashboard",
            type: "preparedWork",
            sourceKind: "routineSettings",
            sourceCardId: template.id,
            actionType: template.actionType || "prepare_routine_work",
            riskLevel: "low",
            status: "ready",
            statusLabel: "자동 준비됨",
            title: `${template.title} 완료`,
            summary: `${template.time || template.schedule?.time || "정해진 시간"} 기준으로 준비함에 올릴 초안을 준비했습니다.`,
            whyItMatters: template.description || "반복 업무를 미리 준비하면 선생님은 확인과 실행에만 집중할 수 있습니다.",
            suggestedNextStep: "검토 버튼으로 초안을 확인하고 필요한 항목만 남긴 뒤 직접 실행하세요.",
            deepLink: ROUTINE_DOMAIN_DEEP_LINKS[template.domain] || "/dashboard",
            nextPrompt: `${template.title}에 필요한 체크리스트를 만들어줘`,
            suggestedQuestions: [
                `${template.title} 대상 목록을 정리해줘`,
                `${template.title} 체크리스트를 만들어줘`,
                "실행 전에 제외할 학생이나 항목을 알려줘",
            ],
            suggestedDraft: {
                type: template.domain === "tax" || template.domain === "police" ? "messageDraft" : "checklist",
                title: `${template.title} 검토 초안`,
                items: [
                    template.description || "반복 업무 준비 내용을 확인합니다.",
                    "대상 학생과 예외 항목을 확인합니다.",
                    "최종 실행은 선생님이 직접 확인 후 진행합니다.",
                ],
            },
            executable: false,
            requiresConfirmation: true,
        }));
};
const getActivityLogDate = (data = {}) => {
    const value = data.createdAt || data.timestamp;
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const toKstDateParts = (date) => {
    const kstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
    return {
        year: kstDate.getUTCFullYear(),
        month: kstDate.getUTCMonth() + 1,
        day: kstDate.getUTCDate(),
        weekday: kstDate.getUTCDay(),
    };
};

const getWeekKeyInKST = (date) => {
    const { year, month, day } = toKstDateParts(date);
    const anchorDate = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = anchorDate.getUTCDay() || 7;
    anchorDate.setUTCDate(anchorDate.getUTCDate() + 4 - dayOfWeek);
    const weekYear = anchorDate.getUTCFullYear();
    const yearStart = new Date(Date.UTC(weekYear, 0, 1));
    const week = Math.ceil((((anchorDate - yearStart) / 86400000) + 1) / 7);
    return `${weekYear}-W${String(week).padStart(2, "0")}`;
};

const WEEKDAY_LABELS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

const isKstMonthEndWindow = ({ year, month, day }) => {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return lastDay - day <= 5;
};

const resolveRoutineCadence = ({ topWeekdayCount = 0, monthEndCount = 0, monthStartCount = 0 }) => {
    if (monthEndCount >= 2) return "monthEnd";
    if (monthStartCount >= 2) return "monthStart";
    if (topWeekdayCount >= 2) return "weekday";
    return "frequent";
};

const resolveActivityDomain = (data = {}) => {
    const raw = [
        data.serviceName,
        data.pageKey,
        data.actionKey,
        data.category,
        data.subCategory,
        data.source,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (/police|fine|reflection|report|rule|penalty/.test(raw)) return "police";
    if (/rent|realestate|real_estate|desk|seat/.test(raw)) return "realestate";
    if (/store|redemption|purchase|item/.test(raw)) return "store";
    if (/tax|bill|settlement/.test(raw)) return "tax";
    if (/payroll|salary|labor|job/.test(raw)) return "payroll";
    if (/mission/.test(raw)) return "missions";
    if (/bank|saving|loan|deposit/.test(raw)) return "bank";
    return "other";
};

const readRecentActivityRoutineSignals = async (classId) => {
    const lookbackDays = 60;
    const startDate = new Date(Date.now() - (lookbackDays * 24 * 60 * 60 * 1000));
    const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);
    const domains = new Map();

    try {
        const snap = await db
            .collectionGroup("activityLogs")
            .where("classId", "==", classId)
            .where("createdAt", ">=", startTimestamp)
            .orderBy("createdAt", "desc")
            .limit(160)
            .select(
                "serviceName",
                "pageKey",
                "actionKey",
                "category",
                "subCategory",
                "source",
                "description",
                "createdAt",
                "timestamp",
            )
            .get();

        snap.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const date = getActivityLogDate(data);
            if (!date) return;

            const domain = resolveActivityDomain(data);
            if (domain === "other") return;

            if (!domains.has(domain)) {
                domains.set(domain, {
                    domain,
                    count: 0,
                    weeks: new Set(),
                    weekdays: new Map(),
                    monthEndCount: 0,
                    monthStartCount: 0,
                    latestAt: null,
                    sampleDescriptions: [],
                });
            }

            const entry = domains.get(domain);
            const kstParts = toKstDateParts(date);
            const { weekday } = kstParts;
            entry.count += 1;
            entry.weeks.add(getWeekKeyInKST(date));
            entry.weekdays.set(weekday, (entry.weekdays.get(weekday) || 0) + 1);
            if (isKstMonthEndWindow(kstParts)) entry.monthEndCount += 1;
            if (kstParts.day <= 5) entry.monthStartCount += 1;
            if (!entry.latestAt || date.getTime() > entry.latestAt.getTime()) {
                entry.latestAt = date;
            }
            const description = String(data.description || "").trim();
            if (description && entry.sampleDescriptions.length < 3) {
                entry.sampleDescriptions.push(description);
            }
        });

        return {
            available: true,
            lookbackDays,
            scannedCount: snap.size,
            domains: Array.from(domains.values()).map((entry) => {
                const topWeekday = Array.from(entry.weekdays.entries())
                    .sort((a, b) => b[1] - a[1])[0] || [null, 0];
                return {
                    domain: entry.domain,
                    count: entry.count,
                    weekCount: entry.weeks.size,
                    topWeekday: topWeekday[0],
                    topWeekdayCount: topWeekday[1],
                    topWeekdayShare: entry.count ? roundMetric(topWeekday[1] / entry.count, 3) : 0,
                    monthEndCount: entry.monthEndCount,
                    monthStartCount: entry.monthStartCount,
                    cadence: resolveRoutineCadence({
                        topWeekdayCount: topWeekday[1],
                        monthEndCount: entry.monthEndCount,
                        monthStartCount: entry.monthStartCount,
                    }),
                    latestAt: entry.latestAt ? entry.latestAt.toISOString() : null,
                    sampleDescriptions: entry.sampleDescriptions,
                };
            }),
        };
    } catch (error) {
        console.warn("[aiAgentSummary] activity routine signal read failed:", error?.message || error);
        return {
            available: false,
            lookbackDays,
            scannedCount: 0,
            domains: [],
            errorMessage: error?.message || "activity log query failed",
        };
    }
};

const getRoutineDomainLabel = (domain) => ({
    police: "생활 규칙",
    realestate: "자리세/임대료",
    store: "스토어",
    tax: "세금",
    payroll: "급여/직업",
    missions: "미션",
    bank: "은행",
}[domain] || "운영");

const getRoutineCadenceLabel = (cadence, topWeekday) => {
    if (cadence === "monthEnd") return "월말";
    if (cadence === "monthStart") return "월초";
    if (cadence === "weekday" && topWeekday !== null && topWeekday !== undefined) {
        return WEEKDAY_LABELS[topWeekday];
    }
    return "자주";
};

const buildRoutineDetectedPattern = ({ signal, label, cadenceLabel }) => {
    const base = `최근 ${signal.weekCount}개 주에 걸쳐 ${label} 관련 로그가 ${signal.count}건 기록됐습니다.`;
    if (signal.cadence === "monthEnd") {
        return `${base} 월말 6일 구간에 ${signal.monthEndCount || 0}건이 몰려 있어 마감 전 점검 업무로 준비할 만합니다.`;
    }
    if (signal.cadence === "monthStart") {
        return `${base} 월초 5일 구간에 ${signal.monthStartCount || 0}건이 몰려 있어 월초 정리 업무로 준비할 만합니다.`;
    }
    if (signal.cadence === "weekday") {
        return `${base} ${cadenceLabel}에 ${signal.topWeekdayCount}건 처리한 흐름이 보여 정기 점검 후보입니다.`;
    }
    return `${base} 특정 마감일보다 반복 빈도가 높아 묶음 점검 후보입니다.`;
};

const getRoutineDraftItems = (domain, cadenceLabel) => {
    const prefix = cadenceLabel === "자주" ? "반복" : cadenceLabel;
    const byDomain = {
        police: [
            "미처리 신고/반성문 확인",
            "같은 학생에게 반복되는 신고나 벌금 확인",
            "상담, 안내문, 회복 과제 중 어떤 대응이 맞는지 정리",
        ],
        realestate: [
            "자리세/임대료 미납 학생 확인",
            "잔액이 충분한 학생과 부족한 학생 구분",
            "납부 안내 또는 페널티 기준 적용 여부 정리",
        ],
        tax: [
            "미납/연체 고지서 확인",
            "반복 연체 학생과 일시 연체 학생 구분",
            "납부 안내문과 다음 페널티 기준 정리",
        ],
        payroll: [
            "직업 없는 학생과 목표 인원 부족 직업 확인",
            "급여 지급 전 직업 변경사항 저장 여부 확인",
            "급여 수준이 대표 상품 가격과 맞는지 점검",
        ],
        store: [
            "스토어 처리 대기와 오래 기다린 요청 확인",
            "구매가 줄어든 상품과 가격 부담 상품 확인",
            "처리 순서와 안내가 필요한 학생 정리",
        ],
        missions: [
            "승인 대기 미션과 오래된 제출 확인",
            "제출물이 있는 미션을 먼저 요약",
            "보상 지급 전 제외/확인 필요 후보 구분",
        ],
        bank: [
            "승인 대기 은행 요청 확인",
            "금액이 큰 요청과 오래 기다린 요청 구분",
            "승인 전 잔액/신용/대출 상태 확인",
        ],
    };
    return [`${prefix} 점검 대상 열기`, ...(byDomain[domain] || [
        "미처리 항목 확인",
        "반복되는 학생이나 항목 확인",
        "안내문 또는 처리 순서 초안 만들기",
    ])];
};

const buildRoutineFromActivitySignal = (signal) => {
    if (!signal || signal.weekCount < 2 || signal.count < 3) return null;

    const label = getRoutineDomainLabel(signal.domain);
    const cadenceLabel = getRoutineCadenceLabel(signal.cadence, signal.topWeekday);
    const confidence = signal.weekCount >= 4 || signal.count >= 8 ||
        signal.monthEndCount >= 2 ?
        "medium" :
        "low";
    const draftItems = getRoutineDraftItems(signal.domain, cadenceLabel);

    return {
        id: `activity-${signal.domain}-routine`,
        domain: signal.domain,
        title: `${cadenceLabel} ${label} 반복 업무 준비`,
        confidence,
        detectedPattern: buildRoutineDetectedPattern({ signal, label, cadenceLabel }),
        currentWorkload: {
            recentLogCount: signal.count,
            recentWeekCount: signal.weekCount,
            topWeekday: signal.topWeekday,
            topWeekdayCount: signal.topWeekdayCount,
            topWeekdayShare: signal.topWeekdayShare,
            monthEndCount: signal.monthEndCount || 0,
            monthStartCount: signal.monthStartCount || 0,
            cadence: signal.cadence,
            latestAt: signal.latestAt,
        },
        suggestedDraft: {
            type: "checklist",
            title: `${cadenceLabel} ${label} 점검 목록`,
            items: draftItems,
        },
        nextPrompt: `${cadenceLabel} ${label} 점검 목록을 준비할까요?`,
        evidence: signal.sampleDescriptions,
        executable: false,
        requiresConfirmation: true,
        suggestedQuestions: [
            "반복 패턴을 설명해줘",
            "점검 목록을 만들어줘",
            "안내문 초안을 써줘",
        ],
    };
};

const buildRoutineFromExecutionLogs = (recentExecutionLogs = {}) => {
    const items = Array.isArray(recentExecutionLogs.items) ? recentExecutionLogs.items : [];
    if (items.length < 2) return null;

    const grouped = new Map();
    items.forEach((item) => {
        const actionType = item.actionType || "unknown";
        const current = grouped.get(actionType) || {
            actionType,
            domain: item.domain || "dashboard",
            count: 0,
            confirmedCount: 0,
            preparedCount: 0,
            samples: [],
        };
        current.count += 1;
        if (item.status === "confirmed") current.confirmedCount += 1;
        if (item.status === "prepared") current.preparedCount += 1;
        if (item.summary && current.samples.length < 3) current.samples.push(item.summary);
        grouped.set(actionType, current);
    });

    const top = [...grouped.values()]
        .filter((item) => item.count >= 2)
        .sort((a, b) => b.confirmedCount - a.confirmedCount || b.count - a.count)[0];
    if (!top) return null;

    const registryItem = AGENT_ACTION_REGISTRY[top.actionType] || {};
    const label = registryItem.label || "AI 실행안";
    return {
        id: "execution-log-" + top.actionType + "-routine",
        domain: registryItem.domain || top.domain || "dashboard",
        title: label + " 반복 준비",
        confidence: top.confirmedCount >= 2 ? "medium" : "low",
        detectedPattern:
            "최근 AI 실행안 기록에서 " + label + " 유형이 " + top.count + "회 반복되었습니다. " +
            "자동 실행이 아니라 다음 검토용 준비 후보로만 제안합니다.",
        currentWorkload: {
            recentExecutionLogCount: top.count,
            confirmedExecutionLogCount: top.confirmedCount,
            preparedExecutionLogCount: top.preparedCount,
            actionType: top.actionType,
        },
        suggestedDraft: {
            type: top.actionType === "prepare_notice_draft" ? "messageDraft" : "checklist",
            title: label + " 반복 준비 점검표",
            items: [
                "최근 저장/검토한 실행안과 같은 업무인지 확인",
                "이번에 제외할 학생이나 항목이 있는지 확인",
                "최종 실행은 관련 페이지에서 선생님이 직접 확인",
            ],
        },
        nextPrompt: label + " 반복 준비 목록을 만들어줘",
        evidence: top.samples,
        executable: false,
        requiresConfirmation: true,
    };
};

const buildRoutineCandidates = ({
    policePendingCount,
    rentDueCount,
    pendingStoreCount,
    activitySignals = null,
    recentExecutionLogs = null,
}) => {
    const candidates = [];
    const usedIds = new Set();

    if (activitySignals?.available) {
        activitySignals.domains
            .map(buildRoutineFromActivitySignal)
            .filter(Boolean)
            .sort((a, b) => {
                const confidenceWeight = { medium: 2, low: 1 };
                return (confidenceWeight[b.confidence] || 0) - (confidenceWeight[a.confidence] || 0);
            })
            .slice(0, 4)
            .forEach((candidate) => {
                candidates.push(candidate);
                usedIds.add(candidate.id);
            });
    }

    const executionLogCandidate = buildRoutineFromExecutionLogs(recentExecutionLogs);
    if (executionLogCandidate && !usedIds.has(executionLogCandidate.id)) {
        candidates.push(executionLogCandidate);
        usedIds.add(executionLogCandidate.id);
    }

    const addFallbackCandidate = (candidate) => {
        if (usedIds.has(candidate.id)) return;
        candidates.push(candidate);
        usedIds.add(candidate.id);
    };

    if (policePendingCount > 0 && !usedIds.has("activity-police-routine")) {
        addFallbackCandidate({
            id: "weekly-police-review",
            title: "생활 규칙 점검 목록 준비",
            confidence: "low",
            detectedPattern: "초기 후보: 미처리 신고가 남아 있어 정기 점검 업무로 발전시킬 수 있습니다.",
            currentWorkload: { reportsPending: policePendingCount },
            suggestedDraft: {
                type: "checklist",
                title: "생활 규칙 점검 목록",
                items: [
                    "미처리 신고 확인",
                    "반복 발생 학생 여부 확인",
                    "안내 또는 반성문 기준 확인",
                ],
            },
            nextPrompt: "생활 규칙 점검 목록을 준비할까요?",
            executable: false,
            requiresConfirmation: true,
        });
    }

    if (rentDueCount > 0 && !usedIds.has("activity-realestate-routine")) {
        addFallbackCandidate({
            id: "rent-due-reminder",
            title: "자리세/임대료 안내 초안 준비",
            confidence: "low",
            detectedPattern: "초기 후보: 자리세/임대료 미납이 있어 안내 업무로 준비할 수 있습니다.",
            currentWorkload: { rentDueCount },
            suggestedDraft: {
                type: "messageDraft",
                title: "자리세/임대료 안내문",
                items: [
                    "미납 학생 목록 확인",
                    "잔액 부족 학생과 납부 지연 학생 구분",
                    "납부 안내 문구 준비",
                ],
            },
            nextPrompt: "자리세 안내문 초안을 만들까요?",
            executable: false,
            requiresConfirmation: true,
        });
    }

    if (pendingStoreCount > 0 && !usedIds.has("activity-store-routine")) {
        addFallbackCandidate({
            id: "store-redemption-review",
            title: "스토어 처리 대기 정리",
            confidence: "low",
            detectedPattern: "초기 후보: 스토어 처리 대기가 있어 묶음 정리 업무로 준비할 수 있습니다.",
            currentWorkload: { pendingStoreCount },
            suggestedDraft: {
                type: "checklist",
                title: "스토어 처리 대기 점검",
                items: [
                    "오래 기다린 요청 확인",
                    "같은 학생의 중복 요청 묶기",
                    "수령/사용 처리 누락 확인",
                ],
            },
            nextPrompt: "스토어 처리 대기 목록을 정리할까요?",
            executable: false,
            requiresConfirmation: true,
        });
    }

    return candidates;
};

const getSummaryData = async (classId, key) => {
    const snap = await db.doc(notificationSummaryPath(classId, key)).get();
    return snap.exists ? snap.data() || {} : {};
};

const countPendingStoreRedemptions = async (classId) => {
    const snap = await db
        .collection(`classes/${classId}/storeRedemptions`)
        .where("status", "==", "pending")
        .get();
    return snap.size;
};

const readStudentEconomySignals = async (classId) => {
    const snap = await db
        .collection(`classes/${classId}/students`)
        .select(
            "role",
            "status",
            "name",
            "displayName",
            "studentNumber",
            "assets",
            "creditScore",
            "statsExclusion",
        )
        .get();

    const students = [];
    snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const role = String(data.role || "").toLowerCase();
        const status = String(data.status || "").toLowerCase();
        if (role !== "student" || status === "deleted" || status === "inactive") return;
        if (isMonetaryAggregateExcluded(data)) return;

        students.push({
            uid: docSnap.id,
            name: data.name || data.displayName || "학생",
            studentNumber: data.studentNumber ?? null,
            cash: toFiniteNumber(data.assets?.cash),
            creditScore: Number.isFinite(Number(data.creditScore)) ?
                Number(data.creditScore) :
                null,
        });
    });

    const activeStudentCount = students.length;
    const cashValues = students.map((student) => student.cash);
    const totalCash = cashValues.reduce((sum, cash) => sum + cash, 0);
    const sortedCash = [...cashValues].sort((a, b) => a - b);
    const medianCash = sortedCash.length ?
        sortedCash[Math.floor(sortedCash.length / 2)] :
        0;
    const topCashStudentCount = activeStudentCount > 0 ?
        Math.max(1, Math.ceil(activeStudentCount * 0.2)) :
        0;
    const topCashTotal = [...cashValues]
        .sort((a, b) => b - a)
        .slice(0, topCashStudentCount)
        .reduce((sum, cash) => sum + cash, 0);
    const lowCreditScores = students
        .map((student) => student.creditScore)
        .filter((score) => Number.isFinite(score) && score < 600);

    return {
        activeStudentCount,
        cashDistribution: {
            totalCash: roundMetric(totalCash),
            averageCash: activeStudentCount ? roundMetric(totalCash / activeStudentCount) : 0,
            medianCash: roundMetric(medianCash),
            top20Share: totalCash > 0 ? roundMetric(topCashTotal / totalCash, 3) : 0,
            topCashStudentCount,
            zeroOrNegativeCashCount: cashValues.filter((cash) => cash <= 0).length,
        },
        credit: {
            lowCreditCount: lowCreditScores.length,
            lowestCreditScore: lowCreditScores.length ? Math.min(...lowCreditScores) : null,
        },
    };
};

const timestampToDate = (value) => {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const {
    ROUTINE_DOMAIN_DEEP_LINKS,
    applyRoutineScheduleMetadata,
    readAgentRoutineSettings,
    routineSettingsPath,
    sanitizeRoutineSettingsUpdate,
} = createAgentRoutineHelpers({
    admin,
    db,
    HttpsError,
    timestampToDate,
});

const isTaxBillPaidForSignal = (bill = {}) =>
    bill.isPaid === true || String(bill.status || "").toLowerCase() === "paid";

const isRealEstateTaxBill = (bill = {}) => {
    const raw = [bill.billKind, bill.taxType, bill.source, bill.description, bill.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return raw.includes("realestate") || raw.includes("holding") || raw.includes("rent");
};

const incrementStudentSignal = (map, key, base = {}) => {
    if (!key) return null;
    if (!map.has(key)) {
        map.set(key, {
            uid: key,
            name: base.name || "학생",
            studentNumber: base.studentNumber ?? null,
            count: 0,
            amount: 0,
            maxDays: 0,
        });
    }
    return map.get(key);
};

const readUnpaidTaxBillSignals = async (classId, students = []) => {
    const nowMs = Date.now();
    const studentMap = new Map(students.map((student) => [student.uid, student]));
    const byStudent = new Map();
    let unpaidBillCount = 0;
    let overdueBillCount = 0;
    let realEstateOverdueBillCount = 0;
    let totalUnpaidAmount = 0;
    let totalOverdueAmount = 0;

    const billSnapshots = await Promise.all(
        students.slice(0, 80).map(async (student) => {
            try {
                const snap = await db
                    .collection(`classes/${classId}/students/${student.uid}/taxBills`)
                    .where("isPaid", "==", false)
                    .limit(30)
                    .get();
                return { student, docs: snap.docs };
            } catch (error) {
                console.warn(
                    `[aiAgentSummary] tax bill signal read failed for ${student.uid}:`,
                    error?.message || error,
                );
                return { student, docs: [] };
            }
        }),
    );

    billSnapshots.forEach(({ student, docs }) => {
        docs.forEach((docSnap) => {
            const bill = docSnap.data() || {};
            if (isTaxBillPaidForSignal(bill)) return;

            unpaidBillCount += 1;
            const amount = Math.max(0, toFiniteNumber(bill.amount));
            totalUnpaidAmount += amount;
            const dueDate = timestampToDate(bill.dueAt || bill.dueDate);
            const overdueDays = dueDate ?
                Math.max(0, Math.floor((nowMs - dueDate.getTime()) / (24 * 60 * 60 * 1000))) :
                0;
            const isOverdue = overdueDays > 0;
            if (!isOverdue) return;

            overdueBillCount += 1;
            totalOverdueAmount += amount;
            if (isRealEstateTaxBill(bill)) realEstateOverdueBillCount += 1;

            const studentSignal = incrementStudentSignal(
                byStudent,
                bill.studentUid || student.uid,
                studentMap.get(bill.studentUid || student.uid) || student,
            );
            if (studentSignal) {
                studentSignal.count += 1;
                studentSignal.amount += amount;
                studentSignal.maxDays = Math.max(studentSignal.maxDays, overdueDays);
            }
        });
    });

    return {
        unpaidBillCount,
        overdueBillCount,
        overdueStudentCount: byStudent.size,
        realEstateOverdueBillCount,
        totalUnpaidAmount: roundMetric(totalUnpaidAmount),
        totalOverdueAmount: roundMetric(totalOverdueAmount),
        topOverdueStudents: Array.from(byStudent.values())
            .sort((a, b) => b.count - a.count || b.amount - a.amount)
            .slice(0, 5)
            .map((entry) => ({
                ...entry,
                amount: roundMetric(entry.amount),
            })),
    };
};

const isPendingPoliceReportStatus = (status) => {
    const normalized = String(status || "pending").toLowerCase();
    return !normalized.startsWith("resolved") && normalized !== "cancelled";
};

const readPoliceRiskSignals = async (classId, { windowDays = 30 } = {}) => {
    const windowStartMs = Date.now() - (windowDays * 24 * 60 * 60 * 1000);
    const reportByStudent = new Map();
    const fineByStudent = new Map();
    let pendingReportCount = 0;
    let recentFineCount = 0;
    let recentFineAmount = 0;
    let submittedReflectionCount = 0;

    const [reportSnap, fineSnap, reflectionSnap] = await Promise.all([
        db.collection(`classes/${classId}/policeReports`)
            .orderBy("createdAt", "desc")
            .limit(120)
            .get()
            .catch((error) => {
                console.warn("[aiAgentSummary] policeReports read failed:", error?.message || error);
                return { docs: [] };
            }),
        db.collection(`classes/${classId}/policeFineHistory`)
            .orderBy("appliedAt", "desc")
            .limit(160)
            .get()
            .catch((error) => {
                console.warn("[aiAgentSummary] policeFineHistory read failed:", error?.message || error);
                return { docs: [] };
            }),
        db.collection(`classes/${classId}/reflections`)
            .where("status", "==", "submitted")
            .limit(80)
            .get()
            .catch((error) => {
                console.warn("[aiAgentSummary] reflections read failed:", error?.message || error);
                return { docs: [] };
            }),
    ]);

    reportSnap.docs.forEach((docSnap) => {
        const report = docSnap.data() || {};
        if (!isPendingPoliceReportStatus(report.status)) return;
        pendingReportCount += 1;
        const uid = report.accusedStudentUid || report.studentUid;
        const signal = incrementStudentSignal(reportByStudent, uid, {
            name: report.accusedStudentName || report.studentName || "학생",
            studentNumber: report.accusedStudentNumber ?? report.studentNumber ?? null,
        });
        if (signal) signal.count += 1;
    });

    fineSnap.docs.forEach((docSnap) => {
        const fine = docSnap.data() || {};
        if (fine.status === "cancelled" || fine.isCancelled === true) return;
        if (String(fine.type || "") !== "fine") return;
        const appliedAt = timestampToDate(fine.appliedAt);
        if (appliedAt && appliedAt.getTime() < windowStartMs) return;
        const amount = Math.abs(toFiniteNumber(fine.amountSigned));
        recentFineCount += 1;
        recentFineAmount += amount;
        const signal = incrementStudentSignal(fineByStudent, fine.studentUid, {
            name: fine.studentName || "학생",
            studentNumber: fine.studentNumber ?? null,
        });
        if (signal) {
            signal.count += 1;
            signal.amount += amount;
        }
    });

    submittedReflectionCount = reflectionSnap.docs.length;

    return {
        pendingReportCount,
        submittedReflectionCount,
        recentFineCount,
        recentFineAmount: roundMetric(recentFineAmount),
        repeatReportStudents: Array.from(reportByStudent.values())
            .filter((entry) => entry.count >= 2)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5),
        repeatFineStudents: Array.from(fineByStudent.values())
            .filter((entry) => entry.count >= 2)
            .sort((a, b) => b.count - a.count || b.amount - a.amount)
            .slice(0, 5)
            .map((entry) => ({
                ...entry,
                amount: roundMetric(entry.amount),
            })),
    };
};

const readOperationalRiskSignals = async (classId, { windowDays = 30 } = {}) => {
    const students = await readActiveStudentEconomyRows(classId);
    const [tax, police] = await Promise.all([
        readUnpaidTaxBillSignals(classId, students),
        readPoliceRiskSignals(classId, { windowDays }),
    ]);

    return {
        windowDays,
        tax,
        police,
    };
};
const normalizeStoreMetrics = (metrics = {}) => ({
    completedAmount: roundMetric(metrics.completedAmount),
    completedCount: toCount(metrics.completedCount),
    redeemedVolume: roundMetric(metrics.redeemedVolume),
    redeemedCount: toCount(metrics.redeemedCount),
    refundAmount: roundMetric(metrics.refundAmount),
    refundCount: toCount(metrics.refundCount),
    netSpend: roundMetric(metrics.netSpend),
    participantCount: toCount(metrics.participantCount),
});

const readRecentMonetaryHistory = async (classId, { limit = 45 } = {}) => {
    const snap = await db
        .collection(`classes/${classId}/monetaryHistory`)
        .orderBy("date", "desc")
        .limit(limit)
        .get();

    return snap.docs
        .map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() || {}),
            date: docSnap.data()?.date || docSnap.id,
        }))
        .filter((item) => parseDateKeyMs(item.date) !== null);
};

const getHistoryNetWorth = (record, fallback = 0) =>
    roundMetric(record?.netWorth ?? record?.totalNetWorth ?? fallback);

const getHistoryCash = (record, fallback = 0) =>
    roundMetric(record?.cash ?? record?.assets?.cash ?? fallback);

const compactStudentChange = (entry) => ({
    uid: entry.uid,
    name: entry.name,
    studentNumber: entry.studentNumber,
    latestDate: entry.latestDate,
    comparisonDate: entry.comparisonDate,
    currentCash: entry.currentCash,
    cashChange: entry.cashChange,
    currentNetWorth: entry.currentNetWorth,
    netWorthChange: entry.netWorthChange,
    netWorthChangeRate: entry.netWorthChangeRate,
    currentCreditScore: entry.currentCreditScore,
    creditScoreChange: entry.creditScoreChange,
});

const normalizeStudentJobNamesForSignal = (jobs = []) => {
    const rawJobs = Array.isArray(jobs) ? jobs : (jobs ? [jobs] : []);
    return rawJobs
        .map((job) => String(job || "").trim())
        .filter((job) => job && job !== "없음");
};

const normalizeCachedPayrollSignals = (data = {}) => {
    if (!data || Number(data.summaryVersion || 0) < 1) return null;

    return {
        source: "economyBaselineCache",
        activeStudentCount: toCount(data.activeStudentCount),
        jobDefinitionCount: toCount(data.jobDefinitionCount),
        assignedStudentCount: toCount(data.assignedStudentCount),
        unassignedStudentCount: toCount(data.unassignedStudentCount),
        assignedStudentRate: Number.isFinite(Number(data.assignedStudentRate)) ?
            Number(data.assignedStudentRate) :
            0,
        weeklyPayrollLiability: roundMetric(data.weeklyPayrollLiability),
        averageWeeklySalary: roundMetric(data.averageWeeklySalary),
        medianWeeklySalary: roundMetric(
            data.medianWeeklySalary ?? data.baselineWeeklySalary,
        ),
        baselineWeeklySalary: roundMetric(data.baselineWeeklySalary),
        targetShortageJobs: Array.isArray(data.targetShortageJobs) ?
            data.targetShortageJobs.slice(0, 5) :
            [],
        unassignedStudents: Array.isArray(data.unassignedStudents) ?
            data.unassignedStudents.slice(0, 5) :
            [],
    };
};

const readCachedPayrollSignals = async (classId) => {
    const snap = await db.doc(dashboardSummaryPath(classId, "economyBaseline")).get();
    if (!snap.exists) return null;
    return normalizeCachedPayrollSignals(snap.data() || {});
};

const readStoreAffordabilitySignals = async (classId) => {
    const [students, itemSnap] = await Promise.all([
        readActiveStudentEconomyRows(classId),
        db.collection(`classes/${classId}/storeItems`).limit(200).get().catch((error) => {
            console.warn("[aiAgentSummary] storeItems read failed:", error?.message || error);
            return { docs: [] };
        }),
    ]);
    const cashValues = students
        .map((student) => toFiniteNumber(student.cash))
        .sort((a, b) => a - b);
    const activeItems = itemSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
        .filter((item) => {
            const price = toFiniteNumber(item.effectivePrice ?? item.price);
            const currencyType = String(item.currencyType || item.currency || "cash").toLowerCase();
            const isClassCash = !currencyType || ["cash", "money", "class", "default"].includes(currencyType);
            const hasStock = item.stock === undefined || item.stock === null || Number(item.stock) !== 0;
            return item.isActive !== false && isClassCash && hasStock && price > 0;
        })
        .map((item) => ({
            id: item.id,
            name: item.name || item.title || "상품",
            price: roundMetric(item.effectivePrice ?? item.price),
            stock: item.stock ?? null,
        }))
        .sort((a, b) => a.price - b.price);

    const activeStudentCount = students.length;
    const medianCash = cashValues.length ? cashValues[Math.floor(cashValues.length / 2)] : 0;
    const averageCash = cashValues.length ?
        roundMetric(cashValues.reduce((sum, value) => sum + value, 0) / cashValues.length) :
        0;
    const prices = activeItems.map((item) => item.price);
    const medianItemPrice = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
    const lowestItemPrice = prices[0] || 0;
    const highItemThreshold = medianCash > 0 ? medianCash * 2 : null;
    const affordableMedianCount = medianItemPrice > 0 ?
        cashValues.filter((cash) => cash >= medianItemPrice).length :
        0;
    const affordableLowestCount = lowestItemPrice > 0 ?
        cashValues.filter((cash) => cash >= lowestItemPrice).length :
        0;

    return {
        activeItemCount: activeItems.length,
        activeStudentCount,
        lowestItemPrice,
        medianItemPrice,
        highestItemPrice: prices.length ? prices[prices.length - 1] : 0,
        medianCash: roundMetric(medianCash),
        averageCash,
        medianCashToMedianPriceRatio: medianItemPrice > 0 ?
            roundMetric(medianCash / medianItemPrice, 2) :
            null,
        averageCashToMedianPriceRatio: medianItemPrice > 0 ?
            roundMetric(averageCash / medianItemPrice, 2) :
            null,
        affordableStudentRateForMedianItem: activeStudentCount ?
            roundMetric(affordableMedianCount / activeStudentCount, 3) :
            0,
        affordableStudentRateForLowestItem: activeStudentCount ?
            roundMetric(affordableLowestCount / activeStudentCount, 3) :
            0,
        highPriceItemCount: highItemThreshold ?
            activeItems.filter((item) => item.price >= highItemThreshold).length :
            0,
        cheapestItems: activeItems.slice(0, 3),
        expensiveItems: activeItems.slice(-3).reverse(),
    };
};

const readPayrollSignals = async (classId) => {
    const cachedSignals = await readCachedPayrollSignals(classId).catch((error) => {
        console.warn("[aiAgentSummary] economyBaseline read failed:", error?.message || error);
        return null;
    });
    if (cachedSignals) return cachedSignals;

    const [students, jobSnap] = await Promise.all([
        readActiveStudentEconomyRows(classId),
        db.collection(`classes/${classId}/jobDefinitions`).limit(120).get().catch((error) => {
            console.warn("[aiAgentSummary] jobDefinitions read failed:", error?.message || error);
            return { docs: [] };
        }),
    ]);
    const jobDefinitions = jobSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
        .filter((job) => String(job.name || "").trim())
        .map((job) => ({
            id: job.id,
            name: String(job.name || "").trim(),
            baseSalary: roundMetric(job.baseSalary),
            targetHeadcount: Number.isFinite(Number(job.targetHeadcount)) ?
                Math.max(0, Math.floor(Number(job.targetHeadcount))) :
                null,
        }));
    const jobByName = new Map(jobDefinitions.map((job) => [job.name, job]));
    const assignedStudents = [];
    const unassignedStudents = [];
    const headcountByJob = new Map(jobDefinitions.map((job) => [job.name, 0]));
    let weeklyPayrollLiability = 0;

    students.forEach((student) => {
        const jobs = normalizeStudentJobNamesForSignal(student.jobs || student.job);
        if (jobs.length === 0) {
            unassignedStudents.push(student);
            return;
        }
        const weeklySalary = jobs.reduce((sum, jobName) => {
            const definition = jobByName.get(jobName);
            if (definition) {
                headcountByJob.set(jobName, (headcountByJob.get(jobName) || 0) + 1);
            }
            return sum + toFiniteNumber(definition?.baseSalary);
        }, 0);
        weeklyPayrollLiability += weeklySalary;
        assignedStudents.push({
            uid: student.uid,
            name: student.name,
            studentNumber: student.studentNumber,
            jobs,
            weeklySalary: roundMetric(weeklySalary),
        });
    });

    const salaries = assignedStudents
        .map((student) => student.weeklySalary)
        .filter((salary) => salary > 0)
        .sort((a, b) => a - b);
    const targetShortageJobs = jobDefinitions
        .filter((job) => job.targetHeadcount !== null && (headcountByJob.get(job.name) || 0) < job.targetHeadcount)
        .map((job) => ({
            id: job.id,
            name: job.name,
            baseSalary: job.baseSalary,
            targetHeadcount: job.targetHeadcount,
            assignedHeadcount: headcountByJob.get(job.name) || 0,
            shortage: job.targetHeadcount - (headcountByJob.get(job.name) || 0),
        }))
        .sort((a, b) => b.shortage - a.shortage)
        .slice(0, 5);

    return {
        activeStudentCount: students.length,
        jobDefinitionCount: jobDefinitions.length,
        assignedStudentCount: assignedStudents.length,
        unassignedStudentCount: unassignedStudents.length,
        assignedStudentRate: students.length ?
            roundMetric(assignedStudents.length / students.length, 3) :
            0,
        weeklyPayrollLiability: roundMetric(weeklyPayrollLiability),
        averageWeeklySalary: assignedStudents.length ?
            roundMetric(weeklyPayrollLiability / assignedStudents.length) :
            0,
        medianWeeklySalary: salaries.length ? salaries[Math.floor(salaries.length / 2)] : 0,
        targetShortageJobs,
        unassignedStudents: unassignedStudents.slice(0, 5).map((student) => ({
            uid: student.uid,
            name: student.name,
            studentNumber: student.studentNumber,
            cash: student.cash,
            creditScore: student.creditScore,
        })),
    };
};

const readStudentChangeSignals = async (classId, { windowDays = 30 } = {}) => {
    const students = await readActiveStudentEconomyRows(classId);
    const limit = Math.min(90, windowDays + 25);
    const sampledStudents = students.slice(0, 60);

    const trends = await Promise.all(
        sampledStudents.map(async (student) => {
            try {
                const [assetHistory, creditHistory] = await Promise.all([
                    readStudentDatedHistory({
                        classId,
                        studentUid: student.uid,
                        collectionName: "assetHistory",
                        limit,
                    }).catch((error) => {
                        console.warn(
                            `[aiAgentSummary] asset history read failed for ${student.uid}:`,
                            error?.message || error,
                        );
                        return [];
                    }),
                    readStudentDatedHistory({
                        classId,
                        studentUid: student.uid,
                        collectionName: "creditHistory",
                        limit,
                    }).catch((error) => {
                        console.warn(
                            `[aiAgentSummary] credit history read failed for ${student.uid}:`,
                            error?.message || error,
                        );
                        return [];
                    }),
                ]);
                const latestAsset = assetHistory[0] || null;
                const comparisonAsset = latestAsset ?
                    pickComparisonHistory(assetHistory.slice(1), latestAsset.date, windowDays) :
                    null;
                const latestCredit = creditHistory[0] || null;
                const comparisonCredit = latestCredit ?
                    pickComparisonHistory(creditHistory.slice(1), latestCredit.date, windowDays) :
                    null;
                const currentNetWorth = getHistoryNetWorth(latestAsset, student.totalNetWorth);
                const comparisonNetWorth = comparisonAsset ?
                    getHistoryNetWorth(comparisonAsset, student.totalNetWorth) :
                    null;
                const currentCash = getHistoryCash(latestAsset, student.cash);
                const comparisonCash = comparisonAsset ?
                    getHistoryCash(comparisonAsset, student.cash) :
                    null;
                const currentCreditScore = latestCredit?.score ?? student.creditScore;
                const comparisonCreditScore = comparisonCredit?.score ?? null;

                return {
                    uid: student.uid,
                    name: student.name,
                    studentNumber: student.studentNumber,
                    latestDate: latestAsset?.date || latestCredit?.date || null,
                    comparisonDate: comparisonAsset?.date || comparisonCredit?.date || null,
                    hasAssetComparison: Boolean(comparisonAsset),
                    hasCreditComparison: Boolean(comparisonCredit),
                    currentCash,
                    cashChange: comparisonAsset ? roundMetric(currentCash - comparisonCash) : null,
                    currentNetWorth,
                    netWorthChange: comparisonAsset ?
                        roundMetric(currentNetWorth - comparisonNetWorth) :
                        null,
                    netWorthChangeRate: comparisonAsset ?
                        percentChange(currentNetWorth, comparisonNetWorth) :
                        null,
                    currentCreditScore,
                    creditScoreChange: comparisonCredit ?
                        roundMetric(
                            toFiniteNumber(currentCreditScore) -
                                toFiniteNumber(comparisonCreditScore),
                        ) :
                        null,
                };
            } catch (error) {
                console.warn(
                    `[aiAgentSummary] student change signal read failed for ${student.uid}:`,
                    error?.message || error,
                );
                return null;
            }
        }),
    );

    const validTrends = trends.filter(Boolean);
    const assetTrends = validTrends.filter((entry) => entry.hasAssetComparison);
    const creditTrends = validTrends.filter((entry) => entry.hasCreditComparison);
    const byNetWorthDrop = [...assetTrends]
        .filter((entry) => entry.netWorthChange < 0)
        .sort((a, b) => a.netWorthChange - b.netWorthChange);
    const byNetWorthIncrease = [...assetTrends]
        .filter((entry) => entry.netWorthChange > 0)
        .sort((a, b) => b.netWorthChange - a.netWorthChange);
    const byCashDrop = [...assetTrends]
        .filter((entry) => entry.cashChange < 0)
        .sort((a, b) => a.cashChange - b.cashChange);
    const byCreditDrop = [...creditTrends]
        .filter((entry) => entry.creditScoreChange < 0)
        .sort((a, b) => a.creditScoreChange - b.creditScoreChange);

    return {
        windowDays,
        scannedStudentCount: sampledStudents.length,
        studentsWithAssetComparisonCount: assetTrends.length,
        studentsWithCreditComparisonCount: creditTrends.length,
        largestNetWorthDrops: byNetWorthDrop.slice(0, 5).map(compactStudentChange),
        largestNetWorthIncreases: byNetWorthIncrease.slice(0, 5).map(compactStudentChange),
        largestCashDrops: byCashDrop.slice(0, 5).map(compactStudentChange),
        largestCreditDrops: byCreditDrop.slice(0, 5).map(compactStudentChange),
    };
};

const buildAgentAnalyticsDaily = async (classId, { dateKey = null } = {}) => {
    const generatedForDate = dateKey || formatDateKeyInKST(new Date());
    const [
        monetaryHistory,
        studentEconomySignals,
        operationalRisks,
        studentChangeSignals,
        storeAffordability,
        payrollSignals,
    ] = await Promise.all([
        readRecentMonetaryHistory(classId),
        readStudentEconomySignals(classId),
        readOperationalRiskSignals(classId, { windowDays: 30 }),
        readStudentChangeSignals(classId, { windowDays: 30 }),
        readStoreAffordabilitySignals(classId),
        readPayrollSignals(classId),
    ]);

    const latest = monetaryHistory[0] || null;
    const comparison7d = latest ?
        pickComparisonHistory(monetaryHistory.slice(1), latest.date, 7) :
        null;
    const comparison30d = latest ?
        pickComparisonHistory(monetaryHistory.slice(1), latest.date, 30) :
        null;
    const latestStore7d = normalizeStoreMetrics(latest?.storeMetrics?.["7d"] || latest || {});
    const latestStore30d = normalizeStoreMetrics(latest?.storeMetrics?.["30d"] || {});
    const comparisonStore7d = normalizeStoreMetrics(
        comparison30d?.storeMetrics?.["7d"] || comparison30d || {},
    );
    const activeStudentCount = toCount(studentEconomySignals.activeStudentCount);
    const liquidMoney = roundMetric(latest?.liquidMoney);
    const totalClassAssets = roundMetric(latest?.totalClassAssets || latest?.totalWealth);
    const m0 = roundMetric(latest?.M0);
    const m2 = roundMetric(latest?.M2);
    const liquidMoneyChangeRate30d = percentChange(
        latest?.liquidMoney,
        comparison30d?.liquidMoney,
    );
    const totalClassAssetsChangeRate30d = percentChange(
        latest?.totalClassAssets || latest?.totalWealth,
        comparison30d?.totalClassAssets || comparison30d?.totalWealth,
    );
    const redeemedCountChangeRate30d = percentChange(
        latestStore7d.redeemedCount,
        comparisonStore7d.redeemedCount,
    );
    const netSpendChangeRate30d = percentChange(
        latestStore7d.netSpend,
        comparisonStore7d.netSpend,
    );

    const hasHistoryComparison30d = Boolean(comparison30d);
    const consumptionStatus =
        hasHistoryComparison30d &&
        (redeemedCountChangeRate30d <= -0.25 || netSpendChangeRate30d <= -0.25) ?
            "attention" :
            latestStore30d.redeemedCount > 0 ? "watch" : "unknown";
    const cashDistribution = studentEconomySignals.cashDistribution || {};
    const credit = studentEconomySignals.credit || {};
    const liquidityStatus =
        cashDistribution.zeroOrNegativeCashCount >= 3 ||
        cashDistribution.top20Share >= 0.6 ?
            "attention" :
            latest ? "watch" : "unknown";
    const payrollSignalsWithRatios = {
        ...payrollSignals,
        medianWeeklySalaryToMedianItemPriceRatio:
            storeAffordability.medianItemPrice > 0 ?
                roundMetric(payrollSignals.medianWeeklySalary / storeAffordability.medianItemPrice, 2) :
                null,
        averageWeeklySalaryToMedianItemPriceRatio:
            storeAffordability.medianItemPrice > 0 ?
                roundMetric(payrollSignals.averageWeeklySalary / storeAffordability.medianItemPrice, 2) :
                null,
    };
    const enrichedOperationalRisks = {
        ...operationalRisks,
        tax: {
            ...(operationalRisks.tax || {}),
            overdueBillRatePerStudent: activeStudentCount ?
                roundMetric((operationalRisks.tax?.overdueBillCount || 0) / activeStudentCount, 3) :
                0,
            overdueStudentRate: activeStudentCount ?
                roundMetric((operationalRisks.tax?.overdueStudentCount || 0) / activeStudentCount, 3) :
                0,
            realEstateOverdueShare: operationalRisks.tax?.overdueBillCount ?
                roundMetric(
                    (operationalRisks.tax?.realEstateOverdueBillCount || 0) /
                        operationalRisks.tax.overdueBillCount,
                    3,
                ) :
                0,
        },
        police: {
            ...(operationalRisks.police || {}),
            pendingReportRatePerStudent: activeStudentCount ?
                roundMetric((operationalRisks.police?.pendingReportCount || 0) / activeStudentCount, 3) :
                0,
            repeatFineStudentRate: activeStudentCount ?
                roundMetric(
                    (operationalRisks.police?.repeatFineStudents?.length || 0) /
                        activeStudentCount,
                    3,
                ) :
                0,
        },
    };

    return {
        schemaVersion: AGENT_ANALYTICS_SCHEMA_VERSION,
        generatedForDate,
        date: generatedForDate,
        generatedAt: FieldValue.serverTimestamp(),
        source: "rebuildAgentAnalyticsDaily",
        sourceUpdatedAt: {
            monetaryHistory: toIsoString(latest?.timestamp) || latest?.date || null,
            students: new Date().toISOString(),
            storeItems: new Date().toISOString(),
            jobDefinitions: new Date().toISOString(),
        },
        windows: {
            historyDayCount: monetaryHistory.length,
            latestMonetaryDate: latest?.date || null,
            comparison7dDate: comparison7d?.date || null,
            comparison30dDate: comparison30d?.date || null,
            hasHistoryComparison30d,
            studentChangeScannedCount: studentChangeSignals.scannedStudentCount,
            studentsWithAssetComparisonCount:
                studentChangeSignals.studentsWithAssetComparisonCount,
            studentsWithCreditComparisonCount:
                studentChangeSignals.studentsWithCreditComparisonCount,
            activeStoreItemCount: storeAffordability.activeItemCount,
            jobDefinitionCount: payrollSignals.jobDefinitionCount,
        },
        monetary: {
            status: liquidityStatus,
            M0: m0,
            M2: m2,
            liquidMoney,
            totalClassAssets,
            potentialLiquidity: roundMetric(latest?.potentialLiquidity),
            liquidMoneyPerStudent: activeStudentCount ?
                roundMetric(liquidMoney / activeStudentCount) :
                0,
            M0ChangeRate30d: percentChange(latest?.M0, comparison30d?.M0),
            M2ChangeRate30d: percentChange(latest?.M2, comparison30d?.M2),
            liquidMoneyChangeRate30d,
            totalClassAssetsChangeRate30d,
        },
        consumption: {
            status: consumptionStatus,
            storeMetrics7d: latestStore7d,
            storeMetrics30d: latestStore30d,
            redeemedCountChangeRate30d,
            netSpendChangeRate30d,
            participantCountChangeRate30d: percentChange(
                latestStore7d.participantCount,
                comparisonStore7d.participantCount,
            ),
        },
        studentEconomySignals,
        studentChangeSignals,
        storeAffordability,
        payrollSignals: payrollSignalsWithRatios,
        operationalRisks: enrichedOperationalRisks,
        credit: {
            status: credit.lowCreditCount >= 3 ?
                "attention" :
                credit.lowCreditCount > 0 ? "watch" : "stable",
            lowCreditCount: credit.lowCreditCount || 0,
            lowestCreditScore: credit.lowestCreditScore ?? null,
        },
        caveats: [
            latest ?
                "monetaryHistory와 현재 학생 문서 스냅샷을 바탕으로 만든 일일 분석 캐시입니다." :
                "monetaryHistory가 없어 현재 학생 문서 스냅샷 중심으로 만든 제한적 분석입니다.",
            "세금/고지서, 신고, 벌금 신호는 현재 미처리 항목과 최근 기록을 읽어 계산합니다.",
            "구매력 신호는 활성 스토어 상품 가격과 현재 학생 현금 분포를 비교합니다.",
            "급여/직업 신호는 jobDefinitions와 학생 jobs/job 필드를 읽어 계산합니다.",
            hasHistoryComparison30d ?
                "30일 전후 비교가 포함되어 있습니다." :
                "30일 비교에 충분한 monetaryHistory가 없어 변화율 일부는 비어 있습니다.",
        ],
    };
};

const persistAgentAnalyticsDaily = async (classId, analyticsDaily) => {
    const dateKey = analyticsDaily?.generatedForDate || formatDateKeyInKST(new Date());
    await db.doc(analyticsDailyPath(classId, dateKey)).set(analyticsDaily, { merge: false });
    return analyticsDaily;
};

const readAnalyticsDailySnapshots = async (classId, { windowDays = 30 } = {}) => {
    const limit = Math.min(140, Math.max(14, windowDays + 10));
    const snap = await db
        .collection(`classes/${classId}/analyticsDaily`)
        .orderBy("date", "desc")
        .limit(limit)
        .get()
        .catch((error) => {
            console.warn("[aiAgentSummary] analyticsDaily snapshot read failed:", error?.message || error);
            return null;
        });

    if (!snap) return [];
    const rows = snap.docs
        .map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() || {}),
            date: docSnap.data()?.date || docSnap.data()?.generatedForDate || docSnap.id,
        }))
        .filter((item) => parseDateKeyMs(item.date) !== null);

    const latestDate = rows[0]?.date || null;
    const latestMs = parseDateKeyMs(latestDate);
    if (!Number.isFinite(latestMs)) return rows;
    return rows.filter((item) => {
        const itemMs = parseDateKeyMs(item.date);
        if (!Number.isFinite(itemMs)) return false;
        const diffDays = Math.floor((latestMs - itemMs) / (24 * 60 * 60 * 1000));
        return diffDays >= 0 && diffDays <= windowDays + 2;
    });
};

const summarizeNumberSeries = (values = []) => {
    const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    if (!numbers.length) {
        return { latest: null, max: null, average: null, min: null };
    }
    return {
        latest: roundMetric(numbers[0], 2),
        max: roundMetric(Math.max(...numbers), 2),
        average: roundMetric(numbers.reduce((sum, value) => sum + value, 0) / numbers.length, 2),
        min: roundMetric(Math.min(...numbers), 2),
    };
};

const summarizeAnalyticsDailySnapshots = (snapshots = [], windowDays = 30) => {
    const validSnapshots = snapshots
        .filter((item) => parseDateKeyMs(item?.date) !== null)
        .sort((a, b) => parseDateKeyMs(b.date) - parseDateKeyMs(a.date));
    const latest = validSnapshots[0] || null;
    const comparison = latest ? pickComparisonHistory(validSnapshots.slice(1), latest.date, windowDays) : null;
    const expectedDays = Math.max(1, Math.min(windowDays, 120));
    const coverageRatio = roundMetric(Math.min(validSnapshots.length, expectedDays) / expectedDays, 2);

    return {
        schemaVersion: 1,
        source: "analyticsDaily",
        requestedWindowDays: windowDays,
        snapshotCount: validSnapshots.length,
        expectedDays,
        coverageRatio,
        latestDate: latest?.date || null,
        oldestDate: validSnapshots[validSnapshots.length - 1]?.date || null,
        comparisonDate: comparison?.date || null,
        hasComparison: Boolean(comparison),
        sufficientCoverage: coverageRatio >= 0.5 || validSnapshots.length >= 7,
        monetary: {
            liquidMoney: summarizeNumberSeries(validSnapshots.map((item) => item.monetary?.liquidMoney)),
            totalClassAssets: summarizeNumberSeries(validSnapshots.map((item) => item.monetary?.totalClassAssets)),
            latestLiquidMoneyChangeRate: comparison ?
                percentChange(latest?.monetary?.liquidMoney, comparison?.monetary?.liquidMoney) :
                null,
            latestTotalClassAssetsChangeRate: comparison ?
                percentChange(latest?.monetary?.totalClassAssets, comparison?.monetary?.totalClassAssets) :
                null,
        },
        operations: {
            overdueBillCount: summarizeNumberSeries(
                validSnapshots.map((item) => item.operationalRisks?.tax?.overdueBillCount),
            ),
            pendingReportCount: summarizeNumberSeries(
                validSnapshots.map((item) => item.operationalRisks?.police?.pendingReportCount),
            ),
            repeatFineStudentCount: summarizeNumberSeries(
                validSnapshots.map((item) => item.operationalRisks?.police?.repeatFineStudents?.length),
            ),
            payrollUnassignedStudentCount: summarizeNumberSeries(
                validSnapshots.map((item) => item.payrollSignals?.unassignedStudentCount),
            ),
        },
        caveats: validSnapshots.length ? [
            "analyticsDaily snapshot aggregation is read-only and may have gaps on days when the summary was not rebuilt.",
        ] : [
            "No analyticsDaily snapshots were available for this class and window.",
        ],
    };
};

const ON_DEMAND_ANALYSIS_TERMS = [
    "60일",
    "학기",
    "추이",
    "변화",
    "경제",
    "자산",
    "잔액",
    "현금",
    "신용",
    "소비",
    "스토어",
    "상점",
    "물가",
    "임금",
    "세금",
    "급여",
    "유동성",
];

const normalizeSearchText = (value) =>
    String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .trim();

const clampAnalysisWindowDays = (value) => {
    const days = Math.floor(Number(value));
    if (!Number.isFinite(days)) return 30;
    return Math.min(120, Math.max(7, days));
};

const resolveOnDemandWindowDays = (message) => {
    const text = String(message || "");
    const dayMatch = text.match(/(\d{1,3})\s*일/);
    if (dayMatch) return clampAnalysisWindowDays(dayMatch[1]);
    if (/학기|이번\s*학기/.test(text)) return 120;
    if (/두\s*달|2\s*달|60/.test(text)) return 60;
    if (/한\s*달|1\s*달|30/.test(text)) return 30;
    if (/일주일|7\s*일/.test(text)) return 7;
    return 30;
};

const shouldAttachOnDemandAnalysis = (message, activeContext) => {
    const text = String(message || "").toLowerCase();
    const contextDomain = String(activeContext?.domain || "").toLowerCase();
    const contextTool = String(activeContext?.detailTool || "").toLowerCase();
    const hasExplicitWindow = /(\d{1,3})\s*일|학기|두\s*달|한\s*달|일주일/.test(text);
    const hasEconomySubject = (
        /asset|cash|credit|economy|store|tax|salary|payroll/.test(text) ||
        ON_DEMAND_ANALYSIS_TERMS.some((term) => text.includes(term)) ||
        ["bank", "store", "tax", "realestate", "credit"].includes(contextDomain)
    );
    const hasAnalysisIntent = /분석|추이|변화|비교|상태|흐름|진단|적정|증가|감소|늘|줄|어떤가|어때/.test(text);

    return (
        contextTool.includes("analytics") ||
        contextTool.includes("economy") ||
        (hasEconomySubject && hasAnalysisIntent) ||
        (hasEconomySubject && hasExplicitWindow)
    );
};

const readActiveStudentEconomyRows = async (
    classId,
    {
        currencyField = "cash",
        includeMonetaryAggregateExcluded = false,
    } = {},
) => {
    const snap = await db
        .collection(`classes/${classId}/students`)
        .select(
            "role",
            "status",
            "name",
            "displayName",
            "studentNumber",
            "assets",
            "creditScore",
            "job",
            "jobs",
            "statsExclusion",
        )
        .get();

    const rows = [];
    snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const role = String(data.role || "").toLowerCase();
        const status = String(data.status || "").toLowerCase();
        if (role !== "student" || status === "deleted" || status === "inactive") return;
        if (!includeMonetaryAggregateExcluded && isMonetaryAggregateExcluded(data)) {
            return;
        }

        const assets = data.assets || {};
        rows.push({
            uid: docSnap.id,
            name: data.name || data.displayName || "학생",
            studentNumber: data.studentNumber ?? null,
            cash: roundMetric(assets[currencyField]),
            deposit: roundMetric(assets.deposit),
            loan: roundMetric(assets.loan),
            totalNetWorth: roundMetric(assets.totalNetWorth),
            creditScore: Number.isFinite(Number(data.creditScore)) ?
                Number(data.creditScore) :
                null,
            job: data.job || null,
            jobs: Array.isArray(data.jobs) ? data.jobs : (data.job ? [data.job] : []),
        });
    });

    return rows;
};

const readAiAssistantStudentRoster = async ({ classId, limit }) => {
    const safeLimit = Math.min(
        cashChangeEvidenceBudget.maxRosterDocuments + 1,
        Math.max(1, Number(limit || 1)),
    );
    const cached = await assistantStudentRosterCache.readThrough(
        classId,
        async () => {
            const snap = await db
                .collection(`classes/${classId}/students`)
                .select("role", "status", "name", "displayName", "studentNumber")
                .limit(safeLimit)
                .get();
            const students = snap.docs
                .map((docSnap) => {
                    const data = docSnap.data() || {};
                    const role = String(data.role || "").toLowerCase();
                    const status = String(data.status || "").toLowerCase();
                    if (role !== "student" || status === "deleted" || status === "inactive") {
                        return null;
                    }
                    return {
                        uid: docSnap.id,
                        name: data.name || data.displayName || "학생",
                        studentNumber: data.studentNumber ?? null,
                    };
                })
                .filter(Boolean)
                .slice(0, cashChangeEvidenceBudget.maxRosterDocuments);
            return {
                students,
                documentsRead: snap.size,
                truncated: snap.size > cashChangeEvidenceBudget.maxRosterDocuments,
            };
        },
    );
    return {
        items: cached.value.students,
        usage: {
            source: "student_identity_roster",
            documentReads: cached.cacheHit ?
                0 : Math.max(1, cached.value.documentsRead),
            cacheHit: cached.cacheHit,
            truncated: cached.value.truncated,
            cachedAt: new Date(cached.cachedAtMs).toISOString(),
        },
    };
};

const readAiAssistantStudentState = async ({
    classId,
    studentUid,
    currencyField,
}) => {
    const snap = await db.doc(`classes/${classId}/students/${studentUid}`).get();
    if (!snap.exists) {
        throw new HttpsError("not-found", "학생 자산 상태를 찾을 수 없습니다.");
    }
    const data = snap.data() || {};
    const role = String(data.role || "").toLowerCase();
    const status = String(data.status || "").toLowerCase();
    if (role !== "student" || status === "deleted" || status === "inactive") {
        throw new HttpsError("failed-precondition", "현재 분석할 수 없는 학생입니다.");
    }
    return {
        student: {
            uid: snap.id,
            name: data.name || data.displayName || "학생",
            studentNumber: data.studentNumber ?? null,
            cash: roundMetric(data.assets?.[currencyField]),
        },
        usage: {
            source: "student_asset_state",
            documentReads: 1,
            cacheHit: false,
        },
    };
};

const readStudentCashActivityEvents = async ({
    classId,
    studentUid,
    windowStart,
    limit = 201,
}) => {
    const startTimestamp = admin.firestore.Timestamp.fromDate(windowStart);
    const snap = await db
        .collection(`classes/${classId}/students/${studentUid}/activityLogs`)
        .where("createdAt", ">=", startTimestamp)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .select(
            "type",
            "category",
            "description",
            "amount",
            "cashDelta",
            "adjustmentDelta",
            "amountSigned",
            "amountInClassCurrency",
            "createdAt",
            "timestamp",
            "activityScope",
            "assetType",
            "currency",
        )
        .get();

    return snap.docs.map((docSnap) => {
        const data = docSnap.data() || {};
        return {
            id: docSnap.id,
            ...data,
            createdAt: toIsoString(data.createdAt || data.timestamp),
        };
    });
};

const readCachedAiAssistantCashEvents = async ({
    classId,
    studentUid,
    currencyField,
    windowStart,
    windowDays,
    limit,
}) => {
    const cacheKey = [classId, studentUid, currencyField, windowDays].join(":");
    const cached = await assistantCashEventCache.readThrough(
        cacheKey,
        () => readStudentCashActivityEvents({
            classId,
            studentUid,
            windowStart,
            limit: Math.min(
                cashChangeEvidenceBudget.maxEventDocuments,
                Math.max(1, Number(limit || 1)),
            ),
        }),
    );
    return {
        items: cached.value,
        usage: {
            source: "student_cash_events",
            documentReads: cached.cacheHit ? 0 : Math.max(1, cached.value.length),
            cacheHit: cached.cacheHit,
            truncated:
                cached.value.length >= cashChangeEvidenceBudget.maxEventDocuments,
            cachedAt: new Date(cached.cachedAtMs).toISOString(),
        },
    };
};

const findMentionedStudents = (message, students = []) => {
    const normalizedMessage = normalizeSearchText(message);
    if (!normalizedMessage) return [];

    return students
        .filter((student) => {
            const name = normalizeSearchText(student.name);
            const number = student.studentNumber === null || student.studentNumber === undefined ?
                "" :
                normalizeSearchText(`${student.studentNumber}번`);
            return (
                (name.length >= 2 && normalizedMessage.includes(name)) ||
                (number && normalizedMessage.includes(number))
            );
        })
        .slice(0, 3);
};

const readStudentDatedHistory = async ({ classId, studentUid, collectionName, limit }) => {
    const snap = await db
        .collection(`classes/${classId}/students/${studentUid}/${collectionName}`)
        .orderBy("date", "desc")
        .limit(limit)
        .get();

    return snap.docs
        .map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() || {}),
            date: docSnap.data()?.date || docSnap.id,
        }))
        .filter((item) => parseDateKeyMs(item.date) !== null);
};

const summarizeStudentTrend = async ({ classId, student, windowDays }) => {
    const limit = Math.min(140, windowDays + 20);
    const [assetHistory, creditHistory] = await Promise.all([
        readStudentDatedHistory({
            classId,
            studentUid: student.uid,
            collectionName: "assetHistory",
            limit,
        }),
        readStudentDatedHistory({
            classId,
            studentUid: student.uid,
            collectionName: "creditHistory",
            limit,
        }),
    ]);
    const latestAsset = assetHistory[0] || null;
    const comparisonAsset = latestAsset ?
        pickComparisonHistory(assetHistory.slice(1), latestAsset.date, windowDays) :
        null;
    const latestCredit = creditHistory[0] || null;
    const comparisonCredit = latestCredit ?
        pickComparisonHistory(creditHistory.slice(1), latestCredit.date, windowDays) :
        null;

    return {
        uid: student.uid,
        name: student.name,
        studentNumber: student.studentNumber,
        current: {
            cash: student.cash,
            deposit: student.deposit,
            loan: student.loan,
            totalNetWorth: student.totalNetWorth,
            creditScore: student.creditScore,
        },
        assetTrend: {
            latestDate: latestAsset?.date || null,
            comparisonDate: comparisonAsset?.date || null,
            latestNetWorth: roundMetric(latestAsset?.netWorth ?? student.totalNetWorth),
            comparisonNetWorth: comparisonAsset ?
                roundMetric(comparisonAsset.netWorth) :
                null,
            netWorthChangeRate: comparisonAsset ?
                percentChange(latestAsset?.netWorth, comparisonAsset.netWorth) :
                null,
        },
        creditTrend: {
            latestDate: latestCredit?.date || null,
            comparisonDate: comparisonCredit?.date || null,
            latestScore: latestCredit?.score ?? student.creditScore,
            comparisonScore: comparisonCredit?.score ?? null,
            scoreChange: comparisonCredit ?
                roundMetric((latestCredit?.score || 0) - toFiniteNumber(comparisonCredit.score)) :
                null,
        },
    };
};

const summarizeClassMonetaryTrend = (monetaryHistory = [], windowDays = 30) => {
    const latest = monetaryHistory[0] || null;
    const comparison = latest ?
        pickComparisonHistory(monetaryHistory.slice(1), latest.date, windowDays) :
        null;
    const latestStore = normalizeStoreMetrics(latest?.storeMetrics?.["7d"] || latest || {});
    const comparisonStore = normalizeStoreMetrics(
        comparison?.storeMetrics?.["7d"] || comparison || {},
    );

    return {
        latestDate: latest?.date || null,
        comparisonDate: comparison?.date || null,
        historyDayCount: monetaryHistory.length,
        requestedWindowDays: windowDays,
        hasComparison: Boolean(comparison),
        monetary: {
            latestM0: roundMetric(latest?.M0),
            latestM2: roundMetric(latest?.M2),
            latestLiquidMoney: roundMetric(latest?.liquidMoney),
            latestTotalClassAssets:
                roundMetric(latest?.totalClassAssets || latest?.totalWealth),
            M0ChangeRate: comparison ? percentChange(latest?.M0, comparison.M0) : null,
            M2ChangeRate: comparison ? percentChange(latest?.M2, comparison.M2) : null,
            liquidMoneyChangeRate: comparison ?
                percentChange(latest?.liquidMoney, comparison.liquidMoney) :
                null,
            totalClassAssetsChangeRate: comparison ?
                percentChange(
                    latest?.totalClassAssets || latest?.totalWealth,
                    comparison.totalClassAssets || comparison.totalWealth,
                ) :
                null,
        },
        consumption: {
            latestStore7d: latestStore,
            comparisonStore7d: comparison ? comparisonStore : null,
            redeemedCountChangeRate: comparison ?
                percentChange(latestStore.redeemedCount, comparisonStore.redeemedCount) :
                null,
            netSpendChangeRate: comparison ?
                percentChange(latestStore.netSpend, comparisonStore.netSpend) :
                null,
            participantCountChangeRate: comparison ?
                percentChange(
                    latestStore.participantCount,
                    comparisonStore.participantCount,
                ) :
                null,
        },
    };
};

const getOnDemandAnalysisCacheKey = ({ message, activeContext, windowDays }) => {
    const payload = {
        message: cleanString(message).toLowerCase(),
        domain: cleanString(activeContext?.domain || ""),
        contextId: cleanString(activeContext?.id || activeContext?.title || ""),
        windowDays,
    };
    return crypto
        .createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex")
        .slice(0, 32);
};

const readCachedOnDemandAnalysis = async (classId, cacheKey) => {
    const snap = await db.doc(onDemandAnalysisCachePath(classId, cacheKey)).get().catch((error) => {
        console.warn("[aiAgentSummary] on-demand analysis cache read failed:", error?.message || error);
        return null;
    });
    if (!snap?.exists) return null;
    const data = snap.data() || {};
    const cachedAt = timestampToDate(data.cachedAt);
    if (!cachedAt) return null;
    if (Date.now() - cachedAt.getTime() > ON_DEMAND_ANALYSIS_CACHE_TTL_MS) return null;
    return data.analysis || null;
};

const persistOnDemandAnalysisCache = async (classId, cacheKey, analysis) => {
    if (!analysis) return;
    await db.doc(onDemandAnalysisCachePath(classId, cacheKey)).set({
        cacheKey,
        analysis,
        cachedAt: FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + ON_DEMAND_ANALYSIS_CACHE_TTL_MS),
        ),
        schemaVersion: 1,
    }, { merge: false }).catch((error) => {
        console.warn("[aiAgentSummary] on-demand analysis cache write failed:", error?.message || error);
    });
};

const buildOnDemandEconomyAnalysis = async (classId, message, activeContext) => {
    if (!shouldAttachOnDemandAnalysis(message, activeContext)) return null;

    const windowDays = resolveOnDemandWindowDays(message);
    const historyLimit = Math.min(150, windowDays + 30);
    const [monetaryHistory, students, operationalRisks, analyticsDailySnapshots] = await Promise.all([
        readRecentMonetaryHistory(classId, { limit: historyLimit }),
        readActiveStudentEconomyRows(classId),
        readOperationalRiskSignals(classId, { windowDays }),
        readAnalyticsDailySnapshots(classId, { windowDays }),
    ]);
    const mentionedStudents = findMentionedStudents(message, students);
    const studentTrends = await Promise.all(
        mentionedStudents.map((student) => summarizeStudentTrend({
            classId,
            student,
            windowDays,
        })),
    );
    const sortedByCash = [...students].sort((a, b) => b.cash - a.cash);
    const sortedByCredit = [...students]
        .filter((student) => Number.isFinite(Number(student.creditScore)))
        .sort((a, b) => a.creditScore - b.creditScore);

    return {
        type: "onDemandEconomyAnalysis",
        requestedWindowDays: windowDays,
        generatedAt: new Date().toISOString(),
        classTrend: summarizeClassMonetaryTrend(monetaryHistory, windowDays),
        dailySnapshotSummary: summarizeAnalyticsDailySnapshots(analyticsDailySnapshots, windowDays),
        operationalRisks,
        studentSnapshot: {
            activeStudentCount: students.length,
            lowestCashStudents: sortedByCash.slice(-5).reverse().map((student) => ({
                uid: student.uid,
                name: student.name,
                studentNumber: student.studentNumber,
                cash: student.cash,
                totalNetWorth: student.totalNetWorth,
                creditScore: student.creditScore,
            })),
            highestCashStudents: sortedByCash.slice(0, 5).map((student) => ({
                uid: student.uid,
                name: student.name,
                studentNumber: student.studentNumber,
                cash: student.cash,
                totalNetWorth: student.totalNetWorth,
                creditScore: student.creditScore,
            })),
            lowestCreditStudents: sortedByCredit.slice(0, 5).map((student) => ({
                uid: student.uid,
                name: student.name,
                studentNumber: student.studentNumber,
                cash: student.cash,
                creditScore: student.creditScore,
            })),
        },
        mentionedStudentTrends: studentTrends,
        caveats: [
            "온디맨드 분석은 monetaryHistory, assetHistory, creditHistory, 현재 학생 문서 스냅샷만 사용합니다.",
            "비교 기준일이 없으면 변화율은 null로 표시됩니다.",
            "이 결과는 읽기 전용 분석이며 자동 승인/지급/차감/수정은 수행하지 않습니다.",
        ],
    };
};
const formatRateForReport = (value) => {
    if (value === null || value === undefined) return "비교 데이터 없음";
    return `${roundMetric(value * 100, 1)}%`;
};

const formatNumberForReport = (value) =>
    roundMetric(value).toLocaleString("ko-KR");

const formatStudentTrendLine = (student) => {
    const assetRate = formatRateForReport(student.assetTrend?.netWorthChangeRate);
    const creditChange = student.creditTrend?.scoreChange === null ||
        student.creditTrend?.scoreChange === undefined ?
        "비교 데이터 없음" :
        `${student.creditTrend.scoreChange}점`;
    const cash = formatNumberForReport(student.current?.cash);
    const netWorth = formatNumberForReport(student.current?.totalNetWorth);
    return `- ${student.name}: 현재 현금 ${cash} / 순자산 ${netWorth} / 순자산 변화 ${assetRate} / 신용 변화 ${creditChange}`;
};

const formatOnDemandEconomyAnalysisResponse = (analysis) => {
    const classTrend = analysis?.classTrend || {};
    const monetary = classTrend.monetary || {};
    const consumption = classTrend.consumption || {};
    const snapshot = analysis?.studentSnapshot || {};
    const dailySnapshotSummary = analysis?.dailySnapshotSummary || null;
    const lines = [
        `요약: 최근 ${analysis.requestedWindowDays}일 기준 경제 흐름을 계산했습니다.`,
        "",
        "### 학급 경제 흐름",
        `- 기준일: ${classTrend.latestDate || "데이터 없음"}`,
        `- 비교일: ${classTrend.comparisonDate || "비교 데이터 없음"}`,
        `- 유동성 변화: ${formatRateForReport(monetary.liquidMoneyChangeRate)}`,
        `- 전체 자산 변화: ${formatRateForReport(monetary.totalClassAssetsChangeRate)}`,
        `- 스토어 순소비 변화: ${formatRateForReport(consumption.netSpendChangeRate)}`,
        `- 스토어 사용 건수 변화: ${formatRateForReport(consumption.redeemedCountChangeRate)}`,
        "",
        "### 먼저 볼 학생",
    ];

    if (dailySnapshotSummary) {
        lines.push(
            "",
            "### 일별 스냅샷 요약",
            "- 분석 스냅샷: " +
                (dailySnapshotSummary.snapshotCount || 0) +
                "일 / 기대 " +
                (dailySnapshotSummary.expectedDays || analysis.requestedWindowDays) +
                "일",
            "- 커버리지: " + formatRateForReport(dailySnapshotSummary.coverageRatio),
            "- 최근 스냅샷: " + (dailySnapshotSummary.latestDate || "없음"),
            "- 비교 스냅샷: " + (dailySnapshotSummary.comparisonDate || "부족"),
        );
        if (dailySnapshotSummary.operations) {
            const overdue = dailySnapshotSummary.operations.overdueBillCount || {};
            const reports = dailySnapshotSummary.operations.pendingReportCount || {};
            lines.push(
                "- 기간 중 세금/자리세 연체: 최근 " +
                    (overdue.latest ?? "없음") +
                    "건 · 최대 " +
                    (overdue.max ?? "없음") +
                    "건 · 평균 " +
                    (overdue.average ?? "없음") +
                    "건",
                "- 기간 중 미처리 신고: 최근 " +
                    (reports.latest ?? "없음") +
                    "건 · 최대 " +
                    (reports.max ?? "없음") +
                    "건 · 평균 " +
                    (reports.average ?? "없음") +
                    "건",
            );
        }
        if (dailySnapshotSummary.sufficientCoverage === false) {
            lines.push("- 스냅샷이 부족해 장기 추세는 원장 히스토리와 함께 보조적으로만 해석해야 합니다.");
        }
    }

    const lowestCash = Array.isArray(snapshot.lowestCashStudents) ?
        snapshot.lowestCashStudents :
        [];
    if (lowestCash.length > 0) {
        lowestCash.slice(0, 3).forEach((student) => {
            lines.push(`- 잔액 낮음: ${student.name} · 현금 ${formatNumberForReport(student.cash)} · 신용 ${student.creditScore ?? "없음"}`);
        });
    } else {
        lines.push("- 잔액 주의 학생 데이터가 없습니다.");
    }

    const lowestCredit = Array.isArray(snapshot.lowestCreditStudents) ?
        snapshot.lowestCreditStudents :
        [];
    if (lowestCredit.length > 0) {
        lowestCredit.slice(0, 3).forEach((student) => {
            lines.push(`- 신용 낮음: ${student.name} · 신용 ${student.creditScore ?? "없음"} · 현금 ${formatNumberForReport(student.cash)}`);
        });
    }

    const trends = Array.isArray(analysis.mentionedStudentTrends) ?
        analysis.mentionedStudentTrends :
        [];
    if (trends.length > 0) {
        lines.push("", "### 언급한 학생 추이");
        trends.forEach((student) => lines.push(formatStudentTrendLine(student)));
    }

    const operationalRisks = analysis?.operationalRisks || {};
    const taxRisks = operationalRisks.tax || {};
    const policeRisks = operationalRisks.police || {};
    if (
        taxRisks.overdueBillCount > 0 ||
        policeRisks.pendingReportCount > 0 ||
        policeRisks.repeatFineStudents?.length > 0
    ) {
        const overdueAmount = formatNumberForReport(taxRisks.totalOverdueAmount || 0);
        const taxSummary = [
            `미납 ${taxRisks.unpaidBillCount || 0}건`,
            `연체 ${taxRisks.overdueBillCount || 0}건`,
            `연체 금액 ${overdueAmount}`,
        ].join(", ");
        const policeSummary = [
            `미처리 신고 ${policeRisks.pendingReportCount || 0}건`,
            `제출된 반성문 ${policeRisks.submittedReflectionCount || 0}건`,
            `최근 벌금 ${policeRisks.recentFineCount || 0}건`,
        ].join(", ");
        lines.push("", "### 운영 리스크");
        lines.push(`- 세금/고지서: ${taxSummary}`);
        lines.push(`- 생활 규칙: ${policeSummary}`);
        (taxRisks.topOverdueStudents || []).slice(0, 3).forEach((student) => {
            lines.push(
                `- 연체 주의: ${student.name} · ${student.count}건 · ${formatNumberForReport(student.amount)} · 최장 ${student.maxDays}일`,
            );
        });
        (policeRisks.repeatFineStudents || []).slice(0, 3).forEach((student) => {
            lines.push(
                `- 반복 벌금: ${student.name} · ${student.count}건 · ${formatNumberForReport(student.amount)}`,
            );
        });
    }

    lines.push(
        "",
        "### 다음 행동",
        "- 유동성이 늘고 소비가 줄었다면 세금 인상보다 상품/가격 매력을 먼저 확인하세요.",
        "- 잔액과 신용이 모두 낮은 학생은 벌금보다 회복 과제나 급여/직업 상태를 먼저 보세요.",
        "- 이 분석은 읽기 전용입니다. 승인, 지급, 차감, 수정은 실행하지 않았습니다.",
    );

    return lines.join("\n");
};
const decodeHtmlEntities = (value) =>
    String(value || "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'");

const stripHtml = (value) =>
    decodeHtmlEntities(value)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

const truncateText = (value, maxLength = 700) => {
    const text = String(value || "").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
};

const toMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.toDate === "function") return value.toDate().getTime();
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

const toIsoString = (value) => {
    const millis = toMillis(value);
    return millis ? new Date(millis).toISOString() : null;
};

const summarizeReward = (mission = {}) => {
    const rewards = mission.rewards || {};
    if (Array.isArray(rewards)) {
        return rewards
            .map((reward) => `${reward.type || "reward"}:${reward.amount ?? ""}`)
            .filter(Boolean);
    }

    return {
        currency: Number(rewards.currency || mission.reward || 0),
        credit: Number(rewards.credit || 0),
        missionToken: Number(rewards.missionToken || rewards.token || 0),
    };
};

const getMissionPendingSubmissionDetails = async (classId, { limit = 12 } = {}) => {
    const missionSnap = await db.collection(`classes/${classId}/missions`).get();
    const pendingEntries = [];

    const resolvedMissionDocs = await readMissionDocsStudentStates(db, missionSnap.docs);
    resolvedMissionDocs.forEach((missionDoc) => {
        const mission = missionDoc.data() || {};
        const completions =
            mission.completions && typeof mission.completions === "object" ?
                mission.completions :
                {};
        const submissionsIndex =
            mission.submissionsIndex && typeof mission.submissionsIndex === "object" ?
                mission.submissionsIndex :
                {};

        Object.entries(completions).forEach(([studentUid, completion]) => {
            const status = String(completion?.status || "").toLowerCase();
            if (status !== "pending" && status !== "late") return;

            pendingEntries.push({
                missionId: missionDoc.id,
                mission,
                studentUid,
                completion: completion || {},
                status,
                submissionId:
                    completion?.submissionId ||
                    submissionsIndex?.[studentUid] ||
                    null,
                submittedAtMs: toMillis(
                    completion?.submittedAt ||
                    completion?.updatedAt ||
                    mission?.updatedAt,
                ),
            });
        });
    });

    pendingEntries.sort((a, b) => b.submittedAtMs - a.submittedAtMs);

    const sampledEntries = pendingEntries.slice(0, limit);
    const submissionRefs = sampledEntries
        .filter((entry) => entry.submissionId)
        .map((entry) => db.doc(
            `classes/${classId}/missions/${entry.missionId}/submissions/${entry.submissionId}`,
        ));
    const studentRefs = [
        ...new Set(sampledEntries.map((entry) => entry.studentUid).filter(Boolean)),
    ].map((studentUid) => db.doc(`classes/${classId}/students/${studentUid}`));

    const [submissionSnaps, studentSnaps] = await Promise.all([
        submissionRefs.length ? db.getAll(...submissionRefs) : Promise.resolve([]),
        studentRefs.length ? db.getAll(...studentRefs) : Promise.resolve([]),
    ]);

    const submissionMap = new Map(
        submissionSnaps.map((snap) => [snap.ref.path, snap.exists ? snap.data() || {} : null]),
    );
    const studentMap = new Map(
        studentSnaps.map((snap) => [snap.id, snap.exists ? snap.data() || {} : null]),
    );

    const samples = sampledEntries.map((entry) => {
        const mission = entry.mission || {};
        const completion = entry.completion || {};
        const submissionPath = entry.submissionId ?
            `classes/${classId}/missions/${entry.missionId}/submissions/${entry.submissionId}` :
            null;
        const submission = submissionPath ? submissionMap.get(submissionPath) : null;
        const student = studentMap.get(entry.studentUid) || {};
        const contentHtml =
            submission?.contentHtml ||
            submission?.content?.html ||
            completion?.contentHtml ||
            "";
        const plainContent = stripHtml(contentHtml);
        const missionBody = stripHtml(
            mission.description ||
            mission.contentHtml ||
            mission.content?.html ||
            mission.detail ||
            "",
        );

        return {
            missionId: entry.missionId,
            submissionId: entry.submissionId,
            studentUid: entry.studentUid,
            studentName:
                submission?.studentName ||
                completion?.name ||
                student.name ||
                student.displayName ||
                "학생",
            studentNumber:
                submission?.studentNumber ??
                completion?.studentNumber ??
                student.studentNumber ??
                null,
            status: entry.status,
            late: entry.status === "late" || submission?.late === true || completion?.late === true,
            submittedAt:
                toIsoString(submission?.submittedAt) ||
                toIsoString(completion?.submittedAt) ||
                null,
            missionTitle: mission.title || submission?.missionTitle || "미션",
            missionType: mission.type || null,
            requiresSubmissionForm: Boolean(
                mission.requireSubmissionForm ||
                mission.type === "challenge" ||
                entry.submissionId,
            ),
            reward: summarizeReward(mission),
            missionPreview: truncateText(missionBody, 320),
            contentPreview: truncateText(plainContent, 900),
            contentTextLength: plainContent.length,
            hasTextContent: plainContent.length > 0,
            actionRef: {
                missionId: entry.missionId,
                submissionId: entry.submissionId,
                uid: entry.studentUid,
            },
        };
    });

    const groupedByMission = samples.reduce((acc, item) => {
        const key = item.missionId;
        if (!acc[key]) {
            acc[key] = {
                missionId: item.missionId,
                missionTitle: item.missionTitle,
                pendingCountInSample: 0,
            };
        }
        acc[key].pendingCountInSample += 1;
        return acc;
    }, {});

    return {
        totalPendingCount: pendingEntries.length,
        sampleCount: samples.length,
        sampleLimit: limit,
        groupedByMission: Object.values(groupedByMission),
        samples,
        caveat:
            pendingEntries.length > samples.length ?
                `Only the latest ${samples.length} of ${pendingEntries.length} pending mission submissions are included.` :
                null,
    };
};

const shouldAttachMissionDetails = (message, activeContext) => {
    const contextDomain = String(activeContext?.domain || "").toLowerCase();
    const contextTool = String(activeContext?.detailTool || "").toLowerCase();
    const text = String(message || "").toLowerCase();

    return (
        contextDomain === "missions" ||
        contextTool.includes("mission") ||
        text.includes("미션") ||
        text.includes("mission") ||
        text.includes("제출") ||
        text.includes("승인")
    );
};

const OPERATIONAL_DECISION_RULES = {
    store: [
        "오래 기다린 요청을 먼저 처리합니다.",
        "같은 학생의 여러 요청은 한 번에 묶어 확인합니다.",
        "수량이 많거나 금액이 큰 요청은 재고/사용 가능 여부를 먼저 확인합니다.",
        "실물 전달이 필요한 보상은 처리 후 실제 수령 여부를 교사가 확인해야 합니다.",
    ],
    police: [
        "같은 학생에게 미처리 신고가 여러 건 있으면 먼저 묶어 확인합니다.",
        "과거 벌금 이력이 있는 학생은 반복 발생 가능성을 먼저 봅니다.",
        "신고 사유가 짧거나 애매하면 바로 벌점보다 확인 필요로 분류합니다.",
        "민감 신고는 공개 처리보다 교사 단독 확인을 우선합니다.",
    ],
    tax: [
        "연체일이 긴 고지서를 먼저 확인합니다.",
        "같은 학생의 여러 연체 고지서는 합쳐서 안내합니다.",
        "금액이 큰 고지서는 잔액과 납부 가능성을 같이 봅니다.",
        "자리세/임대료 성격의 고지서는 부동산 화면과 함께 확인합니다.",
    ],
    realestate: [
        "연체일이 긴 자리부터 먼저 확인합니다.",
        "같은 학생의 여러 자리/계약 문제는 묶어서 안내합니다.",
        "주간 임대료가 큰 자리는 미납 금액 영향이 크므로 우선 확인합니다.",
        "실제 자리 사용 여부나 계약 종료 여부는 교사가 최종 확인합니다.",
    ],
};

const getStudentBriefMap = async (classId, uids = []) => {
    const uniqueUids = [...new Set(uids.filter(Boolean))].slice(0, 80);
    if (uniqueUids.length === 0) return new Map();

    const snaps = await db.getAll(
        ...uniqueUids.map((uid) => db.doc(`classes/${classId}/students/${uid}`)),
    );

    return new Map(snaps.map((snap) => {
        const data = snap.exists ? snap.data() || {} : {};
        return [snap.id, {
            uid: snap.id,
            name: data.name || data.displayName || "학생",
            studentNumber: data.studentNumber ?? null,
            cash: toFiniteNumber(data.assets?.cash, null),
            creditScore: Number.isFinite(Number(data.creditScore)) ?
                Number(data.creditScore) :
                null,
        }];
    }));
};

const getWaitDays = (dateValue, nowMs = Date.now()) => {
    const date = timestampToDate(dateValue);
    if (!date) return null;
    return Math.max(0, Math.floor((nowMs - date.getTime()) / (24 * 60 * 60 * 1000)));
};

const readStorePendingRedemptionDetails = async (classId, { limit = 12 } = {}) => {
    let snap;
    try {
        snap = await db
            .collection(`classes/${classId}/storeRedemptions`)
            .where("status", "==", "pending")
            .orderBy("requestDate", "asc")
            .limit(limit)
            .get();
    } catch (error) {
        console.warn("[aiAgentSummary] ordered store pending read failed:", error?.message || error);
        snap = await db
            .collection(`classes/${classId}/storeRedemptions`)
            .where("status", "==", "pending")
            .limit(limit)
            .get();
    }

    const totalPendingCount = await countPendingStoreRedemptions(classId).catch(() => snap.size);
    const nowMs = Date.now();
    const rows = snap.docs
        .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() || {} }))
        .sort((a, b) => {
            const aMs = toMillis(a.data.requestDate || a.data.createdAt || a.data.purchasedAt);
            const bMs = toMillis(b.data.requestDate || b.data.createdAt || b.data.purchasedAt);
            return aMs - bMs;
        });
    const studentMap = await getStudentBriefMap(
        classId,
        rows.map((row) => row.data.studentUid),
    );
    const byStudent = new Map();

    const samples = rows.map(({ id, data }) => {
        const student = studentMap.get(data.studentUid) || {};
        const quantity = Math.max(1, toCount(data.quantity || 1));
        const unitPrice = toFiniteNumber(data.pricePerItem, null);
        const totalAmount = toFiniteNumber(
            data.totalAmount ?? (unitPrice !== null ? unitPrice * quantity : 0),
            0,
        );
        const requestDate = data.requestDate || data.createdAt || data.purchasedAt;
        const studentKey = data.studentUid || data.studentName || "unknown";
        const grouped = byStudent.get(studentKey) || {
            studentUid: data.studentUid || null,
            studentName: data.studentName || student.name || "학생",
            count: 0,
            totalAmount: 0,
        };
        grouped.count += 1;
        grouped.totalAmount += totalAmount;
        byStudent.set(studentKey, grouped);

        return {
            purchaseId: id,
            studentUid: data.studentUid || null,
            studentName: data.studentName || student.name || "학생",
            studentNumber: data.studentNumber ?? student.studentNumber ?? null,
            itemId: data.itemId || null,
            itemName: data.itemName || data.name || "상품",
            itemType: data.itemType || "general",
            functionTag: data.functionTag || null,
            quantity,
            unitPrice,
            totalAmount,
            currencyUnit: data.currencyUnit || null,
            requestedAt: toIsoString(requestDate),
            waitDays: getWaitDays(requestDate, nowMs),
            actionRef: {
                collection: "storeRedemptions",
                id,
                studentUid: data.studentUid || null,
            },
        };
    });

    return {
        domain: "store",
        detailType: "storePendingRedemptions",
        totalPendingCount,
        sampleCount: samples.length,
        sampleLimit: limit,
        decisionRules: OPERATIONAL_DECISION_RULES.store,
        suggestedSort: "waitDays desc, same student grouped, totalAmount desc",
        groupedByStudent: [...byStudent.values()]
            .sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount)
            .slice(0, 8),
        samples,
        caveat: totalPendingCount > samples.length ?
            `처리 대기 ${totalPendingCount}건 중 오래된 순서 샘플 ${samples.length}건만 포함했습니다.` :
            null,
    };
};

const readPoliceHistoryForStudents = async (classId, studentUids = []) => {
    const uniqueUids = [...new Set(studentUids.filter(Boolean))].slice(0, 20);
    const historyByStudent = new Map();

    await Promise.all(uniqueUids.map(async (studentUid) => {
        let snap;
        try {
            snap = await db
                .collection(`classes/${classId}/policeFineHistory`)
                .where("studentUid", "==", studentUid)
                .orderBy("appliedAt", "desc")
                .limit(20)
                .get();
        } catch (error) {
            console.warn(
                `[aiAgentSummary] ordered police history read failed for ${studentUid}:`,
                error?.message || error,
            );
            snap = await db
                .collection(`classes/${classId}/policeFineHistory`)
                .where("studentUid", "==", studentUid)
                .limit(20)
                .get()
                .catch(() => null);
        }
        const rows = [];
        snap?.forEach((docSnap) => {
            const data = docSnap.data() || {};
            rows.push({
                id: docSnap.id,
                ruleText: data.ruleText || data.description || "생활 규칙",
                reason: truncateText(data.reason || data.reportReason || "", 180),
                type: data.type || null,
                appliedAt: toIsoString(data.appliedAt || data.createdAt),
                amountSigned: toFiniteNumber(data.amountSigned, 0),
            });
        });
        historyByStudent.set(studentUid, rows);
    }));

    return historyByStudent;
};

const readPolicePendingReportDetails = async (classId, { limit = 12 } = {}) => {
    let snap;
    try {
        snap = await db
            .collection(`classes/${classId}/policeReports`)
            .where("status", "==", "pending")
            .orderBy("createdAt", "asc")
            .limit(limit)
            .get();
    } catch (error) {
        console.warn("[aiAgentSummary] ordered police pending read failed:", error?.message || error);
        snap = await db
            .collection(`classes/${classId}/policeReports`)
            .where("status", "==", "pending")
            .limit(limit)
            .get();
    }

    const totalSnap = await db
        .collection(`classes/${classId}/policeReports`)
        .where("status", "==", "pending")
        .get()
        .catch(() => null);
    const rows = snap.docs
        .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() || {} }))
        .sort((a, b) => {
            const aMs = toMillis(a.data.createdAt);
            const bMs = toMillis(b.data.createdAt);
            return aMs - bMs;
        });
    const studentUids = rows.map((row) => row.data.accusedStudentUid).filter(Boolean);
    const [studentMap, historyByStudent] = await Promise.all([
        getStudentBriefMap(classId, studentUids),
        readPoliceHistoryForStudents(classId, studentUids),
    ]);
    const byStudent = new Map();
    const nowMs = Date.now();

    const samples = rows.map(({ id, data }) => {
        const studentUid = data.accusedStudentUid || null;
        const student = studentMap.get(studentUid) || {};
        const history = historyByStudent.get(studentUid) || [];
        const ruleText = data.ruleText || (data.ruleId ? "생활 규칙" : "자유 신고");
        const sameRuleCount = history.filter((item) => item.ruleText === ruleText).length;
        const recentHistoryCount = history.filter((item) => {
            const ms = item.appliedAt ? new Date(item.appliedAt).getTime() : 0;
            return Number.isFinite(ms) && nowMs - ms <= 30 * 24 * 60 * 60 * 1000;
        }).length;
        const studentKey = studentUid || data.accusedStudentName || "unknown";
        const grouped = byStudent.get(studentKey) || {
            studentUid,
            studentName: data.accusedStudentName || student.name || "학생",
            studentNumber: student.studentNumber ?? null,
            pendingCount: 0,
            previousFineCount: history.length,
            previousSameRuleCount: 0,
            recentFineCount: recentHistoryCount,
        };
        grouped.pendingCount += 1;
        grouped.previousSameRuleCount += sameRuleCount;
        byStudent.set(studentKey, grouped);

        return {
            reportId: id,
            studentUid,
            studentName: data.accusedStudentName || student.name || "학생",
            studentNumber: student.studentNumber ?? null,
            ruleText,
            reason: truncateText(data.reason || "", 300),
            repeatCountInReport: toCount(data.repeatCount || 1),
            reporterName: data.reporterName || null,
            isSensitive: data.isSensitive === true,
            reportType: data.reportType || null,
            createdAt: toIsoString(data.createdAt),
            waitDays: getWaitDays(data.createdAt, nowMs),
            previousFineCount: history.length,
            previousSameRuleCount: sameRuleCount,
            recentFineCount: recentHistoryCount,
            recentHistorySamples: history.slice(0, 3),
            actionRef: {
                collection: "policeReports",
                id,
                studentUid,
            },
        };
    });

    return {
        domain: "police",
        detailType: "pendingPoliceReports",
        totalPendingCount: totalSnap?.size ?? samples.length,
        sampleCount: samples.length,
        sampleLimit: limit,
        decisionRules: OPERATIONAL_DECISION_RULES.police,
        suggestedSort: "same student grouped, previousFineCount desc, waitDays desc, sensitive first",
        groupedByStudent: [...byStudent.values()]
            .sort((a, b) =>
                b.pendingCount - a.pendingCount ||
                b.previousFineCount - a.previousFineCount ||
                b.recentFineCount - a.recentFineCount,
            )
            .slice(0, 8),
        samples,
        caveat: (totalSnap?.size || 0) > samples.length ?
            `미처리 신고 ${totalSnap.size}건 중 오래된 순서 샘플 ${samples.length}건만 포함했습니다.` :
            null,
    };
};

const readOverdueTaxBillDetails = async (classId, { limit = 12 } = {}) => {
    const studentsSnap = await db
        .collection(`classes/${classId}/students`)
        .select("role", "status", "name", "displayName", "studentNumber", "assets")
        .limit(100)
        .get();
    const students = [];
    studentsSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const role = String(data.role || "").toLowerCase();
        const status = String(data.status || "").toLowerCase();
        if (role !== "student" || status === "deleted" || status === "inactive") return;
        students.push({
            uid: docSnap.id,
            name: data.name || data.displayName || "학생",
            studentNumber: data.studentNumber ?? null,
            cash: toFiniteNumber(data.assets?.cash, 0),
        });
    });

    const nowMs = Date.now();
    const rows = [];
    await Promise.all(students.slice(0, 80).map(async (student) => {
        const snap = await db
            .collection(`classes/${classId}/students/${student.uid}/taxBills`)
            .where("isPaid", "==", false)
            .limit(30)
            .get()
            .catch((error) => {
                console.warn(
                    `[aiAgentSummary] overdue tax detail read failed for ${student.uid}:`,
                    error?.message || error,
                );
                return null;
            });
        if (!snap) return;
        snap.forEach((docSnap) => {
            const bill = docSnap.data() || {};
            if (isTaxBillPaidForSignal(bill)) return;
            const dueDate = timestampToDate(bill.dueAt || bill.dueDate);
            const overdueDays = dueDate ?
                Math.max(0, Math.floor((nowMs - dueDate.getTime()) / (24 * 60 * 60 * 1000))) :
                0;
            if (overdueDays <= 0) return;
            rows.push({
                billId: docSnap.id,
                studentUid: student.uid,
                studentName: student.name,
                studentNumber: student.studentNumber,
                amount: Math.max(0, toFiniteNumber(bill.amount)),
                dueAt: toIsoString(bill.dueAt || bill.dueDate),
                overdueDays,
                billKind: bill.billKind || bill.taxType || bill.source || null,
                title: bill.title || bill.name || bill.description || "고지서",
                isRealEstateRelated: isRealEstateTaxBill(bill),
                studentCash: student.cash,
                actionRef: {
                    collection: `students/${student.uid}/taxBills`,
                    id: docSnap.id,
                    studentUid: student.uid,
                },
            });
        });
    }));

    rows.sort((a, b) => b.overdueDays - a.overdueDays || b.amount - a.amount);
    const samples = rows.slice(0, limit);
    const groupedByStudent = samples.reduce((acc, item) => {
        const key = item.studentUid;
        if (!acc[key]) {
            acc[key] = {
                studentUid: item.studentUid,
                studentName: item.studentName,
                studentNumber: item.studentNumber,
                count: 0,
                amount: 0,
                maxOverdueDays: 0,
            };
        }
        acc[key].count += 1;
        acc[key].amount += item.amount;
        acc[key].maxOverdueDays = Math.max(acc[key].maxOverdueDays, item.overdueDays);
        return acc;
    }, {});

    return {
        domain: "tax",
        detailType: "overdueTaxBills",
        totalOverdueCount: rows.length,
        sampleCount: samples.length,
        sampleLimit: limit,
        decisionRules: OPERATIONAL_DECISION_RULES.tax,
        suggestedSort: "overdueDays desc, amount desc, same student grouped",
        groupedByStudent: Object.values(groupedByStudent)
            .sort((a, b) => b.maxOverdueDays - a.maxOverdueDays || b.amount - a.amount),
        samples,
        caveat: rows.length > samples.length ?
            `연체 고지서 ${rows.length}건 중 우선순위 샘플 ${samples.length}건만 포함했습니다.` :
            null,
    };
};

const readRealEstateRentDueDetails = async (classId, { limit = 12 } = {}) => {
    const layoutSnap = await readRealEstateLayout(db, db.doc(`classes/${classId}/real_estate/layout`), undefined, { includeSaleContracts: false });
    const groups = layoutSnap.exists && Array.isArray(layoutSnap.data()?.groups) ?
        layoutSnap.data().groups :
        [];
    const todayStart = startOfDayInKST(new Date());
    const rows = [];

    groups.forEach((group) => {
        (group?.desks || []).forEach((desk) => {
            const studentUid = desk.studentId || desk.studentUid || desk.ownerUid || null;
            const paidUntil = timestampToDate(desk.rentPaidUntil);
            const rentStart = timestampToDate(desk.rentStartAt || desk.rentStartDate);
            const weeklyRent = toFiniteNumber(desk.weeklyRent || desk.rentPrice, 0);
            if (!studentUid || desk?.isActive === false) return;
            if (desk.ownerId && desk.ownerId === studentUid) return;
            if (weeklyRent <= 0) return;
            const rentStartDay = rentStart ? startOfDayInKST(rentStart) : null;
            if (rentStartDay && rentStartDay.getTime() > todayStart.getTime()) return;
            const paidUntilStart = paidUntil ? startOfDayInKST(paidUntil) : null;
            const due = !paidUntilStart || paidUntilStart.getTime() <= todayStart.getTime();
            if (!due) return;
            const overdueDays = paidUntilStart ?
                Math.max(0, Math.floor(
                    (todayStart.getTime() - paidUntilStart.getTime()) /
                    (24 * 60 * 60 * 1000),
                )) :
                0;
            rows.push({
                deskId: desk.id || desk.deskId || null,
                groupId: group.id || null,
                groupName: group.name || group.title || null,
                seatLabel: desk.label || desk.name || desk.number || desk.id || "자리",
                studentUid,
                weeklyRent,
                rentStartAt: toIsoString(rentStart),
                paidUntil: toIsoString(paidUntil),
                overdueDays,
                actionRef: {
                    collection: "real_estate/layout",
                    groupId: group.id || null,
                    deskId: desk.id || desk.deskId || null,
                    studentUid,
                },
            });
        });
    });

    rows.sort((a, b) => b.overdueDays - a.overdueDays || b.weeklyRent - a.weeklyRent);
    const studentMap = await getStudentBriefMap(classId, rows.map((row) => row.studentUid));
    const samples = rows.slice(0, limit).map((row) => {
        const student = studentMap.get(row.studentUid) || {};
        return {
            ...row,
            studentName: student.name || "학생",
            studentNumber: student.studentNumber ?? null,
            studentCash: student.cash ?? null,
        };
    });

    return {
        domain: "realestate",
        detailType: "rentDueItems",
        totalDueCount: rows.length,
        sampleCount: samples.length,
        sampleLimit: limit,
        decisionRules: OPERATIONAL_DECISION_RULES.realestate,
        suggestedSort: "overdueDays desc, weeklyRent desc, same student grouped",
        samples,
        caveat: rows.length > samples.length ?
            `자리세/임대료 확인 ${rows.length}건 중 우선순위 샘플 ${samples.length}건만 포함했습니다.` :
            null,
    };
};

const shouldAttachOperationalDetails = (activeContext) => {
    const contextDomain = String(activeContext?.domain || "").toLowerCase();
    const contextId = String(activeContext?.id || "").toLowerCase();
    const contextTool = String(activeContext?.detailTool || "").toLowerCase();
    return (
        contextDomain === "store" ||
        contextDomain === "police" ||
        contextDomain === "tax" ||
        contextDomain === "realestate" ||
        contextId.includes("store") ||
        contextId.includes("police") ||
        contextId.includes("tax") ||
        contextId.includes("rent") ||
        contextTool.includes("store") ||
        contextTool.includes("police") ||
        contextTool.includes("tax") ||
        contextTool.includes("rent") ||
        contextTool.includes("realestate")
    );
};

const getOperationalDetailsForContext = async (classId, activeContext) => {
    if (!shouldAttachOperationalDetails(activeContext)) return null;
    const contextDomain = String(activeContext?.domain || "").toLowerCase();
    const contextId = String(activeContext?.id || "").toLowerCase();
    const contextTool = String(activeContext?.detailTool || "").toLowerCase();

    if (
        contextDomain === "store" ||
        contextId.includes("store") ||
        contextTool.includes("store")
    ) {
        return readStorePendingRedemptionDetails(classId);
    }
    if (
        contextDomain === "police" ||
        contextId.includes("police") ||
        contextTool.includes("police")
    ) {
        return readPolicePendingReportDetails(classId);
    }
    if (
        contextDomain === "tax" ||
        contextId.includes("tax") ||
        contextTool.includes("tax")
    ) {
        return readOverdueTaxBillDetails(classId);
    }
    if (
        contextDomain === "realestate" ||
        contextId.includes("rent") ||
        contextTool.includes("rent") ||
        contextTool.includes("realestate")
    ) {
        return readRealEstateRentDueDetails(classId);
    }

    return null;
};

const readAgentExecutionPolicy = async (classId) => {
    const classSnap = await db.doc(`classes/${classId}`).get().catch((error) => {
        console.warn("[aiAgentSummary] class execution policy read failed:", error?.message || error);
        return null;
    });
    const classData = classSnap?.exists ? classSnap.data() || {} : {};
    const settings = classData.settings || {};
    const featureFlagEnabled = Boolean(
        settings.aiAgentExecuteEnabled === true || classData.aiAgentExecuteEnabled === true,
    );

    const actionTypePolicies = buildAgentActionTypePolicies(settings, classData);

    return {
        schemaVersion: 2,
        mode: "draft_and_review_confirmation_only",
        featureFlagKey: "settings.aiAgentExecuteEnabled",
        featureFlagEnabled,
        executionEnabled: false,
        executionAvailable: false,
        supportedActionTypes: actionTypePolicies.map((item) => item.actionType),
        confirmableActionTypes: actionTypePolicies
            .filter((item) => item.reviewConfirmationEnabled)
            .map((item) => item.actionType),
        executableActionTypes: [],
        actionTypePolicies,
        actionPolicyByType: actionTypePolicies.reduce((acc, item) => {
            acc[item.actionType] = item;
            return acc;
        }, {}),
        requiresFinalTeacherConfirmation: true,
        disabledReason: featureFlagEnabled ?
            "AI 실행 플래그는 켜져 있지만 실행 엔진은 아직 연결되지 않아 초안 저장과 검토 완료 기록만 제공합니다." :
            "AI 실행 플래그가 꺼져 있어 초안 저장과 검토 완료 기록만 제공합니다.",
    };
};

const readRecentAgentExecutionLogs = async (classId, { limit = 5 } = {}) => {
    const snap = await db
        .collection(`classes/${classId}/aiAgentExecutionLogs`)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get()
        .catch((error) => {
            console.warn("[aiAgentSummary] execution log read failed:", error?.message || error);
            return null;
        });
    if (!snap) {
        return {
            schemaVersion: 1,
            available: false,
            items: [],
            count: 0,
            confirmedCount: 0,
            preparedCount: 0,
            reviewOnlyCount: 0,
        };
    }

    const items = snap.docs.map((docSnap) => {
        const data = docSnap.data() || {};
        const createdAt = timestampToDate(data.createdAt);
        const confirmedAt = timestampToDate(data.confirmedAt);
        const completedAt = timestampToDate(data.completedAt);
        return {
            id: docSnap.id,
            actionType: data.actionType || data.action?.actionType || null,
            domain: data.domain || data.action?.domain || "dashboard",
            riskLevel: data.riskLevel || data.action?.riskLevel || "low",
            status: data.status || "unknown",
            statusLabel: data.status === "confirmed" ?
                "검토 완료" :
                data.status === "prepared" ? "실행안 저장" : data.status || "기록됨",
            targetCount: toCount(data.targetCount),
            successCount: toCount(data.successCount),
            failureCount: toCount(data.failureCount),
            reviewOnly: data.reviewOnly === true || data.executionPerformed === false,
            executionPerformed: data.executionPerformed === true,
            createdAt: createdAt ? createdAt.toISOString() : null,
            confirmedAt: confirmedAt ? confirmedAt.toISOString() : null,
            completedAt: completedAt ? completedAt.toISOString() : null,
            sourceKind: data.proposedBy?.sourceKind || data.action?.sourceKind || null,
            sourceCardId: data.proposedBy?.sourceCardId || data.action?.sourceCardId || null,
            summary: data.preview?.summary || data.action?.title || "AI 실행안 기록",
        };
    });

    return {
        schemaVersion: 1,
        available: true,
        items,
        count: items.length,
        confirmedCount: items.filter((item) => item.status === "confirmed").length,
        preparedCount: items.filter((item) => item.status === "prepared").length,
        reviewOnlyCount: items.filter((item) => item.reviewOnly).length,
    };
};

async function buildAgentDailySummary(classId) {
    const summaryDateKey = formatDateKeyInKST(new Date());
    const [
        missions,
        bank,
        police,
        marketplace,
        credentials,
        realestate,
        pendingStoreCount,
        analyticsDaily,
        activitySignals,
        executionPolicy,
        routineSettings,
        recentExecutionLogs,
        dailyContext,
    ] = await Promise.all([
        getSummaryData(classId, "missions"),
        getSummaryData(classId, "bank"),
        getSummaryData(classId, "police"),
        getSummaryData(classId, "marketplace"),
        getSummaryData(classId, "credentials"),
        getSummaryData(classId, "realestate"),
        countPendingStoreRedemptions(classId),
        buildAgentAnalyticsDaily(classId),
        readRecentActivityRoutineSignals(classId),
        readAgentExecutionPolicy(classId),
        readAgentRoutineSettings(classId),
        readRecentAgentExecutionLogs(classId),
        buildAgentDailyContext(db, classId, {
            generatedForDate: summaryDateKey,
            windowDays: 30,
        }),
    ]);

    await persistAgentAnalyticsDaily(classId, analyticsDaily);
    const studentEconomySignals = analyticsDaily?.studentEconomySignals || {};
    const activeStudentCount = toCount(studentEconomySignals?.activeStudentCount);
    const pendingActions = [];

    const missionPendingCount = toCount(missions.teacherPendingCount);
    if (missionPendingCount > 0) {
        pendingActions.push(createPendingAction({
            id: "missions-pending-review",
            domain: "missions",
            type: "missionSubmissionReview",
            label: `승인 대기 미션 제출 ${missionPendingCount}건`,
            count: missionPendingCount,
            severity: missionPendingCount >= 10 ? "high" : "medium",
            deepLink: "/missions",
            detailTool: "getMissionPendingSubmissions",
            suggestedQuestions: [
                "대기 미션 제출물 내용을 요약해줘",
                "바로 승인해도 될 것과 확인할 것을 나눠줘",
                "승인 제외 후보가 있으면 골라줘",
            ],
        }));
    }

    const bankPendingCount = toCount(bank.managerPendingCount);
    if (bankPendingCount > 0) {
        pendingActions.push(createPendingAction({
            id: "bank-pending-approval",
            domain: "bank",
            type: "bankApproval",
            label: `은행 승인 대기 ${bankPendingCount}건`,
            count: bankPendingCount,
            severity: bankPendingCount >= 8 ? "medium" : "low",
            deepLink: "/bank",
            detailTool: "getBankPendingApprovals",
            suggestedQuestions: [
                "승인 전에 확인할 점은?",
                "금액이 큰 요청부터 보여줘",
                "처리 페이지로 이동할래",
            ],
        }));
    }

    const policePendingCount = toCount(police.teacherPendingReportCount);
    if (policePendingCount > 0) {
        pendingActions.push(createPendingAction({
            id: "police-pending-review",
            domain: "police",
            type: "behaviorReview",
            label: `미처리 신고 ${policePendingCount}건`,
            count: policePendingCount,
            severity: "high",
            deepLink: "/police",
            detailTool: "getPolicePendingReviews",
            suggestedQuestions: [
                "먼저 처리해야 할까?",
                "반복 발생 학생이 있어?",
                "관련 규칙을 확인해줘",
            ],
        }));
    }

    if (pendingStoreCount > 0) {
        pendingActions.push(createPendingAction({
            id: "store-pending-redemptions",
            domain: "store",
            type: "storeRedemptionReview",
            label: `스토어 처리 대기 ${pendingStoreCount}건`,
            count: pendingStoreCount,
            severity: pendingStoreCount >= 10 ? "medium" : "low",
            deepLink: "/store",
            detailTool: "getStorePendingRedemptions",
            suggestedQuestions: [
                "어떤 요청부터 처리할까?",
                "학생별로 묶어서 보여줘",
                "오래 기다린 요청이 있어?",
            ],
        }));
    }

    const marketplacePendingCount = toCount(marketplace.managerPendingCount);
    if (marketplacePendingCount > 0) {
        pendingActions.push(createPendingAction({
            id: "marketplace-pending-review",
            domain: "marketplace",
            type: "marketplaceReview",
            label: `마켓 거래 확인 ${marketplacePendingCount}건`,
            count: marketplacePendingCount,
            severity: "low",
            deepLink: "/marketplace",
            detailTool: "getMarketplacePendingItems",
            suggestedQuestions: [
                "확인할 거래를 정리해줘",
                "경매와 일반 거래를 나눠줘",
                "문제 가능성이 있는 거래가 있어?",
            ],
        }));
    }

    const credentialPendingCount = toCount(credentials.teacherPendingRequestCount);
    if (credentialPendingCount > 0) {
        pendingActions.push(createPendingAction({
            id: "credentials-pending-review",
            domain: "credentials",
            type: "credentialRequestReview",
            label: `칭호/자격 승인 대기 ${credentialPendingCount}건`,
            count: credentialPendingCount,
            severity: "low",
            deepLink: "/credentials",
            detailTool: "getCredentialPendingRequests",
            suggestedQuestions: [
                "어떤 요청인지 보여줘",
                "승인 기준을 확인해줘",
                "학생별로 묶어줘",
            ],
        }));
    }

    const rentDueCount = toCount(realestate.teacherPendingRentDueCount);
    if (rentDueCount > 0) {
        pendingActions.push(createPendingAction({
            id: "realestate-rent-due",
            domain: "realestate",
            type: "rentDueReview",
            label: `자리세/임대료 확인 ${rentDueCount}건`,
            count: rentDueCount,
            severity: "medium",
            deepLink: "/realestate",
            detailTool: "getRealEstateRentDueItems",
            suggestedQuestions: [
                "연체 학생을 보여줘",
                "알림을 보내야 할까?",
                "자리세 기준을 확인해줘",
            ],
        }));
    }

    const pendingWork = pendingActions.map(enrichPendingWorkItem);
    const pendingWorkCount = pendingWork.reduce(
        (sum, item) => sum + toCount(item.count),
        0,
    );
    const economyHealth = [
        ...buildInitialEconomyHealth({
            policePendingCount,
            rentDueCount,
            pendingStoreCount,
            pendingWorkCount,
            pendingWorkGroupCount: pendingWork.length,
            studentEconomySignals,
            analyticsDaily,
        }),
        ...buildAgentDailyContextCards(dailyContext, { activeStudentCount }),
    ];
    const routineCandidates = buildRoutineCandidates({
        policePendingCount,
        rentDueCount,
        pendingStoreCount,
        activitySignals,
        recentExecutionLogs,
    });
    const normalizedCards = normalizeAgentDailySummaryCards({
        pendingWork,
        economyHealth,
        routineCandidates,
    });
    const normalizedPendingWork = normalizedCards.pendingWork;
    const normalizedEconomyHealth = normalizedCards.economyHealth;
    const normalizedRoutineCandidates = normalizedCards.routineCandidates;
    const normalizedPendingWorkCount = normalizedPendingWork.reduce(
        (sum, item) => sum + toCount(item.count),
        0,
    );
    const normalizedHighPriorityWorkCount = normalizedPendingWork.filter(
        (item) => item.priority === "high",
    ).length;
    const openingBrief = buildOpeningBrief({
        pendingWork: normalizedPendingWork,
        economyHealth: normalizedEconomyHealth,
        routineCandidates: normalizedRoutineCandidates,
    });

    const preparedWork = normalizePreparedWorkList([
        ...buildScheduledRoutinePreparedWork(routineSettings, summaryDateKey),
        ...buildPreparedWork({
            pendingWork: normalizedPendingWork,
            economyHealth: normalizedEconomyHealth,
            routineCandidates: normalizedRoutineCandidates,
        }),
    ], { dateKey: summaryDateKey, limit: 8 });

    const studentSignals = {
        economyChange: analyticsDaily?.studentChangeSignals || null,
        lowCreditCount: analyticsDaily?.credit?.lowCreditCount || 0,
        zeroOrNegativeCashCount:
            studentEconomySignals?.cashDistribution?.zeroOrNegativeCashCount || 0,
        topOverdueStudents:
            analyticsDaily?.operationalRisks?.tax?.topOverdueStudents || [],
        repeatFineStudents:
            analyticsDaily?.operationalRisks?.police?.repeatFineStudents || [],
    };

    return {
        summaryVersion: SUMMARY_VERSION,
        generatedForDate: summaryDateKey,
        updatedAt: FieldValue.serverTimestamp(),
        source: "rebuildAgentDailySummary",
        sourceUpdatedAt: {
            missions: missions.updatedAt || null,
            bank: bank.updatedAt || null,
            police: police.updatedAt || null,
            marketplace: marketplace.updatedAt || null,
            credentials: credentials.updatedAt || null,
            realestate: realestate.updatedAt || null,
            students: analyticsDaily?.sourceUpdatedAt?.students || new Date().toISOString(),
            analyticsDaily: analyticsDaily?.generatedForDate || null,
            pageAnalyticsDaily: dailyContext?.generatedAt || null,
            activityLogs: activitySignals?.available ? new Date().toISOString() : null,
        },
        sourceVersions: {
            notificationSummary: {
                missions: missions.updatedAt || null,
                bank: bank.updatedAt || null,
                police: police.updatedAt || null,
                marketplace: marketplace.updatedAt || null,
                credentials: credentials.updatedAt || null,
                realestate: realestate.updatedAt || null,
            },
            analyticsDaily: {
                schemaVersion: analyticsDaily?.schemaVersion || null,
                generatedForDate: analyticsDaily?.generatedForDate || null,
                historyDayCount: analyticsDaily?.windows?.historyDayCount || 0,
            },
            pageAnalyticsDaily: {
                schemaVersion: DAILY_CONTEXT_SCHEMA_VERSION,
                generatedForDate: dailyContext?.generatedForDate || null,
                windowDays: dailyContext?.windowDays || 0,
                domainCount: Object.keys(dailyContext?.domains || {}).length,
            },
            activityLogs: {
                available: Boolean(activitySignals?.available),
                lookbackDays: activitySignals?.lookbackDays || null,
                scannedCount: activitySignals?.scannedCount || 0,
            },
            executionLogs: {
                available: Boolean(recentExecutionLogs?.available),
                count: recentExecutionLogs?.count || 0,
                confirmedCount: recentExecutionLogs?.confirmedCount || 0,
                preparedCount: recentExecutionLogs?.preparedCount || 0,
            },
        },
        freshness: {
            status: "fresh",
            checkedAt: FieldValue.serverTimestamp(),
        },
        openingBrief,
        preparedWork,
        pendingWork: normalizedPendingWork,
        pendingActions: normalizedPendingWork,
        economyHealth: normalizedEconomyHealth,
        routineCandidates: normalizedRoutineCandidates,
        highlights: normalizedEconomyHealth,
        dailyContext,
        studentSignals,
        executionPolicy,
        recentExecutionLogs,
        cardValidation: normalizedCards.validation,
        metrics: {
            pendingWorkCount: normalizedPendingWorkCount,
            pendingWorkGroupCount: normalizedPendingWork.length,
            pendingActionCount: normalizedPendingWorkCount,
            pendingActionGroupCount: normalizedPendingWork.length,
            highPriorityWorkCount: normalizedHighPriorityWorkCount,
            highSeverityCount: normalizedHighPriorityWorkCount,
            healthAttentionCount: normalizedEconomyHealth.filter(
                (item) => item.status === "attention",
            ).length,
            routineCandidateCount: normalizedRoutineCandidates.length,
            preparedWorkCount: preparedWork.length,
            recentExecutionLogCount: recentExecutionLogs?.count || 0,
            recentConfirmedExecutionLogCount: recentExecutionLogs?.confirmedCount || 0,
            enabledRoutineRuleCount: routineSettings.enabledCount || 0,
            cardValidationIssueCount: normalizedCards.validation.issueCount,
            executionEnabled: executionPolicy.executionEnabled,
            aiAgentExecuteFeatureFlagEnabled: executionPolicy.featureFlagEnabled,
            activeStudentCount,
            averageCashBalance: studentEconomySignals?.cashDistribution?.averageCash || 0,
            cashConcentrationTop20Share:
                studentEconomySignals?.cashDistribution?.top20Share || 0,
            zeroOrNegativeCashStudentCount:
                studentEconomySignals?.cashDistribution?.zeroOrNegativeCashCount || 0,
            lowCreditStudentCount: studentEconomySignals?.credit?.lowCreditCount || 0,
            liquidMoneyChangeRate30d:
                analyticsDaily?.monetary?.liquidMoneyChangeRate30d ?? null,
            storeNetSpendChangeRate30d:
                analyticsDaily?.consumption?.netSpendChangeRate30d ?? null,
            analyticsHistoryDayCount:
                analyticsDaily?.windows?.historyDayCount || 0,
            overdueTaxBillCount:
                analyticsDaily?.operationalRisks?.tax?.overdueBillCount || 0,
            pendingPoliceReportCount:
                analyticsDaily?.operationalRisks?.police?.pendingReportCount || 0,
            repeatFineStudentCount:
                analyticsDaily?.operationalRisks?.police?.repeatFineStudents?.length || 0,
            dailyContextDomainCount: Object.keys(dailyContext?.domains || {}).length,
            dailyContextSourceRefCount: Object.values(dailyContext?.domains || {})
                .reduce((sum, domain) => sum + (domain?.sourceRefs?.length || 0), 0),
        },
        caveats: [
            "현재 업무 판단 카드는 기존 알림/대시보드 요약을 비서용 문장으로 재가공한 읽기 전용 초안입니다.",
            normalizedCards.validation.issueCount > 0 ?
                "일부 카드가 비서 UI 스키마에 맞게 자동 정규화되었습니다." :
                "카드 스키마 검증은 통과했으며 실행 필드는 읽기 전용으로 고정됩니다.",
            executionPolicy.disabledReason,
            "경제 건강 진단은 analyticsDaily의 monetaryHistory 기반 30일 비교와 현재 학생 스냅샷을 함께 사용하며, 세금/자리세 연체율과 물가 적정성은 후속 지표로 보강합니다.",
            activitySignals?.available ?
                "반복 업무 후보는 최근 활동 로그와 현재 미처리 업무를 함께 참고한 초안이며 자동 실행하지 않습니다." :
                "활동 로그를 읽지 못해 반복 업무 후보는 현재 미처리 업무 기반 초안으로 표시됩니다.",
        ],
    };
}
exports.rebuildAgentAnalyticsDaily = onCall(
    {
        region: REGION,
        memory: "512MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        const classId = String(request.data?.classId || "").trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        await assertAiProTeacher(request, { classId });

        const analyticsDaily = await buildAgentAnalyticsDaily(classId);
        await persistAgentAnalyticsDaily(classId, analyticsDaily);

        return {
            success: true,
            classId,
            generatedForDate: analyticsDaily.generatedForDate,
            activeStudentCount:
                analyticsDaily.studentEconomySignals?.activeStudentCount || 0,
            historyDayCount: analyticsDaily.windows?.historyDayCount || 0,
            healthStatus: {
                monetary: analyticsDaily.monetary?.status || "unknown",
                consumption: analyticsDaily.consumption?.status || "unknown",
                credit: analyticsDaily.credit?.status || "unknown",
            },
            operationalRiskCounts: {
                overdueTaxBills:
                    analyticsDaily.operationalRisks?.tax?.overdueBillCount || 0,
                pendingPoliceReports:
                    analyticsDaily.operationalRisks?.police?.pendingReportCount || 0,
                repeatFineStudents:
                    analyticsDaily.operationalRisks?.police?.repeatFineStudents?.length || 0,
            },
        };
    },
);
exports.rebuildAgentDailySummary = onCall(
    {
        region: REGION,
        memory: "512MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        const classId = String(request.data?.classId || "").trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        await assertAiProTeacher(request, { classId });

        const summary = await buildAgentDailySummary(classId);
        await db.doc(dashboardSummaryPath(classId, "agentDailySummary")).set(
            summary,
            { merge: false },
        );

        return {
            success: true,
            classId,
            pendingWorkCount: summary.metrics.pendingWorkCount,
            pendingWorkGroupCount: summary.metrics.pendingWorkGroupCount,
            pendingActionCount: summary.metrics.pendingActionCount,
            pendingActionGroupCount: summary.metrics.pendingActionGroupCount,
            generatedForDate: summary.generatedForDate,
        };
    },
);

exports.previewAgentAction = onCall(
    {
        region: REGION,
        memory: "256MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        const classId = String(request.data?.classId || "").trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }
        await assertAiProTeacher(request, { classId });
        const action = sanitizeAgentActionInput(request.data?.action || {});
        return {
            success: true,
            classId,
            action,
            preview: buildAgentActionPreview(action),
            idempotencyKey: buildAgentActionIdempotencyKey({ classId, action }),
        };
    },
);

exports.prepareAgentAction = onCall(
    {
        region: REGION,
        memory: "256MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        const classId = String(request.data?.classId || "").trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }
        await assertAiProTeacher(request, { classId });

        const action = sanitizeAgentActionInput(request.data?.action || {});
        const preview = buildAgentActionPreview(action);
        const idempotencyKey = buildAgentActionIdempotencyKey({ classId, action });
        const auth = request.auth || {};
        const existingSnap = await db
            .collection(`classes/${classId}/aiAgentActionDrafts`)
            .where("idempotencyKey", "==", idempotencyKey)
            .limit(1)
            .get();

        if (!existingSnap.empty) {
            const existing = existingSnap.docs[0];
            return {
                success: true,
                classId,
                reused: true,
                draftId: existing.id,
                executionId: existing.data()?.executionId || null,
                action: existing.data()?.action || action,
                preview: existing.data()?.preview || preview,
            };
        }

        const draftRef = db.collection(`classes/${classId}/aiAgentActionDrafts`).doc();
        const executionRef = db.collection(`classes/${classId}/aiAgentExecutionLogs`).doc();
        const now = FieldValue.serverTimestamp();
        const actor = {
            uid: auth.uid || null,
            name: auth.token?.name || auth.token?.displayName || auth.token?.email || null,
            role: auth.token?.role || "teacher",
        };

        await db.runTransaction(async (tx) => {
            tx.set(draftRef, {
                schemaVersion: 1,
                classId,
                action,
                preview,
                status: "prepared",
                idempotencyKey,
                executionId: executionRef.id,
                createdAt: now,
                updatedAt: now,
                createdBy: actor,
                expiresAt: admin.firestore.Timestamp.fromDate(
                    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                ),
            });
            tx.set(executionRef, {
                schemaVersion: 1,
                classId,
                actionType: action.actionType,
                domain: action.domain,
                riskLevel: action.riskLevel,
                status: "prepared",
                requestedBy: actor,
                proposedBy: {
                    type: "ai_assistant",
                    sourceKind: action.sourceKind,
                    sourceCardId: action.sourceCardId,
                },
                preview,
                idempotencyKey,
                targetCount: action.targetCount,
                successCount: 0,
                failureCount: 0,
                skippedCount: 0,
                resultRefs: [],
                failures: [],
                createdAt: now,
                completedAt: null,
                executable: false,
                requiresConfirmation: true,
            });
        });

        return {
            success: true,
            classId,
            reused: false,
            draftId: draftRef.id,
            executionId: executionRef.id,
            action,
            preview,
        };
    },
);
exports.executeAgentAction = onCall(
    {
        region: REGION,
        memory: "256MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        const classId = String(request.data?.classId || "").trim();
        const draftId = String(request.data?.draftId || "").trim();
        const requestedExecutionId = String(request.data?.executionId || "").trim();
        if (!classId || !draftId) {
            throw new HttpsError("invalid-argument", "classId and draftId are required.");
        }

        await assertAiProTeacher(request, { classId });

        const auth = request.auth || {};
        const actor = {
            uid: auth.uid || null,
            name: auth.token?.name || auth.token?.displayName || auth.token?.email || null,
            role: auth.token?.role || "teacher",
        };
        const draftRef = db.doc(`classes/${classId}/aiAgentActionDrafts/${draftId}`);
        const now = FieldValue.serverTimestamp();
        let response = null;

        await db.runTransaction(async (tx) => {
            const draftSnap = await tx.get(draftRef);
            if (!draftSnap.exists) {
                throw new HttpsError("not-found", "Agent action draft was not found.");
            }

            const draft = draftSnap.data() || {};
            if (draft.classId && draft.classId !== classId) {
                throw new HttpsError("permission-denied", "Draft does not belong to this class.");
            }

            const executionId = requestedExecutionId || draft.executionId || "";
            if (!executionId) {
                throw new HttpsError("failed-precondition", "Draft does not have an execution log.");
            }
            if (draft.executionId && requestedExecutionId && draft.executionId !== requestedExecutionId) {
                throw new HttpsError("failed-precondition", "executionId does not match the draft.");
            }

            const executionRef = db.doc(`classes/${classId}/aiAgentExecutionLogs/${executionId}`);
            const executionSnap = await tx.get(executionRef);
            if (!executionSnap.exists) {
                throw new HttpsError("not-found", "Agent execution log was not found.");
            }

            const execution = executionSnap.data() || {};
            const action = draft.action || {};
            const actionType = cleanString(action.actionType || execution.actionType || "");
            const registryItem = AGENT_ACTION_REGISTRY[actionType];
            if (!registryItem) {
                throw new HttpsError("failed-precondition", "Unsupported agent action type.");
            }
            if (registryItem.reviewConfirmationEnabled === false) {
                throw new HttpsError(
                    "failed-precondition",
                    "This action type is not enabled for review confirmation.",
                );
            }
            if (registryItem.executable !== false || action.executable === true || execution.executable === true) {
                throw new HttpsError(
                    "failed-precondition",
                    "This action type is not enabled for automatic execution yet.",
                );
            }

            const draftStatus = draft.status || "prepared";
            const executionStatus = execution.status || "prepared";
            if (draftStatus === "confirmed" && executionStatus === "confirmed") {
                response = {
                    success: true,
                    classId,
                    draftId,
                    executionId,
                    status: "confirmed",
                    reused: true,
                    reviewOnly: true,
                    action,
                    preview: draft.preview || execution.preview || null,
                };
                return;
            }
            if (draftStatus !== "prepared" || executionStatus !== "prepared") {
                throw new HttpsError(
                    "failed-precondition",
                    "Only prepared agent actions can be confirmed in this step.",
                );
            }

            const reviewResult = {
                type: "teacher_confirmed_no_execution",
                message: "Teacher confirmed the draft review. No student data was changed.",
            };

            tx.update(draftRef, {
                status: "confirmed",
                updatedAt: now,
                confirmedAt: now,
                confirmedBy: actor,
                reviewOnly: true,
                executionPerformed: false,
                reviewResult,
            });
            tx.update(executionRef, {
                status: "confirmed",
                confirmedAt: now,
                confirmedBy: actor,
                completedAt: now,
                reviewOnly: true,
                executionPerformed: false,
                resultRefs: [draftRef.path],
                reviewResult,
            });

            response = {
                success: true,
                classId,
                draftId,
                executionId,
                status: "confirmed",
                reused: false,
                reviewOnly: true,
                action,
                preview: draft.preview || execution.preview || null,
            };
        });

        return response;
    },
);

exports.updateAgentRoutineSettings = onCall(
    {
        region: REGION,
        memory: "256MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        const classId = String(request.data?.classId || "").trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        await assertAiProTeacher(request, { classId });

        const rules = applyRoutineScheduleMetadata(
            sanitizeRoutineSettingsUpdate(request.data?.rules || {}),
            { now: new Date(), preserveExisting: true },
        );
        const auth = request.auth || {};
        const enabledCount = Object.values(rules).filter((rule) => rule.enabled === true).length;
        const payload = {
            schemaVersion: 1,
            mode: "auto_prepare_only",
            rules,
            enabledCount,
            updatedAt: FieldValue.serverTimestamp(),
            updatedByUid: auth.uid || null,
            updatedByName:
                auth.token?.name ||
                auth.token?.displayName ||
                auth.token?.email ||
                null,
        };

        await db.doc(routineSettingsPath(classId)).set(payload, { merge: false });

        const summary = await buildAgentDailySummary(classId);
        await db.doc(dashboardSummaryPath(classId, "agentDailySummary")).set(
            summary,
            { merge: false },
        );

        return {
            success: true,
            classId,
            routineSettings: summary.routineSettings,
            enabledRoutineRuleCount: summary.metrics.enabledRoutineRuleCount,
        };
    },
);
const shouldAttachChatDraft = (message, activeContext) => {
    const text = String(message || "");
    const contextHasDraft = Boolean(activeContext?.suggestedDraft);
    return (
        contextHasDraft ||
        /초안|안내문|문구|체크리스트|점검\s*목록|목록\s*준비|다듬|써줘|작성/.test(text)
    );
};

const resolveChatDraftType = (message, activeContext) => {
    const text = String(message || "");
    if (activeContext?.suggestedDraft?.type === "messageDraft") return "messageDraft";
    if (/안내문|문구|메시지|알림/.test(text)) return "messageDraft";
    return "checklist";
};

const extractDraftItemsFromMarkdown = (content) => {
    const lines = String(content || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    return lines
        .map((line) => line.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "").trim())
        .filter((line) => line && !line.startsWith("###") && !line.startsWith("요약:"))
        .filter((line) => line.length >= 4)
        .slice(0, AGENT_CARD_LIMITS.draftItems);
};

const buildChatDraftText = ({ title, type, items, content }) => {
    if (items.length === 0) return String(content || "").trim().slice(0, 1800);
    if (type === "messageDraft") {
        return [
            "[" + title + "]",
            "",
            "안녕하세요. 경제교실 운영과 관련해 확인이 필요한 내용이 있어 안내드립니다.",
            "",
            ...items.map((item) => "- " + item),
            "",
            "확인 후 필요한 조치를 부탁드립니다.",
        ].join("\n");
    }
    return [
        "[" + title + "]",
        "",
        "점검할 일",
        ...items.map((item) => "- " + item),
        "",
        "실행 전 확인",
        "- 이 초안은 자동 실행되지 않습니다.",
        "- 실제 승인, 지급, 차감, 발송 전에는 선생님 확인이 필요합니다.",
    ].join("\n");
};

const buildStructuredChatDraft = ({ message, activeContext, content, provider }) => {
    if (!shouldAttachChatDraft(message, activeContext)) return null;
    const type = resolveChatDraftType(message, activeContext);
    const titleBase = cleanString(
        activeContext?.suggestedDraft?.title || activeContext?.title || activeContext?.label,
        type === "messageDraft" ? "안내문 초안" : "점검 목록 초안",
    );
    const contextItems = Array.isArray(activeContext?.suggestedDraft?.items) ?
        activeContext.suggestedDraft.items :
        [];
    const contextRecommendations = Array.isArray(activeContext?.recommendations) ?
        activeContext.recommendations :
        [];
    const markdownItems = extractDraftItemsFromMarkdown(content);
    const items = cleanStringList(
        markdownItems.length > 0 ? markdownItems : [...contextItems, ...contextRecommendations],
        { limit: AGENT_CARD_LIMITS.draftItems, maxLength: 220 },
    );
    const normalizedDraft = normalizeSuggestedDraft({ type, title: titleBase, items }, titleBase);
    if (!normalizedDraft) return null;
    const text = buildChatDraftText({
        title: normalizedDraft.title,
        type: normalizedDraft.type,
        items: normalizedDraft.items,
        content,
    });
    return {
        id: cleanId("chat-draft-" + Date.now(), "chat-draft"),
        source: "chatWithAgentAssistant",
        provider: provider || null,
        domain: VALID_AGENT_DOMAINS.has(activeContext?.domain) ? activeContext.domain : "dashboard",
        title: normalizedDraft.title,
        type: normalizedDraft.type,
        items: normalizedDraft.items,
        text,
        deepLink: cleanString(activeContext?.deepLink || "", ""),
        executable: false,
        requiresConfirmation: true,
        schemaVersion: 1,
    };
};
const safeJson = (value, maxLength = 12000) => {
    try {
        const text = JSON.stringify(value || {}, null, 2);
        return text.length > maxLength ? `${text.slice(0, maxLength)}\n...` : text;
    } catch (_error) {
        return "{}";
    }
};

const buildChatPromptSummary = (summary) => {
    const compactSummary = { ...(summary || {}) };
    delete compactSummary.dailyContext;
    delete compactSummary.recentExecutionLogs;
    return compactSummary;
};

const addAssistantAuthorizationUsage = (usage = null, infrastructureSources = []) => {
    const sources = [{
        source: "class_permission_context",
        documentReads: 1,
        cacheHit: false,
    }, ...infrastructureSources.filter(Boolean), ...(usage?.sources || [])];
    const documentReads = sources.reduce(
        (total, source) => total + Math.max(0, Number(source.documentReads || 0)),
        0,
    );
    const documentWrites = sources.reduce(
        (total, source) => total + Math.max(0, Number(source.documentWrites || 0)),
        0,
    );
    return {
        ...(usage || {}),
        documentReads,
        documentWrites,
        modelCalls: Number(usage?.modelCalls || 0),
        sources,
        withinBudget:
            documentReads <= cashChangeEvidenceBudget.maxTotalDocumentReads &&
            documentWrites <= cashChangeEvidenceBudget.maxTotalDocumentWrites,
        budget: structuredClone(cashChangeEvidenceBudget),
    };
};

const logAssistantEvidenceUsage = ({
    classId,
    capability,
    usage,
    durationMs,
    requestLimit,
    outcome = "success",
    errorCode = null,
}) => {
    console.info("[aiAssistantEvidenceUsage]", JSON.stringify({
        schemaVersion: 1,
        classId,
        capability,
        evidenceTier: usage?.evidenceTier || null,
        documentReads: Number(usage?.documentReads || 0),
        documentWrites: Number(usage?.documentWrites || 0),
        modelCalls: Number(usage?.modelCalls || 0),
        cacheHits: usage?.cacheHits || [],
        truncatedSources: (usage?.sources || [])
            .filter(({ truncated }) => truncated)
            .map(({ source }) => source),
        withinBudget: usage?.withinBudget !== false,
        costUnknown: (usage?.sources || []).some(({ costUnknown }) => costUnknown),
        failedSources: (usage?.sources || [])
            .filter(({ failed }) => failed)
            .map(({ source }) => source),
        outcome,
        errorCode,
        durationMs,
        rateLimit: {
            userRemaining: requestLimit?.userRemaining ?? null,
            classRemaining: requestLimit?.classRemaining ?? null,
        },
    }));
};

const trackAssistantEvidenceReader = ({ source, sources, reader }) =>
    async (args) => {
        try {
            const result = await reader(args);
            if (result?.usage) sources.push(result.usage);
            return result;
        } catch (error) {
            sources.push(error?.evidenceUsage || {
                source,
                documentReads: 0,
                cacheHit: false,
                failed: true,
                costUnknown: true,
            });
            throw error;
        }
    };

exports.chatWithAgentAssistant = onCall(
    {
        region: REGION,
        secrets: [googleApiKey],
        memory: "512MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        const requestStartedAt = Date.now();
        const classId = String(request.data?.classId || "").trim();
        const message = String(request.data?.message || "").trim();
        const activeContext =
            request.data?.activeContext && typeof request.data.activeContext === "object" ?
                request.data.activeContext :
                null;
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }
        if (!message) {
            throw new HttpsError("invalid-argument", "message is required.");
        }

        let ctx;
        let classData;
        try {
            ({ ctx, classData } = await assertAiProTeacher(request, { classId }));
        } catch (error) {
            const usage = {
                evidenceTier: "authorization",
                documentReads: Number(error?.evidenceUsage?.documentReads || 0),
                documentWrites: 0,
                modelCalls: 0,
                sources: error?.evidenceUsage ? [error.evidenceUsage] : [],
                withinBudget: true,
            };
            logAssistantEvidenceUsage({
                classId,
                capability: null,
                usage,
                durationMs: Date.now() - requestStartedAt,
                requestLimit: null,
                outcome: "rejected",
                errorCode: error?.code || "authorization_failed",
            });
            throw error;
        }

        const localRequestLimit = assistantRequestLimiter.consume({
            classId,
            userId: ctx.uid,
        });
        if (!localRequestLimit.allowed) {
            const evidenceUsage = addAssistantAuthorizationUsage();
            logAssistantEvidenceUsage({
                classId,
                capability: null,
                usage: evidenceUsage,
                durationMs: Date.now() - requestStartedAt,
                requestLimit: localRequestLimit,
                outcome: "rate_limited",
                errorCode: "resource-exhausted",
            });
            const retryAfterSeconds = Math.ceil(
                localRequestLimit.retryAfterMs / 1000,
            );
            throw new HttpsError(
                "resource-exhausted",
                `AI 도우미 요청이 잠시 많습니다. ${retryAfterSeconds}초 후 다시 시도해주세요.`,
            );
        }

        let requestLimit;
        try {
            requestLimit = await consumePersistentAssistantRequestBudget({
                classId,
                userId: ctx.uid,
            });
        } catch (error) {
            const evidenceUsage = addAssistantAuthorizationUsage(null, [
                error?.evidenceUsage || {
                    source: "assistant_request_budget",
                    documentReads: 0,
                    documentWrites: 0,
                    cacheHit: false,
                    failed: true,
                    costUnknown: true,
                },
            ]);
            logAssistantEvidenceUsage({
                classId,
                capability: null,
                usage: evidenceUsage,
                durationMs: Date.now() - requestStartedAt,
                requestLimit: null,
                outcome: "error",
                errorCode: error?.code || "request_budget_failed",
            });
            throw error;
        }
        const requestBudgetWithinPolicy =
            requestLimit.usage.documentReads <=
                AI_ASSISTANT_SERVER_POLICY.rateLimitMaxDocumentReads &&
            requestLimit.usage.documentWrites <=
                AI_ASSISTANT_SERVER_POLICY.rateLimitMaxDocumentWrites;
        if (!requestBudgetWithinPolicy) {
            const evidenceUsage = addAssistantAuthorizationUsage(
                null,
                [{ ...requestLimit.usage, failed: true }],
            );
            logAssistantEvidenceUsage({
                classId,
                capability: null,
                usage: evidenceUsage,
                durationMs: Date.now() - requestStartedAt,
                requestLimit,
                outcome: "evidence_budget_exceeded",
                errorCode: "resource-exhausted",
            });
            throw new HttpsError(
                "resource-exhausted",
                "AI 도우미 요청 비용 한도를 초과해 실행하지 않았습니다. 잠시 후 다시 시도해주세요.",
            );
        }
        if (!requestLimit.allowed) {
            const evidenceUsage = addAssistantAuthorizationUsage(
                null,
                [requestLimit.usage],
            );
            logAssistantEvidenceUsage({
                classId,
                capability: null,
                usage: evidenceUsage,
                durationMs: Date.now() - requestStartedAt,
                requestLimit,
                outcome: "rate_limited",
                errorCode: "resource-exhausted",
            });
            const retryAfterSeconds = Math.ceil(requestLimit.retryAfterMs / 1000);
            throw new HttpsError(
                "resource-exhausted",
                `AI 도우미 요청이 잠시 많습니다. ${retryAfterSeconds}초 후 다시 시도해주세요.`,
            );
        }

        const observedEvidenceSources = [];
        let cashChangeResponse;
        try {
            cashChangeResponse = await answerStudentCashChangeQuestion({
                classId,
                message,
                activeContext,
                classData,
                readStudentRoster: trackAssistantEvidenceReader({
                    source: "student_identity_roster",
                    sources: observedEvidenceSources,
                    reader: readAiAssistantStudentRoster,
                }),
                readStudentState: trackAssistantEvidenceReader({
                    source: "student_asset_state",
                    sources: observedEvidenceSources,
                    reader: readAiAssistantStudentState,
                }),
                readCashEvents: trackAssistantEvidenceReader({
                    source: "student_cash_events",
                    sources: observedEvidenceSources,
                    reader: readCachedAiAssistantCashEvents,
                }),
                onReadError: (error) => console.warn(
                    "[aiAgentSummary] cash activity read failed:",
                    error?.message || error,
                ),
            });
        } catch (error) {
            const evidenceUsage = addAssistantAuthorizationUsage({
                capability: "assets.explain_cash_change",
                evidenceTier: cashChangeEvidenceBudget.evidenceTier,
                modelCalls: 0,
                sources: observedEvidenceSources,
            }, [requestLimit.usage]);
            logAssistantEvidenceUsage({
                classId,
                capability: "assets.explain_cash_change",
                usage: evidenceUsage,
                durationMs: Date.now() - requestStartedAt,
                requestLimit,
                outcome: "error",
                errorCode: error?.code || "evidence_read_failed",
            });
            throw error;
        }
        if (cashChangeResponse) {
            const answerUsage = {
                ...cashChangeResponse.evidenceUsage,
                cacheHits: observedEvidenceSources
                    .filter(({ cacheHit }) => cacheHit)
                    .map(({ source }) => source),
                sources: observedEvidenceSources,
            };
            const evidenceUsage = addAssistantAuthorizationUsage(
                answerUsage,
                [requestLimit.usage],
            );
            logAssistantEvidenceUsage({
                classId,
                capability: cashChangeResponse.questionCapability,
                usage: evidenceUsage,
                durationMs: Date.now() - requestStartedAt,
                requestLimit,
            });
            return {
                ...cashChangeResponse,
                evidenceUsage,
                summaryExists: null,
                missionDetailAttached: false,
                operationalDetailsAttached: false,
                dailyContextAttached: false,
                onDemandAnalysisAttached: false,
                questionCapabilityAttached: true,
                timestamp: cashChangeResponse.timestamp || new Date().toISOString(),
            };
        }

        if (!AI_ASSISTANT_SERVER_POLICY.allowLegacyChat) {
            const evidenceUsage = addAssistantAuthorizationUsage({
                evidenceTier: "unavailable",
                modelCalls: 0,
                cacheHits: [],
                sources: [],
                withinBudget: true,
            }, [requestLimit.usage]);
            logAssistantEvidenceUsage({
                classId,
                capability: null,
                usage: evidenceUsage,
                durationMs: Date.now() - requestStartedAt,
                requestLimit,
            });
            return {
                content: "현재는 학생 현금 변화 분석을 지원합니다. " +
                    "학생 이름이나 번호와 조회 기간을 포함해 질문해주세요.",
                provider: "local-question-capability",
                questionCapability: null,
                route: {
                    schemaVersion: 1,
                    status: "unsupported",
                    needsClarification: false,
                    clarificationQuestion: null,
                    unsupportedCapabilities: [],
                    actionRequests: [],
                    routes: [],
                },
                answerEnvelope: null,
                questionCapabilityAttached: false,
                evidenceUsage,
                timestamp: new Date().toISOString(),
            };
        }

        const onDemandWindowDays = resolveOnDemandWindowDays(message);
        const onDemandCacheKey = getOnDemandAnalysisCacheKey({
            message,
            activeContext,
            windowDays: onDemandWindowDays,
        });
        let onDemandEconomyAnalysis = shouldAttachOnDemandAnalysis(message, activeContext) ?
            await readCachedOnDemandAnalysis(classId, onDemandCacheKey) :
            null;
        const onDemandCacheHit = Boolean(onDemandEconomyAnalysis);
        if (!onDemandEconomyAnalysis) {
            onDemandEconomyAnalysis = await buildOnDemandEconomyAnalysis(
                classId,
                message,
                activeContext,
            );
            if (onDemandEconomyAnalysis) {
                await persistOnDemandAnalysisCache(
                    classId,
                    onDemandCacheKey,
                    onDemandEconomyAnalysis,
                );
            }
        }
        if (onDemandEconomyAnalysis) {
            const localContent = formatOnDemandEconomyAnalysisResponse(onDemandEconomyAnalysis);
            const provider = onDemandCacheHit ?
                "local-on-demand-analysis-cache" :
                "local-on-demand-analysis";
            return {
                content: localContent,
                structuredDraft: buildStructuredChatDraft({
                    message,
                    activeContext,
                    content: localContent,
                    provider,
                }),
                provider,
                summaryExists: null,
                missionDetailAttached: false,
                onDemandAnalysisAttached: true,
                onDemandAnalysisCacheHit: onDemandCacheHit,
                onDemandAnalysisCacheKey,
                onDemandAnalysisWindowDays:
                    onDemandEconomyAnalysis.requestedWindowDays || null,
                timestamp: new Date().toISOString(),
            };
        }

        const apiKey = googleApiKey.value();
        if (!apiKey) {
            throw new HttpsError(
                "failed-precondition",
                "LLM API 키가 설정되지 않았습니다.",
            );
        }

        const summarySnap = await db
            .doc(dashboardSummaryPath(classId, "agentDailySummary"))
            .get();
        const summary = summarySnap.exists ? summarySnap.data() || {} : {};
        const chatPromptSummary = buildChatPromptSummary(summary);
        const missionPendingDetails = shouldAttachMissionDetails(message, activeContext) ?
            await getMissionPendingSubmissionDetails(classId, { limit: 12 }) :
            null;
        const operationalDetails = await getOperationalDetailsForContext(classId, activeContext);

        const systemInstruction = [
            "당신은 핀클래스 경제교실을 돕는 교사용 AI 운영비서입니다.",
            "현재 단계는 읽기/보고 중심 베타입니다. 실제 승인, 지급, 차감, 삭제, 수정이 완료되었다고 말하지 마세요.",
            "제공된 agentDailySummary의 pendingWork, economyHealth, routineCandidates와",
            "selectedDashboardContext, missionPendingSubmissionDetails 안에서만 판단하세요.",
            "근거가 부족하면 추가 조회나 교사의 확인이 필요하다고 말하세요.",
            "교사가 바로 이해할 수 있게 짧고 구체적인 한국어 보고서로 답하세요.",
            "단순 카운트 반복보다 왜 중요한지, 먼저 볼 대상, 다음 행동을 중심으로 답하세요.",
            "교사가 '다 승인', '승인해줘'처럼 실행을 요청해도 실제 실행은 하지 않습니다. 반드시 실행 예정안만 만들고 마지막에 '실행하려면 최종 승인 버튼/확인이 필요합니다'라고 말하세요.",
            "missionPendingSubmissionDetails가 있으면 아래 형식으로만 답하세요: 첫 줄은 '요약: 총 N건 중 승인 후보 A건, 확인 필요 B건, 제외 후보 C건입니다.'",
            "그 다음 섹션은 반드시 '### 승인 후보', '### 확인 필요', '### 제외 후보', '### 다음 단계' 순서로 작성하세요.",
            "각 항목은 한 줄로만 쓰세요. 형식은 '- 학생명 · 미션명: 판단 이유'입니다. 중첩 목록을 만들지 마세요.",
            "제출 원문이 없으면 절대 승인 후보로 분류하지 말고 확인 필요 또는 제외 후보로 분류하세요.",
            "제출 원문이 10자 미만이거나 의미 없는 반복/테스트 문자열로 보이면 승인 후보로 분류하지 말고 확인 필요로 분류하세요.",
            "지각 제출은 기본적으로 제외 후보로 분류하되, 내용이 충분하면 확인 필요로 완화할 수 있습니다.",
            "날짜, 학생번호, 제출 ID는 교사가 묻지 않으면 생략하세요.",
            "목록이 길면 각 섹션 최대 6개까지만 보여주고 나머지는 '외 N건'으로 묶으세요.",
        ].join("\n");
        const responseContract = [
            "When dailyContext or sourceRefs are available, use them as the primary evidence layer.",
            "Answer only in Korean. Do not expose English field names, collection names, ids, URLs, or internal labels.",
            "Use a short teacher-friendly operational tone. Start with the useful answer, not with a report heading.",
            "Avoid rigid headings like 판단, 근거, 추천 행동, 확인할 화면 unless the teacher explicitly asks for a report.",
            "Prefer 2 to 4 short bullets. Each bullet should say what to do or what was found.",
            "Do not only list statistics. Interpret what changed, why it matters, and what the teacher can do next.",
            "Separate facts from interpretation naturally, using Korean phrases like '기록상으로는' and '봐야 할 점은'.",
            "If evidence is weak, say what one detail is missing and what you can still infer now.",
            "Mention page names in Korean when useful, but do not show raw paths like /police or terms like deepLink.",
            "When operationalDetails are attached, do not answer that priority cannot be decided. " +
                "Use samples, groupedByStudent, suggestedSort, and decisionRules to propose a concrete order.",
            "If operationalDetails have zero samples, explain that there is no current item to process.",
            "Never claim that money, credit, tax, approval, or student data was changed " +
                "unless an explicit confirmed action result is present.",
        ].join("\n");

        const promptText = [
            "[agentDailySummary]",
            safeJson(chatPromptSummary, 9000),
            "",
            "[dailyAggregateContext]",
            safeJson(summary?.dailyContext || {}, 10000),
            "",
            "[operationalDetails]",
            operationalDetails ? safeJson(operationalDetails, 12000) : "{}",
            "",
            "[answerContract]",
            "짧고 자연스럽게 답하세요. 내부 데이터 이름, 영어 필드명, 화면 주소는 말하지 마세요. 먼저 할 일과 이유를 바로 알려주세요.",
            "",
            "[selectedDashboardContext]",
            safeJson(activeContext, 4000),
            "",
            "[missionPendingSubmissionDetails]",
            missionPendingDetails ? safeJson(missionPendingDetails, 18000) : "{}",
            "",
            "[teacherQuestion]",
            message,
        ].join("\n");

        const genAI = new GoogleGenerativeAI(apiKey);
        let lastError = null;

        for (const modelName of AGENT_CHAT_MODELS) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: [systemInstruction, responseContract].join("\n"),
                });
                const result = await model.generateContent(promptText);
                const response = await result.response;
                const text = response.text();

                return {
                    content: text,
                    structuredDraft: buildStructuredChatDraft({
                        message,
                        activeContext,
                        content: text,
                        provider: modelName,
                    }),
                    provider: modelName,
                    summaryExists: summarySnap.exists,
                    missionDetailAttached: Boolean(missionPendingDetails),
                    operationalDetailsAttached: Boolean(operationalDetails),
                    operationalDetailsType: operationalDetails?.detailType || null,
                    dailyContextAttached: Boolean(summary?.dailyContext),
                    timestamp: new Date().toISOString(),
                };
            } catch (error) {
                lastError = error;
                if (shouldTryNextAgentChatModel(error)) {
                    continue;
                }

                throw error;
            }
        }

        console.error("[chatWithAgentAssistant] all models failed:", lastError);
        throw new HttpsError(
            "resource-exhausted",
            "오늘의 AI 사용량이 모두 소진되었습니다. 내일 다시 시도해주세요.",
        );
    },
);
