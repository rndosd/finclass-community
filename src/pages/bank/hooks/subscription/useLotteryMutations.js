import { useMutation, useQueryClient } from "@tanstack/react-query";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../../firebase";

export const useLotteryMutations = (classId, productId, showFeedback) => {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["lotteryRounds", classId, productId],
    });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const fn = httpsCallable(functions, "createLotteryRound");
      const res = await fn({ classId, productId, ...data });
      return res.data;
    },
    onSuccess: (data) => {
      if (data?.success) {
        showFeedback?.("새로운 추첨 회차가 생성되었습니다.", "success");
        invalidate();
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ roundId, updates }) => {
      const fn = httpsCallable(functions, "updateLotteryRound");
      const res = await fn({ classId, roundId, updates });
      return res.data;
    },
    onSuccess: (data) => {
      if (data?.success) {
        showFeedback?.("회차 정보가 수정되었습니다.", "success");
        invalidate();
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (roundId) => {
      const fn = httpsCallable(functions, "deleteLotteryRound");
      const res = await fn({ classId, roundId });
      return res.data;
    },
    onSuccess: (data) => {
      if (data?.success) {
        showFeedback?.("회차가 삭제되었습니다.", "success");
        invalidate();
      }
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (roundId) => {
      const fn = httpsCallable(functions, "executeLotteryRound");
      const res = await fn({ classId, roundId });
      return res.data;
    },
    onSuccess: (data) => {
      if (data?.success) {
        showFeedback?.("추첨이 성공적으로 완료되었습니다!", "success");
        invalidate();
      }
    },
  });

  return { createMutation, updateMutation, deleteMutation, executeMutation };
};
