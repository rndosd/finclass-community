"use strict";

const { createHash } = require("node:crypto");
const {
    buildRegularMissionStateEntries, isCompatibleRegularState, isSameRegularState,
    readMissionStudentStates,
} = require("./missionStudentState");

async function cutoverMissionStudentStates(db, missionRef, {
    apply = false, FieldValue, FieldPath, maxStates = 400, archiveMissingRejectedStudents = false,
} = {}) {
    return db.runTransaction(async (tx) => {
        const source = await tx.get(missionRef);
        if (!source.exists) return { outcome: "missing", states: 0, stateWrites: 0, markerWrites: 0 };
        const mission = source.data();
        const [, classId, , missionId] = missionRef.path.split("/");
        if (mission.stateStorageVersion === 2) {
            const current = await readMissionStudentStates(db, missionRef, mission, { tx });
            return { outcome: "unchanged", states: Object.keys(current._studentStateRevisions).length, stateWrites: 0, markerWrites: 0 };
        }
        const entries = buildRegularMissionStateEntries(classId, missionId, mission);
        if (entries.length > maxStates) throw new Error("Mission exceeds the atomic preparation size limit.");
        const archiveRef = db.doc(`internalMigrations/missionStudentStates/missions/${createHash("sha256").update(missionRef.path).digest("hex")}`);
        const archive = await tx.get(archiveRef);
        const refs = entries.map((entry) => db.doc(entry.path));
        const snapshots = refs.length ? await tx.getAll(...refs) : [];
        const studentRefs = entries.map((entry) => db.doc(`classes/${classId}/students/${entry.data.studentUid}`));
        const students = studentRefs.length ? await tx.getAll(...studentRefs, { fieldMask: ["role"] }) : [];
        const missingIndexes = entries.map((_, index) => index).filter((index) => !students[index].exists);
        const missingProfiles = archiveMissingRejectedStudents && missingIndexes.length ?
            await tx.getAll(...missingIndexes.map((index) => db.doc(`users/${entries[index].data.studentUid}`))) : [];
        const archiveOnlyIndexes = new Set();
        if (archiveMissingRejectedStudents) missingIndexes.forEach((index, offset) => {
            const state = entries[index].data;
            // Preserve only closed, unlinked records whose account/profile is
            // absent. Pending work, financial payouts and live accounts remain
            // blocked. Keep the full original entry in the internal archive.
            if (!missingProfiles[offset].exists && !snapshots[index].exists &&
                state.completion?.status === "rejected" && !state.completion?.rewardGranted &&
                !state.submissionId && !state.completion?.submissionId) archiveOnlyIndexes.add(index);
        });
        let conflicts = archive.exists ? 1 : 0;
        let missingStudents = 0;
        for (let index = 0; index < entries.length; index++) {
            if (!students[index].exists && !archiveOnlyIndexes.has(index)) missingStudents++;
            if (snapshots[index].exists && (!isCompatibleRegularState(snapshots[index].data(), entries[index].data) ||
                (mission.studentStateMirrorVersion !== 1 && !isSameRegularState(snapshots[index].data(), entries[index].data)))) conflicts++;
        }
        if (conflicts || missingStudents) return { outcome: "blocked", states: entries.length, stateWrites: 0, markerWrites: 0, conflicts, missingStudents };
        if (apply) {
            if (!FieldValue || !FieldPath) throw new Error("Firestore field types are required for cutover.");
            const originalStateFields = Object.fromEntries(Object.entries(mission).filter(([key]) =>
                /^(completions|submissionsIndex)(\.|$)/.test(key)));
            tx.set(archiveRef, {
                classId, missionId, originalStateFields,
                sourceUpdateTime: source.updateTime || null,
                originalMissionUpdatedAt: mission.updatedAt || null,
                archivedMissingStudentUids: [...archiveOnlyIndexes].map((index) => entries[index].data.studentUid),
                archivedAt: FieldValue.serverTimestamp(),
            });
            for (let index = 0; index < entries.length; index++) {
                if (archiveOnlyIndexes.has(index)) continue;
                tx.set(refs[index], {
                    ...entries[index].data, sourceStorageVersion: 2, revision: 0,
                });
            }
            const update = [
                new FieldPath("stateStorageVersion"), 2,
                new FieldPath("stateStorageMigratedAt"), FieldValue.serverTimestamp(),
                new FieldPath("studentStateMirrorVersion"), FieldValue.delete(),
                new FieldPath("studentStatePreparedAt"), FieldValue.delete(),
                new FieldPath("completions"), FieldValue.delete(),
                new FieldPath("submissionsIndex"), FieldValue.delete(),
            ];
            for (const key of Object.keys(originalStateFields).filter((key) => key.includes("."))) {
                update.push(new FieldPath(key), FieldValue.delete());
            }
            tx.update(missionRef, ...update);
        }
        return { outcome: "ready", states: entries.length - archiveOnlyIndexes.size,
            originalStates: entries.length, archivedMissingStudents: archiveOnlyIndexes.size,
            stateWrites: entries.length - archiveOnlyIndexes.size, markerWrites: 1, archiveWrites: 1, sourceStorageVersion: 2 };
    });
}

module.exports = { cutoverMissionStudentStates };
