"use strict";

const toAmount = (value) => {
    const amount = Math.floor(Number(value));
    return Number.isFinite(amount) ? Math.max(0, amount) : 0;
};

const buildClassFundRealEstateCancellationAccounting = ({
    trade = {},
    fundLedger = {},
}) => {
    if (trade.type === "class_fund_purchase") {
        const price = toAmount(trade.tradePrice || trade.amount);
        const tax = toAmount(trade.acquisitionTax);
        const totalCost = toAmount(trade.buyerTotalCost || price + tax);
        return {
            action: "purchase_cancel",
            cashDelta: totalCost,
            realEstateValueDelta: -price,
            realEstateCountDelta: -1,
            realEstatePurchaseTotalDelta: -price,
            spentTotalDelta: -tax,
            settledExpenseTotalDelta: -tax,
            totalValueDelta: tax,
            cashAmount: totalCost,
            carryingValue: price,
            realizedGainDelta: 0,
            realizedLossDelta: 0,
        };
    }
    if (trade.type === "class_fund_sale") {
        const grossAmount = toAmount(trade.tradePrice || trade.amount);
        const tax = toAmount(trade.capitalGainsTax);
        const netAmount = toAmount(trade.sellerNetIncome || grossAmount - tax);
        const carryingValue = toAmount(fundLedger.assetValueRemoved);
        if (!carryingValue) {
            throw new Error("매각 전 장부가액을 확인할 수 없습니다.");
        }
        const realizedChange = netAmount - carryingValue;
        return {
            action: "sale_cancel",
            cashDelta: -netAmount,
            realEstateValueDelta: carryingValue,
            realEstateCountDelta: 1,
            realEstateSaleTotalDelta: -grossAmount,
            spentTotalDelta: 0,
            settledExpenseTotalDelta: 0,
            totalValueDelta: -realizedChange,
            cashAmount: netAmount,
            carryingValue,
            realizedGainDelta: -Math.max(0, realizedChange),
            realizedLossDelta: -Math.max(0, -realizedChange),
        };
    }
    throw new Error("지원하지 않는 기금 부동산 거래입니다.");
};

module.exports = { buildClassFundRealEstateCancellationAccounting };
