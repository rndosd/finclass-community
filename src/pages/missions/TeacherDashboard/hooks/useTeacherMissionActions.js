import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "../../../../contexts/UserContext";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import {
  approveMissionBatch,
  cancelMissionApprovalBatch,
  rejectMissionCompletionBatch,
  rejectSubmissionBatch,
  setMissionFeedbacks,
} from "../../services/missionService";

/**
 * 교사용 미션 액션 훅
 * - 일괄 승인/승인 취소/반려/피드백 저장 처리
 * - 성공 시 미션 캐시(classMissions)만 invalidate
 */
export function useTeacherMissionActions() {
  const qc = useQueryClient();
  const { classId, userData } = useUser();
  const { showFeedback } = useFeedback();

  const invalidateAll = async () => {
    if (!classId) return;
    await qc.invalidateQueries({ queryKey: ["classMissions", classId] });
    // classStudents는 UserContext의 onSnapshot으로 실시간 동기화됨
  };

  const approveManyMut = useMutation({
    mutationFn: async ({ missionId, items }) => {
      if (!classId || !missionId || !Array.isArray(items)) {
        throw new Error("필수 정보가 누락되었습니다.");
      }
      return approveMissionBatch(classId, missionId, items);
    },
    onSuccess: async (res) => {
      showFeedback?.(res?.message || "승인이 완료되었습니다.", "success");
      await invalidateAll();
    },
    onError: (err) => {
      showFeedback?.(err?.message || "일괄 승인 중 오류가 발생했습니다.", "error");
    },
  });

  const cancelManyMut = useMutation({
    mutationFn: async ({ missionId, uids }) => {
      if (!classId || !missionId || !Array.isArray(uids)) {
        throw new Error("필수 정보가 누락되었습니다.");
      }
      return cancelMissionApprovalBatch(classId, missionId, uids);
    },
    onSuccess: async (res) => {
      showFeedback?.(res?.message || "승인 취소가 완료되었습니다.", "success");
      await invalidateAll();
    },
    onError: (err) => {
      showFeedback?.(err?.message || "일괄 승인 취소 중 오류가 발생했습니다.", "error");
    },
  });

  const rejectManyMut = useMutation({
    mutationFn: async ({
      missionId,
      submissionIds = [],
      studentUids = [],
      options = {},
    }) => {
      if (!classId || !missionId) {
        throw new Error("필수 정보가 누락되었습니다.");
      }

      const normalizedSubmissionIds = Array.isArray(submissionIds)
        ? [...new Set(submissionIds.filter(Boolean))]
        : [];
      const normalizedStudentUids = Array.isArray(studentUids)
        ? [...new Set(studentUids.filter(Boolean))]
        : [];

      if (
        normalizedSubmissionIds.length === 0 &&
        normalizedStudentUids.length === 0
      ) {
        return { success: true, message: "반려할 대상이 없습니다." };
      }

      const messages = [];

      if (normalizedSubmissionIds.length > 0) {
        const res = await rejectSubmissionBatch(
          classId,
          missionId,
          normalizedSubmissionIds,
          options,
        );
        if (res?.data?.results?.failed?.length) throw new Error(res.message || "일부 제출물을 반려하지 못했습니다.");
        messages.push(res?.message || "");
      }

      if (normalizedStudentUids.length > 0) {
        const res = await rejectMissionCompletionBatch(
          classId,
          missionId,
          normalizedStudentUids,
          { reason: options?.reason || "" },
        );
        if (res?.data?.results?.failed?.length) throw new Error(res.message || "일부 완료 요청을 반려하지 못했습니다.");
        messages.push(res?.message || "");
      }

      return {
        success: true,
        message: messages.filter(Boolean).join(" / ") || "일괄 반려가 완료되었습니다.",
      };
    },
    onSuccess: async (res) => {
      showFeedback?.(res?.message || "일괄 반려가 완료되었습니다.", "success");
      await invalidateAll();
    },
    onError: (err) => {
      showFeedback?.(err?.message || "일괄 반려 중 오류가 발생했습니다.", "error");
    },
  });

  const saveFeedbackManyMut = useMutation({
    mutationFn: async ({ missionId, items }) => {
      if (!classId || !missionId || !Array.isArray(items)) {
        throw new Error("필수 정보가 누락되었습니다.");
      }

      const meta = {
        uid: userData?.uid || null,
        name: userData?.name || userData?.displayName || "",
      };

      return setMissionFeedbacks(classId, missionId, items, meta);
    },
    onSuccess: async (res, vars) => {
      showFeedback?.(
        res?.message || `피드백 ${vars?.items?.length ?? 0}건 저장되었습니다.`,
        "success",
      );
      await invalidateAll();
    },
    onError: (err) => {
      showFeedback?.(err?.message || "피드백 저장 중 오류가 발생했습니다.", "error");
    },
  });

  const approveMany = async (missionId, items) =>
    approveManyMut.mutateAsync({ missionId, items });

  const cancelMany = async (missionId, uids) =>
    cancelManyMut.mutateAsync({ missionId, uids });

  // 호환 시그니처:
  // 1) rejectMany(missionId, submissionIdsArray, options)
  // 2) rejectMany(missionId, { submissionIds, studentUids, options })
  const rejectMany = async (missionId, payload, options = {}) => {
    if (Array.isArray(payload)) {
      return rejectManyMut.mutateAsync({
        missionId,
        submissionIds: payload,
        options,
      });
    }

    const data = payload && typeof payload === "object" ? payload : {};
    return rejectManyMut.mutateAsync({
      missionId,
      submissionIds: data.submissionIds || [],
      studentUids: data.studentUids || [],
      options: data.options || options,
    });
  };

  const saveFeedbackMany = async (missionId, items) =>
    saveFeedbackManyMut.mutateAsync({ missionId, items });

  const isBusy =
    approveManyMut.isPending ||
    cancelManyMut.isPending ||
    rejectManyMut.isPending ||
    saveFeedbackManyMut.isPending;

  return {
    approveMany,
    cancelMany,
    rejectMany,
    saveFeedbackMany,
    isBusy,
    approveManyMut,
    cancelManyMut,
    rejectManyMut,
    saveFeedbackManyMut,
  };
}

export default useTeacherMissionActions;
