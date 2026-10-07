import React from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Link2,
  ScissorsLineDashed,
} from "lucide-react";
import { Button } from "../../../components/ui";

function SelectedPostRow({
  breakAfter,
  index,
  isFirst,
  isLast,
  item,
  showTitleEditor,
  onToggleBreakAfter,
  onMoveDown,
  onMoveUp,
  onTitleChange,
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <div className="flex items-start gap-3">
        <GripVertical className="mt-2 h-4 w-4 text-slate-300" />
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold text-slate-500">
              섹션 {index + 1}
            </p>
            <div className="flex gap-2">
              <Button
                tone="slate"
                kind="outline"
                size="sm"
                onClick={onMoveUp}
                disabled={isFirst}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                tone="slate"
                kind="outline"
                size="sm"
                onClick={onMoveDown}
                disabled={isLast}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {showTitleEditor ? (
            <>
              <input
                type="text"
                value={item.sectionTitle}
                onChange={(event) => onTitleChange(event.target.value)}
                className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                placeholder="섹션 제목"
              />
              <p className="text-xs text-slate-500">원본 글: {item.title}</p>
            </>
          ) : (
            <div>
              <p className="text-sm font-bold text-slate-900">{item.sectionTitle}</p>
              <p className="mt-1 text-xs text-slate-500">
                {breakAfter
                  ? "다음 글은 새 페이지에서 시작됩니다."
                  : "다음 글과 같은 페이지로 이어집니다."}
              </p>
            </div>
          )}

          {!isLast ? (
            <Button
              type="button"
              onClick={onToggleBreakAfter}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                breakAfter
                  ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  : "bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              {breakAfter ? (
                <ScissorsLineDashed className="h-3.5 w-3.5" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              {breakAfter ? "다음 글 새 페이지" : "다음 글과 이어 붙이기"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function CaseLibraryPdfOutlineEditor({
  closingNote,
  coverNote,
  documentTitle,
  introNote,
  layoutOptions,
  selectedPosts,
  setClosingNote,
  setCoverNote,
  setDocumentTitle,
  setIntroNote,
  showAdvanced,
  onToggleAdvanced,
  onToggleBreakAfter,
  updateLayoutOption,
  onMovePost,
  onUpdateSectionTitle,
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">문서 설정</h2>
          <p className="mt-1 text-sm text-slate-500">
            제목을 정하고, 선택한 글 순서만 간단히 맞추면 됩니다.
          </p>
        </div>
        <Button tone="slate" kind="outline" size="sm" onClick={onToggleAdvanced}>
          {showAdvanced ? (
            <ChevronUp className="mr-1 h-4 w-4" />
          ) : (
            <ChevronDown className="mr-1 h-4 w-4" />
          )}
          {showAdvanced ? "고급 편집 닫기" : "고급 편집"}
        </Button>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <label className="text-sm font-semibold text-slate-700">자료 제목</label>
          <input
            type="text"
            value={documentTitle}
            onChange={(event) => setDocumentTitle(event.target.value)}
            className="mt-2 w-full rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
            placeholder="예: 3월 경제교실 운영사례 연수자료"
          />
        </div>

        {showAdvanced ? (
          <>
            <div>
              <label className="text-sm font-semibold text-slate-700">표시 항목</label>
              <div className="mt-2 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={layoutOptions.showSectionTitle}
                    onChange={(event) => updateLayoutOption("showSectionTitle", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  글 제목 표시
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={layoutOptions.showSectionMeta}
                    onChange={(event) => updateLayoutOption("showSectionMeta", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  작성 반 / 날짜 표시
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={layoutOptions.showCoverAuthor}
                    onChange={(event) => updateLayoutOption("showCoverAuthor", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  표지에 작성자 표시
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={layoutOptions.showCoverDate}
                    onChange={(event) => updateLayoutOption("showCoverDate", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  표지에 생성일 표시
                </label>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">표지 설명</label>
              <textarea
                value={coverNote}
                onChange={(event) => setCoverNote(event.target.value)}
                rows={3}
                className="mt-2 w-full rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                placeholder="연수자료의 목적이나 한 줄 설명을 적어주세요."
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">도입 문구</label>
              <textarea
                value={introNote}
                onChange={(event) => setIntroNote(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                placeholder="연수자료 앞부분에 들어갈 설명이나 강의 멘트를 적어주세요."
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">마무리 문구</label>
              <textarea
                value={closingNote}
                onChange={(event) => setClosingNote(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                placeholder="마무리 안내나 정리 문구를 적어주세요."
              />
            </div>
          </>
        ) : null}
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900">선택한 글 순서</h3>
          <span className="text-xs text-slate-500">{selectedPosts.length}개 선택됨</span>
        </div>

        {selectedPosts.length > 0 ? (
          <div className="mt-3 space-y-3">
            {selectedPosts.map((post, index) => (
              <SelectedPostRow
                key={post.id}
                index={index}
                isFirst={index === 0}
                isLast={index === selectedPosts.length - 1}
                item={post}
                breakAfter={post.breakAfter !== false}
                showTitleEditor={showAdvanced}
                onToggleBreakAfter={() => onToggleBreakAfter(post.id)}
                onMoveUp={() => onMovePost(post.id, "up")}
                onMoveDown={() => onMovePost(post.id, "down")}
                onTitleChange={(nextTitle) => onUpdateSectionTitle(post.id, nextTitle)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
            왼쪽에서 글을 선택하면 이곳에서 순서를 바꾸고 섹션 제목을 수정할 수 있습니다.
          </div>
        )}
      </div>
    </section>
  );
}
