import { collection, getDocs, onSnapshot, or, query, where } from "firebase/firestore";
import { db } from "../../../firebase";
import { normalizeMission } from "../utils/normalizeMission";

export function missionDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function sortMissionCatalog(missions) {
  const activity = (mission) => Math.max(...[mission.updatedAt, mission.createdAt, mission.timeWindow?.start]
    .map((value) => missionDate(value)?.getTime() || 0));
  return [...missions].sort((a, b) => activity(b) - activity(a));
}

// Canonical roots contain common task settings only. Retain these and recurring
// tasks, but avoid downloading historical legacy roots with class-wide states.
// Older roots used both timestamps and ISO date strings.
export function missionCatalogQueries(classId, cutoff, { includeLegacyCatalog = false } = {}) {
  const ref = collection(db, `classes/${classId}/missions`);
  // Unmigrated classes can have active roots with missing (not null) dates.
  // Firestore cannot query for a missing field. Preserve this compatibility
  // path until the class has explicitly completed the storage migration.
  if (includeLegacyCatalog) return [ref];
  const filters = [where("type", "==", "always"), where("stateStorageVersion", "==", 2),
    where("timeWindow.end", "==", null), where("endDate", "==", null)];
  // Separate inequality fields: a combined multi-field query implicitly orders
  // on every field and drops legacy documents where one date field is missing.
  return [query(ref, or(...filters)), ...["updatedAt", "createdAt", "timeWindow.start", "timeWindow.end", "startDate", "endDate"]
    .map((field) => query(ref, or(where(field, ">=", cutoff), where(field, ">=", cutoff.toISOString()))))];
}

export function combineCatalogSnapshots(snapshots, classId, selfUid) {
  const docs = new Map();
  for (const snapshot of snapshots) for (const item of snapshot.docs) docs.set(item.id, item);
  return normalizeCatalogSnapshot({ docs: [...docs.values()] }, classId, selfUid);
}

export async function fetchMissionCatalog(classId, cutoff, selfUid, options) {
  return combineCatalogSnapshots(await Promise.all(missionCatalogQueries(classId, cutoff, options).map((ref) => getDocs(ref))), classId, selfUid);
}

export function subscribeMissionCatalog(classId, cutoff, selfUid, onNext, onError, options) {
  let active = true;
  const snapshots = new Map();
  const queries = missionCatalogQueries(classId, cutoff, options);
  const stops = queries.map((ref, index) => onSnapshot(ref, (snapshot) => {
    if (!active) return;
    snapshots.set(index, snapshot);
    if (snapshots.size === queries.length) onNext(combineCatalogSnapshots(snapshots.values(), classId, selfUid));
  }, (error) => { if (active) onError(error); }));
  return () => { active = false; stops.forEach((stop) => stop()); };
}

export function normalizeCatalogSnapshot(snapshot, classId, selfUid = null) {
  return sortMissionCatalog(snapshot.docs.map((item) => normalizeMission(
    { ...item.data(), id: item.id, classId }, { selfUid },
  )));
}
