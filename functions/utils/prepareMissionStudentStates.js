"use strict";

const {
    MIRROR_VERSION, buildRegularMissionStateEntries,
    isCompatibleRegularState, isSameRegularState,
} = require("./missionStudentState");

// One mission is a transaction boundary. A concurrent submission changes the
// mission read version, so Firestore retries from the newer authoritative data.
async function prepareMissionStudentStates(db, missionRef, { apply = false, FieldValue, maxStates = 400, requirePrepared = false } = {}) {
    return db.runTransaction(async (tx) => {
        const source = await tx.get(missionRef);
        if (!source.exists) return { outcome: "missing", states: 0, stateWrites: 0, markerWrites: 0 };
        const mission = source.data();
        if (requirePrepared && mission.studentStateMirrorVersion !== MIRROR_VERSION) {
            return { outcome: "unchanged", states: 0, stateWrites: 0, markerWrites: 0 };
        }
        const [, classId, , missionId] = missionRef.path.split("/");
        const entries = buildRegularMissionStateEntries(classId, missionId, mission);
        if (entries.length > maxStates) throw new Error("Mission exceeds the atomic preparation size limit.");
        const stateRefs = entries.map((entry) => db.doc(entry.path));
        const studentRefs = entries.map((entry) => db.doc(`classes/${classId}/students/${entry.data.studentUid}`));
        const snapshots = stateRefs.length ? await tx.getAll(...stateRefs) : [];
        // Only existence/role is needed, not student balances, names or history.
        const studentSnapshots = studentRefs.length ? await tx.getAll(...studentRefs, { fieldMask: ["role"] }) : [];
        const changed = [];
        let conflicts = 0;
        let missingStudents = 0;
        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            const current = snapshots[index];
            if (!studentSnapshots[index].exists) missingStudents++;
            if (current.exists && (!isCompatibleRegularState(current.data(), entry.data) ||
                (mission.studentStateMirrorVersion !== MIRROR_VERSION && !isSameRegularState(current.data(), entry.data)))) {
                conflicts++;
                continue;
            }
            if (!current.exists || !isSameRegularState(current.data(), entry.data)) changed.push(index);
        }
        if (conflicts || missingStudents) {
            return { outcome: "blocked", states: entries.length, stateWrites: 0, markerWrites: 0, conflicts, missingStudents };
        }
        const markerWrites = mission.studentStateMirrorVersion === MIRROR_VERSION ? 0 : 1;
        if (apply) {
            if (!FieldValue) throw new Error("FieldValue is required for apply.");
            for (const index of changed) tx.set(stateRefs[index], entries[index].data);
            if (markerWrites) tx.update(missionRef, {
                studentStateMirrorVersion: MIRROR_VERSION,
                studentStatePreparedAt: FieldValue.serverTimestamp(),
            });
        }
        return {
            outcome: changed.length || markerWrites ? "ready" : "unchanged",
            states: entries.length,
            stateWrites: changed.length,
            markerWrites,
            // This phase never changes stateStorageVersion or deletes source fields.
            sourceStorageVersion: 1,
        };
    });
}

module.exports = { prepareMissionStudentStates };
