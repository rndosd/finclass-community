import React from "react";
import { Bookmark, ThumbsUp } from "lucide-react";
import { Badge, Button } from "../../../components/ui";
import {
  getCaseClassLabel,
  getCaseTeacherLabel,
} from "../caseLibraryAuthorUtils";

function MetaDivider() {
  return <span className="text-slate-300">|</span>;
}

export default function CaseLibraryDetailSummary({
  casePost,
  pageMeta,
  updatedLabel,
  isRecommended,
  isRecommending,
  isSaved,
  isSaving,
  onToggleRecommend,
  onToggleSave,
}) {
  const classLabel = getCaseClassLabel(casePost);
  const teacherLabel = getCaseTeacherLabel(casePost);

  return (
    <header className="border-b border-slate-200 px-5 py-6 sm:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={pageMeta.tone} pill={false}>
          {pageMeta.label}
        </Badge>
        {casePost.featured ? (
          <span className="text-xs font-bold text-rose-600">추천 글</span>
        ) : null}
        {casePost.template ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
            템플릿 포함
          </span>
        ) : null}
      </div>

      <h1 className="mt-4 text-2xl font-bold leading-9 text-slate-900 sm:text-[28px]">
        {casePost.title}
      </h1>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-semibold text-slate-700">{classLabel}</span>
          <MetaDivider />
          <span>{teacherLabel || "교사명 비공개"}</span>
          <MetaDivider />
          <span>{updatedLabel}</span>
          <MetaDivider />
          <span>조회 {casePost.viewCount}</span>
          <MetaDivider />
          <span>스크랩 {casePost.saveCount}</span>
          <MetaDivider />
          <span>추천 {casePost.recommendCount}</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            tone={isSaved ? "blue" : "slate"}
            kind={isSaved ? "solid" : "outline"}
            size="icon-md"
            rounded="full"
            onClick={onToggleSave}
            disabled={isSaving}
            title={
              isSaving ? "스크랩 처리 중" : isSaved ? "스크랩 취소" : "스크랩"
            }
            aria-label={
              isSaving ? "스크랩 처리 중" : isSaved ? "스크랩 취소" : "스크랩"
            }
          >
            <Bookmark className="h-4 w-4" />
          </Button>

          <Button
            tone={isRecommended ? "blue" : "slate"}
            kind={isRecommended ? "solid" : "outline"}
            size="icon-md"
            rounded="full"
            onClick={onToggleRecommend}
            disabled={isRecommending}
            title={
              isRecommending ? "추천 처리 중" : isRecommended ? "추천 취소" : "추천"
            }
            aria-label={
              isRecommending ? "추천 처리 중" : isRecommended ? "추천 취소" : "추천"
            }
          >
            <ThumbsUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
