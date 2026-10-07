"use strict";

const admin = require("../firebaseAdminCompat");
const crypto = require("crypto");
if (!admin.apps.length) admin.initializeApp();

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");

const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const { getPeriodIncomeSettlementPolicy } = require("../utils/taxPolicy");
const {
    buildPeriodTaxIncomeId,
    normalizeTaxEvent,
} = require("../utils/taxEvent");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const REGION = "asia-northeast3";
const MAX_PREVIEW_LINES = 300;
const DAILY_SCHEDULE_QUERY_LIMIT = 100;
const DAILY_SCHEDULE_CONCURRENCY = 10;
const MONTH_END_CATCHUP_CONCURRENCY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const TAX_SOURCE_LABELS = {
    arcadePrize: "상금",
    assetAdjustment: "자산 조정",
    depositInterest: "예금 이자",
    donationTransfer: "기부금 전환",
    incentivePayment: "인센티브",
    jobBoardReward: "잡보드 보상",
    marketplaceFee: "중고마켓 수수료",
    missionReward: "미션 보상",
    payrollBonus: "성과급",
    payrollSalary: "급여",
    policeFine: "벌금",
    policeReward: "경찰 보상",
    realEstateRent: "부동산 임대료",
    realEstateStateRent: "국유 부동산 임대료",
    realEstateTrade: "부동산 거래세",
    stockDividend: "주식 배당",
    storeConsumptionTax: "상점 소비세",
    taxBillPayment: "세금 고지 납부",
};

const normalizeText = (value) => String(value || "").trim();

const getTaxSourceLabel = (sourceKey) =>
    TAX_SOURCE_LABELS[normalizeText(sourceKey)] || "세금";

const buildPeriodTaxIncomeDescription = ({
    sourceKey,
}) => `${getTaxSourceLabel(sourceKey)} 합계`;

const normalizeDateKey = (value) => {
    const dateKey = normalizeText(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : null;
};

const getKstDateKey = (value = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(value instanceof Date ? value : new Date(value));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
};

const getPreviousKstDateKey = (value = new Date()) =>
    getKstDateKey(new Date(new Date(value).getTime() - DAY_MS));

const isDailyScheduleEnabled = (classData = {}) => {
    const policy = getPeriodIncomeSettlementPolicy(classData);
    return (
        policy.enabled === true &&
        policy.dailyAggregationEnabled === true &&
        policy.scheduleEnabled === true
    );
};

const sanitizeIdPart = (value) =>
    normalizeText(value)
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");

const buildPeriodSettlementId = (startDateKey, endDateKey) =>
    sanitizeIdPart(`tax_period_${startDateKey}__${endDateKey}`);

const buildActivityLineId = (row) =>
    crypto.createHash("sha256").update(row.path).digest("hex").slice(0, 40);


const toActivityRow = (docSnap) => {
    const data = docSnap.data() || {};
    const taxEvent = normalizeTaxEvent(data.taxEvent);
    if (!taxEvent) return null;
    return {
        id: docSnap.id,
        path: docSnap.ref.path,
        ref: docSnap.ref,
        classId: normalizeText(data.classId),
        studentUid: normalizeText(data.studentUid),
        studentName: normalizeText(data.studentName || data.displayName),
        description: normalizeText(data.description),
        occurredAt: data.timestamp || data.createdAt || null,
        incomeTax:
            data.incomeTax && typeof data.incomeTax === "object"
                ? data.incomeTax
                : null,
        taxEvent,
    };
};

const isRowEligibleForPolicy = (row, policy, settlementId = null) => {
    if (!row?.taxEvent || row.taxEvent.voided || !(row.taxEvent.amount > 0)) {
        return false;
    }
    if (
        row.taxEvent.periodSettlementId &&
        row.taxEvent.periodSettlementId !== settlementId
    ) {
        return false;
    }
    if (
        policy.activationDateKey &&
        row.taxEvent.dateKey < policy.activationDateKey
    ) {
        return false;
    }
    if (
        Array.isArray(policy.sourceKeys) &&
        policy.sourceKeys.length > 0 &&
        !policy.sourceKeys.includes(row.taxEvent.sourceKey)
    ) {
        return false;
    }
    return true;
};

const readClassPolicy = async (classId, { requireEnabled = true } = {}) => {
    const classRef = db.doc(`classes/${classId}`);
    const classSnap = await classRef.get();
    if (!classSnap.exists) {
        throw new HttpsError("not-found", "Class not found.");
    }
    const classData = classSnap.data() || {};
    const policy = getPeriodIncomeSettlementPolicy(classData);
    if (requireEnabled && policy.enabled !== true) {
        throw new HttpsError(
            "failed-precondition",
            "Period income settlement is not enabled.",
        );
    }
    return { classRef, classData, policy };
};

const readTaxActivityRows = async ({
    classId,
    startDateKey,
    endDateKey,
    policy,
    settlementId = null,
}) => {
    const snap = await db
        .collectionGroup("activityLogs")
        .where("classId", "==", classId)
        .where("taxEvent.dateKey", ">=", startDateKey)
        .where("taxEvent.dateKey", "<=", endDateKey)
        .orderBy("taxEvent.dateKey", "asc")
        .get();

    return snap.docs
        .map(toActivityRow)
        .filter((row) => isRowEligibleForPolicy(row, policy, settlementId));
};

const groupRows = (rows = []) => {
    const groups = new Map();
    rows.forEach((row) => {
        const { taxEvent } = row;
        const key = `${taxEvent.taxCategory}::${taxEvent.sourceKey}`;
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                taxCategory: taxEvent.taxCategory,
                sourceKey: taxEvent.sourceKey,
                taxType: taxEvent.taxType,
                amount: 0,
                taxableAmount: 0,
                detailCount: 0,
                rows: [],
            });
        }
        const group = groups.get(key);
        group.amount += Number(taxEvent.amount || 0);
        group.taxableAmount += Number(taxEvent.taxableAmount || 0);
        group.detailCount += 1;
        group.rows.push(row);
    });
    return Array.from(groups.values()).sort((left, right) =>
        left.key.localeCompare(right.key),
    );
};

const toPublicLine = (row) => ({
    id: row.id,
    classId: row.classId || null,
    activityLogPath: row.path,
    studentUid: row.studentUid || null,
    studentName: row.studentName || null,
    description: row.description || "",
    sourceKey: row.taxEvent.sourceKey,
    taxCategory: row.taxEvent.taxCategory,
    taxType: row.taxEvent.taxType,
    amount: row.taxEvent.amount,
    taxableAmount: row.taxEvent.taxableAmount,
    taxRate: row.taxEvent.taxRate,
    dateKey: row.taxEvent.dateKey,
});

const buildPreview = ({ rows, groups, startDateKey, endDateKey }) => ({
    startDateKey,
    endDateKey,
    detailCount: rows.length,
    amount: groups.reduce((sum, group) => sum + group.amount, 0),
    taxableAmount: groups.reduce(
        (sum, group) => sum + group.taxableAmount,
        0,
    ),
    groups: groups.map((group) => ({
        taxCategory: group.taxCategory,
        sourceKey: group.sourceKey,
        taxType: group.taxType,
        amount: group.amount,
        taxableAmount: group.taxableAmount,
        detailCount: group.detailCount,
    })),
    lines: rows.slice(0, MAX_PREVIEW_LINES).map(toPublicLine),
    linesTruncated: rows.length > MAX_PREVIEW_LINES,
});

const validatePeriod = (startValue, endValue) => {
    const startDateKey = normalizeDateKey(startValue);
    const endDateKey = normalizeDateKey(endValue);
    if (!startDateKey || !endDateKey || startDateKey > endDateKey) {
        throw new HttpsError("invalid-argument", "A valid date range is required.");
    }
    return { startDateKey, endDateKey };
};

const buildSettlementLinePayload = (row) => ({
    ...toPublicLine(row),
    occurredAt: row.occurredAt,
    incomeTax: row.incomeTax || null,
});

const readExistingTaxIncomeMap = async (refs = []) => {
    if (!refs.length) return new Map();
    const snaps = await db.getAll(...refs);
    return new Map(
        snaps.map((snap) => [snap.ref.id, snap.exists ? snap.data() || {} : null]),
    );
};

const finalizePeriodCore = async ({
    classId,
    startDateKey,
    endDateKey,
    actorUid,
    requirePolicyEnabled = true,
    allowEmpty = false,
}) => {
    const { policy } = await readClassPolicy(classId, { requireEnabled: requirePolicyEnabled });
    const settlementId = buildPeriodSettlementId(startDateKey, endDateKey);
    const settlementRef = db.doc(
        `classes/${classId}/taxPeriodSettlements/${settlementId}`,
    );
    const existingSettlementSnap = await settlementRef.get();
    const existingSettlement = existingSettlementSnap.exists
        ? existingSettlementSnap.data() || {}
        : null;

    if (
        existingSettlement?.status === "consumed" ||
        existingSettlement?.monthEndSettlementId
    ) {
        throw new HttpsError(
            "failed-precondition",
            "This period settlement is already used by month-end settlement.",
        );
    }

    try {
        const rows = await readTaxActivityRows({
            classId,
            startDateKey,
            endDateKey,
            policy,
            settlementId,
        });
        const groups = groupRows(rows);
        if (!rows.length && !existingSettlement) {
            if (allowEmpty) {
                return {
                    settlementId,
                    status: "skipped",
                    startDateKey,
                    endDateKey,
                    detailCount: 0,
                    amount: 0,
                };
            }
            throw new HttpsError(
                "failed-precondition",
                "No unsettled tax activity logs were found.",
            );
        }

        await settlementRef.set({
            classId,
            startDateKey,
            endDateKey,
            status: existingSettlement ? "revising" : "preparing",
            createdAt:
                existingSettlement?.createdAt || FieldValue.serverTimestamp(),
            createdBy: existingSettlement?.createdBy || actorUid || null,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actorUid || null,
        }, { merge: true });

        const oldLineSnap = await settlementRef.collection("lines").get();
        const oldTaxIncomeIds = Array.isArray(existingSettlement?.taxIncomeIds)
            ? existingSettlement.taxIncomeIds
            : [];
        const taxIncomeRefs = groups.map((group) =>
            db.doc(
                `classes/${classId}/taxIncomes/${buildPeriodTaxIncomeId({
                    settlementId,
                    taxCategory: group.taxCategory,
                    sourceKey: group.sourceKey,
                })}`,
            ),
        );
        const existingIncomeMap = await readExistingTaxIncomeMap(taxIncomeRefs);
        const nextTaxIncomeIds = taxIncomeRefs.map((ref) => ref.id);
        const removedTaxIncomeIds = oldTaxIncomeIds.filter(
            (id) => !nextTaxIncomeIds.includes(id),
        );

        const writer = db.bulkWriter();
        oldLineSnap.docs.forEach((lineDoc) => writer.delete(lineDoc.ref));
        removedTaxIncomeIds.forEach((id) =>
            writer.delete(db.doc(`classes/${classId}/taxIncomes/${id}`)),
        );

        rows.forEach((row) => {
            writer.set(
                settlementRef.collection("lines").doc(buildActivityLineId(row)),
                buildSettlementLinePayload(row),
            );
            writer.set(row.ref, {
                taxEvent: {
                    ...row.taxEvent,
                    periodSettlementId: settlementId,
                    periodSettledAt: FieldValue.serverTimestamp(),
                },
            }, { merge: true });
        });

        groups.forEach((group, index) => {
            const ref = taxIncomeRefs[index];
            const existingIncome = existingIncomeMap.get(ref.id);
            writer.set(ref, {
                amount: group.amount,
                description: buildPeriodTaxIncomeDescription({
                    startDateKey,
                    endDateKey,
                    sourceKey: group.sourceKey,
                }),
                source: "period_tax_settlement",
                sourceKey: group.sourceKey,
                taxCategory: group.taxCategory,
                taxType: group.taxType,
                studentUid: null,
                studentName: null,
                createdBy: actorUid || null,
                periodSettlementId: settlementId,
                periodStart: startDateKey,
                periodEnd: endDateKey,
                isAggregated: true,
                detailCount: group.detailCount,
                createdAt:
                    existingIncome?.createdAt || FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        });

        await writer.close();

        const preview = buildPreview({
            rows,
            groups,
            startDateKey,
            endDateKey,
        });
        await settlementRef.set({
            status: "finalized",
            amount: preview.amount,
            taxableAmount: preview.taxableAmount,
            detailCount: preview.detailCount,
            taxIncomeIds: nextTaxIncomeIds,
            monthEndSettlementId: null,
            finalizedAt: FieldValue.serverTimestamp(),
            finalizedBy: actorUid || null,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        return {
            settlementId,
            status: "finalized",
            ...preview,
        };
    } catch (error) {
        await settlementRef.set({
            status: "failed",
            errorMessage: normalizeText(error?.message).slice(0, 500),
            failedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        throw error;
    }
};

const getOutstandingDailyDateKeys = (rows = []) =>
    Array.from(
        new Set(
            rows
                .map((row) => normalizeDateKey(row?.taxEvent?.dateKey))
                .filter(Boolean),
        ),
    ).sort();

const finalizeOutstandingDailySettlements = async ({
    classId,
    actorUid,
    throughDateKey = getPreviousKstDateKey(),
}) => {
    const normalizedThroughDateKey = normalizeDateKey(throughDateKey);
    if (!normalizedThroughDateKey) {
        throw new HttpsError(
            "invalid-argument",
            "A valid catch-up end date is required.",
        );
    }

    const { policy } = await readClassPolicy(classId);
    const startDateKey = policy.activationDateKey || "1970-01-01";
    if (startDateKey > normalizedThroughDateKey) {
        return { dateKeys: [], finalizedCount: 0 };
    }

    const outstandingRows = await readTaxActivityRows({
        classId,
        startDateKey,
        endDateKey: normalizedThroughDateKey,
        policy,
    });
    const dateKeys = getOutstandingDailyDateKeys(outstandingRows);
    const results = [];

    for (let index = 0; index < dateKeys.length; index += MONTH_END_CATCHUP_CONCURRENCY) {
        const batch = dateKeys.slice(index, index + MONTH_END_CATCHUP_CONCURRENCY);
        const batchResults = await Promise.all(
            batch.map((dateKey) =>
                finalizePeriodCore({
                    classId,
                    startDateKey: dateKey,
                    endDateKey: dateKey,
                    actorUid,
                    allowEmpty: true,
                }),
            ),
        );
        results.push(...batchResults);
    }

    return {
        dateKeys,
        finalizedCount: results.filter((result) => result.status === "finalized").length,
    };
};

const settleScheduledClass = async ({ classId, classData, dateKey }) => {
    if (!isDailyScheduleEnabled(classData)) {
        return { classId, status: "disabled" };
    }
    const result = await finalizePeriodCore({
        classId,
        startDateKey: dateKey,
        endDateKey: dateKey,
        actorUid: "system:daily-tax-settlement",
        allowEmpty: true,
    });
    return { classId, ...result };
};

exports.scheduleDailyTaxPeriodSettlements = onSchedule(
    {
        schedule: "15 0 * * *",
        timeZone: "Asia/Seoul",
        region: REGION,
        timeoutSeconds: 540,
        memory: "1GiB",
        maxInstances: 1,
    },
    async (event) => {
        const dateKey = getPreviousKstDateKey(event.scheduleTime || new Date());
        const results = [];
        let lastDoc = null;

        do {
            let query = db
                .collection("classes")
                .where("taxPolicy.periodIncomeSettlement.scheduleEnabled", "==", true)
                .limit(DAILY_SCHEDULE_QUERY_LIMIT);
            if (lastDoc) query = query.startAfter(lastDoc);

            const classSnap = await query.get();
            if (classSnap.empty) break;

            for (
                let offset = 0;
                offset < classSnap.docs.length;
                offset += DAILY_SCHEDULE_CONCURRENCY
            ) {
                const chunk = classSnap.docs.slice(
                    offset,
                    offset + DAILY_SCHEDULE_CONCURRENCY,
                );
                const settled = await Promise.allSettled(
                    chunk.map((classDoc) =>
                        settleScheduledClass({
                            classId: classDoc.id,
                            classData: classDoc.data() || {},
                            dateKey,
                        }),
                    ),
                );
                settled.forEach((result, index) => {
                    results.push({ classId: chunk[index].id, result });
                });
            }

            lastDoc = classSnap.docs[classSnap.docs.length - 1];
            if (classSnap.size < DAILY_SCHEDULE_QUERY_LIMIT) break;
        } while (lastDoc);

        const summary = results.reduce(
            (acc, entry) => {
                if (entry.result.status === "rejected") {
                    acc.failed += 1;
                    console.error("[dailyTaxSettlement] class failed", {
                        classId: entry.classId,
                        dateKey,
                        message: normalizeText(entry.result.reason?.message).slice(0, 500),
                    });
                    return acc;
                }
                const status = entry.result.value?.status;
                if (status === "finalized") acc.finalized += 1;
                else if (status === "skipped") acc.empty += 1;
                else acc.disabled += 1;
                return acc;
            },
            { finalized: 0, empty: 0, disabled: 0, failed: 0 },
        );

        console.log("[dailyTaxSettlement] completed", { dateKey, ...summary });
        if (summary.failed > 0) {
            throw new Error(
                `Daily tax settlement failed for ${summary.failed} classes.`,
            );
        }
        return { dateKey, ...summary };
    },
);

exports.previewTaxPeriodSettlement = onCall(
    {
        region: REGION,
        timeoutSeconds: 120,
        memory: "512MiB",
    },
    async (request) => {
        const classId = normalizeText(request.data?.classId);
        assertTeacherOrAdminFromClaims(request, { classId });
        const { startDateKey, endDateKey } = validatePeriod(
            request.data?.startDateKey,
            request.data?.endDateKey,
        );
        const { policy } = await readClassPolicy(classId);
        const settlementId = buildPeriodSettlementId(startDateKey, endDateKey);
        const settlementSnap = await db.doc(
            `classes/${classId}/taxPeriodSettlements/${settlementId}`,
        ).get();
        const settlement = settlementSnap.exists ? settlementSnap.data() || {} : null;
        if (settlement?.status === "consumed" || settlement?.monthEndSettlementId) {
            throw new HttpsError(
                "failed-precondition",
                "This period is already consumed by month-end settlement.",
            );
        }
        const rows = await readTaxActivityRows({
            classId,
            startDateKey,
            endDateKey,
            policy,
            settlementId,
        });
        return {
            settlementId,
            ...buildPreview({
                rows,
                groups: groupRows(rows),
                startDateKey,
                endDateKey,
            }),
        };
    },
);

exports.finalizeTaxPeriodSettlement = onCall(
    {
        region: REGION,
        timeoutSeconds: 540,
        memory: "1GiB",
    },
    async (request) => {
        const classId = normalizeText(request.data?.classId);
        const auth = assertTeacherOrAdminFromClaims(request, { classId });
        const { startDateKey, endDateKey } = validatePeriod(
            request.data?.startDateKey,
            request.data?.endDateKey,
        );
        return finalizePeriodCore({
            classId,
            startDateKey,
            endDateKey,
            actorUid: auth.uid,
        });
    },
);

exports.rebuildTaxPeriodSettlement = onCall(
    {
        region: REGION,
        timeoutSeconds: 540,
        memory: "1GiB",
    },
    async (request) => {
        const classId = normalizeText(request.data?.classId);
        const auth = assertTeacherOrAdminFromClaims(request, { classId });
        const { startDateKey, endDateKey } = validatePeriod(
            request.data?.startDateKey,
            request.data?.endDateKey,
        );
        return finalizePeriodCore({
            classId,
            startDateKey,
            endDateKey,
            actorUid: auth.uid,
        });
    },
);

exports.getTaxPeriodSettlementHistory = onCall(
    {
        region: REGION,
        timeoutSeconds: 60,
        memory: "256MiB",
    },
    async (request) => {
        const classId = normalizeText(request.data?.classId);
        assertTeacherOrAdminFromClaims(request, { classId });
        const limit = Math.min(
            100,
            Math.max(1, Number(request.data?.limit || 30)),
        );
        const snap = await db
            .collection(`classes/${classId}/taxPeriodSettlements`)
            .orderBy("updatedAt", "desc")
            .limit(limit)
            .get();
        return {
            rows: snap.docs.map((docSnap) => ({
                id: docSnap.id,
                ...(docSnap.data() || {}),
            })),
        };
    },
);

exports.onTaxActivityLogDeleted = onDocumentDeleted(
    {
        document:
            "classes/{classId}/students/{studentUid}/activityLogs/{activityLogId}",
        region: REGION,
        timeoutSeconds: 540,
        memory: "512MiB",
    },
    async (event) => {
        const before = event.data?.data() || {};
        const taxEvent = normalizeTaxEvent(before.taxEvent);
        if (!taxEvent) return null;

        const { classId } = event.params;

        if (!taxEvent.periodSettlementId) return null;
        const settlementRef = db.doc(
            `classes/${classId}/taxPeriodSettlements/${taxEvent.periodSettlementId}`,
        );
        const settlementSnap = await settlementRef.get();
        if (!settlementSnap.exists) return null;
        const settlement = settlementSnap.data() || {};
        if (settlement.status === "consumed" || settlement.monthEndSettlementId) {
            await settlementRef.set({
                integrityWarning: true,
                integrityWarningAt: FieldValue.serverTimestamp(),
                integrityWarningReason: "consumed_activity_log_deleted",
            }, { merge: true });
            return null;
        }

        await finalizePeriodCore({
            classId,
            startDateKey: settlement.startDateKey,
            endDateKey: settlement.endDateKey,
            actorUid: null,
            requirePolicyEnabled: false,
        });
        return null;
    },
);

module.exports.__private = {
    buildActivityLineId,
    buildPeriodSettlementId,
    buildPeriodTaxIncomeDescription,
    buildPreview,
    getKstDateKey,
    getPreviousKstDateKey,
    getOutstandingDailyDateKeys,
    groupRows,
    isDailyScheduleEnabled,
    finalizeOutstandingDailySettlements,
    normalizeDateKey,
    toActivityRow,
};
