import { useEffect, useMemo, useState } from "react";
import { collection, documentId, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../../firebase";

export function mergeCanonicalMissionStates(mission, states = {}) {
  if (mission?.stateStorageVersion !== 2 || mission.type === "always") return mission;
  const completions = {};
  const submissionsIndex = {};
  Object.entries(states).forEach(([uid, state]) => {
    if (state?.kind !== "regular" || state.sourceStorageVersion !== 2 || state.studentUid !== uid ||
      state.missionId !== mission.id || state.classId !== mission.classId) return;
    if (state.completion) completions[state.studentUid] = state.completion;
    if (state.submissionId) submissionsIndex[state.studentUid] = state.submissionId;
  });
  // Rebuild derived display fields from authoritative states, never a stale
  // status summary left on the common mission document.
  const common = { ...mission };
  delete common.statusSummary;
  return { ...common, completions, submissionsIndex, _statesHydrated: true };
}

export function useCanonicalMissionStates({ classId, missions = [], studentUids = [], enabled = true, rosterReady = true }) {
  const missionKey = missions.filter((mission) => mission?.stateStorageVersion === 2 && mission.type !== "always")
    .map((mission) => mission.id).sort().join("\u0001");
  const studentKey = [...new Set(studentUids.filter(Boolean))].sort().join("\u0001");
  const [snapshotState, setSnapshotState] = useState({ key: "", data: {}, ready: false, error: null });
  const key = `${classId || ""}\u0002${missionKey}\u0002${studentKey}`;
  useEffect(() => {
    if (!enabled || !classId || !missionKey || !studentKey) return undefined;
    const pending = new Set();
    const stateMap = {};
    const subscriptions = [];
    const lifecycle = { active: true, error: null };
    const ids = missionKey.split("\u0001");
    for (const missionId of missionKey.split("\u0001")) {
      stateMap[missionId] = {};
    }
    for (const uid of studentKey.split("\u0001")) {
      for (let offset = 0; offset < ids.length; offset += 30) pending.add(`${uid}/${offset}`);
    }
    for (const uid of studentKey.split("\u0001")) {
      for (let offset = 0; offset < ids.length; offset += 30) {
        const chunk = ids.slice(offset, offset + 30);
        const stateQuery = query(collection(db, `classes/${classId}/students/${uid}/missionState`), where(documentId(), "in", chunk));
        subscriptions.push(onSnapshot(stateQuery, (snapshot) => {
          if (!lifecycle.active) return;
          chunk.forEach((id) => { delete stateMap[id][uid]; });
          snapshot.docs.forEach((state) => { stateMap[state.id][uid] = state.data(); });
          pending.delete(`${uid}/${offset}`);
          setSnapshotState({ key, data: Object.fromEntries(Object.entries(stateMap).map(([id, states]) => [id, { ...states }])), ready: pending.size === 0, error: lifecycle.error });
        }, (error) => {
          if (!lifecycle.active) return;
          lifecycle.error = error;
          pending.delete(`${uid}/${offset}`);
          setSnapshotState((current) => ({ ...current, key, ready: pending.size === 0, error }));
        }));
      }
    }
    return () => { lifecycle.active = false; subscriptions.forEach((unsubscribe) => unsubscribe()); };
  }, [classId, enabled, key, missionKey, studentKey]);
  const merged = useMemo(() => enabled ? missions.map((mission) => mergeCanonicalMissionStates(mission,
    snapshotState.key === key ? snapshotState.data[mission.id] : {})) : missions, [missions, snapshotState, key, enabled]);
  return {
    missions: merged,
    loading: Boolean(enabled && missionKey && (!rosterReady || (studentKey && (snapshotState.key !== key || !snapshotState.ready)))),
    error: snapshotState.key === key ? snapshotState.error : null,
  };
}
