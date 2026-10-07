"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("../firebaseAdminCompat");

if (admin.apps.length === 0) {
    admin.initializeApp({ projectId: "demo-finclass" });
}

const { stageTaxIncome } = require("../utils/taxIncome");
const { INITIAL_PLAN_FEATURES } = require("../utils/planManager");

test("donation to tax transfer records income immediately during period settlement", () => {
    const writes = [];
    const config = structuredClone(INITIAL_PLAN_FEATURES);
    config.FREE.pages.tax.accessible = true;
    config.FREE.pages.labor.accessible = false;
    const result = stageTaxIncome({
        set: (...args) => writes.push(args),
    }, "class-1", {
        amount: 100,
        source: "donation_transfer",
        taxType: "donation_transfer",
    }, "teacher-1", {
        config,
        planType: "FREE",
        serviceName: "tax",
        skipPeriodSettlement: true,
        classData: {
            taxPolicy: {
                periodIncomeSettlement: {
                    enabled: true,
                    activationDateKey: "2026-07-11",
                    sourceKeys: [],
                },
            },
        },
        sourceKey: "donationTransfer",
        occurredAt: new Date("2026-07-21T00:00:00+09:00"),
        customId: "donation_transfer_1",
    });

    assert.equal(result.skipped, undefined);
    assert.equal(writes.length, 1);
});
