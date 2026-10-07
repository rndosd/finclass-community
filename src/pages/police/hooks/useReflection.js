import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { reviewPoliceReflection } from "../utils/policeUtils";
import {
  cancelReflectionSubmissionInFirestore,
  rejectReflectionInFirestore,
  submitReflectionToFirestore,
  updateReflectionCommentOnly as updateReflectionCommentOnlyFirestore,
  updateReflectionInFirestore,
} from "../utils/reflectionFirestoreUtils";

export const useReflection = (classId, { enabled = true, fineId: targetFineId } = {}) => {
  const { userData, isTeacher, hasPermission, teacherDisplayName } = useUser();
  const { showFeedback } = useFeedback();
  const queryClient = useQueryClient();
  const isEnabled = enabled !== false;

  const [reflectionModal, setReflectionModal] = useState({
    isOpen: false,
    mode: "submit",
    fine: null,
  });
  const [processingId, setProcessingId] = useState(null);

  const refreshData = useCallback(
    (fineId) => {
      queryClient.invalidateQueries({ queryKey: ["reflection", classId, fineId] });
      queryClient.invalidateQueries({ queryKey: ["policeReflections", classId] });
      queryClient.invalidateQueries({ queryKey: ["policeReflectionReview", classId, fineId] });
      queryClient.invalidateQueries({
        queryKey: ["policeFineHistory", classId],
        exact: false,
      });
    },
    [classId, queryClient],
  );

  const closeReflectionModal = useCallback(() => {
    setReflectionModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const openReflectionSubmitModal = useCallback(
    (fine) => {
      if (!isEnabled) return;
      setReflectionModal({ isOpen: true, mode: "submit", fine });
    },
    [isEnabled],
  );

  const openReflectionReviewModal = useCallback(
    (fine) => {
      if (!isEnabled) return;
      const canReview = isTeacher || hasPermission("permission_group_police");
      const nextMode =
        canReview && fine?.reflectionStatus === "submitted" ? "review" : "view";

      setReflectionModal({
        isOpen: true,
        mode: nextMode,
        fine,
      });
    },
    [hasPermission, isEnabled, isTeacher],
  );

  const runAction = useCallback(
    async ({ fineId, actionFn, successMsg }) => {
      if (!isEnabled) {
        const message = "지금은 반성문을 쓸 수 없어요.";
        showFeedback(message, "warning");
        return { success: false, message };
      }

      setProcessingId(fineId);
      try {
        const result = await actionFn();
        if (!result?.success) {
          throw new Error(result?.message || "처리에 실패했습니다.");
        }

        showFeedback(successMsg, "success");
        refreshData(fineId);
        closeReflectionModal();
        return result;
      } catch (error) {
        showFeedback(error.message, "error");
        return { success: false, message: error.message };
      } finally {
        setProcessingId(null);
      }
    },
    [closeReflectionModal, isEnabled, refreshData, showFeedback],
  );

  const reviewerName =
    teacherDisplayName || userData?.name || userData?.displayName || "교사";

  const currentFineId = targetFineId ?? reflectionModal.fine?.id;

  return {
    processingId,
    reflectionModal,
    openReflectionSubmitModal,
    openReflectionReviewModal,
    closeReflectionModal,
    submitReflection: (text, submissionType = "reflection") =>
      runAction({
        fineId: currentFineId,
        successMsg: "제출이 완료되었습니다.",
        actionFn: () =>
          submitReflectionToFirestore(
            classId,
            currentFineId,
            userData?.uid,
            userData?.name,
            text,
            submissionType,
          ),
      }),
    approveReflection: ({
      refId,
      comment = "",
      finePercent = 100,
      creditPercent = 100,
      missionTokenPercent = 100,
    }) =>
      runAction({
        fineId: currentFineId,
        successMsg:
          finePercent === 100 &&
          creditPercent === 100 &&
          missionTokenPercent === 100
            ? "승인되었습니다."
            : "조정 후 승인되었습니다.",
        actionFn: () =>
          reviewPoliceReflection({
            reflectionId: refId,
            finePercent,
            creditPercent,
            missionTokenPercent,
            teacherComment: comment,
          }),
      }),
    rejectReflection: (refId, comment) =>
      runAction({
        fineId: currentFineId,
        successMsg: "반려되었습니다.",
        actionFn: () =>
          rejectReflectionInFirestore(
            classId,
            refId,
            userData?.uid,
            reviewerName,
            comment,
          ),
      }),
    updateReflection: (refId, text, submissionType = "reflection") =>
      runAction({
        fineId: currentFineId,
        successMsg: "다시 제출되었습니다.",
        actionFn: () =>
          updateReflectionInFirestore(
            classId,
            refId,
            userData?.uid,
            text,
            submissionType,
          ),
      }),
    cancelReflectionSubmission: (refId) =>
      runAction({
        fineId: currentFineId,
        successMsg: "제출이 취소되었습니다.",
        actionFn: () => cancelReflectionSubmissionInFirestore(classId, refId),
      }),
    updateComment: (refId, comment) =>
      runAction({
        fineId: currentFineId,
        successMsg: "교사 메모가 저장되었습니다.",
        actionFn: () =>
          updateReflectionCommentOnlyFirestore(classId, refId, comment),
      }),
  };
};
