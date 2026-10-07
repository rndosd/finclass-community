import { useEffect, useMemo, useState } from "react";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import {
  subscribeCaseLibraryCommentRecommended,
  toggleCaseLibraryCommentRecommend,
} from "../services/caseLibraryCommentService";

export default function useCaseLibraryCommentRecommend(
  postId,
  commentId,
  targetClassId,
) {
  const { showFeedback } = useFeedback();
  const { classId, user, userData } = useUser();
  const [isRecommended, setIsRecommended] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const uid = useMemo(
    () => String(userData?.uid || user?.uid || "").trim(),
    [user?.uid, userData?.uid],
  );

  useEffect(() => {
    const unsubscribe = subscribeCaseLibraryCommentRecommended({
      classId: targetClassId || classId,
      postId,
      commentId,
      uid,
      onChange: setIsRecommended,
      onError: (error) => {
        console.error("[useCaseLibraryCommentRecommend] subscribe failed:", error);
      },
    });

    return () => unsubscribe();
  }, [classId, commentId, postId, targetClassId, uid]);

  const handleToggleRecommend = async () => {
    if (!classId || !postId || !commentId || !uid) {
      showFeedback("댓글 추천에 필요한 로그인 정보를 찾지 못했습니다.", "warning");
      return null;
    }

    setIsToggling(true);
    try {
      const result = await toggleCaseLibraryCommentRecommend({
        classId: targetClassId || classId,
        postId,
        commentId,
        uid,
      });
      return result;
    } catch (error) {
      console.error("[useCaseLibraryCommentRecommend] toggle failed:", error);
      showFeedback(
        error?.message || "댓글 추천 처리 중 오류가 발생했습니다.",
        "error",
      );
      return null;
    } finally {
      setIsToggling(false);
    }
  };

  return {
    handleToggleRecommend,
    isRecommended,
    isToggling,
  };
}
