"use strict";

const {
    calculatePeriodRateAdjustment,
    calculateSavingInterest,
    resolveTierRateModifier,
    roundBankMoney,
    toSafeNumber,
} = require("./bankMoney");
const { buildIncomeTaxSnapshot } = require("./incomeTaxUtils");

const BANK_DEPOSIT_DECISION_CONTEXT_VERSION = 1;
const BANK_DEPOSIT_SIMULATION_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

function toNonNegativeNumber(value, fallback = 0) {
    return Math.max(0, toSafeNumber(value, fallback));
}

function toWholeNumber(value, fallback = 0) {
    return Math.max(0, Math.floor(toSafeNumber(value, fallback)));
}

function roundRatio(value) {
    if (!Number.isFinite(Number(value))) return null;
    return Math.round(Number(value) * 10000) / 10000;
}

function safeRatio(numerator, denominator) {
    const normalizedDenominator = toNonNegativeNumber(denominator);
    if (normalizedDenominator <= 0) return null;
    return roundRatio(toNonNegativeNumber(numerator) / normalizedDenominator);
}

function toMillis(value) {
    if (value == null || value === "") return null;
    if (Number.isFinite(Number(value))) return Number(value);
    if (value instanceof Date) return value.getTime();
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.toDate === "function") return value.toDate().getTime();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function readValidBankDepositContextCache(data = {}, nowMs = Date.now()) {
    const context = data?.context;
    const expiresAtMs = toMillis(data?.expiresAt) || 0;
    if (!context || typeof context !== "object") return null;
    if (Number(context.schemaVersion) !== BANK_DEPOSIT_DECISION_CONTEXT_VERSION) return null;
    if (expiresAtMs <= toSafeNumber(nowMs, Date.now())) return null;
    return {
        context,
        expiresAtMs,
    };
}

function isActiveStudent(student = {}) {
    const role = String(student.role || "student").trim().toLowerCase();
    const status = String(student.status || "").trim().toLowerCase();
    return role === "student" && status !== "deleted" && status !== "inactive";
}

function isMonetaryAggregateExcluded(student = {}) {
    return student?.statsExclusion?.monetaryAggregates === true;
}

function calculateMedian(values = []) {
    const normalized = values
        .map((value) => toNonNegativeNumber(value))
        .sort((left, right) => left - right);
    if (!normalized.length) return 0;
    const middle = Math.floor(normalized.length / 2);
    if (normalized.length % 2 === 1) return normalized[middle];
    return roundBankMoney((normalized[middle - 1] + normalized[middle]) / 2);
}

function calculatePercentile(values = [], percentile = 0.5) {
    const normalized = values
        .map((value) => toNonNegativeNumber(value))
        .sort((left, right) => left - right);
    if (!normalized.length) return 0;
    const position = Math.min(1, Math.max(0, Number(percentile))) * (normalized.length - 1);
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    if (lowerIndex === upperIndex) return normalized[lowerIndex];
    const weight = position - lowerIndex;
    return roundBankMoney(
        normalized[lowerIndex] + (normalized[upperIndex] - normalized[lowerIndex]) * weight,
    );
}

function normalizeWithholdingPolicy(value = {}, featureEnabled = false) {
    return {
        featureEnabled: featureEnabled === true,
        enabled: value?.enabled === true,
        taxRate: toNonNegativeNumber(value?.taxRate),
        exemptionAmount: toNonNegativeNumber(value?.exemptionAmount),
        enabledFromMs: toMillis(value?.enabledFrom),
    };
}

function normalizeTierAdjustments(value = {}) {
    const source = value?.byTier && typeof value.byTier === "object" ? value.byTier : value;
    return source && typeof source === "object" ? source : {};
}

function buildTierDistribution(studentProfiles = []) {
    const grouped = new Map();
    studentProfiles.forEach((profile) => {
        const key = `${profile.tierId || "none"}::${profile.tierName || "무등급"}`;
        const current = grouped.get(key) || {
            tierId: profile.tierId || "none",
            tierName: profile.tierName || "무등급",
            studentCount: 0,
            totalCash: 0,
            weeklyBonusRate: toSafeNumber(profile.weeklyBonusRate),
        };
        current.studentCount += 1;
        current.totalCash = roundBankMoney(current.totalCash + profile.cash);
        grouped.set(key, current);
    });

    return Array.from(grouped.values()).sort((left, right) => {
        if (right.weeklyBonusRate !== left.weeklyBonusRate) {
            return right.weeklyBonusRate - left.weeklyBonusRate;
        }
        return left.tierName.localeCompare(right.tierName, "ko-KR");
    });
}

function buildBankDepositDecisionContext({
    generatedAtMs = Date.now(),
    classData = {},
    economyBaseline = {},
    bankOverviewSavings = {},
    bankSettings = {},
    tierAdjustments = {},
    withholdingPolicy = null,
    taxFeatureEnabled = false,
    students = [],
} = {}) {
    const normalizedGeneratedAtMs = toMillis(generatedAtMs) || Date.now();
    const currencyField = String(classData?.currencySettings?.field || "cash").trim() || "cash";
    const currencyUnit = String(
        classData?.currencyUnit || classData?.currencySettings?.name || "원",
    ).trim() || "원";
    const adjustmentLookup = normalizeTierAdjustments(tierAdjustments);
    const activeStudents = [];
    let excludedMonetaryStudentCount = 0;
    let missingCashCount = 0;
    let missingCreditScoreCount = 0;
    let missingCreditTierCount = 0;

    (Array.isArray(students) ? students : []).forEach((student) => {
        if (!isActiveStudent(student)) return;
        if (isMonetaryAggregateExcluded(student)) {
            excludedMonetaryStudentCount += 1;
            return;
        }

        const rawCash = student?.assets?.[currencyField];
        const rawCreditScore = student?.creditScore;
        const tierName = String(student?.creditTier?.name || "무등급").trim() || "무등급";
        const tierId = String(student?.creditTier?.id || "none").trim() || "none";
        const modifier = adjustmentLookup[tierName] || {};
        if (!Number.isFinite(Number(rawCash))) missingCashCount += 1;
        if (!Number.isFinite(Number(rawCreditScore))) missingCreditScoreCount += 1;
        if (!student?.creditTier?.name) missingCreditTierCount += 1;

        activeStudents.push({
            cash: roundBankMoney(toNonNegativeNumber(rawCash)),
            creditScore: toNonNegativeNumber(rawCreditScore),
            tierId,
            tierName,
            weeklyBonusRate: toSafeNumber(modifier.depositRateModifier),
            weeklySalary: roundBankMoney(
                toNonNegativeNumber(student?.payroll?.currentWeeklySalary),
            ),
        });
    });

    activeStudents.sort((left, right) => {
        if (left.cash !== right.cash) return left.cash - right.cash;
        if (left.creditScore !== right.creditScore) return left.creditScore - right.creditScore;
        return left.tierName.localeCompare(right.tierName, "ko-KR");
    });

    const cashValues = activeStudents.map((student) => student.cash);
    const salaryValues = activeStudents
        .map((student) => student.weeklySalary)
        .filter((value) => value > 0);
    const totalStudentCash = roundBankMoney(
        cashValues.reduce((sum, value) => sum + value, 0),
    );
    const fallbackWeeklyPayrollLiability = roundBankMoney(
        salaryValues.reduce((sum, value) => sum + value, 0),
    );
    const fallbackMedianWeeklySalary = calculateMedian(salaryValues);
    const baselineWeeklySalary = toNonNegativeNumber(
        economyBaseline?.baselineWeeklySalary ?? economyBaseline?.medianWeeklySalary,
        fallbackMedianWeeklySalary,
    );
    const medianWeeklySalary = toNonNegativeNumber(
        economyBaseline?.medianWeeklySalary,
        baselineWeeklySalary || fallbackMedianWeeklySalary,
    );
    const weeklyPayrollLiability = toNonNegativeNumber(
        economyBaseline?.weeklyPayrollLiability,
        fallbackWeeklyPayrollLiability,
    );
    const averageWeeklySalary = toNonNegativeNumber(
        economyBaseline?.averageWeeklySalary,
        salaryValues.length ? fallbackWeeklyPayrollLiability / salaryValues.length : 0,
    );
    const activeProducts = (Array.isArray(bankSettings?.depositProducts) ?
        bankSettings.depositProducts : []).filter((product) => product?.active !== false);
    const resolvedWithholdingPolicy = normalizeWithholdingPolicy(
        withholdingPolicy || classData?.taxPolicy?.withholding?.depositInterest || {},
        taxFeatureEnabled,
    );

    const studentProfiles = activeStudents.map((student) => ({
        cash: student.cash,
        creditScore: student.creditScore,
        tierId: student.tierId,
        tierName: student.tierName,
        weeklyBonusRate: student.weeklyBonusRate,
    }));
    const status = activeStudents.length > 0 ? "ready" : "empty";

    return {
        schemaVersion: BANK_DEPOSIT_DECISION_CONTEXT_VERSION,
        contextType: "bank.deposit_product_launch",
        generatedAtMs: normalizedGeneratedAtMs,
        generatedAt: new Date(normalizedGeneratedAtMs).toISOString(),
        currency: {
            field: currencyField,
            unit: currencyUnit,
        },
        economy: {
            activeStudentCount: activeStudents.length,
            baselineWeeklySalary: roundBankMoney(baselineWeeklySalary),
            medianWeeklySalary: roundBankMoney(medianWeeklySalary),
            averageWeeklySalary: roundBankMoney(averageWeeklySalary),
            weeklyPayrollLiability: roundBankMoney(weeklyPayrollLiability),
            totalStudentCash,
            averageStudentCash: activeStudents.length ?
                roundBankMoney(totalStudentCash / activeStudents.length) : 0,
            medianStudentCash: calculateMedian(cashValues),
        },
        bank: {
            activeDepositProductCount: activeProducts.length,
            openSavingCount: toWholeNumber(bankOverviewSavings?.rowCount),
            pendingSavingCount: toWholeNumber(bankOverviewSavings?.pendingCount),
            activeSavingCount: toWholeNumber(bankOverviewSavings?.activeCount),
            currentDepositPrincipal: roundBankMoney(
                toNonNegativeNumber(bankOverviewSavings?.totalAmount),
            ),
        },
        withholdingPolicy: resolvedWithholdingPolicy,
        distributions: {
            cash: {
                min: cashValues.length ? Math.min(...cashValues) : 0,
                p25: calculatePercentile(cashValues, 0.25),
                median: calculateMedian(cashValues),
                p75: calculatePercentile(cashValues, 0.75),
                max: cashValues.length ? Math.max(...cashValues) : 0,
            },
            tiers: buildTierDistribution(studentProfiles),
        },
        studentProfiles,
        dataQuality: {
            status,
            sourceStudentCount: Array.isArray(students) ? students.length : 0,
            activeStudentCount: activeStudents.length,
            excludedMonetaryStudentCount,
            missingCashCount,
            missingCreditScoreCount,
            missingCreditTierCount,
            economyBaselineSource: economyBaseline?.summaryVersion ? "economyBaseline" : "studentPayrollCache",
            bankOverviewSource: bankOverviewSavings?.summaryVersion ?
                "bankOverviewSavings" : "fallback_or_empty",
        },
    };
}

function normalizeStudentProfile(profile = {}) {
    return {
        cash: roundBankMoney(toNonNegativeNumber(profile.cash)),
        creditScore: toNonNegativeNumber(profile.creditScore),
        tierId: String(profile.tierId || "none"),
        tierName: String(profile.tierName || "무등급"),
        weeklyBonusRate: toSafeNumber(profile.weeklyBonusRate),
    };
}

function toPublicBankDepositDecisionContext(context = {}) {
    const {
        studentProfiles,
        ...publicContext
    } = context && typeof context === "object" ? context : {};

    const distributions = publicContext.distributions || {};
    const publicTierDistribution = (Array.isArray(distributions.tiers) ?
        distributions.tiers : []).map((tier) => ({
        tierId: tier.tierId,
        tierName: tier.tierName,
        studentCount: tier.studentCount,
        weeklyBonusRate: tier.weeklyBonusRate,
    }));

    return {
        ...publicContext,
        distributions: {
            ...distributions,
            tiers: publicTierDistribution,
        },
        simulation: {
            mode: "server_preview",
            requiresCandidatePreview: true,
            studentCount: Array.isArray(studentProfiles) ?
                studentProfiles.length : 0,
        },
    };
}

function normalizeBankDepositProductCandidate(context = {}, candidate = {}) {
    const defaultDepositAmount = toWholeNumber(
        context?.economy?.baselineWeeklySalary || context?.economy?.medianWeeklySalary,
    );
    return {
        baseRate: toNonNegativeNumber(candidate.baseRate),
        days: Math.max(1, toWholeNumber(candidate.days, 7)),
        maxDepositPerStudent: toWholeNumber(candidate.maxDepositPerStudent),
        minCreditScore: toNonNegativeNumber(candidate.minCreditScore),
        useTierRateAdjustment: candidate.useTierRateAdjustment !== false,
        expectedParticipantCount: candidate.expectedParticipantCount == null ?
            null : toWholeNumber(candidate.expectedParticipantCount),
        expectedDepositPerStudent: toWholeNumber(
            candidate.expectedDepositPerStudent,
            defaultDepositAmount,
        ),
        exampleDepositAmount: toWholeNumber(
            candidate.exampleDepositAmount,
            defaultDepositAmount,
        ),
    };
}

function getFinalRate(profile, product) {
    const weeklyModifier = resolveTierRateModifier(
        product.useTierRateAdjustment,
        profile.weeklyBonusRate,
    );
    const adjustment = calculatePeriodRateAdjustment(weeklyModifier, product.days);
    return Math.max(0, roundBankMoney(product.baseRate + adjustment, 2));
}

function isWithholdingApplied(context, product) {
    const policy = context?.withholdingPolicy || {};
    if (
        policy.featureEnabled !== true ||
        policy.enabled !== true ||
        toNonNegativeNumber(policy.taxRate) <= 0
    ) return false;
    const enabledFromMs = toMillis(policy.enabledFromMs ?? policy.enabledFrom);
    if (enabledFromMs == null) return true;
    const generatedAtMs = toMillis(context?.generatedAtMs ?? context?.generatedAt) || Date.now();
    const maturityAtMs = generatedAtMs + product.days * DAY_MS;
    return enabledFromMs <= maturityAtMs;
}

function settleInterest(principal, finalRate, withholding) {
    const normalizedPrincipal = roundBankMoney(toNonNegativeNumber(principal));
    const grossInterest = calculateSavingInterest(normalizedPrincipal, finalRate);
    const taxSnapshot = withholding.applied ?
        buildIncomeTaxSnapshot({
            sourceKey: "depositInterest",
            grossAmount: grossInterest,
            policy: {
                enabled: true,
                taxRate: withholding.taxRate,
            },
        }) : null;
    const taxAmount = taxSnapshot?.withheldAmount || 0;
    const netInterest = withholding.applied ?
        roundBankMoney(taxSnapshot?.netAmount || 0) : grossInterest;
    return {
        principal: normalizedPrincipal,
        grossInterest,
        taxAmount,
        netInterest,
        maturityAmount: roundBankMoney(normalizedPrincipal + netInterest),
    };
}

function addSettlements(rows = []) {
    return rows.reduce((totals, row) => ({
        principal: roundBankMoney(totals.principal + row.principal),
        grossInterest: roundBankMoney(totals.grossInterest + row.grossInterest),
        taxAmount: roundBankMoney(totals.taxAmount + row.taxAmount),
        netInterest: roundBankMoney(totals.netInterest + row.netInterest),
        maturityAmount: roundBankMoney(totals.maturityAmount + row.maturityAmount),
    }), {
        principal: 0,
        grossInterest: 0,
        taxAmount: 0,
        netInterest: 0,
        maturityAmount: 0,
    });
}

function makeRange(minValue, maxValue) {
    return {
        min: roundBankMoney(Math.min(toSafeNumber(minValue), toSafeNumber(maxValue))),
        max: roundBankMoney(Math.max(toSafeNumber(minValue), toSafeNumber(maxValue))),
    };
}

function settlementRange(low, high) {
    return {
        grossInterestRange: makeRange(low.grossInterest, high.grossInterest),
        taxAmountRange: makeRange(low.taxAmount, high.taxAmount),
        netInterestRange: makeRange(low.netInterest, high.netInterest),
        maturityAmountRange: makeRange(low.maturityAmount, high.maturityAmount),
    };
}

function simulateBankDepositProduct(context = {}, rawCandidate = {}) {
    const product = normalizeBankDepositProductCandidate(context, rawCandidate);
    const profiles = (Array.isArray(context?.studentProfiles) ? context.studentProfiles : [])
        .map(normalizeStudentProfile);
    const eligibleProfiles = profiles.filter(
        (profile) => profile.creditScore >= product.minCreditScore,
    );
    const withholding = {
        featureEnabled: context?.withholdingPolicy?.featureEnabled === true,
        applied: isWithholdingApplied(context, product),
        taxRate: toNonNegativeNumber(context?.withholdingPolicy?.taxRate),
        enabledFromMs: toMillis(
            context?.withholdingPolicy?.enabledFromMs ??
            context?.withholdingPolicy?.enabledFrom,
        ),
    };
    const rates = eligibleProfiles.length ?
        eligibleProfiles.map((profile) => getFinalRate(profile, product)) :
        [product.baseRate];
    const minimumRate = Math.min(...rates);
    const maximumRate = Math.max(...rates);
    const notices = [];

    const exampleAmount = product.maxDepositPerStudent > 0 ?
        Math.min(product.exampleDepositAmount, product.maxDepositPerStudent) :
        product.exampleDepositAmount;
    const exampleLow = settleInterest(exampleAmount, minimumRate, withholding);
    const exampleHigh = settleInterest(exampleAmount, maximumRate, withholding);
    const baselineWeeklySalary = toNonNegativeNumber(
        context?.economy?.baselineWeeklySalary || context?.economy?.medianWeeklySalary,
    );

    const expectedAmount = product.maxDepositPerStudent > 0 ?
        Math.min(product.expectedDepositPerStudent, product.maxDepositPerStudent) :
        product.expectedDepositPerStudent;
    const fundableProfiles = eligibleProfiles.filter(
        (profile) => profile.cash >= expectedAmount && expectedAmount > 0,
    );
    const requestedParticipantCount = product.expectedParticipantCount == null ?
        Math.ceil(fundableProfiles.length / 2) : product.expectedParticipantCount;
    const appliedParticipantCount = Math.min(
        requestedParticipantCount,
        fundableProfiles.length,
    );
    if (requestedParticipantCount > appliedParticipantCount) {
        notices.push({
            code: "EXPECTED_PARTICIPANTS_CAPPED",
            level: "info",
            message: "예상 예금액을 현재 보유한 가입 가능 학생 수로 참여 인원을 조정했습니다.",
        });
    }

    const fundableByRate = fundableProfiles
        .map((profile) => ({
            profile,
            finalRate: getFinalRate(profile, product),
        }))
        .sort((left, right) => left.finalRate - right.finalRate);
    const expectedRates = fundableByRate.map((row) => row.finalRate);
    const expectedMinimumRate = expectedRates.length ? Math.min(...expectedRates) : minimumRate;
    const expectedMaximumRate = expectedRates.length ? Math.max(...expectedRates) : maximumRate;
    const lowExpectedRows = fundableByRate
        .slice(0, appliedParticipantCount)
        .map((row) => settleInterest(expectedAmount, row.finalRate, withholding));
    const highExpectedRows = fundableByRate
        .slice(Math.max(0, fundableByRate.length - appliedParticipantCount))
        .map((row) => settleInterest(expectedAmount, row.finalRate, withholding));
    const expectedLow = addSettlements(lowExpectedRows);
    const expectedHigh = addSettlements(highExpectedRows);

    const maximumRows = eligibleProfiles
        .map((profile) => {
            const availableCash = toWholeNumber(profile.cash);
            const principal = product.maxDepositPerStudent > 0 ?
                Math.min(availableCash, product.maxDepositPerStudent) : availableCash;
            if (principal <= 0) return null;
            return settleInterest(principal, getFinalRate(profile, product), withholding);
        })
        .filter(Boolean);
    const maximum = addSettlements(maximumRows);
    const weeklyPayrollLiability = toNonNegativeNumber(
        context?.economy?.weeklyPayrollLiability,
    );
    const totalStudentCash = toNonNegativeNumber(context?.economy?.totalStudentCash);
    const currentDepositPrincipal = toNonNegativeNumber(
        context?.bank?.currentDepositPrincipal,
    );

    if (!eligibleProfiles.length) {
        notices.push({
            code: "NO_ELIGIBLE_STUDENTS",
            level: "info",
            message: "현재 최소 신용점수를 충족하는 학생이 없습니다.",
        });
    }

    return {
        schemaVersion: BANK_DEPOSIT_SIMULATION_VERSION,
        contextSchemaVersion: Number(context?.schemaVersion || 0),
        calculatedAtMs: Date.now(),
        product,
        withholding,
        eligibility: {
            totalStudentCount: profiles.length,
            eligibleStudentCount: eligibleProfiles.length,
            ineligibleStudentCount: Math.max(0, profiles.length - eligibleProfiles.length),
            eligibleWithCashCount: eligibleProfiles.filter((profile) => profile.cash > 0).length,
        },
        studentExample: {
            principal: exampleAmount,
            finalRateRange: makeRange(minimumRate, maximumRate),
            ...settlementRange(exampleLow, exampleHigh),
            principalToBaselineWeeklySalaryRatio: safeRatio(
                exampleAmount,
                baselineWeeklySalary,
            ),
            netInterestToBaselineWeeklySalaryRatioRange: makeRange(
                safeRatio(exampleLow.netInterest, baselineWeeklySalary) || 0,
                safeRatio(exampleHigh.netInterest, baselineWeeklySalary) || 0,
            ),
        },
        expectedScenario: {
            requestedParticipantCount,
            fundableStudentCount: fundableProfiles.length,
            appliedParticipantCount,
            depositPerStudent: expectedAmount,
            totalPrincipal: expectedLow.principal,
            finalRateRange: makeRange(expectedMinimumRate, expectedMaximumRate),
            ...settlementRange(expectedLow, expectedHigh),
            principalToStudentCashRatio: safeRatio(expectedLow.principal, totalStudentCash),
            grossInterestToWeeklyPayrollRatioRange: makeRange(
                safeRatio(expectedLow.grossInterest, weeklyPayrollLiability) || 0,
                safeRatio(expectedHigh.grossInterest, weeklyPayrollLiability) || 0,
            ),
        },
        maximumExposure: {
            participantCount: maximumRows.length,
            totalPrincipal: maximum.principal,
            grossInterest: maximum.grossInterest,
            taxAmount: maximum.taxAmount,
            netInterest: maximum.netInterest,
            maturityAmount: maximum.maturityAmount,
            cashLockRatio: safeRatio(maximum.principal, totalStudentCash),
            grossInterestToWeeklyPayrollRatio: safeRatio(
                maximum.grossInterest,
                weeklyPayrollLiability,
            ),
            currentDepositPrincipal: roundBankMoney(currentDepositPrincipal),
            combinedDepositPrincipal: roundBankMoney(
                currentDepositPrincipal + maximum.principal,
            ),
        },
        notices,
    };
}

module.exports = {
    BANK_DEPOSIT_DECISION_CONTEXT_VERSION,
    BANK_DEPOSIT_SIMULATION_VERSION,
    buildBankDepositDecisionContext,
    normalizeBankDepositProductCandidate,
    readValidBankDepositContextCache,
    simulateBankDepositProduct,
    toPublicBankDepositDecisionContext,
};
