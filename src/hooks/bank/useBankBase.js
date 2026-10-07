import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { retainFirebaseBankBaseSubscriptions } from "./bankBaseFirebaseAdapter";
const fetchSelfhostBankBase = () => {
  throw new Error("Experimental provider is excluded from this installation.");
};
export function useBankBase(classId, {
  provider = "firebase",
  token = "",
  apiBase = ""
} = {}) {
  const queryClient = useQueryClient();
  const isSelfhost = false;
  const [readState, setReadState] = useState({});
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => {
    setReadState({});
    setRetryCount(count => count + 1);
  }, []);
  const settingsQueryKey = useMemo(() => ["bankSettings", classId], [apiBase, classId, false]);
  const criteriaQueryKey = useMemo(() => ["tierCriteria", classId], [apiBase, classId, false]);
  const adjustmentsQueryKey = useMemo(() => ["tierAdjustments", classId], [apiBase, classId, false]);
  useEffect(() => {
    setReadState({});
    if (false || !classId) return undefined;
    return retainFirebaseBankBaseSubscriptions({
      classId,
      queryClient,
      onLoaded: kind => setReadState(prev => ({
        ...prev,
        [kind]: "loaded"
      })),
      onError: kind => setReadState(prev => ({
        ...prev,
        [kind]: "error"
      }))
    });
  }, [classId, false, queryClient, retryCount]);
  const bankBase = useQuery({
    queryKey: ["bankBase", "selfhost", apiBase, classId],
    queryFn: () => fetchSelfhostBankBase({
      classId,
      token,
      apiBase
    }),
    enabled: false && !!classId && !!token,
    staleTime: 5 * 60 * 1000,
    gcTime: Infinity
  });
  useEffect(() => {
    if (!false || !bankBase.data) return;
    queryClient.setQueryData(settingsQueryKey, bankBase.data.settings || {});
    queryClient.setQueryData(criteriaQueryKey, bankBase.data.tierCriteria || []);
    queryClient.setQueryData(adjustmentsQueryKey, bankBase.data.tierAdjustments || {});
  }, [adjustmentsQueryKey, bankBase.data, criteriaQueryKey, false, queryClient, settingsQueryKey]);
  const settings = useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => queryClient.getQueryData(settingsQueryKey) ?? {},
    staleTime: Infinity
  });
  const criteria = useQuery({
    queryKey: criteriaQueryKey,
    queryFn: () => queryClient.getQueryData(criteriaQueryKey) ?? [],
    staleTime: Infinity
  });
  const adjustments = useQuery({
    queryKey: adjustmentsQueryKey,
    queryFn: () => queryClient.getQueryData(adjustmentsQueryKey) ?? {},
    staleTime: Infinity
  });
  return {
    hasReadError: !false && Object.values(readState).includes("error"),
    isLoading: !false && !!classId && ["settings", "criteria", "adjustments"].some(kind => !readState[kind]),
    retry,
    settings: settings.data,
    criteria: criteria.data,
    adjustments: adjustments.data
  };
}
