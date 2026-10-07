"use strict";

const { HttpsError } = require("firebase-functions/v2/https");
const { context } = require("./classMaintenanceContext");

const assertClassAvailable = async (db, classId, tx = null) => {
    if (!classId || context.getStore()?.maintenanceClassId === classId) return;
    const ref = db.doc(`classMaintenance/${classId}`);
    const state = (await (tx ? tx.get(ref) : ref.get())).data() || {};
    if (state.active || (context.getStore()?.startedAt && context.getStore().startedAt <= (state.invalidBefore || 0))) {
        throw new HttpsError(
            "failed-precondition",
            "학급 데이터 정리 중이거나 초기화 이전의 작업입니다. 새로고침 후 다시 시도해 주세요.",
            { reason: "class-maintenance" },
        );
    }
};

// Opt-in public API for the feature modules that mutate class economy data.
const createClassBatch = (db, classId) => {
    const writes = [];
    const batch = {};
    for (const method of ["set", "create", "update", "delete"]) {
        batch[method] = (...args) => { writes.push({ method, args }); return batch; };
    }
    batch.commit = () => db.runTransaction(async (tx) => {
        await assertClassAvailable(db, classId, tx);
        writes.forEach(({ method, args }) => tx[method](...args));
    });
    return batch;
};

const writeClassDocument = (db, classId, ref, method, ...args) => {
    if (!ref.path.startsWith(`classes/${classId}/`) && ref.path !== `classes/${classId}`) return ref[method](...args);
    return db.runTransaction(async (tx) => {
        await assertClassAvailable(db, classId, tx);
        tx[method](ref, ...args);
    });
};

const addClassDocument = async (db, classId, collection, data) => {
    const ref = collection.doc();
    await writeClassDocument(db, classId, ref, "set", data);
    return ref;
};

// These bulk callers enqueue writes and await flush/close. Use bounded
// transactions so the maintenance lock and each group commit atomically.
const createClassBulkWriter = (db, classId) => {
    let entries = [];
    let closed = false;
    const writer = {};
    for (const method of ["set", "create", "update", "delete"]) {
        writer[method] = (...args) => {
            if (closed) throw new Error("Bulk writer is closed");
            let resolve, reject;
            const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
            promise.catch(() => {});
            entries.push({ method, args, resolve, reject });
            return promise;
        };
    }
    writer.onWriteError = () => {};
    writer.flush = async () => {
        const pending = entries;
        entries = [];
        try {
            for (let offset = 0; offset < pending.length; offset += 400) {
                const group = pending.slice(offset, offset + 400);
                const batch = createClassBatch(db, classId);
                group.forEach(({ method, args }) => batch[method](...args));
                await batch.commit();
                group.forEach(({ resolve }) => resolve());
            }
        } catch (error) {
            pending.forEach(({ reject }) => reject(error));
            throw error;
        }
    };
    writer.close = async () => { closed = true; await writer.flush(); };
    return writer;
};

module.exports = { assertClassAvailable, createClassBatch, createClassBulkWriter, writeClassDocument, addClassDocument };
