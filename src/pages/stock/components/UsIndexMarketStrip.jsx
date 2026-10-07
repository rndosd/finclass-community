import React, { useMemo } from "react";
import { Info } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

import usFlag from "../../../assets/us-flag.svg";
import { Card } from "../../../components/ui";
import { useStockContext } from "../../../contexts/StockContext";
import { useUser } from "../../../contexts/UserContext";
import { useStockSettings } from "../../../hooks/stock/useStockSettings";
import { useUsIndexHistory } from "../../../hooks/stock/useUsIndexHistory";

const US_INDEX_PROXIES = [
  { symbol: "SPY", label: "S&P 500" },
  { symbol: "QQQ", label: "나스닥 100" },
  { symbol: "DIA", label: "다우 30" },
  { symbol: "IWM", label: "러셀 2000" },
];

const getChangePercent = (priceData) => {
  const current = Number(priceData?.current);
  const previousClose = Number(priceData?.previousClose);
  if (!Number.isFinite(current) || !Number.isFinite(previousClose) || previousClose <= 0) {
    return null;
  }
  return ((current - previousClose) / previousClose) * 100;
};

const formatChange = (value) => {
  if (!Number.isFinite(value)) return "시세 준비 중";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
};

const formatChartDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const toTimestamp = (value) => {
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const getIndexChartData = (historical, priceData, now = Date.now()) => {
  const quoteTimestamp = toTimestamp(priceData?.lastFetched) || now;
  const historyData = (Array.isArray(historical) ? historical : [])
    .map((point) => ({ x: point?.date, value: Number(point?.close) }))
    .filter((point) => toTimestamp(point.x) !== null && Number.isFinite(point.value))
    .slice(-7);
  const latestHistoryTimestamp = toTimestamp(historyData.at(-1)?.x);

  if (
    historyData.length >= 2
    && latestHistoryTimestamp >= quoteTimestamp - (10 * 86400000)
  ) {
    return historyData;
  }

  const previousClose = Number(priceData?.previousClose);
  const current = Number(priceData?.current);
  if (!Number.isFinite(previousClose) || !Number.isFinite(current)) return [];

  return [
    { x: quoteTimestamp - 86400000, value: previousClose },
    { x: quoteTimestamp, value: current },
  ];
};

export const getIndexChartDomain = ([dataMin, dataMax]) => {
  const min = Number(dataMin);
  const max = Number(dataMax);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];

  const spread = Math.max(0, max - min);
  const reference = Math.max(Math.abs(min), Math.abs(max), 1);
  const padding = Math.max(spread * 0.18, reference * 0.0015);
  return [min - padding, max + padding];
};

function IndexItem({ index }) {
  const hasChange = Number.isFinite(index.changePercent);
  const isUp = hasChange && index.changePercent >= 0;
  const strokeColor = !hasChange ? "#94a3b8" : isUp ? "#10b981" : "#fb7185";
  const chartStart = index.chartData[0]?.x;
  const chartEnd = index.chartData[index.chartData.length - 1]?.x;

  return (
    <div className="grid min-w-0 grid-cols-[minmax(72px,auto)_minmax(64px,1fr)] items-end gap-2.5 border-slate-200 px-3 py-3 sm:border-l sm:first:border-l-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-slate-900">{index.label}</p>
        <span className="mt-0.5 block text-[10px] font-bold text-slate-400">{index.symbol}</span>
        <p
          className={`mt-2 text-xl font-black tabular-nums ${
            !hasChange ? "text-slate-400" : isUp ? "text-emerald-700" : "text-rose-600"
          }`}
        >
          {formatChange(index.changePercent)}
        </p>
      </div>
      <div className="min-w-0" aria-label={`${index.label} 최근 가격 흐름`}>
        <div className="h-11 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={index.chartData} margin={{ top: 3, right: 1, bottom: 1, left: 1 }}>
              <YAxis hide dataKey="value" domain={getIndexChartDomain} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={strokeColor}
                strokeWidth={2}
                fill={strokeColor}
                fillOpacity={0.12}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 flex justify-between text-[9px] font-semibold tabular-nums text-slate-400">
          <span>{formatChartDate(chartStart)}</span>
          <span>{formatChartDate(chartEnd)}</span>
        </div>
      </div>
    </div>
  );
}

export default function UsIndexMarketStrip() {
  const { allPrices } = useStockContext();
  const { isTeacher, classId } = useUser();
  const { settings } = useStockSettings(classId);
  const { data: indexHistory = {} } = useUsIndexHistory(classId);
  const isTopMoversHidden = settings?.isTopMoversHidden === true;

  const indexRows = useMemo(
    () =>
      US_INDEX_PROXIES.map((index) => {
        const priceData = allPrices?.[index.symbol];

        return {
          ...index,
          changePercent: getChangePercent(priceData),
          chartData: getIndexChartData(indexHistory?.[index.symbol], priceData),
        };
      }),
    [allPrices, indexHistory],
  );

  if (!isTeacher && isTopMoversHidden) return null;

  return (
    <Card
      noShadow
      className={`overflow-hidden rounded-3xl border p-0 shadow-sm transition-all ${
        isTopMoversHidden ? "border-slate-300 bg-slate-50 opacity-70" : "border-slate-100 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <img src={usFlag} alt="미국 국기" className="h-4 w-6 rounded-[2px] object-cover shadow-sm" />
          <h3 className="text-lg font-black tracking-tight text-slate-900">미국 주요 지수</h3>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400">
          ETF 시세 기준 <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4">
        {indexRows.map((index) => <IndexItem key={index.symbol} index={index} />)}
      </div>
    </Card>
  );
}
