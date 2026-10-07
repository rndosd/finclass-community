import React from "react";
import CaseLibraryBoardRow from "./CaseLibraryBoardRow";

function SelectionHeaderCell({ allSelected, indeterminate, onToggle }) {
  return (
    <th className="w-14 px-4 py-4 text-center">
      <input
        type="checkbox"
        aria-label="표시된 글 전체 선택"
        checked={allSelected}
        ref={(node) => {
          if (node) {
            node.indeterminate = indeterminate;
          }
        }}
        onChange={onToggle}
        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
      />
    </th>
  );
}

export default function CaseLibraryDashboardPostList({
  emptyState,
  posts,
  selectable = false,
  selectedIds = [],
  onSelectAll,
  onToggleSelect,
}) {
  const selectedIdSet = new Set(selectedIds);
  const allSelected = posts.length > 0 && selectedIds.length === posts.length;
  const partiallySelected =
    selectedIds.length > 0 && selectedIds.length < posts.length;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {posts.length === 0 ? (
        <div className="bg-white p-4">{emptyState}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full border-collapse">
            <thead className="bg-white text-xs font-black uppercase tracking-[0.16em] text-slate-400">
              <tr className="border-b border-slate-200">
                {selectable ? (
                  <SelectionHeaderCell
                    allSelected={allSelected}
                    indeterminate={partiallySelected}
                    onToggle={onSelectAll}
                  />
                ) : null}
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
              {posts.map((post) => (
                <CaseLibraryBoardRow
                  key={post.id}
                  casePost={post}
                  selectable={selectable}
                  selected={selectedIdSet.has(post.id)}
                  onToggleSelect={onToggleSelect}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
