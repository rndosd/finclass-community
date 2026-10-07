import React, { useMemo } from "react";
import { Home } from "lucide-react";
import CaseLibraryBoardRow from "./CaseLibraryBoardRow";
import CaseLibraryMobileCard from "./CaseLibraryMobileCard";
import CaseLibraryTabStrip from "./CaseLibraryTabStrip";

export default function CaseLibraryBoardTable({
  activeCategory,
  casePosts,
  categoryTabs,
  isNewCasePost,
  onCategoryChange,
  onSourceClassSelect,
}) {
  const tabItems = useMemo(
    () =>
      categoryTabs.map((tab) => ({
        ...tab,
        icon: tab.id === "all" ? Home : undefined,
      })),
    [categoryTabs],
  );

  return (
    <div className="space-y-2">
      <CaseLibraryTabStrip
        activeId={activeCategory}
        items={tabItems}
        onChange={onCategoryChange}
      />

      <div className="grid gap-3 md:hidden">
        {casePosts.map((casePost) => (
          <CaseLibraryMobileCard
            key={casePost.id}
            casePost={casePost}
            isNew={isNewCasePost?.(casePost)}
            onSourceClassSelect={onSourceClassSelect}
          />
        ))}
      </div>

      <section className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="min-w-[980px] w-full border-collapse">
          <thead className="bg-white text-xs font-black uppercase tracking-[0.16em] text-slate-400">
            <tr className="border-b border-slate-200">
              <th className="w-28 px-4 py-4 text-center">분류</th>
              <th className="px-4 py-4 text-left">제목</th>
              <th className="w-48 px-4 py-4 text-left">공유 반</th>
              <th className="w-28 px-4 py-4 text-left">날짜</th>
              <th className="w-24 px-4 py-4 text-center">조회</th>
              <th className="w-24 px-4 py-4 text-center">스크랩</th>
              <th className="w-24 px-4 py-4 text-center">추천</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {casePosts.map((casePost) => (
              <CaseLibraryBoardRow
                key={casePost.id}
                casePost={casePost}
                isNew={isNewCasePost?.(casePost)}
                onSourceClassSelect={onSourceClassSelect}
              />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
