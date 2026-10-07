"use strict";

const { HttpsError } = require("firebase-functions/v2/https");
const { STORAGE_VERSION, splitLayout, joinLayout, same, fingerprint } = require("./realEstateStorageSchema");
const contexts = new WeakMap();
const { assertClassAvailable } = require("./classMaintenanceGuards");
const clone = (value) => Array.isArray(value) ? value.map(clone) :
    value && Object.getPrototypeOf(value)?.constructor?.name === "Object" ?
        Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)])) : value;
// Harness references and the Admin SDK both expose path/id/collection. Avoid
// depending on parent reference identity when building sibling collections.
const collections = (db, layoutRef) => {
    const base = layoutRef.path.slice(0, -"layout".length);
    return { properties: db.collection(`${base}properties/items`), contracts: db.collection(`${base}contracts/records`) };
};
const fail = () => new HttpsError("failed-precondition", "부동산 저장 정보가 일치하지 않습니다. 관리자에게 확인을 요청해 주세요.");

const runRealEstateTransaction = (db, callback, options) => db.runTransaction((transaction) => {
    // The SDK may reuse a transaction object on retry. Never reuse a hydrated
    // snapshot or staged comparison state from the previous attempt.
    contexts.delete(transaction);
    return callback(transaction);
}, options);

async function readRealEstateLayout(db, layoutRef, transaction, { includeSaleContracts = true } = {}) {
    if (transaction && !includeSaleContracts) throw new Error("Mutation transactions require the complete financial source");
    let context;
    if (transaction) {
        if (!contexts.has(transaction)) contexts.set(transaction, new Map());
        context = contexts.get(transaction);
        if (context.has(layoutRef.path)) return (await context.get(layoutRef.path)).snapshot;
    }
    const load = async () => {
        if (transaction) await assertClassAvailable(db, layoutRef.path.split("/")[1], transaction);
        const snap = await (transaction ? transaction.get(layoutRef) : layoutRef.get());
        const data = snap.data();
        if (!snap.exists || data?.storageSchemaVersion == null) return { snapshot: snap, source: data, split: false, db };
        if (data.storageSchemaVersion !== STORAGE_VERSION) throw fail();
        const refs = collections(db, layoutRef);
        // Keep SDK read errors intact so contention and transient failures can
        // follow the SDK's normal retry policy. Only schema validation errors
        // are converted to a user-facing failed-precondition.
        const propertySnapshot = await (transaction ? transaction.get(refs.properties) : refs.properties.get());
        const properties = new Map(propertySnapshot.docs.map((doc) => [doc.id, doc.data()]));
        const contractIds = new Set();
        properties.forEach((p) => { if (p.rentContractId) contractIds.add(p.rentContractId); if (includeSaleContracts && p.saleContractId) contractIds.add(p.saleContractId); });
        const contracts = new Map();
        const ids = [...contractIds];
        for (let i = 0; i < ids.length; i += 200) {
            const contractRefs = ids.slice(i, i + 200).map((id) => refs.contracts.doc(id));
            const results = transaction ? await transaction.getAll(...contractRefs) : await db.getAll(...contractRefs);
            results.filter((doc) => doc.exists).forEach((doc) => contracts.set(doc.id, doc.data()));
        }
        let hydrated;
        try { hydrated = joinLayout(data, properties, contracts, { includeSaleContracts }); }
        catch (_) { throw fail(); }
        return { snapshot: { exists: snap.exists, id: snap.id, ref: snap.ref, updateTime: snap.updateTime, data: () => clone(hydrated) }, source: hydrated, split: true, properties, contracts, db };
    };
    if (!context) return (await load()).snapshot;
    const pending = load(); context.set(layoutRef.path, pending);
    const state = await pending; context.set(layoutRef.path, state);
    return state.snapshot;
}

function stageRealEstateLayout(transaction, layoutRef, patch, { replace = false, options } = {}) {
    const state = contexts.get(transaction)?.get(layoutRef.path);
    if (!state?.snapshot) throw new Error("Read the real-estate layout before staging a write");
    if (!state.split) {
        if (replace) transaction.set(layoutRef, patch, options);
        else transaction.update(layoutRef, patch);
        return;
    }
    const next = replace && !options?.merge ? patch : { ...state.source, ...patch };
    const split = splitLayout(next, state.properties);
    const refs = collections(state.db, layoutRef);
    // Removing a desk must go through the existing guarded hide flow. Keep past
    // contracts and orphaned ledger records intact when a current pointer clears.
    if ([...state.properties.keys()].some((id) => !split.properties.has(id))) throw fail();
    for (const [id, property] of split.properties) {
        if (!state.properties.has(id) || !same(state.properties.get(id), property)) transaction.set(refs.properties.doc(id), property);
    }
    for (const [id, contract] of split.contracts) {
        if (!state.contracts.has(id) || !same(state.contracts.get(id), contract)) transaction.set(refs.contracts.doc(id), contract);
    }
    if (!same(split.layout, splitLayout(state.source, state.properties).layout)) transaction.set(layoutRef, split.layout);
    // Subsequent writes in the same transaction compare against staged state.
    state.source = clone({ ...next, storageSchemaVersion: STORAGE_VERSION });
    state.properties = split.properties;
    for (const [id, contract] of split.contracts) state.contracts.set(id, contract);
}

async function writeRealEstateLayout(db, layoutRef, patch, { expectedFingerprint } = {}) {
    return runRealEstateTransaction(db, async (transaction) => {
        const snapshot = await readRealEstateLayout(db, layoutRef, transaction);
        if (expectedFingerprint && fingerprint(snapshot.data()) !== expectedFingerprint) {
            throw new HttpsError("aborted", "부동산 정보가 변경되었습니다. 다시 시도해 주세요.");
        }
        stageRealEstateLayout(transaction, layoutRef, patch);
    });
}
module.exports = { readRealEstateLayout, stageRealEstateLayout, writeRealEstateLayout, runRealEstateTransaction, collections };
