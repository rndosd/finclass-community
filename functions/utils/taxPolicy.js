"use strict";

const TREASURY_MODE_VALUES = new Set(["NONE", "TAX_ONLY", "TOTAL"]);

const createWithholdingPolicy = () => ({
    enabled: false,
    taxRate: 0,
    exemptionAmount: 0,
    monthEndSettlementEnabled: true,
    enabledFrom: null,
});

const createDefaultTaxBillLateFeePolicy = () => ({
    enabled: false,
    mode: "fixed",
    dailyAmount: 0,
    dailyRate: 0,
    graceDays: 0,
});

const createDefaultPeriodIncomeSettlementPolicy = () => ({
    enabled: false,
    activationDateKey: null,
    dailyAggregationEnabled: false,
    scheduleEnabled: false,
    sourceKeys: [],
});

const createDefaultMonthEndSettlementPolicy = () => ({
    version: 1,
    lastClosedAt: null,
    activeDraftId: null,
    lockedPeriodEndAt: null,
    taxBrackets: [
        { upToAmount: 5000, rate: 5 },
        { upToAmount: 10000, rate: 10 },
        { upToAmount: null, rate: 15 },
    ],
    exemptionGroups: [
        {
            id: "activityReward",
            label: "활동보상 비과세",
            enabled: true,
            amount: 2000,
            sourceKeys: [
                "missionReward",
                "jobBoardReward",
                "policeReward",
                "incentivePayment",
            ],
        },
        {
            id: "prizeIncome",
            label: "상금 비과세",
            enabled: true,
            amount: 1000,
            sourceKeys: ["arcadePrize"],
        },
        {
            id: "assetIncome",
            label: "자산소득 비과세",
            enabled: false,
            amount: 0,
            sourceKeys: ["depositInterest", "stockDividend", "realEstateRent"],
        },
    ],
    incomeDeductions: {
        basic: { enabled: true, label: "기본공제", amount: 1000 },
        labor: {
            enabled: true,
            label: "근로소득공제",
            sourceKeys: ["payrollSalary", "payrollBonus", "incentivePayment"],
            rate: 20,
            maxAmount: 3000,
        },
        storeSpending: {
            enabled: true,
            label: "상점 소비공제",
            rate: 10,
            maxAmount: 2000,
            minSpendingAmount: 0,
        },
        activity: {
            enabled: false,
            label: "활동 소득공제",
            sourceKeys: ["missionReward", "jobBoardReward", "policeReward"],
            rate: 10,
            maxAmount: 2000,
        },
        manual: { enabled: true, label: "수동 소득공제" },
    },
    taxCredits: {
        donation: {
            enabled: true,
            label: "기부금 세액공제",
            rate: 15,
            maxAmount: 1000,
        },
        manual: { enabled: true, label: "수동 세액공제" },
    },
});

const createDefaultTaxPolicy = () => ({
    version: 1,
    treasury: {
        store: { mode: "NONE" },
        payroll: { mode: "NONE" },
        police: {
            fineEnabled: false,
            rewardExpenseEnabled: false,
        },
    },
    withholding: {
        depositInterest: {
            ...createWithholdingPolicy(),
            enabledFrom: null,
        },
        payrollBonus: {
            ...createWithholdingPolicy(),
            enabledFrom: null,
        },
        payrollSalary: createWithholdingPolicy(),
        incentivePayment: createWithholdingPolicy(),
        jobBoardReward: createWithholdingPolicy(),
        missionReward: createWithholdingPolicy(),
        policeReward: createWithholdingPolicy(),
        arcadePrize: createWithholdingPolicy(),
        stockDividend: createWithholdingPolicy(),
        realEstateRent: createWithholdingPolicy(),
        assetAdjustment: createWithholdingPolicy(),
    },
    billLateFee: createDefaultTaxBillLateFeePolicy(),
    monthEndSettlement: createDefaultMonthEndSettlementPolicy(),
    periodIncomeSettlement: createDefaultPeriodIncomeSettlementPolicy(),
    incomeSettlement: {
        missionReward: {
            enabled: false,
            taxRate: 0,
            exemptionThreshold: 0,
            enabledFrom: null,
        },
        policeReward: {
            enabled: false,
            taxRate: 0,
            exemptionThreshold: 0,
            enabledFrom: null,
        },
        assetAdjustment: {
            enabled: false,
            taxRate: 0,
            exemptionThreshold: 0,
            enabledFrom: null,
        },
        arcadePrize: {
            enabled: false,
            taxRate: 0,
            exemptionThreshold: 0,
            enabledFrom: null,
            profitBasis: "net_cash",
        },
        dividend: {
            enabled: false,
            taxRate: 0,
            exemptionThreshold: 0,
            enabledFrom: null,
        },
        stockCapitalGain: {
            enabled: false,
            taxRate: 0,
            exemptionThreshold: 0,
            enabledFrom: null,
            offsetLosses: true,
        },
    },
});

const isPlainObject = (value) =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

const cloneValue = (value) => {
    if (Array.isArray(value)) {
        return value.map(cloneValue);
    }
    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, nestedValue]) => [key, cloneValue(nestedValue)]),
        );
    }
    return value;
};

const mergePlainObjects = (base, override) => {
    const result = cloneValue(base);
    if (!isPlainObject(override)) return result;

    Object.entries(override).forEach(([key, value]) => {
        if (isPlainObject(value) && isPlainObject(result[key])) {
            result[key] = mergePlainObjects(result[key], value);
            return;
        }
        result[key] = cloneValue(value);
    });

    return result;
};

const normalizeTreasuryMode = (value, fallback) => {
    const normalized = String(value || "")
        .trim()
        .toUpperCase();
    return TREASURY_MODE_VALUES.has(normalized) ? normalized : fallback;
};

const getLegacyStoreMode = (classData = {}) =>
    normalizeTreasuryMode(classData?.taxSettings?.storeMode, "NONE");

const getLegacyPayrollMode = (classData = {}) =>
    normalizeTreasuryMode(classData?.settings?.payrollTaxMode, "NONE");

const getLegacyPoliceEnabled = (classData = {}) =>
    classData?.taxSettings?.policeEnabled === true;

const normalizeWithholdingPolicy = (policy = {}) => {
    policy.enabled = policy?.enabled === true;
    policy.taxRate = Math.max(
        0,
        Math.min(100, Number(policy?.taxRate || 0)),
    );
    policy.exemptionAmount = 0;
    policy.monthEndSettlementEnabled = true;
    policy.enabledFrom = policy?.enabledFrom || null;
    return policy;
};

const normalizeRate = (value) =>
    Math.max(0, Math.min(100, Number(value || 0)));

const normalizeAmount = (value) => Math.max(0, Math.round(Number(value || 0)));

const normalizeNonNegativeNumber = (value) =>
    Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);

const normalizeSourceKeys = (value) =>
    Array.isArray(value)
        ? Array.from(
            new Set(value.map((item) => String(item || "").trim()).filter(Boolean)),
        )
        : [];

const normalizeMonthEndSettlementPolicy = (policy = {}) => {
    policy.version = Number(policy.version) || 1;
    policy.lastClosedAt = policy.lastClosedAt || null;
    policy.activeDraftId = policy.activeDraftId || null;
    policy.lockedPeriodEndAt = policy.lockedPeriodEndAt || null;

    policy.taxBrackets = Array.isArray(policy.taxBrackets)
        ? policy.taxBrackets
            .map((bracket) => ({
                upToAmount:
                    bracket?.upToAmount === null
                        ? null
                        : normalizeAmount(bracket?.upToAmount),
                rate: normalizeRate(bracket?.rate),
            }))
            .filter((bracket) => bracket.upToAmount === null || bracket.upToAmount > 0)
        : [];
    if (policy.taxBrackets.length === 0) {
        policy.taxBrackets = createDefaultMonthEndSettlementPolicy().taxBrackets;
    }

    policy.exemptionGroups = Array.isArray(policy.exemptionGroups)
        ? policy.exemptionGroups.map((group, index) => ({
            id: String(group?.id || `group_${index + 1}`).trim(),
            label: String(group?.label || `비과세 그룹 ${index + 1}`).trim(),
            enabled: group?.enabled !== false,
            amount: normalizeAmount(group?.amount),
            sourceKeys: normalizeSourceKeys(group?.sourceKeys),
        }))
        : [];

    const deductions = policy.incomeDeductions || {};
    policy.incomeDeductions = {
        basic: {
            ...deductions.basic,
            enabled: deductions.basic?.enabled !== false,
            amount: normalizeAmount(deductions.basic?.amount),
        },
        labor: {
            ...deductions.labor,
            enabled: deductions.labor?.enabled !== false,
            sourceKeys: normalizeSourceKeys(deductions.labor?.sourceKeys),
            rate: normalizeRate(deductions.labor?.rate),
            maxAmount: normalizeAmount(deductions.labor?.maxAmount),
        },
        storeSpending: {
            ...deductions.storeSpending,
            enabled: deductions.storeSpending?.enabled !== false,
            rate: normalizeRate(deductions.storeSpending?.rate),
            maxAmount: normalizeAmount(deductions.storeSpending?.maxAmount),
            minSpendingAmount: normalizeAmount(deductions.storeSpending?.minSpendingAmount),
        },
        activity: {
            ...deductions.activity,
            enabled: deductions.activity?.enabled === true,
            sourceKeys: normalizeSourceKeys(deductions.activity?.sourceKeys),
            rate: normalizeRate(deductions.activity?.rate),
            maxAmount: normalizeAmount(deductions.activity?.maxAmount),
        },
        manual: {
            ...deductions.manual,
            enabled: deductions.manual?.enabled !== false,
        },
    };

    const credits = policy.taxCredits || {};
    policy.taxCredits = {
        donation: {
            ...credits.donation,
            enabled: credits.donation?.enabled !== false,
            rate: normalizeRate(credits.donation?.rate),
            maxAmount: normalizeAmount(credits.donation?.maxAmount),
        },
        manual: {
            ...credits.manual,
            enabled: credits.manual?.enabled !== false,
        },
    };

    return policy;
};

const normalizeTaxBillLateFeePolicy = (policy = {}) => {
    policy.enabled = policy?.enabled === true;
    policy.mode = policy?.mode === "rate" ? "rate" : "fixed";
    policy.dailyAmount = Math.round(normalizeNonNegativeNumber(policy?.dailyAmount));
    policy.dailyRate = normalizeNonNegativeNumber(policy?.dailyRate);
    policy.graceDays = 0;
    return policy;
};

const normalizePeriodIncomeSettlementPolicy = (policy = {}) => {
    policy.enabled = policy?.enabled === true;
    policy.dailyAggregationEnabled = policy?.dailyAggregationEnabled === true;
    policy.scheduleEnabled = policy?.scheduleEnabled === true;
    const activationDateKey = String(policy?.activationDateKey || "").trim();
    policy.activationDateKey = /^\d{4}-\d{2}-\d{2}$/.test(activationDateKey)
        ? activationDateKey
        : null;
    policy.sourceKeys = Array.from(
        new Set(
            (Array.isArray(policy?.sourceKeys) ? policy.sourceKeys : [])
                .map((sourceKey) => String(sourceKey || "").trim())
                .filter(Boolean),
        ),
    );
    return policy;
};

const getTaxPolicy = (classData = {}) => {
    const merged = mergePlainObjects(
        createDefaultTaxPolicy(),
        classData?.taxPolicy,
    );
    const legacyPoliceEnabled = getLegacyPoliceEnabled(classData);

    merged.version = Number(merged.version) || 1;
    merged.treasury.store.mode = normalizeTreasuryMode(
        merged?.treasury?.store?.mode,
        getLegacyStoreMode(classData),
    );
    merged.treasury.payroll.mode = normalizeTreasuryMode(
        merged?.treasury?.payroll?.mode,
        getLegacyPayrollMode(classData),
    );
    merged.treasury.police.fineEnabled =
        merged?.treasury?.police?.fineEnabled === undefined
            ? legacyPoliceEnabled
            : !!merged.treasury.police.fineEnabled;
    merged.treasury.police.rewardExpenseEnabled =
        merged?.treasury?.police?.rewardExpenseEnabled === undefined
            ? legacyPoliceEnabled
            : !!merged.treasury.police.rewardExpenseEnabled;
    Object.values(merged.withholding || {}).forEach((policy) => {
        if (isPlainObject(policy)) normalizeWithholdingPolicy(policy);
    });
    normalizeTaxBillLateFeePolicy(merged.billLateFee);
    normalizeMonthEndSettlementPolicy(merged.monthEndSettlement);

    normalizePeriodIncomeSettlementPolicy(merged.periodIncomeSettlement);
    return merged;
};

const getStoreTreasuryMode = (classData = {}) =>
    getTaxPolicy(classData).treasury.store.mode;

const getPayrollTreasuryMode = (classData = {}) =>
    getTaxPolicy(classData).treasury.payroll.mode;

const getPoliceTreasuryPolicy = (classData = {}) =>
    getTaxPolicy(classData).treasury.police;

const getDepositInterestWithholdingPolicy = (classData = {}) =>
    getTaxPolicy(classData).withholding.depositInterest;

const getPayrollBonusWithholdingPolicy = (classData = {}) =>
    getTaxPolicy(classData).withholding.payrollBonus;

const getWithholdingPolicy = (classData = {}, sourceKey = null) => {
    const policies = getTaxPolicy(classData).withholding;
    return sourceKey ? policies?.[sourceKey] || null : policies;
};

const getBonusDeductionPolicy = (classData = {}) =>
    getPayrollBonusWithholdingPolicy(classData);

const getIncomeSettlementPolicy = (classData = {}, sourceKey = null) => {
    const policies = getTaxPolicy(classData).incomeSettlement;
    return sourceKey ? policies?.[sourceKey] || null : policies;
};

const getMonthEndSettlementPolicy = (classData = {}) =>
    getTaxPolicy(classData).monthEndSettlement;

const getTaxBillLateFeePolicy = (classData = {}) =>
    getTaxPolicy(classData).billLateFee;


const getPeriodIncomeSettlementPolicy = (classData = {}) =>
    getTaxPolicy(classData).periodIncomeSettlement;

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

const shouldDeferTaxIncomeToPeriodSettlement = (
    classData = {},
    sourceKey = null,
    occurredAt = new Date(),
) => {
    const policy = getPeriodIncomeSettlementPolicy(classData);
    if (policy.enabled !== true) return false;
    if (policy.activationDateKey && getKstDateKey(occurredAt) < policy.activationDateKey) {
        return false;
    }
    return !policy.sourceKeys.length || policy.sourceKeys.includes(sourceKey);
};
module.exports = {
    TREASURY_MODE_VALUES,
    createDefaultTaxPolicy,
    createDefaultTaxBillLateFeePolicy,
    createDefaultMonthEndSettlementPolicy,
    getTaxPolicy,
    createDefaultPeriodIncomeSettlementPolicy,
    getStoreTreasuryMode,
    getPayrollTreasuryMode,
    getPoliceTreasuryPolicy,
    getDepositInterestWithholdingPolicy,
    getPayrollBonusWithholdingPolicy,
    getWithholdingPolicy,
    getMonthEndSettlementPolicy,
    getBonusDeductionPolicy,
    getIncomeSettlementPolicy,
    getTaxBillLateFeePolicy,
    getPeriodIncomeSettlementPolicy,
    shouldDeferTaxIncomeToPeriodSettlement,
};
