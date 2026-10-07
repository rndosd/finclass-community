import { useState, useCallback } from "react";
import { buildDepositQuote } from "../utils/bankUtils";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  formatBankMoney,
  resolveTierRateModifier,
} from "../../../utils/bankMoney";
import {
  bankCommandApi,
  createBankClientRequestId,
} from "../services/bankCommandApi";

export default function useDepositActions({
  studentAssets,
  bankSettings,
  tierAdjustments,
  classId,
  currencyUnit,
  currentTierInfo,
  studentName,
  creditScore,
}) {
  const { showFeedback } = useFeedback();

  const [selectedDepositProductId, setSelectedDepositProductId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [showDepositConfirmModal, setShowDepositConfirmModal] = useState(false);
  const [depositConfirmDetails, setDepositConfirmDetails] = useState(null);
  const [isSubmittingDeposit, setIsSubmittingDeposit] = useState(false);

  const handleOpenDepositConfirmModal = useCallback(() => {
    const product = bankSettings?.depositProducts?.find(
      (item) => String(item.id) === String(selectedDepositProductId),
    );
    if (!product) {
      showFeedback("예금 상품을 선택해 주세요.", "warning");
      return;
    }

    const amountNum = Number(depositAmount);
    const myCash = Number(studentAssets?.cash ?? 0);
    const minCredit = Number(product.minCreditScore ?? 0);
    const currentCredit = Number(creditScore ?? 0);

    if (amountNum <= 0 || Number.isNaN(amountNum)) {
      showFeedback("금액을 정확히 입력해 주세요.", "warning");
      return;
    }
    if (myCash < amountNum) {
      showFeedback(
        `잔액이 부족합니다. (보유: ${formatBankMoney(myCash)}${currencyUnit})`,
        "warning",
      );
      return;
    }
    if (currentCredit < minCredit) {
      showFeedback(`신용점수가 부족합니다. (필요: ${minCredit}점)`, "error");
      return;
    }

    const baseRate = Number(product.rate || 0);
    const tierName = (currentTierInfo?.name || "기본").trim();
    const modifierApplied = resolveTierRateModifier(
      product.useTierRateAdjustment,
      tierAdjustments?.depositRateModifier ??
        tierAdjustments?.[tierName]?.depositRateModifier ??
        0,
    );

    const quote = buildDepositQuote({
      principal: amountNum,
      baseRate,
      weeklyModifier: modifierApplied,
      productDays: product.days || 0,
    });

    setDepositConfirmDetails({
      product,
      depositAmount: amountNum,
      studentCreditInfo: { tierFullName: tierName },
      finalCalculations: {
        baseInterestAmount: quote.baseInterestAmount,
        tierBonusInterestAmount: quote.tierBonusInterestAmount,
        totalEstimatedInterest: quote.totalEstimatedInterest,
        finalPeriodRate: quote.finalRate,
      },
      firestoreData: {
        baseRate,
        finalRate: quote.finalRate,
        tierApplied: tierName,
        modifierApplied,
      },
    });

    setShowDepositConfirmModal(true);
  }, [
    selectedDepositProductId,
    bankSettings,
    tierAdjustments,
    depositAmount,
    studentAssets,
    currentTierInfo,
    creditScore,
    currencyUnit,
    showFeedback,
  ]);

  const executeDepositApplication = useCallback(async () => {
    if (!depositConfirmDetails) return;

    setIsSubmittingDeposit(true);
    setShowDepositConfirmModal(false);

    try {
      const payload = {
        classId,
        productId: String(depositConfirmDetails.product.id),
        amount: Number(depositConfirmDetails.depositAmount),
        studentName,
        clientRequestId: createBankClientRequestId(),
        calculatedData: depositConfirmDetails.firestoreData,
      };

      const response = await bankCommandApi.applyDeposit(payload);
      const autoApproved = !!response?.autoApproved;

      showFeedback(
        autoApproved
          ? "예금 신청이 완료되어 즉시 승인되었습니다."
          : "예금 신청이 완료되었습니다. 선생님의 승인 후 가입됩니다!",
        "success",
      );
      setDepositAmount("");
    } catch (err) {
      console.error("예금 신청 오류:", err);
      const errorMessage =
        err?.details?.message ||
        err?.message ||
        "요청 중 오류가 발생했습니다.";
      showFeedback(errorMessage, "error");
    } finally {
      setIsSubmittingDeposit(false);
      setDepositConfirmDetails(null);
    }
  }, [depositConfirmDetails, classId, studentName, showFeedback]);

  return {
    selectedDepositProductId,
    setSelectedDepositProductId,
    depositAmount,
    setDepositAmount,
    showDepositConfirmModal,
    setShowDepositConfirmModal,
    depositConfirmDetails,
    handleOpenDepositConfirmModal,
    executeDepositApplication,
    isSubmittingDeposit,
  };
}
