"use strict";

const admin = require("../firebaseAdminCompat");
const db = admin.firestore();

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { FieldValue } = require("firebase-admin/firestore");
const {
    getAuthContext,
    getUserData,
    hasPermission,
    assertTeacherOrAdminFromClaims,
} = require("../utils/permissions");

const ASSEMBLY_VIEW_PERMISSION = "page_assembly_view";
const ASSEMBLY_MEMBER_PERMISSION = "assembly_member";

const isTeacherOrAdminRole = (role) => role === "teacher" || role === "admin";

const normalizeVoteCount = (value) => {
    if (Array.isArray(value)) {
        return value.length;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 0;
    }

    return Math.max(0, Math.round(numericValue));
};

const getStoredVoteCounts = (billData = {}) => {
    const nestedAgree = normalizeVoteCount(billData?.votes?.agree);
    const nestedDisagree = normalizeVoteCount(billData?.votes?.disagree);

    if (nestedAgree > 0 || nestedDisagree > 0) {
        return {
            agree: nestedAgree,
            disagree: nestedDisagree,
            total: nestedAgree + nestedDisagree,
        };
    }

    const legacyAgree = normalizeVoteCount(billData?.agree);
    const legacyDisagree = normalizeVoteCount(billData?.disagree);

    return {
        agree: legacyAgree,
        disagree: legacyDisagree,
        total: legacyAgree + legacyDisagree,
    };
};

const countVotesFromVoterDocs = (voterDocs = []) => {
    let agree = 0;
    let disagree = 0;

    voterDocs.forEach((docSnap) => {
        const vote = docSnap.data()?.vote;
        if (vote === "agree") {
            agree += 1;
        } else if (vote === "disagree") {
            disagree += 1;
        }
    });

    return {
        agree,
        disagree,
        total: agree + disagree,
    };
};

const getCanonicalVoteCounts = (billData = {}, voterDocs = []) => {
    if (Array.isArray(voterDocs) && voterDocs.length > 0) {
        return countVotesFromVoterDocs(voterDocs);
    }

    return getStoredVoteCounts(billData);
};

const buildVoteCountPayload = (voteCounts) => ({
    votes: {
        agree: voteCounts.agree,
        disagree: voteCounts.disagree,
    },
    voteCount: voteCounts.total,
});

const hasSameVoteCounts = (left, right) =>
    left.agree === right.agree && left.disagree === right.disagree;

const syncBillVoteCounts = async (billRef, billData = {}) => {
    const votersSnap = await billRef.collection("voters").get();
    const storedVoteCounts = getStoredVoteCounts(billData);
    const canonicalVoteCounts = getCanonicalVoteCounts(billData, votersSnap.docs);
    const storedVoteCount = normalizeVoteCount(billData?.voteCount);

    if (
        hasSameVoteCounts(storedVoteCounts, canonicalVoteCounts) &&
        storedVoteCount === canonicalVoteCounts.total
    ) {
        return canonicalVoteCounts;
    }

    await billRef.set(buildVoteCountPayload(canonicalVoteCounts), { merge: true });
    return canonicalVoteCounts;
};

const assertRequiredIds = (classId, billId) => {
    if (!classId || !billId) {
        throw new HttpsError(
            "invalid-argument",
            "classId와 billId는 필수입니다.",
        );
    }
};

const assertAssemblyAccess = async (
    request,
    classId,
    { requireProposalAccess = false } = {},
) => {
    const ctx = getAuthContext(request);

    if (ctx.role === "admin") {
        return ctx;
    }

    if (ctx.role === "teacher") {
        assertTeacherOrAdminFromClaims(request, { classId });
        return ctx;
    }

    const requiredPermission = requireProposalAccess
        ? ASSEMBLY_MEMBER_PERMISSION
        : ASSEMBLY_VIEW_PERMISSION;
    const allowed = await hasPermission(ctx.uid, classId, requiredPermission);

    if (!allowed) {
        throw new HttpsError(
            "permission-denied",
            requireProposalAccess
                ? "법안을 제안할 권한이 없습니다."
                : "학급 국회에 접근할 권한이 없습니다.",
        );
    }

    return ctx;
};

const normalizeDangerLevel = (value, fallback = null) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return fallback;
    }

    const normalized = Math.round(numericValue);
    if (normalized < 1 || normalized > 3) {
        return fallback;
    }

    return normalized;
};

const getNormalizedPoliceRuleData = (billId, billData, dangerLevel = null) => {
    const sourceData = billData?.policeRuleData;
    if (!sourceData || typeof sourceData !== "object") {
        throw new HttpsError(
            "invalid-argument",
            "등록할 경찰 규칙 정보가 없습니다.",
        );
    }

    const text = typeof sourceData.text === "string" && sourceData.text.trim()
        ? sourceData.text.trim()
        : typeof billData?.title === "string" && billData.title.trim()
            ? billData.title.trim()
            : "";

    if (!text) {
        throw new HttpsError(
            "invalid-argument",
            "등록할 경찰 규칙 이름이 없습니다.",
        );
    }

    const normalizedDangerLevel = normalizeDangerLevel(
        dangerLevel ?? sourceData.dangerLevel,
    );

    if (normalizedDangerLevel == null) {
        throw new HttpsError(
            "invalid-argument",
            "위험도는 1, 2, 3 중 하나여야 합니다.",
        );
    }

    return {
        ruleId: sourceData.ruleId || billId,
        normalizedDangerLevel,
        ruleData: {
            text,
            fineAmount: Number(sourceData.fineAmount) || 0,
            creditChange: Number(sourceData.creditChange) || 0,
            notes: typeof sourceData.notes === "string"
                ? sourceData.notes.trim()
                : "",
            dangerLevel: normalizedDangerLevel,
            createdBy: billData.proposerName || "학급 국회 제안",
            createdAt: FieldValue.serverTimestamp(),
            sourceBillId: billId,
        },
    };
};

const getLatestPoliceRuleQuery = (classId, dangerLevel) =>
    db.collection(`classes/${classId}/policeRules`)
        .where("dangerLevel", "==", dangerLevel)
        .orderBy("order", "desc")
        .limit(1);

const getNextPoliceRuleOrder = async ({
    classId,
    dangerLevel,
    transaction = null,
}) => {
    const lastRuleQuery = getLatestPoliceRuleQuery(classId, dangerLevel);
    const lastRuleSnap = transaction
        ? await transaction.get(lastRuleQuery)
        : await lastRuleQuery.get();

    if (lastRuleSnap.empty) {
        return 1;
    }

    const lastRule = lastRuleSnap.docs[0]?.data() || {};
    return Number(lastRule.order || 0) + 1;
};

const createPoliceRuleFromBill = async ({
    classId,
    billId,
    billData,
    dangerLevel = null,
    transaction = null,
}) => {
    const {
        ruleId,
        normalizedDangerLevel,
        ruleData,
    } = getNormalizedPoliceRuleData(billId, billData, dangerLevel);

    const ruleRef = db.doc(`classes/${classId}/policeRules/${ruleId}`);
    const existingRuleSnap = transaction
        ? await transaction.get(ruleRef)
        : await ruleRef.get();

    if (existingRuleSnap.exists) {
        throw new HttpsError(
            "already-exists",
            "같은 ID의 경찰 규칙이 이미 존재합니다.",
        );
    }

    const order = await getNextPoliceRuleOrder({
        classId,
        dangerLevel: normalizedDangerLevel,
        transaction,
    });

    const payload = {
        ...ruleData,
        order,
    };

    if (transaction) {
        transaction.set(ruleRef, payload);
    } else {
        await ruleRef.set(payload);
    }

    return {
        normalizedDangerLevel,
        ruleId,
    };
};

const deleteVoterDocs = async (billRef) => {
    const votersSnap = await billRef.collection("voters").get();
    const docs = votersSnap.docs;

    for (let index = 0; index < docs.length; index += 450) {
        const batch = db.batch();
        docs.slice(index, index + 450).forEach((docSnap) => {
            batch.delete(docSnap.ref);
        });
        await batch.commit();
    }
};

exports.castVote = onCall(
    { region: "asia-northeast3", cors: true },
    async (request) => {
        const { classId, billId, choice } = request.data || {};
        assertRequiredIds(classId, billId);

        if (!["agree", "disagree"].includes(choice)) {
            throw new HttpsError(
                "invalid-argument",
                "올바른 투표 선택이 아닙니다.",
            );
        }

        const ctx = await assertAssemblyAccess(request, classId);
        const callerData = await getUserData(classId, ctx.uid).catch(() => null);
        const voterName =
            callerData?.name ||
            request.auth?.token?.name ||
            request.auth?.token?.displayName ||
            ctx.uid;
        const isPrivilegedVoter = isTeacherOrAdminRole(ctx.role);
        const billRef = db.doc(`classes/${classId}/assemblyBills/${billId}`);
        const voterRef = billRef.collection("voters").doc(ctx.uid);

        return db.runTransaction(async (transaction) => {
            const [billDoc, voterDoc] = await transaction.getAll(
                billRef,
                voterRef,
            );

            if (!billDoc.exists) {
                throw new HttpsError("not-found", "해당 법안을 찾을 수 없습니다.");
            }

            const billData = billDoc.data() || {};
            if (billData.status !== "voting") {
                throw new HttpsError(
                    "failed-precondition",
                    "투표가 진행 중인 법안만 투표할 수 있습니다.",
                );
            }

            const previousChoice = voterDoc.exists
                ? voterDoc.data()?.vote || null
                : null;

            const canRevote =
                isPrivilegedVoter || billData.allowVoteChanges === true;

            if (!canRevote && previousChoice) {
                throw new HttpsError(
                    "already-exists",
                    "이미 이 법안에 투표했습니다.",
                );
            }

            if (canRevote && previousChoice === choice) {
                transaction.set(
                    voterRef,
                    {
                        vote: choice,
                        votedAt: FieldValue.serverTimestamp(),
                        voterUid: ctx.uid,
                        voterName,
                        classId,
                    },
                    { merge: true },
                );

                return {
                    success: true,
                    message: "같은 선택으로 투표 상태를 다시 저장했습니다.",
                };
            }

            const voteUpdate = {};
            if (canRevote && ["agree", "disagree"].includes(previousChoice)) {
                voteUpdate[`votes.${previousChoice}`] = FieldValue.increment(-1);
            }
            voteUpdate[`votes.${choice}`] = FieldValue.increment(1);

            transaction.set(
                voterRef,
                {
                    vote: choice,
                    votedAt: FieldValue.serverTimestamp(),
                    voterUid: ctx.uid,
                    voterName,
                    classId,
                },
                { merge: true },
            );
            transaction.set(billRef, voteUpdate, { merge: true });

            return {
                success: true,
                message:
                    canRevote && previousChoice
                        ? "투표가 변경되었습니다."
                        : "투표가 완료되었습니다.",
            };
        });
    },
);

exports.closeVoting = onCall(
    { region: "asia-northeast3", cors: true },
    async (request) => {
        const { classId, billId } = request.data || {};
        assertRequiredIds(classId, billId);
        assertTeacherOrAdminFromClaims(request, { classId });

        return db.runTransaction(async (transaction) => {
            const classRef = db.doc(`classes/${classId}`);
            const billRef = db.doc(`classes/${classId}/assemblyBills/${billId}`);
            const criteriaRef = db.doc(
                `classes/${classId}/assemblySettings/criteria`,
            );
            const votersQuery = billRef.collection("voters");

            const [classDoc, billDoc, criteriaDoc] = await transaction.getAll(
                classRef,
                billRef,
                criteriaRef,
            );
            const votersSnap = await transaction.get(votersQuery);

            if (!billDoc.exists) {
                throw new HttpsError("not-found", "해당 법안을 찾을 수 없습니다.");
            }

            const billData = billDoc.data() || {};
            if (billData.status !== "voting") {
                throw new HttpsError(
                    "failed-precondition",
                    "투표 중인 법안만 종료할 수 있습니다.",
                );
            }

            const canonicalVoteCounts = getCanonicalVoteCounts(
                billData,
                votersSnap.docs,
            );
            const agreeCount = canonicalVoteCounts.agree;
            let passThreshold = 18;

            if (
                criteriaDoc.exists &&
                typeof criteriaDoc.data()?.passThreshold === "number"
            ) {
                passThreshold = criteriaDoc.data().passThreshold;
            } else if (
                classDoc.exists &&
                typeof classDoc.data()?.studentCount === "number"
            ) {
                passThreshold = Math.ceil(classDoc.data().studentCount / 2);
            }

            const finalStatus = agreeCount >= passThreshold ? "passed" : "rejected";
            const updatePayload = {
                ...buildVoteCountPayload(canonicalVoteCounts),
                status: finalStatus,
                closedAt: FieldValue.serverTimestamp(),
            };
            let policyApplied = false;
            let appliedDangerLevel = null;
            let ruleId = null;

            if (
                finalStatus === "passed" &&
                billData.registerPoliceRuleOnPass === true
            ) {
                const policyResult = await createPoliceRuleFromBill({
                    classId,
                    billId,
                    billData,
                    transaction,
                });

                updatePayload.isPolicyApplied = true;
                updatePayload.appliedAt = FieldValue.serverTimestamp();
                updatePayload.appliedDangerLevel =
                    policyResult.normalizedDangerLevel;
                policyApplied = true;
                appliedDangerLevel = policyResult.normalizedDangerLevel;
                ruleId = policyResult.ruleId;
            }

            transaction.update(billRef, updatePayload);

            return {
                success: true,
                finalStatus,
                policyApplied,
                appliedDangerLevel,
                ruleId,
            };
        });
    },
);

exports.syncAssemblyBillVoteCounts = onDocumentWritten(
    {
        document: "classes/{classId}/assemblyBills/{billId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const afterSnap = event.data?.after;
        if (!afterSnap?.exists) {
            return;
        }

        await syncBillVoteCounts(afterSnap.ref, afterSnap.data() || {});
    },
);

exports.reopenVoting = onCall(
    { region: "asia-northeast3", cors: true },
    async (request) => {
        const { classId, billId } = request.data || {};
        assertRequiredIds(classId, billId);
        const ctx = assertTeacherOrAdminFromClaims(request, { classId });

        return db.runTransaction(async (transaction) => {
            const billRef = db.doc(`classes/${classId}/assemblyBills/${billId}`);
            const billDoc = await transaction.get(billRef);

            if (!billDoc.exists) {
                throw new HttpsError("not-found", "해당 법안을 찾을 수 없습니다.");
            }

            const billData = billDoc.data() || {};
            if (!["passed", "rejected"].includes(billData.status)) {
                throw new HttpsError(
                    "failed-precondition",
                    "가결 또는 부결된 법안만 다시 열 수 있습니다.",
                );
            }

            if (billData.isPolicyApplied) {
                throw new HttpsError(
                    "failed-precondition",
                    "이미 경찰 규칙으로 반영된 법안은 다시 열 수 없습니다.",
                );
            }

            transaction.update(billRef, {
                status: "voting",
                reopenedAt: FieldValue.serverTimestamp(),
                reopenedBy: ctx.uid,
                closedAt: FieldValue.delete(),
            });

            return {
                success: true,
                message: "투표가 다시 시작되었습니다.",
                previousStatus: billData.status,
            };
        });
    },
);

exports.deleteAssemblyBill = onCall(
    { region: "asia-northeast3", cors: true },
    async (request) => {
        const { classId, billId } = request.data || {};
        assertRequiredIds(classId, billId);
        assertTeacherOrAdminFromClaims(request, { classId });

        const billRef = db.doc(`classes/${classId}/assemblyBills/${billId}`);
        const billSnap = await billRef.get();

        if (!billSnap.exists) {
            throw new HttpsError("not-found", "해당 법안을 찾을 수 없습니다.");
        }

        if (billSnap.data()?.status === "voting") {
            await billRef.set(
                {
                    status: "deleted",
                    deletedAt: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
        }

        await deleteVoterDocs(billRef);
        await billRef.delete();

        return { success: true };
    },
);

exports.applyAssemblyPolicy = onCall(
    { region: "asia-northeast3", cors: true },
    async (request) => {
        const { classId, billId, dangerLevel = 2 } = request.data || {};
        assertRequiredIds(classId, billId);
        assertTeacherOrAdminFromClaims(request, { classId });

        const normalizedDangerLevel = normalizeDangerLevel(dangerLevel);
        if (normalizedDangerLevel == null) {
            throw new HttpsError(
                "invalid-argument",
                "위험도는 1, 2, 3 중 하나여야 합니다.",
            );
        }

        const billRef = db.doc(`classes/${classId}/assemblyBills/${billId}`);
        const billSnap = await billRef.get();

        if (!billSnap.exists) {
            throw new HttpsError("not-found", "해당 법안을 찾을 수 없습니다.");
        }

        const bill = billSnap.data() || {};
        if (bill.status !== "passed") {
            throw new HttpsError(
                "failed-precondition",
                "가결된 법안만 경찰 규칙으로 반영할 수 있습니다.",
            );
        }

        if (bill.isPolicyApplied) {
            return { message: "이미 경찰 규칙으로 반영된 법안입니다." };
        }

        if (!bill.policeRuleData || typeof bill.policeRuleData !== "object") {
            throw new HttpsError(
                "invalid-argument",
                "경찰 규칙으로 반영할 데이터가 없습니다.",
            );
        }

        const policyResult = await createPoliceRuleFromBill({
            classId,
            billId,
            billData: bill,
            dangerLevel: normalizedDangerLevel,
        });

        await billRef.update({
            isPolicyApplied: true,
            appliedAt: FieldValue.serverTimestamp(),
            appliedDangerLevel: policyResult.normalizedDangerLevel,
        });

        return {
            message: "정책이 성공적으로 반영되었습니다.",
            dangerLevel: policyResult.normalizedDangerLevel,
            ruleId: policyResult.ruleId,
        };
    },
);
