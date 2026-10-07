import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase";

const inflightNotificationStateRepairs = new Map();

export function requestNotificationStateRepair({
  classId,
  studentUid = null,
  scope = "self",
} = {}) {
  if (!classId) {
    return null;
  }

  const normalizedScope = scope === "class" ? "class" : "self";
  const requestKey = `${classId}:${normalizedScope}:${studentUid || "self"}`;

  if (inflightNotificationStateRepairs.has(requestKey)) {
    return inflightNotificationStateRepairs.get(requestKey);
  }

  const rebuildNotificationStateMain = httpsCallable(
    functions,
    "rebuildNotificationStateMain",
  );

  const requestPromise = rebuildNotificationStateMain({
    classId,
    studentUid,
    scope: normalizedScope,
  }).finally(() => {
    inflightNotificationStateRepairs.delete(requestKey);
  });

  inflightNotificationStateRepairs.set(requestKey, requestPromise);
  return requestPromise;
}
