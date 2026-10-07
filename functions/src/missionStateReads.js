"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getAuthContext } = require("../utils/permissions");
const { readMissionStudentStates } = require("../utils/missionStudentState");
const db = admin.firestore();

function toTransport(value) {
    if (typeof value?.toDate === "function") return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value?.path === "string" && typeof value?.get === "function") return value.path;
    if (Array.isArray(value)) return value.map(toTransport);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toTransport(entry)]));
    return value;
}

exports.listRegularMissionStates = onCall({ region: "asia-northeast3", timeoutSeconds: 60 }, async (request) => {
    const auth = getAuthContext(request);
    const { classId, missionIds, studentUid = null } = request.data || {};
    if (typeof classId !== "string" || !classId || classId.includes("/") ||
        (studentUid !== null && (typeof studentUid !== "string" || !studentUid || /[./]/.test(studentUid))) ||
        !Array.isArray(missionIds) || missionIds.length > 30 ||
        missionIds.some((id) => typeof id !== "string" || !id || id.includes("/"))) {
        throw new HttpsError("invalid-argument", "조회할 과제를 최대 30개까지 지정해주세요.");
    }
    if (auth.role !== "admin" && auth.classId !== classId) throw new HttpsError("permission-denied", "다른 학급은 조회할 수 없습니다.");
    const actor = await db.doc(`classes/${classId}/students/${auth.uid}`).get();
    const manager = auth.role === "admin" || auth.role === "teacher" ||
        (actor.exists && actor.data()?.permissions?.mission_admin === true);
    if (!manager && studentUid !== auth.uid) throw new HttpsError("permission-denied", "본인의 과제 상태만 조회할 수 있습니다.");
    const refs = [...new Set(missionIds)].map((id) => db.doc(`classes/${classId}/missions/${id}`));
    const snapshots = refs.length ? await db.getAll(...refs) : [];
    const result = {};
    for (const snap of snapshots) {
        if (!snap.exists || snap.data()?.stateStorageVersion !== 2) continue;
        const mission = await readMissionStudentStates(db, snap.ref, snap.data(), { studentUids: studentUid ? [studentUid] : null });
        result[snap.id] = toTransport({ completions: mission.completions, submissionsIndex: mission.submissionsIndex });
    }
    return { missions: result };
});
