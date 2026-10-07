"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const { readRealEstateLayout, writeRealEstateLayout } = require("../utils/realEstateStorage");
const { fingerprint: realEstateFingerprint } = require("../utils/realEstateStorageSchema");

function cascade({ failMission = false, failTree = false, exists = true, role = "student" } = {}) {
    const sourceFile = process.env.STUDENT_RESET_AUTH_SOURCE || path.join(__dirname, "../src/auth.js");
    const source = fs.readFileSync(sourceFile, "utf8");
    let body;
    traverse(parser.parse(source), { VariableDeclarator(p) {
        if (p.node.id.name === "deleteStudentAccountCascade") body = source.slice(p.node.init.start, p.node.init.end);
    } });
    assert(body, "cascade function must exist");
    const operations = [];
    const ref = (path) => ({ path, get: async () => ({ exists, data: () => ({ role }) }),
        listCollections: async () => [{ path: `${path}/savings` }],
    });
    class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
    const fn = vm.runInNewContext(`(${body})`, {
        db: { doc: ref, recursiveDelete: async (ref) => { operations.push(ref.path); if (failTree && ref.path.endsWith("/savings")) throw new Error("tree failure"); } },
        authAdmin: { deleteUser: async (uid) => operations.push(`auth/${uid}`) }, HttpsError,
        cleanupStudentMissionSharedData: async () => { if (failMission) throw new Error("mission failure"); return {}; },
        cleanupStudentSharedClassData: async () => ({}),
    });
    return { fn, operations };
}

test("mission cleanup failure stops deletion rather than reporting success", async () => {
    const c = cascade({ failMission: true });
    await assert.rejects(c.fn("class-a", "student-a"), /mission failure/);
    assert.deepEqual(c.operations, []);
});

test("recursive child deletion failure never falls back to parent-only delete", async () => {
    const c = cascade({ failTree: true });
    await assert.rejects(c.fn("class-a", "student-a"), /tree failure/);
    assert(!c.operations.includes("auth/student-a"));
    assert(!c.operations.includes("classes/class-a/students/student-a"));
});

test("saved operation can clean a student whose parent is already missing", async () => {
    const c = cascade({ exists: false });
    await c.fn("class-a", "student-a", { allowMissing: true });
    assert(c.operations.includes("auth/student-a"));
    assert(c.operations.includes("classes/class-a/students/student-a"));
});

test("teacher account cannot be deleted even by a resumed operation", async () => {
    const c = cascade({ role: "teacher" });
    await assert.rejects(c.fn("class-a", "teacher-a", { allowMissing: true }), { code: "permission-denied" });
    assert.deepEqual(c.operations, []);
});

function extractCleanup(name, globals) {
 const source=fs.readFileSync(path.join(__dirname,"../src/auth.js"),"utf8");
 let body;
 traverse(parser.parse(source),{VariableDeclarator(p){if(p.node.id.name===name)body=source.slice(p.node.init.start,p.node.init.end);}});
 assert(body);
 return vm.runInNewContext("("+body+")",globals);
}

test("mission cleanup includes nested student attempts even without completion metadata", async () => {
 const operations=[];
 const mission={data:()=>({}),ref:{collection:name=>({doc:uid=>({path:"classes/class-a/missions/mission/"+name+"/"+uid})})}};
 const fn=extractCleanup("cleanupStudentMissionSharedData",{
  db:{collection:()=>({get:async()=>[mission]})},
  getStudentMissionSubmissions:async()=>[],
  FieldValue:{},hasOwnKey:(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key),
  commitFirestoreOpsInChunks:async ops=>operations.push(...ops),
 });
 await fn("class-a","student");
 assert(operations.some(op=>op.type==="delete" && op.ref.path==="classes/class-a/missions/mission/students/student"));
});

test("shared cleanup removes orphan trees and clears an independent rent tenant", async () => {
 const empty={docs:[],size:0,forEach:()=>{}};
 const operations=[];let layoutPatch;
 const fn=extractCleanup("cleanupStudentSharedClassData",{
  readRealEstateLayout, writeRealEstateLayout, realEstateFingerprint,
  db:{runTransaction:async callback=>callback({get:ref=>ref.get(),update:(ref,patch)=>ref.update(patch)}),collection:()=>({where:()=>({get:async()=>empty}),doc:id=>({path:id})}),
   doc:p=>({path:p,get:async()=>p.endsWith("/layout")?{exists:true,data:()=>({groups:[{desks:[{ownerId:"another-student",studentId:null,rentTenantId:"student",rentContractId:"old",rentPaidAmount:20}]}]})}:{exists:false,data:()=>undefined},update:async patch=>{layoutPatch=patch;} }),getAll:async()=>[]},
  createStudentSharedCleanupSummary:()=>({realEstateSeatAssignmentsCleared:0,realEstateOwnershipsCleared:0,realEstatePurchaseRequestsCleared:0}),
  queueDeleteOperation:(map,ref)=>map.set(ref.path,{type:"delete",ref}),
  commitFirestoreOpsInChunks:async ops=>operations.push(...ops),
 });
 await fn("class-a","student");
 assert(operations.some(op=>op.ref.path==="classes/class-a/arcade/config/usage/student"));
 assert(operations.some(op=>op.ref.path==="classes/class-a/donationStats/student"));
 const desk=layoutPatch.groups[0].desks[0];
 assert.equal(desk.ownerId,"another-student");assert.equal(desk.rentTenantId,null);assert.equal(desk.rentContractId,null);assert.equal(desk.rentPaidAmount,0);
});

test("shared history deletes recurse into children and propagate failures", async () => {
 const deleted=[];
 const fn=extractCleanup("commitFirestoreOpsInChunks",{
  DELETE_BATCH_CHUNK_SIZE:400,
  db:{recursiveDelete:async ref=>{deleted.push(ref.path);throw new Error("nested delete failed");},batch:()=>{throw new Error("must not fall back to parent deletion");}},
 });
 await assert.rejects(fn([{type:"delete",ref:{path:"classes/class-a/missions/m/submissions/s"}}]),/nested delete failed/);
 assert.equal(deleted.length,1);
});
