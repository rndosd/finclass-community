import { doc } from "firebase/firestore";
import { subscribeDocCount } from "./subscribeDocCount";

export function subscribeBankBadge({
  db,
  classId,
  isTeacher,
  isBankManager,
  notificationStateMainRef,
  applyCount,
  requestStudentNotificationRepair,
}) {
  if (isTeacher || isBankManager) {
    return subscribeDocCount({
      ref: doc(db, `classes/${classId}/notificationSummary/bank`),
      applyCount,
      selectCount: (data) => Number(data?.managerPendingCount || 0),
    });
  }

  return subscribeDocCount({
    ref: notificationStateMainRef,
    applyCount,
    selectCount: (data) => Number(data?.actions?.bank || 0),
    canUseData: (data) => data?.actionsUpdatedAt?.bank != null,
    onMissingData: requestStudentNotificationRepair,
  });
}
