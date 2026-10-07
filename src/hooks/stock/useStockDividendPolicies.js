import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";

import { db } from "../../firebase";

export const useStockDividendPolicies = (classId) => {
  const queryKey = useMemo(() => ["stock", "dividend-policies", classId], [classId]);

  return useQuery({
    queryKey,
    enabled: !!classId,
    queryFn: async () => {
      const snap = await getDocs(collection(db, "classes", classId, "stockDividendPolicies"));
      const policies = {};

      snap.forEach((docSnap) => {
        policies[docSnap.id] = {
          symbol: docSnap.id,
          ...docSnap.data(),
        };
      });

      return policies;
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
  });
};