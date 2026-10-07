import React from "react";
import { Badge, Button } from "../../../components/ui";
import { caseLibraryPageMeta } from "../caseLibraryRegistry";
import { formatCaseDate } from "../caseLibraryPostUtils";

export default function CaseLibraryDashboardDraftCard({
  draft,
  onContinue,
}) {
  const pageMeta = caseLibraryPageMeta[draft.pageType] || caseLibraryPageMeta.all;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead className="bg-white text-xs font-black uppercase tracking-[0.16em] text-slate-400">
            <tr className="border-b border-slate-200">
              <th className="w-32 px-4 py-4 text-center">분류</th>
              <th className="px-4 py-4 text-left">제목</th>
              <th className="w-32 px-4 py-4 text-left">수정일</th>
              <th className="w-32 px-4 py-4 text-center">상태</th>
              <th className="w-36 px-4 py-4 text-center">작업</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            <tr className="border-b border-slate-100">
              <td className="whitespace-nowrap px-4 py-4 text-center">
                <Badge tone={pageMeta.tone} pill={false}>
                  {pageMeta.label}
                </Badge>
              </td>
              <td className="px-4 py-4">
                <div className="text-sm font-bold text-slate-900">
                  {draft.title || "제목이 아직 없는 임시저장 글"}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {draft.summary || "본문 초안을 이어서 다듬고 게시할 수 있습니다."}
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-500">
                {formatCaseDate(draft.updatedAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-center">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  임시저장
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-center">
                <Button tone="blue" size="sm" onClick={onContinue}>
                  이어쓰기
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
