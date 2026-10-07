"use strict";

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("../firebaseAdminCompat");
const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const {
    markRelativeEconomyProjectionDirty,
} = require("../utils/relativeEconomyProjection");

const db = admin.firestore();

let cachedTierCriteria = {};
let cachedExchangeRates = {};

const TIER_CACHE_TTL_MS = 10 * 1000;
const EXCHANGE_RATE_CACHE_TTL_MS = 10 * 1000;
const DEFAULT_EXCHANGE_RATE = 10;
const WRITE_BATCH_SIZE = 450;

async function handleStudentMetricsWrite(event) {
    if (!event.data?.after.exists) return;

    const afterData = event.data.after.data() || {};
    const beforeData = event.data.before.data() || {};
    const { classId } = event.params;
    const isCreate = !event.data.before.exists;

    const needsCreditSync = shouldSyncStudentCredit({
        beforeData,
        afterData,
        isCreate,
    });
    const needsNetWorthSync = shouldSyncStudentNetWorth({
        beforeData,
        afterData,
        isCreate,
    });

    if (!needsCreditSync && !needsNetWorthSync) {
        return;
    }

    const updatePayload = {};
    let effectiveStudentData = afterData;

    if (needsCreditSync) {
        const tierCriteria = await getTierCriteria(classId);
        const creditSync = buildCreditSyncResult(afterData, tierCriteria);
        Object.assign(updatePayload, creditSync.patch);
        effectiveStudentData = creditSync.effectiveStudentData;
    }

    if (needsNetWorthSync) {
        const netWorthPatch = await handleNetWorth(effectiveStudentData, classId);
        if (netWorthPatch) {
            Object.assign(updatePayload, netWorthPatch);
        }
    }

    if (Object.keys(updatePayload).length === 0) {
        return;
    }

    updatePayload.lastSyncAt = admin.firestore.FieldValue.serverTimestamp();
    await event.data.after.ref.update(updatePayload);
}

exports.__handleStudentMetricsWrite = handleStudentMetricsWrite;

exports.onExchangeRateChange = onDocumentWritten(
    "classes/{classId}/config/stockMarket",
    async (event) => {
        if (!event.data?.after.exists) return;

        const afterData = event.data.after.data() || {};
        const beforeData = event.data.before.data() || {};
        const { classId } = event.params;

        const nextRate = normalizePositiveNumber(
            afterData.conversionRate,
            DEFAULT_EXCHANGE_RATE,
        );
        const previousRate = normalizePositiveNumber(beforeData.conversionRate, null);

        if (!Number.isFinite(nextRate) || nextRate <= 0 || nextRate === previousRate) {
            return;
        }

        cachedExchangeRates[classId] = {
            rate: nextRate,
            fetchedAt: Date.now(),
        };

        const studentsSnap = await db.collection(`classes/${classId}/students`).get();
        if (studentsSnap.empty) return;

        const updates = [];
        studentsSnap.forEach((studentDoc) => {
            const patch = buildNetWorthPatch(studentDoc.data() || {}, nextRate);
            if (!patch) return;
            updates.push({ ref: studentDoc.ref, patch });
        });

        const updatedCount = await commitUpdatesInChunks(updates, {
            includeLastSyncAt: true,
        });
        if (updatedCount > 0) {
            await markRelativeEconomyProjectionDirty({
                db,
                FieldValue: admin.firestore.FieldValue,
                classId,
                reason: "exchange-rate-write",
            });
        }
        console.log(
            `[StudentSync][RateChange] classId=${classId} updated=${updatedCount}/${studentsSnap.size} rate=${nextRate}`,
        );
    },
);

exports.onTierCriteriaChange = onDocumentWritten(
    "classes/{classId}/tierCriteria/default",
    async (event) => {
        if (!event.data?.after.exists) return;

        const { classId } = event.params;
        const beforeData = event.data.before.data() || {};
        const afterData = event.data.after.data() || {};

        const beforeSorted = sortTierCriteria(beforeData.tiers || []);
        const afterSorted = sortTierCriteria(afterData.tiers || []);
        const beforeVersion = getTierCriteriaVersion(beforeData, beforeSorted);
        const afterVersion = getTierCriteriaVersion(afterData, afterSorted);
        const beforeSignature = buildTierSignature(beforeSorted);
        const afterSignature = buildTierSignature(afterSorted);
        const beforeMaxScore = resolveCreditScoreMax(beforeData);
        const afterMaxScore = resolveCreditScoreMax(afterData);

        if (
            beforeSignature === afterSignature &&
            String(beforeVersion) === String(afterVersion) &&
            beforeMaxScore === afterMaxScore
        ) {
            return;
        }

        const tierCriteria = {
            tiers: afterSorted,
            version: afterVersion,
            maxScore: afterMaxScore,
            fetchedAt: Date.now(),
        };
        cachedTierCriteria[classId] = tierCriteria;

        const studentsSnap = await db.collection(`classes/${classId}/students`).get();
        if (studentsSnap.empty) return;

        const updates = [];
        studentsSnap.forEach((studentDoc) => {
            const creditSync = buildCreditSyncResult(
                studentDoc.data() || {},
                tierCriteria,
            );
            if (Object.keys(creditSync.patch).length === 0) {
                return;
            }
            updates.push({ ref: studentDoc.ref, patch: creditSync.patch });
        });

        if (!updates.length) {
            console.log(`[StudentSync][TierChange] classId=${classId} no student changes`);
            return;
        }

        const updatedCount = await commitUpdatesInChunks(updates);
        console.log(
            `[StudentSync][TierChange] classId=${classId} updated=${updatedCount}/${studentsSnap.size} version=${afterVersion}`,
        );
    },
);

exports.backfillStudentMetricCaches = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 540,
        memory: "512MiB",
    },
    async (request) => {
        const rawClassId = request.data?.classId;
        const classId =
            typeof rawClassId === "string" ? rawClassId.trim() : "";

        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        const [tierCriteria, exchangeRate, studentsSnap] = await Promise.all([
            getTierCriteria(classId),
            getExchangeRate(classId),
            db.collection(`classes/${classId}/students`).get(),
        ]);

        if (studentsSnap.empty) {
            return {
                classId,
                totalStudents: 0,
                updatedStudents: 0,
            };
        }

        const updates = [];
        studentsSnap.forEach((studentDoc) => {
            const backfillPatch = buildStudentMetricBackfillPatch(
                studentDoc.data() || {},
                {
                    exchangeRate,
                    tierCriteria,
                },
            );
            if (!backfillPatch) return;
            updates.push({ ref: studentDoc.ref, patch: backfillPatch });
        });

        const updatedCount = await commitUpdatesInChunks(updates);

        return {
            classId,
            totalStudents: studentsSnap.size,
            updatedStudents: updatedCount,
            exchangeRate,
            tierVersion: tierCriteria.version ?? null,
        };
    },
);

function resolveCreditScoreMax(rawCriteria = {}) {
    const rawValue = rawCriteria?.maxScore;
    if (rawValue === null || rawValue === undefined || rawValue === "") {
        return null;
    }

    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) && numericValue > 0
        ? numericValue
        : null;
}

function enforceCreditScoreCap(studentData = {}, maxScore = null) {
    const score = Number(studentData.creditScore);
    if (!Number.isFinite(score)) return null;

    if (!Number.isFinite(Number(maxScore)) || Number(maxScore) <= 0) {
        return null;
    }

    const cappedScore = Math.min(Number(maxScore), score);
    if (cappedScore === score) return null;

    return { creditScore: cappedScore };
}

function normalizeMetricNumber(value, fallbackValue = 0) {
    if (value === null || value === undefined || value === "") {
        return fallbackValue;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallbackValue;
}

function normalizePositiveNumber(value, fallbackValue = null) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return fallbackValue;
    }
    return numericValue;
}

function extractComparableStudentAssetInputs(studentData = {}) {
    const assets = studentData.assets || {};

    return {
        cash: normalizeMetricNumber(assets.cash),
        deposit: normalizeMetricNumber(assets.deposit),
        loan: normalizeMetricNumber(assets.loan),
        itemValue: normalizeMetricNumber(assets.itemValue),
        realEstateValue: normalizeMetricNumber(assets.realEstateValue),
        usdBalance: normalizeMetricNumber(assets.usdBalance),
        stockValue: normalizeMetricNumber(assets.stockValue?.value),
    };
}

function haveComparableAssetInputsChanged(beforeData = {}, afterData = {}) {
    const beforeAssets = extractComparableStudentAssetInputs(beforeData);
    const afterAssets = extractComparableStudentAssetInputs(afterData);

    return Object.keys(afterAssets).some(
        (key) => beforeAssets[key] !== afterAssets[key],
    );
}

function isCreditTierMissing(studentData = {}) {
    const tier = studentData.creditTier;
    if (!tier || typeof tier !== "object") return true;

    const hasTierIdentity = String(tier.id || tier.name || "").trim().length > 0;
    return !hasTierIdentity;
}

function hasCreditTierFastPathMetadata(studentData = {}) {
    const tier = normalizeTier(studentData.creditTier);
    if (!String(tier.id || tier.name || "").trim()) return false;
    if (tier.version === null || tier.version === undefined) return false;
    if (!Number.isFinite(tier.minScore)) return false;
    if (tier.maxScoreExclusive === undefined) return false;
    if (
        tier.maxScoreExclusive !== null &&
        !Number.isFinite(Number(tier.maxScoreExclusive))
    ) {
        return false;
    }
    if (tier.creditScoreMax === undefined) return false;
    if (
        tier.creditScoreMax !== null &&
        !Number.isFinite(Number(tier.creditScoreMax))
    ) {
        return false;
    }
    return true;
}

function isScoreWithinStoredTierRange(score, studentData = {}) {
    const tier = normalizeTier(studentData.creditTier);
    if (!Number.isFinite(score)) return false;
    if (!hasCreditTierFastPathMetadata(studentData)) return false;

    if (score < tier.minScore) return false;
    if (tier.maxScoreExclusive !== null && score >= tier.maxScoreExclusive) {
        return false;
    }

    return true;
}

function getStoredCreditScoreCap(studentData = {}) {
    const tier = normalizeTier(studentData.creditTier);
    return normalizePositiveNumber(tier.creditScoreMax, null);
}

function shouldSyncStudentCredit({
    beforeData = {},
    afterData = {},
    isCreate = false,
} = {}) {
    if (isCreate) return true;
    if (isCreditTierMissing(afterData)) return true;
    if (!hasCreditTierFastPathMetadata(afterData)) return true;

    const beforeScore = normalizeMetricNumber(beforeData.creditScore);
    const afterScore = normalizeMetricNumber(afterData.creditScore);
    if (beforeScore === afterScore) {
        return false;
    }

    const storedCap = getStoredCreditScoreCap(afterData);
    if (Number.isFinite(storedCap) && afterScore > storedCap) {
        return true;
    }

    return !isScoreWithinStoredTierRange(afterScore, afterData);
}

function shouldSyncStudentNetWorth({
    beforeData = {},
    afterData = {},
    isCreate = false,
} = {}) {
    const afterAssets = afterData.assets || {};

    if (isCreate) return true;
    if (afterAssets.totalNetWorth === undefined) return true;
    if (afterAssets.stockValue?.lastConversionRate === undefined) return true;

    return haveComparableAssetInputsChanged(beforeData, afterData);
}

function buildCreditSyncResult(studentData = {}, tierCriteria = null) {
    const patch = {};

    const creditScorePatch = enforceCreditScoreCap(
        studentData,
        tierCriteria?.maxScore ?? null,
    );
    if (creditScorePatch) {
        Object.assign(patch, creditScorePatch);
    }

    const effectiveStudentData = creditScorePatch
        ? { ...studentData, ...creditScorePatch }
        : studentData;

    const creditTierPatch = buildCreditTierPatchFromCriteria(
        effectiveStudentData,
        tierCriteria,
    );
    if (creditTierPatch) {
        Object.assign(patch, creditTierPatch);
    }

    return { patch, effectiveStudentData };
}

function buildCreditTierPatchFromCriteria(studentData = {}, tierCriteria = null) {
    const nextTier = resolveTierForStudent(studentData, tierCriteria);
    if (!nextTier) return null;

    const currentTier = normalizeTier(studentData.creditTier);
    if (isSameTier(currentTier, nextTier)) {
        return null;
    }

    return { creditTier: nextTier };
}

function resolveTierForStudent(studentData = {}, tierCriteria = null) {
    const tiers = Array.isArray(tierCriteria?.tiers) ? tierCriteria.tiers : [];
    if (!tiers.length) return null;

    const score = normalizeMetricNumber(studentData.creditScore);
    let matchedIndex = tiers.findIndex(
        (tier) => score >= normalizeMetricNumber(tier.minScore),
    );

    if (matchedIndex < 0) {
        matchedIndex = tiers.length - 1;
    }

    const matchedTier = tiers[matchedIndex];
    const previousTier = matchedIndex > 0 ? tiers[matchedIndex - 1] : null;
    const maxScoreExclusive = previousTier
        ? normalizeMetricNumber(previousTier.minScore)
        : null;

    return normalizeTier({
        id: matchedTier.id,
        name: matchedTier.name,
        color: matchedTier.color,
        minScore: matchedTier.minScore,
        maxScoreExclusive,
        version: tierCriteria.version ?? null,
        creditScoreMax: tierCriteria.maxScore ?? null,
    });
}

async function getTierCriteria(classId) {
    const now = Date.now();
    const cached = cachedTierCriteria[classId];
    if (cached && now - cached.fetchedAt < TIER_CACHE_TTL_MS) {
        return cached;
    }

    const snap = await db.doc(`classes/${classId}/tierCriteria/default`).get();
    const raw = snap.data() || {};
    const tiers = sortTierCriteria(raw.tiers || []);
    const version = getTierCriteriaVersion(raw, tiers);
    const maxScore = resolveCreditScoreMax(raw);

    const next = { tiers, version, maxScore, fetchedAt: now };
    cachedTierCriteria[classId] = next;
    return next;
}

async function getExchangeRate(classId) {
    const now = Date.now();
    const cached = cachedExchangeRates[classId];
    if (cached && now - cached.fetchedAt < EXCHANGE_RATE_CACHE_TTL_MS) {
        return cached.rate;
    }

    const snap = await db.doc(`classes/${classId}/config/stockMarket`).get();
    const rate = normalizePositiveNumber(
        snap.data()?.conversionRate,
        DEFAULT_EXCHANGE_RATE,
    );

    cachedExchangeRates[classId] = {
        rate,
        fetchedAt: now,
    };

    return rate;
}

function sortTierCriteria(tiers = []) {
    return [...tiers]
        .filter((tier) => tier && typeof tier === "object")
        .sort((a, b) => Number(b.minScore || 0) - Number(a.minScore || 0));
}

function getTierCriteriaVersion(rawCriteria = {}, sortedTiers = []) {
    const explicitVersion = Number(rawCriteria.version);
    if (Number.isFinite(explicitVersion)) return explicitVersion;

    const updatedAtMillis = rawCriteria.updatedAt?.toMillis?.();
    if (Number.isFinite(updatedAtMillis)) return `ts_${updatedAtMillis}`;

    return buildTierSignature(sortedTiers);
}

function buildTierSignature(tiers = []) {
    return tiers
        .map((tier) =>
            [
                tier.id || "",
                tier.name || "",
                tier.color || "",
                Number(tier.minScore || 0),
            ].join(":"),
        )
        .join("|");
}

function normalizeTier(rawTier = {}) {
    if (!rawTier || typeof rawTier !== "object") {
        return {
            id: "",
            name: "",
            color: "",
            minScore: 0,
            maxScoreExclusive: undefined,
            version: null,
            creditScoreMax: undefined,
        };
    }

    const parsedMinScore = Number(rawTier.minScore);
    const maxScoreExclusive = Object.prototype.hasOwnProperty.call(
        rawTier,
        "maxScoreExclusive",
    )
        ? normalizeNullableNumber(rawTier.maxScoreExclusive)
        : undefined;
    const creditScoreMax = Object.prototype.hasOwnProperty.call(
        rawTier,
        "creditScoreMax",
    )
        ? normalizeNullablePositiveNumber(rawTier.creditScoreMax)
        : undefined;

    return {
        id: String(rawTier.id || ""),
        name: String(rawTier.name || ""),
        color: String(rawTier.color || ""),
        minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
        maxScoreExclusive,
        version: rawTier.version ?? null,
        creditScoreMax,
    };
}

function normalizeNullableNumber(value) {
    if (value === null) return null;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : undefined;
}

function normalizeNullablePositiveNumber(value) {
    if (value === null || value === "") return null;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return null;
    }
    return numericValue;
}

function isSameTier(leftTier, rightTier) {
    return (
        leftTier.id === rightTier.id &&
        leftTier.name === rightTier.name &&
        leftTier.color === rightTier.color &&
        leftTier.minScore === rightTier.minScore &&
        leftTier.maxScoreExclusive === rightTier.maxScoreExclusive &&
        leftTier.version === rightTier.version &&
        leftTier.creditScoreMax === rightTier.creditScoreMax
    );
}

function buildNetWorthPatch(studentData = {}, conversionRate) {
    const assets = studentData.assets || {};
    const effectiveRate = normalizePositiveNumber(conversionRate, null);
    if (!Number.isFinite(effectiveRate) || effectiveRate <= 0) {
        return null;
    }

    const cash = normalizeMetricNumber(assets.cash);
    const deposit = normalizeMetricNumber(assets.deposit);
    const loan = normalizeMetricNumber(assets.loan);
    const itemValue = normalizeMetricNumber(assets.itemValue);
    const realEstateValue = normalizeMetricNumber(assets.realEstateValue);
    const usdBalance = normalizeMetricNumber(assets.usdBalance);
    const stockValue = normalizeMetricNumber(assets.stockValue?.value);

    const classCurrencyTotal = cash + deposit - loan;
    const foreignAssetsLocal = Math.round((usdBalance + stockValue) / effectiveRate);
    const totalNetWorth =
        classCurrencyTotal + foreignAssetsLocal + itemValue + realEstateValue;
    const storedNetWorth = normalizeMetricNumber(assets.totalNetWorth);
    const storedRate = normalizePositiveNumber(
        assets.stockValue?.lastConversionRate,
        null,
    );

    if (storedNetWorth === totalNetWorth && storedRate === effectiveRate) {
        return null;
    }

    return {
        "assets.totalNetWorth": totalNetWorth,
        "assets.stockValue.lastConversionRate": effectiveRate,
    };
}

async function handleNetWorth(studentData = {}, classId) {
    try {
        const storedRate = normalizePositiveNumber(
            studentData?.assets?.stockValue?.lastConversionRate,
            null,
        );
        const effectiveRate = storedRate || await getExchangeRate(classId);
        return buildNetWorthPatch(studentData, effectiveRate);
    } catch (error) {
        console.error("[StudentSync][NetWorth]", error);
        return null;
    }
}

function buildStudentMetricBackfillPatch(
    studentData = {},
    { exchangeRate, tierCriteria } = {},
) {
    const creditSync = buildCreditSyncResult(studentData, tierCriteria);
    const netWorthPatch = buildNetWorthPatch(
        creditSync.effectiveStudentData,
        exchangeRate,
    );

    const patch = {
        ...creditSync.patch,
        ...(netWorthPatch || {}),
    };

    return Object.keys(patch).length > 0 ? patch : null;
}

async function commitUpdatesInChunks(
    updates = [],
    { includeLastSyncAt = false } = {},
) {
    if (!Array.isArray(updates) || updates.length === 0) {
        return 0;
    }

    let updatedCount = 0;

    for (let index = 0; index < updates.length; index += WRITE_BATCH_SIZE) {
        const chunk = updates.slice(index, index + WRITE_BATCH_SIZE);
        const batch = db.batch();

        chunk.forEach(({ ref, patch }) => {
            const payload = includeLastSyncAt
                ? {
                    ...patch,
                    lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
                }
                : patch;
            batch.update(ref, payload);
        });

        await batch.commit();
        updatedCount += chunk.length;
    }

    return updatedCount;
}
