import React from "react";
import { ArrowLeft, CircleHelp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../../components/layout/AppLayout";
import { Button, PageHeader } from "../../components/ui";
import { composerPageMeta } from "./caseLibraryRegistry";
import CaseLibraryComposerMetaForm from "./components/CaseLibraryComposerMetaForm";
import CaseLibrarySectionTabs from "./components/CaseLibrarySectionTabs";
import useCaseLibraryRequestComposer from "./hooks/useCaseLibraryRequestComposer";

export default function CaseLibraryRequestComposerPage() {
  const navigate = useNavigate();
  const {
    content,
    handlePublish,
    isLoadingRequest,
    isSubmitting,
    pageMeta,
    pageTitle,
    pageType,
    pageTypes,
    setContent,
    setPageType,
    setTeacherNamePublic,
    setTitle,
    submitButtonLabel,
    teacherNamePublic,
    title,
  } = useCaseLibraryRequestComposer();

  return (
    <AppLayout showSidebar showDefaultHeader={false}>
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-[1220px] space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            tone="slate"
            kind="outline"
            onClick={() => navigate("/case-library/requests")}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            목록으로
          </Button>
        </div>

        <PageHeader
          title={pageTitle}
          subtitle="짧은 답변으로도 이어질 수 있고, 필요하면 정식 운영사례 작성으로 연결할 수 있어요."
          icon={CircleHelp}
          rightSlot={
            <div className="flex flex-wrap gap-2">
              <Button tone="blue" onClick={handlePublish} disabled={isSubmitting || isLoadingRequest}>
                {isSubmitting ? "저장 중..." : submitButtonLabel}
              </Button>
            </div>
          }
        />

        <CaseLibrarySectionTabs />

        <section className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm">
          {isLoadingRequest ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              요청 정보를 불러오는 중입니다.
            </div>
          ) : null}

          <CaseLibraryComposerMetaForm
            disabled={isLoadingRequest}
            titlePlaceholder={`${pageMeta.label}에서 궁금한 운영 방법`}
            pageMeta={pageMeta}
            pageMetaMap={composerPageMeta}
            pageType={pageType}
            pageTypes={pageTypes}
            teacherNamePublic={teacherNamePublic}
            title={title}
            onPageTypeChange={setPageType}
            onTeacherNamePublicChange={setTeacherNamePublic}
            onTitleChange={setTitle}
          />

          <div className="mt-4">
            <textarea
              aria-label="사례 요청 내용"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="걸린 상황, 궁금한 점, 현재까지 해본 방법을 자세히 적어 주세요."
              disabled={isLoadingRequest}
              className="min-h-[220px] w-full rounded-xl border border-blue-200 px-4 py-4 text-sm leading-7 text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50 disabled:text-slate-400"
            />
          </div>
        </section>
        </div>
      </div>
    </AppLayout>
  );
}
