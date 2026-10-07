import { useEffect, useMemo, useState } from "react";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import {
  subscribeCaseLibraryPostSaved,
  toggleCaseLibraryPostSave,
} from "../services/caseLibraryEngagementService";

export default function useCaseLibraryPostSave(postId, targetClassId) {
  const { showFeedback } = useFeedback();
  const { classId, user, userData } = useUser();
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const uid = useMemo(
    () => String(userData?.uid || user?.uid || "").trim(),
    [user?.uid, userData?.uid],
  );

  useEffect(() => {
    const unsubscribe = subscribeCaseLibraryPostSaved({
      storageClassId: classId,
      targetClassId,
      postId,
      uid,
      onChange: setIsSaved,
      onError: (error) => {
        console.error("[useCaseLibraryPostSave] subscribe failed:", error);
      },
    });

    return () => unsubscribe();
  }, [classId, postId, targetClassId, uid]);

  const handleToggleSave = async () => {
    if (!classId || !postId || !uid) {
      showFeedback("스크랩하려면 로그인 정보가 필요합니다.", "warning");
      return null;
    }

    setIsSaving(true);
    try {
      const result = await toggleCaseLibraryPostSave({
        storageClassId: classId,
        targetClassId,
        postId,
        uid,
      });
      showFeedback(
        result?.saved ? "스크랩했습니다." : "스크랩을 취소했습니다.",
        "success",
      );
      return result;
    } catch (error) {
      console.error("[useCaseLibraryPostSave] toggle failed:", error);
      showFeedback(error?.message || "스크랩 처리 중 오류가 발생했습니다.", "error");
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  return {
    handleToggleSave,
    isSaved,
    isSaving,
  };
}
