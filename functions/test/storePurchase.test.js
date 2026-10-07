"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");
const studentPath = "classes/class-a/students/student-a";
const itemPath = "classes/class-a/storeItems/item-a";
const inventoryPath = `${studentPath}/inventory/item-a`;
const auth = { uid: "student-a", token: { role: "student", classId: "class-a" } };
const seed = (validityHours) => ({
    "classes/class-a": { currencyUnit: "unit" },
    [studentPath]: { name: "Synthetic student", role: "student", assets: { cash: 100, itemValue: 0 } },
    "classes/class-a/students/teacher-a": { name: "Synthetic teacher", role: "teacher" },
    [itemPath]: { name: "Synthetic item", price: 10, stock: 10, isTaxExempt: true, validityHours },
});

for (const mode of ["single", "cart", "pos", "pos-immediate"]) {
    for (const validityHours of [null, 24]) {
        test(`${mode} purchase commits payment, inventory, expiry and audit records (${validityHours || "no"} hour validity)`, async () => {
            const h = createCallableHarness(seed(validityHours), { retryTransaction: true });
            const store = h.load("functions/src/store.js");
            const data = { classId: "class-a", itemId: "item-a", quantity: 2, items: [{ itemId: "item-a", quantity: 2 }] };
            const result = mode === "single" ? await store.purchaseStoreItem({ auth, data }) :
                mode === "cart" ? await store.purchaseStoreCart({ auth, data }) :
                    await store.purchaseStoreCartPos({
                        auth: { uid: "teacher-a", token: { role: "teacher", classId: "class-a" } },
                        data: { ...data, targetStudentUid: "student-a", isImmediate: mode === "pos-immediate" },
                    });
            assert.equal(result.success, true);
            if (mode === "single") {
                assert.equal(result.totalCost, 20);
                assert.equal(result.taxAmount, 0);
                assert.equal(result.currencyType, "cash");
                assert.equal(result.newBalance, 80);
            } else if (mode === "cart") {
                assert.deepEqual({ ...result.totalCostByCurrency }, { cash: 20 });
                assert.deepEqual({ ...result.taxAmountByCurrency }, { cash: 0 });
            }
            assert.equal(h.data.get(studentPath).assets.cash, 80);
            assert.equal(h.data.get(studentPath).assets.itemValue, mode === "pos-immediate" ? 0 : 20);
            assert.equal(h.data.get(itemPath).stock, 8);
            const inventory = h.data.get(inventoryPath);
            if (mode === "pos-immediate") {
                assert.equal(inventory, undefined);
            } else {
                assert.equal(inventory.quantity, 2);
                assert.equal(inventory.acquisitions.length, 1);
                const acquisition = inventory.acquisitions[0];
                if (validityHours) {
                    assert.equal(acquisition.expiresAtMs, Date.parse("2026-09-08T01:00:00Z") + 24 * 3600000);
                } else {
                    assert.equal(acquisition.expiresAtMs == null, true);
                }
            }
            assert.equal([...h.data.keys()].filter((key) => key.startsWith("classes/class-a/storeRedemptions/")).length, 1);
            assert.equal([...h.data.values()].filter((record) => record.category === "store").length, 1);
        });
    }
}

test("cart repurchase preserves existing inventory acquisitions", async () => {
    const h = createCallableHarness(seed(24));
    const store = h.load("functions/src/store.js");
    const request = { auth, data: { classId: "class-a", items: [{ itemId: "item-a", quantity: 1 }] } };
    await store.purchaseStoreCart(request);
    const firstId = h.data.get(inventoryPath).acquisitions[0].purchaseId;
    await store.purchaseStoreCart(request);
    const inventory = h.data.get(inventoryPath);
    assert.equal(inventory.quantity, 2);
    assert.equal(inventory.acquisitions.length, 2);
    assert.equal(inventory.acquisitions[0].purchaseId, firstId);
    assert.equal(h.data.get(studentPath).assets.cash, 80);
});

for (const mode of ["single", "cart"]) {
    test(`${mode} receipt returns included tax and separate currency totals without changing payment on retry`, async () => {
        const records = seed(null);
        records["classes/class-a"].taxPolicy = { treasury: { store: { mode: "TAX_ONLY" } } };
        records[itemPath].isTaxExempt = false;
        records[studentPath].assets.usdBalance = 50;
        records["classes/class-a/storeItems/fin-item"] = { name: "FIN item", price: 12, stock: 10, currencyType: "usdBalance" };
        const h = createCallableHarness(records, { retryTransaction: true });
        const store = h.load("functions/src/store.js");
        const result = mode === "single"
            ? await store.purchaseStoreItem({ auth, data: { classId: "class-a", itemId: "item-a", quantity: 2 } })
            : await store.purchaseStoreCart({ auth, data: { classId: "class-a", items: [{ itemId: "item-a", quantity: 2 }, { itemId: "fin-item", quantity: 1 }] } });
        assert.equal(h.data.get(studentPath).assets.cash, 80);
        if (mode === "single") {
            assert.equal(result.totalCost, 20);
            assert.equal(result.taxAmount, 1.82);
            assert.equal(result.newBalance, 80);
        } else {
            assert.deepEqual({ ...result.totalCostByCurrency }, { cash: 20, usdBalance: 12 });
            assert.deepEqual({ ...result.taxAmountByCurrency }, { cash: 1.82, usdBalance: 0 });
            assert.equal(h.data.get(studentPath).assets.usdBalance, 38);
        }
        const redemptions = [...h.data.entries()].filter(([key]) => key.startsWith("classes/class-a/storeRedemptions/"));
        assert.equal(redemptions.length, mode === "single" ? 1 : 2);
        assert.equal(redemptions.find(([, row]) => row.itemId === "item-a")[1].taxAmountPerItem, 0.91);
    });
}

for (const mode of ["single", "cart", "pos"]) {
    test(`${mode} rejects insufficient funds without committing payment or inventory`, async () => {
        const records = seed(24);
        records[studentPath].assets.cash = 5;
        const h = createCallableHarness(records);
        const store = h.load("functions/src/store.js");
        const data = { classId: "class-a", itemId: "item-a", quantity: 1, items: [{ itemId: "item-a", quantity: 1 }] };
        const purchase = mode === "single" ? store.purchaseStoreItem({ auth, data }) :
            mode === "cart" ? store.purchaseStoreCart({ auth, data }) :
                store.purchaseStoreCartPos({ auth: { uid: "teacher-a", token: { role: "teacher", classId: "class-a" } }, data: { ...data, targetStudentUid: "student-a", isImmediate: false } });
        await assert.rejects(purchase, (error) => {
            assert.match(error.message, /잔액이 부족합니다/);
            if (mode !== "pos") assert.equal(error.code, "failed-precondition");
            return true;
        });
        assert.equal(h.writes.length, 0);
        assert.equal(h.data.get(studentPath).assets.cash, 5);
        assert.equal(h.data.get(itemPath).stock, 10);
        assert.equal(h.data.has(inventoryPath), false);
    });
}

for (const mode of ["single", "cart"]) {
    test(`${mode} unexpected storage failure stays internal and rolls back all writes`, async () => {
        const h = createCallableHarness(seed(null));
        h.load("functions/utils/logUtils.js").stageActivityLog = () => { throw new Error("Synthetic storage failure"); };
        const store = h.load("functions/src/store.js");
        const request = { auth, data: { classId: "class-a", itemId: "item-a", quantity: 1, items: [{ itemId: "item-a", quantity: 1 }] } };
        await assert.rejects(mode === "single" ? store.purchaseStoreItem(request) : store.purchaseStoreCart(request), { code: "internal" });
        assert.equal(h.writes.length, 0);
        assert.equal(h.data.get(studentPath).assets.cash, 100);
        assert.equal(h.data.get(itemPath).stock, 10);
        assert.equal(h.data.has(inventoryPath), false);
    });

    test(`${mode} token purchase retries without charging cash or duplicating inventory`, async () => {
        const records = seed(null);
        records[studentPath].assets.missionToken = 20;
        records[itemPath] = { ...records[itemPath], price: 1, stock: 1, currencyType: "missionToken" };
        const h = createCallableHarness(records, { retryTransaction: true });
        const store = h.load("functions/src/store.js");
        const request = { auth, data: { classId: "class-a", itemId: "item-a", quantity: 1, items: [{ itemId: "item-a", quantity: 1 }] } };
        const result = await (mode === "single" ? store.purchaseStoreItem(request) : store.purchaseStoreCart(request));
        assert.equal(result.success, true);
        assert.equal(h.data.get(studentPath).assets.missionToken, 19);
        assert.equal(h.data.get(studentPath).assets.cash, 100);
        assert.equal(h.data.get(itemPath).stock, 0);
        assert.equal(h.data.get(inventoryPath).acquisitions.length, 1);
        assert.equal([...h.data.keys()].filter(key => key.startsWith("classes/class-a/storeRedemptions/")).length, 1);
        const activity = [...h.data.values()].find(record => record.category === "store");
        assert.equal(activity.currencyType, "missionToken");
        assert.equal(activity.amount, 1);
        await assert.rejects(mode === "single" ? store.purchaseStoreItem(request) : store.purchaseStoreCart(request), { code: "failed-precondition" });
        assert.equal(h.data.get(studentPath).assets.missionToken, 19);
        assert.equal(h.data.get(inventoryPath).quantity, 1);
    });

    for (const restriction of ["stock", "tier", "vip", "dailyLimit"]) {
        test(`${mode} ${restriction} denial returns its reason instead of internal and commits no writes`, async () => {
            const records = seed(null);
            if (restriction === "stock") records[itemPath].stock = 0;
            if (restriction === "tier") Object.assign(records[itemPath], { minCreditTierId: "vip", minCreditTierName: "VIP", minCreditScore: 100 });
            if (restriction === "vip") {
                records[itemPath].categoryId = "vip";
                records["classes/class-a/storeCategories/vip"] = { type: "vip", accessMode: "selected_students", allowedStudentUids: ["another-student"] };
            }
            if (restriction === "dailyLimit") records[itemPath].dailyLimit = 1;
            const h = createCallableHarness(records);
            const store = h.load("functions/src/store.js");
            const request = { auth, data: { classId: "class-a", itemId: "item-a", quantity: 2, items: [{ itemId: "item-a", quantity: 2 }] } };
            await assert.rejects(mode === "single" ? store.purchaseStoreItem(request) : store.purchaseStoreCart(request), { code: "failed-precondition" });
            assert.equal(h.writes.length, 0);
            assert.equal(h.data.get(studentPath).assets.cash, 100);
        });
    }
}
