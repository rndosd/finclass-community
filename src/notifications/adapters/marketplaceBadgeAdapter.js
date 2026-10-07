import { doc } from "firebase/firestore";
import { subscribeDocCount } from "./subscribeDocCount";

export function subscribeMarketplaceBadge({
  db,
  classId,
  isMarketplaceManager,
  notificationStateMainRef,
  applyCount,
  requestStudentNotificationRepair,
}) {
  if (isMarketplaceManager) {
    return subscribeDocCount({
      ref: doc(db, `classes/${classId}/notificationSummary/marketplace`),
      applyCount,
      selectCount: (data) => Number(data?.managerPendingCount || 0),
      onSnapshotError: (error) => {
        console.error(
          "[NotificationContext] marketplace summary snapshot error:",
          error,
        );
      },
    });
  }

  return subscribeDocCount({
    ref: notificationStateMainRef,
    applyCount,
    selectCount: (data) => Number(data?.actions?.marketplace || 0),
    canUseData: (data) => data?.actionsUpdatedAt?.marketplace != null,
    onMissingData: requestStudentNotificationRepair,
    onSnapshotError: (error) => {
      console.error("[NotificationContext] marketplace state snapshot error:", error);
    },
  });
}
