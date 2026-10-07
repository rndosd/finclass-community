"use strict";

const admin = require("../../firebaseAdminCompat");
const { HttpsError } = require("firebase-functions/v2/https");
const {
    formatDateKeyInKST,
    parseDateKeyAsKST,
    toDate,
} = require("../dateUtils");

function adminFieldPathDocumentId() {
    return admin.firestore.FieldPath.documentId();
}

const KST = "Asia/Seoul";
const BACKFILL_START_DATE = "2026-03-01";
const MAX_BACKFILL_DAYS = 180;

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

function cleanDateKey(value) {
    const text = String(value || "").trim();
    return isDateKey(text) ? text : "";
}

function requireDateKey(value, label = "date") {
    const dateKey = cleanDateKey(value);
    if (!dateKey) {
        throw new HttpsError("invalid-argument", `${label} must be YYYY-MM-DD.`);
    }
    return dateKey;
}

function getKstTodayKey(now = new Date()) {
    return formatDateKeyInKST(now);
}

function getKstYesterdayKey(now = new Date()) {
    return formatDateKeyInKST(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

function getDateWindow(dateKey) {
    const startDate = parseDateKeyAsKST(dateKey);
    const endDate = parseDateKeyAsKST(dateKey, { endOfDay: true });
    if (!startDate || !endDate) {
        throw new HttpsError("invalid-argument", "Invalid dateKey.");
    }
    return {
        startDate,
        endDate,
        startTs: admin.firestore.Timestamp.fromDate(startDate),
        endTs: admin.firestore.Timestamp.fromDate(endDate),
    };
}

function enumerateDateKeys(startDate, endDate, { maxDays = MAX_BACKFILL_DAYS } = {}) {
    const startKey = requireDateKey(startDate, "startDate");
    const endKey = requireDateKey(endDate, "endDate");
    let cursor = parseDateKeyAsKST(startKey);
    const end = parseDateKeyAsKST(endKey);
    if (!cursor || !end || end.getTime() < cursor.getTime()) {
        throw new HttpsError("invalid-argument", "Invalid date range.");
    }

    const keys = [];
    while (cursor.getTime() <= end.getTime()) {
        keys.push(formatDateKeyInKST(cursor));
        if (keys.length > maxDays) {
            throw new HttpsError(
                "invalid-argument",
                `Date range is too large. Maximum ${maxDays} days per call.`,
            );
        }
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    return keys;
}

function timestampToMillis(value) {
    const date = toDate(value);
    return date ? date.getTime() : null;
}

function isInWindow(value, window) {
    const millis = timestampToMillis(value);
    return Number.isFinite(millis) &&
        millis >= window.startDate.getTime() &&
        millis <= window.endDate.getTime();
}

function toIsoOrNull(value) {
    const millis = timestampToMillis(value);
    return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function toNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function roundAmount(value) {
    return Math.round(toNumber(value));
}

function stringOrNull(value) {
    const text = String(value ?? "").trim();
    return text || null;
}

function increment(target, key, amount = 1) {
    const mapKey = String(key || "unknown").trim() || "unknown";
    target[mapKey] = roundAmount(toNumber(target[mapKey]) + amount);
    return target[mapKey];
}

function addMetric(target, key, amount = 1) {
    target[key] = roundAmount(toNumber(target[key]) + amount);
}

function normalizeStudentNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : String(value);
}

function pickStudentSnapshot(row = {}, fallbackUid = "") {
    const uid = stringOrNull(
        row.studentUid ||
        row.uid ||
        row.userId ||
        row.targetStudentUid ||
        row.buyerUid ||
        row.sellerUid ||
        row.tenantUid ||
        row.ownerUid ||
        fallbackUid,
    ) || "unknown";
    return {
        uid,
        name: stringOrNull(
            row.studentName ||
            row.name ||
            row.targetStudentName ||
            row.buyerName ||
            row.sellerName ||
            row.tenantName ||
            row.ownerName,
        ),
        number: normalizeStudentNumber(
            row.studentNumber ||
            row.number ||
            row.studentNo ||
            row.targetStudentNumber ||
            row.buyerNumber ||
            row.sellerNumber,
        ),
    };
}

async function listStudents(classRef) {
    const snap = await classRef.collection("students").get();
    return snap.docs
        .map((docSnap) => {
            const data = docSnap.data() || {};
            return {
                uid: docSnap.id,
                name: stringOrNull(data.name) || stringOrNull(data.displayName) || "학생",
                number: normalizeStudentNumber(data.number || data.studentNumber),
                role: data.role || "student",
            };
        })
        .filter((student) => student.role === "student" || !student.role);
}

function ensureStudent(map, snapshot = {}) {
    const uid = String(snapshot.uid || "unknown").trim() || "unknown";
    if (!map[uid]) {
        map[uid] = {
            uid,
            studentName: snapshot.name || "학생",
            studentNumber: normalizeStudentNumber(snapshot.number),
            eventCount: 0,
        };
    } else {
        if (!map[uid].studentName && snapshot.name) map[uid].studentName = snapshot.name;
        if (map[uid].studentNumber === null && snapshot.number !== undefined) {
            map[uid].studentNumber = normalizeStudentNumber(snapshot.number);
        }
    }
    return map[uid];
}

function buildBasePayload({ classId, dateKey, domain, status, sourceCollections, sourceCounts, sourceRanges, generatedBy }) {
    return {
        schemaVersion: 1,
        classId,
        date: dateKey,
        domain,
        status,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        generatedBy: generatedBy || "scheduled",
        source: {
            collections: sourceCollections,
            counts: sourceCounts,
            ranges: sourceRanges,
        },
    };
}

async function hasAnyDocs(ref, constraints = []) {
    let queryRef = ref;
    constraints.forEach(([field, op, value]) => {
        queryRef = queryRef.where(field, op, value);
    });
    const snap = await queryRef.limit(1).get();
    return !snap.empty;
}

module.exports = {
    adminFieldPathDocumentId,
    KST,
    BACKFILL_START_DATE,
    MAX_BACKFILL_DAYS,
    cleanDateKey,
    requireDateKey,
    getKstTodayKey,
    getKstYesterdayKey,
    getDateWindow,
    enumerateDateKeys,
    timestampToMillis,
    isInWindow,
    toIsoOrNull,
    toNumber,
    roundAmount,
    stringOrNull,
    increment,
    addMetric,
    pickStudentSnapshot,
    listStudents,
    ensureStudent,
    buildBasePayload,
    hasAnyDocs,
};
