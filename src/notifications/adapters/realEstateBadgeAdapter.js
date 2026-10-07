import { subscribeDocCount } from "./subscribeDocCount";

export function subscribeRealEstateBadge({
  isTeacher,
  notificationStateMainRef,
  applyCount,
  requestStudentNotificationRepair,
}) {
  if (isTeacher) {
    applyCount(0);
    return () => {};
  }

  return subscribeDocCount({
    ref: notificationStateMainRef,
    applyCount,
    canUseData: (data) => data?.actionsUpdatedAt?.realestate != null,
    selectCount: (data) => Number(data?.actions?.realestate || 0),
    onMissingData: requestStudentNotificationRepair,
    onSnapshotError: (error) => {
      console.error(
        "[NotificationContext] realestate state snapshot error:",
        error,
      );
    },
  });
}
