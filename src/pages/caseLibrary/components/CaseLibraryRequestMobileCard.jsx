import React from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
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

export default function CaseLibraryRequestMobileCard({
  request,
  isNew = false,
}) {
  const pageMeta =
    caseLibraryPageMeta[request.pageType] || caseLibraryPageMeta.all;
  const status = getCaseRequestStatus(request);
  const statusClassName =
    status.tone === "emerald"
      ? "bg-emerald-50 text-emerald-700"
      : status.tone === "blue"
        ? "bg-blue-50 text-blue-700"
        : "bg-amber-50 text-amber-700";

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <Badge tone={pageMeta.tone} pill={false}>
          {pageMeta.label}
        </Badge>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClassName}`}
        >
          {status.label}
        </span>
      </div>

      <Link
        to={buildCaseLibraryRequestDetailPath(request.id, request.classId)}
        className="mt-3 block min-h-11 text-base font-black leading-6 text-slate-900"
      >
        <span className="line-clamp-2">{request.title}</span>
      </Link>

      {request.summary ? (
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
          {request.summary}
        </p>
      ) : null}

      <p className="mt-2 text-xs leading-5 text-slate-400">
        {buildCaseRequestMetaLine(request)}
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-700">
            {getCaseClassLabel(request)}
          </p>
          <p className="truncate text-xs text-slate-400">
            {getCaseTeacherLabel(request) || "비공개"} ·{" "}
            {formatCaseDate(request.updatedAt || request.createdAt)}
          </p>
        </div>

        <span className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-rose-50 px-3 text-xs font-bold text-rose-700">
          <Heart aria-hidden="true" className="h-3.5 w-3.5" />
          관심 {Number(request.interestCount || 0)}
        </span>
      </div>

      {isNew ? (
        <span className="mt-3 inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">
          NEW
        </span>
      ) : null}
    </article>
  );
}
