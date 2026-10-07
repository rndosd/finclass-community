"use strict";

const {
    getEvidenceBudgetForCapability,
} = require("./aiAssistantEvidenceBudget");

const TEACHER_QUESTION_CAPABILITIES = [
    {
        id: "Q001",
        key: "operations.rank_today_work",
        type: "recommendation",
        readOnly: true,
        requiredSlots: [],
        defaults: { date: "today", domain: "all", limit: 5 },
        readers: [
            "classPermissionContext",
            "pendingWorkSummary",
            "pendingWorkDetails",
            "evidenceFreshness",
        ],
        calculators: [
            "pendingWorkNormalization",
            "pendingWorkPriority",
            "evidenceConfidence",
        ],
        permission: "ai_pro_teacher",
        clarificationBySlot: {},
    },
    {
        id: "Q003",
        key: "operations.list_pending_work",
        type: "query",
        readOnly: true,
        requiredSlots: [],
        defaults: {
            domain: "all",
            status: "pending",
            sort: "oldest_first",
            detail: "group_summary",
        },
        readers: [
            "classPermissionContext",
            "pendingWorkSummary",
            "pendingWorkDetails",
            "evidenceFreshness",
        ],
        calculators: ["pendingWorkNormalization", "dueAndWaitingTime"],
        permission: "ai_pro_teacher",
        clarificationBySlot: {},
    },
    {
        id: "Q008",
        key: "evidence.explain_answer_basis",
        type: "evidence",
        readOnly: true,
        requiredSlots: ["answerId"],
        defaults: { claim: "all", detail: "concept_time_warning" },
        readers: ["answerEvidence", "evidenceFreshness"],
        calculators: ["claimEvidenceClassification"],
        permission: "inherit_answer_permission",
        clarificationBySlot: {
            answerId: "어느 답변의 기준 시각과 근거를 확인할까요?",
        },
    },
    {
        id: "Q202",
        key: "missions.find_oldest_pending_submission",
        type: "recommendation",
        readOnly: true,
        requiredSlots: [],
        defaults: {
            mission: "all",
            status: "pending_review",
            sort: "submitted_at_asc",
            limit: 5,
        },
        readers: [
            "classPermissionContext",
            "missionPendingSubmissions",
            "evidenceFreshness",
        ],
        calculators: ["dueAndWaitingTime", "pendingWorkNormalization"],
        permission: "mission_review",
        clarificationBySlot: {},
    },
    {
        id: "Q407",
        key: "payroll.find_posting_anomalies",
        type: "diagnosis",
        readOnly: true,
        requiredSlots: ["payrollPeriod"],
        defaults: { payrollType: "salary", student: "all" },
        readers: [
            "classPermissionContext",
            "payrollEvidence",
            "studentAssetState",
            "evidenceFreshness",
        ],
        calculators: ["payrollPostingMatch", "postingReconciliation"],
        permission: "payroll_manage",
        clarificationBySlot: {
            payrollPeriod: "어느 급여 기간의 누락·중복을 확인할까요?",
        },
    },
    {
        id: "Q502",
        key: "assets.explain_cash_change",
        type: "diagnosis",
        readOnly: true,
        requiredSlots: ["student"],
        defaults: {
            assetComponent: "cash",
            timeRange: { kind: "relative_days", days: 7 },
            direction: "both",
            limit: 5,
        },
        readers: [
            "classPermissionContext",
            "studentAssetState",
            "studentMoneyEvents",
            "evidenceFreshness",
        ],
        calculators: [
            "assetPeriodChange",
            "moneyEventNormalization",
            "evidenceConfidence",
        ],
        permission: "teacher_or_self",
        clarificationBySlot: {
            student: "어느 학생의 개인 현금 변화를 확인할까요?",
        },
    },
    {
        id: "Q508",
        key: "bank.list_due_loans",
        type: "query_diagnosis",
        readOnly: true,
        requiredSlots: [],
        defaults: {
            student: "all",
            dueWithinDays: 7,
            statuses: ["ongoing", "overdue"],
            sort: "due_at_asc",
        },
        readers: ["classPermissionContext", "loanContracts", "evidenceFreshness"],
        calculators: ["dueAndWaitingTime", "obligationStateNormalization"],
        permission: "bank_manage",
        clarificationBySlot: {},
    },
    {
        id: "Q601",
        key: "tax.list_unpaid_bills",
        type: "query",
        readOnly: true,
        requiredSlots: [],
        defaults: {
            student: "all",
            scope: "unpaid",
            sort: "overdue_days_amount_desc",
        },
        readers: ["classPermissionContext", "taxBills", "evidenceFreshness"],
        calculators: ["dueAndWaitingTime", "obligationStateNormalization"],
        permission: "tax_manage",
        clarificationBySlot: {},
    },
    {
        id: "Q703",
        key: "store.find_unfulfilled_purchases",
        type: "diagnosis",
        readOnly: true,
        requiredSlots: [],
        defaults: {
            student: "all",
            timeRange: { kind: "relative_days", days: 30 },
            itemType: "all",
        },
        readers: [
            "classPermissionContext",
            "storePurchaseFulfillment",
            "evidenceFreshness",
        ],
        calculators: ["postingReconciliation"],
        permission: "store_manage",
        clarificationBySlot: {},
    },
    {
        id: "Q1001",
        key: "police.list_pending_reports",
        type: "query",
        readOnly: true,
        requiredSlots: [],
        defaults: {
            status: "pending_review",
            sort: "created_at_asc",
            student: "all",
            limit: 20,
        },
        readers: [
            "classPermissionContext",
            "policePendingReports",
            "evidenceFreshness",
        ],
        calculators: ["pendingWorkNormalization", "dueAndWaitingTime"],
        permission: "police_manage",
        clarificationBySlot: {},
    },
    {
        id: "Q1503",
        key: "evidence.verify_source_projection",
        type: "diagnosis",
        readOnly: true,
        requiredSlots: ["evidenceTarget"],
        defaults: { asOf: "current", tolerance: "registered_contract" },
        readers: ["sourceProjectionEvidence", "evidenceFreshness", "answerEvidence"],
        calculators: ["sourceProjectionComparison"],
        permission: "source_projection_permission_intersection",
        clarificationBySlot: {
            evidenceTarget: "어느 지표나 카드의 원본·요약 일치 여부를 확인할까요?",
        },
    },
    {
        id: "Q1505",
        key: "evidence.separate_fact_inference",
        type: "evidence",
        readOnly: true,
        requiredSlots: ["answerId"],
        defaults: {
            claim: "all",
            sections: ["facts", "calculations", "interpretations", "unknowns"],
        },
        readers: ["answerEvidence", "evidenceFreshness"],
        calculators: ["evidenceConfidence"],
        permission: "inherit_answer_permission",
        clarificationBySlot: {
            answerId: "어느 답변에서 사실과 추정을 구분할까요?",
        },
    },
].map((capability) => ({
    ...capability,
    evidenceBudget: getEvidenceBudgetForCapability(capability.key),
}));

const TEACHER_ACTION_REQUEST_CAPABILITIES = [
    "actions.prepare_mission_review",
    "actions.prepare_payroll",
    "actions.prepare_tax_reminder",
    "actions.prepare_maturity_notice",
    "actions.prepare_title_review",
    "actions.prepare_police_review",
    "actions.prepare_store_reversal",
    "actions.prepare_auction_settlement",
    "actions.prepare_month_end_settlement",
    "actions.preview_changes",
    "actions.execute_confirmed_draft",
    "actions.explain_execution_result",
].map((key) => ({
    key,
    readOnly: false,
    requiresConfirmation: true,
    executable: false,
}));

const TEACHER_ACTION_REQUEST_KEYS = new Set(
    TEACHER_ACTION_REQUEST_CAPABILITIES.map(({ key }) => key),
);

const listTeacherQuestionCapabilities = () =>
    structuredClone(TEACHER_QUESTION_CAPABILITIES);

const listTeacherActionRequestCapabilities = () =>
    structuredClone(TEACHER_ACTION_REQUEST_CAPABILITIES);

const getTeacherQuestionCapability = (idOrKey) => {
    const capability = TEACHER_QUESTION_CAPABILITIES.find(
        (item) => item.id === idOrKey || item.key === idOrKey,
    );
    return capability ? structuredClone(capability) : null;
};

const hasSlotValue = (value) =>
    value !== undefined && value !== null && value !== "";

const normalizeConfidence = (value) => {
    const confidence = Number(value);
    if (!Number.isFinite(confidence)) return 0;
    return Math.min(1, Math.max(0, confidence));
};

const normalizeSingleTeacherQuestionRoute = (proposal = {}, context = {}) => {
    if (TEACHER_ACTION_REQUEST_KEYS.has(proposal.capability)) {
        return {
            schemaVersion: 1,
            status: "action_request",
            needsClarification: false,
            clarificationQuestion: null,
            unsupportedCapabilities: [],
            routes: [],
            actionRequests: [{
                capability: proposal.capability,
                confidence: normalizeConfidence(proposal.confidence),
                slots: structuredClone(proposal.slots || {}),
                requiresConfirmation: true,
                executable: false,
            }],
        };
    }

    const capability = getTeacherQuestionCapability(proposal.capability);
    if (!capability) {
        return {
            schemaVersion: 1,
            status: "unsupported",
            needsClarification: false,
            clarificationQuestion: null,
            unsupportedCapabilities: proposal.capability ? [proposal.capability] : [],
            actionRequests: [],
            routes: [],
        };
    }

    const slots = {
        ...structuredClone(capability.defaults),
        ...structuredClone(proposal.slots || {}),
    };
    const subjects = Array.isArray(proposal.subjects) ?
        structuredClone(proposal.subjects) : [];
    if (!hasSlotValue(slots.student) && hasSlotValue(context.selectedStudent?.id)) {
        slots.student = context.selectedStudent.id;
        subjects.push({
            type: "student",
            id: context.selectedStudent.id,
            label: context.selectedStudent.label || null,
            source: "selected_context",
        });
    }
    if (!hasSlotValue(slots.answerId) && hasSlotValue(context.previousAnswerId)) {
        slots.answerId = context.previousAnswerId;
    }
    if (!hasSlotValue(slots.payrollPeriod) &&
        hasSlotValue(context.selectedPayrollPeriod)) {
        slots.payrollPeriod = context.selectedPayrollPeriod;
    }
    if (!hasSlotValue(slots.evidenceTarget) &&
        hasSlotValue(context.selectedEvidenceTarget)) {
        slots.evidenceTarget = context.selectedEvidenceTarget;
    }
    const missingSlots = capability.requiredSlots.filter(
        (slot) => !hasSlotValue(slots[slot]),
    );
    const ambiguities = Array.isArray(proposal.ambiguities) ?
        structuredClone(proposal.ambiguities) : [];
    const confidence = normalizeConfidence(proposal.confidence);
    const lowConfidence = confidence < 0.7;
    let clarificationQuestion = null;
    if (missingSlots.length > 0) {
        clarificationQuestion = capability.clarificationBySlot[missingSlots[0]] ||
            "질문을 처리하려면 대상을 조금 더 구체적으로 알려주세요.";
    } else if (ambiguities.length > 0) {
        clarificationQuestion = ambiguities[0].question ||
            "질문의 대상을 조금 더 구체적으로 알려주세요.";
    } else if (lowConfidence) {
        clarificationQuestion =
            "질문의 의미가 확실하지 않습니다. 확인하려는 내용을 조금 더 구체적으로 알려주세요.";
    }
    const needsClarification = missingSlots.length > 0 ||
        ambiguities.length > 0 || lowConfidence;

    return {
        schemaVersion: 1,
        status: needsClarification ? "needs_clarification" : "ready",
        needsClarification,
        clarificationQuestion,
        unsupportedCapabilities: [],
        actionRequests: [],
        routes: [{
            questionId: capability.id,
            capability: capability.key,
            type: capability.type,
            readOnly: capability.readOnly,
            confidence,
            subjects,
            slots,
            missingSlots,
            ambiguities,
            outputMode: proposal.outputMode || "answer",
            evidenceBudget: structuredClone(capability.evidenceBudget),
        }],
    };
};

const normalizeTeacherQuestionRoute = (proposal = {}, context = {}) => {
    if (!Array.isArray(proposal.intents)) {
        return normalizeSingleTeacherQuestionRoute(proposal, context);
    }

    const results = proposal.intents.map(
        (intent) => normalizeSingleTeacherQuestionRoute(intent, context),
    );
    const routes = results.flatMap((result) => result.routes);
    const actionRequests = results.flatMap((result) => result.actionRequests);
    const unsupportedCapabilities = results.flatMap(
        (result) => result.unsupportedCapabilities,
    );
    const clarificationResult = results.find((result) => result.needsClarification);
    const needsClarification = Boolean(clarificationResult);
    let status = "unsupported";
    if (needsClarification) status = "needs_clarification";
    else if (routes.length > 0 && actionRequests.length > 0) status = "mixed";
    else if (routes.length > 0) status = unsupportedCapabilities.length > 0 ? "partial" : "ready";
    else if (actionRequests.length > 0) status = "action_request";

    return {
        schemaVersion: 1,
        status,
        needsClarification,
        clarificationQuestion: clarificationResult?.clarificationQuestion || null,
        unsupportedCapabilities,
        actionRequests,
        routes,
    };
};

const buildTeacherAnswerEnvelope = (answer = {}) => {
    for (const field of ["answerId", "conclusion", "asOf"]) {
        if (!hasSlotValue(answer[field])) {
            throw new TypeError(`Missing required answer field: ${field}`);
        }
    }
    const capability = getTeacherQuestionCapability(answer.capability);
    const copyArray = (value) => Array.isArray(value) ? structuredClone(value) : [];

    if (!capability) {
        throw new TypeError(
            `Unsupported teacher question capability: ${answer.capability}`,
        );
    }
    const facts = copyArray(answer.facts);
    const calculations = copyArray(answer.calculations);
    const interpretations = copyArray(answer.interpretations);
    const evidence = copyArray(answer.evidence);
    const evidenceIds = new Set(evidence.map(({ id }) => id));
    for (const claim of [...facts, ...calculations, ...interpretations]) {
        for (const evidenceId of claim.evidenceIds || []) {
            if (!evidenceIds.has(evidenceId)) {
                throw new TypeError(`Unknown evidence reference: ${evidenceId}`);
            }
        }
    }

    return {
        schemaVersion: 1,
        answerId: answer.answerId,
        questionId: capability.id,
        capability: capability.key,
        readOnly: true,
        conclusion: answer.conclusion,
        facts,
        calculations,
        interpretations,
        unknowns: copyArray(answer.unknowns),
        evidence,
        asOf: answer.asOf,
        warnings: copyArray(answer.warnings),
        confidence: structuredClone(answer.confidence || {
            level: "low",
            score: 0,
            reasons: ["신뢰도 정보가 제공되지 않았습니다."],
        }),
        nextActions: copyArray(answer.nextActions),
    };
};

module.exports = {
    buildTeacherAnswerEnvelope,
    getTeacherQuestionCapability,
    listTeacherActionRequestCapabilities,
    listTeacherQuestionCapabilities,
    normalizeTeacherQuestionRoute,
};
