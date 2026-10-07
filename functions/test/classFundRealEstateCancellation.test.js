"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildClassFundRealEstateCancellationAccounting,
} = require("../utils/classFundRealEstateCancellation");

test("reverses a class fund real-estate purchase including acquisition tax", () => {
    assert.deepEqual(buildClassFundRealEstateCancellationAccounting({
        trade: {
            type: "class_fund_purchase",
            tradePrice: 500,
            acquisitionTax: 25,
            buyerTotalCost: 525,
        },
    }), {
        action: "purchase_cancel",
        cashDelta: 525,
        realEstateValueDelta: -500,
        realEstateCountDelta: -1,
        realEstatePurchaseTotalDelta: -500,
        spentTotalDelta: -25,
        settledExpenseTotalDelta: -25,
        totalValueDelta: 25,
        cashAmount: 525,
        carryingValue: 500,
        realizedGainDelta: 0,
        realizedLossDelta: 0,
    });
});

test("reverses a profitable real-estate sale", () => {
    const result = buildClassFundRealEstateCancellationAccounting({
        trade: {
            type: "class_fund_sale",
            tradePrice: 600,
            capitalGainsTax: 10,
            sellerNetIncome: 590,
        },
        fundLedger: { assetValueRemoved: 500 },
    });
    assert.equal(result.cashDelta, -590);
    assert.equal(result.realEstateValueDelta, 500);
    assert.equal(result.totalValueDelta, -90);
    assert.equal(result.realizedGainDelta, -90);
});

test("requires the original carrying value to reverse a sale", () => {
    assert.throws(() => buildClassFundRealEstateCancellationAccounting({
        trade: { type: "class_fund_sale", tradePrice: 600, sellerNetIncome: 590 },
        fundLedger: {},
    }), /장부가액/);
});
