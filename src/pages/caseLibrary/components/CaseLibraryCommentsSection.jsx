import React from "react";
import { CornerDownRight, MessageSquareText, ThumbsUp } from "lucide-react";
import { Button } from "../../../components/ui";
import { formatCaseDateTime } from "../caseLibraryPostUtils";
import useCaseLibraryCommentRecommend from "../hooks/useCaseLibraryCommentRecommend";
import CaseLibraryTeacherVisibilityToggle from "./CaseLibraryTeacherVisibilityToggle";

function CommentComposer({
  value,
  placeholder,
  submitLabel,
  teacherNamePublic,
  onTeacherNamePublicChange,
  showVisibilityToggle = false,
  onChange,
  onCancel,
  onSubmit,
  submitting,
}) {
  const hasMetaActions = showVisibilityToggle || Boolean(onCancel);

  return (
    <div className="mt-3">
      <div className="grid items-stretch gap-2 md:grid-cols-[minmax(0,1fr)_132px]">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-h-[112px] w-full rounded-xl border border-blue-200 px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
        />
        <div className="flex min-w-[132px] flex-col gap-2">
          {hasMetaActions ? (
            <div className="flex flex-wrap justify-end gap-2">
              {showVisibilityToggle ? (
                <CaseLibraryTeacherVisibilityToggle
                  teacherNamePublic={teacherNamePublic}
                  onChange={onTeacherNamePublicChange}
                  className="justify-center"
                />
              ) : null}
              {onCancel ? (
                <Button tone="slate" kind="outline" onClick={onCancel} className="min-w-[92px]">
                  취소
                </Button>
              ) : null}
            </div>
          ) : null}
          <Button
            tone="blue"
            onClick={onSubmit}
            disabled={submitting}
            className={hasMetaActions ? "min-h-[70px] flex-1" : "min-h-[112px]"}
          >
            {submitting ? "처리 중..." : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  currentUid,
  depth = 0,
  editingCommentId,
  editingText,
  isSubmitting,
  onCancelEdit,
  onCancelReply,
  onChangeEditingText,
  onChangeReplyText,
  onDeleteComment,
  onStartEdit,
  onStartReply,
  onSubmitEdit,
  onSubmitReply,
  replyTargetId,
  replyText,
  readOnly = false,
  teacherNamePublic,
  onTeacherNamePublicChange,
}) {
  const { handleToggleRecommend, isRecommended, isToggling } =
    useCaseLibraryCommentRecommend(comment.postId, comment.id, comment.classId);
  const authorLabel = `${comment.classLabel || "학급"}(${
    comment.teacherNamePublic === false
      ? "비공개"
      : comment.authorName || "교사"
  })`;
  const isEditing = editingCommentId === comment.id;
  const isReplying = replyTargetId === comment.id;
  const canManage =
    String(comment.authorUid || "").trim() === String(currentUid || "").trim();

  return (
    <li className={depth > 0 ? "border-l-2 border-slate-100 pl-4 sm:pl-6" : ""}>
      <div className="px-5 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-semibold text-slate-800">{authorLabel}</span>
            <span className="text-slate-400">
              {formatCaseDateTime(comment.createdAt || comment.updatedAt)}
            </span>
            {comment.parentId ? (
              <span className="text-xs text-slate-400">
                답글
                {comment.replyToAuthorName ? ` · ${comment.replyToAuthorName}` : ""}
              </span>
            ) : null}
          </div>

          {readOnly ? null : (
            <Button
              type="button"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold transition ${
                isRecommended
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              }`}
              onClick={handleToggleRecommend}
              disabled={isToggling}
              title="댓글 추천"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              <span>{Number(comment.recommendCount || 0)}</span>
            </Button>
          )}
        </div>

        {isEditing ? (
          <CommentComposer
            value={editingText}
            placeholder="수정할 댓글 내용을 입력해 주세요."
            submitLabel="수정 완료"
            onChange={onChangeEditingText}
            onCancel={onCancelEdit}
            onSubmit={() => onSubmitEdit(comment)}
            submitting={isSubmitting}
          />
        ) : (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">
            {comment.content}
          </p>
        )}

        {!isEditing && !readOnly ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Button tone="slate" kind="ghost" size="md"
              type="button"
              className="inline-flex items-center gap-1"
              onClick={() => onStartReply(comment)}
            >
              <CornerDownRight className="h-3.5 w-3.5" />
              답글
            </Button>

            {canManage ? (
              <>
                <span className="text-slate-300">|</span>
                <Button tone="slate" kind="ghost" size="md"
                  type="button"
                  
                  onClick={() => onStartEdit(comment)}
                >
                  수정
                </Button>
                <span className="text-slate-300">|</span>
                <Button tone="rose" kind="ghost" size="md"
                  type="button"
                  
                  onClick={() => onDeleteComment(comment)}
                >
                  삭제
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        {isReplying && !readOnly ? (
          <CommentComposer
            value={replyText}
            teacherNamePublic={teacherNamePublic}
            onTeacherNamePublicChange={onTeacherNamePublicChange}
            showVisibilityToggle
            placeholder="답글 내용을 입력해 주세요."
            submitLabel="답글 등록"
            onChange={onChangeReplyText}
            onCancel={onCancelReply}
            onSubmit={() => onSubmitReply(comment)}
            submitting={isSubmitting}
          />
        ) : null}
      </div>

      {comment.children?.length ? (
        <ul className="divide-y divide-slate-100">
          {comment.children.map((childComment) => (
            <CommentItem
              key={childComment.id}
              comment={childComment}
              currentUid={currentUid}
              depth={depth + 1}
              editingCommentId={editingCommentId}
              editingText={editingText}
              isSubmitting={isSubmitting}
              onCancelEdit={onCancelEdit}
              onCancelReply={onCancelReply}
              onChangeEditingText={onChangeEditingText}
              onChangeReplyText={onChangeReplyText}
              onDeleteComment={onDeleteComment}
              onStartEdit={onStartEdit}
              onStartReply={onStartReply}
              onSubmitEdit={onSubmitEdit}
              onSubmitReply={onSubmitReply}
              replyTargetId={replyTargetId}
              replyText={replyText}
              readOnly={readOnly}
              teacherNamePublic={teacherNamePublic}
              onTeacherNamePublicChange={onTeacherNamePublicChange}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function CaseLibraryCommentsSection({
  commentCount,
  commentText,
  comments,
  currentUid,
  editingCommentId,
  editingText,
  isLoading,
  isSubmitting,
  onCancelEdit,
  onCancelReply,
  onChangeCommentText,
  onChangeEditingText,
  onChangeReplyText,
  onDeleteComment,
  onStartEdit,
  onStartReply,
  onSubmitComment,
  onSubmitEdit,
  onSubmitReply,
  replyTargetId,
  replyText,
  readOnly = false,
  teacherNamePublic,
  onTeacherNamePublicChange,
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <MessageSquareText className="h-4 w-4 text-slate-500" />
          댓글 {commentCount}
        </div>
      </div>

      {readOnly ? null : (
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <CommentComposer
            value={commentText}
            teacherNamePublic={teacherNamePublic}
            onTeacherNamePublicChange={onTeacherNamePublicChange}
            showVisibilityToggle
            placeholder="운영 팁이나 궁금했던 점을 댓글로 남겨 보세요."
            submitLabel="댓글 등록"
            onChange={onChangeCommentText}
            onSubmit={onSubmitComment}
            submitting={isSubmitting}
          />
        </div>
      )}

      {isLoading ? (
        <div className="px-5 py-8 text-sm text-slate-500 sm:px-6">
          댓글을 불러오는 중입니다.
        </div>
      ) : comments.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUid={currentUid}
              editingCommentId={editingCommentId}
              editingText={editingText}
              isSubmitting={isSubmitting}
              onCancelEdit={onCancelEdit}
              onCancelReply={onCancelReply}
              onChangeEditingText={onChangeEditingText}
              onChangeReplyText={onChangeReplyText}
              onDeleteComment={onDeleteComment}
              onStartEdit={onStartEdit}
              onStartReply={onStartReply}
              onSubmitEdit={onSubmitEdit}
              onSubmitReply={onSubmitReply}
              replyTargetId={replyTargetId}
              replyText={replyText}
              readOnly={readOnly}
              teacherNamePublic={teacherNamePublic}
              onTeacherNamePublicChange={onTeacherNamePublicChange}
            />
          ))}
        </ul>
      ) : (
        <div className="px-5 py-8 text-sm text-slate-500 sm:px-6">
          아직 댓글이 없습니다. 첫 댓글을 남겨 보세요.
        </div>
      )}
    </section>
  );
}
