import { appConfirm } from "../../../utils/appDialogs";
import { useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { mergeStoredDesk, REAL_ESTATE_STORAGE_VERSION } from '../utils/storageLayout';
import {
  executeClassFundRealEstateTradeAPI,
  executeTransactionAPI,
  createRealEstateClientRequestId,
  payRentAPI,
  payRentDepositAPI,
  settleRentDepositAPI,
  updateDeskStateAPI,
} from '../services/realEstateService';
import { useUser } from '../../../contexts/UserContext';

const toWholeNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

export const useRealEstate = (classId, user, showFeedback) => {
  const [loading, setLoading] = useState(false);
  const actionInFlightRef = useRef(false);
  const { formatCurrency } = useUser();

  const ensureSystemEnabled = async () => {
    if (!classId) {
      throw new Error('학급 정보가 없습니다.');
    }

    const configRef = doc(db, 'classes', classId, 'real_estate', 'config');
    const configSnap = await getDoc(configRef);
    const enabled = !configSnap.exists() || configSnap.data()?.enabled !== false;

    if (!enabled) {
      throw new Error('부동산 시스템이 비활성화되어 있어 이 작업을 진행할 수 없습니다.');
    }
  };

  const getLatestDeskState = async (deskId) => {
    if (!classId || !deskId) return null;

    const layoutRef = doc(db, 'classes', classId, 'real_estate', 'layout');
    const layoutSnap = await getDoc(layoutRef);
    const groups = Array.isArray(layoutSnap.data()?.groups)
      ? layoutSnap.data().groups
      : [];

    for (const group of groups) {
      const desks = Array.isArray(group?.desks) ? group.desks : [];
      const foundDesk = desks.find((desk) => desk?.id === deskId);
      if (foundDesk) {
        if (layoutSnap.data()?.storageSchemaVersion !== REAL_ESTATE_STORAGE_VERSION) return foundDesk;
        const property = await getDoc(doc(db, 'classes', classId, 'real_estate', 'properties', 'items', deskId));
        return mergeStoredDesk(foundDesk, property.exists() ? property.data() : null);
      }
    }

    return null;
  };

  const verifyDeskActionApplied = async (deskId, action, payload = {}) => {
    try {
      const latestDesk = await getLatestDeskState(deskId);
      if (!latestDesk) return false;

      if (action === 'register_sale') {
        const askingPrice = Math.max(0, parseInt(payload.askingPrice, 10) || 0);
        return (
          latestDesk.isForSale === true &&
          String(latestDesk.tradeStatus || '') === 'on_sale' &&
          Number(latestDesk.askingPrice || 0) === askingPrice
        );
      }

      return false;
    } catch (verificationError) {
      console.warn('[useRealEstate] post-error verification failed:', verificationError);
      return false;
    }
  };

  const updateDeskStatus = async (deskId, action, payload = {}, options = {}) => {
    if (actionInFlightRef.current) {
      return false;
    }

    actionInFlightRef.current = true;
    setLoading(true);
    try {
      if (!classId) {
        throw new Error('학급 정보가 없습니다.');
      }

      if (!options.allowWhenDisabled) {
        await ensureSystemEnabled();
      }

      await updateDeskStateAPI({ classId, deskId, action, payload });
      return true;
    } catch (error) {
      const didApply = await verifyDeskActionApplied(deskId, action, payload);
      if (didApply) {
        return true;
      }

      showFeedback(error.message || '작업 처리 중 오류가 발생했습니다.', 'error');
      return false;
    } finally {
      actionInFlightRef.current = false;
      setLoading(false);
    }
  };

  const requestPurchase = async (deskId) =>
    updateDeskStatus(deskId, 'request_purchase');

  const selectContractBuyer = async (deskId, buyerId) =>
    updateDeskStatus(deskId, 'select_contract_buyer', { buyerId });

  const cancelPurchaseRequest = async (deskId) =>
    updateDeskStatus(
      deskId,
      'cancel_purchase_request',
      {},
      { allowWhenDisabled: true },
    );

  const submitSignature = async (desk, _isSeller, _isBuyer, signatureImg, confirmation = {}) =>
    updateDeskStatus(
      desk.id,
      'submit_signature',
      {
        signatureImg: signatureImg || '',
        signerName: confirmation.signerName || '',
        confirmationText: confirmation.confirmationText || '',
        reviewChecklistIds: Array.isArray(confirmation.reviewChecklistIds)
          ? confirmation.reviewChecklistIds
          : [],
        contractDateKey: confirmation.contractDateKey || '',
      },
      { allowWhenDisabled: true },
    );

  const cancelContract = async (deskId) => {
    if (!(await appConfirm('현재 진행 중인 매매 계약을 취소할까요?'))) {
      return false;
    }

    const success = await updateDeskStatus(
      deskId,
      'cancel_contract',
      {},
      { allowWhenDisabled: true },
    );

    if (success) {
      showFeedback('매매 계약을 취소했습니다.', 'info');
    }
    return success;
  };

  const registerSale = async (deskId, price) => {
    const askingPrice = Math.max(0, parseInt(price, 10) || 0);
    const success = await updateDeskStatus(deskId, 'register_sale', { askingPrice });

    if (success) {
      showFeedback('매물로 등록했습니다.', 'success');
    }
    return success;
  };

  const cancelSale = async (deskId) => {
    const success = await updateDeskStatus(
      deskId,
      'cancel_sale',
      {},
      { allowWhenDisabled: true },
    );

    if (success) {
      showFeedback('매물 등록을 해제했습니다.', 'info');
    }
    return success;
  };

  const executePayment = async (desk) => {
    setLoading(true);
    try {
      await ensureSystemEnabled();
      const result = await executeTransactionAPI({
        classId,
        deskId: desk.id,
        buyerName:
          desk.contractState?.buyerName ||
          user?.name ||
          user?.displayName ||
          '구매자',
      });

      if (result.success) {
        showFeedback('매매 결제가 완료되었습니다.', 'success');
        return true;
      }
      return false;
    } catch (error) {
      showFeedback(error.message, 'error');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const executeFundTrade = async ({ deskId, classFundId, action }) => {
    if (actionInFlightRef.current) return false;

    actionInFlightRef.current = true;
    setLoading(true);
    try {
      await ensureSystemEnabled();
      const result = await executeClassFundRealEstateTradeAPI({
        classId,
        deskId,
        classFundId,
        action,
      });
      if (result?.success) {
        showFeedback(
          action === 'purchase'
            ? '기금으로 부동산을 구매했습니다.'
            : '기금 소유 부동산을 국가에 매각했습니다.',
          'success',
        );
        return true;
      }
      return false;
    } catch (error) {
      showFeedback(error.message || '기금 부동산 거래 중 오류가 발생했습니다.', 'error');
      return false;
    } finally {
      actionInFlightRef.current = false;
      setLoading(false);
    }
  };

  const payRent = async ({
    deskId,
    amount = 0,
    days = 0,
    label = '',
  }) => {
    const paymentDays = toWholeNumber(days);
    if (paymentDays <= 0) {
      showFeedback('납부 일수를 먼저 입력해주세요.', 'error');
      return false;
    }

    const paymentLabel = label || `${paymentDays}일`;
    const numericAmount = Math.max(0, Number(amount) || 0);
    const confirmMessage = numericAmount > 0
      ? `${paymentLabel} 임대료 ${formatCurrency(numericAmount)}을 납부할까요?`
      : `${paymentLabel} 임대료를 납부할까요?`;

    if (!(await appConfirm(confirmMessage))) {
      return false;
    }

    setLoading(true);
    try {
      await ensureSystemEnabled();
      const result = await payRentAPI({
        classId,
        deskId,
        days: paymentDays,
        clientRequestId: createRealEstateClientRequestId(),
      });
      if (result.success) {
        showFeedback(result.message || '임대료를 납부했습니다.', 'success');
        return true;
      }
      return false;
    } catch (error) {
      showFeedback(error.message, 'error');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const updateRentFee = async (deskId, newRent, options = {}) => {
    const weeklyRent = Math.max(0, parseInt(newRent, 10) || 0);
    const success = await updateDeskStatus(deskId, 'update_rent_fee', {
      weeklyRent,
      depositAmount: Math.max(0, parseInt(options.depositAmount, 10) || 0),
      rentStartDateKey: options.rentStartDateKey || null,
      rentLastDateKey: options.rentLastDateKey || null,
    });

    if (success) {
      if (weeklyRent > 0) {
        showFeedback(`임대 계약을 ${formatCurrency(weeklyRent)} 기준으로 저장했습니다.`, 'success');
      } else {
        showFeedback('임대 계약을 해제했습니다.', 'info');
      }
    }
    return success;
  };

  const payRentDeposit = async ({
    deskId,
    amount = 0,
    depositAmount = 0,
    rentAmount = 0,
    prepaidDays = 0,
  }) => {
    const message = [
      `첫 납부 금액 ${formatCurrency(amount)}을 납부할까요?`,
      `보증금 ${formatCurrency(depositAmount)} + 임대료 ${prepaidDays}일치 ${formatCurrency(rentAmount)}`,
    ].join('\n');
    if (!(await appConfirm(message))) return false;

    setLoading(true);
    try {
      await ensureSystemEnabled();
      const result = await payRentDepositAPI({
        classId,
        deskId,
        clientRequestId: createRealEstateClientRequestId(),
      });
      if (result?.success) {
        showFeedback(result.message || '첫 납부를 완료했습니다.', 'success');
        return true;
      }
      return false;
    } catch (error) {
      showFeedback(error.message || '첫 납부 중 오류가 발생했습니다.', 'error');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const settleRentDeposit = async ({
    deskId,
    deductionAmount = 0,
    reason = '',
    forceSettle = false,
  }) => {
    setLoading(true);
    try {
      await ensureSystemEnabled();
      const result = await settleRentDepositAPI({
        classId,
        deskId,
        deductionAmount,
        reason,
        forceSettle,
      });
      if (result?.success) {
        showFeedback(result.message || '보증금 정산을 완료했습니다.', 'success');
        return true;
      }
      return false;
    } catch (error) {
      showFeedback(error.message || '보증금 정산 중 오류가 발생했습니다.', 'error');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const terminateRentContract = async (deskId) => {
    const success = await updateDeskStatus(deskId, 'terminate_rent_contract');
    if (success) showFeedback('임대 계약을 종료하고 보증금을 반환했습니다.', 'success');
    return success;
  };

  const replaceRentContract = async (deskId, payload) => {
    const success = await updateDeskStatus(deskId, 'replace_rent_contract', payload);
    if (success) {
      showFeedback('기존 계약을 정산하고 새 계약을 첫 납부 대기로 등록했습니다.', 'success');
    }
    return success;
  };

  return {
    loading,
    registerSale,
    cancelSale,
    requestPurchase,
    selectContractBuyer,
    cancelPurchaseRequest,
    submitSignature,
    cancelContract,
    executePayment,
    executeFundTrade,
    payRent,
    payRentDeposit,
    settleRentDeposit,
    terminateRentContract,
    replaceRentContract,
    updateRentFee,
  };
};
