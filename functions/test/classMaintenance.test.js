"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClassMaintenance } = require("../utils/classMaintenance");
const { resetStudentData } = require("../utils/classResetPolicy");
const { assertClassAvailable, createClassBatch } = require("../utils/classMaintenanceGuards");

const CLASS = "class-test";
const teacherRequest = (data = {}) => ({ auth: { uid: "teacher", token: { role: "teacher", classId: CLASS } }, data: { classId: CLASS, operationId: "op-1", confirmation: "테스트 학급", ...data } });

function memory(seed = {}, { finalizeClass } = {}) {
    const data = new Map(Object.entries(structuredClone({
        [`classes/${CLASS}`]: { teacherUid: "teacher", className: "테스트 학급" },
        [`classes/${CLASS}/students/teacher`]: { role: "teacher", uid: "teacher", name: "교사" },
        [`classes/${CLASS}/students/student`]: { role: "student", uid: "student", name: "학생", email: "student@example.test", studentNumber: 1, classId: CLASS, privacyAgreed: true, assets: { cash: 500 }, jobs: ["은행원"], jobPermissions: { bank_admin: true }, permissions: { bank_admin: true }, extraActivityCounter: 100 },
        "users/student": { role: "student", classId: CLASS },
        ...seed,
    })));
    let failure;
    const fail = (kind, path) => { if (failure?.kind === kind && failure.path === path) { failure = null; throw new Error("injected failure"); } };
    const snap = (ref) => ({ ref, id: ref.id, exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path)) });
    const doc = (path) => ({ path, id: path.split("/").at(-1),
        get: async () => snap(doc(path)),
        set: async (value, options) => { fail("set", path); data.set(path, options?.merge ? { ...data.get(path), ...structuredClone(value) } : structuredClone(value)); },
        update: async (value) => { fail("update", path); assert(data.has(path), `missing ${path}`); data.set(path, { ...data.get(path), ...structuredClone(value) }); },
        delete: async () => data.delete(path),
        collection: (name) => collection(`${path}/${name}`),
        listCollections: async () => [...new Set([...data.keys()].filter((key) => key.startsWith(path + "/")).map((key) => key.slice(path.length + 1).split("/")[0]))].map((name) => collection(`${path}/${name}`)),
    });
    const collection = (path) => ({ path, id: path.split("/").at(-1), doc: (id) => doc(`${path}/${id}`),
        listDocuments: async () => [...new Set([...data.keys()].filter((key) => key.startsWith(path + "/")).map((key) => key.slice(path.length + 1).split("/")[0]))].map((id) => doc(`${path}/${id}`)),
        get: async () => { const docs = (await collection(path).listDocuments()).filter((ref) => data.has(ref.path)).map(snap); return { docs, size: docs.length, forEach: (callback) => docs.forEach(callback) }; },
    });
    const db = { doc, collection,
        recursiveDelete: async (ref) => { fail("recursiveDelete", ref.path); for (const path of data.keys()) if (path === ref.path || path.startsWith(ref.path + "/")) data.delete(path); },
        runTransaction: async (callback) => {
            const writes = [];
            const tx = { get: async (ref) => { assert.equal(writes.length, 0, "reads must precede writes"); return ref.get(); },
                getAll: async (...refs) => Promise.all(refs.map((ref) => { assert.equal(writes.length, 0, "reads must precede writes"); return ref.get(); })),
                set: (...args) => writes.push(["set", args]), update: (...args) => writes.push(["update", args]), delete: (...args) => writes.push(["delete", args]) };
            const result = await callback(tx);
            for (const [kind, [ref, ...args]] of writes) await ref[kind](...args);
            return result;
        },
    };
    const deletedAuth = [];
    let failAuth = false;
    const engine = createClassMaintenance({ db, finalizeClass, FieldValue: { serverTimestamp: () => "timestamp" },
        auth: { deleteUser: async (uid) => { if (failAuth) { failAuth = false; throw new Error("auth failure"); } deletedAuth.push(uid); } },
        cleanupStudent: async (classId, uid) => { await db.recursiveDelete(doc(`classes/${classId}/students/${uid}`)); await doc(`users/${uid}`).delete(); deletedAuth.push(uid); },
        syncClaims: async (uid, permissions) => { data.set(`claims/${uid}`, structuredClone(permissions)); },
    });
    return { db, data, engine, deletedAuth, failNext: (kind, path) => { failure = { kind, path }; }, failNextAuth: () => { failAuth = true; } };
}

test("activity reset preserves identity, settings, passwords and clears linked activity", async () => {
    const m = memory({ [`classes/${CLASS}/students/student/savings/s1`]: { amount: 100 }, [`classes/${CLASS}/storeItems/item`]: { name: "상품" }, [`classes/${CLASS}/taxIncomes/old`]: { amount: 100 } });
    await m.engine.execute(teacherRequest({ initialCapital: 1000 }), "activity");
    const student = m.data.get(`classes/${CLASS}/students/student`);
    assert.equal(student.name, "학생"); assert.equal(student.studentNumber, 1); assert.equal(student.privacyAgreed, true);
    assert.equal(student.assets.cash, 1000); assert.deepEqual(student.jobs, []); assert.deepEqual(student.permissions, {});
    assert.equal(student.extraActivityCounter, undefined);
    assert(m.data.has("users/student")); assert(m.data.has(`classes/${CLASS}/storeItems/item`));
    assert(!m.data.has(`classes/${CLASS}/students/student/savings/s1`)); assert(!m.data.has(`classes/${CLASS}/taxIncomes/old`));
    assert.deepEqual(m.deletedAuth, []);
});

test("full reset preserves actual teacher when an administrator executes it", async () => {
    const m = memory({ [`classes/${CLASS}/storeItems/item`]: {} });
    const request = teacherRequest(); request.auth = { uid: "admin", token: { role: "admin" } };
    await m.engine.execute(request, "full");
    assert(m.data.has(`classes/${CLASS}/students/teacher`)); assert(m.data.has(`classes/${CLASS}`));
    assert(!m.data.has(`classes/${CLASS}/students/student`)); assert(!m.data.has("users/student"));
    assert(!m.data.has(`classes/${CLASS}/storeItems/item`)); assert.deepEqual(m.deletedAuth, ["student"]);
});

test("failed Auth deletion stays pending and resumes after student tree is gone", async () => {
    const m = memory(); m.failNextAuth();
    await assert.rejects(m.engine.execute(teacherRequest(), "full"));
    assert.equal(m.data.get(`classMaintenance/${CLASS}`).active, true);
    assert.equal(m.data.get(`classMaintenance/${CLASS}`).status, "failed");
    await m.engine.execute(teacherRequest(), "full");
    assert.deepEqual(m.deletedAuth, ["student"]);
    assert.equal(m.data.get(`classMaintenance/${CLASS}`).active, false);
    await m.engine.execute(teacherRequest(), "full");
    assert.deepEqual(m.deletedAuth, ["student"], "duplicate completed request must not delete again");
});

test("failed activity reset can resume after member reset but before checkpoint", async () => {
    const m = memory();
    m.failNext("set", `classMaintenance/${CLASS}/operations/op-1/steps/student_student`);
    await assert.rejects(m.engine.execute(teacherRequest({ initialCapital: 250 }), "activity"));
    await m.engine.execute(teacherRequest({ initialCapital: 999 }), "activity");
    assert.equal(m.data.get(`classes/${CLASS}/students/student`).assets.cash, 250, "retry uses saved parameters");
});

test("unknown activity collections fail before deleting anything", async () => {
    const m = memory({ [`classes/${CLASS}/futureFeature/important`]: {} });
    await assert.rejects(m.engine.execute(teacherRequest(), "activity"), { code: "failed-precondition" });
    assert.equal(m.data.get(`classes/${CLASS}/students/student`).assets.cash, 500);
    assert(!m.data.has(`classMaintenance/${CLASS}`));
});

test("student, other class teacher, and teacher account deletion are denied", async () => {
    const m = memory();
    for (const auth of [{ uid: "student", token: { role: "student", classId: CLASS } }, { uid: "other", token: { role: "teacher", classId: "other-class" } }]) {
        await assert.rejects(m.engine.execute({ ...teacherRequest(), auth }, "full"), { code: "permission-denied" });
    }
    await assert.rejects(m.engine.execute(teacherRequest({ studentUids: ["teacher"] }), "delete"), { code: "permission-denied" });
    assert.deepEqual(m.deletedAuth, []);
});

test("failed deletion blocks a new operation and allows the original to resume", async () => {
    const m = memory(); m.failNext("recursiveDelete", `classes/${CLASS}/students/student`);
    await assert.rejects(m.engine.execute(teacherRequest({ studentUids: ["student"] }), "delete"));
    await assert.rejects(m.engine.execute(teacherRequest({ operationId: "op-2", studentUids: ["student"] }), "delete"), { code: "failed-precondition" });
    await m.engine.execute(teacherRequest({ studentUids: ["student"] }), "delete");
    assert.equal(m.data.get(`classMaintenance/${CLASS}`).active, false);
});

test("class lock denies transactional economy writes and leaves other classes available", async () => {
    const m = memory({ [`classMaintenance/${CLASS}`]: { active: true } });
    const batch = createClassBatch(m.db, CLASS); batch.update(m.db.doc(`classes/${CLASS}/students/student`), { assets: { cash: 999 } });
    await assert.rejects(batch.commit(), { code: "failed-precondition" });
    assert.equal(m.data.get(`classes/${CLASS}/students/student`).assets.cash, 500);
    await assertClassAvailable(m.db, "other-class");
});

test("activity reset retains explicit manual permissions and removes job permissions", () => {
    const reset = resetStudentData({ role: "student", manualPermissions: { police_admin: true }, jobPermissions: { bank_admin: true }, permissions: { police_admin: true, bank_admin: true } }, 0, "now");
    assert.deepEqual(reset.permissions, { police_admin: true }); assert.deepEqual(reset.jobPermissions, {});
});


test("execution receipts survive activity reset to prevent delayed duplicate trades", async () => {
    const path = `classes/${CLASS}/students/student/idempotency/trade_old`;
    const m = memory({ [path]: { requestHash: "old", result: { committed: true } } });
    await m.engine.execute(teacherRequest(), "activity");
    assert(m.data.has(path));
});

test("deletion retry after reload uses saved targets without a selected roster", async () => {
    const m = memory(); m.failNext("recursiveDelete", `classes/${CLASS}/students/student`);
    await assert.rejects(m.engine.execute(teacherRequest({ studentUids: ["student"] }), "delete"));
    await m.engine.execute(teacherRequest(), "delete");
    assert(!m.data.has("users/student"));
});

test("global account belonging to another class cannot be deleted through stale membership", async () => {
    const m = memory({ "users/student": { role: "student", classId: "other-class" } });
    await assert.rejects(m.engine.execute(teacherRequest({ studentUids: ["student"] }), "delete"), { code: "permission-denied" });
    assert(m.data.has("users/student"));
});

test("summary failure keeps lock active and retry completes the saved reset", async () => {
    let calls = 0;
    const m = memory({}, { finalizeClass: async () => { calls++; if (calls === 1) throw new Error("summary failure"); } });
    await assert.rejects(m.engine.execute(teacherRequest({ initialCapital: 100 }), "activity"));
    assert.equal(m.data.get(`classMaintenance/${CLASS}`).active, true);
    const failed = await m.engine.getState(teacherRequest());
    assert.equal(failed.phase, "summaries");
    assert.equal(failed.failureReason, "internal");
    assert.equal(failed.canRetry, true);
    await m.engine.execute(teacherRequest({ initialCapital: 200 }), "activity");
    assert.equal(calls, 2);
    assert.equal(m.data.get(`classes/${CLASS}/students/student`).assets.cash, 100);
    assert.equal((await m.engine.getState(teacherRequest())).failureReason, null);
});

test("an in-flight runner lease prevents simultaneous duplicate execution", async () => {
    const m = memory({ [`classMaintenance/${CLASS}`]: { active: true, operationId: "op-1", leaseUntil: Date.now() + 10000 } });
    await assert.rejects(m.engine.execute(teacherRequest(), "full"), { code: "aborted" });
    assert.deepEqual(m.deletedAuth, []);
});


test("full reset clears stale local membership while preserving an account in another class", async () => {
    const m = memory({ "users/student": { role: "student", classId: "other-class" } });
    await m.engine.execute(teacherRequest(), "full");
    assert.equal(m.data.get("users/student").classId, "other-class");
    assert(!m.data.has(`classes/${CLASS}/students/student`));
    assert.deepEqual(m.deletedAuth, []);
});


test("activity reset keeps split property prices and clears participants before removing contracts", async () => {
    const {splitLayout}=require('../utils/realEstateStorageSchema');
    const split=splitLayout({groups:[{id:'g',desks:[{id:'d',permanentId:'permanent',studentId:'student',ownerId:'student',price:500,
        rentContractId:'rent1',rentPaidAmount:100,contractState:{selectedAt:'2026-09-30',sellerSignatureImg:'synthetic'}}]}]});
    const base='classes/'+CLASS+'/real_estate/';
    const seed=Object.fromEntries([[base+'layout',split.layout],...[...split.properties].map(([id,p])=>[base+'properties/items/'+id,p]),
        ...[...split.contracts].map(([id,c])=>[base+'contracts/records/'+id,c])]);
    const m=memory(seed);
    await m.engine.execute(teacherRequest(), 'activity');
    assert.equal(m.data.get(base+'layout').storageSchemaVersion,3);
    assert.equal(m.data.get(base+'layout').groups[0].desks[0].studentId,null);
    assert.equal(m.data.get(base+'properties/items/d').fields.price,500);
    assert.equal(m.data.get(base+'properties/items/d').fields.ownerId,null);
    assert.equal(m.data.get(base+'properties/items/d').saleContractId,undefined);
    assert.equal([...m.data.keys()].some(k=>k.startsWith(base+'contracts/records/')),false);
});
