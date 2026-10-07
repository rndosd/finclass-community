"use strict";

const admin = require("../firebaseAdminCompat");
if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const { FieldValue } = require("firebase-admin/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const { buildShoppingSnapshot, buildPriceItemMetadata, buildCapturedPrices } = require("../utils/storeAnalyticsShopping");
const {
    buildInventoryExpiryIndexState,
    isTrackedInventoryAcquisitionExpired,
    normalizeAcquisitionForAccounting,
    roundCurrency,
} = require("../utils/inventoryAccounting");
const {
    stageDailyStudentHistoryWrites,
} = require("../utils/studentServerProjectionWriters");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const KST = "Asia/Seoul";
const RECENT_ACTIVITY_DAYS = 14;
const STORE_WINDOWS = [7, 14, 30];
const ACTIVITY_INDEX_DOC_PATH = "system_stats/activityIndex";
const ACTIVITY_INDEX_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const STORE_ANALYTICS_DAILY_SCHEMA_VERSION = 1;
const STORE_ANALYTICS_BACKFILL_START_DATE = "2026-03-01";
const STORE_ANALYTICS_MAX_BACKFILL_DAYS = 140;
const DEFAULT_NET_WORTH_CONVERSION_RATE = 10;
const INVENTORY_SETTLEMENT_CONCURRENCY = 8;

const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};
const isStudentRole = (role) =>
    String(role || "student").trim().toLowerCase() === "student";
const isMonetaryAggregateExcluded = (student) =>
    student?.statsExclusion?.monetaryAggregates === true;

const normalizePositiveRate = (value, fallback = DEFAULT_NET_WORTH_CONVERSION_RATE) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const calculateTotalNetWorthFromAssets = (assets = {}) => {
    const cash = toNumber(assets.cash);
    const deposit = toNumber(assets.deposit);
    const loan = toNumber(assets.loan);
    const itemValue = toNumber(assets.itemValue);
    const realEstateValue = toNumber(assets.realEstateValue);
    const usdBalance = toNumber(assets.usdBalance);
    const stockValue = toNumber(assets.stockValue?.value);
    const conversionRate = normalizePositiveRate(
        assets.stockValue?.lastConversionRate,
    );

    return (
        cash +
        deposit -
        loan +
        Math.round((usdBalance + stockValue) / conversionRate) +
        itemValue +
        realEstateValue
    );
};

const runWithConcurrency = async (items, concurrency, worker) => {
    const results = [];
    let nextIndex = 0;

    const runners = Array.from(
        { length: Math.min(concurrency, items.length) },
        async () => {
            while (nextIndex < items.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                results[currentIndex] = await worker(items[currentIndex], currentIndex);
            }
        },
    );

    await Promise.all(runners);
    return results;
};

const buildExpiredInventoryAssetSettlement = (
    inventoryData = {},
    nowMs = Date.now(),
) => {
    const acquisitions = Array.isArray(inventoryData.acquisitions)
        ? inventoryData.acquisitions
        : [];
    if (acquisitions.length === 0) return null;

    const settledAt = admin.firestore.Timestamp.fromMillis(nowMs);
    let settledValue = 0;
    let settledQuantity = 0;
    let hasSettlement = false;

    const nextAcquisitions = acquisitions.map((acquisition) => {
        const normalized = normalizeAcquisitionForAccounting(
            acquisition,
            inventoryData,
        );
        const quantity = Math.max(0, Math.floor(Number(normalized.quantity || 0)));
        if (
            quantity <= 0 ||
            !isTrackedInventoryAcquisitionExpired(normalized, { nowMs })
        ) {
            return normalized;
        }

        if (normalized.assetValueApplied !== true) {
            return normalized;
        }

        hasSettlement = true;
        settledQuantity += quantity;
        settledValue += toNumber(normalized.unitValue) * quantity;

        return {
            ...normalized,
            assetValueApplied: false,
            assetValueSettledAt: settledAt,
            assetValueSettlementReason: "expired",
        };
    });

    if (!hasSettlement) return null;

    return {
        acquisitions: nextAcquisitions,
        settledQuantity,
        settledValue: roundCurrency(settledValue),
        settledAt,
    };
};

const getClassIdFromInventoryRef = (inventoryRef) => {
    const parts = String(inventoryRef?.path || "").split("/");
    return parts[0] === "classes" && parts[1] ? parts[1] : "";
};

const getStudentRefFromInventoryRef = (inventoryRef) =>
    inventoryRef?.parent?.parent || null;

const buildInventoryExpiryIndexFirestorePatch = (
    inventoryData = {},
    options = {},
) => {
    const state = buildInventoryExpiryIndexState(inventoryData, options);
    return {
        hasUnsettledExpiringAsset: state.hasExpiringAsset,
        nextExpiryAtMs:
            state.nextExpiryAtMs === null
                ? FieldValue.delete()
                : state.nextExpiryAtMs,
    };
};

const settleExpiredInventoryDoc = async ({
    studentRef,
    inventoryRef,
    nowMs,
}) => db.runTransaction(async (transaction) => {
    const [studentSnap, inventorySnap] = await Promise.all([
        transaction.get(studentRef),
        transaction.get(inventoryRef),
    ]);

    if (!studentSnap.exists || !inventorySnap.exists) {
        return null;
    }

    const inventoryData = inventorySnap.data() || {};
    const settlement = buildExpiredInventoryAssetSettlement(inventoryData, nowMs);
    if (!settlement || settlement.settledValue <= 0) {
        const indexPatch = buildInventoryExpiryIndexFirestorePatch(
            inventoryData,
            { nowMs },
        );
        if (
            Boolean(inventoryData.hasUnsettledExpiringAsset) !==
                Boolean(indexPatch.hasUnsettledExpiringAsset) ||
            Number(inventoryData.nextExpiryAtMs || 0) !==
                Number(indexPatch.nextExpiryAtMs || 0)
        ) {
            transaction.update(inventoryRef, indexPatch);
        }
        return null;
    }

    const studentData = studentSnap.data() || {};
    const currentAssets = studentData.assets || {};
    const currentItemValue = toNumber(currentAssets.itemValue);
    const nextItemValue = roundCurrency(
        Math.max(0, currentItemValue - settlement.settledValue),
    );
    const nextAssets = {
        ...currentAssets,
        itemValue: nextItemValue,
    };

    transaction.update(inventoryRef, {
        acquisitions: settlement.acquisitions,
        ...buildInventoryExpiryIndexFirestorePatch(
            inventoryData,
            {
                acquisitions: settlement.acquisitions,
                nowMs,
            },
        ),
        expiredAssetSettledAt: FieldValue.serverTimestamp(),
        expiredAssetSettledValue: FieldValue.increment(settlement.settledValue),
        expiredAssetSettledQuantity: FieldValue.increment(
            settlement.settledQuantity,
        ),
    });

    transaction.update(studentRef, {
        "assets.itemValue": nextItemValue,
        "assets.totalNetWorth": calculateTotalNetWorthFromAssets(nextAssets),
        "assets.expiredItemValueSettledAt": FieldValue.serverTimestamp(),
    });

    return settlement;
});

const settleIndexedExpiredInventoryAssets = async (
    classIds = [],
    { nowMs = Date.now() } = {},
) => {
    const targetClassIds = new Set(
        classIds.map((classId) => String(classId || "").trim()).filter(Boolean),
    );
    if (targetClassIds.size === 0) return [];

    const candidateSnapshot = await db
        .collectionGroup("inventory")
        .where("nextExpiryAtMs", "<=", nowMs)
        .get();

    const targets = candidateSnapshot.docs
        .map((inventoryDoc) => {
            const inventoryClassId =
                String(inventoryDoc.data()?.classId || "").trim() ||
                getClassIdFromInventoryRef(inventoryDoc.ref);
            return {
                classId: inventoryClassId,
                inventoryRef: inventoryDoc.ref,
                studentRef: getStudentRefFromInventoryRef(inventoryDoc.ref),
            };
        })
        .filter(
            (target) =>
                target.studentRef &&
                target.classId &&
                targetClassIds.has(target.classId),
        );

    return runWithConcurrency(
        targets,
        INVENTORY_SETTLEMENT_CONCURRENCY,
        (target) =>
            settleExpiredInventoryDoc({
                studentRef: target.studentRef,
                inventoryRef: target.inventoryRef,
                nowMs,
            }),
    );
};

const settleExpiredInventoryAssetsForClass = async (
    classId,
    { nowMs = Date.now() } = {},
) => {
    const studentsSnapshot = await db.collection(`classes/${classId}/students`).get();
    if (studentsSnapshot.empty) {
        return {
            classId,
            scannedStudents: 0,
            scannedInventoryDocs: 0,
            settledInventoryDocs: 0,
            settledValue: 0,
            settledQuantity: 0,
        };
    }

    let scannedInventoryDocs = 0;
    let settledInventoryDocs = 0;
    let settledValue = 0;
    let settledQuantity = 0;

    for (const studentDoc of studentsSnapshot.docs) {
        const inventorySnapshot = await studentDoc.ref.collection("inventory").get();
        scannedInventoryDocs += inventorySnapshot.size;

        const candidateRefs = inventorySnapshot.docs
            .filter((inventoryDoc) =>
                buildExpiredInventoryAssetSettlement(inventoryDoc.data() || {}, nowMs),
            )
            .map((inventoryDoc) => inventoryDoc.ref);

        const indexOnlyRefs = inventorySnapshot.docs
            .filter((inventoryDoc) => {
                if (candidateRefs.some((ref) => ref.path === inventoryDoc.ref.path)) {
                    return false;
                }
                const data = inventoryDoc.data() || {};
                const indexState = buildInventoryExpiryIndexState(data, { nowMs });
                return indexState.hasExpiringAsset;
            });

        const settlements = await runWithConcurrency(
            candidateRefs,
            INVENTORY_SETTLEMENT_CONCURRENCY,
            (inventoryRef) =>
                settleExpiredInventoryDoc({
                    studentRef: studentDoc.ref,
                    inventoryRef,
                    nowMs,
                }),
        );

        await runWithConcurrency(
            indexOnlyRefs,
            INVENTORY_SETTLEMENT_CONCURRENCY,
            async (inventoryDoc) => {
                await inventoryDoc.ref.update(
                    buildInventoryExpiryIndexFirestorePatch(
                        inventoryDoc.data() || {},
                        { nowMs },
                    ),
                );
            },
        );

        settlements.filter(Boolean).forEach((settlement) => {
            settledInventoryDocs += 1;
            settledValue += toNumber(settlement.settledValue);
            settledQuantity += Number(settlement.settledQuantity || 0);
        });
    }

    return {
        classId,
        scannedStudents: studentsSnapshot.size,
        scannedInventoryDocs,
        settledInventoryDocs,
        settledValue: roundCurrency(settledValue),
        settledQuantity,
    };
};

const getTodayString = () => dayjs().tz(KST).format("YYYY-MM-DD");

const getDayBoundaries = (targetDay) => {
    const dayStart = targetDay.tz(KST).startOf("day");
    return {
        start: admin.firestore.Timestamp.fromDate(dayStart.toDate()),
        end: admin.firestore.Timestamp.fromDate(dayStart.add(1, "day").toDate()),
    };
};

const getRecentlyActiveClassIds = async (days = RECENT_ACTIVITY_DAYS) => {
    const baseDate = dayjs().tz(KST).startOf("day");
    const refs = [];
    const dayEntries = [];

    for (let i = 0; i < days; i += 1) {
        const targetDay = baseDate.subtract(i, "day");
        const dateStr = targetDay.format("YYYY-MM-DD");

        dayEntries.push({ index: i, targetDay });
        refs.push(db.collection("daily_stats").doc(dateStr));
    }

    if (refs.length === 0) return [];

    const snapshots = await db.getAll(...refs);
    const activeClassIds = new Set();
    const fallbackDays = [];

    snapshots.forEach((snap, index) => {
        const dayEntry = dayEntries[index];
        if (!snap.exists) {
            fallbackDays.push(dayEntry);
            return;
        }

        const ids = snap.data()?.activeClassIds;
        if (Array.isArray(ids)) {
            ids.forEach((classId) => {
                if (classId) activeClassIds.add(classId);
            });
        }

        if (dayEntry.index === 0 || !Array.isArray(ids)) {
            fallbackDays.push(dayEntry);
        }
    });

    if (fallbackDays.length > 0) {
        const fallbackResults = await Promise.all(
            fallbackDays.map(async ({ targetDay }) => {
                const { start, end } = getDayBoundaries(targetDay);
                const snap = await db
                    .collectionGroup("activityLogs")
                    .where("createdAt", ">=", start)
                    .where("createdAt", "<", end)
                    .select("classId")
                    .get();

                const dayClassIds = new Set();
                snap.forEach((docSnap) => {
                    const classId = docSnap.data()?.classId;
                    if (classId) dayClassIds.add(classId);
                });

                return [...dayClassIds];
            }),
        );

        fallbackResults.forEach((ids) => {
            ids.forEach((classId) => {
                if (classId) activeClassIds.add(classId);
            });
        });
    }

    return [...activeClassIds];
};

const normalizeStoreWindows = (windows = STORE_WINDOWS) => {
    const normalized = Array.isArray(windows)
        ? windows
            .map((value) => Math.floor(Number(value)))
            .filter((value) => Number.isFinite(value) && value > 0)
        : [];
    if (normalized.length === 0) return [...STORE_WINDOWS];
    return [...new Set(normalized)].sort((a, b) => a - b);
};

const createEmptyStoreMetrics = () => ({
    completedAmount: 0,
    completedCount: 0,
    redeemedVolume: 0,
    redeemedCount: 0,
    refundAmount: 0,
    refundCount: 0,
    netSpend: 0,
    participantCount: 0,
});

const roundStoreMetrics = (metrics = {}) => ({
    completedAmount: Math.round(toNumber(metrics.completedAmount)),
    completedCount: Math.round(toNumber(metrics.completedCount)),
    redeemedVolume: Math.round(toNumber(metrics.redeemedVolume)),
    redeemedCount: Math.round(toNumber(metrics.redeemedCount)),
    refundAmount: Math.round(toNumber(metrics.refundAmount)),
    refundCount: Math.round(toNumber(metrics.refundCount)),
    netSpend: Math.round(toNumber(metrics.netSpend)),
    participantCount: Math.round(toNumber(metrics.participantCount)),
});

const timestampToMillis = (value) => {
    if (!value) return null;
    if (typeof value.toDate === "function") {
        const date = value.toDate();
        return date instanceof Date ? date.getTime() : null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const cleanDateKey = (value) => {
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};

const enumerateDateKeys = (startDate, endDate, { maxDays = STORE_ANALYTICS_MAX_BACKFILL_DAYS } = {}) => {
    const startKey = cleanDateKey(startDate);
    const endKey = cleanDateKey(endDate);
    if (!startKey || !endKey) {
        throw new HttpsError("invalid-argument", "startDate and endDate must be YYYY-MM-DD.");
    }

    const start = dayjs.tz(startKey, KST).startOf("day");
    const end = dayjs.tz(endKey, KST).startOf("day");
    if (!start.isValid() || !end.isValid() || end.isBefore(start) ||
        start.format("YYYY-MM-DD") !== startKey || end.format("YYYY-MM-DD") !== endKey) {
        throw new HttpsError("invalid-argument", "Invalid date range.");
    }

    const days = [];
    let cursor = start;
    while (!cursor.isAfter(end)) {
        days.push(cursor.format("YYYY-MM-DD"));
        if (days.length > maxDays) {
            throw new HttpsError(
                "invalid-argument",
                `Date range is too large. Maximum ${maxDays} days per call.`,
            );
        }
        cursor = cursor.add(1, "day");
    }
    return days;
};

const getDateKeyFromTimestamp = (value) => {
    const millis = timestampToMillis(value);
    if (!Number.isFinite(millis)) return "";
    return dayjs(millis).tz(KST).format("YYYY-MM-DD");
};

const isCashLikeCurrencyType = (value) => {
    const normalized = String(value || "cash").trim().toLowerCase();
    return !normalized || ["cash", "money", "class", "default"].includes(normalized);
};

const roundAmount = (value) => Math.round(toNumber(value));

const getPositiveQuantity = (value) => {
    const quantity = Math.floor(Number(value || 0));
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
};

const ensureCurrencySummary = (map, currencyType) => {
    const key = String(currencyType || "cash").trim() || "cash";
    if (!map[key]) {
        map[key] = {
            grossAmount: 0,
            refundAmount: 0,
            netAmount: 0,
            purchaseCount: 0,
            refundCount: 0,
            quantity: 0,
        };
    }
    return map[key];
};

const addAmountFields = (target, amount, quantity, { refund = false } = {}) => {
    const normalizedAmount = roundAmount(amount);
    const normalizedQuantity = getPositiveQuantity(quantity);
    if (refund) {
        target.refundAmount = roundAmount((target.refundAmount || 0) + normalizedAmount);
        target.refundCount = Math.round(toNumber(target.refundCount) + 1);
        target.netAmount = roundAmount((target.netAmount || 0) - normalizedAmount);
        return;
    }

    target.grossAmount = roundAmount((target.grossAmount || 0) + normalizedAmount);
    target.purchaseCount = Math.round(toNumber(target.purchaseCount) + 1);
    target.quantity = Math.round(toNumber(target.quantity) + normalizedQuantity);
    target.netAmount = roundAmount((target.netAmount || 0) + normalizedAmount);
};

const getUnitPriceFromPurchase = (purchase = {}) => {
    const explicit = Number(purchase.pricePerItem);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const quantity = getPositiveQuantity(purchase.quantity);
    const total = Number(purchase.totalAmount);
    if (Number.isFinite(total) && total > 0) return total / quantity;

    return null;
};

const getPriceStats = (prices = {}) => {
    const values = Object.values(prices)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);

    return {
        activeItemCount: values.length,
        lowestPrice: values.length ? roundAmount(values[0]) : 0,
        medianPrice: values.length ? roundAmount(values[Math.floor(values.length / 2)]) : 0,
        highestPrice: values.length ? roundAmount(values[values.length - 1]) : 0,
    };
};

const getPriceBandKey = (price, priceStats = {}) => {
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) return "unknown";
    const median = Number(priceStats.medianPrice || 0);
    if (!median) return "unknown";
    if (numericPrice < median * 0.75) return "low";
    if (numericPrice > median * 1.5) return "high";
    return "mid";
};

const buildStorePriceSnapshotFromPrices = (dateKey, prices = {}, source = "none") => {
    const stats = getPriceStats(prices);
    const priceBands = {
        low: { itemCount: 0 },
        mid: { itemCount: 0 },
        high: { itemCount: 0 },
        unknown: { itemCount: 0 },
    };
    Object.values(prices).forEach((price) => {
        const bandKey = getPriceBandKey(price, stats);
        priceBands[bandKey].itemCount += 1;
    });

    return {
        source: Object.keys(prices).length ? source : "none",
        date: dateKey,
        itemCount: stats.activeItemCount,
        prices,
        priceBands,
        ...stats,
    };
};

const buildCurrentStorePriceSnapshotPayload = (dateKey, currentItemMap = new Map()) => {
    const prices = {};
    currentItemMap.forEach((item, itemId) => {
        const price = Number(item.price);
        if (itemId && Number.isFinite(price) && price > 0) {
            prices[itemId] = roundAmount(price);
        }
    });

    return buildStorePriceSnapshotFromPrices(dateKey, prices, "currentStoreItems");
};

const buildStorePriceSnapshotPayload = async (classId, dateKey, currentItemMap = new Map()) => {
    const analyticsSnap = await db
        .doc(`classes/${classId}/storeAnalyticsDaily/${dateKey}`)
        .get();
    const analyticsPriceSnapshot = analyticsSnap?.exists
        ? analyticsSnap.data()?.priceSnapshot || null
        : null;
    const analyticsPrices =
        analyticsPriceSnapshot?.prices && typeof analyticsPriceSnapshot.prices === "object"
            ? analyticsPriceSnapshot.prices
            : {};
    const normalizedAnalyticsPrices = {};
    Object.entries(analyticsPrices).forEach(([itemId, price]) => {
        const numericPrice = Number(price);
        if (itemId && Number.isFinite(numericPrice) && numericPrice > 0) {
            normalizedAnalyticsPrices[itemId] = roundAmount(numericPrice);
        }
    });

    if (Object.keys(normalizedAnalyticsPrices).length ||
        Object.keys(analyticsPriceSnapshot?.capturedPrices || {}).length) {
        const normalized = buildStorePriceSnapshotFromPrices(
            dateKey,
            normalizedAnalyticsPrices,
            analyticsPriceSnapshot.source || "storeAnalyticsDaily",
        );
        return {
            ...normalized,
            capturedDate: analyticsPriceSnapshot.capturedDate || null,
            capturedPrices: analyticsPriceSnapshot.capturedPrices || null,
            items: analyticsPriceSnapshot.items || {},
        };
    }

    const legacySnapshotSnap = await db
        .doc(`classes/${classId}/storePriceSnapshots/${dateKey}`)
        .get();

    const snapshotData = legacySnapshotSnap?.exists ? legacySnapshotSnap.data() || {} : {};
    const rawPrices = snapshotData.prices && typeof snapshotData.prices === "object"
        ? snapshotData.prices
        : {};
    const prices = {};
    Object.entries(rawPrices).forEach(([itemId, price]) => {
        const numericPrice = Number(price);
        if (itemId && Number.isFinite(numericPrice) && numericPrice > 0) {
            prices[itemId] = roundAmount(numericPrice);
        }
    });

    let source = legacySnapshotSnap?.exists ? "storePriceSnapshots" : "currentStoreItems";
    if (!Object.keys(prices).length && currentItemMap.size > 0) {
        currentItemMap.forEach((item, itemId) => {
            const price = Number(item.price);
            if (itemId && Number.isFinite(price) && price > 0) {
                prices[itemId] = roundAmount(price);
            }
        });
        if (Object.keys(prices).length) source = "currentStoreItems";
    }

    if (!Object.keys(prices).length) source = "none";

    return buildStorePriceSnapshotFromPrices(dateKey, prices, source);
};

const readCurrentStoreItemsForAnalytics = async (classId) => {
    const snap = await db.collection(`classes/${classId}/storeItems`).get();
    const itemMap = new Map();
    snap.forEach((docSnap) => {
        const item = docSnap.data() || {};
        itemMap.set(docSnap.id, {
            id: docSnap.id,
            name: String(item.name || item.title || "상품").trim() || "상품",
            categoryId: String(item.categoryId || "").trim() || null,
            categoryName: String(item.categoryName || item.itemCategoryName || "").trim() || null,
            itemType: String(item.itemType || "general").trim() || "general",
            functionTag: String(item.functionTag || "").trim() || null,
            saleStatus: String(item.saleStatus || "").trim() || null,
            currencyType: String(item.currencyType || "cash").trim() || "cash",
            currencyUnit: String(item.currencyUnit || "").trim(),
            price: Number(item.price || 0),
            stock: item.stock ?? null,
            isActive: item.isActive !== false,
        });
    });
    return itemMap;
};

const selectStoreAnalyticsPurchaseFields = [
    "status",
    "studentUid",
    "studentName",
    "studentNumber",
    "itemId",
    "itemName",
    "itemCategoryId",
    "itemCategoryName",
    "itemType",
    "functionTag",
    "itemSaleStatus",
    "currencyType",
    "currencyField",
    "currencyUnit",
    "quantity",
    "totalAmount",
    "pricePerItem",
    "baseAmountPerItem",
    "taxAmountPerItem",
    "completedAt",
    "cancelledAt",
    "redeemedAt",
    "isGift",
    "transactionType",
    "paymentSourceType",
];

const readStoreAnalyticsRowsForDate = async (classId, dateKey) => {
    const date = dayjs.tz(dateKey, KST);
    const startWindow = date.startOf("day");
    const endWindow = date.endOf("day");

    const [completedSnap, refundSnap] = await Promise.all([
        fetchStoreRedemptionsWithFallback({
            classId,
            dateField: "completedAt",
            startWindow,
            endWindow,
            statusFilter: { in: ["completed", "redeemed"] },
            selectFields: selectStoreAnalyticsPurchaseFields,
            label: "storeAnalytics completedAt+status",
        }),
        fetchStoreRedemptionsWithFallback({
            classId,
            dateField: "cancelledAt",
            startWindow,
            endWindow,
            statusFilter: { eq: "cancelled" },
            selectFields: selectStoreAnalyticsPurchaseFields,
            label: "storeAnalytics cancelledAt+status",
        }),
    ]);

    const completed = [];
    completedSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const status = String(data.status || "");
        if (!["completed", "redeemed"].includes(status)) return;
        if (getDateKeyFromTimestamp(data.completedAt) !== dateKey) return;
        completed.push({ id: docSnap.id, ...data });
    });

    const refunds = [];
    refundSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (String(data.status || "") !== "cancelled") return;
        if (getDateKeyFromTimestamp(data.cancelledAt) !== dateKey) return;
        refunds.push({ id: docSnap.id, ...data });
    });

    return { completed, refunds };
};

const STORE_ROW_SNAPSHOT_FIELDS = [
    "itemName",
    "itemCategoryId",
    "itemCategoryName",
    "itemType",
    "functionTag",
    "itemSaleStatus",
    "currencyType",
];

const storeAnalyticsRowsNeedCurrentItems = (rows, priceSnapshot) => {
    const allRows = [
        ...(Array.isArray(rows?.completed) ? rows.completed : []),
        ...(Array.isArray(rows?.refunds) ? rows.refunds : []),
    ];

    return allRows.some((row) => {
        if (STORE_ROW_SNAPSHOT_FIELDS.some((field) =>
            !Object.prototype.hasOwnProperty.call(row || {}, field))) {
            return true;
        }

        const itemId = String(row?.itemId || "").trim();
        const snapshotPrice = Number(priceSnapshot?.prices?.[itemId]);
        const purchasePrice = getUnitPriceFromPurchase(row);
        return !(
            Number.isFinite(snapshotPrice) && snapshotPrice > 0
        ) && !(
            Number.isFinite(purchasePrice) && purchasePrice > 0
        );
    });
};

const buildStoreAnalyticsDailyPayload = async (classId, dateKey, { source = "scheduled" } = {}) => {
    let currentItemMap = new Map();
    const [initialPriceSnapshot, rows] = await Promise.all([
        buildStorePriceSnapshotPayload(classId, dateKey),
        readStoreAnalyticsRowsForDate(classId, dateKey),
    ]);
    let priceSnapshot = initialPriceSnapshot;
    const hasRecordedPrices = Number(priceSnapshot?.itemCount || 0) > 0 ||
        Object.keys(priceSnapshot?.capturedPrices || {}).length > 0;
    if (
        !hasRecordedPrices ||
        storeAnalyticsRowsNeedCurrentItems(rows, priceSnapshot)
    ) {
        currentItemMap = await readCurrentStoreItemsForAnalytics(classId);
        if (!hasRecordedPrices) {
            priceSnapshot = buildCurrentStorePriceSnapshotPayload(
                dateKey,
                currentItemMap,
            );
        }
    }

    const participantUids = new Set();
    const itemBuyerSets = new Map();
    const studentItemSets = new Map();
    const byStudent = {};
    const byItem = {};
    const currencyBreakdown = {};
    const dataQuality = {
        sourcePurchaseCount: rows.completed.length,
        sourceRefundCount: rows.refunds.length,
        excludedCount: 0,
        missingPriceSnapshotCount: 0,
        fallbackPriceCount: 0,
        hasPartialData: false,
    };

    const ensureStudent = (row) => {
        const uid = String(row.studentUid || "unknown").trim() || "unknown";
        if (!byStudent[uid]) {
            byStudent[uid] = {
                uid,
                name: String(row.studentName || "학생").trim() || "학생",
                studentNumber: row.studentNumber ?? null,
                grossAmount: 0,
                refundAmount: 0,
                netAmount: 0,
                purchaseCount: 0,
                refundCount: 0,
                quantity: 0,
                itemKinds: 0,
                lastPurchasedAt: null,
            };
        }
        if (!studentItemSets.has(uid)) studentItemSets.set(uid, new Set());
        return byStudent[uid];
    };

    const ensureItem = (row, priceInfo = {}) => {
        const itemId = String(row.itemId || "unknown").trim() || "unknown";
        const currentItem = currentItemMap.get(itemId) || {};
        if (!byItem[itemId]) {
            byItem[itemId] = {
                itemId,
                name: String(row.itemName || currentItem.name || "상품").trim() || "상품",
                categoryId:
                    String(row.itemCategoryId || currentItem.categoryId || "").trim() ||
                    null,
                categoryName:
                    String(row.itemCategoryName || currentItem.categoryName || "").trim() ||
                    null,
                itemType: String(row.itemType || currentItem.itemType || "general").trim() || "general",
                functionTag:
                    String(row.functionTag || currentItem.functionTag || "").trim() ||
                    null,
                saleStatus:
                    String(row.itemSaleStatus || currentItem.saleStatus || "").trim() ||
                    null,
                currencyType: String(row.currencyType || currentItem.currencyType || "cash").trim() || "cash",
                priceSnapshot: priceInfo.priceSnapshot ?? null,
                priceSource: priceInfo.priceSource || "missing",
                grossAmount: 0,
                refundAmount: 0,
                netAmount: 0,
                purchaseCount: 0,
                refundCount: 0,
                quantity: 0,
                buyerCount: 0,
                lastPurchasedAt: null,
            };
        }
        if (!itemBuyerSets.has(itemId)) itemBuyerSets.set(itemId, new Set());
        return byItem[itemId];
    };

    const resolvePriceInfo = (row) => {
        const itemId = String(row.itemId || "").trim();
        const snapshotPrice = Number(priceSnapshot.prices?.[itemId]);
        if (Number.isFinite(snapshotPrice) && snapshotPrice > 0) {
            return { priceSnapshot: roundAmount(snapshotPrice), priceSource: priceSnapshot.source };
        }

        const purchasePrice = getUnitPriceFromPurchase(row);
        if (Number.isFinite(purchasePrice) && purchasePrice > 0) {
            dataQuality.missingPriceSnapshotCount += 1;
            dataQuality.fallbackPriceCount += 1;
            return { priceSnapshot: roundAmount(purchasePrice), priceSource: "purchaseRecord" };
        }

        const currentPrice = Number(currentItemMap.get(itemId)?.price);
        if (Number.isFinite(currentPrice) && currentPrice > 0) {
            dataQuality.missingPriceSnapshotCount += 1;
            dataQuality.fallbackPriceCount += 1;
            dataQuality.hasPartialData = true;
            return { priceSnapshot: roundAmount(currentPrice), priceSource: "currentStoreItems" };
        }

        dataQuality.missingPriceSnapshotCount += 1;
        dataQuality.hasPartialData = true;
        return { priceSnapshot: null, priceSource: "missing" };
    };

    const applyCompletedRow = (row) => {
        const quantity = getPositiveQuantity(row.quantity);
        const amount = roundAmount(row.totalAmount);
        const currencyType = String(row.currencyType || "cash").trim() || "cash";
        const studentUid = String(row.studentUid || "").trim();
        const itemId = String(row.itemId || "").trim();
        const completedAtMs = timestampToMillis(row.completedAt);
        const completedAtIso = Number.isFinite(completedAtMs) ? new Date(completedAtMs).toISOString() : null;

        if (studentUid) participantUids.add(studentUid);

        const student = ensureStudent(row);
        addAmountFields(student, amount, quantity);
        if (completedAtIso && (!student.lastPurchasedAt || completedAtIso > student.lastPurchasedAt)) {
            student.lastPurchasedAt = completedAtIso;
        }
        if (itemId) studentItemSets.get(student.uid).add(itemId);

        const item = ensureItem(row, resolvePriceInfo(row));
        addAmountFields(item, amount, quantity);
        if (studentUid) itemBuyerSets.get(item.itemId).add(studentUid);
        if (completedAtIso && (!item.lastPurchasedAt || completedAtIso > item.lastPurchasedAt)) {
            item.lastPurchasedAt = completedAtIso;
        }

        const currencySummary = ensureCurrencySummary(currencyBreakdown, currencyType);
        addAmountFields(currencySummary, amount, quantity);
    };

    const applyRefundRow = (row) => {
        const quantity = getPositiveQuantity(row.quantity);
        const amount = roundAmount(row.totalAmount);
        const currencyType = String(row.currencyType || "cash").trim() || "cash";

        addAmountFields(ensureStudent(row), amount, quantity, { refund: true });
        addAmountFields(ensureItem(row, resolvePriceInfo(row)), amount, quantity, { refund: true });
        addAmountFields(ensureCurrencySummary(currencyBreakdown, currencyType), amount, quantity, { refund: true });
    };

    rows.completed.forEach(applyCompletedRow);
    rows.refunds.forEach(applyRefundRow);

    studentItemSets.forEach((itemSet, uid) => {
        if (byStudent[uid]) byStudent[uid].itemKinds = itemSet.size;
    });
    itemBuyerSets.forEach((buyerSet, itemId) => {
        if (byItem[itemId]) byItem[itemId].buyerCount = buyerSet.size;
    });

    const totals = Object.values(currencyBreakdown).reduce(
        (acc, entry) => ({
            grossAmount: acc.grossAmount + roundAmount(entry.grossAmount),
            refundAmount: acc.refundAmount + roundAmount(entry.refundAmount),
            netAmount: acc.netAmount + roundAmount(entry.netAmount),
            purchaseCount: acc.purchaseCount + Math.round(toNumber(entry.purchaseCount)),
            refundCount: acc.refundCount + Math.round(toNumber(entry.refundCount)),
            quantity: acc.quantity + Math.round(toNumber(entry.quantity)),
        }),
        {
            grossAmount: 0,
            refundAmount: 0,
            netAmount: 0,
            purchaseCount: 0,
            refundCount: 0,
            quantity: 0,
            participantCount: participantUids.size,
            cashLikeNetAmount: 0,
        },
    );
    totals.participantCount = participantUids.size;
    totals.cashLikeNetAmount = Object.entries(currencyBreakdown).reduce(
        (sum, [currencyType, entry]) =>
            sum + (isCashLikeCurrencyType(currencyType) ? roundAmount(entry.netAmount) : 0),
        0,
    );

    return {
        schemaVersion: STORE_ANALYTICS_DAILY_SCHEMA_VERSION,
        date: dateKey,
        generatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        source,
        sourceCollections: ["storeRedemptions", "storeAnalyticsDaily", "storePriceSnapshots", "storeItems"],
        totals,
        currencyBreakdown,
        byStudent,
        byItem,
        priceSnapshot,
        dataQuality,
        shopping: buildShoppingSnapshot(rows.completed),
    };
};

const writeStoreAnalyticsDaily = async (classId, dateKey, options = {}) => {
    const payload = await buildStoreAnalyticsDailyPayload(classId, dateKey, options);
    await db
        .doc(`classes/${classId}/storeAnalyticsDaily/${dateKey}`)
        .set(payload, { merge: false });
    return {
        date: dateKey,
        purchaseCount: payload.totals.purchaseCount,
        refundCount: payload.totals.refundCount,
        netAmount: payload.totals.netAmount,
        itemCount: Object.keys(payload.byItem || {}).length,
        studentCount: Object.keys(payload.byStudent || {}).length,
        hasPartialData: payload.dataQuality.hasPartialData,
    };
};

const writeStoreAnalyticsPriceSnapshotDaily = async (classId, dateKey, options = {}) => {
    const currentItemMap = await readCurrentStoreItemsForAnalytics(classId);
    const priceSnapshot = buildCurrentStorePriceSnapshotPayload(dateKey, currentItemMap);
    priceSnapshot.capturedDate = dateKey;
    priceSnapshot.capturedPrices = buildCapturedPrices(currentItemMap);
    priceSnapshot.items = buildPriceItemMetadata(currentItemMap);
    if (Object.keys(priceSnapshot.capturedPrices).length === 0) {
        return {
            date: dateKey,
            itemCount: 0,
            skipped: true,
        };
    }

    await db
        .doc(`classes/${classId}/storeAnalyticsDaily/${dateKey}`)
        .set(
            {
                schemaVersion: STORE_ANALYTICS_DAILY_SCHEMA_VERSION,
                date: dateKey,
                updatedAt: FieldValue.serverTimestamp(),
                priceSnapshot,
                priceSnapshotUpdatedAt: FieldValue.serverTimestamp(),
                priceSnapshotSource: options.source || "scheduled_price_snapshot",
                sourceCollections: ["storeRedemptions", "storeAnalyticsDaily", "storeItems"],
            },
            { merge: true },
        );

    return {
        date: dateKey,
        itemCount: priceSnapshot.itemCount,
        skipped: false,
    };
};

const getActivityJobClassSelection = async () => {
    try {
        const snap = await db.doc(ACTIVITY_INDEX_DOC_PATH).get();
        if (snap.exists) {
            const data = snap.data() || {};
            const generatedAtMs = timestampToMillis(data.generatedAt);
            const isFresh =
                Number.isFinite(generatedAtMs) &&
                Date.now() - generatedAtMs <= ACTIVITY_INDEX_MAX_AGE_MS;

            if (isFresh) {
                const indexedClassIds = Array.isArray(data.eligibleClassIds)
                    ? data.eligibleClassIds
                    : Array.isArray(data.rankedClasses)
                        ? data.rankedClasses
                            .filter(
                                (classItem) =>
                                    classItem?.skipActivityBasedDailyJobs !== true,
                            )
                            .map((classItem) => classItem?.classId)
                        : [];
                return {
                    classIds: [...new Set(
                        indexedClassIds
                            .map((classId) => String(classId || "").trim())
                            .filter(Boolean),
                    )],
                    trusted: true,
                    source: "activityIndex",
                };
            }
        }
    } catch (error) {
        console.warn("[assetHistory] failed to read activity index; fallback used.", error);
    }

    const recentClassIds = await getRecentlyActiveClassIds();
    if (recentClassIds.length > 0) {
        return {
            classIds: recentClassIds,
            trusted: false,
            source: "recentActivity",
        };
    }

    const fallbackSnapshot = await db
        .collection("classes")
        .where("activityCount", ">", 0)
        .get();

    return {
        classIds: fallbackSnapshot.docs.map((docSnap) => docSnap.id),
        trusted: false,
        source: "activityCount",
    };
};

const isMissingIndexError = (error) => {
    const code = String(error?.code || "").toLowerCase();
    const message = String(error?.message || "");
    return (
        code.includes("failed-precondition") ||
        message.includes("FAILED_PRECONDITION") ||
        message.includes("requires an index")
    );
};

const fetchStoreRedemptionsWithFallback = async ({
    classId,
    dateField,
    startWindow,
    endWindow,
    statusFilter = null,
    selectFields = [],
    label = "",
}) => {
    const collectionRef = db.collection(`classes/${classId}/storeRedemptions`);
    const startTs = admin.firestore.Timestamp.fromDate(startWindow.toDate());
    const endTs = admin.firestore.Timestamp.fromDate(endWindow.toDate());

    const applySelect = (queryRef) =>
        Array.isArray(selectFields) && selectFields.length > 0
            ? queryRef.select(...selectFields)
            : queryRef;

    const baseQuery = collectionRef
        .where(dateField, ">=", startTs)
        .where(dateField, "<=", endTs);

    let statusQuery = baseQuery;
    if (Array.isArray(statusFilter?.in) && statusFilter.in.length > 0) {
        statusQuery = statusQuery.where("status", "in", statusFilter.in);
    } else if (typeof statusFilter?.eq === "string" && statusFilter.eq) {
        statusQuery = statusQuery.where("status", "==", statusFilter.eq);
    }

    try {
        return await applySelect(statusQuery).get();
    } catch (error) {
        if (!isMissingIndexError(error)) throw error;

        console.warn(
            `[storeMetrics] ${label || "status-filter query"} index unavailable for class ${classId}; fallback used.`,
        );
        return applySelect(baseQuery).get();
    }
};

const collectRollingStoreMetricsByWindows = async (classId, windows = STORE_WINDOWS) => {
    const targetWindows = normalizeStoreWindows(windows);
    const maxWindow = Math.max(...targetWindows);

    const endWindow = dayjs().tz(KST).subtract(1, "day").endOf("day");
    const startWindow = endWindow.subtract(Math.max(0, maxWindow - 1), "day").startOf("day");

    const [completedSnap, refundSnap] = await Promise.all([
        fetchStoreRedemptionsWithFallback({
            classId,
            dateField: "completedAt",
            startWindow,
            endWindow,
            statusFilter: { in: ["completed", "redeemed"] },
            selectFields: ["status", "totalAmount", "studentUid", "completedAt"],
            label: "completedAt+status",
        }),
        fetchStoreRedemptionsWithFallback({
            classId,
            dateField: "cancelledAt",
            startWindow,
            endWindow,
            statusFilter: { eq: "cancelled" },
            selectFields: ["status", "totalAmount", "cancelledAt"],
            label: "cancelledAt+status",
        }),
    ]);

    const completedRows = [];
    completedSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const status = String(data.status || "");
        if (!["completed", "redeemed"].includes(status)) return;

        const occurredAt = timestampToMillis(data.completedAt);
        if (!Number.isFinite(occurredAt)) return;

        const studentUid = String(data.studentUid || "").trim();
        completedRows.push({
            amount: toNumber(data.totalAmount),
            occurredAt,
            studentUid,
        });
    });

    const refundRows = [];
    refundSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (String(data.status || "") !== "cancelled") return;

        const occurredAt = timestampToMillis(data.cancelledAt);
        if (!Number.isFinite(occurredAt)) return;

        refundRows.push({
            amount: toNumber(data.totalAmount),
            occurredAt,
        });
    });

    const endWindowMs = endWindow.valueOf();
    const metricsByWindow = {};

    targetWindows.forEach((windowDays) => {
        const windowStartMs = endWindow
            .subtract(Math.max(0, windowDays - 1), "day")
            .startOf("day")
            .valueOf();

        let completedAmount = 0;
        let completedCount = 0;
        const participantSet = new Set();

        completedRows.forEach((row) => {
            if (row.occurredAt < windowStartMs || row.occurredAt > endWindowMs) return;
            completedAmount += row.amount;
            completedCount += 1;
            if (row.studentUid) participantSet.add(row.studentUid);
        });

        let refundAmount = 0;
        let refundCount = 0;
        refundRows.forEach((row) => {
            if (row.occurredAt < windowStartMs || row.occurredAt > endWindowMs) return;
            refundAmount += row.amount;
            refundCount += 1;
        });

        metricsByWindow[`${windowDays}d`] = {
            completedAmount,
            completedCount,
            redeemedVolume: completedAmount,
            redeemedCount: completedCount,
            refundAmount,
            refundCount,
            netSpend: completedAmount - refundAmount,
            participantCount: participantSet.size,
        };
    });

    return metricsByWindow;
};

/**
 * 1) 학생 자산/신용 이력 수집 (매일 23:59 KST)
 */
exports.collectDailyStudentData = onSchedule(
    {
        schedule: "59 23 * * *",
        timeZone: KST,
        region: "asia-northeast3",
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    async () => {
        const now = dayjs().tz(KST);
        if (now.day() === 0 || now.day() === 6) {
            console.log("주말에는 학생 일일 이력 수집을 건너뜁니다.");
            return null;
        }

        const today = getTodayString();

        try {
            const selection = await getActivityJobClassSelection();
            const targetClassIds = selection.classIds;

            if (targetClassIds.length === 0) {
                console.log(
                    `[학생 이력] 활성 학급이 없어 수집을 건너뜁니다. source=${selection.source}`,
                );
                return null;
            }

            try {
                const settlements = await settleIndexedExpiredInventoryAssets(
                    targetClassIds,
                    { nowMs: now.valueOf() },
                );
                const settled = settlements.filter(Boolean);
                if (settled.length > 0) {
                    const settledValue = roundCurrency(
                        settled.reduce(
                            (sum, item) => sum + toNumber(item.settledValue),
                            0,
                        ),
                    );
                    const settledQuantity = settled.reduce(
                        (sum, item) => sum + Number(item.settledQuantity || 0),
                        0,
                    );
                    console.log(
                        "[inventoryExpirySettlement] " +
                        `indexedDocs=${settled.length} ` +
                        `value=${settledValue} ` +
                        `qty=${settledQuantity}`,
                    );
                }
            } catch (error) {
                console.error("[inventoryExpirySettlement] indexed run failed", error);
            }

            for (const classId of targetClassIds) {
                const studentsSnapshot = await db.collection(`classes/${classId}/students`).get();
                if (studentsSnapshot.empty) continue;

                const batch = db.batch();
                stageDailyStudentHistoryWrites({
                    batch,
                    dbClient: db,
                    classId,
                    studentsSnapshot,
                    today,
                    fieldValue: FieldValue,
                });

                await batch.commit();
            }

            console.log(
                `[학생 이력] ${targetClassIds.length}개 학급 처리 완료 (source=${selection.source})`,
            );
        } catch (error) {
            console.error("학생 일일 이력 수집 중 오류가 발생했습니다.", error);
        }

        return null;
    },
);

/**
 * 2) 학급 통화/소비 지표 일일 스냅샷 (화~토 00:00 KST)
 */
exports.collectDailyMonetaryMetrics = onSchedule(
    {
        schedule: "0 0 * * 2-6",
        timeZone: KST,
        region: "asia-northeast3",
        memory: "256MiB",
    },
    async () => {
        const now = dayjs().tz(KST);
        if (now.day() === 0 || now.day() === 1) {
            console.log("일요일/월요일에는 통화 지표 수집을 건너뜁니다.");
            return null;
        }

        const today = getTodayString();

        try {
            const selection = await getActivityJobClassSelection();
            if (selection.classIds.length === 0) {
                console.log(
                    `[통화 지표] 대상 학급이 없어 스냅샷을 건너뜁니다. source=${selection.source}`,
                );
                return null;
            }

            for (const classId of selection.classIds) {
                const settingsSnap = await db.doc(`classes/${classId}/config/stockMarket`).get();
                const lambda = toNumber(settingsSnap.data()?.lambda) || 0.9;

                const studentsSnapshot = await db.collection(`classes/${classId}/students`).get();
                if (studentsSnapshot.empty) continue;

                let sumCash = 0;
                let sumDeposit = 0;
                let sumUsdBalance = 0;
                let sumItems = 0;
                let sumStock = 0;
                let activeRate = 100;
                let includedStudentCount = 0;

                studentsSnapshot.docs.forEach((studentDoc) => {
                    const studentData = studentDoc.data() || {};
                    if (!isStudentRole(studentData.role)) return;
                    if (isMonetaryAggregateExcluded(studentData)) return;

                    includedStudentCount += 1;
                    const assets = studentData.assets || {};
                    sumCash += toNumber(assets.cash);
                    sumDeposit += toNumber(assets.deposit);
                    sumItems += toNumber(assets.itemValue);
                    sumUsdBalance += toNumber(assets.usdBalance);
                    sumStock += toNumber(assets.stockValue?.value);

                    const lastRate = toNumber(assets.stockValue?.lastConversionRate);
                    if (lastRate > 0) activeRate = lastRate;
                });

                if (includedStudentCount === 0) continue;

                const conversionRate = activeRate > 0 ? activeRate : 10;

                const M0 = sumCash + sumUsdBalance / conversionRate;
                const M2 = M0 + sumDeposit;
                const potentialLiquidity = M2 + (sumStock * lambda) / conversionRate;
                const totalWealth = M2 + sumStock / conversionRate + sumItems;
                const totalClassAssets = totalWealth;
                const liquidMoney =
                    sumCash +
                    (sumUsdBalance / conversionRate) * 0.9 +
                    sumDeposit * 0.2 +
                    (sumStock / conversionRate) * 0.35;

                const rawStoreMetricsByWindow = await collectRollingStoreMetricsByWindows(
                    classId,
                    STORE_WINDOWS,
                );
                const storeMetricsByWindow = Object.entries(rawStoreMetricsByWindow).reduce(
                    (acc, [windowKey, metrics]) => {
                        acc[windowKey] = roundStoreMetrics(metrics);
                        return acc;
                    },
                    {},
                );
                const storeMetrics7d = storeMetricsByWindow["7d"] || roundStoreMetrics(createEmptyStoreMetrics());

                await db.doc(`classes/${classId}/monetaryHistory/${today}`).set(
                    {
                        date: today,
                        M0: Math.round(M0),
                        M2: Math.round(M2),
                        potentialLiquidity: Math.round(potentialLiquidity),
                        totalClassAssets: Math.round(totalClassAssets),
                        liquidMoney: Math.round(liquidMoney),
                        totalItems: Math.round(sumItems),
                        totalWealth: Math.round(totalWealth),
                        redeemedVolume: storeMetrics7d.redeemedVolume,
                        redeemedCount: storeMetrics7d.redeemedCount,
                        refundAmount: storeMetrics7d.refundAmount,
                        refundCount: storeMetrics7d.refundCount,
                        netSpend: storeMetrics7d.netSpend,
                        participantCount: storeMetrics7d.participantCount,
                        storeMetrics: storeMetricsByWindow,
                        appliedRate: conversionRate,
                        timestamp: FieldValue.serverTimestamp(),
                    },
                    { merge: true },
                );
            }

            console.log(
                `[${today}] 통화/소비 지표 스냅샷 저장 완료 (${selection.classIds.length}개 학급, source=${selection.source})`,
            );
        } catch (error) {
            console.error("통화/소비 지표 스냅샷 저장 중 오류가 발생했습니다.", error);
        }

        return null;
    },
);

/**
 * 3) 상점 가격 스냅샷 수집 (매일 00:10 KST)
 */
exports.collectDailyStorePriceSnapshots = onSchedule(
    {
        schedule: "10 0 * * 1-5",
        timeZone: KST,
        region: "asia-northeast3",
        memory: "256MiB",
    },
    async () => {
        const today = getTodayString();

        try {
            const selection = await getActivityJobClassSelection();

            if (selection.classIds.length === 0) {
                console.log(
                    `[${today}] 스냅샷 대상 학급이 없습니다. source=${selection.source}`,
                );
                return null;
            }

            for (const classId of selection.classIds) {
                try {
                    await writeStoreAnalyticsPriceSnapshotDaily(classId, today, {
                        source: "scheduled_price_snapshot",
                    });
                } catch (error) {
                    console.error(
                        `[storeAnalyticsDaily] price snapshot failed classId=${classId} date=${today}`,
                        error,
                    );
                }
            }

            console.log(
                `[${today}] 상점 가격 스냅샷 저장 완료 (${selection.classIds.length}개 학급, source=${selection.source})`,
            );
        } catch (error) {
            console.error("상점 가격 스냅샷 저장 중 오류가 발생했습니다.", error);
        }

        return null;
    },
);

/**
 * 4) 상점 통계 일별 집계 (매일 00:25 KST)
 *
 * 기존 storePriceSnapshots/monetaryHistory는 유지하고, 통계/AI 분석용 원시 집계를
 * storeAnalyticsDaily/{yyyy-MM-dd}에 별도로 저장한다.
 */
exports.collectDailyStoreAnalytics = onSchedule(
    {
        schedule: "25 0 * * 2-6",
        timeZone: KST,
        region: "asia-northeast3",
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    async () => {
        const targetDate = dayjs().tz(KST).subtract(1, "day").format("YYYY-MM-DD");

        try {
            const selection = await getActivityJobClassSelection();
            if (selection.classIds.length === 0) {
                console.log(
                    `[${targetDate}] 상점 통계 대상 학급이 없습니다. source=${selection.source}`,
                );
                return null;
            }

            const results = [];
            for (const classId of selection.classIds) {
                try {
                    const result = await writeStoreAnalyticsDaily(classId, targetDate, {
                        source: "scheduled",
                    });
                    results.push({ classId, ...result });
                } catch (error) {
                    console.error(
                        `[storeAnalyticsDaily] failed classId=${classId} date=${targetDate}`,
                        error,
                    );
                    results.push({
                        classId,
                        date: targetDate,
                        error: error?.message || String(error),
                    });
                }
            }

            console.log(
                `[${targetDate}] 상점 통계 일별 집계 완료 (${selection.classIds.length}개 학급, source=${selection.source})`,
            );
            return { targetDate, results };
        } catch (error) {
            console.error("상점 통계 일별 집계 중 오류가 발생했습니다.", error);
            return null;
        }
    },
);

exports.rebuildStoreAnalyticsDaily = onCall(
    {
        region: "asia-northeast3",
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    async (request) => {
        const classId = String(request.data?.classId || request.auth?.token?.classId || "").trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        const today = getTodayString();
        const requestedDateKey = cleanDateKey(request.data?.dateKey);
        const requestedStartDate = cleanDateKey(request.data?.startDate);
        const requestedEndDate = cleanDateKey(request.data?.endDate);
        const startDate =
            requestedDateKey ||
            requestedStartDate ||
            STORE_ANALYTICS_BACKFILL_START_DATE;
        const endDate =
            requestedDateKey ||
            requestedEndDate ||
            today;
        const dryRun = request.data?.dryRun === true;
        const dateKeys = enumerateDateKeys(startDate, endDate);

        const results = [];
        for (const dateKey of dateKeys) {
            if (dryRun) {
                const payload = await buildStoreAnalyticsDailyPayload(classId, dateKey, {
                    source: "backfill_dry_run",
                });
                results.push({
                    date: dateKey,
                    purchaseCount: payload.totals.purchaseCount,
                    refundCount: payload.totals.refundCount,
                    netAmount: payload.totals.netAmount,
                    itemCount: Object.keys(payload.byItem || {}).length,
                    studentCount: Object.keys(payload.byStudent || {}).length,
                    hasPartialData: payload.dataQuality.hasPartialData,
                    dryRun: true,
                });
                continue;
            }

            results.push(
                await writeStoreAnalyticsDaily(classId, dateKey, {
                    source: "backfill",
                }),
            );
        }

        return {
            success: true,
            classId,
            dryRun,
            startDate,
            endDate,
            dateCount: dateKeys.length,
            summaryPath: `classes/${classId}/storeAnalyticsDaily/{date}`,
            results,
        };
    },
);

exports.settleExpiredInventoryAssets = onCall(
    {
        region: "asia-northeast3",
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    async (request) => {
        const classId = String(
            request.data?.classId || request.auth?.token?.classId || "",
        ).trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        const result = await settleExpiredInventoryAssetsForClass(classId, {
            nowMs: Date.now(),
        });

        return {
            success: true,
            ...result,
        };
    },
);
