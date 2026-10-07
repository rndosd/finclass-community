import React from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../../components/ui";
import { formatCaseDate } from "../caseLibraryPostUtils";
import {
  getCaseClassLabel,
  getCaseTeacherLabel,
} from "../caseLibraryAuthorUtils";
import {
  buildCaseLibraryRequestDetailPath,
  buildCaseRequestMetaLine,
  getCaseRequestStatus,
} from "../caseLibraryRequestUtils";
import { caseLibraryPageMeta } from "../caseLibraryRegistry";

function CounterCell({ value }) {
  return (
    <td className="whitespace-nowrap px-4 py-4 text-center text-sm font-semibold text-slate-600">
      {Number(value || 0)}
    </td>
  );
}

function StatusBadge({ request }) {
  const status = getCaseRequestStatus(request);

  const toneClassName =
    status.tone === "emerald"
      ? "bg-emerald-50 text-emerald-700"
      : status.tone === "blue"
        ? "bg-blue-50 text-blue-700"
        : "bg-amber-50 text-amber-700";

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${toneClassName}`}>
      {status.label}
    </span>
  );
}

export default function CaseLibraryRequestBoardRow({
  request,
  isNew = false,
}) {
  const pageMeta =
    caseLibraryPageMeta[request.pageType] || caseLibraryPageMeta.all;
  const classLabel = getCaseClassLabel(request);
  const teacherLabel = getCaseTeacherLabel(request);
  const authorLabel = `${classLabel}(${teacherLabel || "비공개"})`;

  return (
    <tr className="border-b border-slate-100 transition hover:bg-slate-50/80">
      <td className="whitespace-nowrap px-4 py-4 text-center">
        <Badge tone={pageMeta.tone} pill={false}>
          {pageMeta.label}
        </Badge>
      </td>

      <td className="min-w-0 px-4 py-4">
        <Link
          to={buildCaseLibraryRequestDetailPath(request.id, request.classId)}
          className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-900 hover:text-blue-600 sm:text-[15px]"
        >
          <span className="truncate">{request.title}</span>
          {Number(request.commentCount || 0) > 0 ? (
            <span className="shrink-0 text-sm font-bold text-blue-600">
              {Number(request.commentCount || 0)}
            </span>
          ) : null}
          {isNew ? (
            <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-rose-600">
              NEW
            </span>
          ) : null}
        </Link>
        <p className="mt-1 line-clamp-1 text-sm text-slate-500">{request.summary}</p>
        <p className="mt-1 text-xs text-slate-400">
          {buildCaseRequestMetaLine(request)}
        </p>
      </td>

      <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-slate-700">
        {authorLabel}
      </td>

      <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-500">
        {formatCaseDate(request.updatedAt || request.createdAt)}
      </td>

      <CounterCell value={request.interestCount} />

      <td className="whitespace-nowrap px-4 py-4 text-center">
        <StatusBadge request={request} />
      </td>
    </tr>
  );
}
