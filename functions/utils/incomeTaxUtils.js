"use strict";

const clampRate = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(100, parsed);
};

const toMoney = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.round(parsed));
};

const clonePlainObject = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return JSON.parse(JSON.stringify(value));
};

const buildIncomeTaxSnapshot = ({
    sourceKey,
    grossAmount,
    policy = {},
    incomeGroup = "general",
    treatment = "withholding",
    exemptAmount = 0,
    withheldAmount: explicitWithheldAmount = null,
    policySnapshot = null,
} = {}) => {
    const normalizedGrossAmount = toMoney(grossAmount);
    const normalizedExemptAmount = Math.min(normalizedGrossAmount, toMoney(exemptAmount));
    const taxableAmount = Math.max(0, normalizedGrossAmount - normalizedExemptAmount);
    const taxRate = policy?.enabled === true ? clampRate(policy?.taxRate) : 0;
    const withheldAmount = explicitWithheldAmount == null
        ? Math.min(
            taxableAmount,
            taxRate > 0 ? Math.round(taxableAmount * (taxRate / 100)) : 0,
        )
        : Math.min(taxableAmount, toMoney(explicitWithheldAmount));
    const netAmount = Math.max(0, normalizedGrossAmount - withheldAmount);

    return {
        grossAmount: normalizedGrossAmount,
        taxableAmount,
        exemptAmount: normalizedExemptAmount,
        withheldAmount,
        netAmount,
        incomeTax: {
            version: 1,
            sourceKey,
            incomeGroup,
            treatment,
            grossAmount: normalizedGrossAmount,
            taxableAmount,
            exemptAmount: normalizedExemptAmount,
            withheldAmount,
            netAmount,
            taxRate,
            monthEndSettlementEnabled:
                policy?.monthEndSettlementEnabled !== false,
            policySnapshot: policySnapshot || clonePlainObject(policy),
        },
    };
};

module.exports = {
    buildIncomeTaxSnapshot,
    clampRate,
    toMoney,
};
