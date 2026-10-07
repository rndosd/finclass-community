import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { requestOverviewSummaryRepair } from "../../utils/overviewSummaryRepair";
import {
  getEmptyPendingSummary,
  isValidPendingSummaryData,
  normalizePendingSummaryData,
} from "../../utils/overviewSummarySchema";

function buildKindsMap(kinds = []) {
  const normalized = new Set(
    (Array.isArray(kinds) ? kinds : [])
      .map((kind) => String(kind || "").trim())
      .filter(Boolean),
  );

  return {
    savings: normalized.has("savings"),
    loans: normalized.has("loans"),
  };
}

export function useBankAdmin(
  classId,
  isBankAdmin,
  { enabled = true, kinds = ["savings", "loans"], canRepair = false } = {},
) {
  const queryEnabled = !!classId && !!isBankAdmin && enabled;
  const requestedKinds = useMemo(() => buildKindsMap(kinds), [kinds]);
  const [pendingSavings, setPendingSavings] = useState([]);
  const [pendingLoans, setPendingLoans] = useState([]);
  const [pendingCounts, setPendingCounts] = useState(getEmptyPendingSummary().counts);
  const [isPendingListsReady, setIsPendingListsReady] = useState(false);
  const [isPendingListsLoading, setIsPendingListsLoading] = useState(false);
  const [error, setError] = useState(null);
  const hasPendingRowsRef = useRef(false);

  useEffect(() => {
    hasPendingRowsRef.current = pendingSavings.length > 0 || pendingLoans.length > 0;
  }, [pendingLoans.length, pendingSavings.length]);

  const summaryRef = useMemo(
    () => (classId ? doc(db, "classes", classId, "dashboardSummary", "bankAdminPending") : null),
    [classId],
  );

  const refreshPendingSummary = useCallback(async ({ force = false } = {}) => {
    if (!classId) {
      const emptySummary = getEmptyPendingSummary();
      setPendingSavings(emptySummary.pendingSavings);
      setPendingLoans(emptySummary.pendingLoans);
      setPendingCounts(emptySummary.counts);
      setIsPendingListsReady(true);
      setIsPendingListsLoading(false);
      setError(null);
      return emptySummary;
    }

    setIsPendingListsLoading((current) => current || !hasPendingRowsRef.current || force);
    setError(null);

    try {
      const repairResult = canRepair
        ? await requestOverviewSummaryRepair(classId, {
            force,
            scope: "bank",
          })
        : { error: null };
      const snap = summaryRef ? await getDoc(summaryRef) : null;
      const data = snap?.exists() ? snap.data() || {} : null;

      if (isValidPendingSummaryData(data)) {
        const normalizedSummary = normalizePendingSummaryData(data);
        setPendingSavings(normalizedSummary.pendingSavings);
        setPendingLoans(normalizedSummary.pendingLoans);
        setPendingCounts(normalizedSummary.counts);
        setIsPendingListsReady(true);
        return normalizedSummary;
      }

      const summaryError =
        repairResult.error ||
        new Error("bank admin pending summary is unavailable.");
      if (!hasPendingRowsRef.current) {
        const emptySummary = getEmptyPendingSummary();
        setPendingSavings(emptySummary.pendingSavings);
        setPendingLoans(emptySummary.pendingLoans);
        setPendingCounts(emptySummary.counts);
      }
      setIsPendingListsReady(true);
      setError(summaryError);
      return getEmptyPendingSummary();
    } catch (summaryError) {
      console.error("[useBankAdmin] failed to refresh pending summary:", summaryError);
      if (!hasPendingRowsRef.current) {
        const emptySummary = getEmptyPendingSummary();
        setPendingSavings(emptySummary.pendingSavings);
        setPendingLoans(emptySummary.pendingLoans);
        setPendingCounts(emptySummary.counts);
      }
      setIsPendingListsReady(true);
      setError(summaryError);
      return getEmptyPendingSummary();
    } finally {
      setIsPendingListsLoading(false);
    }
  }, [canRepair, classId, summaryRef]);

  useEffect(() => {
    if (!classId) {
      const emptySummary = getEmptyPendingSummary();
      setPendingSavings(emptySummary.pendingSavings);
      setPendingLoans(emptySummary.pendingLoans);
      setPendingCounts(emptySummary.counts);
      setIsPendingListsReady(false);
      setIsPendingListsLoading(false);
      setError(null);
      return undefined;
    }

    if (!queryEnabled) {
      setIsPendingListsReady(true);
      setIsPendingListsLoading(false);
      setError(null);
      return undefined;
    }

    let isActive = true;
    setIsPendingListsLoading((current) => current || !hasPendingRowsRef.current);
    setIsPendingListsReady(false);
    setError(null);
    const unsubscribe = onSnapshot(
      summaryRef,
      (snap) => {
        if (!isActive) return;

        const data = snap.exists() ? snap.data() || {} : null;
        if (isValidPendingSummaryData(data)) {
          const normalizedSummary = normalizePendingSummaryData(data);
          setPendingSavings(normalizedSummary.pendingSavings);
          setPendingLoans(normalizedSummary.pendingLoans);
          setPendingCounts(normalizedSummary.counts);
          setIsPendingListsReady(true);
          setIsPendingListsLoading(false);
          setError(null);
          return;
        }

        void refreshPendingSummary();
      },
      (summaryError) => {
        if (!isActive) return;
        console.error("[useBankAdmin] pending summary snapshot error:", summaryError);
        void refreshPendingSummary();
      },
    );

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [classId, queryEnabled, refreshPendingSummary, summaryRef]);

  return {
    pendingSavings: queryEnabled && requestedKinds.savings ? pendingSavings : [],
    pendingLoans: queryEnabled && requestedKinds.loans ? pendingLoans : [],
    pendingCounts: queryEnabled ? pendingCounts : getEmptyPendingSummary().counts,
    requestedKinds,
    isPendingListsReady: !queryEnabled || isPendingListsReady,
    isPendingListsLoading: queryEnabled && isPendingListsLoading,
    refetchPendingLists: refreshPendingSummary,
    error,
  };
}
