import React from "react";

export default function CaseLibraryComposerMetaForm({
  disabled = false,
  titlePlaceholder,
  pageMeta,
  pageMetaMap,
  pageType,
  pageTypes,
  teacherNamePublic,
  title,
  onPageTypeChange,
  onTeacherNamePublicChange,
  onTitleChange,
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <select
          disabled={disabled}
          value={pageType}
          onChange={(event) => onPageTypeChange(event.target.value)}
          className="h-11 rounded-md border border-blue-200 bg-blue-50/50 px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50 disabled:text-slate-400"
          aria-label="페이지 선택"
        >
          {pageTypes.map((item) => (
            <option key={item} value={item}>
              {pageMetaMap[item]?.label || item}
            </option>
          ))}
        </select>

        <input
          type="text"
          disabled={disabled}
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={titlePlaceholder || `${pageMeta.label} 운영사례 제목`}
          className="h-11 rounded-md border border-blue-200 bg-blue-50/50 px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50 disabled:text-slate-400"
          aria-label="제목"
        />
      </div>

      <label className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <input
          type="checkbox"
          disabled={disabled}
          checked={teacherNamePublic}
          onChange={(event) => onTeacherNamePublicChange(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        <span className="font-semibold">교사명 공개</span>
        <span className="text-slate-500">
          체크를 해제하면 게시자에 ‘반 이름(비공개)’ 형태로 표시됩니다.
        </span>
      </label>
    </div>
  );
}
