import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase';

export const createRealEstateClientRequestId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `realestate_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export const executeTransactionAPI = async ({ classId, deskId, buyerName }) => {
  try {
    const executeFn = httpsCallable(functions, 'executeRealEstateTransaction');
    const result = await executeFn({ classId, deskId, buyerName });
    return result.data;
  } catch (error) {
    console.error('Cloud Function Error (Transaction):', error);
    const message =
      (typeof error?.details === 'string' && error.details) ||
      error?.details?.message ||
      error?.message ||
      '거래 처리 중 서버 오류가 발생했습니다.';
    throw new Error(message);
  }
};

export const payRentAPI = async ({ classId, deskId, weeks, days, clientRequestId }) => {
  try {
    const payRentFn = httpsCallable(functions, 'payRent');
    const result = await payRentFn({ classId, deskId, weeks, days, clientRequestId });
    return result.data;
  } catch (error) {
    console.error('Cloud Function Error (Pay Rent):', error);
    const message =
      (typeof error?.details === 'string' && error.details) ||
      error?.details?.message ||
      error?.message ||
      '임대료 납부 처리 중 오류가 발생했습니다.';
    throw new Error(message);
  }
};

export const updateDeskStateAPI = async ({ classId, deskId, action, payload = {} }) => {
  try {
    const mutateFn = httpsCallable(functions, 'updateRealEstateDeskState');
    const result = await mutateFn({ classId, deskId, action, payload });
    return result.data;
  } catch (error) {
    console.error('Cloud Function Error (Update Desk State):', error);
    const message =
      (typeof error?.details === 'string' && error.details) ||
      error?.details?.message ||
      error?.message ||
      '부동산 상태 변경 중 오류가 발생했습니다.';
    throw new Error(message);
  }
};

export const payRentDepositAPI = async ({ classId, deskId, clientRequestId }) => {
  try {
    const payDepositFn = httpsCallable(functions, 'payRentDeposit');
    const result = await payDepositFn({ classId, deskId, clientRequestId });
    return result.data;
  } catch (error) {
    console.error('Cloud Function Error (Pay Rent Deposit):', error);
    const message =
      (typeof error?.details === 'string' && error.details) ||
      error?.details?.message ||
      error?.message ||
      '보증금 납부 처리 중 오류가 발생했습니다.';
    throw new Error(message);
  }
};

export const settleRentDepositAPI = async ({
  classId,
  deskId,
  deductionAmount = 0,
  reason = '',
  forceSettle = false,
}) => {
  try {
    const settleDepositFn = httpsCallable(functions, 'settleRentDeposit');
    const result = await settleDepositFn({
      classId,
      deskId,
      deductionAmount,
      reason,
      forceSettle,
    });
    return result.data;
  } catch (error) {
    console.error('Cloud Function Error (Settle Rent Deposit):', error);
    const message =
      (typeof error?.details === 'string' && error.details) ||
      error?.details?.message ||
      error?.message ||
      '보증금 정산 처리 중 오류가 발생했습니다.';
    throw new Error(message);
  }
};

export const executeClassFundRealEstateTradeAPI = async ({
  classId,
  deskId,
  classFundId,
  action,
}) => {
  try {
    const executeFn = httpsCallable(functions, 'executeClassFundRealEstateTrade');
    const result = await executeFn({ classId, deskId, classFundId, action });
    return result.data;
  } catch (error) {
    console.error('Cloud Function Error (Class Fund Real Estate Trade):', error);
    const message =
      (typeof error?.details === 'string' && error.details) ||
      error?.details?.message ||
      error?.message ||
      '기금 부동산 거래 중 서버 오류가 발생했습니다.';
    throw new Error(message);
  }
};

export const updateRealEstateRentContractsBulkAPI = async ({
  classId,
  deskIds,
  weeklyRent,
  depositAmount,
  rentStartDateKey,
  rentLastDateKey,
  settleExpiredContracts = false,
  allowSystemCoverage = false,
  previewOnly = false,
  previewHash,
  clientRequestId,
}) => {
  try {
    const updateFn = httpsCallable(functions, 'updateRealEstateRentContractsBulk');
    const result = await updateFn({
      classId,
      deskIds,
      weeklyRent,
      depositAmount,
      rentStartDateKey,
      rentLastDateKey,
      ...(settleExpiredContracts ? { settleExpiredContracts, allowSystemCoverage, previewOnly, previewHash: previewHash || null, clientRequestId } : {}),
    });
    return result.data;
  } catch (error) {
    console.error('Cloud Function Error (Bulk Rent Contracts):', error);
    const message =
      (typeof error?.details === 'string' && error.details) ||
      error?.details?.message ||
      error?.message ||
      '임대 계약 일괄 설정 중 오류가 발생했습니다.';
    throw new Error(message);
  }
};

export const updateAuctionStateAPI = async ({ classId, action, payload = {} }) => {
  try {
    const mutateFn = httpsCallable(functions, 'updateRealEstateAuctionState');
    const result = await mutateFn({ classId, action, payload });
    return result.data;
  } catch (error) {
    console.error('Cloud Function Error (Update Auction State):', error);
    const message =
      (typeof error?.details === 'string' && error.details) ||
      error?.details?.message ||
      error?.message ||
      '??? ?? ?? ? ??? ??????.';
    throw new Error(message);
  }
};

export const adjustMarketPriceAPI = async ({
  classId,
  deskIds,
  adjustmentRate,
  targetPrice,
  reason,
  reasonType,
}) => {
  try {
    const adjustFn = httpsCallable(functions, 'adjustMarketPrice');
    const result = await adjustFn({
      classId,
      deskIds,
      adjustmentRate,
      targetPrice,
      reason,
      reasonType,
    });
    return result.data;
  } catch (error) {
    console.error('Cloud Function Error (Adjust Market Price):', error);
    const message =
      (typeof error?.details === 'string' && error.details) ||
      error?.details?.message ||
      error?.message ||
      '시세 조정 처리 중 오류가 발생했습니다.';
    throw new Error(message);
  }
};

export const updateRealEstateLedgerStateAPI = async ({
  classId,
  action,
  ledgerIds,
}) => {
  try {
    const updateFn = httpsCallable(functions, 'updateRealEstateLedgerState');
    const result = await updateFn({
      classId,
      action,
      ledgerIds,
    });
    return result.data;
  } catch (error) {
    console.error('Cloud Function Error (Update Real Estate Ledger State):', error);
    const message =
      (typeof error?.details === 'string' && error.details) ||
      error?.details?.message ||
      error?.message ||
      '거래기록 정리 중 오류가 발생했습니다.';
    throw new Error(message);
  }
};

export const updateRealEstateRentPaymentStateAPI = async ({
  classId,
  deskId,
  action,
  paymentIds,
}) => {
  try {
    const updateFn = httpsCallable(functions, 'updateRealEstateRentPaymentState');
    const result = await updateFn({
      classId,
      deskId,
      action,
      paymentIds,
    });
    return result.data;
  } catch (error) {
    console.error('Cloud Function Error (Update Real Estate Rent Payment State):', error);
    const message =
      (typeof error?.details === 'string' && error.details) ||
      error?.details?.message ||
      error?.message ||
      '임대기록 정리 중 오류가 발생했습니다.';
    throw new Error(message);
  }
};
