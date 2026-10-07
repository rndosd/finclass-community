import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";

import { db } from "../../firebase";

const fetchStockEtfProfile = async (symbol) => {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  if (!normalizedSymbol) return null;

  const snapshot = await getDoc(
    doc(db, "stockEtfProfileCache", normalizedSymbol),
  );
  return snapshot.exists() ? snapshot.data() : null;
};

export const useStockEtfProfile = (symbol, options = {}) => {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const enabled = options.enabled !== false && !!normalizedSymbol;

  return useQuery({
    queryKey: ["stock", "etfProfile", normalizedSymbol],
    queryFn: () => fetchStockEtfProfile(normalizedSymbol),
    enabled,
    staleTime: 1000 * 60 * 60 * 12,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnWindowFocus: false,
  });
};
