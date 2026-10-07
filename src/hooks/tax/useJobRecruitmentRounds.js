import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import { db } from "../../firebase";

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const sortByLatest = (rounds = []) =>
  [...rounds].sort((a, b) => {
    const left = toMillis(a.startedAt || a.createdAt || a.updatedAt);
    const right = toMillis(b.startedAt || b.createdAt || b.updatedAt);
    return right - left;
  });

export const useJobRecruitmentRoundsQuery = ({ classId }) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["class", "jobRecruitmentRounds", classId],
    [classId],
  );

  useEffect(() => {
    if (!classId) return undefined;

    const roundsRef = collection(db, `classes/${classId}/jobRecruitmentRounds`);
    const q = query(roundsRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rounds = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));

        queryClient.setQueryData(queryKey, sortByLatest(rounds));
      },
      (error) => {
        console.error("[useJobRecruitmentRoundsQuery] subscribe error:", error);
      },
    );

    return () => unsubscribe();
  }, [classId, queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId),
    staleTime: Infinity,
  });
};
