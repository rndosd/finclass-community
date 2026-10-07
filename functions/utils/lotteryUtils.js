// functions/utils/lotteryUtils.js
"use strict";

const admin = require("../firebaseAdminCompat");

const db = admin.firestore();

function toDateOrNull(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === "function") return value.toDate();

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeStudentNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

async function getEligibleParticipantsViaProducts({
    classId,
    productId,
    requiredPayments,
    eligibilityDate = null,
}) {
    const minPayments = Math.max(1, toNumber(requiredPayments, 1));
    const cutoffDate = eligibilityDate ? toDateOrNull(eligibilityDate) : null;

    if (eligibilityDate && !cutoffDate) {
        throw new Error("Invalid eligibilityDate");
    }

    const subsSnap = await db.collection(`classes/${classId}/subscriptions`).get();
    if (subsSnap.empty) return [];

    const studentRefs = subsSnap.docs.map((docSnap) =>
        db.doc(`classes/${classId}/students/${docSnap.id}`),
    );
    const studentSnaps = studentRefs.length ? await db.getAll(...studentRefs) : [];
    const studentMap = new Map(
        studentSnaps.map((snap) => [snap.id, (snap.exists ? snap.data() : {}) || {}]),
    );

    const eligible = [];

    for (const docSnap of subsSnap.docs) {
        const uid = docSnap.id;
        const subData = docSnap.data() || {};
        const productSub = subData?.activeSubscriptions?.[productId];

        if (!productSub || productSub.isWithdrawn || productSub.isTerminated) continue;

        const paymentHistory = Array.isArray(productSub.paymentHistory)
            ? productSub.paymentHistory
            : [];

        const validHistory = paymentHistory.filter((entry) => {
            if (!entry || entry.isCancelled) return false;
            if (!cutoffDate) return true;

            const paidAt = toDateOrNull(entry.date || entry.paymentDate);
            return !!paidAt && paidAt.getTime() <= cutoffDate.getTime();
        });

        const paymentCount = validHistory.length;
        if (paymentCount < minPayments) continue;

        const totalAmount = validHistory.reduce(
            (sum, entry) => sum + toNumber(entry.amount, 0),
            0,
        );
        const latestPayment = validHistory[validHistory.length - 1];
        const lastPaymentDate = toDateOrNull(latestPayment?.date || latestPayment?.paymentDate);

        const student = studentMap.get(uid) || {};
        const studentNumber = normalizeStudentNumber(student.studentNumber);
        const name =
            student.name ||
            productSub.studentName ||
            `student-${String(uid).slice(-6)}`;

        eligible.push({
            uid,
            name,
            studentNumber,
            paymentCount,
            totalAmount,
            lastPaymentDate: lastPaymentDate
                ? admin.firestore.Timestamp.fromDate(lastPaymentDate)
                : null,
        });
    }

    eligible.sort((a, b) => {
        const aNum = a.studentNumber ?? Number.MAX_SAFE_INTEGER;
        const bNum = b.studentNumber ?? Number.MAX_SAFE_INTEGER;
        if (aNum !== bNum) return aNum - bNum;
        return String(a.name || "").localeCompare(String(b.name || ""), "ko");
    });

    return eligible;
}

module.exports = { getEligibleParticipantsViaProducts };
