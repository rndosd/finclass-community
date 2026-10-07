import React from "react";
import dayjs from "dayjs";

import { Button } from "../../../components/ui";

function benchmarkLabel(application = {}) {
  if (
    Array.isArray(application.benchmarkSymbols) &&
    application.benchmarkSymbols.length > 0
  ) {
    return application.benchmarkSymbols.join(" / ");
  }
  if (application.benchmarkSymbol) return application.benchmarkSymbol;
  return "SPY / QQQ";
}

export default function FundAdminTab({
  pendingApplications = [],
  onOpenReview,
}) {
  if (pendingApplications.length === 0) {
    return (
      <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white/70 px-8 py-16 text-center">
        <h3 className="text-2xl font-black text-slate-800">
          심사 대기 중인 신청서가 없습니다.
        </h3>
        <p className="mt-3 text-sm text-slate-500">
          새로운 펀드 신청이 들어오면 여기서 승인하거나 반려할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {pendingApplications.map((application) => {
        const submittedAt =
          application.submittedAt?.toDate?.() || application.submittedAt;

        return (
          <article
            key={application.id}
            className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
                  Pending Review
                </p>
                <h3 className="mt-1 truncate text-2xl font-black text-slate-900">
                  {application.fundName}
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  {application.summary}
                </p>
              </div>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">
                심사 대기
              </span>
            </div>

            <dl className="mt-5 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt>신청자</dt>
                <dd className="font-bold text-slate-900">{application.applicantName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>제출일</dt>
                <dd className="font-bold text-slate-900">
                  {submittedAt ? dayjs(submittedAt).format("YYYY.MM.DD HH:mm") : "-"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>비교 기준</dt>
                <dd className="font-bold text-slate-900">
                  {benchmarkLabel(application)}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex justify-end">
              <Button tone="blue" kind="solid" onClick={() => onOpenReview?.(application)}>
                신청서 검토
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
