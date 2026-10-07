"use strict";

const toNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

const normalizeClassFundStockSymbol = (value) =>
    String(value || "").trim().toUpperCase();

const negateAmount = (value) => {
    const amount = toNumber(value);
    return amount === 0 ? 0 : -amount;
};

const buildClassFundStockCancellationAccounting = (trade = {}) => {
    if (trade.type === "CLASS_FUND_STOCK_BUY") {
        return {
            action: "buy_cancel",
            cashDelta: toNumber(trade.totalInClassCurrency),
            investmentValueDelta: -toNumber(trade.grossInClassCurrency),
            totalValueDelta:
                toNumber(trade.feeInClassCurrency) +
                toNumber(trade.exchangeFeeInClassCurrency),
            investedTotalDelta: -toNumber(trade.grossInClassCurrency),
            tradeFeeTotalDelta: -toNumber(trade.feeInClassCurrency),
            tradeFeeTotalUSDDelta: -toNumber(trade.feeUSD),
            exchangeFeeTotalDelta: negateAmount(
                trade.exchangeFeeInClassCurrency,
            ),
            exchangeFeeTotalUSDDelta: negateAmount(trade.exchangeFeeUSD),
            realizedGainDelta: 0,
            realizedLossDelta: 0,
        };
    }
    if (trade.type === "CLASS_FUND_STOCK_SELL") {
        const realizedGain = toNumber(trade.realizedGainInClassCurrency);
        return {
            action: "sell_cancel",
            cashDelta: -toNumber(trade.netInClassCurrency),
            investmentValueDelta: toNumber(
                trade.soldInvestmentInClassCurrency,
            ),
            totalValueDelta: -realizedGain,
            investedTotalDelta: 0,
            tradeFeeTotalDelta: -toNumber(trade.feeInClassCurrency),
            tradeFeeTotalUSDDelta: -toNumber(trade.feeUSD),
            exchangeFeeTotalDelta: negateAmount(
                trade.exchangeFeeInClassCurrency,
            ),
            exchangeFeeTotalUSDDelta: negateAmount(trade.exchangeFeeUSD),
            realizedGainDelta: -Math.max(0, realizedGain),
            realizedLossDelta: -Math.max(0, -realizedGain),
        };
    }
    throw new Error("지원하지 않는 기금 주식 거래입니다.");
};

module.exports = {
    buildClassFundStockCancellationAccounting,
    normalizeClassFundStockSymbol,
};
