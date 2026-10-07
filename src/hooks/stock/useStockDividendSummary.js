import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";

import { db } from "../../firebase";

export const useStockDividendSummary = () =>
  useQuery({
    queryKey: ["stock", "dividend-summary", "upcoming"],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "stockDividendSummary", "upcoming_by_symbol"));
      if (!snap.exists()) return {};
      return snap.data()?.symbols || {};
    },
    staleTime: 1000 * 60 * 60 * 6,
    gcTime: 1000 * 60 * 60 * 24,
  });
