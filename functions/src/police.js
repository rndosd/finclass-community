"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
    onDocumentCreated,
    onDocumentWritten,
} = require("firebase-functions/v2/firestore");
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ✅ 유틸리티 임포트
const { stageActivityLog, stageCreditLog } = require("../utils/logUtils");
const { stageTaxIncome } = require("../utils/taxIncome");
const { stageTaxExpense } = require("../utils/taxExpense");
const {
    stageActivityTaxCancellation,
    stageIncomeCancellationAsExpense,
    stageExpenseCancellationAsIncome,
    stageTaxPostingLink,
} = require("../utils/taxReversal");
const {
    stageNotification,
} = require("../utils/notificationUtils");
const {
    hasPermission,
    assertTeacherOrAdminFromClaims,
} = require("../utils/permissions");
const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { getPoliceTreasuryPolicy, getWithholdingPolicy } = require("../utils/taxPolicy");
const { buildIncomeTaxSnapshot } = require("../utils/incomeTaxUtils");
const {
    hasPoliceRuleCatalogContributionChanged,
} = require("../utils/summaryProjectionGuards");

const now = () => FieldValue.serverTimestamp();
const ANALYTICS_VERSION = 1;
const TAX_LINE_COLLECTION = "lines";
const MAX_RULE_REPEAT_COUNT = 1000;
const POLICE_RULE_CATALOG_SUMMARY_VERSION = 1;
const POLICE_RULE_CATALOG_DOC_PATH = (classId) =>
    `classes/${classId}/dashboardSummary/policeRuleCatalog`;
const REPORT_TYPE_RULE = "rule";
const REPORT_TYPE_FREEFORM = "freeform";
const FREEFORM_REPORT_RULE_TEXT = "\uc790\uc720 \uc2e0\uace0";
const CUSTOM_REPORT_FINE_RULE_TEXT = "\uc784\uc758\ubd80\uacfc";

const toSafeId = (value, fallback = "na") => {
    const normalized = String(value ?? "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized || fallback;
};

const resolveAggregateBatchKey = (data, fallbackSeed) =>
    toSafeId(
        data?.aggregateBatchKey ||
            data?.requestId ||
            fallbackSeed ||
            db.collection("_").doc().id,
    );

const isPoliceFineTreasuryEnabled = (globalConfig, planType, classData = {}) =>
    canUseFeature(globalConfig, planType, "police", "enableTax") &&
    getPoliceTreasuryPolicy(classData).fineEnabled !== false;

const isPoliceRewardTreasuryEnabled = (globalConfig, planType, classData = {}) =>
    canUseFeature(globalConfig, planType, "police", "enableTax") &&
    getPoliceTreasuryPolicy(classData).rewardExpenseEnabled !== false;

const buildTaxRecordPointer = (collection, id, lineId) => ({
    collection,
    id,
    lineCollection: TAX_LINE_COLLECTION,
    lineId,
    detailStorage: "inline",
    aggregated: true,
});

const buildPoliceRewardIncomeTax = (classData = {}, grossAmount = 0) =>
    buildIncomeTaxSnapshot({
        sourceKey: "policeReward",
        grossAmount,
        policy: getWithholdingPolicy(classData, "policeReward") || {},
    });

const normalizeDangerLevel = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const normalized = Math.round(n);
    if (normalized < 1 || normalized > 3) return null;
    return normalized;
};

const resolvePoliceReportType = (report = {}) => {
    const rawType = typeof report?.reportType === "string" ?
        report.reportType.trim() :
        "";
    if (rawType) return rawType;
    return report?.ruleId ? REPORT_TYPE_RULE : REPORT_TYPE_FREEFORM;
};

const resolvePoliceRuleType = ({
    fineAmount = 0,
    creditChange = 0,
    missionTokenChange = 0,
} = {}) => {
    if (fineAmount > 0 || creditChange > 0 || missionTokenChange > 0) {
        return "reward";
    }
    if (fineAmount < 0 || creditChange < 0 || missionTokenChange < 0) {
        return "penalty";
    }
    return "penalty";
};

const stageMissionTokenLog = (
    tx,
    classId,
    {
        studentUid,
        delta = 0,
        category,
        description,
        relatedDoc,
        source,
        quantityApplied,
        unitAmount,
        unitCreditChange,
        unitMissionTokenChange,
    } = {},
    context = {},
) => {
    const missionTokenDelta = Number(delta || 0);
    if (!missionTokenDelta) return null;

    return stageActivityLog(tx, classId, {
        studentUid,
        type: missionTokenDelta > 0 ? "income" : "expense",
        category,
        amount: Math.abs(missionTokenDelta),
        description,
        relatedDoc,
        currency: "mission_token",
        assetType: "missionToken",
        missionTokenDelta,
        source,
        quantityApplied,
        unitAmount,
        unitCreditChange,
        unitMissionTokenChange,
    }, context);
};

const buildPoliceRuleCatalogEntry = (ruleDoc, fallbackOrder = 0) => {
    const data = typeof ruleDoc?.data === "function" ?
        (ruleDoc.data() || {}) :
        (ruleDoc || {});
    const fineAmount = Number(data?.fineAmount || 0);
    const creditChange = Number(data?.creditChange || 0);
    const missionTokenChange = Number(data?.missionTokenChange || 0);
    const rawOrder = Number(data?.order);
    const derivedType = resolvePoliceRuleType({
        fineAmount,
        creditChange,
        missionTokenChange,
    });

    return {
        id: String(ruleDoc?.id || data?.id || "").trim(),
        text: String(data?.text || "").trim(),
        notes: typeof data?.notes === "string" ? data.notes : "",
        fineAmount,
        creditChange,
        missionTokenChange,
        missionTokenEnabled:
            data?.missionTokenEnabled === true || missionTokenChange !== 0,
        order: Number.isFinite(rawOrder) ? rawOrder : fallbackOrder,
        dangerLevel: normalizeDangerLevel(data?.dangerLevel) || 1,
        type: derivedType,
        sensitive: data?.sensitive === true,
    };
};

async function recomputePoliceRuleCatalogSummary(classId) {
    if (!classId) return;

    const rulesSnap = await db
        .collection(`classes/${classId}/policeRules`)
        .orderBy("order")
        .get();

    const rules = rulesSnap.docs
        .map((ruleDoc, index) => buildPoliceRuleCatalogEntry(ruleDoc, index + 1))
        .filter((rule) => Boolean(rule.id));

    await db.doc(POLICE_RULE_CATALOG_DOC_PATH(classId)).set(
        {
            summaryVersion: POLICE_RULE_CATALOG_SUMMARY_VERSION,
            ruleCount: rules.length,
            rules,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
}

async function patchPoliceRuleCatalogSummary(classId, ruleId, afterSnapshot) {
    const summaryRef = db.doc(POLICE_RULE_CATALOG_DOC_PATH(classId));
    let needsRebuild = false;

    await db.runTransaction(async (transaction) => {
        needsRebuild = false;
        const summarySnap = await transaction.get(summaryRef);
        const summary = summarySnap.exists ? summarySnap.data() || {} : null;
        if (
            !summary ||
            Number(summary.summaryVersion) !== POLICE_RULE_CATALOG_SUMMARY_VERSION ||
            !Array.isArray(summary.rules)
        ) {
            needsRebuild = true;
            return;
        }

        const existingRule = summary.rules.find(
            (rule) => String(rule?.id || "") === ruleId,
        );
        const rules = summary.rules.filter(
            (rule) => String(rule?.id || "") !== ruleId,
        );
        if (afterSnapshot?.exists) {
            rules.push(buildPoliceRuleCatalogEntry(
                afterSnapshot,
                Number(existingRule?.order) || rules.length + 1,
            ));
        }
        rules.sort((left, right) => {
            const orderDelta = Number(left?.order || 0) - Number(right?.order || 0);
            if (orderDelta !== 0) return orderDelta;
            return String(left?.text || "").localeCompare(
                String(right?.text || ""),
                "ko",
            );
        });

        transaction.set(
            summaryRef,
            {
                summaryVersion: POLICE_RULE_CATALOG_SUMMARY_VERSION,
                ruleCount: rules.length,
                rules,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    });

    if (needsRebuild) {
        await recomputePoliceRuleCatalogSummary(classId);
    }
}

const normalizeAppliedQuantity = (value) => {
    if (value === undefined || value === null || value === "") return 1;
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) {
        throw new HttpsError(
            "invalid-argument",
            "반복 횟수는 1 이상의 정수여야 합니다.",
        );
    }
    if (n > MAX_RULE_REPEAT_COUNT) {
        throw new HttpsError(
            "invalid-argument",
            `반복 횟수는 최대 ${MAX_RULE_REPEAT_COUNT}회까지만 적용할 수 있습니다.`,
        );
    }
    return n;
};

const normalizeAdjustmentPercent = (value, fieldName = "percent") => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        throw new HttpsError(
            "invalid-argument",
            `${fieldName} must be a valid number.`,
        );
    }

    if (n < 0 || n > 100) {
        throw new HttpsError(
            "invalid-argument",
            `${fieldName} must be between 0 and 100.`,
        );
    }

    return Math.round(n);
};

const getBaseSignedValue = (currentValue, originalValue) => {
    const normalizedOriginal = Number(originalValue);
    if (Number.isFinite(normalizedOriginal)) {
        return normalizedOriginal;
    }
    return Number(currentValue) || 0;
};

const getAdjustedSignedValue = (baseSignedValue, percent) => {
    const normalizedBase = Number(baseSignedValue) || 0;
    if (normalizedBase === 0) return 0;

    const magnitude = Math.round(Math.abs(normalizedBase) * percent / 100);
    return Math.sign(normalizedBase) * magnitude;
};

const buildHistoryAnalyticsFields = ({
    sourceType = "manual",
    eventType = "unknown",
    reportOutcome = null,
    dangerLevel = null,
} = {}) => ({
    sourceType,
    eventType,
    reportOutcome,
    dangerLevel: normalizeDangerLevel(dangerLevel),
    analyticsVersion: ANALYTICS_VERSION,
});

const buildEmptyReflectionSummaryFields = () => ({
    hasReflection: false,
    reflectionStatus: "none",
    reflectionUpdatedAt: null,
    reflectionSubmittedAt: null,
    reflectionReviewedAt: null,
    submissionType: null,
    reviewOutcome: null,
});

const buildReflectionSummaryFields = ({
    hasReflection = true,
    reflectionStatus = "none",
    reflectionUpdatedAt = null,
    reflectionSubmittedAt = null,
    reflectionReviewedAt = null,
    submissionType = null,
    reviewOutcome = null,
} = {}) => ({
    hasReflection,
    reflectionStatus,
    reflectionUpdatedAt,
    reflectionSubmittedAt,
    reflectionReviewedAt,
    submissionType,
    reviewOutcome,
});

/* ──────────────────────────────────────────────────────────────
 * 0) 헬퍼 함수
 * ────────────────────────────────────────────────────────────── */

const resolveTeacherActorName = async (classId, fallbackName = "") => {
    const normalizedFallback = String(fallbackName ?? "").trim();

    try {
        const classSnap = await db.doc(`classes/${classId}`).get();
        if (classSnap.exists) {
            const classData = classSnap.data() || {};
            const configuredName = String(
                classData.teacherDisplayName || classData.teacherName || "",
            ).trim();
            if (configuredName) return configuredName;
        }
    } catch (error) {
        console.error("[police] failed to resolve teacher actor name:", error);
    }

    return normalizedFallback || "선생님";
};

const verifyPolicePermission = async (request) => {
    if (!request.auth)
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const { uid, token } = request.auth;
    const { classId, role, name } = token || {};
    if (!classId)
        throw new HttpsError("failed-precondition", "학급 정보가 필요합니다.");

    if (role === "admin" || role === "teacher") {
        const actorName = await resolveTeacherActorName(
            classId,
            name || (role === "admin" ? "관리자" : "선생님"),
        );
        return { classId, actorUid: uid, actorName, role };
    }
    const ok = await hasPermission(uid, classId, "permission_group_police");
    if (!ok) throw new HttpsError("permission-denied", "경찰 권한이 없습니다.");

    return {
        classId,
        actorUid: uid,
        actorName: name || `학생경찰`,
        role: "student",
    };
};

const getAnonymizeSetting = async (classId) => {
    try {
        const snap = await db.doc(`classes/${classId}/settings/privacy`).get();
        return snap.exists ? !!snap.data().anonymizeFineIncome : true;
    } catch {
        return true;
    }
};

exports.notifyPoliceReportCreated = onDocumentCreated(
    {
        document: "classes/{classId}/policeReports/{reportId}",
        region: "asia-northeast3",
    },
    async () => {
        // New police reports are already surfaced by the police action badge.
        // Keep this trigger as a no-op to avoid duplicate dropdown inbox items.
        return null;
    },
);

/** 신고 일괄 처리(처벌/무시)를 서버 트랜잭션으로 원자 처리 */
exports.syncPoliceRuleCatalogSummary = onDocumentWritten(
    {
        document: "classes/{classId}/policeRules/{ruleId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId, ruleId } = event.params;
        if (!classId || !ruleId) return;

        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;
        if (!hasPoliceRuleCatalogContributionChanged(beforeData, afterData)) return;

        await patchPoliceRuleCatalogSummary(classId, ruleId, event.data?.after);
    },
);

exports.rebuildPoliceRuleCatalogSummary = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const requestedClassId = String(request.data?.classId || "").trim();
        const fallbackClassId = String(request.auth?.token?.classId || "").trim();
        const classId = requestedClassId || fallbackClassId;

        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        assertTeacherOrAdminFromClaims(request, { classId });
        await recomputePoliceRuleCatalogSummary(classId);

        return {
            success: true,
            classId,
            summaryPath: POLICE_RULE_CATALOG_DOC_PATH(classId),
        };
    },
);

exports.resolvePoliceReports = onCall({ region: "asia-northeast3" }, async (request) => {
    const { classId, actorUid, actorName } = await verifyPolicePermission(request);
    const { reportIds, decision = "applied" } = request.data || {};
    const rejectReason = String(
        request.data?.rejectReason ||
        request.data?.rejectionReason ||
        request.data?.resolutionReason ||
        "",
    ).trim();
    const rawRejectReasonByReportId =
        request.data?.rejectReasonByReportId &&
        typeof request.data.rejectReasonByReportId === "object"
            ? request.data.rejectReasonByReportId
            : {};
    const rejectReasonByReportId = {};
    Object.entries(rawRejectReasonByReportId).forEach(([rawId, rawReason]) => {
        const reportId = String(rawId || "").trim();
        const reason = String(rawReason || "").trim();
        if (reportId) rejectReasonByReportId[reportId] = reason;
    });

    if (!Array.isArray(reportIds) || reportIds.length === 0) {
        return { success: false, message: "처리할 신고가 없습니다." };
    }
    if (!["applied", "ignored"].includes(decision)) {
        throw new HttpsError("invalid-argument", "decision은 applied 또는 ignored만 허용됩니다.");
    }
    if (rejectReason.length > 500) {
        throw new HttpsError("invalid-argument", "반려 사유는 500자 이하로 입력해 주세요.");
    }
    if (Object.values(rejectReasonByReportId).some((reason) => reason.length > 500)) {
        throw new HttpsError("invalid-argument", "반려 사유는 500자 이하로 입력해 주세요.");
    }

    const uniqueReportIds = [...new Set(
        reportIds.map((id) => String(id || "").trim()).filter(Boolean),
    )];
    if (uniqueReportIds.length === 0) {
        throw new HttpsError("invalid-argument", "유효한 신고 ID가 없습니다.");
    }

    const globalConfig = await getGlobalConfig();
    const anonymize = await getAnonymizeSetting(classId);
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `resolve_${actorUid}_${Date.now()}`,
    );

    return await db.runTransaction(async (tx) => {
        const classRef = db.doc(`classes/${classId}`);
        const classSnap = await tx.get(classRef);
        const classData = classSnap.data() || {};
        const planType = classData.planType || "FREE";
        const currencyUnit = classData.currencyUnit || "캐시";
        const context = { config: globalConfig, planType, serviceName: "police" };
        const isTaxEnabled = isPoliceFineTreasuryEnabled(
            globalConfig,
            planType,
            classData,
        );
        const aggregateFineTaxId = `police_fine_${batchKey}`;
        const fineTaxLines = [];
        let fineTaxTotal = 0;

        const reportRefs = uniqueReportIds.map((id) =>
            db.doc(`classes/${classId}/policeReports/${id}`),
        );
        const reportSnaps = await tx.getAll(...reportRefs);

        const pendingReports = [];
        const skipped = [];
        const ruleIdSet = new Set();
        const studentUidSet = new Set();

        reportSnaps.forEach((snap, idx) => {
            const reportId = uniqueReportIds[idx];
            if (!snap.exists) {
                skipped.push({ reportId, reason: "missing_report" });
                return;
            }
            const report = snap.data() || {};
            if (report.status !== "pending") {
                skipped.push({ reportId, reason: "already_resolved" });
                return;
            }
            pendingReports.push({ reportId, ref: snap.ref, data: report });
            if (report.ruleId) ruleIdSet.add(String(report.ruleId));
            if (report.accusedStudentUid) studentUidSet.add(String(report.accusedStudentUid));
        });

        if (pendingReports.length === 0) {
            return {
                success: true,
                decision,
                requestedCount: uniqueReportIds.length,
                processedCount: 0,
                appliedCount: 0,
                ignoredCount: 0,
                skippedCount: skipped.length,
                skipped,
            };
        }

        const ruleRefs = [...ruleIdSet].map((ruleId) =>
            db.doc(`classes/${classId}/policeRules/${ruleId}`),
        );
        const studentRefs = [...studentUidSet].map((uid) =>
            db.doc(`classes/${classId}/students/${uid}`),
        );
        const historyRefs = pendingReports.map(({ reportId }) =>
            db.doc(`classes/${classId}/policeFineHistory/${reportId}`),
        );

        const [ruleSnaps, studentSnaps, historySnaps] = await Promise.all([
            ruleRefs.length ? tx.getAll(...ruleRefs) : Promise.resolve([]),
            studentRefs.length ? tx.getAll(...studentRefs) : Promise.resolve([]),
            historyRefs.length ? tx.getAll(...historyRefs) : Promise.resolve([]),
        ]);

        const ruleMap = new Map(
            ruleSnaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data() || {}]),
        );
        const studentMap = new Map(
            studentSnaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap]),
        );
        const historyMap = new Map(historySnaps.map((snap) => [snap.id, snap]));

        let processedCount = 0;
        let appliedCount = 0;
        let ignoredCount = 0;

        for (const entry of pendingReports) {
            const { reportId, ref: reportRef, data: report } = entry;
            const reportRejectReason =
                String(rejectReasonByReportId[reportId] || rejectReason || "").trim();
            const reportType = resolvePoliceReportType(report);
            const existingHistorySnap = historyMap.get(reportId);
            if (existingHistorySnap?.exists) {
                const existingData = existingHistorySnap.data() || {};
                const fallbackStatus = decision === "applied" ? "resolved_applied" : "resolved_ignored";
                const resolvedStatus =
                    existingData.reportOutcome === "ignored"
                        ? "resolved_ignored"
                        : existingData.reportOutcome === "applied"
                            ? "resolved_applied"
                            : fallbackStatus;
                const actionTaken = resolvedStatus === "resolved_applied" ? "fined" : "ignored";
                const resolvedRejectReason =
                    String(existingData.rejectReason || reportRejectReason || "").trim();

                tx.update(reportRef, {
                    status: resolvedStatus,
                    resolvedAt: existingData.appliedAt || now(),
                    resolverUid: existingData.actorUid || actorUid,
                    resolverName: existingData.actorName || actorName,
                    actionTaken,
                    ...(resolvedStatus === "resolved_ignored" && resolvedRejectReason
                        ? { rejectReason: resolvedRejectReason }
                        : {}),
                });

                processedCount += 1;
                if (resolvedStatus === "resolved_applied") appliedCount += 1;
                else ignoredCount += 1;
                continue;
            }

            if (decision === "applied" && reportType === REPORT_TYPE_FREEFORM) {
                skipped.push({ reportId, reason: "freeform_requires_custom_fine" });
                continue;
            }

            const studentUid = String(report.accusedStudentUid || "");
            const studentSnap = studentMap.get(studentUid);
            if (!studentSnap?.exists) {
                tx.update(reportRef, {
                    status: "resolved_ignored",
                    resolvedAt: now(),
                    resolverUid: actorUid,
                    resolverName: actorName,
                    actionTaken: "ignored",
                    ...(decision === "ignored" && reportRejectReason ? { rejectReason: reportRejectReason } : {}),
                });
                skipped.push({ reportId, reason: "student_not_found_auto_ignored" });
                processedCount += 1;
                ignoredCount += 1;
                continue;
            }

            const studentData = studentSnap.data() || {};
            const ruleData = ruleMap.get(String(report.ruleId || "")) || {};
            const ruleText = report.ruleText || ruleData.text || "규칙 위반";
            const dangerLevel = normalizeDangerLevel(ruleData.dangerLevel);
            const quantityApplied = normalizeAppliedQuantity(report.repeatCount);
            const unitAmount = Math.abs(Number(ruleData.fineAmount || 0));
            const unitCreditChange = Number(ruleData.creditChange || 0);
            const unitMissionTokenChange = Number(ruleData.missionTokenChange || 0);

            if (decision === "applied") {
                const dec = unitAmount * quantityApplied;
                const creditChange = unitCreditChange * quantityApplied;
                const missionTokenChange =
                    unitMissionTokenChange * quantityApplied;

                if (dec <= 0 && creditChange === 0 && missionTokenChange === 0) {
                    tx.update(reportRef, {
                        status: "resolved_ignored",
                        resolvedAt: now(),
                        resolverUid: actorUid,
                        resolverName: actorName,
                        actionTaken: "ignored",
                    });
                    skipped.push({ reportId, reason: "no_penalty_rule_auto_ignored" });
                    processedCount += 1;
                    ignoredCount += 1;
                    continue;
                }

                const studentUpdate = { lastUpdated: now() };
                if (dec > 0) studentUpdate["assets.cash"] = FieldValue.increment(-dec);
                if (creditChange !== 0) studentUpdate["creditScore"] = FieldValue.increment(creditChange);
                if (missionTokenChange !== 0) {
                    studentUpdate["assets.missionToken"] =
                        FieldValue.increment(missionTokenChange);
                }
                tx.update(studentSnap.ref, studentUpdate);

                if (creditChange !== 0) {
                    stageCreditLog(tx, classId, {
                        studentUid,
                        delta: creditChange,
                        source: "police_fine",
                        issuedByUid: actorUid,
                        reason: report.reason || ruleText || "police fine",
                        relatedDoc: { collection: "policeFineHistory", id: reportId },
                        quantityApplied,
                        unitAmount,
                        unitCreditChange,
                    }, context);
                }

                if (dec > 0) {
                    stageActivityLog(tx, classId, {
                        studentUid,
                        type: "expense",
                        category: "fine",
                        amount: dec,
                        description: ruleText || "벌금 부과",
                        taxEvent: isTaxEnabled ? {
                            sourceKey: "policeFine",
                            taxCategory: "fine",
                            taxType: "police_fine",
                            amount: dec,
                        } : null,
                        relatedDoc: { collection: "policeFineHistory", id: reportId },
                        quantityApplied,
                        unitAmount,
                        unitCreditChange,
                    }, context);

                    if (isTaxEnabled) {
                        fineTaxTotal += dec;
                        fineTaxLines.push({
                            id: reportId,
                            amount: dec,
                            source: "police_fine",
                            taxType: "police_fine",
                            description: anonymize
                                ? "경찰 벌금"
                                : `벌금 - ${studentData.name}`,
                            studentUid,
                            studentName: studentData.name || null,
                            relatedDoc: { collection: "policeFineHistory", id: reportId },
                            externalId: reportId,
                            meta: {
                                ruleId: report.ruleId || "custom",
                                reportId,
                                sourceType: "report",
                                quantityApplied,
                                unitAmount,
                            },
                        });
                    }
                }

                if (missionTokenChange !== 0) {
                    stageMissionTokenLog(tx, classId, {
                        studentUid,
                        delta: missionTokenChange,
                        category:
                            missionTokenChange > 0 ? "reward" : "fine",
                        description: ruleText || "벌금 부과",
                        relatedDoc: {
                            collection: "policeFineHistory",
                            id: reportId,
                        },
                        source: "police_fine",
                        quantityApplied,
                        unitAmount,
                        unitCreditChange,
                        unitMissionTokenChange,
                    }, context);
                }

                tx.set(db.doc(`classes/${classId}/policeFineHistory/${reportId}`), {
                    id: reportId,
                    studentUid,
                    studentName: studentData.name,
                    type: "fine",
                    amountSigned: -dec,
                    creditChangeApplied: creditChange,
                    missionTokenChangeApplied: missionTokenChange,
                    originalAmountSigned: -dec,
                    originalCreditChangeApplied: creditChange,
                    originalMissionTokenChangeApplied: missionTokenChange,
                    adjustmentFinePercent: 100,
                    adjustmentCreditPercent: 100,
                    adjustmentMissionTokenPercent: 100,
                    quantityApplied,
                    unitAmount,
                    unitCreditChange,
                    unitMissionTokenChange,
                    ruleId: report.ruleId || "custom",
                    ruleText,
                    reason: report.reason || "",
                    actorUid,
                    actorName,
                    reporterName: report.reporterName || null,
                    reporterUid: report.reporterUid || null,
                    reportReason: report.reason || null,
                    reportId,
                    isSensitive: !!report.isSensitive,
                    appliedAt: now(),
                    status: "applied",
                    ...buildEmptyReflectionSummaryFields(),
                    ...(dec > 0 && isTaxEnabled
                        ? {
                            taxRecord: buildTaxRecordPointer(
                                "taxIncomes",
                                aggregateFineTaxId,
                                reportId,
                            ),
                            taxRecordedAt: now(),
                            taxCancelled: false,
                        }
                        : {}),
                    ...buildHistoryAnalyticsFields({
                        sourceType: "report",
                        eventType: "fine_applied",
                        reportOutcome: "applied",
                        dangerLevel,
                    }),
                }, { merge: true });

                tx.update(reportRef, {
                    status: "resolved_applied",
                    resolvedAt: now(),
                    resolverUid: actorUid,
                    resolverName: actorName,
                    actionTaken: "fined",
                });

                if (dec > 0) {
                    stageNotification(tx, classId, {
                        uid: studentUid,
                        title: "벌금 부과 안내",
                        message: `'${ruleText}' 사유로 ${dec.toLocaleString("ko-KR")}${currencyUnit} 벌금이 부과되었습니다.`,
                        type: "police_penalty_applied",
                        path: "/police",
                        priority: "high",
                        metadata: {
                            relatedDocId: reportId,
                            ruleId: report.ruleId || "custom",
                            ruleText,
                            amount: dec,
                            quantityApplied,
                            unitAmount,
                        },
                    });
                }

                processedCount += 1;
                appliedCount += 1;
            } else {
                tx.set(db.doc(`classes/${classId}/policeFineHistory/${reportId}`), {
                    id: reportId,
                    studentUid,
                    studentName: studentData.name,
                    type: "report",
                    amountSigned: 0,
                    creditChangeApplied: 0,
                    missionTokenChangeApplied: 0,
                    quantityApplied,
                    unitAmount,
                    unitCreditChange,
                    unitMissionTokenChange,
                    ruleId: report.ruleId || "custom",
                    ruleText,
                    reason: report.reason || "",
                    actorUid,
                    actorName,
                    reporterName: report.reporterName || null,
                    reporterUid: report.reporterUid || null,
                    reportReason: report.reason || null,
                    rejectReason: reportRejectReason || null,
                    reportId,
                    isSensitive: !!report.isSensitive,
                    appliedAt: now(),
                    status: "resolved_ignored",
                    ...buildEmptyReflectionSummaryFields(),
                    ...buildHistoryAnalyticsFields({
                        sourceType: "report",
                        eventType: "report_ignored",
                        reportOutcome: "ignored",
                        dangerLevel,
                    }),
                }, { merge: true });

                tx.update(reportRef, {
                    status: "resolved_ignored",
                    resolvedAt: now(),
                    resolverUid: actorUid,
                    resolverName: actorName,
                    actionTaken: "ignored",
                    ...(reportRejectReason ? { rejectReason: reportRejectReason } : {}),
                });

                processedCount += 1;
                ignoredCount += 1;
            }
        }

        if (decision === "applied" && isTaxEnabled && fineTaxTotal > 0) {
            stageTaxIncome(
                tx,
                classId,
                {
                    amount: fineTaxTotal,
                    source: "police_fine",
                    taxType: "police_fine",
                    description: `경찰 벌금 일괄 기록 (${fineTaxLines.length}건)`,
                },
                actorUid,
                {
                    ...context,
                    classData,
                    sourceKey: "policeFine",
                    customId: aggregateFineTaxId,
                    aggregateMeta: {
                        group: "police_fine",
                        batchKey,
                        pageKey: "police",
                        actorUid,
                        actorName,
                        mode: "resolve_reports",
                    },
                    detailLines: fineTaxLines,
                    detailCollection: TAX_LINE_COLLECTION,
                },
            );
        }

        return {
            success: true,
            decision,
            requestedCount: uniqueReportIds.length,
            processedCount,
            appliedCount,
            ignoredCount,
            skippedCount: skipped.length,
            skipped,
            taxAggregateId:
                decision === "applied" && fineTaxTotal > 0
                    ? aggregateFineTaxId
                    : null,
        };
    });
});

/** 1. 규칙 기반 다중 벌금 부과 (신고 처리 및 일반 규칙 적용) */
exports.applyMultipleFinesLegacy = onCall({ region: "asia-northeast3" }, async (request) => {
    const { classId, actorUid, actorName } = await verifyPolicePermission(request);
    const { fines } = request.data || {};
    if (!Array.isArray(fines) || fines.length === 0) return { success: false, message: "데이터가 없습니다." };

    const globalConfig = await getGlobalConfig();
    const anonymize = await getAnonymizeSetting(classId);
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `legacy_fines_${actorUid}_${Date.now()}`,
    );

    return await db.runTransaction(async (tx) => {
        const studentRefs = fines.map(f => db.doc(`classes/${classId}/students/${f.studentUid}`));
        const studentSnaps = await tx.getAll(...studentRefs);
        const classSnap = await tx.get(db.doc(`classes/${classId}`));

        const classData = classSnap.data() || {};
        const planType = classData.planType || "FREE";
        const currencyUnit = classData.currencyUnit || "캐시";
        const context = { config: globalConfig, planType, serviceName: "police" };
        const isTaxEnabled = isPoliceFineTreasuryEnabled(
            globalConfig,
            planType,
            classData,
        );
        const aggregateFineTaxId = `police_fine_${batchKey}`;
        const fineTaxLines = [];
        let fineTaxTotal = 0;

        for (let i = 0; i < fines.length; i++) {
            const fine = fines[i];
            const studentSnap = studentSnaps[i];
            if (!studentSnap.exists) continue;

            const quantityApplied = normalizeAppliedQuantity(
                fine.quantity ?? fine.repeatCount,
            );
            const unitAmount = Math.abs(Number(fine.amount || 0));
            const unitCreditChange = Number(fine.creditChange || 0);
            const unitMissionTokenChange = Number(fine.missionTokenChange || 0);
            const dec = unitAmount * quantityApplied;
            const creditChange = unitCreditChange * quantityApplied;
            const missionTokenChange = unitMissionTokenChange * quantityApplied;
            const docId = fine.relatedDocId || db.collection("_").doc().id;

            // 1. 학생 데이터 업데이트
            const studentUpdate = { lastUpdated: now() };
            if (dec > 0) studentUpdate["assets.cash"] = FieldValue.increment(-dec);
            if (creditChange !== 0) studentUpdate["creditScore"] = FieldValue.increment(creditChange);
            if (missionTokenChange !== 0) {
                studentUpdate["assets.missionToken"] =
                    FieldValue.increment(missionTokenChange);
            }
            tx.update(studentSnap.ref, studentUpdate);

            // 2. 로그 및 세금 처리
            if (dec > 0) {
                stageActivityLog(tx, classId, {
                    studentUid: fine.studentUid, type: "expense", category: "fine", amount: dec,
                    description: fine.ruleText || "벌금 부과", relatedDoc: { collection: "policeFineHistory", id: docId },
                    taxEvent: isTaxEnabled ? {
                        sourceKey: "policeFine",
                        taxCategory: "fine",
                        taxType: "police_fine",
                        amount: dec,
                    } : null,
                }, context);

                if (isTaxEnabled) {
                    fineTaxTotal += dec;
                    fineTaxLines.push({
                        id: docId,
                        amount: dec,
                        source: "police_fine",
                        taxType: "police_fine",
                        description: anonymize
                            ? "경찰 벌금"
                            : `벌금 - ${studentSnap.data().name}`,
                        studentUid: fine.studentUid,
                        studentName: studentSnap.data().name || null,
                        relatedDoc: { collection: "policeFineHistory", id: docId },
                        externalId: docId,
                        meta: {
                            ruleId: fine.ruleId || "custom",
                            sourceType: fine.sourceType || "manual",
                        },
                    });
                }
            }

            // 3. 경찰청 히스토리 기록 (🌟 reason 필드 추가됨)
            if (missionTokenChange !== 0) {
                stageMissionTokenLog(tx, classId, {
                    studentUid: fine.studentUid,
                    delta: missionTokenChange,
                    category:
                        missionTokenChange > 0 ? "reward" : "fine",
                    description: fine.ruleText || "벌금 부과",
                    relatedDoc: { collection: "policeFineHistory", id: docId },
                    source: "police_fine",
                    quantityApplied,
                    unitAmount,
                    unitCreditChange,
                    unitMissionTokenChange,
                }, context);
            }

            tx.set(db.doc(`classes/${classId}/policeFineHistory/${docId}`), {
                id: docId,
                studentUid: fine.studentUid,
                studentName: studentSnap.data().name,
                type: "fine",
                amountSigned: -dec,
                creditChangeApplied: creditChange,
                missionTokenChangeApplied: missionTokenChange,
                originalAmountSigned: -dec,
                originalCreditChangeApplied: creditChange,
                originalMissionTokenChangeApplied: missionTokenChange,
                adjustmentFinePercent: 100,
                adjustmentCreditPercent: 100,
                adjustmentMissionTokenPercent: 100,
                quantityApplied,
                unitAmount,
                unitCreditChange,
                unitMissionTokenChange,
                ruleId: fine.ruleId || "custom",
                ruleText: fine.ruleText || "벌금",

                // 🔥 [핵심 보정] 상세 사유 필드 추가
                reason: fine.reason || fine.description || "",

                actorUid: actorUid,
                actorName: actorName,
                reporterName: fine.reporterName || null,
                reporterUid: fine.reporterUid || null,
                reportReason: fine.reportReason || null,
                appliedAt: now(),
                status: "applied",
                ...buildEmptyReflectionSummaryFields(),
                ...(dec > 0 && isTaxEnabled
                    ? {
                        taxRecord: buildTaxRecordPointer(
                            "taxIncomes",
                            aggregateFineTaxId,
                            docId,
                        ),
                        taxRecordedAt: now(),
                        taxCancelled: false,
                    }
                    : {}),
            }, { merge: true });

            if (dec > 0) {
                const ruleText = fine.ruleText || "벌금";
                stageNotification(tx, classId, {
                    uid: fine.studentUid,
                    title: "벌금 부과 안내",
                    message: `'${ruleText}' 사유로 ${dec.toLocaleString("ko-KR")}${currencyUnit} 벌금이 부과되었습니다.`,
                    type: "police_penalty_applied",
                    path: "/police",
                    priority: "high",
                    metadata: {
                        relatedDocId: docId,
                        ruleId: fine.ruleId || "custom",
                        ruleText,
                        amount: dec,
                        quantityApplied,
                        unitAmount,
                    },
                });
            }
        }
        if (isTaxEnabled && fineTaxTotal > 0) {
            stageTaxIncome(
                tx,
                classId,
                {
                    amount: fineTaxTotal,
                    source: "police_fine",
                    taxType: "police_fine",
                    description: `경찰 벌금 일괄 기록 (${fineTaxLines.length}건)`,
                },
                actorUid,
                {
                    ...context,
                    customId: aggregateFineTaxId,
                    classData,
                    sourceKey: "policeFine",
                    aggregateMeta: {
                        group: "police_fine",
                        batchKey,
                        pageKey: "police",
                        actorUid,
                        actorName,
                        mode: "apply_fines_legacy",
                    },
                    detailLines: fineTaxLines,
                    detailCollection: TAX_LINE_COLLECTION,
                },
            );
        }
        return {
            success: true,
            taxAggregateId: fineTaxTotal > 0 ? aggregateFineTaxId : null,
        };
    });
});

/** 1. 규칙 기반 다중 벌금 부과 (신고 처리 및 일반 규칙 적용) */
exports.applyMultipleFines = onCall({ region: "asia-northeast3" }, async (request) => {
    const { classId, actorUid, actorName } = await verifyPolicePermission(request);
    const { fines } = request.data || {};
    if (!Array.isArray(fines) || fines.length === 0) return { success: false, message: "데이터가 없습니다." };

    const normalizedFines = fines.map((fine) => ({
        ...fine,
        __docId: fine.relatedDocId || db.collection("_").doc().id,
    }));

    const globalConfig = await getGlobalConfig();
    const anonymize = await getAnonymizeSetting(classId);
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `bulk_fines_${actorUid}_${Date.now()}`,
    );

    return await db.runTransaction(async (tx) => {
        const studentRefs = normalizedFines.map((fine) =>
            db.doc(`classes/${classId}/students/${fine.studentUid}`),
        );
        const historyRefs = normalizedFines.map((fine) =>
            db.doc(`classes/${classId}/policeFineHistory/${fine.__docId}`),
        );

        const [studentSnaps, historySnaps, classSnap] = await Promise.all([
            tx.getAll(...studentRefs),
            tx.getAll(...historyRefs),
            tx.get(db.doc(`classes/${classId}`)),
        ]);

        const classData = classSnap.data() || {};
        const planType = classData.planType || "FREE";
        const currencyUnit = classData.currencyUnit || "캐시";
        const context = { config: globalConfig, planType, serviceName: "police" };
        const isTaxEnabled = isPoliceFineTreasuryEnabled(
            globalConfig,
            planType,
            classData,
        );
        const aggregateFineTaxId = `police_fine_${batchKey}`;
        const fineTaxLines = [];
        let fineTaxTotal = 0;

        const historyMap = new Map(historySnaps.map((snap) => [snap.id, snap]));

        let appliedCount = 0;
        let skippedCount = 0;

        for (let i = 0; i < normalizedFines.length; i++) {
            const fine = normalizedFines[i];
            const studentSnap = studentSnaps[i];
            const docId = fine.__docId;
            if (!studentSnap.exists) continue;

            if (historyMap.get(docId)?.exists) {
                skippedCount += 1;
                continue;
            }

            const quantityApplied = normalizeAppliedQuantity(
                fine.quantity ?? fine.repeatCount,
            );
            const unitAmount = Math.abs(Number(fine.amount || 0));
            const unitCreditChange = Number(fine.creditChange || 0);
            const unitMissionTokenChange = Number(fine.missionTokenChange || 0);
            const dec = unitAmount * quantityApplied;
            const creditChange = unitCreditChange * quantityApplied;
            const missionTokenChange = unitMissionTokenChange * quantityApplied;
            const sourceType =
                fine.sourceType ||
                ((fine.reporterUid || fine.reporterName || fine.reportId) ? "report" : "manual");
            const reportOutcome = fine.reportOutcome || (sourceType === "report" ? "applied" : null);

            const studentUpdate = { lastUpdated: now() };
            if (dec > 0) studentUpdate["assets.cash"] = FieldValue.increment(-dec);
            if (creditChange !== 0) studentUpdate["creditScore"] = FieldValue.increment(creditChange);
            if (missionTokenChange !== 0) {
                studentUpdate["assets.missionToken"] =
                    FieldValue.increment(missionTokenChange);
            }
            tx.update(studentSnap.ref, studentUpdate);

            if (creditChange !== 0) {
                stageCreditLog(tx, classId, {
                    studentUid: fine.studentUid,
                    delta: creditChange,
                    source: "police_fine",
                    issuedByUid: actorUid,
                    reason: fine.reason || fine.description || fine.ruleText || "police fine",
                    relatedDoc: { collection: "policeFineHistory", id: docId },
                    quantityApplied,
                    unitAmount,
                    unitCreditChange,
                }, context);
            }

            if (dec > 0) {
                stageActivityLog(tx, classId, {
                    studentUid: fine.studentUid,
                    type: "expense",
                    category: "fine",
                    amount: dec,
                    description: fine.ruleText || "벌금 부과",
                    relatedDoc: { collection: "policeFineHistory", id: docId },
                    taxEvent: isTaxEnabled ? {
                        sourceKey: "policeFine",
                        taxCategory: "fine",
                        taxType: "police_fine",
                        amount: dec,
                    } : null,
                    quantityApplied,
                    unitAmount,
                    unitCreditChange,
                }, context);

                if (isTaxEnabled) {
                    fineTaxTotal += dec;
                    fineTaxLines.push({
                        id: docId,
                        amount: dec,
                        source: "police_fine",
                        taxType: "police_fine",
                        description: anonymize
                            ? "경찰 벌금"
                            : `벌금 - ${studentSnap.data().name}`,
                        studentUid: fine.studentUid,
                        studentName: studentSnap.data().name || null,
                        relatedDoc: { collection: "policeFineHistory", id: docId },
                        externalId: docId,
                        meta: {
                            sourceType,
                            reportId: fine.reportId || null,
                            ruleId: fine.ruleId || "custom",
                            reportOutcome,
                            quantityApplied,
                            unitAmount,
                        },
                    });
                }
            }

            if (missionTokenChange !== 0) {
                stageMissionTokenLog(tx, classId, {
                    studentUid: fine.studentUid,
                    delta: missionTokenChange,
                    category:
                        missionTokenChange > 0 ? "reward" : "fine",
                    description: fine.ruleText || "벌금 부과",
                    relatedDoc: { collection: "policeFineHistory", id: docId },
                    source:
                        missionTokenChange > 0 ?
                            "police_reward" :
                            "police_fine",
                    quantityApplied,
                    unitAmount,
                    unitCreditChange,
                    unitMissionTokenChange,
                }, context);
            }

            tx.set(db.doc(`classes/${classId}/policeFineHistory/${docId}`), {
                id: docId,
                studentUid: fine.studentUid,
                studentName: studentSnap.data().name,
                type: "fine",
                amountSigned: -dec,
                creditChangeApplied: creditChange,
                missionTokenChangeApplied: missionTokenChange,
                originalAmountSigned: -dec,
                originalCreditChangeApplied: creditChange,
                originalMissionTokenChangeApplied: missionTokenChange,
                adjustmentFinePercent: 100,
                adjustmentCreditPercent: 100,
                adjustmentMissionTokenPercent: 100,
                quantityApplied,
                unitAmount,
                unitCreditChange,
                unitMissionTokenChange,
                ruleId: fine.ruleId || "custom",
                ruleText: fine.ruleText || "벌금",
                reason: fine.reason || fine.description || "",
                actorUid,
                actorName,
                reporterName: fine.reporterName || null,
                reporterUid: fine.reporterUid || null,
                reportReason: fine.reportReason || null,
                reportId: fine.reportId || (sourceType === "report" ? docId : null),
                isSensitive: !!fine.isSensitive,
                appliedAt: now(),
                status: "applied",
                ...buildEmptyReflectionSummaryFields(),
                ...(dec > 0 && isTaxEnabled
                    ? {
                        taxRecord: buildTaxRecordPointer(
                            "taxIncomes",
                            aggregateFineTaxId,
                            docId,
                        ),
                        taxRecordedAt: now(),
                        taxCancelled: false,
                    }
                    : {}),
                ...buildHistoryAnalyticsFields({
                    sourceType,
                    eventType: "fine_applied",
                    reportOutcome,
                    dangerLevel: fine.dangerLevel,
                }),
            }, { merge: true });

            if (dec > 0) {
                const ruleText = fine.ruleText || "벌금";
                stageNotification(tx, classId, {
                    uid: fine.studentUid,
                    title: "벌금 부과 안내",
                    message: `'${ruleText}' 사유로 ${dec.toLocaleString("ko-KR")}${currencyUnit} 벌금이 부과되었습니다.`,
                    type: "police_penalty_applied",
                    path: "/police",
                    priority: "high",
                    metadata: {
                        relatedDocId: docId,
                        ruleId: fine.ruleId || "custom",
                        ruleText,
                        amount: dec,
                        quantityApplied,
                        unitAmount,
                    },
                });
            }

            appliedCount += 1;
        }

        if (isTaxEnabled && fineTaxTotal > 0) {
            stageTaxIncome(
                tx,
                classId,
                {
                    amount: fineTaxTotal,
                    source: "police_fine",
                    taxType: "police_fine",
                    description: `경찰 벌금 일괄 기록 (${fineTaxLines.length}건)`,
                },
                actorUid,
                {
                    ...context,
                    customId: aggregateFineTaxId,
                    classData,
                    sourceKey: "policeFine",
                    aggregateMeta: {
                        group: "police_fine",
                        batchKey,
                        pageKey: "police",
                        actorUid,
                        actorName,
                        mode: "apply_fines",
                    },
                    detailLines: fineTaxLines,
                    detailCollection: TAX_LINE_COLLECTION,
                },
            );
        }

        return {
            success: true,
            appliedCount,
            skippedCount,
            taxAggregateId: fineTaxTotal > 0 ? aggregateFineTaxId : null,
        };
    });
});

/** 2. 임의 벌금 부과 (교사/경찰 직접 입력) */
exports.applyCustomFines = onCall({ region: "asia-northeast3" }, async (request) => {
    const { classId, actorUid, actorName } = await verifyPolicePermission(request);
    const { fines: inputList, ruleTitle = "임의 벌금" } = request.data || {};
    if (!inputList?.length) return { success: false };

    const globalConfig = await getGlobalConfig();
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `custom_fines_${actorUid}_${Date.now()}`,
    );

    return await db.runTransaction(async (tx) => {
        const studentRefs = inputList.map((item) => db.doc(`classes/${classId}/students/${item.studentUid}`));
        const studentSnaps = await tx.getAll(...studentRefs);
        const classSnap = await tx.get(db.doc(`classes/${classId}`));
        const classData = classSnap.data() || {};
        const currencyUnit = classData.currencyUnit || "캐시";
        const context = { config: globalConfig, planType: classData.planType || "FREE", serviceName: "police" };
        const isTaxEnabled = isPoliceFineTreasuryEnabled(
            globalConfig,
            classData.planType,
            classData,
        );
        const aggregateFineTaxId = `police_custom_fine_${batchKey}`;
        const fineTaxLines = [];
        let fineTaxTotal = 0;

        let appliedCount = 0;

        for (let i = 0; i < inputList.length; i++) {
            const item = inputList[i];
            const studentSnap = studentSnaps[i];
            if (!studentSnap.exists) continue;

            const dec = Math.abs(Number(item.amount || 0));
            const creditChange = Number(item.creditChange || 0);
            const missionTokenChange = Number(item.missionTokenChange || 0);
            const docId = item.relatedDocId || db.collection("_").doc().id;
            const sourceType = item.sourceType || "custom";
            const historyRuleText =
                item.ruleText ||
                ruleTitle ||
                (sourceType === "report" ? CUSTOM_REPORT_FINE_RULE_TEXT : "");
            const linkedReportId = sourceType === "report" ?
                String(item.reportId || item.relatedDocId || "").trim() :
                "";
            const reportRef = linkedReportId ?
                db.doc(`classes/${classId}/policeReports/${linkedReportId}`) :
                null;
            const reportSnap = reportRef ? await tx.get(reportRef) : null;

            const studentUpdate = { lastUpdated: now() };
            if (dec > 0) studentUpdate["assets.cash"] = FieldValue.increment(-dec);
            if (creditChange !== 0) studentUpdate["creditScore"] = FieldValue.increment(creditChange);
            if (missionTokenChange !== 0) {
                studentUpdate["assets.missionToken"] =
                    FieldValue.increment(missionTokenChange);
            }
            tx.update(studentSnap.ref, studentUpdate);

            if (creditChange !== 0) {
                stageCreditLog(tx, classId, {
                    studentUid: item.studentUid,
                    delta: creditChange,
                    source: "police_fine",
                    issuedByUid: actorUid,
                    reason: item.reason || item.description || ruleTitle,
                    relatedDoc: { collection: "policeFineHistory", id: docId },
                }, context);
            }

            if (dec > 0) {
                stageActivityLog(tx, classId, {
                    studentUid: item.studentUid,
                    type: "expense",
                    category: "fine",
                    amount: dec,
                    description: item.description || historyRuleText,
                    taxEvent: isTaxEnabled ? {
                        sourceKey: "policeFine",
                        taxCategory: "fine",
                        taxType: "police_custom_fine",
                        amount: dec,
                    } : null,
                    relatedDoc: { collection: "policeFineHistory", id: docId },
                }, context);

                if (isTaxEnabled) {
                    fineTaxTotal += dec;
                    fineTaxLines.push({
                        id: docId,
                        amount: dec,
                        source: "police_fine",
                        taxType: "police_custom_fine",
                        description: `벌금 - ${ruleTitle}`,
                        studentUid: item.studentUid,
                        studentName: studentSnap.data().name || null,
                        relatedDoc: { collection: "policeFineHistory", id: docId },
                        externalId: docId,
                        meta: {
                            sourceType,
                            ruleTitle,
                            reportId: linkedReportId || null,
                        },
                    });
                }
            }

            if (missionTokenChange !== 0) {
                stageMissionTokenLog(tx, classId, {
                    studentUid: item.studentUid,
                    delta: missionTokenChange,
                    category:
                        missionTokenChange > 0 ? "reward" : "fine",
                    description: item.description || historyRuleText,
                    relatedDoc: { collection: "policeFineHistory", id: docId },
                    source:
                        missionTokenChange > 0 ?
                            "police_reward" :
                            "police_fine",
                }, context);
            }

            tx.set(db.doc(`classes/${classId}/policeFineHistory/${docId}`), {
                id: docId,
                studentUid: item.studentUid,
                studentName: studentSnap.data().name,
                type: "fine",
                amountSigned: -dec,
                creditChangeApplied: creditChange,
                missionTokenChangeApplied: missionTokenChange,
                originalAmountSigned: -dec,
                originalCreditChangeApplied: creditChange,
                originalMissionTokenChangeApplied: missionTokenChange,
                adjustmentFinePercent: 100,
                adjustmentCreditPercent: 100,
                adjustmentMissionTokenPercent: 100,
                ruleId: item.ruleId ? String(item.ruleId).trim() : null,
                ruleText: historyRuleText,
                reason: item.reason || item.description || "",
                actorUid,
                actorName,
                reporterName: item.reporterName || null,
                reporterUid: item.reporterUid || null,
                reportReason: item.reportReason || item.reason || null,
                reportId: linkedReportId || null,
                isSensitive: item.isSensitive === true,
                appliedAt: now(),
                status: "applied",
                ...buildEmptyReflectionSummaryFields(),
                ...(dec > 0 && isTaxEnabled
                    ? {
                        taxRecord: buildTaxRecordPointer(
                            "taxIncomes",
                            aggregateFineTaxId,
                            docId,
                        ),
                        taxRecordedAt: now(),
                        taxCancelled: false,
                    }
                    : {}),
                ...buildHistoryAnalyticsFields({
                    sourceType,
                    eventType: "fine_applied",
                    reportOutcome: sourceType === "report" ? "applied" : null,
                    dangerLevel: item.dangerLevel,
                }),
            }, { merge: true });

            if (dec > 0) {
                const ruleText = historyRuleText;
                stageNotification(tx, classId, {
                    uid: item.studentUid,
                    title: "벌금 부과 안내",
                    message: `'${ruleText}' 사유로 ${dec.toLocaleString("ko-KR")}${currencyUnit} 벌금이 부과되었습니다.`,
                    type: "police_penalty_applied",
                    path: "/police",
                    priority: "high",
                    metadata: {
                        relatedDocId: docId,
                        ruleText,
                        amount: dec,
                    },
                });
            }

            if (reportRef && reportSnap?.exists) {
                tx.set(reportRef, {
                    status: "resolved_applied",
                    resolvedAt: now(),
                    resolverUid: actorUid,
                    resolverName: actorName,
                    actionTaken: "custom_fined",
                    updatedAt: now(),
                }, { merge: true });
            }

            appliedCount += 1;
        }

        if (isTaxEnabled && fineTaxTotal > 0) {
            stageTaxIncome(
                tx,
                classId,
                {
                    amount: fineTaxTotal,
                    source: "police_fine",
                    taxType: "police_custom_fine",
                    description: `경찰 벌금 일괄 기록 (${fineTaxLines.length}건)`,
                },
                actorUid,
                {
                    ...context,
                    classData,
                    sourceKey: "policeFine",
                    customId: aggregateFineTaxId,
                    aggregateMeta: {
                        group: "police_custom_fine",
                        batchKey,
                        pageKey: "police",
                        actorUid,
                        actorName,
                        mode: "apply_custom_fines",
                    },
                    detailLines: fineTaxLines,
                    detailCollection: TAX_LINE_COLLECTION,
                },
            );
        }

        return {
            success: true,
            appliedCount,
            taxAggregateId: fineTaxTotal > 0 ? aggregateFineTaxId : null,
        };
    });
});

/** 3. 규칙 기반 다중 상금 지급 */
exports.applyMultipleRewards = onCall({ region: "asia-northeast3" }, async (request) => {
    const { classId, actorUid, actorName } = await verifyPolicePermission(request);
    const { rewards } = request.data || {};
    if (!Array.isArray(rewards) || rewards.length === 0) return { success: false };

    const globalConfig = await getGlobalConfig();
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `bulk_rewards_${actorUid}_${Date.now()}`,
    );

    return await db.runTransaction(async (tx) => {
        const studentRefs = rewards.map((r) => db.doc(`classes/${classId}/students/${r.studentUid}`));
        const studentSnaps = await tx.getAll(...studentRefs);
        const classSnap = await tx.get(db.doc(`classes/${classId}`));
        const classData = classSnap.data() || {};
        const planType = classData.planType || "FREE";
        const context = { config: globalConfig, planType, serviceName: "police" };
        const isTaxEnabled = isPoliceRewardTreasuryEnabled(
            globalConfig,
            planType,
            classData,
        );
        const aggregateRewardTaxId = `police_reward_${batchKey}`;
        const aggregateWithholdingTaxId = `police_reward_withholding_${batchKey}`;
        const rewardTaxLines = [];
        const withholdingTaxLines = [];
        const withholdingActivityLogs = [];
        let rewardTaxTotal = 0;
        let withholdingTaxTotal = 0;

        let appliedCount = 0;

        for (let i = 0; i < rewards.length; i++) {
            const r = rewards[i];
            const studentSnap = studentSnaps[i];
            if (!studentSnap.exists) continue;

            const quantityApplied = normalizeAppliedQuantity(
                r.quantity ?? r.repeatCount,
            );
            const unitAmount = Math.abs(Number(r.amount || 0));
            const unitCreditChange = Number(r.creditChange || 0);
            const unitMissionTokenChange = Number(r.missionTokenChange || 0);
            const inc = unitAmount * quantityApplied;
            const incomeTaxSnapshot = buildPoliceRewardIncomeTax(classData, inc);
            const netRewardAmount = incomeTaxSnapshot.netAmount;
            const creditChange = unitCreditChange * quantityApplied;
            const missionTokenChange = unitMissionTokenChange * quantityApplied;
            const rewardId = r.relatedDocId || db.collection("_").doc().id;
            const studentUpdate = { lastUpdated: now() };

            if (inc > 0) {
                studentUpdate["assets.cash"] = FieldValue.increment(netRewardAmount);
            }
            if (creditChange !== 0) {
                studentUpdate["creditScore"] = FieldValue.increment(creditChange);
            }
            if (missionTokenChange !== 0) {
                studentUpdate["assets.missionToken"] =
                    FieldValue.increment(missionTokenChange);
            }
            tx.update(studentSnap.ref, studentUpdate);

            if (inc > 0) {
                const taxActivityLogId = stageActivityLog(tx, classId, {
                    studentUid: r.studentUid,
                    type: "income",
                    category: "reward",
                    amount: netRewardAmount,
                    description: r.description || "상금 지급",
                    relatedDoc: { collection: "policeFineHistory", id: rewardId },
                    grossAmount: incomeTaxSnapshot.grossAmount,
                    withheldAmount: incomeTaxSnapshot.withheldAmount,
                    netAmount: incomeTaxSnapshot.netAmount,
                    incomeTax: incomeTaxSnapshot.incomeTax,
                    quantityApplied,
                    unitAmount,
                    unitCreditChange,
                }, context);

                if (isTaxEnabled) {
                    rewardTaxTotal += inc;
                    rewardTaxLines.push({
                        id: rewardId,
                        amount: inc,
                        source: "police_reward",
                        expenseType: "reward",
                        category: "reward",
                        description: `상금 - ${studentSnap.data().name}`,
                        studentUid: r.studentUid,
                        studentName: studentSnap.data().name || null,
                        relatedDoc: { collection: "policeFineHistory", id: rewardId },
                        externalId: rewardId,
                        meta: {
                            sourceType: r.sourceType || "manual",
                            quantityApplied,
                            unitAmount,
                            ruleText: r.ruleText || "상금",
                            incomeTax: incomeTaxSnapshot.incomeTax,
                        },
                    });
                }
                if (incomeTaxSnapshot.withheldAmount > 0) {
                    if (taxActivityLogId) {
                        withholdingActivityLogs.push({
                            studentUid: r.studentUid,
                            historyId: rewardId,
                            activityLogId: taxActivityLogId,
                        });
                    }
                    withholdingTaxTotal += incomeTaxSnapshot.withheldAmount;
                    withholdingTaxLines.push({
                        id: rewardId,
                        amount: incomeTaxSnapshot.withheldAmount,
                        source: "police_reward_withholding",
                        taxType: "income_tax",
                        description: `경찰 상금 원천징수 - ${studentSnap.data().name}`,
                        studentUid: r.studentUid,
                        studentName: studentSnap.data().name || null,
                        relatedDoc: { collection: "policeFineHistory", id: rewardId },
                        externalId: rewardId,
                        meta: {
                            incomeTax: incomeTaxSnapshot.incomeTax,
                        },
                    });
                }
            }

            if (creditChange !== 0) {
                stageCreditLog(tx, classId, {
                    studentUid: r.studentUid,
                    delta: creditChange,
                    source: "police_reward",
                    issuedByUid: actorUid,
                    reason: r.reason || r.description || r.ruleText || "경찰 상금",
                    relatedDoc: { collection: "policeFineHistory", id: rewardId },
                    quantityApplied,
                    unitAmount,
                    unitCreditChange,
                }, context);
            }

            if (missionTokenChange !== 0) {
                stageMissionTokenLog(tx, classId, {
                    studentUid: r.studentUid,
                    delta: missionTokenChange,
                    category:
                        missionTokenChange > 0 ? "reward" : "fine",
                    description: r.reason || r.description || r.ruleText || "경찰 상금",
                    relatedDoc: { collection: "policeFineHistory", id: rewardId },
                    source:
                        missionTokenChange > 0 ?
                            "police_reward" :
                            "police_fine",
                    quantityApplied,
                    unitAmount,
                    unitCreditChange,
                    unitMissionTokenChange,
                }, context);
            }

            tx.set(db.doc(`classes/${classId}/policeFineHistory/${rewardId}`), {
                id: rewardId,
                studentUid: r.studentUid,
                studentName: studentSnap.data().name,
                type: "reward",
                amountSigned: netRewardAmount,
                grossAmountSigned: inc,
                withheldAmount: incomeTaxSnapshot.withheldAmount,
                netAmountSigned: netRewardAmount,
                incomeTax: incomeTaxSnapshot.incomeTax,
                creditChangeApplied: creditChange,
                missionTokenChangeApplied: missionTokenChange,
                ruleText: r.ruleText || "상금",
                quantityApplied,
                unitAmount,
                unitCreditChange,
                unitMissionTokenChange,
                reason: r.reason || r.description || "",
                actorUid,
                actorName,
                appliedAt: now(),
                status: "applied",
                ...buildEmptyReflectionSummaryFields(),
                ...(inc > 0 && isTaxEnabled
                    ? {
                        taxRecord: buildTaxRecordPointer(
                            "taxExpenses",
                            aggregateRewardTaxId,
                            rewardId,
                        ),
                        taxRecordedAt: now(),
                        taxCancelled: false,
                    }
                    : {}),
                ...buildHistoryAnalyticsFields({
                    sourceType: r.sourceType || "manual",
                    eventType: "reward_applied",
                    reportOutcome: null,
                    dangerLevel: r.dangerLevel,
                }),
            }, { merge: true });

            appliedCount += 1;
        }

        if (isTaxEnabled && rewardTaxTotal > 0) {
            stageTaxExpense(
                tx,
                classId,
                {
                    amount: rewardTaxTotal,
                    description: `경찰 상금 일괄 기록 (${rewardTaxLines.length}건)`,
                    source: "police_reward",
                    expenseType: "reward",
                    category: "reward",
                },
                actorUid,
                {
                    ...context,
                    customId: aggregateRewardTaxId,
                    aggregateMeta: {
                        group: "police_reward",
                        batchKey,
                        pageKey: "police",
                        actorUid,
                        actorName,
                        mode: "apply_rewards",
                    },
                    detailLines: rewardTaxLines,
                    detailCollection: TAX_LINE_COLLECTION,
                },
            );
        }

        if (withholdingTaxTotal > 0) {
            const withholdingTaxRecord = stageTaxIncome(
                tx,
                classId,
                {
                    amount: withholdingTaxTotal,
                    description: `경찰 상금 원천징수 (${withholdingTaxLines.length}건)`,
                    source: "police_reward_withholding",
                    taxType: "income_tax",
                },
                actorUid,
                {
                    ...context,
                    classData,
                    sourceKey: "policeReward",
                    customId: aggregateWithholdingTaxId,
                    aggregateMeta: {
                        group: "police_reward_withholding",
                        batchKey,
                        pageKey: "police",
                        actorUid,
                        actorName,
                        mode: "apply_rewards",
                    },
                    detailLines: withholdingTaxLines,
                    detailCollection: TAX_LINE_COLLECTION,
                },
            );
            withholdingActivityLogs.forEach((entry) => {
                const activityLogRef = db.doc(
                    `classes/${classId}/students/${entry.studentUid}/activityLogs/${entry.activityLogId}`,
                );
                stageTaxPostingLink(tx, activityLogRef, withholdingTaxRecord);
                tx.set(
                    db.doc(
                        `classes/${classId}/policeFineHistory/${entry.historyId}`,
                    ),
                    { taxActivityLogId: entry.activityLogId },
                    { merge: true },
                );
            });
        }

        return {
            success: true,
            appliedCount,
            taxAggregateId: rewardTaxTotal > 0 ? aggregateRewardTaxId : null,
        };
    });
});

/** 4. 임의 상금 지급 (직접 입력) */
exports.applyCustomRewards = onCall({ region: "asia-northeast3" }, async (request) => {
    const { classId, actorUid, actorName } = await verifyPolicePermission(request);
    const { rewards: inputList, ruleTitle = "임의 상금" } = request.data || {};
    if (!inputList?.length) return { success: false };

    const globalConfig = await getGlobalConfig();
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `custom_rewards_${actorUid}_${Date.now()}`,
    );

    return await db.runTransaction(async (tx) => {
        const studentRefs = inputList.map((item) => db.doc(`classes/${classId}/students/${item.studentUid}`));
        const studentSnaps = await tx.getAll(...studentRefs);
        const classSnap = await tx.get(db.doc(`classes/${classId}`));
        const classData = classSnap.data() || {};
        const planType = classData.planType || "FREE";
        const context = { config: globalConfig, planType, serviceName: "police" };
        const isTaxEnabled = isPoliceRewardTreasuryEnabled(
            globalConfig,
            planType,
            classData,
        );
        const aggregateRewardTaxId = `police_reward_${batchKey}`;
        const aggregateWithholdingTaxId = `police_reward_withholding_${batchKey}`;
        const rewardTaxLines = [];
        const withholdingTaxLines = [];
        const withholdingActivityLogs = [];
        let rewardTaxTotal = 0;
        let withholdingTaxTotal = 0;

        let appliedCount = 0;

        for (let i = 0; i < inputList.length; i++) {
            const item = inputList[i];
            const studentSnap = studentSnaps[i];
            if (!studentSnap.exists) continue;

            const inc = Math.abs(Number(item.amount || 0));
            const incomeTaxSnapshot = buildPoliceRewardIncomeTax(classData, inc);
            const netRewardAmount = incomeTaxSnapshot.netAmount;
            const creditChange = Number(item.creditChange || 0);
            const missionTokenChange = Number(item.missionTokenChange || 0);
            const docId = item.relatedDocId || db.collection("_").doc().id;
            const studentUpdate = { lastUpdated: now() };

            if (inc > 0) {
                studentUpdate["assets.cash"] = FieldValue.increment(netRewardAmount);
            }
            if (creditChange !== 0) {
                studentUpdate["creditScore"] = FieldValue.increment(creditChange);
            }
            if (missionTokenChange !== 0) {
                studentUpdate["assets.missionToken"] =
                    FieldValue.increment(missionTokenChange);
            }
            tx.update(studentSnap.ref, studentUpdate);

            if (inc > 0) {
                const taxActivityLogId = stageActivityLog(tx, classId, {
                    studentUid: item.studentUid,
                    type: "income",
                    category: "reward",
                    amount: netRewardAmount,
                    description: item.description || ruleTitle,
                    relatedDoc: { collection: "policeFineHistory", id: docId },
                    grossAmount: incomeTaxSnapshot.grossAmount,
                    withheldAmount: incomeTaxSnapshot.withheldAmount,
                    netAmount: incomeTaxSnapshot.netAmount,
                    incomeTax: incomeTaxSnapshot.incomeTax,
                }, context);

                if (isTaxEnabled) {
                    rewardTaxTotal += inc;
                    rewardTaxLines.push({
                        id: docId,
                        amount: inc,
                        source: "police_reward",
                        expenseType: "reward",
                        category: "reward",
                        description: `상금 - ${ruleTitle}`,
                        studentUid: item.studentUid,
                        studentName: studentSnap.data().name || null,
                        relatedDoc: { collection: "policeFineHistory", id: docId },
                        externalId: docId,
                        meta: {
                            sourceType: item.sourceType || "custom",
                            ruleTitle,
                            incomeTax: incomeTaxSnapshot.incomeTax,
                        },
                    });
                }
                if (incomeTaxSnapshot.withheldAmount > 0) {
                    if (taxActivityLogId) {
                        withholdingActivityLogs.push({
                            studentUid: item.studentUid,
                            historyId: docId,
                            activityLogId: taxActivityLogId,
                        });
                    }
                    withholdingTaxTotal += incomeTaxSnapshot.withheldAmount;
                    withholdingTaxLines.push({
                        id: docId,
                        amount: incomeTaxSnapshot.withheldAmount,
                        source: "police_reward_withholding",
                        taxType: "income_tax",
                        description: `경찰 상금 원천징수 - ${ruleTitle}`,
                        studentUid: item.studentUid,
                        studentName: studentSnap.data().name || null,
                        relatedDoc: { collection: "policeFineHistory", id: docId },
                        externalId: docId,
                        meta: {
                            incomeTax: incomeTaxSnapshot.incomeTax,
                        },
                    });
                }
            }

            if (creditChange !== 0) {
                stageCreditLog(tx, classId, {
                    studentUid: item.studentUid,
                    delta: creditChange,
                    source: "police_reward",
                    issuedByUid: actorUid,
                    reason: item.reason || item.description || ruleTitle,
                    relatedDoc: { collection: "policeFineHistory", id: docId },
                }, context);
            }

            if (missionTokenChange !== 0) {
                stageMissionTokenLog(tx, classId, {
                    studentUid: item.studentUid,
                    delta: missionTokenChange,
                    category:
                        missionTokenChange > 0 ? "reward" : "fine",
                    description: item.reason || item.description || ruleTitle,
                    relatedDoc: { collection: "policeFineHistory", id: docId },
                    source:
                        missionTokenChange > 0 ?
                            "police_reward" :
                            "police_fine",
                }, context);
            }

            tx.set(db.doc(`classes/${classId}/policeFineHistory/${docId}`), {
                id: docId,
                studentUid: item.studentUid,
                studentName: studentSnap.data().name,
                type: "reward",
                amountSigned: netRewardAmount,
                grossAmountSigned: inc,
                withheldAmount: incomeTaxSnapshot.withheldAmount,
                netAmountSigned: netRewardAmount,
                incomeTax: incomeTaxSnapshot.incomeTax,
                creditChangeApplied: creditChange,
                missionTokenChangeApplied: missionTokenChange,
                ruleText: item.description || ruleTitle,
                reason: item.reason || item.description || "",
                actorUid,
                actorName,
                appliedAt: now(),
                status: "applied",
                ...buildEmptyReflectionSummaryFields(),
                ...(inc > 0 && isTaxEnabled
                    ? {
                        taxRecord: buildTaxRecordPointer(
                            "taxExpenses",
                            aggregateRewardTaxId,
                            docId,
                        ),
                        taxRecordedAt: now(),
                        taxCancelled: false,
                    }
                    : {}),
                ...buildHistoryAnalyticsFields({
                    sourceType: item.sourceType || "custom",
                    eventType: "reward_applied",
                    reportOutcome: null,
                    dangerLevel: item.dangerLevel,
                }),
            }, { merge: true });

            appliedCount += 1;
        }

        if (isTaxEnabled && rewardTaxTotal > 0) {
            stageTaxExpense(
                tx,
                classId,
                {
                    amount: rewardTaxTotal,
                    description: `경찰 상금 일괄 기록 (${rewardTaxLines.length}건)`,
                    source: "police_reward",
                    expenseType: "reward",
                    category: "reward",
                },
                actorUid,
                {
                    ...context,
                    customId: aggregateRewardTaxId,
                    aggregateMeta: {
                        group: "police_reward",
                        batchKey,
                        pageKey: "police",
                        actorUid,
                        actorName,
                        mode: "apply_custom_rewards",
                    },
                    detailLines: rewardTaxLines,
                    detailCollection: TAX_LINE_COLLECTION,
                },
            );
        }

        if (withholdingTaxTotal > 0) {
            const withholdingTaxRecord = stageTaxIncome(
                tx,
                classId,
                {
                    amount: withholdingTaxTotal,
                    description: `경찰 상금 원천징수 (${withholdingTaxLines.length}건)`,
                    source: "police_reward_withholding",
                    taxType: "income_tax",
                },
                actorUid,
                {
                    ...context,
                    classData,
                    sourceKey: "policeReward",
                    customId: aggregateWithholdingTaxId,
                    aggregateMeta: {
                        group: "police_reward_withholding",
                        batchKey,
                        pageKey: "police",
                        actorUid,
                        actorName,
                        mode: "apply_custom_rewards",
                    },
                    detailLines: withholdingTaxLines,
                    detailCollection: TAX_LINE_COLLECTION,
                },
            );
            withholdingActivityLogs.forEach((entry) => {
                const activityLogRef = db.doc(
                    `classes/${classId}/students/${entry.studentUid}/activityLogs/${entry.activityLogId}`,
                );
                stageTaxPostingLink(tx, activityLogRef, withholdingTaxRecord);
                tx.set(
                    db.doc(
                        `classes/${classId}/policeFineHistory/${entry.historyId}`,
                    ),
                    { taxActivityLogId: entry.activityLogId },
                    { merge: true },
                );
            });
        }

        return {
            success: true,
            appliedCount,
            taxAggregateId: rewardTaxTotal > 0 ? aggregateRewardTaxId : null,
        };
    });
});

/* ──────────────────────────────────────────────────────────────
 * 3) 환불 및 회수 (Refunds)
 * ────────────────────────────────────────────────────────────── */

exports.refundFineAmount = onCall({ region: "asia-northeast3" }, async (request) => {
    const { classId, actorUid, actorName } = await verifyPolicePermission(request);

    // 🌟 [수정] 단일 ID 혹은 배열을 모두 수용하도록 파라미터 추출 방식 변경
    const { amount, relatedDocId, relatedDocIds } = request.data || {};
    const targetDocIds = Array.isArray(relatedDocIds) ? relatedDocIds : (relatedDocId ? [relatedDocId] : []);

    // 🌟 [수정] 검증 로직을 targetDocIds 기준으로 변경하여 에러 방지
    if (targetDocIds.length === 0)
        throw new HttpsError("invalid-argument", "취소할 벌금 내역 ID가 없습니다.");

    const globalConfig = await getGlobalConfig();
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `refund_fines_${actorUid}_${Date.now()}`,
    );

    return await db.runTransaction(async (tx) => {
        const classRef = db.doc(`classes/${classId}`);
        const classSnap = await tx.get(classRef);
        const classData = classSnap.data() || {};
        const planType = classData.planType || "FREE";
        const context = { config: globalConfig, planType, serviceName: "police" };
        const aggregateRefundTaxId = `police_refund_fine_${batchKey}`;
        const refundTaxLines = [];
        let refundTaxTotal = 0;

        // 1️⃣ [READ] 모든 벌금 히스토리 문서를 한꺼번에 가져오기
        const historyRefs = targetDocIds.map(id => db.doc(`classes/${classId}/policeFineHistory/${id}`));
        const historySnaps = await tx.getAll(...historyRefs);

        // 2️⃣ [READ] 대상 학생들 정보 한꺼번에 가져오기 (중복 Uid 제거)
        const uniqueStudentUids = [...new Set(historySnaps.map(s => s.exists ? s.data().studentUid : null).filter(id => id))];
        const studentRefs = uniqueStudentUids.map(uid => db.doc(`classes/${classId}/students/${uid}`));
        const studentSnaps = await tx.getAll(...studentRefs);

        const studentMap = Object.fromEntries(studentSnaps.map(s => [s.id, s]));
        const legacyTaxRefs = historySnaps
            .filter((snap) => snap.exists && !snap.data().isCancelled)
            .filter((snap) => !(snap.data()?.taxRecord?.id))
            .map((snap) => db.doc(`classes/${classId}/taxIncomes/${snap.id}`));
        const legacyTaxSnaps = legacyTaxRefs.length ? await tx.getAll(...legacyTaxRefs) : [];
        const legacyTaxMap = new Map(
            legacyTaxSnaps
                .filter((snap) => snap.exists)
                .map((snap) => [snap.id, snap]),
        );
        // 3️⃣ [WRITE] 각 항목별 환불 로직 실행
        for (const fineSnap of historySnaps) {
            if (!fineSnap.exists || fineSnap.data().isCancelled) continue;

            const fineData = fineSnap.data();
            const sUid = fineData.studentUid;
            const sSnap = studentMap[sUid];
            if (!sSnap?.exists) continue;

            // 벌금이었으므로 환불(자산 증가) 금액 계산
            // 프론트에서 amount를 안 보내도 DB의 amountSigned를 절댓값으로 사용
            const requestedAmount = Number(amount);
            const hasExplicitRefundAmount =
                amount !== undefined &&
                amount !== null &&
                Number.isFinite(requestedAmount) &&
                requestedAmount !== 0;
            const refundAmt = Math.abs(Number(
                hasExplicitRefundAmount ?
                    requestedAmount :
                    fineData.amountSigned ?? fineData.originalAmountSigned ?? 0,
            ) || 0);
            const creditRevert = -Number(
                fineData.creditChangeApplied ??
                fineData.originalCreditChangeApplied ??
                0,
            );
            const missionTokenRevert = -Number(
                fineData.missionTokenChangeApplied ??
                fineData.originalMissionTokenChangeApplied ??
                0,
            );

            // A. 학생 데이터 업데이트 (자산 환불 / 신용 복구)
            const studentUpdate = { lastUpdated: now() };
            if (refundAmt > 0) studentUpdate["assets.cash"] = FieldValue.increment(refundAmt);
            if (creditRevert !== 0) studentUpdate["creditScore"] = FieldValue.increment(creditRevert);
            if (missionTokenRevert !== 0) {
                studentUpdate["assets.missionToken"] =
                    FieldValue.increment(missionTokenRevert);
            }
            tx.update(sSnap.ref, studentUpdate);

            // B. 벌금 히스토리 상태 변경
            tx.update(fineSnap.ref, {
                isCancelled: true,
                status: "cancelled",
                cancelledAt: now(),
                cancelledBy: actorUid,
                cancelledByName: actorName
            });

            // C. 활동 로그 기록 (환불)
            if (refundAmt > 0) {
                stageActivityLog(tx, classId, {
                    studentUid: sUid, type: "income", category: "fine_refund", amount: refundAmt,
                    description: `벌금 취소 환불: ${fineData.ruleText || "벌금"}`
                }, context);

                let shouldReverseTax = false;
                const taxRecord = fineData.taxRecord || null;
                if (taxRecord?.id) {
                    shouldReverseTax = true;
                    if (taxRecord.detailStorage !== "inline") {
                        const originalLinePath = [
                            `classes/${classId}/taxIncomes/${taxRecord.id}`,
                            taxRecord.lineCollection || TAX_LINE_COLLECTION,
                            taxRecord.lineId || fineSnap.id,
                        ].join("/");
                        const originalLineRef = db.doc(originalLinePath);
                        tx.set(
                            originalLineRef,
                            {
                                status: "cancelled",
                                cancelledAt: now(),
                                cancelledBy: actorUid,
                                cancelledReason: "fine_refund",
                            },
                            { merge: true },
                        );
                    }
                } else {
                    const legacyTaxSnap = legacyTaxMap.get(fineSnap.id);
                    if (legacyTaxSnap?.exists) {
                        shouldReverseTax = true;
                        tx.set(
                            legacyTaxSnap.ref,
                            {
                                status: "cancelled",
                                cancelledAt: now(),
                                cancelledBy: actorUid,
                                cancelledReason: "fine_refund",
                            },
                            { merge: true },
                        );
                    }
                }

                if (shouldReverseTax) {
                    refundTaxTotal += refundAmt;
                    refundTaxLines.push({
                        id: fineSnap.id,
                        amount: refundAmt,
                        source: "police_fine_refund",
                        expenseType: "police_fine_refund",
                        category: "refund",
                        description: `벌금 취소 환불: ${fineData.ruleText || "벌금"}`,
                        studentUid: sUid,
                        studentName: sSnap.data()?.name || null,
                        relatedDoc: { collection: "policeFineHistory", id: fineSnap.id },
                        externalId: fineSnap.id,
                        meta: {
                            reversalOfTaxRecordId: taxRecord?.id || fineSnap.id,
                            reversalType: "income_to_expense",
                        },
                    });

                    tx.set(
                        fineSnap.ref,
                        {
                            taxCancelled: true,
                            taxReversal: buildTaxRecordPointer(
                                "taxExpenses",
                                aggregateRefundTaxId,
                                fineSnap.id,
                            ),
                        },
                        { merge: true },
                    );
                }
            }

            // D. 신용점수 로그 기록 (복구)
            if (creditRevert !== 0) {
                stageCreditLog(tx, classId, {
                    studentUid: sUid, delta: creditRevert, source: "police_cancel",
                    reason: `경찰 벌금 취소로 인한 점수 복구`,
                    relatedDoc: { collection: "policeFineHistory", id: fineSnap.id }
                }, context);
            }

            if (missionTokenRevert !== 0) {
                stageMissionTokenLog(tx, classId, {
                    studentUid: sUid,
                    delta: missionTokenRevert,
                    category:
                        missionTokenRevert > 0 ? "fine_refund" : "fine",
                    description:
                        missionTokenRevert > 0 ?
                            `벌금 취소 환급: ${fineData.ruleText || "벌금"}` :
                            `벌금 취소 재적용: ${fineData.ruleText || "벌금"}`,
                    relatedDoc: {
                        collection: "policeFineHistory",
                        id: fineSnap.id,
                    },
                    source:
                        missionTokenRevert > 0 ?
                            "police_fine_refund" :
                            "police_fine",
                }, context);
            }
        }

        if (refundTaxTotal > 0) {
            stageIncomeCancellationAsExpense(
                tx,
                classId,
                {
                    amount: refundTaxTotal,
                    source: "police_fine_refund",
                    expenseType: "police_fine_refund",
                    category: "refund",
                    description: `경찰 벌금 환불 역분개 (${refundTaxLines.length}건)`,
                },
                actorUid,
                {
                    ...context,
                    customId: aggregateRefundTaxId,
                    aggregateMeta: {
                        group: "police_fine_refund",
                        batchKey,
                        pageKey: "police",
                        actorUid,
                        actorName,
                        mode: "refund_fines",
                    },
                    detailLines: refundTaxLines,
                    detailCollection: TAX_LINE_COLLECTION,
                    skipFeatureGate: true,
                },
            );
        }

        return {
            success: true,
            count: targetDocIds.length,
            taxAggregateId: refundTaxTotal > 0 ? aggregateRefundTaxId : null,
        };
    });
});

exports.reviewPoliceReflection = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { classId, actorUid, actorName } = await verifyPolicePermission(request);
        const {
            reflectionId,
            finePercent = 100,
            creditPercent = 100,
            missionTokenPercent = 100,
            teacherComment = "",
        } = request.data || {};

        const normalizedReflectionId = String(reflectionId || "").trim();
        if (!normalizedReflectionId) {
            throw new HttpsError(
                "invalid-argument",
                "reflectionId is required.",
            );
        }

        const normalizedFinePercent = normalizeAdjustmentPercent(
            finePercent,
            "finePercent",
        );
        const normalizedCreditPercent = normalizeAdjustmentPercent(
            creditPercent,
            "creditPercent",
        );
        const normalizedMissionTokenPercent = normalizeAdjustmentPercent(
            missionTokenPercent,
            "missionTokenPercent",
        );
        const normalizedTeacherComment = String(teacherComment || "").trim();

        const globalConfig = await getGlobalConfig();
        const batchKey = resolveAggregateBatchKey(
            request.data,
            `review_reflection_${actorUid}_${Date.now()}`,
        );

        return await db.runTransaction(async (tx) => {
            const classRef = db.doc(`classes/${classId}`);
            const reflectionRef = db.doc(
                `classes/${classId}/reflections/${normalizedReflectionId}`,
            );
            const historyRef = db.doc(
                `classes/${classId}/policeFineHistory/${normalizedReflectionId}`,
            );

            const [classSnap, reflectionSnap, historySnap] = await Promise.all([
                tx.get(classRef),
                tx.get(reflectionRef),
                tx.get(historyRef),
            ]);

            if (!reflectionSnap.exists) {
                throw new HttpsError(
                    "not-found",
                    "The reflection record does not exist.",
                );
            }

            if (!historySnap.exists) {
                throw new HttpsError(
                    "not-found",
                    "The police fine history record does not exist.",
                );
            }

            const reflectionData = reflectionSnap.data() || {};
            const reflectionSubmissionType =
                reflectionData?.submissionType === "appeal" ? "appeal" : "reflection";
            const historyData = historySnap.data() || {};
            if (reflectionData.status !== "submitted") {
                throw new HttpsError(
                    "failed-precondition",
                    "Only submitted reflections can be reviewed.",
                );
            }

            if (historyData.isCancelled || historyData.status === "cancelled") {
                throw new HttpsError(
                    "failed-precondition",
                    "Cancelled records cannot be reviewed.",
                );
            }

            if (String(historyData.type || "") !== "fine") {
                throw new HttpsError(
                    "failed-precondition",
                    "Only fine records can be adjusted from reflections.",
                );
            }

            const studentUid = String(historyData.studentUid || "").trim();
            if (!studentUid) {
                throw new HttpsError(
                    "failed-precondition",
                    "The fine record does not have a valid student.",
                );
            }

            const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
            const studentSnap = await tx.get(studentRef);
            if (!studentSnap.exists) {
                throw new HttpsError(
                    "not-found",
                    "The student record does not exist.",
                );
            }

            const classData = classSnap.data() || {};
            const currencyUnit = classData.currencyUnit || "원";
            const planType = classData.planType || "FREE";
            const context = {
                config: globalConfig,
                planType,
                serviceName: "police",
            };
            const baseAmountSigned = getBaseSignedValue(
                historyData.amountSigned,
                historyData.originalAmountSigned,
            );
            const baseCreditChange = getBaseSignedValue(
                historyData.creditChangeApplied,
                historyData.originalCreditChangeApplied,
            );
            const baseMissionTokenChange = getBaseSignedValue(
                historyData.missionTokenChangeApplied,
                historyData.originalMissionTokenChangeApplied,
            );
            const currentAmountSigned = Number(historyData.amountSigned) || 0;
            const currentCreditChange = Number(historyData.creditChangeApplied) || 0;
            const currentMissionTokenChange =
                Number(historyData.missionTokenChangeApplied) || 0;

            const targetAmountSigned = -Math.abs(
                getAdjustedSignedValue(baseAmountSigned, normalizedFinePercent),
            );
            const targetCreditChange = getAdjustedSignedValue(
                baseCreditChange,
                normalizedCreditPercent,
            );
            const targetMissionTokenChange = getAdjustedSignedValue(
                baseMissionTokenChange,
                normalizedMissionTokenPercent,
            );

            const currentFineAmount = Math.abs(currentAmountSigned);
            const targetFineAmount = Math.abs(targetAmountSigned);
            const cashDelta = currentFineAmount - targetFineAmount;
            const creditDelta = targetCreditChange - currentCreditChange;
            const missionTokenDelta =
                targetMissionTokenChange - currentMissionTokenChange;
            const reviewOutcome =
                normalizedFinePercent === 100 &&
                normalizedCreditPercent === 100 &&
                normalizedMissionTokenPercent === 100
                    ? "approved"
                    : "adjusted";

            const studentUpdate = { lastUpdated: now() };
            if (cashDelta !== 0) {
                studentUpdate["assets.cash"] = FieldValue.increment(cashDelta);
            }
            if (creditDelta !== 0) {
                studentUpdate["creditScore"] = FieldValue.increment(creditDelta);
            }
            if (missionTokenDelta !== 0) {
                studentUpdate["assets.missionToken"] =
                    FieldValue.increment(missionTokenDelta);
            }
            tx.update(studentRef, studentUpdate);

            if (cashDelta !== 0) {
                stageActivityLog(
                    tx,
                    classId,
                    {
                        studentUid,
                        type: cashDelta > 0 ? "income" : "expense",
                        category: cashDelta > 0 ? "fine_refund" : "fine",
                        amount: Math.abs(cashDelta),
                        description:
                            cashDelta > 0
                                ? `벌금 조정 환급: ${historyData.ruleText || "벌금"}`
                                : `벌금 조정 추가부과: ${historyData.ruleText || "벌금"}`,
                        relatedDoc: {
                            collection: "policeFineHistory",
                            id: normalizedReflectionId,
                        },
                    },
                    context,
                );
            }

            if (creditDelta !== 0) {
                stageCreditLog(
                    tx,
                    classId,
                    {
                        studentUid,
                        delta: creditDelta,
                        source:
                            creditDelta > 0
                                ? "police_fine_refund"
                                : "police_fine",
                        issuedByUid: actorUid,
                        reason: `소명 검토 후 신용점수 조정: ${historyData.ruleText || "벌금"}`,
                        relatedDoc: {
                            collection: "policeFineHistory",
                            id: normalizedReflectionId,
                        },
                    },
                    context,
                );
            }

            if (missionTokenDelta !== 0) {
                stageMissionTokenLog(
                    tx,
                    classId,
                    {
                        studentUid,
                        delta: missionTokenDelta,
                        category:
                            missionTokenDelta > 0 ? "fine_refund" : "fine",
                        description:
                            missionTokenDelta > 0
                                ? `벌금 조정 환급: ${historyData.ruleText || "벌금"}`
                                : `벌금 조정 추가 차감: ${historyData.ruleText || "벌금"}`,
                        relatedDoc: {
                            collection: "policeFineHistory",
                            id: normalizedReflectionId,
                        },
                        source:
                            missionTokenDelta > 0
                                ? "police_fine_refund"
                                : "police_fine",
                    },
                    context,
                );
            }

            const hasRecordedTax = Boolean(
                historyData.taxRecord?.id || historyData.taxRecordedAt,
            );
            if (cashDelta > 0 && hasRecordedTax) {
                const adjustmentTaxId = `police_reflection_adjust_${batchKey}`;
                stageIncomeCancellationAsExpense(
                    tx,
                    classId,
                    {
                        amount: cashDelta,
                        source: "police_fine_refund",
                        expenseType: "police_fine_refund",
                        category: "refund",
                        description: `벌금 조정 환급: ${historyData.ruleText || "벌금"}`,
                    },
                    actorUid,
                    {
                        ...context,
                        customId: adjustmentTaxId,
                        aggregateMeta: {
                            group: "police_reflection_adjustment",
                            batchKey,
                            pageKey: "police",
                            actorUid,
                            actorName,
                            mode: "review_reflection",
                        },
                        detailLines: [
                            {
                                id: normalizedReflectionId,
                                amount: cashDelta,
                                source: "police_fine_refund",
                                expenseType: "police_fine_refund",
                                category: "refund",
                                description: `벌금 조정 환급: ${historyData.ruleText || "벌금"}`,
                                studentUid,
                                studentName: studentSnap.data()?.name || null,
                                relatedDoc: {
                                    collection: "policeFineHistory",
                                    id: normalizedReflectionId,
                                },
                                externalId: normalizedReflectionId,
                                meta: {
                                    adjustmentType: "reflection_review",
                                    reversalOfTaxRecordId:
                                        historyData.taxRecord?.id ||
                                        normalizedReflectionId,
                                },
                            },
                        ],
                        detailCollection: TAX_LINE_COLLECTION,
                        skipFeatureGate: true,
                    },
                );
            }

            const reviewedAt = now();

            tx.set(
                historyRef,
                {
                    amountSigned: targetAmountSigned,
                    creditChangeApplied: targetCreditChange,
                    missionTokenChangeApplied: targetMissionTokenChange,
                    originalAmountSigned: baseAmountSigned,
                    originalCreditChangeApplied: baseCreditChange,
                    originalMissionTokenChangeApplied: baseMissionTokenChange,
                    adjustmentFinePercent: normalizedFinePercent,
                    adjustmentCreditPercent: normalizedCreditPercent,
                    adjustmentMissionTokenPercent: normalizedMissionTokenPercent,
                    adjustedAt: now(),
                    adjustedByUid: actorUid,
                    adjustedByName: actorName,
                    submissionType: reflectionSubmissionType,
                    reviewOutcome,
                    ...buildReflectionSummaryFields({
                        hasReflection: true,
                        reflectionStatus: "approved",
                        reflectionUpdatedAt: reviewedAt,
                        reflectionSubmittedAt:
                            reflectionData.submittedAt || null,
                        reflectionReviewedAt: reviewedAt,
                        submissionType: reflectionSubmissionType,
                        reviewOutcome,
                    }),
                    updatedAt: reviewedAt,
                },
                { merge: true },
            );

            tx.set(
                reflectionRef,
                {
                    status: "approved",
                    reviewedAt,
                    reviewedByUid: actorUid,
                    reviewedByName: actorName,
                    teacherComment: normalizedTeacherComment,
                    finalFinePercent: normalizedFinePercent,
                    finalCreditPercent: normalizedCreditPercent,
                    finalMissionTokenPercent: normalizedMissionTokenPercent,
                    reviewOutcome,
                    updatedAt: reviewedAt,
                },
                { merge: true },
            );

            stageNotification(tx, classId, {
                uid: studentUid,
                title: "소명서 검토 완료",
                message:
                    reviewOutcome === "adjusted"
                        ? `최종 결과가 벌금 ${targetFineAmount.toLocaleString("ko-KR")}${currencyUnit}, 신용점수 ${targetCreditChange}점으로 조정되었습니다.`
                        : "제출한 소명/반성문이 승인되었습니다.",
                type: "police_reflection_reviewed",
                path: "/police",
                priority: "medium",
                metadata: {
                    relatedDocId: normalizedReflectionId,
                    reviewOutcome,
                    finePercent: normalizedFinePercent,
                    creditPercent: normalizedCreditPercent,
                    missionTokenPercent: normalizedMissionTokenPercent,
                },
            });

            return {
                success: true,
                reviewOutcome,
                finePercent: normalizedFinePercent,
                creditPercent: normalizedCreditPercent,
                missionTokenPercent: normalizedMissionTokenPercent,
                amountSigned: targetAmountSigned,
                creditChangeApplied: targetCreditChange,
                missionTokenChangeApplied: targetMissionTokenChange,
            };
        });
    },
);

exports.refundRewardAmountLegacy = onCall({ region: "asia-northeast3" }, async (request) => {
    const { classId, actorUid, actorName } = await verifyPolicePermission(request);
    const { studentUid, amount, relatedDocId } = request.data || {};
    if (!studentUid || !relatedDocId) throw new HttpsError("invalid-argument", "필수 정보가 누락되었습니다.");

    const globalConfig = await getGlobalConfig();
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `refund_reward_legacy_${actorUid}_${Date.now()}`,
    );

    return await db.runTransaction(async (tx) => {
        const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
        const rewardRef = db.doc(`classes/${classId}/policeFineHistory/${relatedDocId}`);
        const classRef = db.doc(`classes/${classId}`);
        const legacyTaxRef = db.doc(`classes/${classId}/taxExpenses/${relatedDocId}`);

        // [READ PHASE]
        const [studentSnap, rewardSnap, classSnap, legacyTaxSnap] = await tx.getAll(
            studentRef,
            rewardRef,
            classRef,
            legacyTaxRef,
        );

        if (!rewardSnap.exists) throw new HttpsError("not-found", "해당 상금 내역을 찾을 수 없습니다.");
        const rewardData = rewardSnap.data();
        if (rewardData.isCancelled) throw new HttpsError("failed-precondition", "이미 취소된 내역입니다.");

        const classData = classSnap.data() || {};
        const planType = classData.planType || "FREE";
        const context = { config: globalConfig, planType, serviceName: "police" };
        const aggregateRefundTaxId = `police_refund_reward_${batchKey}`;

        const recoverAmt = Math.abs(Number(amount || rewardData.amountSigned || 0));
        const creditRevert = -(rewardData.creditChangeApplied || 0); // +3점이었다면 -3점으로 복구
        const missionTokenRevert =
            -(rewardData.missionTokenChangeApplied || 0);

        // [WRITE PHASE]
        // 1. 학생 데이터 회수
        const studentUpdate = { lastUpdated: now() };
        if (recoverAmt > 0) studentUpdate["assets.cash"] = FieldValue.increment(-recoverAmt);
        if (creditRevert !== 0) studentUpdate["creditScore"] = FieldValue.increment(creditRevert);
        if (missionTokenRevert !== 0) {
            studentUpdate["assets.missionToken"] =
                FieldValue.increment(missionTokenRevert);
        }
        tx.update(studentRef, studentUpdate);

        // 2. 상금 히스토리 상태 변경
        tx.update(rewardRef, {
            isCancelled: true,
            status: "cancelled",
            cancelledAt: now(),
            cancelledBy: actorUid,
            cancelledByName: actorName
        });

        // 3. 활동 로그 기록 (회수)
        if (recoverAmt > 0) {
            stageActivityLog(tx, classId, {
                studentUid, type: "expense", category: "reward_refund", amount: recoverAmt,
                description: `상금 지급 취소 회수: ${rewardData.ruleText || "상금"}`
            }, context);
        }

        // 4. 신용점수 로그 기록 (복구)
        if (creditRevert !== 0) {
            stageCreditLog(tx, classId, {
                studentUid, delta: creditRevert, source: "police_cancel",
                reason: `경찰 상금 취소로 인한 점수 회수`,
                relatedDoc: { collection: "policeFineHistory", id: relatedDocId }
            }, context);
        }

        if (missionTokenRevert !== 0) {
            stageMissionTokenLog(tx, classId, {
                studentUid,
                delta: missionTokenRevert,
                category:
                    missionTokenRevert > 0 ? "reward" : "reward_refund",
                description:
                    missionTokenRevert > 0 ?
                        `상금 취소 재지급: ${rewardData.ruleText || "상금"}` :
                        `상금 지급 취소 회수: ${rewardData.ruleText || "상금"}`,
                relatedDoc: {
                    collection: "policeFineHistory",
                    id: relatedDocId,
                },
                source:
                    missionTokenRevert > 0 ?
                        "police_reward" :
                        "police_reward_refund",
            }, context);
        }

        if (recoverAmt > 0) {
            let shouldReverseTax = false;
            const taxRecord = rewardData.taxRecord || null;
            if (taxRecord?.id) {
                shouldReverseTax = true;
                if (taxRecord.detailStorage !== "inline") {
                    const originalLinePath = [
                        `classes/${classId}/taxExpenses/${taxRecord.id}`,
                        taxRecord.lineCollection || TAX_LINE_COLLECTION,
                        taxRecord.lineId || relatedDocId,
                    ].join("/");
                    const originalLineRef = db.doc(originalLinePath);
                    tx.set(
                        originalLineRef,
                        {
                            status: "cancelled",
                            cancelledAt: now(),
                            cancelledBy: actorUid,
                            cancelledReason: "reward_refund",
                        },
                        { merge: true },
                    );
                }
            } else {
                if (legacyTaxSnap.exists) {
                    shouldReverseTax = true;
                    tx.set(
                        legacyTaxRef,
                        {
                            status: "cancelled",
                            cancelledAt: now(),
                            cancelledBy: actorUid,
                            cancelledReason: "reward_refund",
                        },
                        { merge: true },
                    );
                }
            }

            if (shouldReverseTax) {
                stageExpenseCancellationAsIncome(
                    tx,
                    classId,
                    {
                        amount: recoverAmt,
                        source: "police_reward_refund",
                        taxType: "police_reward_refund",
                        description: "경찰 상금 환수 역분개 (legacy)",
                    },
                    actorUid,
                    {
                        ...context,
                        customId: aggregateRefundTaxId,
                        aggregateMeta: {
                            group: "police_reward_refund",
                            batchKey,
                            pageKey: "police",
                            actorUid,
                            actorName,
                            mode: "refund_reward_legacy",
                        },
                        detailLines: [
                            {
                                id: relatedDocId,
                                amount: recoverAmt,
                                source: "police_reward_refund",
                                taxType: "police_reward_refund",
                                description: `상금 지급 취소 환수: ${rewardData.ruleText || "상금"}`,
                                studentUid,
                                studentName: studentSnap.data()?.name || null,
                                relatedDoc: { collection: "policeFineHistory", id: relatedDocId },
                                externalId: relatedDocId,
                                meta: {
                                    reversalOfTaxRecordId: taxRecord?.id || relatedDocId,
                                    reversalType: "expense_to_income",
                                },
                            },
                        ],
                        detailCollection: TAX_LINE_COLLECTION,
                        skipFeatureGate: true,
                    },
                );

                tx.set(
                    rewardRef,
                    {
                        taxCancelled: true,
                        taxReversal: buildTaxRecordPointer(
                            "taxIncomes",
                            aggregateRefundTaxId,
                            relatedDocId,
                        ),
                    },
                    { merge: true },
                );
            }
        }

        return {
            success: true,
            taxAggregateId: recoverAmt > 0 ? aggregateRefundTaxId : null,
        };
    });
});


exports.refundRewardAmount = onCall({ region: "asia-northeast3" }, async (request) => {
    const { classId, actorUid, actorName } = await verifyPolicePermission(request);

    // 🌟 단일 ID 혹은 배열을 모두 수용합니다.
    const { relatedDocId, relatedDocIds } = request.data || {};
    const targetDocIds = Array.isArray(relatedDocIds) ? relatedDocIds : (relatedDocId ? [relatedDocId] : []);

    if (targetDocIds.length === 0)
        throw new HttpsError("invalid-argument", "취소할 상금 내역 ID가 없습니다.");

    const globalConfig = await getGlobalConfig();
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `refund_rewards_${actorUid}_${Date.now()}`,
    );

    return await db.runTransaction(async (tx) => {
        const classRef = db.doc(`classes/${classId}`);
        const classSnap = await tx.get(classRef);
        const classData = classSnap.data() || {};
        const planType = classData.planType || "FREE";
        const context = { config: globalConfig, planType, serviceName: "police" };
        const aggregateRefundTaxId = `police_refund_reward_${batchKey}`;
        const refundTaxLines = [];
        let refundTaxTotal = 0;

        // 1️⃣ [READ] 모든 상금 히스토리 문서를 한꺼번에 가져오기
        const historyRefs = targetDocIds.map(id => db.doc(`classes/${classId}/policeFineHistory/${id}`));
        const historySnaps = await tx.getAll(...historyRefs);

        // 2️⃣ [READ] 대상 학생들 정보 한꺼번에 가져오기 (중복 Uid 제거)
        const uniqueStudentUids = [...new Set(historySnaps.map(s => s.exists ? s.data().studentUid : null).filter(id => id))];
        const studentRefs = uniqueStudentUids.map(uid => db.doc(`classes/${classId}/students/${uid}`));
        const studentSnaps = await tx.getAll(...studentRefs);

        // 학생 Uid별로 스냅샷 매핑
        const studentMap = Object.fromEntries(studentSnaps.map(s => [s.id, s]));
        const legacyTaxRefs = historySnaps
            .filter((snap) => snap.exists && !snap.data().isCancelled)
            .filter((snap) => !(snap.data()?.taxRecord?.id))
            .map((snap) => db.doc(`classes/${classId}/taxExpenses/${snap.id}`));
        const legacyTaxSnaps = legacyTaxRefs.length ? await tx.getAll(...legacyTaxRefs) : [];
        const legacyTaxMap = new Map(
            legacyTaxSnaps
                .filter((snap) => snap.exists)
                .map((snap) => [snap.id, snap]),
        );

        const taxActivityLogRefs = historySnaps
            .filter((snap) => snap.exists && !snap.data().isCancelled)
            .map((snap) => {
                const data = snap.data() || {};
                return data.taxActivityLogId && data.studentUid
                    ? db.doc(
                        `classes/${classId}/students/${data.studentUid}/activityLogs/${data.taxActivityLogId}`,
                    )
                    : null;
            })
            .filter(Boolean);
        const taxActivityLogSnaps = taxActivityLogRefs.length
            ? await tx.getAll(...taxActivityLogRefs)
            : [];
        const taxActivityLogSnapMap = new Map(
            taxActivityLogRefs.map((ref, index) => [
                ref.path,
                taxActivityLogSnaps[index],
            ]),
        );

        // 3️⃣ [WRITE] 각 항목별 회수 로직 실행
        for (const rewardSnap of historySnaps) {
            if (!rewardSnap.exists || rewardSnap.data().isCancelled) continue;

            const rewardData = rewardSnap.data();
            const sUid = rewardData.studentUid;
            const sSnap = studentMap[sUid];
            if (!sSnap?.exists) continue;

            // 상금이었으므로 회수(차감) 금액 계산
            const recoverAmt = Math.abs(Number(
                rewardData.amountSigned ??
                rewardData.originalAmountSigned ??
                0,
            ) || 0);
            const creditRevert = -Number(
                rewardData.creditChangeApplied ??
                rewardData.originalCreditChangeApplied ??
                0,
            );
            const missionTokenRevert = -Number(
                rewardData.missionTokenChangeApplied ??
                rewardData.originalMissionTokenChangeApplied ??
                0,
            );

            // A. 학생 데이터 업데이트 (자산 차감 / 신용 복구)
            const studentUpdate = { lastUpdated: now() };
            if (recoverAmt > 0) studentUpdate["assets.cash"] = FieldValue.increment(-recoverAmt);
            if (creditRevert !== 0) studentUpdate["creditScore"] = FieldValue.increment(creditRevert);
            if (missionTokenRevert !== 0) {
                studentUpdate["assets.missionToken"] =
                    FieldValue.increment(missionTokenRevert);
            }
            tx.update(sSnap.ref, studentUpdate);

            // B. 상금 히스토리 상태 변경
            tx.update(rewardSnap.ref, {
                isCancelled: true,
                status: "cancelled",
                cancelledAt: now(),
                cancelledBy: actorUid,
                cancelledByName: actorName
            });

            // C. 활동 로그 기록 (회수)
            if (recoverAmt > 0) {
                stageActivityLog(tx, classId, {
                    studentUid: sUid, type: "expense", category: "reward_refund", amount: recoverAmt,
                    description: `상금 지급 취소 회수: ${rewardData.ruleText || "상금"}`
                }, context);

                let shouldReverseTax = false;
                const taxRecord = rewardData.taxRecord || null;
                if (taxRecord?.id) {
                    shouldReverseTax = true;
                    if (taxRecord.detailStorage !== "inline") {
                        const originalLinePath = [
                            `classes/${classId}/taxExpenses/${taxRecord.id}`,
                            taxRecord.lineCollection || TAX_LINE_COLLECTION,
                            taxRecord.lineId || rewardSnap.id,
                        ].join("/");
                        const originalLineRef = db.doc(originalLinePath);
                        tx.set(
                            originalLineRef,
                            {
                                status: "cancelled",
                                cancelledAt: now(),
                                cancelledBy: actorUid,
                                cancelledReason: "reward_refund",
                            },
                            { merge: true },
                        );
                    }
                } else {
                    const legacyTaxSnap = legacyTaxMap.get(rewardSnap.id);
                    if (legacyTaxSnap?.exists) {
                        shouldReverseTax = true;
                        tx.set(
                            legacyTaxSnap.ref,
                            {
                                status: "cancelled",
                                cancelledAt: now(),
                                cancelledBy: actorUid,
                                cancelledReason: "reward_refund",
                            },
                            { merge: true },
                        );
                    }
                }

                if (shouldReverseTax) {
                    refundTaxTotal += recoverAmt;
                    refundTaxLines.push({
                        id: rewardSnap.id,
                        amount: recoverAmt,
                        source: "police_reward_refund",
                        taxType: "police_reward_refund",
                        description: `상금 지급 취소 회수: ${rewardData.ruleText || "상금"}`,
                        studentUid: sUid,
                        studentName: sSnap.data()?.name || null,
                        relatedDoc: { collection: "policeFineHistory", id: rewardSnap.id },
                        externalId: rewardSnap.id,
                        meta: {
                            reversalOfTaxRecordId: taxRecord?.id || rewardSnap.id,
                            reversalType: "expense_to_income",
                        },
                    });

                    tx.set(
                        rewardSnap.ref,
                        {
                            taxCancelled: true,
                            taxReversal: buildTaxRecordPointer(
                                "taxIncomes",
                                aggregateRefundTaxId,
                                rewardSnap.id,
                            ),
                        },
                        { merge: true },
                    );
                }
            }

            if (rewardData.taxActivityLogId) {
                const taxActivityLogRef = db.doc(
                    `classes/${classId}/students/${sUid}/activityLogs/${rewardData.taxActivityLogId}`,
                );
                const taxActivityLogSnap = taxActivityLogSnapMap.get(
                    taxActivityLogRef.path,
                );
                if (taxActivityLogSnap?.exists) {
                    stageActivityTaxCancellation({
                        tx,
                        classId,
                        activityLogRef: taxActivityLogRef,
                        activityLogData: taxActivityLogSnap.data(),
                        actorUid,
                        reason: "police_reward_cancelled",
                        context: {
                            ...context,
                            pageKey: "police",
                        },
                    });
                }
            }

            // D. 신용점수 로그 기록 (복구)
            if (creditRevert !== 0) {
                stageCreditLog(tx, classId, {
                    studentUid: sUid, delta: creditRevert, source: "police_cancel",
                    reason: `경찰 상금 취소로 인한 점수 회수`,
                    relatedDoc: { collection: "policeFineHistory", id: rewardSnap.id }
                }, context);
            }

            if (missionTokenRevert !== 0) {
                stageMissionTokenLog(tx, classId, {
                    studentUid: sUid,
                    delta: missionTokenRevert,
                    category:
                        missionTokenRevert > 0 ? "reward" : "reward_refund",
                    description:
                        missionTokenRevert > 0 ?
                            `상금 취소 재지급: ${rewardData.ruleText || "상금"}` :
                            `상금 지급 취소 회수: ${rewardData.ruleText || "상금"}`,
                    relatedDoc: {
                        collection: "policeFineHistory",
                        id: rewardSnap.id,
                    },
                    source:
                        missionTokenRevert > 0 ?
                            "police_reward" :
                            "police_reward_refund",
                }, context);
            }
        }

        if (refundTaxTotal > 0) {
            stageExpenseCancellationAsIncome(
                tx,
                classId,
                {
                    amount: refundTaxTotal,
                    source: "police_reward_refund",
                    taxType: "police_reward_refund",
                    description: `경찰 상금 환수 역분개 (${refundTaxLines.length}건)`,
                },
                actorUid,
                {
                    ...context,
                    customId: aggregateRefundTaxId,
                    aggregateMeta: {
                        group: "police_reward_refund",
                        batchKey,
                        pageKey: "police",
                        actorUid,
                        actorName,
                        mode: "refund_rewards",
                    },
                    detailLines: refundTaxLines,
                    detailCollection: TAX_LINE_COLLECTION,
                    skipFeatureGate: true,
                },
            );
        }

        return {
            success: true,
            count: targetDocIds.length,
            taxAggregateId: refundTaxTotal > 0 ? aggregateRefundTaxId : null,
        };
    });
});

/* ──────────────────────────────────────────────────────────────
 * 4) 조회 기능 (Checks)
 * ────────────────────────────────────────────────────────────── */

exports.updatePoliceReason = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { classId, targetType, recordId, reason } = request.data || {};

        if (!classId || !targetType || !recordId) {
            throw new HttpsError(
                "invalid-argument",
                "classId, targetType, and recordId are required.",
            );
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        const normalizedTargetType = String(targetType).trim().toLowerCase();
        if (!["report", "history"].includes(normalizedTargetType)) {
            throw new HttpsError(
                "invalid-argument",
                "targetType must be report or history.",
            );
        }

        const normalizedRecordId = String(recordId).trim();
        const normalizedReason = String(reason ?? "").trim();

        if (!normalizedRecordId) {
            throw new HttpsError("invalid-argument", "recordId is required.");
        }

        if (!normalizedReason) {
            throw new HttpsError("invalid-argument", "reason is required.");
        }

        if (normalizedReason.length > 1000) {
            throw new HttpsError(
                "invalid-argument",
                "reason must be 1000 characters or fewer.",
            );
        }

        const { uid: actorUid, token = {} } = request.auth || {};
        const actorName = await resolveTeacherActorName(
            classId,
            token.name || "선생님",
        );

        return await db.runTransaction(async (tx) => {
            const reportRef = db.doc(
                `classes/${classId}/policeReports/${normalizedRecordId}`,
            );
            const historyRef = db.doc(
                `classes/${classId}/policeFineHistory/${normalizedRecordId}`,
            );

            let syncedReport = false;
            let syncedHistory = false;

            if (normalizedTargetType === "report") {
                const [reportSnap, historySnap] = await Promise.all([
                    tx.get(reportRef),
                    tx.get(historyRef),
                ]);

                if (!reportSnap.exists) {
                    throw new HttpsError(
                        "not-found",
                        "The police report does not exist.",
                    );
                }

                tx.set(
                    reportRef,
                    {
                        reason: normalizedReason,
                        updatedAt: now(),
                        reasonUpdatedAt: now(),
                        reasonUpdatedByUid: actorUid || null,
                        reasonUpdatedByName: actorName,
                    },
                    { merge: true },
                );
                syncedReport = true;

                if (historySnap.exists) {
                    tx.set(
                        historyRef,
                        {
                            reason: normalizedReason,
                            reportReason: normalizedReason,
                            updatedAt: now(),
                            reasonUpdatedAt: now(),
                            reasonUpdatedByUid: actorUid || null,
                            reasonUpdatedByName: actorName,
                        },
                        { merge: true },
                    );
                    syncedHistory = true;
                }
            } else {
                const historySnap = await tx.get(historyRef);
                if (!historySnap.exists) {
                    throw new HttpsError(
                        "not-found",
                        "The police history record does not exist.",
                    );
                }

                const historyData = historySnap.data() || {};
                const linkedReportId = historyData.reportId
                    ? String(historyData.reportId).trim()
                    : "";
                const linkedReportRef = linkedReportId
                    ? db.doc(`classes/${classId}/policeReports/${linkedReportId}`)
                    : null;
                const linkedReportSnap = linkedReportRef
                    ? await tx.get(linkedReportRef)
                    : null;

                tx.set(
                    historyRef,
                    {
                        reason: normalizedReason,
                        ...(linkedReportId ? { reportReason: normalizedReason } : {}),
                        updatedAt: now(),
                        reasonUpdatedAt: now(),
                        reasonUpdatedByUid: actorUid || null,
                        reasonUpdatedByName: actorName,
                    },
                    { merge: true },
                );
                syncedHistory = true;

                if (linkedReportRef && linkedReportSnap?.exists) {
                    tx.set(
                        linkedReportRef,
                        {
                            reason: normalizedReason,
                            updatedAt: now(),
                            reasonUpdatedAt: now(),
                            reasonUpdatedByUid: actorUid || null,
                            reasonUpdatedByName: actorName,
                        },
                        { merge: true },
                    );
                    syncedReport = true;
                }
            }

            return {
                success: true,
                targetType: normalizedTargetType,
                recordId: normalizedRecordId,
                reason: normalizedReason,
                syncedReport,
                syncedHistory,
            };
        });
    },
);

exports.updatePoliceSensitivity = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { classId, targetType, recordIds, isSensitive } = request.data || {};

        if (!classId || !targetType) {
            throw new HttpsError(
                "invalid-argument",
                "classId and targetType are required.",
            );
        }

        if (typeof isSensitive !== "boolean") {
            throw new HttpsError(
                "invalid-argument",
                "isSensitive must be a boolean.",
            );
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        const normalizedTargetType = String(targetType).trim().toLowerCase();
        if (!["report", "history"].includes(normalizedTargetType)) {
            throw new HttpsError(
                "invalid-argument",
                "targetType must be report or history.",
            );
        }

        const normalizedRecordIds = Array.isArray(recordIds)
            ? [...new Set(recordIds.map((id) => String(id || "").trim()).filter(Boolean))]
            : [];

        if (normalizedRecordIds.length === 0) {
            throw new HttpsError("invalid-argument", "recordIds are required.");
        }

        if (normalizedRecordIds.length > 100) {
            throw new HttpsError(
                "invalid-argument",
                "You can update at most 100 records at once.",
            );
        }

        const { uid: actorUid, token = {} } = request.auth || {};
        const actorName = await resolveTeacherActorName(
            classId,
            token.name || "선생님",
        );

        const sensitivityPatch = {
            isSensitive,
            updatedAt: now(),
            sensitivityUpdatedAt: now(),
            sensitivityUpdatedByUid: actorUid || null,
            sensitivityUpdatedByName: actorName,
        };

        return await db.runTransaction(async (tx) => {
            let syncedReportCount = 0;
            let syncedHistoryCount = 0;

            for (const recordId of normalizedRecordIds) {
                if (normalizedTargetType === "report") {
                    const reportRef = db.doc(`classes/${classId}/policeReports/${recordId}`);
                    const historyRef = db.doc(`classes/${classId}/policeFineHistory/${recordId}`);
                    const [reportSnap, historySnap] = await Promise.all([
                        tx.get(reportRef),
                        tx.get(historyRef),
                    ]);

                    if (!reportSnap.exists) {
                        throw new HttpsError(
                            "not-found",
                            `The police report does not exist: ${recordId}`,
                        );
                    }

                    tx.set(reportRef, sensitivityPatch, { merge: true });
                    syncedReportCount += 1;

                    if (historySnap.exists) {
                        tx.set(historyRef, sensitivityPatch, { merge: true });
                        syncedHistoryCount += 1;
                    }
                } else {
                    const historyRef = db.doc(`classes/${classId}/policeFineHistory/${recordId}`);
                    const historySnap = await tx.get(historyRef);

                    if (!historySnap.exists) {
                        throw new HttpsError(
                            "not-found",
                            `The police history record does not exist: ${recordId}`,
                        );
                    }

                    const historyData = historySnap.data() || {};
                    const linkedReportId = historyData.reportId
                        ? String(historyData.reportId).trim()
                        : "";
                    const linkedReportRef = linkedReportId
                        ? db.doc(`classes/${classId}/policeReports/${linkedReportId}`)
                        : null;
                    const linkedReportSnap = linkedReportRef
                        ? await tx.get(linkedReportRef)
                        : null;

                    tx.set(historyRef, sensitivityPatch, { merge: true });
                    syncedHistoryCount += 1;

                    if (linkedReportRef && linkedReportSnap?.exists) {
                        tx.set(linkedReportRef, sensitivityPatch, { merge: true });
                        syncedReportCount += 1;
                    }
                }
            }

            return {
                success: true,
                targetType: normalizedTargetType,
                recordIds: normalizedRecordIds,
                isSensitive,
                syncedReportCount,
                syncedHistoryCount,
            };
        });
    },
);

exports.hardDeletePoliceFineHistory = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { classId, recordId } = request.data || {};

        if (!classId || !recordId) {
            throw new HttpsError(
                "invalid-argument",
                "classId and recordId are required.",
            );
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        return await db.runTransaction(async (tx) => {
            const historyRef = db.doc(
                `classes/${classId}/policeFineHistory/${recordId}`,
            );
            const historySnap = await tx.get(historyRef);

            if (!historySnap.exists) {
                throw new HttpsError(
                    "not-found",
                    "The police history record does not exist.",
                );
            }

            tx.delete(historyRef);
            tx.delete(db.doc(`classes/${classId}/reflections/${recordId}`));

            return {
                success: true,
                message: "Police history record deleted.",
            };
        });
    },
);

exports.getStudentBalance = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { classId } = await verifyPolicePermission(request);
        const { studentUid } = request.data || {};
        const snap = await db
            .doc(`classes/${classId}/students/${studentUid}`)
            .get();
        return {
            success: true,
            balance: snap.data()?.assets?.cash || 0,
            studentName: snap.data()?.name,
        };
    },
);

exports.checkMultipleStudentBalances = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { classId } = await verifyPolicePermission(request);
        const { checks = [] } = request.data || {};
        const results = [];
        for (const c of checks) {
            const snap = await db
                .doc(`classes/${classId}/students/${c.studentUid}`)
                .get();
            const bal = snap.data()?.assets?.cash || 0;
            results.push({
                studentUid: c.studentUid,
                studentName: snap.data()?.name,
                balance: bal,
                canAfford: bal >= c.requiredAmount,
            });
        }
        return { success: true, results };
    },
);
