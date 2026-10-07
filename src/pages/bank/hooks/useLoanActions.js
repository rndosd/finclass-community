import { useState, useCallback } from "react";
import { buildLoanQuote } from "../utils/bankUtils";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  bankCommandApi,
  createBankClientRequestId,
} from "../services/bankCommandApi";

export default function useLoanActions({
  bankSettings,
  tierAdjustments,
  studentInfo,
  currentTierInfo,
  classId,
}) {
  const { showFeedback } = useFeedback();

  const [selectedLoanProductId, setSelectedLoanProductId] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [showLoanConfirmModal, setShowLoanConfirmModal] = useState(false);
  const [loanConfirmDetails, setLoanConfirmDetails] = useState(null);
  const [isSubmittingLoan, setIsSubmittingLoan] = useState(false);

  const handleOpenLoanConfirmModal = useCallback(() => {
    const product = bankSettings?.loanProducts?.find(
      (item) => String(item.id) === String(selectedLoanProductId),
    );
    if (!product) {
      showFeedback("대출 상품을 선택해 주세요.", "warning");
      return;
    }

    const amountNum = Number(loanAmount);
    if (amountNum <= 0 || Number.isNaN(amountNum)) {
      showFeedback("금액을 정확히 입력해 주세요.", "warning");
      return;
    }

    const tierName = (currentTierInfo?.name || "기본").trim();
    const baseRate = Number(product.periodRate || 0);
    const shouldApplyTierRateAdjustment =
      product.useTierRateAdjustment !== false;
    const modifierApplied = shouldApplyTierRateAdjustment
      ? Number(
          tierAdjustments?.loanRateModifier ??
            tierAdjustments?.[tierName]?.loanRateModifier ??
            0,
        )
      : 0;
    const quote = buildLoanQuote({
      principal: amountNum,
      baseRate,
      weeklyModifier: modifierApplied,
      productDays: product.days || 0,
    });

    setLoanConfirmDetails({
      product,
      loanAmount: amountNum,
      studentCreditInfo: { tierFullName: tierName || "일반" },
      finalCalculations: {
        baseInterestAmount: quote.baseInterestAmount,
        tierBonusInterestAmount: quote.tierBonusInterestAmount,
        totalEstimatedInterest: quote.totalEstimatedInterest,
        finalPeriodRate: quote.finalRate,
      },
      firestoreData: {
        baseRate,
        finalRate: quote.finalRate,
        tierApplied: shouldApplyTierRateAdjustment ? tierName || "기본" : "미적용",
        modifierApplied,
      },
    });

    setShowLoanConfirmModal(true);
  }, [
    selectedLoanProductId,
    bankSettings,
    tierAdjustments,
    loanAmount,
    currentTierInfo,
    showFeedback,
  ]);

  const executeLoanApplication = useCallback(async (contractData = {}) => {
    if (!loanConfirmDetails) return;

    setIsSubmittingLoan(true);
    setShowLoanConfirmModal(false);

    try {
      const requestPayload = {
        classId,
        productId: String(loanConfirmDetails.product.id),
        amount: Number(loanConfirmDetails.loanAmount),
        studentName: studentInfo?.name,
        clientRequestId: createBankClientRequestId(),
        calculatedData: loanConfirmDetails.firestoreData,
      };
      if (typeof contractData?.borrowerSignatureImg === "string") {
        requestPayload.borrowerSignatureImg = contractData.borrowerSignatureImg;
      }

      const response = await bankCommandApi.applyLoan(requestPayload);

      const autoApproved = !!response?.autoApproved;
      showFeedback(
        autoApproved
          ? "대출 신청이 완료되어 즉시 승인 및 지급되었습니다."
          : "대출 신청 완료! 선생님의 승인을 기다려 주세요.",
        "success",
      );
      setLoanAmount("");
    } catch (err) {
      console.error("대출 신청 오류:", err);
      showFeedback(err?.message || "요청 오류", "error");
    } finally {
      setIsSubmittingLoan(false);
      setTimeout(() => setLoanConfirmDetails(null), 300);
    }
  }, [loanConfirmDetails, classId, studentInfo, showFeedback]);

  return {
    selectedLoanProductId,
    setSelectedLoanProductId,
    loanAmount,
    setLoanAmount,
    showLoanConfirmModal,
    setShowLoanConfirmModal,
    loanConfirmDetails,
    handleOpenLoanConfirmModal,
    executeLoanApplication,
    isSubmittingLoan,
  };
}
