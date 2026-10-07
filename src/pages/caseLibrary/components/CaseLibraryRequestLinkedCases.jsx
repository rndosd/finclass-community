import React from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../../components/ui";
import { caseLibraryPageMeta } from "../caseLibraryRegistry";
import {
  buildCaseLibraryPostDetailPath,
  formatCaseDate,
} from "../caseLibraryPostUtils";

export default function CaseLibraryRequestLinkedCases({ linkedCases }) {
  if (!linkedCases.length) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900">작성된 운영사례</h2>
          <p className="mt-1 text-sm text-slate-500">
            이 요청을 바탕으로 작성된 운영사례만 모아봤어요.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
          {linkedCases.length}건
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {linkedCases.map((casePost) => {
          const pageMeta =
            caseLibraryPageMeta[casePost.pageType] || caseLibraryPageMeta.all;

          return (
            <Link
              key={casePost.id}
              to={buildCaseLibraryPostDetailPath(casePost)}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 transition hover:border-blue-200 hover:bg-blue-50/60"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={pageMeta.tone} pill={false}>
                    {pageMeta.label}
                  </Badge>
                  <span className="truncate text-sm font-bold text-slate-900">
                    {casePost.title}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatCaseDate(casePost.updatedAt || casePost.createdAt)} · 스크랩{" "}
                  {Number(casePost.saveCount || 0)} · 추천{" "}
                  {Number(casePost.recommendCount || 0)}
                </p>
              </div>
              <span className="text-xs font-semibold text-blue-600">바로 보기</span>
            </Link>
          );
        })}
      </ul>
    </section>
  );
}
