import { doc } from "firebase/firestore";
import { subscribeDocCount } from "./subscribeDocCount";

export function subscribeCredentialBadge({
  db,
  classId,
  isTeacher,
  notificationStateMainRef,
  applyCount,
  requestStudentNotificationRepair,
}) {
  if (isTeacher) {
    return subscribeDocCount({
      ref: doc(db, `classes/${classId}/notificationSummary/credentials`),
      applyCount,
      selectCount: (data) => Number(data?.teacherPendingRequestCount || 0),
    });
  }

  return subscribeDocCount({
    ref: notificationStateMainRef,
    applyCount,
    selectCount: (data) => Number(data?.actions?.credentials || 0),
    canUseData: (data) => data?.actionsUpdatedAt?.credentials != null,
    onMissingData: requestStudentNotificationRepair,
  });
}
