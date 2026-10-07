import { subscribeCaseLibraryUnreadCount } from "../../pages/caseLibrary/services/caseLibraryReadStateService";

export function subscribeCaseLibraryBadge({
  classId,
  uid,
  isTeacher,
  applyCount,
}) {
  if (!isTeacher) {
    applyCount(0);
    return () => {};
  }

  return subscribeCaseLibraryUnreadCount({
    classId,
    uid,
    onChange: applyCount,
    onError: (error) => {
      console.error(
        "[NotificationContext] case library unread subscribe failed:",
        error,
      );
      applyCount(0);
    },
  });
}
