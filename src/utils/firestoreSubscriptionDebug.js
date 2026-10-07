const MAX_RECENT_SUBSCRIPTIONS = 250;

const activeSubscriptions = new Map();
const recentSubscriptions = [];
let nextSubscriptionId = 1;

const NOOP_TRACKER = Object.freeze({
  recordSnapshot: () => {},
  recordError: () => {},
  stop: () => {},
});

const isLocalDevelopmentHost = () => {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(
    String(window.location?.hostname || "").toLowerCase(),
  );
};

const isDebugEnabled = () =>
  process.env.NODE_ENV === "development" ||
  process.env.REACT_APP_FIRESTORE_SUBSCRIPTION_DEBUG === "true" ||
  isLocalDevelopmentHost();

const getCurrentRoute = () => {
  if (typeof window === "undefined") return "/";
  return String(window.location?.pathname || "/").slice(0, 120);
};

const normalizeText = (value, fallback, maxLength) =>
  String(value || fallback).trim().slice(0, maxLength) || fallback;

const getSnapshotDocumentCount = (snapshot) => {
  if (Array.isArray(snapshot?.docs)) return snapshot.docs.length;
  if (typeof snapshot?.exists === "function") return snapshot.exists() ? 1 : 0;
  return 0;
};

const getDuplicateGroupSize = (entry) => {
  let count = 0;
  activeSubscriptions.forEach((activeEntry) => {
    if (activeEntry.duplicateKey === entry.duplicateKey) count += 1;
  });
  return count;
};

const toPublicEntry = (entry, now = Date.now()) => ({
  id: entry.id,
  source: entry.source,
  pathKey: entry.pathKey,
  route: entry.route,
  role: entry.role,
  classId: entry.classId,
  startedAt: new Date(entry.startedAt).toISOString(),
  durationMs: Math.max(0, now - entry.startedAt),
  snapshotCount: entry.snapshotCount,
  lastDocumentCount: entry.lastDocumentCount,
  observedDocumentCount: entry.observedDocumentCount,
  errorCount: entry.errorCount,
  lastError: entry.lastError,
  duplicateGroupSize: getDuplicateGroupSize(entry),
});

export const getFirestoreSubscriptionDebugSnapshot = () => {
  const now = Date.now();
  return {
    active: Array.from(activeSubscriptions.values()).map((entry) =>
      toPublicEntry(entry, now),
    ),
    recent: recentSubscriptions.map((entry) => ({ ...entry })),
  };
};

export const printFirestoreSubscriptionDebugSnapshot = () => {
  const snapshot = getFirestoreSubscriptionDebugSnapshot();
  if (typeof console !== "undefined") {
    console.groupCollapsed?.(
      `[Firestore subscriptions] active ${snapshot.active.length}`,
    );
    console.table?.(snapshot.active);
    console.groupEnd?.();
  }
  return snapshot;
};

const installBrowserDebugApi = () => {
  if (typeof window === "undefined" || !isDebugEnabled()) return;
  if (window.finclassFirestoreSubscriptions) return;

  const inspectSubscriptions = () => printFirestoreSubscriptionDebugSnapshot();
  inspectSubscriptions.getSnapshot = getFirestoreSubscriptionDebugSnapshot;
  window.finclassFirestoreSubscriptions = inspectSubscriptions;
};

const writeDebugEvent = (event, entry) => {
  if (typeof console === "undefined" || process.env.NODE_ENV === "test") return;
  const payload = {
    event,
    id: entry.id,
    source: entry.source,
    pathKey: entry.pathKey,
    route: entry.route,
    role: entry.role,
    duplicateGroupSize: getDuplicateGroupSize(entry),
    snapshotCount: entry.snapshotCount,
  };
  console.debug("[Firestore subscription]", JSON.stringify(payload));
};

export const beginFirestoreSubscriptionDebug = ({
  source,
  pathKey,
  classId = "",
  role = "unknown",
  route,
} = {}) => {
  if (!isDebugEnabled()) return NOOP_TRACKER;

  installBrowserDebugApi();

  const id = `firestore-subscription-${nextSubscriptionId}`;
  nextSubscriptionId += 1;

  const entry = {
    id,
    source: normalizeText(source, "unknown", 100),
    pathKey: normalizeText(pathKey, "unknown", 180),
    route: normalizeText(route || getCurrentRoute(), "/", 120),
    role: normalizeText(role, "unknown", 40),
    classId: normalizeText(classId, "unknown", 100),
    startedAt: Date.now(),
    snapshotCount: 0,
    lastDocumentCount: 0,
    observedDocumentCount: 0,
    errorCount: 0,
    lastError: "",
  };
  entry.duplicateKey = [entry.classId, entry.pathKey, entry.route].join("|");
  activeSubscriptions.set(id, entry);
  writeDebugEvent("start", entry);

  let stopped = false;
  return {
    recordSnapshot(snapshot) {
      if (stopped) return;
      const documentCount = getSnapshotDocumentCount(snapshot);
      entry.snapshotCount += 1;
      entry.lastDocumentCount = documentCount;
      entry.observedDocumentCount += documentCount;
    },
    recordError(error) {
      if (stopped) return;
      entry.errorCount += 1;
      entry.lastError = normalizeText(error?.message || error, "unknown", 200);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      activeSubscriptions.delete(id);
      writeDebugEvent("stop", entry);
      recentSubscriptions.unshift({
        ...toPublicEntry(entry),
        stoppedAt: new Date().toISOString(),
      });
      if (recentSubscriptions.length > MAX_RECENT_SUBSCRIPTIONS) {
        recentSubscriptions.length = MAX_RECENT_SUBSCRIPTIONS;
      }
    },
  };
};

export const resetFirestoreSubscriptionDebug = () => {
  activeSubscriptions.clear();
  recentSubscriptions.length = 0;
  nextSubscriptionId = 1;
};
