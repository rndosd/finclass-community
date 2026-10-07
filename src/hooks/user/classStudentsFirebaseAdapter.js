import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "../../firebase";
import {
  createSnapshotTelemetryModeTracker,
  trackFirestorePayload,
} from "../../utils/firestoreTelemetry";
import { beginFirestoreSubscriptionDebug } from "../../utils/firestoreSubscriptionDebug";

const realtimeStudentRosterRegistry = new Map();

const buildStudentsQuery = (classId) =>
  query(collection(db, "classes", classId, "students"), orderBy("studentNumber", "asc"));

const normalizeStudents = (snapshot) =>
  snapshot.docs.map((studentDoc) => ({
    uid: studentDoc.id,
    ...studentDoc.data(),
  }));

const publishStudentsToQueryClients = (classId, students, queryClients, primeStudentCaches) => {
  queryClients.forEach((_count, queryClient) => {
    primeStudentCaches(queryClient, classId, students);
  });
};

const getRealtimeRosterEntry = (classId) => {
  let entry = realtimeStudentRosterRegistry.get(classId);
  if (!entry) {
    entry = {
      latestStudents: null,
      queryClients: new Map(),
      pendingQueries: new Set(),
      subscribers: 0,
      unsubscribe: null,
      subscriptionDebug: null,
      telemetry: {
        source: "useClassStudents",
        sourceGroup: "page",
        role: "unknown",
      },
    };
    entry.firstSnapshot = new Promise((resolve, reject) => {
      entry.resolveFirstSnapshot = resolve;
      entry.rejectFirstSnapshot = reject;
    });
    // The persistent listener may have no pending query when an error arrives.
    entry.firstSnapshot.catch(() => {});
    realtimeStudentRosterRegistry.set(classId, entry);
  }
  return entry;
};

const ensureRealtimeRosterSubscription = (classId, entry, primeStudentCaches) => {
  if (entry.unsubscribe) return;

  const getTelemetryMode = createSnapshotTelemetryModeTracker();
  entry.subscriptionDebug = beginFirestoreSubscriptionDebug({
    source: entry.telemetry?.source || "useClassStudents",
    pathKey: "classes/{classId}/students",
    classId,
    role: entry.telemetry?.role,
  });
  entry.unsubscribe = onSnapshot(
    buildStudentsQuery(classId), { includeMetadataChanges: true },
    (snapshot) => {
      if (realtimeStudentRosterRegistry.get(classId) !== entry) return;
      entry.subscriptionDebug?.recordSnapshot(snapshot);
      const students = normalizeStudents(snapshot);
      entry.latestStudents = students;
      entry.resolveFirstSnapshot(students);
      trackFirestorePayload({
        classId,
        source: entry.telemetry?.source || "useClassStudents",
        sourceGroup: entry.telemetry?.sourceGroup || "page",
        pathKey: "classes/{classId}/students",
        mode: getTelemetryMode(snapshot),
        rows: students,
        snapshot,
      });
      publishStudentsToQueryClients(classId, students, entry.queryClients, primeStudentCaches);
    },
    (error) => {
      if (realtimeStudentRosterRegistry.get(classId) !== entry) return;
      entry.rejectFirstSnapshot(error);
      entry.subscriptionDebug?.recordError(error);
      console.error("[useClassStudents] roster subscribe error:", error);
    },
  );
};

export function retainFirebaseStudentRosterSubscription(
  queryClient,
  classId,
  primeStudentCaches,
  telemetry = {},
) {
  const entry = getRealtimeRosterEntry(classId);
  entry.subscribers += 1;
  entry.queryClients.set(queryClient, (entry.queryClients.get(queryClient) || 0) + 1);
  if (telemetry.sourceGroup === "global") {
    entry.telemetry = {
      source: telemetry.source || "useClassStudents",
      sourceGroup: "global",
      role: telemetry.role || "unknown",
    };
  }

  if (Array.isArray(entry.latestStudents)) {
    primeStudentCaches(queryClient, classId, entry.latestStudents);
  }

  ensureRealtimeRosterSubscription(classId, entry, primeStudentCaches);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const currentEntry = realtimeStudentRosterRegistry.get(classId);
    if (currentEntry !== entry) return;

    const remaining = (currentEntry.queryClients.get(queryClient) || 0) - 1;
    if (remaining > 0) currentEntry.queryClients.set(queryClient, remaining);
    else {
      currentEntry.queryClients.delete(queryClient);
      currentEntry.pendingQueries.forEach((pending) => {
        if (pending.queryClient === queryClient) pending.cancel();
      });
    }
    currentEntry.subscribers -= 1;
    if (currentEntry.subscribers > 0) {
      return;
    }

    realtimeStudentRosterRegistry.delete(classId);
    currentEntry.rejectFirstSnapshot(new DOMException("Roster subscription released", "AbortError"));
    currentEntry.unsubscribe?.();
    currentEntry.subscriptionDebug?.stop();
  };
}

export async function fetchFirebaseClassStudents({
  classId,
  telemetrySource,
  telemetrySourceGroup,
}) {
  const snapshot = await getDocs(buildStudentsQuery(classId));
  const students = normalizeStudents(snapshot);
  trackFirestorePayload({
    classId,
    source: telemetrySource,
    sourceGroup: telemetrySourceGroup,
    pathKey: "classes/{classId}/students",
    mode: "getDocs",
    rows: students,
    snapshot,
  });
  return students;
}

// Reuse the first live snapshot instead of a parallel full-roster getDocs read.
// Queries do not retain the listener: disabling the last UI consumer must stop it
// even when the first server response has not arrived yet.
export async function waitForFirebaseClassStudents({
  classId, queryClient, signal,
}) {
  if (signal?.aborted) throw new DOMException("Roster query cancelled", "AbortError");
  const entry = getRealtimeRosterEntry(classId);
  let pending;
  let onAbort;
  try {
    if (Array.isArray(entry.latestStudents)) return entry.latestStudents;
    const cancelled = new Promise((_resolve, reject) => {
      onAbort = () => reject(new DOMException("Roster query cancelled", "AbortError"));
      pending = { queryClient, cancel: onAbort };
      entry.pendingQueries.add(pending);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    await Promise.race([entry.firstSnapshot, cancelled]);
    return entry.latestStudents;
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    entry.pendingQueries.delete(pending);
  }
}
