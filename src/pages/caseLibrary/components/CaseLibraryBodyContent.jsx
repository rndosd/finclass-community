import React, { useMemo } from "react";
import { sanitizeRichHtml } from "../../../utils/sanitizeRichHtml";

export default function CaseLibraryBodyContent({ bodyHtml }) {
  const safeHtml = useMemo(() => sanitizeRichHtml(bodyHtml), [bodyHtml]);

  return (
    <section className="px-5 py-7 sm:px-8 sm:py-8">
      <style>{`
        .case-library-body-html img[data-align="center"] {
          clear: both;
          display: block;
          margin: 1.25rem auto;
          max-width: 100%;
          height: auto;
        }

        .case-library-body-html img[data-align="left"] {
          float: left;
          clear: left;
          display: block;
          max-width: min(42%, 320px);
          height: auto;
          margin: 0.35rem 1rem 0.9rem 0;
        }

        .case-library-body-html img[data-align="right"] {
          float: right;
          clear: right;
          display: block;
          max-width: min(42%, 320px);
          height: auto;
          margin: 0.35rem 0 0.9rem 1rem;
        }

        .case-library-body-html::after {
          content: "";
          display: block;
          clear: both;
        }

        @media (max-width: 640px) {
          .case-library-body-html img[data-align="left"],
          .case-library-body-html img[data-align="right"] {
            float: none;
            clear: both;
            display: block;
            max-width: 100%;
            margin: 1rem auto;
          }
        }
      `}</style>
      {safeHtml ? (
        <div
          className="case-library-body-html prose prose-slate max-w-none text-[15px] leading-7 sm:prose-base [&_img]:rounded-xl [&_img]:border [&_img]:border-slate-200"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      ) : (
        <div className="text-sm leading-6 text-slate-500">
          아직 작성된 본문이 없습니다.
        </div>
      )}
    </section>
  );
}
