import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { BarChart3, BookOpen, ClipboardList, Coins, Settings2 } from "lucide-react";

import AppLayout from "../../components/layout/AppLayout";
import {
  Alert,
  ErrorState,
  Button,
  CardSkeleton,
  PageHeader,
  PageLoader,
  SurfaceLoader,
  Tabs,
} from "../../components/ui";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useStockContext } from "../../contexts/StockContext";
import { useUser } from "../../contexts/UserContext";
import { useFundMode } from "../../contexts/FundModeContext";
import { db } from "../../firebase";
import { useStockDividendPolicies } from "../../hooks/stock/useStockDividendPolicies";
import { useStockDividendSummary } from "../../hooks/stock/useStockDividendSummary";
import { useClassFundStockPortfolio } from "../../hooks/stock/useClassFundStockPortfolio";
import { useStockSettings } from "../../hooks/stock/useStockSettings";
import { useClassStudents } from "../../hooks/user/useClassStudents";
import StockMarketDisplay from "./components/StockMarketDisplay";
import StockOverview from "./components/StockOverview";
import { FundStockBalance } from "./components/FundStockOverview";
import { useStockActions } from "./hooks/useStockActions";
import { useStockFilter } from "./hooks/useStockFilter";
import BulkStockEditModal from "./modals/BulkStockEditModal";
import BuyStockModal from "./modals/BuyStockModal";
import ChartModal from "./modals/ChartModal";
import DividendBulkSettingsModal from "./modals/DividendBulkSettingsModal";
import ExchangeModal from "./modals/ExchangeModal";
import MarketSettingsModal from "./modals/MarketSettingsModal";
import StockCategoryManagerModal from "./modals/StockCategoryManagerModal";
import PortfolioModal from "./modals/PortfolioModal";
import SellStockModal from "./modals/SellStockModal";
import StockInfoModal from "./modals/StockInfoModal";
import StockRegistrationModal from "./modals/StockRegistrationModal";
import TradeAnalysisModal from "./modals/TradeAnalysisModal";
import { buildDividendPreviewInfo } from "./utils/dividendPolicyUtils";
import FundsPanel from "../funds/FundsPanel";
import { useFunds } from "../funds/hooks/useFunds";
import { ENABLE_CLASS_FUNDS_ROLLOUT } from "../../config/rolloutFlags";
import { STOCK_VISIBILITY_TEMPLATES } from "../../config/stockCatalog";
import { useChoiceReflections } from "../../features/choiceReflection/useChoiceReflections";
import ChoiceReflectionPanel from "../../features/choiceReflection/ChoiceReflectionPanel";
import ChoiceReflectionHistoryModal from "../../features/choiceReflection/ChoiceReflectionHistoryModal";

const StockPageSkeleton = () => (
  <div className="space-y-6">
    <div className="space-y-3">
      <div className="h-10 w-48 animate-pulse rounded-2xl bg-slate-200/80" />
      <div className="h-5 w-80 max-w-full animate-pulse rounded-xl bg-slate-200/60" />
    </div>

    <div className="flex max-w-full gap-1 overflow-hidden rounded-2xl border border-slate-200 bg-white/80 p-1.5 shadow-sm">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={`stock-tab-skeleton-${index}`}
          className="h-11 flex-1 animate-pulse rounded-xl bg-slate-200/70"
        />
      ))}
    </div>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <CardSkeleton
          key={`stock-summary-skeleton-${index}`}
          rows={3}
          className="min-h-[156px] rounded-[1.75rem] border-0 bg-white shadow-md shadow-slate-200/40"
        />
      ))}
    </div>

    <CardSkeleton
      rows={6}
      className="rounded-[2rem] border-0 bg-white shadow-md shadow-slate-200/40"
    />

    <CardSkeleton
      rows={7}
      showFooter
      className="rounded-[2rem] border-0 bg-white shadow-md shadow-slate-200/40"
    />
  </div>
);

const STOCK_SELL_LOCK_EXEMPT_SYMBOLS = new Set([
  "PLAG",
  "HIVE",
  "HUT",
  "RIOT",
  "MARA",
  "LAZR",
  "AAL",
  "WBD",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

const getTimestampMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const getStockSellRestriction = ({ symbol, stock, minHoldingDays }) => {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const days = Math.max(0, Math.round(Number(minHoldingDays) || 0));
  if (days <= 0 || STOCK_SELL_LOCK_EXEMPT_SYMBOLS.has(normalizedSymbol)) return null;

  const buyAtMs = getTimestampMillis(stock?.lastBuyAt || stock?.createdAt);
  if (!buyAtMs) return null;

  const availableAtMs = buyAtMs + days * DAY_MS;
  const nowMs = Date.now();
  if (nowMs >= availableAtMs) return null;

  return {
    locked: true,
    minHoldingDays: days,
    availableAt: new Date(availableAtMs).toISOString(),
    remainingDays: Math.max(1, Math.ceil((availableAtMs - nowMs) / DAY_MS)),
  };
};

export default function StockPage() {
  const queryClient = useQueryClient();
  const {
    userData,
    classId: contextClassId,
    classData,
    isTeacher,
    loading: userContextLoading,
  } = useUser();
  const { showFeedback } = useFeedback();
  const { activeFund, getChannelAccess, isFundMode } = useFundMode();
  const choiceReflections = useChoiceReflections("stock", isFundMode);
  const stockInvestmentAccess = getChannelAccess("stockInvestment");
  const uid = userData?.uid;
  const currencyUnit = classData?.currencyUnit || "?⑥쐞";

  const {
    pricesFlatMap,
    conversionRate,
    balanceBIL,
    availableBalanceBIL = balanceBIL,
    balanceUSD,
    detailedPortfolio = [],
    isLoading: isContextLoading,
    dataError,
    retryData,
  } = useStockContext();

  const {
    settings,
    updateSettings,
    isSaving: isSavingSettings,
    isLoading: isLoadingSettings,
  } = useStockSettings(contextClassId);
  const { data: dividendSummaryBySymbol = {} } = useStockDividendSummary();
  const { data: dividendPoliciesBySymbol = {} } = useStockDividendPolicies(contextClassId);
  const { funds: classFunds = [] } = useFunds(contextClassId);

  const { buyStock, sellStock, exchangeCurrency, isSubmitting, hasPendingBuy, hasPendingSell, hasPendingExchange } = useStockActions(contextClassId, uid);
  const canManageFundInvestment = ENABLE_CLASS_FUNDS_ROLLOUT && isFundMode;
  const selectedInvestmentFund =
    isFundMode &&
    stockInvestmentAccess.allowed
      ? activeFund
      : null;
  const isFundInvestmentMode =
    isFundMode && canManageFundInvestment && !!selectedInvestmentFund;

  const tradeFeeRate = settings?.tradeFeeRate ?? 0.002;
  const tradeFeeMinUSD = settings?.tradeFeeMinUSD ?? 0;
  const tradeFeeOverrides = useMemo(
    () => settings?.tradeFeeOverrides || {},
    [settings?.tradeFeeOverrides],
  );
  const effectiveTradeFeeRate =
    Number.isFinite(Number(tradeFeeOverrides?.[uid])) &&
    Number(tradeFeeOverrides?.[uid]) >= 0
      ? Number(tradeFeeOverrides?.[uid])
      : tradeFeeRate;
  const exchangeFeeRate = settings?.exchangeFeeRate ?? 0.01;
  const studentAutoExchangeBuyEnabled =
    settings?.studentAutoExchangeBuyEnabled === true;
  const exchangeFeeOverrides = useMemo(
    () => settings?.exchangeFeeOverrides || {},
    [settings?.exchangeFeeOverrides],
  );
  const effectiveExchangeFeeRate =
    Number.isFinite(Number(exchangeFeeOverrides?.[uid])) &&
    Number(exchangeFeeOverrides?.[uid]) >= 0
      ? Number(exchangeFeeOverrides?.[uid])
      : exchangeFeeRate;
  const hiddenStocks = useMemo(() => settings?.hiddenStocks || {}, [settings?.hiddenStocks]);
  const stockMinHoldingDays = settings?.stockMinHoldingDays ?? 0;
  const selectedFundCashBalance = Number(selectedInvestmentFund?.cashBalance || 0);
  const selectedFundBuyingPowerUSD =
    selectedFundCashBalance *
    (Number(conversionRate) || 0) *
    Math.max(0, 1 - exchangeFeeRate);
  const {
    portfolioEntries: fundPortfolioEntries = [],
    summary: fundPortfolioSummary,
    isLoading: isLoadingFundPortfolio,
  } = useClassFundStockPortfolio(contextClassId, selectedInvestmentFund?.id || "", {
    enabled: isFundInvestmentMode,
    pricesFlatMap,
    conversionRate,
  });
  const {
    filteredStocks: baseFilteredStocks,
    allStockSymbols,
    categoryOptions,
    allStocksByCategory,
    activeCategory,
    setActiveCategory,
    searchTerm,
    setSearchTerm,
    categoryNames,
    privilegedSymbols,
    classCategoryDefinitions,
    isLoading: isFilterLoading,
    isSearchMode,
  } = useStockFilter(contextClassId);

  const fundPortfolioDisplayEntries = useMemo(() => {
    const names = new Map(
      allStockSymbols.map((stock) => [stock.symbol, stock.companyName]),
    );
    return fundPortfolioEntries.map((entry) => ({
      ...entry,
      companyName:
        names.get(entry.symbol) || entry.companyName || entry.symbol,
      avgPriceUSD:
        entry.averagePriceUSD ??
        (entry.quantity > 0
          ? entry.totalInvestmentUSD / entry.quantity
          : 0),
      currentPriceUSD:
        entry.currentPriceUSD > 0 ? entry.currentPriceUSD : null,
    }));
  }, [allStockSymbols, fundPortfolioEntries]);

  const mergedDividendInfoBySymbol = useMemo(() => {
    const merged = { ...dividendSummaryBySymbol };

    Object.entries(dividendPoliciesBySymbol).forEach(([symbol, policy]) => {
      if (policy?.dividendEnabled === false) {
        merged[symbol] = null;
        return;
      }

      merged[symbol] = buildDividendPreviewInfo(policy, dividendSummaryBySymbol[symbol] || null);
    });

    return merged;
  }, [dividendPoliciesBySymbol, dividendSummaryBySymbol]);

  const filteredStocks = useMemo(
    () =>
      (baseFilteredStocks || []).map((stock) => ({
        ...stock,
        dividendInfo: mergedDividendInfoBySymbol[stock.symbol] || null,
      })),
    [baseFilteredStocks, mergedDividendInfoBySymbol],
  );

  const [tab, setTab] = useState("overview");
  const [fundDetailTarget, setFundDetailTarget] = useState(null);
  const [showPortfolioModal, setShowPortfolioModal] = useState(false);
  const [showTradeAnalysisModal, setShowTradeAnalysisModal] = useState(false);
  const [showExchangeModal, setShowExchangeModal] = useState(false);
  const [showMarketSettingsModal, setShowMarketSettingsModal] = useState(false);
  const [showCategoryManagerModal, setShowCategoryManagerModal] = useState(false);
  const [categoryManagerInitialId, setCategoryManagerInitialId] = useState("");
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [showDividendPolicyModal, setShowDividendPolicyModal] = useState(false);

  const openStockRegistration = useCallback(() => {
    setShowBulkEditModal(false);
    setShowRegistrationModal(true);
  }, []);
  const closeStockRegistration = useCallback(() => {
    setShowRegistrationModal(false);
    setShowBulkEditModal(true);
  }, []);
  const handleStockRegistered = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stock", "categories"] }),
      queryClient.invalidateQueries({ queryKey: ["stock", "quotes"] }),
    ]);
  }, [queryClient]);

  useEffect(() => {
    setTab("overview");
    setFundDetailTarget(null);
    setShowPortfolioModal(false);
    setShowTradeAnalysisModal(false);
    setShowExchangeModal(false);
  }, [activeFund?.id, isFundMode]);

  const handleOpenFundDetail = useCallback((fund) => {
    if (!fund?.id) return;
    setFundDetailTarget(fund);
  }, []);
  const openCategoryManager = useCallback((category = null) => {
    setCategoryManagerInitialId(category?.id || "");
    setShowCategoryManagerModal(true);
  }, []);
  const closeCategoryManager = useCallback(() => {
    setShowCategoryManagerModal(false);
    setCategoryManagerInitialId("");
  }, []);
  const handleReorderStockCategories = useCallback(
    async (orderedCategories = []) => {
      if (!isTeacher || !contextClassId || orderedCategories.length === 0) return;
      const batch = writeBatch(db);
      orderedCategories.forEach((category, index) => {
        if (!category?.id) return;
        batch.update(
          doc(db, "classes", contextClassId, "stockCategories", category.id),
          { order: index, updatedAt: serverTimestamp() },
        );
      });
      try {
        await batch.commit();
        // Category order is delivered by the existing class listener.
        showFeedback("주식 카테고리 순서를 저장했습니다.", "success");
      } catch (error) {
        console.error("[StockPage] Failed to reorder stock categories:", error);
        showFeedback("카테고리 순서 저장에 실패했습니다.", "error");
      }
    },
    [contextClassId, isTeacher, showFeedback],
  );
  const handleOpenMarketStock = useCallback(
    (stock) => {
      if (stock?.categoryId) {
        setSearchTerm("");
        setActiveCategory(stock.categoryId);
        setTab("market");
        requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
        return;
      }
      const symbol = String(stock?.symbol || "").trim().toUpperCase();
      if (!symbol) return;

      const matchedCategory = Object.entries(allStocksByCategory || {}).find(
        ([categoryId, stocks]) =>
          categoryId !== "indices" &&
          Array.isArray(stocks) &&
          stocks.some(
            (item) =>
              String(item?.ticker || "").trim().toUpperCase() === symbol,
          ),
      )?.[0];

      setSearchTerm("");
      setActiveCategory(matchedCategory || "all");
      setTab("market");
      requestAnimationFrame(() =>
        window.scrollTo({ top: 0, behavior: "smooth" }),
      );
    },
    [allStocksByCategory, setActiveCategory, setSearchTerm],
  );



  const { data: marketSettingsStudents = [] } = useClassStudents(contextClassId, {
    enabled: !!contextClassId && isTeacher && showMarketSettingsModal,
  });
  const marketSettingsCurrentSettings = useMemo(
    () => ({
      conversionRate: settings?.conversionRate ?? conversionRate,
      tradeFeeRate,
      tradeFeeMinUSD,
      tradeFeeOverrides,
      exchangeFeeRate,
      exchangeFeeOverrides,
      studentAutoExchangeBuyEnabled,
      stockMinHoldingDays,
      currencyUnit,
    }),
    [
      conversionRate,
      currencyUnit,
      exchangeFeeRate,
      exchangeFeeOverrides,
      studentAutoExchangeBuyEnabled,
      settings?.conversionRate,
      stockMinHoldingDays,
      tradeFeeMinUSD,
      tradeFeeOverrides,
      tradeFeeRate,
    ],
  );

  const [chartModal, setChartModal] = useState({ show: false, symbol: null, timeframe: "1W" });
  const [stockInfoModal, setStockInfoModal] = useState({
    show: false,
    symbol: null,
    companyName: null,
    isIndex: false,
  });
  const [buyModalInfo, setBuyModalInfo] = useState({
    show: false,
    symbol: null,
    companyName: null,
    currentPriceUSD: 0,
    dividendInfo: null,
  });
  const [sellModalInfo, setSellModalInfo] = useState({
    show: false,
    symbol: null,
    quantityOwned: 0,
    currentPriceUSD: 0,
    sellRestriction: null,
  });

  const openBuyModal = useCallback(
    (data, companyName) => {
      if (isFundMode && !isFundInvestmentMode) {
        showFeedback(
          canManageFundInvestment
            ? stockInvestmentAccess.reason
            : "주식 기금 운용 권한이 없습니다.",
          "warning",
        );
        return;
      }
      const symbol = (typeof data === "object" ? data.symbol : data)?.toUpperCase();
      const name = typeof data === "object" ? data.companyName : companyName || symbol;
      const price = pricesFlatMap[symbol] || 0;

      if (price <= 0) {
        showFeedback(`${symbol}의 실시간 시세 정보를 찾지 못했습니다.`, "warning");
        return;
      }

      setBuyModalInfo({
        show: true,
        symbol,
        companyName: name,
        currentPriceUSD: price,
        dividendInfo: isFundInvestmentMode
          ? null
          : mergedDividendInfoBySymbol[symbol] || null,
        classFundId: isFundInvestmentMode ? selectedInvestmentFund?.id || "" : "",
        fundName: isFundInvestmentMode ? selectedInvestmentFund?.name || "" : "",
      });
    },
    [
      isFundInvestmentMode,
      isFundMode,
      canManageFundInvestment,
      mergedDividendInfoBySymbol,
      pricesFlatMap,
      selectedInvestmentFund,
      showFeedback,
      stockInvestmentAccess.reason,
    ],
  );

  const openSellModal = useCallback(
    (data, companyName, quantityOwned) => {
      if (isFundMode && !isFundInvestmentMode) {
        showFeedback(
          canManageFundInvestment
            ? stockInvestmentAccess.reason
            : "주식 기금 운용 권한이 없습니다.",
          "warning",
        );
        return;
      }
      const symbol = (typeof data === "object" ? data.symbol : data)?.toUpperCase();
      const name = typeof data === "object" ? data.companyName : companyName || symbol;
      const quantity = typeof data === "object" ? data.quantity : quantityOwned;
      const sellRestriction = getStockSellRestriction({
        symbol,
        stock: typeof data === "object" ? data : null,
        minHoldingDays: stockMinHoldingDays,
      });
      const price = pricesFlatMap[symbol] || 0;

      if (price <= 0) {
        showFeedback(`${symbol}의 실시간 시세 정보를 찾지 못했습니다.`, "warning");
        return;
      }

      setSellModalInfo({
        show: true,
        symbol,
        companyName: name,
        quantityOwned: quantity,
        currentPriceUSD: price,
        sellRestriction,
        classFundId: isFundInvestmentMode ? selectedInvestmentFund?.id || "" : "",
        fundName: isFundInvestmentMode ? selectedInvestmentFund?.name || "" : "",
      });
    },
    [
      isFundInvestmentMode,
      isFundMode,
      canManageFundInvestment,
      pricesFlatMap,
      selectedInvestmentFund,
      showFeedback,
      stockInvestmentAccess.reason,
      stockMinHoldingDays,
    ],
  );

  const openStockInfoModal = useCallback((stock) => {
    if (!stock) return;

    if (typeof stock === "string") {
      setStockInfoModal({
        show: true,
        symbol: stock,
        companyName: stock,
        isIndex: false,
      });
      return;
    }

    setStockInfoModal({
      show: true,
      symbol: stock.symbol || null,
      companyName: stock.companyName || stock.symbol || null,
      isIndex: !!stock.isIndex,
    });
  }, []);

  const handleExecuteBuyOrder = async (quantity) => {
    const result = await buyStock({
      symbol: buyModalInfo.symbol,
      priceUSD: buyModalInfo.currentPriceUSD,
      quantity,
      classFundId: buyModalInfo.classFundId || "",
    });

    if (result.success) {
      setBuyModalInfo((prev) => ({ ...prev, show: false }));
      if (!buyModalInfo.classFundId) choiceReflections.recordCompletedChoice({
        sourceType: "stock_buy", sourceId: result.data?.tradeId,
        label: `${buyModalInfo.companyName || buyModalInfo.symbol} ${quantity}주`,
      });
    }

    return result;
  };

  const handleExecuteSellOrder = async (quantityToSell) => {
    const result = await sellStock({
      symbol: sellModalInfo.symbol,
      priceUSD: sellModalInfo.currentPriceUSD,
      quantity: quantityToSell,
      classFundId: sellModalInfo.classFundId || "",
    });

    if (result.success) {
      setSellModalInfo((prev) => ({ ...prev, show: false }));
      if (!sellModalInfo.classFundId) choiceReflections.recordCompletedChoice({
        sourceType: "stock_sell", sourceId: result.data?.tradeId,
        label: `${sellModalInfo.companyName || sellModalInfo.symbol} ${quantityToSell}주`,
      });
    }

    return result;
  };

  const handleExecuteExchange = async (params) => {
    const result = await exchangeCurrency(params);
    if (result.success) {
      setShowExchangeModal(false);
    }
    return result;
  };

  const handleToggleStockVisibility = useCallback(
    async (symbol, shouldHide) => {
      if (!isTeacher || !contextClassId || !symbol) return;

      const normalizedSymbol = String(symbol).trim().toUpperCase();
      const nextHiddenStocks = { ...hiddenStocks };

      if (shouldHide) {
        nextHiddenStocks[normalizedSymbol] = true;
      } else {
        delete nextHiddenStocks[normalizedSymbol];
      }

      try {
        await updateSettings({ hiddenStocks: nextHiddenStocks });
        showFeedback(
          shouldHide
            ? `${normalizedSymbol} 종목을 학생 화면에서 숨겼습니다.`
            : `${normalizedSymbol} 종목을 다시 학생 화면에 표시했습니다.`,
          "success",
        );
      } catch (error) {
        console.error("[StockPage] Failed to update stock visibility:", error);
        showFeedback("종목 표시 설정 저장에 실패했습니다.", "error");
      }
    },
    [contextClassId, hiddenStocks, isTeacher, showFeedback, updateSettings],
  );

  const handleBulkToggleStockVisibility = useCallback(
    async (symbols, shouldHide) => {
      if (!isTeacher || !contextClassId || !Array.isArray(symbols) || symbols.length === 0) return;

      const normalizedSymbols = Array.from(
        new Set(
          symbols
            .map((symbol) => String(symbol || "").trim().toUpperCase())
            .filter(Boolean),
        ),
      );

      if (normalizedSymbols.length === 0) return;

      const nextHiddenStocks = { ...hiddenStocks };

      normalizedSymbols.forEach((symbol) => {
        if (shouldHide) {
          nextHiddenStocks[symbol] = true;
        } else {
          delete nextHiddenStocks[symbol];
        }
      });

      try {
        await updateSettings({ hiddenStocks: nextHiddenStocks });
        showFeedback(
          shouldHide
            ? `${normalizedSymbols.length}개 종목을 학생 화면에서 숨겼습니다.`
            : `${normalizedSymbols.length}개 종목을 다시 학생 화면에 표시했습니다.`,
          "success",
        );
      } catch (error) {
        console.error("[StockPage] Failed to bulk update stock visibility:", error);
        showFeedback("종목 표시 설정 저장에 실패했습니다.", "error");
      }
    },
    [contextClassId, hiddenStocks, isTeacher, showFeedback, updateSettings],
  );

  const handleApplyStockVisibilityTemplate = useCallback(
    async (template) => {
      if (!isTeacher || !contextClassId || !template) return;

      const registeredSymbols = Array.from(
        new Set(
          allStockSymbols
            .map((stock) => String(stock?.symbol || "").trim().toUpperCase())
            .filter(Boolean),
        ),
      );
      const templateSymbols = new Set(
        (template.symbols || [])
          .map((symbol) => String(symbol || "").trim().toUpperCase())
          .filter(Boolean),
      );
      const visibleRegisteredSymbols = registeredSymbols.filter((symbol) => templateSymbols.has(symbol));

      if (registeredSymbols.length === 0 || visibleRegisteredSymbols.length === 0) {
        showFeedback("현재 등록된 종목 중 이 템플릿에 적용할 종목을 찾지 못했습니다.", "warning");
        return;
      }

      const nextHiddenStocks = { ...hiddenStocks };

      registeredSymbols.forEach((symbol) => {
        if (templateSymbols.has(symbol)) {
          delete nextHiddenStocks[symbol];
        } else {
          nextHiddenStocks[symbol] = true;
        }
      });

      try {
        await updateSettings({ hiddenStocks: nextHiddenStocks });
        showFeedback(
          `${template.name} 템플릿을 적용했습니다. ${visibleRegisteredSymbols.length}개 종목을 학생 화면에 표시합니다.`,
          "success",
        );
      } catch (error) {
        console.error("[StockPage] Failed to apply stock visibility template:", error);
        showFeedback("종목 공개 템플릿 적용에 실패했습니다.", "error");
      }
    },
    [allStockSymbols, contextClassId, hiddenStocks, isTeacher, showFeedback, updateSettings],
  );

  const hasStockSeedData =
    allStockSymbols.length > 0 || filteredStocks.length > 0;
  const isInitialLoading =
    (userContextLoading ||
      isContextLoading ||
      isLoadingSettings ||
      isFilterLoading) &&
    !hasStockSeedData;
  const isOverviewRefreshing =
    !isInitialLoading &&
    tab === "overview" &&
    (userContextLoading || isContextLoading || isLoadingSettings || isFilterLoading);
  const stockQuestGuide = useMemo(() => {
    if (!isTeacher) return null;

    const hiddenStockCount = Object.values(hiddenStocks || {}).filter(Boolean).length;
    const visibleStockCount = Math.max(0, allStockSymbols.length - hiddenStockCount);
    const hasPortfolio = detailedPortfolio.length > 0;
    const hasCustomMarketPolicy =
      Number(tradeFeeRate) !== 0.002 ||
      Number(exchangeFeeRate) !== 0.01 ||
      Number(tradeFeeMinUSD) > 0 ||
      Number(stockMinHoldingDays) > 0;
    const hasDividendPolicy = Object.values(dividendPoliciesBySymbol || {}).some(
      (policy) => policy?.dividendEnabled !== false,
    );

    return {
      type: "quest",
      title: "주식 도우미",
      launcherTitle: "주식 도우미",
      launcherDescription: "종목 공개, 시장 설정, 거래 흐름, 포트폴리오를 체크합니다.",
      subtitle: "학생들이 투자하고 결과를 확인하는 기본 주식 시장 구조를 점검합니다.",
      storageKey: contextClassId
        ? `finclass_stock_quest_${contextClassId}`
        : "finclass_stock_quest",
      tourKey: "TEACHER_STOCK_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "stock-overview",
          title: "투자 현황 둘러보기",
          description: "자산 요약, 시장 변동, 보유 종목 영역을 먼저 확인합니다.",
          completed: tab === "overview",
          manualComplete: true,
          objectives: [
            {
              id: "overview-open",
              label: "투자 현황 탭 열기",
              completed: tab === "overview",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="stock-overview-summary"]',
              title: "자산 요약",
              content: "FIN 잔액, 달러 잔액, 수익률, 평가액을 확인합니다.",
            },
            {
              target: '[data-tour="stock-overview-portfolio"]',
              title: "보유 종목",
              content: "학생의 보유 종목과 평가 손익을 확인합니다.",
            },
          ],
        },
        {
          id: "stock-list-ready",
          title: "거래 가능한 종목 확인하기",
          description: "학생에게 보여줄 주식 종목이 준비되어 있는지 확인합니다.",
          doneText: `${visibleStockCount}개의 종목이 공개되어 있습니다.`,
          completed: visibleStockCount > 0,
          manualComplete: false,
          objectives: [
            {
              id: "visible-stock-count",
              label: "공개 종목 1개 이상 준비",
              completed: visibleStockCount > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="stock-tabs"]',
              title: "주식 거래 탭",
              content: "주식 거래 탭에서 학생이 볼 수 있는 종목 목록을 확인합니다.",
            },
            {
              target: '[data-tour="stock-market-grid"]',
              title: "종목 카드",
              content: "종목 카드에서 가격, 차트, 매수 흐름을 확인합니다.",
            },
          ],
        },
        {
          id: "market-settings",
          title: "시장 설정 확인하기",
          description: "환율, 수수료, 최소 보유일 같은 거래 조건을 확인합니다.",
          completed: Boolean(settings),
          manualComplete: true,
          objectives: [
            {
              id: "settings-ready",
              label: "시장 설정 데이터 확인",
              completed: Boolean(settings),
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="stock-actions"]',
              title: "시장 설정",
              content: "상단 관리 버튼에서 환율, 수수료, 보유 제한을 조정합니다.",
            },
            {
              target: '[data-tour="stock-market-settings-action"]',
              title: "시장 설정 열기",
              content: "시장 설정 버튼을 누르면 환율, 거래 수수료, 최소 보유일을 조정하는 모달이 열립니다.",
              waitForTarget: '[data-tour="stock-market-settings-modal"]',
            },
            {
              target: '[data-tour="stock-market-settings-modal"]',
              title: "시장 설정 모달",
              content: "거래 조건과 학생별 환전·거래 보정을 확인하고 저장합니다.",
            },
          ],
        },
        {
          id: "student-trade-flow",
          title: "학생 거래 흐름 확인하기",
          description: "학생이 종목을 검색하고, 차트를 보고, 매수하는 흐름을 확인합니다.",
          completed: tab === "market" || hasPortfolio,
          manualComplete: true,
          objectives: [
            {
              id: "market-open",
              label: "주식 거래 탭 열기",
              completed: tab === "market",
            },
            {
              id: "portfolio-created",
              label: "보유 종목 또는 거래 흐름 확인",
              completed: hasPortfolio,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="stock-market-filters"]',
              title: "검색과 필터",
              content: "검색, 카테고리, 종목 그룹 필터로 거래 대상을 좁힙니다.",
            },
            {
              target: '[data-tour="stock-market-grid"]',
              title: "매수 흐름",
              content: "종목 카드에서 정보 확인, 차트, 매수로 이어지는 흐름을 확인합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "funds-flow",
          title: "학생 펀드 탭 살펴보기",
          description: "주식과 별도로 학생 펀드를 운영할 수 있는 탭을 확인합니다.",
          completed: tab === "funds",
          manualComplete: true,
          objectives: [
            {
              id: "funds-open",
              label: "학생 펀드 탭 열기",
              completed: tab === "funds",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="stock-tabs"]',
              title: "학생 펀드",
              content: "주식 탭 옆의 학생 펀드 탭에서 펀드형 활동을 확인합니다.",
            },
          ],
        },
        {
          id: "dividend-policy",
          title: "배당 설정 살펴보기",
          description: "종목별 배당을 켜면 장기 보유의 의미를 수업에 연결할 수 있습니다.",
          completed: hasDividendPolicy || showDividendPolicyModal,
          manualComplete: true,
          objectives: [
            {
              id: "dividend-open",
              label: "배당 설정 열기",
              completed: showDividendPolicyModal,
            },
            {
              id: "dividend-policy-ready",
              label: "배당 정책 확인",
              completed: hasDividendPolicy,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="stock-actions"]',
              title: "배당 설정",
              content: "상단 배당 설정에서 종목별 배당 정책을 관리합니다.",
            },
            {
              target: '[data-tour="stock-dividend-settings-action"]',
              title: "배당 설정 열기",
              content: "배당 설정 버튼을 누르면 종목별 배당 적용 여부와 지급 기준을 조정하는 모달이 열립니다.",
              waitForTarget: '[data-tour="stock-dividend-settings-modal"]',
            },
            {
              target: '[data-tour="stock-dividend-settings-modal"]',
              title: "배당 일괄 설정",
              content: "실제 배당 사용, 학급 배당 사용, 배당 미적용을 종목별로 조정합니다.",
            },
          ],
        },
        {
          id: "visibility-template",
          title: "종목 공개 범위 조정하기",
          description: "처음 수업, 안정 운영, 관심 테마처럼 공개 종목 묶음을 조정할 수 있습니다.",
          completed: hiddenStockCount > 0 || showBulkEditModal,
          manualComplete: true,
          objectives: [
            {
              id: "visibility-open",
              label: "주식 정보 관리 열기",
              completed: showBulkEditModal,
            },
            {
              id: "hidden-stock-count",
              label: "비공개 종목 여부 확인",
              completed: hiddenStockCount > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="stock-actions"]',
              title: "주식 정보",
              content: "상단 주식 정보에서 학생에게 공개할 종목을 조정합니다.",
            },
            {
              target: '[data-tour="stock-bulk-edit-action"]',
              title: "주식 정보 열기",
              content: "주식 정보 버튼을 누르면 종목 공개 여부와 설명을 일괄 편집하는 모달이 열립니다.",
              waitForTarget: '[data-tour="stock-bulk-edit-modal"]',
            },
            {
              target: '[data-tour="stock-bulk-edit-modal"]',
              title: "주식 정보 일괄 편집",
              content: "학생에게 공개할 종목, 종목명, 설명, 공개 상태를 확인합니다.",
            },
          ],
        },
        {
          id: "custom-market-policy",
          title: "거래 조건 세밀하게 조정하기",
          description: "수수료, 환전 수수료, 최소 보유일을 조정해 투자 행동을 다르게 설계할 수 있습니다.",
          completed: hasCustomMarketPolicy || showMarketSettingsModal,
          manualComplete: true,
          objectives: [
            {
              id: "market-settings-open",
              label: "시장 설정 열기",
              completed: showMarketSettingsModal,
            },
            {
              id: "custom-market-policy-ready",
              label: "기본값과 다른 거래 조건 확인",
              completed: hasCustomMarketPolicy,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="stock-actions"]',
              title: "시장 설정",
              content: "시장 설정에서 환율, 수수료, 보유 제한을 조정합니다.",
            },
            {
              target: '[data-tour="stock-market-settings-action"]',
              title: "시장 설정 열기",
              content: "시장 설정 버튼을 눌러 학급 주식 시장의 거래 조건을 확인합니다.",
              waitForTarget: '[data-tour="stock-market-settings-modal"]',
            },
            {
              target: '[data-tour="stock-market-settings-modal"]',
              title: "거래 조건 설정",
              content: "수수료, 환전 수수료, 최소 보유일을 조정해 투자 행동을 설계합니다.",
            },
          ],
        },
        {
          id: "trade-analysis",
          title: "거래 분석 열어보기",
          description: "거래가 쌓이면 분석 화면에서 학생 투자 흐름을 돌아볼 수 있습니다.",
          completed: showTradeAnalysisModal,
          manualComplete: true,
          objectives: [
            {
              id: "analysis-open",
              label: "거래 분석 열기",
              completed: showTradeAnalysisModal,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="stock-overview-summary"]',
              title: "투자 현황",
              content: "투자 현황 화면에서 포트폴리오와 거래 분석 흐름으로 이어집니다.",
            },
          ],
        },
      ],
    };
  }, [
    allStockSymbols.length,
    contextClassId,
    detailedPortfolio.length,
    dividendPoliciesBySymbol,
    exchangeFeeRate,
    hiddenStocks,
    isTeacher,
    settings,
    showBulkEditModal,
    showDividendPolicyModal,
    showMarketSettingsModal,
    showTradeAnalysisModal,
    stockMinHoldingDays,
    tab,
    tradeFeeMinUSD,
    tradeFeeRate,
  ]);

  if (dataError) {
    return (
      <AppLayout showDefaultHeader={false}>
        <ErrorState title="주식 정보를 불러오지 못했습니다." onRetry={retryData} />
      </AppLayout>
    );
  }

  if (isInitialLoading) {
    return (
      <AppLayout showDefaultHeader={false}>
        <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
          <StockPageSkeleton />
        </div>
      </AppLayout>
    );
  }

  if (false && isInitialLoading) {
    return <PageLoader message="주식 정보 불러오는 중…" />;
  }

  if (!uid) {
    return (
      <div className="p-4">
        <Alert type="warning" message="로그인이 필요합니다." />
      </div>
    );
  }

  if (!contextClassId) {
    return (
      <div className="p-4">
        <Alert type="warning" message="학급 정보를 찾을 수 없습니다." />
      </div>
    );
  }

  return (
    <AppLayout showDefaultHeader={false} pageGuide={stockQuestGuide}>
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <PageHeader
          title="주식 센터"
          subtitle={
            isFundMode
              ? `${activeFund?.name || "선택한 기금"}의 주식 자산을 운용합니다.`
              : "투자 현황과 종목 거래를 확인하고 관리합니다."
          }
          icon={BarChart3}
          actions={
            <>
            {choiceReflections.enabled && <Button size="sm" kind="outline" tone="blue" icon={BookOpen}
              onClick={choiceReflections.openHistory}>내 선택 기록</Button>}
            {!isFundMode && isTeacher && tab !== "funds" ? (
              <div data-tour="stock-actions" className="flex flex-wrap gap-2">
                <Button
                  tone="slate"
                  kind="outline"
                  size="sm"
                  onClick={() => setShowBulkEditModal(true)}
                  icon={ClipboardList}
                  data-tour="stock-bulk-edit-action"
                  data-tutorial-interactive="true"
                >
                  주식 정보
                </Button>
                <Button
                  tone="slate"
                  kind="outline"
                  size="sm"
                  onClick={() => setShowDividendPolicyModal(true)}
                  icon={Coins}
                  data-tour="stock-dividend-settings-action"
                  data-tutorial-interactive="true"
                >
                  배당 설정
                </Button>
                <Button
                  tone="slate"
                  kind="soft"
                  size="sm"
                  onClick={() => setShowMarketSettingsModal(true)}
                  icon={Settings2}
                  data-tour="stock-market-settings-action"
                  data-tutorial-interactive="true"
                >
                  시장 설정
                </Button>
              </div>
            ) : null}
            </>
          }
        />

        <ChoiceReflectionPanel controller={choiceReflections} />

        <div className="space-y-4">
          <div data-tour="stock-tabs" data-active-tab={tab} className="flex justify-start">
            <Tabs
              variant="underline"
              size="md"
              activeTab={tab}
              onTabChange={setTab}
              idPrefix="stock-page"
              tabs={
                isFundMode
                  ? [
                      { id: "overview", label: "투자 현황" },
                      { id: "market", label: "주식 거래" },
                    ]
                  : [
                      { id: "overview", label: "투자 현황" },
                      { id: "market", label: "주식 거래" },
                      { id: "funds", label: "학생 펀드" },
                    ]
              }
              className="max-w-full"
            />
          </div>

          <div className="relative">
          <div
            data-tour="stock-content"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[260px]"
          />
          {isFundMode && !isFundInvestmentMode ? (
            <Alert
              type="warning"
              message={canManageFundInvestment ? stockInvestmentAccess.reason : "주식 기금 운용 권한이 없습니다."}
            />
          ) : tab === "overview" && isFundInvestmentMode ? (
            <StockOverview
              key={selectedInvestmentFund.id}
              accountOverride={{
                balanceUSD: selectedFundBuyingPowerUSD,
                balanceBIL: selectedFundCashBalance,
                localBalanceLabel: "기금 현금",
                hideFinBalance: true,
                portfolioEntries: fundPortfolioDisplayEntries,
                summary: fundPortfolioSummary,
                isLoading: isLoadingFundPortfolio,
              }}
              onOpenPortfolioModal={() => setShowPortfolioModal(true)}
              onOpenMarketStock={handleOpenMarketStock}
              allStocksByCategory={allStocksByCategory}
              hiddenStocks={hiddenStocks}
              privilegedSymbols={privilegedSymbols}
              showTopMovers={isTeacher || !settings?.isTopMoversHidden}
              allStockSymbols={allStockSymbols}
              isLoadingData={isFilterLoading}
            />
          ) : tab === "overview" ? (
            <SurfaceLoader
              loading={isOverviewRefreshing}
              variant="refreshing"
              message="주식 요약을 업데이트하는 중입니다..."
            >
              <StockOverview
                onOpenExchangeModal={() => setShowExchangeModal(true)}
                onOpenPortfolioModal={() => setShowPortfolioModal(true)}
                onOpenTradeAnalysisModal={() => setShowTradeAnalysisModal(true)}
                onOpenFundDetail={handleOpenFundDetail}
                onOpenMarketStock={handleOpenMarketStock}
                allStocksByCategory={allStocksByCategory}
                hiddenStocks={hiddenStocks}
                privilegedSymbols={privilegedSymbols}
                showTopMovers={isTeacher || !settings?.isTopMoversHidden}
                allStockSymbols={allStockSymbols}
                isLoadingData={isFilterLoading}
                classFunds={classFunds}
              />
            </SurfaceLoader>
          ) : tab === "market" ? (
            <div className="space-y-4">
              {isFundInvestmentMode ? (
                <FundStockBalance
                  fundName={selectedInvestmentFund.name}
                  cashBalance={selectedFundCashBalance}
                  buyingPowerUSD={selectedFundBuyingPowerUSD}
                />
              ) : null}

              <StockMarketDisplay
                categoryOptions={categoryOptions}
                classCategoryDefinitions={classCategoryDefinitions}
                currentCategory={activeCategory}
                onSelectCategory={setActiveCategory}
                onOpenCategoryManager={() => openCategoryManager()}
                onEditCategory={openCategoryManager}
                onReorderCategories={handleReorderStockCategories}
                allStocksByCategory={allStocksByCategory}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                stocksToDisplay={filteredStocks}
                isLoadingData={isFilterLoading}
                onOpenBuyModal={openBuyModal}
                tradeDisabled={isFundMode && !isFundInvestmentMode}
                onOpenChartModal={(symbol) => setChartModal({ show: true, symbol, timeframe: "1W" })}
                onOpenStockInfoModal={openStockInfoModal}
                currencyUnit={currencyUnit}
                hiddenStocks={hiddenStocks}
                privilegedSymbols={privilegedSymbols}
                onToggleStockVisibility={handleToggleStockVisibility}
                onBulkToggleStockVisibility={handleBulkToggleStockVisibility}
                visibilityTemplates={STOCK_VISIBILITY_TEMPLATES}
                onApplyVisibilityTemplate={handleApplyStockVisibilityTemplate}
                isSavingVisibility={isSavingSettings}
                showTopMovers={!isSearchMode && activeCategory === categoryNames[0]}
              />
            </div>
          ) : (
            <FundsPanel onOpenStockInfoModal={openStockInfoModal} />
          )}
        </div>

        {fundDetailTarget ? (
          <FundsPanel
            detailOnly
            initialDetailTarget={fundDetailTarget}
            onInitialDetailTargetClose={() => setFundDetailTarget(null)}
            onOpenStockInfoModal={openStockInfoModal}
          />
        ) : null}
      </div>
      </div>

      {choiceReflections.enabled && <ChoiceReflectionHistoryModal key={`${contextClassId}:${uid}`}
        controller={choiceReflections} />}
      {showPortfolioModal && (
        <PortfolioModal
          isOpen={showPortfolioModal}
          onClose={() => setShowPortfolioModal(false)}
          onOpenSellModal={openSellModal}
          {...(isFundInvestmentMode
            ? {
                title: `${selectedInvestmentFund?.name || "선택한 기금"} 주식 포트폴리오`,
                portfolioEntries: fundPortfolioDisplayEntries,
                summary: fundPortfolioSummary,
                isPortfolioLoading: isLoadingFundPortfolio,
                isMyPortfolio: true,
                hideServerValuation: true,
                weightLabel: "기금 평가액의",
              }
            : {})}
        />
      )}

      {showTradeAnalysisModal && (
        <TradeAnalysisModal
          isOpen={showTradeAnalysisModal}
          onClose={() => setShowTradeAnalysisModal(false)}
        />
      )}

      {buyModalInfo.show && (
        <BuyStockModal
          isOpen={buyModalInfo.show}
          onClose={() => setBuyModalInfo((prev) => ({ ...prev, show: false }))}
          {...buyModalInfo}
          balanceUSD={buyModalInfo.classFundId ? selectedFundBuyingPowerUSD : balanceUSD}
          tradeFeeRate={
            buyModalInfo.classFundId ? tradeFeeRate : effectiveTradeFeeRate
          }
          tradeFeeMinUSD={tradeFeeMinUSD}
          localBalance={
            buyModalInfo.classFundId ? selectedFundCashBalance : availableBalanceBIL
          }
          localCurrencyUnit={currencyUnit}
          conversionRate={conversionRate}
          exchangeFeeRate={
            buyModalInfo.classFundId
              ? exchangeFeeRate
              : effectiveExchangeFeeRate
          }
          autoExchangeEnabled={
            Boolean(buyModalInfo.classFundId) || studentAutoExchangeBuyEnabled
          }
          paymentBalanceUSD={buyModalInfo.classFundId ? 0 : balanceUSD}
          onSubmitBuyOrder={handleExecuteBuyOrder}
          hasPendingOrder={(quantity) => hasPendingBuy({ ...buyModalInfo, quantity })}
          currencyUnit="FIN"
          isSubmitting={isSubmitting}
        />
      )}

      {sellModalInfo.show && (
        <SellStockModal
          isOpen={sellModalInfo.show}
          onClose={() => setSellModalInfo((prev) => ({ ...prev, show: false }))}
          {...sellModalInfo}
          tradeFeeRate={
            sellModalInfo.classFundId ? tradeFeeRate : effectiveTradeFeeRate
          }
          tradeFeeMinUSD={tradeFeeMinUSD}
          localCurrencyUnit={currencyUnit}
          conversionRate={conversionRate}
          exchangeFeeRate={exchangeFeeRate}
          onSubmitSellOrder={handleExecuteSellOrder}
          hasPendingOrder={(quantity) => hasPendingSell({ ...sellModalInfo, quantity })}
          currencyUnit="FIN"
          isSubmitting={isSubmitting}
        />
      )}

      {chartModal.show && (
        <ChartModal
          isOpen={chartModal.show}
          onClose={() => setChartModal({ show: false, symbol: null, timeframe: "1W" })}
          dividendInfo={mergedDividendInfoBySymbol[chartModal.symbol] || null}
          {...chartModal}
        />
      )}

      {showExchangeModal && (
        <ExchangeModal
          hasPendingExchange={hasPendingExchange}
          isOpen={showExchangeModal}
          onClose={() => setShowExchangeModal(false)}
          onSubmitExchange={handleExecuteExchange}
          exchangeFeeRate={effectiveExchangeFeeRate}
          isSubmitting={isSubmitting}
        />
      )}

      {stockInfoModal.show && (
        <StockInfoModal
          isOpen={stockInfoModal.show}
          onClose={() =>
            setStockInfoModal({
              show: false,
              symbol: null,
              companyName: null,
              isIndex: false,
            })
          }
          dividendInfo={mergedDividendInfoBySymbol[stockInfoModal.symbol] || null}
          {...stockInfoModal}
        />
      )}

      {showMarketSettingsModal && (
        <MarketSettingsModal
          isOpen={showMarketSettingsModal}
          onClose={() => setShowMarketSettingsModal(false)}
          currentSettings={marketSettingsCurrentSettings}
          students={marketSettingsStudents}
          onSubmitSettings={updateSettings}
          isSubmitting={isSavingSettings}
          data-tour="stock-market-settings-modal"
        />
      )}

      {showCategoryManagerModal && (
        <StockCategoryManagerModal
          isOpen={showCategoryManagerModal}
          onClose={closeCategoryManager}
          classId={contextClassId}
          categories={classCategoryDefinitions}
          stocks={allStockSymbols}
          initialCategoryId={categoryManagerInitialId}
        />
      )}

      {showBulkEditModal && (
        <BulkStockEditModal
          isOpen={showBulkEditModal}
          onClose={() => setShowBulkEditModal(false)}
          onOpenRegistration={openStockRegistration}
          allStocksByCategory={allStocksByCategory}
          data-tour="stock-bulk-edit-modal"
        />
      )}

      {showRegistrationModal && (
        <StockRegistrationModal
          isOpen={showRegistrationModal}
          onClose={closeStockRegistration}
          classId={contextClassId}
          onRegistered={handleStockRegistered}
        />
      )}

      {showDividendPolicyModal && (
        <DividendBulkSettingsModal
          isOpen={showDividendPolicyModal}
          onClose={() => setShowDividendPolicyModal(false)}
          allStocksByCategory={allStocksByCategory}
          pricesFlatMap={pricesFlatMap}
          dividendSummaryBySymbol={dividendSummaryBySymbol}
          data-tour="stock-dividend-settings-modal"
        />
      )}
    </AppLayout>
  );
}
