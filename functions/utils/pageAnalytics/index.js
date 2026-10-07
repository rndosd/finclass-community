"use strict";

const admin = require("../../firebaseAdminCompat");
const {
    BACKFILL_START_DATE,
    cleanDateKey,
    enumerateDateKeys,
    getKstTodayKey,
    getKstYesterdayKey,
    requireDateKey,
} = require("./common");
const police = require("./policeDaily");
const tax = require("./taxDaily");
const mission = require("./missionDaily");
const credit = require("./creditDaily");
const realEstate = require("./realEstateDaily");
const { rebuildDirtyDates } = require("./missionDirty");

const DEFAULT_DOMAIN_ORDER = ["police", "tax", "mission", "credit", "realEstate"];
const SCHEDULED_DOMAIN_ORDER = ["police", "tax", "mission", "credit"];

const DOMAINS = {
    police,
    tax,
    mission,
    credit,
    realEstate,
};

function normalizeDomain(value) {
    const domain = String(value || "").trim();
    return DOMAINS[domain] ? domain : "";
}

function getDomains(value) {
    const domain = normalizeDomain(value);
    return domain ? [domain] : DEFAULT_DOMAIN_ORDER;
}

async function listActiveClassIds(db, domain, {
    classId = "",
    startDate = BACKFILL_START_DATE,
    limit = 0,
    candidateClassIds = null,
} = {}) {
    const mod = DOMAINS[domain];
    if (!mod) throw new Error(`Unknown page analytics domain: ${domain}`);

    const classIds = [];
    if (classId) {
        if (await mod.hasActivity(db, classId, startDate)) {
            return [classId];
        }
        return [];
    }

    const candidates = Array.isArray(candidateClassIds)
        ? candidateClassIds
        : (await db.collection("classes").get()).docs.map((classDoc) => classDoc.id);
    for (const candidateClassId of candidates) {
        if (limit > 0 && classIds.length >= limit) break;
        if (await mod.hasActivity(db, candidateClassId, startDate)) {
            classIds.push(candidateClassId);
        }
    }
    return classIds;
}

async function buildWithRetry(mod, db, classId, dateKey, options, attempts = 2) {
    let lastError = null;
    for (let index = 0; index < attempts; index += 1) {
        try {
            return await mod.buildDaily(db, classId, dateKey, options);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

async function writeDaily(db, domain, classId, dateKey, options = {}) {
    const mod = DOMAINS[domain];
    if (!mod) throw new Error(`Unknown page analytics domain: ${domain}`);

    const payload = await buildWithRetry(mod, db, classId, dateKey, options);
    await db
        .doc(`classes/${classId}/${mod.COLLECTION}/${dateKey}`)
        .set(payload, { merge: false });

    return {
        domain,
        classId,
        date: dateKey,
        status: payload.status,
        eventCount: Number(payload.eventTotals?.eventCount || 0),
        studentCount: Object.keys(payload.byStudent || {}).length,
        sourceCounts: payload.source?.counts || {},
    };
}

async function runScheduledDailyAnalytics(db, options = {}) {
    const dateKey = requireDateKey(options.dateKey || getKstYesterdayKey(), "dateKey");
    const requestedDomain = normalizeDomain(options.domain);
    const domains = requestedDomain ? [requestedDomain] : SCHEDULED_DOMAIN_ORDER;
    const candidateClassIds = options.classId
        ? null
        : (await db.collection("classes").get()).docs.map((classDoc) => classDoc.id);
    const results = [];

    let remainingMissionRepairs = 200;

    for (const domain of domains) {
        const classIds = await listActiveClassIds(db, domain, {
            classId: options.classId || "",
            startDate: options.startDate || BACKFILL_START_DATE,
            limit: options.limit || 0,
            candidateClassIds,
        });
        for (const classId of classIds) {
            try {
                results.push(await writeDaily(db, domain, classId, dateKey, {
                    source: options.source || "scheduled",
                }));
            } catch (error) {
                results.push({
                    domain,
                    classId,
                    date: dateKey,
                    error: error?.message || String(error),
                });
            }
            if (domain === "mission" && options.repairMissionHistory && remainingMissionRepairs > 0) {
                try {
                    const repaired = await rebuildDirtyDates(db, classId, dateKey,
                        (date) => writeDaily(db, "mission", classId, date, { source: "scheduled_history_repair" }),
                        { limit: Math.min(20, remainingMissionRepairs) });
                    remainingMissionRepairs -= repaired.length;
                    results.push(...repaired);
                } catch (error) {
                    results.push({ domain, classId, historicalRepair: true, error: error?.message || String(error) });
                }
            }
        }
    }

    return {
        success: true,
        date: dateKey,
        results,
    };
}

async function rebuildDailyAnalytics(db, {
    classId = "",
    domain = "",
    startDate = BACKFILL_START_DATE,
    endDate = getKstTodayKey(),
    dryRun = false,
    limit = 0,
    source = "backfill",
} = {}) {
    const domains = getDomains(domain);
    const startKey = cleanDateKey(startDate) || BACKFILL_START_DATE;
    const endKey = cleanDateKey(endDate) || getKstTodayKey();
    const dateKeys = enumerateDateKeys(startKey, endKey);
    const results = [];

    for (const targetDomain of domains) {
        const classIds = await listActiveClassIds(db, targetDomain, {
            classId,
            startDate: startKey,
            limit,
        });

        for (const targetClassId of classIds) {
            if (DOMAINS[targetDomain].buildRange && dateKeys.length > 1) {
                const payloads = await DOMAINS[targetDomain].buildRange(
                    db,
                    targetClassId,
                    dateKeys,
                    { source: dryRun ? `${source}_dry_run` : source },
                );
                for (const payload of payloads) {
                    if (dryRun) {
                        results.push({
                            domain: targetDomain,
                            classId: targetClassId,
                            date: payload.date,
                            dryRun: true,
                            status: payload.status,
                            eventCount: Number(payload.eventTotals?.eventCount || 0),
                            studentCount: Object.keys(payload.byStudent || {}).length,
                            sourceCounts: payload.source?.counts || {},
                        });
                        continue;
                    }
                    await db
                        .doc(`classes/${targetClassId}/${DOMAINS[targetDomain].COLLECTION}/${payload.date}`)
                        .set(payload, { merge: false });
                    results.push({
                        domain: targetDomain,
                        classId: targetClassId,
                        date: payload.date,
                        status: payload.status,
                        eventCount: Number(payload.eventTotals?.eventCount || 0),
                        studentCount: Object.keys(payload.byStudent || {}).length,
                        sourceCounts: payload.source?.counts || {},
                    });
                }
                continue;
            }

            for (const dateKey of dateKeys) {
                if (dryRun) {
                    const payload = await buildWithRetry(DOMAINS[targetDomain], db, targetClassId, dateKey, {
                        source: `${source}_dry_run`,
                    });
                    results.push({
                        domain: targetDomain,
                        classId: targetClassId,
                        date: dateKey,
                        dryRun: true,
                        status: payload.status,
                        eventCount: Number(payload.eventTotals?.eventCount || 0),
                        studentCount: Object.keys(payload.byStudent || {}).length,
                        sourceCounts: payload.source?.counts || {},
                    });
                    continue;
                }

                results.push(await writeDaily(db, targetDomain, targetClassId, dateKey, {
                    source,
                }));
            }
        }
    }

    return {
        success: true,
        dryRun,
        domains,
        classId: classId || null,
        startDate: startKey,
        endDate: endKey,
        dateCount: dateKeys.length,
        resultCount: results.length,
        results,
    };
}

function getDb() {
    return admin.firestore();
}

module.exports = {
    DOMAINS,
    DEFAULT_DOMAIN_ORDER,
    SCHEDULED_DOMAIN_ORDER,
    getDomains,
    listActiveClassIds,
    writeDaily,
    runScheduledDailyAnalytics,
    rebuildDailyAnalytics,
    getDb,
};
