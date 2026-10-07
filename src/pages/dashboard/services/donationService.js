// src/pages/dashboard/services/donationService.js
import { httpsCallable } from "firebase/functions";
import { functions, db } from "../../../firebase";
import { doc, setDoc } from "firebase/firestore";

/** 학생이 기부하기 */
export async function makeDonation({ classId, amount, clientRequestId }) {
    const n = Number(amount);
    if (!classId || !Number.isFinite(n) || n <= 0) {
        return { success: false, message: "유효하지 않은 금액 또는 학급입니다." };
    }
    try {
        const call = httpsCallable(functions, "makeDonation");
        const { data } = await call({ classId, amount: n, ...(clientRequestId ? { clientRequestId } : {}) });
        return data ?? { success: false, message: "응답이 올바르지 않습니다." };
    } catch (err) {
        const msg =
            err?.code === "functions/unauthenticated"
                ? "로그인이 필요합니다."
                : err?.message || "기부 처리 중 오류가 발생했습니다.";
        return { success: false, message: msg, code: err?.code };
    }
}

/** 기부 목표 설정(교사) */
export async function setDonationGoal({ classId, newGoal }) {
    const goalAmount = Number(newGoal);
    if (!classId || isNaN(goalAmount) || goalAmount < 0) {
        return { success: false, message: "유효하지 않은 목표 금액입니다." };
    }
    try {
        const summaryDocRef = doc(
            db,
            `classes/${classId}/dashboardSummary/donationSummary`
        );
        await setDoc(summaryDocRef, { goalAmount }, { merge: true });
        return { success: true, message: "기부 목표가 성공적으로 설정되었습니다." };
    } catch (error) {
        console.error("[setDonationGoal] error:", error);
        return { success: false, message: "목표 설정 중 오류가 발생했습니다." };
    }
}

/** 기부 순위 학생 공개 여부 설정(선생님 전용) */
export async function setDonationLeaderboardVisibility({
    classId,
    visible,
}) {
    if (!classId || typeof visible !== "boolean") {
        return {
            success: false,
            message: "기부 순위 공개 설정값이 올바르지 않습니다.",
        };
    }
    try {
        const summaryDocRef = doc(
            db,
            `classes/${classId}/dashboardSummary/donationSummary`
        );
        await setDoc(
            summaryDocRef,
            { showLeaderboardToStudents: visible },
            { merge: true }
        );
        return {
            success: true,
            message: visible
                ? "학생용 기부 순위를 표시하도록 설정했습니다."
                : "학생용 기부 순위를 숨기도록 설정했습니다.",
        };
    } catch (error) {
        console.error("[setDonationLeaderboardVisibility] error:", error);
        return {
            success: false,
            message: "기부 순위 공개 설정을 저장하지 못했습니다.",
        };
    }
}

/** 기부 내역 삭제(교사) */
export async function deleteDonation({ classId, donationId, refund = true }) {
    if (!classId || !donationId) {
        return { success: false, message: "잘못된 요청입니다." };
    }
    try {
        const call = httpsCallable(functions, "deleteDonation");
        const { data } = await call({ classId, donationId, refund });
        return data ?? { success: false, message: "응답이 올바르지 않습니다." };
    } catch (err) {
        const msg =
            err?.code === "functions/permission-denied"
                ? "권한이 없습니다."
                : err?.code === "functions/not-found"
                    ? "기부 내역을 찾을 수 없습니다."
                    : err?.code === "functions/failed-precondition"
                        ? "요청을 처리할 수 없습니다."
                        : err?.message || "삭제 처리 중 오류가 발생했습니다.";
        return { success: false, message: msg };
    }
}

/** 기부금 음수 잔액을 0으로 보정(교사) */
export async function adjustDonationBalanceToZero({ classId, reason = "" }) {
    if (!classId) {
        return { success: false, message: "학급 정보가 없습니다." };
    }
    try {
        const call = httpsCallable(functions, "adjustDonationBalanceToZero");
        const { data } = await call({ classId, reason });
        return data ?? { success: false, message: "응답이 올바르지 않습니다." };
    } catch (err) {
        const msg =
            err?.code === "functions/unauthenticated"
                ? "로그인이 필요합니다."
                : err?.code === "functions/permission-denied"
                    ? "권한이 없습니다."
                    : err?.code === "functions/failed-precondition"
                        ? "0보다 작은 기부금 잔액이 있을 때만 보정할 수 있습니다."
                        : err?.message || "기부금 잔액 보정 중 오류가 발생했습니다.";
        return { success: false, message: msg };
    }
}

/** ✅ 기부금 → 세금 전입(이동)만 기록 */
export async function transferDonationToTax({ classId, amount }) {
    const n = Number(amount);
    if (!classId || !Number.isFinite(n) || n <= 0) {
        return { success: false, message: "유효하지 않은 금액 또는 학급입니다." };
    }
    try {
        const call = httpsCallable(functions, "transferDonationToTax");
        const { data } = await call({ classId, amount: n });
        return data ?? { success: false, message: "응답이 올바르지 않습니다." };
    } catch (err) {
        const msg =
            err?.code === "functions/unauthenticated"
                ? "로그인이 필요합니다."
                : err?.code === "functions/permission-denied"
                    ? "권한이 없습니다."
                    : err?.code === "functions/failed-precondition"
                        ? "이동 금액이 잔액보다 큽니다."
                        : err?.message || "이동 처리 중 오류가 발생했습니다.";
        return { success: false, message: msg };
    }
}

/** 세금 → 기부금 이동 */
export async function transferTaxToDonation({ classId, amount }) {
    const n = Number(amount);
    if (!classId || !Number.isFinite(n) || n <= 0) {
        return { success: false, message: "유효하지 않은 금액 또는 학급입니다." };
    }
    try {
        const call = httpsCallable(functions, "transferTaxToDonation");
        const { data } = await call({ classId, amount: n });
        return data ?? { success: false, message: "응답이 올바르지 않습니다." };
    } catch (err) {
        const msg =
            err?.code === "functions/unauthenticated"
                ? "로그인이 필요합니다."
                : err?.code === "functions/permission-denied"
                    ? "권한이 없습니다."
                    : err?.code === "functions/failed-precondition"
                        ? "이동 금액이 세금 잔액보다 큽니다."
                        : err?.message || "이동 처리 중 오류가 발생했습니다.";
        return { success: false, message: msg };
    }
}

/**
 * ✅ 기부금 사용(차감) + 사용내역 기록(교사)
 * - 옵션: taxIncomes에도 동시 기록 (recordAsTaxIncome, taxType)
 */
export async function spendDonation({
    classId,
    amount,
    reason = "",
    category = "",
    items = [],
    recordAsTaxIncome = false,
    taxType = "donation_transfer", // 기본 세금 타입 키
}) {
    const n = Number(amount);
    if (!classId || !Number.isFinite(n) || n <= 0) {
        return { success: false, message: "유효하지 않은 금액 또는 학급입니다." };
    }
    try {
        const call = httpsCallable(functions, "spendDonation");
        const { data } = await call({
            classId,
            amount: n,
            reason,
            category,
            items: Array.isArray(items) ? items : [],
            recordAsTaxIncome: !!recordAsTaxIncome,
            taxType,
        });
        return data ?? { success: false, message: "응답이 올바르지 않습니다." };
    } catch (err) {
        const msg =
            err?.code === "functions/unauthenticated"
                ? "로그인이 필요합니다."
                : err?.code === "functions/permission-denied"
                    ? "권한이 없습니다."
                    : err?.code === "functions/failed-precondition"
                        ? "사용 금액이 잔액보다 큽니다."
                        : err?.message || "사용 처리 중 오류가 발생했습니다.";
        return { success: false, message: msg };
    }
}
