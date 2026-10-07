"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const { getTaxBillLateFeePolicy, getTaxPolicy } = require("../utils/taxPolicy");

if (!admin.apps.length) admin.initializeApp();
dayjs.extend(utc);
dayjs.extend(timezone);

const db = admin.firestore();

const REGION = "asia-northeast3";
const KST = "Asia/Seoul";
const INCOME_SETTLEMENT_SUMMARY_VERSION = 1;
const INCOME_SETTLEMENT_BILL_SUMMARY_VERSION = 1;
const INCOME_SETTLEMENT_META_PATH = (classId) =>
    `classes/${classId}/analytics/incomeSettlement`;
const INCOME_SETTLEMENT_DAILY_COLLECTION_PATH = (classId) =>
    `${INCOME_SETTLEMENT_META_PATH(classId)}/dailyStudents`;
const INCOME_SETTLEMENT_DAY_STATUS_PATH = (classId, dayKey) =>
    `${INCOME_SETTLEMENT_META_PATH(classId)}/days/${dayKey}`;
const INCOME_SETTLEMENT_BILL_SUMMARY_COLLECTION_PATH = (classId) =>
    `${INCOME_SETTLEMENT_META_PATH(classId)}/billStudents`;
const INCOME_SETTLEMENT_BILL_SUMMARY_DOC_PATH = (classId, studentUid) =>
    `${INCOME_SETTLEMENT_BILL_SUMMARY_COLLECTION_PATH(classId)}/${studentUid}`;
const SUPPORTED_SOURCE_KEYS = new Set([
    "missionReward",
    "jobBoardReward",
    "policeReward",
    "assetAdjustment",
    "arcadePrize",
    "dividend",
    "stockCapitalGain",
]);
const ACTIVE_ACTIVITY_SOURCES = new Set([
    "missionReward",
    "jobBoardReward",
    "assetAdjustment",
    "arcadePrize",
    "dividend",
]);
const LEGACY_ACTIVITY_FALLBACK_SOURCES = new Set([
    "missionReward",
    "assetAdjustment",
]);

const toSafeNumber = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
};

const normalizeValue = (value) => String(value || "").trim();

const getDayKeyFromValue = (value) => {
    const dateValue = toDateValue(value);
    return dateValue ? dayjs(dateValue).tz(KST).format("YYYY-MM-DD") : null;
};

const getDayKeysForRange = (startMs, endMs) => {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
        return [];
    }

    const dayKeys = [];
    let cursor = dayjs(startMs).tz(KST).startOf("day");
    const endDay = dayjs(endMs).tz(KST).startOf("day");

    while (!cursor.isAfter(endDay, "day")) {
        dayKeys.push(cursor.format("YYYY-MM-DD"));
        cursor = cursor.add(1, "day");
    }

    return dayKeys;
};

const getDailySummaryDocId = (dayKey, studentUid) =>
    sanitizeIdPart(`${dayKey}__${studentUid}`);

const sanitizeIdPart = (value) =>
    String(value || "")
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");

const buildIncomeSettlementBillId = ({
    periodKey,
    studentUid,
    sequence = 1,
}) =>
    sanitizeIdPart(`income_settlement__${periodKey}__${studentUid}__${sequence}`);

const toDateValue = (value) => {
    if (!value) return null;

    if (typeof value?.toDate === "function") {
        const dateValue = value.toDate();
        return dateValue instanceof Date && !Number.isNaN(dateValue.getTime())
            ? dateValue
            : null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === "number") {
        const dateValue = new Date(value);
        return Number.isNaN(dateValue.getTime()) ? null : dateValue;
    }

    if (typeof value === "string") {
        const dateValue = new Date(value);
        return Number.isNaN(dateValue.getTime()) ? null : dateValue;
    }

    if (typeof value?.seconds === "number") {
        return new Date(
            value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6),
        );
    }

    return null;
};

const getRecordTimeMs = (value) => {
    const dateValue = toDateValue(value);
    return dateValue ? dateValue.getTime() : null;
};

const getSourceRecordTimeMs = (sourceType, record) => {
    if (sourceType === "policeReward") {
        return getRecordTimeMs(record?.appliedAt);
    }

    if (sourceType === "stockCapitalGain") {
        return getRecordTimeMs(record?.createdAt);
    }

    return getRecordTimeMs(record?.timestamp) || getRecordTimeMs(record?.createdAt);
};

const getIncomeSettlementMeta = (record = {}) => {
    const meta = record?.incomeSettlement;
    return meta && typeof meta === "object" ? meta : null;
};

const resolveActivitySettlementAmount = ({ sourceType, log }) => {
    const meta = getIncomeSettlementMeta(log);
    if (meta?.sourceKey === sourceType) {
        return toSafeNumber(meta.taxableAmount ?? meta.grossAmount ?? log.amount);
    }

    return toSafeNumber(log.amount);
};

const matchesLegacyActivitySource = ({ sourceType, log, currencyUnit }) => {
    if (!LEGACY_ACTIVITY_FALLBACK_SOURCES.has(sourceType)) {
        return false;
    }

    if (sourceType === "missionReward") {
        return (
            log.type === "income" &&
            log.category === "mission" &&
            toSafeNumber(log.amount) > 0
        );
    }

    if (sourceType === "assetAdjustment") {
        return (
            log.type === "admin_adjustment" &&
            log.category === "increment" &&
            toSafeNumber(log.amount) > 0 &&
            normalizeValue(log.currency) === normalizeValue(currencyUnit)
        );
    }

    return false;
};

const periodsOverlap = (startA, endA, startB, endB) =>
    Number(startA) <= Number(endB) && Number(endA) >= Number(startB);

const formatPeriodLabel = (startValue, endValue) => {
    const start = toDateValue(startValue);
    const end = toDateValue(endValue);
    if (!start || !end) return null;

    const formatPart = (dateValue) => {
        const year = dateValue.getFullYear();
        const month = `${dateValue.getMonth() + 1}`.padStart(2, "0");
        const day = `${dateValue.getDate()}`.padStart(2, "0");
        return `${year}.${month}.${day}`;
    };

    return `${formatPart(start)} ~ ${formatPart(end)}`;
};

const getBillSequence = (bill) => {
    const sequence = Number(bill?.billSequence);
    if (Number.isFinite(sequence) && sequence > 0) {
        return sequence;
    }
    return 1;
};

const isIncomeSettlementBill = (record = {}) =>
    normalizeValue(record.billKind) === "income_settlement";

const buildPolicySnapshot = (taxPolicy, selectedSourceKeys) => {
    const next = {};

    selectedSourceKeys.forEach((sourceKey) => {
        next[sourceKey] = taxPolicy?.incomeSettlement?.[sourceKey] || null;
    });

    return next;
};

const buildEmptyBreakdown = (sourceType) => ({
    sourceType,
    grossAmount: 0,
    exemptionThreshold: 0,
    taxBase: 0,
    taxRate: 0,
    taxAmount: 0,
    recordCount: 0,
});

const buildEmptySummarySourceTotal = () => ({
    grossAmount: 0,
    recordCount: 0,
});

const normalizeSummarySourceTotals = (sourceTotals = {}) => {
    const next = {};

    SUPPORTED_SOURCE_KEYS.forEach((sourceKey) => {
        const sourceTotal =
            sourceTotals && typeof sourceTotals === "object"
                ? sourceTotals[sourceKey]
                : null;
        const grossAmount = toSafeNumber(sourceTotal?.grossAmount);
        const recordCount = Math.max(
            0,
            Math.trunc(toSafeNumber(sourceTotal?.recordCount)),
        );

        if (grossAmount !== 0 || recordCount !== 0) {
            next[sourceKey] = {
                grossAmount,
                recordCount,
            };
        }
    });

    return next;
};

const hasNormalizedSummarySourceTotals = (sourceTotals = {}) =>
    Object.values(sourceTotals).some(
        (sourceTotal) =>
            toSafeNumber(sourceTotal?.grossAmount) !== 0 ||
            toSafeNumber(sourceTotal?.recordCount) !== 0,
    );

const addSummaryContribution = ({
    summaryPatchByDocId,
    studentUid,
    dayKey,
    sourceKey,
    grossAmount,
    recordCount = 1,
}) => {
    if (
        !summaryPatchByDocId ||
        !dayKey ||
        !studentUid ||
        !SUPPORTED_SOURCE_KEYS.has(sourceKey)
    ) {
        return;
    }

    const docId = getDailySummaryDocId(dayKey, studentUid);
    if (!docId) return;

    if (!summaryPatchByDocId.has(docId)) {
        summaryPatchByDocId.set(docId, {
            dayKey,
            studentUid,
            sourceTotals: {},
        });
    }

    const current = summaryPatchByDocId.get(docId);
    const sourceTotals = current.sourceTotals || {};
    const currentTotal = sourceTotals[sourceKey] || buildEmptySummarySourceTotal();

    sourceTotals[sourceKey] = {
        grossAmount: toSafeNumber(currentTotal.grossAmount) + toSafeNumber(grossAmount),
        recordCount:
            Math.max(0, Math.trunc(toSafeNumber(currentTotal.recordCount))) +
            Math.max(0, Math.trunc(toSafeNumber(recordCount))),
    };
    current.sourceTotals = sourceTotals;
};

const getActivitySummaryContribution = ({ log, currencyUnit }) => {
    const studentUid = normalizeValue(log?.studentUid);
    const dayKey = getDayKeyFromValue(log?.timestamp || log?.createdAt);
    if (!studentUid || !dayKey) {
        return null;
    }

    const meta = getIncomeSettlementMeta(log);
    const metaSourceKey = normalizeValue(meta?.sourceKey);
    if (ACTIVE_ACTIVITY_SOURCES.has(metaSourceKey)) {
        const grossAmount = resolveActivitySettlementAmount({
            sourceType: metaSourceKey,
            log,
        });

        if (meta?.eligible !== false && grossAmount > 0) {
            return {
                studentUid,
                dayKey,
                sourceKey: metaSourceKey,
                grossAmount,
                recordCount: 1,
            };
        }

        return null;
    }

    for (const sourceKey of LEGACY_ACTIVITY_FALLBACK_SOURCES) {
        if (
            matchesLegacyActivitySource({
                sourceType: sourceKey,
                log,
                currencyUnit,
            })
        ) {
            return {
                studentUid,
                dayKey,
                sourceKey,
                grossAmount: toSafeNumber(log.amount),
                recordCount: 1,
            };
        }
    }

    return null;
};

const getTradeSummaryContribution = (trade = {}) => {
    const studentUid =
        normalizeValue(trade.studentUid) || normalizeValue(trade.userId);
    const dayKey = getDayKeyFromValue(trade.createdAt);
    const grossAmount = Number(trade.realizedGainInClassCurrency);

    if (
        !studentUid ||
        !dayKey ||
        trade.type !== "STOCK_SELL" ||
        !Number.isFinite(grossAmount)
    ) {
        return null;
    }

    return {
        studentUid,
        dayKey,
        sourceKey: "stockCapitalGain",
        grossAmount,
        recordCount: 1,
    };
};

const getPoliceSummaryContribution = (record = {}) => {
    const studentUid = normalizeValue(record.studentUid);
    const dayKey = getDayKeyFromValue(record.appliedAt);

    if (
        !studentUid ||
        !dayKey ||
        record.type !== "reward" ||
        record.status !== "applied" ||
        record.isCancelled === true ||
        toSafeNumber(record.amountSigned) <= 0
    ) {
        return null;
    }

    return {
        studentUid,
        dayKey,
        sourceKey: "policeReward",
        grossAmount: toSafeNumber(record.amountSigned),
        recordCount: 1,
    };
};

const buildIncomeSettlementSummaryPatchFromRawResults = ({
    activityLogsByStudent,
    tradeHistoryByStudent,
    policeRewards,
    sourceKeys,
    currencyUnit,
}) => {
    const summaryPatchByDocId = new Map();
    const selectedSourceKeys = new Set(
        (sourceKeys || []).filter((sourceKey) => SUPPORTED_SOURCE_KEYS.has(sourceKey)),
    );

    if (selectedSourceKeys.size === 0) {
        return summaryPatchByDocId;
    }

    for (const [studentUid, logs] of activityLogsByStudent.entries()) {
        (logs || []).forEach((log) => {
            const contribution = getActivitySummaryContribution({
                log: {
                    ...log,
                    studentUid: log.studentUid || studentUid,
                },
                currencyUnit,
            });

            if (!contribution || !selectedSourceKeys.has(contribution.sourceKey)) {
                return;
            }

            addSummaryContribution({
                summaryPatchByDocId,
                ...contribution,
            });
        });
    }

    for (const [studentUid, trades] of tradeHistoryByStudent.entries()) {
        (trades || []).forEach((trade) => {
            const contribution = getTradeSummaryContribution({
                ...trade,
                studentUid: trade.studentUid || studentUid,
            });

            if (!contribution || !selectedSourceKeys.has(contribution.sourceKey)) {
                return;
            }

            addSummaryContribution({
                summaryPatchByDocId,
                ...contribution,
            });
        });
    }

    (policeRewards || []).forEach((record) => {
        const contribution = getPoliceSummaryContribution(record);
        if (!contribution || !selectedSourceKeys.has(contribution.sourceKey)) {
            return;
        }

        addSummaryContribution({
            summaryPatchByDocId,
            ...contribution,
        });
    });

    return summaryPatchByDocId;
};

const buildIncomeSettlementDaySourceStates = (sourceKeys, stateBuilder) =>
    sourceKeys.reduce((accumulator, sourceKey) => {
        accumulator[sourceKey] = {
            version: INCOME_SETTLEMENT_SUMMARY_VERSION,
            ...stateBuilder(sourceKey),
        };
        return accumulator;
    }, {});

const readIncomeSettlementDayStatusMap = async ({ classId, dayKeys = [] }) => {
    const uniqueDayKeys = Array.from(new Set((dayKeys || []).filter(Boolean)));
    if (uniqueDayKeys.length === 0) {
        return new Map();
    }

    const refs = uniqueDayKeys.map((dayKey) =>
        db.doc(INCOME_SETTLEMENT_DAY_STATUS_PATH(classId, dayKey)),
    );
    const snaps = await db.getAll(...refs);
    const statusMap = new Map();

    snaps.forEach((snap, index) => {
        const dayKey = uniqueDayKeys[index];
        statusMap.set(dayKey, snap.exists ? snap.data() || {} : null);
    });

    return statusMap;
};

const evaluateIncomeSettlementSummaryAvailability = ({
    dayStatusMap,
    dayKeys,
    sourceKeys,
}) => {
    for (const dayKey of dayKeys) {
        const dayStatus = dayStatusMap.get(dayKey);
        if (!dayStatus) {
            return {
                ready: false,
                reason: "missing_day_status",
                dayKey,
            };
        }

        for (const sourceKey of sourceKeys) {
            const sourceState = dayStatus?.sourceStates?.[sourceKey];
            const version = Number(
                sourceState?.version || dayStatus?.summaryVersion || 0,
            );

            if (version !== INCOME_SETTLEMENT_SUMMARY_VERSION) {
                return {
                    ready: false,
                    reason: "summary_version_mismatch",
                    dayKey,
                    sourceKey,
                    version,
                };
            }

            if (sourceState?.dirty === true) {
                return {
                    ready: false,
                    reason: "summary_dirty",
                    dayKey,
                    sourceKey,
                };
            }

            if (sourceState?.ready !== true) {
                return {
                    ready: false,
                    reason: "summary_not_ready",
                    dayKey,
                    sourceKey,
                };
            }
        }
    }

    return { ready: true };
};

const markIncomeSettlementSummaryDirty = async ({
    classId,
    dirtyTargets = [],
    reason = null,
}) => {
    const dayToSourceKeys = new Map();

    (dirtyTargets || []).forEach(({ dayKey, sourceKey }) => {
        if (!dayKey || !SUPPORTED_SOURCE_KEYS.has(sourceKey)) {
            return;
        }

        if (!dayToSourceKeys.has(dayKey)) {
            dayToSourceKeys.set(dayKey, new Set());
        }

        dayToSourceKeys.get(dayKey).add(sourceKey);
    });

    if (dayToSourceKeys.size === 0) {
        return null;
    }

    const bulkWriter = db.bulkWriter();
    dayToSourceKeys.forEach((sourceKeySet, dayKey) => {
        const sourceKeys = Array.from(sourceKeySet);
        bulkWriter.set(
            db.doc(INCOME_SETTLEMENT_DAY_STATUS_PATH(classId, dayKey)),
            {
                dayKey,
                summaryVersion: INCOME_SETTLEMENT_SUMMARY_VERSION,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                sourceStates: buildIncomeSettlementDaySourceStates(
                    sourceKeys,
                    () => ({
                        ready: false,
                        dirty: true,
                        reason,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }),
                ),
            },
            { merge: true },
        );
    });

    await bulkWriter.close();
    return {
        dirtyDayCount: dayToSourceKeys.size,
    };
};

const rewriteIncomeSettlementDailySummaryRange = async ({
    classId,
    dayKeys = [],
    sourceKeys = [],
    summaryPatchByDocId,
}) => {
    const uniqueDayKeys = Array.from(new Set((dayKeys || []).filter(Boolean)));
    const selectedSourceKeys = Array.from(
        new Set((sourceKeys || []).filter((sourceKey) => SUPPORTED_SOURCE_KEYS.has(sourceKey))),
    );

    if (uniqueDayKeys.length === 0 || selectedSourceKeys.length === 0) {
        return {
            writtenDocCount: 0,
            deletedDocCount: 0,
            dayCount: uniqueDayKeys.length,
            sourceCount: selectedSourceKeys.length,
        };
    }

    const dailySummaryCollection = db.collection(
        INCOME_SETTLEMENT_DAILY_COLLECTION_PATH(classId),
    );
    const existingSnapshot = await dailySummaryCollection
        .where("dayKey", ">=", uniqueDayKeys[0])
        .where("dayKey", "<=", uniqueDayKeys[uniqueDayKeys.length - 1])
        .select("dayKey", "studentUid", "sourceTotals")
        .get();

    const existingByDocId = new Map(
        existingSnapshot.docs.map((docSnap) => [docSnap.id, docSnap]),
    );
    const targetDocIds = new Set([
        ...existingByDocId.keys(),
        ...summaryPatchByDocId.keys(),
    ]);

    let writtenDocCount = 0;
    let deletedDocCount = 0;
    const bulkWriter = db.bulkWriter();

    targetDocIds.forEach((docId) => {
        const existingDoc = existingByDocId.get(docId) || null;
        const existingData = existingDoc?.data() || {};
        const mergedSourceTotals = normalizeSummarySourceTotals(
            existingData.sourceTotals,
        );

        selectedSourceKeys.forEach((sourceKey) => {
            delete mergedSourceTotals[sourceKey];
        });

        const nextPatch = summaryPatchByDocId.get(docId) || null;
        const nextSourceTotals = normalizeSummarySourceTotals(
            nextPatch?.sourceTotals,
        );
        selectedSourceKeys.forEach((sourceKey) => {
            if (nextSourceTotals[sourceKey]) {
                mergedSourceTotals[sourceKey] = nextSourceTotals[sourceKey];
            }
        });

        if (!hasNormalizedSummarySourceTotals(mergedSourceTotals)) {
            if (existingDoc) {
                bulkWriter.delete(existingDoc.ref);
                deletedDocCount += 1;
            }
            return;
        }

        const dayKey = nextPatch?.dayKey || normalizeValue(existingData.dayKey);
        const studentUid =
            nextPatch?.studentUid || normalizeValue(existingData.studentUid);
        if (!dayKey || !studentUid) {
            return;
        }

        bulkWriter.set(
            existingDoc?.ref || dailySummaryCollection.doc(docId),
            {
                classId,
                dayKey,
                studentUid,
                summaryVersion: INCOME_SETTLEMENT_SUMMARY_VERSION,
                sourceTotals: mergedSourceTotals,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: false },
        );
        writtenDocCount += 1;
    });

    uniqueDayKeys.forEach((dayKey) => {
        bulkWriter.set(
            db.doc(INCOME_SETTLEMENT_DAY_STATUS_PATH(classId, dayKey)),
            {
                dayKey,
                summaryVersion: INCOME_SETTLEMENT_SUMMARY_VERSION,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                sourceStates: buildIncomeSettlementDaySourceStates(
                    selectedSourceKeys,
                    () => ({
                        ready: true,
                        dirty: false,
                        refreshedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }),
                ),
            },
            { merge: true },
        );
    });

    await bulkWriter.close();

    return {
        writtenDocCount,
        deletedDocCount,
        dayCount: uniqueDayKeys.length,
        sourceCount: selectedSourceKeys.length,
    };
};

const readIncomeSettlementDailySummaryByStudent = async ({
    classId,
    dayKeys = [],
    targetStudentUidSet,
}) => {
    const uniqueDayKeys = Array.from(new Set((dayKeys || []).filter(Boolean)));
    if (uniqueDayKeys.length === 0) {
        return {
            byStudent: new Map(),
            docCount: 0,
        };
    }

    const snapshot = await db
        .collection(INCOME_SETTLEMENT_DAILY_COLLECTION_PATH(classId))
        .where("dayKey", ">=", uniqueDayKeys[0])
        .where("dayKey", "<=", uniqueDayKeys[uniqueDayKeys.length - 1])
        .select("studentUid", "sourceTotals")
        .get();

    const byStudent = new Map();
    let docCount = 0;

    snapshot.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const studentUid = normalizeValue(data.studentUid);
        if (!studentUid || !targetStudentUidSet.has(studentUid)) {
            return;
        }

        docCount += 1;
        if (!byStudent.has(studentUid)) {
            byStudent.set(studentUid, {});
        }

        const aggregate = byStudent.get(studentUid);
        const sourceTotals = normalizeSummarySourceTotals(data.sourceTotals);

        Object.entries(sourceTotals).forEach(([sourceKey, sourceTotal]) => {
            if (!aggregate[sourceKey]) {
                aggregate[sourceKey] = buildEmptySummarySourceTotal();
            }

            aggregate[sourceKey] = {
                grossAmount:
                    toSafeNumber(aggregate[sourceKey].grossAmount) +
                    toSafeNumber(sourceTotal.grossAmount),
                recordCount:
                    Math.max(0, Math.trunc(toSafeNumber(aggregate[sourceKey].recordCount))) +
                    Math.max(0, Math.trunc(toSafeNumber(sourceTotal.recordCount))),
            };
        });
    });

    return {
        byStudent,
        docCount,
    };
};

const computeSummarySettlement = ({
    sourceType,
    summarySourceTotal,
    policy,
}) => {
    const base = buildEmptyBreakdown(sourceType);
    const grossAmount = toSafeNumber(summarySourceTotal?.grossAmount);
    const recordCount = Math.max(
        0,
        Math.trunc(toSafeNumber(summarySourceTotal?.recordCount)),
    );
    const exemptionThreshold = toSafeNumber(policy?.exemptionThreshold);
    const taxBase = Math.max(grossAmount - exemptionThreshold, 0);
    const taxRate = toSafeNumber(policy?.taxRate);

    return {
        ...base,
        grossAmount,
        exemptionThreshold,
        taxBase,
        taxRate,
        taxAmount: Math.round(taxBase * (taxRate / 100)),
        recordCount,
    };
};

const computeActivitySettlement = ({
    sourceType,
    activityLogs = [],
    policy,
    currencyUnit,
    coveredAfterMs = 0,
}) => {
    const base = buildEmptyBreakdown(sourceType);

    const records = activityLogs.filter((log) => {
        const recordTimeMs = getSourceRecordTimeMs(sourceType, log);
        if (coveredAfterMs && Number(recordTimeMs) <= coveredAfterMs) {
            return false;
        }

        const meta = getIncomeSettlementMeta(log);
        if (meta?.sourceKey === sourceType) {
            return (
                meta.eligible !== false &&
                resolveActivitySettlementAmount({ sourceType, log }) > 0
            );
        }

        return matchesLegacyActivitySource({ sourceType, log, currencyUnit });
    });

    const grossAmount = records.reduce(
        (sum, log) => sum + resolveActivitySettlementAmount({ sourceType, log }),
        0,
    );
    const exemptionThreshold = toSafeNumber(policy?.exemptionThreshold);
    const taxBase = Math.max(grossAmount - exemptionThreshold, 0);
    const taxRate = toSafeNumber(policy?.taxRate);

    return {
        ...base,
        grossAmount,
        exemptionThreshold,
        taxBase,
        taxRate,
        taxAmount: Math.round(taxBase * (taxRate / 100)),
        recordCount: records.length,
    };
};

const computePoliceRewardSettlement = ({
    studentUid,
    policeRewards = [],
    policy,
    coveredAfterMs = 0,
}) => {
    const base = buildEmptyBreakdown("policeReward");
    const records = policeRewards.filter(
        (record) =>
            record.studentUid === studentUid &&
            record.type === "reward" &&
            record.status === "applied" &&
            record.isCancelled !== true &&
            (!coveredAfterMs ||
                Number(getSourceRecordTimeMs("policeReward", record)) > coveredAfterMs) &&
            toSafeNumber(record.amountSigned) > 0,
    );

    const grossAmount = records.reduce(
        (sum, record) => sum + toSafeNumber(record.amountSigned),
        0,
    );
    const exemptionThreshold = toSafeNumber(policy?.exemptionThreshold);
    const taxBase = Math.max(grossAmount - exemptionThreshold, 0);
    const taxRate = toSafeNumber(policy?.taxRate);

    return {
        ...base,
        grossAmount,
        exemptionThreshold,
        taxBase,
        taxRate,
        taxAmount: Math.round(taxBase * (taxRate / 100)),
        recordCount: records.length,
    };
};

const computeStockSettlement = ({
    tradeHistory = [],
    policy,
    coveredAfterMs = 0,
}) => {
    const base = buildEmptyBreakdown("stockCapitalGain");
    const sellTrades = tradeHistory.filter(
        (trade) =>
            trade.type === "STOCK_SELL" &&
            (!coveredAfterMs ||
                Number(getSourceRecordTimeMs("stockCapitalGain", trade)) > coveredAfterMs) &&
            Number.isFinite(Number(trade.realizedGainInClassCurrency)),
    );

    const grossAmount = sellTrades.reduce(
        (sum, trade) => sum + toSafeNumber(trade.realizedGainInClassCurrency),
        0,
    );
    const exemptionThreshold = toSafeNumber(policy?.exemptionThreshold);
    const taxBase = Math.max(grossAmount - exemptionThreshold, 0);
    const taxRate = toSafeNumber(policy?.taxRate);

    return {
        ...base,
        grossAmount,
        exemptionThreshold,
        taxBase,
        taxRate,
        taxAmount: Math.round(taxBase * (taxRate / 100)),
        recordCount: sellTrades.length,
    };
};

const isStudentRole = (role) => {
    const normalizedRole = normalizeValue(role).toLowerCase();
    return normalizedRole !== "teacher" && normalizedRole !== "admin";
};

const readTargetStudents = async ({ classId, selectedStudentUids = [] }) => {
    const targetUids = Array.from(
        new Set((selectedStudentUids || []).map(normalizeValue).filter(Boolean)),
    );

    if (targetUids.length > 0) {
        const refs = targetUids.map((uid) => db.doc(`classes/${classId}/students/${uid}`));
        const snaps = await db.getAll(...refs);
        return snaps
            .filter((snap) => snap.exists)
            .map((snap) => ({ uid: snap.id, ...snap.data() }))
            .filter((student) => isStudentRole(student.role));
    }

    const snapshot = await db.collection(`classes/${classId}/students`).get();
    return snapshot.docs
        .map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }))
        .filter((student) => isStudentRole(student.role));
};

const readActivityLogsForSettlement = async ({
    classId,
    startTimestamp,
    endTimestamp,
    targetStudentUidSet,
}) => {
    const snapshot = await db
        .collectionGroup("activityLogs")
        .where("classId", "==", classId)
        .where("timestamp", ">=", startTimestamp)
        .where("timestamp", "<=", endTimestamp)
        .orderBy("timestamp", "desc")
        .select(
            "studentUid",
            "type",
            "category",
            "amount",
            "currency",
            "createdAt",
            "timestamp",
            "incomeSettlement",
        )
        .get();

    const byStudent = new Map();
    let docCount = 0;

    snapshot.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const studentUid =
            normalizeValue(data.studentUid) || normalizeValue(docSnap.ref.parent.parent?.id);

        if (!studentUid || !targetStudentUidSet.has(studentUid)) {
            return;
        }

        docCount += 1;
        if (!byStudent.has(studentUid)) {
            byStudent.set(studentUid, []);
        }

        byStudent.get(studentUid).push({
            id: docSnap.id,
            studentUid,
            type: data.type || "",
            category: data.category || "",
            amount: data.amount ?? 0,
            currency: data.currency || "",
            createdAt: data.createdAt || null,
            timestamp: data.timestamp || data.createdAt || null,
            incomeSettlement:
                data.incomeSettlement && typeof data.incomeSettlement === "object"
                    ? data.incomeSettlement
                    : null,
        });
    });

    return {
        byStudent,
        docCount,
    };
};

const readTradeHistoryForSettlement = async ({
    classId,
    startTimestamp,
    endTimestamp,
    targetStudentUidSet,
}) => {
    const snapshot = await db
        .collectionGroup("tradeHistory")
        .where("classId", "==", classId)
        .where("type", "==", "STOCK_SELL")
        .where("createdAt", ">=", startTimestamp)
        .where("createdAt", "<=", endTimestamp)
        .orderBy("createdAt", "desc")
        .select(
            "type",
            "createdAt",
            "realizedGainInClassCurrency",
            "userId",
            "studentUid",
        )
        .get();

    const byStudent = new Map();
    let docCount = 0;

    snapshot.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const studentUid =
            normalizeValue(data.studentUid) ||
            normalizeValue(data.userId) ||
            normalizeValue(docSnap.ref.parent.parent?.id);

        if (!studentUid || !targetStudentUidSet.has(studentUid)) {
            return;
        }

        docCount += 1;
        if (!byStudent.has(studentUid)) {
            byStudent.set(studentUid, []);
        }

        byStudent.get(studentUid).push({
            id: docSnap.id,
            type: data.type || "",
            createdAt: data.createdAt || null,
            realizedGainInClassCurrency: data.realizedGainInClassCurrency ?? null,
        });
    });

    return {
        byStudent,
        docCount,
    };
};

const readPoliceRewardsForSettlement = async ({
    classId,
    startTimestamp,
    endTimestamp,
    targetStudentUidSet,
}) => {
    const snapshot = await db
        .collection(`classes/${classId}/policeFineHistory`)
        .where("appliedAt", ">=", startTimestamp)
        .where("appliedAt", "<=", endTimestamp)
        .select(
            "studentUid",
            "type",
            "status",
            "isCancelled",
            "amountSigned",
            "appliedAt",
        )
        .get();

    const records = [];
    let docCount = 0;

    snapshot.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const studentUid = normalizeValue(data.studentUid);
        if (!studentUid || !targetStudentUidSet.has(studentUid)) {
            return;
        }

        docCount += 1;
        records.push({
            id: docSnap.id,
            studentUid,
            type: data.type || "",
            status: data.status || "",
            isCancelled: data.isCancelled === true,
            amountSigned: data.amountSigned ?? 0,
            appliedAt: data.appliedAt || null,
        });
    });

    return {
        records,
        docCount,
    };
};

const readIncomeSettlementBillSummaryEntries = (summaryDoc = {}) =>
    Array.isArray(summaryDoc.bills)
        ? summaryDoc.bills
        : [];

const normalizeIncomeSettlementBillSummaryEntry = (entry = {}) => ({
    id: normalizeValue(entry.id),
    studentUid: normalizeValue(entry.studentUid),
    billKind: normalizeValue(entry.billKind) || "income_settlement",
    periodStart: getRecordTimeMs(entry.periodStart),
    periodEnd: getRecordTimeMs(entry.periodEnd),
    periodKey: normalizeValue(entry.periodKey),
    sourceTypes: Array.isArray(entry.sourceTypes)
        ? Array.from(new Set(entry.sourceTypes.map(normalizeValue).filter(Boolean)))
        : [],
    coveredUntil: getRecordTimeMs(entry.coveredUntil),
    billSequence: Number(entry.billSequence) || 1,
    isPaid: entry.isPaid === true,
    name: entry.name || "",
});

const readIncomeSettlementBillSummaries = async ({
    classId,
    studentUids = [],
}) => {
    const refs = studentUids.map((studentUid) =>
        db.doc(INCOME_SETTLEMENT_BILL_SUMMARY_DOC_PATH(classId, studentUid)),
    );
    const snaps = await db.getAll(...refs);
    const byStudent = new Map();
    const missingStudentUids = [];
    let billCount = 0;
    let summaryDocCount = 0;

    snaps.forEach((snap, index) => {
        const studentUid = studentUids[index];
        if (!snap.exists) {
            missingStudentUids.push(studentUid);
            return;
        }

        const data = snap.data() || {};
        if (Number(data.summaryVersion) !== INCOME_SETTLEMENT_BILL_SUMMARY_VERSION) {
            missingStudentUids.push(studentUid);
            return;
        }

        summaryDocCount += 1;
        const bills = readIncomeSettlementBillSummaryEntries(data)
            .map(normalizeIncomeSettlementBillSummaryEntry)
            .filter((bill) => bill.id);
        byStudent.set(studentUid, bills);
        billCount += bills.length;
    });

    return {
        byStudent,
        missingStudentUids,
        billCount,
        summaryDocCount,
    };
};

const readStudentIncomeSettlementBillsForSummary = async ({
    classId,
    studentUid,
}) => {
    const snapshot = await db
        .collection(`classes/${classId}/students/${studentUid}/taxBills`)
        .select(
            "billKind",
            "periodStart",
            "periodEnd",
            "periodKey",
            "sourceTypes",
            "coveredUntil",
            "billSequence",
            "isPaid",
            "name",
        )
        .get();

    return snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, studentUid, ...docSnap.data() }))
        .filter((bill) => isIncomeSettlementBill(bill))
        .map(normalizeIncomeSettlementBillSummaryEntry)
        .sort((left, right) => {
            const leftEnd = Number(left.periodEnd || 0);
            const rightEnd = Number(right.periodEnd || 0);
            if (leftEnd !== rightEnd) {
                return rightEnd - leftEnd;
            }
            return Number(right.billSequence || 0) - Number(left.billSequence || 0);
        });
};

const rebuildIncomeSettlementBillSummaryForStudents = async ({
    classId,
    studentUids = [],
}) => {
    const uniqueStudentUids = Array.from(
        new Set((studentUids || []).map(normalizeValue).filter(Boolean)),
    );

    if (uniqueStudentUids.length === 0) {
        return {
            byStudent: new Map(),
            studentCount: 0,
            billCount: 0,
        };
    }

    const entries = await Promise.all(
        uniqueStudentUids.map(async (studentUid) => [
            studentUid,
            await readStudentIncomeSettlementBillsForSummary({
                classId,
                studentUid,
            }),
        ]),
    );
    const byStudent = new Map(entries);
    let billCount = 0;
    const bulkWriter = db.bulkWriter();

    uniqueStudentUids.forEach((studentUid) => {
        const bills = byStudent.get(studentUid) || [];
        billCount += bills.length;
        bulkWriter.set(
            db.doc(INCOME_SETTLEMENT_BILL_SUMMARY_DOC_PATH(classId, studentUid)),
            {
                classId,
                studentUid,
                summaryVersion: INCOME_SETTLEMENT_BILL_SUMMARY_VERSION,
                billCount: bills.length,
                bills,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: false },
        );
    });

    await bulkWriter.close();

    return {
        byStudent,
        studentCount: uniqueStudentUids.length,
        billCount,
    };
};

const readIncomeSettlementBills = async ({ classId, targetStudentUidSet }) => {
    const targetStudentUids = Array.from(
        new Set(Array.from(targetStudentUidSet || []).map(normalizeValue).filter(Boolean)),
    );

    if (targetStudentUids.length === 0) {
        return {
            byStudent: new Map(),
            docCount: 0,
            summaryDocCount: 0,
            rebuiltStudentCount: 0,
        };
    }

    const initialSummary = await readIncomeSettlementBillSummaries({
        classId,
        studentUids: targetStudentUids,
    });
    const byStudent = new Map(initialSummary.byStudent);
    let docCount = initialSummary.billCount;
    let rebuiltStudentCount = 0;

    if (initialSummary.missingStudentUids.length > 0) {
        const rebuiltSummary = await rebuildIncomeSettlementBillSummaryForStudents({
            classId,
            studentUids: initialSummary.missingStudentUids,
        });
        rebuiltStudentCount = rebuiltSummary.studentCount;

        rebuiltSummary.byStudent.forEach((bills, studentUid) => {
            byStudent.set(studentUid, bills);
        });

        docCount =
            Array.from(byStudent.values()).reduce(
                (sum, bills) => sum + (Array.isArray(bills) ? bills.length : 0),
                0,
            );
    }

    targetStudentUids.forEach((studentUid) => {
        if (!byStudent.has(studentUid)) {
            byStudent.set(studentUid, []);
        }
    });

    return {
        byStudent,
        docCount,
        summaryDocCount: initialSummary.summaryDocCount,
        rebuiltStudentCount,
    };
};

const buildSourceCoverageByKey = ({
    enabledSourceKeys = [],
    existingSettlementBills = [],
    currentStart,
    currentEnd,
}) =>
    new Map(
        enabledSourceKeys.map((sourceKey) => {
            const coveredAfterMs = existingSettlementBills.reduce((latest, bill) => {
                const periodStart = toDateValue(bill.periodStart);
                const periodEnd = toDateValue(bill.periodEnd);
                if (!periodStart || !periodEnd) return latest;

                if (
                    !periodsOverlap(
                        periodStart.getTime(),
                        periodEnd.getTime(),
                        currentStart,
                        currentEnd,
                    )
                ) {
                    return latest;
                }

                const billSourceTypes = Array.isArray(bill.sourceTypes)
                    ? bill.sourceTypes
                    : [];
                if (!billSourceTypes.includes(sourceKey)) return latest;

                return Math.max(latest, getRecordTimeMs(bill.coveredUntil));
            }, 0);

            return [sourceKey, { coveredAfterMs }];
        }),
    );

const findIncomeSettlementSummaryCoverageConflict = ({
    students = [],
    enabledSourceKeys = [],
    settlementBillsByStudent,
    currentStart,
    currentEnd,
}) => {
    for (const student of students) {
        const sourceCoverageByKey = buildSourceCoverageByKey({
            enabledSourceKeys,
            existingSettlementBills:
                settlementBillsByStudent.get(student.uid) || [],
            currentStart,
            currentEnd,
        });

        for (const sourceKey of enabledSourceKeys) {
            const coveredAfterMs =
                sourceCoverageByKey.get(sourceKey)?.coveredAfterMs || 0;
            if (coveredAfterMs >= currentStart) {
                return {
                    studentUid: student.uid,
                    sourceKey,
                    coveredAfterMs,
                };
            }
        }
    }

    return null;
};

const buildSettlementPreviewRow = ({
    student,
    breakdown,
    existingSettlementBills = [],
    period,
    currentStart,
    currentEnd,
}) => {
    const grossAmount = breakdown.reduce((sum, item) => sum + item.grossAmount, 0);
    const taxBase = breakdown.reduce((sum, item) => sum + item.taxBase, 0);
    const taxAmount = breakdown.reduce((sum, item) => sum + item.taxAmount, 0);
    const sourceCount = breakdown.reduce((sum, item) => sum + item.recordCount, 0);
    const sourceTypes = breakdown.map((item) => item.sourceType);
    const billSequence =
        existingSettlementBills
            .filter((bill) => bill.periodKey === period.key)
            .reduce(
                (maxSequence, bill) =>
                    Math.max(maxSequence, getBillSequence(bill)),
                0,
            ) + 1;
    const billId = buildIncomeSettlementBillId({
        periodKey: period.key,
        studentUid: student.uid,
        sequence: billSequence,
    });

    const relatedBills = existingSettlementBills
        .map((bill) => {
            const periodStart = toDateValue(bill.periodStart);
            const periodEnd = toDateValue(bill.periodEnd);
            if (!periodStart || !periodEnd) return null;

            if (
                !periodsOverlap(
                    periodStart.getTime(),
                    periodEnd.getTime(),
                    currentStart,
                    currentEnd,
                )
            ) {
                return null;
            }

            const billSourceTypes = Array.isArray(bill.sourceTypes)
                ? bill.sourceTypes
                : [];
            const overlappingSourceTypes = sourceTypes.filter((sourceType) =>
                billSourceTypes.includes(sourceType),
            );
            const hasSourceMetadata = billSourceTypes.length > 0;
            const hasCoverageMetadata = Boolean(getRecordTimeMs(bill.coveredUntil));
            let overlapKind = null;

            if (!hasSourceMetadata) {
                overlapKind = "period_overlap";
            } else if (
                overlappingSourceTypes.length > 0 &&
                !hasCoverageMetadata
            ) {
                overlapKind = "source_overlap";
            }

            return {
                id: bill.id,
                name: bill.name || "",
                isPaid: bill.isPaid === true,
                periodLabel: formatPeriodLabel(bill.periodStart, bill.periodEnd),
                billSourceTypes,
                overlappingSourceTypes,
                overlapKind,
            };
        })
        .filter(Boolean);

    const existingBill = null;
    const overlappingBills = relatedBills.filter(
        (bill) => bill.id !== billId && bill.overlapKind,
    );
    let warningKind = "clear";
    if (existingBill) {
        warningKind = "exact";
    } else if (
        overlappingBills.some((bill) => bill.overlapKind === "source_overlap")
    ) {
        warningKind = "source_overlap";
    } else if (overlappingBills.length > 0) {
        warningKind = "period_overlap";
    }

    return {
        studentUid: student.uid,
        studentName: student.name || student.displayName || student.uid,
        studentNumber: student.studentNumber || null,
        breakdown,
        grossAmount,
        taxBase,
        taxAmount,
        sourceCount,
        sourceTypes,
        billSequence,
        billId,
        existingBill,
        overlappingBills,
        warningKind,
    };
};

const buildIncomeSettlementPreviewResponse = ({
    rows = [],
    enabledSourceKeys = [],
    taxPolicy,
    diagnostics,
}) => {
    const previewRows = rows
        .filter((row) => row.taxAmount > 0)
        .sort((left, right) => {
            const leftNumber = Number(left.studentNumber);
            const rightNumber = Number(right.studentNumber);
            const leftHasNumber = Number.isFinite(leftNumber);
            const rightHasNumber = Number.isFinite(rightNumber);

            if (leftHasNumber && rightHasNumber && leftNumber !== rightNumber) {
                return leftNumber - rightNumber;
            }
            if (leftHasNumber && !rightHasNumber) return -1;
            if (!leftHasNumber && rightHasNumber) return 1;
            return String(left.studentName).localeCompare(
                String(right.studentName),
                "ko",
            );
        });

    const issueableRows = previewRows.filter((row) => !row.existingBill);
    const warningRows = previewRows.filter((row) => row.warningKind !== "clear");
    const policySnapshot = buildPolicySnapshot(taxPolicy, enabledSourceKeys);

    return {
        rows: previewRows,
        issueableRows,
        warningRows,
        selectedSourceKeys: enabledSourceKeys,
        policySnapshot,
        diagnostics,
        totals: {
            studentCount: previewRows.length,
            issueableCount: issueableRows.length,
            existingCount: previewRows.length - issueableRows.length,
            exactDuplicateCount: previewRows.filter((row) => row.warningKind === "exact").length,
            overlapCount: previewRows.filter((row) => row.warningKind === "period_overlap").length,
            sourceOverlapCount: previewRows.filter((row) => row.warningKind === "source_overlap").length,
            safeIssueableCount: issueableRows.filter((row) => row.warningKind === "clear").length,
            grossAmount: previewRows.reduce((sum, row) => sum + row.grossAmount, 0),
            taxBase: previewRows.reduce((sum, row) => sum + row.taxBase, 0),
            taxAmount: previewRows.reduce((sum, row) => sum + row.taxAmount, 0),
            sourceCount: previewRows.reduce((sum, row) => sum + row.sourceCount, 0),
        },
    };
};

const buildIncomeSettlementPreviewPayloadFromSummary = ({
    students = [],
    enabledSourceKeys = [],
    taxPolicy,
    period,
    dailySummaryByStudent,
    settlementBillsByStudent,
    diagnostics,
}) => {
    const currentStart = period.startMs;
    const currentEnd = period.endMs;

    const rows = students.map((student) => {
        const existingSettlementBills =
            settlementBillsByStudent.get(student.uid) || [];
        const summarySourceTotals = dailySummaryByStudent.get(student.uid) || {};
        const breakdown = enabledSourceKeys
            .map((sourceKey) => {
                const policy = taxPolicy.incomeSettlement?.[sourceKey] || {};
                return computeSummarySettlement({
                    sourceType: sourceKey,
                    summarySourceTotal:
                        summarySourceTotals[sourceKey] ||
                        buildEmptySummarySourceTotal(),
                    policy,
                });
            })
            .filter((item) => item.recordCount > 0 || item.taxAmount > 0 || item.grossAmount !== 0);

        return buildSettlementPreviewRow({
            student,
            breakdown,
            existingSettlementBills,
            period,
            currentStart,
            currentEnd,
        });
    });

    return buildIncomeSettlementPreviewResponse({
        rows,
        enabledSourceKeys,
        taxPolicy,
        diagnostics,
    });
};

const buildIncomeSettlementPreviewPayload = ({
    students = [],
    enabledSourceKeys = [],
    taxPolicy,
    currencyUnit,
    period,
    activityLogsByStudent,
    tradeHistoryByStudent,
    policeRewards,
    settlementBillsByStudent,
    diagnostics,
}) => {
    const currentStart = period.startMs;
    const currentEnd = period.endMs;

    const rows = students.map((student) => {
        const existingSettlementBills =
            settlementBillsByStudent.get(student.uid) || [];
        const sourceCoverageByKey = buildSourceCoverageByKey({
            enabledSourceKeys,
            existingSettlementBills,
            currentStart,
            currentEnd,
        });

        const breakdown = enabledSourceKeys
            .map((sourceKey) => {
                const policy = taxPolicy.incomeSettlement?.[sourceKey] || {};
                const coveredAfterMs =
                    sourceCoverageByKey.get(sourceKey)?.coveredAfterMs || 0;

                if (sourceKey === "policeReward") {
                    return computePoliceRewardSettlement({
                        studentUid: student.uid,
                        policeRewards,
                        policy,
                        coveredAfterMs,
                    });
                }

                if (sourceKey === "stockCapitalGain") {
                    return computeStockSettlement({
                        tradeHistory: tradeHistoryByStudent.get(student.uid) || [],
                        policy,
                        coveredAfterMs,
                    });
                }

                return computeActivitySettlement({
                    sourceType: sourceKey,
                    activityLogs: activityLogsByStudent.get(student.uid) || [],
                    policy,
                    currencyUnit,
                    coveredAfterMs,
                });
            })
            .filter((item) => item.recordCount > 0 || item.taxAmount > 0 || item.grossAmount !== 0);

        return buildSettlementPreviewRow({
            student,
            breakdown,
            existingSettlementBills,
            period,
            currentStart,
            currentEnd,
        });
    });

    return buildIncomeSettlementPreviewResponse({
        rows,
        enabledSourceKeys,
        taxPolicy,
        diagnostics,
    });
};

const computeIncomeSettlementPreviewResult = async ({
    classId,
    selectedStudentUids = [],
    selectedSourceKeys = [],
    periodKey,
    periodLabel,
    startMs,
    endMs,
    currencyUnit,
}) => {
    if (!classId) {
        throw new HttpsError("invalid-argument", "classId is required.");
    }

    if (!periodKey || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
        throw new HttpsError("invalid-argument", "A valid period is required.");
    }

    const enabledSourceKeys = selectedSourceKeys.filter((sourceKey) =>
        SUPPORTED_SOURCE_KEYS.has(sourceKey),
    );
    if (enabledSourceKeys.length === 0) {
        throw new HttpsError("invalid-argument", "At least one source key is required.");
    }

    const classSnap = await db.doc(`classes/${classId}`).get();
    if (!classSnap.exists) {
        throw new HttpsError("not-found", "Class not found.");
    }

    const classData = classSnap.data() || {};
    const taxPolicy = getTaxPolicy(classData);
    const targetStudents = await readTargetStudents({
        classId,
        selectedStudentUids,
    });

    if (targetStudents.length === 0) {
        throw new HttpsError("invalid-argument", "No target students were found.");
    }

    const resolvedCurrencyUnit =
        currencyUnit || classData.currencyUnit || "class_currency";
    const targetStudentUidSet = new Set(targetStudents.map((student) => student.uid));
    const period = {
        key: periodKey,
        label: periodLabel || periodKey,
        startMs,
        endMs,
    };
    const dayKeys = getDayKeysForRange(startMs, endMs);
    const startTimestamp = admin.firestore.Timestamp.fromMillis(startMs);
    const endTimestamp = admin.firestore.Timestamp.fromMillis(endMs);
    const needsActivityLogs = enabledSourceKeys.some((sourceKey) =>
        ACTIVE_ACTIVITY_SOURCES.has(sourceKey),
    );
    const needsTradeHistory = enabledSourceKeys.includes("stockCapitalGain");
    const needsPoliceRewards = enabledSourceKeys.includes("policeReward");
    const billsResult = await readIncomeSettlementBills({
        classId,
        targetStudentUidSet,
    });
    const summaryCoverageConflict = findIncomeSettlementSummaryCoverageConflict({
        students: targetStudents,
        enabledSourceKeys,
        settlementBillsByStudent: billsResult.byStudent,
        currentStart: startMs,
        currentEnd: endMs,
    });

    let summaryAvailability = {
        ready: false,
        reason: "summary_not_checked",
    };

    if (!summaryCoverageConflict) {
        const dayStatusMap = await readIncomeSettlementDayStatusMap({
            classId,
            dayKeys,
        });
        summaryAvailability = evaluateIncomeSettlementSummaryAvailability({
            dayStatusMap,
            dayKeys,
            sourceKeys: enabledSourceKeys,
        });

        if (summaryAvailability.ready) {
            const summaryResult = await readIncomeSettlementDailySummaryByStudent({
                classId,
                dayKeys,
                targetStudentUidSet,
            });

            return {
                preview: buildIncomeSettlementPreviewPayloadFromSummary({
                    students: targetStudents,
                    enabledSourceKeys,
                    taxPolicy,
                    period,
                    dailySummaryByStudent: summaryResult.byStudent,
                    settlementBillsByStudent: billsResult.byStudent,
                    diagnostics: {
                        mode: "server_summary_v1",
                        targetStudentCount: targetStudents.length,
                        dayCount: dayKeys.length,
                        sourceCounts: {
                            dailySummaryDocs: summaryResult.docCount,
                            settlementBills: billsResult.docCount,
                        },
                        billSummary: {
                            summaryDocCount: billsResult.summaryDocCount,
                            rebuiltStudentCount: billsResult.rebuiltStudentCount,
                        },
                        summary: {
                            used: true,
                            reason: "ready",
                            availability: {
                                ready: true,
                            },
                        },
                    },
                }),
                classData,
                resolvedCurrencyUnit,
                period,
            };
        }
    } else {
        summaryAvailability = {
            ready: false,
            reason: "covered_until_within_period",
            ...summaryCoverageConflict,
        };
    }

    const [
        activityResult,
        tradeResult,
        policeResult,
    ] = await Promise.all([
        needsActivityLogs
            ? readActivityLogsForSettlement({
                classId,
                startTimestamp,
                endTimestamp,
                targetStudentUidSet,
            })
            : Promise.resolve({ byStudent: new Map(), docCount: 0 }),
        needsTradeHistory
            ? readTradeHistoryForSettlement({
                classId,
                startTimestamp,
                endTimestamp,
                targetStudentUidSet,
            })
            : Promise.resolve({ byStudent: new Map(), docCount: 0 }),
        needsPoliceRewards
            ? readPoliceRewardsForSettlement({
                classId,
                startTimestamp,
                endTimestamp,
                targetStudentUidSet,
            })
            : Promise.resolve({ records: [], docCount: 0 }),
    ]);

    let summaryRefresh = null;
    let summaryRefreshError = null;

    try {
        const summaryPatchByDocId = buildIncomeSettlementSummaryPatchFromRawResults({
            activityLogsByStudent: activityResult.byStudent,
            tradeHistoryByStudent: tradeResult.byStudent,
            policeRewards: policeResult.records,
            sourceKeys: enabledSourceKeys,
            currencyUnit: resolvedCurrencyUnit,
        });

        summaryRefresh = await rewriteIncomeSettlementDailySummaryRange({
            classId,
            dayKeys,
            sourceKeys: enabledSourceKeys,
            summaryPatchByDocId,
        });
    } catch (error) {
        summaryRefreshError =
            error instanceof Error ? error.message : String(error);
        console.error(
            "[taxSettlement] failed to refresh income settlement summary",
            {
                classId,
                periodKey,
                error: summaryRefreshError,
            },
        );
    }

    return {
        preview: buildIncomeSettlementPreviewPayload({
            students: targetStudents,
            enabledSourceKeys,
            taxPolicy,
            currencyUnit: resolvedCurrencyUnit,
            period,
            activityLogsByStudent: activityResult.byStudent,
            tradeHistoryByStudent: tradeResult.byStudent,
            policeRewards: policeResult.records,
            settlementBillsByStudent: billsResult.byStudent,
            diagnostics: {
                mode: "server_aggregate_v2",
                targetStudentCount: targetStudents.length,
                dayCount: dayKeys.length,
                sourceCounts: {
                    activityLogs: activityResult.docCount,
                    tradeHistory: tradeResult.docCount,
                    policeRewards: policeResult.docCount,
                    settlementBills: billsResult.docCount,
                },
                billSummary: {
                    summaryDocCount: billsResult.summaryDocCount,
                    rebuiltStudentCount: billsResult.rebuiltStudentCount,
                },
                summary: {
                    used: false,
                    reason: summaryAvailability.reason,
                    availability: summaryAvailability,
                    conflict:
                        summaryCoverageConflict
                            ? {
                                studentUid: summaryCoverageConflict.studentUid,
                                sourceKey: summaryCoverageConflict.sourceKey,
                                coveredAfterMs: summaryCoverageConflict.coveredAfterMs,
                                coveredAfterDayKey: getDayKeyFromValue(
                                    summaryCoverageConflict.coveredAfterMs,
                                ),
                            }
                            : null,
                    refresh: summaryRefresh,
                    refreshError: summaryRefreshError,
                },
            },
        }),
        classData,
        resolvedCurrencyUnit,
        period,
    };
};

const buildIncomeSettlementIssuePresentation = ({
    period,
    row,
    presentation = {},
}) => {
    const normalizedPresentation =
        presentation && typeof presentation === "object"
            ? presentation
            : {};
    const sourceLabelsByKey =
        normalizedPresentation.sourceLabelsByKey &&
        typeof normalizedPresentation.sourceLabelsByKey === "object"
            ? normalizedPresentation.sourceLabelsByKey
            : {};
    const sourceLabels = row.sourceTypes.map((sourceType) =>
        normalizeValue(sourceLabelsByKey[sourceType]) || sourceType,
    );
    const billName =
        normalizeValue(normalizedPresentation.billName) ||
        `income_settlement (${period.label})`;
    const descriptionPrefix =
        normalizeValue(normalizedPresentation.descriptionPrefix) ||
        `${period.label} / `;

    return {
        billName,
        description: `${descriptionPrefix}${sourceLabels.join(", ")}`,
    };
};

const issueIncomeSettlementBillsFromPreview = async ({
    classId,
    classData,
    issuerUid,
    preview,
    period,
    dueDateMs,
    currencyUnit,
    presentation,
}) => {
    const issueableRows = Array.isArray(preview?.issueableRows)
        ? preview.issueableRows
        : [];

    if (!classId) {
        throw new HttpsError("invalid-argument", "classId is required.");
    }

    if (issueableRows.length === 0) {
        return {
            issuedCount: 0,
            skippedCount: Array.isArray(preview?.rows) ? preview.rows.length : 0,
            issuedBillIds: [],
            diagnostics: {
                revalidatedMode: preview?.diagnostics?.mode || null,
                issueableCount: 0,
            },
        };
    }

    const batch = db.batch();
    const resolvedDueDateMs = Number.isFinite(dueDateMs)
        ? dueDateMs
        : dayjs(period.endMs).add(7, "day").endOf("day").valueOf();
    const dueDate = admin.firestore.Timestamp.fromMillis(resolvedDueDateMs);
    const periodStart = admin.firestore.Timestamp.fromMillis(period.startMs);
    const periodEnd = admin.firestore.Timestamp.fromMillis(period.endMs);
    const coveredUntil = admin.firestore.Timestamp.now();
    const lateFeePolicy = getTaxBillLateFeePolicy(classData || {});

    issueableRows.forEach((row) => {
        const billRef = db.doc(
            `classes/${classId}/students/${row.studentUid}/taxBills/${row.billId}`,
        );
        const primaryRate =
            row.breakdown.length === 1 ? row.breakdown[0].taxRate : null;
        const { billName, description } = buildIncomeSettlementIssuePresentation({
            period,
            row,
            presentation,
        });

        batch.set(billRef, {
            classId,
            studentUid: row.studentUid,
            studentName: row.studentName,
            issuedBy: issuerUid || null,
            billKind: "income_settlement",
            name: billName,
            amount: row.taxAmount,
            description,
            status: "pending",
            isPaid: false,
            issuedAt: admin.firestore.FieldValue.serverTimestamp(),
            paidAt: null,
            dueDate,
            lateFeePolicy,
            taxType: "income_settlement",
            periodStart,
            periodEnd,
            periodKey: period.key,
            coveredFrom: periodStart,
            coveredUntil,
            sourceTypes: row.sourceTypes,
            sourceCount: row.sourceCount,
            billSequence: row.billSequence || 1,
            taxBase: row.taxBase,
            taxRate: primaryRate,
            policySnapshot: preview.policySnapshot || {},
            settlementBreakdown: row.breakdown,
            currencyUnit: currencyUnit || null,
        });
    });

    await batch.commit();

    return {
        issuedCount: issueableRows.length,
        skippedCount:
            (Array.isArray(preview?.rows) ? preview.rows.length : 0) -
            issueableRows.length,
        issuedBillIds: issueableRows.map((row) => row.billId),
        diagnostics: {
            revalidatedMode: preview?.diagnostics?.mode || null,
            issueableCount: issueableRows.length,
        },
    };
};

exports.getIncomeSettlementPreview = onCall(
    {
        region: REGION,
        timeoutSeconds: 120,
        memory: "512MiB",
    },
    async () => {
        throw new HttpsError(
            "failed-precondition",
            "기간 소득정산은 종료되었습니다. 원천징수와 월말정산을 이용해 주세요.",
        );
    },
);

exports.issueIncomeSettlementBillsVerified = onCall(
    {
        region: REGION,
        timeoutSeconds: 120,
        memory: "512MiB",
    },
    async () => {
        throw new HttpsError(
            "failed-precondition",
            "기간 소득정산 고지서 발급은 종료되었습니다. 월말정산 추가납부를 이용해 주세요.",
        );
    },
);

const collectActivitySummaryDirtyTargets = (log = {}) => {
    const dayKey = getDayKeyFromValue(log.timestamp || log.createdAt);
    if (!dayKey) {
        return [];
    }

    const targets = [];
    const metaSourceKey = normalizeValue(getIncomeSettlementMeta(log)?.sourceKey);
    if (ACTIVE_ACTIVITY_SOURCES.has(metaSourceKey)) {
        targets.push({
            dayKey,
            sourceKey: metaSourceKey,
        });
    }

    if (
        log.type === "income" &&
        log.category === "mission" &&
        toSafeNumber(log.amount) > 0
    ) {
        targets.push({
            dayKey,
            sourceKey: "missionReward",
        });
    }

    if (
        log.type === "admin_adjustment" &&
        log.category === "increment" &&
        toSafeNumber(log.amount) > 0
    ) {
        targets.push({
            dayKey,
            sourceKey: "assetAdjustment",
        });
    }

    return targets;
};

const collectTradeSummaryDirtyTargets = (trade = {}) => {
    const dayKey = getDayKeyFromValue(trade.createdAt);
    if (
        !dayKey ||
        trade.type !== "STOCK_SELL" ||
        !Number.isFinite(Number(trade.realizedGainInClassCurrency))
    ) {
        return [];
    }

    return [
        {
            dayKey,
            sourceKey: "stockCapitalGain",
        },
    ];
};

const collectPoliceSummaryDirtyTargets = (record = {}) => {
    const dayKey = getDayKeyFromValue(record.appliedAt);
    if (
        !dayKey ||
        record.type !== "reward" ||
        record.status !== "applied" ||
        record.isCancelled === true ||
        toSafeNumber(record.amountSigned) <= 0
    ) {
        return [];
    }

    return [
        {
            dayKey,
            sourceKey: "policeReward",
        },
    ];
};

const collectDirtyTargetsFromWrite = ({
    beforeData,
    afterData,
    resolver,
}) => {
    const dirtyTargetMap = new Map();

    [beforeData, afterData].forEach((data) => {
        if (!data) return;

        (resolver(data) || []).forEach((target) => {
            if (!target?.dayKey || !target?.sourceKey) {
                return;
            }

            dirtyTargetMap.set(
                `${target.dayKey}::${target.sourceKey}`,
                target,
            );
        });
    });

    return Array.from(dirtyTargetMap.values());
};

exports.markIncomeSettlementSummaryDirtyFromActivityLog = onDocumentWritten(
    {
        document: "classes/{classId}/students/{studentUid}/activityLogs/{logId}",
        region: REGION,
    },
    async (event) => markIncomeSettlementSummaryDirty({
        classId: event.params.classId,
        dirtyTargets: collectDirtyTargetsFromWrite({
            beforeData: event.data?.before?.exists
                ? event.data.before.data() || {}
                : null,
            afterData: event.data?.after?.exists
                ? event.data.after.data() || {}
                : null,
            resolver: collectActivitySummaryDirtyTargets,
        }),
        reason: "activity-log-write",
    }),
);

exports.markIncomeSettlementSummaryDirtyFromTradeHistory = onDocumentWritten(
    {
        document: "classes/{classId}/students/{studentUid}/tradeHistory/{logId}",
        region: REGION,
    },
    async (event) => markIncomeSettlementSummaryDirty({
        classId: event.params.classId,
        dirtyTargets: collectDirtyTargetsFromWrite({
            beforeData: event.data?.before?.exists
                ? event.data.before.data() || {}
                : null,
            afterData: event.data?.after?.exists
                ? event.data.after.data() || {}
                : null,
            resolver: collectTradeSummaryDirtyTargets,
        }),
        reason: "trade-history-write",
    }),
);

exports.markIncomeSettlementSummaryDirtyFromPoliceReward = onDocumentWritten(
    {
        document: "classes/{classId}/policeFineHistory/{recordId}",
        region: REGION,
    },
    async (event) => markIncomeSettlementSummaryDirty({
        classId: event.params.classId,
        dirtyTargets: collectDirtyTargetsFromWrite({
            beforeData: event.data?.before?.exists
                ? event.data.before.data() || {}
                : null,
            afterData: event.data?.after?.exists
                ? event.data.after.data() || {}
                : null,
            resolver: collectPoliceSummaryDirtyTargets,
        }),
        reason: "police-reward-write",
    }),
);

exports.syncIncomeSettlementBillSummary = onDocumentWritten(
    {
        document: "classes/{classId}/students/{studentUid}/taxBills/{billId}",
        region: REGION,
    },
    async (event) => {
        const beforeData = event.data?.before?.exists
            ? event.data.before.data() || {}
            : null;
        const afterData = event.data?.after?.exists
            ? event.data.after.data() || {}
            : null;

        if (!isIncomeSettlementBill(beforeData) && !isIncomeSettlementBill(afterData)) {
            return null;
        }

        return rebuildIncomeSettlementBillSummaryForStudents({
            classId: event.params.classId,
            studentUids: [event.params.studentUid],
        });
    },
);
