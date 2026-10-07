import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  startAfter,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { beginFirestoreSubscriptionDebug } from "../../../utils/firestoreSubscriptionDebug";

const PAGE_SIZE = 20;

const useMyInventory = (filters = {}, targetUid = null) => {
  const { classId, userData, isTeacher } = useUser();
  const uid = targetUid || userData?.uid;

  const [inventoryItems, setInventoryItems] = useState([]);
  const [isLoadingInventory, setIsLoadingInventory] = useState(true);

  // 1. 가방 (Inventory) 실시간 조회
  useEffect(() => {
    if (!classId || !uid) {
      setInventoryItems([]);
      setIsLoadingInventory(false);
      return;
    }

    setIsLoadingInventory(true);
    const ref = collection(
      db,
      `classes/${classId}/students/${uid}/inventory`,
    );
    const q = query(
      ref,
      where("quantity", ">", 0),
      orderBy("quantity", "desc"),
    );
    const subscriptionDebug = beginFirestoreSubscriptionDebug({
      source: "Store.inventory",
      pathKey: "classes/{classId}/students/{uid}/inventory",
      classId,
      role: isTeacher ? "teacher" : "student",
    });

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        subscriptionDebug.recordSnapshot(snap);
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setInventoryItems(items);
        setIsLoadingInventory(false);
      },
      (error) => {
        subscriptionDebug.recordError(error);
        console.error("[useMyInventory] inventory snapshot error:", error);
        setInventoryItems([]);
        setIsLoadingInventory(false);
      },
    );

    return () => {
      unsubscribe();
      subscriptionDebug.stop();
    };
  }, [classId, isTeacher, uid]);

  // 2. 사용/선물 기록 (Usage History) 🚀 [수정 완료]
  const historyQuery = useInfiniteQuery({
    // queryKey 명칭도 일관성 있게 변경
    queryKey: ["usageHistory", classId, uid, filters.start, filters.end],
    queryFn: async ({ pageParam }) => {
      if (!classId || !uid) return { docs: [], lastVisible: null };

      // ✅ 백엔드 useItem / giftItem 함수가 기록을 남기는 경로로 수정
      const ref = collection(
        db,
        `classes/${classId}/students/${uid}/usageHistory`,
      );

      // ✅ 날짜 내림차순 정렬 (최신순)
      let constraints = [orderBy("usedDate", "desc"), limit(PAGE_SIZE)];
      if (pageParam) constraints.push(startAfter(pageParam));

      const q = query(ref, ...constraints);
      const snap = await getDocs(q);

      return {
        docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        lastVisible: snap.docs[snap.docs.length - 1] || null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.lastVisible || undefined,
    enabled: !!classId && !!uid,
  });

  return {
    inventoryItems,
    isLoadingInventory,
    usageHistory: historyQuery.data?.pages.flatMap((page) => page.docs) || [],
    isLoadingHistory: historyQuery.isLoading,
    historyError: historyQuery.isError, // 로딩 상태 추가
    refresh: () => {
      historyQuery.refetch();
    },
    fetchNextPage: historyQuery.fetchNextPage, // 무한 스크롤용
    hasNextPage: historyQuery.hasNextPage,
  };
};

export default useMyInventory;
