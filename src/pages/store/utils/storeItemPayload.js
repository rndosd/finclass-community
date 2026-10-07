import { deleteField, serverTimestamp } from "firebase/firestore";

import {
  isStoreItemVisibleToStudents,
  normalizeStoreItemSaleStatus,
} from "./storeSaleStatus";
import { normalizeStoreCurrencyType } from "./storeCurrency";
import {
  RANDOM_BOX_FUNCTION_TAG,
  RANDOM_BOX_ITEM_TYPE,
} from "./randomBox";

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const intOr = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
};

export function buildStoreItemWriteData({
  formData,
  timeSalePayload,
  tierOptions,
  itemToEdit,
  isEditing,
  teacherUid,
}) {
  const selectedTier =
    tierOptions.find((tier) => tier.id === formData.minCreditTierId) || null;
  const selectedTierName =
    selectedTier?.name ||
    itemToEdit?.minCreditTierName ||
    formData.minCreditTierId;

  const baseData = {
    name: formData.name.trim(),
    description: formData.description.trim(),
    itemIcon: formData.itemIcon === "auto" ? "" : formData.itemIcon,
    price: Number(formData.price),
    stock: formData.stock === "" ? -1 : Number(formData.stock),
    saleStatus: normalizeStoreItemSaleStatus({
      saleStatus: formData.saleStatus,
    }),
    isActive: isStoreItemVisibleToStudents({
      saleStatus: formData.saleStatus,
    }),
    categoryId: formData.categoryId,
    itemType: formData.itemType,
    currencyType: normalizeStoreCurrencyType(formData.currencyType),
    validityHours:
      formData.validityHours === ""
        ? null
        : Math.floor(Number(formData.validityHours)),
    functionTag: formData.itemType === "ticket" ? "arcade_ticket" : "",
    dailyLimit: formData.dailyLimit === "" ? null : Number(formData.dailyLimit),
    weeklyLimit:
      formData.weeklyLimit === "" ? null : Number(formData.weeklyLimit),
    totalLimit: formData.totalLimit === "" ? null : Number(formData.totalLimit),
    updatedAt: serverTimestamp(),
    teacherUid,
    isTaxable: true,
    isGiftAllowed: formData.isGiftAllowed !== false,
  };

  if (timeSalePayload) {
    baseData.timeSale = timeSalePayload;
  } else if (isEditing) {
    baseData.timeSale = deleteField();
  }

  if (formData.minCreditTierId) {
    baseData.minCreditTierId = formData.minCreditTierId;
    baseData.minCreditTierName = selectedTierName;
  } else if (isEditing) {
    baseData.minCreditTierId = deleteField();
    baseData.minCreditTierName = deleteField();
  }

  if (formData.taxType === "custom" && formData.customTaxRate !== "") {
    baseData.customTaxRate = Number(formData.customTaxRate);
  } else if (isEditing) {
    baseData.customTaxRate = deleteField();
  }

  if (isEditing) {
    baseData.isFeatured = deleteField();
    baseData.featuredLabel = deleteField();
  }

  return baseData;
}

export function buildNewStoreItemWriteData(options) {
  return {
    ...buildStoreItemWriteData(options),
    createdAt: serverTimestamp(),
    displayOrder: Date.now(),
  };
}

export function buildRandomBoxItemWriteData({
  formData,
  rewardRows,
  rewardItemMap,
  tierOptions,
  itemToEdit,
  isEditing,
  teacherUid,
}) {
  const selectedTier =
    tierOptions.find((tier) => tier.id === formData.minCreditTierId) || null;
  const rowsForSave = rewardRows.map((row) => ({
    itemId: String(row.itemId || "").trim(),
    probabilityPercent: Math.max(0, round2(row.probabilityPercent)),
    quantity: intOr(row.quantity, 0),
  }));
  const rawTotalProbability = rowsForSave.reduce(
    (sum, row) => sum + row.probabilityPercent,
    0,
  );
  let usedProbability = 0;
  const normalizedRewards = rowsForSave.map((row, index) => {
    const item = rewardItemMap.get(row.itemId);
    const probabilityPercent =
      index === rowsForSave.length - 1
        ? round2(Math.max(0, 100 - usedProbability))
        : round2((row.probabilityPercent / rawTotalProbability) * 100);
    usedProbability = round2(usedProbability + probabilityPercent);
    return {
      itemId: row.itemId,
      itemName: item?.name || "",
      categoryId: item?.categoryId || "",
      quantity: row.quantity,
      probabilityPercent,
      weight: Math.max(1, Math.round(probabilityPercent * 100)),
      price: Number(item?.price || 0),
      itemType: item?.itemType || "general",
      currencyType: normalizeStoreCurrencyType(item?.currencyType),
    };
  });

  const baseData = {
    name: formData.name.trim(),
    description: formData.description.trim(),
    price: Math.round(Number(formData.price)),
    stock: -1,
    saleStatus: normalizeStoreItemSaleStatus({
      saleStatus: formData.saleStatus,
    }),
    isActive: isStoreItemVisibleToStudents({
      saleStatus: formData.saleStatus,
    }),
    categoryId: formData.categoryId,
    itemType: RANDOM_BOX_ITEM_TYPE,
    functionTag: RANDOM_BOX_FUNCTION_TAG,
    currencyType: normalizeStoreCurrencyType(formData.currencyType),
    validityHours: null,
    dailyLimit: formData.dailyLimit === "" ? null : Number(formData.dailyLimit),
    weeklyLimit:
      formData.weeklyLimit === "" ? null : Number(formData.weeklyLimit),
    totalLimit: formData.totalLimit === "" ? null : Number(formData.totalLimit),
    updatedAt: serverTimestamp(),
    teacherUid,
    isTaxable: true,
    isGiftAllowed: formData.isGiftAllowed !== false,
    randomBoxConfig: {
      boxType: formData.boxType === "premium" ? "premium" : "normal",
      rewards: normalizedRewards,
    },
  };

  if (formData.minCreditTierId) {
    baseData.minCreditTierId = formData.minCreditTierId;
    baseData.minCreditTierName =
      selectedTier?.name ||
      itemToEdit?.minCreditTierName ||
      formData.minCreditTierId;
  } else if (isEditing) {
    baseData.minCreditTierId = deleteField();
    baseData.minCreditTierName = deleteField();
  }

  if (isEditing) {
    baseData.customTaxRate = deleteField();
    baseData.timeSale = deleteField();
  }

  return baseData;
}

export function buildNewRandomBoxItemWriteData(options) {
  return {
    ...buildRandomBoxItemWriteData(options),
    createdAt: serverTimestamp(),
    displayOrder: Date.now(),
  };
}
