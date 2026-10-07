"use strict";
const { joinLayout, STORAGE_VERSION } = require("./realEstateStorageSchema");
const { summarizeRealEstateAssetsByOwner, buildRealEstateAssetPatch } = require("../src/realestateAssetSync");

// Reconcile from current source inside a transaction. Late/duplicated trigger
// events contribute former owner IDs, never stale amounts or stale ownership.
async function reconcileRealEstateAssets(db, classId, formerOwnerIds = []) {
    return db.runTransaction(async (tx) => {
        const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
        const layout = await tx.get(layoutRef);
        let current = layout.data() || {};
        if (layout.exists && current.storageSchemaVersion === STORAGE_VERSION) {
            const docs = await tx.get(db.collection(`classes/${classId}/real_estate/properties/items`));
            const properties = new Map(docs.docs.map((d) => [d.id, d.data()]));
            current = joinLayout(current, properties, new Map(), { includeContracts: false });
        }
        const summary = summarizeRealEstateAssetsByOwner(current);
        const ownerIds = [...new Set([...summary.keys(), ...formerOwnerIds.filter((id) => id && !String(id).startsWith("CLASS_FUND:"))])];
        const students = [];
        for (let i = 0; i < ownerIds.length; i += 200) students.push(...await tx.getAll(...ownerIds.slice(i, i + 200).map((id) => db.doc(`classes/${classId}/students/${id}`))));
        let updatedStudentCount = 0;
        for (const snap of students) {
            if (!snap.exists) continue;
            const patch = buildRealEstateAssetPatch(snap.data(), summary.get(snap.id) || { value: 0, count: 0 });
            if (patch) { tx.update(snap.ref, patch); updatedStudentCount++; }
        }
        return { updatedStudentCount };
    });
}
module.exports = { reconcileRealEstateAssets };
