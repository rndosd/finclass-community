"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildClassFundStockCancellationAccounting,
    normalizeClassFundStockSymbol,
} = require("../utils/classFundStockCancellation");

test("normalizes the linked stock symbol used by cancellation", () => {
    assert.equal(normalizeClassFundStockSymbol(" msft "), "MSFT");
    assert.equal(normalizeClassFundStockSymbol(null), "");
});

test("reverses a class fund stock buy including its fee", () => {
    assert.deepEqual(buildClassFundStockCancellationAccounting({
        type: "CLASS_FUND_STOCK_BUY",
        grossInClassCurrency: 500,
        feeInClassCurrency: 1,
        totalInClassCurrency: 501,
        feeUSD: 0.1,
    }), {
        action: "buy_cancel",
        cashDelta: 501,
        investmentValueDelta: -500,
        totalValueDelta: 1,
        investedTotalDelta: -500,
        tradeFeeTotalDelta: -1,
        tradeFeeTotalUSDDelta: -0.1,
        exchangeFeeTotalDelta: 0,
        exchangeFeeTotalUSDDelta: 0,
        realizedGainDelta: 0,
        realizedLossDelta: 0,
    });
});

test("reverses both trading and exchange fees for a class fund buy", () => {
    const result = buildClassFundStockCancellationAccounting({
        type: "CLASS_FUND_STOCK_BUY",
        grossInClassCurrency: 500,
        feeInClassCurrency: 1,
        exchangeFeeInClassCurrency: 5.06,
        totalInClassCurrency: 506.06,
        feeUSD: 0.1,
        exchangeFeeUSD: 0.506,
    });

    assert.equal(result.cashDelta, 506.06);
    assert.equal(result.totalValueDelta, 6.06);
    assert.equal(result.exchangeFeeTotalDelta, -5.06);
    assert.equal(result.exchangeFeeTotalUSDDelta, -0.506);
});

test("reverses a profitable class fund stock sale", () => {
    const result = buildClassFundStockCancellationAccounting({
        type: "CLASS_FUND_STOCK_SELL",
        netInClassCurrency: 550,
        soldInvestmentInClassCurrency: 500,
        realizedGainInClassCurrency: 50,
        feeInClassCurrency: 1,
        feeUSD: 0.1,
    });
    assert.equal(result.cashDelta, -550);
    assert.equal(result.investmentValueDelta, 500);
    assert.equal(result.totalValueDelta, -50);
    assert.equal(result.realizedGainDelta, -50);
});

test("reverses a class fund stock sale loss", () => {
    const result = buildClassFundStockCancellationAccounting({
        type: "CLASS_FUND_STOCK_SELL",
        netInClassCurrency: 450,
        soldInvestmentInClassCurrency: 500,
        realizedGainInClassCurrency: -50,
    });
    assert.equal(result.totalValueDelta, 50);
    assert.equal(result.realizedLossDelta, -50);
});
