import React from "react";
import { CopyPlus } from "lucide-react";
import { Button, Modal } from "../../../components/ui";
import { buildCaseLibraryTemplatePreview } from "../caseLibraryTemplatePreview";
import useCaseLibraryApply from "../hooks/useCaseLibraryApply";
import CaseLibraryApplyModeSelector from "./CaseLibraryApplyModeSelector";
import CaseLibraryScopePanel from "./CaseLibraryScopePanel";
import {
  CaseLibraryTemplateCompactList,
  CaseLibraryTemplateDetailSections,
  CaseLibraryTemplateHighlightGrid,
  CaseLibraryTemplateVisualBlock,
} from "./CaseLibraryTemplatePreviewBlocks";

function ApplyPreviewCard({ preview }) {

  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex items-center gap-2">
        <CopyPlus className="h-4 w-4 text-slate-500" />
        <h3 className="text-base font-black text-slate-900">적용 미리보기</h3>
      </div>

      <div className="mt-4 space-y-4">
        <CaseLibraryTemplateHighlightGrid highlights={preview.highlights} />
        <CaseLibraryTemplateVisualBlock visual={preview.visual} maxItems={4} />
        <CaseLibraryTemplateCompactList items={preview.compactItems} />
      </div>
    </div>
  );
}

export default function CaseLibraryApplyModal({ caseId, isOpen, onClose }) {
  const {
    canApplyTemplate,
    casePost,
    classLabel,
    handleApply,
    isApplying,
    pageMeta,
    templateRuntimeSupported,
  } = useCaseLibraryApply(caseId);

  if (!isOpen || !casePost) {
    return null;
  }

  const preview = buildCaseLibraryTemplatePreview(casePost);

  const handleApplyClick = async () => {
    const result = await handleApply();
    if (result) {
      onClose?.();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" title="내 반에 적용하기">
      <div className="grid gap-6 xl:grid-cols-[1fr_1.02fr]">
        <div className="space-y-6">
          {!templateRuntimeSupported || !casePost.templatePayload ? (
            <div className="rounded-3xl border border-dashed border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-800">
              템플릿 payload가 없어서 바로 적용할 수 없습니다. 템플릿을 다시 첨부해
              저장한 글인지 확인해 주세요.
            </div>
          ) : null}

          <CaseLibraryApplyModeSelector
            classLabel={classLabel}
            pageMeta={pageMeta}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <CaseLibraryScopePanel
              title="가져오는 항목"
              items={casePost.template?.includedScopes || []}
              tone="emerald"
            />
            <CaseLibraryScopePanel
              title="제외되는 항목"
              items={casePost.template?.excludedScopes || []}
              tone="rose"
            />
          </div>

          <CaseLibraryTemplateDetailSections sections={preview.sections} />
        </div>

        <div className="space-y-6">
          <ApplyPreviewCard preview={preview} />

          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex gap-3">
              <Button
                tone="blue"
                fullWidth
                onClick={handleApplyClick}
                disabled={!canApplyTemplate || isApplying}
              >
                {isApplying ? "적용 중..." : "내 반에 적용하기"}
              </Button>
              <Button tone="slate" kind="outline" fullWidth onClick={onClose}>
                닫기
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
