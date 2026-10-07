import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { retainFirebaseClassInfoSubscription } from "./classInfoFirebaseAdapter";
const fetchSelfhostClassInfo = () => {
  throw new Error("Experimental provider is excluded from this installation.");
};
export function useClassInfo(classId, {
  provider = "firebase",
  token = "",
  apiBase = ""
} = {}) {
  const queryClient = useQueryClient();
  const isSelfhost = false;
  const [readyQueryKey, setReadyQueryKey] = useState(null);
  const queryKey = useMemo(() => ["classInfo", classId], [apiBase, classId, false]);
  useEffect(() => {
    if (false || !classId) return undefined;
    return retainFirebaseClassInfoSubscription({
      classId,
      queryClient,
      onReady: () => setReadyQueryKey(queryKey)
    });
  }, [classId, false, queryClient, queryKey]);
  const classDataQuery = useQuery({
    queryKey,
    queryFn: () => Promise.resolve(queryClient.getQueryData(["classInfo", classId]) || null),
    enabled: !!classId && (!false || !!token),
    staleTime: Infinity,
    gcTime: Infinity
  });
  const resolvedClassReady = !classId || readyQueryKey === queryKey;
  return useMemo(() => ({
    classData: classDataQuery.data,
    classReady: resolvedClassReady
  }), [classDataQuery.data, resolvedClassReady]);
}
