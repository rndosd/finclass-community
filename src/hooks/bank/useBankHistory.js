import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase";

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function sortByCreatedAtDesc(items) {
  return [...items].sort((a, b) => toMillis(b?.createdAt) - toMillis(a?.createdAt));
}

export function useStudentBankHistory(
  classId,
  uid,
  kind,
  { enabled = true, initialData = [] } = {},
) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["studentBankHistory", kind, classId, uid],
    [classId, kind, uid],
  );
  const [isReady, setIsReady] = useState(
    () => queryClient.getQueryData(queryKey) !== undefined,
  );

  useEffect(() => {
    setIsReady(queryClient.getQueryData(queryKey) !== undefined);
  }, [queryClient, queryKey]);

  useEffect(() => {
    if (!enabled || !classId || !uid || !kind) return;

    const cachedData = queryClient.getQueryData(queryKey);
    if (cachedData === undefined && Array.isArray(initialData) && initialData.length > 0) {
      queryClient.setQueryData(queryKey, initialData);
    }
  }, [classId, enabled, initialData, kind, queryClient, queryKey, uid]);

  useEffect(() => {
    if (!enabled || !classId || !uid || !kind) return undefined;

    const historyRef = query(
      collection(db, `classes/${classId}/students/${uid}/${kind}`),
      orderBy("createdAt", "desc"),
    );

    const unsubscribe = onSnapshot(
      historyRef,
      (snap) => {
        queryClient.setQueryData(
          queryKey,
          sortByCreatedAtDesc(
            snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
          ),
        );
        setIsReady(true);
      },
      () => {
        setIsReady(true);
      },
    );

    return () => unsubscribe();
  }, [classId, enabled, kind, queryClient, queryKey, uid]);

  const historyQuery = useQuery({
    queryKey,
    queryFn: () => queryClient.getQueryData(queryKey) ?? initialData ?? [],
    staleTime: Infinity,
  });

  return {
    data: historyQuery.data || initialData || [],
    isLoading: !!enabled && !!classId && !!uid && !isReady,
  };
}
