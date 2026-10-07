import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CircleHelp, Eye, FilePenLine, Save } from "lucide-react";
import AppLayout from "../../components/layout/AppLayout";
import { Button, PageHeader } from "../../components/ui";
import CaseLibraryComposerBodyEditor from "./components/CaseLibraryComposerBodyEditor";
import CaseLibraryComposerMetaForm from "./components/CaseLibraryComposerMetaForm";
import CaseLibraryComposerPreviewModal from "./components/CaseLibraryComposerPreviewModal";
import CaseLibraryComposerTemplateAttachment from "./components/CaseLibraryComposerTemplateAttachment";
import { composerPageMeta } from "./caseLibraryRegistry";
import useCaseLibraryComposer from "./hooks/useCaseLibraryComposer";

export default function CaseLibraryComposerPage() {
  const navigate = useNavigate();
  const { caseId } = useParams();
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const {
    attachTemplate,
    bodyPreview,
    canEditPost,
    content,
    handlePublish,
    handleSaveDraft,
    handleTemplateToggle,
    isDraftSaving,
    isEditing,
    isEditorUploading,
    pageMeta,
    pageType,
    pageTypes,
    previewTitle,
    publishDisabled,
    scopeOptions,
    selectedScopes,
    setContent,
    setIsEditorUploading,
    setPageType,
    setTeacherNamePublic,
    setTitle,
    teacherNamePublic,
    templateRuntimeSupported,
    templateSupported,
    title,
    toggleScope,
    linkedRequest,
  } = useCaseLibraryComposer();

  return (
    <AppLayout showSidebar showDefaultHeader={false}>
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-[1220px] space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            tone="slate"
            kind="outline"
            onClick={() =>
              navigate(isEditing ? `/case-library/${caseId}` : "/case-library")
            }
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            목록으로
          </Button>
        </div>

        <PageHeader
          title={isEditing ? "운영사례 수정" : "운영사례 작성"}
          subtitle={
            isEditing
              ? "기존 글 내용을 수정하고 다시 저장할 수 있습니다."
              : "지금 보고 있는 카테고리에 맞춰 글을 작성하고, 필요한 경우 템플릿도 함께 첨부할 수 있습니다."
          }
          icon={FilePenLine}
          rightSlot={
            <div className="flex flex-wrap items-center gap-2">
              {!isEditing ? (
                <Button
                  tone="slate"
                  kind="outline"
                  icon={Save}
                  onClick={handleSaveDraft}
                  disabled={isDraftSaving || isEditorUploading || publishDisabled}
                >
                  {isDraftSaving ? "임시저장 중..." : "임시저장"}
                </Button>
              ) : null}
              <Button
                tone="slate"
                kind="outline"
                icon={Eye}
                onClick={() => setIsPreviewOpen(true)}
                disabled={publishDisabled}
              >
                미리보기
              </Button>
              <Button
                tone="blue"
                onClick={handlePublish}
                disabled={publishDisabled || !canEditPost}
              >
                {isEditing ? "수정 완료" : "게시하기"}
              </Button>
            </div>
          }
        />

        <div className="w-full space-y-5">
          {linkedRequest ? (
            <section className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900">
              <div className="flex flex-wrap items-center gap-2 font-semibold">
                <CircleHelp className="h-4 w-4" />
                <span>이 요청에 답변하는 운영사례를 작성 중입니다.</span>
              </div>
              <div className="mt-2 text-blue-800">
                {linkedRequest.title}
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm">
            <CaseLibraryComposerMetaForm
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

            <CaseLibraryComposerBodyEditor
              content={content}
              isUploading={isEditorUploading}
              onChange={setContent}
              onUploadStateChange={setIsEditorUploading}
            />
          </section>

          {templateSupported ? (
            <CaseLibraryComposerTemplateAttachment
              attachTemplate={attachTemplate}
              pageMeta={pageMeta}
              selectedScopes={selectedScopes}
              scopeOptions={scopeOptions}
              templateRuntimeSupported={templateRuntimeSupported}
              templateSupported={templateSupported}
              onAttachTemplateChange={handleTemplateToggle}
              onToggleScope={toggleScope}
            />
          ) : null}
        </div>

        </div>

        <CaseLibraryComposerPreviewModal
          attachTemplate={attachTemplate}
          bodyPreview={bodyPreview}
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          onPublish={handlePublish}
          pageMeta={pageMeta}
          previewTitle={previewTitle}
          publishDisabled={publishDisabled}
          scopeOptions={scopeOptions}
          selectedScopes={selectedScopes}
          teacherNamePublic={teacherNamePublic}
        />
      </div>
    </AppLayout>
  );
}
