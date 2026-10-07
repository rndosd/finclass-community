import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useUser } from "../../../contexts/UserContext";
import { fetchSelfhostMissionList, getMissionReadProvider } from "../services/missionReadService";
import { isMissionAssignedToStudent } from "../utils/missionEligibility";
import { fetchMissionCatalog, subscribeMissionCatalog, missionDate } from "./missionCatalog";
const DEFAULT_DAYS = 60;
export function resolveMissionReaderIdentity({
  userData,
  isTeacher,
  hasMissionAdminPermission,
  studentMode = false
}) {
  return {
    selfUid: studentMode || !isTeacher ? userData?.uid ?? null : null,
    teacherLike: !studentMode && Boolean(isTeacher || hasMissionAdminPermission)
  };
}
function shouldIncludeMissionInDashboard(mission, cutoff, now) {
  if (!mission) return false;
  if (mission?.type === "always") return true;
  const startAt = missionDate(mission?.timeWindow?.start ?? mission?.startDate);
  const endAt = missionDate(mission?.timeWindow?.end ?? mission?.endDate);
  if (startAt && startAt >= cutoff) return true;
  if (endAt && endAt >= now) return true;
  if (!endAt) return true;
  if ((missionDate(mission?.updatedAt)?.getTime() || 0) >= cutoff.getTime()) return true;
  if ((missionDate(mission?.createdAt)?.getTime() || 0) >= cutoff.getTime()) return true;
  return false;
}
export function filterStudentMissionCatalog(missions, {
  studentData,
  selfUid,
  teacherLike,
  days = DEFAULT_DAYS
}) {
  const now = new Date();
  const cutoff = dayjs().subtract(days, "day").startOf("day").toDate();
  return missions.filter(mission => shouldIncludeMissionInDashboard(mission, cutoff, now) && (teacherLike || isMissionAssignedToStudent(mission, studentData, selfUid))).map(mission => teacherLike ? mission : {
    ...mission,
    _studentView: true
  });
}
export const useMissionsRQ = (classId, opts = {}) => {
  const {
    userData,
    classData,
    isTeacher,
    hasPermission
  } = useUser();
  const qc = useQueryClient();
  const days = opts.days ?? DEFAULT_DAYS;
  const provider = opts.provider || getMissionReadProvider();
  const selfhost = false;
  const includeLegacyCatalog = classData?.missionStudentStateVersion !== 2;
  const realtime = !selfhost && (opts.realtime ?? true);
  const {
    selfUid,
    teacherLike
  } = resolveMissionReaderIdentity({
    userData,
    isTeacher,
    hasMissionAdminPermission: hasPermission?.("mission_admin"),
    studentMode: opts.studentMode === true
  });
  const enabled = !!classId && (teacherLike || !!selfUid);
  const selfhostEligibilityKey = selfhost ? JSON.stringify({
    creditScore: userData?.creditScore,
    creditTier: userData?.creditTier
  }) : null;
  const key = useMemo(() => ["classMissions", classId, {
    days,
    provider,
    selfUid,
    teacherLike,
    includeLegacyCatalog,
    readerVersion: 3
  }], [classId, days, provider, selfUid, teacherLike, includeLegacyCatalog]);
  const readKey = JSON.stringify(key);
  const [live, setLive] = useState({
    key: null,
    ready: false,
    error: null
  });
  const filter = useCallback(missions => filterStudentMissionCatalog(missions, {
    studentData: userData || {},
    selfUid,
    teacherLike,
    days
  }), [userData, selfUid, teacherLike, days]);
  const fetchCatalog = useCallback(async () => {
    if (!enabled) return [];
    if (selfhost) return fetchSelfhostMissionList({
      classId,
      selfUid,
      teacherLike,
      studentData: userData || {}
    });
    const cutoff = dayjs().subtract(days, "day").startOf("day").toDate();
    return fetchMissionCatalog(classId, cutoff, selfUid, {
      includeLegacyCatalog
    });
  }, [enabled, selfhost, classId, selfUid, teacherLike, userData, days, includeLegacyCatalog]);
  const queryState = useQuery({
    queryKey: selfhost ? [...key, selfhostEligibilityKey] : key,
    enabled: enabled && !realtime,
    queryFn: fetchCatalog,
    staleTime: realtime ? Infinity : 10000,
    gcTime: 30 * 60 * 1000
  });
  useEffect(() => {
    if (!enabled || !realtime) return undefined;
    let active = true;
    const cutoff = dayjs().subtract(days, "day").startOf("day").toDate();
    const unsubscribe = subscribeMissionCatalog(classId, cutoff, selfUid, missions => {
      if (!active) return;
      qc.setQueryData(key, missions);
      setLive({
        key: readKey,
        ready: true,
        error: null
      });
    }, error => {
      if (active) setLive({
        key: readKey,
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
  }, [enabled, realtime, classId, days, key, readKey, qc, selfUid, includeLegacyCatalog]);
  const refetch = useCallback(async () => {
    if (selfhost) return queryState.refetch();
    const missions = await fetchCatalog();
    qc.setQueryData(key, missions);
    return {
      data: filter(missions)
    };
  }, [fetchCatalog, qc, key, filter, selfhost, queryState]);
  const error = realtime ? live.key === readKey ? live.error : null : queryState.error;
  const missions = useMemo(() => selfhost ? queryState.data ?? [] : filter(queryState.data ?? []), [selfhost, queryState.data, filter]);
  return {
    missions: error || !enabled ? [] : missions,
    loading: enabled && (realtime ? live.key !== readKey || !live.ready : queryState.isLoading),
    refreshing: queryState.isRefetching,
    error,
    refetch
  };
};
export default useMissionsRQ;
