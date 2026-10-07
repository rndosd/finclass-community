import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

const DEFAULT_SAMPLE_RATE = Number(
  process.env.REACT_APP_FIRESTORE_TELEMETRY_SAMPLE_RATE || 0.1,
);
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_BUFFER_EVENTS = 80;
const MIN_FLUSH_INTERVAL_MS = 60 * 1000;

const recordClientFirestoreTelemetry = httpsCallable(
  functions,
  "recordClientFirestoreTelemetry",
);

let buffer = new Map();
let lastFlushAt = 0;
let flushTimerId = null;
let isFlushing = false;
let sessionSampleRate = null;

const clampSampleRate = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(0.001, Math.min(1, numeric));
};

const getSampleRate = () => {
  if (sessionSampleRate !== null) return sessionSampleRate;
  sessionSampleRate = clampSampleRate(DEFAULT_SAMPLE_RATE);
  return sessionSampleRate;
};

const shouldSample = () => {
  const sampleRate = getSampleRate();
  return sampleRate > 0 && Math.random() < sampleRate;
};

const getRoute = () => {
  if (typeof window === "undefined") return "/";
  const pathname = String(window.location?.pathname || "/").trim() || "/";
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === "manage"
    ? "/manage/" + (parts[1] || "")
    : "/" + (parts[0] || "");
};

const estimateJsonBytes = (value) => {
  try {
    const text = JSON.stringify(value ?? null);
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(text).length;
    }
    return text.length;
  } catch (_error) {
    return 0;
  }
};

const extractDocs = (snapshotOrRows) => {
  if (!snapshotOrRows) return [];
  if (Array.isArray(snapshotOrRows)) return snapshotOrRows;
  if (Array.isArray(snapshotOrRows.docs)) {
    return snapshotOrRows.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(typeof docSnap.data === "function" ? docSnap.data() : {}),
    }));
  }
  if (typeof snapshotOrRows.data === "function") {
    const data =
      snapshotOrRows.exists?.() === false ? null : snapshotOrRows.data();
    return data ? [{ id: snapshotOrRows.id, ...data }] : [];
  }
  return [snapshotOrRows];
};

const normalizeSourceGroup = (value) =>
  value === "global" ? "global" : "page";

// A sampled event is measured only after selection. No document contents leave the browser.
const collectFirestorePayload = ({
  classId,
  sourceGroup = "page",
  mode = "snapshot",
  rows = null,
  snapshot = null,
}) => {
  if (
    !classId ||
    mode === "snapshot_unchanged" ||
    snapshot?.metadata?.fromCache ||
    snapshot?.metadata?.hasPendingWrites ||
    !shouldSample()
  )
    return;
  let docs;
  let readCount;
  if (
    snapshot &&
    mode.startsWith("snapshot") &&
    typeof snapshot.docChanges === "function"
  ) {
    const changes = (
      mode === "snapshot_initial"
        ? snapshot.docs.map((doc) => ({ type: "added", doc }))
        : snapshot.docChanges()
    ).filter(
      (change) =>
        change.type !== "removed" && !change.doc.metadata?.hasPendingWrites,
    );
    docs = changes.map((change) => ({
      id: change.doc.id,
      ...change.doc.data(),
    }));
    if (!docs.length && snapshot.size > 0) return;
    // Removals are excluded: deletes are not billed reads, query exits cannot be distinguished here.
    if (!docs.length && mode === "snapshot_update") return;
    readCount = Math.max(1, docs.length);
  } else {
    docs = extractDocs(snapshot || rows);
    readCount = Math.max(1, docs.length);
  }
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const route =
    normalizeSourceGroup(sourceGroup) === "global" ? "/_shared" : getRoute();
  const key = JSON.stringify([classId, date, route]);
  if (!buffer.has(key) && buffer.size >= MAX_BUFFER_EVENTS) return;
  const event = buffer.get(key) || {
    classId: String(classId),
    date,
    route,
    approxBytes: 0,
    docCount: 0,
    eventCount: 0,
    sampleRate: getSampleRate(),
  };
  event.approxBytes += docs.length ? estimateJsonBytes(docs) : 0;
  event.docCount += readCount;
  event.eventCount += 1;
  buffer.set(key, event);
  scheduleFlush();
};

// Instrumentation must never interrupt query results or UI callbacks.
export const trackFirestorePayload = (event) => {
  try {
    collectFirestorePayload(event);
  } catch (_error) {
    // Best effort: drop a malformed sample without exposing document contents.
  }
};

// Compare document values without JSON serialization or retaining a global document registry.
// Metadata confirmations still reach UI consumers; only their telemetry estimate is skipped.
const sameDocumentValue = (left, right) => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (left instanceof Date || right instanceof Date)
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  if ((left.type === "document" && left.firestore) || (right.type === "document" && right.firestore))
    return left.type === right.type && left.firestore === right.firestore && left.path === right.path;
  if (typeof left.isEqual === "function") {
    try {
      return left.isEqual(right);
    } catch (_error) {
      return false;
    }
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(
    (key) => Object.prototype.hasOwnProperty.call(right, key) && sameDocumentValue(left[key], right[key]),
  );
};

export const createSnapshotTelemetryModeTracker = () => {
  let hasReceivedSnapshot = false;
  let lastDocumentSnapshot = null;

  const getMode = (snapshot) => {
    if (snapshot?.metadata?.fromCache || snapshot?.metadata?.hasPendingWrites)
      return "snapshot_cache";
    if (typeof snapshot?.data === "function" && typeof snapshot?.docChanges !== "function") {
      if (
        lastDocumentSnapshot &&
        lastDocumentSnapshot.id === snapshot.id &&
        lastDocumentSnapshot.exists?.() === snapshot.exists?.() &&
        sameDocumentValue(lastDocumentSnapshot.data(), snapshot.data())
      ) return "snapshot_unchanged";
      lastDocumentSnapshot = snapshot;
    }
    const mode = hasReceivedSnapshot ? "snapshot_update" : "snapshot_initial";
    hasReceivedSnapshot = true;
    return mode;
  };
  return (snapshot) => {
    try {
      return getMode(snapshot);
    } catch (_error) {
      return "snapshot_unchanged";
    }
  };
};

// This measures logical consumer deliveries, not SDK watch targets or wire bytes.
// Keep each observer's initial state separate, including multi-query consumers.
export const withFirestoreSnapshotTelemetry = ({ classId, sourceGroup = "page" }, onNext) => {
  const getMode = createSnapshotTelemetryModeTracker();
  return (snapshot) => {
    trackFirestorePayload({ classId, sourceGroup, snapshot, mode: getMode(snapshot) });
    onNext(snapshot);
  };
};

export const flushFirestoreTelemetry = async () => {
  if (isFlushing || buffer.size === 0) return;
  if (Date.now() - lastFlushAt < MIN_FLUSH_INTERVAL_MS) {
    scheduleFlush();
    return;
  }
  const events = [...buffer.values()];
  buffer = new Map();
  isFlushing = true;
  lastFlushAt = Date.now();
  if (flushTimerId) {
    window.clearTimeout(flushTimerId);
    flushTimerId = null;
  }
  try {
    await recordClientFirestoreTelemetry({ version: 2, events });
  } catch (_error) {
    // Best effort: failed samples are dropped, never retried at the expense of product flows.
  } finally {
    isFlushing = false;
    if (buffer.size > 0) scheduleFlush();
  }
};

const scheduleFlush = () => {
  if (flushTimerId || typeof window === "undefined") return;
  flushTimerId = window.setTimeout(() => {
    flushTimerId = null;
    void flushFirestoreTelemetry();
  }, FLUSH_INTERVAL_MS);
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void flushFirestoreTelemetry();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushFirestoreTelemetry();
    }
  });
}
