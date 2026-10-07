import React from "react";
import { Link } from "react-router-dom";
import { Button, Badge } from "../../../components/ui";
import {
  buildCaseLibraryPostDetailPath,
  formatCaseDate,
} from "../caseLibraryPostUtils";
import { caseLibraryPageMeta } from "../caseLibraryRegistry";
import {
  getCaseClassLabel,
  getCaseTeacherLabel,
} from "../caseLibraryAuthorUtils";

function CounterCell({ value }) {
  return (
    <td className="whitespace-nowrap px-4 py-4 text-center text-sm font-semibold text-slate-600">
      {value}
    </td>
  );
}

export default function CaseLibraryBoardRow({
  casePost,
  isNew = false,
  selectable = false,
  selected = false,
  onSourceClassSelect,
  onToggleSelect,
}) {
  const pageMeta =
    caseLibraryPageMeta[casePost.pageType] || caseLibraryPageMeta.all;
  const classLabel = getCaseClassLabel(casePost);
  const teacherLabel = getCaseTeacherLabel(casePost);
  const sourceClassId = String(
    casePost.sourceClassId || casePost.classId || "",
  ).trim();

  return (
    <tr className="border-b border-slate-100 transition hover:bg-slate-50/80">
      {selectable ? (
        <td className="whitespace-nowrap px-4 py-4 text-center">
          <input
            type="checkbox"
            aria-label={`${casePost.title || "제목 없는 글"} 선택`}
            checked={selected}
            onChange={() => onToggleSelect?.(casePost.id)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
        </td>
      ) : null}

      <td className="whitespace-nowrap px-4 py-4 text-center">
        <Badge tone={pageMeta.tone} pill={false}>
          {pageMeta.label}
        </Badge>
      </td>

      <td className="min-w-0 px-4 py-4">
        <Link
          to={buildCaseLibraryPostDetailPath(casePost)}
          className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-900 hover:text-blue-600 sm:text-[15px]"
        >
          {casePost.featured ? (
            <span className="shrink-0 text-xs font-black text-rose-500">
              추천 글
            </span>
          ) : null}
          <span className="truncate">{casePost.title}</span>
          {Number(casePost.commentCount || 0) > 0 ? (
            <span className="shrink-0 text-sm font-bold text-blue-600">
              {Number(casePost.commentCount || 0)}
            </span>
          ) : null}
          {isNew ? (
            <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-rose-600">
              NEW
            </span>
          ) : null}
          {casePost.template ? (
            <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
              템플릿
            </span>
          ) : null}
        </Link>
      </td>

      <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-slate-700">
        {onSourceClassSelect && sourceClassId ? (
          <Button tone="slate" kind="ghost" size="md"
            type="button"
            onClick={() => onSourceClassSelect(sourceClassId)}
            className="transition hover:underline"
          >
            {classLabel}
          </Button>
        ) : (
          <span>{classLabel}</span>
        )}
        <span className="text-slate-500">({teacherLabel || "비공개"})</span>
      </td>

      <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-500">
        {formatCaseDate(casePost.createdAt || casePost.publishedAt || casePost.updatedAt)}
      </td>

      <CounterCell value={casePost.viewCount} />
      <CounterCell value={casePost.saveCount} />
      <CounterCell value={casePost.recommendCount} />
    </tr>
  );
}
