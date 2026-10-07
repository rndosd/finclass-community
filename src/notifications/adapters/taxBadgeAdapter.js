import { subscribeDocCount } from "./subscribeDocCount";

export function subscribeTaxBadge({
  isTeacher,
  notificationStateMainRef,
  applyCount,
  requestStudentNotificationRepair,
}) {
  if (isTeacher) {
    return () => {};
  }

  return subscribeDocCount({
    ref: notificationStateMainRef,
    applyCount,
    selectCount: (data) => Number(data?.actions?.tax || 0),
    canUseData: (data) => data?.actionsUpdatedAt?.tax != null,
    onMissingData: requestStudentNotificationRepair,
  });
}
