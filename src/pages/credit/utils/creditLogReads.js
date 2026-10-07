import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import { auth, db } from "../../../firebase";

// Share only overlapping in-flight reads; do not reuse settled/stale statistics.
const sessions = new WeakMap();
export function fetchCreditLogsSince(classId, studentUid, since) {
  const user = auth.currentUser;
  // Never share a teacher's pending read with a different login session.
  const pending = user ? (sessions.get(user) || new Map()) : new Map();
  if (user) sessions.set(user, pending);
  const key = JSON.stringify([classId, studentUid, since.getTime()]);
  if (pending.has(key)) return pending.get(key);
  const request = Promise.resolve().then(() => getDocs(query(
    collection(db, `classes/${classId}/students/${studentUid}/creditLogs`),
    where("timestamp", ">=", Timestamp.fromDate(since)),
  ))).finally(() => { pending.delete(key); });
  pending.set(key, request);
  return request;
}
