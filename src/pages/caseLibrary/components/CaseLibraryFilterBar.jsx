import React from "react";
import { Search } from "lucide-react";
import { Button } from "../../../components/ui";

export default function CaseLibraryFilterBar({
  activeSourceClassLabel,
  filteredCount,
  query,
  selectedMeta,
  showReset,
  sortKey,
  sortOptions,
  onQueryChange,
  onReset,
  onSortChange,
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              aria-label="사례 검색"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="제목, 내용, 학급으로 검색"
              className="w-full rounded-xl border border-blue-200 bg-blue-50/50 py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
            />
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="case-library-sort"
              className="shrink-0 text-xs font-semibold text-slate-500"
            >
              정렬
            </label>
            <select
              id="case-library-sort"
              value={sortKey}
              onChange={(event) => onSortChange(event.target.value)}
              className="min-w-[120px] rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
            >
              {sortOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-700">{selectedMeta.label}</span>
            <span className="mx-2 text-slate-300">|</span>
            {activeSourceClassLabel ? (
              <>
                <span className="font-semibold text-blue-700">
                  {activeSourceClassLabel} 활동
                </span>
                <span className="mx-2 text-slate-300">|</span>
              </>
            ) : null}
            <span>{filteredCount}개</span>
          </p>
        </div>

        {showReset ? (
          <div className="flex items-center justify-end gap-2">
            <Button tone="slate" kind="outline" size="sm" onClick={onReset}>
              초기화
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
