"use strict";

const CLASS_FUND_OWNER_TYPE = "classFund";
const CLASS_FUND_OWNER_PREFIX = "CLASS_FUND:";
const CLASS_FUND_TAX_INCOME_RECORDING_OPTIONS = Object.freeze({
    skipFeatureGate: true,
    skipPeriodSettlement: true,
});
const CLASS_FUND_TAX_EXPENSE_RECORDING_OPTIONS = Object.freeze({
    skipFeatureGate: true,
});

const toAmount = (value) => {
    const amount = Math.floor(Number(value));
    return Number.isFinite(amount) ? Math.max(0, amount) : 0;
};

const getClassFundOwnerId = (fundId) =>
    `${CLASS_FUND_OWNER_PREFIX}${String(fundId || "").trim()}`;

const isClassFundOwnedDesk = (desk, fundId = "") => {
    if (desk?.ownerType !== CLASS_FUND_OWNER_TYPE || !desk?.ownerFundId) {
        return false;
    }
    return !fundId || String(desk.ownerFundId) === String(fundId);
};

const getClassFundPropertyPrice = (desk = {}) =>
    toAmount(desk.lastPurchasePrice || desk.price);

const buildClassFundPurchaseQuote = (desk = {}, config = {}) => {
    const price = getClassFundPropertyPrice(desk);
    const acquisitionTaxRate = config.acquisitionTaxEnabled === false ?
        0 :
        Math.max(0, Number(config.acquisitionTaxRate || 0));
    const acquisitionTax = Math.floor(price * (acquisitionTaxRate / 100));

    return {
        price,
        acquisitionTax,
        totalCost: price + acquisitionTax,
        carryingValue: price,
    };
};

const buildClassFundSaleQuote = (desk = {}, config = {}) => {
    const salePrice = getClassFundPropertyPrice(desk);
    const carryingValue = toAmount(
        desk.fundAcquisitionPrice || desk.lastPurchasePrice || desk.price,
    );
    const taxableGain = Math.max(0, salePrice - carryingValue);
    const capitalGainsTaxRate = config.capitalGainsTaxEnabled === false ?
        0 :
        Math.max(0, Number(config.capitalGainsTaxRate || 0));
    const capitalGainsTax = Math.floor(
        taxableGain * (capitalGainsTaxRate / 100),
    );

    return {
        salePrice,
        carryingValue,
        capitalGainsTax,
        netProceeds: salePrice - capitalGainsTax,
        realizedChange: salePrice - capitalGainsTax - carryingValue,
    };
};

const buildClassFundPurchaseAccounting = (quote = {}) => ({
    cashDelta: -toAmount(quote.totalCost),
    realEstateValueDelta: toAmount(quote.carryingValue),
    realEstateCountDelta: 1,
    realEstatePurchaseTotalDelta: toAmount(quote.price),
    spentTotalDelta: toAmount(quote.acquisitionTax),
    settledExpenseTotalDelta: toAmount(quote.acquisitionTax),
    totalValueDelta: -toAmount(quote.acquisitionTax),
});

const buildClassFundSaleAccounting = (quote = {}) => {
    const realizedChange = Math.floor(Number(quote.realizedChange || 0));
    return {
        cashDelta: toAmount(quote.netProceeds),
        realEstateValueDelta: -toAmount(quote.carryingValue),
        realEstateCountDelta: -1,
        realEstateSaleTotalDelta: toAmount(quote.salePrice),
        totalValueDelta: Number.isFinite(realizedChange) ? realizedChange : 0,
        realizedGainDelta: Math.max(0, realizedChange),
        realizedLossDelta: Math.max(0, -realizedChange),
    };
};

module.exports = {
    CLASS_FUND_OWNER_TYPE,
    CLASS_FUND_TAX_EXPENSE_RECORDING_OPTIONS,
    CLASS_FUND_TAX_INCOME_RECORDING_OPTIONS,
    buildClassFundPurchaseAccounting,
    buildClassFundPurchaseQuote,
    buildClassFundSaleAccounting,
    buildClassFundSaleQuote,
    getClassFundOwnerId,
    getClassFundPropertyPrice,
    isClassFundOwnedDesk,
};
