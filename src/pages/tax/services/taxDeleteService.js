// src/pages/tax/services/taxDeleteService.js

import { getFunctions, httpsCallable } from 'firebase/functions';

// 리전 설정 추가 - asia-northeast3로 명시
const functions = getFunctions(undefined, 'asia-northeast3');

// Firebase Functions 호출
const deleteTaxIncomeFunction = httpsCallable(functions, 'deleteTaxIncome');
const deleteTaxExpenseFunction = httpsCallable(functions, 'deleteTaxExpense');
const bulkDeleteTaxDataFunction = httpsCallable(functions, 'bulkDeleteTaxData');

/**
 * 세금 수입 삭제
 */
export const deleteTaxIncome = async (classId, taxIncomeId) => {
    try {
        const result = await deleteTaxIncomeFunction({
            classId,
            taxIncomeId
        });

        return {
            success: true,
            message: result.data.message,
            deletedAmount: result.data.deletedAmount
        };
    } catch (error) {
        console.error('[deleteTaxIncome] Error:', error);
        return {
            success: false,
            message: error.message || '세금 수입 삭제 중 오류가 발생했습니다.'
        };
    }
};

/**
 * 세금 지출 삭제
 */
export const deleteTaxExpense = async (classId, taxExpenseId) => {
    try {
        const result = await deleteTaxExpenseFunction({
            classId,
            taxExpenseId
        });

        return {
            success: true,
            message: result.data.message,
            deletedAmount: result.data.deletedAmount,
            category: result.data.category
        };
    } catch (error) {
        console.error('[deleteTaxExpense] Error:', error);
        return {
            success: false,
            message: error.message || '세금 지출 삭제 중 오류가 발생했습니다.'
        };
    }
};

/**
 * 일괄 세금 데이터 삭제
 */
export const bulkDeleteTaxData = async (classId, incomeIds = [], expenseIds = []) => {
    try {
        const result = await bulkDeleteTaxDataFunction({
            classId,
            incomeIds,
            expenseIds
        });

        return {
            success: true,
            message: result.data.message,
            deletedIncomeAmount: result.data.deletedIncomeAmount,
            deletedExpenseAmount: result.data.deletedExpenseAmount
        };
    } catch (error) {
        console.error('[bulkDeleteTaxData] Error:', error);
        return {
            success: false,
            message: error.message || '일괄 삭제 중 오류가 발생했습니다.'
        };
    }
};