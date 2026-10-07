import { confirmMissionAction } from "../components/MissionActionDialog";
import { useState, useCallback } from "react";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { createSubmission, getMissionTeacherActionProvider, processAutoApproveMission } from "../services/missionService";
export const useStudentMissionActions = () => {
  const {
    classId,
    userData
  } = useUser();
  const uid = userData?.uid;
  const {
    showFeedback
  } = useFeedback();
  const [submittingMissions, setSubmittingMissions] = useState(new Set());
  const notify = useCallback((msg, type = "info") => {
    if (!msg) return;
    Promise.resolve().then(() => showFeedback?.(msg, type));
  }, [showFeedback]);
  const normalizeId = id => id == null ? "" : String(id);
  const setSubmitting = useCallback((missionId, flag) => {
    const key = normalizeId(missionId);
    setSubmittingMissions(prev => {
      const next = new Set(prev);
      if (flag) next.add(key);else next.delete(key);
      return next;
    });
  }, []);
  const isSubmitting = useCallback(missionId => submittingMissions.has(normalizeId(missionId)), [submittingMissions]);
  const toDateSafe = v => v?.toDate ? v.toDate() : v || null;
  const executeSubmissionLogic = useCallback(async (mission, contentHtml = "", {
    partial = false
  } = {}) => {
    if (!classId || !uid) throw new Error("사용자 정보가 없습니다.");
    const now = new Date();
    const end = toDateSafe(mission?.timeWindow?.end);
    const isLate = !!end && now > end;
    const allowLateSubmission = mission?.allowLateSubmission !== false;
    if (isLate && !allowLateSubmission) {
      throw new Error("마감 후 제출이 허용되지 않은 과제입니다.");
    }

    // A) 제출 폼 미션: 기존 callable 제출 경로 사용
    if (mission?.requireSubmissionForm) {
      await createSubmission({
        classId,
        missionId: mission.id,
        studentUid: uid,
        studentName: userData?.name || "학생",
        studentNumber: userData?.studentNumber ?? null,
        contentHtml: typeof contentHtml === "string" ? contentHtml : "",
        isLate,
        missionTitle: mission.title
      });
      if (partial) {
        return {
          success: true,
          message: "제출 내용이 수정되었습니다."
        };
      }
      if (mission.autoApprove && true) {
        await processAutoApproveMission(classId, mission.id);
      }
      return {
        success: true,
        message: isLate ? "마감 후 제출되었습니다." : mission.autoApprove ? "제출 및 승인이 완료되었습니다!" : "과제가 제출되었습니다. 선생님의 승인을 기다려주세요."
      };
    }

    // B) 제출 폼 없는 미션
    if (partial) {
      return {
        success: false,
        message: "제출 폼 과제만 수정할 수 있습니다."
      };
    }

    // B-1) 자동 승인: callable 처리
    if (mission.autoApprove) {
      const result = await processAutoApproveMission(classId, mission.id);
      return {
        success: true,
        message: result?.message || "제출 및 승인이 완료되었습니다!"
      };
    }
    // B-2) Manual approval path: submit through callable
    await createSubmission({
      classId,
      missionId: mission.id,
      studentUid: uid,
      studentName: userData?.name || "학생",
      studentNumber: userData?.studentNumber ?? null,
      contentHtml: typeof contentHtml === "string" ? contentHtml : "",
      isLate,
      missionTitle: mission.title
    });
    return {
      success: true,
      message: isLate ? "마감 후 제출되었습니다. 선생님의 승인을 기다려주세요." : "제출되었습니다. 선생님의 승인을 기다려주세요."
    };
  }, [classId, uid, userData]);
  const submitMission = useCallback(async (mission, content = "") => {
    const missionId = normalizeId(mission?.id);
    if (!missionId) return {
      success: false,
      message: "잘못된 과제입니다."
    };
    if (isSubmitting(missionId)) return {
      success: false,
      message: "이미 처리 중입니다."
    };
    const isPartialUpdate = typeof content === "object" && content?.partial;
    const normalizedContent = isPartialUpdate ? content?.contentHtml ?? "" : content;
    if (isPartialUpdate) {
      setSubmitting(missionId, true);
      try {
        const result = await executeSubmissionLogic(mission, normalizedContent, {
          partial: true
        });
        notify(result.message, "success");
        return result;
      } catch (error) {
        const msg = error?.message || "수정 중 오류가 발생했습니다.";
        notify(msg, "error");
        return {
          success: false,
          error: msg
        };
      } finally {
        setSubmitting(missionId, false);
      }
    }
    const end = toDateSafe(mission?.timeWindow?.end);
    const isLate = !!end && new Date() > end;
    // The submission editor already provides the final review and submit action.
    if (!mission?.requireSubmissionForm) {
      const confirmed = await confirmMissionAction(mission.title || "선택한 과제", {
        title: mission.autoApprove ? "과제를 완료할까요?" : "완료를 요청할까요?",
        confirmLabel: mission.autoApprove ? "완료하기" : "완료 요청",
        consequence: isLate ? "마감 후 제출로 처리됩니다." : mission.autoApprove ? "즉시 완료 처리되고 설정된 보상이 지급됩니다." : "선생님 승인 후 완료 처리됩니다."
      });
      if (!confirmed) return {
        success: false,
        cancelled: true
      };
    }
    setSubmitting(missionId, true);
    try {
      const result = await executeSubmissionLogic(mission, normalizedContent, {
        partial: false
      });
      notify(result.message, isLate ? "info" : "success");
      return {
        success: true,
        ...result
      };
    } catch (error) {
      const msg = error?.message || "과제 처리 중 오류가 발생했습니다.";
      notify(msg, "error");
      return {
        success: false,
        error: msg
      };
    } finally {
      setSubmitting(missionId, false);
    }
  }, [isSubmitting, setSubmitting, executeSubmissionLogic, notify]);
  return {
    submitMission,
    isSubmitting,
    submittingCount: submittingMissions.size
  };
};
export default useStudentMissionActions;
