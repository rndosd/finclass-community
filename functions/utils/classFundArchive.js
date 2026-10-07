"use strict";

const toMoneyAmount = (value) => {
    const amount = Math.round(Number(value));
    return Number.isFinite(amount) ? amount : 0;
};

const getClassFundArchivePlan = (fund = {}) => {
    const cashAmount = Math.max(0, toMoneyAmount(fund.cashBalance));
    const investmentValue = Math.max(0, toMoneyAmount(fund.investmentValue));
    const realEstateValue = Math.max(0, toMoneyAmount(fund.realEstateValue));
    const pendingSettlementExpenseTotal = Math.max(
        0,
        toMoneyAmount(fund.pendingSettlementExpenseTotal),
    );
    const settledExpenseTotal = Math.max(
        0,
        toMoneyAmount(fund.settledExpenseTotal),
    );
    const hasAllocationTotal = Object.prototype.hasOwnProperty.call(
        fund,
        "allocatedFromTaxTotal",
    );
    const allocatedFromTaxTotal = Math.max(
        settledExpenseTotal,
        toMoneyAmount(fund.allocatedFromTaxTotal),
    );
    const committedBudget = hasAllocationTotal
        ? Math.max(0, allocatedFromTaxTotal - settledExpenseTotal)
        : cashAmount + pendingSettlementExpenseTotal;
    const blockers = [];

    if (investmentValue > 0) blockers.push("stock");
    if (realEstateValue > 0) blockers.push("realEstate");
    if (pendingSettlementExpenseTotal > 0) blockers.push("pendingSettlement");

    return {
        canArchive: blockers.length === 0,
        blockers,
        cashAmount,
        committedBudget,
        investmentValue,
        realEstateValue,
        pendingSettlementExpenseTotal,
        settledExpenseTotal,
    };
};

module.exports = { getClassFundArchivePlan };
