import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collection,
  getCountFromServer,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../firebase";

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const sortByLatest = (applications = []) =>
  [...applications].sort((a, b) => {
    const left = toMillis(a.updatedAt || a.reviewedAt || a.submittedAt);
    const right = toMillis(b.updatedAt || b.reviewedAt || b.submittedAt);
    return right - left;
  });

const isStoredCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
};

const mapApplications = (snapshot) =>
  sortByLatest(
    snapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data(),
    })),
  );

const buildApplicationsQuery = ({
  classId,
  userUid,
  canManageAll = false,
  roundId = "",
}) => {
  const baseRef = collection(db, `classes/${classId}/jobApplications`);
  return canManageAll
    ? query(baseRef, where("roundId", "==", roundId))
    : query(baseRef, where("studentUid", "==", userUid));
};

export const fetchJobApplicationsByRound = async ({
  classId,
  roundId,
}) => {
  if (!classId || !roundId) return [];

  const snapshot = await getDocs(
    buildApplicationsQuery({
      classId,
      canManageAll: true,
      roundId,
    }),
  );

  return mapApplications(snapshot);
};

export const useJobApplicationsQuery = ({
  classId,
  userUid,
  canManageAll = false,
  roundId = "",
  enabled = true,
}) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => [
      "class",
      "jobApplications",
      classId,
      canManageAll ? `round:${roundId || "none"}` : userUid,
    ],
    [classId, canManageAll, roundId, userUid],
  );

  useEffect(() => {
    if (!classId || !userUid || !enabled) {
      queryClient.setQueryData(queryKey, []);
      return undefined;
    }

    if (canManageAll && !roundId) {
      queryClient.setQueryData(queryKey, []);
      return undefined;
    }

    const q = buildApplicationsQuery({
      classId,
      userUid,
      canManageAll,
      roundId,
    });

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        queryClient.setQueryData(queryKey, mapApplications(snapshot));
      },
      (error) => {
        console.error("[useJobApplicationsQuery] subscribe error:", error);
      },
    );

    return () => unsubscribe();
  }, [classId, userUid, canManageAll, enabled, queryClient, queryKey, roundId]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && userUid && enabled && (!canManageAll || roundId)),
    staleTime: Infinity,
  });
};

export const useLegacyJobApplicationsQuery = ({
  classId,
  enabled = false,
}) =>
  useQuery({
    queryKey: ["class", "jobApplications", classId, "legacy"],
    queryFn: async () => {
      const snapshot = await getDocs(
        collection(db, `classes/${classId}/jobApplications`),
      );

      const legacyApplications = snapshot.docs
        .map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }))
        .filter((application) => !String(application.roundId || "").trim());

      return sortByLatest(legacyApplications);
    },
    initialData: [],
    enabled: Boolean(classId && enabled),
    staleTime: 5 * 60 * 1000,
  });

export const useJobApplicationRoundTotalsQuery = ({
  classId,
  rounds = [],
}) => {
  const missingRoundIds = useMemo(
    () =>
      rounds
        .filter((round) => !isStoredCount(round?.applicationCount))
        .map((round) => String(round?.id || "").trim())
        .filter(Boolean),
    [rounds],
  );

  return useQuery({
    queryKey: [
      "class",
      "jobApplicationRoundTotals",
      classId,
      missingRoundIds.join("|"),
    ],
    queryFn: async () => {
      const applicationsRef = collection(db, `classes/${classId}/jobApplications`);
      const entries = await Promise.all(
        missingRoundIds.map(async (roundId) => {
          const snapshot = await getCountFromServer(
            query(applicationsRef, where("roundId", "==", roundId)),
          );

          return [roundId, snapshot.data().count];
        }),
      );

      return Object.fromEntries(entries);
    },
    initialData: {},
    enabled: Boolean(classId && missingRoundIds.length > 0),
    staleTime: 5 * 60 * 1000,
  });
};
