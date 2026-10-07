import {
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../../../firebase";

const CASE_LIBRARY_SUMMARY_REF = doc(db, "sharedSummaries", "caseLibrary");

function getCaseLibraryReadStateRef(classId, uid) {
  return doc(db, "classes", classId, "caseLibraryReadStates", uid);
}

function getSafeReadTimestamp(value) {
  if (value instanceof Timestamp) {
    return value;
  }

  return Timestamp.fromDate(new Date());
}

function getDefaultUnreadSinceTimestamp() {
  return Timestamp.fromMillis(0);
}

function getCaseLibraryMarkerCutoff(data = {}) {
  if (data?.previousLastSeenAt instanceof Timestamp) {
    return data.previousLastSeenAt;
  }

  if (data?.lastSeenAt instanceof Timestamp) {
    return data.lastSeenAt;
  }

  return getDefaultUnreadSinceTimestamp();
}

function toMillis(value) {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  return 0;
}

export async function markCaseLibrarySeen({ classId, uid, path = "" }) {
  if (!classId || !uid) {
    return;
  }

  const readStateRef = getCaseLibraryReadStateRef(classId, uid);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(readStateRef);
    const previousLastSeenAt = snapshot.exists()
      ? getSafeReadTimestamp(snapshot.data()?.lastSeenAt)
      : getDefaultUnreadSinceTimestamp();

    transaction.set(
      readStateRef,
      {
        previousLastSeenAt,
        lastSeenAt: serverTimestamp(),
        lastSeenPath: String(path || "").trim(),
        updatedAt: serverTimestamp(),
        uid: String(uid),
      },
      { merge: true },
    );
  });
}

export function subscribeCaseLibraryNewMarkerCutoff({
  classId,
  uid,
  onChange,
  onError,
}) {
  if (!classId || !uid) {
    onChange?.(getDefaultUnreadSinceTimestamp());
    return () => {};
  }

  return onSnapshot(
    getCaseLibraryReadStateRef(classId, uid),
    (snapshot) => {
      const data = snapshot.exists() ? snapshot.data() || {} : {};
      const cutoff = getCaseLibraryMarkerCutoff(data);

      onChange?.(cutoff);
    },
    (error) => {
      onError?.(error);
      onChange?.(getDefaultUnreadSinceTimestamp());
    },
  );
}

export function subscribeCaseLibrarySectionUnread({
  classId,
  uid,
  onChange,
  onError,
}) {
  if (!classId || !uid) {
    onChange?.({ posts: false, requests: false });
    return () => {};
  }

  let cutoff = getDefaultUnreadSinceTimestamp();
  let latestPostCreatedAt = null;
  let latestRequestCreatedAt = null;

  const emit = () => {
    const cutoffMillis = toMillis(cutoff);
    onChange?.({
      posts: toMillis(latestPostCreatedAt) > cutoffMillis,
      requests: toMillis(latestRequestCreatedAt) > cutoffMillis,
    });
  };

  const unsubscribeReadState = onSnapshot(
    getCaseLibraryReadStateRef(classId, uid),
    (snapshot) => {
      cutoff = getCaseLibraryMarkerCutoff(snapshot.exists() ? snapshot.data() || {} : {});
      emit();
    },
    (error) => {
      cutoff = getDefaultUnreadSinceTimestamp();
      emit();
      onError?.(error);
    },
  );

  const unsubscribeSummary = onSnapshot(
    CASE_LIBRARY_SUMMARY_REF,
    (snapshot) => {
      const data = snapshot.exists() ? snapshot.data() || {} : {};
      latestPostCreatedAt = data?.latestPostCreatedAt || null;
      latestRequestCreatedAt = data?.latestRequestCreatedAt || null;
      emit();
    },
    (error) => {
      latestPostCreatedAt = null;
      latestRequestCreatedAt = null;
      emit();
      onError?.(error);
    },
  );

  return () => {
    unsubscribeReadState();
    unsubscribeSummary();
  };
}

export function subscribeCaseLibraryUnreadCount({
  classId,
  uid,
  onChange,
  onError,
}) {
  if (!classId || !uid) {
    onChange?.(0);
    return () => {};
  }

  let latestSeenAt = getDefaultUnreadSinceTimestamp();
  let latestActivityAt = null;

  const emit = () => {
    const hasUnread = toMillis(latestActivityAt) > toMillis(latestSeenAt);
    onChange?.(hasUnread ? 1 : 0);
  };

  const unsubscribeReadState = onSnapshot(
    getCaseLibraryReadStateRef(classId, uid),
    (snapshot) => {
      latestSeenAt = snapshot.exists()
        ? getSafeReadTimestamp(snapshot.data()?.lastSeenAt)
        : getDefaultUnreadSinceTimestamp();
      emit();
    },
    (error) => {
      onError?.(error);
      latestSeenAt = getDefaultUnreadSinceTimestamp();
      emit();
    },
  );

  const unsubscribeSummary = onSnapshot(
    CASE_LIBRARY_SUMMARY_REF,
    (snapshot) => {
      latestActivityAt = snapshot.exists()
        ? snapshot.data()?.latestActivityAt || null
        : null;
      emit();
    },
    (error) => {
      latestActivityAt = null;
      emit();
      onError?.(error);
    },
  );

  return () => {
    unsubscribeReadState();
    unsubscribeSummary();
  };
}
