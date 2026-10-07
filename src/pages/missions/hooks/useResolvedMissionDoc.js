import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { normalizeMission } from "../utils/normalizeMission";
import { useCanonicalMissionStates } from "./useCanonicalMissionStates";

export function isSummaryMissionPayload(mission = null) {
  return Boolean(mission?._teacherSummary || mission?._summaryOnly);
}

export function useResolvedMissionDoc({ mission = null, enabled = true } = {}) {
  const { classId: contextClassId, userData, studentList = [], isTeacher, hasPermission } = useUser();
  const [rawMission, setRawMission] = useState(null);
  const [loading, setLoading] = useState(false);

  const requiresResolution = useMemo(
    () => isSummaryMissionPayload(mission),
    [mission],
  );

  useEffect(() => {
    if (!enabled || !mission?.id) {
      setRawMission(null);
      setLoading(false);
      return undefined;
    }

    if (!requiresResolution) {
      setRawMission(mission);
      setLoading(false);
      return undefined;
    }

    const effectiveClassId =
      mission?.classId || mission?.classID || contextClassId || null;
    if (!effectiveClassId) {
      setRawMission(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, `classes/${effectiveClassId}/missions/${mission.id}`),
      (snapshot) => {
        if (!snapshot.exists()) {
          setRawMission(null);
          setLoading(false);
          return;
        }

        setRawMission(
          normalizeMission(
            {
              id: snapshot.id,
              classId: effectiveClassId,
              ...snapshot.data(),
            },
            {},
          ),
        );
        setLoading(false);
      },
      () => {
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [contextClassId, enabled, mission, requiresResolution]);

  const resolvedMission = rawMission || mission || null;
  const studentView = mission?._studentView || (mission?._summaryOnly && !mission?._teacherSummary);
  const manager = !studentView && (isTeacher || hasPermission?.("mission_admin"));
  const canonical = useCanonicalMissionStates({
    classId: resolvedMission?.classId || contextClassId,
    missions: resolvedMission ? [resolvedMission] : [],
    studentUids: manager ? studentList.map((student) => student.uid || student.id) : [userData?.uid],
    enabled: enabled && !resolvedMission?._statesHydrated,
  });
  return {
    mission: canonical.error ? null : canonical.missions[0] ? {
      ...canonical.missions[0],
      ...(!manager && canonical.missions[0].stateStorageVersion === 2 ? { _completion: canonical.missions[0].completions?.[userData?.uid] || null } : {}),
    } : null,
    rawMission,
    loading: (requiresResolution ? loading && !rawMission : false) || canonical.loading,
    requiresResolution,
    error: canonical.error,
  };
}

export default useResolvedMissionDoc;
