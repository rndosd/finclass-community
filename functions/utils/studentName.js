"use strict";

const { HttpsError } = require("firebase-functions/v2/https");
const { validateId } = require("./classMaintenance");

const createStudentNameUpdater = ({ db, stageActivityLog }) => async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const { role, classId: callerClass } = request.auth.token;
    const classId = validateId(request.data?.classId, "학급 ID");
    const studentUid = validateId(request.data?.studentUid, "학생 ID");
    const name = typeof request.data?.name === "string" ? request.data.name.trim() : "";
    const expectedName = request.data?.expectedName;
    if (!name || name.length > 50 || /[\u0000-\u001f\u007f]/u.test(name) || typeof expectedName !== "string") {
        throw new HttpsError("invalid-argument", "이름은 1~50자로 입력해 주세요.");
    }
    if (role !== "admin" && !(role === "teacher" && callerClass === classId)) {
        throw new HttpsError("permission-denied", "담당 교사 또는 관리자만 이름을 수정할 수 있습니다.");
    }
    const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
    const userRef = db.doc(`users/${studentUid}`);
    await db.runTransaction(async (tx) => {
        const [classSnap, student, user, maintenance] = await Promise.all([
            tx.get(db.doc(`classes/${classId}`)), tx.get(studentRef), tx.get(userRef),
            tx.get(db.doc(`classMaintenance/${classId}`)),
        ]);
        if (!classSnap.exists || (role !== "admin" && classSnap.data().teacherUid !== request.auth.uid)) {
            throw new HttpsError("permission-denied", "담당 교사만 수정할 수 있습니다.");
        }
        if (maintenance.data()?.active) throw new HttpsError("failed-precondition", "학급 데이터 정리가 끝난 뒤 수정해 주세요.");
        if (!student.exists || !user.exists) throw new HttpsError("not-found", "학생 계정을 찾을 수 없습니다.");
        if (student.data().role !== "student" || user.data().role !== "student" ||
            user.data().classId !== classId || classSnap.data().teacherUid === studentUid) {
            throw new HttpsError("permission-denied", "현재 학급의 학생만 수정할 수 있습니다.");
        }
        const previousName = student.data().name || "";
        if (previousName !== expectedName && previousName !== name) {
            throw new HttpsError("aborted", "다른 화면에서 이름이 변경됐습니다. 새 이름을 확인한 뒤 다시 수정해 주세요.");
        }
        if (previousName === name && user.data().name === name) return;
        tx.update(studentRef, { name });
        tx.update(userRef, { name });
        stageActivityLog(tx, classId, {
            studentUid, type: "system", category: "general", subCategory: "student_name_update",
            description: "교사가 학생 이름을 수정했습니다.",
            previousName, name, actorUid: request.auth.uid, source: "updateStudentName",
        }, { forceWrite: true, serviceName: "admin" });
    });
    return { success: true, name };
};

module.exports = { createStudentNameUpdater };
