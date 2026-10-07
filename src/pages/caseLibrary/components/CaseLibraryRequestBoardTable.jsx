import React, { useMemo, useState } from "react";
import { Home } from "lucide-react";
import CaseLibraryTabStrip from "./CaseLibraryTabStrip";
import CaseLibraryRequestBoardRow from "./CaseLibraryRequestBoardRow";
import CaseLibraryRequestMobileCard from "./CaseLibraryRequestMobileCard";
import { getCaseRequestStatus } from "../caseLibraryRequestUtils";

export default function CaseLibraryRequestBoardTable({
  activeCategory,
  categoryTabs,
  isNewRequest,
  onCategoryChange,
  requests,
}) {
  const [mobileStatus, setMobileStatus] = useState("all");
  const tabItems = useMemo(
    () =>
      categoryTabs.map((tab) => ({
        ...tab,
        icon: tab.id === "all" ? Home : undefined,
      })),
    [categoryTabs],
  );
  const mobileRequests = useMemo(
    () =>
      mobileStatus === "all"
        ? requests
        : requests.filter(
            (request) => getCaseRequestStatus(request).id === mobileStatus,
          ),
    [mobileStatus, requests],
  );

  return (
    <div className="space-y-2">
      <CaseLibraryTabStrip
        activeId={activeCategory}
        items={tabItems}
        onChange={onCategoryChange}
      />

      <div className="space-y-3 md:hidden">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            { id: "all", label: "전체" },
            { id: "waiting", label: "답변 대기" },
            { id: "commented", label: "답변 등록" },
            { id: "resolved", label: "사례 등록" },
          ].map((status) => (
            <button
              key={status.id}
              type="button"
              onClick={() => setMobileStatus(status.id)}
              className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold ${
                mobileStatus === status.id
                  ? "bg-blue-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              {status.label}
            </button>
          ))}
        </div>

        {mobileRequests.map((request) => (
          <CaseLibraryRequestMobileCard
            key={request.id}
            request={request}
            isNew={isNewRequest?.(request)}
          />
        ))}
        {mobileRequests.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm font-semibold text-slate-400">
            선택한 상태의 요청이 없습니다.
          </div>
        ) : null}
      </div>

      <section className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="min-w-[980px] w-full border-collapse">
          <thead className="bg-white text-xs font-black uppercase tracking-[0.16em] text-slate-400">
            <tr className="border-b border-slate-200">
              <th className="w-28 px-4 py-4 text-center">분류</th>
              <th className="px-4 py-4 text-left">제목</th>
              <th className="w-48 px-4 py-4 text-left">공유 반</th>
              <th className="w-28 px-4 py-4 text-left">날짜</th>
              <th className="w-24 px-4 py-4 text-center">나도 궁금해요</th>
              <th className="w-32 px-4 py-4 text-center">상태</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {requests.map((request) => (
              <CaseLibraryRequestBoardRow
                key={request.id}
                request={request}
                isNew={isNewRequest?.(request)}
              />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
