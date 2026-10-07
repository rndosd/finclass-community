import React from "react";
import { Link } from "react-router-dom";
import {
  buildCaseLibraryPostDetailPath,
  formatCaseDateTime,
} from "../caseLibraryPostUtils";
import { caseLibraryPageMeta } from "../caseLibraryRegistry";

export default function CaseLibraryDashboardCommentList({
  comments,
  emptyState,
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {comments.length === 0 ? (
        <div className="bg-white p-4">{emptyState}</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {comments.map((comment) => {
            const pageMeta =
              caseLibraryPageMeta[comment.postPageType] || caseLibraryPageMeta.all;

            return (
              <li key={comment.id} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                    {pageMeta.label}
                  </span>
                  <span>{formatCaseDateTime(comment.createdAt || comment.updatedAt)}</span>
                </div>

                <Link
                  to={buildCaseLibraryPostDetailPath({
                    classId: comment.classId,
                    id: comment.postId,
                  })}
                  className="mt-2 block text-sm font-semibold text-slate-900 hover:text-blue-600"
                >
                  {comment.postTitle}
                </Link>

                <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                  {comment.content}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
