// functions/src/lotteryRounds.js - ?꾩꽦??異붿꺼 ?쒖뒪??諛깆뿏??
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("../firebaseAdminCompat");
const crypto = require('crypto');
const { getEligibleParticipantsViaProducts } = require("../utils/lotteryUtils");
const logger = require("firebase-functions/logger");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// 怨듭젙???쒕뜡 ?뷀뵆 ?⑥닔
function cryptoShuffle(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * 1) ?덈줈??異붿꺼 ?뚯감 ?앹꽦
 */
exports.createLotteryRound = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "濡쒓렇?몄씠 ?꾩슂?⑸땲??");

    const role = auth.token?.role;
    if (!["teacher", "admin"].includes(role)) {
        throw new HttpsError("permission-denied", "沅뚰븳???놁뒿?덈떎.");
    }

    const {
        classId, productId, title, description, selectionMethod,
        requiredPayments: rawRequiredPayments, weights: rawWeights,
        scheduledDate, winnerCount: rawWinnerCount = 3, eligibilityDate,
        preventDuplicateWinners = true,
    } = data || {};

    if (!classId || !productId || !title || !selectionMethod || !rawRequiredPayments) {
        throw new HttpsError("invalid-argument", "?꾩닔 ?뺣낫媛 ?꾨씫?섏뿀?듬땲??");
    }

    const requiredPayments = Math.max(1, Math.floor(Number(rawRequiredPayments)));
    const winnerCount = Math.max(1, Math.floor(Number(rawWinnerCount)));

    // ?뵏 1. ?꾩뿭 ?뺤콉 濡쒕뱶 (罹먯떆 ?쒖슜)

    try {
        const result = await db.runTransaction(async (tx) => {
            const productRef = db.doc(`classes/${classId}/subscriptionProducts/${productId}`);

            // READs
            const [productSnap] = await Promise.all([tx.get(productRef)]);

            if (!productSnap.exists) throw new HttpsError("not-found", "泥?빟 ?곹뭹 ?놁쓬");
            const productData = productSnap.data() || {};

            // ?뵏 2. ?뚮옖 ?뺣낫 ?뺤씤

            // 以묐났 ?뚯감 泥댄겕
            const activeSnap = await tx.get(db.collection(`classes/${classId}/lotteryRounds`)
                .where("productId", "==", productId)
                .where("status", "in", ["scheduled", "running"]).limit(1));
            if (!activeSnap.empty) throw new HttpsError("failed-precondition", "?대? 吏꾪뻾 以묒씤 ?뚯감媛 ?덉뒿?덈떎.");

            const nextRoundNumber = (Number(productData.lastRoundNumber || 0)) + 1;
            tx.update(productRef, { lastRoundNumber: nextRoundNumber });

            const roundRef = db.collection(`classes/${classId}/lotteryRounds`).doc();
            tx.set(roundRef, {
                classId, productId, roundNumber: nextRoundNumber, title, description: description || "",
                selectionMethod, requiredPayments, winnerCount, preventDuplicateWinners,
                status: "scheduled", createdAt: FieldValue.serverTimestamp(), createdBy: auth.uid,
                ...(scheduledDate && { scheduledDate: admin.firestore.Timestamp.fromDate(new Date(scheduledDate)) }),
                ...(eligibilityDate && { eligibilityDate: admin.firestore.Timestamp.fromDate(new Date(eligibilityDate)) }),
            });

            return { success: true, roundId: roundRef.id, roundNumber: nextRoundNumber };
        });
        return result;
    } catch (e) {
        throw new HttpsError("internal", e.message);
    }
});
/**
 * 異붿꺼 ?먭꺽??議고쉶 (?몃? ?몄텧??
 */
exports.getLotteryEligibleParticipants = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "濡쒓렇?몄씠 ?꾩슂?⑸땲??");

        const { classId, productId, requiredPayments, eligibilityDate } = data || {};
        if (!classId || !productId || !requiredPayments) {
            throw new HttpsError(
                "invalid-argument",
                "classId, productId, requiredPayments媛 ?꾩슂?⑸땲??"
            );
        }

        try {
            const participants = await getEligibleParticipantsViaProducts({
                classId,
                productId,
                requiredPayments: Math.max(1, Number(requiredPayments)),
                eligibilityDate: eligibilityDate || null,
            });

            return {
                success: true,
                participants,
                totalCount: participants.length,
            };
        } catch (e) {
            console.error("[getLotteryEligibleParticipants] ?ㅻ쪟:", e);
            throw new HttpsError("internal", `李몄뿬??議고쉶 以??ㅻ쪟: ${e.message}`);
        }
    }
);

/**
 * 2) 異붿꺼 ?ㅽ뻾 (以묐났 ?뱀꺼 諛⑹? 濡쒖쭅 ?ы븿)
 */
exports.executeLotteryRound = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "濡쒓렇?몄씠 ?꾩슂?⑸땲??");
    if (!["teacher", "admin"].includes(auth.token?.role)) throw new HttpsError("permission-denied", "沅뚰븳 ?놁쓬");

    const { classId, roundId } = data || {};
    if (!classId || !roundId) throw new HttpsError("invalid-argument", "classId 또는 roundId가 필요합니다.");

    // ?뵏 1. ?꾩뿭 ?뺤콉 濡쒕뱶

    try {
        const roundRef = db.doc(`classes/${classId}/lotteryRounds/${roundId}`);
        const roundSnap = await roundRef.get();
        if (!roundSnap.exists) throw new HttpsError("not-found", "?뚯감 ?놁쓬");
        const round = roundSnap.data();
        if (round.status === "completed") throw new HttpsError("failed-precondition", "이미 완료된 추첨입니다.");

        // ?먭꺽???섏쭛
        const eligibilityDate = round.eligibilityDate?.toDate?.() || round.eligibilityDate || null;
        let participants = await getEligibleParticipantsViaProducts({
            classId, productId: round.productId,
            requiredPayments: Math.max(1, Number(round.requiredPayments || 1)),
            eligibilityDate,
        });

        // 以묐났 ?뱀꺼 諛⑹? ?꾪꽣留?
        if (round.preventDuplicateWinners !== false) {
            const pastSnap = await db.collection(`classes/${classId}/lotteryRounds`)
                .where("productId", "==", round.productId).where("status", "==", "completed").get();
            const prevUids = new Set();
            pastSnap.forEach(d => (d.data().winners || []).forEach(w => prevUids.add(w.uid)));
            participants = participants.filter(p => !prevUids.has(p.uid));
        }

        if (participants.length === 0) throw new HttpsError("failed-precondition", "李몄뿬???놁쓬");

        // ?뱀꺼???좎젙
        const take = Math.min(Number(round.winnerCount || 1), participants.length);
        let winners = [];

        if (round.selectionMethod === "score_ranking") {
            // ?? 1. 湲곕낯媛믨낵 援ъ“ 遺꾪빐 ?좊떦?쇰줈 媛以묒튂 蹂댄샇
            const { paymentCount = 0.6, totalAmount = 0.4 } = round.weights || {};

            participants = participants.map(p => {
                // ?? 2. 媛??섏튂媛 ?レ옄?몄? 媛뺤젣 ?뺣???Number) 諛?0?쇰줈 諛⑹뼱
                const pCount = Number(p.paymentCount || 0);
                const pAmount = Number(p.totalAmount || 0);

                const score = (pCount * paymentCount) + (pAmount * totalAmount);

                return {
                    ...p,
                    score: Number(score.toFixed(2)) // ?뚯닔??2?먮━源뚯? 源붾걫?섍쾶 ?뺣━
                };
            });

            // ?? 3. ?먯닔 ?대┝李⑥닚 ?뺣젹 (?숈젏??諛쒖깮 ??理쒖떊????異붽? ?뺣젹 媛??
            participants.sort((a, b) => b.score - a.score);
            winners = participants.slice(0, take);
        } else {
            // ?쒕뜡 異붿꺼 (湲곗〈 ?좎?)
            winners = cryptoShuffle(participants).slice(0, take);
        }

        // 寃곌낵 ????몃옖??뀡
        await db.runTransaction(async (tx) => {
            const fresh = await tx.get(roundRef);

            if (fresh.data().status === "completed") throw new HttpsError("failed-precondition", "이미 처리된 추첨입니다.");

            tx.update(roundRef, {
                status: "completed",
                lotteryDate: FieldValue.serverTimestamp(),
                winners: winners.map(w => ({ uid: w.uid, name: w.name, paymentCount: w.paymentCount, totalAmount: w.totalAmount, score: w.score ?? null })),
                actualWinnerCount: winners.length,
                totalParticipants: participants.length,
                executedBy: auth.uid,
            });
        });

        return { success: true, winners, totalParticipants: participants.length };
    } catch (e) {
        throw new HttpsError("internal", e.message);
    }
});

/**
 * 異붿꺼 ?뚯감 ?섏젙
 */
exports.updateLotteryRound = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "濡쒓렇?몄씠 ?꾩슂?⑸땲??");

    const role = auth.token?.role;
    if (!["teacher", "admin"].includes(role)) {
        throw new HttpsError("permission-denied", "沅뚰븳???놁뒿?덈떎.");
    }

    const { classId, roundId, updates } = data || {};
    if (!classId || !roundId || !updates || typeof updates !== "object") {
        throw new HttpsError("invalid-argument", "classId, roundId, updates媛 ?꾩슂?⑸땲??");
    }

    try {
        const roundRef = db.doc(`classes/${classId}/lotteryRounds/${roundId}`);
        const roundSnap = await roundRef.get();

        if (!roundSnap.exists) {
            throw new HttpsError("not-found", "異붿꺼 ?뚯감瑜?李얠쓣 ???놁뒿?덈떎.");
        }

        const roundData = roundSnap.data();

        // ?대? 異붿꺼???꾨즺???뚯감???섏젙 遺덇?
        if (roundData.status === "completed") {
            throw new HttpsError("failed-precondition", "?대? 異붿꺼???꾨즺???뚯감???섏젙?????놁뒿?덈떎.");
        }

        // ?섏젙 媛?ν븳 ?꾨뱶留?異붿텧
        const allowedFields = [
            "title",
            "description",
            "selectionMethod",
            "requiredPayments",
            "winnerCount",
            "weights",
            "preventDuplicateWinners"
        ];

        const payload = {};
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                payload[field] = updates[field];
            }
        }

        // 寃利?
        if (payload.requiredPayments !== undefined && payload.requiredPayments < 1) {
            throw new HttpsError("invalid-argument", "?꾩슂 ?⑹엯 ?잛닔??1 ?댁긽?댁뼱???⑸땲??");
        }
        if (payload.winnerCount !== undefined && payload.winnerCount < 1) {
            throw new HttpsError("invalid-argument", "?뱀꺼???섎뒗 1 ?댁긽?댁뼱???⑸땲??");
        }

        payload.updatedAt = FieldValue.serverTimestamp();
        payload.updatedBy = auth.uid;

        await roundRef.update(payload);

        return {
            success: true,
            roundId,
            message: "異붿꺼 ?뚯감媛 ?섏젙?섏뿀?듬땲??"
        };
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        logger.error("[updateLotteryRound] ?ㅻ쪟:", e);
        throw new HttpsError("internal", `異붿꺼 ?뚯감 ?섏젙 以??ㅻ쪟: ${e.message}`);
    }
});

/**
 * 異붿꺼 ?뚯감 ??젣
 */
exports.deleteLotteryRound = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "濡쒓렇?몄씠 ?꾩슂?⑸땲??");

    const role = auth.token?.role;
    if (!["teacher", "admin"].includes(role)) {
        throw new HttpsError("permission-denied", "沅뚰븳???놁뒿?덈떎.");
    }

    const { classId, roundId } = data || {};
    if (!classId || !roundId) {
        throw new HttpsError("invalid-argument", "classId, roundId媛 ?꾩슂?⑸땲??");
    }

    try {
        const roundRef = db.doc(`classes/${classId}/lotteryRounds/${roundId}`);
        const roundSnap = await roundRef.get();

        if (!roundSnap.exists) {
            throw new HttpsError("not-found", "異붿꺼 ?뚯감瑜?李얠쓣 ???놁뒿?덈떎.");
        }

        const roundData = roundSnap.data();
        if (roundData.status === "completed") {
            await roundRef.delete();
            return {
                success: true,
                roundId,
                message: "異붿꺼 ?뚯감媛 ??젣?섏뿀?듬땲??"
            };
        }

        // ?꾨즺???뚯감????젣 ????꾩뭅?대툕 沅뚯옣
        if (roundData.status === "completed") {
            throw new HttpsError(
                "failed-precondition",
                "?꾨즺???뚯감????젣?????놁뒿?덈떎. 湲곕줉 蹂댁〈???꾪빐 ?꾩뭅?대툕瑜??ъ슜?섏꽭??"
            );
        }

        await roundRef.delete();

        return {
            success: true,
            roundId,
            message: "異붿꺼 ?뚯감媛 ??젣?섏뿀?듬땲??"
        };
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        logger.error("[deleteLotteryRound] ?ㅻ쪟:", e);
        throw new HttpsError("internal", `異붿꺼 ?뚯감 ??젣 以??ㅻ쪟: ${e.message}`);
    }
});

/**
 * 異붿꺼 ?대젰 議고쉶
 */
exports.getLotteryHistory = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "濡쒓렇?몄씠 ?꾩슂?⑸땲??");

        const { classId, productId, limit = 20 } = data || {};

        if (!classId) {
            throw new HttpsError("invalid-argument", "classId媛 ?꾩슂?⑸땲??");
        }

        try {
            let query = db.collection(`classes/${classId}/lotteryRounds`)
                .orderBy("roundNumber", "desc")
                .limit(Number(limit));

            if (productId) {
                query = query.where("productId", "==", productId);
            }

            const roundsSnap = await query.get();

            const rounds = roundsSnap.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                scheduledDate: doc.data().scheduledDate?.toDate(),
                lotteryDate: doc.data().lotteryDate?.toDate(),
                eligibilityDate: doc.data().eligibilityDate?.toDate(),
                createdAt: doc.data().createdAt?.toDate(),
                updatedAt: doc.data().updatedAt?.toDate()
            }));

            return {
                success: true,
                rounds,
                total: rounds.length
            };

        } catch (e) {
            console.error("[getLotteryHistory] ?ㅻ쪟:", e);
            throw new HttpsError("internal", `異붿꺼 ?대젰 議고쉶 以??ㅻ쪟: ${e.message}`);
        }
    }
);


