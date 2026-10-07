import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";

export function retainFirebaseBankBaseSubscriptions({ classId, queryClient, onLoaded = () => {}, onError = () => {} }) {
  let cancelled = false;
  const fail = (kind) => { if (!cancelled) onError(kind); };
  const unsubSettings = onSnapshot(
    doc(db, "classes", classId, "bank", "settings"),
    (snap) => {
      if (cancelled) return;
      queryClient.setQueryData(
        ["bankSettings", classId],
        snap.data() || {},
      );
      onLoaded("settings");
    },
    () => fail("settings"),
  );

  const unsubTiers = onSnapshot(
    doc(db, "classes", classId, "tierCriteria", "default"),
    (snap) => {
      if (cancelled) return;
      const sortedTiers = (snap.data()?.tiers || []).sort(
        (a, b) => (a.minScore || 0) - (b.minScore || 0),
      );
      queryClient.setQueryData(["tierCriteria", classId], sortedTiers);
      onLoaded("criteria");
    },
    () => fail("criteria"),
  );

  const unsubAdjust = onSnapshot(
    doc(db, "classes", classId, "bankConfig", "tierAdjustments"),
    (snap) => {
      if (cancelled) return;
      const rawData = snap.data();
      const adjustments = rawData?.byTier ? rawData.byTier : rawData || {};
      queryClient.setQueryData(["tierAdjustments", classId], adjustments);
      onLoaded("adjustments");
    },
    () => fail("adjustments"),
  );

  return () => {
    cancelled = true;
    unsubSettings();
    unsubTiers();
    unsubAdjust();
  };
}
