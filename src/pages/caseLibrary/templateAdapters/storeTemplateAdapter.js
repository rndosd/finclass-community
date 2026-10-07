import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../../firebase";
import {
  RANDOM_BOX_FUNCTION_TAG,
  RANDOM_BOX_ITEM_TYPE,
  isRandomBoxItem,
} from "../../store/utils/randomBox";
import { normalizeStoreCurrencyType } from "../../store/utils/storeCurrency";
import { normalizeStoreItemSaleStatus } from "../../store/utils/storeSaleStatus";

const STORE_TEMPLATE_SCOPE_IDS = new Set([
  "categories",
  "catalog",
  "pricing",
  "salesRules",
]);

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeNumber(value, fallback = 0, minimum = null) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  if (minimum == null) {
    return numericValue;
  }

  return Math.max(minimum, numericValue);
}

function normalizeOptionalNumber(value, minimum = null) {
  if (value === "" || value == null) {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  if (minimum == null) {
    return numericValue;
  }

  return Math.max(minimum, numericValue);
}

function normalizeInteger(value, fallback = 0, minimum = null) {
  const numericValue = Math.floor(Number(value));
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  if (minimum == null) {
    return numericValue;
  }

  return Math.max(minimum, numericValue);
}

function normalizeOptionalInteger(value, minimum = null) {
  if (value === "" || value == null) {
    return null;
  }

  const numericValue = Math.floor(Number(value));
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  if (minimum == null) {
    return numericValue;
  }

  return Math.max(minimum, numericValue);
}

function normalizeDateString(value) {
  if (!value) {
    return null;
  }

  const resolvedDate =
    typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
        ? value
        : new Date(value);

  if (Number.isNaN(resolvedDate?.getTime?.())) {
    return null;
  }

  return resolvedDate.toISOString();
}

function buildStoreCategoryKey(category = {}) {
  return normalizeString(category.name).toLowerCase();
}

function buildStoreItemKey(item = {}, categoryName = "") {
  return [
    normalizeString(item.name).toLowerCase(),
    normalizeString(categoryName || item.categorySnapshot?.name).toLowerCase(),
    normalizeString(item.itemType || "general").toLowerCase(),
  ].join("::");
}

function toDateValue(value) {
  if (!value) {
    return null;
  }

  const resolvedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(resolvedDate.getTime())) {
    return null;
  }

  return resolvedDate;
}

function normalizeStoreCategoryRecord(category = {}, fallbackOrder = 0, id = "") {
  return {
    id: normalizeString(id) || normalizeString(category.id),
    name: normalizeString(category.name),
    icon: normalizeString(category.icon) || "Tag",
    iconColor: normalizeString(category.iconColor) || "indigo",
    isActive: category.isActive !== false,
    order: normalizeInteger(category.order, fallbackOrder, 0),
  };
}

function normalizeStoreRandomBoxReward(reward = {}) {
  const itemId = normalizeString(reward.itemId);
  if (!itemId) {
    return null;
  }

  const probabilityPercent = normalizeNumber(
    reward.probabilityPercent ?? reward.chance,
    0,
    0,
  );

  return {
    itemId,
    itemName: normalizeString(reward.itemName),
    categoryId: normalizeString(reward.categoryId),
    quantity: normalizeInteger(reward.quantity, 1, 1),
    probabilityPercent,
    weight: normalizeInteger(
      reward.weight,
      Math.max(1, Math.round(probabilityPercent * 100)),
      1,
    ),
    price: normalizeInteger(reward.price, 0, 0),
    itemType: normalizeString(reward.itemType) || "general",
    currencyType: normalizeStoreCurrencyType(reward.currencyType),
  };
}

function normalizeStoreRandomBoxConfig(item = {}) {
  const config = item?.randomBoxConfig || {};
  const rewards = (Array.isArray(config?.rewards) ? config.rewards : [])
    .map((reward) => normalizeStoreRandomBoxReward(reward))
    .filter(Boolean);

  if (!isRandomBoxItem(item) && rewards.length === 0) {
    return null;
  }

  return {
    boxType:
      normalizeString(config?.boxType).toLowerCase() === "premium"
        ? "premium"
        : "normal",
    rewards,
  };
}

function normalizeStoreTimeSale(timeSale = {}) {
  const salePrice = normalizeOptionalInteger(timeSale?.salePrice, 1);
  const startAt = normalizeDateString(timeSale?.startAt);
  const endAt = normalizeDateString(timeSale?.endAt);

  if (salePrice == null || !startAt || !endAt) {
    return null;
  }

  return {
    salePrice,
    startAt,
    endAt,
  };
}

function buildItemCategorySnapshot(categoryMap, categoryId) {
  const matchedCategory = categoryMap.get(categoryId);
  if (!matchedCategory) {
    return null;
  }

  return normalizeStoreCategoryRecord(
    matchedCategory,
    matchedCategory?.order ?? 0,
    categoryId,
  );
}

function normalizeStoreItemRecord(item = {}, index = 0, categoryMap = new Map()) {
  const itemId = normalizeString(item.id);
  const categoryId = normalizeString(item.categoryId);
  const saleStatus = normalizeStoreItemSaleStatus(item);
  const normalizedRandomBoxConfig = normalizeStoreRandomBoxConfig(item);
  const normalizedItemType = isRandomBoxItem(item)
    ? RANDOM_BOX_ITEM_TYPE
    : normalizeString(item.itemType) || "general";

  return {
    id: itemId,
    name: normalizeString(item.name),
    description: String(item.description || ""),
    categoryId,
    categorySnapshot: buildItemCategorySnapshot(categoryMap, categoryId),
    itemType: normalizedItemType,
    functionTag:
      normalizedItemType === RANDOM_BOX_ITEM_TYPE
        ? RANDOM_BOX_FUNCTION_TAG
        : normalizeString(item.functionTag),
    validityHours: normalizeOptionalInteger(item.validityHours, 1),
    displayOrder: normalizeInteger(item.displayOrder, index, 0),
    price: normalizeInteger(item.price, 0, 0),
    stock: normalizeInteger(item.stock, -1),
    currencyType: normalizeStoreCurrencyType(item.currencyType),
    isTaxable: item.isTaxable !== false,
    customTaxRate: normalizeOptionalNumber(item.customTaxRate, 0),
    saleStatus,
    isActive: saleStatus !== "hidden",
    dailyLimit: normalizeOptionalInteger(item.dailyLimit, 1),
    weeklyLimit: normalizeOptionalInteger(item.weeklyLimit, 1),
    totalLimit: normalizeOptionalInteger(item.totalLimit, 1),
    isGiftAllowed: item.isGiftAllowed !== false,
    timeSale: normalizeStoreTimeSale(item.timeSale),
    randomBoxConfig: normalizedRandomBoxConfig,
  };
}

function getStoreCategoriesCollection(classId) {
  return collection(db, "classes", classId, "storeCategories");
}

function getStoreItemsCollection(classId) {
  return collection(db, "classes", classId, "storeItems");
}

function resolveScopeIds(templatePayload = {}) {
  if (Array.isArray(templatePayload?.scopeIds) && templatePayload.scopeIds.length > 0) {
    return templatePayload.scopeIds.filter((scopeId) =>
      STORE_TEMPLATE_SCOPE_IDS.has(scopeId),
    );
  }

  return Object.keys(templatePayload?.data || {}).filter((scopeId) =>
    STORE_TEMPLATE_SCOPE_IDS.has(scopeId),
  );
}

function buildStoreItemCreatePayload(item = {}) {
  const payload = {
    name: item.name,
    description: item.description,
    categoryId: item.categoryId,
    itemType: item.itemType,
    functionTag: item.functionTag,
    validityHours: item.validityHours,
    displayOrder: item.displayOrder,
    price: item.price,
    stock: item.stock,
    currencyType: item.currencyType,
    isTaxable: item.isTaxable,
    saleStatus: item.saleStatus,
    isActive: item.isActive,
    dailyLimit: item.dailyLimit,
    weeklyLimit: item.weeklyLimit,
    totalLimit: item.totalLimit,
    isGiftAllowed: item.isGiftAllowed,
  };

  if (item.customTaxRate != null) {
    payload.customTaxRate = item.customTaxRate;
  }

  if (item.timeSale) {
    payload.timeSale = {
      salePrice: item.timeSale.salePrice,
      startAt: toDateValue(item.timeSale.startAt),
      endAt: toDateValue(item.timeSale.endAt),
    };
  }

  if (item.randomBoxConfig) {
    payload.randomBoxConfig = item.randomBoxConfig;
  }

  return payload;
}

function buildStoreItemUpdatePayload({
  item,
  hasCatalogScope,
  hasPricingScope,
  hasSalesRulesScope,
}) {
  const payload = {};

  if (hasCatalogScope) {
    payload.name = item.name;
    payload.description = item.description;
    payload.categoryId = item.categoryId;
    payload.itemType = item.itemType;
    payload.functionTag = item.functionTag;
    payload.validityHours = item.validityHours;
    payload.displayOrder = item.displayOrder;
  }

  if (hasPricingScope) {
    payload.price = item.price;
    payload.stock = item.stock;
    payload.currencyType = item.currencyType;
    payload.isTaxable = item.isTaxable;

    if (item.customTaxRate != null) {
      payload.customTaxRate = item.customTaxRate;
    }
  }

  if (hasSalesRulesScope) {
    payload.saleStatus = item.saleStatus;
    payload.isActive = item.isActive;
    payload.dailyLimit = item.dailyLimit;
    payload.weeklyLimit = item.weeklyLimit;
    payload.totalLimit = item.totalLimit;
    payload.isGiftAllowed = item.isGiftAllowed;

    if (item.timeSale) {
      payload.timeSale = {
        salePrice: item.timeSale.salePrice,
        startAt: toDateValue(item.timeSale.startAt),
        endAt: toDateValue(item.timeSale.endAt),
      };
    }

    if (item.randomBoxConfig) {
      payload.randomBoxConfig = item.randomBoxConfig;
      if (!hasCatalogScope) {
        payload.itemType = item.itemType;
        payload.functionTag = item.functionTag;
      }
    }
  }

  return payload;
}

export async function exportStoreTemplatePayload({ classId, scopeIds = [] }) {
  if (!classId) {
    throw new Error("학급 정보가 없어 상점 템플릿을 내보낼 수 없습니다.");
  }

  const selectedScopeIds = (scopeIds || []).filter((scopeId) =>
    STORE_TEMPLATE_SCOPE_IDS.has(scopeId),
  );

  if (selectedScopeIds.length === 0) {
    return null;
  }

  const hasItemScope = selectedScopeIds.some((scopeId) =>
    ["catalog", "pricing", "salesRules"].includes(scopeId),
  );

  const [categoriesSnapshot, itemsSnapshot] = await Promise.all([
    getDocs(getStoreCategoriesCollection(classId)),
    hasItemScope ? getDocs(getStoreItemsCollection(classId)) : Promise.resolve(null),
  ]);

  const categories = categoriesSnapshot.docs
    .map((docSnapshot, index) =>
      normalizeStoreCategoryRecord(
        docSnapshot.data(),
        index,
        docSnapshot.id,
      ),
    )
    .sort((left, right) => left.order - right.order);

  const categoryMap = new Map(
    categories.map((category) => [category.id, category]),
  );

  const payloadData = {};

  if (selectedScopeIds.includes("categories")) {
    payloadData.categories = categories;
  }

  if (hasItemScope) {
    const items = itemsSnapshot.docs
      .map((docSnapshot, index) =>
        normalizeStoreItemRecord(
          { id: docSnapshot.id, ...docSnapshot.data() },
          index,
          categoryMap,
        ),
      )
      .filter((item) => item.id && item.name)
      .sort((left, right) => left.displayOrder - right.displayOrder);

    payloadData.items = items;
  }

  return {
    version: 1,
    pageType: "store",
    exportedAt: new Date().toISOString(),
    scopeIds: selectedScopeIds,
    data: payloadData,
  };
}

export async function applyStoreTemplatePayload({
  classId,
  templatePayload,
  applyMode = "merge",
}) {
  if (!classId) {
    throw new Error("학급 정보가 없어 상점 템플릿을 적용할 수 없습니다.");
  }

  if (!templatePayload?.data) {
    throw new Error("적용할 상점 템플릿 데이터가 없습니다.");
  }

  const scopeIds = resolveScopeIds(templatePayload);
  if (scopeIds.length === 0) {
    throw new Error("적용할 상점 템플릿 범위를 찾을 수 없습니다.");
  }

  const hasCatalogScope = scopeIds.includes("catalog");
  const hasPricingScope = scopeIds.includes("pricing");
  const hasSalesRulesScope = scopeIds.includes("salesRules");
  const hasItemScope = hasCatalogScope || hasPricingScope || hasSalesRulesScope;

  const [existingCategoriesSnapshot, existingItemsSnapshot] = await Promise.all([
    getDocs(getStoreCategoriesCollection(classId)),
    hasItemScope ? getDocs(getStoreItemsCollection(classId)) : Promise.resolve(null),
  ]);

  const categoryCollectionRef = getStoreCategoriesCollection(classId);
  const itemCollectionRef = getStoreItemsCollection(classId);
  const existingCategoryList = existingCategoriesSnapshot.docs.map((docSnapshot) =>
    normalizeStoreCategoryRecord(docSnapshot.data(), 0, docSnapshot.id),
  );
  const existingCategoryMap = new Map(
    existingCategoryList.map((category) => [category.id, category]),
  );
  const existingCategoryIdByKey = new Map(
    existingCategoryList
      .map((category) => [buildStoreCategoryKey(category), category.id])
      .filter(([key]) => key),
  );
  const existingItemList = (existingItemsSnapshot?.docs || []).map(
    (docSnapshot, index) =>
      normalizeStoreItemRecord(
        { id: docSnapshot.id, ...docSnapshot.data() },
        index,
        existingCategoryMap,
      ),
  );
  const existingItemMap = new Map(
    existingItemList.map((item) => [item.id, item]),
  );
  const existingItemIdByKey = new Map(
    existingItemList
      .map((item) => [
        buildStoreItemKey(item, item.categorySnapshot?.name),
        item.id,
      ])
      .filter(([key]) => key !== "::::general"),
  );

  const batch = writeBatch(db);
  let hasWrites = false;
  let categoriesCreated = 0;
  let categoriesUpdated = 0;
  let itemsCreated = 0;
  let itemsUpdated = 0;

  const ensureCategory = (categoryRecord, allowUpdate = false) => {
    if (!categoryRecord?.id || !categoryRecord?.name) {
      return "";
    }

    const categoryKey = buildStoreCategoryKey(categoryRecord);
    const matchedCategoryId =
      existingCategoryMap.has(categoryRecord.id)
        ? categoryRecord.id
        : existingCategoryIdByKey.get(categoryKey) || "";
    const existingCategory = matchedCategoryId
      ? existingCategoryMap.get(matchedCategoryId)
      : null;
    const categoryRef = doc(
      categoryCollectionRef,
      matchedCategoryId || categoryRecord.id,
    );

    if (existingCategory) {
      if (!allowUpdate) {
        return matchedCategoryId;
      }

      categoriesUpdated += 1;
      hasWrites = true;
      batch.set(
        categoryRef,
        {
          name: categoryRecord.name,
          icon: categoryRecord.icon,
          iconColor: categoryRecord.iconColor,
          isActive: categoryRecord.isActive,
          order: categoryRecord.order,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      const nextCategory = {
        ...existingCategory,
        ...categoryRecord,
        id: matchedCategoryId,
      };
      existingCategoryMap.set(matchedCategoryId, nextCategory);
      existingCategoryIdByKey.set(categoryKey, matchedCategoryId);
      return matchedCategoryId;
    }

    categoriesCreated += 1;
    hasWrites = true;
    existingCategoryMap.set(categoryRecord.id, categoryRecord);
    existingCategoryIdByKey.set(categoryKey, categoryRecord.id);
    batch.set(categoryRef, {
      name: categoryRecord.name,
      icon: categoryRecord.icon,
      iconColor: categoryRecord.iconColor,
      isActive: categoryRecord.isActive,
      order: categoryRecord.order,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return categoryRecord.id;
  };

  if (scopeIds.includes("categories")) {
    (templatePayload?.data?.categories || []).forEach((category, index) => {
      ensureCategory(
        normalizeStoreCategoryRecord(category, index, category?.id),
        true,
      );
    });
  }

  if (hasItemScope) {
    const items = Array.isArray(templatePayload?.data?.items)
      ? templatePayload.data.items
      : [];

    items.forEach((item, index) => {
      const normalizedItem = normalizeStoreItemRecord(item, index);
      if (!normalizedItem?.id || !normalizedItem?.name) {
        return;
      }

      let resolvedCategoryId = normalizedItem.categoryId;
      if (normalizedItem.categorySnapshot) {
        resolvedCategoryId =
          ensureCategory(normalizedItem.categorySnapshot, false) ||
          normalizedItem.categoryId;
      }

      const nextItemRecord = {
        ...normalizedItem,
        categoryId: resolvedCategoryId,
        categorySnapshot: resolvedCategoryId
          ? existingCategoryMap.get(resolvedCategoryId) || normalizedItem.categorySnapshot
          : normalizedItem.categorySnapshot,
      };
      const itemKey = buildStoreItemKey(
        nextItemRecord,
        nextItemRecord.categorySnapshot?.name,
      );
      const matchedItemId =
        existingItemMap.has(normalizedItem.id)
          ? normalizedItem.id
          : existingItemIdByKey.get(itemKey) || "";
      const itemRef = doc(itemCollectionRef, matchedItemId || normalizedItem.id);
      const existingItem = matchedItemId
        ? existingItemMap.get(matchedItemId)
        : null;

      if (existingItem) {
        const updatePayload = buildStoreItemUpdatePayload({
          item: nextItemRecord,
          hasCatalogScope,
          hasPricingScope,
          hasSalesRulesScope,
        });

        if (Object.keys(updatePayload).length === 0) {
          return;
        }

        itemsUpdated += 1;
        hasWrites = true;
        batch.set(
          itemRef,
          {
            ...updatePayload,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        return;
      }

      itemsCreated += 1;
      hasWrites = true;
      existingItemMap.set(normalizedItem.id, nextItemRecord);
      existingItemIdByKey.set(itemKey, normalizedItem.id);
      batch.set(itemRef, {
        ...buildStoreItemCreatePayload(nextItemRecord),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  if (hasWrites) {
    await batch.commit();
  }

  return {
    pageType: "store",
    applyMode,
    categoriesCreated,
    categoriesUpdated,
    itemsCreated,
    itemsUpdated,
    note:
      "신용등급 제한, 학생 구매 기록, 장바구니와 재고 이력 같은 운영 데이터는 불러오지 않고 공통 설정만 반영했습니다.",
  };
}
