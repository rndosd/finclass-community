import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase";

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const round4 = (value) => Math.round(toNumber(value) * 10000) / 10000;

const buildFundPortfolioRows = ({
  rows = [],
  pricesFlatMap = {},
  conversionRate = 1,
}) => {
  const safeRate = toNumber(conversionRate, 1) || 1;
  let totalCurrentValueUSD = 0;
  let totalInvestedUSD = 0;
  let totalCurrentValueLocal = 0;
  let totalInvestedLocal = 0;

  const entries = rows.map((row) => {
    const symbol = String(row?.symbol || row?.id || "").trim().toUpperCase();
    const quantity = round4(row?.quantity);
    const currentPriceUSD = toNumber(pricesFlatMap?.[symbol], 0);
    const totalInvestmentUSD = toNumber(
      row?.totalInvestmentUSD,
      toNumber(row?.averagePriceUSD, 0) * quantity,
    );
    const totalInvestmentLocal = toNumber(
      row?.totalInvestmentInClassCurrency,
      totalInvestmentUSD / safeRate,
    );
    const evalAmountUSD = round4(currentPriceUSD * quantity);
    const evalAmountLocal = round4(evalAmountUSD / safeRate);
    const profitLossUSD = round4(evalAmountUSD - totalInvestmentUSD);
    const profitLossLocal = round4(evalAmountLocal - totalInvestmentLocal);
    const profitRate =
      totalInvestmentUSD > 0
        ? round4((profitLossUSD / totalInvestmentUSD) * 100)
        : 0;

    totalCurrentValueUSD += evalAmountUSD;
    totalInvestedUSD += totalInvestmentUSD;
    totalCurrentValueLocal += evalAmountLocal;
    totalInvestedLocal += totalInvestmentLocal;

    return {
      ...row,
      symbol,
      quantity,
      currentPriceUSD,
      evalAmountUSD,
      evalAmountLocal,
      totalInvestmentUSD,
      totalInvestmentLocal,
      profitLossUSD,
      profitLossLocal,
      profitRate,
    };
  });

  const totalProfitLossUSD = round4(totalCurrentValueUSD - totalInvestedUSD);
  const totalProfitLossLocal = round4(totalCurrentValueLocal - totalInvestedLocal);

  return {
    entries,
    summary: {
      totalCurrentValueUSD: round4(totalCurrentValueUSD),
      totalCurrentValueLocal: round4(totalCurrentValueLocal),
      totalInvestedUSD: round4(totalInvestedUSD),
      totalInvestedLocal: round4(totalInvestedLocal),
      totalProfitLossUSD,
      totalProfitLossLocal,
      totalProfitRate:
        totalInvestedUSD > 0
          ? round4((totalProfitLossUSD / totalInvestedUSD) * 100)
          : 0,
    },
  };
};

export function useClassFundStockPortfolio(
  classId,
  fundId,
  { enabled = true, pricesFlatMap = {}, conversionRate = 1 } = {},
) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["stock", "classFundPortfolio", classId, fundId],
    [classId, fundId],
  );

  useEffect(() => {
    if (!classId || !fundId || !enabled) return undefined;

    const portfolioRef = collection(
      db,
      `classes/${classId}/classFunds/${fundId}/stockPortfolio`,
    );
    const q = query(portfolioRef, orderBy("symbol"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        queryClient.setQueryData(queryKey, rows);
      },
      (error) => {
        console.error("[useClassFundStockPortfolio] subscribe error:", error);
      },
    );

    return () => unsubscribe();
  }, [classId, enabled, fundId, queryClient, queryKey]);

  const queryResult = useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: () => queryClient.getQueryData(queryKey) ?? [],
    enabled: !!classId && !!fundId && enabled,
    staleTime: Infinity,
  });

  return useMemo(() => {
    const rows = Array.isArray(queryResult.data) ? queryResult.data : [];
    const calculated = buildFundPortfolioRows({
      rows,
      pricesFlatMap,
      conversionRate,
    });

    return {
      ...queryResult,
      data: rows,
      portfolioEntries: calculated.entries,
      summary: calculated.summary,
    };
  }, [conversionRate, pricesFlatMap, queryResult]);
}
