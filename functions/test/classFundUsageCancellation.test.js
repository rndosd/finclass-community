"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildClassFundUsageCancellationAccounting,
    getClassFundUsageCancellationPolicy,
} = require("../utils/classFundUsageCancellation");

test("allows a settled cash expense and reverses its accounting", () => {
    const usage = { amount: 120, settlementStatus: "settled", direction: "out" };
    assert.deepEqual(getClassFundUsageCancellationPolicy(usage), {
        allowed: true,
        kind: "cash_expense",
    });
    assert.deepEqual(buildClassFundUsageCancellationAccounting(usage), {
        cashDelta: 120,
        spentTotalDelta: -120,
        settledExpenseTotalDelta: -120,
        pendingSettlementExpenseTotalDelta: 0,
        totalValueDelta: 120,
    });
});

test("allows a linked bank payout but blocks asset and POS records", () => {
    assert.equal(getClassFundUsageCancellationPolicy({
        amount: 200,
        direction: "out",
        relatedPayoutId: "payout-1",
    }).kind, "bank_payout");
    assert.equal(getClassFundUsageCancellationPolicy({
        amount: 200,
        direction: "out",
        source: "store_pos",
    }).allowed, false);
    assert.equal(getClassFundUsageCancellationPolicy({
        amount: 200,
        direction: "out",
        usageKind: "asset_purchase",
    }).allowed, false);
});

test("blocks duplicate cancellation and reversal rows", () => {
    assert.equal(getClassFundUsageCancellationPolicy({
        amount: 100,
        cancellationStatus: "cancelled",
    }).allowed, false);
    assert.equal(getClassFundUsageCancellationPolicy({
        amount: 100,
        reversalOfUsageId: "usage-1",
    }).allowed, false);
    assert.equal(getClassFundUsageCancellationPolicy({
        amount: 100,
        settlementId: "shared-daily-settlement",
    }).allowed, false);
});
