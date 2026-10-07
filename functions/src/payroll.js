"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("../utils/maintenanceHttps");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const { createMaintenanceDb } = require("../utils/maintenanceDb");
const db = createMaintenanceDb(admin.firestore());
const FieldValue = admin.firestore.FieldValue;

const { mustBeTeacherOrTaxAdmin } = require("../utils/permissions");
const { stageTaxIncome } = require("../utils/taxIncome");
const { stageTaxExpense } = require("../utils/taxExpense");
const { stageActivityLog } = require("../utils/logUtils");
const {
    getPayrollTreasuryMode,
    getPayrollBonusWithholdingPolicy,
    getWithholdingPolicy,
} = require("../utils/taxPolicy");
const { buildIncomeTaxSnapshot } = require("../utils/incomeTaxUtils");
const { getGlobalConfig, canUseFeature } = require("../utils/planManager"); // canUseFeature 異붽?
const {
    calculatePayrollPensionContribution,
} = require("../utils/classFundPension");

const PAYROLL_OPTS = {
    region: "asia-northeast3",
    memory: "512MiB",
    timeoutSeconds: 120,
};
const TAX_LINE_COLLECTION = "lines";

const buildTaxRecordPointer = (collection, id, lineId) => ({
    collection,
    id,
    lineCollection: TAX_LINE_COLLECTION,
    lineId,
    detailStorage: "inline",
    aggregated: true,
});

const normalizePayslipType = (value) =>
    String(value || "salary").trim().toLowerCase() === "bonus"
        ? "bonus"
        : "salary";

const isSalaryPayslip = (payslipData = {}) =>
    normalizePayslipType(payslipData?.slipType) === "salary";

const normalizeBonusMode = (value) =>
    String(value || "").trim().toLowerCase() === "percent"
        ? "percent"
        : "fixed";

const normalizeBonusEntryMode = (value) =>
    String(value || "").trim().toLowerCase() === "per_job"
        ? "per_job"
        : "shared";
const normalizeIncentiveMode = (value) =>
    String(value || "").trim().toLowerCase() === "quantity"
        ? "quantity"
        : "fixed";

const BONUS_DEDUCTION_LABEL = "성과급 공제";
const INCENTIVE_DEDUCTION_LABEL = "인센티브 공제";

const normalizePercentRate = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(100, parsed);
};

function getBonusDeductionSnapshot(classData = {}) {
    const policy = getPayrollBonusWithholdingPolicy(classData);
    const taxRate = normalizePercentRate(policy?.taxRate);

    return {
        enabled: policy?.enabled === true && taxRate > 0,
        taxRate,
        exemptionAmount: Math.max(0, Number(policy?.exemptionAmount || 0)),
        monthEndSettlementEnabled: policy?.monthEndSettlementEnabled !== false,
    };
}

function getIncentiveDeductionSnapshot(classData = {}) {
    const policy = getWithholdingPolicy(classData, "incentivePayment");
    const taxRate = normalizePercentRate(policy?.taxRate);

    return {
        enabled: policy?.enabled === true && taxRate > 0,
        taxRate,
        exemptionAmount: Math.max(0, Number(policy?.exemptionAmount || 0)),
        monthEndSettlementEnabled: policy?.monthEndSettlementEnabled !== false,
    };
}

function applyBonusDeductionToBreakdowns({
    jobBreakdowns = {},
    totalBonusAmount = 0,
    deductionRate = 0,
    label = BONUS_DEDUCTION_LABEL,
}) {
    const grossBonusAmount = Math.max(0, Math.round(Number(totalBonusAmount || 0)));
    const normalizedRate = normalizePercentRate(deductionRate);

    if (!(grossBonusAmount > 0) || !(normalizedRate > 0)) {
        return {
            totalDeductionAmount: 0,
            netBonusAmount: grossBonusAmount,
        };
    }

    const totalDeductionAmount = Math.min(
        grossBonusAmount,
        Math.round(grossBonusAmount * (normalizedRate / 100)),
    );
    const rows = Object.values(jobBreakdowns).filter(
        (row) => Number(row?.bonusAmount || 0) > 0,
    );

    if (rows.length > 0 && totalDeductionAmount > 0) {
        const totalWeight = rows.reduce(
            (sum, row) => sum + Number(row.bonusAmount || 0),
            0,
        );
        let remaining = totalDeductionAmount;

        rows.forEach((row, index) => {
            let deductionAmount = 0;

            if (index === rows.length - 1) {
                deductionAmount = remaining;
            } else if (totalWeight > 0) {
                deductionAmount = Math.min(
                    remaining,
                    Math.max(
                        0,
                        Math.round(
                            totalDeductionAmount *
                                (Number(row.bonusAmount || 0) / totalWeight),
                        ),
                    ),
                );
            } else {
                deductionAmount = Math.floor(totalDeductionAmount / rows.length);
            }

            remaining = Math.max(0, remaining - deductionAmount);
            if (!(deductionAmount > 0)) return;

            row.deductions = Array.isArray(row.deductions) ? row.deductions : [];
            row.deductions.push({ name: label, amount: deductionAmount });
            row.totalDeductions = Number(row.totalDeductions || 0) + deductionAmount;
            row.netSalary = Math.max(
                0,
                Number(row.netSalary ?? row.bonusAmount ?? 0) - deductionAmount,
            );
        });
    }

    return {
        totalDeductionAmount,
        netBonusAmount: Math.max(0, grossBonusAmount - totalDeductionAmount),
    };
}

/* ??????????????????????????????????????????????????????????????
 * ?ы띁 ?⑥닔 (湲곗〈 濡쒖쭅 ?좎?)
 * ?????????????????????????????????????????????????????????????? */

function toISODateOnly(dateLike) {
    if (!dateLike) throw new HttpsError("invalid-argument", "날짜 데이터가 없습니다.");
    const d = (typeof dateLike.toDate === "function") ? dateLike.toDate() : new Date(dateLike);
    if (isNaN(d.getTime())) throw new HttpsError("invalid-argument", "날짜 형식이 올바르지 않습니다.");
    return d.toISOString().split("T")[0];
}

function toDateOnlyEndISO(startISO, numWeeks) {
    const start = new Date(startISO);
    const end = new Date(start.getTime() + (numWeeks * 7 - 1) * 24 * 60 * 60 * 1000);
    return end.toISOString().split("T")[0];
}

function safeToISODateOnly(dateLike) {
    if (!dateLike) return null;
    try {
        return toISODateOnly(dateLike);
    } catch (_) {
        return null;
    }
}

function rangesOverlapISO(startA, endA, startB, endB) {
    if (!startA || !endA || !startB || !endB) return false;
    return !(endA < startB || startA > endB);
}

function getPayslipRangeISO(payslipData) {
    if (!isSalaryPayslip(payslipData)) return null;
    const startISO = safeToISODateOnly(payslipData?.paymentStartDate);
    let endISO = safeToISODateOnly(payslipData?.paymentEndDate);

    if (!startISO) return null;
    if (!endISO && Number(payslipData?.numberOfWeeksPaid) > 0) {
        endISO = toDateOnlyEndISO(startISO, Number(payslipData.numberOfWeeksPaid));
    }
    if (!endISO) return null;

    return { startISO, endISO };
}

function isPayrollRuleEnabled(rule = {}) {
    const autoDeduct = rule.autoDeduct !== false;
    const isActive = rule.isActive !== false;
    return autoDeduct && isActive;
}

function normalizeTierKey(value) {
    return String(value || "").trim().toLowerCase();
}

function getStudentCreditTierKeySet(student) {
    const tier = student?.creditTier;
    const keys = new Set();

    if (!tier) {
        keys.add("__no_tier__");
        return keys;
    }

    if (typeof tier === "string") {
        const normalized = normalizeTierKey(tier);
        if (normalized) keys.add(normalized);
        if (keys.size === 0) keys.add("__no_tier__");
        return keys;
    }

    const idKey = normalizeTierKey(tier?.id);
    const nameKey = normalizeTierKey(tier?.name);
    if (idKey) keys.add(idKey);
    if (nameKey) keys.add(nameKey);

    if (keys.size === 0) keys.add("__no_tier__");
    return keys;
}

function isCreditTierRuleMatch(student, targetValue) {
    if (!Array.isArray(targetValue) || targetValue.length === 0) return false;
    const tierKeys = getStudentCreditTierKeySet(student);
    return targetValue.some((tierId) => tierKeys.has(normalizeTierKey(tierId)));
}

function mapSelectedBonusJobs(baseJobBreakdowns = {}, selectedJobNames = []) {
    return selectedJobNames
        .map((jobName) => {
            const detail = baseJobBreakdowns[jobName];
            if (!detail) return null;
            return {
                jobName,
                weeklyBaseSalary: Number(detail.weeklyBaseSalary || 0),
                numberOfWeeks: Number(detail.numberOfWeeks || 0),
                baseSalary: Number(detail.baseSalary || 0),
                referenceNetSalary: Number(detail.netSalary || 0),
            };
        })
        .filter(Boolean);
}

function buildSharedBonusJobBreakdowns({
    baseJobBreakdowns = {},
    selectedJobNames = [],
    bonusMode = "fixed",
    bonusValue = 0,
}) {
    const selectedJobs = mapSelectedBonusJobs(baseJobBreakdowns, selectedJobNames);

    if (selectedJobs.length === 0) {
        throw new Error("성과급 기준 직업 정보를 찾을 수 없습니다.");
    }

    const normalizedBonusMode = normalizeBonusMode(bonusMode);
    const numericValue = Number(bonusValue || 0);
    const referenceSalaryAmount = selectedJobs.reduce(
        (sum, job) => sum + job.baseSalary,
        0,
    );

    if (referenceSalaryAmount < 0) {
        throw new Error("성과급 기준 금액이 올바르지 않습니다.");
    }

    const jobBonusMap = {};
    let totalBonusAmount = 0;

    if (normalizedBonusMode === "percent") {
        selectedJobs.forEach((job) => {
            const bonusAmount = Math.round(job.baseSalary * (numericValue / 100));
            jobBonusMap[job.jobName] = bonusAmount;
            totalBonusAmount += bonusAmount;
        });
    } else {
        totalBonusAmount = Math.round(numericValue);

        let remaining = totalBonusAmount;
        selectedJobs.forEach((job, index) => {
            let bonusAmount = 0;
            if (index === selectedJobs.length - 1) {
                bonusAmount = remaining;
            } else if (referenceSalaryAmount > 0) {
                bonusAmount = Math.min(
                    remaining,
                    Math.max(
                        0,
                        Math.round(
                            totalBonusAmount *
                                (job.baseSalary / referenceSalaryAmount),
                        ),
                    ),
                );
                remaining -= bonusAmount;
            } else {
                bonusAmount = Math.floor(totalBonusAmount / selectedJobs.length);
                remaining -= bonusAmount;
            }
            jobBonusMap[job.jobName] = bonusAmount;
        });
    }

    const jobBreakdowns = {};
    const appliedJobBonusConfigs = [];
    selectedJobs.forEach((job) => {
        const bonusAmount = Number(jobBonusMap[job.jobName] || 0);
        jobBreakdowns[job.jobName] = {
            jobName: job.jobName,
            weeklyBaseSalary: job.weeklyBaseSalary,
            numberOfWeeks: job.numberOfWeeks,
            baseSalary: job.baseSalary,
            referenceNetSalary: job.referenceNetSalary,
            bonusAmount,
            deductions: [],
            totalDeductions: 0,
            netSalary: bonusAmount,
        };
        appliedJobBonusConfigs.push({
            jobName: job.jobName,
            bonusMode: normalizedBonusMode,
            bonusValue: numericValue,
            bonusAmount,
        });
    });

    return {
        bonusEntryMode: "shared",
        jobBreakdowns,
        referenceSalaryAmount,
        totalBonusAmount,
        appliedJobBonusConfigs,
    };
}

function buildPerJobBonusBreakdowns({
    baseJobBreakdowns = {},
    jobBonusConfigs = [],
}) {
    const normalizedConfigs = Array.isArray(jobBonusConfigs)
        ? jobBonusConfigs
            .map((config) => ({
                jobName: String(config?.jobName || "").trim(),
                enabled: config?.enabled !== false,
                bonusMode: normalizeBonusMode(config?.bonusMode),
                bonusValue: Number(config?.bonusValue || 0),
            }))
            .filter((config) => config.enabled)
        : [];

    if (normalizedConfigs.length === 0) {
        throw new Error("직업별 성과급 설정이 없습니다.");
    }

    const jobBreakdowns = {};
    const appliedJobBonusConfigs = [];
    let referenceSalaryAmount = 0;
    let totalBonusAmount = 0;

    normalizedConfigs.forEach((config) => {
        const detail = baseJobBreakdowns[config.jobName];
        if (!detail) return;

        const baseSalary = Number(detail.baseSalary || 0);
        const bonusAmount =
            config.bonusMode === "percent"
                ? Math.round(baseSalary * (config.bonusValue / 100))
                : Math.round(config.bonusValue);

        if (!(bonusAmount > 0)) return;

        referenceSalaryAmount += baseSalary;
        totalBonusAmount += bonusAmount;

        jobBreakdowns[config.jobName] = {
            jobName: config.jobName,
            weeklyBaseSalary: Number(detail.weeklyBaseSalary || 0),
            numberOfWeeks: Number(detail.numberOfWeeks || 0),
            baseSalary,
            referenceNetSalary: Number(detail.netSalary || 0),
            bonusAmount,
            deductions: [],
            totalDeductions: 0,
            netSalary: bonusAmount,
        };

        appliedJobBonusConfigs.push({
            jobName: config.jobName,
            bonusMode: config.bonusMode,
            bonusValue: config.bonusValue,
            bonusAmount,
        });
    });

    if (appliedJobBonusConfigs.length === 0 || !(totalBonusAmount > 0)) {
        throw new Error("직업별 성과급 금액은 0보다 커야 합니다.");
    }

    return {
        bonusEntryMode: "per_job",
        jobBreakdowns,
        referenceSalaryAmount,
        totalBonusAmount,
        appliedJobBonusConfigs,
    };
}

function buildBonusJobBreakdowns({
    baseJobBreakdowns = {},
    bonusEntryMode = "shared",
    selectedJobNames = [],
    bonusMode = "fixed",
    bonusValue = 0,
    jobBonusConfigs = [],
}) {
    const normalizedEntryMode = normalizeBonusEntryMode(bonusEntryMode);
    if (normalizedEntryMode === "per_job") {
        return buildPerJobBonusBreakdowns({
            baseJobBreakdowns,
            jobBonusConfigs,
        });
    }

    return buildSharedBonusJobBreakdowns({
        baseJobBreakdowns,
        selectedJobNames,
        bonusMode,
        bonusValue,
    });
}

/* ??????????????????????????????????????????????????????????????
 * 湲됱뿬 怨꾩궛 ?듭떖 濡쒖쭅 (湲곗〈 濡쒖쭅 ?좎?)
 * ?????????????????????????????????????????????????????????????? */
function toNonNegativeNumber(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
}

function normalizeProgressiveBrackets(brackets = []) {
    if (!Array.isArray(brackets)) return [];

    const normalized = [];
    let previousUpper = 0;
    let hasOpenEndedBracket = false;

    brackets.forEach((bracket) => {
        if (hasOpenEndedBracket) return;

        const rate = toNonNegativeNumber(bracket?.rate);
        const rawUpper = bracket?.upToAmount;

        if (rawUpper === null || rawUpper === undefined || rawUpper === "") {
            normalized.push({ upToAmount: null, rate });
            hasOpenEndedBracket = true;
            return;
        }

        const upToAmount = toNonNegativeNumber(rawUpper);
        if (!(upToAmount > previousUpper)) return;

        normalized.push({ upToAmount, rate });
        previousUpper = upToAmount;
    });

    return normalized;
}

function getNormalizedTaxRuleCalculation(rule = {}) {
    const nextMode = String(rule?.calculationMode || "").trim().toLowerCase();
    const config =
        rule?.calculationConfig && typeof rule.calculationConfig === "object"
            ? rule.calculationConfig
            : {};

    if (nextMode === "flat_rate") {
        return {
            mode: "flat_rate",
            config: {
                rate: toNonNegativeNumber(config.rate),
            },
        };
    }

    if (nextMode === "flat_amount") {
        return {
            mode: "flat_amount",
            config: {
                amount: toNonNegativeNumber(config.amount),
            },
        };
    }

    if (nextMode === "rate_after_exemption") {
        return {
            mode: "rate_after_exemption",
            config: {
                rate: toNonNegativeNumber(config.rate),
                exemptionAmount: toNonNegativeNumber(config.exemptionAmount),
            },
        };
    }

    if (nextMode === "progressive") {
        return {
            mode: "progressive",
            config: {
                brackets: normalizeProgressiveBrackets(config.brackets),
            },
        };
    }

    if (String(rule?.type || "").trim().toLowerCase() === "percent") {
        return {
            mode: "flat_rate",
            config: {
                rate: toNonNegativeNumber(rule?.value),
            },
        };
    }

    return {
        mode: "flat_amount",
        config: {
            amount: toNonNegativeNumber(rule?.value),
        },
    };
}

function calculateProgressiveDeduction(baseAmount, brackets = []) {
    const taxableBase = Math.max(0, Number(baseAmount || 0));
    if (!(taxableBase > 0) || !Array.isArray(brackets) || brackets.length === 0) {
        return 0;
    }

    let total = 0;
    let previousUpper = 0;

    brackets.forEach((bracket) => {
        const upper = bracket?.upToAmount === null ? Infinity : Number(bracket?.upToAmount);
        if (!(upper > previousUpper) && upper !== Infinity) return;

        const taxableSlice = Math.max(0, Math.min(taxableBase, upper) - previousUpper);
        if (taxableSlice > 0 && Number(bracket?.rate || 0) > 0) {
            total += taxableSlice * (Number(bracket.rate) / 100);
        }

        previousUpper = upper;
    });

    return Math.round(total);
}

function scaleProgressiveBrackets(brackets = [], numberOfWeeks = 0) {
    const weeks = Math.max(0, Number(numberOfWeeks || 0));
    return (brackets || []).map((bracket) => ({
        upToAmount:
            bracket?.upToAmount === null
                ? null
                : Number(bracket?.upToAmount || 0) * weeks,
        rate: Number(bracket?.rate || 0),
    }));
}

function calculateProgressiveDeductionBreakdown(baseAmount, brackets = []) {
    const taxableBase = Math.max(0, Number(baseAmount || 0));
    if (!(taxableBase > 0) || !Array.isArray(brackets) || brackets.length === 0) {
        return {
            amount: 0,
            taxableBase,
            brackets: [],
        };
    }

    let totalRaw = 0;
    let previousUpper = 0;
    const appliedBrackets = [];

    brackets.forEach((bracket, index) => {
        const upper = bracket?.upToAmount === null ? Infinity : Number(bracket?.upToAmount);
        if (!(upper > previousUpper) && upper !== Infinity) return;

        const taxableSlice = Math.max(0, Math.min(taxableBase, upper) - previousUpper);
        const rate = Number(bracket?.rate || 0);

        if (taxableSlice > 0 && rate > 0) {
            const rawDeductionAmount = taxableSlice * (rate / 100);
            totalRaw += rawDeductionAmount;
            appliedBrackets.push({
                index: index + 1,
                fromAmount: previousUpper,
                upToAmount: upper === Infinity ? null : upper,
                rate,
                taxableSlice,
                rawDeductionAmount,
            });
        }

        previousUpper = upper;
    });

    const amount = Math.round(totalRaw);
    let remaining = amount;

    appliedBrackets.forEach((bracket, index) => {
        const roundedAmount =
            index === appliedBrackets.length - 1
                ? remaining
                : Math.round(bracket.rawDeductionAmount);

        remaining -= roundedAmount;
        bracket.deductionAmount = roundedAmount;
        delete bracket.rawDeductionAmount;
    });

    return {
        amount,
        taxableBase,
        brackets: appliedBrackets,
    };
}

function calculateRuleDeductionAmount(normalizedCalculation, baseAmount, numberOfWeeks) {
    const taxableBase = Math.max(0, Number(baseAmount || 0));
    const weeks = Math.max(0, Number(numberOfWeeks || 0));

    if (normalizedCalculation.mode === "flat_rate") {
        return Math.round(
            taxableBase * (Number(normalizedCalculation?.config?.rate || 0) / 100),
        );
    }

    if (normalizedCalculation.mode === "flat_amount") {
        return Number(normalizedCalculation?.config?.amount || 0) * weeks;
    }

    if (normalizedCalculation.mode === "rate_after_exemption") {
        const exemptionAmount =
            Number(normalizedCalculation?.config?.exemptionAmount || 0) * weeks;
        const rate = Number(normalizedCalculation?.config?.rate || 0);
        return Math.round(Math.max(0, taxableBase - exemptionAmount) * (rate / 100));
    }

    if (normalizedCalculation.mode === "progressive") {
        const scaledBrackets = scaleProgressiveBrackets(
            normalizedCalculation?.config?.brackets || [],
            weeks,
        );
        return calculateProgressiveDeduction(taxableBase, scaledBrackets);
    }

    return 0;
}

function buildDeductionEntry(rule, normalizedCalculation, baseAmount, numberOfWeeks) {
    const taxableBase = Math.max(0, Number(baseAmount || 0));
    const weeks = Math.max(0, Number(numberOfWeeks || 0));
    const deductionEntry = {
        name: rule?.name || "怨듭젣",
        amount: 0,
        ruleId: rule?.id || null,
        calculationMode: normalizedCalculation?.mode || "flat_amount",
    };

    if (normalizedCalculation.mode === "progressive") {
        const scaledBrackets = scaleProgressiveBrackets(
            normalizedCalculation?.config?.brackets || [],
            weeks,
        );
        const breakdown = calculateProgressiveDeductionBreakdown(taxableBase, scaledBrackets);
        if (!(breakdown.amount > 0)) return null;

        deductionEntry.amount = breakdown.amount;
        deductionEntry.calculationDetail = {
            taxableBase,
            numberOfWeeks: weeks,
            brackets: breakdown.brackets,
        };
        return deductionEntry;
    }

    const amount = calculateRuleDeductionAmount(normalizedCalculation, taxableBase, weeks);
    if (!(amount > 0)) return null;

    deductionEntry.amount = amount;

    if (normalizedCalculation.mode === "flat_rate") {
        deductionEntry.calculationDetail = {
            taxableBase,
            rate: Number(normalizedCalculation?.config?.rate || 0),
        };
        return deductionEntry;
    }

    if (normalizedCalculation.mode === "flat_amount") {
        deductionEntry.calculationDetail = {
            amountPerWeek: Number(normalizedCalculation?.config?.amount || 0),
            numberOfWeeks: weeks,
        };
        return deductionEntry;
    }

    if (normalizedCalculation.mode === "rate_after_exemption") {
        const exemptionAmount =
            Number(normalizedCalculation?.config?.exemptionAmount || 0) * weeks;
        deductionEntry.calculationDetail = {
            taxableBase,
            exemptionAmount,
            appliedBase: Math.max(0, taxableBase - exemptionAmount),
            rate: Number(normalizedCalculation?.config?.rate || 0),
        };
        return deductionEntry;
    }

    return deductionEntry;
}

function applyDeductionToJobBreakdown(jobBreakdown, deductionEntry) {
    if (!jobBreakdown || !deductionEntry || !(deductionEntry.amount > 0)) return 0;

    jobBreakdown.deductions = Array.isArray(jobBreakdown.deductions)
        ? jobBreakdown.deductions
        : [];
    jobBreakdown.deductions.push(deductionEntry);
    jobBreakdown.totalDeductions =
        Number(jobBreakdown.totalDeductions || 0) + deductionEntry.amount;
    jobBreakdown.netSalary = Number(jobBreakdown.netSalary || 0) - deductionEntry.amount;
    return deductionEntry.amount;
}

function applyGlobalDeduction(globalDeductions, deductionEntry) {
    if (!deductionEntry || !(deductionEntry.amount > 0)) return 0;
    globalDeductions.push(deductionEntry);
    return deductionEntry.amount;
}

function calculateDetailedPayslip({ student, jobs, jobDefs, taxRules, classData, paymentStartISO, numberOfWeeks }) {
    const currencyUnit = classData?.currencyUnit || "원";
    const jobBreakdowns = {};
    let totalBaseSalary = 0;

    jobs.forEach(jobName => {
        const def = jobDefs.find(j => j.name === jobName);
        if (!def) return;
        const baseSalary = Number(def.baseSalary || 0) * numberOfWeeks;
        jobBreakdowns[jobName] = {
            jobName,
            weeklyBaseSalary: Number(def.baseSalary),
            numberOfWeeks,
            baseSalary,
            deductions: [],
            totalDeductions: 0,
            netSalary: baseSalary
        };
        totalBaseSalary += baseSalary;
    });

    let totalDeductions = 0;
    const globalDeductions = [];

    taxRules.forEach(rule => {
        const appliesAll = (rule.targetType === "all");
        const appliesJob = (rule.targetType === "job" && jobs.includes(rule.targetValue));
        const appliesIndiv =
            rule.targetType === "individual" &&
            Array.isArray(rule.targetValue) &&
            rule.targetValue.includes(student.uid);
        const appliesCreditTier = (rule.targetType === "credit_tier" && isCreditTierRuleMatch(student, rule.targetValue));

        if (!(appliesAll || appliesJob || appliesIndiv || appliesCreditTier)) return;

        const normalizedCalculation = getNormalizedTaxRuleCalculation(rule);

        if (rule.targetType === "job") {
            const jobBreakdown = jobBreakdowns[rule.targetValue];
            if (!jobBreakdown) return;

            const deductionEntry = buildDeductionEntry(
                rule,
                normalizedCalculation,
                jobBreakdown.baseSalary,
                numberOfWeeks,
            );

            if (deductionEntry) {
                totalDeductions += applyDeductionToJobBreakdown(
                    jobBreakdown,
                    deductionEntry,
                );
            }
            return;
        }

        if (normalizedCalculation.mode === "flat_rate") {
            Object.values(jobBreakdowns).forEach((jobBreakdown) => {
                const deductionEntry = buildDeductionEntry(
                    rule,
                    normalizedCalculation,
                    jobBreakdown.baseSalary,
                    numberOfWeeks,
                );

                if (deductionEntry) {
                    totalDeductions += applyDeductionToJobBreakdown(
                        jobBreakdown,
                        deductionEntry,
                    );
                }
            });
            return;
        }

        const deductionEntry = buildDeductionEntry(
            rule,
            normalizedCalculation,
            totalBaseSalary,
            numberOfWeeks,
        );

        if (deductionEntry) {
            totalDeductions += applyGlobalDeduction(globalDeductions, deductionEntry);
        }
    });

    const netSalary = totalBaseSalary - totalDeductions;
    const endISO = toDateOnlyEndISO(paymentStartISO, numberOfWeeks);

    return {
        slipType: "salary",
        studentUid: student.uid,
        studentName: student.name,
        paymentStartDate: admin.firestore.Timestamp.fromDate(new Date(paymentStartISO)),
        paymentEndDate: admin.firestore.Timestamp.fromDate(new Date(endISO)),
        numberOfWeeksPaid: numberOfWeeks,
        jobBreakdowns,
        globalDeductions,
        totals: { totalBaseSalary, totalDeductions, netSalary },
        currencyUnit,
        paymentPeriodDescription: `${numberOfWeeks}주분 급여 (${paymentStartISO} ~ ${endISO})`
    };
}

/* ??????????????????????????????????????????????????????????????
 * 湲됱뿬 吏湲??꾨줈?몄꽌 (?몃옖??뀡 ?ㅽ뻾遺)
 * ?????????????????????????????????????????????????????????????? */
async function processStudentUnifiedPayroll(tx, {
    classId,
    studentUid,
    paymentStartDate,
    numberOfWeeks,
    actorUid,
    actorName,
    globalConfig,
    allowOverlapOverride = false,
    executionMode = "manual",
    automationRunId = null,
}) {
    const startISO = toISODateOnly(paymentStartDate);
    const canonicalPayslipId = `${studentUid}_${startISO}_${numberOfWeeks}`;
    const targetEndISO = toDateOnlyEndISO(startISO, numberOfWeeks);

    const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
    const canonicalPayslipRef = studentRef.collection("paySlips").doc(canonicalPayslipId);

    const pensionFundsQuery = db.collection(`classes/${classId}/classFunds`)
        .where("fundType", "==", "pension");
    const [
        studentSnap,
        payslipSnap,
        existingPayslipsSnap,
        jobDefsSnap,
        taxRulesSnap,
        classSnap,
        pensionFundsSnap,
    ] = await Promise.all([
        tx.get(studentRef),
        tx.get(canonicalPayslipRef),
        tx.get(studentRef.collection("paySlips")),
        tx.get(db.collection(`classes/${classId}/jobDefinitions`)),
        tx.get(db.collection(`classes/${classId}/taxRules`)),
        tx.get(db.doc(`classes/${classId}`)),
        tx.get(pensionFundsQuery),
    ]);

    if (!studentSnap.exists) throw new Error("학생 정보를 찾을 수 없습니다.");

    const student = studentSnap.data() || {};
    const studentName = student.name || "해당 학생";

    const exactSalaryPayslipExists =
        payslipSnap.exists && isSalaryPayslip(payslipSnap.data() || {});
    const exactPayslipData = exactSalaryPayslipExists
        ? payslipSnap.data() || {}
        : null;
    if (
        exactPayslipData &&
        automationRunId &&
        exactPayslipData.automationRunId === automationRunId
    ) {
        return {
            success: true,
            studentName,
            totals: exactPayslipData.totals || null,
            payslipId: payslipSnap.id,
            overlapOverride: false,
            alreadyProcessed: true,
        };
    }
    const overlappingSalaryPayslips = existingPayslipsSnap.docs.filter((docSnap) => {
        if (docSnap.id === canonicalPayslipId && exactSalaryPayslipExists) return true;
        const docData = docSnap.data() || {};
        if (!isSalaryPayslip(docData)) return false;
        const range = getPayslipRangeISO(docData);
        if (!range) return false;
        return rangesOverlapISO(range.startISO, range.endISO, startISO, targetEndISO);
    });
    const hasOverlappingPayslip = overlappingSalaryPayslips.length > 0;
    const shouldCreateOverridePayslip =
        allowOverlapOverride && (exactSalaryPayslipExists || hasOverlappingPayslip);

    if (exactSalaryPayslipExists && !shouldCreateOverridePayslip) {
        throw new Error(`${studentName} 학생은 이미 지급된 급여입니다.`);
    }

    if (hasOverlappingPayslip && !shouldCreateOverridePayslip) {
        throw new Error(`${studentName} 학생은 이미 지급된 급여 기간과 겹칩니다.`);
    }

    const payslipRef = shouldCreateOverridePayslip
        ? studentRef.collection("paySlips").doc()
        : canonicalPayslipRef;
    const payslipId = payslipRef.id;
    const overlappingPayslipIds = overlappingSalaryPayslips.map((docSnap) => docSnap.id);

    const classData = classSnap.data() || {};
    const planType = classData.planType || "FREE";
    const currencyUnit = classData.currencyUnit || "원";

    // 1. 留덉뒪???뺤콉 泥댄겕 (Payroll???멸툑 湲곕줉 沅뚰븳)
    const isMasterTaxEnabled = canUseFeature(globalConfig, planType, "payroll", "enableTax");

    // 2. ?꾨줎?몄뿏???ㅼ젙怨??숆린??(settings.payrollTaxMode)
    // 紐⑤뱶 醫낅쪟: 'TOTAL' (?꾩껜 ?곕룞), 'TAX_ONLY' (?뚮뱷???섏닔), 'NONE' (誘몄뿰??
    const payrollMode = getPayrollTreasuryMode(classData);

    const payrollContext = { config: globalConfig, planType, serviceName: "payroll" };
    const enabledTaxRules = taxRulesSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(isPayrollRuleEnabled);

    const jobs = (student.jobs || []).filter(j => j && j !== "?놁쓬");
    if (jobs.length === 0) throw new Error(`${student.name || studentName}: 배정된 직업이 없습니다.`);

    // 湲됱뿬 怨꾩궛
    const payslip = calculateDetailedPayslip({
        student: { uid: studentUid, name: student.name, creditTier: student.creditTier || null },
        jobs,
        jobDefs: jobDefsSnap.docs.map(d => d.data()),
        taxRules: enabledTaxRules,
        classData: classData,
        paymentStartISO: startISO,
        numberOfWeeks
    });

    // 湲덉븸 蹂???뺤쓽 (?뚭퀎 ?뺤궛??
    const grossAmount = payslip.totals.totalBaseSalary; // ?몄쟾 珥앹븸 (?? 100)
    const deductions = payslip.totals.totalDeductions; // ?뚮뱷??(?? 10)
    const netSalaryBeforePension = payslip.totals.netSalary;
    const enabledPensionFunds = pensionFundsSnap.docs.filter((docSnap) => {
        const fund = docSnap.data() || {};
        return (!fund.status || fund.status === "active") &&
            fund.pensionSettings?.enabled === true;
    });
    if (enabledPensionFunds.length > 1) {
        throw new Error("급여 연동 연금 기금이 두 개 이상 활성화되어 있습니다.");
    }

    const pensionFundSnap = enabledPensionFunds[0] || null;
    const pensionFund = pensionFundSnap?.data() || null;
    const pensionContribution = calculatePayrollPensionContribution({
        baseSalary: grossAmount,
        netSalaryBeforePension,
        settings: pensionFund?.pensionSettings || {},
        studentUid,
    });
    const pensionAmount = pensionContribution.amount;
    const netAmount = netSalaryBeforePension - pensionAmount;
    let pensionSnapshot = null;

    if (pensionFundSnap && pensionAmount > 0) {
        const fundId = pensionFundSnap.id;
        const fundRef = pensionFundSnap.ref;
        const contributionId = `${fundId}_${payslipId}`;
        const contributionRef = db.doc(
            `classes/${classId}/pensionContributions/${contributionId}`,
        );
        const ledgerRef = fundRef.collection("ledger").doc(
            `pension_${payslipId}`,
        );
        const balanceBefore = Number(pensionFund.cashBalance || 0);
        const balanceAfter = balanceBefore + pensionAmount;
        const now = FieldValue.serverTimestamp();

        pensionSnapshot = {
            fundId,
            fundName: pensionFund.name || "연금 기금",
            contributionId,
            contributionRate: pensionContribution.rate,
            contributionBaseSalary: pensionContribution.baseSalary,
            contributionAmount: pensionAmount,
            cappedByNetSalary: pensionContribution.cappedByNetSalary,
        };

        tx.update(fundRef, {
            cashBalance: FieldValue.increment(pensionAmount),
            totalValue: FieldValue.increment(pensionAmount),
            pensionContributionTotal: FieldValue.increment(pensionAmount),
            lastPensionContributionAt: now,
            updatedAt: now,
        });
        tx.set(contributionRef, {
            ...pensionSnapshot,
            classId,
            studentUid,
            studentName: student.name || null,
            payslipId,
            payrollPeriodKey: canonicalPayslipId,
            paymentStartDate: startISO,
            paymentEndDate: targetEndISO,
            numberOfWeeks,
            status: "contributed",
            createdBy: actorUid,
            createdAt: now,
        });
        tx.set(ledgerRef, {
            type: "pension_contribution",
            direction: "in",
            amount: pensionAmount,
            studentUid,
            studentName: student.name || null,
            contributionRate: pensionContribution.rate,
            baseSalary: pensionContribution.baseSalary,
            relatedContributionId: contributionId,
            relatedPayslipId: payslipId,
            description: `${student.name || "학생"} 급여 연동 연금 납입`,
            balanceBefore,
            balanceAfter,
            createdBy: actorUid,
            createdAt: now,
        });
    }

    payslip.totals.netSalaryBeforePension = netSalaryBeforePension;
    payslip.totals.pensionContribution = pensionAmount;
    payslip.totals.netSalary = netAmount;

    // 紐낆꽭?????
    tx.set(payslipRef, {
        ...payslip,
        id: payslipId,
        classId,
        payrollPeriodKey: canonicalPayslipId,
        overlapOverride: shouldCreateOverridePayslip,
        overlapReferencePayslipIds: shouldCreateOverridePayslip
            ? overlappingPayslipIds
            : [],
        pension: pensionSnapshot,
        generatedBy: actorUid,
        generatedByType: executionMode,
        automationRunId: automationRunId || null,
        createdAt: FieldValue.serverTimestamp(),
    });
    const salaryIncomeTaxSnapshot = buildIncomeTaxSnapshot({
        sourceKey: "payrollSalary",
        grossAmount,
        policy: {
            enabled: deductions > 0,
            taxRate: grossAmount > 0 ? (deductions / grossAmount) * 100 : 0,
            monthEndSettlementEnabled: true,
        },
        withheldAmount: deductions,
        policySnapshot: {
            source: "payrollTaxRules",
            ruleCount: enabledTaxRules.length,
            payrollMode,
        },
    });

    if (netAmount !== 0) {
        // A. ?숈깮 ?듭옣 ?낃툑 (??긽 ?ㅽ뻾)
        tx.update(studentRef, {
            "assets.cash": FieldValue.increment(netAmount),
            "lastUpdated": FieldValue.serverTimestamp()
        });

        // B. ?쒕룞 濡쒓렇 湲곕줉 (??긽 ?ㅽ뻾)
        stageActivityLog(tx, classId, {
            studentUid,
            type: netAmount > 0 ? "income" : "expense",
            category: netAmount > 0 ? "salary" : "salary_deduction",
            amount: Math.abs(netAmount),
            description: netAmount > 0
                ? pensionAmount > 0
                    ? `급여 수령 (${numberOfWeeks}주, 연금 ${pensionAmount}${currencyUnit} 납입)`
                    : `급여 수령 (${numberOfWeeks}주)`
                : `급여 공제 환수 (${numberOfWeeks}주)`,
            currency: currencyUnit,
            incomeTax: salaryIncomeTaxSnapshot.incomeTax,
            pensionContribution: pensionSnapshot,
        }, payrollContext);

    }

    if (isMasterTaxEnabled) {
        stagePayrollTaxRecords(tx, {
            classId,
            classData,
            studentUid,
            studentName: student.name || null,
            payslipRef,
            payslipId,
            paymentStartISO: startISO,
            paymentEndISO: targetEndISO,
            numberOfWeeks,
            actorUid,
            actorName,
            payrollMode,
            grossAmount,
            netAmount,
            deductions,
            incomeTax: salaryIncomeTaxSnapshot.incomeTax,
            payrollContext,
        });
    }

    return {
        success: true,
        studentName: student.name,
        totals: payslip.totals,
        payslipId,
        overlapOverride: shouldCreateOverridePayslip,
        alreadyProcessed: false,
    };
}

exports.processIndividualBonus = onCall(
    { ...PAYROLL_OPTS, memory: "1GiB" },
    async (request) => {
        if (!request.auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");

        const {
            classId,
            studentUid,
            basePayslipId,
            bonusEntryMode,
            selectedJobNames = [],
            bonusMode,
            bonusValue,
            jobBonusConfigs = [],
            note = "",
        } = request.data || {};

        if (!classId || !studentUid || !basePayslipId) {
            throw new HttpsError(
                "invalid-argument",
                "classId, studentUid, basePayslipId가 필요합니다.",
            );
        }

        const normalizedBonusEntryMode = normalizeBonusEntryMode(bonusEntryMode);
        const normalizedBonusMode = normalizeBonusMode(bonusMode);
        const parsedBonusValue = Number(bonusValue || 0);
        if (
            normalizedBonusEntryMode === "shared" &&
            (!Number.isFinite(parsedBonusValue) || parsedBonusValue <= 0)
        ) {
            throw new HttpsError(
                "invalid-argument",
                "성과급 값은 0보다 큰 숫자여야 합니다.",
            );
        }

        const trimmedNote = String(note || "").trim();
        if (trimmedNote.length > 200) {
            throw new HttpsError(
                "invalid-argument",
                "메모는 200자 이하로 입력해 주세요.",
            );
        }

        const globalConfig = await getGlobalConfig();
        await mustBeTeacherOrTaxAdmin(classId, request.auth.uid, {
            requireSalaryPower: true,
        });

        const result = await db.runTransaction(async (tx) => {
            const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
            const basePayslipRef = studentRef.collection("paySlips").doc(basePayslipId);
            const classRef = db.doc(`classes/${classId}`);
            const bonusSlipRef = studentRef.collection("paySlips").doc();

            const [studentSnap, basePayslipSnap, classSnap] = await Promise.all([
                tx.get(studentRef),
                tx.get(basePayslipRef),
                tx.get(classRef),
            ]);

            if (!studentSnap.exists) {
                throw new HttpsError("not-found", "학생 정보를 찾을 수 없습니다.");
            }
            if (!basePayslipSnap.exists) {
                throw new HttpsError("not-found", "기준 급여 명세서를 찾을 수 없습니다.");
            }

            const student = studentSnap.data() || {};
            const classData = classSnap.data() || {};
            const planType = classData.planType || "FREE";
            const currencyUnit = classData.currencyUnit || "원";
            const payrollContext = {
                config: globalConfig,
                planType,
                serviceName: "payroll",
            };
            const basePayslip = basePayslipSnap.data() || {};

            if (!isSalaryPayslip(basePayslip)) {
                throw new HttpsError(
                    "failed-precondition",
                    "성과급 기준은 일반 급여 명세서여야 합니다.",
                );
            }

            const baseJobBreakdowns = basePayslip.jobBreakdowns || {};
            const allJobNames = Object.keys(baseJobBreakdowns);
            if (allJobNames.length === 0) {
                throw new HttpsError(
                    "failed-precondition",
                    "기준 급여에 직업 정보가 없어 성과급을 계산할 수 없습니다.",
                );
            }

            const sanitizedSelectedJobNames = Array.isArray(selectedJobNames) &&
                selectedJobNames.length > 0
                ? Array.from(
                    new Set(
                        selectedJobNames
                            .map((jobName) => String(jobName || "").trim())
                            .filter((jobName) => allJobNames.includes(jobName)),
                    ),
                )
                : allJobNames;

            if (sanitizedSelectedJobNames.length === 0) {
                throw new HttpsError(
                    "invalid-argument",
                    "성과급에 반영할 직업을 하나 이상 선택해 주세요.",
                );
            }

            const {
                bonusEntryMode: resolvedBonusEntryMode,
                jobBreakdowns,
                referenceSalaryAmount,
                totalBonusAmount,
                appliedJobBonusConfigs,
            } = buildBonusJobBreakdowns({
                baseJobBreakdowns,
                bonusEntryMode: normalizedBonusEntryMode,
                selectedJobNames: sanitizedSelectedJobNames,
                bonusMode: normalizedBonusMode,
                bonusValue: parsedBonusValue,
                jobBonusConfigs,
            });

            if (!(totalBonusAmount > 0)) {
                throw new HttpsError(
                    "failed-precondition",
                    "계산된 성과급이 0보다 커야 합니다.",
                );
            }

            const bonusDeductionPolicy = getBonusDeductionSnapshot(classData);
            const deductionLabel = bonusDeductionPolicy.enabled
                ? `${BONUS_DEDUCTION_LABEL} (${bonusDeductionPolicy.taxRate}%)`
                : BONUS_DEDUCTION_LABEL;
            const { totalDeductionAmount, netBonusAmount } =
                applyBonusDeductionToBreakdowns({
                    jobBreakdowns,
                    totalBonusAmount,
                    deductionRate: bonusDeductionPolicy.taxRate,
                    label: deductionLabel,
                });
            const bonusIncomeTaxSnapshot = buildIncomeTaxSnapshot({
                sourceKey: "payrollBonus",
                grossAmount: totalBonusAmount,
                policy: bonusDeductionPolicy,
            });

            const paymentStartISO =
                safeToISODateOnly(basePayslip.paymentStartDate) ||
                safeToISODateOnly(basePayslip.createdAt) ||
                new Date().toISOString().split("T")[0];
            const paymentEndISO =
                safeToISODateOnly(basePayslip.paymentEndDate) || paymentStartISO;
            const payslipDescription =
                basePayslip.paymentPeriodDescription ||
                `${paymentStartISO} ~ ${paymentEndISO}`;

            const bonusSlipId = bonusSlipRef.id;
            const payrollMode = getPayrollTreasuryMode(classData);
            const isMasterTaxEnabled = canUseFeature(
                globalConfig,
                planType,
                "payroll",
                "enableTax",
            );
            const bonusTaxExpenseRecordId = `payroll_bonus_expense_${bonusSlipId}`;
            const bonusTaxIncomeRecordId = `payroll_bonus_income_${bonusSlipId}`;
            let taxExpenseRecordPointer = null;
            let taxIncomeRecordPointer = null;

            tx.set(bonusSlipRef, {
                id: bonusSlipId,
                classId,
                slipType: "bonus",
                studentUid,
                studentName: student.name || "해당 학생",
                basePayslipId,
                paymentStartDate: basePayslip.paymentStartDate || null,
                paymentEndDate: basePayslip.paymentEndDate || null,
                numberOfWeeksPaid: Number(basePayslip.numberOfWeeksPaid || 0),
                paymentPeriodDescription: `성과급 기준 기간 (${payslipDescription})`,
                currencyUnit,
                jobBreakdowns,
                globalDeductions: [],
                bonusDeduction: {
                    enabled: bonusDeductionPolicy.enabled,
                    taxRate: bonusDeductionPolicy.taxRate,
                    amount: totalDeductionAmount,
                    label: deductionLabel,
                },
                bonusEntryMode: resolvedBonusEntryMode,
                bonusMode:
                    resolvedBonusEntryMode === "shared"
                        ? normalizedBonusMode
                        : null,
                bonusValue:
                    resolvedBonusEntryMode === "shared"
                        ? parsedBonusValue
                        : null,
                bonusScope:
                    resolvedBonusEntryMode === "per_job"
                        ? "per_job"
                        : sanitizedSelectedJobNames.length === allJobNames.length
                            ? "all_jobs"
                            : "selected_jobs",
                selectedJobNames: sanitizedSelectedJobNames,
                appliedJobBonusConfigs,
                note: trimmedNote || null,
                bonusSummary: {
                    referenceSalaryAmount,
                    totalBonusAmount,
                    totalDeductionAmount,
                    netBonusAmount,
                    deductionRate: bonusDeductionPolicy.taxRate,
                    deductionEnabled: bonusDeductionPolicy.enabled,
                    selectedJobCount:
                        resolvedBonusEntryMode === "per_job"
                            ? appliedJobBonusConfigs.length
                            : sanitizedSelectedJobNames.length,
                },
                totals: {
                    totalBaseSalary: referenceSalaryAmount,
                    totalDeductions: totalDeductionAmount,
                    totalBonusAmount,
                    netSalary: netBonusAmount,
                },
                incomeTax: bonusIncomeTaxSnapshot.incomeTax,
                generatedBy: request.auth.uid,
                createdAt: FieldValue.serverTimestamp(),
            });

            tx.update(studentRef, {
                "assets.cash": FieldValue.increment(netBonusAmount),
                "lastUpdated": FieldValue.serverTimestamp(),
            });

            if (netBonusAmount > 0) {
                stageActivityLog(
                    tx,
                    classId,
                    {
                        studentUid,
                        type: "income",
                        category: "salary",
                        subCategory: "bonus",
                        amount: netBonusAmount,
                        description: `성과급 수령 (${payslipDescription})`,
                        currency: currencyUnit,
                        relatedDoc: {
                            collection: "paySlips",
                            id: bonusSlipId,
                        },
                        incomeTax: bonusIncomeTaxSnapshot.incomeTax,
                        ...(trimmedNote ? { note: trimmedNote } : {}),
                    },
                    payrollContext,
                );
            }

            if (isMasterTaxEnabled && payrollMode === "TOTAL") {
                const taxResult = stageTaxExpense(
                    tx,
                    classId,
                    {
                        amount: totalBonusAmount,
                        source: "payroll",
                        expenseType: "salary",
                        category: "salary",
                        description: `성과급 지급 - ${student.name || "학생"} (${payslipDescription})`,
                    },
                    request.auth.uid,
                    {
                        ...payrollContext,
                        customId: bonusTaxExpenseRecordId,
                        aggregateMeta: {
                            group: "payroll_bonus",
                            batchKey: bonusSlipId,
                            pageKey: "payroll",
                            actorUid: request.auth.uid,
                            actorName: request.auth.token?.name || null,
                            mode: "process_individual_bonus",
                        },
                        detailLines: [
                            {
                                id: bonusSlipId,
                                amount: totalBonusAmount,
                                source: "payroll",
                                expenseType: "salary",
                                category: "salary",
                                description: `성과급 지급 - ${student.name || "학생"}`,
                                studentUid,
                                studentName: student.name || null,
                                relatedDoc: {
                                    collection: "paySlips",
                                    id: bonusSlipId,
                                },
                                externalId: bonusSlipId,
                                meta: {
                                    slipType: "bonus",
                                    basePayslipId,
                                    paymentStartDate: paymentStartISO,
                                    paymentEndDate: paymentEndISO,
                                    bonusEntryMode: resolvedBonusEntryMode,
                                    bonusMode: normalizedBonusMode,
                                    bonusValue: parsedBonusValue,
                                    selectedJobNames: sanitizedSelectedJobNames,
                                    appliedJobBonusConfigs,
                                    referenceSalaryAmount,
                                    totalBonusAmount,
                                    totalDeductionAmount,
                                    netBonusAmount,
                                    deductionRate: bonusDeductionPolicy.taxRate,
                                    incomeTax: bonusIncomeTaxSnapshot.incomeTax,
                                    ...(trimmedNote ? { note: trimmedNote } : {}),
                                },
                            },
                        ],
                    },
                );

                if (!taxResult?.skipped && taxResult?.id) {
                    taxExpenseRecordPointer = buildTaxRecordPointer(
                        "taxExpenses",
                        bonusTaxExpenseRecordId,
                        bonusSlipId,
                    );
                }
            }

            if (
                isMasterTaxEnabled &&
                totalDeductionAmount > 0 &&
                (payrollMode === "TOTAL" || payrollMode === "TAX_ONLY")
            ) {
                const taxResult = stageTaxIncome(
                    tx,
                    classId,
                    {
                        amount: totalDeductionAmount,
                        source: "payroll",
                        taxType: "income_tax",
                        description: `성과급 공제 수입 - ${student.name || "학생"} (${payslipDescription})`,
                    },
                    request.auth.uid,
                    {
                        ...payrollContext,
                        classData,
                        sourceKey: "payrollBonus",
                        customId: bonusTaxIncomeRecordId,
                        aggregateMeta: {
                            group: "payroll_bonus_deduction",
                            batchKey: bonusSlipId,
                            pageKey: "payroll",
                            actorUid: request.auth.uid,
                            actorName: request.auth.token?.name || null,
                            mode: "process_individual_bonus",
                        },
                        detailLines: [
                            {
                                id: bonusSlipId,
                                amount: totalDeductionAmount,
                                source: "payroll",
                                taxType: "income_tax",
                                description: `성과급 공제 수입 - ${student.name || "학생"}`,
                                studentUid,
                                studentName: student.name || null,
                                relatedDoc: {
                                    collection: "paySlips",
                                    id: bonusSlipId,
                                },
                                externalId: bonusSlipId,
                                meta: {
                                    slipType: "bonus",
                                    basePayslipId,
                                    paymentStartDate: paymentStartISO,
                                    paymentEndDate: paymentEndISO,
                                    totalBonusAmount,
                                    totalDeductionAmount,
                                    netBonusAmount,
                                    deductionRate: bonusDeductionPolicy.taxRate,
                                    incomeTax: bonusIncomeTaxSnapshot.incomeTax,
                                    ...(trimmedNote ? { note: trimmedNote } : {}),
                                },
                            },
                        ],
                    },
                );

                if (!taxResult?.skipped && taxResult?.id) {
                    taxIncomeRecordPointer = buildTaxRecordPointer(
                        "taxIncomes",
                        bonusTaxIncomeRecordId,
                        bonusSlipId,
                    );
                }
            }

            const taxRecords = {};
            if (taxExpenseRecordPointer) taxRecords.expense = taxExpenseRecordPointer;
            if (taxIncomeRecordPointer) taxRecords.income = taxIncomeRecordPointer;
            const primaryTaxRecordPointer =
                taxIncomeRecordPointer || taxExpenseRecordPointer || null;

            if (primaryTaxRecordPointer) {
                tx.set(
                    bonusSlipRef,
                    {
                        taxRecord: primaryTaxRecordPointer,
                        taxRecords,
                        taxRecordedAt: FieldValue.serverTimestamp(),
                        taxCancelled: false,
                    },
                    { merge: true },
                );
            }

            return {
                success: true,
                studentUid,
                studentName: student.name || "해당 학생",
                bonusSlipId,
                slipType: "bonus",
                paymentPeriodDescription: `성과급 기준 기간 (${payslipDescription})`,
                bonusEntryMode: resolvedBonusEntryMode,
                selectedJobNames: sanitizedSelectedJobNames,
                appliedJobBonusConfigs,
                note: trimmedNote || null,
                bonusDeduction: {
                    enabled: bonusDeductionPolicy.enabled,
                    taxRate: bonusDeductionPolicy.taxRate,
                    amount: totalDeductionAmount,
                },
                totals: {
                    totalBaseSalary: referenceSalaryAmount,
                    totalBonusAmount,
                    totalDeductions: totalDeductionAmount,
                    netSalary: netBonusAmount,
                },
                ...(primaryTaxRecordPointer
                    ? {
                        taxRecord: primaryTaxRecordPointer,
                        taxRecords,
                    }
                    : {}),
            };
        });

        return result;
    },
);
exports.processIndividualIncentive = onCall(
    { ...PAYROLL_OPTS, memory: "1GiB" },
    async (request) => {
        if (!request.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const {
            classId,
            studentUid,
            jobName,
            reason,
            incentiveMode,
            amount,
            quantity,
            unitAmount,
            note = "",
        } = request.data || {};

        if (!classId || !studentUid) {
            throw new HttpsError(
                "invalid-argument",
                "classId와 studentUid가 필요합니다.",
            );
        }

        const trimmedJobName = String(jobName || "").trim();
        const trimmedReason = String(reason || "").trim();
        const trimmedNote = String(note || "").trim();
        const normalizedIncentiveMode = normalizeIncentiveMode(incentiveMode);


        if (!trimmedReason) {
            throw new HttpsError(
                "invalid-argument",
                "지급 사유를 입력해 주세요.",
            );
        }

        if (trimmedNote.length > 200) {
            throw new HttpsError(
                "invalid-argument",
                "메모는 200자 이하로 입력해 주세요.",
            );
        }

        const parsedAmount = Math.round(Number(amount || 0));
        const parsedQuantity = Number(quantity || 0);
        const parsedUnitAmount = Math.round(Number(unitAmount || 0));
        const totalAmount =
            normalizedIncentiveMode === "quantity"
                ? Math.round(parsedQuantity * parsedUnitAmount)
                : parsedAmount;

        if (normalizedIncentiveMode === "quantity") {
            if (
                !Number.isFinite(parsedQuantity) ||
                parsedQuantity <= 0 ||
                !Number.isFinite(parsedUnitAmount) ||
                parsedUnitAmount <= 0 ||
                totalAmount <= 0
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "건수와 건당 금액을 모두 0보다 크게 입력해 주세요.",
                );
            }
        } else if (
            !Number.isFinite(parsedAmount) ||
            parsedAmount <= 0
        ) {
            throw new HttpsError(
                "invalid-argument",
                "지급 금액은 0보다 크게 입력해 주세요.",
            );
        }

        const globalConfig = await getGlobalConfig();
        await mustBeTeacherOrTaxAdmin(classId, request.auth.uid, {
            requireSalaryPower: true,
        });

        return await db.runTransaction(async (tx) => {
            const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
            const classRef = db.doc(`classes/${classId}`);

            const [studentSnap, classSnap] = await Promise.all([
                tx.get(studentRef),
                tx.get(classRef),
            ]);

            if (!studentSnap.exists) {
                throw new HttpsError("not-found", "학생 정보를 찾을 수 없습니다.");
            }

            const student = studentSnap.data() || {};
            const classData = classSnap.data() || {};
            const currencyUnit = classData.currencyUnit || "원";
            const planType = classData.planType || "FREE";
            const payrollContext = {
                config: globalConfig,
                planType,
                serviceName: "payroll",
            };

            const rawJobs = Array.isArray(student.jobs)
                ? student.jobs
                : (student.job ? [student.job] : []);
            const validJobs = Array.from(
                new Set(
                    rawJobs
                        .map((job) => String(job || "").trim())
                        .filter((job) => job && job !== "없음"),
                ),
            );

            if (trimmedJobName && !validJobs.includes(trimmedJobName)) {
                throw new HttpsError(
                    "failed-precondition",
                    "현재 배정된 직업에만 인센티브를 지급할 수 있습니다.",
                );
            }

            const effectiveJobName = trimmedJobName || "";
            const incentiveSubCategory =
                normalizedIncentiveMode === "quantity"
                    ? (effectiveJobName ? "job_piece_rate" : "student_piece_rate")
                    : (effectiveJobName ? "job_incentive" : "student_incentive");

            const incentiveDeductionPolicy = getIncentiveDeductionSnapshot(classData);
            const incentiveIncomeTaxSnapshot = buildIncomeTaxSnapshot({
                sourceKey: "incentivePayment",
                grossAmount: totalAmount,
                policy: incentiveDeductionPolicy,
            });
            const totalDeductionAmount = incentiveIncomeTaxSnapshot.withheldAmount;
            const netIncentiveAmount = incentiveIncomeTaxSnapshot.netAmount;

            tx.update(studentRef, {
                "assets.cash": FieldValue.increment(netIncentiveAmount),
                "lastUpdated": FieldValue.serverTimestamp(),
            });

            const activityLogId = stageActivityLog(
                tx,
                classId,
                {
                    studentUid,
                    type: "income",
                    category: "incentive",
                    subCategory: incentiveSubCategory,
                    amount: netIncentiveAmount,
                    description: `${effectiveJobName ? `${effectiveJobName} ` : ""}인센티브 지급 (${trimmedReason})`,
                    reason: trimmedReason,
                    currency: currencyUnit,
                    ...(effectiveJobName ? { jobName: effectiveJobName } : {}),
                    incentiveMode: normalizedIncentiveMode,
                    grossAmount: totalAmount,
                    deductionAmount: totalDeductionAmount,
                    netAmount: netIncentiveAmount,
                    incomeTax: incentiveIncomeTaxSnapshot.incomeTax,
                    incentiveDeduction: {
                        enabled: incentiveDeductionPolicy.enabled,
                        taxRate: incentiveDeductionPolicy.taxRate,
                        amount: totalDeductionAmount,
                        label: incentiveDeductionPolicy.enabled
                            ? `${INCENTIVE_DEDUCTION_LABEL} (${incentiveDeductionPolicy.taxRate}%)`
                            : INCENTIVE_DEDUCTION_LABEL,
                    },
                    ...(normalizedIncentiveMode === "quantity"
                        ? {
                            quantity: parsedQuantity,
                            unitAmount: parsedUnitAmount,
                        }
                        : {
                            fixedAmount: parsedAmount,
                        }),
                    ...(trimmedNote ? { note: trimmedNote } : {}),
                },
                payrollContext,
            );

            return {
                success: true,
                studentUid,
                studentName: student.name || "해당 학생",
                jobName: effectiveJobName || null,
                reason: trimmedReason,
                incentiveMode: normalizedIncentiveMode,
                amount: netIncentiveAmount,
                grossAmount: totalAmount,
                deductionAmount: totalDeductionAmount,
                incentiveDeduction: {
                    enabled: incentiveDeductionPolicy.enabled,
                    taxRate: incentiveDeductionPolicy.taxRate,
                    amount: totalDeductionAmount,
                },
                quantity:
                    normalizedIncentiveMode === "quantity" ? parsedQuantity : null,
                unitAmount:
                    normalizedIncentiveMode === "quantity"
                        ? parsedUnitAmount
                        : null,
                note: trimmedNote || null,
                currencyUnit,
                activityLogId: activityLogId || null,
                incomeTax: incentiveIncomeTaxSnapshot.incomeTax,
            };
        });
    },
);

function stagePayrollTaxRecords(tx, {
    classId,
    studentUid,
    classData,
    studentName,
    payslipRef,
    payslipId,
    paymentStartISO,
    paymentEndISO,
    numberOfWeeks,
    actorUid,
    actorName,
    payrollMode,
    grossAmount,
    netAmount,
    deductions,
    incomeTax,
    payrollContext,
}) {
    let taxExpenseRecordPointer = null;
    let taxIncomeRecordPointer = null;

    const taxExpenseRecordId = `payroll_salary_expense_${payslipId}`;
    const taxIncomeRecordId = `payroll_salary_income_${payslipId}`;
    const baseMeta = {
        paymentStartDate: paymentStartISO,
        paymentEndDate: paymentEndISO,
        numberOfWeeks,
        payrollMode,
        grossAmount,
        netAmount,
        deductions,
        ...(incomeTax ? { incomeTax } : {}),
    };

    if (grossAmount > 0 && payrollMode === "TOTAL") {
        const taxResult = stageTaxExpense(
            tx,
            classId,
            {
                amount: grossAmount,
                source: "payroll",
                expenseType: "salary",
                category: "salary",
                description: `급여 지출(세전) - ${studentName || "학생"} (${numberOfWeeks}주)`,
            },
            actorUid,
            {
                ...payrollContext,
                customId: taxExpenseRecordId,
                aggregateMeta: {
                    group: "payroll_salary",
                    batchKey: payslipId,
                    pageKey: "payroll",
                    actorUid,
                    actorName: actorName || null,
                    mode: "process_bulk_payroll",
                },
                detailLines: [
                    {
                        id: payslipId,
                        amount: grossAmount,
                        source: "payroll",
                        expenseType: "salary",
                        category: "salary",
                        description: `급여 지출(세전) - ${studentName || "학생"}`,
                        studentUid,
                        studentName: studentName || null,
                        relatedDoc: {
                            collection: "paySlips",
                            id: payslipId,
                        },
                        externalId: payslipId,
                        meta: baseMeta,
                    },
                ],
            },
        );

        if (!taxResult?.skipped && taxResult?.id) {
            taxExpenseRecordPointer = buildTaxRecordPointer(
                "taxExpenses",
                taxExpenseRecordId,
                payslipId,
            );
        }
    }

    if (deductions > 0 && (payrollMode === "TOTAL" || payrollMode === "TAX_ONLY")) {
        const taxResult = stageTaxIncome(
            tx,
            classId,
            {
                amount: deductions,
                source: "payroll",
                taxType: "income_tax",
                description: `급여 소득세 원천징수 - ${studentName || "학생"}`,
            },
            actorUid,
            {
                ...payrollContext,
                customId: taxIncomeRecordId,
                classData,
                sourceKey: "payrollSalary",
                aggregateMeta: {
                    group: "payroll_deduction",
                    batchKey: payslipId,
                    pageKey: "payroll",
                    actorUid,
                    actorName: actorName || null,
                    mode: "process_bulk_payroll",
                },
                detailLines: [
                    {
                        id: payslipId,
                        amount: deductions,
                        source: "payroll",
                        taxType: "income_tax",
                        description: `급여 소득세 원천징수 - ${studentName || "학생"}`,
                        studentUid,
                        studentName: studentName || null,
                        relatedDoc: {
                            collection: "paySlips",
                            id: payslipId,
                        },
                        externalId: payslipId,
                        meta: baseMeta,
                    },
                ],
            },
        );

        if (!taxResult?.skipped && taxResult?.id) {
            taxIncomeRecordPointer = buildTaxRecordPointer(
                "taxIncomes",
                taxIncomeRecordId,
                payslipId,
            );
        }
    }

    const taxRecords = {};
    if (taxExpenseRecordPointer) taxRecords.expense = taxExpenseRecordPointer;
    if (taxIncomeRecordPointer) taxRecords.income = taxIncomeRecordPointer;
    const primaryTaxRecordPointer =
        taxIncomeRecordPointer || taxExpenseRecordPointer || null;

    if (primaryTaxRecordPointer) {
        tx.set(
            payslipRef,
            {
                taxRecord: primaryTaxRecordPointer,
                taxRecords,
                taxRecordedAt: FieldValue.serverTimestamp(),
                taxCancelled: false,
            },
            { merge: true },
        );
    }
}

/* ??????????????????????????????????????????????????????????????
 * [EXPORTS] 1. 媛쒕퀎 諛??쇨큵 吏湲?
 * ?????????????????????????????????????????????????????????????? */

async function executePayrollBatch({
    classId,
    studentUids,
    paymentStartDate,
    numberOfWeeks = 1,
    actorUid,
    actorName = null,
    allowOverlapOverride = false,
    executionMode = "manual",
    automationRunId = null,
    globalConfig: providedGlobalConfig = null,
}) {
    const normalizedStudentUids = Array.from(new Set(
        (Array.isArray(studentUids) ? studentUids : [])
            .map((uid) => String(uid || "").trim())
            .filter(Boolean),
    ));
    const normalizedWeeks = Number(numberOfWeeks);
    if (!classId) throw new HttpsError("invalid-argument", "학급 정보가 필요합니다.");
    if (!paymentStartDate) {
        throw new HttpsError("invalid-argument", "급여 기간 시작일이 필요합니다.");
    }
    if (!Number.isInteger(normalizedWeeks) || normalizedWeeks < 1 || normalizedWeeks > 52) {
        throw new HttpsError("invalid-argument", "지급 주차가 올바르지 않습니다.");
    }

    const globalConfig = providedGlobalConfig || await getGlobalConfig();
    const results = [];
    for (const uid of normalizedStudentUids) {
        try {
            const res = await db.runTransaction(async (tx) => {
                return await processStudentUnifiedPayroll(tx, {
                    classId,
                    studentUid: uid,
                    paymentStartDate: new Date(paymentStartDate),
                    numberOfWeeks: normalizedWeeks,
                    actorUid,
                    actorName,
                    globalConfig,
                    allowOverlapOverride,
                    executionMode,
                    automationRunId,
                });
            });
            results.push({ studentUid: uid, ...res });
        } catch (error) {
            console.error("[executePayrollBatch] payroll failed", {
                classId,
                studentUid: uid,
                paymentStartDate,
                numberOfWeeks: normalizedWeeks,
                executionMode,
                automationRunId,
                message: error?.message || String(error),
                stack: error?.stack || null,
            });
            results.push({
                studentUid: uid,
                success: false,
                error: error?.message || "급여 지급에 실패했습니다.",
            });
        }
    }

    return { success: true, results };
}

exports.processBulkPayroll = onCall({ ...PAYROLL_OPTS, memory: "1GiB" }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");
    const {
        classId,
        studentUids = [],
        paymentStartDate,
        numberOfWeeks,
        allowOverlapOverride = false,
    } = request.data || {};

    const actorPermission = await mustBeTeacherOrTaxAdmin(classId, request.auth.uid, {
        requireSalaryPower: true,
    });
    const actorName = request.auth.token?.name || null;
    const canOverrideOverlappingPayroll =
        actorPermission?.isTeacher === true && allowOverlapOverride === true;

    return executePayrollBatch({
        classId,
        studentUids,
        paymentStartDate,
        numberOfWeeks,
        actorUid: request.auth.uid,
        actorName,
        allowOverlapOverride: canOverrideOverlappingPayroll,
        executionMode: "manual",
    });
});

exports.__private = {
    executePayrollBatch,
    processStudentUnifiedPayroll,
};
