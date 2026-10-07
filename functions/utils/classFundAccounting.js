"use strict";

const toMoneyAmount = (value) => {
    const amount = Math.round(Number(value));
    return Number.isFinite(amount) ? amount : 0;
};

const getFundPublicValue = (fund = {}) => {
    const cashBalance = toMoneyAmount(fund.cashBalance);
    const realEstateValue = toMoneyAmount(fund.realEstateValue);
    if (fund.fundType === "investment") {
        return cashBalance +
            toMoneyAmount(fund.investmentValue) +
            realEstateValue;
    }
    return cashBalance +
        toMoneyAmount(fund.pendingSettlementExpenseTotal) +
        realEstateValue;
};

const getCommittedClassFundBudget = (fund = {}) => {
    if (!Object.prototype.hasOwnProperty.call(fund, "allocatedFromTaxTotal")) {
        return getFundPublicValue(fund);
    }

    return (
        toMoneyAmount(fund.allocatedFromTaxTotal) -
    toMoneyAmount(fund.settledExpenseTotal)
    );
};

const getCommittedClassFundBudgetTotal = (funds = []) =>
    funds.reduce((sum, fund) => sum + getCommittedClassFundBudget(fund), 0);

const buildClassFundSettlementId = (fundId, dateKey, runId) =>
    `${fundId}_${dateKey}_${runId}`
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 180);

module.exports = {
    buildClassFundSettlementId,
    getCommittedClassFundBudget,
    getCommittedClassFundBudgetTotal,
};
