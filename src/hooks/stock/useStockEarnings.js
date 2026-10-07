import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";

import { db } from "../../firebase";

const fetchStockEarnings = async (symbol) => {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  if (!normalizedSymbol) return null;

  const snapshot = await getDoc(doc(db, "stockEarningsCache", normalizedSymbol));
  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data();
};

export const useStockEarnings = (symbol, options = {}) => {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const enabled = options.enabled !== false && !!normalizedSymbol;

  return useQuery({
    queryKey: ["stock", "earnings", normalizedSymbol],
    queryFn: () => fetchStockEarnings(normalizedSymbol),
    enabled,
    staleTime: 1000 * 60 * 60 * 12,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnWindowFocus: false,
  });
};
