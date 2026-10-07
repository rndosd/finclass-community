"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { recordCost, reportCost } = require("../utils/clientTelemetryCostService");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const MAX_EVENTS_PER_CALL = 100;
const MAX_REPORT_DAYS = 10;
const ACTIVITY_SCOPE_LIMIT = 40;
const ACTIVITY_SCOPE_CACHE_TTL_MS = 10 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const OPERATING_START_HOUR_KST = 8;
const OPERATING_END_HOUR_KST = 15;

let activityScopeCache = {
    expiresAt: 0,
    classIds: new Set(),
    rows: [],
};

function formatDateKeyInKST(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const shifted = new Date(date.getTime() + KST_OFFSET_MS);
    const pad = (part) => String(part).padStart(2, "0");
    return [
        shifted.getUTCFullYear(),
        pad(shifted.getUTCMonth() + 1),
        pad(shifted.getUTCDate()),
    ].join("-");
}

function parseDateKey(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const [year, month, day] = text.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
    return formatDateKeyInKST(parsed) === text ? parsed : null;
}

function isWithinTelemetryOperatingHours(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const shifted = new Date(date.getTime() + KST_OFFSET_MS);
    const day = shifted.getUTCDay();
    const hour = shifted.getUTCHours();

    return (
        day >= 1 &&
        day <= 5 &&
        hour >= OPERATING_START_HOUR_KST &&
        hour < OPERATING_END_HOUR_KST
    );
}

function enumerateDateKeys(startDate, endDate) {
    const start = parseDateKey(startDate);
    const end = parseDateKey(endDate);
    if (!start || !end || end.getTime() < start.getTime()) {
        throw new HttpsError("invalid-argument", "Invalid date range.");
    }

    const keys = [];
    let cursor = start;
    while (cursor.getTime() <= end.getTime()) {
        keys.push(formatDateKeyInKST(cursor));
        if (keys.length > MAX_REPORT_DAYS) {
            throw new HttpsError(
                "invalid-argument",
                `Date range is too large. Maximum ${MAX_REPORT_DAYS} days.`,
            );
        }
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    return keys;
}

function sanitizeKey(value, fallback = "unknown", maxLength = 80) {
    const text = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_/-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, maxLength);
    return text || fallback;
}

function sanitizeRoute(value) {
    const raw = String(value || "/").split("?")[0].split("#")[0].trim() || "/";
    if (raw === "/") return "/";
    return raw.startsWith("/") ? raw.slice(0, 120) : `/${raw.slice(0, 119)}`;
}

function routeToKey(route) {
    if (route === "/") return "root";
    return sanitizeKey(route.replace(/^\/+/, "").replace(/\//g, "_"), "root", 100);
}

function getAuthContext(request) {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Login is required.");
    }
    return {
        uid: request.auth.uid,
        role: request.auth.token?.role || null,
        classId: request.auth.token?.classId || null,
    };
}

function assertCanWriteTelemetry(requestClassId, ctx) {
    if (!requestClassId) {
        throw new HttpsError("invalid-argument", "classId is required.");
    }
    if (ctx.role === "admin") return;
    if (ctx.classId && ctx.classId === requestClassId) return;
    throw new HttpsError("permission-denied", "Cannot write telemetry for this class.");
}

function assertAdmin(ctx) {
    if (ctx.role !== "admin") {
        throw new HttpsError("permission-denied", "Admin role is required.");
    }
}

async function getTopActivityClassScope() {
    const now = Date.now();
    if (activityScopeCache.expiresAt > now && activityScopeCache.classIds.size > 0) {
        return activityScopeCache;
    }

    const snap = await db
        .collection("classes")
        .orderBy("activityCount", "desc")
        .limit(ACTIVITY_SCOPE_LIMIT)
        .get();

    const rows = snap.docs.map((docSnap) => {
        const data = docSnap.data() || {};
        return {
            classId: docSnap.id,
            className:
                String(data.className || "").trim() ||
                String(data.classDocId || "").trim() ||
                "",
            teacherName: String(data.teacherName || "").trim(),
            activityCount: Number(data.activityCount || 0),
        };
    });

    activityScopeCache = {
        expiresAt: now + ACTIVITY_SCOPE_CACHE_TTL_MS,
        classIds: new Set(rows.map((row) => row.classId)),
        rows,
    };

    return activityScopeCache;
}

function normalizeEvent(rawEvent, ctx) {
    const classId = String(rawEvent?.classId || "").trim();
    assertCanWriteTelemetry(classId, ctx);

    const approxBytes = Math.max(0, Math.round(Number(rawEvent?.approxBytes || 0)));
    const docCount = Math.max(0, Math.round(Number(rawEvent?.docCount || 0)));
    if (approxBytes <= 0 && docCount <= 0) return null;

    const sampleRateRaw = Number(rawEvent?.sampleRate || 1);
    const sampleRate =
        Number.isFinite(sampleRateRaw) && sampleRateRaw > 0
            ? Math.min(1, sampleRateRaw)
            : 1;
    const route = sanitizeRoute(rawEvent?.route);

    return {
        classId,
        route,
        routeKey: routeToKey(route),
        approxBytes,
        estimatedBytes: Math.round(approxBytes / sampleRate),
        docCount,
        estimatedDocCount: Math.round(docCount / sampleRate),
        eventCount: 1,
        estimatedEventCount: Math.round(1 / sampleRate),
    };
}

function aggregateEvents(events) {
    const grouped = new Map();

    events.forEach((event) => {
        const key = `${event.classId}:${event.routeKey}`;
        const current = grouped.get(key) || {
            classId: event.classId,
            route: event.route,
            routeKey: event.routeKey,
            approxBytes: 0,
            estimatedBytes: 0,
            docCount: 0,
            estimatedDocCount: 0,
            eventCount: 0,
            estimatedEventCount: 0,
        };

        current.approxBytes += event.approxBytes;
        current.estimatedBytes += event.estimatedBytes;
        current.docCount += event.docCount;
        current.estimatedDocCount += event.estimatedDocCount;
        current.eventCount += event.eventCount;
        current.estimatedEventCount += event.estimatedEventCount;

        grouped.set(key, current);
    });

    return [...grouped.values()];
}

exports.recordClientFirestoreTelemetry = onCall(
    {
        region: "asia-northeast3",
        memory: "256MiB",
        timeoutSeconds: 30,
    },
    async (request) => {
        const ctx = getAuthContext(request);
        if (request.data?.version === 2) return recordCost(request, ctx, formatDateKeyInKST(), assertCanWriteTelemetry);
        const rawEvents = Array.isArray(request.data?.events) ? request.data.events : [];
        if (rawEvents.length === 0) {
            return { accepted: 0 };
        }
        if (rawEvents.length > MAX_EVENTS_PER_CALL) {
            throw new HttpsError("invalid-argument", "Too many telemetry events.");
        }
        if (!isWithinTelemetryOperatingHours()) {
            return {
                accepted: 0,
                skipped: "outsideOperatingHours",
                operatingHours: {
                    timezone: "Asia/Seoul",
                    weekdays: "mon-fri",
                    startHour: OPERATING_START_HOUR_KST,
                    endHour: OPERATING_END_HOUR_KST,
                },
            };
        }

        const dateKey = formatDateKeyInKST(new Date());
        const activityScope = await getTopActivityClassScope();
        const normalizedEvents = rawEvents
            .map((event) => normalizeEvent(event, ctx))
            .filter((event) => event && activityScope.classIds.has(event.classId))
            .filter(Boolean);
        const aggregates = aggregateEvents(normalizedEvents);

        const batch = db.batch();
        aggregates.forEach((row) => {
            const ref = db.doc(
                `classes/${row.classId}/clientTelemetryDaily/${dateKey}/routeStats/${row.routeKey}`,
            );
            const patch = {
                classId: row.classId,
                date: dateKey,
                route: row.route,
                routeKey: row.routeKey,
                updatedAt: FieldValue.serverTimestamp(),
                totalApproxBytes: FieldValue.increment(row.approxBytes),
                totalEstimatedBytes: FieldValue.increment(row.estimatedBytes),
                totalDocCount: FieldValue.increment(row.docCount),
                totalEstimatedDocCount: FieldValue.increment(row.estimatedDocCount),
                totalEventCount: FieldValue.increment(row.eventCount),
                totalEstimatedEventCount: FieldValue.increment(row.estimatedEventCount),
            };

            batch.set(ref, patch, { merge: true });
        });

        if (aggregates.length > 0) {
            await batch.commit();
        }

        return {
            accepted: normalizedEvents.length,
            routeRows: aggregates.length,
            date: dateKey,
            scope: {
                type: "topActivityClasses",
                limit: ACTIVITY_SCOPE_LIMIT,
            },
        };
    },
);

function addToMap(map, key, patch) {
    const current = map.get(key) || { ...patch, approxBytes: 0, estimatedBytes: 0, docCount: 0, eventCount: 0 };
    current.approxBytes += Number(patch.approxBytes || 0);
    current.estimatedBytes += Number(patch.estimatedBytes || 0);
    current.docCount += Number(patch.docCount || 0);
    current.eventCount += Number(patch.eventCount || 0);
    map.set(key, current);
}

function normalizeMetricBucket(raw = {}) {
    return {
        approxBytes: Number(raw.approxBytes || raw.totalApproxBytes || 0),
        estimatedBytes: Number(raw.estimatedBytes || raw.totalEstimatedBytes || 0),
        docCount: Number(raw.docCount || raw.totalDocCount || 0),
        eventCount: Number(raw.eventCount || raw.totalEventCount || 0),
    };
}

function getClassName(classNameById, classId) {
    const normalizedClassId = String(classId || "").trim();
    return classNameById.get(normalizedClassId) || normalizedClassId || "unknown";
}

exports.getClientFirestoreTelemetryReport = onCall(
    {
        region: "asia-northeast3",
        memory: "256MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        const ctx = getAuthContext(request);
        assertAdmin(ctx);

        const endDate = String(request.data?.endDate || formatDateKeyInKST()).trim();
        const startDate = String(request.data?.startDate || endDate).trim();
        const dateKeys = enumerateDateKeys(startDate, endDate);
        if (request.data?.version === 2) return reportCost(request, dateKeys);
        const classIdFilter = String(request.data?.classId || "").trim();
        const activityScope = await getTopActivityClassScope();
        const classNameById = new Map(
            activityScope.rows.map((row) => [
                row.classId,
                row.className || row.classId,
            ]),
        );

        const queryRef = db.collectionGroup("routeStats").where("date", "in", dateKeys);
        const snap = await queryRef.get();
        const byRoute = new Map();
        const byClass = new Map();
        const routeRows = [];
        const totals = {
            approxBytes: 0,
            estimatedBytes: 0,
            docCount: 0,
            eventCount: 0,
        };

        snap.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const rowClassId = String(data.classId || "").trim();

            if (classIdFilter && rowClassId !== classIdFilter) return;

            const bucket = normalizeMetricBucket(data);
            const className = getClassName(classNameById, rowClassId);
            totals.approxBytes += bucket.approxBytes;
            totals.estimatedBytes += bucket.estimatedBytes;
            totals.docCount += bucket.docCount;
            totals.eventCount += bucket.eventCount;

            addToMap(byRoute, data.route || data.routeKey || "unknown", {
                route: data.route || data.routeKey || "unknown",
                approxBytes: bucket.approxBytes,
                estimatedBytes: bucket.estimatedBytes,
                docCount: bucket.docCount,
                eventCount: bucket.eventCount,
            });
            addToMap(byClass, rowClassId || "unknown", {
                classId: rowClassId || "unknown",
                className,
                teacherName:
                    activityScope.rows.find((row) => row.classId === rowClassId)
                        ?.teacherName || "",
                approxBytes: bucket.approxBytes,
                estimatedBytes: bucket.estimatedBytes,
                docCount: bucket.docCount,
                eventCount: bucket.eventCount,
            });

            routeRows.push({
                id: docSnap.id,
                classId: rowClassId,
                className,
                date: data.date || "",
                route: data.route || "",
                ...bucket,
            });
        });

        const sortRows = (rows) =>
            rows.sort((a, b) => {
                const metric = request.data?.sortBy === "reads" ? "docCount" : "estimatedBytes";
                return Number(b[metric] || 0) - Number(a[metric] || 0);
            });

        return {
            startDate,
            endDate,
            dateKeys,
            scope: {
                type: "topActivityClasses",
                limit: ACTIVITY_SCOPE_LIMIT,
                classes: activityScope.rows.map((row) => ({
                    ...row,
                    className: row.className || row.classId,
                })),
            },
            totals,
            topRoutes: sortRows([...byRoute.values()]).slice(0, 30),
            topClasses: sortRows([...byClass.values()]).slice(0, 30),
            routeRows: sortRows(routeRows).slice(0, 120),
            rowCount: routeRows.length,
        };
    },
);
