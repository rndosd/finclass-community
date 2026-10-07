import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFirebaseClassStudents, waitForFirebaseClassStudents, retainFirebaseStudentRosterSubscription } from "./classStudentsFirebaseAdapter";
const fetchSelfhostClassStudents = () => {
  throw new Error("Experimental provider is excluded from this installation.");
};
const primeStudentCaches = (queryClient, classId, students, {
  rosterQueryKey = ["classStudents", classId]
} = {}) => {
  queryClient.setQueryData(rosterQueryKey, students);
  students.forEach(student => {
    queryClient.setQueryData(["userProfile", classId, student.uid], student);
  });
};
export function useClassStudents(classId, {
  enabled = true,
  realtime = true,
  telemetry = {},
  provider = "firebase",
  token = "",
  apiBase = ""
} = {}) {
  const queryClient = useQueryClient();
  const isSelfhost = false;
  const telemetrySource = telemetry.source || "useClassStudents";
  const telemetrySourceGroup = telemetry.sourceGroup || "page";
  const telemetryRole = telemetry.role || "unknown";
  const queryKey = useMemo(() => ["classStudents", classId], [apiBase, classId, false]);
  const getCachedStudents = useCallback(() => queryClient.getQueryData(queryKey), [queryClient, queryKey]);
  const cacheStudents = useCallback(students => {
    if (!classId) return;
    primeStudentCaches(queryClient, classId, students, {
      rosterQueryKey: queryKey
    });
  }, [classId, queryClient, queryKey]);
  useEffect(() => {
    if (false || !classId || !enabled || !realtime) return undefined;
    return retainFirebaseStudentRosterSubscription(queryClient, classId, primeStudentCaches, {
      source: telemetrySource,
      sourceGroup: telemetrySourceGroup,
      role: telemetryRole
    });
  }, [classId, enabled, false, queryClient, realtime, telemetryRole, telemetrySource, telemetrySourceGroup]);
  return useQuery({
    queryKey,
    queryFn: async ({
      signal
    }) => {
      if (!classId || !enabled) return [];
      const cachedStudents = getCachedStudents();
      if (Array.isArray(cachedStudents)) {
        return cachedStudents;
      }
      const students = realtime ? await waitForFirebaseClassStudents({
        classId,
        queryClient,
        signal
      }) : await fetchFirebaseClassStudents({
        classId,
        telemetrySource,
        telemetrySourceGroup
      });
      cacheStudents(students);
      return students;
    },
    enabled: !!classId && enabled && (!false || !!token),
    initialData: () => getCachedStudents(),
    staleTime: !false && realtime ? Infinity : 5 * 60 * 1000,
    gcTime: Infinity
  });
}
