import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import {
  createSnapshotTelemetryModeTracker,
  trackFirestorePayload,
} from "../../utils/firestoreTelemetry";

const OPEN_SAVINGS_STATUSES = ["pending", "active"];
const OPEN_LOAN_STATUSES = ["pending", "ongoing", "active"];

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

export function retainFirebaseBankUserData({
  classId,
  uid,
  queryClient,
  savingsKey,
  loansKey,
  savingsMode,
  loansMode,
  onLoaded,
  onError = () => {},
  onSuccess = () => {},
}) {
  const savingsRef = query(
    collection(db, `classes/${classId}/students/${uid}/savings`),
    where("status", "in", OPEN_SAVINGS_STATUSES),
  );
  const loansRef = query(
    collection(db, `classes/${classId}/students/${uid}/loans`),
    where("status", "in", OPEN_LOAN_STATUSES),
  );
  let isCancelled = false;
  const unsubscribers = [];

  const markLoaded = (kind) => {
    if (isCancelled) return;
    onLoaded(kind);
  };
  const updateQueryData = (key, snap, kind, telemetryMode) => {
    if (isCancelled) return;
    const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    trackFirestorePayload({
      classId,
      source: `useBankUser.${kind}`,
      sourceGroup: "page",
      pathKey: `classes/{classId}/students/{uid}/${kind}`,
      mode: telemetryMode,
      rows,
      snapshot: snap,
    });
    queryClient.setQueryData(
      key,
      sortByCreatedAtDesc(rows),
    );
    onSuccess(kind);
  };
  const handleError = (kind) => {
    if (isCancelled) return;
    onError(kind);
    markLoaded(kind);
  };
  const subscribeOrFetch = (kind, mode, ref, key) => {
    if (mode === "realtime") {
      const getTelemetryMode = createSnapshotTelemetryModeTracker();
      return onSnapshot(ref, { includeMetadataChanges: true },
        (snap) => {
        updateQueryData(
          key,
          snap,
          kind,
          typeof getTelemetryMode === "function" ? getTelemetryMode(snap) : "snapshot",
        );
        markLoaded(kind);
      }, () => handleError(kind));
    }

    if (mode === "fetch") {
      void getDocs(ref)
        .then((snap) => {
          if (isCancelled) return;
          updateQueryData(key, snap, kind, "getDocs");
        })
        .catch(() => handleError(kind))
        .finally(() => {
          markLoaded(kind);
        });
    }

    return null;
  };

  const savingsUnsubscribe = subscribeOrFetch("savings", savingsMode, savingsRef, savingsKey);
  const loansUnsubscribe = subscribeOrFetch("loans", loansMode, loansRef, loansKey);

  if (typeof savingsUnsubscribe === "function") {
    unsubscribers.push(savingsUnsubscribe);
  }
  if (typeof loansUnsubscribe === "function") {
    unsubscribers.push(loansUnsubscribe);
  }

  return () => {
    isCancelled = true;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}
