import { useQuery } from "@tanstack/react-query";
import { Timestamp, collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../../firebase";

const STOCK_HISTORY_TYPES = new Set([
  "STOCK_BUY",
  "STOCK_SELL",
  "STOCK_DIVIDEND",
]);

const DEFAULT_PERIOD_DAYS = 30;

const toTradeRecord = (docSnap) => ({
  id: docSnap.id,
  ...docSnap.data(),
});

const normalizePeriodDays = (value) => {
  if (value === null || value === undefined || value === "all") {
    return null;
  }

  const num = Number(value);
  if (!Number.isFinite(num) || num < 1) return DEFAULT_PERIOD_DAYS;
  return Math.floor(num);
};

const getPeriodStartDate = (periodDays) => {
  const normalized = normalizePeriodDays(periodDays);
  if (!normalized) return null;

  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - (normalized - 1));
  return startDate;
};

export default function useStockTradeHistory({
  classId,
  uid,
  enabled = true,
  periodDays = DEFAULT_PERIOD_DAYS,
} = {}) {
  const normalizedPeriodDays = normalizePeriodDays(periodDays);

  const queryState = useQuery({
    queryKey: [
      "stockTradeHistory",
      classId,
      uid,
      normalizedPeriodDays ?? "all",
    ],
    enabled: !!classId && !!uid && enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const tradeHistoryRef = collection(
        db,
        `classes/${classId}/students/${uid}/tradeHistory`,
      );
      const startDate = getPeriodStartDate(normalizedPeriodDays);

      const constraints = [
        ...(startDate
          ? [where("createdAt", ">=", Timestamp.fromDate(startDate))]
          : []),
        orderBy("createdAt", "desc"),
      ];

      const snapshot = await getDocs(query(tradeHistoryRef, ...constraints));

      return snapshot.docs
        .map(toTradeRecord)
        .filter((trade) => STOCK_HISTORY_TYPES.has(trade?.type));
    },
  });

  return {
    ...queryState,
    tradeHistory: queryState.data || [],
  };
}
