import React, { memo, useMemo } from "react";
import {
  BarChart3,
  Coins,
  MinusCircle,
  Repeat,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Card, Button, EmptyState, IconButton, Spinner } from "../../../components/ui";
import { useStockContext } from "../../../contexts/StockContext";
import useStudentPortfolio from "../../hooks/useStudentPortfolio";
import ClassFundRanking, { getOperatingFunds } from "./ClassFundRanking";
import TopMoversDashboard from "./TopMoversDashboard";
import UsIndexMarketStrip from "./UsIndexMarketStrip";

function StockOverview({
  accountOverride,
  onOpenExchangeModal,
  onOpenMarketStock,
  onOpenFundDetail,
  onOpenPortfolioModal,
  onOpenTradeAnalysisModal,
  topN = 5,
  allStockSymbols = [],
  allStocksByCategory = {},
  hiddenStocks = {},
  privilegedSymbols = new Set(),
  isTopMoversHidden = false,
  showTopMovers = true,
  onToggleTopMoversVisibility,
  isLoadingData = false,
  classFunds = [],
}) {
  const {
    formatClassCurrency,
    formatExchangeRate,
    formatFin,
    formatPercent,
    formatShareQuantity,
    balanceBIL,
    balanceUSD,
    conversionRate,
    currencyUnit,
    isLoading: isContextLoading,
  } = useStockContext();

  const {
    portfolioEntries: studentPortfolioEntries,
    summary: studentPortfolioSummary,
    loading: isStudentPortfolioLoading,
  } = useStudentPortfolio({
    conversionRate,
  });
  const portfolioEntries =
    accountOverride?.portfolioEntries ?? studentPortfolioEntries;
  const summary = accountOverride?.summary ?? studentPortfolioSummary;
  const isPortfolioLoading =
    accountOverride?.isLoading ?? isStudentPortfolioLoading;
  const displayedBalanceUSD = accountOverride?.balanceUSD ?? balanceUSD;
  const displayedBalanceBIL = accountOverride?.balanceBIL ?? balanceBIL;
  const finBalanceLabel = accountOverride?.finBalanceLabel || "FIN 잔액";
  const localBalanceLabel =
    accountOverride?.localBalanceLabel || `${currencyUnit} 잔액`;
  const hideFinBalance = accountOverride?.hideFinBalance === true;

  const hasPortfolio = portfolioEntries.length > 0;
  const operatingFunds = useMemo(() => getOperatingFunds(classFunds), [classFunds]);
  const hasOperatingFunds = operatingFunds.length > 0;
  const visibleTopN = hasOperatingFunds ? Math.min(topN, 3) : topN;

  const topEntries = useMemo(() => {
    if (!hasPortfolio) return [];

    return [...portfolioEntries]
      .sort((a, b) => (b.evalAmountUSD ?? 0) - (a.evalAmountUSD ?? 0))
      .slice(0, visibleTopN);
  }, [portfolioEntries, hasPortfolio, visibleTopN]);

  if (
    !accountOverride &&
    isContextLoading &&
    !displayedBalanceBIL &&
    !displayedBalanceUSD
  ) {
    return (
      <div className="flex justify-center p-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        data-tour="stock-overview-summary"
        className={`grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-slate-200/90 bg-slate-200/80 shadow-sm md:grid-cols-2 ${
          hideFinBalance ? "lg:grid-cols-3" : "lg:grid-cols-4"
        }`}
      >
        {!hideFinBalance ? (
          <div className="flex min-h-[132px] flex-col bg-white p-5">
          <div className="flex h-full flex-col justify-between">
            <div className="flex items-start justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {finBalanceLabel}
              </p>
              {onOpenExchangeModal ? (
                <Button
                  size="xs"
                  tone="lightBlue"
                  kind="soft"
                  onClick={onOpenExchangeModal}
                >
                  환전
                </Button>
              ) : null}
            </div>
            <p className="mt-3 text-2xl font-black tabular-nums text-emerald-600">
              {formatFin(displayedBalanceUSD, {
                compact: true,
                fractionDigits: 0,
              })}{" "}
              <span className="text-sm font-medium">FIN</span>
            </p>
          </div>
          </div>
        ) : null}

        <div className="flex min-h-[132px] flex-col bg-white p-5">
          <div className="flex h-full flex-col justify-between">
            <div className="flex items-start justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {localBalanceLabel}
              </p>
              <div className="rounded-lg bg-blue-50 p-1.5">
                <Coins className="h-4 w-4 text-blue-500" />
              </div>
            </div>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-2xl font-black tabular-nums text-blue-600">
              {formatClassCurrency(displayedBalanceBIL, { compact: true })}{" "}
              <span className="text-sm font-medium">{currencyUnit}</span>
              {hideFinBalance ? (
                <span className="text-xs font-semibold text-slate-400">
                  ≈ {formatFin(displayedBalanceUSD, {
                    compact: true,
                    fractionDigits: 0,
                  })} FIN
                </span>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex min-h-[132px] flex-col bg-white p-5">
          <div className="flex h-full flex-col justify-between">
            <div className="flex items-start justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                현재 환율
              </p>
              <div className="rounded-lg bg-slate-100 p-1.5">
                <Repeat className="h-4 w-4 text-slate-500" />
              </div>
            </div>
            <p className="mt-3 text-2xl font-black tabular-nums text-slate-800">
              {conversionRate > 0
                ? formatExchangeRate(conversionRate, {
                    fractionDigits: 2,
                    trimTrailingZeros: true,
                  })
                : "-"}
              <span className="ml-1 text-sm font-medium text-slate-400">
                {currencyUnit}/FIN
              </span>
            </p>
          </div>
        </div>

        <div className="flex min-h-[132px] flex-col bg-white p-5">
          <div className="flex h-full flex-col justify-between">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            보유 주식 평가액
          </p>
          {hasPortfolio ? (
            <div className="space-y-1">
              <p className="text-2xl font-black tabular-nums text-indigo-700">
                {formatFin(summary.totalCurrentValueUSD)}{" "}
                <span className="text-sm font-medium">FIN</span>
              </p>
              <div
                className={`flex items-center gap-1 text-xs font-bold ${
                  summary.totalProfitLossUSD >= 0
                    ? "text-emerald-600"
                    : "text-rose-600"
                }`}
              >
                {summary.totalProfitLossUSD >= 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {summary.totalProfitLossUSD >= 0 ? "+" : ""}
                {formatFin(summary.totalProfitLossUSD)} (
                {formatPercent(summary.totalProfitRate)}%)
              </div>
            </div>
          ) : (
            <p className="mt-3 text-2xl font-black tabular-nums text-slate-300">
              -
            </p>
          )}
          </div>
        </div>
      </div>

      {showTopMovers ? <UsIndexMarketStrip /> : null}

      <div
        className={`grid grid-cols-1 items-start gap-4 ${
          showTopMovers
            ? hasOperatingFunds
              ? "lg:grid-cols-[minmax(0,5fr)_minmax(280px,3fr)]"
              : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
            : ""
        }`}
      >
        {showTopMovers && (
          <div className="h-full" data-tour="stock-overview-movers">
        <TopMoversDashboard
          isLoadingData={isLoadingData || isContextLoading || isPortfolioLoading}
          allStockSymbols={allStockSymbols}
          allStocksByCategory={allStocksByCategory}
          hiddenStocks={hiddenStocks}
          privilegedSymbols={privilegedSymbols}
          isTopMoversHidden={isTopMoversHidden}
          onSelectStock={onOpenMarketStock}
          onToggleTopMoversVisibility={onToggleTopMoversVisibility}
        />
          </div>
        )}

      <div className={`${hasOperatingFunds ? "space-y-4" : "h-full"}`} data-tour="stock-overview-portfolio">
        {hasOperatingFunds ? (
          <ClassFundRanking funds={operatingFunds} onOpenFundDetail={onOpenFundDetail} />
        ) : null}
        <Card className="h-full overflow-hidden border-none p-5 shadow-md">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-black text-slate-800">
              보유 종목 TOP {visibleTopN}
            </h3>
            <div className="flex items-center gap-1">
              {onOpenPortfolioModal && (
                <Button
                  size="xs"
                  tone="blue"
                  kind="ghost"
                onClick={onOpenPortfolioModal}
                
              >
                  포트폴리오
                </Button>
              )}
              {onOpenTradeAnalysisModal && (
                <IconButton
                  size="sm"
                  tone="slate"
                  icon={BarChart3}
                  label="거래 분석"
                  onClick={onOpenTradeAnalysisModal}
                />
              )}
            </div>
          </div>

          {!hasPortfolio ? (
            <EmptyState
              icon={MinusCircle}
              title="아직 보유 중인 종목이 없습니다"
              description="거래 탭에서 첫 투자를 시작해보세요."
              className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 py-14"
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {topEntries.map((entry) => (
                <div
                  key={entry.symbol}
                  className="flex items-center justify-between gap-4 py-3 first:pt-1 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-slate-800">
                      {entry.symbol}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                      {formatShareQuantity(entry.quantity)}주 보유
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-black tabular-nums text-slate-700">
                      {formatFin(entry.evalAmountUSD)}{" "}
                      <span className="text-[10px] uppercase text-slate-400">
                        FIN
                      </span>
                    </p>
                    <p
                      className={`mt-0.5 text-xs font-bold tabular-nums ${
                        entry.profitLossUSD >= 0
                          ? "text-emerald-500"
                          : "text-rose-500"
                      }`}
                    >
                      {entry.profitLossUSD >= 0 ? "+" : "-"}{" "}
                      {formatPercent(Math.abs(entry.profitRate))}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      </div>
    </div>
  );
}

export default memo(StockOverview);
