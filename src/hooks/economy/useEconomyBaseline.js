import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { db } from "../../firebase";
import { beginFirestoreSubscriptionDebug } from "../../utils/firestoreSubscriptionDebug";

const EMPTY_BASELINE = {
  summaryVersion: 0,
  baselineWeeklySalary: 0,
  medianWeeklySalary: 0,
  averageWeeklySalary: 0,
  weeklyPayrollLiability: 0,
  activeStudentCount: 0,
  assignedStudentCount: 0,
  unassignedStudentCount: 0,
};

const normalizeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeEconomyBaseline = (data = {}) => {
  const baselineWeeklySalary = normalizeNumber(
    data.baselineWeeklySalary ||
      data.medianWeeklySalary ||
      data.averageWeeklySalary,
  );

  return {
    ...EMPTY_BASELINE,
    ...data,
    baselineWeeklySalary,
    medianWeeklySalary: normalizeNumber(data.medianWeeklySalary),
    averageWeeklySalary: normalizeNumber(data.averageWeeklySalary),
    weeklyPayrollLiability: normalizeNumber(data.weeklyPayrollLiability),
    activeStudentCount: normalizeNumber(data.activeStudentCount),
    assignedStudentCount: normalizeNumber(data.assignedStudentCount),
    unassignedStudentCount: normalizeNumber(data.unassignedStudentCount),
  };
};

export const useEconomyBaseline = (
  classId,
  { enabled = true, debug = {} } = {},
) => {
  const [data, setData] = useState(EMPTY_BASELINE);
  const [exists, setExists] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!classId || !enabled) {
      setData(EMPTY_BASELINE);
      setExists(false);
      setIsLoading(false);
      setError(null);
      return undefined;
    }

    setIsLoading(true);
    setError(null);

    const summaryRef = doc(
      db,
      "classes",
      classId,
      "dashboardSummary",
      "economyBaseline",
    );
    const subscriptionDebug = beginFirestoreSubscriptionDebug({
      source: debug.source || "useEconomyBaseline",
      pathKey: "classes/{classId}/dashboardSummary/economyBaseline",
      classId,
      role: debug.role,
    });

    const unsubscribe = onSnapshot(
      summaryRef,
      (snapshot) => {
        subscriptionDebug.recordSnapshot(snapshot);
        setExists(snapshot.exists());
        setData(
          snapshot.exists()
            ? normalizeEconomyBaseline(snapshot.data() || {})
            : EMPTY_BASELINE,
        );
        setIsLoading(false);
        setError(null);
      },
      (snapshotError) => {
        subscriptionDebug.recordError(snapshotError);
        console.error("[useEconomyBaseline] snapshot error:", snapshotError);
        setData(EMPTY_BASELINE);
        setExists(false);
        setError(snapshotError);
        setIsLoading(false);
      },
    );

    return () => {
      unsubscribe();
      subscriptionDebug.stop();
    };
  }, [classId, debug.role, debug.source, enabled]);

  return useMemo(
    () => ({
      data,
      exists,
      isLoading,
      error,
      baselineWeeklySalary: data.baselineWeeklySalary,
    }),
    [data, error, exists, isLoading],
  );
};

export default useEconomyBaseline;
