import { collection, doc, getDoc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase";

export function retainFirebaseSubscriptionProducts({
  classId,
  queryClient,
  productsKey,
  onLoaded,
  onError = () => {},
  onSuccess = () => {},
}) {
  const qProducts = query(
    collection(db, "classes", classId, "subscriptionProducts"),
    orderBy("createdAt", "desc"),
  );
  let isCancelled = false;
  const unsubscribe = onSnapshot(
    qProducts,
    (snap) => {
      if (isCancelled) return;
      const data = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      queryClient.setQueryData(productsKey, data);
      onSuccess();
      onLoaded();
    },
    () => {
      if (isCancelled) return;
      onError();
      onLoaded();
    },
  );
  return () => { isCancelled = true; unsubscribe(); };
}

export function retainOrFetchFirebaseSubscriptionParticipations({
  classId,
  uid,
  queryClient,
  participationsKey,
  participationsMode,
  onLoaded,
  onError = () => {},
  onSuccess = () => {},
}) {
  let isCancelled = false;
  const subDocRef = doc(db, `classes/${classId}/subscriptions`, uid);
  const markLoaded = () => {
    if (isCancelled) return;
    onLoaded();
  };
  const handleError = () => {
    if (isCancelled) return;
    onError();
    markLoaded();
  };

  if (participationsMode === "realtime") {
    const unsubscribe = onSnapshot(subDocRef, (snap) => {
      if (isCancelled) return;
      const data = snap.data();
      queryClient.setQueryData(participationsKey, data?.activeSubscriptions || {});
      onSuccess();
      markLoaded();
    }, handleError);

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }

  void getDoc(subDocRef)
    .then((snap) => {
      if (isCancelled) return;
      const data = snap.data();
      queryClient.setQueryData(participationsKey, data?.activeSubscriptions || {});
      onSuccess();
    })
    .catch(handleError)
    .finally(() => {
      markLoaded();
    });

  return () => {
    isCancelled = true;
  };
}
