import React from "react";
import { ArrowLeft, BookOpenText, CircleHelp, Pencil } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import AppLayout from "../../components/layout/AppLayout";
import { Badge, Button, ErrorState, SectionLoader } from "../../components/ui";
import { useUser } from "../../contexts/UserContext";
import { formatCaseDateTime } from "./caseLibraryPostUtils";
import { getCaseClassLabel, getCaseTeacherLabel } from "./caseLibraryAuthorUtils";
import { getCaseRequestStatus } from "./caseLibraryRequestUtils";
import CaseLibraryRequestCommentsSection from "./components/CaseLibraryRequestCommentsSection";
import CaseLibraryRequestLinkedCases from "./components/CaseLibraryRequestLinkedCases";
import CaseLibrarySectionTabs from "./components/CaseLibrarySectionTabs";
import useCaseLibraryRequestComments from "./hooks/useCaseLibraryRequestComments";
import useCaseLibraryRequestDetail from "./hooks/useCaseLibraryRequestDetail";
import useCaseLibraryRequestInterest from "./hooks/useCaseLibraryRequestInterest";

function DetailStatusPanel({ message, loading = false, error = false }) {
  return (
    <AppLayout showSidebar showDefaultHeader={false}>
      <div className="min-h-screen bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        {loading ? (
          <SectionLoader
            message={message}
            minHeightClassName="min-h-[240px]"
          />
        ) : error ? (
          <ErrorState variant="section" title={message} onReload={() => window.location.reload()} />
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-sm text-slate-600">
            {message}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

export default function CaseLibraryRequestDetailPage() {
  const navigate = useNavigate();
  const { requestId } = useParams();
  const [searchParams] = useSearchParams();
  const { classId } = useUser();
  const requestedSourceClassId = String(
    searchParams.get("sourceClassId") || "",
  ).trim();
  const { error, linkedCases, loading, pageMeta, request } =
    useCaseLibraryRequestDetail(requestId, requestedSourceClassId);
  const sourceClassId = String(
    request?.classId || requestedSourceClassId || "",
  ).trim();
  const { handleToggleInterest, isInterested, isToggling } =
    useCaseLibraryRequestInterest(requestId, sourceClassId);
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
  } = useCaseLibraryRequestComments(requestId, sourceClassId);

  if (loading) {
    return <DetailStatusPanel message="사례 요청을 불러오는 중입니다." loading />;
  }

  if (error) {
    return (
      <DetailStatusPanel message="사례 요청을 불러오지 못했습니다." error />
    );
  }

  if (!request) {
    return <DetailStatusPanel message="사례 요청을 찾지 못했습니다." />;
  }

  const authorLabel = `${getCaseClassLabel(request)}(${
    getCaseTeacherLabel(request) || "비공개"
  })`;
  const status = getCaseRequestStatus({
    ...request,
    commentCount,
    linkedCaseCount: linkedCases.length,
  });
  const canManageRequest = Boolean(
    request &&
      String(request.classId || "").trim() === String(classId || "").trim() &&
      String(request.authorUid || "").trim() === String(currentUid || "").trim(),
  );

  const handleWriteCase = () => {
    const pageTypeQuery = encodeURIComponent(request.pageType);
    const requestIdQuery = encodeURIComponent(request.id);
    const requestClassIdQuery = encodeURIComponent(request.classId || "");
    navigate(
      `/case-library/new?pageType=${pageTypeQuery}&requestId=${requestIdQuery}&requestClassId=${requestClassIdQuery}`,
    );
  };

  const handleEditRequest = () => {
    if (!request?.id || !canManageRequest) {
      return;
    }

    navigate(`/case-library/requests/${request.id}/edit`);
  };

  return (
    <AppLayout showSidebar showDefaultHeader={false}>
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-[1220px] space-y-6">
        <CaseLibrarySectionTabs />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            tone="slate"
            kind="outline"
            onClick={() => navigate("/case-library/requests")}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            목록으로
          </Button>

          <div className="flex flex-wrap gap-2">
            {canManageRequest ? (
              <Button tone="slate" kind="outline" onClick={handleEditRequest}>
                <Pencil className="mr-1 h-4 w-4" />
                수정
              </Button>
            ) : null}
            <Button
              tone={isInterested ? "blue" : "slate"}
              kind={isInterested ? "solid" : "outline"}
              onClick={handleToggleInterest}
              disabled={isToggling}
            >
              <CircleHelp className="mr-1 h-4 w-4" />
              {isInterested ? "나도 궁금해요 취소" : "나도 궁금해요"}
            </Button>
            <Button tone="blue" onClick={handleWriteCase}>
              <BookOpenText className="mr-1 h-4 w-4" />
              이 요청으로 운영사례 작성
            </Button>
          </div>
        </div>

        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-5 sm:px-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={pageMeta.tone} pill={false}>
                {pageMeta.label}
              </Badge>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  status.tone === "emerald"
                    ? "bg-emerald-50 text-emerald-700"
                    : status.tone === "blue"
                      ? "bg-blue-50 text-blue-700"
                      : "bg-amber-50 text-amber-700"
                }`}
              >
                {status.label}
              </span>
            </div>

            <h1 className="mt-4 text-2xl font-black tracking-tight text-slate-950 sm:text-[30px]">
              {request.title}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-500">
              <span className="font-semibold text-slate-700">{authorLabel}</span>
              <span>|</span>
              <span>{formatCaseDateTime(request.updatedAt || request.createdAt)}</span>
              <span>|</span>
              <span>나도 궁금해요 {Number(request.interestCount || 0)}</span>
              <span>|</span>
              <span>답변 {commentCount}</span>
            </div>
          </div>

          <div className="px-5 py-6 sm:px-8">
            <p className="whitespace-pre-wrap text-[15px] leading-8 text-slate-700">
              {request.content}
            </p>
          </div>

        </article>

        <CaseLibraryRequestCommentsSection
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

        <CaseLibraryRequestLinkedCases linkedCases={linkedCases} />
        </div>
      </div>
    </AppLayout>
  );
}
