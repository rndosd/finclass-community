"use strict";

// Preparation keeps the legacy mission authoritative until all readers and
// legacy direct writes have been retired in a separately reviewed cutover.
const MIRROR_VERSION = 1;
const REGULAR_STATE_SCHEMA_VERSION = 1;
const pendingStatuses = new Set(["pending", "late"]);

function isMap(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) &&
        Object.getPrototypeOf(value)?.constructor?.name === "Object";
}

function setPath(target, parts, value, isDelete = () => false) {
    let current = target;
    for (const part of parts.slice(0, -1)) {
        if (["__proto__", "constructor", "prototype"].includes(part)) {
            throw new Error("Unsafe mission state field.");
        }
        current[part] = isMap(current[part]) ? { ...current[part] } : {};
        current = current[part];
    }
    const leaf = parts.at(-1);
    if (["__proto__", "constructor", "prototype"].includes(leaf)) {
        throw new Error("Unsafe mission state field.");
    }
    if (isDelete(value)) delete current[leaf];
    else current[leaf] = value;
}

function serializeStateValue(value) {
    if (typeof value?.toMillis === "function") return { timestampMillis: value.toMillis() };
    if (value instanceof Date) return { timestampMillis: value.getTime() };
    if (typeof value?.path === "string" && typeof value?.get === "function") return { referencePath: value.path };
    if (Array.isArray(value)) return value.map(serializeStateValue);
    if (isMap(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, serializeStateValue(value[key])]));
    return value;
}

// Firestore set(merge:true) can have produced literal dotted keys. Flattening
// accepts either representation; ambiguous overlapping values block backfill.
function normalizeMissionStateFields(raw = {}, { strict = false } = {}) {
    const result = { ...raw };
    for (const name of ["completions", "submissionsIndex", "stats", "lastAttempts"]) {
        if (raw[name] !== undefined && !isMap(raw[name])) {
            if (strict) throw new Error(`Invalid ${name} map.`);
        }
        result[name] = isMap(raw[name]) ? { ...raw[name] } : {};
    }
    for (const [key, value] of Object.entries(raw)) {
        const match = /^(completions|submissionsIndex|stats|lastAttempts)\.(.+)$/.exec(key);
        if (!match) continue;
        const parts = match[2].split(".");
        let existing = result[match[1]];
        for (const part of parts) existing = existing?.[part];
        if (strict && existing !== undefined &&
            JSON.stringify(serializeStateValue(existing)) !== JSON.stringify(serializeStateValue(value))) {
            throw new Error("Conflicting nested and dotted mission state fields.");
        }
        setPath(result[match[1]], parts, value);
        delete result[key];
    }
    return result;
}

function getMissionStructuralFields(raw = {}) {
    const result = normalizeMissionStateFields(raw);
    delete result.completions;
    delete result.submissionsIndex;
    delete result.updatedAt;
    // Mirror bookkeeping never changes eligibility or the displayed mission.
    delete result.studentStateMirrorVersion;
    delete result.studentStatePreparedAt;
    delete result._studentStateRevisions;
    if (result.type === "always" || (!!result.availability && result.isActive)) {
        delete result.stats;
        delete result.lastAttempts;
    }
    return result;
}

function validateStudentUid(uid) {
    if (typeof uid !== "string" || !uid || /[./]/.test(uid) ||
        ["__proto__", "constructor", "prototype"].includes(uid)) {
        throw new Error("Invalid mission state student key.");
    }
}

function regularMissionStatePath(classId, studentUid, missionId) {
    validateStudentUid(studentUid);
    return `classes/${classId}/students/${studentUid}/missionState/${missionId}`;
}

function buildRegularMissionState({ classId, missionId, studentUid, completion = null, submissionId = null }) {
    validateStudentUid(studentUid);
    if (completion !== null && !isMap(completion)) throw new Error("Invalid completion entry.");
    if (submissionId !== null && (typeof submissionId !== "string" || !submissionId || submissionId.includes("/"))) {
        throw new Error("Invalid submission reference.");
    }
    if (completion?.submissionId && submissionId && completion.submissionId !== submissionId) {
        throw new Error("Conflicting completion and submission reference.");
    }
    const resolvedSubmissionId = submissionId || completion?.submissionId || null;
    if (resolvedSubmissionId !== null && (typeof resolvedSubmissionId !== "string" || !resolvedSubmissionId || resolvedSubmissionId.includes("/"))) {
        throw new Error("Invalid submission reference.");
    }
    const status = typeof completion?.status === "string" ? completion.status : null;
    return {
        kind: "regular",
        schemaVersion: REGULAR_STATE_SCHEMA_VERSION,
        sourceStorageVersion: 1,
        classId,
        missionId,
        studentUid,
        completion,
        submissionId: resolvedSubmissionId,
        latestStatus: status,
        pendingCount: pendingStatuses.has(status) ? 1 : 0,
    };
}

function buildRegularMissionStateEntries(classId, missionId, rawMission) {
    const mission = normalizeMissionStateFields(rawMission, { strict: true });
    if (mission.type === "always") throw new Error("Recurring missions already have personal state.");
    if (Number(mission.stateStorageVersion || 1) !== 1) throw new Error("Unsupported source storage version.");
    return [...new Set([...Object.keys(mission.completions), ...Object.keys(mission.submissionsIndex)])]
        .sort().map((studentUid) => ({
            path: regularMissionStatePath(classId, studentUid, missionId),
            data: buildRegularMissionState({
                classId, missionId, studentUid,
                completion: mission.completions[studentUid] ?? null,
                submissionId: mission.submissionsIndex[studentUid] ?? null,
            }),
        }));
}

function isCompatibleRegularState(data, entry) {
    return data?.kind === "regular" && data?.schemaVersion === REGULAR_STATE_SCHEMA_VERSION &&
        data?.sourceStorageVersion === 1 && data?.classId === entry.classId &&
        data?.missionId === entry.missionId && data?.studentUid === entry.studentUid;
}

function isSameRegularState(data, expected) {
    return JSON.stringify(serializeStateValue(data)) === JSON.stringify(serializeStateValue(expected));
}

// Use the exact same write stage for submission, approval, reversal, rejection
// and server feedback. No rewards/logs are replayed when creating the mirror.
function stageMissionStatePatch(tx, missionRef, rawMission, patch, FieldValue, db) {
    const mission = normalizeMissionStateFields(rawMission, { strict: true });
    const canonical = Number(mission.stateStorageVersion || 1) === 2;
    if (![1, 2].includes(Number(mission.stateStorageVersion || 1))) throw new Error("Unsupported mission state version.");
    if ((canonical || mission.studentStateMirrorVersion === MIRROR_VERSION) && mission.type !== "always") {
        const next = { completions: { ...mission.completions }, submissionsIndex: { ...mission.submissionsIndex } };
        const affected = new Set();
        const isDelete = (value) => value?.__op === "delete" ||
            (typeof value?.isEqual === "function" && value.isEqual(FieldValue.delete()));
        for (const [key, value] of Object.entries(patch)) {
            const match = /^(completions|submissionsIndex)\.([^.]+)(?:\.(.+))?$/.exec(key);
            if (!match) continue;
            const [, name, studentUid, field] = match;
            validateStudentUid(studentUid);
            affected.add(studentUid);
            const parts = [studentUid, ...(field ? field.split(".") : [])];
            setPath(next[name], parts, value, isDelete);
        }
        const [, classId, , missionId] = missionRef.path.split("/");
        for (const studentUid of affected) {
            const stateRef = db.doc(regularMissionStatePath(classId, studentUid, missionId));
            const state = buildRegularMissionState({
                classId, missionId, studentUid,
                completion: next.completions[studentUid] ?? null,
                submissionId: next.submissionsIndex[studentUid] ?? null,
            });
            if (canonical) {
                state.sourceStorageVersion = 2;
                state.revision = Number(mission._studentStateRevisions?.[studentUid] || 0) + 1;
                state.updatedAt = FieldValue.serverTimestamp();
            }
            tx.set(stateRef, state);
        }
    }
    if (!canonical) tx.update(missionRef, patch);
    else {
        const metadataPatch = Object.fromEntries(Object.entries(patch).filter(([key]) =>
            key !== "updatedAt" && !/^(completions|submissionsIndex)\./.test(key)));
        if (Object.keys(metadataPatch).length) tx.update(missionRef, metadataPatch);
    }
}

async function readMissionStudentStates(db, missionRef, rawMission, { tx = null, studentUids = null } = {}) {
    const mission = normalizeMissionStateFields(rawMission, { strict: true });
    if (Number(mission.stateStorageVersion || 1) !== 2 || mission.type === "always") return mission;
    const [, classId, , missionId] = missionRef.path.split("/");
    let uids = studentUids;
    if (!uids) {
        const query = db.collection(`classes/${classId}/students`).select("role");
        const roster = tx ? await tx.get(query) : await query.get();
        uids = roster.docs.map((doc) => doc.id);
    }
    const refs = [...new Set(uids)].map((uid) => db.doc(regularMissionStatePath(classId, uid, missionId)));
    const states = refs.length ? (tx ? await tx.getAll(...refs) : await db.getAll(...refs)) : [];
    const result = { ...mission, completions: {}, submissionsIndex: {}, _studentStateRevisions: {} };
    for (const snap of states) {
        if (!snap.exists) continue;
        const state = snap.data();
        if (state.kind !== "regular" || state.classId !== classId || state.missionId !== missionId ||
            state.sourceStorageVersion !== 2 || snap.ref.path !== regularMissionStatePath(classId, state.studentUid, missionId)) {
            throw new Error("Invalid canonical mission state.");
        }
        if (state.completion) result.completions[state.studentUid] = state.completion;
        if (state.submissionId) result.submissionsIndex[state.studentUid] = state.submissionId;
        result._studentStateRevisions[state.studentUid] = Number(state.revision || 0);
    }
    return result;
}

async function readMissionDocsStudentStates(db, missionDocs, { studentUids = null, tx = null } = {}) {
    const result = [];
    let roster = studentUids;
    for (const doc of missionDocs) {
        const raw = doc.data();
        if (raw.stateStorageVersion === 2 && !roster) {
            const query = db.collection(`${doc.ref.path.split("/").slice(0, 2).join("/")}/students`).select("role");
            roster = (tx ? await tx.get(query) : await query.get()).docs.map((student) => student.id);
        }
        const data = await readMissionStudentStates(db, doc.ref, raw, { studentUids: roster, tx });
        result.push({ id: doc.id, ref: doc.ref, data: () => data });
    }
    return result;
}

async function guardCanonicalMissionProjection(tx, db, classId, missionId, expected) {
    if (expected?.stateStorageVersion !== 2) return;
    const ref = db.doc(`classes/${classId}/missions/${missionId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Canonical mission changed while projecting.");
    const current = await readMissionStudentStates(db, ref, snap.data(), { tx });
    const comparable = (mission) => serializeStateValue({
        metadata: getMissionStructuralFields(mission),
        completions: mission.completions, submissionsIndex: mission.submissionsIndex,
    });
    if (JSON.stringify(comparable(current)) !== JSON.stringify(comparable(expected))) {
        throw new Error("Canonical mission changed while projecting.");
    }
}

module.exports = {
    MIRROR_VERSION, REGULAR_STATE_SCHEMA_VERSION, normalizeMissionStateFields,
    getMissionStructuralFields, regularMissionStatePath, buildRegularMissionState,
    buildRegularMissionStateEntries, isCompatibleRegularState, isSameRegularState,
    serializeStateValue, stageMissionStatePatch,
    readMissionStudentStates, readMissionDocsStudentStates,
    guardCanonicalMissionProjection,
};
