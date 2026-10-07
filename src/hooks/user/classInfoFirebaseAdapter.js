import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { normalizeClassCurrencyData } from "../../utils/currencyUnit";

export function retainFirebaseClassInfoSubscription({
  classId,
  queryClient,
  onReady,
}) {
  let active = true;
  const unsubscribe = onSnapshot(
    doc(db, "classes", classId),
    (snap) => {
      if (!active) return;
      queryClient.setQueryData(
        ["classInfo", classId],
        snap.exists()
          ? {
              classId: snap.id,
              ...normalizeClassCurrencyData(snap.data()),
            }
          : null,
      );
      onReady?.();
    },
    (error) => {
      if (!active) return;
      console.error("[useClassInfo] class listen error:", {
        classId,
        code: error?.code,
        message: error?.message,
      });
      onReady?.();
    },
  );

  return () => {
    active = false;
    unsubscribe();
  };
}
