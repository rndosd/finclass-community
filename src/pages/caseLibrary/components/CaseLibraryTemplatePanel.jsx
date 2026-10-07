import React from "react";
import { Button } from "../../../components/ui";
import { buildCaseLibraryTemplatePreview } from "../caseLibraryTemplatePreview";
import {
  CaseLibraryTemplateCompactList,
  CaseLibraryTemplateHighlightGrid,
  CaseLibraryTemplateVisualBlock,
} from "./CaseLibraryTemplatePreviewBlocks";

export default function CaseLibraryTemplatePanel({
  canApply,
  casePost,
  pageMeta,
  template,
  onApply,
}) {
  const preview = buildCaseLibraryTemplatePreview(casePost);

  return (
    <section className="border-t border-slate-200 px-5 py-6 sm:px-8">
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-black text-emerald-900">첨부된 템플릿</p>
            <p className="text-sm leading-6 text-emerald-900">
              {pageMeta.label} 설정 예시를 함께 보고 바로 가져올 수 있어요.
            </p>
          </div>

          <Button tone="blue" onClick={onApply} disabled={!canApply}>
            내 반에 적용하기
          </Button>
        </div>

        {template?.includedScopes?.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {template.includedScopes.map((scope) => (
              <span
                key={scope}
                className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-700"
              >
                {scope}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-5 space-y-4">
          <CaseLibraryTemplateHighlightGrid highlights={preview.highlights} />
          <CaseLibraryTemplateVisualBlock visual={preview.visual} maxItems={2} />
          <CaseLibraryTemplateCompactList items={preview.compactItems} />
        </div>
      </div>
    </section>
  );
}
