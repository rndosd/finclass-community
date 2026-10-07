import React, { createContext, useContext, useMemo } from "react";
import { useUser } from "./UserContext";
import { useStockPortfolio } from "../hooks/stock/useStockPortfolio";
import { useStockQuotes } from "../hooks/stock/useStockQuotes";
import { getSpendableBankBalance } from "../utils/bankMoney";
import { useStockSettings } from "../hooks/stock/useStockSettings";
import {
  buildPortfolioEntries,
  buildPortfolioSummary,
  buildStockPriceMap,
} from "../pages/stock/utils/portfolioCalculations";
import {
  formatStockClassCurrency,
  formatStockExchangeRate,
  formatStockMoney,
  formatStockPercent,
  formatStockPrice,
  formatStockQuantity,
  normalizeStockDisplaySettings,
  setStockDisplaySettings,
} from "../utils/stockFormat";
import {
  DEFAULT_CLASS_CURRENCY_UNIT,
  resolveClassCurrencyUnit,
} from "../utils/currencyUnit";

const StockContext = createContext();

const INITIAL_ASSET_INFO = {
  totalValueUSD: 0,
  totalValueBIL: 0,
  totalInvestedUSD: 0,
  totalProfitLossUSD: 0,
  totalProfitLossPercentage: 0,
};

const buildStockFormatters = (displayFormat) => ({
  formatFin: (value, options = {}) =>
    formatStockMoney(value, { settings: displayFormat, ...options }),
  formatClassCurrency: (value, options = {}) =>
    formatStockClassCurrency(value, { settings: displayFormat, ...options }),
  formatExchangeRate: (value, options = {}) =>
    formatStockExchangeRate(value, { settings: displayFormat, ...options }),
  formatPercent: (value, options = {}) =>
    formatStockPercent(value, { settings: displayFormat, ...options }),
  formatWholeNumber: (value, options = {}) =>
    formatStockQuantity(value, { settings: displayFormat, ...options }),
  formatStockPrice: (value, options = {}) =>
    formatStockPrice(value, { settings: displayFormat, ...options }),
  formatShareQuantity: (value, options = {}) =>
    formatStockQuantity(value, { settings: displayFormat, ...options }),
});

export const useStockContext = () => {
  const context = useContext(StockContext);
  if (!context) {
    throw new Error("useStockContext must be used within StockProvider");
  }
  return context;
};

export const StockProvider = ({ children }) => {
  const { userData, classId, classData, loading: userLoading } = useUser();
  const uid = userData?.uid;
  const profile = userData;
  const profileLoading = userLoading;

  const { data: allPrices, isLoading: quotesLoading, error: quotesError, refetch: refetchQuotes } = useStockQuotes(classId);
  const { data: portfolio, isLoading: portfolioLoading, error: portfolioError, refetch: refetchPortfolio } = useStockPortfolio(
    classId,
    uid,
  );
  const { settings } = useStockSettings(classId);

  const value = useMemo(() => {
    const currentProfile = profile || {};
    const currentPortfolio = portfolio || {};
    const currentAllPrices = allPrices || {};
    const displayFormat = normalizeStockDisplaySettings(settings?.displayFormat);
    const currencyUnit = resolveClassCurrencyUnit(
      classData,
      DEFAULT_CLASS_CURRENCY_UNIT,
      [settings?.currencyUnit],
    );
    const currentRate =
      settings?.conversionRate ??
      currentProfile?.assets?.stockValue?.lastConversionRate ??
      10;
    const currentExchangeFeeRate =
      typeof settings?.exchangeFeeRate === "number"
        ? settings.exchangeFeeRate
        : 0.01;
    const balanceBIL = currentProfile?.assets?.cash ?? 0;
    const balanceUSD = currentProfile?.assets?.usdBalance ?? 0;
    const formatters = buildStockFormatters(displayFormat);

    setStockDisplaySettings(displayFormat);

    const dataError = quotesError || portfolioError;
    const isInitialLoading = !dataError && (
      profileLoading ||
      portfolioLoading ||
      quotesLoading ||
      !allPrices ||
      !profile);

    const defaultStructure = {
      allPrices: currentAllPrices,
      pricesFlatMap: {},
      userPortfolio: currentPortfolio,
      detailedPortfolio: [],
      chartSummaries: {},
      balanceBIL,
      availableBalanceBIL: Math.max(0, getSpendableBankBalance(currentProfile.assets)),
      balanceUSD,
      conversionRate: currentRate,
      exchangeFeeRate: currentExchangeFeeRate,
      marketStatus: { status: "closed", label: "장 마감" },
      currencyUnit,
      stockAssetInfo: INITIAL_ASSET_INFO,
      stockDisplaySettings: displayFormat,
      isLoading: isInitialLoading,
      isDataLoading: isInitialLoading,
      dataError,
      retryData: () => { refetchPortfolio(); return refetchQuotes(); },
      getPriceData: () => null,
      getCurrentPrice: () => 0,
      ...formatters,
    };

    if (isInitialLoading) {
      return defaultStructure;
    }

    try {
      const pricesFlatMap = buildStockPriceMap(currentAllPrices);
      const { entries } = buildPortfolioEntries(
        currentPortfolio,
        currentAllPrices,
        { fallbackToAveragePrice: true },
      );
      const portfolioSummary = buildPortfolioSummary(entries, currentRate);
      const detailedPortfolio = entries.map((entry) => ({
        ...entry,
        currentPrice: entry.currentPriceUSD,
        totalInvestedUSD: entry.totalInvestmentUSD,
        totalCurrentValueUSD: entry.evalAmountUSD,
        profitLossPercentage: entry.profitRate,
      }));

      const now = new Date();
      const nyTime = new Date(
        now.toLocaleString("en-US", { timeZone: "America/New_York" }),
      );
      const nyHour = nyTime.getHours();
      const nyDay = nyTime.getDay();
      const isMarketHours =
        nyHour >= 9 && nyHour < 16 && nyDay !== 0 && nyDay !== 6;

      return {
        ...defaultStructure,
        isLoading: false,
        isDataLoading: false,
        pricesFlatMap,
        detailedPortfolio,
        marketStatus: isMarketHours
          ? { status: "open", label: "장 운영 중" }
          : { status: "closed", label: "장 마감" },
        stockAssetInfo: {
          totalValueUSD: portfolioSummary.totalCurrentValueUSD,
          totalValueBIL: portfolioSummary.totalCurrentValueLocal,
          totalInvestedUSD: portfolioSummary.totalInvestedUSD,
          totalProfitLossUSD: portfolioSummary.totalProfitLossUSD,
          totalProfitLossPercentage: portfolioSummary.totalProfitRate,
        },
        getPriceData: (symbol) =>
          currentAllPrices[symbol?.toUpperCase()] || null,
        getCurrentPrice: (symbol) => pricesFlatMap[symbol?.toUpperCase()] || 0,
      };
    } catch (error) {
      console.error("[StockContext] Failed to build stock data:", error);
      return defaultStructure;
    }
  }, [
    allPrices,
    classData,
    portfolio,
    profile,
    profileLoading,
    portfolioLoading,
    quotesLoading,
    quotesError,
    portfolioError,
    refetchQuotes,
    refetchPortfolio,
    settings,
  ]);

  return (
    <StockContext.Provider value={value}>{children}</StockContext.Provider>
  );
};
