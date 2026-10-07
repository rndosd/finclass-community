import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../firebase";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { requestOverviewSummaryRepair } from "../../utils/overviewSummaryRepair";
import {
  getEmptyPayrollOverviewSummary,
  isValidPayrollOverviewSummaryData,
  normalizePayrollOverviewSummaryData,
} from "../../utils/overviewSummarySchema";

const normalizeOptions = (optionsOrLimit) => {
  if (typeof optionsOrLimit === "number") {
    return {
      enabled: true,
      limitCount: optionsOrLimit,
      repairEnabled: false,
    };
  }

  return {
    enabled: optionsOrLimit?.enabled ?? true,
    limitCount: optionsOrLimit?.limitCount ?? 200,
    repairEnabled: optionsOrLimit?.repairEnabled ?? false,
  };
};

export const useClassPayslipsQuery = (classId, optionsOrLimit = 200) => {
  const { enabled, limitCount, repairEnabled } = normalizeOptions(optionsOrLimit);
  const [data, setData] = useState([]);
  const [summaryMeta, setSummaryMeta] = useState(getEmptyPayrollOverviewSummary());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const hasPayslipsRef = useRef(false);

  const applyPayslips = useCallback((rows) => {
    const normalizedRows = Array.isArray(rows) ? rows : [];
    hasPayslipsRef.current = normalizedRows.length > 0;
    setData(normalizedRows);
  }, []);

  useEffect(() => {
    if (!classId) {
      const emptySummary = getEmptyPayrollOverviewSummary();
      applyPayslips(emptySummary.recentPayslips);
      setSummaryMeta(emptySummary);
      setIsLoading(false);
      setError(null);
      return undefined;
    }

    if (!enabled) {
      setIsLoading(false);
      return undefined;
    }

    let isActive = true;

    setIsLoading(!hasPayslipsRef.current);
    setError(null);

    const summaryRef = doc(db, "classes", classId, "dashboardSummary", "payrollOverview");
    const refreshSummary = async ({ force = false } = {}) => {
      setIsLoading((current) => current || !hasPayslipsRef.current || force);

      try {
        const repairResult = repairEnabled
          ? await requestOverviewSummaryRepair(classId, {
              force,
              scope: "payroll",
            })
          : { error: null };
        if (!isActive) return;

        const snap = await getDoc(summaryRef);
        if (!isActive) return;

        const summary = snap.exists() ? snap.data() || {} : null;
        if (isValidPayrollOverviewSummaryData(summary)) {
          const normalizedSummary = normalizePayrollOverviewSummaryData(
            summary,
            limitCount,
          );
          applyPayslips(normalizedSummary.recentPayslips);
          setSummaryMeta(normalizedSummary);
          setError(null);
          setIsLoading(false);
          return;
        }

        const summaryError =
          repairResult.error ||
          new Error("payroll overview summary is unavailable.");
        if (!hasPayslipsRef.current) {
          const emptySummary = getEmptyPayrollOverviewSummary();
          applyPayslips(emptySummary.recentPayslips);
          setSummaryMeta(emptySummary);
        }
        setError(summaryError);
        setIsLoading(false);
      } catch (summaryError) {
        if (!isActive) return;
        console.error("[usePayrollInfo] payroll summary refresh error:", summaryError);
        if (!hasPayslipsRef.current) {
          applyPayslips([]);
        }
        setError(summaryError);
        setIsLoading(false);
      }
    };

    const summaryUnsubscribe = onSnapshot(
      summaryRef,
      (snap) => {
        if (!isActive) return;

        const summary = snap.exists() ? snap.data() || {} : null;
        if (isValidPayrollOverviewSummaryData(summary)) {
          const normalizedSummary = normalizePayrollOverviewSummaryData(
            summary,
            limitCount,
          );
          applyPayslips(normalizedSummary.recentPayslips);
          setSummaryMeta(normalizedSummary);
          setError(null);
          setIsLoading(false);
          return;
        }

        void refreshSummary();
      },
      (summaryError) => {
        if (!isActive) return;
        console.error("[usePayrollInfo] payroll summary snapshot error:", summaryError);
        void refreshSummary();
      },
    );

    return () => {
      isActive = false;
      summaryUnsubscribe();
    };
  }, [applyPayslips, classId, enabled, limitCount, repairEnabled]);

  return useMemo(
    () => ({
      data,
      summaryMeta,
      isLoading: !!classId && enabled && isLoading,
      error,
    }),
    [classId, data, enabled, error, isLoading, summaryMeta],
  );
};
