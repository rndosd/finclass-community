"use strict";

const RELATIVE_ECONOMY_SUMMARY_SCHEMA_VERSION = 1;

const getRelativeEconomySummaryPath = (classId) =>
    `classes/${classId}/analytics/relativeEconomy`;

const normalizeText = (value) => String(value ?? "").trim();
const normalizeNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
};

function getRelativeEconomyStudentSourceFingerprint(data = {}) {
    return JSON.stringify({
        role: normalizeText(data.role).toLowerCase(),
        name: normalizeText(data.name),
        studentNumber: normalizeText(data.studentNumber),
        creditScore: normalizeNumber(data.creditScore),
        assets: {
            cash: normalizeNumber(data.assets?.cash),
            deposit: normalizeNumber(data.assets?.deposit),
            loan: normalizeNumber(data.assets?.loan),
            itemValue: normalizeNumber(data.assets?.itemValue),
            usdBalance: normalizeNumber(data.assets?.usdBalance),
            stockValue: normalizeNumber(data.assets?.stockValue?.value),
        },
    });
}

async function markRelativeEconomyProjectionDirty({
    db,
    FieldValue,
    classId,
    reason = "unknown",
    nowMs = Date.now(),
}) {
    if (!db || !FieldValue || !classId) return null;

    return db.doc(getRelativeEconomySummaryPath(classId)).set(
        {
            schemaVersion: RELATIVE_ECONOMY_SUMMARY_SCHEMA_VERSION,
            needsRefresh: true,
            lastMutationAtMs: nowMs,
            lastMutationReason: reason,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
}

module.exports = {
    RELATIVE_ECONOMY_SUMMARY_SCHEMA_VERSION,
    getRelativeEconomyStudentSourceFingerprint,
    getRelativeEconomySummaryPath,
    markRelativeEconomyProjectionDirty,
};
