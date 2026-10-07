import { onSnapshot } from "firebase/firestore";

export const subscribeDocCount = ({
  ref,
  applyCount,
  selectCount,
  canUseData,
  onMissingData,
  onSnapshotError,
}) => {
  let active = true;
  const unsubscribe = onSnapshot(
    ref,
    (snap) => {
      if (!active) return;
      const data = snap.exists() ? snap.data() || {} : null;
      const canUse =
        !!data && (typeof canUseData === "function" ? canUseData(data) : true);

      if (!canUse) {
        onMissingData?.();
      }

      applyCount(selectCount(canUse ? data : data || {}));
    },
    (error) => {
      if (!active) return;
      onSnapshotError?.(error);
      onMissingData?.();
      applyCount(0);
    },
  );

  return () => {
    if (!active) return;
    active = false;
    unsubscribe();
  };
};
