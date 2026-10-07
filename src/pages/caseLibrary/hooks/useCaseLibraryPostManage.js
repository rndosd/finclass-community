import { appConfirm } from "../../../utils/appDialogs";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { deleteCaseLibraryPost } from "./useCaseLibraryPosts";

export default function useCaseLibraryPostManage(casePost) {
  const navigate = useNavigate();
  const { showFeedback } = useFeedback();
  const { classId, user, userData } = useUser();
  const [isDeleting, setIsDeleting] = useState(false);

  const currentUid = useMemo(
    () => String(userData?.uid || user?.uid || "").trim(),
    [user?.uid, userData?.uid],
  );

  const canManagePost = useMemo(
    () =>
      Boolean(
        casePost &&
          String(casePost.classId || "").trim() === String(classId || "").trim() &&
          currentUid &&
          String(casePost.authorUid || "").trim() === currentUid,
      ),
    [casePost, classId, currentUid],
  );

  const handleEditPost = () => {
    if (!casePost?.id || !canManagePost) {
      return;
    }

    navigate(`/case-library/${casePost.id}/edit`);
  };

  const handleDeletePost = async () => {
    if (!casePost?.id || !canManagePost) {
      showFeedback("내가 작성한 글만 삭제할 수 있습니다.", "warning");
      return null;
    }

    if (typeof window !== "undefined") {
      const confirmed = (await appConfirm("이 글을 삭제할까요? 댓글도 함께 삭제됩니다.", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}));
      if (!confirmed) {
        return null;
      }
    }

    setIsDeleting(true);
    try {
      await deleteCaseLibraryPost({
        classId,
        postId: casePost.id,
      });
      showFeedback("운영사례를 삭제했습니다.", "success");
      navigate("/case-library");
      return true;
    } catch (error) {
      console.error("[useCaseLibraryPostManage] delete failed:", error);
      showFeedback(error?.message || "글 삭제 중 오류가 발생했습니다.", "error");
      return null;
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    canManagePost,
    handleDeletePost,
    handleEditPost,
    isDeleting,
  };
}
