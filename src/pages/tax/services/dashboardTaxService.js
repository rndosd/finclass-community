// src/pages/tax/services/dashboardTaxService.js

import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions(undefined, 'asia-northeast3');
const recordTaxIncomeCallable = httpsCallable(functions, 'recordTaxIncome');
const recordTaxExpenseCallable = httpsCallable(functions, 'recordTaxExpense');

/**
 * 수동으로 세금 수입 내역을 기록하는 함수
 * @param {object} data - 수입 데이터
 * @param {string} data.classId - 학급 ID
 * @param {number} data.amount - 수입 금액
 * @param {string} data.taxType - 세금 유형 (예: 'manual_income')
 * @param {string} data.description - 수입 사유
 * @returns {Promise<{success: boolean, message?: string}>}
 */
export const recordTaxIncome = async ({ classId, amount, taxType, description }) => {
    if (!classId || !amount || !description) {
        return { success: false, message: "수입 기록에 필요한 정보가 부족합니다." };
    }

    try {
        const result = await recordTaxIncomeCallable({
            classId,
            amount: Number(amount),
            taxType: taxType || 'manual_income',
            description,
        });

        if (!result?.data?.success) {
            return {
                success: false,
                message: result?.data?.message || "세금 수입 기록에 실패했습니다.",
            };
        }

        return { success: true };
    } catch (error) {
        console.error("Error recording tax income:", error);
        return { success: false, message: error.message };
    }
};

/**
 * 세금 지출 내역을 기록하는 함수
 * @param {object} data - 지출 데이터
 * @param {string} data.classId - 학급 ID
 * @param {number} data.amountUsed - 지출 금액
 * @param {string} data.reason - 지출 사유
 * @param {string} data.category - 지출 카테고리 (예: 'general')
 * @returns {Promise<{success: boolean, message?: string}>}
 */
export const recordTaxExpense = async ({ classId, amountUsed, reason, category }) => {
    if (!classId || !amountUsed || !reason) {
        return { success: false, message: "지출 기록에 필요한 정보가 부족합니다." };
    }

    try {
        const result = await recordTaxExpenseCallable({
            classId,
            amountUsed: Number(amountUsed),
            reason,
            category: category || 'general',
        });

        if (!result?.data?.success) {
            return {
                success: false,
                message: result?.data?.message || "세금 지출 기록에 실패했습니다.",
            };
        }

        return { success: true };
    } catch (error) {
        console.error("Error recording tax expense:", error);
        return { success: false, message: error.message };
    }
};

/** ─────────────────────────────────────────────────────
 *  taxSummary 재계산 (전체 기간)
 *  - 선생님/ tax_admin / (전역 admin 허용 시)만 성공
 * ───────────────────────────────────────────────────── */
export const rebuildTaxSummary = async (classId) => {
    if (!classId) return { success: false, message: 'classId가 필요합니다.' };
    try {
        const callable = httpsCallable(functions, 'rebuildTaxSummary');
        const { data } = await callable({ classId });
        return data; // { success, daysCount, totalIncome, totalExpense, byTaxType, byCategory }
    } catch (e) {
        console.error('[rebuildTaxSummary] error:', e);
        return { success: false, message: e?.message || '재계산 실패' };
    }
};

/** ─────────────────────────────────────────────────────
 *  taxSummary 재계산 (기간 지정)
 *  - startDate/endDate: 'YYYY-MM-DD' 둘 다 필요
 * ───────────────────────────────────────────────────── */
export const rebuildTaxSummaryInRange = async (classId, startDate, endDate) => {
    if (!classId || !startDate || !endDate)
        return { success: false, message: 'classId, startDate, endDate가 필요합니다.' };
    try {
        const callable = httpsCallable(functions, 'rebuildTaxSummary');
        const { data } = await callable({ classId, startDate, endDate });
        return data;
    } catch (e) {
        console.error('[rebuildTaxSummaryInRange] error:', e);
        return { success: false, message: e?.message || '재계산 실패' };
    }
};
