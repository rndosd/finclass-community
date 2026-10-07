"use strict";

const CLASS_FUND_STOCK_CHANNEL = "stockInvestment";
const CLASS_FUND_ASSET_STATUS = "not_applicable";

const toAmount = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.max(0, amount) : 0;
};

const buildCommonRecord = ({
    fundId,
    fundName = "",
    fundType = "investment",
    actorUid,
    symbol,
    quantity,
    dateKey,
    tradeId,
    now,
}) => ({
    fundId,
    fundName,
    fundType,
    channel: CLASS_FUND_STOCK_CHANNEL,
    symbol,
    quantity: toAmount(quantity),
    dateKey,
    relatedTradeId: tradeId,
    createdBy: actorUid,
    usedAt: now,
    createdAt: now,
    updatedAt: now,
});

const buildClassFundStockBuyRecords = ({
    fundId,
    fundName,
    fundType,
    actorUid,
    symbol,
    quantity,
    grossInClassCurrency,
    feeInClassCurrency,
    exchangeFeeInClassCurrency = 0,
    totalInClassCurrency,
    balanceBefore,
    dateKey,
    tradeId,
    now,
}) => {
    const principalAmount = toAmount(grossInClassCurrency);
    const feeAmount = toAmount(feeInClassCurrency);
    const exchangeFeeAmount = toAmount(exchangeFeeInClassCurrency);
    const cashAmount = toAmount(totalInClassCurrency);
    const balanceAfter = toAmount(balanceBefore) - cashAmount;
    const common = buildCommonRecord({
        fundId,
        fundName,
        fundType,
        actorUid,
        symbol,
        quantity,
        dateKey,
        tradeId,
        now,
    });
    const description = `[주식 매수] ${symbol} ${quantity}주`;

    return {
        usage: {
            ...common,
            usageKind: "asset_purchase",
            direction: "out",
            amount: principalAmount,
            cashAmount,
            feeAmount,
            exchangeFeeAmount,
            totalFeeAmount: feeAmount + exchangeFeeAmount,
            description,
            balanceBefore: toAmount(balanceBefore),
            balanceAfter,
            settlementStatus: CLASS_FUND_ASSET_STATUS,
        },
        ledger: {
            ...common,
            type: "stock_buy",
            direction: "out",
            amount: cashAmount,
            principalAmount,
            feeAmount,
            exchangeFeeAmount,
            totalFeeAmount: feeAmount + exchangeFeeAmount,
            description,
            balanceBefore: toAmount(balanceBefore),
            balanceAfter,
        },
    };
};

const buildClassFundStockSellRecords = ({
    fundId,
    fundName,
    fundType,
    actorUid,
    symbol,
    quantity,
    grossInClassCurrency,
    feeInClassCurrency,
    exchangeFeeInClassCurrency = 0,
    netInClassCurrency,
    soldInvestmentInClassCurrency,
    realizedGainInClassCurrency,
    balanceBefore,
    dateKey,
    tradeId,
    now,
}) => {
    const grossAmount = toAmount(grossInClassCurrency);
    const feeAmount = toAmount(feeInClassCurrency);
    const exchangeFeeAmount = toAmount(exchangeFeeInClassCurrency);
    const cashAmount = toAmount(netInClassCurrency);
    const balanceAfter = toAmount(balanceBefore) + cashAmount;
    const common = buildCommonRecord({
        fundId,
        fundName,
        fundType,
        actorUid,
        symbol,
        quantity,
        dateKey,
        tradeId,
        now,
    });
    const description = `[주식 매도] ${symbol} ${quantity}주`;

    return {
        usage: {
            ...common,
            usageKind: "asset_sale",
            direction: "in",
            amount: cashAmount,
            grossAmount,
            feeAmount,
            exchangeFeeAmount,
            totalFeeAmount: feeAmount + exchangeFeeAmount,
            soldInvestmentInClassCurrency: toAmount(
                soldInvestmentInClassCurrency,
            ),
            realizedGainInClassCurrency: Number(realizedGainInClassCurrency) || 0,
            description,
            balanceBefore: toAmount(balanceBefore),
            balanceAfter,
            settlementStatus: CLASS_FUND_ASSET_STATUS,
        },
        ledger: {
            ...common,
            type: "stock_sell",
            direction: "in",
            amount: cashAmount,
            grossAmount,
            feeAmount,
            exchangeFeeAmount,
            totalFeeAmount: feeAmount + exchangeFeeAmount,
            soldInvestmentInClassCurrency: toAmount(
                soldInvestmentInClassCurrency,
            ),
            realizedGainInClassCurrency: Number(realizedGainInClassCurrency) || 0,
            description,
            balanceBefore: toAmount(balanceBefore),
            balanceAfter,
        },
    };
};

module.exports = {
    CLASS_FUND_ASSET_STATUS,
    CLASS_FUND_STOCK_CHANNEL,
    buildClassFundStockBuyRecords,
    buildClassFundStockSellRecords,
};
