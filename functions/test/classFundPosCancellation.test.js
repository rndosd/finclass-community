"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildClassFundPosInventoryCancellation,
} = require("../utils/classFundPosCancellation");

test("removes only the acquisition belonging to the cancelled POS purchase", () => {
    const result = buildClassFundPosInventoryCancellation({
        purchaseId: "purchase-1",
        redemption: { quantity: 2, totalAmount: 200 },
        inventory: {
            quantity: 3,
            acquisitions: [
                {
                    purchaseId: "purchase-1",
                    quantity: 2,
                    unitValue: 100,
                    assetValueApplied: true,
                },
                { purchaseId: "purchase-2", quantity: 1, unitValue: 80 },
            ],
        },
    });

    assert.equal(result.nextQuantity, 1);
    assert.equal(result.itemValueToRemove, 200);
    assert.deepEqual(result.nextAcquisitions, [
        { purchaseId: "purchase-2", quantity: 1, unitValue: 80 },
    ]);
});

test("rejects a POS cancellation after its tracked acquisition was consumed", () => {
    assert.throws(() => buildClassFundPosInventoryCancellation({
        purchaseId: "purchase-1",
        redemption: { quantity: 2, totalAmount: 200 },
        inventory: {
            quantity: 2,
            acquisitions: [
                { purchaseId: "purchase-1", quantity: 1, unitValue: 100 },
                { purchaseId: "purchase-2", quantity: 1, unitValue: 80 },
            ],
        },
    }), /이미 사용/);
});

test("returns the linked ticket adjustment", () => {
    const result = buildClassFundPosInventoryCancellation({
        purchaseId: "ticket-purchase",
        redemption: {
            quantity: 3,
            totalAmount: 30,
            functionTag: "arcade_ticket",
        },
        inventory: {
            quantity: 3,
            acquisitions: [{
                purchaseId: "ticket-purchase",
                quantity: 3,
                unitValue: 10,
                assetValueApplied: true,
            }],
        },
    });
    assert.equal(result.ticketCountToRemove, 3);
});
