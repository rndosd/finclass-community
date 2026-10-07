import { useEffect, useState } from "react";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import {
  subscribeCaseLibraryRequestInterested,
  toggleCaseLibraryRequestInterest,
} from "../services/caseLibraryRequestService";

export default function useCaseLibraryRequestInterest(requestId, targetClassId) {
  const { showFeedback } = useFeedback();
  const { classId, user, userData } = useUser();
  const [isInterested, setIsInterested] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const uid = String(userData?.uid || user?.uid || "").trim();

  useEffect(() => {
    return subscribeCaseLibraryRequestInterested({
      storageClassId: classId,
      targetClassId,
      requestId,
      uid,
      onChange: setIsInterested,
      onError: (error) => {
        console.error("[useCaseLibraryRequestInterest] subscribe failed:", error);
      },
    });
  }, [classId, requestId, targetClassId, uid]);

  const handleToggleInterest = async () => {
    if (!classId || !requestId || !uid || isToggling) {
      return;
    }

    setIsToggling(true);
    try {
      const result = await toggleCaseLibraryRequestInterest({
        storageClassId: classId,
        targetClassId,
        requestId,
        uid,
      });
      showFeedback(
        result?.interested ? "나도 궁금해요에 반영했어요." : "공감을 취소했어요.",
        "success",
      );
    } catch (error) {
      console.error("[useCaseLibraryRequestInterest] toggle failed:", error);
      showFeedback(
        error?.message || "공감 처리 중 문제가 생겼어요. 다시 시도해 주세요.",
        "error",
      );
    } finally {
      setIsToggling(false);
    }
  };

  return {
    handleToggleInterest,
    isInterested,
    isToggling,
  };
}
