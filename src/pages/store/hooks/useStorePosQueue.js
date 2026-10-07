// src/pages/store/hooks/useStorePosQueue.js
import { useState, useEffect } from "react";
import { db } from "../../../firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { beginFirestoreSubscriptionDebug } from "../../../utils/firestoreSubscriptionDebug";

const useStorePosQueue = (classId, { enabled = true, debug = {} } = {}) => {
  const [queue, setQueue] = useState({}); // { [uid]: items[] }
  const [isLoading, setIsLoading] = useState(Boolean(enabled && classId));

  useEffect(() => {
    if (!classId || !enabled) {
      setQueue({});
      setIsLoading(false);
      return undefined;
    }

    setIsLoading(true);
    // POS 큐 전용 문서 구독
    const queueRef = doc(db, `classes/${classId}/storeSettings/posQueue`);
    const subscriptionDebug = beginFirestoreSubscriptionDebug({
      source: debug.source || "Store.posQueue",
      pathKey: "classes/{classId}/storeSettings/posQueue",
      classId,
      role: debug.role,
    });
    let cancelled = false;
    const unsubscribe = onSnapshot(queueRef, (snap) => {
      subscriptionDebug.recordSnapshot(snap);
      if (cancelled) return;
      setQueue(snap.exists() ? snap.data().queue || {} : {});
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      subscriptionDebug.stop();
    };
  }, [classId, debug.role, debug.source, enabled]);

  const updateQueue = async (newQueue) => {
    const queueRef = doc(db, `classes/${classId}/storeSettings/posQueue`);
    await setDoc(queueRef, { queue: newQueue }, { merge: true });
  };

  const clearQueue = async () => {
    const queueRef = doc(db, `classes/${classId}/storeSettings/posQueue`);
    await setDoc(queueRef, { queue: {} });
  };

  return { queue, updateQueue, clearQueue, isLoading };
};

export default useStorePosQueue;
