"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");
const studentPath = "classes/class-a/students/student-a";
const seed = () => ({ "classes/class-a": {}, [studentPath]: { role: "student", assets: { cash: 100 } } });
const auth = { uid: "student-a", token: { role: "student", classId: "class-a" } };
const handlers = { bank: "transferMoney", store: "purchaseStoreItem", stock: "performStockBuy", donation: "makeDonation", funds: "submitFundOrder", jobBoard: "payJobBoardReward", payroll: "processBulkPayroll" };
for (const [name, handler] of Object.entries(handlers)) {
    test(`${name} real callable refuses requests while class maintenance is active`, async () => {
        const records = seed(); records["classMaintenance/class-a"] = { active: true };
        const h = createCallableHarness(records), module = h.load(`functions/src/${name}.js`);
        await assert.rejects(module[handler]({ auth, data: { classId: "class-a" } }), { code: "failed-precondition" });
        assert.equal(h.writes.length, 0);
    });
}
test("maintenance beginning after initial callable check still blocks the store transaction", async () => {
    const records = seed(); records["classes/class-a/storeItems/item-a"] = { name: "Synthetic", price: 10, stock: 10 };
    const h = createCallableHarness(records), store = h.load("functions/src/store.js");
    const original = h.db.runTransaction;
    h.db.runTransaction = (...args) => { h.data.set("classMaintenance/class-a", { active: true }); return original(...args); };
    await assert.rejects(store.purchaseStoreItem({ auth, data: { classId: "class-a", itemId: "item-a", quantity: 1 } }), { code: "failed-precondition" });
    assert.equal(h.data.get(studentPath).assets.cash, 100);
    assert.equal(h.writes.length, 0);
});
test("transactions and batches isolate classes and reject pre-reset work after completion", async () => {
    const records = seed(); records["classMaintenance/class-a"] = { active: true };
    records["classes/class-b/students/student-b"] = { assets: { cash: 100 } };
    const h = createCallableHarness(records);
    const { createMaintenanceDb } = h.load("functions/utils/maintenanceDb.js");
    const { context } = h.load("functions/utils/classMaintenanceContext.js");
    const db = createMaintenanceDb(h.db);
    const batch = db.batch(); batch.update(db.doc("classes/class-b/students/student-b"), { "assets.cash": 110 });
    await batch.commit(); assert.equal(h.data.get("classes/class-b/students/student-b").assets.cash, 110);
    h.data.set("classMaintenance/class-a", { active: false, invalidBefore: 200 });
    await assert.rejects(context.run({ startedAt: 100 }, () => db.runTransaction(async tx => {
        await tx.get(db.doc(studentPath)); tx.update(db.doc(studentPath), { "assets.cash": 999 });
    })), { code: "failed-precondition" });
    await context.run({ startedAt: 300 }, () => db.runTransaction(async tx => {
        await tx.get(db.doc(studentPath)); tx.update(db.doc(studentPath), { "assets.cash": 120 });
    }));
    assert.equal(h.data.get(studentPath).assets.cash, 120);
});
