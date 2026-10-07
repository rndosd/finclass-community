import React, { useMemo } from "react";
import dayjs from "dayjs";

import { Button } from "../../../components/ui";
import FundCard from "../components/FundCard";
import {
  FUND_REBALANCE_OPEN_TIME,
  getFundRebalanceDisabledReason,
} from "../utils/fundActionAvailability";

function statusTone(status) {
  switch (status) {
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "rejected":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function statusLabel(status) {
  switch (status) {
    case "approved":
      return "승인 완료";
    case "rejected":
      return "반려";
    default:
      return "심사 대기";
  }
}

function formatDateTime(value) {
  const date = value?.toDate?.() || value;
  if (!date) return "-";
  return dayjs(date).format("YYYY.MM.DD HH:mm");
}

function EmptyState({ message }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-7 text-center">
      <p className="text-sm font-semibold text-slate-500">{message}</p>
    </div>
  );
}

function SectionHeading({ title, description, count }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div>
        <h3 className="text-xl font-bold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <span className="shrink-0 text-xs font-bold tabular-nums text-slate-500">
        {count}건
      </span>
    </div>
  );
}

export default function MyFundsTab({
  managedFunds = [],
  managedInvestorPositions = [],
  myApplications = [],
  myPositions = [],
  allFunds = [],
  formatFin,
  currencyUnit = "FIN",
  orderCutoffTime = "15:00",
  isTeacher = false,
  onRetryApplication,
  onOpenDetail,
  onOpenChart,
  onOpenReport,
  onOpenRebalance,
}) {
  const findFundById = (fundId) =>
    (allFunds || []).find((fund) => fund.id === fundId) || null;

  const investorCountByFundId = useMemo(() => {
    const counts = new Map();
    (managedInvestorPositions || []).forEach((position) => {
      if (!position?.fundId) return;
      counts.set(position.fundId, (counts.get(position.fundId) || 0) + 1);
    });
    return counts;
  }, [managedInvestorPositions]);

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <SectionHeading
          title="운용 중인 펀드"
          description={
            isTeacher
              ? "교사는 관리자 권한으로 시간 제한 없이 리밸런싱할 수 있습니다."
              : `평일 ${FUND_REBALANCE_OPEN_TIME}부터 ${orderCutoffTime}까지 리밸런싱할 수 있습니다.`
          }
          count={managedFunds.length}
        />

        {managedFunds.length === 0 ? (
          <EmptyState message="아직 직접 운용 중인 펀드가 없습니다." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {managedFunds.map((fund) => {
              const lastRebalancedAt =
                fund.lastRebalancedAt?.toDate?.() || fund.lastRebalancedAt;
              const rebalanceDisabledReason = getFundRebalanceDisabledReason(fund, {
                orderCutoffTime,
                isTeacher,
              });

              return (
                <FundCard
                  key={fund.id}
                  fund={fund}
                  formatFin={formatFin}
                  currencyUnit={currencyUnit}
                  investorCount={investorCountByFundId.get(fund.id) || 0}
                  lastRebalancedLabel={
                    lastRebalancedAt
                      ? dayjs(lastRebalancedAt).format("YYYY.MM.DD")
                      : "아직 없음"
                  }
                  rebalanceDisabledReason={rebalanceDisabledReason}
                  onOpenDetail={onOpenDetail}
                  onOpenChart={onOpenChart}
                  onOpenReport={onOpenReport}
                  onOpenRebalance={onOpenRebalance}
                />
              );
            })}
          </div>
        )}
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <SectionHeading
            title="내 투자내역"
            description="내가 가입한 펀드의 현재 가치를 확인합니다."
            count={myPositions.length}
          />

          <div className="mt-5">
            {myPositions.length === 0 ? (
              <EmptyState message="아직 가입한 펀드가 없습니다." />
            ) : (
              <div className="divide-y divide-slate-200">
                {myPositions.map((position) => {
                  const fund = findFundById(position.fundId);
                  const currentNav = Number(fund?.currentNav ?? fund?.baseNav ?? 100);
                  const availableUnits = Math.max(
                    0,
                    Number(position.units || 0) - Number(position.reservedUnits || 0),
                  );
                  const marketValue = availableUnits * currentNav;
                  const investedAmount = Number(position.totalInvestedUSD || 0);
                  const returnPct =
                    investedAmount > 0
                      ? ((marketValue - investedAmount) / investedAmount) * 100
                      : 0;

                  return (
                    <article
                      key={`${position.fundId}-${position.studentUid}`}
                      className="flex items-center gap-3 py-4 first:pt-0 last:pb-0"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => fund && onOpenDetail?.(fund)}
                        disabled={!fund}
                      >
                        <span className="block truncate text-sm font-bold text-slate-900">
                          {position.fundName || fund?.fundName || "펀드 정보 없음"}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          투자 원금 {formatFin(investedAmount)} {currencyUnit}
                        </span>
                      </button>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
                        {formatFin(marketValue)} {currencyUnit}
                      </span>
                      <span
                        className={`w-14 shrink-0 text-right text-sm font-bold tabular-nums ${
                          returnPct >= 0 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%
                      </span>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <SectionHeading
            title="신청 현황"
            description="개설 신청의 상태와 반려 사유를 확인합니다."
            count={myApplications.length}
          />

          <div className="mt-5">
            {myApplications.length === 0 ? (
              <EmptyState message="아직 제출한 신청서가 없습니다." />
            ) : (
              <div className="divide-y divide-slate-200">
                {myApplications.map((application) => {
                  const isRejected = application.status === "rejected";

                  return (
                    <article key={application.id} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="truncate text-sm font-bold text-slate-900">
                              {application.fundName}
                            </h4>
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(application.status)}`}>
                              {statusLabel(application.status)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs tabular-nums text-slate-500">
                            {formatDateTime(application.submittedAt)}
                          </p>
                        </div>
                        {isRejected ? (
                          <Button
                            tone="blue"
                            kind="outline"
                            size="xs"
                            className="shrink-0"
                            onClick={() => onRetryApplication?.(application)}
                          >
                            다시 제출
                          </Button>
                        ) : null}
                      </div>
                      {application.reviewNote ? (
                        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                          {application.reviewNote}
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
