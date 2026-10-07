import { appConfirm } from "../../../utils/appDialogs";
// src/pages/news/components/NewsComments.jsx
import React, { useMemo, useState } from "react";
import { Button, Textarea, Spinner } from "../../../components/ui";
import { User, Send, MessageCircle, Trash2 } from "lucide-react";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  useInfiniteComments,
  useLiveComments,
  useNewsActions,
} from "../hooks/useNewsQueries";

const NewsComments = ({ newsId, classId, isTeacher, canManage = false }) => {
  const { userData, hasPermission } = useUser();
  const { showFeedback } = useFeedback();
  const [newComment, setNewComment] = useState("");
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const LIVE_COMMENT_LIMIT = 7;

  // 최신 댓글은 실시간 구독
  const {
    list: liveComments,
    oldestDoc: liveOldestDoc,
    isLoading: isLiveLoading,
  } = useLiveComments(classId, newsId, { liveLimit: LIVE_COMMENT_LIMIT });
  const shouldFetchOlder = !!liveOldestDoc && liveComments.length >= LIVE_COMMENT_LIMIT;

  // 오래된 댓글은 페이지네이션으로 추가 로드
  const {
    data,
    fetchNextPage,
    hasNextPage = false,
    isFetchingNextPage,
    isLoading: isOlderLoading,
  } = useInfiniteComments(classId, newsId, {
    startAfterDoc: liveOldestDoc,
    enabled: shouldFetchOlder,
    pageSize: LIVE_COMMENT_LIMIT,
  });

  const { addComment, deleteComment } = useNewsActions(classId);
  const olderComments = useMemo(
    () => data?.pages.flatMap((page) => page.list) || [],
    [data],
  );
  const canModerateComments = isTeacher || canManage || hasPermission("news_admin");

  const allComments = useMemo(() => {
    const map = new Map();
    [...liveComments, ...olderComments].forEach((comment) => {
      if (!map.has(comment.id)) {
        map.set(comment.id, comment);
      }
    });
    return Array.from(map.values());
  }, [liveComments, olderComments]);

  const isLoading = isLiveLoading || (shouldFetchOlder && isOlderLoading);

  const handleSubmit = async () => {
    if (!newComment.trim()) return;
    try {
      // 🚀 핵심: classId를 인자에 포함시켜야 합니다.
      await addComment({
        classId: classId, // 👈 추가된 부분
        newsId: newsId,
        commentData: {
          content: newComment.trim(),
          authorUid: userData.uid,
          authorName: userData.name,
          authorRole: userData.role || "student",
          likes: [],
          likesCount: 0,
        }
      });
      setNewComment("");
      showFeedback("댓글이 등록되었습니다.", "success");
    } catch (err) {
      console.error("댓글 등록 에러 상세:", err); // 🔍 에러 확인용 로깅 추가
      showFeedback("댓글 등록 실패", "error");
    }
  };

  const handleDeleteComment = async (comment) => {
    if (!comment?.id) return;
    if (!(await appConfirm("이 댓글을 삭제할까요?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;

    setDeletingCommentId(comment.id);
    try {
      await deleteComment({
        classId,
        newsId,
        commentId: comment.id,
      });
      showFeedback("댓글을 삭제했습니다.", "success");
    } catch (error) {
      console.error("[NewsComments] delete comment failed:", error);
      showFeedback("댓글 삭제에 실패했습니다.", "error");
    } finally {
      setDeletingCommentId(null);
    }
  };

  return (
    <div className="space-y-6 pt-2">
      <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-blue-500" />
        전체 댓글 ({allComments.length})
      </h3>

      {/* 댓글 입력창 */}
      <div className="flex gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
        <div className="w-9 h-9 bg-white rounded-full flex items-center justify-center flex-shrink-0 shadow-sm">
          <User className="w-5 h-5 text-slate-400" />
        </div>
        <div className="flex-1">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="따뜻한 댓글을 남겨주세요..."
            rows={2}
            className="text-sm bg-white border-none focus:ring-2 focus:ring-blue-100 rounded-xl transition-all resize-none"
          />
          <div className="flex justify-end mt-3">
            <Button tone="blue" kind="solid" size="sm" onClick={handleSubmit} disabled={!newComment.trim()} >
              <Send className="w-3.5 h-3.5 mr-1.5" /> 댓글 등록
            </Button>
          </div>
        </div>
      </div>

      {/* 댓글 목록 */}
      <div className="mt-8 space-y-6">
        {isLoading ? <Spinner /> : allComments.map(comment => (
          <div key={comment.id} className="flex gap-3 animate-in fade-in">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
              <User className="w-5 h-5 text-slate-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-slate-900">@{comment.authorName}</span>
                  <span className="text-[11px] text-slate-400 font-medium">
                    {comment.createdAt?.toDate().toLocaleDateString()}
                  </span>
                </div>
                {(canModerateComments || comment.authorUid === userData?.uid) && (
                  <Button tone="slate" kind="ghost" size="icon-md"
                    type="button"
                    onClick={() => handleDeleteComment(comment)}
                    disabled={deletingCommentId === comment.id}
                    className="inline-flex h-7 w-7 items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="댓글 삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <p className="text-[14px] text-slate-700 mt-1">{comment.content}</p>
            </div>
          </div>
        ))}

        {hasNextPage && (
          <div className="text-center pt-4">
            <Button variant="ghost" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? "로딩 중..." : "댓글 더 보기"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default NewsComments;
