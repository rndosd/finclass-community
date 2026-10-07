"use strict";
const { splitLayout, joinLayout, verifySplit, fingerprint, STORAGE_VERSION } = require("./realEstateStorageSchema");
const { readRealEstateLayout, collections, runRealEstateTransaction } = require("./realEstateStorage");
const { runMaintenance } = require("./classMaintenanceContext");
const { buildLayoutViewData } = require("../src/realestateLayoutViewSummary");

// This is an operator API, not a callable. The CLI defaults to a read-only plan.
// A per-class cutover, immutable backup and discriminator switch commit together.
async function planStorageMigration(db, classId, { rollback = false } = {}) {
    const ref = db.doc(`classes/${classId}/real_estate/layout`);
    const snap = await readRealEstateLayout(db, ref);
    if (!snap.exists) throw new Error("Missing layout");
    const source = snap.data();
    if (rollback ? source.storageSchemaVersion !== STORAGE_VERSION : source.storageSchemaVersion != null) throw new Error("Unexpected storage version");
    if (!rollback) {
        const refs = collections(db, ref);
        const [properties, contracts] = await Promise.all([refs.properties.limit(1).get(), refs.contracts.limit(1).get()]);
        if (properties.docs.length || contracts.docs.length) throw new Error("Destination is not empty; review before overwrite");
    }
    const split = splitLayout(source);
    const verification = verifySplit(source, split);
    const writes = split.properties.size + split.contracts.size + 3;
    // Keep the cutover atomic; large classes require a separate reviewed plan.
    if (writes > 450) throw new Error("Class exceeds atomic migration write limit");
    return { classId, rollback, sourceHash: fingerprint(source), desks: verification.desks, contracts: verification.contracts, writes };
}

async function applyStorageMigration(db, plan, operationId, { readerRelease = "offline-test" } = {}) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(plan.classId) || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) throw new Error("Invalid operator target");
    const { classId } = plan;
    const lockRef = db.doc(`classMaintenance/${classId}`);
    const recordRef = db.doc(`realEstateStorageMigrations/${classId}/operations/${operationId}`);
    // The record is outside client-readable class data. Never put backups in
    // real_estate's generally readable recursive subtree.
    const locked = await db.runTransaction(async (tx) => {
        const [lock, previous] = await Promise.all([tx.get(lockRef), tx.get(recordRef)]);
        if (previous.exists) {
            if (previous.data().planHash !== fingerprint(plan)) throw new Error("Operation ID belongs to another plan");
            return false;
        }
        const current = lock.data() || {};
        if (current.active && !(current.type === "realestate_storage" && current.operationId === operationId)) throw new Error("Another maintenance operation is active");
        tx.set(lockRef, { ...current, active: true, operationId, type: "realestate_storage", status: "running", invalidBefore: Date.now() });
        return true;
    });
    const release = async (status) => db.runTransaction(async (tx) => {
        const lock = await tx.get(lockRef);
        if (lock.data()?.type === "realestate_storage" && lock.data()?.operationId === operationId) tx.update(lockRef, { active: false, status });
    });
    const verifyCurrent = () => runMaintenance(classId, () => runRealEstateTransaction(db, async (tx) => {
        const [live, record] = await Promise.all([readRealEstateLayout(db, db.doc(`classes/${classId}/real_estate/layout`), tx), tx.get(recordRef)]);
        if (!record.exists || record.data().planHash !== fingerprint(plan)) throw new Error("Missing migration verification record");
        const expected = { ...record.data().source };
        if (plan.rollback) delete expected.storageSchemaVersion;
        else expected.storageSchemaVersion = STORAGE_VERSION;
        if (fingerprint(live.data()) !== fingerprint(expected)) throw new Error("Post-cutover verification failed; class remains frozen");
    }));
    if (!locked) {
        // A completed operation may have been followed by valid later trades.
        // Only reverify when this operation still owns a frozen release.
        const lock = await lockRef.get();
        if (lock.data()?.active && lock.data()?.operationId === operationId) await verifyCurrent();
        await release("complete"); return { applied: false, duplicate: true };
    }
    let committed = false;
    let completed = false;
    try {
        const result = await runMaintenance(classId, () => db.runTransaction(async (tx) => {
            const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
            const refs = collections(db, layoutRef);
            const [layout, lock, previous, properties, contracts] = await Promise.all([
                tx.get(layoutRef), tx.get(lockRef), tx.get(recordRef), tx.get(refs.properties), tx.get(refs.contracts),
            ]);
            if (!lock.data()?.active || lock.data()?.operationId !== operationId || previous.exists) throw new Error("Migration lease changed");
            const propertyMap = new Map(properties.docs.map((d) => [d.id, d.data()]));
            const contractMap = new Map(contracts.docs.map((d) => [d.id, d.data()]));
            const source = plan.rollback ? joinLayout(layout.data(), propertyMap, contractMap) : layout.data();
            if (!layout.exists || fingerprint(source) !== plan.sourceHash) throw new Error("Source changed since reviewed plan");
            if (plan.rollback ? source.storageSchemaVersion !== STORAGE_VERSION : source.storageSchemaVersion != null) throw new Error("Storage version changed");
            const split = splitLayout(source); verifySplit(source, split);
            if (!plan.rollback && (properties.docs.length || contracts.docs.length)) throw new Error("Destination is not empty; review before overwrite");
            // Back up the live source, not an earlier local export. Rollback also
            // uses live values, so trades after migration are never reverted.
            tx.create(recordRef, { version: STORAGE_VERSION, direction: plan.rollback ? "rollback" : "split", plan, planHash: fingerprint(plan), sourceHash: plan.sourceHash,
                source, actor: "operator-authorized-maintenance", sourceScript: "scripts/realestate/migrateRealEstateStorage.cjs", readerRelease, completedAt: new Date().toISOString() });
            if (plan.rollback) {
                const restored = { ...source }; delete restored.storageSchemaVersion;
                tx.set(layoutRef, restored);
                tx.set(db.doc(`classes/${classId}/real_estate/layoutView`), buildLayoutViewData(restored));
            } else {
                for (const [id, data] of split.properties) tx.create(refs.properties.doc(id), data);
                for (const [id, data] of split.contracts) tx.create(refs.contracts.doc(id), data);
                tx.set(layoutRef, split.layout);
                tx.delete(db.doc(`classes/${classId}/real_estate/layoutView`));
            }
            return { applied: true, desks: split.properties.size, contracts: split.contracts.size };
        }));
        committed = true;
        await verifyCurrent();
        completed = true;
        return result;
    } finally {
        // A failed transaction wrote no partial tree. A failed release leaves
        // the class frozen and can be retried using the same operation ID.
        if (completed || !committed) await release(completed ? "complete" : "failed");
    }
}
module.exports = { planStorageMigration, applyStorageMigration };
