import { useQuery } from "@tanstack/react-query";
import { db } from "../../firebase";
import { doc, getDoc } from "firebase/firestore";
import { trackFirestorePayload } from "../../utils/firestoreTelemetry";

export const useStockQuotes = (classId = "") => {
    return useQuery({
        queryKey: ["stock", "quotes", "all"],
        queryFn: async () => {
            const snap = await getDoc(doc(db, "stockMarketSummary", "today_quotes_all"));
            trackFirestorePayload({
                classId,
                source: "useStockQuotes",
                sourceGroup: "page",
                pathKey: "stockMarketSummary/today_quotes_all",
                mode: "getDoc",
                snapshot: snap,
            });
            if (!snap.exists()) return {};
            return snap.data();
        },
        // 하루에 한 번 바뀌므로 6시간 정도로 넉넉하게 staleTime 설정
        staleTime: 1000 * 60 * 60 * 6,
        gcTime: 1000 * 60 * 60 * 24,
    });
};
