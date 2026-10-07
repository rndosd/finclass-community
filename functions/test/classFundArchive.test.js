"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    getClassFundArchivePlan,
} = require("../utils/classFundArchive");

test("allows archiving a cash-only fund and preserves its remaining commitment", () => {
    assert.deepEqual(
        getClassFundArchivePlan({
            cashBalance: 700,
            allocatedFromTaxTotal: 1000,
            settledExpenseTotal: 300,
        }),
        {
            canArchive: true,
            blockers: [],
            cashAmount: 700,
            committedBudget: 700,
            investmentValue: 0,
            realEstateValue: 0,
            pendingSettlementExpenseTotal: 0,
            settledExpenseTotal: 300,
        },
    );
});

test("blocks archiving until investments and pending expenses are cleared", () => {
    const plan = getClassFundArchivePlan({
        cashBalance: 100,
        investmentValue: 30,
        realEstateValue: 50,
        pendingSettlementExpenseTotal: 20,
    });

    assert.equal(plan.canArchive, false);
    assert.deepEqual(plan.blockers, ["stock", "realEstate", "pendingSettlement"]);
});

test("never produces a negative remaining commitment", () => {
    const plan = getClassFundArchivePlan({
        cashBalance: 0,
        allocatedFromTaxTotal: 100,
        settledExpenseTotal: 150,
    });

    assert.equal(plan.committedBudget, 0);
    assert.equal(plan.settledExpenseTotal, 150);
});

test("treats a legacy fund cash balance as committed budget", () => {
    const plan = getClassFundArchivePlan({ cashBalance: 420 });

    assert.equal(plan.canArchive, true);
    assert.equal(plan.committedBudget, 420);
});
