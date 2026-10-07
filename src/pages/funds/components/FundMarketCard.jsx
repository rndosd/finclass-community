import React, { useMemo } from "react";
import {
  ArrowSquareOutIcon,
  ChartLineUpIcon,
  ScalesIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "../../../components/ui";
import { formatSignedPercentValue } from "../utils/displayFormat";
import {
  FUND_PERFORMANCE_PERIODS,
  getFundDrawdownUnavailableLabel,
  getFundPerformanceMetric,
  getPerformanceUnavailableLabel,
  isFundDrawdownComparable,
} from "../utils/fundPerformance";
import { getFundRiskLabel, isFundRiskFeatureVisible } from "./FundRiskSummary";
import { isFundReportOverdue } from "../utils/fundReportStatus";

function getFundStatus(fund = {}) {
  if (fund.status === "paused" || fund.joinStatus === "paused") {
    return { label: "운용 일시중지", dotClassName: "bg-amber-500", textClassName: "text-amber-700" };
  }
  if (fund.status === "closed") {
    return { label: "운용 종료", dotClassName: "bg-slate-400", textClassName: "text-slate-600" };
  }
  if (isFundReportOverdue(fund)) {
    return { label: "보고서 지연", dotClassName: "bg-amber-500", textClassName: "text-amber-700" };
  }
  return { label: "가입 가능", dotClassName: "bg-emerald-500", textClassName: "text-emerald-700" };
}

function formatDateLabel(value, fallback) {
  if (typeof value === "string") {
    const match = /^(?:\d{4}-)?(\d{2})-(\d{2})/.exec(value);
    if (match) return `${match[1]}.${match[2]}`;
  }

  const date = value?.toDate?.() || (value instanceof Date ? value : null);
  if (date && !Number.isNaN(date.getTime())) {
    return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  }

  return fallback;
}

export function buildFundMarketChartData(fund = {}) {
  const history = Array.isArray(fund.navWindow30d) ? fund.navWindow30d : [];
  const points = history
    .map((point) => ({
      label: String(point?.dateKey || "").slice(5).replace("-", "."),
      nav: Number(point?.nav),
    }))
    .filter((point) => point.label && Number.isFinite(point.nav) && point.nav > 0);

  if (points.length >= 2) return points;

  const baseNav = Number(fund.baseNav || 100);
  const currentNav = Number(fund.currentNav || baseNav);
  const startLabel = formatDateLabel(
    fund.performance30d?.startDate || fund.navWindow30d?.[0]?.dateKey || fund.approvedAt || fund.createdAt,
    "시작",
  );
  const endLabel = formatDateLabel(
    fund.performance30d?.endDate || fund.lastNavDate || fund.navUpdatedAt,
    "현재",
  );
  return [
    { label: startLabel, nav: baseNav },
    { label: endLabel, nav: currentNav },
  ];
}

export default function FundMarketCard({
  fund,
  formatFin,
  currencyUnit = "FIN",
  position = null,
  availableUnits = 0,
  marketValue = 0,
  latestOrderLabel = null,
  subscribeDisabledReason = null,
  rebalanceDisabledReason = null,
  isTeacher = false,
  onOpenDetail,
  onOpenChart,
  onOpenRebalance,
  onOpenSubscribe,
  onOpenRedeem,
  compact = false,
  performancePeriod = "sinceInception",
}) {
  const chartData = useMemo(() => buildFundMarketChartData(fund), [fund]);
  if (!fund) return null;

  const metric = fund.metric || getFundPerformanceMetric(fund, performancePeriod);
  const returnPct = metric.returnPct;
  const hasReturn = Number.isFinite(returnPct);
  const hasDrawdown = isFundDrawdownComparable(metric);
  const isPositive = hasReturn && returnPct >= 0;
  const performanceLabel = `${FUND_PERFORMANCE_PERIODS[performancePeriod]} 수익률`;
  const status = getFundStatus(fund);
  const currentNav = Number(fund.currentNav || fund.baseNav || 100);
  const periodLabel = fund.performance30d?.isFullPeriod
    ? "최근 30일"
    : fund.performance30d?.periodDays > 0
      ? `최근 ${fund.performance30d.periodDays}일`
      : "운용 시작 이후";

  if (compact) {
    return (
      <article className="flex h-full min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
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
              {isFundRiskFeatureVisible(fund.riskSummary) ? (
                <p className="mt-1 text-[11px] font-extrabold text-indigo-600">
                  {getFundRiskLabel(fund.riskSummary)}{fund.riskSummary?.historyQuality === "short" ? " · 가격 기록이 짧아요" : ""}
                </p>
              ) : null}
            </div>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-2 pt-1 text-xs font-bold ${status.textClassName}`}>
            <span className={`h-2 w-2 rounded-full ${status.dotClassName}`} aria-hidden="true" />
            {status.label}
          </span>
        </header>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-y border-slate-200 py-4">
          <div>
            <dt className="text-xs font-bold text-slate-500">현재 기준가</dt>
            <dd className="mt-1 text-xl font-extrabold tabular-nums text-slate-900">
              {formatFin(currentNav, { fractionDigits: 2, trimTrailingZeros: true })}
              <span className="ml-1 text-xs font-bold text-slate-500">{currencyUnit}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-slate-500">{performanceLabel}</dt>
            <dd className={`mt-1 text-xl font-extrabold tabular-nums ${!hasReturn ? "text-slate-400" : isPositive ? "text-emerald-600" : "text-rose-600"}`}>
              {hasReturn ? formatSignedPercentValue(returnPct, 1) : getPerformanceUnavailableLabel(metric)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-slate-500">최대 하락</dt>
            <dd className="mt-1 truncate text-sm font-bold tabular-nums text-slate-900">
              {hasDrawdown ? `${metric.maxDrawdownPct.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%` : getFundDrawdownUnavailableLabel(metric)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-slate-500">내 투자</dt>
            <dd className="mt-1 truncate text-sm font-bold tabular-nums text-slate-900">
              {position
                ? `${formatFin(marketValue, { fractionDigits: 2, trimTrailingZeros: true })} ${currencyUnit}`
                : "미가입"}
            </dd>
          </div>
        </dl>

        <div className="min-h-0 flex-1 space-y-2 py-3">
          {latestOrderLabel ? (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">{latestOrderLabel}</p>
          ) : null}
          {subscribeDisabledReason ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              {subscribeDisabledReason}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button tone="slate" kind="outline" size="sm" icon={ChartLineUpIcon} onClick={() => onOpenChart?.(fund)}>
            차트
          </Button>
          <Button tone="slate" kind="outline" size="sm" icon={ArrowSquareOutIcon} onClick={() => onOpenDetail?.(fund)}>
            상세
          </Button>
          {isTeacher ? (
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
          ) : null}
          <Button
            tone="indigo"
            kind="solid"
            size="sm"
            icon={UserPlusIcon}
            disabled={Boolean(subscribeDisabledReason)}
            title={subscribeDisabledReason || undefined}
            onClick={() => onOpenSubscribe?.(fund)}
          >
            {position ? "추가 매수" : "가입 신청"}
          </Button>
          {position && availableUnits > 0 ? (
            <Button tone="slate" kind="outline" size="sm" onClick={() => onOpenRedeem?.(fund)}>
              환매 신청
            </Button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <header className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
            <ChartLineUpIcon aria-hidden="true" className="h-6 w-6" weight="regular" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
              {fund.fundName || "이름 없는 펀드"}
            </h3>
            <p className="mt-1 truncate text-sm font-medium text-slate-500">
              {fund.summary || "등록된 펀드 소개가 없습니다."}
            </p>
            {isFundRiskFeatureVisible(fund.riskSummary) ? (
              <p className="mt-1 text-xs font-extrabold text-indigo-600">
                {getFundRiskLabel(fund.riskSummary)}{fund.riskSummary?.historyQuality === "short" ? " · 가격 기록이 짧아요" : ""}
              </p>
            ) : null}
          </div>
        </div>

        <span className={`inline-flex shrink-0 items-center gap-2 text-sm font-bold ${status.textClassName}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${status.dotClassName}`} aria-hidden="true" />
          {status.label}
        </span>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
        <section className="border-b border-slate-200 px-5 py-5 sm:px-6 lg:border-b-0 lg:border-r">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-slate-500">NAV 흐름</p>
              <p className="mt-1 text-sm font-semibold text-slate-700">{periodLabel}</p>
            </div>
            {onOpenChart ? (
              <Button
                tone="slate"
                kind="ghost"
                size="sm"
                icon={ChartLineUpIcon}
                onClick={() => onOpenChart(fund)}
              >
                전체 차트
              </Button>
            ) : null}
          </div>

          <div className="h-44 w-full sm:h-52" aria-label={`${fund.fundName} NAV 추이 차트`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 5" vertical={false} />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                  tickMargin={10}
                  interval="preserveStartEnd"
                  minTickGap={28}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                  domain={["dataMin - 2", "dataMax + 2"]}
                  width={48}
                />
                <Tooltip
                  formatter={(value) => [
                    `${formatFin(value, { fractionDigits: 2, trimTrailingZeros: true })} ${currencyUnit}`,
                    "NAV",
                  ]}
                  contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0", boxShadow: "0 8px 24px rgb(15 23 42 / 0.08)" }}
                />
                <Line
                  type="monotone"
                  dataKey="nav"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, fill: "#2563eb", strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="flex flex-col px-5 py-5 sm:px-6">
          <div className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 pb-5">
            <div className="pr-4">
              <p className="text-xs font-bold text-slate-500">현재 기준가 (NAV)</p>
              <p className="mt-2 text-2xl font-extrabold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                {formatFin(currentNav, { fractionDigits: 2, trimTrailingZeros: true })}
                <span className="ml-1.5 text-sm font-bold text-slate-500">{currencyUnit}</span>
              </p>
            </div>
            <div className="pl-4">
              <p className="text-xs font-bold text-slate-500">{performanceLabel}</p>
              <p className={`mt-2 text-2xl font-extrabold tabular-nums tracking-tight sm:text-3xl ${!hasReturn ? "text-slate-400" : isPositive ? "text-emerald-600" : "text-rose-600"}`}>
                {hasReturn ? formatSignedPercentValue(returnPct, 1) : "—"}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 py-4 text-sm">
            <div className="pr-4">
              <dt className="text-xs font-bold text-slate-500">최대 하락</dt>
              <dd className="mt-1.5 truncate font-bold tabular-nums text-slate-900">
                {hasDrawdown ? `${metric.maxDrawdownPct.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%` : getFundDrawdownUnavailableLabel(metric)}
              </dd>
            </div>
            <div className="pl-4">
              <dt className="text-xs font-bold text-slate-500">내 투자</dt>
              <dd className="mt-1.5 truncate font-bold tabular-nums text-slate-900">
                {position
                  ? `${formatFin(marketValue, { fractionDigits: 2, trimTrailingZeros: true })} ${currencyUnit}`
                  : "미가입"}
              </dd>
            </div>
          </dl>

          <div className="space-y-2 py-4">
            {latestOrderLabel ? (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                {latestOrderLabel}
              </p>
            ) : null}
            {subscribeDisabledReason ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                {subscribeDisabledReason}
              </p>
            ) : null}
          </div>

          <div className="mt-auto grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <Button tone="slate" kind="outline" size="sm" icon={ArrowSquareOutIcon} onClick={() => onOpenDetail?.(fund)}>
              자세히 보기
            </Button>
            {isTeacher ? (
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
            ) : null}
            <Button
              tone="indigo"
              kind="solid"
              size="sm"
              icon={UserPlusIcon}
              disabled={Boolean(subscribeDisabledReason)}
              title={subscribeDisabledReason || undefined}
              onClick={() => onOpenSubscribe?.(fund)}
            >
              {position ? "추가 매수" : "가입 신청"}
            </Button>
            {position && availableUnits > 0 ? (
              <Button tone="slate" kind="outline" size="sm" onClick={() => onOpenRedeem?.(fund)}>
                환매 신청
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </article>
  );
}
