import React from "react";
import { Link } from "react-router-dom";
import { Bookmark, Eye, MessageCircle, ThumbsUp } from "lucide-react";
import { Badge } from "../../../components/ui";
import {
  buildCaseLibraryPostDetailPath,
  formatCaseDate,
} from "../caseLibraryPostUtils";
import { caseLibraryPageMeta } from "../caseLibraryRegistry";
import {
  getCaseClassLabel,
  getCaseTeacherLabel,
} from "../caseLibraryAuthorUtils";

function Metric({ icon: Icon, label, value }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-slate-100 px-3 text-xs font-bold text-slate-600">
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      <span className="sr-only">{label}</span>
      {Number(value || 0)}
    </span>
  );
}

export default function CaseLibraryMobileCard({
  casePost,
  isNew = false,
  onSourceClassSelect,
}) {
  const pageMeta =
    caseLibraryPageMeta[casePost.pageType] || caseLibraryPageMeta.all;
  const classLabel = getCaseClassLabel(casePost);
  const teacherLabel = getCaseTeacherLabel(casePost);
  const sourceClassId = String(
    casePost.sourceClassId || casePost.classId || "",
  ).trim();

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <Badge tone={pageMeta.tone} pill={false}>
          {pageMeta.label}
        </Badge>
        <span className="shrink-0 text-xs font-medium text-slate-400">
          {formatCaseDate(
            casePost.createdAt || casePost.publishedAt || casePost.updatedAt,
          )}
        </span>
      </div>

      <Link
        to={buildCaseLibraryPostDetailPath(casePost)}
        className="mt-3 block min-h-11 text-base font-black leading-6 text-slate-900"
      >
        <span className="line-clamp-2">{casePost.title}</span>
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {casePost.featured ? (
          <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-600">
            추천 글
          </span>
        ) : null}
        {isNew ? (
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">
            NEW
          </span>
        ) : null}
        {casePost.template ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
            템플릿
          </span>
        ) : null}
      </div>

      <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
        {onSourceClassSelect && sourceClassId ? (
          <button
            type="button"
            onClick={() => onSourceClassSelect(sourceClassId)}
            className="min-h-11 min-w-0 text-left text-sm font-bold text-slate-700"
          >
            <span className="block truncate">{classLabel}</span>
            <span className="block truncate text-xs font-medium text-slate-400">
              {teacherLabel || "비공개"}
            </span>
          </button>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-700">{classLabel}</p>
            <p className="truncate text-xs text-slate-400">
              {teacherLabel || "비공개"}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Metric icon={Eye} label="조회" value={casePost.viewCount} />
          <Metric icon={Bookmark} label="스크랩" value={casePost.saveCount} />
          <Metric icon={ThumbsUp} label="추천" value={casePost.recommendCount} />
          {Number(casePost.commentCount || 0) > 0 ? (
            <Metric
              icon={MessageCircle}
              label="댓글"
              value={casePost.commentCount}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
