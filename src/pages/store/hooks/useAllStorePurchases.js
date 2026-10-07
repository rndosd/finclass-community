import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
} from "firebase/firestore";

import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import { parseDateKeyAsKST } from "../../../utils/kstDate";

const atStartOfDay = (ymd) => parseDateKeyAsKST(ymd);

const atEndOfDay = (ymd) => parseDateKeyAsKST(ymd, { endOfDay: true });

const PAGE_SIZE = 20;

const useAllStorePurchases = ({
  startDate,
  endDate,
  statusFilter = "all",
} = {}) => {
  const { classId } = useUser();

  const queryInfo = useInfiniteQuery({
    queryKey: ["allStorePurchases", classId, startDate, endDate, statusFilter],
    queryFn: async ({ pageParam }) => {
      if (!classId) return { docs: [], lastVisible: null };

      const base = collection(db, `classes/${classId}/storeRedemptions`);
      const constraints = [];

      if (statusFilter === "completed") {
        constraints.push(where("status", "in", ["redeemed", "completed"]));
      } else if (statusFilter === "cancelled") {
        constraints.push(where("status", "==", "cancelled"));
      } else {
        constraints.push(
          where("status", "in", ["redeemed", "completed", "cancelled"]),
        );
      }

      const start = atStartOfDay(startDate);
      const end = atEndOfDay(endDate);
      if (start) {
        constraints.push(where("completedAt", ">=", Timestamp.fromDate(start)));
      }
      if (end) {
        constraints.push(where("completedAt", "<=", Timestamp.fromDate(end)));
      }

      constraints.push(orderBy("completedAt", "desc"));

      if (pageParam) {
        constraints.push(startAfter(pageParam));
      }

      constraints.push(limit(PAGE_SIZE));

      const purchaseQuery = query(base, ...constraints);
      const snapshot = await getDocs(purchaseQuery);

      return {
        docs: snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
        lastVisible: snapshot.docs[snapshot.docs.length - 1] || null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.lastVisible || undefined,
    enabled: Boolean(classId),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const allPurchases = useMemo(
    () =>
      queryInfo.data
        ? queryInfo.data.pages.flatMap((page) => page.docs)
        : [],
    [queryInfo.data],
  );

  return {
    allPurchases,
    isLoading: queryInfo.isLoading,
    isFetchingNextPage: queryInfo.isFetchingNextPage,
    hasNextPage: queryInfo.hasNextPage,
    error: queryInfo.error,
    fetchNextPage: queryInfo.fetchNextPage,
    refresh: queryInfo.refetch,
  };
};

export default useAllStorePurchases;
