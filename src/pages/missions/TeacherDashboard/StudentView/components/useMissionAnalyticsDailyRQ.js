import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../../../../firebase";

function normalizeMissionAnalyticsDailyDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    date: String(data.date || docSnap.id),
    byStudentMission:
      data.byStudentMission && typeof data.byStudentMission === "object"
        ? data.byStudentMission
        : {},
    eventTotals:
      data.eventTotals && typeof data.eventTotals === "object"
        ? data.eventTotals
        : {},
    updatedAt: data.generatedAt || null,
  };
}

export function useMissionAnalyticsDailyRQ({
  classId,
  dateFrom,
  dateTo,
  enabled = true,
}) {
  const [dailyRows, setDailyRows] = useState([]);
  const [loadingDailyRows, setLoadingDailyRows] = useState(false);
  const [error, setError] = useState(null);
  const [resultKey, setResultKey] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const requestKey = `${classId}/${dateFrom}/${dateTo}`;

  useEffect(() => {
    if (!enabled || !classId || !dateFrom || !dateTo) {
      setDailyRows([]);
      setLoadingDailyRows(false);
      return undefined;
    }

    setLoadingDailyRows(true);
    setError(null);
    const dailyRef = collection(db, `classes/${classId}/missionAnalyticsDaily`);
    const dailyQuery = query(
      dailyRef,
      where("date", ">=", dateFrom),
      where("date", "<=", dateTo),
      orderBy("date", "desc"),
    );

    const unsubscribe = onSnapshot(
      dailyQuery,
      (snapshot) => {
        setDailyRows(snapshot.docs.map(normalizeMissionAnalyticsDailyDoc));
        setResultKey(requestKey);
        setLoadingDailyRows(false);
      },
      (failure) => {
        setDailyRows([]);
        setError(failure);
        setResultKey(requestKey);
        setLoadingDailyRows(false);
      },
    );

    return () => unsubscribe();
  }, [classId, dateFrom, dateTo, enabled, requestKey, refreshKey]);

  return {
    dailyRows: resultKey === requestKey ? dailyRows : [],
    loadingDailyRows: loadingDailyRows || (enabled && !!classId && resultKey !== requestKey),
    error: resultKey === requestKey ? error : null,
    retry: () => setRefreshKey(value => value + 1),
  };
}

export default useMissionAnalyticsDailyRQ;
