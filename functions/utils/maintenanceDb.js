"use strict";

const { HttpsError } = require("firebase-functions/v2/https");
const { context } = require("./classMaintenanceContext");
const { assertClassAvailable } = require("./classMaintenanceGuards");

const classOf = (ref) => /^classes\/([^/]+)(?:\/|$)/.exec(ref?.path || "")?.[1];

// Scoped adapter: leave the Admin SDK and maintenance engine untouched.
// Reading the lock in the same transaction also protects commits against
// maintenance starting after the callable's initial check.
function createMaintenanceDb(db) {
    const runTransaction = (callback, ...options) => {
        const scope = { ...context.getStore() };
        if (!scope.startedAt) scope.startedAt = Date.now();
        return context.run(scope, () => db.runTransaction(async (tx) => {
            const checked = new Map();
            const check = (classId) => {
                if (!classId) return Promise.resolve();
                if (!checked.has(classId)) checked.set(classId, assertClassAvailable(db, classId, tx));
                return checked.get(classId);
            };
            for (const classId of scope.classIds || []) await check(classId);
            const guarded = new Proxy(tx, {
                get(target, key) {
                    if (key === "get") return async (ref, ...args) => {
                        await check(classOf(ref));
                        return target.get(ref, ...args);
                    };
                    if (key === "getAll") return async (...refs) => {
                        for (const ref of refs) await check(classOf(ref));
                        return target.getAll(...refs);
                    };
                    if (["set", "create", "update", "delete"].includes(key)) return (ref, ...args) => {
                        const classId = classOf(ref);
                        if (classId && !checked.has(classId)) {
                            throw new HttpsError("failed-precondition", "거래 대상 학급을 먼저 확인해야 합니다.");
                        }
                        target[key](ref, ...args);
                        return guarded;
                    };
                    const value = Reflect.get(target, key);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            });
            return callback(guarded);
        }, ...options));
    };
    return new Proxy(db, {
        get(target, key) {
            if (key === "runTransaction") return runTransaction;
            if (key === "batch") return () => {
                const writes = [];
                const batch = {};
                for (const method of ["set", "create", "update", "delete"]) batch[method] = (...args) => {
                    writes.push({ method, args });
                    return batch;
                };
                batch.commit = () => runTransaction(async (tx) => {
                    // Read every target before staging the first write.
                    const refs = [...new Map(writes.map(({ args }) => [classOf(args[0]), args[0]])).values()];
                    for (const ref of refs) if (classOf(ref)) await tx.get(db.doc(`classes/${classOf(ref)}`));
                    writes.forEach(({ method, args }) => tx[method](...args));
                });
                return batch;
            };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

module.exports = { createMaintenanceDb };
