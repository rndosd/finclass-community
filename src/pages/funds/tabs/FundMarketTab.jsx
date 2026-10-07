import React, { useMemo, useState } from "react";

import FundMarketCard from "../components/FundMarketCard";
import { isFundRiskFeatureVisible } from "../components/FundRiskSummary";
import {
  FUND_PERFORMANCE_PERIODS,
  compareFundPerformance,
  getFundPerformanceMetric,
} from "../utils/fundPerformance";
import {
  getFundRebalanceDisabledReason,
  getFundSubscribeDisabledReason,
} from "../utils/fundActionAvailability";

function getLatestOrderStatusLabel(order = null) {
  if (!order) return null;

  if (order.status === "executed") {
    return order.type === "redeem"
      ? "최근 주문: 환매 완료"
      : "최근 주문: 가입 체결 완료";
  }
  if (order.status === "rejected") return "최근 주문: 반려";
  return order.type === "redeem"
    ? "최근 주문: 환매 접수 중"
    : "최근 주문: 가입 접수 중";
}

export default function FundMarketTab({
  funds = [],
  formatFin,
  currencyUnit = "FIN",
  positionsByFundId = {},
  latestOrdersByFundId = {},
  orderCutoffTime = "15:00",
  isTeacher = false,
  onOpenDetail,
  onOpenChart,
  onOpenRebalance,
  onOpenSubscribe,
  onOpenRedeem,
}) {
  const [period, setPeriod] = useState("sinceInception");
  const [sort, setSort] = useState("return");
  const [riskFilter, setRiskFilter] = useState("all");
  const hasMultipleFunds = funds.length > 1;
  const selectedPeriod = hasMultipleFunds ? period : "sinceInception";
  const hasRiskCategories = funds.some((fund) =>
    isFundRiskFeatureVisible(fund?.riskSummary) && Boolean(fund?.riskSummary?.category));
  const selectedRiskFilter = hasMultipleFunds && hasRiskCategories ? riskFilter : "all";
  const hasOneMonthPerformance = funds.some((fund) =>
    Number.isFinite(getFundPerformanceMetric(fund, "oneMonth").returnPct));
  const comparedFunds = useMemo(
    () => funds
      .filter((fund) => {
        if (selectedRiskFilter === "all") return true;
        const category = isFundRiskFeatureVisible(fund?.riskSummary) ? fund?.riskSummary?.category : null;
        if (selectedRiskFilter === "unavailable") return !category;
        return category === selectedRiskFilter;
      })
      .map((fund) => ({ ...fund, metric: getFundPerformanceMetric(fund, selectedPeriod) }))
      .sort((left, right) => compareFundPerformance(left, right, sort)),
    [funds, selectedPeriod, selectedRiskFilter, sort],
  );

  if (funds.length === 0) {
    return (
      <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white/70 px-8 py-16 text-center">
        <h3 className="text-2xl font-black text-slate-800">아직 개설된 펀드가 없습니다.</h3>
        <p className="mt-3 text-sm text-slate-500">
          첫 번째 펀드가 승인되면 여기에서 둘러볼 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hasMultipleFunds ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2" role="group" aria-label="펀드 비교">
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="펀드 성과 기간">
            {Object.entries(FUND_PERFORMANCE_PERIODS).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                aria-pressed={selectedPeriod === value}
                className={`min-h-11 rounded-xl border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${selectedPeriod === value ? "border-indigo-100 bg-white text-indigo-700" : "border-transparent text-slate-600 hover:bg-white/60 hover:text-slate-900"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
              정렬
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                className="min-h-11 min-w-0 rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="return">수익률 높은 순</option>
                <option value="drawdown">최대 하락 작은 순</option>
              </select>
            </label>
            {hasRiskCategories ? (
              <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
                가격 움직임
                <select
                  value={selectedRiskFilter}
                  onChange={(event) => setRiskFilter(event.target.value)}
                  className="min-h-11 min-w-0 rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="all">전체</option>
                  <option value="stable">작음</option>
                  <option value="neutral">보통</option>
                  <option value="aggressive">큼</option>
                  <option value="unavailable">아직 알 수 없음</option>
                </select>
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedPeriod === "oneMonth" && !hasOneMonthPerformance ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
          <span>아직 최근 1개월을 채운 펀드가 없습니다.</span>
          <button type="button" onClick={() => setPeriod("sinceInception")} className="rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-amber-800 shadow-sm">
            개설 이후 보기
          </button>
        </div>
      ) : null}

      <div className={hasMultipleFunds ? "grid min-w-0 gap-4 xl:grid-cols-2" : "space-y-4"}>
      {comparedFunds.map((fund) => {
        const position = positionsByFundId[fund.id];
        const latestOrder = latestOrdersByFundId[fund.id];
        const availableUnits = Math.max(
          0,
          Number(position?.units || 0) - Number(position?.reservedUnits || 0),
        );
        const marketValue = availableUnits * Number(fund.currentNav || fund.baseNav || 100);
        const latestOrderLabel = getLatestOrderStatusLabel(latestOrder);
        const subscribeDisabledReason = getFundSubscribeDisabledReason(fund, {
          orderCutoffTime,
          isTeacher,
        });
        const rebalanceDisabledReason = getFundRebalanceDisabledReason(fund, {
          orderCutoffTime,
          isTeacher,
        });

        return (
          <FundMarketCard
            key={fund.id}
            fund={fund}
            formatFin={formatFin}
            currencyUnit={currencyUnit}
            position={position}
            availableUnits={availableUnits}
            marketValue={marketValue}
            latestOrderLabel={latestOrderLabel}
            subscribeDisabledReason={subscribeDisabledReason}
            rebalanceDisabledReason={rebalanceDisabledReason}
            isTeacher={isTeacher}
            onOpenDetail={onOpenDetail}
            onOpenChart={onOpenChart}
            onOpenRebalance={onOpenRebalance}
            onOpenSubscribe={onOpenSubscribe}
            onOpenRedeem={onOpenRedeem}
            compact={hasMultipleFunds}
            performancePeriod={selectedPeriod}
          />
        );
      })}
      {comparedFunds.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm font-bold text-slate-500">
          선택한 가격 움직임에 맞는 펀드가 없어요.
        </p>
      ) : null}
      </div>
    </div>
  );
}
