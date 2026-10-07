import React, { useEffect, useState } from "react";
import dayjs from "dayjs";
import { BarChart3, History } from "lucide-react";
import { Button, Modal } from "../../../components/ui";
import { useStockContext } from "../../../contexts/StockContext";
import { useUser } from "../../../contexts/UserContext";
import useStockTradeHistory from "../../../hooks/stock/useStockTradeHistory";
import PortfolioTradeHistory from "./components/PortfolioTradeHistory";
import PortfolioTradeLedger from "./components/PortfolioTradeLedger";

const PERFORMANCE_DEFAULT_PERIOD_DAYS = 30;
const TRADE_LEDGER_DEFAULT_PERIOD_DAYS = null;

const PERIOD_OPTIONS = [
  { id: "7d", label: "최근 7일", value: 7 },
  { id: "30d", label: "최근 30일", value: 30 },
  { id: "90d", label: "최근 90일", value: 90 },
  { id: "all", label: "전체", value: null },
];

export default function TradeAnalysisModal({
  isOpen,
  onClose,
  uid: propUid,
  studentName,
}) {
  const { userData, classId } = useUser();
  const {
    formatFin,
    formatClassCurrency,
    formatWholeNumber,
    conversionRate: contextRate,
    currencyUnit,
  } = useStockContext();

  const [activeTab, setActiveTab] = useState("performance");
  const [showTradeDataLocalCurrency, setShowTradeDataLocalCurrency] =
    useState(false);
  const [isTradeDataFilterOpen, setIsTradeDataFilterOpen] = useState(false);
  const [performancePeriodDays, setPerformancePeriodDays] = useState(
    PERFORMANCE_DEFAULT_PERIOD_DAYS,
  );
  const [tradeLedgerPeriodDays, setTradeLedgerPeriodDays] = useState(
    TRADE_LEDGER_DEFAULT_PERIOD_DAYS,
  );

  useEffect(() => {
    if (!isOpen) return;

    setActiveTab("performance");
    setShowTradeDataLocalCurrency(false);
    setIsTradeDataFilterOpen(false);
    setPerformancePeriodDays(PERFORMANCE_DEFAULT_PERIOD_DAYS);
    setTradeLedgerPeriodDays(TRADE_LEDGER_DEFAULT_PERIOD_DAYS);
  }, [isOpen]);

  const targetUid = propUid || userData?.uid;
  const isMyPortfolio = targetUid === userData?.uid;
  const displayName = isMyPortfolio
    ? userData?.name || "내"
    : studentName || "학생";
  const activeTradePeriodDays =
    activeTab === "trades" ? tradeLedgerPeriodDays : performancePeriodDays;

  const {
    tradeHistory,
    isLoading: isTradeHistoryLoading,
  } = useStockTradeHistory({
    classId,
    uid: isOpen ? targetUid : null,
    enabled: isOpen,
    periodDays: activeTradePeriodDays,
  });

  if (!isOpen) return null;

  const tabs = [
    {
      id: "performance",
      label: "기간 손익",
      icon: BarChart3,
    },
    {
      id: "trades",
      label: "거래내역",
      icon: History,
    },
  ];

  const handleSelectTab = (tabId) => {
    setActiveTab(tabId);
    setIsTradeDataFilterOpen(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="max-w-[88vw]">
      <div className="space-y-8 p-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 p-3 shadow-lg">
              <BarChart3 className="h-7 w-7 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-800">
                {isMyPortfolio
                  ? "내 주식 거래 분석"
                  : `${displayName} 주식 거래 분석`}
              </h2>
              <p className="text-sm font-medium text-slate-400">
                {dayjs().format("YYYY년 MM월 DD일")} 기준 기간 손익과 거래내역을
                확인할 수 있습니다.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1.5 shadow-sm">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <Button
                  key={tab.id}
                  size="md"
                  tone="slate"
                  kind={isActive ? "solid" : "ghost"}
                  rounded="xl"
                  onClick={() => handleSelectTab(tab.id)}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Button>
              );
            })}
          </div>
        </div>

        {activeTab === "performance" ? (
          <PortfolioTradeHistory
            trades={tradeHistory}
            isLoading={isTradeHistoryLoading}
            showLocalCurrency={showTradeDataLocalCurrency}
            currencyUnit={currencyUnit}
            defaultConversionRate={contextRate}
            formatFin={formatFin}
            formatClassCurrency={formatClassCurrency}
            formatWholeNumber={formatWholeNumber}
            onChangeShowLocalCurrency={setShowTradeDataLocalCurrency}
            isFilterOpen={isTradeDataFilterOpen}
            onToggleFilters={() => setIsTradeDataFilterOpen((prev) => !prev)}
            periodOptions={PERIOD_OPTIONS}
            selectedPeriodDays={performancePeriodDays}
            onSelectPeriodDays={setPerformancePeriodDays}
          />
        ) : null}

        {activeTab === "trades" ? (
          <PortfolioTradeLedger
            trades={tradeHistory}
            isLoading={isTradeHistoryLoading}
            showLocalCurrency={showTradeDataLocalCurrency}
            currencyUnit={currencyUnit}
            defaultConversionRate={contextRate}
            formatFin={formatFin}
            formatClassCurrency={formatClassCurrency}
            formatWholeNumber={formatWholeNumber}
            onChangeShowLocalCurrency={setShowTradeDataLocalCurrency}
            isFilterOpen={isTradeDataFilterOpen}
            onToggleFilters={() => setIsTradeDataFilterOpen((prev) => !prev)}
            periodOptions={PERIOD_OPTIONS}
            selectedPeriodDays={tradeLedgerPeriodDays}
            onSelectPeriodDays={setTradeLedgerPeriodDays}
          />
        ) : null}

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
