import { appConfirm } from "../../../utils/appDialogs";
import { useState } from "react";

import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { getDepositInterestWithholdingPolicy } from "../../../utils/taxPolicy";
import { calculateFinalInterest, calculateMaturityDate } from "../utils/dateUtils";
import { buildSavingClaimBreakdown } from "../utils/savingPayoutUtils";
import { formatBankMoney } from "../../../utils/bankMoney";
import { bankCommandApi } from "../services/bankCommandApi";
import { buildSavingTerminationMessage } from "../utils/savingTerminationMessage";

export default function useSavingsManagement({
  savings,
  uid,
  classId,
}) {
  const { showFeedback } = useFeedback();
  const {
    userData,
    classData,
    hasPermission,
    isTeacher,
    isAdmin,
    currencyUnit: contextCurrency,
  } = useUser();
  const [isProcessingSaving, setIsProcessingSaving] = useState(false);
  const [claimConfirmDetails, setClaimConfirmDetails] = useState(null);

  const safeCurrencyUnit = contextCurrency || "단위";
  const withholdingPolicy = getDepositInterestWithholdingPolicy(classData);

  const actorUid = userData?.uid;
  const isActuallyMe = actorUid && uid && actorUid === uid;
  const isManager = isTeacher || isAdmin || hasPermission("bank_admin");
  const canManage = isActuallyMe || isManager;

  const closeClaimConfirmModal = () => {
    if (isProcessingSaving) return;
    setClaimConfirmDetails(null);
  };

  const executeSavingAction = async ({ saving, savingId, actionType }) => {
    setIsProcessingSaving(true);
    try {
      const result = await bankCommandApi.processSavingAction({
        classId,
        savingId,
        actionType,
        targetUid: uid,
      });

      const payout = result?.payoutAmount ?? 0;
      if (actionType === "terminate") {
        showFeedback(`중도 해지 완료.\n${buildSavingTerminationMessage({
          principal: saving.amount,
          payoutAmount: result?.payoutAmount,
          interestPaid: result?.interestPaid,
          currencyUnit: safeCurrencyUnit,
        })}`, "success", { autoClose: 12000 });
      } else if (payout > 0) {
        const formatted = formatBankMoney(payout);
        const claimInterestSummary =
          actionType === "claim" && Number(result?.grossInterestPaid || 0) > 0
            ? Number(result?.interestTaxAmount || 0) > 0
              ? ` 세전 이자 ${formatBankMoney(result.grossInterestPaid)}${safeCurrencyUnit}, 원천징수 ${formatBankMoney(result.interestTaxAmount)}${safeCurrencyUnit}, 세후 이자 ${formatBankMoney(result.interestPaid || 0)}${safeCurrencyUnit}`
              : ` 이자 ${formatBankMoney(result.grossInterestPaid)}${safeCurrencyUnit} 포함`
            : "";
        const msgMap = {
          claim: `만기 수령 완료! ${formatted}${safeCurrencyUnit}이 입금되었습니다.${claimInterestSummary}`,
          terminate: `중도 해지 완료. 원금 ${formatted}${safeCurrencyUnit}이 반환되었습니다.`,
          cancel_request: `취소 완료. ${formatted}${safeCurrencyUnit}이 복구되었습니다.`,
        };
        showFeedback(msgMap[actionType] || "처리가 완료되었습니다.", "success");
      } else {
        showFeedback("처리가 완료되었습니다.", "success");
      }

      return result;
    } catch (err) {
      console.error("예금 처리 오류:", err);
      showFeedback(
        err?.details?.message || err?.message || "처리 중 오류가 발생했습니다.",
        "error",
      );
      throw err;
    } finally {
      setIsProcessingSaving(false);
    }
  };

  const confirmClaimAction = async () => {
    if (!claimConfirmDetails?.savingId) return;

    try {
      await executeSavingAction({
        saving: claimConfirmDetails.saving,
        savingId: claimConfirmDetails.savingId,
        actionType: "claim",
      });
      setClaimConfirmDetails(null);
    } catch (_error) {
      // Feedback handled in executeSavingAction
    }
  };

  const processSavingAction = async (savingOrId, actionType) => {
    if (!canManage) {
      return showFeedback("이 작업을 실행할 권한이 없습니다.", "warning");
    }

    const savingId =
      savingOrId && typeof savingOrId === "object" ? savingOrId.id : savingOrId;
    const saving =
      savingOrId && typeof savingOrId === "object"
        ? savingOrId
        : savings?.find((item) => item.id === savingId);
    if (!saving) {
      return showFeedback("예금 정보를 찾을 수 없습니다.", "error");
    }

    const now = new Date();
    const maturityDate = calculateMaturityDate(saving);

    let confirmMsg = "";
    if (actionType === "claim") {
      if (saving.status !== "active") {
        return showFeedback("활성 상태의 예금만 수령할 수 있습니다.", "warning");
      }
      if (!maturityDate || now < maturityDate) {
        return showFeedback("아직 만기가 되지 않았습니다.", "warning");
      }

      const breakdown = buildSavingClaimBreakdown({
        saving,
        withholdingPolicy,
        referenceDate: now,
      });
      const payoutAmount =
        breakdown.totalPaid || (saving.amount || 0) + calculateFinalInterest(saving);
      const detailLines = [
        `원금 ${formatBankMoney(breakdown.principal)}${safeCurrencyUnit}`,
      ];

      if (breakdown.hasInterest) {
        detailLines.push(
          `세전 이자 ${formatBankMoney(breakdown.grossInterest)}${safeCurrencyUnit}`,
        );
        if (breakdown.taxAmount > 0) {
          detailLines.push(
            `원천징수세 ${formatBankMoney(breakdown.taxAmount)}${safeCurrencyUnit} (${breakdown.taxRate}%)`,
          );
        }
        detailLines.push(
          `세후 이자 ${formatBankMoney(breakdown.netInterest)}${safeCurrencyUnit}`,
        );
      }

      setClaimConfirmDetails({
        saving,
        savingId,
        breakdown,
        payoutAmount,
        currencyUnit: safeCurrencyUnit,
      });
      return;
    } else if (actionType === "terminate") {
      if (saving.earlyTerminationBlocked === true) {
        return showFeedback(
          "이 예금 상품은 만기 전 중도해지가 제한되어 있습니다.",
          "warning",
        );
      }

      confirmMsg = `'${saving.productLabel}' 예금을 중도 해지하시겠습니까?\n원금 ${formatBankMoney(saving.amount)}${safeCurrencyUnit}이 반환됩니다.\n만기 전 해지하므로 이자는 지급되지 않으며, 별도 차감액은 없습니다.`;
    } else if (actionType === "cancel_request") {
      confirmMsg = "신청한 예금을 취소하시겠습니까?";
    }

    if (!(await appConfirm(confirmMsg))) return;

    try {
      await executeSavingAction({ saving, savingId, actionType });
    } catch (err) {
      void err;
    }
  };

  return {
    processSavingAction,
    confirmClaimAction,
    closeClaimConfirmModal,
    claimConfirmDetails,
    showClaimConfirmModal: !!claimConfirmDetails,
    isProcessingSaving,
    calculateMaturityDate,
  };
}
