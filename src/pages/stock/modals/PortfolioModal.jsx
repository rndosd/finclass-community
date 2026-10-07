import React, { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Clock, Eye, EyeOff, History, PieChart } from "lucide-react";
import {
  Button,
  CardSkeleton,
  EmptyState,
  Modal,
  SurfaceLoader,
} from "../../../components/ui";
import { useStockContext } from "../../../contexts/StockContext";
import { useUser } from "../../../contexts/UserContext";
import useStudentPortfolio from "../../hooks/useStudentPortfolio";
import { getPortfolioProfitStyle as getProfitStyle } from "../utils/portfolioProfitStyle";
import PortfolioTable from "./components/PortfolioTable";
import PortfolioSummaryCards from "./components/PortfolioSummaryCards";

export default function PortfolioModal({
  isOpen,
  onClose,
  uid: propUid,
  studentName,
  title,
  portfolioEntries: propPortfolioEntries,
  summary: propSummary,
  isPortfolioLoading: propIsPortfolioLoading,
  isMyPortfolio: propIsMyPortfolio,
  hideServerValuation = false,
  weightLabel,
  onOpenSellModal,
  onOpenTradeAnalysis,
}) {
  const { userData } = useUser();
  const {
    formatFin,
    formatPercent,
    formatShareQuantity,
    formatStockPrice,
    conversionRate: contextRate,
    currencyUnit,
    portfolioValuation: myValuation,
  } = useStockContext();

  const [showPortfolioLocalCurrency, setShowPortfolioLocalCurrency] =
    useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setShowPortfolioLocalCurrency(true);
  }, [isOpen]);

  const targetUid = propUid || userData?.uid;
  const isMyPortfolio =
    typeof propIsMyPortfolio === "boolean"
      ? propIsMyPortfolio
      : targetUid === userData?.uid;
  const displayName = isMyPortfolio
    ? userData?.name || "내"
    : studentName || "학생";

  const {
    portfolioEntries: studentPortfolioEntries,
    summary: studentSummary,
    loading: isStudentPortfolioLoading,
  } =
    useStudentPortfolio({
      uid: targetUid,
      conversionRate: contextRate,
    });
  const portfolioEntries = propPortfolioEntries ?? studentPortfolioEntries;
  const summary = propSummary ?? studentSummary;
  const isPortfolioLoading =
    propIsPortfolioLoading ?? isStudentPortfolioLoading;


  if (!isOpen) return null;

  const hasPortfolio = portfolioEntries && portfolioEntries.length > 0;
  const hasPortfolioContext =
    hasPortfolio || (!hideServerValuation && Boolean(myValuation));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="max-w-[88vw]"
      title={
        <span className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-3 shadow-lg">
            <PieChart className="h-7 w-7 text-white" />
          </span>
          <span className="min-w-0 break-words">
            {title || (isMyPortfolio
              ? "내 주식 포트폴리오"
              : `${displayName} 주식 포트폴리오`)}
          </span>
        </span>
      }
      subtitle={`${dayjs().format("YYYY년 MM월 DD일")} 기준 보유 현황과 평가 손익을 확인할 수 있습니다.`}
    >
      <div className="space-y-8">
        <div className="flex flex-wrap items-center justify-end gap-3">
          {typeof onOpenTradeAnalysis === "function" ? (
            <Button
              onClick={() =>
                onOpenTradeAnalysis({
                  uid: targetUid,
                  name: displayName,
                })
              }
              tone="slate"
              kind="outline"
              size="sm"
              icon={History}
              
            >
              {"\uAC70\uB798 \uBD84\uC11D"}
            </Button>
          ) : null}

          <Button
            onClick={() => setShowPortfolioLocalCurrency((prev) => !prev)}
            tone={showPortfolioLocalCurrency ? "indigo" : "slate"}
            kind={showPortfolioLocalCurrency ? "soft" : "outline"}
            size="sm"
            className={`max-w-full flex items-center gap-2 transition-all duration-300  ${
              showPortfolioLocalCurrency
                ? "border-transparent ring-2 ring-indigo-100"
                : "border-slate-200 text-slate-400"
            }`}
          >
            {showPortfolioLocalCurrency ? (
              <Eye className="h-4 w-4 shrink-0 text-indigo-600" />
            ) : (
              <EyeOff className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <span
              className={`min-w-0 break-words font-bold ${
                showPortfolioLocalCurrency
                  ? "text-indigo-700"
                  : "text-slate-500"
              }`}
            >
              {showPortfolioLocalCurrency ? currencyUnit : "FIN"} 기준 보기
            </span>
          </Button>
        </div>

        <SurfaceLoader
          loading={isPortfolioLoading}
          variant={hasPortfolioContext ? "refreshing" : "surface-loading"}
          preserveContent={hasPortfolioContext}
          skeleton={<CardSkeleton bare className="h-full min-h-full" rows={6} />}
          minHeightClassName="min-h-[360px]"
        >
          <>
            {hasPortfolio ? (
              <PortfolioSummaryCards
                summary={summary}
                showLocalCurrency={showPortfolioLocalCurrency}
                currencyUnit={currencyUnit}
                getProfitStyle={getProfitStyle}
              />
            ) : null}

            {!hideServerValuation && isMyPortfolio && myValuation ? (
              <div className="flex items-center justify-between rounded-[2rem] border border-white bg-slate-50/80 p-6 shadow-inner backdrop-blur-sm">
                <div className="flex items-center gap-4">
                  <div className="rounded-lg bg-white p-2 shadow-sm">
                    <Clock className="h-5 w-5 text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Server Sync
                    </p>
                    <p className="text-sm font-bold text-slate-600">
                      {myValuation.lastUpdated
                        ? dayjs(myValuation.lastUpdated).format("MM/DD HH:mm")
                        : "기록 없음"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black text-slate-700">
                    {formatFin(myValuation.value || 0)}{" "}
                    <span className="text-xs font-bold uppercase text-slate-400">
                      FIN
                    </span>
                  </p>
                </div>
              </div>
            ) : null}

            <div className="min-h-[280px]">
              {hasPortfolio ? (
                <PortfolioTable
                  entries={portfolioEntries}
                  onOpenSellModal={onOpenSellModal}
                  getProfitStyle={getProfitStyle}
                  formatFin={formatFin}
                  formatPercent={formatPercent}
                  formatShareQuantity={formatShareQuantity}
                  formatStockPrice={formatStockPrice}
                  isMyPortfolio={isMyPortfolio}
                  weightLabel={weightLabel}
                />
              ) : (
                <EmptyState
                  icon={PieChart}
                  title="현재 보유 중인 주식이 없습니다"
                  description="종목을 매수하면 이곳에서 보유 수량과 평가 현황을 볼 수 있습니다."
                  className="rounded-[2.5rem] border-2 border-slate-200 bg-slate-50/50 py-28"
                />
              )}
            </div>
          </>
        </SurfaceLoader>

        <div className="flex justify-center pt-4">
          <Button
            size="lg"
            tone="slate"
            rounded="lg"
            onClick={onClose}
            
          >
            닫기
          </Button>
        </div>
      </div>
    </Modal>
  );
}
