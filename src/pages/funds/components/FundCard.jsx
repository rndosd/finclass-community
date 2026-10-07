import React from "react";
import {
  ArrowSquareOutIcon,
  ChartLineUpIcon,
  FileTextIcon,
  ScalesIcon,
} from "@phosphor-icons/react";

import { Button } from "../../../components/ui";
import { formatSignedPercentValue } from "../utils/displayFormat";
import { getFundPerformanceMetric, getPerformanceUnavailableLabel } from "../utils/fundPerformance";
import { getFundReportOverdueLabel, isFundReportOverdue } from "../utils/fundReportStatus";

function getStatusMeta(fund = {}) {
  if (fund.status === "paused" || fund.joinStatus === "paused") {
    return { label: "운용 일시중지", dotClassName: "bg-amber-500", textClassName: "text-amber-700" };
  }
  if (fund.status === "closed") {
    return { label: "운용 종료", dotClassName: "bg-slate-400", textClassName: "text-slate-600" };
  }
  if (isFundReportOverdue(fund)) {
    return { label: getFundReportOverdueLabel(fund), dotClassName: "bg-rose-500", textClassName: "text-rose-700" };
  }
  return { label: "정상 운용", dotClassName: "bg-emerald-500", textClassName: "text-emerald-700" };
}

export default function FundCard({
  fund,
  formatFin,
  currencyUnit = "FIN",
  investorCount = 0,
  lastRebalancedLabel = "아직 없음",
  rebalanceDisabledReason = null,
  onOpenDetail,
  onOpenChart,
  onOpenReport,
  onOpenRebalance,
}) {
  if (!fund) return null;

  const performanceMetric = getFundPerformanceMetric(fund, "sinceInception");
  const returnPct = performanceMetric.returnPct;
  const hasReturn = Number.isFinite(returnPct);
  const isPositive = hasReturn && returnPct >= 0;
  const status = getStatusMeta(fund);

  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
            <ChartLineUpIcon aria-hidden="true" className="h-5 w-5" weight="regular" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-lg font-extrabold tracking-tight text-slate-900">
              {fund.fundName || "이름 없는 펀드"}
            </h3>
            <p className="mt-0.5 truncate text-xs font-medium text-slate-500">
              {fund.summary || "등록된 펀드 소개가 없습니다."}
            </p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-2 pt-1 text-xs font-bold ${status.textClassName}`}>
          <span className={`h-2 w-2 rounded-full ${status.dotClassName}`} aria-hidden="true" />
          {status.label}
        </span>
      </header>

      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-y border-slate-200 py-4 lg:grid-cols-4 xl:grid-cols-2">
        <div>
          <dt className="text-xs font-bold text-slate-500">현재 기준가</dt>
          <dd className="mt-1 text-xl font-extrabold tabular-nums text-slate-900">
            {formatFin(fund.currentNav || fund.baseNav || 100, {
              fractionDigits: 2,
              trimTrailingZeros: true,
            })}
            <span className="ml-1 text-xs font-bold text-slate-500">{currencyUnit}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-slate-500">개설 이후 수익률</dt>
          <dd className={`mt-1 text-xl font-extrabold tabular-nums ${!hasReturn ? "text-slate-500" : isPositive ? "text-emerald-600" : "text-rose-600"}`}>
            {hasReturn ? formatSignedPercentValue(returnPct, 1) : getPerformanceUnavailableLabel(performanceMetric)}
          </dd>
          {performanceMetric.startDate && performanceMetric.endDate ? (
            <p className="mt-1 text-[11px] text-slate-500">
              평가 {performanceMetric.startDate} – {performanceMetric.endDate}
            </p>
          ) : null}
        </div>
        <div>
          <dt className="text-xs font-bold text-slate-500">투자자</dt>
          <dd className="mt-1 text-sm font-bold tabular-nums text-slate-900">{investorCount}명</dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-slate-500">최근 리밸런싱</dt>
          <dd className="mt-1 truncate text-sm font-bold tabular-nums text-slate-900">
            {lastRebalancedLabel}
          </dd>
        </div>
      </dl>

      {rebalanceDisabledReason ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          {rebalanceDisabledReason}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap justify-end gap-2 pt-4">
        {onOpenChart ? (
          <Button
            tone="slate"
            kind="outline"
            size="icon-md"
            icon={ChartLineUpIcon}
            iconOnly
            title="NAV 차트 보기"
            aria-label="NAV 차트 보기"
            onClick={() => onOpenChart(fund)}
          />
        ) : null}
        <Button
          tone="slate"
          kind="outline"
          size="sm"
          icon={ArrowSquareOutIcon}
          onClick={() => onOpenDetail?.(fund)}
        >
          상세
        </Button>
        {fund.status !== "closed" && onOpenReport ? (
          <Button
            tone="blue"
            kind="solid"
            size="sm"
            icon={FileTextIcon}
            onClick={() => onOpenReport(fund)}
          >
            보고서 작성
          </Button>
        ) : null}
        <Button
          tone="blue"
          kind="outline"
          size="sm"
          icon={ScalesIcon}
          disabled={Boolean(rebalanceDisabledReason)}
          title={rebalanceDisabledReason || undefined}
          onClick={() => onOpenRebalance?.(fund)}
        >
          리밸런싱
        </Button>
      </div>
    </article>
  );
}
