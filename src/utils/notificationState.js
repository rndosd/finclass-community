import { doc } from "firebase/firestore";

export const NOTIFICATION_STATE_MAIN_VERSION = 1;
export const NOTIFICATION_STATE_MAIN_DOC_ID = "main";
export const NOTIFICATION_STATE_MAIN_COLLECTION_ID = "notificationState";

export const NOTIFICATION_ACTION_KEYS = Object.freeze([
  "missions",
  "bank",
  "police",
  "tax",
  "credentials",
  "marketplace",
  "realestate",
  "assembly",
]);

export const NOTIFICATION_ACTIVITY_KEYS = Object.freeze([
  "caseLibrary",
]);

function toSafeNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

export function createEmptyNotificationActionCounts() {
  return Object.fromEntries(
    NOTIFICATION_ACTION_KEYS.map((key) => [key, 0]),
  );
}

export function createEmptyNotificationActionUpdatedAt() {
  return Object.fromEntries(
    NOTIFICATION_ACTION_KEYS.map((key) => [key, null]),
  );
}

export function createEmptyNotificationActivityCounts() {
  return Object.fromEntries(
    NOTIFICATION_ACTIVITY_KEYS.map((key) => [key, 0]),
  );
}

export function createEmptyNotificationActionFlags() {
  return Object.fromEntries(
    NOTIFICATION_ACTION_KEYS.map((key) => [key, false]),
  );
}

export function createEmptyNotificationActivityFlags() {
  return Object.fromEntries(
    NOTIFICATION_ACTIVITY_KEYS.map((key) => [key, false]),
  );
}

export function normalizeNotificationActionCounts(source = {}) {
  const normalized = createEmptyNotificationActionCounts();

  NOTIFICATION_ACTION_KEYS.forEach((key) => {
    normalized[key] = toSafeNonNegativeInteger(source?.[key]);
  });

  return normalized;
}

export function normalizeNotificationActivityFlags(source = {}) {
  const normalized = createEmptyNotificationActivityFlags();

  NOTIFICATION_ACTIVITY_KEYS.forEach((key) => {
    normalized[key] = source?.[key] === true;
  });

  return normalized;
}

export function normalizeNotificationActionUpdatedAt(source = {}) {
  const normalized = createEmptyNotificationActionUpdatedAt();

  NOTIFICATION_ACTION_KEYS.forEach((key) => {
    normalized[key] = source?.[key] ?? null;
  });

  return normalized;
}

export function createNotificationStateMainData({
  inbox = {},
  actions = {},
  actionsUpdatedAt = {},
  activity = {},
  updatedAt = null,
} = {}) {
  return {
    version: NOTIFICATION_STATE_MAIN_VERSION,
    inbox: {
      unreadCount: toSafeNonNegativeInteger(inbox?.unreadCount),
      updatedAt: inbox?.updatedAt ?? null,
    },
    actions: normalizeNotificationActionCounts(actions),
    actionsUpdatedAt: normalizeNotificationActionUpdatedAt(actionsUpdatedAt),
    activity: normalizeNotificationActivityFlags(activity),
    updatedAt,
  };
}

export function getNotificationStateMainPath(classId, uid) {
  return `classes/${classId}/students/${uid}/${NOTIFICATION_STATE_MAIN_COLLECTION_ID}/${NOTIFICATION_STATE_MAIN_DOC_ID}`;
}

export function getNotificationStateMainRef(db, classId, uid) {
  return doc(
    db,
    "classes",
    classId,
    "students",
    uid,
    NOTIFICATION_STATE_MAIN_COLLECTION_ID,
    NOTIFICATION_STATE_MAIN_DOC_ID,
  );
}
