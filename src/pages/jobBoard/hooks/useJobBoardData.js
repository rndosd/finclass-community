import useLiveQueryStatus from "./useLiveQueryStatus";
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collection,
  collectionGroup,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../../firebase";
import { withFirestoreSnapshotTelemetry } from "../../../utils/firestoreTelemetry";
import { buildJobPostApplicationsQuery } from "./jobPostApplicationsQuery";

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const sortByUpdatedAt = (rows = []) =>
  [...rows].sort((left, right) => {
    const leftTime = toMillis(left.updatedAt || left.createdAt || left.appliedAt);
    const rightTime = toMillis(right.updatedAt || right.createdAt || right.appliedAt);
    return rightTime - leftTime;
  });

const JOB_BOARD_LIST_STATUSES = ["recruiting", "pending_approval", "draft"];

// Firestore IN filters are sets; retain the existing first-ten-value limit.
const statusFilterIdentity = (statusIn) => JSON.stringify(
  Array.isArray(statusIn) ? [...new Set(statusIn.slice(0, 10))].sort() : [],
);

const buildStatusClauses = (statusIn) =>
  Array.isArray(statusIn) && statusIn.length > 0
    ? [where("status", "in", statusIn.slice(0, 10))]
    : [];

export const useJobBoardPostsQuery = ({ classId }) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["class", "jobBoardPosts", classId], [classId]);

  const { retryCount, onSuccess, onError, ...liveStatus } = useLiveQueryStatus(queryKey, Boolean(classId));

  useEffect(() => {
    if (!classId) return undefined;

    const postsRef = collection(db, `classes/${classId}/jobPosts`);
    const q = query(
      postsRef,
      where("status", "in", JOB_BOARD_LIST_STATUSES),
      orderBy("createdAt", "desc"),
    );
    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        onSuccess();
        const posts = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));
        queryClient.setQueryData(queryKey, sortByUpdatedAt(posts));
      }),
      (error) => {
        if (!active) return;
        onError(error);
        console.error("[useJobBoardPostsQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, queryClient, queryKey, retryCount, onSuccess, onError]);

  const result = useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId),
    staleTime: Infinity,
  });
  return { ...result, ...liveStatus };
};

export const useJobPostApplicationsQuery = ({
  classId,
  postId,
  authorUid = "",
  enabled = true,
}) => {
  const queryClient = useQueryClient();
  const normalizedAuthorUid = String(authorUid || "").trim();
  const queryKey = useMemo(
    () => [
      "class",
      "jobBoardApplications",
      classId,
      postId,
      normalizedAuthorUid || "all",
    ],
    [classId, normalizedAuthorUid, postId],
  );

  useEffect(() => {
    if (!classId || !postId || !enabled) return undefined;

    const applicationsRef = collection(
      db,
      `classes/${classId}/jobPosts/${postId}/applications`,
    );
    const q = buildJobPostApplicationsQuery({
      applicationsRef,
      authorUid: normalizedAuthorUid,
    });
    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        const applications = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));
        queryClient.setQueryData(queryKey, sortByUpdatedAt(applications));
      }),
      (error) => {
        if (!active) return;
        console.error("[useJobPostApplicationsQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, normalizedAuthorUid, postId, queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && postId && enabled),
    staleTime: Infinity,
  });
};

export const useMyJobBoardApplicationsQuery = ({
  classId,
  userUid,
  enabled = true,
  limitCount = null,
  statusIn = null,
}) => {
  const queryClient = useQueryClient();
  const statusFilterKey = statusFilterIdentity(statusIn);
  const queryKey = useMemo(
    () => ["class", "myJobBoardApplications", classId, userUid, statusFilterKey, limitCount || "all"],
    [classId, limitCount, statusFilterKey, userUid],
  );

  const { retryCount, onSuccess, onError, ...liveStatus } = useLiveQueryStatus(queryKey, Boolean(classId && userUid && enabled));

  useEffect(() => {
    if (!classId || !userUid || !enabled) return undefined;

    const q = query(
      collectionGroup(db, "applications"),
      where("classId", "==", classId),
      where("applicantUid", "==", userUid),
      ...buildStatusClauses(JSON.parse(statusFilterKey)),
      orderBy("updatedAt", "desc"),
      ...(limitCount ? [limit(limitCount)] : []),
    );

    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        onSuccess();
        const applications = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));
        queryClient.setQueryData(queryKey, sortByUpdatedAt(applications));
      }),
      (error) => {
        if (!active) return;
        onError(error);
        console.error("[useMyJobBoardApplicationsQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, limitCount, queryClient, queryKey, statusFilterKey, userUid, retryCount, onSuccess, onError]);

  const result = useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && userUid && enabled),
    staleTime: Infinity,
  });
  return { ...result, ...liveStatus };
};

export const useClassJobBoardApplicationsQuery = ({ classId, enabled = true }) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["class", "jobBoardApplications", "all", classId], [classId]);

  useEffect(() => {
    if (!classId || !enabled) return undefined;

    const q = query(
      collectionGroup(db, "applications"),
      where("classId", "==", classId),
      orderBy("updatedAt", "desc"),
    );
    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        const applications = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));
        queryClient.setQueryData(queryKey, sortByUpdatedAt(applications));
      }),
      (error) => {
        if (!active) return;
        console.error("[useClassJobBoardApplicationsQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && enabled),
    staleTime: Infinity,
  });
};

export const useJobBoardProfilesQuery = ({ classId, enabled = true }) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["class", "jobBoardProfiles", classId], [classId]);

  useEffect(() => {
    if (!classId || !enabled) return undefined;

    const profilesRef = collection(db, `classes/${classId}/jobBoardProfiles`);
    let active = true;
    const unsubscribe = onSnapshot(
      profilesRef,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        const profiles = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));
        queryClient.setQueryData(queryKey, sortByUpdatedAt(profiles));
      }),
      (error) => {
        if (!active) return;
        console.error("[useJobBoardProfilesQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && enabled),
    staleTime: Infinity,
  });
};

export const useJobBoardProfileQuery = ({
  classId,
  userUid,
  enabled = true,
}) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["class", "jobBoardProfile", classId, userUid],
    [classId, userUid],
  );

  useEffect(() => {
    if (!classId || !userUid || !enabled) return undefined;

    const profileRef = doc(db, `classes/${classId}/jobBoardProfiles/${userUid}`);
    let active = true;
    const unsubscribe = onSnapshot(
      profileRef,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        const profile = snapshot.exists()
          ? { id: snapshot.id, ...snapshot.data() }
          : null;
        queryClient.setQueryData(queryKey, profile);
      }),
      (error) => {
        if (!active) return;
        console.error("[useJobBoardProfileQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, queryClient, queryKey, userUid]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? null,
    initialData: null,
    enabled: Boolean(classId && userUid && enabled),
    staleTime: Infinity,
  });
};

export const useJobBoardRatingsQuery = ({ classId, enabled = true }) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["class", "jobBoardRatings", classId], [classId]);

  useEffect(() => {
    if (!classId || !enabled) return undefined;

    const ratingsRef = collection(db, `classes/${classId}/jobBoardRatings`);
    const q = query(ratingsRef, orderBy("updatedAt", "desc"));
    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        const ratings = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));
        queryClient.setQueryData(queryKey, sortByUpdatedAt(ratings));
      }),
      (error) => {
        if (!active) return;
        console.error("[useJobBoardRatingsQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && enabled),
    staleTime: Infinity,
  });
};

export const useMyAuthoredJobBoardRatingsQuery = ({
  classId,
  userUid,
  enabled = true,
}) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["class", "jobBoardRatings", "authored", classId, userUid],
    [classId, userUid],
  );

  useEffect(() => {
    if (!classId || !userUid || !enabled) return undefined;

    const ratingsRef = collection(db, `classes/${classId}/jobBoardRatings`);
    const q = query(ratingsRef, where("raterUid", "==", userUid));
    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        const ratings = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));
        queryClient.setQueryData(queryKey, sortByUpdatedAt(ratings));
      }),
      (error) => {
        if (!active) return;
        console.error("[useMyAuthoredJobBoardRatingsQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, queryClient, queryKey, userUid]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && userUid && enabled),
    staleTime: Infinity,
  });
};

export const useJobBoardDashboardSummaryQuery = ({
  classId,
  userUid,
  enabled = true,
}) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["class", "jobBoardDashboardSummary", classId, userUid],
    [classId, userUid],
  );

  useEffect(() => {
    if (!classId || !userUid || !enabled) return undefined;

    const summaryRef = doc(db, `classes/${classId}/jobBoardDashboardSummaries/${userUid}`);
    let active = true;
    const unsubscribe = onSnapshot(
      summaryRef,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        queryClient.setQueryData(
          queryKey,
          snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null,
        );
      }),
      (error) => {
        if (!active) return;
        console.error("[useJobBoardDashboardSummaryQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, queryClient, queryKey, userUid]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? null,
    initialData: null,
    enabled: Boolean(classId && userUid && enabled),
    staleTime: Infinity,
  });
};

export const useMyReceivedJobBoardRatingsQuery = ({
  classId,
  userUid,
  enabled = true,
  limitCount = null,
}) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => [
      "class",
      "jobBoardRatings",
      "received",
      classId,
      userUid,
      limitCount ?? "all",
    ],
    [classId, limitCount, userUid],
  );

  useEffect(() => {
    if (!classId || !userUid || !enabled) return undefined;

    const ratingsRef = collection(db, `classes/${classId}/jobBoardRatings`);
    const q =
      typeof limitCount === "number"
        ? query(
            ratingsRef,
            where("targetUid", "==", userUid),
            orderBy("updatedAt", "desc"),
            limit(limitCount),
          )
        : query(ratingsRef, where("targetUid", "==", userUid));
    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        const ratings = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));
        queryClient.setQueryData(queryKey, sortByUpdatedAt(ratings));
      }),
      (error) => {
        if (!active) return;
        console.error("[useMyReceivedJobBoardRatingsQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, limitCount, queryClient, queryKey, userUid]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && userUid && enabled),
    staleTime: Infinity,
  });
};

export const useMyAuthoredJobBoardPostsQuery = ({
  classId,
  userUid,
  enabled = true,
  limitCount = null,
  statusIn = null,
}) => {
  const queryClient = useQueryClient();
  const statusFilterKey = statusFilterIdentity(statusIn);
  const queryKey = useMemo(
    () => ["class", "jobBoardPosts", "authored", classId, userUid, statusFilterKey, limitCount || "all"],
    [classId, limitCount, statusFilterKey, userUid],
  );

  useEffect(() => {
    if (!classId || !userUid || !enabled) return undefined;

    const postsRef = collection(db, `classes/${classId}/jobPosts`);
    const q = query(
      postsRef,
      where("authorUid", "==", userUid),
      ...buildStatusClauses(JSON.parse(statusFilterKey)),
      orderBy("updatedAt", "desc"),
      ...(limitCount ? [limit(limitCount)] : []),
    );
    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        const posts = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));
        queryClient.setQueryData(queryKey, sortByUpdatedAt(posts));
      }),
      (error) => {
        if (!active) return;
        console.error("[useMyAuthoredJobBoardPostsQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, limitCount, queryClient, queryKey, statusFilterKey, userUid]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && userUid && enabled),
    staleTime: Infinity,
  });
};

export const useMyJobBoardPaymentsQuery = ({
  classId,
  userUid,
  enabled = true,
}) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["class", "jobBoardPayments", classId, userUid],
    [classId, userUid],
  );

  useEffect(() => {
    if (!classId || !userUid || !enabled) return undefined;

    const paymentsRef = collection(db, `classes/${classId}/jobPayments`);
    const q = query(paymentsRef, where("recipientUids", "array-contains", userUid));
    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        const payments = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));
        queryClient.setQueryData(queryKey, sortByUpdatedAt(payments));
      }),
      (error) => {
        if (!active) return;
        console.error("[useMyJobBoardPaymentsQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, queryClient, queryKey, userUid]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && userUid && enabled),
    staleTime: Infinity,
  });
};
