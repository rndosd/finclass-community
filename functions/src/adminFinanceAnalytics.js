"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const {
    RELATIVE_ECONOMY_SUMMARY_SCHEMA_VERSION,
    getRelativeEconomyStudentSourceFingerprint,
    getRelativeEconomySummaryPath,
    markRelativeEconomyProjectionDirty,
} = require("../utils/relativeEconomyProjection");

dayjs.extend(utc);
dayjs.extend(timezone);

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const { FieldValue } = admin.firestore;

const KST = "Asia/Seoul";
const PERIOD_OPTIONS = [7, 14, 30];
const MAX_LOOKBACK_DAYS = Math.max(...PERIOD_OPTIONS);
const SUMMARY_DOC_PATH = getRelativeEconomySummaryPath;
const SUMMARY_SCHEMA_VERSION = RELATIVE_ECONOMY_SUMMARY_SCHEMA_VERSION;
const REFRESH_LOCK_MS = 30 * 1000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

const getRequestOrigin = (request) => {
    const rawOrigin = String(request.rawRequest?.headers?.origin || "").trim();
    if (rawOrigin) {
        return rawOrigin;
    }

    const rawReferer = String(request.rawRequest?.headers?.referer || "").trim();
    if (!rawReferer) {
        return "";
    }

    try {
        return new URL(rawReferer).origin;
    } catch (_error) {
        return "";
    }
};

const isLocalOrigin = (origin) => {
    if (!origin) return false;

    try {
        const parsed = new URL(origin);
        return LOCAL_HOSTS.has(String(parsed.hostname || "").trim().toLowerCase());
    } catch (_error) {
        return false;
    }
};

const assertRelativeEconomyLocalOnly = (request) => {
    const origin = getRequestOrigin(request);
    if (isLocalOrigin(origin)) {
        return;
    }

    throw new HttpsError(
        "permission-denied",
        "Relative economy analytics is available only from local development.",
    );
};

const ACTIVITY_TYPE_MAP = {
    consumptionSpend: [
        "store",
        "store_purchase",
        "store_gift",
        "transfer_out",
        "rent_pay",
        "subscription_payment",
    ],
    consumptionRefund: [
        "store_refund",
        "subscription_payment_cancel",
    ],
    savingsCommit: [
        "deposit_join",
        "deposit_started",
        "subscription_payment",
    ],
    savingsRelease: [
        "deposit_return",
        "subscription_withdraw",
    ],
    savingsReversal: [
        "deposit_cancel",
        "deposit_terminate",
        "subscription_payment_cancel",
        "subscription_terminate",
    ],
    debtBorrow: [
        "loan",
        "loan_approve",
    ],
    debtRepay: [
        "loan_repayment",
    ],
    communityContribution: [
        "tax_payment",
        "donation",
    ],
    rulePenalty: [
        "fine",
    ],
    ruleRelief: [
        "fine_refund",
        "reward",
    ],
    missionSubmit: [
        "mission_submit",
    ],
    missionApproved: [
        "mission",
    ],
    missionRejected: [
        "mission_reject",
        "mission_reject_batch",
        "mission_reject_completion_batch",
    ],
    missionPenalty: [
        "mission_penalty",
    ],
    investmentEntry: [
        "stock_buy",
        "fund_subscribe",
        "real_estate",
        "auction_purchase",
        "currency_exchange",
        "exchange_out",
    ],
    investmentExit: [
        "stock_sell",
        "fund_redeem",
        "fund_order_refund",
        "auction_sale",
        "rent_income",
        "dividend",
        "exchange_in",
    ],
    investmentCost: [
        "stock_fee",
        "exchange_fee",
    ],
    riskSignal: [
        "arcade",
        "stock_buy",
        "stock_sell",
        "fund_subscribe",
        "fund_redeem",
        "currency_exchange",
        "exchange_in",
        "exchange_out",
        "loan_approve",
    ],
};

const CREDIT_SOURCE_MAP = {
    rulePenalty: [
        "police_rule",
        "police_fine",
    ],
    ruleRelief: [
        "police_fine_refund",
        "police_reward",
        "police_reward_refund",
        "police_cancel",
    ],
};

const AXIS_META = [
    { key: "consumptionManagementPercentile", label: "소비 관리", tone: "rose" },
    { key: "savingsAttitudePercentile", label: "저축 태도", tone: "emerald" },
    { key: "investmentParticipationPercentile", label: "투자 참여", tone: "indigo" },
    { key: "debtManagementPercentile", label: "부채 관리", tone: "blue" },
    { key: "ruleCompliancePercentile", label: "규칙 준수", tone: "amber" },
    { key: "communityContributionPercentile", label: "공동체 기여", tone: "teal" },
    { key: "missionDiligencePercentile", label: "미션 성실도", tone: "sky" },
    { key: "creditRecoveryPercentile", label: "신용 회복력", tone: "violet" },
];

const POSITIVE_AXIS_KEYS = AXIS_META.map((axis) => axis.key);
const AXIS_META_MAP = new Map(AXIS_META.map((axis) => [axis.key, axis]));

const ACTIVITY_CATEGORY_SETS = Object.fromEntries(
    Object.entries(ACTIVITY_TYPE_MAP).map(([key, values]) => [
        key,
        new Set(values.map((value) => String(value || "").trim())),
    ]),
);

const CREDIT_SOURCE_SETS = Object.fromEntries(
    Object.entries(CREDIT_SOURCE_MAP).map(([key, values]) => [
        key,
        new Set(values.map((value) => String(value || "").trim())),
    ]),
);

const clamp = (value, min = 0, max = 100) =>
    Math.min(max, Math.max(min, Number(value) || 0));

const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const average = (values = []) => {
    if (!Array.isArray(values) || values.length === 0) return 0;
    return values.reduce((sum, value) => sum + toNumber(value), 0) / values.length;
};

const normalizeValue = (value) => String(value || "").trim();

const safeRatio = (numerator, denominator, fallback = 0) => {
    const safeDenominator = Number(denominator);
    if (!Number.isFinite(safeDenominator) || safeDenominator <= 0) {
        return fallback;
    }
    return toNumber(numerator) / safeDenominator;
};

const toPercentile = (values, target) => {
    const numericValues = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));

    if (!numericValues.length || !Number.isFinite(Number(target))) {
        return 50;
    }

    if (numericValues.length === 1) {
        return 50;
    }

    const normalizedTarget = Number(target);
    let below = 0;
    let equal = 0;

    numericValues.forEach((value) => {
        if (value < normalizedTarget) below += 1;
        else if (value === normalizedTarget) equal += 1;
    });

    return clamp(((below + equal * 0.5) / numericValues.length) * 100);
};

const averageScores = (...values) => {
    const numericValues = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));

    if (!numericValues.length) return 50;
    return clamp(average(numericValues));
};

const toDateSafe = (value) => {
    if (!value) return null;
    if (typeof value.toDate === "function") {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const isStudentRole = (role) => {
    const normalized = normalizeValue(role).toLowerCase();
    return normalized !== "teacher" && normalized !== "admin";
};

const getStudentNetWorth = (student = {}) => {
    const assets = student.assets || {};
    const storedNetWorth = Number(assets.totalNetWorth);
    if (Number.isFinite(storedNetWorth)) {
        return storedNetWorth;
    }

    const cash = toNumber(assets.cash);
    const deposit = toNumber(assets.deposit);
    const loan = toNumber(assets.loan);
    const itemValue = toNumber(assets.itemValue);
    const realEstateValue = toNumber(assets.realEstateValue);
    const usdBalance = toNumber(assets.usdBalance);
    const stockValue = toNumber(assets?.stockValue?.value);
    const conversionRate = Math.max(
        1,
        toNumber(assets?.stockValue?.lastConversionRate, 10),
    );

    return (
        cash +
        deposit -
        loan +
        itemValue +
        realEstateValue +
        Math.round((usdBalance + stockValue) / conversionRate)
    );
};

const getGrossAssetBase = (student = {}) => {
    const assets = student.assets || {};
    const cash = toNumber(assets.cash);
    const deposit = toNumber(assets.deposit);
    const itemValue = toNumber(assets.itemValue);
    const realEstateValue = toNumber(assets.realEstateValue);
    const usdBalance = toNumber(assets.usdBalance);
    const stockValue = toNumber(assets?.stockValue?.value);
    const conversionRate = Math.max(
        1,
        toNumber(assets?.stockValue?.lastConversionRate, 10),
    );

    return (
        cash +
        deposit +
        itemValue +
        realEstateValue +
        Math.round((usdBalance + stockValue) / conversionRate)
    );
};

const getCurrentInvestmentBase = (student = {}) => {
    const assets = student.assets || {};
    const usdBalance = toNumber(assets.usdBalance);
    const stockValue = toNumber(assets?.stockValue?.value);
    const conversionRate = Math.max(
        1,
        toNumber(assets?.stockValue?.lastConversionRate, 10),
    );

    return Math.round((usdBalance + stockValue) / conversionRate);
};

const resolveDirectionalDelta = (log = {}) => {
    const candidates = [
        Number.isFinite(Number(log.adjustmentDelta))
            ? Number(log.adjustmentDelta)
            : null,
        Number.isFinite(Number(log.missionTokenDelta))
            ? Number(log.missionTokenDelta)
            : null,
        Number.isFinite(Number(log.delta))
            ? Number(log.delta)
            : null,
    ];

    return candidates.find((value) => value !== null && value !== 0) ?? null;
};

const getAmountInClass = (log) => {
    if (!log) return 0;

    const directionalAmount = resolveDirectionalDelta(log);
    if (directionalAmount !== null && directionalAmount !== 0) {
        return Math.abs(directionalAmount);
    }

    const classAmount = Number(log.amountInClassCurrency);
    if (Number.isFinite(classAmount) && classAmount !== 0) {
        return Math.abs(classAmount);
    }

    const rawAmount = Number(log.amount);
    if (Number.isFinite(rawAmount)) {
        return Math.abs(rawAmount);
    }

    if (Number.isFinite(classAmount)) {
        return Math.abs(classAmount);
    }

    return 0;
};

const sumActivityAmount = (activities, setKey) => {
    const targetSet = ACTIVITY_CATEGORY_SETS[setKey];
    if (!targetSet) return 0;

    return activities.reduce((sum, activity) => {
        const category = normalizeValue(activity.category);
        if (!targetSet.has(category)) return sum;
        return sum + getAmountInClass(activity);
    }, 0);
};

const countActivity = (activities, setKey) => {
    const targetSet = ACTIVITY_CATEGORY_SETS[setKey];
    if (!targetSet) return 0;

    return activities.reduce((count, activity) => {
        const category = normalizeValue(activity.category);
        return count + (targetSet.has(category) ? 1 : 0);
    }, 0);
};

const sumCreditDelta = (logs, setKey, direction = "all") => {
    const targetSet = CREDIT_SOURCE_SETS[setKey];
    if (!targetSet) return 0;

    return logs.reduce((sum, log) => {
        const source = normalizeValue(log.source);
        const delta = toNumber(log.delta);
        if (!targetSet.has(source)) return sum;

        if (direction === "positive") {
            return delta > 0 ? sum + delta : sum;
        }

        if (direction === "negative") {
            return delta < 0 ? sum + Math.abs(delta) : sum;
        }

        return sum + delta;
    }, 0);
};

const countCreditLogs = (logs, setKey, direction = "all") => {
    const targetSet = CREDIT_SOURCE_SETS[setKey];
    if (!targetSet) return 0;

    return logs.reduce((count, log) => {
        const source = normalizeValue(log.source);
        const delta = toNumber(log.delta);
        if (!targetSet.has(source)) return count;
        if (direction === "positive" && delta <= 0) return count;
        if (direction === "negative" && delta >= 0) return count;
        return count + 1;
    }, 0);
};

const getProfileMeta = (row, periodDays) => {
    if (
        row.attentionScore >= 70 &&
        row.consumptionManagementPercentile <= 40 &&
        row.riskTendencyPercentile >= 65
    ) {
        return {
            id: "coaching",
            tone: "rose",
            label: "코칭 우선",
            description: `최근 ${periodDays}일 기준 소비 부담과 위험 신호가 함께 높습니다. 예산 지키기와 지출 우선순위 코칭을 먼저 붙여보는 편이 좋습니다.`,
        };
    }

    if (
        row.savingsAttitudePercentile >= 70 &&
        row.debtManagementPercentile >= 60 &&
        row.ruleCompliancePercentile >= 60
    ) {
        return {
            id: "stable",
            tone: "emerald",
            label: "안정형",
            description: "저축 습관과 부채 관리가 안정적이고 규칙 리스크도 낮은 편입니다. 장기 목표형 과제를 줘보기에 좋습니다.",
        };
    }

    if (
        row.communityContributionPercentile >= 60 &&
        row.missionDiligencePercentile >= 70
    ) {
        return {
            id: "responsible",
            tone: "teal",
            label: "책임형",
            description: "세금/기부 같은 공동체 참여와 미션 수행력이 함께 높은 학생입니다. 반 운영 역할을 맡겨보기 좋습니다.",
        };
    }

    if (row.creditRecoveryPercentile >= 70 && row.creditChange > 0) {
        return {
            id: "recovery",
            tone: "sky",
            label: "회복형",
            description: `최근 ${periodDays}일 동안 신용이 반 평균보다 빠르게 회복되었습니다. 실패 이후 복구하는 힘이 보입니다.`,
        };
    }

    if (row.activityPercentile <= 20 && row.activityCount <= 1) {
        return {
            id: "low-signal",
            tone: "amber",
            label: "관찰 필요",
            description: `최근 ${periodDays}일 동안 기록된 행동이 많지 않아 해석 신호가 약합니다. 참여 기회를 먼저 늘려보는 편이 좋습니다.`,
        };
    }

    return {
        id: "balanced",
        tone: "slate",
        label: "균형 관찰형",
        description: "특정 축으로 과하게 치우친 모습보다 중간권 신호가 모여 있습니다. 다음 변화 추이를 계속 보면 좋습니다.",
    };
};

const getPeriodContext = (periodDays, now = dayjs().tz(KST)) => {
    const today = now.startOf("day");
    const startDay = today.subtract(periodDays - 1, "day");
    const endDay = today;
    const startAt = startDay.startOf("day");
    const endAt = endDay.endOf("day");
    const lastSnapshotDay = endDay.subtract(1, "day");
    const snapshotDays = [];
    let cursor = startDay;

    while (!cursor.isAfter(lastSnapshotDay, "day")) {
        if (cursor.day() !== 0 && cursor.day() !== 6) {
            snapshotDays.push(cursor.format("YYYY-MM-DD"));
        }
        cursor = cursor.add(1, "day");
    }

    return {
        periodDays,
        startDay,
        endDay,
        startMs: startAt.valueOf(),
        endMs: endAt.valueOf(),
        startTimestamp: admin.firestore.Timestamp.fromDate(startAt.toDate()),
        endTimestamp: admin.firestore.Timestamp.fromDate(endAt.toDate()),
        snapshotDays,
        snapshotDaySet: new Set(snapshotDays),
        generatedAtMs: now.valueOf(),
        startDateKey: startDay.format("YYYY-MM-DD"),
        endDateKey: endDay.format("YYYY-MM-DD"),
    };
};

const toMillis = (value) => {
    const date = toDateSafe(value);
    return date ? date.getTime() : null;
};

const buildCreditMetrics = ({
    creditLogs = [],
    currentCreditScore = 0,
    periodContext,
}) => {
    if (!Array.isArray(creditLogs) || creditLogs.length === 0) {
        return {
            creditChange: 0,
            creditVolatility: 0,
        };
    }

    const dayDeltaMap = new Map();
    let totalDelta = 0;

    creditLogs.forEach((log) => {
        const delta = toNumber(log.delta);
        totalDelta += delta;

        const dayKey = dayjs(toDateSafe(log.timestamp)).tz(KST).format("YYYY-MM-DD");
        dayDeltaMap.set(dayKey, (dayDeltaMap.get(dayKey) || 0) + delta);
    });

    const startScore = currentCreditScore - totalDelta;
    const snapshotScores = [];
    let runningScore = startScore;
    let cursor = periodContext.startDay;

    while (!cursor.isAfter(periodContext.endDay, "day")) {
        const dayKey = cursor.format("YYYY-MM-DD");
        runningScore += dayDeltaMap.get(dayKey) || 0;
        if (periodContext.snapshotDaySet.has(dayKey)) {
            snapshotScores.push(runningScore);
        }
        cursor = cursor.add(1, "day");
    }

    const initialCreditScore =
        snapshotScores.length > 0 ? snapshotScores[0] : currentCreditScore;

    let creditVolatility = 0;
    if (snapshotScores.length > 1) {
        let totalAbsDiff = 0;
        for (let index = 1; index < snapshotScores.length; index += 1) {
            totalAbsDiff += Math.abs(snapshotScores[index] - snapshotScores[index - 1]);
        }
        creditVolatility = totalAbsDiff / (snapshotScores.length - 1);
    }

    return {
        creditChange: currentCreditScore - initialCreditScore,
        creditVolatility,
    };
};

const filterEntriesForPeriod = (entries = [], periodContext) =>
    entries.filter((entry) => {
        const timestampMs = toMillis(entry.timestamp || entry.createdAt);
        return (
            Number.isFinite(timestampMs) &&
            timestampMs >= periodContext.startMs &&
            timestampMs <= periodContext.endMs
        );
    });

const buildBaseRowsForPeriod = ({
    students,
    activitiesByStudent,
    creditLogsByStudent,
    periodContext,
}) =>
    students.map((student) => {
        const activities = filterEntriesForPeriod(
            activitiesByStudent.get(student.uid) || [],
            periodContext,
        );
        const creditLogs = filterEntriesForPeriod(
            creditLogsByStudent.get(student.uid) || [],
            periodContext,
        );

        const incomeAmount = activities.reduce((sum, activity) => {
            const category = normalizeValue(activity.category);
            if (
                ACTIVITY_CATEGORY_SETS.consumptionSpend.has(category) ||
                ACTIVITY_CATEGORY_SETS.savingsCommit.has(category) ||
                ACTIVITY_CATEGORY_SETS.debtRepay.has(category) ||
                ACTIVITY_CATEGORY_SETS.communityContribution.has(category) ||
                ACTIVITY_CATEGORY_SETS.rulePenalty.has(category) ||
                ACTIVITY_CATEGORY_SETS.investmentEntry.has(category) ||
                ACTIVITY_CATEGORY_SETS.investmentCost.has(category)
            ) {
                return sum;
            }

            return sum + getAmountInClass(activity);
        }, 0);

        const netConsumptionAmount = Math.max(
            0,
            sumActivityAmount(activities, "consumptionSpend") -
                sumActivityAmount(activities, "consumptionRefund"),
        );
        const savingsCommittedAmount = sumActivityAmount(activities, "savingsCommit");
        const savingsReversalAmount = sumActivityAmount(activities, "savingsReversal");
        const savingsReleasedAmount = sumActivityAmount(activities, "savingsRelease");
        const debtBorrowAmount = sumActivityAmount(activities, "debtBorrow");
        const debtRepayAmount = sumActivityAmount(activities, "debtRepay");
        const communityContributionAmount = sumActivityAmount(
            activities,
            "communityContribution",
        );
        const rulePenaltyAmount = sumActivityAmount(activities, "rulePenalty");
        const ruleReliefAmount = sumActivityAmount(activities, "ruleRelief");
        const investmentEntryAmount = sumActivityAmount(activities, "investmentEntry");
        const investmentExitAmount = sumActivityAmount(activities, "investmentExit");
        const investmentCostAmount = sumActivityAmount(activities, "investmentCost");
        const riskSignalAmount = sumActivityAmount(activities, "riskSignal");

        const ruleCreditPenalty = sumCreditDelta(
            creditLogs,
            "rulePenalty",
            "negative",
        );
        const ruleCreditRelief = sumCreditDelta(
            creditLogs,
            "ruleRelief",
            "positive",
        );

        const missionSubmitCount = countActivity(activities, "missionSubmit");
        const missionApprovedCount = countActivity(activities, "missionApproved");
        const missionRejectedCount = countActivity(activities, "missionRejected");
        const missionPenaltyCount = countActivity(activities, "missionPenalty");
        const arcadeCount = activities.reduce((count, activity) =>
            count + (normalizeValue(activity.category) === "arcade" ? 1 : 0), 0);
        const riskSignalCount = countActivity(activities, "riskSignal");
        const ruleIncidentCount =
            countActivity(activities, "rulePenalty") +
            countCreditLogs(creditLogs, "rulePenalty", "negative");
        const communityActionCount = countActivity(
            activities,
            "communityContribution",
        );

        const currentNetWorth = getStudentNetWorth(student);
        const grossAssetBase = Math.max(getGrossAssetBase(student), 0);
        const currentInvestmentBase = Math.max(getCurrentInvestmentBase(student), 0);
        const currentCreditScore = toNumber(student.creditScore);
        const creditMetrics = buildCreditMetrics({
            creditLogs,
            currentCreditScore,
            periodContext,
        });

        const netConsumptionRatio = safeRatio(netConsumptionAmount, incomeAmount, 0);
        const savingsShare = safeRatio(student.assets?.deposit, grossAssetBase, 0);
        const savingsFlowRatio = safeRatio(
            savingsCommittedAmount + savingsReleasedAmount * 0.35,
            incomeAmount,
            0,
        );
        const savingsReversalRatio = safeRatio(
            savingsReversalAmount,
            savingsCommittedAmount,
            0,
        );
        const investmentFlowRatio = safeRatio(
            investmentEntryAmount,
            incomeAmount,
            0,
        );
        const investmentShare = safeRatio(
            currentInvestmentBase,
            grossAssetBase,
            0,
        );
        const loanBurden = safeRatio(student.assets?.loan, grossAssetBase, 0);
        const repaymentCoverage =
            debtBorrowAmount > 0
                ? safeRatio(debtRepayAmount, debtBorrowAmount, 0)
                : loanBurden > 0
                    ? 0
                    : 1;
        const ruleRiskRatio = safeRatio(
            rulePenaltyAmount + ruleCreditPenalty,
            incomeAmount,
            0,
        );
        const communityContributionRatio = safeRatio(
            communityContributionAmount,
            incomeAmount,
            0,
        );
        const missionApprovalRate = safeRatio(
            missionApprovedCount,
            Math.max(missionSubmitCount, missionApprovedCount),
            0,
        );
        const missionRejectionRate = safeRatio(
            missionRejectedCount + missionPenaltyCount,
            Math.max(missionSubmitCount, 1),
            0,
        );
        const missionEngagement = missionApprovedCount + missionSubmitCount;
        const riskPressureRatio = safeRatio(
            riskSignalAmount + investmentCostAmount + debtBorrowAmount * 0.4,
            incomeAmount,
            0,
        );
        const riskTradeIntensity = safeRatio(
            riskSignalCount + arcadeCount,
            Math.max(activities.length, 1),
            0,
        );

        return {
            uid: student.uid,
            name: student.name || "이름 없음",
            studentNumber: student.studentNumber || "",
            activityCount: activities.length,
            currentNetWorth,
            currentCreditScore,
            incomeAmount,
            netConsumptionAmount,
            netConsumptionRatio,
            savingsCommittedAmount,
            savingsReversalAmount,
            savingsShare,
            savingsFlowRatio,
            savingsReversalRatio,
            investmentEntryAmount,
            investmentExitAmount,
            investmentFlowRatio,
            investmentShare,
            debtBorrowAmount,
            debtRepayAmount,
            loanBurden,
            repaymentCoverage,
            rulePenaltyAmount,
            ruleReliefAmount,
            ruleCreditPenalty,
            ruleCreditRelief,
            ruleRiskRatio,
            ruleIncidentCount,
            communityContributionAmount,
            communityContributionRatio,
            communityActionCount,
            missionSubmitCount,
            missionApprovedCount,
            missionRejectedCount,
            missionPenaltyCount,
            missionApprovalRate,
            missionRejectionRate,
            missionEngagement,
            currentInvestmentBase,
            creditChange: creditMetrics.creditChange,
            creditVolatility: creditMetrics.creditVolatility,
            riskPressureRatio,
            riskTradeIntensity,
            arcadeCount,
        };
    });

const decorateRowsWithScores = (baseRows, periodDays) => {
    const assetValues = baseRows.map((row) => row.currentNetWorth);
    const consumptionRatioValues = baseRows.map((row) => row.netConsumptionRatio);
    const savingsShareValues = baseRows.map((row) => row.savingsShare);
    const savingsFlowValues = baseRows.map((row) => row.savingsFlowRatio);
    const savingsReversalValues = baseRows.map((row) => row.savingsReversalRatio);
    const investmentFlowValues = baseRows.map((row) => row.investmentFlowRatio);
    const investmentShareValues = baseRows.map((row) => row.investmentShare);
    const debtBurdenValues = baseRows.map((row) => row.loanBurden);
    const repaymentCoverageValues = baseRows.map((row) => row.repaymentCoverage);
    const ruleRiskValues = baseRows.map((row) => row.ruleRiskRatio);
    const communityValues = baseRows.map((row) => row.communityContributionRatio);
    const communityCountValues = baseRows.map((row) => row.communityActionCount);
    const missionApprovalValues = baseRows.map((row) => row.missionApprovalRate);
    const missionEngagementValues = baseRows.map((row) => row.missionEngagement);
    const missionRejectionValues = baseRows.map((row) => row.missionRejectionRate);
    const creditChangeValues = baseRows.map((row) => row.creditChange);
    const creditScoreValues = baseRows.map((row) => row.currentCreditScore);
    const creditVolatilityValues = baseRows.map((row) => row.creditVolatility);
    const riskPressureValues = baseRows.map((row) => row.riskPressureRatio);
    const riskTradeValues = baseRows.map((row) => row.riskTradeIntensity);
    const activityValues = baseRows.map((row) => row.activityCount);

    return baseRows.map((row) => {
        const assetPercentile = toPercentile(assetValues, row.currentNetWorth);
        const consumptionManagementPercentile = averageScores(
            100 - toPercentile(consumptionRatioValues, row.netConsumptionRatio),
            100 -
                toPercentile(
                    activityValues,
                    row.activityCount > 0 ? row.activityCount : 0,
                ) *
                    0.15,
        );
        const savingsAttitudePercentile = averageScores(
            toPercentile(savingsShareValues, row.savingsShare),
            toPercentile(savingsFlowValues, row.savingsFlowRatio),
            100 - toPercentile(savingsReversalValues, row.savingsReversalRatio),
        );
        const investmentParticipationPercentile = averageScores(
            toPercentile(investmentFlowValues, row.investmentFlowRatio),
            toPercentile(investmentShareValues, row.investmentShare),
        );
        const debtManagementPercentile = averageScores(
            100 - toPercentile(debtBurdenValues, row.loanBurden),
            toPercentile(repaymentCoverageValues, row.repaymentCoverage),
        );
        const ruleCompliancePercentile = averageScores(
            100 - toPercentile(ruleRiskValues, row.ruleRiskRatio),
            100 - toPercentile(activityValues, row.ruleIncidentCount),
        );
        const communityContributionPercentile = averageScores(
            toPercentile(communityValues, row.communityContributionRatio),
            toPercentile(communityCountValues, row.communityActionCount),
        );
        const missionDiligencePercentile = averageScores(
            toPercentile(missionApprovalValues, row.missionApprovalRate),
            toPercentile(missionEngagementValues, row.missionEngagement),
            100 - toPercentile(missionRejectionValues, row.missionRejectionRate),
        );
        const creditRecoveryPercentile = averageScores(
            toPercentile(creditChangeValues, row.creditChange),
            toPercentile(creditScoreValues, row.currentCreditScore),
            100 - toPercentile(creditVolatilityValues, row.creditVolatility),
        );
        const riskTendencyPercentile = averageScores(
            toPercentile(riskPressureValues, row.riskPressureRatio),
            toPercentile(riskTradeValues, row.riskTradeIntensity),
            toPercentile(debtBurdenValues, row.loanBurden),
        );
        const activityPercentile = toPercentile(activityValues, row.activityCount);

        const attentionScore = Math.round(
            clamp(
                (100 - consumptionManagementPercentile) * 0.24 +
                    (100 - savingsAttitudePercentile) * 0.16 +
                    (100 - debtManagementPercentile) * 0.14 +
                    (100 - ruleCompliancePercentile) * 0.14 +
                    (100 - missionDiligencePercentile) * 0.12 +
                    riskTendencyPercentile * 0.2,
            ),
        );

        const rowWithScores = {
            ...row,
            assetPercentile,
            consumptionManagementPercentile,
            savingsAttitudePercentile,
            investmentParticipationPercentile,
            debtManagementPercentile,
            ruleCompliancePercentile,
            communityContributionPercentile,
            missionDiligencePercentile,
            creditRecoveryPercentile,
            riskTendencyPercentile,
            activityPercentile,
            attentionScore,
        };

        const strengths = POSITIVE_AXIS_KEYS.map((key) => ({
            ...AXIS_META_MAP.get(key),
            value: rowWithScores[key],
        }))
            .sort((left, right) => right.value - left.value)
            .slice(0, 3)
            .map((axis) => axis.key);

        return {
            ...rowWithScores,
            strengthKeys: strengths,
            profileId: getProfileMeta(rowWithScores, periodDays).id,
        };
    });
};

const buildSummaryForPeriod = (rows = []) => {
    const coachingNeededCount = rows.filter((row) => row.attentionScore >= 70).length;
    const stableCount = rows.filter(
        (row) =>
            row.savingsAttitudePercentile >= 70 &&
            row.debtManagementPercentile >= 60 &&
            row.ruleCompliancePercentile >= 60,
    ).length;
    const responsibleCount = rows.filter(
        (row) =>
            row.communityContributionPercentile >= 60 &&
            row.missionDiligencePercentile >= 70,
    ).length;

    return {
        studentCount: rows.length,
        coachingNeededCount,
        stableCount,
        responsibleCount,
        averageConsumptionRatio: average(rows.map((row) => row.netConsumptionRatio)),
    };
};

const readTargetStudents = async (classId) => {
    const snapshot = await db.collection(`classes/${classId}/students`).get();
    return snapshot.docs
        .map((docSnap) => ({
            uid: docSnap.id,
            ...docSnap.data(),
        }))
        .filter((student) => isStudentRole(student.role));
};

const readClassActivityLogs = async (classId, lookbackContext) => {
    const snapshot = await db
        .collectionGroup("activityLogs")
        .where("classId", "==", classId)
        .where("createdAt", ">=", lookbackContext.startTimestamp)
        .where("createdAt", "<=", lookbackContext.endTimestamp)
        .orderBy("createdAt", "desc")
        .select(
            "studentUid",
            "category",
            "amount",
            "adjustmentDelta",
            "missionTokenDelta",
            "delta",
            "amountInClassCurrency",
            "createdAt",
            "timestamp",
        )
        .get();

    const activitiesByStudent = new Map();
    snapshot.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const studentUid = normalizeValue(data.studentUid);
        if (!studentUid) return;

        if (!activitiesByStudent.has(studentUid)) {
            activitiesByStudent.set(studentUid, []);
        }

        activitiesByStudent.get(studentUid).push({
            category: data.category || "",
            amount: data.amount ?? 0,
            adjustmentDelta: data.adjustmentDelta ?? null,
            missionTokenDelta: data.missionTokenDelta ?? null,
            delta: data.delta ?? null,
            amountInClassCurrency: data.amountInClassCurrency ?? null,
            createdAt: toDateSafe(data.createdAt) || toDateSafe(data.timestamp),
            timestamp: toDateSafe(data.createdAt) || toDateSafe(data.timestamp),
        });
    });

    return activitiesByStudent;
};

const readCreditLogsForStudents = async (classId, students, lookbackContext) => {
    const creditLogsByStudent = new Map(students.map((student) => [student.uid, []]));
    const batchSize = 20;

    for (let index = 0; index < students.length; index += batchSize) {
        const batch = students.slice(index, index + batchSize);
        const batchResults = await Promise.all(
            batch.map(async (student) => {
                const snapshot = await db
                    .collection(`classes/${classId}/students/${student.uid}/creditLogs`)
                    .where("timestamp", ">=", lookbackContext.startTimestamp)
                    .where("timestamp", "<=", lookbackContext.endTimestamp)
                    .orderBy("timestamp", "asc")
                    .select("studentUid", "source", "delta", "timestamp")
                    .get();

                return [
                    student.uid,
                    snapshot.docs.map((docSnap) => {
                        const data = docSnap.data() || {};
                        return {
                            studentUid: normalizeValue(data.studentUid) || student.uid,
                            source: data.source || "",
                            delta: toNumber(data.delta),
                            timestamp: toDateSafe(data.timestamp),
                        };
                    }),
                ];
            }),
        );

        batchResults.forEach(([uid, logs]) => {
            creditLogsByStudent.set(uid, logs);
        });
    }

    return creditLogsByStudent;
};

const normalizeExportStudents = (students = []) => {
    const deduped = new Map();

    (Array.isArray(students) ? students : []).forEach((student) => {
        const uid = normalizeValue(student?.uid);
        if (!uid || deduped.has(uid)) return;

        deduped.set(uid, {
            uid,
            name: normalizeValue(student?.name),
            studentNumber: normalizeValue(student?.studentNumber),
        });
    });

    return [...deduped.values()];
};

const toIsoStringOrNull = (value) => {
    const date = toDateSafe(value);
    return date ? date.toISOString() : null;
};

const readCreditLogExportRows = async (
    classId,
    students,
    { startDate = null, endDate = null } = {},
) => {
    const batchSize = 20;
    const startTimestamp = startDate
        ? admin.firestore.Timestamp.fromDate(
            dayjs(startDate).tz(KST).startOf("day").toDate(),
        )
        : null;
    const endTimestamp = endDate
        ? admin.firestore.Timestamp.fromDate(
            dayjs(endDate).tz(KST).endOf("day").toDate(),
        )
        : null;
    const rows = [];

    for (let index = 0; index < students.length; index += batchSize) {
        const batch = students.slice(index, index + batchSize);
        const batchRows = await Promise.all(
            batch.map(async (student) => {
                let creditLogQuery = db
                    .collection(`classes/${classId}/students/${student.uid}/creditLogs`)
                    .orderBy("timestamp", "desc")
                    .select("studentUid", "delta", "amount", "reason", "source", "timestamp");

                if (startTimestamp) {
                    creditLogQuery = creditLogQuery.where("timestamp", ">=", startTimestamp);
                }

                if (endTimestamp) {
                    creditLogQuery = creditLogQuery.where("timestamp", "<=", endTimestamp);
                }

                const snapshot = await creditLogQuery.get();
                return snapshot.docs.map((docSnap) => {
                    const data = docSnap.data() || {};
                    return {
                        id: docSnap.id,
                        studentUid: student.uid,
                        studentName: student.name || "",
                        studentNumber: student.studentNumber || "",
                        delta: toNumber(data.delta, toNumber(data.amount)),
                        amount: toNumber(data.amount, toNumber(data.delta)),
                        reason: data.reason || "",
                        source: data.source || "",
                        timestamp: toIsoStringOrNull(data.timestamp),
                    };
                });
            }),
        );

        rows.push(...batchRows.flat());
    }

    return rows;
};

const readCreditHistoryExportRows = async (
    classId,
    students,
    { startDate = null, endDate = null } = {},
) => {
    const batchSize = 20;
    const rows = [];

    for (let index = 0; index < students.length; index += batchSize) {
        const batch = students.slice(index, index + batchSize);
        const batchRows = await Promise.all(
            batch.map(async (student) => {
                let creditHistoryQuery = db
                    .collection(`classes/${classId}/students/${student.uid}/creditHistory`)
                    .orderBy("date", "desc")
                    .select("date", "score", "timestamp");

                if (startDate) {
                    creditHistoryQuery = creditHistoryQuery.where("date", ">=", startDate);
                }

                if (endDate) {
                    creditHistoryQuery = creditHistoryQuery.where("date", "<=", endDate);
                }

                const snapshot = await creditHistoryQuery.get();
                return snapshot.docs.map((docSnap) => {
                    const data = docSnap.data() || {};
                    return {
                        id: docSnap.id,
                        studentUid: student.uid,
                        studentName: student.name || "",
                        studentNumber: student.studentNumber || "",
                        date: normalizeValue(data.date),
                        score: toNumber(data.score),
                        timestamp: toIsoStringOrNull(data.timestamp),
                    };
                });
            }),
        );

        rows.push(...batchRows.flat());
    }

    return rows;
};

const buildRelativeEconomySummary = async (classId) => {
    const now = dayjs().tz(KST);
    const lookbackContext = getPeriodContext(MAX_LOOKBACK_DAYS, now);
    const students = await readTargetStudents(classId);

    const [activitiesByStudent, creditLogsByStudent] = await Promise.all([
        readClassActivityLogs(classId, lookbackContext),
        readCreditLogsForStudents(classId, students, lookbackContext),
    ]);

    const periods = {};

    PERIOD_OPTIONS.forEach((periodDays) => {
        const periodContext = getPeriodContext(periodDays, now);
        const baseRows = buildBaseRowsForPeriod({
            students,
            activitiesByStudent,
            creditLogsByStudent,
            periodContext,
        });
        const rows = decorateRowsWithScores(baseRows, periodDays);

        periods[String(periodDays)] = {
            periodDays,
            startDateKey: periodContext.startDateKey,
            endDateKey: periodContext.endDateKey,
            generatedAtMs: periodContext.generatedAtMs,
            rowCount: rows.length,
            rows,
            summary: buildSummaryForPeriod(rows),
        };
    });

    return {
        schemaVersion: SUMMARY_SCHEMA_VERSION,
        classId,
        lastComputedAtMs: Date.now(),
        periodKeys: PERIOD_OPTIONS,
        periods,
        needsRefresh: false,
        refreshInProgress: false,
        lastMutationAtMs: null,
        lastError: null,
        updatedAt: FieldValue.serverTimestamp(),
    };
};

const markRelativeEconomyDirty = async (classId, reason) => {
    return markRelativeEconomyProjectionDirty({
        db,
        FieldValue,
        classId,
        reason,
    });
};

const shouldSkipStudentSummaryDirtyMark = (event) => {
    const beforeData = event.data?.before?.exists ? event.data.before.data() || {} : null;
    const afterData = event.data?.after?.exists ? event.data.after.data() || {} : null;

    if (!beforeData || !afterData) return false;

    return (
        getRelativeEconomyStudentSourceFingerprint(beforeData) ===
        getRelativeEconomyStudentSourceFingerprint(afterData)
    );
};

exports.refreshRelativeEconomyAnalytics = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 120,
        memory: "512MiB",
    },
    async (request) => {
        const classId = normalizeValue(request.data?.classId);
        const force = request.data?.force === true;

        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        assertTeacherOrAdminFromClaims(request, { classId });
        assertRelativeEconomyLocalOnly(request);

        const summaryRef = db.doc(SUMMARY_DOC_PATH(classId));
        const summarySnap = await summaryRef.get();
        const summaryData = summarySnap.exists ? summarySnap.data() || {} : {};
        const now = Date.now();

        if (
            !force &&
            summarySnap.exists &&
            summaryData.schemaVersion === SUMMARY_SCHEMA_VERSION &&
            summaryData.needsRefresh !== true &&
            summaryData.refreshInProgress !== true &&
            typeof summaryData.lastComputedAtMs === "number" &&
            now - summaryData.lastComputedAtMs < REFRESH_LOCK_MS &&
            summaryData.periods
        ) {
            return summaryData;
        }

        if (
            summaryData.refreshInProgress === true &&
            typeof summaryData.refreshRequestedAtMs === "number" &&
            now - summaryData.refreshRequestedAtMs < REFRESH_LOCK_MS &&
            summaryData.periods &&
            !force
        ) {
            return summaryData;
        }

        await summaryRef.set(
            {
                schemaVersion: SUMMARY_SCHEMA_VERSION,
                refreshInProgress: true,
                refreshRequestedAtMs: now,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );

        try {
            const payload = await buildRelativeEconomySummary(classId);
            await summaryRef.set(payload, { merge: true });
            return payload;
        } catch (error) {
            await summaryRef.set(
                {
                    schemaVersion: SUMMARY_SCHEMA_VERSION,
                    refreshInProgress: false,
                    needsRefresh: true,
                    lastError: error?.message || "relative economy refresh failed",
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
            throw new HttpsError(
                "internal",
                error?.message || "relative economy refresh failed",
            );
        }
    },
);

exports.exportAdminCreditData = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 120,
        memory: "512MiB",
    },
    async (request) => {
        const classId = normalizeValue(request.data?.classId);
        const targetStudents = normalizeExportStudents(request.data?.targetStudents);
        const selectedRecordTypes = Array.isArray(request.data?.selectedRecordTypes)
            ? request.data.selectedRecordTypes.map((value) => normalizeValue(value))
            : [];
        const startDate = normalizeValue(request.data?.startDate) || null;
        const endDate = normalizeValue(request.data?.endDate) || null;
        const shouldFetchLogs = selectedRecordTypes.includes("creditLogs");
        const shouldFetchHistory = selectedRecordTypes.includes("creditHistory");

        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        if (!targetStudents.length) {
            throw new HttpsError("invalid-argument", "targetStudents is required.");
        }

        if (!shouldFetchLogs && !shouldFetchHistory) {
            throw new HttpsError(
                "invalid-argument",
                "selectedRecordTypes must include creditLogs or creditHistory.",
            );
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        const [logs, history] = await Promise.all([
            shouldFetchLogs
                ? readCreditLogExportRows(classId, targetStudents, { startDate, endDate })
                : Promise.resolve([]),
            shouldFetchHistory
                ? readCreditHistoryExportRows(classId, targetStudents, { startDate, endDate })
                : Promise.resolve([]),
        ]);

        return {
            logs,
            history,
        };
    },
);

exports.markRelativeEconomyDirtyFromActivityLog = onDocumentWritten(
    {
        document: "classes/{classId}/students/{studentUid}/activityLogs/{logId}",
        region: "asia-northeast3",
    },
    async (event) => markRelativeEconomyDirty(
        event.params.classId,
        "activity-log-write",
    ),
);

exports.markRelativeEconomyDirtyFromCreditLog = onDocumentWritten(
    {
        document: "classes/{classId}/students/{studentUid}/creditLogs/{logId}",
        region: "asia-northeast3",
    },
    async (event) => markRelativeEconomyDirty(
        event.params.classId,
        "credit-log-write",
    ),
);

async function handleRelativeEconomyDirtyFromStudent(event) {
    if (shouldSkipStudentSummaryDirtyMark(event)) {
        return null;
    }

    return markRelativeEconomyDirty(
        event.params.classId,
        "student-summary-write",
    );
}

exports.__handleRelativeEconomyDirtyFromStudent =
    handleRelativeEconomyDirtyFromStudent;
