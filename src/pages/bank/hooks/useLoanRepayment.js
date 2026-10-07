// src/pages/bank/hooks/useLoanRepayment.js
import { useRef, useState } from "react";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { formatBankMoney } from "../../../utils/bankMoney";
import {
  bankCommandApi,
  createBankClientRequestId,
} from "../services/bankCommandApi";

export default function useLoanRepayment({
  classId,
  currencyUnit = "",
  refreshStudentData,
}) {
  const { showFeedback } = useFeedback();
  const [isRepayingLoan, setIsRepayingLoan] = useState(false);
  const repayInFlightRef = useRef(false);

  const handleRepayLoan = async (loanId, amount) => {
    const amountToPay = Number(amount);

    if (!loanId) {
      showFeedback("상환할 대출 정보를 찾을 수 없습니다.", "error");
      return { success: false };
    }

    if (Number.isNaN(amountToPay) || amountToPay <= 0) {
      showFeedback("상환 금액을 올바르게 입력해주세요.", "warning");
      return { success: false };
    }

    if (repayInFlightRef.current) {
      return { success: false, skipped: true };
    }

    repayInFlightRef.current = true;
    setIsRepayingLoan(true);

    try {
      const result = await bankCommandApi.repayLoan({
        classId,
        loanId,
        amount: amountToPay,
        clientRequestId: createBankClientRequestId(),
      });

      const { success, message, paidPrincipal, paidInterest, paidPenalty } =
        result || {};

      if (!success) {
        throw new Error(message || "상환 처리에 실패했습니다.");
      }

      const totalPaid =
        Number(paidPrincipal || 0) +
        Number(paidInterest || 0) +
        Number(paidPenalty || 0);

      showFeedback(
        `${formatBankMoney(totalPaid)}${currencyUnit} 상환이 완료되었습니다.`,
        "success",
      );

      if (refreshStudentData) {
        await refreshStudentData();
      }

      return {
        success: true,
        data: result,
      };
    } catch (err) {
      console.error("대출 상환 오류:", err);
      const message =
        err?.details?.message || err?.message || "상환 처리 중 오류가 발생했습니다.";
      showFeedback(`상환 실패: ${message}`, "error");

      return {
        success: false,
        error: err,
      };
    } finally {
      repayInFlightRef.current = false;
      setIsRepayingLoan(false);
    }
  };

  return {
    isRepayingLoan,
    handleRepayLoan,
  };
}
