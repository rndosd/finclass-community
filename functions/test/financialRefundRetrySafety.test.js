"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");

async function fixture() {
    const h = createCallableHarness({
        "classes/class-a": { currencyUnit: "unit", taxPolicy: { treasury: { store: { mode: "TAX_ONLY" } } } },
        "classes/class-a/students/student-a": { role: "student", name: "Synthetic", assets: { cash: 100, itemValue: 0 } },
        "classes/class-a/students/teacher-a": { role: "teacher" },
        "classes/class-a/storeItems/item-a": { name: "Synthetic", price: 10, stock: 10 },
    });
    const store = h.load("functions/src/store.js");
    const auth = { uid: "student-a", token: { role: "student", classId: "class-a" } };
    const teacher = { uid: "teacher-a", token: { role: "teacher", classId: "class-a" } };
    const purchase = await store.purchaseStoreItem({ auth, data: { classId: "class-a", itemId: "item-a", quantity: 1 } });
    const data = { classId: "class-a", studentUid: "student-a", purchaseId: purchase.purchaseId };
    return { h, store, auth, teacher, data };
}

test("single refund response-loss retry reports success with no additional balance, ledger or tax writes", async () => {
    const { h, store, teacher, data } = await fixture();
    await store.cancelStorePurchase({ auth: teacher, data });
    const writes = h.writes.length;
    const retried = await store.cancelStorePurchase({ auth: teacher, data });
    assert.equal(retried.success, true);
    assert.equal(retried.alreadyCancelled, true);
    assert.equal(h.writes.length, writes);
    assert.equal(h.data.get("classes/class-a/students/student-a").assets.cash, 100);
    assert.equal([...h.data.keys()].filter(path => path.startsWith("classes/class-a/taxExpenses/store_refund_")).length, 1);
});

test("bulk refund retry is a successful no-op rather than an overall failure", async () => {
    const { h, store, teacher, data } = await fixture();
    const request = { auth: teacher, data: { classId: data.classId, requestId: "synthetic-refund", purchases: [{ studentUid: data.studentUid, purchaseId: data.purchaseId }] } };
    assert.equal((await store.bulkCancelStorePurchases(request)).allSucceeded, true);
    const writes = h.writes.length;
    const retry = await store.bulkCancelStorePurchases(request);
    assert.equal(retry.allSucceeded, true);
    assert.equal(retry.failedCount, 0);
    assert.equal(retry.successCount, 1);
    assert.equal(h.writes.length, writes);
});

test("cancelled purchase retries still reject unauthorized callers and incorrect student ownership", async () => {
    const { h, store, auth, teacher, data } = await fixture();
    await store.cancelStorePurchase({ auth: teacher, data });
    const writes = h.writes.length;
    await assert.rejects(store.cancelStorePurchase({ auth, data }), { code: "permission-denied" });
    await assert.rejects(store.cancelStorePurchase({ auth: teacher, data: { ...data, studentUid: "wrong-synthetic-student" } }));
    assert.equal(h.writes.length, writes);
});
