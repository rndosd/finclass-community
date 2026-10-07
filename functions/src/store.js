const {
    calculateItemTaxInfo,
    buildTimeSaleRecordFields,
    buildStoreItemExpirationMeta,
} = require("../utils/storePricing");
const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("../utils/maintenanceHttps");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const { runFinancialRequest } = require("../utils/financialRequest");

const { createMaintenanceDb } = require("../utils/maintenanceDb");
const db = createMaintenanceDb(admin.firestore());

const { stageTaxIncome } = require("../utils/taxIncome");
const { stageTaxExpense } = require("../utils/taxExpense");
const {
    stageActivityTaxCancellation,
    stageIncomeCancellationAsExpense,
    stageExpenseCancellationAsIncome,
} = require("../utils/taxReversal");
const { stageActivityLog } = require("../utils/logUtils");
const { stageNotification } = require("../utils/notificationUtils");
const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const {
    getStoreTreasuryMode,
    shouldDeferTaxIncomeToPeriodSettlement,
} = require("../utils/taxPolicy");
const {
    assertCanOperateClassFund,
    assertTeacherOrAdminFromClaims,
} = require("../utils/permissions");
const {
    buildInventoryExpiryIndexState,
    buildTrackedInventoryAcquisition,
    consumeExpiredTrackedInventoryAcquisitions,
    consumeTrackedInventoryAcquisitions,
    isTicketInventoryItem,
    isTrackedInventoryAcquisitionExpired,
    normalizeAcquisitionForAccounting,
    recalculateInventoryHoldingState,
    roundCurrency,
    sortTrackedInventoryAcquisitions,
} = require("../utils/inventoryAccounting");
const {
    buildRandomBoxOpenEventRecord,
    buildRandomBoxRewardUsageTransition,
    buildRandomBoxTrackingSeed,
} = require("../utils/randomBoxTracking");
const { resolveClassCurrencyUnit } = require("../utils/currencyUnit");
const {
    isStoreItemPurchasableByStudents,
    isStoreItemVisibleToStudents,
    normalizeStoreItemSaleStatus,
} = require("./storeSaleStatus");
const { getClassFundChannelAccess } = require("../utils/classFundPolicy");
const {
    stageImmediateClassFundExpense,
} = require("../utils/classFundExpenseRecording");
const {
    CANCELLATION_STATUS_CANCELLED,
    CANCELLATION_STATUS_REVERSAL,
    buildClassFundUsageCancellationAccounting,
} = require("../utils/classFundUsageCancellation");
const {
    buildClassFundPosInventoryCancellation,
} = require("../utils/classFundPosCancellation");

const getStoreConsumptionTaxMode = (classData = {}) =>
    getStoreTreasuryMode(classData) === "NONE" ? "NONE" : "TAX_ONLY";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const RANDOM_BOX_ITEM_TYPE = "randomBox";
const RANDOM_BOX_FUNCTION_TAG = "random_box";
const STORE_LIMIT_SUMMARY_COLLECTION = "storeLimitSummaries";
const STORE_ITEM_DOCUMENT_PATH = "classes/{classId}/storeItems/{itemId}";

const pad2 = (value) => String(value).padStart(2, "0");

const toKstDate = (date = new Date()) =>
    new Date(new Date(date).getTime() + KST_OFFSET_MS);

const formatKstDayId = (date = new Date()) => {
    const kstDate = toKstDate(date);
    return [
        kstDate.getUTCFullYear(),
        pad2(kstDate.getUTCMonth() + 1),
        pad2(kstDate.getUTCDate()),
    ].join("-");
};

/**
 */
const getUsagePeriodIds = (now = new Date()) => {
    const nowKst = toKstDate(now);
    const dailyId = formatKstDayId(now);

    const weekday = nowKst.getUTCDay() || 7;
    const mondayKst = new Date(
        Date.UTC(
            nowKst.getUTCFullYear(),
            nowKst.getUTCMonth(),
            nowKst.getUTCDate(),
        ),
    );
    mondayKst.setUTCDate(mondayKst.getUTCDate() - weekday + 1);

    const weeklyId = [
        mondayKst.getUTCFullYear(),
        pad2(mondayKst.getUTCMonth() + 1),
        pad2(mondayKst.getUTCDate()),
    ].join("-");

    return { dailyId, weeklyId };
};

const TAX_LINE_COLLECTION = "lines";

const toSafeId = (value, fallback = "na") => {
    const normalized = String(value ?? "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized || fallback;
};

const resolveAggregateBatchKey = (data, fallbackSeed) =>
    toSafeId(
        data?.aggregateBatchKey ||
            data?.requestId ||
            fallbackSeed ||
            db.collection("_").doc().id,
    );

const buildTaxRecordPointer = (collection, id, lineId) => ({
    collection,
    id,
    lineCollection: TAX_LINE_COLLECTION,
    lineId,
    detailStorage: "inline",
    aggregated: true,
});

const MISSION_TOKEN_UNIT = "\uBBF8\uC158\uD1A0\uD070";

const normalizeStoreCurrencyType = (currencyType) =>
    ["missionToken", "usdBalance"].includes(currencyType) ? currencyType : "cash";

const getStoreCurrencyMeta = (itemData = {}, classData = {}) => {
    const currencyType = normalizeStoreCurrencyType(itemData?.currencyType);
    const assetField = currencyType;
    const currencyUnit =
        currencyType === "usdBalance"
            ? "FIN"
            : currencyType === "missionToken"
                ? MISSION_TOKEN_UNIT
                : resolveClassCurrencyUnit(classData);

    return { currencyType, assetField, currencyUnit };
};

const isStoreItemGiftAllowed = (itemData = {}) => itemData?.isGiftAllowed !== false;

const isRandomBoxStoreItem = (itemData = {}) =>
    itemData?.itemType === RANDOM_BOX_ITEM_TYPE ||
    itemData?.functionTag === RANDOM_BOX_FUNCTION_TAG;

const STORE_CATEGORY_TYPE_VIP = "vip";

const isVipStoreCategory = (categoryData = {}) =>
    String(categoryData?.type || categoryData?.categoryType || "").trim() ===
    STORE_CATEGORY_TYPE_VIP;

const getVipAllowedStudentUids = (categoryData = {}) => {
    const raw =
        categoryData?.allowedStudentUids ||
        categoryData?.vipStudentUids ||
        categoryData?.allowedStudents ||
        [];

    if (!Array.isArray(raw)) return [];

    return raw
        .map((student) =>
            typeof student === "string"
                ? student
                : String(student?.uid || "").trim(),
        )
        .filter(Boolean);
};

const cleanText = (value, maxLength = 200) =>
    String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);

const toMoneyAmount = (value) => {
    const amount = Math.round(Number(value));
    return Number.isFinite(amount) ? amount : 0;
};

const getVipAccessMode = (categoryData = {}) =>
    categoryData?.vipAccessMode === "hybrid_or"
        ? "hybrid_or"
        : categoryData?.vipAccessMode === "credit_tier" ||
          String(categoryData?.minCreditTierId || "").trim()
            ? "credit_tier"
            : "selected_students";

const getVipRequiredTierSnapshot = (categoryData = {}) => {
    const requiredTierId = String(categoryData?.minCreditTierId || "").trim();
    if (!requiredTierId) return null;

    const rawTier = categoryData?.minCreditTier || {};
    const parsedMinScore = Number(
        categoryData?.minCreditScore ??
        categoryData?.minCreditTierMinScore ??
        rawTier?.minScore,
    );

    return {
        id: requiredTierId,
        name: String(
            categoryData?.minCreditTierName ||
            rawTier?.name ||
            requiredTierId,
        ).trim(),
        minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : null,
    };
};

const buildInventoryExpiryIndexFields = ({
    classId,
    studentUid,
    inventoryData = {},
    acquisitions = null,
    nowMs = Date.now(),
    includeDelete = true,
}) => {
    const state = buildInventoryExpiryIndexState(inventoryData, {
        acquisitions,
        nowMs,
    });

    const fields = {
        classId,
        studentUid,
        hasUnsettledExpiringAsset: state.hasExpiringAsset,
    };

    if (state.nextExpiryAtMs === null) {
        if (includeDelete) {
            fields.nextExpiryAtMs = FieldValue.delete();
        }
    } else {
        fields.nextExpiryAtMs = state.nextExpiryAtMs;
    }

    return fields;
};

const buildInventoryAcquisitionsWithAddedEntry = (
    inventoryData = {},
    acquisition,
) => [
    ...(Array.isArray(inventoryData?.acquisitions)
        ? inventoryData.acquisitions
        : []),
    acquisition,
];

const needsVipTierCriteriaRead = (categoryData = {}) => {
    if (!["credit_tier", "hybrid_or"].includes(getVipAccessMode(categoryData))) {
        return false;
    }
    const requiredTier = getVipRequiredTierSnapshot(categoryData);
    return Boolean(requiredTier && !Number.isFinite(requiredTier.minScore));
};

const loadStoreItemCategory = async (transaction, classId, itemData = {}) => {
    const categoryId = String(itemData?.categoryId || "").trim();
    if (!categoryId) return null;

    const categoryRef = db.doc(`classes/${classId}/storeCategories/${categoryId}`);
    const categorySnap = await transaction.get(categoryRef);
    if (!categorySnap.exists) return null;

    return {
        id: categorySnap.id,
        ...categorySnap.data(),
    };
};

const assertCategoryVipEligibility = ({
    categoryData = null,
    studentUid = "",
    studentData = {},
    sortedTierCriteria = [],
}) => {
    if (!isVipStoreCategory(categoryData)) return;

    const accessMode = getVipAccessMode(categoryData);
    const allowedUids = getVipAllowedStudentUids(categoryData);
    const hasSelectedStudentAccess = allowedUids.includes(
        String(studentUid || "").trim(),
    );

    if (accessMode === "hybrid_or" && hasSelectedStudentAccess) {
        return;
    }

    if (accessMode === "credit_tier" || accessMode === "hybrid_or") {
        const requiredTier = getVipRequiredTierSnapshot(categoryData);
        if (!requiredTier) {
            throw new HttpsError("failed-precondition", "VIP 라운지 입장 기준이 설정되지 않았습니다.");
        }

        const studentTier = resolveEffectiveStudentTier(
            studentData,
            sortedTierCriteria,
        );
        if (
            studentTier?.id &&
            requiredTier.id &&
            String(studentTier.id) === String(requiredTier.id)
        ) {
            return;
        }
        if (
            studentTier?.name &&
            requiredTier.name &&
            String(studentTier.name) === String(requiredTier.name)
        ) {
            return;
        }

        const studentCreditScore = getFirstFiniteNumber(studentData?.creditScore);
        if (
            studentCreditScore !== null &&
            requiredTier.minScore !== null &&
            studentCreditScore >= requiredTier.minScore
        ) {
            return;
        }

        const studentTierScore = getFirstFiniteNumber(studentTier?.minScore);
        if (
            studentTierScore !== null &&
            requiredTier.minScore !== null &&
            studentTierScore >= requiredTier.minScore
        ) {
            return;
        }

        throw new HttpsError("failed-precondition", "VIP 라운지 입장 기준을 충족한 학생만 이 상품을 구매할 수 있습니다.");
    }

    if (
        allowedUids.length === 0 ||
        !hasSelectedStudentAccess
    ) {
        throw new HttpsError("failed-precondition", "VIP 라운지 입장 대상 학생만 이 상품을 구매할 수 있습니다.");
    }
};

const buildStorePurchaseSnapshotFields = (itemData = {}, categoryData = null) => ({
    itemCategoryId: String(itemData?.categoryId || "").trim() || null,
    itemCategoryName: String(categoryData?.name || "").trim() || null,
    itemCategoryType:
        String(categoryData?.type || categoryData?.categoryType || "").trim() || null,
    itemSaleStatus: normalizeStoreItemSaleStatus(itemData),
});

const buildRandomBoxRewardSearchFields = ({
    rewardItemId = "",
    rewardItemName = "",
} = {}) => {
    const fields = {};
    const normalizedRewardItemId = String(rewardItemId || "").trim();
    const normalizedRewardItemName = String(rewardItemName || "").trim();

    if (normalizedRewardItemId) {
        fields.randomBoxRewardItemIds = FieldValue.arrayUnion(normalizedRewardItemId);
    }

    if (normalizedRewardItemName) {
        fields.randomBoxRewardNames = FieldValue.arrayUnion(normalizedRewardItemName);
    }

    return fields;
};

const normalizeRandomBoxRewardEntry = (reward = {}) => {
    const itemId = String(reward?.itemId || "").trim();
    const rawProbabilityPercent = Number(
        reward?.probabilityPercent ?? reward?.chance ?? 0,
    );
    const normalizedProbabilityPercent =
        Number.isFinite(rawProbabilityPercent) && rawProbabilityPercent > 0
            ? Math.round(rawProbabilityPercent * 100) / 100
            : 0;
    const derivedWeight = normalizedProbabilityPercent > 0
        ? Math.max(1, Math.round(normalizedProbabilityPercent * 100))
        : 0;
    const weight = Math.max(
        0,
        Math.floor(Number(reward?.weight || derivedWeight || 0)),
    );
    const quantity = Math.max(0, Math.floor(Number(reward?.quantity || 0)));

    if (!itemId || weight <= 0 || quantity <= 0) {
        return null;
    }

    return {
        itemId,
        itemName: String(reward?.itemName || "").trim(),
        categoryId: String(reward?.categoryId || "").trim(),
        itemType: String(reward?.itemType || "").trim() || "general",
        price: Math.max(0, Number(reward?.price || 0)),
        probabilityPercent: normalizedProbabilityPercent,
        weight,
        quantity,
    };
};

const normalizeRandomBoxConfig = (input = {}) => {
    const rawConfig =
        input?.randomBoxConfig && typeof input.randomBoxConfig === "object"
            ? input.randomBoxConfig
            : input;
    const rewards = Array.isArray(rawConfig?.rewards)
        ? rawConfig.rewards
            .map((reward) => normalizeRandomBoxRewardEntry(reward))
            .filter(Boolean)
        : [];

    if (rewards.length === 0) {
        return null;
    }

    const totalWeight = rewards.reduce(
        (sum, reward) => sum + Math.max(0, Number(reward?.weight || 0)),
        0,
    );
    const rewardsWithProbability = rewards.map((reward) => ({
        ...reward,
        probabilityPercent:
            totalWeight > 0
                ? Math.round(((Number(reward.weight || 0) / totalWeight) * 100) * 100) / 100
                : Math.round(Number(reward.probabilityPercent || 0) * 100) / 100,
    }));

    return {
        boxType: String(rawConfig?.boxType || "normal").trim() === "premium"
            ? "premium"
            : "normal",
        rewardCount: rewards.length,
        rewards: rewardsWithProbability,
    };
};

const buildRandomBoxConfigSnapshot = (itemData = {}) => {
    if (!isRandomBoxStoreItem(itemData)) {
        return null;
    }

    return normalizeRandomBoxConfig(itemData);
};

const buildRandomBoxTrackingFields = (itemData = {}) =>
    isRandomBoxStoreItem(itemData) ? buildRandomBoxTrackingSeed() : {};

const applyRandomBoxRewardUsageTracking = ({
    transaction,
    classId,
    studentUid,
    detail,
    usedAt,
}) => {
    const transition = buildRandomBoxRewardUsageTransition(detail);
    if (!transition || !classId) {
        return;
    }

    const openEventRef = db.doc(
        `classes/${classId}/storeRedemptions/${transition.purchaseId}/openEvents/${transition.randomBoxOpenId}`,
    );
    const redemptionRef = db.doc(
        `classes/${classId}/storeRedemptions/${transition.purchaseId}`,
    );

    transaction.set(
        openEventRef,
        {
            rewardUsedQty: FieldValue.increment(transition.usedQuantity),
            rewardRemainingQty: transition.remainingQuantityAfterUse,
            rewardUsageStatus: transition.nextStatus,
            rewardLastUsedAt: usedAt,
            updatedAt: usedAt,
            ...(studentUid ? { studentUid } : {}),
        },
        { merge: true },
    );

    const summaryUpdates = Object.entries(transition.summaryCounterUpdates).reduce(
        (accumulator, [fieldName, delta]) => {
            if (!delta) {
                return accumulator;
            }
            accumulator[fieldName] = FieldValue.increment(delta);
            return accumulator;
        },
        {},
    );

    transaction.set(
        redemptionRef,
        {
            ...summaryUpdates,
            randomBoxLastUsedAt: usedAt,
        },
        { merge: true },
    );
};

const consumeInventoryAcquisitionsWithFallback = ({
    inventoryData = {},
    quantity = 0,
    skipExpired = false,
    deleteOnlyExpired = false,
}) => {
    const consumeFn = deleteOnlyExpired
        ? consumeExpiredTrackedInventoryAcquisitions
        : consumeTrackedInventoryAcquisitions;
    const consumeOptions = skipExpired ? { skipExpired: true } : {};

    let accounting = consumeFn(
        inventoryData?.acquisitions,
        quantity,
        inventoryData,
        consumeOptions,
    );

    if (accounting.remainingQuantity <= 0) {
        return accounting;
    }

    const currentQty = Math.max(0, Math.floor(Number(inventoryData?.quantity || 0)));
    const targetQty = Math.max(0, Math.floor(Number(quantity || 0)));
    if (currentQty < targetQty) {
        return accounting;
    }

    const repairedState = recalculateInventoryHoldingState(inventoryData);
    if (!Array.isArray(repairedState?.normalizedAcquisitions) || repairedState.normalizedAcquisitions.length === 0) {
        return accounting;
    }

    return consumeFn(
        repairedState.normalizedAcquisitions,
        quantity,
        {
            ...inventoryData,
            acquisitions: repairedState.normalizedAcquisitions,
        },
        consumeOptions,
    );
};

const getUsableInventoryAcquisition = (
    acquisitions,
    inventoryData = {},
    options = {},
) => {
    const normalizedAcquisitions = sortTrackedInventoryAcquisitions(acquisitions);
    const nowMs = Number.isFinite(Number(options?.nowMs))
        ? Number(options.nowMs)
        : Date.now();

    for (const acquisition of normalizedAcquisitions) {
        const normalized = normalizeAcquisitionForAccounting(
            acquisition,
            inventoryData,
            options,
        );

        if (Number(normalized?.quantity || 0) <= 0) {
            continue;
        }

        if (
            options?.skipExpired === true &&
            isTrackedInventoryAcquisitionExpired(normalized, { nowMs })
        ) {
            continue;
        }

        return normalized;
    }

    return null;
};

const pickWeightedRandomBoxReward = (rewards = []) => {
    const totalWeight = rewards.reduce(
        (sum, reward) => sum + Math.max(0, Number(reward?.weight || 0)),
        0,
    );

    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        return null;
    }

    let cursor = crypto.randomInt(totalWeight);
    for (const reward of rewards) {
        cursor -= Math.max(0, Number(reward?.weight || 0));
        if (cursor < 0) {
            return reward;
        }
    }

    return rewards[rewards.length - 1] || null;
};

const buildRandomBoxRewardAcquisition = ({
    rewardQuantity = 1,
    rewardUnitValue = 0,
    acquiredAt,
    rewardItemData = {},
    boxItemId = "",
    boxItemName = "",
    sourcePurchaseId = "",
    randomBoxOpenId = "",
}) =>
    buildTrackedInventoryAcquisition({
        type: "random_box_reward",
        quantity: rewardQuantity,
        grantedQuantity: rewardQuantity,
        acquiredAt,
        obtainedFrom: "random_box",
        unitValue: rewardUnitValue,
        assetValueApplied: rewardUnitValue > 0 && rewardItemData?.currencyType !== "usdBalance",
        ticketCountApplied:
            rewardItemData?.itemType === "ticket" ||
            rewardItemData?.functionTag === "arcade_ticket",
        ...(boxItemId ? { boxItemId } : {}),
        ...(boxItemName ? { boxItemName } : {}),
        ...(sourcePurchaseId ? { sourcePurchaseId } : {}),
        ...(randomBoxOpenId ? { randomBoxOpenId } : {}),
    });

const getStudentBalanceByField = (studentData = {}, field = "cash") =>
    Number(studentData?.assets?.[field] ?? 0);

const getArcadeTicketInventoryQuery = (classId, studentUid) =>
    db
        .collection(`classes/${classId}/students/${studentUid}/inventory`)
        .where("quantity", ">", 0);

const readSnapshotData = (snapshot) =>
    (typeof snapshot?.data === "function" ? snapshot.data() : snapshot?.data) || {};

const isArcadeTicketInventorySnapshot = (snapshot) => {
    const data = readSnapshotData(snapshot);
    return data?.functionTag === "arcade_ticket" ||
        (data?.itemType === "ticket" && !data?.functionTag);
};

const sumInventoryQuantities = (snapshots = []) =>
    snapshots.reduce(
        (sum, snapshot) =>
            sum + Math.max(0, Number(readSnapshotData(snapshot)?.quantity || 0)),
        0,
    );

const sumArcadeTicketQuantities = (snapshots = []) =>
    sumInventoryQuantities(
        snapshots.filter((snapshot) => isArcadeTicketInventorySnapshot(snapshot)),
    );

const createEmptyUsageData = () => ({
    daily: 0,
    weekly: 0,
    totalPurchased: 0,
    totalResetVersion: 0,
    lastDailyId: "",
    lastWeeklyId: "",
});

const getStoreLimitSummaryRef = (classId, itemId) =>
    db.doc(`classes/${classId}/${STORE_LIMIT_SUMMARY_COLLECTION}/${itemId}`);

const getStoreItemUsageSnapshots = async (classId, itemId) => {
    const studentsSnap = await db.collection(`classes/${classId}/students`).get();
    const usageRefs = studentsSnap.docs.map((studentDoc) =>
        studentDoc.ref.collection("storeUsage").doc(itemId),
    );
    const usageSnaps = [];
    const CHUNK_SIZE = 200;

    for (let index = 0; index < usageRefs.length; index += CHUNK_SIZE) {
        const chunkRefs = usageRefs.slice(index, index + CHUNK_SIZE);
        if (!chunkRefs.length) continue;
        const chunkSnaps = await db.getAll(...chunkRefs);
        usageSnaps.push(...chunkSnaps);
    }

    return usageSnaps.filter((usageSnap) => usageSnap.exists);
};

const buildStoreLimitSummaryRow = (usageData = {}) => {
    const normalized = normalizeUsageData(
        usageData,
        getUsagePeriodIds(),
    );

    return {
        hasUsageDoc: true,
        daily: Math.max(0, Number(normalized.daily || 0)),
        weekly: Math.max(0, Number(normalized.weekly || 0)),
        totalPurchased: Math.max(0, Number(normalized.totalPurchased || 0)),
        totalResetVersion: Math.max(0, Number(normalized.totalResetVersion || 0)),
        lastDailyId: String(normalized.lastDailyId || ""),
        lastWeeklyId: String(normalized.lastWeeklyId || ""),
    };
};

const stageStoreLimitSummaryRow = ({
    transaction,
    classId,
    itemId,
    studentUid,
    usageData,
}) => {
    if (!transaction || !classId || !itemId || !studentUid) {
        return;
    }

    transaction.set(
        getStoreLimitSummaryRef(classId, itemId),
        {
            itemId,
            updatedAt: FieldValue.serverTimestamp(),
            rows: {
                [studentUid]: buildStoreLimitSummaryRow(usageData),
            },
        },
        { merge: true },
    );
};

const buildStoreLimitSummaryDocData = async (classId, itemId) => {
    const usageSnaps = await getStoreItemUsageSnapshots(classId, itemId);
    const rows = {};
    usageSnaps.forEach((usageSnap) => {
        const studentUid = usageSnap.ref.parent.parent?.id;
        if (!studentUid) return;
        rows[studentUid] = buildStoreLimitSummaryRow(usageSnap.data() || {});
    });

    return {
        itemId,
        rowCount: Object.keys(rows).length,
        rows,
        updatedAt: FieldValue.serverTimestamp(),
    };
};

const rebuildStoreLimitSummaryDoc = async (classId, itemId) => {
    const summaryData = await buildStoreLimitSummaryDocData(classId, itemId);
    await getStoreLimitSummaryRef(classId, itemId).set(summaryData);
    return summaryData.rowCount || 0;
};

const resetStoreUsageWhenUnlimited = async (classId, itemId) => {
    const usageSnaps = await getStoreItemUsageSnapshots(classId, itemId);
    const BATCH_SIZE = 350;
    let resetCount = 0;

    for (let idx = 0; idx < usageSnaps.length; idx += BATCH_SIZE) {
        const chunk = usageSnaps.slice(idx, idx + BATCH_SIZE);
        const batch = db.batch();

        chunk.forEach((usageSnap) => {
            batch.set(
                usageSnap.ref,
                {
                    daily: 0,
                    weekly: 0,
                    totalPurchased: 0,
                    totalResetVersion: FieldValue.increment(1),
                    lastDailyId: "",
                    lastWeeklyId: "",
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
        });

        await batch.commit();
        resetCount += chunk.length;
    }

    await getStoreLimitSummaryRef(classId, itemId).set({
        itemId,
        rowCount: 0,
        rows: {},
        updatedAt: FieldValue.serverTimestamp(),
    });

    return resetCount;
};

const normalizeUsageData = (usageData = {}, periodIds = getUsagePeriodIds()) => {
    const base = {
        ...createEmptyUsageData(),
        ...(usageData && typeof usageData === "object" ? usageData : {}),
    };

    const normalized = {
        ...base,
        daily: Math.max(0, Number(base.daily || 0)),
        weekly: Math.max(0, Number(base.weekly || 0)),
        totalPurchased: Math.max(0, Number(base.totalPurchased || 0)),
        totalResetVersion: Math.max(0, Number(base.totalResetVersion || 0)),
    };

    if (normalized.lastDailyId !== periodIds.dailyId) {
        normalized.daily = 0;
        normalized.lastDailyId = periodIds.dailyId;
    }

    if (normalized.lastWeeklyId !== periodIds.weeklyId) {
        normalized.weekly = 0;
        normalized.lastWeeklyId = periodIds.weeklyId;
    }

    return normalized;
};

const assertStorePurchaseLimits = ({
    itemData = {},
    usage = {},
    quantity = 0,
}) => {
    const itemName = itemData?.name || "상품";

    if (itemData.dailyLimit && usage.daily + quantity > itemData.dailyLimit) {
        throw new HttpsError("failed-precondition", `[${itemName}] 일일 구매 한도를 초과했습니다.`);
    }

    if (itemData.weeklyLimit && usage.weekly + quantity > itemData.weeklyLimit) {
        throw new HttpsError("failed-precondition", `[${itemName}] 주간 구매 한도를 초과했습니다.`);
    }

    if (itemData.totalLimit && usage.totalPurchased + quantity > itemData.totalLimit) {
        throw new HttpsError("failed-precondition", `[${itemName}] 전체 구매 한도를 초과했습니다.`);
    }
};

const hasPurchaseLimit = (itemData = {}) =>
    Boolean(
        itemData?.dailyLimit ||
        itemData?.weeklyLimit ||
        itemData?.totalLimit,
    );

const shouldReadUsage = (itemData = {}) => hasPurchaseLimit(itemData);

const buildUsagePurchaseUpdate = ({
    usage = {},
    quantity = 0,
    periodIds = getUsagePeriodIds(),
    countTowardTotal = true,
}) => ({
    daily: usage.daily + quantity,
    weekly: usage.weekly + quantity,
    ...(countTowardTotal
        ? { totalPurchased: usage.totalPurchased + quantity }
        : {}),
    totalResetVersion: usage.totalResetVersion,
    lastDailyId: periodIds.dailyId,
    lastWeeklyId: periodIds.weeklyId,
    updatedAt: FieldValue.serverTimestamp(),
});

const buildUsageRefundUpdate = ({
    usageData = {},
    quantity = 0,
    periodIds = getUsagePeriodIds(),
    purchaseDailyId = "",
    purchaseWeeklyId = "",
    shouldDecrementTotal = false,
}) => {
    const usage = normalizeUsageData(usageData, periodIds);
    const rawUsage = usageData && typeof usageData === "object" ? usageData : {};
    const dailyReferenceId = purchaseDailyId || rawUsage.lastDailyId || "";
    const weeklyReferenceId = purchaseWeeklyId || rawUsage.lastWeeklyId || "";

    return {
        daily:
            dailyReferenceId === periodIds.dailyId
                ? Math.max(0, usage.daily - quantity)
                : usage.daily,
        weekly:
            weeklyReferenceId === periodIds.weeklyId
                ? Math.max(0, usage.weekly - quantity)
                : usage.weekly,
        ...(shouldDecrementTotal
            ? { totalPurchased: Math.max(0, usage.totalPurchased - quantity) }
            : {}),
        totalResetVersion: usage.totalResetVersion,
        lastDailyId: periodIds.dailyId,
        lastWeeklyId: periodIds.weeklyId,
        updatedAt: FieldValue.serverTimestamp(),
    };
};

const normalizeTierMeta = (rawTier = null) => {
    if (!rawTier) return null;

    if (typeof rawTier === "string") {
        const value = rawTier.trim();
        if (!value) return null;

        return {
            id: value,
            name: value,
            minScore: null,
        };
    }

    const id = String(rawTier?.id || rawTier?.name || "").trim();
    const name = String(rawTier?.name || id).trim();
    if (!id && !name) return null;

    const parsedMinScore = Number(rawTier?.minScore);
    return {
        id: id || name,
        name: name || id,
        minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : null,
    };
};

const getFirstFiniteNumber = (...values) => {
    for (const value of values) {
        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) {
            return numericValue;
        }
    }

    return null;
};

const getStoreItemTierRequirementSnapshot = (itemData = {}) => {
    const requiredTierId = String(itemData?.minCreditTierId || "").trim();
    if (!requiredTierId) return null;

    const itemTier = normalizeTierMeta(itemData?.minCreditTier);
    return {
        id: requiredTierId,
        name: String(
            itemData?.minCreditTierName ||
            itemTier?.name ||
            requiredTierId,
        ).trim(),
        minScore: getFirstFiniteNumber(
            itemData?.minCreditScore,
            itemData?.minCreditTierMinScore,
            itemTier?.minScore,
        ),
    };
};

const needsTierCriteriaRead = (itemData = {}) => {
    const tierRequirement = getStoreItemTierRequirementSnapshot(itemData);
    return Boolean(
        tierRequirement &&
        !Number.isFinite(tierRequirement.minScore),
    );
};

// Inventory writes branch on existence so we can preserve createdAt
// and safely append acquisition history without clobbering prior data.
const shouldReadInventory = () => true;

const sortTierCriteria = (tiers = []) =>
    [...tiers]
        .filter((tier) => tier && typeof tier === "object" && tier.id)
        .sort((a, b) => Number(b.minScore ?? 0) - Number(a.minScore ?? 0));

const resolveEffectiveStudentTier = (studentData = {}, sortedTierCriteria = []) => {
    const rawTier = studentData?.creditTier;
    const studentTierId =
        typeof rawTier === "string" ? rawTier : rawTier?.id;
    if (studentTierId) {
        const matched = sortedTierCriteria.find((tier) => tier.id === studentTierId);
        if (matched) return matched;
    }

    const studentTierName =
        typeof rawTier === "string" ? rawTier : rawTier?.name;
    if (studentTierName) {
        const matchedByName = sortedTierCriteria.find(
            (tier) => tier.name === studentTierName,
        );
        if (matchedByName) return matchedByName;
    }

    // Policy: students missing creditTier are treated as lowest tier.
    return sortedTierCriteria[sortedTierCriteria.length - 1] || null;
};

const assertItemTierEligibility = ({
    itemData = {},
    studentData = {},
    sortedTierCriteria = [],
}) => {
    const tierRequirement = getStoreItemTierRequirementSnapshot(itemData);
    if (!tierRequirement) return;

    const itemName = itemData?.name || "상품";

    if (Number.isFinite(tierRequirement.minScore)) {
        const studentTier = normalizeTierMeta(studentData?.creditTier);
        const studentTierId = String(studentTier?.id || "").trim();

        if (studentTierId && studentTierId === tierRequirement.id) {
            return;
        }

        const studentCreditScore = getFirstFiniteNumber(studentData?.creditScore);
        if (
            studentCreditScore !== null &&
            studentCreditScore >= tierRequirement.minScore
        ) {
            return;
        }

        const studentTierMinScore = getFirstFiniteNumber(studentTier?.minScore);
        if (
            studentTierMinScore !== null &&
            studentTierMinScore >= tierRequirement.minScore
        ) {
            return;
        }

        if (
            !studentTierId &&
            studentCreditScore === null &&
            studentTierMinScore === null &&
            tierRequirement.minScore <= 0
        ) {
            return;
        }

        throw new HttpsError(
            "failed-precondition",
            `[${itemName}] ${tierRequirement.name || "지정"} 등급 이상만 구매할 수 있습니다.`,
        );
    }

    if (!sortedTierCriteria.length) {
        throw new HttpsError(
            "failed-precondition",
            `[${itemName}] 신용등급 기준이 없어 구매 제한을 확인할 수 없습니다.`,
        );
    }

    const requiredIndex = sortedTierCriteria.findIndex(
        (tier) => tier.id === tierRequirement.id,
    );
    if (requiredIndex < 0) {
        throw new HttpsError(
            "failed-precondition",
            `[${itemName}] 신용등급 제한 설정이 올바르지 않습니다.`,
        );
    }

    const requiredTier = sortedTierCriteria[requiredIndex];
    const studentTier = resolveEffectiveStudentTier(studentData, sortedTierCriteria);
    let studentIndex = sortedTierCriteria.findIndex(
        (tier) => tier.id === studentTier?.id,
    );

    if (studentIndex < 0) {
        studentIndex = sortedTierCriteria.length - 1;
    }

    if (studentIndex > requiredIndex) {
        throw new HttpsError(
            "failed-precondition",
            `[${itemName}] ${requiredTier?.name || "지정"} 등급 이상만 구매할 수 있습니다.`,
        );
    }
};

const assertStoreManagerPermission = async (classId, uid) => {
    const callerRef = db.doc(`classes/${classId}/students/${uid}`);
    const callerSnap = await callerRef.get();

    if (!callerSnap.exists) {
        throw new HttpsError("permission-denied", "해당 학급의 구성원만 요청할 수 있습니다.");
    }

    const callerData = callerSnap.data() || {};
    const isTeacher = ["teacher", "admin"].includes(callerData.role);
    const isStoreAdmin = callerData.permissions?.store_admin === true;

    if (!isTeacher && !isStoreAdmin) {
        throw new HttpsError("permission-denied", "환불/취소 처리 권한이 없습니다.");
    }

    return callerData;
};

const cancelStorePurchaseInTransaction = async ({
    transaction,
    classId,
    studentUid,
    purchaseId,
    reason,
    adminUid,
    context = {},
}) => {
    const redemptionRef = db.doc(
        `classes/${classId}/storeRedemptions/${purchaseId}`,
    );
    const rSnap = await transaction.get(redemptionRef);

    if (!rSnap.exists) throw new Error("취소할 구매 내역을 찾을 수 없습니다.");
    const rData = rSnap.data() || {};
    if (rData.paymentSourceType === "classFund") {
        throw new Error("기금 POS 결제는 예산·기금 장부에서 취소해 주세요.");
    }
    if (String(rData.studentUid || "") !== String(studentUid || "")) {
        throw new Error("구매 내역의 학생 정보가 요청값과 일치하지 않습니다.");
    }

    // A response-loss retry must preserve the completed refund without posting twice.
    if (rData.status === "cancelled") {
        return { purchaseId, studentUid, alreadyCancelled: true, refundAmount: 0 };
    }

    const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
    const itemRef = db.doc(`classes/${classId}/storeItems/${rData.itemId}`);
    const usageRef = db.doc(
        `classes/${classId}/students/${studentUid}/storeUsage/${rData.itemId}`,
    );
    const inventoryRef = db.doc(
        `classes/${classId}/students/${studentUid}/inventory/${rData.itemId}`,
    );
    const taxActivityLogRef = rData.taxActivityLogId
        ? db.doc(
            `classes/${classId}/students/${studentUid}/activityLogs/${rData.taxActivityLogId}`,
        )
        : null;

    const [sSnap, iSnap, invSnap, uSnap, taxActivityLogSnap] = await Promise.all([
        transaction.get(studentRef),
        transaction.get(itemRef),
        transaction.get(inventoryRef),
        transaction.get(usageRef),
        taxActivityLogRef
            ? transaction.get(taxActivityLogRef)
            : Promise.resolve(null),
    ]);
    if (!sSnap.exists) {
        throw new Error("학생 정보를 찾을 수 없습니다.");
    }

    const qty = Number(rData.quantity || 0);
    if (!(qty > 0)) {
        throw new Error("취소할 구매 수량 정보가 올바르지 않습니다.");
    }
    const periodIds = getUsagePeriodIds();
    const totalAmount = Number(rData.totalAmount || 0);
    const isGiftTransaction =
        rData.isGift === true || rData.transactionType === "gift";
    const refundAmount = isGiftTransaction ? 0 : totalAmount;
    const isTicket =
        rData.itemType === "ticket" || rData.functionTag === "arcade_ticket";
    const currencyType = normalizeStoreCurrencyType(
        rData.currencyType ||
            normalizeStoreCurrencyType(rData.currencyField),
    );
    const currencyField =
        rData.currencyField ||
        currencyType;

    const currentInvQty = invSnap.exists
        ? Number(invSnap.data().quantity || 0)
        : 0;
    if (currentInvQty < qty) {
        throw new Error(
            `취소할 수 없습니다: 학생 보유 수량이 부족합니다. (현재 보유: ${currentInvQty}개 / 취소 요청: ${qty}개)`,
        );
    }

    let currentTicketsForRefund = null;
    if (isTicket) {
        const ticketInventorySnap = await transaction.get(
            getArcadeTicketInventoryQuery(classId, studentUid),
        );
        const currentTickets = sumArcadeTicketQuantities(ticketInventorySnap.docs);
        currentTicketsForRefund = currentTickets;
        if (currentTickets < qty) {
            throw new Error(
                `취소할 수 없습니다: 학생 티켓 수량이 부족합니다. (현재 티켓: ${currentTickets}개 / 취소 요청: ${qty}개)`,
            );
        }
    }

    const invData = invSnap.data();
    let acquisitions = Array.isArray(invData?.acquisitions)
        ? [...invData.acquisitions]
        : [];
    let remainingToRemove = qty;
    let itemValueToRemove = 0;
    const fallbackUnitValue = qty > 0 ? totalAmount / qty : 0;

    acquisitions = acquisitions.filter((acq) => {
        if (remainingToRemove <= 0) return true;
        if (acq.purchaseId === purchaseId) {
            const acqQty = Number(acq.quantity || 0);
            const removeQty = Math.min(acqQty, remainingToRemove);
            const normalizedAcquisition = normalizeAcquisitionForAccounting(
                acq,
                invData,
                { fallbackUnitValue },
            );

            if (normalizedAcquisition.assetValueApplied === true) {
                itemValueToRemove +=
                    Number(normalizedAcquisition.unitValue || 0) * removeQty;
            }

            if (acqQty <= remainingToRemove) {
                remainingToRemove -= removeQty;
                return false;
            } else {
                acq.quantity = acqQty - removeQty;
                remainingToRemove = 0;
                return true;
            }
        }
        return true;
    });

    if (remainingToRemove > 0) {
        const refundableQty = Math.max(0, qty - remainingToRemove);
        throw new Error(
            `취소할 수 없습니다: 해당 구매건에서 이미 사용된 수량이 있어 환불 가능한 수량이 부족합니다. (환불 가능: ${refundableQty}개 / 취소 요청: ${qty}개)`,
        );
    }

    const storeMode = rData.storeMode || "TOTAL";
    const amountToRefundFromTreasury = isGiftTransaction
        ? 0
        : (storeMode === "TAX_ONLY"
            ? Math.round(Number(rData.taxAmountPerItem || 0) * qty)
            : refundAmount);

    const cancelTaxMeta = {
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: adminUid,
    };

    let taxReversal = null;
    const taxRecord = rData.taxRecord || null;
    if (taxRecord?.id) {
        const originalCollection =
            taxRecord.collection === "taxExpenses" ? "taxExpenses" : "taxIncomes";
        const lineCollection = taxRecord.lineCollection || TAX_LINE_COLLECTION;
        const lineId = taxRecord.lineId || purchaseId;
        if (taxRecord.detailStorage !== "inline") {
            const originalLineRef = db.doc(
                `classes/${classId}/${originalCollection}/${taxRecord.id}/${lineCollection}/${lineId}`,
            );
            transaction.set(
                originalLineRef,
                {
                    status: "cancelled",
                    cancelledReason: "store_refund",
                    ...cancelTaxMeta,
                },
                { merge: true },
            );
        }

        if (originalCollection === "taxIncomes" && amountToRefundFromTreasury > 0) {
            taxReversal = {
                direction: "income_to_expense",
                amount: amountToRefundFromTreasury,
                originalTaxRecord: {
                    collection: originalCollection,
                    id: taxRecord.id,
                    lineCollection,
                    lineId,
                },
                line: {
                    id: purchaseId,
                    amount: amountToRefundFromTreasury,
                    source: "store_refund",
                    expenseType: "store_refund",
                    category: "refund",
                    description: `매점 환불 - ${rData.itemName} (${qty}개)`,
                    studentUid,
                    studentName: sSnap.data()?.name || null,
                    relatedDoc: { collection: "storeRedemptions", id: purchaseId },
                    externalId: purchaseId,
                    meta: {
                        reversalType: "income_to_expense",
                        reversalOfTaxRecordId: taxRecord.id,
                        storeMode,
                    },
                },
            };
        }

        if (originalCollection === "taxExpenses" && totalAmount > 0) {
            taxReversal = {
                direction: "expense_to_income",
                amount: totalAmount,
                originalTaxRecord: {
                    collection: originalCollection,
                    id: taxRecord.id,
                    lineCollection,
                    lineId,
                },
                line: {
                    id: purchaseId,
                    amount: totalAmount,
                    source: "store_gift_cancel",
                    taxType: "store_gift_reversal",
                    description: `[POS] 무료 선물 취소 - ${rData.itemName} (${qty}개)`,
                    studentUid,
                    studentName: sSnap.data()?.name || null,
                    relatedDoc: { collection: "storeRedemptions", id: purchaseId },
                    externalId: purchaseId,
                    meta: {
                        reversalType: "expense_to_income",
                        reversalOfTaxRecordId: taxRecord.id,
                        storeMode,
                    },
                },
            };
        }
    } else {
        const legacyIncomeRef = db.doc(`classes/${classId}/taxIncomes/${purchaseId}`);
        const legacyGiftExpenseRef = db.doc(
            `classes/${classId}/taxExpenses/gift_${purchaseId}`,
        );
        const [legacyIncomeSnap, legacyGiftExpenseSnap] = await transaction.getAll(
            legacyIncomeRef,
            legacyGiftExpenseRef,
        );

        if (legacyIncomeSnap.exists) {
            transaction.set(
                legacyIncomeRef,
                {
                    status: "cancelled",
                    cancelledReason: "store_refund",
                    ...cancelTaxMeta,
                },
                { merge: true },
            );

            if (amountToRefundFromTreasury > 0) {
                taxReversal = {
                    direction: "income_to_expense",
                    amount: amountToRefundFromTreasury,
                    originalTaxRecord: {
                        collection: "taxIncomes",
                        id: purchaseId,
                    },
                    line: {
                        id: purchaseId,
                        amount: amountToRefundFromTreasury,
                        source: "store_refund",
                        expenseType: "store_refund",
                        category: "refund",
                        description: `매점 환불 - ${rData.itemName} (${qty}개)`,
                        studentUid,
                        studentName: sSnap.data()?.name || null,
                        relatedDoc: { collection: "storeRedemptions", id: purchaseId },
                        externalId: purchaseId,
                        meta: {
                            reversalType: "income_to_expense",
                            reversalOfTaxRecordId: purchaseId,
                            storeMode,
                            legacyTax: true,
                        },
                    },
                };
            }
        } else if (legacyGiftExpenseSnap.exists) {
            transaction.set(
                legacyGiftExpenseRef,
                {
                    status: "cancelled",
                    cancelledReason: "store_refund",
                    ...cancelTaxMeta,
                },
                { merge: true },
            );

            if (totalAmount > 0) {
                taxReversal = {
                    direction: "expense_to_income",
                    amount: totalAmount,
                    originalTaxRecord: {
                        collection: "taxExpenses",
                        id: `gift_${purchaseId}`,
                    },
                    line: {
                        id: purchaseId,
                        amount: totalAmount,
                        source: "store_gift_cancel",
                        taxType: "store_gift_reversal",
                        description: `[POS] 무료 선물 취소 - ${rData.itemName} (${qty}개)`,
                        studentUid,
                        studentName: sSnap.data()?.name || null,
                        relatedDoc: { collection: "storeRedemptions", id: purchaseId },
                        externalId: purchaseId,
                        meta: {
                            reversalType: "expense_to_income",
                            reversalOfTaxRecordId: `gift_${purchaseId}`,
                            storeMode,
                            legacyTax: true,
                        },
                    },
                };
            }
        }
    }

    const studentUpdateData = {};
    const roundedItemValueToRemove = roundCurrency(itemValueToRemove);
    if (roundedItemValueToRemove > 0) {
        studentUpdateData["assets.itemValue"] = FieldValue.increment(
            -roundedItemValueToRemove,
        );
    }
    if (refundAmount > 0) {
        studentUpdateData[`assets.${currencyField}`] =
            FieldValue.increment(refundAmount);
    }
    if (isTicket) {
        studentUpdateData["assets.ticket"] = Math.max(currentTicketsForRefund - qty, 0);
    }
    if (Object.keys(studentUpdateData).length > 0) {
        transaction.update(studentRef, studentUpdateData);
    }

    if (iSnap.exists && iSnap.data().stock !== -1) {
        transaction.update(itemRef, { stock: FieldValue.increment(qty) });
    }
    if (uSnap.exists) {
        const usageData = uSnap.data() || {};
        const currentResetVersion = Math.max(
            0,
            Number(usageData.totalResetVersion || 0),
        );
        const purchaseResetVersion = Math.max(
            0,
            Number(rData.totalResetVersion || 0),
        );
        const shouldDecrementTotal =
            rData.countsTowardTotalLimit !== false &&
            purchaseResetVersion === currentResetVersion;

        const usageRefundUpdate = buildUsageRefundUpdate({
            usageData,
            quantity: qty,
            periodIds,
            purchaseDailyId: rData.purchaseDailyId || "",
            purchaseWeeklyId: rData.purchaseWeeklyId || "",
            shouldDecrementTotal,
        });

        transaction.set(usageRef, usageRefundUpdate, { merge: true });
        stageStoreLimitSummaryRow({
            transaction,
            classId,
            itemId: rData.itemId,
            studentUid,
            usageData: usageRefundUpdate,
        });
    }

    const newQty = currentInvQty - qty;
    if (newQty <= 0) {
        transaction.delete(inventoryRef);
    } else {
        transaction.update(inventoryRef, {
            ...buildInventoryExpiryIndexFields({
                classId,
                studentUid,
                inventoryData: invData,
                acquisitions,
            }),
            quantity: newQty,
            acquisitions,
        });
    }

    const redemptionUpdate = {
        status: "cancelled",
        cancellationReason: reason || "관리자에 의해 취소됨",
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: adminUid,
    };
    if (taxReversal) {
        redemptionUpdate.taxCancelled = true;
    }
    transaction.update(redemptionRef, redemptionUpdate);

    if (taxActivityLogRef && taxActivityLogSnap?.exists) {
        stageActivityTaxCancellation({
            tx: transaction,
            classId,
            activityLogRef: taxActivityLogRef,
            activityLogData: taxActivityLogSnap.data(),
            actorUid: adminUid,
            reason: "store_purchase_refunded",
            context: { ...context, pageKey: "store" },
        });
    }

    return {
        refundAmount,
        taxRefundAmount: amountToRefundFromTreasury,
        taxReversal,
    };
};

const stageStoreCancellationTaxReversal = ({
    transaction,
    classId,
    adminUid,
    adminName,
    batchKey,
    context,
    incomeToExpenseLines = [],
    expenseToIncomeLines = [],
}) => {
    const output = {
        expenseAggregateId: null,
        incomeAggregateId: null,
    };

    if (incomeToExpenseLines.length > 0) {
        const expenseAggregateId = `store_refund_${batchKey}`;
        const totalAmount = incomeToExpenseLines.reduce(
            (sum, line) => sum + Number(line.amount || 0),
            0,
        );

        stageIncomeCancellationAsExpense(
            transaction,
            classId,
            {
                amount: totalAmount,
                source: "store_refund",
                expenseType: "store_refund",
                category: "refund",
                description: `상점 환불 합산 기록 (${incomeToExpenseLines.length}건)`,
            },
            adminUid,
            {
                ...context,
                customId: expenseAggregateId,
                aggregateMeta: {
                    group: "store_refund",
                    batchKey,
                    pageKey: "store",
                    actorUid: adminUid,
                    actorName: adminName || null,
                    mode: "cancel_store_purchase",
                },
                detailLines: incomeToExpenseLines,
                detailCollection: TAX_LINE_COLLECTION,
                skipFeatureGate: true,
            },
        );

        for (const line of incomeToExpenseLines) {
            const redemptionRef = db.doc(
                `classes/${classId}/storeRedemptions/${line.id}`,
            );
            transaction.set(
                redemptionRef,
                {
                    taxCancelled: true,
                    taxReversal: buildTaxRecordPointer(
                        "taxExpenses",
                        expenseAggregateId,
                        line.id,
                    ),
                    taxReversalAt: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
        }

        output.expenseAggregateId = expenseAggregateId;
    }

    if (expenseToIncomeLines.length > 0) {
        const incomeAggregateId = `store_gift_cancel_${batchKey}`;
        const totalAmount = expenseToIncomeLines.reduce(
            (sum, line) => sum + Number(line.amount || 0),
            0,
        );

        stageExpenseCancellationAsIncome(
            transaction,
            classId,
            {
                amount: totalAmount,
                source: "store_gift_cancel",
                taxType: "store_gift_reversal",
                description: `[POS] 무료 선물 취소 합산 기록 (${expenseToIncomeLines.length}건)`,
            },
            adminUid,
            {
                ...context,
                customId: incomeAggregateId,
                aggregateMeta: {
                    group: "store_gift_cancel",
                    batchKey,
                    pageKey: "store",
                    actorUid: adminUid,
                    actorName: adminName || null,
                    mode: "cancel_store_gift",
                },
                detailLines: expenseToIncomeLines,
                detailCollection: TAX_LINE_COLLECTION,
                skipFeatureGate: true,
            },
        );

        for (const line of expenseToIncomeLines) {
            const redemptionRef = db.doc(
                `classes/${classId}/storeRedemptions/${line.id}`,
            );
            transaction.set(
                redemptionRef,
                {
                    taxCancelled: true,
                    taxReversal: buildTaxRecordPointer(
                        "taxIncomes",
                        incomeAggregateId,
                        line.id,
                    ),
                    taxReversalAt: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
        }

        output.incomeAggregateId = incomeAggregateId;
    }

    return output;
};

const redeemStorePurchaseInTransaction = async ({
    transaction,
    classId,
    studentUid,
    purchaseId,
    adminUid,
}) => {
    const redemptionRef = db.doc(
        `classes/${classId}/storeRedemptions/${purchaseId}`,
    );
    const redemptionSnap = await transaction.get(redemptionRef);

    if (!redemptionSnap.exists) {
        throw new Error("지급할 구매 내역을 찾을 수 없습니다.");
    }

    const redemptionData = redemptionSnap.data() || {};
    if (String(redemptionData.studentUid || "") !== String(studentUid || "")) {
        throw new Error("지급 대상 학생 정보가 구매 내역과 일치하지 않습니다.");
    }
    if (redemptionData.status !== "pending") {
        throw new Error("지급 가능한 상태가 아닙니다.");
    }

    const itemId = String(redemptionData.itemId || "").trim();
    const quantity = Math.max(1, Number(redemptionData.quantity || 1));
    if (!itemId) {
        throw new Error("구매 내역에 상품 정보(itemId)가 없습니다.");
    }

    const targetInventoryRef = db.doc(
        `classes/${classId}/students/${studentUid}/inventory/${itemId}`,
    );
    const inventorySnap = await transaction.get(targetInventoryRef);
    const nowTs = FieldValue.serverTimestamp();

    const acquisition = buildTrackedInventoryAcquisition({
        type: "purchase",
        purchaseId,
        quantity,
        acquiredAt: admin.firestore.Timestamp.now(),
        unitValue: Number(redemptionData.pricePerItem ?? redemptionData.totalAmount ?? 0),
        assetValueApplied: redemptionData.currencyType !== "usdBalance",
        ticketCountApplied: isTicketInventoryItem({
            itemType: redemptionData.itemType || "general",
            functionTag: redemptionData.functionTag || null,
        }),
        ...(redemptionData?.randomBoxConfigSnapshot
            ? { randomBoxConfigSnapshot: redemptionData.randomBoxConfigSnapshot }
            : {}),
    });

    const commonInventoryData = {
        itemId,
        itemName: redemptionData.itemName || "",
        itemType: redemptionData.itemType || "general",
        functionTag: redemptionData.functionTag || null,
        isGiftAllowed: redemptionData.isGiftAllowed !== false,
        price: Number(redemptionData.pricePerItem ?? redemptionData.totalAmount ?? 0),
        currencyType: redemptionData.currencyType || "cash",
        currencyUnit: redemptionData.currencyUnit || null,
        lastAcquiredDate: nowTs,
    };

    if (inventorySnap.exists) {
        transaction.update(targetInventoryRef, {
            ...commonInventoryData,
            quantity: FieldValue.increment(quantity),
            totalAcquired: FieldValue.increment(quantity),
            acquisitions: FieldValue.arrayUnion(acquisition),
        });
    } else {
        transaction.set(targetInventoryRef, {
            ...commonInventoryData,
            quantity,
            totalAcquired: quantity,
            totalUsed: 0,
            createdAt: nowTs,
            acquisitions: [acquisition],
        });
    }

    transaction.update(redemptionRef, {
        status: "redeemed",
        redeemedAt: nowTs,
        redeemedBy: adminUid,
        updatedAt: nowTs,
    });

    return {
        purchaseId,
        studentUid,
        itemId,
        quantity,
    };
};

const grantRandomBoxRewardInTransaction = async ({
    transaction,
    classId,
    studentUid,
    rewardItemRef,
    rewardInventoryRef,
    rewardInventorySnap,
    rewardItemData = {},
    rewardEntry = {},
    classData = {},
    nowTs,
    staticNow,
    boxItemId = "",
    boxItemName = "",
    sourcePurchaseId = "",
    randomBoxOpenId = "",
}) => {
    const rewardQuantity = Math.max(
        1,
        Math.floor(Number(rewardEntry?.quantity || 1)),
    );
    const rewardUnitValue = Math.max(
        0,
        Number(rewardItemData?.price ?? rewardEntry?.price ?? 0),
    );
    const rewardCurrencyMeta = getStoreCurrencyMeta(rewardItemData, classData);
    const rewardIsTicket =
        rewardItemData?.itemType === "ticket" ||
        rewardItemData?.functionTag === "arcade_ticket";
    const expirationMeta = buildStoreItemExpirationMeta(
        rewardItemData,
        staticNow.toMillis(),
    );
    const rewardAcquisition = buildTrackedInventoryAcquisition({
        ...buildRandomBoxRewardAcquisition({
            rewardQuantity,
            rewardUnitValue,
            acquiredAt: staticNow,
            rewardItemData,
            boxItemId,
            boxItemName,
            sourcePurchaseId,
            randomBoxOpenId,
        }),
        ...expirationMeta,
    });
    const commonInventoryData = {
        itemId: rewardItemRef.id,
        itemName:
            rewardItemData?.name ||
            rewardEntry?.itemName ||
            "랜덤박스 보상",
        itemType: rewardItemData?.itemType || rewardEntry?.itemType || "general",
        functionTag: rewardItemData?.functionTag || null,
        isGiftAllowed: isStoreItemGiftAllowed(rewardItemData),
        price: rewardUnitValue,
        currencyType: rewardCurrencyMeta.currencyType,
        currencyUnit: rewardCurrencyMeta.currencyUnit,
        lastAcquiredDate: nowTs,
        obtainedFrom: "random_box",
    };

    if (rewardInventorySnap.exists) {
        const rewardInventoryData = rewardInventorySnap.data() || {};
        const nextRewardAcquisitions = buildInventoryAcquisitionsWithAddedEntry(
            rewardInventoryData,
            rewardAcquisition,
        );
        transaction.update(rewardInventoryRef, {
            ...commonInventoryData,
            ...buildInventoryExpiryIndexFields({
                classId,
                studentUid,
                inventoryData: rewardInventoryData,
                acquisitions: nextRewardAcquisitions,
            }),
            quantity: FieldValue.increment(rewardQuantity),
            totalAcquired: FieldValue.increment(rewardQuantity),
            acquisitions: FieldValue.arrayUnion(rewardAcquisition),
        });
    } else {
        transaction.set(rewardInventoryRef, {
            ...commonInventoryData,
            ...buildInventoryExpiryIndexFields({
                classId,
                studentUid,
                inventoryData: commonInventoryData,
                acquisitions: [rewardAcquisition],
                includeDelete: false,
            }),
            quantity: rewardQuantity,
            totalAcquired: rewardQuantity,
            totalUsed: 0,
            createdAt: nowTs,
            acquisitions: [rewardAcquisition],
        });
    }

    if (rewardItemData.stock !== -1) {
        transaction.update(rewardItemRef, {
            stock: FieldValue.increment(-rewardQuantity),
        });
    }

    return {
        rewardItemId: rewardItemRef.id,
        rewardItemName:
            rewardItemData?.name ||
            rewardEntry?.itemName ||
            "랜덤박스 보상",
        rewardQuantity,
        rewardTotalAssetValue: rewardCurrencyMeta.currencyType === "usdBalance" ? 0 : rewardUnitValue * rewardQuantity,
        rewardTicketCount: rewardIsTicket ? rewardQuantity : 0,
    };
};

const useItemInTransaction = async ({
    transaction,
    classId,
    studentUid,
    itemId,
    quantity = 1,
    note = "",
    usedBy = null,
}) => {
    const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
    const inventoryRef = db.doc(
        `classes/${classId}/students/${studentUid}/inventory/${itemId}`,
    );

    const [studentSnap, inventorySnap] = await Promise.all([
        transaction.get(studentRef),
        transaction.get(inventoryRef),
    ]);

    if (!studentSnap.exists) {
        throw new Error("학생 정보를 찾을 수 없습니다.");
    }
    if (!inventorySnap.exists) {
        throw new Error("보유 중인 상품이 없어 사용할 수 없습니다.");
    }

    const invData = inventorySnap.data();
    const isArcadeTicket =
        invData?.functionTag === "arcade_ticket" ||
        (invData?.itemType === "ticket" && !invData?.functionTag);
    const isRandomBox = isRandomBoxStoreItem(invData);
    const currentQty = Number(invData.quantity || 0);
    const useQty = Math.floor(Number(quantity));
    const nowTs = FieldValue.serverTimestamp();

    if (isArcadeTicket) {
        throw new Error("오락실 티켓은 내가방에서 사용할 수 없고 오락실에서만 사용할 수 있습니다.");
    }

    if (!Number.isFinite(useQty) || useQty < 1) {
        throw new Error("사용 수량이 올바르지 않습니다.");
    }
    if (currentQty < useQty) {
        throw new Error("사용 수량이 보유 수량보다 많습니다.");
    }

    if (isRandomBox) {
        if (useQty !== 1) {
            throw new Error("랜덤박스는 한 번에 1개씩만 열 수 있습니다.");
        }

        const usageAccounting = consumeInventoryAcquisitionsWithFallback({
            inventoryData: invData,
            quantity: useQty,
            skipExpired: true,
        });
        const remainingToUse = usageAccounting.remainingQuantity;
        const updatedAcquisitions = usageAccounting.updatedAcquisitions;
        const usageDetail = usageAccounting.consumptionDetails[0] || {};

        if (remainingToUse > 0 && usageAccounting.expiredQuantity <= 0) {
            throw new Error("아이템 수량 계산 중 오류가 발생했습니다.");
        }

        if (remainingToUse > 0 && usageAccounting.expiredQuantity > 0) {
            throw new Error(
                "사용 가능한 수량이 부족합니다. 만료된 아이템은 사용할 수 없고 학생 가방에서는 표시되지 않습니다.",
            );
        }

        const usableAcquisition = getUsableInventoryAcquisition(
            invData.acquisitions,
            invData,
            { skipExpired: true },
        );
        if (!usableAcquisition) {
            throw new Error("사용 가능한 랜덤박스가 없습니다.");
        }

        const trackingPurchaseId = String(
            usableAcquisition.sourcePurchaseId ||
                usableAcquisition.purchaseId ||
                "",
        ).trim();
        const redemptionRef = trackingPurchaseId
            ? db.doc(`classes/${classId}/storeRedemptions/${trackingPurchaseId}`)
            : null;
        const randomBoxOpenRef = redemptionRef
            ? redemptionRef.collection("openEvents").doc()
            : null;
        const randomBoxOpenId = randomBoxOpenRef?.id || "";

        const classRef = db.doc(`classes/${classId}`);
        const boxItemRef = db.doc(`classes/${classId}/storeItems/${itemId}`);
        const [classSnap, boxItemSnap] = await Promise.all([
            transaction.get(classRef),
            transaction.get(boxItemRef),
        ]);
        const classData = classSnap.exists ? (classSnap.data() || {}) : {};
        const boxItemData = boxItemSnap.exists ? (boxItemSnap.data() || {}) : {};
        const boxConfig =
            normalizeRandomBoxConfig(usableAcquisition?.randomBoxConfigSnapshot) ||
            normalizeRandomBoxConfig(boxItemData);

        if (!boxConfig || !Array.isArray(boxConfig.rewards) || boxConfig.rewards.length === 0) {
            throw new Error("랜덤박스 보상 정보가 없습니다.");
        }

        const rewardItemRefs = boxConfig.rewards.map((reward) =>
            db.doc(`classes/${classId}/storeItems/${reward.itemId}`),
        );
        const rewardItemSnaps = await Promise.all(
            rewardItemRefs.map((rewardRef) => transaction.get(rewardRef)),
        );
        const eligibleRewards = boxConfig.rewards.reduce(
            (acc, reward, index) => {
                const rewardSnap = rewardItemSnaps[index];
                if (!rewardSnap?.exists) {
                    return acc;
                }

                const rewardItemData = rewardSnap.data() || {};
                const rewardQuantity = Math.max(
                    1,
                    Math.floor(Number(reward?.quantity || 1)),
                );
                const rewardStock = Number(rewardItemData.stock ?? -1);

                if (isRandomBoxStoreItem(rewardItemData)) {
                    return acc;
                }

                if (rewardItemData.stock !== -1 && rewardStock < rewardQuantity) {
                    return acc;
                }

                acc.push({
                    ...reward,
                    quantity: rewardQuantity,
                    rewardItemRef: rewardItemRefs[index],
                    rewardItemData,
                });
                return acc;
            },
            [],
        );

        if (eligibleRewards.length === 0) {
            throw new Error("현재 지급 가능한 랜덤박스 보상이 없습니다.");
        }

        const selectedReward = pickWeightedRandomBoxReward(eligibleRewards);
        if (!selectedReward) {
            throw new Error("랜덤박스 보상 추첨 중 오류가 발생했습니다.");
        }

        const rewardInventoryRef = db.doc(
            `classes/${classId}/students/${studentUid}/inventory/${selectedReward.itemId}`,
        );
        const rewardInventorySnap = await transaction.get(rewardInventoryRef);
        const totalValueToRemove = usageAccounting.totalAssetValueToRemove;

        if (currentQty === useQty) {
            transaction.delete(inventoryRef);
        } else {
            transaction.update(inventoryRef, {
                ...buildInventoryExpiryIndexFields({
                    classId,
                    studentUid,
                    inventoryData: invData,
                    acquisitions: updatedAcquisitions,
                }),
                quantity: FieldValue.increment(-useQty),
                acquisitions: updatedAcquisitions,
                totalUsed: FieldValue.increment(useQty),
            });
        }

        const rewardGrant = await grantRandomBoxRewardInTransaction({
            transaction,
            classId,
            studentUid,
            rewardItemRef: selectedReward.rewardItemRef,
            rewardInventoryRef,
            rewardInventorySnap,
            rewardItemData: selectedReward.rewardItemData,
            rewardEntry: selectedReward,
            classData,
            nowTs,
            staticNow: admin.firestore.Timestamp.now(),
            boxItemId: itemId,
            boxItemName: invData.itemName || boxItemData.name || "랜덤박스",
            sourcePurchaseId: trackingPurchaseId,
            randomBoxOpenId,
        });

        const studentUpdates = {};
        const netItemValueDelta =
            Number(rewardGrant.rewardTotalAssetValue || 0) - totalValueToRemove;

        if (netItemValueDelta !== 0) {
            studentUpdates["assets.itemValue"] = FieldValue.increment(
                netItemValueDelta,
            );
        }
        if (rewardGrant.rewardTicketCount > 0) {
            studentUpdates["assets.ticket"] = FieldValue.increment(
                rewardGrant.rewardTicketCount,
            );
        }
        if (Object.keys(studentUpdates).length > 0) {
            transaction.update(studentRef, studentUpdates);
        }

        if (redemptionRef && randomBoxOpenRef) {
            transaction.set(
                randomBoxOpenRef,
                buildRandomBoxOpenEventRecord({
                    purchaseId: trackingPurchaseId,
                    randomBoxOpenId,
                    studentUid,
                    boxItemId: itemId,
                    boxItemName:
                        invData.itemName || boxItemData.name || "랜덤박스",
                    rewardItemId: rewardGrant.rewardItemId,
                    rewardItemName: rewardGrant.rewardItemName,
                    rewardQuantity: rewardGrant.rewardQuantity,
                    openedAt: nowTs,
                }),
            );
            transaction.set(
                redemptionRef,
                {
                    randomBoxOpenedCount: FieldValue.increment(1),
                    randomBoxRewardUnusedCount: FieldValue.increment(1),
                    randomBoxLastOpenId: randomBoxOpenId,
                    randomBoxLastOpenedAt: nowTs,
                    randomBoxLastRewardItemId: rewardGrant.rewardItemId,
                    randomBoxLastRewardItemName: rewardGrant.rewardItemName,
                    randomBoxLastRewardQuantity: rewardGrant.rewardQuantity,
                    ...buildRandomBoxRewardSearchFields({
                        rewardItemId: rewardGrant.rewardItemId,
                        rewardItemName: rewardGrant.rewardItemName,
                    }),
                    updatedAt: nowTs,
                },
                { merge: true },
            );
        }

        transaction.set(
            db.collection(`classes/${classId}/students/${studentUid}/usageHistory`).doc(),
            {
                itemId,
                itemName: invData.itemName || boxItemData.name || "랜덤박스",
                quantity: 1,
                sourceType: "random_box_open",
                boxSourceType:
                    usageDetail.sourceType ||
                    usableAcquisition.type ||
                    "purchase",
                fromName: usageDetail.fromName || null,
                message: usageDetail.message || null,
                unitValue: usageDetail.unitValue || 0,
                assetValueApplied: usageDetail.assetValueApplied === true,
                ticketCountApplied: false,
                obtainedFrom: usageDetail.obtainedFrom || null,
                sourcePurchaseId: usageDetail.sourcePurchaseId || trackingPurchaseId || null,
                randomBoxOpenId: randomBoxOpenId || null,
                boxItemId: itemId,
                boxItemName:
                    invData.itemName || boxItemData.name || "랜덤박스",
                note,
                rewardItemId: rewardGrant.rewardItemId,
                rewardItemName: rewardGrant.rewardItemName,
                rewardQuantity: rewardGrant.rewardQuantity,
                usedDate: nowTs,
                status: "used",
                ...(usedBy?.uid && {
                    usedByUid: usedBy.uid,
                    usedByName: usedBy.name || "",
                    usedByRole: usedBy.role || "",
                }),
            },
        );

        return {
            success: true,
            openedRandomBox: true,
            boxItemId: itemId,
            boxItemName: invData.itemName || boxItemData.name || "랜덤박스",
            rewardItemId: rewardGrant.rewardItemId,
            rewardItemName: rewardGrant.rewardItemName,
            rewardQuantity: rewardGrant.rewardQuantity,
        };
    }

    const usageAccounting = consumeInventoryAcquisitionsWithFallback({
        inventoryData: invData,
        quantity: useQty,
        skipExpired: true,
    });
    let remainingToUse = usageAccounting.remainingQuantity;
    const updatedAcquisitions = usageAccounting.updatedAcquisitions;
    const usageDetails = usageAccounting.consumptionDetails;

    if (remainingToUse > 0 && usageAccounting.expiredQuantity <= 0) {
        throw new Error("아이템 수량 계산 중 오류가 발생했습니다.");
    }

    if (remainingToUse > 0 && usageAccounting.expiredQuantity > 0) {
        throw new Error(
            "사용 가능한 수량이 부족합니다. 만료된 아이템은 사용할 수 없고 학생 가방에서는 표시되지 않습니다.",
        );
    }

    const totalValueToRemove = usageAccounting.totalAssetValueToRemove;

    if (currentQty === useQty) {
        transaction.delete(inventoryRef);
    } else {
        transaction.update(inventoryRef, {
            ...buildInventoryExpiryIndexFields({
                classId,
                studentUid,
                inventoryData: invData,
                acquisitions: updatedAcquisitions,
            }),
            quantity: FieldValue.increment(-useQty),
            acquisitions: updatedAcquisitions,
            totalUsed: FieldValue.increment(useQty),
        });
    }

    transaction.update(studentRef, {
        "assets.itemValue": FieldValue.increment(-totalValueToRemove),
    });

    const usageLogCol = db.collection(
        `classes/${classId}/students/${studentUid}/usageHistory`,
    );
    for (const detail of usageDetails) {
        transaction.set(usageLogCol.doc(), {
            itemId,
            itemName: invData.itemName,
            quantity: detail.quantity,
            sourceType: detail.sourceType,
            fromName: detail.fromName,
            message: detail.message,
            unitValue: detail.unitValue || 0,
            assetValueApplied: detail.assetValueApplied === true,
            ticketCountApplied: detail.ticketCountApplied === true,
            obtainedFrom: detail.obtainedFrom || null,
            sourcePurchaseId: detail.sourcePurchaseId || null,
            randomBoxOpenId: detail.randomBoxOpenId || null,
            boxItemId: detail.boxItemId || null,
            boxItemName: detail.boxItemName || null,
            note,
            usedDate: nowTs,
            status: "used",
            ...(usedBy?.uid && {
                usedByUid: usedBy.uid,
                usedByName: usedBy.name || "",
                usedByRole: usedBy.role || "",
            }),
        });
        applyRandomBoxRewardUsageTracking({
            transaction,
            classId,
            studentUid,
            detail,
            usedAt: nowTs,
        });
    }

    return { success: true };
};

const deleteInventoryItemInTransaction = async ({
    transaction,
    classId,
    studentUid,
    itemId,
    quantity = 1,
    reason = "",
    deletedBy = null,
    deleteOnlyExpired = false,
}) => {
    const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
    const inventoryRef = db.doc(
        `classes/${classId}/students/${studentUid}/inventory/${itemId}`,
    );

    const [studentSnap, inventorySnap] = await Promise.all([
        transaction.get(studentRef),
        transaction.get(inventoryRef),
    ]);

    if (!studentSnap.exists) {
        throw new Error("학생 정보를 찾을 수 없습니다.");
    }
    if (!inventorySnap.exists) {
        throw new Error("삭제할 보유 상품이 없습니다.");
    }

    const studentData = studentSnap.data() || {};
    const invData = inventorySnap.data();
    const currentQty = Number(invData.quantity || 0);
    const deleteQty = Math.floor(Number(quantity));

    if (!Number.isFinite(deleteQty) || deleteQty < 1) {
        throw new Error("삭제 수량이 올바르지 않습니다.");
    }
    if (currentQty < deleteQty) {
        throw new Error("삭제 수량이 보유 수량보다 많습니다.");
    }

    const deleteAccounting = consumeInventoryAcquisitionsWithFallback({
        inventoryData: invData,
        quantity: deleteQty,
        deleteOnlyExpired,
    });
    let remainingToDelete = deleteAccounting.remainingQuantity;
    const updatedAcquisitions = deleteAccounting.updatedAcquisitions;
    const deleteDetails = deleteAccounting.consumptionDetails;

    if (remainingToDelete > 0 && !deleteOnlyExpired) {
        throw new Error("아이템 수량 계산 중 오류가 발생했습니다.");
    }

    if (remainingToDelete > 0 && deleteOnlyExpired) {
        if (deleteAccounting.expiredQuantity <= 0) {
            throw new Error("삭제할 만료 아이템이 없습니다.");
        }

        throw new Error(
            `만료된 수량 ${deleteAccounting.expiredQuantity}개까지만 삭제할 수 있습니다.`,
        );
    }

    const totalValueToRemove = deleteAccounting.totalAssetValueToRemove;
    const ticketCountToRemove = deleteAccounting.totalTicketCountToRemove;
    const isTicket = isTicketInventoryItem(invData);

    if (currentQty === deleteQty) {
        transaction.delete(inventoryRef);
    } else {
        transaction.update(inventoryRef, {
            ...buildInventoryExpiryIndexFields({
                classId,
                studentUid,
                inventoryData: invData,
                acquisitions: updatedAcquisitions,
            }),
            quantity: FieldValue.increment(-deleteQty),
            acquisitions: updatedAcquisitions,
        });
    }

    const studentUpdates = {
        "assets.itemValue": FieldValue.increment(-totalValueToRemove),
    };
    if (isTicket && ticketCountToRemove > 0) {
        studentUpdates["assets.ticket"] = FieldValue.increment(
            -ticketCountToRemove,
        );
    }
    transaction.update(studentRef, studentUpdates);

    const usageLogCol = db.collection(
        `classes/${classId}/students/${studentUid}/usageHistory`,
    );
    for (const detail of deleteDetails) {
        transaction.set(usageLogCol.doc(), {
            itemId,
            itemName: invData.itemName,
            quantity: detail.quantity,
            sourceType: detail.sourceType,
            fromName: detail.fromName,
            message: detail.message,
            unitValue: detail.unitValue || 0,
            assetValueApplied: detail.assetValueApplied === true,
            ticketCountApplied: detail.ticketCountApplied === true,
            obtainedFrom: detail.obtainedFrom || null,
            sourcePurchaseId: detail.sourcePurchaseId || null,
            note: reason,
            usedDate: FieldValue.serverTimestamp(),
            status: "deleted",
            ...(deletedBy?.uid && {
                deletedByUid: deletedBy.uid,
                deletedByName: deletedBy.name || studentData?.name || "",
                deletedByRole: deletedBy.role || studentData?.role || "",
            }),
        });
    }

    return { success: true };
};

/**
 */
exports.purchaseStoreItem = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth)
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, itemId, quantity = 1 } = data || {};
        if (!classId || !itemId || quantity <= 0) {
            throw new HttpsError("invalid-argument", "필수 값(classId, itemId, quantity)이 올바르지 않습니다.");
        }

        const userId = auth.uid;
        const globalConfig = await getGlobalConfig();

        try {
            return await runFinancialRequest({
                db, classId, actorUid: auth.uid,
                operation: "store_item", clientRequestId: data.clientRequestId,
                payload: { itemId, quantity },
            }, async (transaction) => {
                const pricingNow = new Date();
                const studentRef = db.doc(`classes/${classId}/students/${userId}`);
                const itemRef = db.doc(`classes/${classId}/storeItems/${itemId}`);
                const classRef = db.doc(`classes/${classId}`);
                const inventoryRef = db.doc(
                    `classes/${classId}/students/${userId}/inventory/${itemId}`,
                );
                const usageRef = db.doc(
                    `classes/${classId}/students/${userId}/storeUsage/${itemId}`,
                );
                const tierCriteriaRef = db.doc(
                    `classes/${classId}/tierCriteria/default`,
                );

                const [sSnap, iSnap, cSnap] = await Promise.all([
                    transaction.get(studentRef),
                    transaction.get(itemRef),
                    transaction.get(classRef),
                ]);

                if (!sSnap.exists || !iSnap.exists)
                    throw new HttpsError("failed-precondition", "학생 또는 상품 정보를 찾을 수 없습니다.");

                const studentData = sSnap.data() || {};
                const itemData = iSnap.data() || {};
                const classData = cSnap.data() || {};
                const categoryData = await loadStoreItemCategory(
                    transaction,
                    classId,
                    itemData,
                );
                const isVipCategory = isVipStoreCategory(categoryData);
                const isRequesterTeacher = ["teacher", "admin"].includes(
                    studentData?.role,
                );
                const isRequesterStoreAdmin =
                    studentData?.permissions?.store_admin === true;
                const isRequesterStoreManager =
                    isRequesterTeacher || isRequesterStoreAdmin;
                const planType = classData.planType || "FREE";

                if (!canUseFeature(globalConfig, planType, "store", "accessible")) {
                    throw new HttpsError("failed-precondition", "현재 요금제에서는 상점 기능을 사용할 수 없습니다.");
                }

                const canBypassSaleStatus =
                    isRequesterStoreManager && (!isVipCategory || isRequesterTeacher);

                if (
                    !canBypassSaleStatus &&
                    !isStoreItemPurchasableByStudents(itemData)
                ) {
                    throw new HttpsError(
                        "failed-precondition",
                        isStoreItemVisibleToStudents(itemData)
                            ? "현재 구매할 수 없는 상품입니다."
                            : "판매중지된 상품입니다.",
                    );
                }

                const shouldReadUsageData = shouldReadUsage(itemData);
                const shouldReadInventoryData = shouldReadInventory();
                const shouldReadTierCriteria =
                    !isRequesterTeacher &&
                    (needsTierCriteriaRead(itemData) ||
                        needsVipTierCriteriaRead(categoryData));

                const [invSnap, uSnap, tierSnap] = await Promise.all([
                    shouldReadInventoryData
                        ? transaction.get(inventoryRef)
                        : Promise.resolve(null),
                    shouldReadUsageData
                        ? transaction.get(usageRef)
                        : Promise.resolve(null),
                    shouldReadTierCriteria
                        ? transaction.get(tierCriteriaRef)
                        : Promise.resolve(null),
                ]);

                const sortedTierCriteria = shouldReadTierCriteria
                    ? sortTierCriteria(tierSnap?.data()?.tiers || [])
                    : [];
                const currencyMeta = getStoreCurrencyMeta(itemData, classData);
                const storeMode = getStoreConsumptionTaxMode(classData);
                const isTicket =
          itemData.itemType === "ticket" ||
          itemData.functionTag === "arcade_ticket";

                if (!isRequesterTeacher) {
                    assertItemTierEligibility({
                        itemData,
                        studentData,
                        sortedTierCriteria,
                    });
                    assertCategoryVipEligibility({
                        categoryData,
                        studentUid: userId,
                        studentData,
                        sortedTierCriteria,
                    });
                }

                const periodIds = shouldReadUsageData ? getUsagePeriodIds() : null;
                const usage = shouldReadUsageData
                    ? normalizeUsageData(
                        uSnap?.exists ? uSnap.data() : {},
                        periodIds,
                    )
                    : null;

                if (shouldReadUsageData) {
                    assertStorePurchaseLimits({
                        itemData,
                        usage,
                        quantity,
                    });
                }

                const taxInfo = calculateItemTaxInfo(
                    itemData,
                    classData?.settings || {},
                    pricingNow,
                );
                const totalCost = Math.round(taxInfo.totalAmount * quantity);
                const currentBalance = getStudentBalanceByField(
                    studentData,
                    currencyMeta.assetField,
                );

                if (currentBalance < totalCost) throw new HttpsError("failed-precondition", "잔액이 부족합니다.");
                if (itemData.stock !== -1 && itemData.stock < quantity)
                    throw new HttpsError("failed-precondition", "재고가 부족합니다.");

                const redemptionRef = db
                    .collection(`classes/${classId}/storeRedemptions`)
                    .doc();
                const nowTs = FieldValue.serverTimestamp();
                const staticNow = admin.firestore.Timestamp.now();

                const studentUpdates = {
                    [`assets.${currencyMeta.assetField}`]: FieldValue.increment(-totalCost),
                    // FIN inventory is valued separately; never add nominal FIN to local itemValue.
                    "assets.itemValue": FieldValue.increment(currencyMeta.currencyType === "usdBalance" ? 0 : totalCost),
                };

                if (isTicket) {
                    studentUpdates["assets.ticket"] = FieldValue.increment(quantity);
                }

                transaction.update(studentRef, studentUpdates);

                if (itemData.stock !== -1)
                    transaction.update(itemRef, {
                        stock: FieldValue.increment(-quantity),
                    });

                if (shouldReadUsageData) {
                    const usagePurchaseUpdate = buildUsagePurchaseUpdate({
                        usage,
                        quantity,
                        periodIds,
                        countTowardTotal: true,
                    });

                    transaction.set(usageRef, usagePurchaseUpdate, { merge: true });
                    stageStoreLimitSummaryRow({
                        transaction,
                        classId,
                        itemId,
                        studentUid: userId,
                        usageData: usagePurchaseUpdate,
                    });
                }

                const expirationMeta = buildStoreItemExpirationMeta(
                    itemData,
                    staticNow.toMillis(),
                );
                const randomBoxConfigSnapshot = buildRandomBoxConfigSnapshot(itemData);

                const acqEntry = buildTrackedInventoryAcquisition({
                    type: "purchase",
                    purchaseId: redemptionRef.id,
                    quantity,
                    acquiredAt: staticNow,
                    unitValue: taxInfo.totalAmount,
                    assetValueApplied: currencyMeta.currencyType !== "usdBalance",
                    ticketCountApplied: isTicket,
                    ...expirationMeta,
                    ...(randomBoxConfigSnapshot ? { randomBoxConfigSnapshot } : {}),
                });

                const commonInvData = {
                    itemId,
                    itemName: itemData.name,
                    itemType: itemData.itemType || "general",
                    functionTag: itemData.functionTag || null,
                    isGiftAllowed: isStoreItemGiftAllowed(itemData),
                    price: taxInfo.totalAmount,
                    currencyType: currencyMeta.currencyType,
                    currencyUnit: currencyMeta.currencyUnit,
                    lastAcquiredDate: nowTs,
                };

                if (invSnap?.exists) {
                    const inventoryData = invSnap.data() || {};
                    const nextAcquisitions = buildInventoryAcquisitionsWithAddedEntry(
                        inventoryData,
                        acqEntry,
                    );
                    transaction.update(inventoryRef, {
                        ...commonInvData,
                        ...buildInventoryExpiryIndexFields({
                            classId,
                            studentUid: userId,
                            inventoryData,
                            acquisitions: nextAcquisitions,
                        }),
                        quantity: FieldValue.increment(quantity),
                        totalAcquired: FieldValue.increment(quantity),
                        acquisitions: FieldValue.arrayUnion(acqEntry),
                    });
                } else {
                    transaction.set(inventoryRef, {
                        ...commonInvData,
                        ...buildInventoryExpiryIndexFields({
                            classId,
                            studentUid: userId,
                            inventoryData: commonInvData,
                            acquisitions: [acqEntry],
                            includeDelete: false,
                        }),
                        quantity,
                        totalAcquired: quantity,
                        totalUsed: 0,
                        createdAt: nowTs,
                        acquisitions: [acqEntry],
                    });
                }

                const logContext = {
                    config: globalConfig,
                    planType,
                    serviceName: "store",
                };
                const isTaxEnabled =
                    canUseFeature(globalConfig, planType, "store", "enableTax") &&
                    storeMode !== "NONE" &&
                    currencyMeta.currencyType === "cash";
                const amountToRecord = isTaxEnabled
                    ? (storeMode === "TAX_ONLY"
                        ? Math.round(taxInfo.taxAmount * quantity)
                        : totalCost)
                    : 0;
                const batchKey = resolveAggregateBatchKey(
                    data,
                    `purchase_item_${userId}_${itemId}_${Date.now()}`,
                );
                const aggregateTaxId = `store_sale_${batchKey}`;
                const taxRecordPointer =
                    amountToRecord > 0 &&
                    !shouldDeferTaxIncomeToPeriodSettlement(
                        classData, "storeConsumptionTax")
                        ? buildTaxRecordPointer("taxIncomes", aggregateTaxId, redemptionRef.id)
                        : null;

                transaction.set(redemptionRef, {
                    studentUid: userId,
                    studentName: studentData.name,
                    itemId,
                    itemName: itemData.name,
                    ...buildStorePurchaseSnapshotFields(itemData, categoryData),
                    quantity,
                    totalAmount: totalCost,
                    currencyType: currencyMeta.currencyType,
                    currencyField: currencyMeta.assetField,
                    currencyUnit: currencyMeta.currencyUnit,
                    storeMode,
                    status: "completed",
                    itemType: itemData.itemType || "general",
                    functionTag: itemData.functionTag || null,
                    isGiftAllowed: isStoreItemGiftAllowed(itemData),
                    pricePerItem: taxInfo.totalAmount,
                    taxAmountPerItem: taxInfo.taxAmount,
                    baseAmountPerItem: taxInfo.baseAmount,
                    taxRate: taxInfo.taxRate,
                    ...expirationMeta,
                    ...(randomBoxConfigSnapshot ? { randomBoxConfigSnapshot } : {}),
                    ...buildRandomBoxTrackingFields(itemData),
                    ...buildTimeSaleRecordFields(taxInfo),
                    completedAt: nowTs,
                    purchaseDailyId: shouldReadUsageData ? periodIds.dailyId : null,
                    purchaseWeeklyId: shouldReadUsageData ? periodIds.weeklyId : null,
                    countsTowardPurchaseLimits: shouldReadUsageData,
                    countsTowardTotalLimit: shouldReadUsageData,
                    totalResetVersion: shouldReadUsageData
                        ? usage.totalResetVersion
                        : 0,
                    ...(taxRecordPointer
                        ? {
                            taxRecord: taxRecordPointer,
                            taxRecordedAt: nowTs,
                            taxCancelled: false,
                        }
                        : {}),
                });

                const taxActivityLogId = stageActivityLog(
                    transaction,
                    classId,
                    {
                        studentUid: userId,
                        type: "expense",
                        category: "store",
                        amount: totalCost,
                        currency: currencyMeta.currencyUnit,
                        currencyType: currencyMeta.currencyType,
                        currencyField: currencyMeta.assetField,
                        description: `${itemData.name} ${quantity}개 구매`,
                        relatedDoc: {
                            collection: "storeRedemptions",
                            id: redemptionRef.id,
                        },
                        taxEvent: amountToRecord > 0 ? {
                            sourceKey: "storeConsumptionTax",
                            taxCategory: "consumption_tax",
                            taxType: "store_revenue",
                            amount: amountToRecord,
                            taxableAmount: Math.round(taxInfo.baseAmount * quantity),
                            taxRate: taxInfo.taxRate,
                        } : null,
                    },
                    logContext,
                );
                if (amountToRecord > 0 && taxActivityLogId) {
                    transaction.set(
                        redemptionRef,
                        { taxActivityLogId },
                        { merge: true },
                    );
                }

                if (amountToRecord > 0) {
                    stageTaxIncome(
                        transaction,
                        classId,
                        {
                            amount: amountToRecord,
                            source: "store",
                            taxType: "store_revenue",
                            studentUid: userId,
                            description: `상점 판매 합산 기록 (${itemData.name})`,
                            breakdown: {
                                baseAmount: Math.round(taxInfo.baseAmount * quantity),
                                taxAmount: Math.round(taxInfo.taxAmount * quantity),
                                taxRate: taxInfo.taxRate,
                            },
                        },
                        userId,
                        {
                            ...logContext,
                            classData,
                            sourceKey: "storeConsumptionTax",
                            customId: aggregateTaxId,
                            aggregateMeta: {
                                group: "store_sale",
                                batchKey,
                                pageKey: "store",
                                actorUid: userId,
                                actorName: studentData.name || null,
                                mode: "purchase_store_item",
                            },
                            detailLines: [
                                {
                                    id: redemptionRef.id,
                                    amount: amountToRecord,
                                    source: "store",
                                    taxType: "store_revenue",
                                    description: `상점 판매 - ${itemData.name} (${quantity}개)`,
                                    studentUid: userId,
                                    studentName: studentData.name || null,
                                    relatedDoc: {
                                        collection: "storeRedemptions",
                                        id: redemptionRef.id,
                                    },
                                    externalId: redemptionRef.id,
                                    meta: {
                                        storeMode,
                                        quantity,
                                    },
                                },
                            ],
                            detailCollection: TAX_LINE_COLLECTION,
                        },
                    );
                }

                return {
                    success: true,
                    purchaseId: redemptionRef.id,
                    newBalance: currentBalance - totalCost,
                    currencyType: currencyMeta.currencyType,
                    totalCost,
                    taxAmount: currencyMeta.currencyType === "cash" && isTaxEnabled
                        ? Math.min(totalCost, Math.round(taxInfo.taxAmount * quantity * 100) / 100)
                        : 0,
                };
            });
        } catch (error) {
            if (error instanceof HttpsError) throw error;
            console.error("Purchase Error:", error);
            throw new HttpsError("internal", error.message);
        }
    },
);

/**
 */
exports.getItemPurchaseInfo = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, itemId } = data;
        const [sSnap, iSnap, cSnap, uSnap] = await Promise.all([
            db.doc(`classes/${classId}/students/${auth.uid}`).get(),
            db.doc(`classes/${classId}/storeItems/${itemId}`).get(),
            db.doc(`classes/${classId}`).get(),
            db
                .doc(`classes/${classId}/students/${auth.uid}/storeUsage/${itemId}`)
                .get(),
        ]);

        const itemData = iSnap.data();
        const classData = cSnap.data() || {};
        const currencyMeta = getStoreCurrencyMeta(itemData, classData);
        const periodIds = getUsagePeriodIds();
        const usageData = normalizeUsageData(uSnap.data() || {}, periodIds);
        const currentDaily = usageData.daily;
        const currentWeekly = usageData.weekly;
        const currentTotal = usageData.totalPurchased;
        const taxInfo = calculateItemTaxInfo(
            itemData,
            classData?.settings || {},
            new Date(),
        );
        const currentBalance = getStudentBalanceByField(
            sSnap.data() || {},
            currencyMeta.assetField,
        );

        return {
            item: {
                ...itemData,
                id: itemId,
                saleStatus: normalizeStoreItemSaleStatus(itemData),
                isActive: isStoreItemVisibleToStudents(itemData),
            },
            student: {
                currentBalance,
                currencyType: currencyMeta.currencyType,
                currencyField: currencyMeta.assetField,
            },
            pricing: {
                ...taxInfo,
                totalCost: taxInfo.totalAmount,
                currencyUnit: currencyMeta.currencyUnit,
                currencyType: currencyMeta.currencyType,
                currencyField: currencyMeta.assetField,
                originalPrice: taxInfo.originalPrice,
                timeSaleApplied: taxInfo.saleApplied,
                timeSaleSalePrice: taxInfo.salePrice,
                timeSaleDiscountPercent: taxInfo.discountPercent,
                timeSaleStartAt: taxInfo.timeSaleStartAt,
                timeSaleEndAt: taxInfo.timeSaleEndAt,
            },
            limits: {
                dailyLimit: itemData.dailyLimit || null,
                weeklyLimit: itemData.weeklyLimit || null,
                totalLimit: itemData.totalLimit || null,
                currentDaily,
                currentWeekly,
                currentTotal,
                remainingDaily: itemData.dailyLimit
                    ? Math.max(0, itemData.dailyLimit - currentDaily)
                    : 999,
                remainingWeekly: itemData.weeklyLimit
                    ? Math.max(0, itemData.weeklyLimit - currentWeekly)
                    : 999,
                remainingTotal: itemData.totalLimit
                    ? Math.max(0, itemData.totalLimit - currentTotal)
                    : 999,
            },
        };
    },
);

/**
 */
exports.cancelStorePurchase = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, studentUid, purchaseId, reason } = data;
        const adminUid = auth.uid;
        if (!classId || !studentUid || !purchaseId) {
            throw new HttpsError(
                "invalid-argument",
                "필수 값(classId, studentUid, purchaseId)이 올바르지 않습니다.",
            );
        }

        const callerData = await assertStoreManagerPermission(classId, adminUid);
        const globalConfig = await getGlobalConfig();
        const classSnap = await db.doc(`classes/${classId}`).get();
        const classData = classSnap.data() || {};
        const planType = classData.planType || "FREE";
        const context = { config: globalConfig, planType, serviceName: "store" };
        const batchKey = resolveAggregateBatchKey(
            data,
            `cancel_store_${adminUid}_${purchaseId}_${Date.now()}`,
        );

        return await db.runTransaction(async (transaction) => {
            const result = await cancelStorePurchaseInTransaction({
                transaction,
                classId,
                studentUid,
                purchaseId,
                reason,
                adminUid,
                context,
            });

            let taxAggregate = {
                expenseAggregateId: null,
                incomeAggregateId: null,
            };
            if (result.taxReversal?.amount > 0) {
                const incomeToExpenseLines = [];
                const expenseToIncomeLines = [];
                if (result.taxReversal.direction === "income_to_expense") {
                    incomeToExpenseLines.push(result.taxReversal.line);
                } else if (result.taxReversal.direction === "expense_to_income") {
                    expenseToIncomeLines.push(result.taxReversal.line);
                }

                taxAggregate = stageStoreCancellationTaxReversal({
                    transaction,
                    classId,
                    adminUid,
                    adminName: callerData?.name || null,
                    batchKey,
                    context,
                    incomeToExpenseLines,
                    expenseToIncomeLines,
                });
            }

            return {
                success: true,
                message: "환불 처리가 완료되었습니다.",
                ...result,
                ...taxAggregate,
            };
        });
    },
);

exports.markStorePurchaseAsRedeemed = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, studentUid, purchaseId } = data || {};
        const adminUid = auth.uid;
        if (!classId || !studentUid || !purchaseId) {
            throw new HttpsError(
                "invalid-argument",
                "필수 값(classId, studentUid, purchaseId)이 올바르지 않습니다.",
            );
        }

        await assertStoreManagerPermission(classId, adminUid);

        return await db.runTransaction(async (transaction) => {
            const result = await redeemStorePurchaseInTransaction({
                transaction,
                classId,
                studentUid,
                purchaseId,
                adminUid,
            });

            return {
                success: true,
                message: "상품 지급이 완료되었습니다.",
                ...result,
            };
        });
    },
);

exports.hardDeleteStorePurchase = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { classId, purchaseId, studentUid } = request.data || {};

        if (!classId || !purchaseId) {
            throw new HttpsError(
                "invalid-argument",
                "classId and purchaseId are required.",
            );
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        return await db.runTransaction(async (transaction) => {
            const redemptionRef = db.doc(
                `classes/${classId}/storeRedemptions/${purchaseId}`,
            );
            const redemptionSnap = await transaction.get(redemptionRef);

            if (!redemptionSnap.exists) {
                throw new HttpsError(
                    "not-found",
                    "The store purchase record does not exist.",
                );
            }

            const redemptionData = redemptionSnap.data() || {};
            const normalizedStatus = String(redemptionData.status || "")
                .trim()
                .toLowerCase();
            const hasRecordedLedgerImpact =
                normalizedStatus === "completed" ||
                normalizedStatus === "redeemed" ||
                normalizedStatus === "cancelled" ||
                Boolean(
                    redemptionData.taxRecord?.id ||
                        redemptionData.completedAt ||
                        redemptionData.redeemedAt ||
                        redemptionData.cancelledAt,
                );

            if (hasRecordedLedgerImpact) {
                throw new HttpsError(
                    "failed-precondition",
                    "국고나 자산에 반영된 구매 내역은 영구 삭제할 수 없습니다. 환불/취소를 사용해 주세요.",
                );
            }
            if (
                studentUid &&
                String(redemptionData.studentUid || "") !== String(studentUid)
            ) {
                throw new HttpsError(
                    "failed-precondition",
                    "The store purchase record does not match the selected student.",
                );
            }

            transaction.delete(redemptionRef);

            return {
                success: true,
                message: "Store purchase record deleted.",
            };
        });
    },
);

exports.bulkCancelStorePurchases = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, reason = "", purchases } = data || {};
        const adminUid = auth.uid;

        if (!classId || !Array.isArray(purchases) || purchases.length === 0) {
            throw new HttpsError(
                "invalid-argument",
                "필수 값(classId, purchases)이 올바르지 않습니다.",
            );
        }

        const callerData = await assertStoreManagerPermission(classId, adminUid);
        const globalConfig = await getGlobalConfig();
        const classSnap = await db.doc(`classes/${classId}`).get();
        const classData = classSnap.data() || {};
        const planType = classData.planType || "FREE";
        const context = { config: globalConfig, planType, serviceName: "store" };
        const batchKey = resolveAggregateBatchKey(
            data,
            `bulk_cancel_store_${adminUid}_${Date.now()}`,
        );

        const normalizedPurchases = purchases
            .map((item) => ({
                purchaseId: String(item?.purchaseId || "").trim(),
                studentUid: String(item?.studentUid || "").trim(),
            }))
            .filter((item) => item.purchaseId && item.studentUid);

        if (normalizedPurchases.length === 0) {
            throw new HttpsError(
                "invalid-argument",
                "환불할 구매 항목이 비어 있습니다.",
            );
        }

        const results = {
            total: normalizedPurchases.length,
            success: [],
            failed: [],
        };
        const expenseAggregateIds = [];
        const incomeAggregateIds = [];
        for (const target of normalizedPurchases) {
            try {
                const result = await db.runTransaction(async (transaction) => {
                    const refund = await cancelStorePurchaseInTransaction({
                        transaction,
                        classId,
                        studentUid: target.studentUid,
                        purchaseId: target.purchaseId,
                        reason,
                        adminUid,
                        context,
                    });
                    const reversal = refund.taxReversal;
                    const aggregate = stageStoreCancellationTaxReversal({
                        transaction,
                        classId,
                        adminUid,
                        adminName: callerData?.name || null,
                        batchKey: `${batchKey}_${target.purchaseId}`,
                        context,
                        incomeToExpenseLines: reversal?.direction === "income_to_expense" ? [reversal.line] : [],
                        expenseToIncomeLines: reversal?.direction === "expense_to_income" ? [reversal.line] : [],
                    });
                    return { ...refund, ...aggregate };
                });
                if (result.expenseAggregateId) expenseAggregateIds.push(result.expenseAggregateId);
                if (result.incomeAggregateId) incomeAggregateIds.push(result.incomeAggregateId);

                results.success.push({
                    purchaseId: target.purchaseId,
                    studentUid: target.studentUid,
                    taxDirection: result.taxReversal?.direction || null,
                    ...result,
                });
            } catch (error) {
                results.failed.push({
                    purchaseId: target.purchaseId,
                    studentUid: target.studentUid,
                    message: error?.message || "환불 처리 중 오류가 발생했습니다.",
                });
            }
        }

        return {
            // Keep the existing successful-item array contract separate from
            // the overall boolean, including partial failures.
            allSucceeded: results.failed.length === 0,
            successCount: results.success.length,
            failedCount: results.failed.length,
            message:
                results.failed.length === 0
                    ? `${results.success.length}건 환불이 완료되었습니다.`
                    : `${results.success.length}건 완료, ${results.failed.length}건 실패`,
            expenseAggregateId: expenseAggregateIds.length === 1 ? expenseAggregateIds[0] : null,
            incomeAggregateId: incomeAggregateIds.length === 1 ? incomeAggregateIds[0] : null,
            expenseAggregateIds,
            incomeAggregateIds,
            ...results,
        };
    },
);

/**
 */
exports.useItem = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { classId, itemId, quantity = 1, note = "" } = data;
    const userId = auth.uid;

    try {
        return await db.runTransaction(async (transaction) => {
            return await useItemInTransaction({
                transaction,
                classId,
                studentUid: userId,
                itemId,
                quantity,
                note,
            });
        });
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }
});

exports.adminUseItem = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const {
        classId,
        targetStudentUid,
        itemId,
        quantity = 1,
        note = "",
    } = data || {};
    const adminUid = auth.uid;

    if (!classId || !targetStudentUid || !itemId) {
        throw new HttpsError("invalid-argument", "필수 값이 누락되었습니다.");
    }

    try {
        const callerData = await assertStoreManagerPermission(classId, adminUid);

        return await db.runTransaction(async (transaction) => {
            return await useItemInTransaction({
                transaction,
                classId,
                studentUid: targetStudentUid,
                itemId,
                quantity,
                note,
                usedBy: {
                    uid: adminUid,
                    name: callerData?.name || "",
                    role: callerData?.role || "",
                },
            });
        });
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }
});

exports.adminDeleteInventoryItem = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const {
            classId,
            targetStudentUid,
            itemId,
            quantity = 1,
            reason = "",
        } = data || {};
        const adminUid = auth.uid;

        if (!classId || !targetStudentUid || !itemId) {
            throw new HttpsError("invalid-argument", "필수 값이 누락되었습니다.");
        }

        try {
            const callerData = await assertStoreManagerPermission(classId, adminUid);

            return await db.runTransaction(async (transaction) => {
                return await deleteInventoryItemInTransaction({
                    transaction,
                    classId,
                    studentUid: targetStudentUid,
                    itemId,
                    quantity,
                    reason,
                    deletedBy: {
                        uid: adminUid,
                        name: callerData?.name || "",
                        role: callerData?.role || "",
                    },
                });
            });
        } catch (error) {
            throw new HttpsError("internal", error.message);
        }
    },
);

/**
 */
exports.giftItem = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { classId, recipientUid, itemId, quantity = 1, message = "" } = data;
    const senderUid = auth.uid;

    if (senderUid === recipientUid)
        throw new Error("본인에게는 선물할 수 없습니다.");

    try {
        return await db.runTransaction(async (transaction) => {
            const senderRef = db.doc(`classes/${classId}/students/${senderUid}`);
            const recipientRef = db.doc(
                `classes/${classId}/students/${recipientUid}`,
            );
            const senderInvRef = db.doc(
                `classes/${classId}/students/${senderUid}/inventory/${itemId}`,
            );
            const recipientInvRef = db.doc(
                `classes/${classId}/students/${recipientUid}/inventory/${itemId}`,
            );
            const itemRef = db.doc(`classes/${classId}/storeItems/${itemId}`);

            const [sSnap, sInvSnap, rInvSnap, itemSnap] = await Promise.all([
                transaction.get(senderRef),
                transaction.get(senderInvRef),
                transaction.get(recipientInvRef),
                transaction.get(itemRef),
            ]);

            if (!sInvSnap.exists) throw new Error("보낸 학생의 보유 아이템을 찾을 수 없습니다.");

            const sInvData = sInvSnap.data();
            const isGiftAllowed = itemSnap.exists
                ? isStoreItemGiftAllowed(itemSnap.data())
                : sInvData?.isGiftAllowed !== false;

            if (!isGiftAllowed) {
                throw new Error("이 상품은 선물할 수 없도록 설정되어 있습니다.");
            }

            const isTicket =
        sInvData.itemType === "ticket" ||
        sInvData.functionTag === "arcade_ticket";

            const allAcqs = Array.isArray(sInvData.acquisitions)
                ? sInvData.acquisitions
                : [];
            const purchaseAcqs = allAcqs.filter((a) => a.type === "purchase");
            const giftAcqs = allAcqs.filter((a) => a.type !== "purchase");
            const normalizedPurchaseAcqs = sortTrackedInventoryAcquisitions(
                purchaseAcqs.map((acq) =>
                    normalizeAcquisitionForAccounting(acq, sInvData),
                ),
            );

            const totalGiftable = normalizedPurchaseAcqs.reduce(
                (acc, cur) =>
                    !isTrackedInventoryAcquisitionExpired(cur)
                        ? acc + (Number(cur.quantity) || 0)
                        : acc,
                0,
            );
            if (totalGiftable < quantity)
                throw new Error(
                    "선물 가능한 수량이 부족합니다. (직접 구매한 수량만 선물할 수 있습니다.)",
                );

            let remainingToGift = quantity;
            const updatedPurchaseAcqs = [];
            const newGiftAcqs = [];
            const giftAcquiredAt = admin.firestore.Timestamp.now();
            for (const acq of normalizedPurchaseAcqs) {
                if (isTrackedInventoryAcquisitionExpired(acq)) {
                    updatedPurchaseAcqs.push(acq);
                    continue;
                }

                if (remainingToGift <= 0) {
                    updatedPurchaseAcqs.push(acq);
                    continue;
                }
                const availableQuantity = Number(acq.quantity || 0);
                const take = Math.min(remainingToGift, availableQuantity);
                remainingToGift -= take;

                const {
                    purchaseId: originalPurchaseId,
                    sourcePurchaseId: inheritedSourcePurchaseId,
                    ...giftAcquisitionBase
                } = acq;

                newGiftAcqs.push(
                    buildTrackedInventoryAcquisition({
                        ...giftAcquisitionBase,
                        type: "gift",
                        ...(inheritedSourcePurchaseId || originalPurchaseId
                            ? {
                                sourcePurchaseId:
                                    inheritedSourcePurchaseId || originalPurchaseId,
                            }
                            : {}),
                        senderUid,
                        senderName: sSnap.data().name,
                        message: message || "",
                        acquiredAt: giftAcquiredAt,
                        quantity: take,
                    }),
                );

                if (availableQuantity - take > 0)
                    updatedPurchaseAcqs.push({
                        ...acq,
                        quantity: availableQuantity - take,
                    });
            }

            const itemPrice = Number(sInvData.price || 0);
            const totalGiftValue = itemPrice * quantity;
            const totalGiftAssetValue = sInvData.currencyType === "usdBalance" ? 0 : totalGiftValue;

            const finalSenderAcqs = [...updatedPurchaseAcqs, ...giftAcqs];
            if (finalSenderAcqs.length === 0) {
                transaction.delete(senderInvRef);
            } else {
                transaction.update(senderInvRef, {
                    ...buildInventoryExpiryIndexFields({
                        classId,
                        studentUid: senderUid,
                        inventoryData: sInvData,
                        acquisitions: finalSenderAcqs,
                    }),
                    quantity: FieldValue.increment(-quantity),
                    acquisitions: finalSenderAcqs,
                });
            }

            const senderUpdate = {
                "assets.itemValue": FieldValue.increment(-totalGiftAssetValue),
            };
            if (isTicket) {
                senderUpdate["assets.ticket"] = FieldValue.increment(-quantity);
            }
            transaction.update(senderRef, senderUpdate);

            if (rInvSnap.exists) {
                const recipientInvData = rInvSnap.data() || {};
                const recipientAcquisitions = [
                    ...(Array.isArray(recipientInvData.acquisitions)
                        ? recipientInvData.acquisitions
                        : []),
                    ...newGiftAcqs,
                ];
                transaction.update(recipientInvRef, {
                    ...buildInventoryExpiryIndexFields({
                        classId,
                        studentUid: recipientUid,
                        inventoryData: recipientInvData,
                        acquisitions: recipientAcquisitions,
                    }),
                    isGiftAllowed,
                    price: itemPrice,
                    itemType: sInvData.itemType || "general",
                    functionTag: sInvData.functionTag || null,
                    currencyType: sInvData.currencyType || "cash",
                    currencyUnit: sInvData.currencyUnit || null,
                    lastAcquiredDate: FieldValue.serverTimestamp(),
                    totalAcquired: FieldValue.increment(quantity),
                    quantity: FieldValue.increment(quantity),
                    acquisitions: FieldValue.arrayUnion(...newGiftAcqs),
                });
            } else {
                const newRecipientInvData = {
                    itemId,
                    itemName: sInvData.itemName,
                    price: itemPrice,
                    itemType: sInvData.itemType || "general",
                    functionTag: sInvData.functionTag || null,
                    isGiftAllowed,
                    currencyType: sInvData.currencyType || "cash",
                    currencyUnit: sInvData.currencyUnit || null,
                };
                transaction.set(recipientInvRef, {
                    ...newRecipientInvData,
                    ...buildInventoryExpiryIndexFields({
                        classId,
                        studentUid: recipientUid,
                        inventoryData: newRecipientInvData,
                        acquisitions: newGiftAcqs,
                        includeDelete: false,
                    }),
                    itemId,
                    itemName: sInvData.itemName,
                    price: itemPrice,
                    quantity: quantity,
                    itemType: sInvData.itemType || "general",
                    functionTag: sInvData.functionTag || null,
                    isGiftAllowed,
                    currencyType: sInvData.currencyType || "cash",
                    currencyUnit: sInvData.currencyUnit || null,
                    lastAcquiredDate: FieldValue.serverTimestamp(),
                    totalAcquired: quantity,
                    totalUsed: 0,
                    acquisitions: newGiftAcqs,
                    createdAt: FieldValue.serverTimestamp(),
                });
            }

            const recipientUpdate = {
                "assets.itemValue": FieldValue.increment(totalGiftAssetValue),
            };
            if (isTicket) {
                recipientUpdate["assets.ticket"] = FieldValue.increment(quantity);
            }
            transaction.update(recipientRef, recipientUpdate);

            stageNotification(transaction, classId, {
                uid: recipientUid,
                title: "선물을 받았어요",
                message: `${sSnap.data().name}님이 ${sInvData.itemName} ${quantity}개를 선물했어요.`,
                type: "store_gift_received",
                path: "/store",
                priority: "medium",
                metadata: {
                    senderUid,
                    senderName: sSnap.data().name || "",
                    itemId,
                    itemName: sInvData.itemName || "",
                    quantity,
                    message: message || "",
                },
            });

            return { success: true };
        });
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }
});

/**
 */
exports.purchaseStoreCart = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, items } = data || {};
        if (!classId || !Array.isArray(items) || items.length === 0) {
            throw new HttpsError("invalid-argument", "필수 값(classId, items)이 올바르지 않습니다.");
        }

        const userId = auth.uid;
        const globalConfig = await getGlobalConfig();

        try {
            return await runFinancialRequest({
                db, classId, actorUid: auth.uid,
                operation: "store_cart", clientRequestId: data.clientRequestId,
                payload: { items: items.map(({ itemId, quantity }) => ({ itemId, quantity })) },
            }, async (transaction) => {
                const pricingNow = new Date();
                const studentRef = db.doc(`classes/${classId}/students/${userId}`);
                const classRef = db.doc(`classes/${classId}`);
                const tierCriteriaRef = db.doc(
                    `classes/${classId}/tierCriteria/default`,
                );
                const [sSnap, cSnap] = await Promise.all([
                    transaction.get(studentRef),
                    transaction.get(classRef),
                ]);

                if (!sSnap.exists) throw new HttpsError("failed-precondition", "학생 정보를 찾을 수 없습니다.");
                const studentData = sSnap.data() || {};
                const classData = cSnap.data() || {};
                const planType = classData.planType || "FREE";
                const logContext = {
                    config: globalConfig,
                    planType,
                    serviceName: "store",
                };
                const storeMode = getStoreConsumptionTaxMode(classData);
                const isTaxFeatureEnabled =
                    canUseFeature(globalConfig, planType, "store", "enableTax") &&
                    storeMode !== "NONE";
                const batchKey = resolveAggregateBatchKey(
                    data,
                    `purchase_cart_${userId}_${Date.now()}`,
                );
                const aggregateTaxId = `store_cart_sale_${batchKey}`;
                const isRequesterTeacher = ["teacher", "admin"].includes(
                    studentData?.role,
                );
                const isRequesterStoreAdmin =
                    studentData?.permissions?.store_admin === true;
                const isRequesterStoreManager =
                    isRequesterTeacher || isRequesterStoreAdmin;
                const periodIds = getUsagePeriodIds();
                const shouldReadInventoryData = shouldReadInventory();

                let totalCartCost = 0;
                const totalCostByCurrencyField = {};
                const purchaseResults = [];
                const cartTaxLines = [];
                let cartTaxTotal = 0;
                let shouldReadTierCriteria = false;
                const preloadedItems = [];

                for (const cartItem of items) {
                    const itemId = cartItem?.itemId;
                    const quantity = Math.floor(Number(cartItem?.quantity));
                    if (!itemId || quantity <= 0) {
                        throw new HttpsError("invalid-argument", "장바구니 항목 형식이 올바르지 않습니다.");
                    }

                    const itemRef = db.doc(`classes/${classId}/storeItems/${itemId}`);
                    const usageRef = db.doc(
                        `classes/${classId}/students/${userId}/storeUsage/${itemId}`,
                    );
                    const inventoryRef = db.doc(
                        `classes/${classId}/students/${userId}/inventory/${itemId}`,
                    );

                    const iSnap = await transaction.get(itemRef);

                    if (!iSnap.exists)
                        throw new HttpsError("failed-precondition", `상품 정보를 찾을 수 없습니다: ${itemId}`);
                    const itemData = iSnap.data();
                    const categoryData = await loadStoreItemCategory(
                        transaction,
                        classId,
                        itemData,
                    );
                    const isVipCategory = isVipStoreCategory(categoryData);
                    const currencyMeta = getStoreCurrencyMeta(itemData, classData);
                    const shouldReadUsageData = shouldReadUsage(itemData);
                    const canBypassSaleStatus =
                        isRequesterStoreManager &&
                        (!isVipCategory || isRequesterTeacher);

                    if (
                        !canBypassSaleStatus &&
                        !isStoreItemPurchasableByStudents(itemData)
                    ) {
                        throw new HttpsError(
                            "failed-precondition",
                            `[${itemData.name}] ${
                                isStoreItemVisibleToStudents(itemData)
                                    ? "현재 구매할 수 없는 상품입니다."
                                    : "판매중지된 상품입니다."
                            }`,
                        );
                    }

                    if (
                        !isRequesterTeacher &&
                        (needsTierCriteriaRead(itemData) ||
                            needsVipTierCriteriaRead(categoryData))
                    ) {
                        shouldReadTierCriteria = true;
                    }

                    preloadedItems.push({
                        itemRef,
                        usageRef,
                        inventoryRef,
                        itemData,
                        categoryData,
                        quantity,
                        currencyMeta,
                        shouldReadUsageData,
                    });
                }
                const tierSnap = shouldReadTierCriteria
                    ? await transaction.get(tierCriteriaRef)
                    : null;
                const sortedTierCriteria = shouldReadTierCriteria
                    ? sortTierCriteria(tierSnap?.data()?.tiers || [])
                    : [];

                for (const itemPlan of preloadedItems) {
                    const {
                        itemRef,
                        usageRef,
                        inventoryRef,
                        itemData,
                        categoryData,
                        quantity,
                        currencyMeta,
                        shouldReadUsageData,
                    } = itemPlan;
                    const [uSnap, invSnap] = await Promise.all([
                        shouldReadUsageData
                            ? transaction.get(usageRef)
                            : Promise.resolve(null),
                        shouldReadInventoryData
                            ? transaction.get(inventoryRef)
                            : Promise.resolve(null),
                    ]);

                    if (!isRequesterTeacher) {
                        assertItemTierEligibility({
                            itemData,
                            studentData,
                            sortedTierCriteria,
                        });
                        assertCategoryVipEligibility({
                            categoryData,
                            studentUid: userId,
                            studentData,
                            sortedTierCriteria,
                        });
                    }

                    const usage = shouldReadUsageData
                        ? normalizeUsageData(
                            uSnap?.exists ? uSnap.data() : {},
                            periodIds,
                        )
                        : null;

                    if (shouldReadUsageData) {
                        assertStorePurchaseLimits({
                            itemData,
                            usage,
                            quantity,
                        });
                    }
                    if (itemData.stock !== -1 && itemData.stock < quantity)
                        throw new HttpsError("failed-precondition", `[${itemData.name}] 재고가 부족합니다.`);

                    const taxInfo = calculateItemTaxInfo(
                        itemData,
                        classData?.settings || {},
                        pricingNow,
                    );
                    const itemTotalCost = Math.round(taxInfo.totalAmount * quantity);
                    totalCartCost += itemTotalCost;
                    totalCostByCurrencyField[currencyMeta.assetField] =
            Number(totalCostByCurrencyField[currencyMeta.assetField] || 0) +
            itemTotalCost;

                    purchaseResults.push({
                        itemRef,
                        usageRef,
                        inventoryRef,
                        invSnap,
                        invExists: invSnap?.exists === true,
                        itemData,
                        categoryData,
                        quantity,
                        taxInfo,
                        itemTotalCost,
                        currencyMeta,
                        usage,
                        shouldReadUsageData,
                    });
                }

                for (const [assetField, requiredAmount] of Object.entries(
                    totalCostByCurrencyField,
                )) {
                    const currentBalance = getStudentBalanceByField(
                        studentData,
                        assetField,
                    );
                    if (currentBalance < requiredAmount) {
                        const shortageUnit =
              assetField === "usdBalance"
                  ? "FIN"
                  : assetField === "missionToken"
                      ? MISSION_TOKEN_UNIT
                      : resolveClassCurrencyUnit(classData);
                        throw new HttpsError("failed-precondition", `${shortageUnit} 잔액이 부족합니다.`);
                    }
                }

                const nowTs = FieldValue.serverTimestamp();
                const staticNow = admin.firestore.Timestamp.now();

                let totalItemValueIncrement = 0;
                let totalTicketIncrement = 0;

                for (const res of purchaseResults) {
                    const {
                        itemRef,
                        usageRef,
                        inventoryRef,
                        invSnap,
                        invExists,
                        itemData,
                        categoryData,
                        quantity,
                        taxInfo,
                        itemTotalCost,
                        currencyMeta,
                        usage,
                        shouldReadUsageData,
                    } = res;
                    const itemId = itemRef.id;
                    const redemptionRef = db
                        .collection(`classes/${classId}/storeRedemptions`)
                        .doc();
                    const isTicket =
            itemData.itemType === "ticket" ||
            itemData.functionTag === "arcade_ticket";

                    if (itemData.stock !== -1)
                        transaction.update(itemRef, {
                            stock: FieldValue.increment(-quantity),
                        });
                    if (shouldReadUsageData) {
                        const usagePurchaseUpdate = buildUsagePurchaseUpdate({
                            usage,
                            quantity,
                            periodIds,
                            countTowardTotal: true,
                        });

                        transaction.set(usageRef, usagePurchaseUpdate, { merge: true });
                        stageStoreLimitSummaryRow({
                            transaction,
                            classId,
                            itemId,
                            studentUid: userId,
                            usageData: usagePurchaseUpdate,
                        });
                    }

                    const expirationMeta = buildStoreItemExpirationMeta(
                        itemData,
                        staticNow.toMillis(),
                    );
                    const randomBoxConfigSnapshot = buildRandomBoxConfigSnapshot(itemData);
                    const commonInvData = {
                        itemId,
                        itemName: itemData.name,
                        itemType: itemData.itemType || "general",
                        functionTag: itemData.functionTag || null,
                        isGiftAllowed: isStoreItemGiftAllowed(itemData),
                        price: taxInfo.totalAmount,
                        currencyType: currencyMeta.currencyType,
                        currencyUnit: currencyMeta.currencyUnit,
                        lastAcquiredDate: nowTs,
                    };

                    const acqEntry = buildTrackedInventoryAcquisition({
                        type: "purchase",
                        purchaseId: redemptionRef.id,
                        quantity,
                        acquiredAt: staticNow,
                        unitValue: taxInfo.totalAmount,
                        assetValueApplied: currencyMeta.currencyType !== "usdBalance",
                        ticketCountApplied: isTicket,
                        ...expirationMeta,
                        ...(randomBoxConfigSnapshot ? { randomBoxConfigSnapshot } : {}),
                    });

                    if (invExists) {
                        const inventoryData = invSnap?.data?.() || {};
                        const nextAcquisitions = buildInventoryAcquisitionsWithAddedEntry(
                            inventoryData,
                            acqEntry,
                        );
                        transaction.update(inventoryRef, {
                            ...commonInvData,
                            ...buildInventoryExpiryIndexFields({
                                classId,
                                studentUid: userId,
                                inventoryData,
                                acquisitions: nextAcquisitions,
                            }),
                            quantity: FieldValue.increment(quantity),
                            totalAcquired: FieldValue.increment(quantity),
                            acquisitions: FieldValue.arrayUnion(acqEntry),
                        });
                    } else {
                        transaction.set(inventoryRef, {
                            ...commonInvData,
                            ...buildInventoryExpiryIndexFields({
                                classId,
                                studentUid: userId,
                                inventoryData: commonInvData,
                                acquisitions: [acqEntry],
                                includeDelete: false,
                            }),
                            quantity,
                            totalAcquired: quantity,
                            totalUsed: 0,
                            createdAt: nowTs,
                            acquisitions: [acqEntry],
                        });
                    }

                    const amountToRecord =
                        isTaxFeatureEnabled && currencyMeta.currencyType === "cash"
                            ? (storeMode === "TAX_ONLY"
                                ? Math.round(taxInfo.taxAmount * quantity)
                                : itemTotalCost)
                            : 0;
                    const taxRecordPointer =
                        amountToRecord > 0 &&
                        !shouldDeferTaxIncomeToPeriodSettlement(
                            classData, "storeConsumptionTax")
                            ? buildTaxRecordPointer("taxIncomes", aggregateTaxId, redemptionRef.id)
                            : null;

                    transaction.set(redemptionRef, {
                        studentUid: userId,
                        studentName: studentData.name,
                        itemId,
                        itemName: itemData.name,
                        ...buildStorePurchaseSnapshotFields(itemData, categoryData),
                        quantity,
                        totalAmount: itemTotalCost,
                        currencyType: currencyMeta.currencyType,
                        currencyField: currencyMeta.assetField,
                        currencyUnit: currencyMeta.currencyUnit,
                        storeMode,
                        status: "completed",
                        itemType: itemData.itemType || "general",
                        functionTag: itemData.functionTag || null,
                        isGiftAllowed: isStoreItemGiftAllowed(itemData),
                        pricePerItem: taxInfo.totalAmount,
                        taxAmountPerItem: taxInfo.taxAmount,
                        baseAmountPerItem: taxInfo.baseAmount,
                        taxRate: taxInfo.taxRate,
                        ...expirationMeta,
                        ...(randomBoxConfigSnapshot ? { randomBoxConfigSnapshot } : {}),
                        ...buildRandomBoxTrackingFields(itemData),
                        ...buildTimeSaleRecordFields(taxInfo),
                        completedAt: nowTs,
                        purchaseDailyId: shouldReadUsageData ? periodIds.dailyId : null,
                        purchaseWeeklyId: shouldReadUsageData ? periodIds.weeklyId : null,
                        countsTowardPurchaseLimits: shouldReadUsageData,
                        countsTowardTotalLimit: shouldReadUsageData,
                        totalResetVersion: shouldReadUsageData
                            ? usage.totalResetVersion
                            : 0,
                        ...(taxRecordPointer
                            ? {
                                taxRecord: taxRecordPointer,
                                taxRecordedAt: nowTs,
                                taxCancelled: false,
                            }
                            : {}),
                    });

                    if (amountToRecord > 0) {
                        cartTaxTotal += amountToRecord;
                        cartTaxLines.push({
                            id: redemptionRef.id,
                            amount: amountToRecord,
                            source: "store",
                            taxType: "store_revenue",
                            description: `장바구니 구매 - ${itemData.name} (${quantity}개)`,
                            studentUid: userId,
                            studentName: studentData.name || null,
                            relatedDoc: {
                                collection: "storeRedemptions",
                                id: redemptionRef.id,
                            },
                            externalId: redemptionRef.id,
                            meta: {
                                storeMode,
                                quantity,
                            },
                        });
                    }

                    const taxActivityLogId = stageActivityLog(
                        transaction,
                        classId,
                        {
                            studentUid: userId,
                            type: "expense",
                            category: "store",
                            amount: itemTotalCost,
                            currency: currencyMeta.currencyUnit,
                            currencyType: currencyMeta.currencyType,
                            currencyField: currencyMeta.assetField,
                            description: `${itemData.name} ${quantity}개 구매(장바구니)`,
                            relatedDoc: {
                                collection: "storeRedemptions",
                                id: redemptionRef.id,
                            },
                            taxEvent: amountToRecord > 0 ? {
                                sourceKey: "storeConsumptionTax",
                                taxCategory: "consumption_tax",
                                taxType: "store_revenue",
                                amount: amountToRecord,
                                taxableAmount: Math.round(taxInfo.baseAmount * quantity),
                                taxRate: taxInfo.taxRate,
                            } : null,
                        },
                        logContext,
                    );
                    if (amountToRecord > 0 && taxActivityLogId) {
                        transaction.set(
                            redemptionRef,
                            { taxActivityLogId },
                            { merge: true },
                        );
                    }

                    if (currencyMeta.currencyType !== "usdBalance") totalItemValueIncrement += itemTotalCost;
                    if (isTicket) totalTicketIncrement += quantity;
                }

                if (cartTaxTotal > 0) {
                    stageTaxIncome(
                        transaction,
                        classId,
                        {
                            amount: cartTaxTotal,
                            source: "store",
                            taxType: "store_revenue",
                            studentUid: userId,
                            description: `상점 장바구니 판매 합산 기록 (${cartTaxLines.length}건)`,
                        },
                        userId,
                        {
                            ...logContext,
                            classData,
                            sourceKey: "storeConsumptionTax",
                            customId: aggregateTaxId,
                            aggregateMeta: {
                                group: "store_cart_sale",
                                batchKey,
                                pageKey: "store",
                                actorUid: userId,
                                actorName: studentData.name || null,
                                mode: "purchase_store_cart",
                            },
                            detailLines: cartTaxLines,
                            detailCollection: TAX_LINE_COLLECTION,
                        },
                    );
                }

                const studentUpdates = {
                    "assets.itemValue": FieldValue.increment(totalItemValueIncrement),
                };
                for (const [assetField, amount] of Object.entries(
                    totalCostByCurrencyField,
                )) {
                    studentUpdates[`assets.${assetField}`] = FieldValue.increment(
                        -amount,
                    );
                }
                if (totalTicketIncrement > 0)
                    studentUpdates["assets.ticket"] =
            FieldValue.increment(totalTicketIncrement);

                transaction.update(studentRef, studentUpdates);

                return {
                    success: true,
                    totalCost: totalCartCost,
                    totalCostByCurrency: totalCostByCurrencyField,
                    itemCount: items.length,
                    taxAmountByCurrency: Object.fromEntries(
                        Object.keys(totalCostByCurrencyField).map((field) => [field,
                            field === "cash" && isTaxFeatureEnabled
                                ? Math.min(totalCostByCurrencyField[field], Math.round(purchaseResults.reduce(
                                    (sum, row) => sum + (row.currencyMeta.assetField === field ? row.taxInfo.taxAmount * row.quantity : 0), 0,
                                ) * 100) / 100)
                                : 0,
                        ]),
                    ),
                };
            });
        } catch (error) {
            if (error instanceof HttpsError) throw error;
            console.error("Cart Purchase Error:", error);
            throw new HttpsError("internal", error.message);
        }
    },
);

/**
 */
exports.purchaseStoreCartPos = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const {
            classId,
            targetStudentUid,
            items,
            isImmediate = true,
            transactionType = "purchase",
            recordAsTaxExpense = false,
            classFundId,
        } = data || {};
        const normalizedTransactionType =
            transactionType === "gift" ? "gift" : "purchase";
        const isGift = normalizedTransactionType === "gift";
        const normalizedClassFundId = cleanText(classFundId, 120);
        const usesClassFund = !isGift && !!normalizedClassFundId;
        const shouldRecordTaxExpense = isGift && recordAsTaxExpense === true;
        const globalConfig = await getGlobalConfig();

        if (
            !classId ||
      !targetStudentUid ||
      !Array.isArray(items) ||
      items.length === 0
        ) {
            throw new HttpsError("invalid-argument", "필수 값(classId, targetStudentUid, items)이 올바르지 않습니다.");
        }

        try {
            const callerSnap = await db
                .doc(`classes/${classId}/students/${auth.uid}`)
                .get();
            if (!callerSnap.exists)
                throw new Error("요청자(판매자) 정보를 찾을 수 없습니다.");

            const callerData = callerSnap.data();
            const isTeacher = ["teacher", "admin"].includes(callerData.role);
            const isStoreAdmin = callerData.permissions?.store_admin === true;

            if (!isTeacher && !isStoreAdmin && !usesClassFund) {
                throw new HttpsError("permission-denied", "POS 결제 권한이 없습니다.");
            }

            return await runFinancialRequest({
                db, classId, actorUid: auth.uid,
                operation: "store_pos", clientRequestId: data.clientRequestId,
                payload: { targetStudentUid, items: items.map(({ itemId, quantity }) => ({ itemId, quantity })),
                    isImmediate, transactionType: normalizedTransactionType,
                    recordAsTaxExpense: shouldRecordTaxExpense, classFundId: normalizedClassFundId },
            }, async (transaction) => {
                const pricingNow = new Date();
                const studentRef = db.doc(
                    `classes/${classId}/students/${targetStudentUid}`,
                );
                const classRef = db.doc(`classes/${classId}`);
                const classFundRef = usesClassFund
                    ? db.doc(`classes/${classId}/classFunds/${normalizedClassFundId}`)
                    : null;
                const tierCriteriaRef = db.doc(
                    `classes/${classId}/tierCriteria/default`,
                );
                const [sSnap, cSnap, fundSnap] = await Promise.all([
                    transaction.get(studentRef),
                    transaction.get(classRef),
                    classFundRef ? transaction.get(classFundRef) : Promise.resolve(null),
                ]);

                if (!sSnap.exists)
                    throw new Error("대상 학생 정보를 찾을 수 없습니다.");
                const studentData = sSnap.data();
                const classData = cSnap.data() || {};
                const planType = classData.planType || "FREE";
                const logContext = {
                    config: globalConfig,
                    planType,
                    serviceName: "store",
                };
                const storeMode = getStoreConsumptionTaxMode(classData);
                const isTaxFeatureEnabled =
                    canUseFeature(globalConfig, planType, "store", "enableTax") &&
                    storeMode !== "NONE";
                const classFundData = fundSnap?.exists ? fundSnap.data() || {} : null;
                if (usesClassFund) {
                    if (!classFundData) {
                        throw new Error("기금 정보를 찾을 수 없습니다.");
                    }
                    assertCanOperateClassFund({
                        userData: callerData,
                        fundData: classFundData,
                        uid: auth.uid,
                    });
                    const access = getClassFundChannelAccess(
                        classFundData,
                        "storePurchase",
                    );
                    if (!access.allowed) {
                        throw new Error(access.reason);
                    }
                }
                const batchKey = resolveAggregateBatchKey(
                    data,
                    `purchase_pos_${auth.uid}_${targetStudentUid}_${Date.now()}`,
                );
                const aggregateSaleTaxId = `store_pos_sale_${batchKey}`;
                const aggregateGiftTaxId = `store_pos_gift_${batchKey}`;
                const periodIds = getUsagePeriodIds();
                const shouldReadInventoryData = !isImmediate && shouldReadInventory();

                const preLoadData = [];
                let shouldReadTierCriteria = false;
                for (const cartItem of items) {
                    const itemId = cartItem?.itemId;
                    const quantity = Math.floor(Number(cartItem?.quantity));
                    if (!itemId || quantity <= 0) {
                        throw new Error("POS 결제 항목 형식이 올바르지 않습니다.");
                    }
                    const itemRef = db.doc(`classes/${classId}/storeItems/${itemId}`);
                    const usageRef = db.doc(
                        `classes/${classId}/students/${targetStudentUid}/storeUsage/${itemId}`,
                    );
                    const inventoryRef = db.doc(
                        `classes/${classId}/students/${targetStudentUid}/inventory/${itemId}`,
                    );

                    const iSnap = await transaction.get(itemRef);

                    if (!iSnap.exists)
                        throw new Error(`상품 정보를 찾을 수 없습니다: ${itemId}`);
                    const itemData = iSnap.data();
                    const categoryData = await loadStoreItemCategory(
                        transaction,
                        classId,
                        itemData,
                    );
                    const isVipCategory = isVipStoreCategory(categoryData);
                    const currencyMeta = getStoreCurrencyMeta(itemData, classData);
                    const shouldReadUsageData = !isGift && shouldReadUsage(itemData);

                    if (isVipCategory && !isTeacher) {
                        throw new Error("VIP 라운지 상품은 교사만 POS에서 처리할 수 있습니다.");
                    }

                    if (
                        (!isTeacher && needsTierCriteriaRead(itemData)) ||
                        needsVipTierCriteriaRead(categoryData)
                    ) {
                        shouldReadTierCriteria = true;
                    }

                    if (isRandomBoxStoreItem(itemData)) {
                        throw new Error("랜덤박스는 POS에서 판매할 수 없습니다.");
                    }

                    if (itemData.stock !== -1 && itemData.stock < quantity) {
                        throw new Error(`[${itemData.name}] 재고가 부족합니다.`);
                    }

                    preLoadData.push({
                        itemRef,
                        usageRef,
                        itemData,
                        categoryData,
                        inventoryRef,
                        quantity,
                        currencyMeta,
                        shouldReadUsageData,
                    });
                }

                const tierSnap = shouldReadTierCriteria
                    ? await transaction.get(tierCriteriaRef)
                    : null;
                const sortedTierCriteria = shouldReadTierCriteria
                    ? sortTierCriteria(tierSnap?.data()?.tiers || [])
                    : [];

                for (let index = 0; index < preLoadData.length; index += 1) {
                    const task = preLoadData[index];
                    const {
                        itemData,
                        categoryData,
                        inventoryRef,
                        quantity,
                        shouldReadUsageData,
                        usageRef,
                    } = task;
                    const [invSnap, uSnap] = await Promise.all([
                        shouldReadInventoryData
                            ? transaction.get(inventoryRef)
                            : Promise.resolve(null),
                        shouldReadUsageData
                            ? transaction.get(usageRef)
                            : Promise.resolve(null),
                    ]);

                    if (!isTeacher) {
                        assertItemTierEligibility({
                            itemData,
                            studentData,
                            sortedTierCriteria,
                        });
                    }

                    assertCategoryVipEligibility({
                        categoryData,
                        studentUid: targetStudentUid,
                        studentData,
                        sortedTierCriteria,
                    });

                    const usage = shouldReadUsageData
                        ? normalizeUsageData(
                            uSnap?.exists ? uSnap.data() : {},
                            periodIds,
                        )
                        : null;

                    if (shouldReadUsageData) {
                        assertStorePurchaseLimits({
                            itemData,
                            usage,
                            quantity,
                        });
                    }

                    preLoadData[index] = {
                        ...task,
                        invExists: invSnap?.exists === true,
                        inventoryData: invSnap?.exists ? (invSnap.data() || {}) : {},
                        usage,
                    };
                }

                let totalCartCost = 0;
                const totalCostByCurrencyField = {};
                const purchaseTasks = preLoadData.map((res) => {
                    const taxInfo = calculateItemTaxInfo(
                        res.itemData,
                        classData?.settings || {},
                        pricingNow,
                    );
                    const itemTotalCost = Math.round(taxInfo.totalAmount * res.quantity);
                    totalCartCost += itemTotalCost;
                    totalCostByCurrencyField[res.currencyMeta.assetField] =
            Number(totalCostByCurrencyField[res.currencyMeta.assetField] || 0) +
            itemTotalCost;
                    return { ...res, taxInfo, itemTotalCost };
                });

                if (usesClassFund) {
                    const unsupportedCurrencyTask = purchaseTasks.find(
                        (task) => task.currencyMeta.currencyType !== "cash",
                    );
                    if (unsupportedCurrencyTask) {
                        throw new Error("기금 결제는 일반 화폐 상품에만 사용할 수 있습니다.");
                    }

                    const access = getClassFundChannelAccess(
                        classFundData,
                        "storePurchase",
                        { amount: totalCartCost },
                    );
                    if (!access.allowed) {
                        throw new Error(access.reason);
                    }
                }

                if (!isGift) {
                    if (!usesClassFund) {
                        for (const [assetField, requiredAmount] of Object.entries(
                            totalCostByCurrencyField,
                        )) {
                            const currentBalance = getStudentBalanceByField(
                                studentData,
                                assetField,
                            );
                            if (currentBalance < requiredAmount) {
                                const shortageUnit =
                    assetField === "usdBalance"
                        ? "FIN"
                        : assetField === "missionToken"
                            ? MISSION_TOKEN_UNIT
                            : resolveClassCurrencyUnit(classData);
                                throw new Error(`${shortageUnit} 잔액이 부족합니다.`);
                            }
                        }
                    }
                }

                const nowTs = FieldValue.serverTimestamp();
                const staticNow = admin.firestore.Timestamp.now();
                const posSaleTaxLines = [];
                const posGiftTaxLines = [];
                let posSaleTaxTotal = 0;
                let posGiftTaxTotal = 0;
                let totalTicketIncrement = 0;
                const fundUsageRef = usesClassFund
                    ? db.collection(`classes/${classId}/fundUsages`).doc()
                    : null;
                const fundRedemptionIds = [];

                for (const task of purchaseTasks) {
                    const {
                        itemRef,
                        usageRef,
                        itemData,
                        categoryData,
                        inventoryRef,
                        invExists,
                        quantity,
                        taxInfo,
                        itemTotalCost,
                        currencyMeta,
                        usage,
                        shouldReadUsageData,
                    } = task;
                    const itemId = itemRef.id;
                    const redemptionRef = db
                        .collection(`classes/${classId}/storeRedemptions`)
                        .doc();
                    const isTicket =
                        itemData.itemType === "ticket" ||
                        itemData.functionTag === "arcade_ticket";

                    if (itemData.stock !== -1) {
                        transaction.update(itemRef, {
                            stock: FieldValue.increment(-quantity),
                        });
                    }

                    if (shouldReadUsageData) {
                        const usagePurchaseUpdate = buildUsagePurchaseUpdate({
                            usage,
                            quantity,
                            periodIds,
                            countTowardTotal: true,
                        });

                        transaction.set(usageRef, usagePurchaseUpdate, { merge: true });
                        stageStoreLimitSummaryRow({
                            transaction,
                            classId,
                            itemId,
                            studentUid: targetStudentUid,
                            usageData: usagePurchaseUpdate,
                        });
                    }

                    if (isImmediate) {
                        const usageLogRef = db
                            .collection(
                                `classes/${classId}/students/${targetStudentUid}/usageHistory`,
                            )
                            .doc();
                        transaction.set(usageLogRef, {
                            itemId,
                            itemName: itemData.name,
                            quantity,
                            sourceType: "pos_immediate",
                            usedDate: nowTs,
                            status: "used",
                            note: "POS 즉시 사용",
                        });
                    } else {
                        const expirationMeta = buildStoreItemExpirationMeta(
                            itemData,
                            staticNow.toMillis(),
                        );
                        const acqEntry = buildTrackedInventoryAcquisition({
                            type: isGift ? "gift" : "purchase",
                            purchaseId: redemptionRef.id,
                            quantity,
                            acquiredAt: staticNow,
                            unitValue: taxInfo.totalAmount,
                            assetValueApplied: currencyMeta.currencyType !== "usdBalance",
                            ticketCountApplied: isTicket,
                            ...expirationMeta,
                            ...(isGift && {
                                senderUid: auth.uid,
                                senderName: callerData.name || "",
                            }),
                        });
                        const commonInv = {
                            itemId,
                            itemName: itemData.name,
                            itemType: itemData.itemType || "general",
                            functionTag: itemData.functionTag || null,
                            isGiftAllowed: isStoreItemGiftAllowed(itemData),
                            price: taxInfo.totalAmount,
                            currencyType: currencyMeta.currencyType,
                            currencyUnit: currencyMeta.currencyUnit,
                            lastAcquiredDate: nowTs,
                        };

                        if (invExists) {
                            const nextAcquisitions = buildInventoryAcquisitionsWithAddedEntry(
                                task.inventoryData,
                                acqEntry,
                            );
                            transaction.update(inventoryRef, {
                                ...commonInv,
                                ...buildInventoryExpiryIndexFields({
                                    classId,
                                    studentUid: targetStudentUid,
                                    inventoryData: task.inventoryData,
                                    acquisitions: nextAcquisitions,
                                }),
                                quantity: FieldValue.increment(quantity),
                                totalAcquired: FieldValue.increment(quantity),
                                acquisitions: FieldValue.arrayUnion(acqEntry),
                            });
                        } else {
                            transaction.set(inventoryRef, {
                                ...commonInv,
                                ...buildInventoryExpiryIndexFields({
                                    classId,
                                    studentUid: targetStudentUid,
                                    inventoryData: commonInv,
                                    acquisitions: [acqEntry],
                                    includeDelete: false,
                                }),
                                quantity,
                                totalAcquired: quantity,
                                totalUsed: 0,
                                createdAt: nowTs,
                                acquisitions: [acqEntry],
                            });
                        }

                        if (isTicket) {
                            totalTicketIncrement += quantity;
                        }
                    }

                    const saleTaxAmount =
                        !isGift &&
                        !usesClassFund &&
                        isTaxFeatureEnabled &&
                        currencyMeta.currencyType === "cash"
                            ? (storeMode === "TAX_ONLY"
                                ? Math.round(taxInfo.taxAmount * quantity)
                                : itemTotalCost)
                            : 0;
                    const giftTaxAmount =
                        shouldRecordTaxExpense &&
                        currencyMeta.currencyType === "cash"
                            ? itemTotalCost
                            : 0;
                    const taxRecordPointer = saleTaxAmount > 0 &&
                        !shouldDeferTaxIncomeToPeriodSettlement(
                            classData, "storeConsumptionTax")
                        ? buildTaxRecordPointer(
                            "taxIncomes",
                            aggregateSaleTaxId,
                            redemptionRef.id,
                        )
                        : (giftTaxAmount > 0
                            ? buildTaxRecordPointer(
                                "taxExpenses",
                                aggregateGiftTaxId,
                                redemptionRef.id,
                            )
                            : null);
                    if (usesClassFund) {
                        fundRedemptionIds.push(redemptionRef.id);
                    }

                    transaction.set(redemptionRef, {
                        studentUid: targetStudentUid,
                        studentName: studentData.name,
                        itemId,
                        itemName: itemData.name,
                        ...buildStorePurchaseSnapshotFields(itemData, categoryData),
                        quantity,
                        totalAmount: itemTotalCost,
                        currencyType: currencyMeta.currencyType,
                        currencyField: currencyMeta.assetField,
                        currencyUnit: currencyMeta.currencyUnit,
                        storeMode,
                        status: "completed",
                        itemType: itemData.itemType || "general",
                        functionTag: itemData.functionTag || null,
                        isGiftAllowed: isStoreItemGiftAllowed(itemData),
                        pricePerItem: taxInfo.totalAmount,
                        taxAmountPerItem: taxInfo.taxAmount,
                        baseAmountPerItem: taxInfo.baseAmount,
                        taxRate: taxInfo.taxRate,
                        ...(!isImmediate
                            ? buildStoreItemExpirationMeta(
                                itemData,
                                staticNow.toMillis(),
                            )
                            : {}),
                        ...buildTimeSaleRecordFields(taxInfo),
                        completedAt: nowTs,
                        purchaseDailyId: shouldReadUsageData ? periodIds.dailyId : null,
                        purchaseWeeklyId: shouldReadUsageData ? periodIds.weeklyId : null,
                        sellerUid: auth.uid,
                        isPosPurchase: true,
                        isImmediate,
                        transactionType: normalizedTransactionType,
                        isGift,
                        paymentSourceType: usesClassFund ? "classFund" : "student",
                        ...(usesClassFund
                            ? {
                                classFundId: normalizedClassFundId,
                                classFundName: classFundData.name || "",
                                fundUsageId: fundUsageRef.id,
                            }
                            : {}),
                        countsTowardPurchaseLimits: shouldReadUsageData,
                        countsTowardTotalLimit: shouldReadUsageData,
                        totalResetVersion: shouldReadUsageData
                            ? usage.totalResetVersion
                            : 0,
                        ...(taxRecordPointer
                            ? {
                                taxRecord: taxRecordPointer,
                                taxRecordedAt: nowTs,
                                taxCancelled: false,
                            }
                            : {}),
                    });

                    if (saleTaxAmount > 0) {
                        posSaleTaxTotal += saleTaxAmount;
                        posSaleTaxLines.push({
                            id: redemptionRef.id,
                            amount: saleTaxAmount,
                            source: "store",
                            taxType: "store_revenue",
                            description: `[POS] ${itemData.name} 판매 (${quantity}개)`,
                            studentUid: targetStudentUid,
                            studentName: studentData.name || null,
                            relatedDoc: {
                                collection: "storeRedemptions",
                                id: redemptionRef.id,
                            },
                            externalId: redemptionRef.id,
                            meta: {
                                storeMode,
                                quantity,
                                isImmediate,
                            },
                        });
                    }

                    if (giftTaxAmount > 0) {
                        posGiftTaxTotal += giftTaxAmount;
                        posGiftTaxLines.push({
                            id: redemptionRef.id,
                            amount: giftTaxAmount,
                            source: "store_pos_gift",
                            expenseType: "store_gift",
                            category: "store_gift",
                            description: `[POS] ${itemData.name} ${quantity}개 무료 선물`,
                            studentUid: targetStudentUid,
                            studentName: studentData.name || null,
                            relatedDoc: {
                                collection: "storeRedemptions",
                                id: redemptionRef.id,
                            },
                            externalId: redemptionRef.id,
                            meta: {
                                quantity,
                                isImmediate,
                            },
                        });
                    }

                    const taxActivityLogId = stageActivityLog(
                        transaction,
                        classId,
                        {
                            studentUid: targetStudentUid,
                            type: isGift ? "income" : "expense",
                            category: usesClassFund
                                ? "store_class_fund"
                                : isGift ? "store_gift" : "store",
                            amount: itemTotalCost,
                            currency: currencyMeta.currencyUnit,
                            currencyType: currencyMeta.currencyType,
                            currencyField: currencyMeta.assetField,
                            description: isGift
                                ? `[POS] ${itemData.name} ${quantity}개 무료 선물 (${isImmediate ? "즉시사용" : "인벤토리지급"})`
                                : usesClassFund
                                    ? `[POS] ${itemData.name} ${quantity}개 기금 결제 (${classFundData.name || "기금"})`
                                    : `[POS] ${itemData.name} ${quantity}개 구매 (${isImmediate ? "즉시사용" : "인벤토리지급"})`,
                            relatedDoc: {
                                collection: "storeRedemptions",
                                id: redemptionRef.id,
                            },
                            taxEvent: saleTaxAmount > 0 ? {
                                sourceKey: "storeConsumptionTax",
                                taxCategory: "consumption_tax",
                                taxType: "store_revenue",
                                amount: saleTaxAmount,
                                taxableAmount: itemTotalCost,
                                taxRate: null,
                            } : null,
                        },
                        logContext,
                    );
                    if (saleTaxAmount > 0 && taxActivityLogId) {
                        transaction.set(
                            redemptionRef,
                            { taxActivityLogId },
                            { merge: true },
                        );
                    }
                }

                if (posSaleTaxTotal > 0) {
                    stageTaxIncome(
                        transaction,
                        classId,
                        {
                            amount: posSaleTaxTotal,
                            source: "store",
                            taxType: "store_revenue",
                            studentUid: targetStudentUid,
                            description: `[POS] 판매 합산 기록 (${posSaleTaxLines.length}건)`,
                        },
                        auth.uid,
                        {
                            ...logContext,
                            classData,
                            sourceKey: "storeConsumptionTax",
                            customId: aggregateSaleTaxId,
                            aggregateMeta: {
                                group: "store_pos_sale",
                                batchKey,
                                pageKey: "store_pos",
                                actorUid: auth.uid,
                                actorName: callerData?.name || null,
                                mode: "purchase_store_cart_pos",
                            },
                            detailLines: posSaleTaxLines,
                            detailCollection: TAX_LINE_COLLECTION,
                        },
                    );
                }

                if (posGiftTaxTotal > 0) {
                    stageTaxExpense(
                        transaction,
                        classId,
                        {
                            amount: posGiftTaxTotal,
                            source: "store_pos_gift",
                            expenseType: "store_gift",
                            category: "store_gift",
                            studentUid: targetStudentUid,
                            studentName: studentData.name || "",
                            description: `[POS] 무료 선물 합산 기록 (${posGiftTaxLines.length}건)`,
                        },
                        auth.uid,
                        {
                            ...logContext,
                            customId: aggregateGiftTaxId,
                            aggregateMeta: {
                                group: "store_pos_gift",
                                batchKey,
                                pageKey: "store_pos",
                                actorUid: auth.uid,
                                actorName: callerData?.name || null,
                                mode: "purchase_store_cart_pos_gift",
                            },
                            detailLines: posGiftTaxLines,
                            detailCollection: TAX_LINE_COLLECTION,
                        },
                    );
                }

                if (usesClassFund) {
                    const fundBalanceBefore = toMoneyAmount(classFundData.cashBalance);
                    const stagedExpense = stageImmediateClassFundExpense(
                        transaction,
                        {
                            classId,
                            usageRef: fundUsageRef,
                            fundId: normalizedClassFundId,
                            fundName: classFundData.name || "",
                            fundType: classFundData.fundType || "general",
                            amount: totalCartCost,
                            channel: "storePurchase",
                            description: `[POS] ${studentData.name || "학생"} 상점 기금 결제 (${purchaseTasks.length}건)`,
                            dateKey: periodIds.dailyId,
                            balanceBefore: fundBalanceBefore,
                            balanceAfter: fundBalanceBefore - totalCartCost,
                            createdBy: auth.uid,
                            now: nowTs,
                            taxContext: logContext,
                            usageData: {
                                source: "store_pos",
                                targetStudentUid,
                                targetStudentName: studentData.name || "",
                                storeRedemptionIds: fundRedemptionIds,
                            },
                        },
                    );
                    transaction.update(classFundRef, {
                        cashBalance: FieldValue.increment(
                            stagedExpense.accounting.cashDelta,
                        ),
                        spentTotal: FieldValue.increment(
                            stagedExpense.accounting.spentTotalDelta,
                        ),
                        settledExpenseTotal: FieldValue.increment(
                            stagedExpense.accounting.settledExpenseTotalDelta,
                        ),
                        totalValue: FieldValue.increment(
                            stagedExpense.accounting.totalValueDelta,
                        ),
                        lastUsageAt: nowTs,
                        updatedAt: nowTs,
                    });
                }

                const studentUpdates = {
                    "assets.itemValue": isImmediate
                        ? FieldValue.increment(0)
                        : FieldValue.increment(Object.entries(totalCostByCurrencyField).reduce(
                            (sum, [field, amount]) => sum + (field === "usdBalance" ? 0 : amount), 0)),
                };
                if (!isGift && !usesClassFund) {
                    for (const [assetField, amount] of Object.entries(
                        totalCostByCurrencyField,
                    )) {
                        studentUpdates[`assets.${assetField}`] = FieldValue.increment(
                            -amount,
                        );
                    }
                }
                if (totalTicketIncrement > 0) {
                    studentUpdates["assets.ticket"] = FieldValue.increment(
                        totalTicketIncrement,
                    );
                }
                transaction.update(studentRef, studentUpdates);

                return {
                    success: true,
                    message: isGift
                        ? `${studentData.name} 학생에게 POS 무료 선물을 완료했습니다.`
                        : usesClassFund
                            ? `${studentData.name} 학생의 POS 기금 결제가 완료되었습니다.`
                            : `${studentData.name} 학생의 POS 결제가 완료되었습니다.`,
                };
            });
        } catch (error) {
            console.error("POS Final Transaction Error:", error);
            if (error instanceof HttpsError) throw error;
            throw new HttpsError("internal", error.message);
        }
    },
);

exports.resetStoreItemUsageOnUnlimited = onDocumentUpdated(
    {
        document: STORE_ITEM_DOCUMENT_PATH,
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId, itemId } = event.params || {};
        if (!classId || !itemId) return;

        const beforeData = event.data?.before?.data() || {};
        const afterData = event.data?.after?.data() || {};

        if (!hasPurchaseLimit(beforeData) || hasPurchaseLimit(afterData)) {
            return;
        }

        const resetCount = await resetStoreUsageWhenUnlimited(classId, itemId);
        console.log(
            `[StoreUsageReset] classId=${classId} itemId=${itemId} reset ${resetCount} usage docs after limit removal`,
        );
    },
);

exports.rebuildStoreItemLimitSummary = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "ë¡œê·¸ì¸ì´ í•„ìš”í•©ë‹ˆë‹¤.");

        const { classId, itemId } = data || {};
        if (!classId || !itemId) {
            throw new HttpsError(
                "invalid-argument",
                "í•„ìˆ˜ ê°’(classId, itemId)ì´ ì˜¬ë°”ë¥´ì§€ ì•ŠìŠµë‹ˆë‹¤.",
            );
        }

        await assertStoreManagerPermission(classId, auth.uid);
        const rowCount = await rebuildStoreLimitSummaryDoc(classId, itemId);

        return {
            success: true,
            itemId,
            rowCount,
            message:
                rowCount > 0
                    ? `${rowCount}ëª… ê¸°ì¤€ìœ¼ë¡œ ìƒì  ì œí•œ í˜„í™©ì„ ìž¬ìƒì„±í–ˆìŠµë‹ˆë‹¤.`
                    : "í•´ë‹¹ ìƒí’ˆì˜ ì œí•œ í˜„í™© ê¸°ë¡ì´ ì—†ì–´ ë¹ˆ ìš”ì•½ì„ ìƒì„±í–ˆìŠµë‹ˆë‹¤.",
        };
    },
);

exports.__cancelClassFundPosUsage = async ({
    classId,
    usageId,
    reason,
    actorUid,
    logContext = {},
}) => db.runTransaction(async (transaction) => {
    const usageRef = db.doc(`classes/${classId}/fundUsages/${usageId}`);
    const usageSnap = await transaction.get(usageRef);
    if (!usageSnap.exists) {
        throw new HttpsError("not-found", "기금 POS 사용내역을 찾을 수 없습니다.");
    }

    const usage = usageSnap.data() || {};
    if (usage.cancellationStatus === CANCELLATION_STATUS_CANCELLED) {
        throw new HttpsError("already-exists", "이미 취소된 기금 POS 결제입니다.");
    }
    const redemptionIds = Array.from(new Set(
        (Array.isArray(usage.storeRedemptionIds) ? usage.storeRedemptionIds : [])
            .map((id) => String(id || "").trim())
            .filter(Boolean),
    ));
    if (!redemptionIds.length) {
        throw new HttpsError(
            "failed-precondition",
            "연결된 POS 구매 기록을 찾을 수 없습니다.",
        );
    }

    const fundId = String(usage.fundId || "").trim();
    const fundRef = db.doc(`classes/${classId}/classFunds/${fundId}`);
    const redemptionRefs = redemptionIds.map((id) =>
        db.doc(`classes/${classId}/storeRedemptions/${id}`),
    );
    const [fundSnap, ...redemptionSnaps] = await Promise.all([
        transaction.get(fundRef),
        ...redemptionRefs.map((ref) => transaction.get(ref)),
    ]);
    if (!fundSnap.exists || redemptionSnaps.some((snap) => !snap.exists)) {
        throw new HttpsError(
            "not-found",
            "기금 또는 POS 구매 기록 일부를 찾을 수 없습니다.",
        );
    }

    const redemptions = redemptionSnaps.map((snap) => ({
        id: snap.id,
        ref: snap.ref,
        data: snap.data() || {},
    }));
    const studentUids = new Set(redemptions.map((row) => row.data.studentUid));
    const itemIds = redemptions.map((row) => String(row.data.itemId || ""));
    if (studentUids.size !== 1 || itemIds.some((id) => !id) ||
        new Set(itemIds).size !== itemIds.length) {
        throw new HttpsError(
            "failed-precondition",
            "POS 묶음 구매 정보가 올바르지 않아 취소할 수 없습니다.",
        );
    }
    const studentUid = [...studentUids][0];
    for (const row of redemptions) {
        const data = row.data;
        if (data.status === "cancelled") {
            throw new HttpsError("already-exists", "이미 취소된 POS 상품이 있습니다.");
        }
        if (data.paymentSourceType !== "classFund" ||
            data.classFundId !== fundId || data.fundUsageId !== usageId) {
            throw new HttpsError(
                "failed-precondition",
                "POS 구매와 기금 장부 연결 정보가 일치하지 않습니다.",
            );
        }
        if (data.isImmediate === true) {
            throw new HttpsError(
                "failed-precondition",
                `${data.itemName || "즉시 사용 상품"}은 이미 사용되어 장부에서 취소할 수 없습니다.`,
            );
        }
    }

    const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
    const dependencyRefs = [studentRef];
    const rows = redemptions.map((row) => {
        const itemId = row.data.itemId;
        const itemRef = db.doc(`classes/${classId}/storeItems/${itemId}`);
        const inventoryRef = db.doc(
            `classes/${classId}/students/${studentUid}/inventory/${itemId}`,
        );
        const storeUsageRef = db.doc(
            `classes/${classId}/students/${studentUid}/storeUsage/${itemId}`,
        );
        dependencyRefs.push(itemRef, inventoryRef, storeUsageRef);
        return { ...row, itemRef, inventoryRef, storeUsageRef };
    });
    const dependencySnaps = await Promise.all(
        dependencyRefs.map((ref) => transaction.get(ref)),
    );
    const studentSnap = dependencySnaps[0];
    if (!studentSnap.exists) {
        throw new HttpsError("not-found", "POS 구매 학생 정보를 찾을 수 없습니다.");
    }

    let itemValueToRemove = 0;
    let ticketCountToRemove = 0;
    let redemptionTotal = 0;
    rows.forEach((row, index) => {
        row.itemSnap = dependencySnaps[1 + index * 3];
        row.inventorySnap = dependencySnaps[2 + index * 3];
        row.storeUsageSnap = dependencySnaps[3 + index * 3];
        const quantity = Math.max(0, Number(row.data.quantity || 0));
        if (!quantity || !row.inventorySnap.exists) {
            throw new HttpsError(
                "failed-precondition",
                `${row.data.itemName || "상품"}의 보유 내역이 없어 취소할 수 없습니다.`,
            );
        }
        const inventoryData = row.inventorySnap.data() || {};
        if (Number(inventoryData.quantity || 0) < quantity) {
            throw new HttpsError(
                "failed-precondition",
                `${row.data.itemName || "상품"}의 남은 수량이 부족해 취소할 수 없습니다.`,
            );
        }

        let cancellation;
        try {
            cancellation = buildClassFundPosInventoryCancellation({
                purchaseId: row.id,
                redemption: row.data,
                inventory: inventoryData,
            });
        } catch (error) {
            throw new HttpsError(
                "failed-precondition",
                `${row.data.itemName || "상품"}: ${error.message}`,
            );
        }
        row.quantity = cancellation.quantity;
        row.inventoryData = inventoryData;
        row.nextAcquisitions = cancellation.nextAcquisitions;
        row.nextQuantity = cancellation.nextQuantity;
        row.itemValueToRemove = cancellation.itemValueToRemove;
        itemValueToRemove += row.itemValueToRemove;
        redemptionTotal += toMoneyAmount(row.data.totalAmount);
        ticketCountToRemove += cancellation.ticketCountToRemove;
    });

    const usageAmount = toMoneyAmount(usage.amount);
    if (usageAmount !== redemptionTotal) {
        throw new HttpsError(
            "failed-precondition",
            "POS 상품 합계와 기금 장부 금액이 일치하지 않습니다.",
        );
    }
    const currentTicketCount = Number(studentSnap.data()?.assets?.ticket || 0);
    if (currentTicketCount < ticketCountToRemove) {
        throw new HttpsError(
            "failed-precondition",
            "학생의 남은 티켓이 부족해 POS 구매를 취소할 수 없습니다.",
        );
    }

    const now = FieldValue.serverTimestamp();
    const accounting = buildClassFundUsageCancellationAccounting(usage);
    const fund = fundSnap.data() || {};
    const balanceBefore = toMoneyAmount(fund.cashBalance);
    const reversalRef = db.collection(`classes/${classId}/fundUsages`).doc();
    const ledgerRef = fundRef.collection("ledger").doc();
    const periodIds = getUsagePeriodIds();

    rows.forEach((row) => {
        if (row.itemSnap.exists && row.itemSnap.data()?.stock !== -1) {
            transaction.update(row.itemRef, {
                stock: FieldValue.increment(row.quantity),
            });
        }
        if (row.storeUsageSnap.exists) {
            const storeUsage = row.storeUsageSnap.data() || {};
            const shouldDecrementTotal =
                row.data.countsTowardTotalLimit !== false &&
                Math.max(0, Number(row.data.totalResetVersion || 0)) ===
                    Math.max(0, Number(storeUsage.totalResetVersion || 0));
            const usageUpdate = buildUsageRefundUpdate({
                usageData: storeUsage,
                quantity: row.quantity,
                periodIds,
                purchaseDailyId: row.data.purchaseDailyId || "",
                purchaseWeeklyId: row.data.purchaseWeeklyId || "",
                shouldDecrementTotal,
            });
            transaction.set(row.storeUsageRef, usageUpdate, { merge: true });
            stageStoreLimitSummaryRow({
                transaction,
                classId,
                itemId: row.data.itemId,
                studentUid,
                usageData: usageUpdate,
            });
        }
        if (row.nextQuantity <= 0) {
            transaction.delete(row.inventoryRef);
        } else {
            transaction.update(row.inventoryRef, {
                ...buildInventoryExpiryIndexFields({
                    classId,
                    studentUid,
                    inventoryData: row.inventoryData,
                    acquisitions: row.nextAcquisitions,
                }),
                quantity: row.nextQuantity,
                acquisitions: row.nextAcquisitions,
            });
        }
        transaction.update(row.ref, {
            status: "cancelled",
            cancellationReason: reason,
            cancelledAt: now,
            cancelledBy: actorUid,
            fundReversalUsageId: reversalRef.id,
        });
        stageActivityLog(transaction, classId, {
            studentUid,
            type: "admin_action",
            category: "store_class_fund_cancel",
            amount: toMoneyAmount(row.data.totalAmount),
            description: `[POS 취소] ${row.data.itemName || "상품"} ${row.quantity}개`,
            relatedDoc: { collection: "storeRedemptions", id: row.id },
        }, logContext);
    });

    const studentUpdate = {};
    if (itemValueToRemove > 0) {
        studentUpdate["assets.itemValue"] = FieldValue.increment(
            -roundCurrency(itemValueToRemove),
        );
    }
    if (ticketCountToRemove > 0) {
        studentUpdate["assets.ticket"] = FieldValue.increment(-ticketCountToRemove);
    }
    if (Object.keys(studentUpdate).length) {
        transaction.update(studentRef, studentUpdate);
    }

    const fundUpdate = {
        cashBalance: FieldValue.increment(accounting.cashDelta),
        spentTotal: FieldValue.increment(accounting.spentTotalDelta),
        totalValue: FieldValue.increment(accounting.totalValueDelta),
        lastCancellationAt: now,
        updatedAt: now,
    };
    if (accounting.settledExpenseTotalDelta) {
        fundUpdate.settledExpenseTotal = FieldValue.increment(
            accounting.settledExpenseTotalDelta,
        );
    }
    if (accounting.pendingSettlementExpenseTotalDelta) {
        fundUpdate.pendingSettlementExpenseTotal = FieldValue.increment(
            accounting.pendingSettlementExpenseTotalDelta,
        );
    }
    transaction.update(fundRef, fundUpdate);
    transaction.update(usageRef, {
        cancellationStatus: CANCELLATION_STATUS_CANCELLED,
        cancellationReason: reason,
        cancelledBy: actorUid,
        cancelledAt: now,
        reversalUsageId: reversalRef.id,
        reversalLedgerId: ledgerRef.id,
        updatedAt: now,
    });
    transaction.set(reversalRef, {
        fundId,
        fundName: usage.fundName || fund.name || "",
        fundType: usage.fundType || fund.fundType || "general",
        amount: usageAmount,
        channel: "storePurchase",
        direction: "in",
        usageKind: "cancellation_reversal",
        description: `[POS 취소 복구] ${usage.description || "상점 기금 결제"}`,
        dateKey: formatKstDayId(),
        balanceBefore,
        balanceAfter: balanceBefore + usageAmount,
        settlementStatus: "not_applicable",
        cancellationStatus: CANCELLATION_STATUS_REVERSAL,
        reversalOfUsageId: usageId,
        storeRedemptionIds: redemptionIds,
        reason,
        createdBy: actorUid,
        usedAt: now,
        createdAt: now,
        updatedAt: now,
    });
    transaction.set(ledgerRef, {
        type: "store_pos_cancellation",
        direction: "in",
        amount: usageAmount,
        description: `[POS 취소 복구] ${usage.description || "상점 기금 결제"}`,
        originalUsageId: usageId,
        reversalUsageId: reversalRef.id,
        storeRedemptionIds: redemptionIds,
        reason,
        balanceBefore,
        balanceAfter: balanceBefore + usageAmount,
        createdBy: actorUid,
        createdAt: now,
    });
    if (usage.taxExpenseId) {
        transaction.set(
            db.doc(`classes/${classId}/taxExpenses/${usage.taxExpenseId}`),
            {
                status: "cancelled",
                isCancelled: true,
                cancelledAt: now,
                cancelledBy: actorUid,
                cancelledReason: "class_fund_pos_cancelled",
            },
            { merge: true },
        );
    }
    stageActivityLog(transaction, classId, {
        studentUid: actorUid,
        type: "admin_action",
        category: "class_fund_pos_cancel",
        amount: usageAmount,
        description: `기금 POS 거래 취소: ${usage.description || reason}`,
        relatedDoc: { collection: "fundUsages", id: usageId },
    }, logContext);

    return {
        usageId,
        reversalUsageId: reversalRef.id,
        refundedAmount: usageAmount,
        cancelledItemCount: rows.length,
        balanceAfter: balanceBefore + usageAmount,
    };
});

exports.resetStoreItemTotalPurchases = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, itemId, studentUids } = data || {};
        const targets = Array.isArray(studentUids)
            ? Array.from(
                new Set(
                    studentUids
                        .map((uid) => String(uid || "").trim())
                        .filter(Boolean),
                ),
            )
            : [];

        if (!classId || !itemId || targets.length === 0) {
            throw new HttpsError(
                "invalid-argument",
                "필수 값(classId, itemId, studentUids)이 올바르지 않습니다.",
            );
        }

        await assertStoreManagerPermission(classId, auth.uid);

        const resetUsageRefs = async (usageRefs = []) => {
            const BATCH_SIZE = 350;
            let resetCount = 0;

            for (let idx = 0; idx < usageRefs.length; idx += BATCH_SIZE) {
                const chunk = usageRefs.slice(idx, idx + BATCH_SIZE);
                const batch = db.batch();

                for (const usageRef of chunk) {
                    batch.set(
                        usageRef,
                        {
                            totalPurchased: 0,
                            totalResetVersion: FieldValue.increment(1),
                            updatedAt: FieldValue.serverTimestamp(),
                        },
                        { merge: true },
                    );
                }

                await batch.commit();
                resetCount += chunk.length;
            }

            return resetCount;
        };

        const usageRefs = targets.map((studentUid) =>
            db.doc(`classes/${classId}/students/${studentUid}/storeUsage/${itemId}`),
        );
        const successCount = await resetUsageRefs(usageRefs);
        const summaryRowCount = await rebuildStoreLimitSummaryDoc(classId, itemId);

        return {
            success: true,
            successCount,
            summaryRowCount,
            message: `${successCount}명의 전체 구매 횟수를 초기화했습니다.`,
        };
    },
);

exports.resetAllStoreTotalPurchases = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId } = data || {};
        if (!classId) {
            throw new HttpsError("invalid-argument", "필수 값(classId)이 필요합니다.");
        }

        await assertStoreManagerPermission(classId, auth.uid);

        const studentsSnap = await db.collection(`classes/${classId}/students`).get();
        const usageRefs = [];
        const summaryRowsByItem = new Map();

        for (const studentDoc of studentsSnap.docs) {
            const usageSnap = await studentDoc.ref.collection("storeUsage").get();
            usageSnap.forEach((usageDoc) => {
                usageRefs.push(usageDoc.ref);
                const currentUsage = usageDoc.data() || {};
                const nextUsage = {
                    ...currentUsage,
                    totalPurchased: 0,
                    totalResetVersion:
                        Math.max(0, Number(currentUsage.totalResetVersion || 0)) + 1,
                };
                const itemRows = summaryRowsByItem.get(usageDoc.id) || {};
                itemRows[studentDoc.id] = buildStoreLimitSummaryRow(nextUsage);
                summaryRowsByItem.set(usageDoc.id, itemRows);
            });
        }

        const BATCH_SIZE = 350;
        let resetDocCount = 0;

        for (let idx = 0; idx < usageRefs.length; idx += BATCH_SIZE) {
            const chunk = usageRefs.slice(idx, idx + BATCH_SIZE);
            const batch = db.batch();

            for (const usageRef of chunk) {
                batch.set(
                    usageRef,
                    {
                        totalPurchased: 0,
                        totalResetVersion: FieldValue.increment(1),
                        updatedAt: FieldValue.serverTimestamp(),
                    },
                    { merge: true },
                );
            }

            await batch.commit();
            resetDocCount += chunk.length;
        }

        const existingSummarySnap = await db
            .collection(`classes/${classId}/${STORE_LIMIT_SUMMARY_COLLECTION}`)
            .get();

        for (let idx = 0; idx < existingSummarySnap.docs.length; idx += BATCH_SIZE) {
            const chunk = existingSummarySnap.docs.slice(idx, idx + BATCH_SIZE);
            const batch = db.batch();
            chunk.forEach((summaryDoc) => batch.delete(summaryDoc.ref));
            await batch.commit();
        }

        const summaryEntries = Array.from(summaryRowsByItem.entries());
        for (let idx = 0; idx < summaryEntries.length; idx += BATCH_SIZE) {
            const chunk = summaryEntries.slice(idx, idx + BATCH_SIZE);
            const batch = db.batch();

            chunk.forEach(([itemId, rows]) => {
                batch.set(getStoreLimitSummaryRef(classId, itemId), {
                    itemId,
                    rowCount: Object.keys(rows).length,
                    rows,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            });

            await batch.commit();
        }

        return {
            success: true,
            studentCount: studentsSnap.size,
            resetDocCount,
            summaryDocCount: summaryEntries.length,
            message:
                resetDocCount > 0
                    ? `${resetDocCount}개 상품의 전체 구매 횟수를 초기화했습니다.`
                    : "초기화할 전체 구매 기록이 없습니다.",
        };
    },
);




