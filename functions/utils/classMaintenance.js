"use strict";

const { randomUUID } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { runMaintenance } = require("./classMaintenanceContext");
const { PRESERVE, CLEAR, MIXED, resetStudentData, clearLayoutParticipants } = require("./classResetPolicy");
const { readRealEstateLayout, stageRealEstateLayout, runRealEstateTransaction } = require("./realEstateStorage");
const LEASE_MS = 10 * 60 * 1000;

const validateId = (value, label) => {
    if (typeof value !== "string" || !value.trim() || value.includes("/") || value.length > 180) {
        throw new HttpsError("invalid-argument", `${label} 값이 올바르지 않습니다.`);
    }
    return value.trim();
};

const createClassMaintenance = ({ db, auth, FieldValue, cleanupStudent, syncClaims, finalizeClass = async () => {} }) => {
    const stateRef = (classId) => db.doc(`classMaintenance/${classId}`);
    const authorize = async (request, classId) => {
        if (!request.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        const role = request.auth.token.role;
        const snap = await db.doc(`classes/${classId}`).get();
        if (!snap.exists) throw new HttpsError("not-found", "학급을 찾을 수 없습니다.");
        if (role !== "admin" && !(role === "teacher" && request.auth.token.classId === classId && snap.data().teacherUid === request.auth.uid)) {
            throw new HttpsError("permission-denied", "학급 소유 교사 또는 관리자만 실행할 수 있습니다.");
        }
        return snap;
    };

    const getState = async (request) => {
        const classId = validateId(request.data?.classId, "학급 ID");
        await authorize(request, classId);
        const snap = await stateRef(classId).get();
        const data = snap.data() || {};
        return { active: !!data.active, operationId: data.operationId || null, type: data.type || null,
            status: data.status || null, completedSteps: data.completedSteps || 0,
            phase: data.phase || null, failureReason: data.failureReason || null,
            retryAfterMs: Math.max(0, (data.leaseUntil || 0) - Date.now()),
            canRetry: !data.leaseUntil || data.leaseUntil <= Date.now() };
    };

    const execute = async (request, type) => {
        const classId = validateId(request.data?.classId, "학급 ID");
        const operationId = validateId(request.data?.operationId, "작업 ID");
        const classSnap = await authorize(request, classId);
        const initialCapital = request.data?.initialCapital ?? 0;
        if (type === "activity" && (!Number.isSafeInteger(initialCapital) || initialCapital < 0 || initialCapital > 100000000)) {
            throw new HttpsError("invalid-argument", "초기 현금은 0~100,000,000 사이의 정수여야 합니다.");
        }
        const existingOperation = await stateRef(classId).collection("operations").doc(operationId).get();
        if (!existingOperation.exists && type === "delete" && !Array.isArray(request.data?.studentUids)) throw new HttpsError("invalid-argument", "삭제할 학생 목록이 필요합니다.");
        const studentUids = type === "delete" ? [...new Set(existingOperation.data()?.studentUids || request.data?.studentUids || [])] : [];
        if (type === "delete" && ((!existingOperation.exists && !Array.isArray(request.data?.studentUids)) || !studentUids.length || studentUids.length > 500)) {
            throw new HttpsError("invalid-argument", "삭제할 학생을 1~500명 선택해 주세요.");
        }
        studentUids.forEach((uid) => validateId(uid, "학생 UID"));
        const ref = stateRef(classId);
        const opRef = ref.collection("operations").doc(operationId);
        const runner = randomUUID();
        const previous = existingOperation;
        if (!previous.exists && type !== "delete") {
            if (request.data?.confirmation !== (classSnap.data().className || classSnap.data().name || "학급")) {
                throw new HttpsError("invalid-argument", "학급 이름을 정확히 입력해 주세요.");
            }
            if (type === "activity") {
                const collections = await classSnap.ref.listCollections();
                const unknown = collections.map((col) => col.id).filter((id) => id !== "students" && !PRESERVE.has(id) && !CLEAR.has(id) && !MIXED.has(id));
                if (unknown.length) throw new HttpsError("failed-precondition", `초기화 정책 확인이 필요한 데이터가 있습니다: ${unknown.join(", ")}`);
                for (const member of (await classSnap.ref.collection("students").get()).docs) {
                    if (member.data().role !== "student") continue;
                    const user = (await db.doc(`users/${member.id}`).get()).data();
                    if (user && (user.role !== "student" || user.classId !== classId)) throw new HttpsError("failed-precondition", "다른 학급 계정과 연결된 학생 명단을 먼저 정리해 주세요.");
                }
            }
        }
        // Validate identities before any destructive operation; retries use saved targets.
        if (!previous.exists && type === "delete") {
            for (const uid of studentUids) {
                const snap = await db.doc(`classes/${classId}/students/${uid}`).get();
                const user = (await db.doc(`users/${uid}`).get()).data();
                if ((user && (user.classId !== classId || user.role !== "student")) || !snap.exists || snap.data().role !== "student" || uid === classSnap.data().teacherUid) {
                    throw new HttpsError("permission-denied", "현재 학급의 학생 계정만 삭제할 수 있습니다.");
                }
            }
        }
        const manifest = await db.runTransaction(async (tx) => {
            const [stateSnap, opSnap] = await Promise.all([tx.get(ref), tx.get(opRef)]);
            const state = stateSnap.data() || {};
            const operation = opSnap.data();
            if (operation && operation.type !== type) throw new HttpsError("invalid-argument", "작업 ID의 실행 방식이 다릅니다.");
            if (operation?.status === "completed") return operation;
            if (state.active && state.operationId !== operationId) throw new HttpsError("failed-precondition", "진행 중인 데이터 정리 작업을 먼저 재시도해 주세요.");
            if (state.active && state.leaseUntil > Date.now()) throw new HttpsError("aborted", "이미 실행 중인 작업입니다. 잠시 후 상태를 확인해 주세요.");
            const next = operation || { type, studentUids, initialCapital, actorUid: request.auth.uid,
                createdAt: FieldValue.serverTimestamp(), completedSteps: 0 };
            tx.set(opRef, { ...next, status: "running", failureReason: null });
            tx.set(ref, { ...state, active: true, operationId, type, status: "running", runner,
                failureReason: null,
                leaseUntil: Date.now() + LEASE_MS, completedSteps: next.completedSteps || 0 });
            return next;
        });
        if (manifest.status === "completed") return { success: true, results: manifest.results || [], message: "이미 완료된 작업입니다." };

        let completedSteps = manifest.completedSteps || 0;
        let phase = "prepare";
        const step = async (key, callback) => {
            const checkpoint = opRef.collection("steps").doc(key);
            if ((await checkpoint.get()).exists) return;
            phase = key === "finalize_projections" ? "summaries" : key.startsWith("student_") ? "students" : "collections";
            await db.runTransaction(async (tx) => {
                const state = (await tx.get(ref)).data();
                if (state.runner !== runner) throw new HttpsError("aborted", "다른 실행에서 작업을 이어받았습니다.");
                tx.update(ref, { phase });
            });
            await callback();
            completedSteps += 1;
            await db.runTransaction(async (tx) => {
                const state = (await tx.get(ref)).data();
                if (state.runner !== runner) throw new HttpsError("aborted", "다른 실행에서 작업을 이어받았습니다.");
                tx.set(checkpoint, { completedAt: FieldValue.serverTimestamp() });
                tx.update(opRef, { completedSteps });
                tx.update(ref, { completedSteps, leaseUntil: Date.now() + LEASE_MS });
            });
        };
        const clearSubcollections = async (docRef, preserveReceipts = false) => {
            for (const col of await docRef.listCollections()) {
                if (preserveReceipts && col.id === "idempotency") continue;
                await db.recursiveDelete(col);
            }
        };
        const resetMember = async (docRef) => {
            const savedRef = opRef.collection("identities").doc(docRef.id);
            let saved = await savedRef.get();
            if (!saved.exists) {
                const snap = await docRef.get();
                if (!snap.exists) { await db.recursiveDelete(docRef); return; }
                const data = resetStudentData(snap.data(), manifest.initialCapital, FieldValue.serverTimestamp());
                await savedRef.set(data);
                saved = await savedRef.get();
            }
            await clearSubcollections(docRef, true);
            const data = saved.data();
            await docRef.set({ ...data, uid: docRef.id, classId, lastUpdated: FieldValue.serverTimestamp() });
            if (data.role === "student") await syncClaims(docRef.id, data.permissions);
        };

        try {
            await runMaintenance(classId, async () => {
                if (type === "delete") {
                    for (const uid of manifest.studentUids) {
                        await step(`student_${uid}`, () => cleanupStudent(classId, uid, { allowMissing: true }));
                    }
                } else {
                    const classRef = classSnap.ref;
                    for (const col of await classRef.listCollections()) {
                        if (col.id === "students") continue;
                        if (type === "full" || CLEAR.has(col.id)) {
                            await step(`collection_${col.id}`, () => db.recursiveDelete(col));
                        } else if (MIXED.has(col.id)) {
                            await step(`collection_${col.id}`, async () => {
                                // Hydrate before deleting contract containers. Activity resets
                                // preserve the classroom and prices in either storage version.
                                let splitRealEstate = false;
                                if (col.id === "real_estate") {
                                    const layoutRef = col.doc("layout");
                                    splitRealEstate = await runRealEstateTransaction(db, async (tx) => {
                                        const layout = await readRealEstateLayout(db, layoutRef, tx);
                                        if (layout.data()?.storageSchemaVersion !== 3) return false;
                                        stageRealEstateLayout(tx, layoutRef, clearLayoutParticipants(layout.data()), { replace: true });
                                        return true;
                                    });
                                }
                                for (const docRef of await col.listDocuments()) {
                                    if (splitRealEstate && ["layout", "properties"].includes(docRef.id)) continue;
                                    const snap = await docRef.get();
                                    if (col.id === "missions") {
                                        await clearSubcollections(docRef);
                                        if (snap.exists) await docRef.update({ completions: snap.data()?.stateStorageVersion === 2 ? FieldValue.delete() : {}, submissionsIndex: snap.data()?.stateStorageVersion === 2 ? FieldValue.delete() : {}, lastAttempts: {}, updatedAt: FieldValue.serverTimestamp() });
                                    } else if (col.id === "real_estate" && docRef.id === "layout" && snap.exists) {
                                        await clearSubcollections(docRef);
                                        await docRef.set(clearLayoutParticipants(snap.data()));
                                    } else if ((col.id === "real_estate" && ["config", "grouping"].includes(docRef.id)) ||
                                        (col.id === "bank" && docRef.id === "settings") || (col.id === "arcade" && docRef.id === "config")) {
                                        await clearSubcollections(docRef);
                                    } else await db.recursiveDelete(docRef);
                                }
                            });
                        } else if (!PRESERVE.has(col.id)) {
                            throw new HttpsError("failed-precondition", `초기화 정책이 없는 데이터: ${col.id}`);
                        }
                    }
                    const studentsRef = classRef.collection("students");
                    // Keep targets outside the deleted tree so a failed Auth deletion is retryable.
                    const targetsRef = opRef.collection("targets");
                    if (!(await opRef.get()).data().targetsSaved) {
                        for (const docRef of await studentsRef.listDocuments()) {
                            const data = (await docRef.get()).data() || {};
                            const user = (await db.doc(`users/${docRef.id}`).get()).data();
                            const role = data.role || user?.role || "orphan";
                            await targetsRef.doc(docRef.id).set({ role, deleteAccount: role === "student" && (!user || (user.role === "student" && user.classId === classId)) });
                        }
                        await opRef.update({ targetsSaved: true });
                    }
                    for (const target of (await targetsRef.get()).docs) {
                        const docRef = studentsRef.doc(target.id);
                        const preserve = type === "activity" || target.id === classSnap.data().teacherUid || ["teacher", "admin"].includes(target.data().role);
                        await step(`student_${target.id}`, async () => {
                            if (preserve) await resetMember(docRef);
                            else {
                                await db.recursiveDelete(docRef);
                                if (target.data().deleteAccount) {
                                    await db.recursiveDelete(db.doc(`users/${target.id}`));
                                    try { await auth.deleteUser(target.id); }
                                    catch (error) { if (error.code !== "auth/user-not-found") throw error; }
                                }
                            }
                        });
                    }
                }
                await step("finalize_projections", () => finalizeClass(classId, type));
                const results = manifest.studentUids.map((uid) => ({ uid, status: "success" }));
                await db.runTransaction(async (tx) => {
                    const state = (await tx.get(ref)).data();
                    if (state.runner !== runner) throw new HttpsError("aborted", "작업 실행 소유권이 변경되었습니다.");
                    tx.update(opRef, { status: "completed", results, completedAt: FieldValue.serverTimestamp() });
                    tx.update(ref, { active: false, status: "completed", phase: null,
                        failureReason: null, leaseUntil: 0, invalidBefore: Date.now() });
                });
            });
            return { success: true, results: manifest.studentUids.map((uid) => ({ uid, status: "success" })),
                message: type === "activity" ? "계정과 수업 설정을 유지하고 활동 데이터를 초기화했습니다." : type === "full" ? "학급 전체 리셋이 완료되었습니다." : "학생 계정 삭제가 완료되었습니다." };
        } catch (error) {
            const code = String(error.code || "internal");
            const failureReason = ["9", "failed-precondition"].includes(code) ? "precondition"
                : ["4", "14", "deadline-exceeded", "unavailable"].includes(code) ? "connection"
                    : ["7", "permission-denied", "auth/insufficient-permission"].includes(code) ? "permission" : "internal";
            await db.runTransaction(async (tx) => {
                const state = (await tx.get(ref)).data();
                if (state.runner !== runner) return;
                tx.update(opRef, { status: "failed", phase, failureReason, failedAt: FieldValue.serverTimestamp() });
                tx.update(ref, { status: "failed", phase, failureReason, leaseUntil: 0 });
            });
            console.error("Class maintenance failed", { classId, operationId, phase, code });
            throw new HttpsError(error.code === "failed-precondition" ? error.code : "internal", "데이터 정리가 완료되지 않았습니다. 같은 작업을 재시도해 주세요.", { operationId });
        }
    };
    return { execute, getState };
};

module.exports = { createClassMaintenance, validateId };
