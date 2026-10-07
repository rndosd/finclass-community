import { doc } from "firebase/firestore";
import { subscribeDocCount } from "./subscribeDocCount";

export function subscribePoliceBadge({
  db,
  classId,
  isTeacher,
  isPoliceManager,
  notificationStateMainRef,
  applyCount,
  requestStudentNotificationRepair,
}) {
  if (isTeacher || isPoliceManager) {
    return subscribeDocCount({
      ref: doc(db, `classes/${classId}/notificationSummary/police`),
      applyCount,
      selectCount: (data) => {
        if (isTeacher) {
          return Number(data?.teacherPendingReportCount || 0);
        }
        return Number(data?.policeAdminPendingReportCount || 0);
      },
      onSnapshotError: (error) => {
        console.error(
          "[NotificationContext] police summary snapshot error:",
          error,
        );
      },
    });
  }

  return subscribeDocCount({
    ref: notificationStateMainRef,
    applyCount,
    selectCount: (data) => Number(data?.actions?.police || 0),
    canUseData: (data) => data?.actionsUpdatedAt?.police != null,
    onMissingData: requestStudentNotificationRepair,
    onSnapshotError: (error) => {
      console.error(
        "[NotificationContext] police state snapshot error:",
        error,
      );
    },
  });
}
