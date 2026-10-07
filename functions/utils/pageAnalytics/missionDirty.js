"use strict";
const { formatDateKeyInKST, toDate } = require("../dateUtils");
const { cleanDateKey } = require("./common");
const COLLECTION = "missionAnalyticsDirtyDays";

function completionDates(row = {}) {
    row = row || {};
    // Include the former approval date to remove aggregates written using the
    // old date contract as well as rebuilding the actual submission date.
    return [...new Set([row.submittedAt || row.createdAt || row.completedAt || row.updatedAt,
        row.approvedAt].map(toDate).filter(Boolean).map(formatDateKeyInKST))];
}

async function markDates(db, classId, dates, eventId) {
    const keys = [...new Set(dates.map(cleanDateKey).filter(Boolean))];
    for (const date of keys) {
        const ref = db.doc(`classes/${classId}/${COLLECTION}/${date}`);
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (snap.exists && snap.data().lastEventId === eventId) return;
            tx.set(ref, { date, revision: Number(snap.data()?.revision || 0) + 1, lastEventId: eventId });
        });
    }
}

async function rebuildDirtyDates(db, classId, throughDate, rebuild, { limit = 20 } = {}) {
    const snap = await db.collection(`classes/${classId}/${COLLECTION}`)
        .where("date", "<=", throughDate).limit(limit).get();
    const results = [];
    for (const marker of snap.docs) {
        const date = cleanDateKey(marker.data().date);
        const revision = marker.data().revision;
        const lastEventId = marker.data().lastEventId;
        if (!date || marker.id !== date) continue;
        try {
            const result = await rebuild(date);
            await db.runTransaction(async (tx) => {
                const current = await tx.get(marker.ref);
                // An approval arriving during the rebuild must remain queued.
                if (current.exists && current.data().revision === revision && current.data().lastEventId === lastEventId) tx.delete(marker.ref);
            });
            results.push({ ...result, historicalRepair: true });
        } catch (error) {
            results.push({ domain: "mission", classId, date, historicalRepair: true, error: error?.message || String(error) });
        }
    }
    return results;
}
module.exports = { COLLECTION, completionDates, markDates, rebuildDirtyDates };
