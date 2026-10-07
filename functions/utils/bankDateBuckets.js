"use strict";
const { calculateMaturityDate, resolveLoanPenaltyBaseDate, addCalendarDaysInKST, formatDateKeyInKST } = require("./dateUtils");

function getAlertDateKey(kind, row) {
    if (!row) return null;
    const date = kind === "savings"
        ? (row.status === "active" ? calculateMaturityDate(row) : null)
        : (["ongoing", "approved"].includes(row.status)
            ? addCalendarDaysInKST(resolveLoanPenaltyBaseDate(row), 1) : null);
    return date ? formatDateKeyInKST(date) : null;
}

function updateDateBuckets(kind, buckets, before, after) {
    const next = { ...buckets };
    for (const [row, delta] of [[before, -1], [after, 1]]) {
        const key = getAlertDateKey(kind, row);
        if (!key) continue;
        const count = (Number(next[key]) || 0) + delta;
        if (count > 0) next[key] = count;
        else delete next[key];
    }
    return next;
}

function buildDateBuckets(kind, rows) {
    return rows.reduce((buckets, row) => updateDateBuckets(kind, buckets, null, row), {});
}

function countDateBuckets(buckets, now = new Date()) {
    const today = formatDateKeyInKST(now);
    return Object.entries(buckets).reduce((sum, [key, count]) => sum + (key <= today ? Number(count) || 0 : 0), 0);
}

module.exports = { getAlertDateKey, updateDateBuckets, buildDateBuckets, countDateBuckets };
