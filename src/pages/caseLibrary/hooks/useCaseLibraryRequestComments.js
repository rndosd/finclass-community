import { appConfirm } from "../../../utils/appDialogs";
import { useEffect, useMemo, useState } from "react";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import {
  createCaseLibraryRequestComment,
  deleteCaseLibraryRequestComment,
  subscribeCaseLibraryRequestComments,
  updateCaseLibraryRequestComment,
} from "../services/caseLibraryRequestCommentService";

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
    authorName: authorName || "교사",
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

export default function useCaseLibraryRequestComments(requestId, targetClassId) {
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
  const [loading, setLoading] = useState(() => Boolean(resolvedClassId && requestId));

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
    if (!resolvedClassId || !requestId) {
      setComments([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    return subscribeCaseLibraryRequestComments({
      classId: resolvedClassId,
      requestId,
      onChange: (nextComments) => {
        setComments(Array.isArray(nextComments) ? nextComments : []);
        setLoading(false);
      },
      onError: (error) => {
        console.error("[useCaseLibraryRequestComments] subscribe failed:", error);
        setComments([]);
        setLoading(false);
      },
    });
  }, [requestId, resolvedClassId]);

  const commentTree = useMemo(() => buildCommentTree(comments), [comments]);

  const canManageComment = (comment) =>
    String(comment?.authorUid || "").trim() === currentUid;
  const getEntryLabel = (comment) =>
    String(comment?.parentId || "").trim() ? "의견" : "답변";

  const handleSubmitRootComment = async () => {
    if (!resolvedClassId || !requestId || !authorMeta.authorUid) {
      showFeedback("답변을 작성할 정보를 확인한 뒤 다시 시도해 주세요.", "warning");
      return null;
    }

    if (!commentText.trim()) {
      showFeedback("답변 내용을 입력해 주세요.", "warning");
      return null;
    }

    setIsSubmitting(true);
    try {
      await createCaseLibraryRequestComment({
        classId: resolvedClassId,
        requestId,
        authorUid: authorMeta.authorUid,
        authorName: authorMeta.authorName,
        classLabel: authorMeta.classLabel,
        teacherNamePublic,
        content: commentText,
      });
      setCommentText("");
      showFeedback("답변을 등록했어요.", "success");
      return true;
    } catch (error) {
      console.error("[useCaseLibraryRequestComments] root submit failed:", error);
      showFeedback(
        error?.message || "답변 등록 중 문제가 생겼어요. 다시 시도해 주세요.",
        "error",
      );
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
    if (!resolvedClassId || !requestId || !authorMeta.authorUid) {
      showFeedback("답글을 작성할 정보를 확인한 뒤 다시 시도해 주세요.", "warning");
      return null;
    }

    if (!replyText.trim()) {
      showFeedback("답글 내용을 입력해 주세요.", "warning");
      return null;
    }

    setIsSubmitting(true);
    try {
      await createCaseLibraryRequestComment({
        classId: resolvedClassId,
        requestId,
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
      showFeedback("답글을 남겼어요.", "success");
      return true;
    } catch (error) {
      console.error("[useCaseLibraryRequestComments] reply submit failed:", error);
      showFeedback(
        error?.message || "답글 등록 중 문제가 생겼어요. 다시 시도해 주세요.",
        "error",
      );
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
    const entryLabel = getEntryLabel(comment);

    if (!canManageComment(comment)) {
      showFeedback(`이 ${entryLabel}은 수정할 수 없어요.`, "warning");
      return null;
    }

    if (!editingText.trim()) {
      showFeedback(`${entryLabel} 내용을 입력해 주세요.`, "warning");
      return null;
    }

    setIsSubmitting(true);
    try {
      await updateCaseLibraryRequestComment({
        classId: resolvedClassId,
        requestId,
        commentId: comment.id,
        content: editingText,
      });
      setEditingCommentId("");
      setEditingText("");
      showFeedback(`${entryLabel}을 수정했어요.`, "success");
      return true;
    } catch (error) {
      console.error("[useCaseLibraryRequestComments] edit failed:", error);
      showFeedback(
        error?.message || `${entryLabel} 수정 중 문제가 생겼어요. 다시 시도해 주세요.`,
        "error",
      );
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteComment = async (comment) => {
    const entryLabel = getEntryLabel(comment);

    if (!canManageComment(comment)) {
      showFeedback(`이 ${entryLabel}은 삭제할 수 없어요.`, "warning");
      return null;
    }

    if (typeof window !== "undefined") {
      const confirmed = (await appConfirm(`${entryLabel}을 삭제할까요? 답글이 있으면 함께 삭제됩니다.`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}));
      if (!confirmed) {
        return null;
      }
    }

    setIsSubmitting(true);
    try {
      await deleteCaseLibraryRequestComment({
        classId: resolvedClassId,
        requestId,
        commentId: comment.id,
      });
      showFeedback(`${entryLabel}을 삭제했어요.`, "success");
      return true;
    } catch (error) {
      console.error("[useCaseLibraryRequestComments] delete failed:", error);
      showFeedback(
        error?.message || `${entryLabel} 삭제 중 문제가 생겼어요. 다시 시도해 주세요.`,
        "error",
      );
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

