const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildClassFundBuyExchangePayment,
    buildClassFundSellExchangePayment,
    buildStudentAutoExchangeBuyPayment,
} = require("../utils/stockAutoExchange");

test("uses FIN first and automatically exchanges only the shortage", () => {
    const payment = buildStudentAutoExchangeBuyPayment({
        totalUSD: 120,
        usdBalance: 20,
        cashBalance: 20,
        conversionRate: 10,
        exchangeFeeRate: 0.01,
        enabled: true,
    });

    assert.equal(payment.canAfford, true);
    assert.equal(payment.usdUsed, 20);
    assert.equal(payment.autoExchangeUSD, 100);
    assert.equal(payment.autoExchangeSourceAmount, 10.1011);
    assert.equal(payment.autoExchangeFeeInClassCurrency, 0.101);
});

test("does not spend class currency when automatic exchange is disabled", () => {
    const payment = buildStudentAutoExchangeBuyPayment({
        totalUSD: 120,
        usdBalance: 20,
        cashBalance: 20,
        conversionRate: 10,
        exchangeFeeRate: 0.01,
        enabled: false,
    });

    assert.equal(payment.canAfford, false);
    assert.equal(payment.autoExchangeApplied, false);
    assert.equal(payment.autoExchangeSourceAmount, 0);
});

test("rejects the payment when class currency cannot cover exchange and fee", () => {
    const payment = buildStudentAutoExchangeBuyPayment({
        totalUSD: 100,
        usdBalance: 0,
        cashBalance: 10,
        conversionRate: 10,
        exchangeFeeRate: 0.01,
        enabled: true,
    });

    assert.equal(payment.canAfford, false);
    assert.equal(payment.autoExchangeSourceAmount, 10.1011);
});

test("charges the configured exchange fee on a class fund buy", () => {
    const payment = buildClassFundBuyExchangePayment({
        totalUSD: 100,
        conversionRate: 10,
        exchangeFeeRate: 0.01,
    });

    assert.deepEqual(payment, {
        settlementInClassCurrency: 10,
        sourceAmount: 10.1011,
        feeInClassCurrency: 0.1011,
        feeUSD: 1.011,
    });
});

test("charges the configured exchange fee before crediting a class fund sale", () => {
    const payment = buildClassFundSellExchangePayment({
        sourceUSD: 100,
        conversionRate: 10,
        exchangeFeeRate: 0.01,
    });

    assert.deepEqual(payment, {
        sourceUSD: 100,
        feeUSD: 1,
        feeInClassCurrency: 0.1,
        netUSD: 99,
        netInClassCurrency: 9.9,
    });
});
