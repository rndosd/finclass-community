import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import AppLayout from "../../components/layout/AppLayout";
import { Button, ErrorState, SectionLoader } from "../../components/ui";
import CaseLibraryApplyModal from "./components/CaseLibraryApplyModal";
import CaseLibraryBodyContent from "./components/CaseLibraryBodyContent";
import CaseLibraryCommentsSection from "./components/CaseLibraryCommentsSection";
import CaseLibraryDetailSummary from "./components/CaseLibraryDetailSummary";
import CaseLibraryNotFoundState from "./components/CaseLibraryNotFoundState";
import CaseLibraryRelatedCases from "./components/CaseLibraryRelatedCases";
import CaseLibraryTemplatePanel from "./components/CaseLibraryTemplatePanel";
import useCaseLibraryComments from "./hooks/useCaseLibraryComments";
import useCaseLibraryDetail from "./hooks/useCaseLibraryDetail";
import useCaseLibraryPostManage from "./hooks/useCaseLibraryPostManage";
import useCaseLibraryPostRecommend from "./hooks/useCaseLibraryPostRecommend";
import useCaseLibraryPostSave from "./hooks/useCaseLibraryPostSave";

function DetailStatusPanel({ message, loading = false }) {
  return (
    <AppLayout showSidebar showDefaultHeader={false}>
      <div className="min-h-screen bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        {loading ? (
          <SectionLoader
            message={message}
            minHeightClassName="min-h-[240px]"
          />
        ) : (
          <ErrorState variant="section" title={message} onReload={() => window.location.reload()} />
        )}
      </div>
    </AppLayout>
  );
}

export default function CaseLibraryDetailPage() {
  const navigate = useNavigate();
  const { caseId } = useParams();
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const { casePost, error, loading, pageMeta, relatedCases, updatedLabel } =
    useCaseLibraryDetail(caseId);
  const sourceClassId = String(casePost?.classId || "").trim();
  const postId = String(casePost?.postId || casePost?.id || "").trim();
  const { handleToggleSave, isSaved, isSaving } = useCaseLibraryPostSave(
    postId,
    sourceClassId,
  );
  const {
    commentCount,
    commentText,
    comments,
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
    loading: commentsLoading,
    replyTargetId,
    replyText,
    setCommentText,
    setEditingText,
    setReplyText,
    setTeacherNamePublic,
    teacherNamePublic,
  } = useCaseLibraryComments(postId, sourceClassId);
  const {
    handleToggleRecommend,
    isRecommended,
    isRecommending,
  } = useCaseLibraryPostRecommend(postId, sourceClassId);
  const { canManagePost, handleDeletePost, handleEditPost, isDeleting } =
    useCaseLibraryPostManage(casePost);

  if (loading) {
    return <DetailStatusPanel message="운영사례를 불러오는 중입니다." loading />;
  }

  if (error) {
    return (
      <DetailStatusPanel message="운영사례를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." />
    );
  }

  if (!casePost) {
    return (
      <AppLayout showSidebar showDefaultHeader={false}>
        <div className="min-h-screen bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
          <CaseLibraryNotFoundState onBack={() => navigate("/case-library")} />
        </div>
      </AppLayout>
    );
  }

  const canApplyTemplate = Boolean(casePost.template && casePost.templatePayload);

  return (
    <AppLayout showSidebar showDefaultHeader={false}>
      <div className="min-h-screen bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-[1220px] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              tone="slate"
              kind="outline"
              onClick={() => navigate("/case-library")}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              목록으로
            </Button>

            {canManagePost ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button tone="slate" kind="outline" onClick={handleEditPost}>
                  <Pencil className="mr-1 h-4 w-4" />
                  수정
                </Button>
                <Button
                  tone="rose"
                  kind="outline"
                  onClick={handleDeletePost}
                  disabled={isDeleting}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  {isDeleting ? "삭제 중..." : "삭제"}
                </Button>
              </div>
            ) : null}
          </div>

          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <CaseLibraryDetailSummary
              casePost={casePost}
              pageMeta={pageMeta}
              updatedLabel={updatedLabel}
              isRecommended={isRecommended}
              isRecommending={isRecommending}
              isSaved={isSaved}
              isSaving={isSaving}
              onToggleRecommend={handleToggleRecommend}
              onToggleSave={handleToggleSave}
            />
            <CaseLibraryBodyContent bodyHtml={casePost.bodyHtml} />

            {casePost.template ? (
              <CaseLibraryTemplatePanel
                canApply={canApplyTemplate}
                casePost={casePost}
                pageMeta={pageMeta}
                template={casePost.template}
                onApply={() => setIsApplyModalOpen(true)}
              />
            ) : null}
          </article>

          {relatedCases.length > 0 ? (
            <CaseLibraryRelatedCases
              pageMeta={pageMeta}
              relatedCases={relatedCases}
            />
          ) : null}

          <CaseLibraryCommentsSection
            commentCount={commentCount}
            commentText={commentText}
            comments={comments}
            currentUid={currentUid}
            editingCommentId={editingCommentId}
            editingText={editingText}
            isLoading={commentsLoading}
            isSubmitting={isSubmitting}
            onCancelEdit={handleCancelEdit}
            onCancelReply={handleCancelReply}
            onChangeCommentText={setCommentText}
            onChangeEditingText={setEditingText}
            onChangeReplyText={setReplyText}
            onDeleteComment={handleDeleteComment}
            onStartEdit={handleStartEdit}
            onStartReply={handleStartReply}
            onSubmitComment={handleSubmitRootComment}
            onSubmitEdit={handleSubmitEdit}
            onSubmitReply={handleSubmitReply}
            replyTargetId={replyTargetId}
            replyText={replyText}
            teacherNamePublic={teacherNamePublic}
            onTeacherNamePublicChange={setTeacherNamePublic}
          />
        </div>
      </div>

      <CaseLibraryApplyModal
        caseId={casePost.id}
        isOpen={isApplyModalOpen}
        onClose={() => setIsApplyModalOpen(false)}
      />
    </AppLayout>
  );
}
