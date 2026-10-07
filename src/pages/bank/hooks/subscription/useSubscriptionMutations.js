import { useMutation } from "@tanstack/react-query";
import { getFunctions, httpsCallable } from "firebase/functions";

import app from "../../../../firebase";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { formatBankMoney } from "../../../../utils/bankMoney";

const functions = getFunctions(app, "asia-northeast3");

export const useSubscriptionMutations = (classId, uid) => {
  const { showFeedback } = useFeedback();

  const payMutation = useMutation({
    mutationFn: async ({ productId, amount }) => {
      const fn = httpsCallable(functions, "processSubscriptionPayment");
      const response = await fn({ classId, productId, amount });
      return response.data;
    },
    onSuccess: (data) => {
      if (data?.success) {
        showFeedback("청약 납입이 완료되었습니다.", "success");
      }
    },
    onError: (error) => {
      showFeedback(error.message || "청약 납입 중 오류가 발생했습니다.", "error");
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async ({ productId, studentUid }) => {
      const fn = httpsCallable(functions, "withdrawFromProduct");
      const response = await fn({ classId, productId, studentUid: studentUid || uid });
      return response.data;
    },
    onSuccess: (data) => {
      if (data?.success) {
        showFeedback(
          `만기 수령이 완료되었습니다. ${formatBankMoney(data.total)}원이 지급되었습니다.`,
          "success",
        );
      }
    },
    onError: (error) => {
      showFeedback(error.message || "만기 수령 처리 중 오류가 발생했습니다.", "error");
    },
  });

  const terminateMutation = useMutation({
    mutationFn: async ({ productId, studentUid }) => {
      const fn = httpsCallable(functions, "terminateSubscription");
      const response = await fn({ classId, productId, studentUid: studentUid || uid });
      return response.data;
    },
    onSuccess: (data) => {
      if (data?.success) {
        showFeedback(
          `청약을 해지했습니다. 원금과 이자 포함 ${formatBankMoney(data.total)}원이 지급되었습니다.`,
          "success",
        );
      }
    },
    onError: (error) => {
      showFeedback(error.message || "청약 해지 처리 중 오류가 발생했습니다.", "error");
    },
  });

  const executeLotteryMutation = useMutation({
    mutationFn: async (roundId) => {
      const fn = httpsCallable(functions, "executeLotteryRound");
      const response = await fn({ classId, roundId });
      return response.data;
    },
    onSuccess: () => showFeedback("추첨이 완료되었습니다.", "success"),
    onError: (error) => {
      showFeedback(error.message || "추첨 실행 중 오류가 발생했습니다.", "error");
    },
  });

  const addProductMutation = useMutation({
    mutationFn: async (newProductData) => {
      const fn = httpsCallable(functions, "createSubscriptionProduct");
      const response = await fn({ classId, ...newProductData });
      return response.data;
    },
    onSuccess: () => showFeedback("새 청약 상품이 등록되었습니다.", "success"),
    onError: (error) => {
      showFeedback(error.message || "상품 등록 중 오류가 발생했습니다.", "error");
    },
  });

  const payPending = payMutation.isPending ?? payMutation.isLoading ?? false;
  const withdrawPending = withdrawMutation.isPending ?? withdrawMutation.isLoading ?? false;
  const terminatePending = terminateMutation.isPending ?? terminateMutation.isLoading ?? false;
  const executePending =
    executeLotteryMutation.isPending ?? executeLotteryMutation.isLoading ?? false;
  const addProductPending =
    addProductMutation.isPending ?? addProductMutation.isLoading ?? false;

  return {
    payMutation,
    withdrawMutation,
    terminateMutation,
    executeLotteryMutation,
    addProductMutation,
    isLoading:
      payPending ||
      withdrawPending ||
      terminatePending ||
      executePending ||
      addProductPending,
  };
};
