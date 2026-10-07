"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { stageActivityLog, stageCreditLog } = require("../utils/logUtils");
const { stageTaxIncome } = require("../utils/taxIncome");
const { getWithholdingPolicy } = require("../utils/taxPolicy");
const { buildIncomeTaxSnapshot } = require("../utils/incomeTaxUtils");
const {
    assertTeacherAdminOrCreditAdminFromClaims,
    assertTeacherAdminOrAssetManagerFromClaims,
} = require("../utils/permissions");
const { getGlobalConfig } = require("../utils/planManager");

const db = admin.firestore();
const inc = (n) => admin.firestore.FieldValue.increment(n);
const MAX_STUDENTS_PER_BATCH = 200;
const ALLOWED_ADJUST_TYPES = new Set(["asset", "credit", "missionToken", "usdBalance"]);

// FIN adjustments read balances and write the operation receipt and audit logs atomically.
async function adjustForeignBalance({ auth, data, classId, logContext }) {
    const { mode, requestId } = data;
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) {
        throw new HttpsError("invalid-argument", "외화 조정 요청 ID가 필요합니다.");
    }
    let entries;
    if (mode === "absolute") {
        entries = data.adjustments;
    } else if (mode === "increment") {
        if (Array.isArray(data.increments) && data.increments.length) {
            entries = data.increments;
        } else {
            const amount = Number(data.amount);
            if (!Number.isFinite(amount) || amount <= 0 || !["add", "subtract"].includes(data.type)) {
                throw new HttpsError("invalid-argument", "외화 증감값을 확인해 주세요.");
            }
            entries = Array.isArray(data.studentUids) ? data.studentUids.map((uid) => ({
                uid, amount: data.type === "add" ? amount : -amount, reason: data.reason,
            })) : [];
        }
    } else {
        throw new HttpsError("invalid-argument", "지원하지 않는 조정 모드입니다.");
    }
    if (!Array.isArray(entries) || !entries.length || entries.length > MAX_STUDENTS_PER_BATCH) {
        throw new HttpsError("invalid-argument", `외화 조정은 1~${MAX_STUDENTS_PER_BATCH}명을 선택해 주세요.`);
    }
    const seen = new Set();
    const normalized = entries.map((entry) => {
        const uid = entry?.uid;
        const amount = Number(entry?.amount);
        if (typeof uid !== "string" || !uid || uid.includes("/") || seen.has(uid) ||
            !Number.isFinite(amount) || (mode === "absolute" && amount < 0)) {
            throw new HttpsError("invalid-argument", "외화 조정 대상과 금액을 확인해 주세요.");
        }
        seen.add(uid);
        return { uid, amount, reason: String(entry.reason || "") };
    });
    const fingerprint = JSON.stringify({ mode, entries: normalized });
    const receiptRef = db.doc(`classes/${classId}/assetAdjustmentRequests/${auth.uid}_${requestId}`);
    return db.runTransaction(async (transaction) => {
        const receipt = await transaction.get(receiptRef);
        if (receipt.exists) {
            if (receipt.data().fingerprint !== fingerprint) {
                throw new HttpsError("invalid-argument", "이미 사용된 외화 조정 요청 ID입니다.");
            }
            return { success: true, duplicate: true };
        }
        const refs = normalized.map(({ uid }) => db.doc(`classes/${classId}/students/${uid}`));
        const snaps = await transaction.getAll(...refs);
        const updates = normalized.map((entry, index) => {
            if (!snaps[index].exists) throw new HttpsError("not-found", "조정 대상 학생을 찾을 수 없습니다.");
            const previous = Number(snaps[index].data()?.assets?.usdBalance ?? 0);
            const next = mode === "absolute" ? entry.amount : previous + entry.amount;
            if (!Number.isFinite(previous) || !Number.isFinite(next) || next < 0) {
                throw new HttpsError("failed-precondition", "외화 잔액이 부족하거나 유효하지 않습니다.");
            }
            return { ...entry, previous, next, delta: next - previous };
        });
        updates.forEach((entry, index) => {
            if (entry.delta === 0) return;
            transaction.update(refs[index], { "assets.usdBalance": entry.next });
            stageActivityLog(transaction, classId, {
                studentUid: entry.uid,
                type: "admin_adjustment",
                category: mode,
                subCategory: entry.delta > 0 ? "add" : "subtract",
                amount: mode === "absolute" ? entry.next : entry.delta,
                currency: "FIN",
                currencyType: "usdBalance",
                assetType: "usdBalance",
                actorUid: auth.uid,
                source: "admin_adjustment",
                requestId,
                adjustmentDelta: entry.delta,
                adjustmentPreviousAmount: entry.previous,
                adjustmentNextAmount: entry.next,
                description: `[교사 외화 ${mode === "absolute" ? "설정" : "조정"}] ${entry.reason}`,
            }, { ...logContext, forceWrite: true });
        });
        transaction.set(receiptRef, {
            fingerprint, actorUid: auth.uid, adjustType: "usdBalance",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { success: true };
    });
}

function getAdjustTypeMeta(adjustType, currencyUnit) {
    if (adjustType === "credit") {
        return {
            label: "신용점수",
            fieldPath: "creditScore",
            currency: "credit",
            addLabel: "상향",
            subtractLabel: "하향",
        };
    }

    if (adjustType === "missionToken") {
        return {
            label: "미션토큰",
            fieldPath: "assets.missionToken",
            currency: "mission_token",
            addLabel: "지급",
            subtractLabel: "회수",
        };
    }

    return {
        label: "자산",
        fieldPath: "assets.cash",
        currency: currencyUnit,
        addLabel: "지급",
        subtractLabel: "회수",
    };
}

function getCurrentValueByType(studentData = {}, adjustType) {
    if (adjustType === "credit") {
        return Number(studentData?.creditScore || 0);
    }

    if (adjustType === "missionToken") {
        return Number(
            studentData?.assets?.missionToken ?? studentData?.assets?.token ?? 0,
        );
    }

    return Number(studentData?.assets?.cash || 0);
}

function resolveCreditScoreMax(rawCriteria = {}) {
    const rawValue = rawCriteria?.maxScore;
    if (rawValue === null || rawValue === undefined || rawValue === "") {
        return null;
    }

    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) && numericValue > 0
        ? numericValue
        : null;
}

function clampCreditScore(value, creditScoreMax = null) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    if (!Number.isFinite(Number(creditScoreMax)) || Number(creditScoreMax) <= 0) {
        return numericValue;
    }
    return Math.min(Number(creditScoreMax), numericValue);
}

function buildAssetAdjustmentIncomeTax({
    classData = {},
    adjustType,
    deltaAmount,
    requestIncomeSettlement = {},
}) {
    if (adjustType !== "asset") return null;

    const grossAmount = Number(deltaAmount) || 0;
    const isTaxable = requestIncomeSettlement?.taxable === true;
    if (!isTaxable || !(grossAmount > 0)) return null;

    return buildIncomeTaxSnapshot({
        sourceKey: "assetAdjustment",
        grossAmount,
        policy: getWithholdingPolicy(classData, "assetAdjustment") || {},
    });
}

function stageAssetAdjustmentWithholdingTax(batch, {
    classId,
    studentUid,
    actorUid,
    logContext,
    incomeTaxSnapshot,
    classData,
    reason = "",
}) {
    if (!(incomeTaxSnapshot?.withheldAmount > 0)) return null;

    const lineId = `asset_adjustment_${studentUid}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    return stageTaxIncome(
        batch,
        classId,
        {
            amount: incomeTaxSnapshot.withheldAmount,
            source: "asset_adjustment_withholding",
            taxType: "income_tax",
            description: "자산 수동 추가 원천징수",
            studentUid,
            breakdown: {
                baseAmount: incomeTaxSnapshot.grossAmount,
                taxAmount: incomeTaxSnapshot.withheldAmount,
                taxRate: incomeTaxSnapshot.incomeTax.taxRate,
            },
        },
        actorUid,
        {
            ...logContext,
            serviceName: "admin",
            classData,
            sourceKey: "assetAdjustment",
            detailLines: [
                {
                    id: lineId,
                    amount: incomeTaxSnapshot.withheldAmount,
                    source: "asset_adjustment_withholding",
                    taxType: "income_tax",
                    description: reason || "자산 수동 추가 원천징수",
                    studentUid,
                    meta: {
                        incomeTax: incomeTaxSnapshot.incomeTax,
                    },
                },
            ],
        },
    );
}

exports.adjustStudentAssets = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { classId, mode, adjustType = "asset" } = data || {};
        if (!classId || !mode) {
            throw new HttpsError("invalid-argument", "필수 파라미터가 누락되었습니다.");
        }
        if (!ALLOWED_ADJUST_TYPES.has(adjustType)) {
            throw new HttpsError("invalid-argument", `지원하지 않는 조정 타입: ${adjustType}`);
        }

        // 권한:
        // - admin/teacher: 모든 adjustType 허용(교사는 본인 학급만)
        // - credit_admin(a_crd): adjustType === "credit" 인 경우만 허용
        if (adjustType === "asset") {
            await assertTeacherAdminOrAssetManagerFromClaims(request, {
                classId,
            });
        } else {
            await assertTeacherAdminOrCreditAdminFromClaims(request, {
                classId,
                allowCreditAdmin: adjustType === "credit",
            });
        }

        const [globalConfig, classSnap, tierCriteriaSnap] = await Promise.all([
            getGlobalConfig(),
            db.doc(`classes/${classId}`).get(),
            adjustType === "credit"
                ? db.doc(`classes/${classId}/tierCriteria/default`).get()
                : Promise.resolve(null),
        ]);

        const classData = classSnap.exists ? classSnap.data() : {};
        const creditScoreMax = resolveCreditScoreMax(tierCriteriaSnap?.data?.() || {});
        const planType = classData.planType || "FREE";
        const currencyUnit = classData.currencyUnit || "단위";
        const meta = getAdjustTypeMeta(adjustType, currencyUnit);

        const logContext = {
            config: globalConfig,
            planType,
            serviceName: "admin",
        };

        logger.info(`[조정 시작] 타입: ${adjustType}, 모드: ${mode}`);

        try {
            if (adjustType === "usdBalance") {
                return await adjustForeignBalance({ auth, data, classId, logContext });
            }
            if (mode === "increment") {
                const {
                    studentUids = [],
                    amount,
                    reason = "",
                    type = "add",
                    incomeSettlement = null,
                    increments = [],
                } = data;
                const hasIndividualIncrements =
                    Array.isArray(increments) && increments.length > 0;

                if (hasIndividualIncrements) {
                    for (let i = 0; i < increments.length; i += MAX_STUDENTS_PER_BATCH) {
                        const chunk = increments.slice(i, i + MAX_STUDENTS_PER_BATCH);
                        chunk.forEach((entry) => {
                            if (!entry?.uid) {
                                throw new HttpsError(
                                    "invalid-argument",
                                    "조정 대상 학생 정보가 올바르지 않습니다.",
                                );
                            }
                        });

                        const batch = db.batch();
                        const studentRefs = chunk.map((entry) =>
                            db.doc(`classes/${classId}/students/${entry.uid}`),
                        );
                        const studentSnaps =
                            adjustType === "credit" ? await db.getAll(...studentRefs) : [];
                        const studentDataMap = new Map(
                            studentSnaps.map((snap) => [snap.id, snap.data() || {}]),
                        );

                        chunk.forEach((entry) => {
                            const delta = Number(entry.amount);
                            if (!Number.isFinite(delta)) {
                                throw new HttpsError(
                                    "invalid-argument",
                                    "유효하지 않은 증감 값입니다.",
                                );
                            }
                            if (delta === 0) {
                                return;
                            }

                            const entryType = delta > 0 ? "add" : "subtract";
                            const entryReason = String(entry.reason || "");
                            const studentRef = db.doc(
                                `classes/${classId}/students/${entry.uid}`,
                            );

                            if (adjustType === "credit") {
                                const currentScore = getCurrentValueByType(
                                    studentDataMap.get(entry.uid),
                                    adjustType,
                                );
                                const nextScore = clampCreditScore(
                                    currentScore + delta,
                                    creditScoreMax,
                                );
                                const appliedDelta = nextScore - currentScore;

                                if (appliedDelta === 0) {
                                    return;
                                }

                                batch.update(studentRef, { [meta.fieldPath]: nextScore });
                                stageCreditLog(
                                    batch,
                                    classId,
                                    {
                                        studentUid: entry.uid,
                                        delta: appliedDelta,
                                        reason: `[교사 조정] ${entryReason}`,
                                        source: "admin_adjustment",
                                        issuedByUid: auth.uid,
                                        actorName: classData.teacherName || "관리자",
                                        newScore: nextScore,
                                        previousScore: currentScore,
                                        adjustmentMode: mode,
                                        adjustmentType: entryType,
                                    },
                                    logContext,
                                );
                                return;
                            }

                            const incomeTaxSnapshot = buildAssetAdjustmentIncomeTax({
                                classData,
                                adjustType,
                                deltaAmount: delta,
                                requestIncomeSettlement: incomeSettlement,
                            });
                            const appliedDelta =
                                incomeTaxSnapshot && delta > 0 ? incomeTaxSnapshot.netAmount : delta;
                            batch.update(studentRef, { [meta.fieldPath]: inc(appliedDelta) });
                            stageActivityLog(
                                batch,
                                classId,
                                {
                                    studentUid: entry.uid,
                                    type: "admin_adjustment",
                                    category: mode,
                                    subCategory: entryType,
                                    amount: appliedDelta,
                                    description: `[교사 ${meta.label} 조정/${
                                        entryType === "add"
                                            ? meta.addLabel
                                            : meta.subtractLabel
                                    }] ${entryReason}`,
                                    currency: meta.currency,
                                    adjustmentDelta: appliedDelta,
                                    grossAmount: incomeTaxSnapshot?.grossAmount,
                                    withheldAmount: incomeTaxSnapshot?.withheldAmount,
                                    netAmount: incomeTaxSnapshot?.netAmount,
                                    ...(incomeTaxSnapshot
                                        ? { incomeTax: incomeTaxSnapshot.incomeTax }
                                        : {}),
                                },
                                logContext,
                            );
                            stageAssetAdjustmentWithholdingTax(batch, {
                                classId,
                                studentUid: entry.uid,
                                actorUid: auth.uid,
                                logContext,
                                incomeTaxSnapshot,
                                reason: entryReason,
                                classData,
                            });
                        });

                        await batch.commit();
                    }
                } else {
                    if (!Array.isArray(studentUids) || studentUids.length === 0) {
                        throw new HttpsError("invalid-argument", "대상 학생이 없습니다.");
                    }

                    const n = Number(amount);
                    if (!Number.isFinite(n) || n <= 0) {
                        throw new HttpsError("invalid-argument", "조정 수량은 0보다 커야 합니다.");
                    }

                    const delta = type === "add" ? n : -n;

                    for (let i = 0; i < studentUids.length; i += MAX_STUDENTS_PER_BATCH) {
                        const chunk = studentUids.slice(i, i + MAX_STUDENTS_PER_BATCH);
                        const batch = db.batch();
                        const studentRefs = chunk.map((uid) =>
                            db.doc(`classes/${classId}/students/${uid}`),
                        );
                        const studentSnaps =
                            adjustType === "credit" ? await db.getAll(...studentRefs) : [];
                        const studentDataMap = new Map(
                            studentSnaps.map((snap) => [snap.id, snap.data() || {}]),
                        );

                        chunk.forEach((uid) => {
                            const studentRef = db.doc(`classes/${classId}/students/${uid}`);

                            if (adjustType === "credit") {
                                const currentScore = getCurrentValueByType(
                                    studentDataMap.get(uid),
                                    adjustType,
                                );
                                const nextScore = clampCreditScore(
                                    currentScore + delta,
                                    creditScoreMax,
                                );
                                const appliedDelta = nextScore - currentScore;

                                if (appliedDelta === 0) {
                                    return;
                                }

                                batch.update(studentRef, { [meta.fieldPath]: nextScore });
                                stageCreditLog(
                                    batch,
                                    classId,
                                    {
                                        studentUid: uid,
                                        delta: appliedDelta,
                                        reason: `[교사 조정] ${reason}`,
                                        source: "admin_adjustment",
                                        issuedByUid: auth.uid,
                                        actorName: classData.teacherName || "관리자",
                                        newScore: nextScore,
                                        previousScore: currentScore,
                                        adjustmentMode: mode,
                                        adjustmentType: type,
                                    },
                                    logContext,
                                );
                                return;
                            }

                            const incomeTaxSnapshot = buildAssetAdjustmentIncomeTax({
                                classData,
                                adjustType,
                                deltaAmount: delta,
                                requestIncomeSettlement: incomeSettlement,
                            });
                            const appliedDelta =
                                incomeTaxSnapshot && delta > 0 ? incomeTaxSnapshot.netAmount : delta;
                            batch.update(studentRef, { [meta.fieldPath]: inc(appliedDelta) });
                            stageActivityLog(
                                batch,
                                classId,
                                {
                                    studentUid: uid,
                                    type: "admin_adjustment",
                                    category: mode,
                                    subCategory: type,
                                    amount: appliedDelta,
                                    description: `[교사 ${meta.label} 조정/${type === "add" ? meta.addLabel : meta.subtractLabel}] ${reason}`,
                                    currency: meta.currency,
                                    adjustmentDelta: appliedDelta,
                                    grossAmount: incomeTaxSnapshot?.grossAmount,
                                    withheldAmount: incomeTaxSnapshot?.withheldAmount,
                                    netAmount: incomeTaxSnapshot?.netAmount,
                                    ...(incomeTaxSnapshot
                                        ? { incomeTax: incomeTaxSnapshot.incomeTax }
                                        : {}),
                                },
                                logContext,
                            );
                            stageAssetAdjustmentWithholdingTax(batch, {
                                classId,
                                studentUid: uid,
                                actorUid: auth.uid,
                                logContext,
                                incomeTaxSnapshot,
                                reason,
                                classData,
                            });
                        });

                        await batch.commit();
                    }
                }
            } else if (mode === "absolute") {
                const { adjustments = [], incomeSettlement = null } = data;
                if (!Array.isArray(adjustments) || adjustments.length === 0) {
                    throw new HttpsError("invalid-argument", "조정 데이터가 없습니다.");
                }

                for (let i = 0; i < adjustments.length; i += MAX_STUDENTS_PER_BATCH) {
                    const chunk = adjustments.slice(i, i + MAX_STUDENTS_PER_BATCH);
                    const batch = db.batch();
                    const studentRefs = chunk.map((adj) =>
                        db.doc(`classes/${classId}/students/${adj.uid}`),
                    );
                    const studentSnaps = await db.getAll(...studentRefs);
                    const studentDataMap = new Map(
                        studentSnaps.map((snap) => [snap.id, snap.data() || {}]),
                    );

                    chunk.forEach((adj) => {
                        const n = Number(adj.amount);
                        if (!Number.isFinite(n)) {
                            throw new HttpsError("invalid-argument", "유효하지 않은 조정 값입니다.");
                        }

                        const studentRef = db.doc(`classes/${classId}/students/${adj.uid}`);
                        const previousValue = getCurrentValueByType(
                            studentDataMap.get(adj.uid),
                            adjustType,
                        );
                        const nextValue =
                            adjustType === "credit"
                                ? clampCreditScore(n, creditScoreMax)
                                : n;
                        const adjustmentDelta = nextValue - previousValue;

                        if (adjustType === "credit") {
                            batch.update(studentRef, { [meta.fieldPath]: nextValue });
                            stageCreditLog(
                                batch,
                                classId,
                                {
                                    studentUid: adj.uid,
                                    delta: adjustmentDelta,
                                    reason: `[교사 설정] ${adj.reason || ""}`,
                                    source: "admin_adjustment",
                                    issuedByUid: auth.uid,
                                    actorName: classData.teacherName || "관리자",
                                    newScore: nextValue,
                                    previousScore: previousValue,
                                    adjustmentMode: mode,
                                },
                                logContext,
                            );
                            return;
                        }

                        const incomeTaxSnapshot = buildAssetAdjustmentIncomeTax({
                            classData,
                            adjustType,
                            deltaAmount: adjustmentDelta,
                            requestIncomeSettlement: incomeSettlement,
                        });
                        const appliedNextValue =
                            incomeTaxSnapshot && adjustmentDelta > 0
                                ? previousValue + incomeTaxSnapshot.netAmount
                                : nextValue;
                        const appliedAdjustmentDelta = appliedNextValue - previousValue;
                        batch.update(studentRef, { [meta.fieldPath]: appliedNextValue });
                        stageActivityLog(
                            batch,
                            classId,
                            {
                                studentUid: adj.uid,
                                type: "admin_adjustment",
                                category: mode,
                                amount: appliedNextValue,
                                description: `[교사 ${meta.label} 설정] ${adj.reason || ""}`,
                                currency: meta.currency,
                                adjustmentDelta: appliedAdjustmentDelta,
                                adjustmentPreviousAmount: previousValue,
                                adjustmentNextAmount: appliedNextValue,
                                grossAmount: incomeTaxSnapshot?.grossAmount,
                                withheldAmount: incomeTaxSnapshot?.withheldAmount,
                                netAmount: incomeTaxSnapshot?.netAmount,
                                ...(incomeTaxSnapshot
                                    ? { incomeTax: incomeTaxSnapshot.incomeTax }
                                    : {}),
                            },
                            logContext,
                        );
                        stageAssetAdjustmentWithholdingTax(batch, {
                            classId,
                            studentUid: adj.uid,
                            actorUid: auth.uid,
                            logContext,
                            incomeTaxSnapshot,
                            reason: adj.reason || "",
                            classData,
                        });
                    });

                    await batch.commit();
                }
            } else {
                throw new HttpsError("invalid-argument", `지원하지 않는 모드: ${mode}`);
            }

            return { success: true };
        } catch (err) {
            logger.error("Error adjustStudentAssets:", err);
            if (err instanceof HttpsError) throw err;
            throw new HttpsError("internal", err.message || "자산 조정 중 오류가 발생했습니다.");
        }
    },
);
