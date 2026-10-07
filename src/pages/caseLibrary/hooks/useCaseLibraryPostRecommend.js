import { useEffect, useMemo, useState } from "react";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import {
  subscribeCaseLibraryPostRecommended,
  toggleCaseLibraryPostRecommend,
} from "../services/caseLibraryEngagementService";

export default function useCaseLibraryPostRecommend(postId, targetClassId) {
  const { showFeedback } = useFeedback();
  const { classId, user, userData } = useUser();
  const [isRecommended, setIsRecommended] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);

  const uid = useMemo(
    () => String(userData?.uid || user?.uid || "").trim(),
    [user?.uid, userData?.uid],
  );

  useEffect(() => {
    const unsubscribe = subscribeCaseLibraryPostRecommended({
      storageClassId: classId,
      targetClassId,
      postId,
      uid,
      onChange: setIsRecommended,
      onError: (error) => {
        console.error("[useCaseLibraryPostRecommend] subscribe failed:", error);
      },
    });

    return () => unsubscribe();
  }, [classId, postId, targetClassId, uid]);

  const handleToggleRecommend = async () => {
    if (!classId || !postId || !uid) {
      showFeedback("추천하려면 로그인 정보가 필요합니다.", "warning");
      return null;
    }

    setIsRecommending(true);
    try {
      const result = await toggleCaseLibraryPostRecommend({
        storageClassId: classId,
        targetClassId,
        postId,
        uid,
      });
      showFeedback(
        result?.recommended ? "이 글을 추천했습니다." : "추천을 취소했습니다.",
        "success",
      );
      return result;
    } catch (error) {
      console.error("[useCaseLibraryPostRecommend] toggle failed:", error);
      showFeedback(error?.message || "추천 처리 중 오류가 발생했습니다.", "error");
      return null;
    } finally {
      setIsRecommending(false);
    }
  };

  return {
    handleToggleRecommend,
    isRecommended,
    isRecommending,
  };
}
