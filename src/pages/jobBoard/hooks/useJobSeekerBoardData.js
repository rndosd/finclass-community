import useLiveQueryStatus from "./useLiveQueryStatus";
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collection,
  collectionGroup,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../../firebase";
import { withFirestoreSnapshotTelemetry } from "../../../utils/firestoreTelemetry";

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const sortByUpdatedAt = (rows = []) =>
  [...rows].sort((left, right) => {
    const leftTime = toMillis(left.updatedAt || left.createdAt);
    const rightTime = toMillis(right.updatedAt || right.createdAt);
    return rightTime - leftTime;
  });

const mapSnapshotRows = (snapshot) =>
  snapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    ...docSnapshot.data(),
  }));

// Firestore IN filters are sets; retain the existing first-ten-value limit.
const statusFilterIdentity = (statusIn) => JSON.stringify(
  Array.isArray(statusIn) ? [...new Set(statusIn.slice(0, 10))].sort() : [],
);

const buildStatusClauses = (statusIn) =>
  Array.isArray(statusIn) && statusIn.length > 0
    ? [where("status", "in", statusIn.slice(0, 10))]
    : [];

export const useJobSeekerServicesQuery = ({ classId, enabled = true }) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["class", "jobSeekerServices", classId], [classId]);

  const { retryCount, onSuccess, onError, ...liveStatus } = useLiveQueryStatus(queryKey, Boolean(classId && enabled));

  useEffect(() => {
    if (!classId || !enabled) return undefined;

    const servicesRef = collection(db, `classes/${classId}/jobSeekerServices`);
    const q = query(servicesRef, orderBy("updatedAt", "desc"));
    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        onSuccess();
        queryClient.setQueryData(queryKey, sortByUpdatedAt(mapSnapshotRows(snapshot)));
      }),
      (error) => {
        if (!active) return;
        onError(error);
        console.error("[useJobSeekerServicesQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, queryClient, queryKey, retryCount, onSuccess, onError]);

  const result = useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && enabled),
    staleTime: Infinity,
  });
  return { ...result, ...liveStatus };
};

export const useJobSeekerCategoriesQuery = ({ classId, enabled = true }) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["class", "jobSeekerCategories", classId], [classId]);

  useEffect(() => {
    if (!classId || !enabled) return undefined;

    const categoriesRef = collection(db, `classes/${classId}/jobSeekerCategories`);
    const q = query(categoriesRef, orderBy("order", "asc"));
    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        queryClient.setQueryData(queryKey, mapSnapshotRows(snapshot));
      }),
      (error) => {
        if (!active) return;
        console.error("[useJobSeekerCategoriesQuery] subscribe error:", error);
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

export const useMyJobSeekerServicesQuery = ({
  classId,
  userUid,
  enabled = true,
  limitCount = null,
  statusIn = null,
}) => {
  const queryClient = useQueryClient();
  const statusFilterKey = statusFilterIdentity(statusIn);
  const queryKey = useMemo(
    () => ["class", "myJobSeekerServices", classId, userUid, statusFilterKey, limitCount || "all"],
    [classId, limitCount, statusFilterKey, userUid],
  );

  useEffect(() => {
    if (!classId || !userUid || !enabled) return undefined;

    const servicesRef = collection(db, `classes/${classId}/jobSeekerServices`);
    const q = query(
      servicesRef,
      where("ownerUid", "==", userUid),
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
        queryClient.setQueryData(queryKey, sortByUpdatedAt(mapSnapshotRows(snapshot)));
      }),
      (error) => {
        if (!active) return;
        console.error("[useMyJobSeekerServicesQuery] subscribe error:", error);
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

export const useJobSeekerServiceRequestsQuery = ({
  classId,
  serviceId,
  enabled = true,
}) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["class", "jobSeekerServiceRequests", classId, serviceId],
    [classId, serviceId],
  );

  useEffect(() => {
    if (!classId || !serviceId || !enabled) return undefined;

    const requestsRef = collection(
      db,
      `classes/${classId}/jobSeekerServices/${serviceId}/requests`,
    );
    const q = query(requestsRef, orderBy("updatedAt", "desc"));
    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        queryClient.setQueryData(queryKey, sortByUpdatedAt(mapSnapshotRows(snapshot)));
      }),
      (error) => {
        if (!active) return;
        console.error("[useJobSeekerServiceRequestsQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, queryClient, queryKey, serviceId]);

  return useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && serviceId && enabled),
    staleTime: Infinity,
  });
};

export const useMySentJobSeekerRequestsQuery = ({
  classId,
  userUid,
  enabled = true,
  limitCount = null,
  statusIn = null,
}) => {
  const queryClient = useQueryClient();
  const statusFilterKey = statusFilterIdentity(statusIn);
  const queryKey = useMemo(
    () => ["class", "jobSeekerRequests", "sent", classId, userUid, statusFilterKey, limitCount || "all"],
    [classId, limitCount, statusFilterKey, userUid],
  );

  const { retryCount, onSuccess, onError, ...liveStatus } = useLiveQueryStatus(queryKey, Boolean(classId && userUid && enabled));

  useEffect(() => {
    if (!classId || !userUid || !enabled) return undefined;

    const q = query(
      collectionGroup(db, "requests"),
      where("classId", "==", classId),
      where("requesterUid", "==", userUid),
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
        queryClient.setQueryData(queryKey, sortByUpdatedAt(mapSnapshotRows(snapshot)));
      }),
      (error) => {
        if (!active) return;
        onError(error);
        console.error("[useMySentJobSeekerRequestsQuery] subscribe error:", error);
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

export const useClassJobSeekerRequestsQuery = ({ classId, enabled = true }) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["class", "jobSeekerRequests", "all", classId], [classId]);

  const { retryCount, onSuccess, onError, ...liveStatus } = useLiveQueryStatus(queryKey, Boolean(classId && enabled));

  useEffect(() => {
    if (!classId || !enabled) return undefined;

    const q = query(
      collectionGroup(db, "requests"),
      where("classId", "==", classId),
      orderBy("updatedAt", "desc"),
    );
    let active = true;
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        onSuccess();
        queryClient.setQueryData(queryKey, sortByUpdatedAt(mapSnapshotRows(snapshot)));
      }),
      (error) => {
        if (!active) return;
        onError(error);
        console.error("[useClassJobSeekerRequestsQuery] subscribe error:", error);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [classId, enabled, queryClient, queryKey, retryCount, onSuccess, onError]);

  const result = useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
    initialData: [],
    enabled: Boolean(classId && enabled),
    staleTime: Infinity,
  });
  return { ...result, ...liveStatus };
};

export const useMyReceivedJobSeekerRequestsQuery = ({
  classId,
  userUid,
  enabled = true,
  limitCount = null,
  statusIn = null,
}) => {
  const queryClient = useQueryClient();
  const statusFilterKey = statusFilterIdentity(statusIn);
  const queryKey = useMemo(
    () => ["class", "jobSeekerRequests", "received", classId, userUid, statusFilterKey, limitCount || "all"],
    [classId, limitCount, statusFilterKey, userUid],
  );

  const { retryCount, onSuccess, onError, ...liveStatus } = useLiveQueryStatus(queryKey, Boolean(classId && userUid && enabled));

  useEffect(() => {
    if (!classId || !userUid || !enabled) return undefined;

    const q = query(
      collectionGroup(db, "requests"),
      where("classId", "==", classId),
      where("providerUid", "==", userUid),
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
        queryClient.setQueryData(queryKey, sortByUpdatedAt(mapSnapshotRows(snapshot)));
      }),
      (error) => {
        if (!active) return;
        onError(error);
        console.error("[useMyReceivedJobSeekerRequestsQuery] subscribe error:", error);
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
