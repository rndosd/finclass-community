import { doc, getDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import app, { db } from "../../../firebase";

const functions = getFunctions(app, "asia-northeast3");

export async function saveProduct({ classId, product, productId }) {
  const fn = httpsCallable(functions, "createOrUpdateProduct");
  const { data } = await fn({ classId, product, productId });
  return data;
}

export async function deleteProductCascade({ classId, productId }) {
  const fn = httpsCallable(functions, "deleteProductCascade");
  const { data } = await fn({ classId, productId });
  return data;
}

export async function submitPayment({ classId, productId, amount }) {
  const fn = httpsCallable(functions, "processSubscriptionPayment");
  const { data } = await fn({ classId, productId, amount });
  return data;
}

export async function withdrawFromProduct({ classId, productId, studentUid }) {
  const fn = httpsCallable(functions, "withdrawFromProduct");
  const { data } = await fn({ classId, productId, studentUid });
  return data;
}

export async function terminateSubscription({ classId, productId, studentUid }) {
  const fn = httpsCallable(functions, "terminateSubscription");
  const { data } = await fn({ classId, productId, studentUid });
  return data;
}

export async function cancelPayment({ classId, productId, paymentNum, studentUid }) {
  const fn = httpsCallable(functions, "cancelSubscriptionPayment");
  const { data } = await fn({ classId, productId, paymentNum, studentUid });
  return data;
}

export async function loadPaymentsForProduct({ classId, studentUid, productId }) {
  const docRef = doc(db, `classes/${classId}/subscriptions/${studentUid}`);
  const snap = await getDoc(docRef);

  if (!snap.exists()) return [];

  const subData = snap.data()?.activeSubscriptions?.[productId];
  return subData?.paymentHistory ? [...subData.paymentHistory].reverse() : [];
}
