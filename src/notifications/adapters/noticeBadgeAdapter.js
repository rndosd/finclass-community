import { subscribeDocCount } from "./subscribeDocCount";

export function subscribeNoticeBadge({
  notificationStateMainRef,
  applyCount,
  requestStudentNotificationRepair,
}) {
  return subscribeDocCount({
    ref: notificationStateMainRef,
    applyCount,
    selectCount: (data) => Number(data?.inbox?.unreadCount || 0),
    canUseData: (data) => data?.inbox?.updatedAt != null,
    onMissingData: requestStudentNotificationRepair,
  });
}
