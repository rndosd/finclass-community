import { useEffect, useMemo, useState } from "react";
import { collection, documentId, onSnapshot, query, where } from "firebase/firestore";
import dayjs from "dayjs";
import { db } from "../../../firebase";
import { fetchSelfhostMissionList, getMissionReadProvider } from "../services/missionReadService";
import { useCanonicalMissionStates } from "./useCanonicalMissionStates";
import { subscribeMissionCatalog, normalizeCatalogSnapshot, sortMissionCatalog } from "./missionCatalog";
const EMPTY = [];
export function useTeacherMissionDashboardRQ(classId, opts = {}) {
  const enabled = opts.enabled ?? true;
  const selfhost = false;
  const days = opts.days ?? 30;
  const includeLegacyCatalog = opts.includeLegacyCatalog === true;
  const cutoffKey = opts.rangeStart || dayjs().subtract(days, "day").format("YYYY-MM-DD");
  const selectedKey = [...new Set((opts.selectedMissionIds || EMPTY).filter(Boolean))].sort().join("\u0001");
  const visibleKey = [...new Set((opts.visibleMissionIds || EMPTY).filter(Boolean))].sort().join("\u0001");
  const [catalog, setCatalog] = useState({
    key: null,
    missions: [],
    ready: false,
    error: null
  });
  const [extra, setExtra] = useState({
    key: null,
    missions: [],
    ready: false,
    error: null
  });
  const catalogKey = `${classId}/${selfhost}/${cutoffKey}/${includeLegacyCatalog}`;
  useEffect(() => {
    if (!enabled || !classId) return undefined;
    let active = true;
    if (selfhost) {
      fetchSelfhostMissionList({
        classId,
        teacherLike: true
      }).then(missions => {
        if (active) setCatalog({
          key: catalogKey,
          missions,
          ready: true,
          error: null
        });
      }, error => {
        if (active) setCatalog({
          key: catalogKey,
          missions: [],
          ready: true,
          error
        });
      });
      return () => {
        active = false;
      };
    }
    const cutoff = dayjs(cutoffKey).startOf("day").toDate();
    const unsubscribe = subscribeMissionCatalog(classId, cutoff, null, missions => {
      if (active) setCatalog({
        key: catalogKey,
        missions,
        ready: true,
        error: null
      });
    }, error => {
      if (active) setCatalog({
        key: catalogKey,
        missions: [],
        ready: true,
        error
      });
    }, {
      includeLegacyCatalog
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled, classId, selfhost, cutoffKey, catalogKey, includeLegacyCatalog]);
  const currentCatalog = enabled && catalog.key === catalogKey ? catalog.missions : EMPTY;
  const catalogReady = catalog.key === catalogKey && catalog.ready;
  const missingKey = selectedKey.split("\u0001").filter(id => id && !currentCatalog.some(m => m.id === id)).join("\u0001");
  const extraKey = `${classId}/${missingKey}`;
  useEffect(() => {
    if (!enabled || selfhost || !classId || !catalogReady || !missingKey) return undefined;
    const ids = missingKey.split("\u0001");
    const chunks = new Map();
    const pending = new Set();
    const subscriptions = [];
    const lifecycle = {
      active: true,
      failure: null
    };
    for (let offset = 0; offset < ids.length; offset += 30) pending.add(offset);
    const emit = () => {
      if (lifecycle.active) setExtra({
        key: extraKey,
        missions: sortMissionCatalog([...chunks.values()].flat()),
        ready: !pending.size,
        error: lifecycle.failure
      });
    };
    for (let offset = 0; offset < ids.length; offset += 30) {
      subscriptions.push(onSnapshot(query(collection(db, `classes/${classId}/missions`), where(documentId(), "in", ids.slice(offset, offset + 30))), snapshot => {
        if (!lifecycle.active) return;
        chunks.set(offset, normalizeCatalogSnapshot(snapshot, classId));
        pending.delete(offset);
        emit();
      }, error => {
        lifecycle.failure = error;
        pending.delete(offset);
        emit();
      }));
    }
    return () => {
      lifecycle.active = false;
      subscriptions.forEach(stop => stop());
    };
  }, [enabled, selfhost, classId, catalogReady, missingKey, extraKey]);
  const extraMissions = extra.key === extraKey ? extra.missions : EMPTY;
  const hydrationKey = [...new Set([...selectedKey.split("\u0001"), ...visibleKey.split("\u0001")])].filter(Boolean).sort().join("\u0001");
  const hydrationMissions = useMemo(() => [...currentCatalog, ...extraMissions].filter(m => opts.loadAllRawMissions || hydrationKey.split("\u0001").includes(m.id)), [currentCatalog, extraMissions, hydrationKey, opts.loadAllRawMissions]);
  const canonical = useCanonicalMissionStates({
    classId,
    missions: hydrationMissions,
    studentUids: opts.studentUids || EMPTY,
    enabled: enabled && !selfhost,
    rosterReady: opts.rosterReady !== false
  });
  const hydrated = new Map(canonical.missions.map(m => [m.id, m]));
  const missions = currentCatalog.map(m => hydrated.get(m.id) || m);
  const selected = [...missions, ...canonical.missions.filter(m => !currentCatalog.some(c => c.id === m.id))].filter(m => selectedKey.split("\u0001").includes(m.id));
  const error = (catalog.key === catalogKey ? catalog.error : null) || (missingKey && extra.key === extraKey ? extra.error : null) || canonical.error;
  const loading = enabled && !!classId && (!catalogReady || missingKey && !selfhost && (extra.key !== extraKey || !extra.ready) || canonical.loading);
  return {
    summaryMissions: error ? [] : missions,
    selectedRawMissions: error ? [] : selected,
    allRawMissions: opts.loadAllRawMissions && !error ? missions : EMPTY,
    loadingSummary: loading,
    loadingSelectedRaw: loading,
    loadingAllRaw: opts.loadAllRawMissions && loading,
    error,
    usingRawFallback: false,
    usingMainSummary: false
  };
}
export default useTeacherMissionDashboardRQ;
