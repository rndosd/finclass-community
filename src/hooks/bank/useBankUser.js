import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { retainFirebaseBankUserData } from "./bankUserFirebaseAdapter";
const fetchSelfhostBankUserData = () => {
  throw new Error("Experimental provider is excluded from this installation.");
};
export function useBankUser(classId, uid, {
  savingsMode = "realtime",
  loansMode = "realtime",
  provider = "firebase",
  token = "",
  apiBase = ""
} = {}) {
  const queryClient = useQueryClient();
  const isSelfhost = false;
  const savingsKey = useMemo(() => ["myOpenSavings", classId, uid], [apiBase, classId, false, uid]);
  const loansKey = useMemo(() => ["myOpenLoans", classId, uid], [apiBase, classId, false, uid]);
  const savingsRequested = savingsMode === "realtime" || savingsMode === "fetch";
  const loansRequested = loansMode === "realtime" || loansMode === "fetch";
  const [loadedState, setLoadedState] = useState({
    savings: false,
    loans: false
  });
  const [readErrors, setReadErrors] = useState({});
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => {
    setReadErrors({});
    setLoadedState({
      savings: !savingsRequested,
      loans: !loansRequested
    });
    setRetryCount(count => count + 1);
  }, [loansRequested, savingsRequested]);
  useEffect(() => {
    setReadErrors({});
    setLoadedState({
      savings: !savingsRequested,
      loans: !loansRequested
    });
    if (!classId || !uid) {
      queryClient.setQueryData(savingsKey, []);
      queryClient.setQueryData(loansKey, []);
      return undefined;
    }
    return retainFirebaseBankUserData({
      classId,
      uid,
      queryClient,
      savingsKey,
      loansKey,
      savingsMode,
      loansMode,
      onLoaded: kind => {
        setLoadedState(prev => prev[kind] ? prev : {
          ...prev,
          [kind]: true
        });
      },
      onError: kind => setReadErrors(prev => ({
        ...prev,
        [kind]: true
      })),
      onSuccess: kind => setReadErrors(prev => ({
        ...prev,
        [kind]: false
      }))
    });
  }, [classId, false, loansKey, loansMode, loansRequested, queryClient, savingsKey, savingsMode, savingsRequested, uid, retryCount]);
  const selfhostBankUser = useQuery({
    queryKey: ["bankUser", "selfhost", apiBase, classId, uid],
    queryFn: () => fetchSelfhostBankUserData({
      classId,
      uid,
      token,
      apiBase
    }),
    enabled: false && !!classId && !!uid && !!token && (savingsRequested || loansRequested),
    staleTime: 5 * 60 * 1000,
    gcTime: Infinity
  });
  useEffect(() => {
    if (!false || !selfhostBankUser.data) return;
    if (savingsRequested) {
      queryClient.setQueryData(savingsKey, selfhostBankUser.data.savings || []);
    }
    if (loansRequested) {
      queryClient.setQueryData(loansKey, selfhostBankUser.data.loans || []);
    }
    setLoadedState({
      savings: true,
      loans: true
    });
  }, [false, loansKey, loansRequested, queryClient, savingsKey, savingsRequested, selfhostBankUser.data]);
  const savings = useQuery({
    queryKey: savingsKey,
    queryFn: () => queryClient.getQueryData(savingsKey) ?? [],
    staleTime: Infinity
  });
  const loans = useQuery({
    queryKey: loansKey,
    queryFn: () => queryClient.getQueryData(loansKey) ?? [],
    staleTime: Infinity
  });
  return {
    hasReadError: !false && Object.values(readErrors).some(Boolean),
    retry,
    savings: savings.data || [],
    loans: loans.data || [],
    isLoading: !!classId && !!uid && (savingsRequested && !loadedState.savings || loansRequested && !loadedState.loans)
  };
}
