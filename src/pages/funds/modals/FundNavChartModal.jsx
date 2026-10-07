import React, { useMemo } from "react";
import dayjs from "dayjs";
import {
  Activity,
  CalendarDays,
  LineChart as LineChartIcon,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Modal, Spinner } from "../../../components/ui";
import { useFundNavHistory } from "../hooks/useFunds";
import {
  formatSignedPercentValue,
  formatTrimmedNumber,
} from "../utils/displayFormat";

function formatAxisNav(value) {
  return formatTrimmedNumber(value, value >= 1000 ? 0 : 2);
}

function NavTooltip({ active, payload, formatFin, currencyUnit }) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;

  const point = payload[0]?.payload || null;
  if (!point) return null;

  return (
    <div className="min-w-[180px] rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
        {point.fullDateLabel}
      </p>
      <p className="mt-2 text-lg font-black text-slate-900">
        {formatFin(point.nav, {
          fractionDigits: 2,
          trimTrailingZeros: true,
        })}{" "}
        {currencyUnit}
      </p>
      <p
        className={`mt-2 text-sm font-bold ${
          point.returnPct > 0
            ? "text-emerald-600"
            : point.returnPct < 0
              ? "text-rose-500"
              : "text-slate-500"
        }`}
      >
        전일 대비 {formatSignedPercentValue(point.returnPct, 2)}
      </p>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone = "slate" }) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "rose"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : tone === "sky"
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em]">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
    </div>
  );
}

export default function FundNavChartModal({
  isOpen,
  onClose,
  classId,
  fund = null,
  formatFin,
  currencyUnit = "FIN",
}) {
  const fundId = fund?.id || null;
  const { navHistory, isLoading } = useFundNavHistory(
    isOpen ? classId : null,
    isOpen ? fundId : null,
  );

  const chartData = useMemo(
    () =>
      (navHistory || [])
        .map((entry) => {
          const dateKey = String(entry?.dateKey || entry?.id || "");
          const nav = Number(entry?.nav ?? entry?.currentNav ?? 0);
          const returnPct = Number(entry?.returnRate || 0) * 100;
          const parsedDate = dayjs(dateKey);

          return {
            id: dateKey,
            dateKey,
            nav,
            returnPct,
            fullDateLabel: parsedDate.isValid()
              ? parsedDate.format("YYYY.MM.DD")
              : dateKey,
          };
        })
        .filter((entry) => entry.dateKey && Number.isFinite(entry.nav) && entry.nav > 0),
    [navHistory],
  );

  const stats = useMemo(() => {
    const firstPoint = chartData[0] || null;
    const latestPoint = chartData[chartData.length - 1] || null;

    if (!firstPoint || !latestPoint) {
      return {
        firstPoint: null,
        latestPoint: null,
        highestPoint: null,
        lowestPoint: null,
        totalReturnPct: 0,
        chartRangeLabel: "-",
        yDomain: [95, 105],
      };
    }

    const highestPoint = chartData.reduce((best, entry) => {
      if (!best || entry.nav > best.nav) return entry;
      return best;
    }, null);
    const lowestPoint = chartData.reduce((best, entry) => {
      if (!best || entry.nav < best.nav) return entry;
      return best;
    }, null);

    const comparisonValues = [
      ...chartData.map((entry) => entry.nav),
      Number(fund?.baseNav || 100),
    ].filter((value) => Number.isFinite(value) && value > 0);
    const minNav = Math.min(...comparisonValues);
    const maxNav = Math.max(...comparisonValues);
    const padding =
      maxNav === minNav ? Math.max(2, maxNav * 0.05) : (maxNav - minNav) * 0.14;

    return {
      firstPoint,
      latestPoint,
      highestPoint,
      lowestPoint,
      totalReturnPct:
        firstPoint.nav > 0
          ? ((latestPoint.nav - firstPoint.nav) / firstPoint.nav) * 100
          : 0,
      chartRangeLabel: `${firstPoint.fullDateLabel} - ${latestPoint.fullDateLabel}`,
      yDomain: [Math.max(0, minNav - padding), maxNav + padding],
    };
  }, [chartData, fund?.baseNav]);

  if (!isOpen || !fund) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={`${fund.fundName} NAV 차트`}
    >
      <div className="space-y-6">
        <section className="overflow-hidden rounded-[1.75rem] border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-sky-700">
                <LineChartIcon className="h-4 w-4" />
                NAV history
              </div>
              <h3 className="mt-2 text-3xl font-black tracking-tight text-slate-900">
                {fund.fundName}
              </h3>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                매일 저장되는 기준가 흐름입니다. 리밸런싱과 시장 변동이 누적되면서
                펀드의 NAV가 어떻게 움직였는지 한눈에 볼 수 있습니다.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/80 bg-white/85 px-3 py-1 text-xs font-black text-slate-700">
                기록 {chartData.length}개
              </span>
              {stats.latestPoint ? (
                <span className="rounded-full border border-white/80 bg-white/85 px-3 py-1 text-xs font-black text-slate-700">
                  최신 {stats.latestPoint.fullDateLabel}
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {isLoading ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-[1.75rem] border border-slate-200 bg-white">
            <Spinner size="lg" />
            <p className="text-sm font-bold text-slate-500">
              NAV 히스토리를 불러오는 중입니다.
            </p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50/80 px-6 text-center">
            <Activity className="h-10 w-10 text-slate-300" />
            <div className="space-y-2">
              <p className="text-base font-black text-slate-700">
                아직 누적된 NAV 히스토리가 없습니다.
              </p>
              <p className="text-sm leading-6 text-slate-500">
                일일 기준가 스냅샷이 쌓이기 시작하면 이 모달에서 차트로 바로
                확인할 수 있습니다.
              </p>
            </div>
          </div>
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                icon={LineChartIcon}
                label="현재 NAV"
                value={`${formatFin(stats.latestPoint?.nav || 0, {
                  fractionDigits: 2,
                  trimTrailingZeros: true,
                })} ${currencyUnit}`}
                tone="sky"
              />
              <StatCard
                icon={TrendingUp}
                label="누적 수익률"
                value={formatSignedPercentValue(stats.totalReturnPct, 2)}
                tone={stats.totalReturnPct >= 0 ? "emerald" : "rose"}
              />
              <StatCard
                icon={TrendingUp}
                label="기간 고점"
                value={`${formatFin(stats.highestPoint?.nav || 0, {
                  fractionDigits: 2,
                  trimTrailingZeros: true,
                })} ${currencyUnit}`}
                tone="emerald"
              />
              <StatCard
                icon={TrendingDown}
                label="기간 저점"
                value={`${formatFin(stats.lowestPoint?.nav || 0, {
                  fractionDigits: 2,
                  trimTrailingZeros: true,
                })} ${currencyUnit}`}
                tone="rose"
              />
            </section>

            <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 sm:p-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h4 className="text-xl font-black text-slate-900">기준가 추이</h4>
                  <p className="mt-1 text-sm text-slate-500">
                    {stats.chartRangeLabel}
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                  <CalendarDays className="h-4 w-4" />
                  {chartData.length}일 기록
                </div>
              </div>

              <div className="mt-6 h-[320px] sm:h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart
                    data={chartData}
                    margin={{ top: 12, right: 18, left: -12, bottom: 0 }}
                  >
                    <CartesianGrid
                      stroke="#e2e8f0"
                      strokeDasharray="4 4"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="dateKey"
                      tickFormatter={(value) => dayjs(value).format("M.D")}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={24}
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                    />
                    <YAxis
                      domain={stats.yDomain}
                      tickFormatter={formatAxisNav}
                      axisLine={false}
                      tickLine={false}
                      width={54}
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                    />
                    <Tooltip
                      content={
                        <NavTooltip
                          formatFin={formatFin}
                          currencyUnit={currencyUnit}
                        />
                      }
                    />
                    <ReferenceLine
                      y={Number(fund.baseNav || 100)}
                      stroke="#cbd5e1"
                      strokeDasharray="5 5"
                    />
                    <Line
                      type="monotone"
                      dataKey="nav"
                      stroke="#2563eb"
                      strokeWidth={3}
                      dot={{
                        r: chartData.length === 1 ? 5 : 3,
                        fill: "#2563eb",
                        stroke: "#ffffff",
                        strokeWidth: 2,
                      }}
                      activeDot={{
                        r: 6,
                        fill: "#2563eb",
                        stroke: "#ffffff",
                        strokeWidth: 2,
                      }}
                    />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </div>

              <p className="mt-4 text-xs font-bold text-slate-500">
                회색 기준선은 기본 NAV {formatTrimmedNumber(fund.baseNav || 100, 2)}
                입니다.
                {chartData.length === 1
                  ? " 첫 스냅샷만 있어서 현재는 점 형태로 표시됩니다."
                  : ""}
              </p>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
