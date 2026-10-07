import React, { useMemo, useState } from "react";

import { Card , Tabs} from "../../../components/ui";
import { formatSignedPercentValue } from "../../funds/utils/displayFormat";
import {
  getFundPerformanceMetric,
  isFundDrawdownComparable,
} from "../../funds/utils/fundPerformance";

export { MIN_DRAWDOWN_OBSERVATIONS } from "../../funds/utils/fundPerformance";

export const getOperatingFunds = (funds = []) =>
  (Array.isArray(funds) ? funds : []).filter(
    (fund) => fund && !fund.deletedAt && String(fund.status || "open") !== "closed",
  );

export const getFundRankingPerformance = (fund = {}) => {
  const metric = getFundPerformanceMetric(fund, "sinceInception");

  return {
    returnPct: metric.returnPct,
    maxDrawdownPct: metric.maxDrawdownPct,
    observations: metric.observations,
    performanceStatus: metric.status,
  };
};

export const buildClassFundRanking = (funds = [], limit = 3, rankingMetric = "return") => {
  const isDrawdownRanking = rankingMetric === "drawdown";
  const ordered = getOperatingFunds(funds)
    .map((fund) => ({ ...fund, ...getFundRankingPerformance(fund) }))
    .map((fund) => ({
      ...fund,
      rankingValue: isDrawdownRanking ? fund.maxDrawdownPct : fund.returnPct,
    }))
    .filter((fund) => Number.isFinite(fund.rankingValue))
    .filter((fund) => !isDrawdownRanking || isFundDrawdownComparable(fund))
    .sort((left, right) => {
      if (right.rankingValue !== left.rankingValue) {
        return isDrawdownRanking
          ? left.rankingValue - right.rankingValue
          : right.rankingValue - left.rankingValue;
      }
      return String(left.fundName || left.id || "").localeCompare(
        String(right.fundName || right.id || ""),
        "ko",
      );
    });

  let priorValue = null;
  let priorRank = 0;
  return ordered.slice(0, limit).map((fund, index) => {
    const rank = priorValue !== null && fund.rankingValue === priorValue ? priorRank : index + 1;
    priorValue = fund.rankingValue;
    priorRank = rank;
    return { ...fund, rank };
  });
};

const RANK_STYLES = [
  "bg-amber-400 text-amber-950 ring-4 ring-amber-50 shadow-sm",
  "bg-slate-200 text-slate-700 ring-4 ring-slate-50",
  "bg-orange-200 text-orange-800 ring-4 ring-orange-50",
];

export default function ClassFundRanking({ funds = [], onOpenFundDetail }) {
  const [rankingMetric, setRankingMetric] = useState("return");
  const operatingFunds = useMemo(() => getOperatingFunds(funds), [funds]);
  const rankedFunds = useMemo(
    () => buildClassFundRanking(funds, 3, rankingMetric),
    [funds, rankingMetric],
  );
  const isDrawdownRanking = rankingMetric === "drawdown";
  if (operatingFunds.length === 0) return null;

  return (
    <Card className="overflow-hidden border-none p-5 shadow-md">
      <div className="mb-2 flex items-start justify-between gap-3 border-b border-slate-100">
        <div className="pb-2.5">
          <h3 className="text-base font-black text-slate-800">우리 반 펀드 TOP 3</h3>
          <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
            {isDrawdownRanking ? "개설 이후 최대 하락이 작은 순" : "개설 이후 수익률"}
          </p>
        </div>
        <Tabs ariaLabel="펀드 순위 기준" idPrefix="fund-ranking" tabs={[{id:"return",label:"수익률"},{id:"drawdown",label:"하락 방어"}]} activeTab={rankingMetric} onTabChange={setRankingMetric} variant="underline" size="sm" className="shrink-0" />
      </div>

      {rankedFunds.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-5 text-center text-xs font-bold text-slate-500">
          {isDrawdownRanking ? "하락 기록 집계 준비 중" : "수익률 집계 준비 중"}
        </p>
      ) : (
      <ol className="divide-y divide-slate-100">
        {rankedFunds.map((fund) => {
          const hasPerformance = Number.isFinite(fund.rankingValue);
          const isPositive = hasPerformance && fund.rankingValue >= 0;
          const rowContent = (
            <>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-black ${
                  RANK_STYLES[fund.rank - 1] || "bg-slate-100 text-slate-500"
                }`}
              >
                {fund.rank}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-slate-800">{fund.fundName || "이름 없는 펀드"}</p>
              </div>
              <span className={`shrink-0 text-sm font-black tabular-nums ${!hasPerformance ? "text-slate-300" : isDrawdownRanking ? "text-slate-700" : isPositive ? "text-emerald-600" : "text-rose-600"}`}>
                {hasPerformance
                  ? isDrawdownRanking
                    ? `${fund.rankingValue.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`
                    : formatSignedPercentValue(fund.rankingValue, 1)
                  : "—"}
              </span>
            </>
          );

          return (
            <li key={fund.id || fund.fundName} className="first:pt-1 last:pb-0">
              {onOpenFundDetail ? (
                <button
                  type="button"
                  onClick={() => onOpenFundDetail(fund)}
                  className="flex w-full items-center gap-3 rounded-lg py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                  aria-label={`${fund.fundName || "이름 없는 펀드"} 상세 보기`}
                >
                  {rowContent}
                </button>
              ) : (
                <div className="flex items-center gap-3 py-3">{rowContent}</div>
              )}
            </li>
          );
        })}
      </ol>
      )}
    </Card>
  );
}
