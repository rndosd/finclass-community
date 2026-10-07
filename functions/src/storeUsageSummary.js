const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { FieldValue } = require("firebase-admin/firestore");

const { getUserData } = require("../utils/permissions");
const {
    hasStoreCatalogContributionChanged,
} = require("../utils/summaryProjectionGuards");
const {
    isStoreItemVisibleToStudents,
    normalizeStoreItemSaleStatus,
} = require("./storeSaleStatus");

const db = admin.firestore();

const REGION = "asia-northeast3";
const STORE_ITEM_DOCUMENT_PATH = "classes/{classId}/storeItems/{itemId}";
const STORE_CATALOG_DOC_ID = "catalog";
const STORE_CATALOG_SCHEMA_VERSION = 4;
const PUBLIC_CATALOG_FIELDS = [
    "name",
    "description",
    "price",
    "currencyType",
    "customTaxRate",
    "isTaxable",
    "categoryId",
    "itemType",
    "functionTag",
    "stock",
    "dailyLimit",
    "weeklyLimit",
    "totalLimit",
    "displayOrder",
    "createdAt",
    "validityHours",
    "minCreditTierId",
    "minCreditTierName",
    "isGiftAllowed",
    "timeSale",
];

const getStoreCatalogRef = (classId) =>
    db.doc(`classes/${classId}/storeSettings/${STORE_CATALOG_DOC_ID}`);

const toMillis = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value?.seconds === "number") return value.seconds * 1000;
    if (typeof value === "number") return value;

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
};

const compareStoreItems = (left, right) => {
    const leftOrder = Number(left?.displayOrder);
    const rightOrder = Number(right?.displayOrder);
    const hasLeftOrder = Number.isFinite(leftOrder);
    const hasRightOrder = Number.isFinite(rightOrder);

    if (hasLeftOrder || hasRightOrder) {
        if (!hasLeftOrder) return 1;
        if (!hasRightOrder) return -1;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }

    const leftCreatedAt = toMillis(left?.createdAt);
    const rightCreatedAt = toMillis(right?.createdAt);
    const hasLeftCreatedAt = leftCreatedAt !== null;
    const hasRightCreatedAt = rightCreatedAt !== null;

    if (hasLeftCreatedAt || hasRightCreatedAt) {
        if (!hasLeftCreatedAt) return 1;
        if (!hasRightCreatedAt) return -1;
        if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
    }

    return String(left?.name || "").localeCompare(String(right?.name || ""), "ko");
};

const isVipCategory = (category = {}) =>
    [category.type, category.categoryType]
        .some((type) => String(type || "").trim() === "vip");

const buildPublicCatalogItem = (docSnapshot, vipCategoryIds = new Set()) => {
    const rawData = docSnapshot.data() || {};
    if (!isStoreItemVisibleToStudents(rawData) ||
        vipCategoryIds.has(String(rawData.categoryId || "").trim())) {
        return null;
    }

    const saleStatus = normalizeStoreItemSaleStatus(rawData);
    const catalogItem = {
        id: docSnapshot.id,
        saleStatus,
        isActive: true,
        isTaxable: rawData.isTaxable !== false,
        isGiftAllowed: rawData.isGiftAllowed !== false,
    };

    PUBLIC_CATALOG_FIELDS.forEach((field) => {
        if (rawData[field] !== undefined) {
            catalogItem[field] = rawData[field];
        }
    });

    const randomBoxConfig = rawData.randomBoxConfig;
    if (Array.isArray(randomBoxConfig?.rewards)) {
        catalogItem.randomBoxConfig = {
            boxType: randomBoxConfig.boxType === "premium" ? "premium" : "normal",
            rewards: randomBoxConfig.rewards.map((reward) => ({
                itemId: String(reward?.itemId || "").trim(),
                itemName: String(reward?.itemName || "").trim(),
                quantity: Math.max(1, Math.floor(Number(reward?.quantity || 1))),
                probabilityPercent: Number(reward?.probabilityPercent || 0),
                weight: Math.max(0, Number(reward?.weight || 0)),
            })),
        };
    }

    return catalogItem;
};

const buildStoreCatalogSummaryData = async (classId) => {
    const [itemsSnap, categoriesSnap] = await Promise.all([
        db.collection(`classes/${classId}/storeItems`).get(),
        db.collection(`classes/${classId}/storeCategories`).get(),
    ]);
    const vipCategoryIds = new Set(categoriesSnap.docs
        .filter((doc) => isVipCategory(doc.data()))
        .map((doc) => doc.id));
    const items = itemsSnap.docs
        .map((doc) => buildPublicCatalogItem(doc, vipCategoryIds))
        .filter(Boolean)
        .sort(compareStoreItems);

    return {
        schemaVersion: STORE_CATALOG_SCHEMA_VERSION,
        itemCount: items.length,
        items,
        updatedAt: FieldValue.serverTimestamp(),
    };
};

const rebuildStoreCatalogSummaryDoc = async (classId) => {
    const summaryData = await buildStoreCatalogSummaryData(classId);
    await getStoreCatalogRef(classId).set(summaryData);
    return summaryData.itemCount || 0;
};

const patchStoreCatalogSummaryDoc = async (classId, itemId, afterSnapshot) => {
    const summaryRef = getStoreCatalogRef(classId);
    let needsRebuild = false;

    await db.runTransaction(async (transaction) => {
        needsRebuild = false;
        const summarySnap = await transaction.get(summaryRef);
        const summary = summarySnap.exists ? summarySnap.data() || {} : null;
        if (
            !summary ||
            Number(summary.schemaVersion) !== STORE_CATALOG_SCHEMA_VERSION ||
            !Array.isArray(summary.items)
        ) {
            needsRebuild = true;
            return;
        }

        const categoryId = String(afterSnapshot?.data()?.categoryId || "").trim();
        const categorySnap = categoryId
            ? await transaction.get(db.doc(`classes/${classId}/storeCategories/${categoryId}`))
            : null;
        const vipCategoryIds = new Set(
            categorySnap?.exists && isVipCategory(categorySnap.data())
                ? [categoryId] : [],
        );
        const nextItem = afterSnapshot?.exists
            ? buildPublicCatalogItem(afterSnapshot, vipCategoryIds)
            : null;
        const items = summary.items
            .filter((item) => String(item?.id || "") !== itemId);
        if (nextItem) items.push(nextItem);
        items.sort(compareStoreItems);

        transaction.set(
            summaryRef,
            {
                schemaVersion: STORE_CATALOG_SCHEMA_VERSION,
                itemCount: items.length,
                items,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    });

    if (needsRebuild) {
        await rebuildStoreCatalogSummaryDoc(classId);
    }
};

exports.syncStoreCatalogSummary = onDocumentWritten(
    {
        document: STORE_ITEM_DOCUMENT_PATH,
        region: REGION,
    },
    async (event) => {
        const { classId, itemId } = event.params;
        if (!classId || !itemId) return;

        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;
        if (!hasStoreCatalogContributionChanged(beforeData, afterData)) return;

        await patchStoreCatalogSummaryDoc(classId, itemId, event.data?.after);
    },
);

exports.syncStoreCatalogOnCategoryChange = onDocumentWritten(
    {
        document: "classes/{classId}/storeCategories/{categoryId}",
        region: REGION,
    },
    async (event) => {
        const before = event.data?.before?.data() || {};
        const after = event.data?.after?.data() || {};
        if (isVipCategory(before) !== isVipCategory(after)) {
            await rebuildStoreCatalogSummaryDoc(event.params.classId);
        }
    },
);

exports.rebuildStoreCatalogSummary = onCall(
    { region: REGION },
    async (request) => {
        const { auth, data } = request;
        if (!auth) {
            throw new HttpsError("unauthenticated", "Authentication is required.");
        }

        const classId = String(data?.classId || "").trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        const callerData = await getUserData(classId, auth.uid);
        if (!callerData) {
            throw new HttpsError(
                "permission-denied",
                "You do not have access to this class catalog.",
            );
        }

        const itemCount = await rebuildStoreCatalogSummaryDoc(classId);

        return {
            success: true,
            itemCount,
            message:
                itemCount > 0
                    ? `Rebuilt the public store catalog with ${itemCount} items.`
                    : "Rebuilt the public store catalog with no visible items.",
        };
    },
);

exports.__private = { rebuildStoreCatalogSummaryDoc };
