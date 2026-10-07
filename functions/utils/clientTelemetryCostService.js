"use strict";
const admin = require("../firebaseAdminCompat");
const { HttpsError } = require("firebase-functions/v2/https");
const {
    METRICS,
    normalizeCostEvent,
    routeKey,
    buildCostReport,
} = require("../utils/clientTelemetryCost");
const db = admin.firestore();
const cache = new Map();
function classId(value) {
    const id = String(value || "").trim();
    if (!id || id.includes("/") || id.length > 128)
        throw new HttpsError("invalid-argument", "Invalid classId");
    return id;
}
async function recordCost(request, ctx, today, assertCanWrite) {
    const events = request.data.events;
    if (!Array.isArray(events) || events.length > 80)
        throw new HttpsError("invalid-argument", "Invalid aggregates");
    const grouped = new Map();
    for (const raw of events) {
        const id = classId(raw?.classId);
        assertCanWrite(id, ctx);
        let row;
        try {
            row = normalizeCostEvent({ ...raw, classId: id }, today);
        } catch (error) {
            throw new HttpsError("invalid-argument", error.message);
        }
        const key = id + ":" + row.date;
        const patch = grouped.get(key) || {
            classId: id,
            date: row.date,
            routes: {},
        };
        const route = patch.routes[routeKey(row.route)] || { route: row.route };
        METRICS.forEach((name) => {
            route[name] = (route[name] || 0) + row[name];
        });
        patch.routes[routeKey(row.route)] = route;
        grouped.set(key, patch);
    }
    const batch = db.batch();
    for (const patch of grouped.values()) {
        const routes = {};
        for (const [key, row] of Object.entries(patch.routes)) {
            routes[key] = { route: row.route };
            METRICS.forEach((name) => {
                routes[key][name] = admin.firestore.FieldValue.increment(
                    row[name],
                );
            });
        }
        batch.set(
            db.doc(
                "classes/" +
                    patch.classId +
                    "/clientTelemetryCostDaily/" +
                    patch.date,
            ),
            {
                classId: patch.classId,
                date: patch.date,
                version: 2,
                routes,
                writeCount: admin.firestore.FieldValue.increment(1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    }
    if (grouped.size) await batch.commit();
    return { accepted: events.length, writes: grouped.size, version: 2 };
}
async function reportCost(request, dateKeys) {
    const id = request.data?.classId ? classId(request.data.classId) : "";
    const sortBy = request.data?.sortBy === "bytes" ? "bytes" : "reads";
    const key = JSON.stringify([dateKeys, id, sortBy]);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now())
        return { ...cached.report, cached: true, queryDocumentCount: 0 };
    let documents;
    let queryDocumentCount;
    if (id) {
        const snapshots = await db.getAll(
            ...dateKeys.map((date) =>
                db.doc("classes/" + id + "/clientTelemetryCostDaily/" + date),
            ),
        );
        documents = snapshots
            .filter((snap) => snap.exists)
            .map((snap) => snap.data());
        queryDocumentCount = snapshots.length;
    } else {
        const snap = await db
            .collectionGroup("clientTelemetryCostDaily")
            .where("date", "in", dateKeys)
            .get();
        documents = snap.docs.map((doc) => doc.data());
        queryDocumentCount = Math.max(1, snap.size);
    }
    // Names are fetched only for observed classes, only on an uncached report.
    const ids = [...new Set(documents.map((data) => data.classId))];
    const names = ids.length
        ? await db.getAll(...ids.map((value) => db.doc("classes/" + value)))
        : [];
    queryDocumentCount += names.length;
    const byId = new Map(
        names.map((snap) => [
            snap.id,
            snap.exists ? snap.data().className || snap.id : snap.id,
        ]),
    );
    const report = {
        ...buildCostReport(
            documents.map((data) => ({
                ...data,
                className: byId.get(data.classId),
                updatedAt: data.updatedAt?.toDate?.().toISOString() || "",
            })),
            sortBy,
        ),
        version: 2,
        startDate: dateKeys[0],
        endDate: dateKeys[dateKeys.length - 1],
        generatedAt: new Date().toISOString(),
        queryDocumentCount,
        cached: false,
    };
    if (cache.size >= 20) cache.clear();
    cache.set(key, { expiresAt: Date.now() + 5 * 60000, report });
    return report;
}
module.exports = { recordCost, reportCost };
