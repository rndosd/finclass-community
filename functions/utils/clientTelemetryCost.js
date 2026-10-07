"use strict";
const { createHash } = require("node:crypto");
const ROUTES = new Set([
    "dashboard", "assets", "stock", "bank", "police", "tax", "labor", "job-board",
    "store", "credit", "missions", "realestate", "arcade", "assembly", "news",
    "marketplace", "credentials", "economy-learning", "case-library", "account", "changepassword",
]);
const METRICS = [
    "approxBytes",
    "estimatedBytes",
    "docCount",
    "estimatedDocCount",
    "eventCount",
];
function routeName(value) {
    if (value === "/_shared") return value;
    const parts = String(value || "/")
        .split("/")
        .filter(Boolean);
    if (parts[0] === "manage")
        return [
            "assets",
            "permissions",
            "dashboard",
            "time-settings",
            "students",
        ].includes(parts[1])
            ? "/manage/" + parts[1]
            : "/manage";
    return ROUTES.has(parts[0]) ? "/" + parts[0] : "/_other";
}
function normalizeCostEvent(raw, today) {
    const sampleRate = Number(raw.sampleRate);
    if (!Number.isFinite(sampleRate) || sampleRate < 0.001 || sampleRate > 1)
        throw new Error("Invalid sample rate");
    const date = String(raw.date || "");
    const age = (Date.parse(today) - Date.parse(date)) / 86400000;
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(Date.parse(date)).toISOString().slice(0, 10) !== date ||
        !Number.isInteger(age) ||
        age < 0 ||
        age > 1
    )
        throw new Error("Invalid event date");
    const read = (name, max) => {
        const n = Number(raw[name]);
        if (!Number.isSafeInteger(n) || n < 0 || n > max)
            throw new Error("Invalid " + name);
        return n;
    };
    const approxBytes = read("approxBytes", 1000000000);
    const docCount = read("docCount", 10000000);
    const eventCount = read("eventCount", 1000000);
    if (!eventCount || !docCount) throw new Error("Empty aggregate");
    return {
        classId: raw.classId,
        date,
        route: routeName(raw.route),
        approxBytes,
        docCount,
        eventCount,
        estimatedBytes: Math.round(approxBytes / sampleRate),
        estimatedDocCount: Math.round(docCount / sampleRate),
    };
}
function routeKey(route) {
    return createHash("sha256").update(route).digest("hex").slice(0, 16);
}
function emptyMetrics() {
    return Object.fromEntries(METRICS.map((key) => [key, 0]));
}
function addMetrics(target, row) {
    METRICS.forEach((key) => {
        target[key] = (target[key] || 0) + Number(row[key] || 0);
    });
}
function buildCostReport(documents, sortBy = "reads") {
    const totals = { ...emptyMetrics(), writeCount: 0 };
    const byRoute = new Map();
    const byClass = new Map();
    const routeRows = [];
    let updatedAt = "";
    for (const data of documents) {
        const className = data.className || data.classId;
        const cls = byClass.get(data.classId) || {
            classId: data.classId,
            className,
            ...emptyMetrics(),
        };
        totals.writeCount += Number(data.writeCount || 0);
        if (data.updatedAt && data.updatedAt > updatedAt)
            updatedAt = data.updatedAt;
        for (const row of Object.values(data.routes || {})) {
            addMetrics(totals, row);
            addMetrics(cls, row);
            const route = byRoute.get(row.route) || {
                route: row.route,
                ...emptyMetrics(),
            };
            addMetrics(route, row);
            byRoute.set(row.route, route);
            routeRows.push({
                classId: data.classId,
                className,
                date: data.date,
                ...row,
            });
        }
        byClass.set(data.classId, cls);
    }
    const key = sortBy === "bytes" ? "estimatedBytes" : "estimatedDocCount";
    const decorate = (rows) =>
        rows
            .map((row) => ({
                ...row,
                share: totals[key] ? row[key] / totals[key] : 0,
            }))
            .sort((a, b) => b[key] - a[key]);
    return {
        totals,
        topRoutes: decorate([...byRoute.values()]),
        topClasses: decorate([...byClass.values()]),
        routeRows: decorate(routeRows).slice(0, 120),
        rowCount: routeRows.length,
        updatedAt,
        scope: {
            type: "allInstrumentedClasses",
            classes: [...byClass.values()].map(({ classId, className }) => ({
                classId,
                className,
            })),
        },
    };
}
module.exports = { METRICS, normalizeCostEvent, routeKey, buildCostReport };
