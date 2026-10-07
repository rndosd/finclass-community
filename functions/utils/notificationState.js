"use strict";

const NOTIFICATION_STATE_MAIN_VERSION = 1;
const NOTIFICATION_STATE_MAIN_DOC_ID = "main";
const NOTIFICATION_STATE_MAIN_COLLECTION_ID = "notificationState";

const NOTIFICATION_ACTION_KEYS = Object.freeze([
    "missions",
    "bank",
    "police",
    "tax",
    "credentials",
    "marketplace",
    "realestate",
    "assembly",
]);

const NOTIFICATION_ACTIVITY_KEYS = Object.freeze([
    "caseLibrary",
]);

function toSafeNonNegativeInteger(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }
    return Math.floor(parsed);
}

function createEmptyNotificationActionCounts() {
    return Object.fromEntries(
        NOTIFICATION_ACTION_KEYS.map((key) => [key, 0]),
    );
}

function createEmptyNotificationActionUpdatedAt() {
    return Object.fromEntries(
        NOTIFICATION_ACTION_KEYS.map((key) => [key, null]),
    );
}

function createEmptyNotificationActivityFlags() {
    return Object.fromEntries(
        NOTIFICATION_ACTIVITY_KEYS.map((key) => [key, false]),
    );
}

function normalizeNotificationActionCounts(source = {}) {
    const normalized = createEmptyNotificationActionCounts();

    NOTIFICATION_ACTION_KEYS.forEach((key) => {
        normalized[key] = toSafeNonNegativeInteger(source?.[key]);
    });

    return normalized;
}

function normalizeNotificationActivityFlags(source = {}) {
    const normalized = createEmptyNotificationActivityFlags();

    NOTIFICATION_ACTIVITY_KEYS.forEach((key) => {
        normalized[key] = source?.[key] === true;
    });

    return normalized;
}

function normalizeNotificationActionUpdatedAt(source = {}) {
    const normalized = createEmptyNotificationActionUpdatedAt();

    NOTIFICATION_ACTION_KEYS.forEach((key) => {
        normalized[key] = source?.[key] ?? null;
    });

    return normalized;
}

function getNotificationStateMainDocPath(classId, studentUid) {
    return `classes/${classId}/students/${studentUid}/${NOTIFICATION_STATE_MAIN_COLLECTION_ID}/${NOTIFICATION_STATE_MAIN_DOC_ID}`;
}

function createNotificationStateMainData({
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

function createNotificationStateMainInboxPatch({
    unreadCount = 0,
    updatedAt = null,
} = {}) {
    return {
        version: NOTIFICATION_STATE_MAIN_VERSION,
        inbox: {
            unreadCount: toSafeNonNegativeInteger(unreadCount),
            updatedAt: updatedAt ?? null,
        },
        updatedAt,
    };
}

function createNotificationStateMainActionPatch({
    actionKey = "",
    count = 0,
    updatedAt = null,
} = {}) {
    if (!NOTIFICATION_ACTION_KEYS.includes(actionKey)) {
        return {
            version: NOTIFICATION_STATE_MAIN_VERSION,
            updatedAt,
        };
    }

    return {
        version: NOTIFICATION_STATE_MAIN_VERSION,
        actions: {
            [actionKey]: toSafeNonNegativeInteger(count),
        },
        actionsUpdatedAt: {
            [actionKey]: updatedAt ?? null,
        },
        updatedAt,
    };
}

module.exports = {
    NOTIFICATION_STATE_MAIN_VERSION,
    NOTIFICATION_STATE_MAIN_DOC_ID,
    NOTIFICATION_STATE_MAIN_COLLECTION_ID,
    NOTIFICATION_ACTION_KEYS,
    NOTIFICATION_ACTIVITY_KEYS,
    createEmptyNotificationActionCounts,
    createEmptyNotificationActionUpdatedAt,
    createEmptyNotificationActivityFlags,
    normalizeNotificationActionCounts,
    normalizeNotificationActionUpdatedAt,
    normalizeNotificationActivityFlags,
    getNotificationStateMainDocPath,
    createNotificationStateMainData,
    createNotificationStateMainInboxPatch,
    createNotificationStateMainActionPatch,
};
