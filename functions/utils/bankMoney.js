"use strict";

const BANK_MONEY_FRACTION_DIGITS = 2;

function toSafeNumber(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
}

function getSpendableBankBalance(assets = {}, currencyField = "cash") {
    assets = assets || {};
    const reserved = assets.reserved && typeof assets.reserved === "object"
        ? assets.reserved[currencyField]
        : assets.reserved;
    const auctionHold = currencyField === "cash" ? assets.auctionHold : 0;
    return toSafeNumber(assets[currencyField]) -
        Math.max(0, toSafeNumber(reserved)) -
        Math.max(0, toSafeNumber(auctionHold));
}

function roundBankMoney(value, fractionDigits = BANK_MONEY_FRACTION_DIGITS) {
    const numericValue = toSafeNumber(value, 0);
    const safeFractionDigits = Math.max(0, Number(fractionDigits) || 0);
    const factor = 10 ** safeFractionDigits;
    const adjusted =
        numericValue >= 0
            ? numericValue + Number.EPSILON
            : numericValue - Number.EPSILON;
    const rounded = Math.round(adjusted * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
}

function calculatePeriodRateAdjustment(weeklyModifier, productDays) {
    const rawAdjustment =
        (toSafeNumber(weeklyModifier) / 7) * toSafeNumber(productDays);
    return roundBankMoney(rawAdjustment, 2);
}

function resolveTierRateModifier(useTierRateAdjustment, weeklyModifier) {
    return useTierRateAdjustment === false ? 0 : toSafeNumber(weeklyModifier);
}

function calculateSavingInterest(principal, ratePercentage) {
    return Math.max(
        0,
        roundBankMoney(
            toSafeNumber(principal) * (toSafeNumber(ratePercentage) / 100),
        ),
    );
}

function calculateInterestTax(baseAmount, taxRatePercentage) {
    const grossAmount = Math.max(0, toSafeNumber(baseAmount));
    const calculatedTax = Math.max(
        0,
        roundBankMoney(
            grossAmount * (toSafeNumber(taxRatePercentage) / 100),
        ),
    );

    return roundBankMoney(Math.min(grossAmount, calculatedTax));
}

module.exports = {
    BANK_MONEY_FRACTION_DIGITS,
    toSafeNumber,
    getSpendableBankBalance,
    roundBankMoney,
    calculatePeriodRateAdjustment,
    resolveTierRateModifier,
    calculateSavingInterest,
    calculateInterestTax,
};
