import { doc } from "firebase/firestore";
import { subscribeDocCount } from "./subscribeDocCount";

export function subscribeMissionBadge({
  db,
  classId,
  isMissionManager,
  notificationStateMainRef,
  applyCount,
  requestStudentNotificationRepair,
}) {
  if (isMissionManager) {
    return subscribeDocCount({
      ref: doc(db, `classes/${classId}/notificationSummary/missions`),
      applyCount,
      selectCount: (data) => Number(data?.teacherPendingCount || 0),
    });
  }

  return subscribeDocCount({
    ref: notificationStateMainRef,
    applyCount,
    selectCount: (data) => Number(data?.actions?.missions || 0),
    canUseData: (data) => data?.actionsUpdatedAt?.missions != null,
    onMissingData: requestStudentNotificationRepair,
  });
}
