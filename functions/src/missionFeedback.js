"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getAuthContext } = require("../utils/permissions");
const { readMissionStudentStates, stageMissionStatePatch } = require("../utils/missionStudentState");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

exports.saveMissionFeedback = onCall({ region: "asia-northeast3", timeoutSeconds: 30 }, async (request) => {
    const auth = getAuthContext(request);
    const { classId, missionId, items = [], submissionId = null, feedback = "" } = request.data || {};
    if (typeof classId !== "string" || !classId || classId.includes("/") ||
        typeof missionId !== "string" || !missionId || missionId.includes("/") ||
        !Array.isArray(items) || items.length > 50 ||
        (!submissionId && items.length === 0) || (submissionId && items.length > 0)) {
        throw new HttpsError("invalid-argument", "피드백 대상 정보가 올바르지 않습니다.");
    }
    if (auth.role !== "admin" && auth.classId !== classId) {
        throw new HttpsError("permission-denied", "다른 학급의 피드백을 수정할 수 없습니다.");
    }
    const normalized = items.map((item) => ({ uid: item?.uid || item?.studentUid, feedback: item?.feedback ?? "" }));
    if (normalized.some((item) => typeof item.uid !== "string" || !item.uid || /[./]/.test(item.uid) ||
        typeof item.feedback !== "string") || new Set(normalized.map((item) => item.uid)).size !== normalized.length ||
        (submissionId && (typeof submissionId !== "string" || /\//.test(submissionId) || typeof feedback !== "string"))) {
        throw new HttpsError("invalid-argument", "피드백 대상이 중복되었거나 올바르지 않습니다.");
    }

    const missionRef = db.doc(`classes/${classId}/missions/${missionId}`);
    const actorRef = db.doc(`classes/${classId}/students/${auth.uid}`);
    const explicitSubmissionRef = submissionId ? missionRef.collection("submissions").doc(submissionId) : null;
    await db.runTransaction(async (tx) => {
        const [missionSnap, actorSnap, explicitSubmissionSnap] = await tx.getAll(
            missionRef, actorRef, ...(explicitSubmissionRef ? [explicitSubmissionRef] : []),
        );
        const actor = actorSnap.exists ? actorSnap.data() : {};
        const teacher = auth.role === "teacher";
        const manager = actorSnap.exists && actor.permissions?.mission_admin === true;
        if (auth.role !== "admin" && !teacher && !manager) {
            throw new HttpsError("permission-denied", "미션 피드백 수정 권한이 없습니다.");
        }
        if (!missionSnap.exists) throw new HttpsError("not-found", "과제를 찾을 수 없습니다.");
        const mission = await readMissionStudentStates(db, missionRef, missionSnap.data(), {
            tx, studentUids: explicitSubmissionRef ? [explicitSubmissionSnap.data()?.studentUid].filter(Boolean) : normalized.map((item) => item.uid),
        });
        if (mission.type === "always") throw new HttpsError("failed-precondition", "상시 과제 회차 피드백 경로를 사용해주세요.");

        const targets = explicitSubmissionRef ? [] : normalized;
        if (explicitSubmissionRef) {
            if (!explicitSubmissionSnap.exists) throw new HttpsError("not-found", "제출물을 찾을 수 없습니다.");
            const studentUid = explicitSubmissionSnap.data()?.studentUid;
            if (!studentUid || /[./]/.test(studentUid)) throw new HttpsError("failed-precondition", "제출 학생 정보가 없습니다.");
            const latestId = mission.submissionsIndex[studentUid] || mission.completions[studentUid]?.submissionId;
            if (latestId === submissionId) targets.push({ uid: studentUid, feedback: feedback.trim() });
        }
        if (targets.some((item) => !mission.completions[item.uid])) {
            throw new HttpsError("failed-precondition", "피드백을 남길 수행 기록이 없습니다.");
        }
        const linkedRefs = explicitSubmissionRef ? [] : targets.map((item) => {
            const id = mission.submissionsIndex[item.uid] || mission.completions[item.uid]?.submissionId;
            return id ? missionRef.collection("submissions").doc(id) : null;
        });
        const linkedSnaps = linkedRefs.filter(Boolean).length ? await tx.getAll(...linkedRefs.filter(Boolean)) : [];
        for (const snap of linkedSnaps) {
            const expected = targets.find((item) => (mission.submissionsIndex[item.uid] || mission.completions[item.uid]?.submissionId) === snap.id);
            if (!snap.exists || snap.data()?.studentUid !== expected?.uid) {
                throw new HttpsError("failed-precondition", "제출물 연결이 일치하지 않습니다.");
            }
        }

        const editedAt = FieldValue.serverTimestamp();
        const actorName = actor.name || actor.displayName || "";
        const patch = { updatedAt: editedAt };
        for (const item of targets) {
            patch[`completions.${item.uid}.feedback`] = item.feedback;
            patch[`completions.${item.uid}.feedbackUpdatedBy`] = auth.uid;
            patch[`completions.${item.uid}.feedbackUpdatedByName`] = actorName;
            patch[`completions.${item.uid}.feedbackEditedAt`] = editedAt;
        }
        const submissionPatch = (value) => ({
            feedback: value, feedbackEditedAt: editedAt, feedbackByUid: auth.uid, feedbackByName: actorName,
        });
        if (explicitSubmissionRef) tx.update(explicitSubmissionRef, submissionPatch(feedback.trim()));
        else for (let index = 0; index < targets.length; index++) {
            if (linkedRefs[index]) tx.update(linkedRefs[index], submissionPatch(targets[index].feedback));
        }
        if (targets.length) stageMissionStatePatch(tx, missionRef, mission, patch, FieldValue, db);
    });
    return { success: true, message: "피드백이 저장되었습니다.", updatedCount: submissionId ? 1 : normalized.length };
});
