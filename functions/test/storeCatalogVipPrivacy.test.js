"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("public store catalog omits VIP items and uses the protected schema", async () => {
    const source = fs.readFileSync(path.join(__dirname, "../src/storeUsageSummary.js"), "utf8");
    let savedCatalog;
    const docs = {
        storeCategories: [
            { id: "regular", data: () => ({ type: "normal" }) },
            { id: "vip", data: () => ({ type: "vip" }) },
        ],
        storeItems: [
            { id: "regular-item", data: () => ({ categoryId: "regular", name: "Pencil", price: 10 }) },
            { id: "vip-item", data: () => ({ categoryId: "vip", name: "Secret", price: 100 }) },
        ],
    };
    const db = {
        collection: (name) => ({ get: async () => ({ docs: docs[name.split("/").at(-1)] }) }),
        doc: () => ({ set: async (value) => { savedCatalog = value; } }),
    };
    const module = { exports: {} };
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        require: (name) => {
            if (name === "../firebaseAdminCompat") return { firestore: () => db };
            if (name === "firebase-functions/v2/https") {
                return { onCall: (_options, handler) => handler, HttpsError: Error };
            }
            if (name === "firebase-functions/v2/firestore") {
                return { onDocumentWritten: (_options, handler) => handler };
            }
            if (name === "firebase-admin/firestore") {
                return { FieldValue: { serverTimestamp: () => "timestamp" } };
            }
            if (name === "../utils/permissions") return { getUserData: async () => ({}) };
            if (name === "../utils/summaryProjectionGuards") {
                return { hasStoreCatalogContributionChanged: () => true };
            }
            if (name === "./storeSaleStatus") {
                return {
                    isStoreItemVisibleToStudents: () => true,
                    normalizeStoreItemSaleStatus: () => "available",
                };
            }
            throw new Error(`Unexpected dependency: ${name}`);
        },
        Set,
        Number,
        String,
        Date,
        console,
    });

    const count = await module.exports.__private.rebuildStoreCatalogSummaryDoc("class-a");
    assert.equal(count, 1);
    assert.equal(savedCatalog.schemaVersion, 4);
    assert.deepEqual(Array.from(savedCatalog.items, (item) => item.name), ["Pencil"]);

    docs.storeCategories[0] = { id: "regular", data: () => ({ type: "vip" }) };
    await module.exports.syncStoreCatalogOnCategoryChange({
        params: { classId: "class-a", categoryId: "regular" },
        data: {
            before: { data: () => ({ type: "normal" }) },
            after: { data: () => ({ type: "vip" }) },
        },
    });
    assert.deepEqual(Array.from(savedCatalog.items, (item) => item.name), []);
});
