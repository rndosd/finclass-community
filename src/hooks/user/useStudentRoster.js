import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase";
import { useClassStudents } from "./useClassStudents";
import { createSnapshotTelemetryModeTracker, trackFirestorePayload } from "../../utils/firestoreTelemetry";

const EMPTY = [];
const streams = new Map();
const pickRoster = (item) => {
  const data = item.data();
  const result = { uid: item.id };
  for (const key of ["name", "displayName", "studentName", "nickname", "studentNumber", "role"])
    if (data[key] !== undefined) result[key] = data[key];
  return result;
};
function retainRoster(classId, observer) {
  let entry = streams.get(classId);
  if (!entry) {
    entry = { observers: new Set(), value: { data: undefined, error: null } };
    streams.set(classId, entry);
  }
  entry.observers.add(observer);
  observer(entry.value);
  if (!entry.stop) {
    const mode = createSnapshotTelemetryModeTracker();
    entry.stop = onSnapshot(query(collection(db, "classes", classId, "studentRoster"), orderBy("studentNumber", "asc")),
      { includeMetadataChanges: true }, (snapshot) => {
        if (streams.get(classId) !== entry) return;
        trackFirestorePayload({ classId, sourceGroup: "global", snapshot, mode: mode(snapshot) });
        entry.value = { data: snapshot.docs.map(pickRoster), error: null };
        entry.observers.forEach((next) => next(entry.value));
      }, (error) => {
        if (streams.get(classId) !== entry) return;
        entry.value = { data: undefined, error };
        entry.observers.forEach((next) => next(entry.value));
      });
  }
  return () => {
    entry.observers.delete(observer);
    if (entry.observers.size === 0 && streams.get(classId) === entry) {
      streams.delete(classId);
      entry.stop?.();
    }
  };
}
// Readiness is server-owned and set only after a verified backfill.
// Legacy classes keep their existing full roster; the two streams never run together here.
export function useStudentRoster(classId, { enabled = true, version = 0, ready = true } = {}) {
  const projected = Number(version) === 1;
  const legacy = useClassStudents(classId, { enabled: enabled && ready && !projected, realtime: true,
    telemetry: { source: "UserContext.legacyRoster", sourceGroup: "global" } });
  const scope = useMemo(() => ({ classId, enabled, projected, ready }), [classId, enabled, projected, ready]);
  const [state, setState] = useState({ scope: null, data: undefined, error: null });
  useEffect(() => {
    if (!enabled || !ready || !classId || !projected) return undefined;
    return retainRoster(classId, (value) => setState({ scope, ...value }));
  }, [classId, enabled, projected, ready, scope]);
  if (!enabled || !classId) return { data: EMPTY, isLoading: false, isFetching: false, error: null };
  if (!ready) return { data: EMPTY, isLoading: true, isFetching: false, error: null };
  if (!projected) return legacy;
  const current = state.scope === scope ? state : {};
  return { data: current.data || EMPTY, error: current.error || null,
    isLoading: !current.data && !current.error, isFetching: !current.data && !current.error };
}
