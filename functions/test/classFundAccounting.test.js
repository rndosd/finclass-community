const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildClassFundSettlementId,
    getCommittedClassFundBudget,
    getCommittedClassFundBudgetTotal,
} = require("../utils/classFundAccounting");

test("keeps an investment allocation committed after a market loss or fee", () => {
    assert.equal(
        getCommittedClassFundBudget({
            fundType: "investment",
            allocatedFromTaxTotal: 1000,
            cashBalance: 100,
            investmentValue: 700,
            settledExpenseTotal: 0,
        }),
        1000,
    );
});

test("releases committed budget only when a fund expense is settled", () => {
    assert.equal(
        getCommittedClassFundBudget({
            allocatedFromTaxTotal: 1000,
            cashBalance: 600,
            pendingSettlementExpenseTotal: 100,
            settledExpenseTotal: 300,
        }),
        700,
    );
});

test("preserves a conservative balance fallback for legacy funds", () => {
    assert.equal(
        getCommittedClassFundBudget({
            fundType: "general",
            cashBalance: 600,
            pendingSettlementExpenseTotal: 100,
        }),
        700,
    );
});

test("keeps fund-owned real estate in the legacy public-value fallback", () => {
    assert.equal(
        getCommittedClassFundBudget({
            fundType: "general",
            cashBalance: 200,
            realEstateValue: 800,
        }),
        1000,
    );
});

test("sums committed budget across transfers without depending on current value", () => {
    assert.equal(
        getCommittedClassFundBudgetTotal([
            { allocatedFromTaxTotal: 1000, settledExpenseTotal: 0 },
            { allocatedFromTaxTotal: 0, settledExpenseTotal: 300 },
        ]),
        700,
    );
});

test("creates a different settlement id for another run on the same date", () => {
    assert.notEqual(
        buildClassFundSettlementId("fund-a", "2026-08-26", "run-1"),
        buildClassFundSettlementId("fund-a", "2026-08-26", "run-2"),
    );
});
