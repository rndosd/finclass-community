import React from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../../components/ui";
import {
  buildCaseLibraryPostDetailPath,
  formatCaseDate,
} from "../caseLibraryPostUtils";

function RelatedCaseMeta({ relatedCase }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
      <span>{formatCaseDate(relatedCase.updatedAt || relatedCase.createdAt)}</span>
      <span>조회 {relatedCase.viewCount}</span>
      <span>스크랩 {relatedCase.saveCount}</span>
      <span>추천 {relatedCase.recommendCount}</span>
    </div>
  );
}

export default function CaseLibraryRelatedCases({ pageMeta, relatedCases }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4 text-sm font-bold text-slate-800 sm:px-6">
        같은 분류의 다른 글
      </div>

      <div className="divide-y divide-slate-100">
        {relatedCases.map((relatedCase) => (
          <Link
            key={relatedCase.id}
            to={buildCaseLibraryPostDetailPath(relatedCase)}
            className="flex items-start gap-3 px-5 py-4 transition hover:bg-slate-50 sm:px-6"
          >
            <div className="pt-0.5">
              <Badge tone={pageMeta.tone} pill={false}>
                {pageMeta.label}
              </Badge>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-slate-900 sm:text-[15px]">
                  {relatedCase.title}
                </span>
                {relatedCase.template ? (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    템플릿
                  </span>
                ) : null}
              </div>
              <RelatedCaseMeta relatedCase={relatedCase} />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
