import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";

import { db } from "../../firebase";
import { trackFirestorePayload } from "../../utils/firestoreTelemetry";

export const useUsIndexHistory = (classId = "") => useQuery({
  queryKey: ["stock", "us-index-history"],
  queryFn: async () => {
    const snap = await getDoc(doc(db, "stockMarketSummary", "us_index_history"));
    trackFirestorePayload({
      classId,
      source: "useUsIndexHistory",
      sourceGroup: "page",
      pathKey: "stockMarketSummary/us_index_history",
      mode: "getDoc",
      snapshot: snap,
    });
    return snap.exists() ? snap.data()?.historyBySymbol || {} : {};
  },
  staleTime: 1000 * 60 * 60 * 6,
  gcTime: 1000 * 60 * 60 * 24,
});
