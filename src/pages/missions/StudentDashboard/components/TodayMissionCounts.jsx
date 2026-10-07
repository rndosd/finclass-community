import React, { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../../../firebase";
import { useUser } from "../../../../contexts/UserContext";
import { getTodayKeyInKST } from "../../utils/alwaysMissionState";

export default function TodayMissionCounts({ mission, classId, todayCount, maxPerDay, readOnly }) {
  const { userData } = useUser();
  const [approvedCount, setApprovedCount] = useState(null);
  const todayKey = getTodayKeyInKST();
  const resolvedClassId = mission.classId || classId;
  const studentUid = userData?.uid;

  useEffect(() => {
    setApprovedCount(null);
    if (readOnly || !resolvedClassId || !studentUid) return undefined;
    return onSnapshot(
      doc(db, `classes/${resolvedClassId}/students/${studentUid}/missionState/${mission.id}/days/${todayKey}`),
      (snapshot) => setApprovedCount(Number(snapshot.data()?.approvedCount || 0)),
      () => setApprovedCount(null),
    );
  }, [mission.id, readOnly, resolvedClassId, studentUid, todayKey]);

  return (
    <dl className="flex gap-5 lg:border-l lg:border-slate-100 lg:pl-4">
      <div>
        <dt className="text-xs font-medium text-slate-600">오늘 제출</dt>
        <dd className="mt-1 whitespace-nowrap text-sm text-slate-600 tabular-nums"><strong className="text-xl font-bold leading-7 text-indigo-600">{todayCount}</strong> / {maxPerDay}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-slate-600">오늘 승인</dt>
        <dd className="mt-1 whitespace-nowrap text-sm text-slate-600 tabular-nums"><strong className="text-xl font-bold leading-7 text-emerald-600">{approvedCount ?? "—"}</strong> / {maxPerDay}</dd>
      </div>
    </dl>
  );
}
