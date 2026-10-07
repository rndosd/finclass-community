import React from "react";
import { CheckSquare, FileText, Square } from "lucide-react";
import { Badge, Button } from "../../../components/ui";
import { caseLibraryPageMeta } from "../caseLibraryRegistry";
import { formatCaseDate } from "../caseLibraryPostUtils";

function PostRow({ isSelected, post, onToggle }) {
  const pageMeta = caseLibraryPageMeta[post.pageType] || caseLibraryPageMeta.all;

  return (
    <Button
      type="button"
      onClick={onToggle}
      className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
        isSelected
          ? "border-blue-500 bg-blue-50"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {isSelected ? (
            <CheckSquare className="mt-0.5 h-5 w-5 text-blue-600" />
          ) : (
            <Square className="mt-0.5 h-5 w-5 text-slate-300" />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={pageMeta.tone}>{pageMeta.label}</Badge>
              {post.template ? <Badge tone="emerald">템플릿</Badge> : null}
            </div>
            <h3 className="mt-2 text-sm font-bold text-slate-900">{post.title}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {formatCaseDate(post.updatedAt || post.createdAt)}
            </p>
          </div>
        </div>
        <FileText className="h-4 w-4 text-slate-300" />
      </div>
    </Button>
  );
}

export default function CaseLibraryPdfPostSelector({
  loading,
  ownPosts,
  selectedIdSet,
  onClearAll,
  onSelectAll,
  onTogglePost,
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">내 글 선택</h2>
          <p className="mt-1 text-sm text-slate-500">
            내가 작성한 운영사례 글만 골라 연수자료에 묶을 수 있습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button tone="slate" kind="outline" size="sm" onClick={onSelectAll}>
            전체 선택
          </Button>
          <Button tone="slate" kind="outline" size="sm" onClick={onClearAll}>
            선택 해제
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
          내 글을 불러오는 중입니다.
        </div>
      ) : ownPosts.length > 0 ? (
        <div className="mt-4 space-y-3">
          {ownPosts.map((post) => (
            <PostRow
              key={post.id}
              isSelected={selectedIdSet.has(post.id)}
              post={post}
              onToggle={() => onTogglePost(post)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
          아직 작성한 운영사례 글이 없습니다.
        </div>
      )}
    </section>
  );
}
