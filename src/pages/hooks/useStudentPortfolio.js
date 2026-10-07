import { useMemo } from "react";
import { useStockContext } from "../../contexts/StockContext";
import { useUser } from "../../contexts/UserContext";
import { useStockPortfolio } from "../../hooks/stock/useStockPortfolio";
import {
  buildPortfolioEntries,
  buildPortfolioSummary,
} from "../stock/utils/portfolioCalculations";

const EMPTY_RESULT = {
  portfolioEntries: [],
  summary: {
    totalInvestedUSD: 0,
    totalCurrentValueUSD: 0,
    totalProfitLossUSD: 0,
    totalProfitRate: 0,
    totalInvestedLocal: 0,
    totalCurrentValueLocal: 0,
    totalProfitLossLocal: 0,
    hasPositions: false,
  },
};

export default function useStudentPortfolio({
  classId: propClassId,
  uid: propUid,
  conversionRate: propRate,
} = {}) {
  const { userData, classId: userClassId } = useUser();
  const {
    userPortfolio: contextPortfolio,
    allPrices,
    isLoading: contextLoading,
    conversionRate: contextRate,
  } = useStockContext();

  const resolvedClassId = propClassId || userClassId;
  const resolvedUid = propUid || userData?.uid;
  const isCurrentUserTarget =
    !!resolvedUid &&
    resolvedUid === userData?.uid &&
    resolvedClassId === userClassId;

  const {
    data: targetPortfolio = {},
    isLoading: portfolioLoading,
    error,
    refetch,
  } = useStockPortfolio(resolvedClassId, resolvedUid);

  const rawPortfolioMap = useMemo(
    () =>
      isCurrentUserTarget ? contextPortfolio || {} : targetPortfolio || {},
    [contextPortfolio, isCurrentUserTarget, targetPortfolio],
  );

  const loading = isCurrentUserTarget
    ? contextLoading
    : portfolioLoading ||
      (contextLoading && Object.keys(allPrices || {}).length === 0);

  const result = useMemo(() => {
    if (loading) {
      return EMPTY_RESULT;
    }

    if (!Object.keys(rawPortfolioMap || {}).length) {
      return EMPTY_RESULT;
    }
    const activeRate = propRate || contextRate || 1;
    const { entries: portfolioEntries } = buildPortfolioEntries(
      rawPortfolioMap,
      allPrices,
    );
    const summary = buildPortfolioSummary(portfolioEntries, activeRate);

    return {
      portfolioEntries,
      summary,
    };
  }, [allPrices, contextRate, loading, propRate, rawPortfolioMap]);

  return {
    ...result,
    loading,
    error: error || null,
    refetch,
  };
}
