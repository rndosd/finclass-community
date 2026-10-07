import { appConfirm } from "../../../utils/appDialogs";
import { useEffect, useMemo, useState } from "react";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import {
  createCaseLibraryComment,
  deleteCaseLibraryComment,
  subscribeCaseLibraryComments,
  updateCaseLibraryComment,
} from "../services/caseLibraryCommentService";

function normalizeCommentAuthor({
  classData,
  classId,
  teacherDisplayName,
  user,
  userData,
}) {
  const classLabel = String(
    classData?.className || classData?.name || classId || "",
  ).trim();
  const authorName = String(
    teacherDisplayName || userData?.name || user?.displayName || "",
  ).trim();
  const authorUid = String(userData?.uid || user?.uid || "").trim();

  return {
    authorName: authorName || "사용자",
    authorUid,
    classLabel: classLabel || "학급",
    teacherNamePublic: true,
  };
}

function buildCommentTree(comments) {
  const commentMap = new Map();
  const roots = [];

  comments.forEach((comment) => {
    commentMap.set(comment.id, {
      ...comment,
      children: [],
    });
  });

  comments.forEach((comment) => {
    const node = commentMap.get(comment.id);
    const parentId = String(comment.parentId || "").trim();

    if (parentId && commentMap.has(parentId)) {
      commentMap.get(parentId).children.push(node);
      return;
    }

    roots.push(node);
  });

  return roots;
}

export default function useCaseLibraryComments(postId, targetClassId) {
  const { showFeedback } = useFeedback();
  const { classData, classId, teacherDisplayName, user, userData } = useUser();
  const resolvedClassId = String(targetClassId || classId || "").trim();
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [teacherNamePublic, setTeacherNamePublic] = useState(true);
  const [replyTargetId, setReplyTargetId] = useState("");
  const [replyText, setReplyText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(() => Boolean(resolvedClassId && postId));

  const authorMeta = useMemo(
    () =>
      normalizeCommentAuthor({
        classData,
        classId,
        teacherDisplayName,
        user,
        userData,
      }),
    [classData, classId, teacherDisplayName, user, userData],
  );

  const currentUid = authorMeta.authorUid;

  useEffect(() => {
    if (!resolvedClassId || !postId) {
      setComments([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    return subscribeCaseLibraryComments({
      classId: resolvedClassId,
      postId,
      onChange: (nextComments) => {
        setComments(Array.isArray(nextComments) ? nextComments : []);
        setLoading(false);
      },
      onError: (error) => {
        console.error("[useCaseLibraryComments] subscribe failed:", error);
        setComments([]);
        setLoading(false);
      },
    });
  }, [postId, resolvedClassId]);

  const commentTree = useMemo(() => buildCommentTree(comments), [comments]);

  const canManageComment = (comment) =>
    String(comment?.authorUid || "").trim() === currentUid;

  const handleSubmitRootComment = async () => {
    if (!resolvedClassId || !postId || !authorMeta.authorUid) {
      showFeedback("댓글을 작성하려면 로그인 정보가 필요합니다.", "warning");
      return null;
    }

    if (!commentText.trim()) {
      showFeedback("댓글 내용을 입력해 주세요.", "warning");
      return null;
    }

    setIsSubmitting(true);
    try {
      await createCaseLibraryComment({
        classId: resolvedClassId,
        postId,
        authorUid: authorMeta.authorUid,
        authorName: authorMeta.authorName,
        classLabel: authorMeta.classLabel,
        teacherNamePublic,
        content: commentText,
      });
      setCommentText("");
      showFeedback("댓글을 등록했습니다.", "success");
      return true;
    } catch (error) {
      console.error("[useCaseLibraryComments] root submit failed:", error);
      showFeedback(error?.message || "댓글 등록 중 오류가 발생했습니다.", "error");
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartReply = (comment) => {
    setEditingCommentId("");
    setEditingText("");
    setReplyTargetId(comment.id);
    setReplyText("");
  };

  const handleCancelReply = () => {
    setReplyTargetId("");
    setReplyText("");
  };

  const handleSubmitReply = async (comment) => {
    if (!resolvedClassId || !postId || !authorMeta.authorUid) {
      showFeedback("답글을 작성하려면 로그인 정보가 필요합니다.", "warning");
      return null;
    }

    if (!replyText.trim()) {
      showFeedback("답글 내용을 입력해 주세요.", "warning");
      return null;
    }

    setIsSubmitting(true);
    try {
      await createCaseLibraryComment({
        classId: resolvedClassId,
        postId,
        authorUid: authorMeta.authorUid,
        authorName: authorMeta.authorName,
        classLabel: authorMeta.classLabel,
        teacherNamePublic,
        content: replyText,
        parentId: comment.id,
        replyToAuthorName: comment.authorName || "",
      });
      setReplyTargetId("");
      setReplyText("");
      showFeedback("답글을 등록했습니다.", "success");
      return true;
    } catch (error) {
      console.error("[useCaseLibraryComments] reply submit failed:", error);
      showFeedback(error?.message || "답글 등록 중 오류가 발생했습니다.", "error");
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (comment) => {
    setReplyTargetId("");
    setReplyText("");
    setEditingCommentId(comment.id);
    setEditingText(comment.content || "");
  };

  const handleCancelEdit = () => {
    setEditingCommentId("");
    setEditingText("");
  };

  const handleSubmitEdit = async (comment) => {
    if (!canManageComment(comment)) {
      showFeedback("내 댓글만 수정할 수 있습니다.", "warning");
      return null;
    }

    if (!editingText.trim()) {
      showFeedback("댓글 내용을 입력해 주세요.", "warning");
      return null;
    }

    setIsSubmitting(true);
    try {
      await updateCaseLibraryComment({
        classId: resolvedClassId,
        postId,
        commentId: comment.id,
        content: editingText,
      });
      setEditingCommentId("");
      setEditingText("");
      showFeedback("댓글을 수정했습니다.", "success");
      return true;
    } catch (error) {
      console.error("[useCaseLibraryComments] edit failed:", error);
      showFeedback(error?.message || "댓글 수정 중 오류가 발생했습니다.", "error");
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteComment = async (comment) => {
    if (!canManageComment(comment)) {
      showFeedback("내 댓글만 삭제할 수 있습니다.", "warning");
      return null;
    }

    if (typeof window !== "undefined") {
      const confirmed = (await appConfirm("이 댓글을 삭제할까요? 답글도 함께 삭제됩니다.", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}));
      if (!confirmed) {
        return null;
      }
    }

    setIsSubmitting(true);
    try {
      await deleteCaseLibraryComment({
        classId: resolvedClassId,
        postId,
        commentId: comment.id,
      });
      showFeedback("댓글을 삭제했습니다.", "success");
      return true;
    } catch (error) {
      console.error("[useCaseLibraryComments] delete failed:", error);
      showFeedback(error?.message || "댓글 삭제 중 오류가 발생했습니다.", "error");
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    commentCount: comments.length,
    commentText,
    comments: commentTree,
    currentUid,
    editingCommentId,
    editingText,
    handleCancelEdit,
    handleCancelReply,
    handleDeleteComment,
    handleStartEdit,
    handleStartReply,
    handleSubmitEdit,
    handleSubmitReply,
    handleSubmitRootComment,
    isSubmitting,
    loading,
    replyTargetId,
    replyText,
    setCommentText,
    setEditingText,
    setReplyText,
    setTeacherNamePublic,
    teacherNamePublic,
  };
}
