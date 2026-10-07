"use strict";

const MAX_PENSION_RATE = 50;
const MAX_STUDENT_SETTINGS = 100;

const clampRate = (value) => {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate <= 0) return 0;
    return Math.min(MAX_PENSION_RATE, Math.round(rate * 100) / 100);
};

const normalizePensionSettings = (raw = {}) => {
    const source = raw && typeof raw === "object" ? raw : {};
    const rateOverrides = Object.fromEntries(
        Object.entries(source.rateOverrides || {})
            .slice(0, MAX_STUDENT_SETTINGS)
            .map(([uid, rate]) => [String(uid || "").trim(), clampRate(rate)])
            .filter(([uid]) => Boolean(uid)),
    );
    const excludedStudentUids = Array.from(new Set(
        (Array.isArray(source.excludedStudentUids) ? source.excludedStudentUids : [])
            .map((uid) => String(uid || "").trim())
            .filter(Boolean),
    )).slice(0, MAX_STUDENT_SETTINGS);

    return {
        enabled: source.enabled === true,
        defaultContributionRate: clampRate(source.defaultContributionRate),
        rateOverrides,
        excludedStudentUids,
    };
};

const getStudentPensionRate = (settings = {}, studentUid = "") => {
    const normalized = normalizePensionSettings(settings);
    const uid = String(studentUid || "").trim();
    if (!normalized.enabled || !uid) return 0;
    if (normalized.excludedStudentUids.includes(uid)) return 0;
    if (Object.prototype.hasOwnProperty.call(normalized.rateOverrides, uid)) {
        return normalized.rateOverrides[uid];
    }
    return normalized.defaultContributionRate;
};

const calculatePayrollPensionContribution = ({
    baseSalary = 0,
    netSalaryBeforePension = 0,
    settings = {},
    studentUid = "",
} = {}) => {
    const rate = getStudentPensionRate(settings, studentUid);
    const normalizedBaseSalary = Math.max(0, Math.round(Number(baseSalary) || 0));
    const availableNetSalary = Math.max(
        0,
        Math.round(Number(netSalaryBeforePension) || 0),
    );
    const requestedAmount = Math.max(
        0,
        Math.round(normalizedBaseSalary * (rate / 100)),
    );
    const amount = Math.min(requestedAmount, availableNetSalary);

    return {
        rate,
        baseSalary: normalizedBaseSalary,
        requestedAmount,
        amount,
        cappedByNetSalary: amount < requestedAmount,
    };
};

module.exports = {
    MAX_PENSION_RATE,
    calculatePayrollPensionContribution,
    getStudentPensionRate,
    normalizePensionSettings,
};
