import React, { useMemo } from "react";
import { Badge } from "../../../components/ui";
import { sanitizeRichHtml } from "../../../utils/sanitizeRichHtml";
import { caseLibraryPageMeta } from "../caseLibraryRegistry";
import { formatCaseDate } from "../caseLibraryPostUtils";

function PreviewPostSection({ post, layoutOptions }) {
  const pageMeta = caseLibraryPageMeta[post.pageType] || caseLibraryPageMeta.all;
  const safeHtml = useMemo(() => sanitizeRichHtml(post.bodyHtml), [post.bodyHtml]);

  return (
    <article
      className={`case-library-pdf-page rounded-[28px] border border-slate-200 bg-white p-10 shadow-sm ${
        post.breakAfter === false ? "case-library-pdf-page--continued" : ""
      }`}
    >
      <style>{`
        .case-library-pdf-html img[data-align="center"] {
          clear: both;
          display: block;
          margin: 1.25rem auto;
          max-width: 100%;
          height: auto;
        }

        .case-library-pdf-html img[data-align="left"] {
          float: left;
          clear: left;
          display: block;
          max-width: min(38%, 280px);
          height: auto;
          margin: 0.35rem 1rem 0.9rem 0;
        }

        .case-library-pdf-html img[data-align="right"] {
          float: right;
          clear: right;
          display: block;
          max-width: min(38%, 280px);
          height: auto;
          margin: 0.35rem 0 0.9rem 1rem;
        }

        .case-library-pdf-html::after {
          content: "";
          display: block;
          clear: both;
        }
      `}</style>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={pageMeta.tone}>{pageMeta.label}</Badge>
        {post.template ? <Badge tone="emerald">템플릿 포함</Badge> : null}
        <Badge tone={post.breakAfter === false ? "blue" : "slate"}>
          {post.breakAfter === false ? "다음 글과 이어짐" : "다음 글 새 페이지"}
        </Badge>
      </div>

      {layoutOptions?.showSectionTitle ? (
        <h2 className="mt-5 text-3xl font-black tracking-tight text-slate-900">
          {post.sectionTitle}
        </h2>
      ) : null}
      {layoutOptions?.showSectionMeta ? (
        <div className="mt-3 text-sm text-slate-500">
          <span>{post.classLabel}</span>
          <span className="mx-2">·</span>
          <span>{formatCaseDate(post.updatedAt || post.createdAt)}</span>
        </div>
      ) : null}

      <div
        className={`border-slate-200 ${
          layoutOptions?.showSectionTitle || layoutOptions?.showSectionMeta
            ? "mt-6 border-t pt-6"
            : "mt-4"
        }`}
      >
        <div
          className="case-library-pdf-html prose prose-slate max-w-none text-slate-700 prose-img:rounded-2xl prose-img:border prose-img:border-slate-200 prose-img:shadow-sm prose-p:leading-7"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      </div>
    </article>
  );
}

function TextSection({ title, body }) {
  if (!String(body || "").trim()) {
    return null;
  }

  return (
    <section className="case-library-pdf-page rounded-[28px] border border-slate-200 bg-white p-10 shadow-sm">
      <h2 className="text-3xl font-black tracking-tight text-slate-900">{title}</h2>
      <div className="mt-6 whitespace-pre-wrap text-base leading-8 text-slate-700">
        {body}
      </div>
    </section>
  );
}

export default function CaseLibraryPdfPreview({
  closingNote,
  coverNote,
  documentTitle,
  generatedDateLabel,
  introNote,
  layoutOptions,
  selectedPosts,
  teacherLabel,
}) {
  const displayTitle = String(documentTitle || "").trim() || "연수자료 제목";

  return (
    <div className="case-library-pdf-preview mx-auto w-full max-w-[920px] space-y-6">
      <section className="case-library-pdf-page rounded-[28px] border border-slate-200 bg-white p-12 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">
          Training Material
        </p>
        <h1 className="mt-5 text-4xl font-black tracking-tight text-slate-900">
          {displayTitle}
        </h1>
        <p className="mt-4 text-base leading-8 text-slate-600">
          {coverNote || "선택한 운영사례 글을 모아 연수자료로 정리한 문서입니다."}
        </p>

        {layoutOptions?.showCoverAuthor || layoutOptions?.showCoverDate ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {layoutOptions?.showCoverAuthor ? (
              <div className="rounded-2xl bg-slate-50 px-5 py-4">
                <p className="text-xs font-semibold text-slate-500">작성자</p>
                <p className="mt-2 text-lg font-bold text-slate-900">{teacherLabel}</p>
              </div>
            ) : null}
            {layoutOptions?.showCoverDate ? (
              <div className="rounded-2xl bg-slate-50 px-5 py-4">
                <p className="text-xs font-semibold text-slate-500">생성일</p>
                <p className="mt-2 text-lg font-bold text-slate-900">{generatedDateLabel}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <TextSection title="도입" body={introNote} />

      {selectedPosts.map((post) => (
        <PreviewPostSection key={post.id} post={post} layoutOptions={layoutOptions} />
      ))}

      <TextSection title="마무리" body={closingNote} />

      {selectedPosts.length === 0 ? (
        <section className="case-library-pdf-page rounded-[28px] border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <h2 className="text-2xl font-black text-slate-900">선택한 글이 없습니다.</h2>
          <p className="mt-4 text-sm leading-7 text-slate-500">
            왼쪽에서 내 글을 선택하면 이곳에 연수자료 미리보기가 만들어집니다.
          </p>
        </section>
      ) : null}
    </div>
  );
}
