import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, FileStack, Printer, SlidersHorizontal } from "lucide-react";
import AppLayout from "../../components/layout/AppLayout";
import { Button, PageHeader } from "../../components/ui";
import CaseLibraryPdfOutlineEditor from "./components/CaseLibraryPdfOutlineEditor";
import CaseLibraryPdfPostSelector from "./components/CaseLibraryPdfPostSelector";
import CaseLibraryPdfPreview from "./components/CaseLibraryPdfPreview";
import useCaseLibraryPdfBuilder from "./hooks/useCaseLibraryPdfBuilder";

const printStyles = `
  @page {
    size: A4;
    margin: 14mm;
  }

  @media print {
    body {
      background: #ffffff !important;
    }

    .case-library-pdf-screen {
      display: none !important;
    }

    .case-library-pdf-root {
      padding: 0 !important;
      background: #ffffff !important;
    }

    .case-library-pdf-preview {
      max-width: none !important;
      margin: 0 !important;
      width: 100% !important;
    }

    .case-library-pdf-page {
      box-shadow: none !important;
      border: none !important;
      border-radius: 0 !important;
      margin: 0 0 10mm 0 !important;
      break-after: page;
      page-break-after: always;
    }

    .case-library-pdf-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }

    .case-library-pdf-page--continued {
      break-after: auto !important;
      page-break-after: auto !important;
      margin-bottom: 6mm !important;
    }
  }
`;

export default function CaseLibraryPdfBuilderPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const {
    clearSelectedPosts,
    closingNote,
    coverNote,
    documentTitle,
    error,
    exportAuthorLabel,
    generatedDateLabel,
    handlePrint,
    introNote,
    layoutOptions,
    loading,
    moveSelectedPost,
    ownPosts,
    selectedIdSet,
    selectedPosts,
    selectAllPosts,
    setClosingNote,
    setCoverNote,
    setDocumentTitle,
    setIntroNote,
    togglePostSelection,
    toggleSectionBreakAfter,
    updateLayoutOption,
    updateSectionTitle,
  } = useCaseLibraryPdfBuilder();

  return (
    <AppLayout showSidebar={false} showDefaultHeader={false}>
      <style>{printStyles}</style>

      <div className="case-library-pdf-root min-h-screen bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <div className="case-library-pdf-screen space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              tone="slate"
              kind="outline"
              onClick={() => navigate("/case-library/dashboard", {
                state: { caseLibraryReturn: location.state?.caseLibraryReturn },
              })}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              내 활동으로
            </Button>
          </div>

          <PageHeader
            title="자료 내보내기"
            subtitle="미리보기를 보면서 글 순서와 페이지 경계를 조절한 뒤 PDF로 저장할 수 있습니다."
            icon={FileStack}
            rightSlot={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  tone="slate"
                  kind="outline"
                  onClick={() => setShowAdvanced((current) => !current)}
                >
                  <SlidersHorizontal className="mr-1 h-4 w-4" />
                  {showAdvanced ? "고급 편집 닫기" : "고급 편집"}
                </Button>
                <Button
                  tone="slate"
                  kind="outline"
                  onClick={() => setShowPreview((current) => !current)}
                >
                  {showPreview ? (
                    <EyeOff className="mr-1 h-4 w-4" />
                  ) : (
                    <Eye className="mr-1 h-4 w-4" />
                  )}
                  {showPreview ? "미리보기 숨기기" : "미리보기 보기"}
                </Button>
                <Button
                  tone="blue"
                  onClick={handlePrint}
                  disabled={selectedPosts.length === 0}
                >
                  <Printer className="mr-1 h-4 w-4" />
                  인쇄/PDF 저장
                </Button>
              </div>
            }
          />

          {error ? (
            <section className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
              글 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
            </section>
          ) : null}

          <section className="rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                    PDF
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                    PPT 준비 중
                  </span>
                </div>
                <h2 className="mt-1 text-lg font-black text-slate-900">
                  {documentTitle || "연수자료 제목"}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <span className="rounded-full bg-slate-100 px-3 py-1.5">
                  선택한 글 {selectedPosts.length}건
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1.5">
                  작성자 {exportAuthorLabel}
                </span>
              </div>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <CaseLibraryPdfPostSelector
              loading={loading}
              ownPosts={ownPosts}
              selectedIdSet={selectedIdSet}
              onClearAll={clearSelectedPosts}
              onSelectAll={selectAllPosts}
              onTogglePost={togglePostSelection}
            />

            <CaseLibraryPdfOutlineEditor
              closingNote={closingNote}
              coverNote={coverNote}
              documentTitle={documentTitle}
              introNote={introNote}
              layoutOptions={layoutOptions}
              selectedPosts={selectedPosts}
              setClosingNote={setClosingNote}
              setCoverNote={setCoverNote}
              setDocumentTitle={setDocumentTitle}
              setIntroNote={setIntroNote}
              showAdvanced={showAdvanced}
              onToggleAdvanced={() => setShowAdvanced((current) => !current)}
              onToggleBreakAfter={toggleSectionBreakAfter}
              updateLayoutOption={updateLayoutOption}
              onMovePost={moveSelectedPost}
              onUpdateSectionTitle={updateSectionTitle}
            />
          </div>

          {showPreview ? (
            <CaseLibraryPdfPreview
              closingNote={closingNote}
              coverNote={coverNote}
              documentTitle={documentTitle}
              generatedDateLabel={generatedDateLabel}
              introNote={introNote}
              layoutOptions={layoutOptions}
              selectedPosts={selectedPosts}
              teacherLabel={exportAuthorLabel}
            />
          ) : null}
        </div>

        <div className="hidden print:block">
          <CaseLibraryPdfPreview
            closingNote={closingNote}
            coverNote={coverNote}
            documentTitle={documentTitle}
            generatedDateLabel={generatedDateLabel}
            introNote={introNote}
            layoutOptions={layoutOptions}
            selectedPosts={selectedPosts}
            teacherLabel={exportAuthorLabel}
          />
        </div>
      </div>
    </AppLayout>
  );
}
