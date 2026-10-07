"use strict";

const admin = require("../firebaseAdminCompat");
const { FieldValue } = require("firebase-admin/firestore");
const { canUseFeature, canUsePagePolicy } = require("./planManager");
const {
    buildTaxEventFromIncomeTax,
    normalizeTaxEvent,
} = require("./taxEvent");
const { formatActivityLogDescription } = require("./activityLogDescription");

const db = admin.firestore();

const MISSION_TOKEN_LOG_CURRENCIES = new Set([
    "mission_token",
    "미션토큰",
    "미션 토큰",
]);

const normalizeActivityPathId = (value, fieldName) => {
    if (typeof value !== "string") {
        throw new Error(`activity log write failed: ${fieldName} must be a string`);
    }
    const normalized = value.trim();
    if (
        !normalized ||
        normalized !== value ||
        normalized.length > 128 ||
        normalized === "." ||
        normalized === ".." ||
        normalized.includes("/") ||
        /[\u0000-\u001f\u007f]/.test(normalized)
    ) {
        throw new Error(`activity log write failed: invalid ${fieldName}`);
    }
    return normalized;
};

const SERVICE_TO_PAGE_KEY = {
    admin: "assetManager",
    assetManager: "assetManager",
    bank: "bank",
    stock: "stock",
    tax: "tax",
    payroll: "labor",
    labor: "labor",
    police: "police",
    mission: "mission",
    credentials: "credentials",
    realestate: "realestate",
    store: "store",
    credit: "credit",
    donation: "donation",
    arcade: "arcade",
    news: "news",
    assembly: "assembly",
    jobBoard: "jobBoard",
    marketplace: "marketplace",
};

const deriveActivityScope = ({
    activityScope,
    currency,
    currencyType,
    assetType,
}) => {
    if (activityScope) return activityScope;
    if (
        assetType === "missionToken" ||
        currencyType === "missionToken" ||
        MISSION_TOKEN_LOG_CURRENCIES.has(String(currency || "").trim())
    ) {
        return "mission_token";
    }
    return "general";
};

const deriveAssetType = ({ assetType, currency, currencyType }) => {
    if (assetType) return assetType;
    if (currencyType === "usdBalance" || currency === "FIN") return "usdBalance";
    if (
        currencyType === "missionToken" ||
        MISSION_TOKEN_LOG_CURRENCIES.has(String(currency || "").trim())
    ) {
        return "missionToken";
    }
    return null;
};

const resolvePageKey = (context = {}) => {
    if (context.pageKey) return context.pageKey;
    if (!context.serviceName) return null;
    return SERVICE_TO_PAGE_KEY[context.serviceName] || null;
};

const shouldWriteLog = (config, planType, context = {}, family) => {
    if (context.forceWrite === true) {
        return true;
    }

    const pageKey = resolvePageKey(context);

    if (pageKey) {
        return canUsePagePolicy(
            config,
            planType,
            pageKey,
            family === "activity" ? "activityLog" : "creditLog",
        );
    }

    const serviceName = context.serviceName || "etc";
    return canUseFeature(
        config,
        planType,
        serviceName,
        family === "activity" ? "enableLog" : "enableCredit",
    );
};

const attachLogContext = (payload, context = {}) => {
    const pageKey = resolvePageKey(context);
    if (pageKey && !payload.pageKey) {
        payload.pageKey = pageKey;
    }
    if (context.serviceName && !payload.serviceName) {
        payload.serviceName = context.serviceName;
    }
    if (context.actionKey && !payload.actionKey) {
        payload.actionKey = context.actionKey;
    }
    return payload;
};

const omitUndefined = (value = {}) =>
    Object.fromEntries(
        Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
    );

const omitServerOwnedActivityFields = (value = {}) => {
    const safeValue = { ...value };
    delete safeValue.classId;
    delete safeValue.studentUid;
    delete safeValue.createdAt;
    delete safeValue.timestamp;
    return omitUndefined(safeValue);
};

const resolveTaxEventFromLogData = (logData = {}) =>
    normalizeTaxEvent(logData?.taxEvent) ||
    buildTaxEventFromIncomeTax({
        incomeTax: logData?.incomeTax,
        dateKey: logData?.taxEventDateKey,
        occurredAt: logData?.timestamp || new Date(),
        sourceDoc: logData?.relatedDoc,
    });

const normalizeActivityLogPayload = (classId, logData = {}) => {
    const {
        studentUid,
        type = "system",
        category = "general",
        subCategory,
        amount = 0,
        description = "",
        relatedDoc,
        currency = "class_currency",
        ...extraFields
    } = logData;

    const normalizedClassId = normalizeActivityPathId(classId, "classId");
    const normalizedStudentUid = normalizeActivityPathId(studentUid, "studentUid");

    const activityScope = deriveActivityScope({
        activityScope: extraFields.activityScope,
        currency,
        currencyType: extraFields.currencyType,
        assetType: extraFields.assetType,
    });
    const assetType = deriveAssetType({
        assetType: extraFields.assetType,
        currency,
        currencyType: extraFields.currencyType,
    });
    const derivedTaxEvent = resolveTaxEventFromLogData(logData);
    const normalizedExtraFields = omitServerOwnedActivityFields(extraFields);
    delete normalizedExtraFields.taxEvent;
    delete normalizedExtraFields.taxEventDateKey;


    return {
        classId: normalizedClassId,
        studentUid: normalizedStudentUid,
        type,
        category,
        description: formatActivityLogDescription({
            ...logData,
            type,
            category,
            amount,
            description,
            currency,
        }),
        amount: Number(amount) || 0,
        createdAt: FieldValue.serverTimestamp(),
        timestamp: FieldValue.serverTimestamp(),
        currency,
        activityScope,
        ...(subCategory && { subCategory }),
        ...(relatedDoc && { relatedDoc }),
        ...(assetType ? { assetType } : {}),
        ...normalizedExtraFields,
        ...(derivedTaxEvent ? { taxEvent: derivedTaxEvent } : {}),
    };
};

const normalizeCreditLogPayload = (classId, data = {}) => {
    const {
        studentUid,
        delta = 0,
        reason = "사유 없음",
        source = "system",
        issuedByUid = null,
        relatedDoc = null,
        ...extraFields
    } = data || {};

    if (!classId || !studentUid) {
        throw new Error("credit log write failed: missing classId or studentUid");
    }

    return {
        classId,
        studentUid,
        delta: Number(delta) || 0,
        reason,
        source,
        issuedByUid,
        ...(relatedDoc ? { relatedDoc } : {}),
        ...omitUndefined(extraFields),
        timestamp: FieldValue.serverTimestamp(),
    };
};

const stageActivityLog = (writer, classId, logData, context = {}) => {
    const { config, planType = "FREE", customId = null } = context;
    const hasTaxEvent = Boolean(resolveTaxEventFromLogData(logData));
    if (!hasTaxEvent && !shouldWriteLog(config, planType, context, "activity")) {
        return null;
    }

    const payload = attachLogContext(
        normalizeActivityLogPayload(classId, logData),
        context,
    );
    const activityLogs = db.collection(
        `classes/${payload.classId}/students/${payload.studentUid}/activityLogs`,
    );
    const ref = customId ? activityLogs.doc(customId) : activityLogs.doc();

    writer.set(ref, payload);
    return ref.id;
};

const logActivity = async (classId, logData, context = {}) => {
    const { config, planType = "FREE", customId = null } = context;
    const hasTaxEvent = Boolean(resolveTaxEventFromLogData(logData));
    if (!hasTaxEvent && !shouldWriteLog(config, planType, context, "activity")) {
        return null;
    }
    if (!classId || !logData?.studentUid) return null;

    const payload = attachLogContext(
        normalizeActivityLogPayload(classId, logData),
        context,
    );
    const activityLogs = db.collection(
        `classes/${payload.classId}/students/${payload.studentUid}/activityLogs`,
    );
    const ref = customId ? activityLogs.doc(customId) : activityLogs.doc();
    await ref.set(payload);

    return ref.id;
};

const stageCreditLog = (writer, classId, data, context = {}) => {
    const { config, planType = "FREE" } = context;
    if (!shouldWriteLog(config, planType, context, "credit")) return null;
    if (!classId || !data?.studentUid) return null;

    const payload = attachLogContext(
        normalizeCreditLogPayload(classId, data),
        context,
    );
    const ref = db
        .collection(`classes/${classId}/students/${payload.studentUid}/creditLogs`)
        .doc();

    writer.set(ref, payload);
    return ref.id;
};

const logCredit = async (classId, data, context = {}) => {
    const { config, planType = "FREE" } = context;
    if (!shouldWriteLog(config, planType, context, "credit")) return null;
    if (!classId || !data?.studentUid) return null;

    const payload = attachLogContext(
        normalizeCreditLogPayload(classId, data),
        context,
    );
    const ref = await db
        .collection(`classes/${classId}/students/${payload.studentUid}/creditLogs`)
        .add(payload);

    return ref.id;
};

module.exports = {
    stageActivityLog,
    logActivity,
    stageCreditLog,
    logCredit,
};
