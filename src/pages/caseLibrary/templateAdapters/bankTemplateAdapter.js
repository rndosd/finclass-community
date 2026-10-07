import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../../firebase";

const BANK_TEMPLATE_SCOPE_IDS = new Set([
  "depositProducts",
  "loanProducts",
  "subscriptionProducts",
  "generalPolicies",
]);

const BANK_GENERAL_POLICY_KEYS = [
  "depositAutoApprovalEnabled",
  "loanAutoApprovalEnabled",
  "isLoanLimitRatioEnabled",
  "defaultLoanLimitRatio",
  "moneyFormat",
];

function clonePlainObject(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeNumber(value, fallback = 0, min = null) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  if (min == null) {
    return numericValue;
  }

  return Math.max(min, numericValue);
}

function normalizeOptionalNumber(value, min = null) {
  if (value === "" || value == null) {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  if (min == null) {
    return numericValue;
  }

  return Math.max(min, numericValue);
}

function normalizeString(value) {
  return String(value || "").trim();
}

function slugifyProductId(value) {
  const normalizedValue = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalizedValue || "product";
}

function resolveTemplateProductId(tab, product = {}, index = 0) {
  const explicitId = normalizeString(product.id);
  if (explicitId) {
    return explicitId;
  }

  const label =
    normalizeString(product.label) ||
    normalizeString(product.title) ||
    `${tab}-product-${index + 1}`;

  return `${tab}-${slugifyProductId(label)}-${index + 1}`;
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

  return resolvedDate.toISOString().split("T")[0];
}

function toDateValue(value, options = {}) {
  if (!value) {
    return null;
  }

  const resolvedDate =
    value instanceof Date ? value : new Date(`${value}T00:00:00.000`);
  if (Number.isNaN(resolvedDate.getTime())) {
    return null;
  }

  if (options.endOfDay) {
    resolvedDate.setHours(23, 59, 59, 999);
  } else {
    resolvedDate.setHours(0, 0, 0, 0);
  }

  return resolvedDate;
}

function normalizeDepositProductTemplate(product = {}, index = 0) {
  return {
    id: resolveTemplateProductId("deposit", product, index),
    label: normalizeString(product.label),
    days: normalizeNumber(product.days, 7, 1),
    active: product.active ?? true,
    rate: normalizeNumber(product.rate, 0, 0),
    minCreditScore: normalizeOptionalNumber(product.minCreditScore, 0),
    maxDepositProductLimit: normalizeOptionalNumber(
      product.maxDepositProductLimit,
      0,
    ),
    useTierRateAdjustment: product.useTierRateAdjustment !== false,
  };
}

function normalizeLoanProductTemplate(product = {}, index = 0) {
  return {
    id: resolveTemplateProductId("loan", product, index),
    label: normalizeString(product.label),
    days: normalizeNumber(product.days, 7, 1),
    active: product.active ?? true,
    periodRate: normalizeNumber(product.periodRate, 0, 0),
    minCreditScore: normalizeOptionalNumber(product.minCreditScore, 0),
    maxLoanProductLimit: normalizeOptionalNumber(product.maxLoanProductLimit, 0),
    overdueRate: normalizeNumber(product.overdueRate, 0, 0),
    useTierRateAdjustment: product.useTierRateAdjustment !== false,
  };
}

function buildBankProductMatchKey(tab, product = {}) {
  const label = normalizeString(product.label).toLowerCase();
  const days = normalizeNumber(product.days, 0, 0);
  return `${tab}::${label}::${days}`;
}

function buildSubscriptionProductMatchKey(product = {}) {
  return [
    normalizeString(product.title).toLowerCase(),
    normalizeNumber(product.paymentCycle, 0, 0),
  ].join("::");
}

function normalizeSubscriptionProductTemplate(product = {}, index = 0) {
  return {
    id: resolveTemplateProductId("subscription", product, index),
    title: normalizeString(product.title) || `청약 상품 ${index + 1}`,
    description: String(product.description || ""),
    minAmount: normalizeNumber(product.minAmount, 1000, 0),
    maxAmount: normalizeOptionalNumber(product.maxAmount, 0),
    paymentCycle: normalizeNumber(product.paymentCycle, 7, 1),
    hasInterest: product.hasInterest !== false,
    weeklyInterestRate: normalizeNumber(product.weeklyInterestRate, 0, 0),
    startDate: normalizeDateString(product.startDate),
    endDate: normalizeDateString(product.endDate),
  };
}

function normalizeDepositProducts(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((product, index) => normalizeDepositProductTemplate(product, index))
    .filter((product) => product.label);
}

function normalizeLoanProducts(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((product, index) => normalizeLoanProductTemplate(product, index))
    .filter((product) => product.label);
}

function normalizeSubscriptionProducts(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((product, index) => normalizeSubscriptionProductTemplate(product, index))
    .filter((product) => product.title);
}

function resolveGeneralPolicyAutoApprovalSettings(source = {}) {
  const legacyValue =
    typeof source?.isAutoApprovalEnabled === "boolean"
      ? source.isAutoApprovalEnabled
      : false;

  return {
    depositAutoApprovalEnabled:
      typeof source?.depositAutoApprovalEnabled === "boolean"
        ? source.depositAutoApprovalEnabled
        : legacyValue,
    loanAutoApprovalEnabled:
      typeof source?.loanAutoApprovalEnabled === "boolean"
        ? source.loanAutoApprovalEnabled
        : legacyValue,
  };
}

function buildExportedGeneralPolicies(settingsData = {}) {
  const generalPolicies = {};
  const autoApprovalSettings =
    resolveGeneralPolicyAutoApprovalSettings(settingsData);

  if (
    typeof settingsData?.depositAutoApprovalEnabled === "boolean" ||
    typeof settingsData?.isAutoApprovalEnabled === "boolean"
  ) {
    generalPolicies.depositAutoApprovalEnabled =
      autoApprovalSettings.depositAutoApprovalEnabled;
  }

  if (
    typeof settingsData?.loanAutoApprovalEnabled === "boolean" ||
    typeof settingsData?.isAutoApprovalEnabled === "boolean"
  ) {
    generalPolicies.loanAutoApprovalEnabled =
      autoApprovalSettings.loanAutoApprovalEnabled;
  }

  if (typeof settingsData?.isLoanLimitRatioEnabled === "boolean") {
    generalPolicies.isLoanLimitRatioEnabled =
      settingsData.isLoanLimitRatioEnabled;
  }

  if (typeof settingsData?.defaultLoanLimitRatio === "number") {
    generalPolicies.defaultLoanLimitRatio = settingsData.defaultLoanLimitRatio;
  }

  if (settingsData?.moneyFormat && typeof settingsData.moneyFormat === "object") {
    generalPolicies.moneyFormat = clonePlainObject(settingsData.moneyFormat);
  }

  return generalPolicies;
}

function getBankSettingsDoc(classId) {
  return doc(db, "classes", classId, "bank", "settings");
}

function getSubscriptionProductsCollection(classId) {
  return collection(db, "classes", classId, "subscriptionProducts");
}

function resolveScopeIds(templatePayload = {}) {
  if (Array.isArray(templatePayload?.scopeIds) && templatePayload.scopeIds.length > 0) {
    return templatePayload.scopeIds.filter((scopeId) =>
      BANK_TEMPLATE_SCOPE_IDS.has(scopeId),
    );
  }

  return Object.keys(templatePayload?.data || {}).filter((scopeId) =>
    BANK_TEMPLATE_SCOPE_IDS.has(scopeId),
  );
}

function mergeBankSettingsProducts({
  applyMode,
  existingProducts = [],
  incomingProducts = [],
  tab,
}) {
  const normalizedIncomingProducts =
    tab === "deposit"
      ? normalizeDepositProducts(incomingProducts)
      : normalizeLoanProducts(incomingProducts);

  const existingProductList = Array.isArray(existingProducts) ? existingProducts : [];
  const existingProductMap = new Map(
    existingProductList.map((product) => [normalizeString(product?.id), product]),
  );
  const existingProductKeyMap = new Map(
    existingProductList
      .map((product) => [buildBankProductMatchKey(tab, product), product])
      .filter(([key]) => key !== `${tab}::::0`),
  );

  let createdCount = 0;
  let updatedCount = 0;

  if (applyMode === "replace") {
    const nextMatchedIds = new Set();
    const nextProducts = normalizedIncomingProducts.map((product) => {
      const existingProduct =
        existingProductMap.get(product.id) ||
        existingProductKeyMap.get(buildBankProductMatchKey(tab, product));
      if (existingProduct?.id) {
        nextMatchedIds.add(normalizeString(existingProduct.id));
      }

      if (existingProduct) {
        updatedCount += 1;
        return {
          ...existingProduct,
          ...product,
        };
      }

      createdCount += 1;
      return {
        minCreditScore: null,
        ...product,
      };
    });

    return {
      nextProducts,
      createdCount,
      updatedCount,
    };
  }

  const incomingProductsByMatchId = new Map();
  normalizedIncomingProducts.forEach((product) => {
    const matchedProduct =
      existingProductMap.get(product.id) ||
      existingProductKeyMap.get(buildBankProductMatchKey(tab, product));
    const matchId = matchedProduct?.id
      ? normalizeString(matchedProduct.id)
      : product.id;
    incomingProductsByMatchId.set(matchId, product);
  });
  const matchedIds = new Set();

  const nextProducts = existingProductList.map((product) => {
    const productId = normalizeString(product?.id);
    const incomingProduct = incomingProductsByMatchId.get(productId);
    if (!incomingProduct) {
      return product;
    }

    matchedIds.add(productId);
    updatedCount += 1;
    return {
      ...product,
      ...incomingProduct,
    };
  });

  normalizedIncomingProducts.forEach((product) => {
    const matchedProduct =
      existingProductMap.get(product.id) ||
      existingProductKeyMap.get(buildBankProductMatchKey(tab, product));
    if (matchedProduct?.id && matchedIds.has(normalizeString(matchedProduct.id))) {
      return;
    }

    createdCount += 1;
    nextProducts.push({
      minCreditScore: null,
      ...product,
    });
  });

  return {
    nextProducts,
    createdCount,
    updatedCount,
  };
}

function buildGeneralPoliciesUpdate({
  applyMode,
  existingSettings = {},
  incomingGeneralPolicies = {},
}) {
  const nextPolicies = {};
  const hasLegacyAutoApproval = Object.prototype.hasOwnProperty.call(
    incomingGeneralPolicies,
    "isAutoApprovalEnabled",
  );
  const hasDepositAutoApproval = Object.prototype.hasOwnProperty.call(
    incomingGeneralPolicies,
    "depositAutoApprovalEnabled",
  );
  const hasLoanAutoApproval = Object.prototype.hasOwnProperty.call(
    incomingGeneralPolicies,
    "loanAutoApprovalEnabled",
  );

  if (
    hasLegacyAutoApproval ||
    hasDepositAutoApproval ||
    hasLoanAutoApproval
  ) {
    const existingAutoApprovalSettings =
      resolveGeneralPolicyAutoApprovalSettings(existingSettings);
    const legacyAutoApprovalValue = hasLegacyAutoApproval
      ? Boolean(incomingGeneralPolicies.isAutoApprovalEnabled)
      : null;

    const depositAutoApprovalEnabled = hasDepositAutoApproval
      ? Boolean(incomingGeneralPolicies.depositAutoApprovalEnabled)
      : legacyAutoApprovalValue ??
        existingAutoApprovalSettings.depositAutoApprovalEnabled;
    const loanAutoApprovalEnabled = hasLoanAutoApproval
      ? Boolean(incomingGeneralPolicies.loanAutoApprovalEnabled)
      : legacyAutoApprovalValue ??
        existingAutoApprovalSettings.loanAutoApprovalEnabled;

    nextPolicies.depositAutoApprovalEnabled = depositAutoApprovalEnabled;
    nextPolicies.loanAutoApprovalEnabled = loanAutoApprovalEnabled;
    nextPolicies.isAutoApprovalEnabled =
      depositAutoApprovalEnabled && loanAutoApprovalEnabled;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      incomingGeneralPolicies,
      "isLoanLimitRatioEnabled",
    )
  ) {
    nextPolicies.isLoanLimitRatioEnabled = Boolean(
      incomingGeneralPolicies.isLoanLimitRatioEnabled,
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      incomingGeneralPolicies,
      "defaultLoanLimitRatio",
    )
  ) {
    nextPolicies.defaultLoanLimitRatio = normalizeNumber(
      incomingGeneralPolicies.defaultLoanLimitRatio,
      0.5,
      0,
      1,
    );
  }

  if (Object.prototype.hasOwnProperty.call(incomingGeneralPolicies, "moneyFormat")) {
    nextPolicies.moneyFormat = clonePlainObject(incomingGeneralPolicies.moneyFormat);
  }

  return nextPolicies;
}

function buildSubscriptionWritePayload(templateProduct = {}) {
  return {
    title: templateProduct.title,
    description: templateProduct.description,
    minAmount: templateProduct.minAmount,
    maxAmount: templateProduct.maxAmount,
    paymentCycle: templateProduct.paymentCycle,
    hasInterest: templateProduct.hasInterest,
    weeklyInterestRate: templateProduct.weeklyInterestRate,
    startDate: toDateValue(templateProduct.startDate),
    endDate: toDateValue(templateProduct.endDate, { endOfDay: true }),
  };
}

function applySubscriptionProducts({
  batch,
  classId,
  incomingProducts = [],
  existingProducts = [],
}) {
  const normalizedIncomingProducts = normalizeSubscriptionProducts(incomingProducts);
  const existingProductMap = new Map(
    existingProducts.map((product) => [normalizeString(product?.id), product]),
  );
  const existingProductKeyMap = new Map(
    existingProducts
      .map((product) => [buildSubscriptionProductMatchKey(product), product])
      .filter(([key]) => key !== "::0"),
  );

  let createdCount = 0;
  let updatedCount = 0;

  normalizedIncomingProducts.forEach((product) => {
    const existingProduct =
      existingProductMap.get(product.id) ||
      existingProductKeyMap.get(buildSubscriptionProductMatchKey(product));
    const productRef = doc(
      getSubscriptionProductsCollection(classId),
      existingProduct?.id || product.id,
    );
    const payload = buildSubscriptionWritePayload(product);

    if (existingProduct) {
      updatedCount += 1;
      batch.set(
        productRef,
        {
          ...payload,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    createdCount += 1;
    batch.set(productRef, {
      ...payload,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  return {
    createdCount,
    updatedCount,
  };
}

export async function exportBankTemplatePayload({ classId, scopeIds = [] }) {
  if (!classId) {
    throw new Error("학급 정보가 없어 은행 템플릿을 내보낼 수 없습니다.");
  }

  const selectedScopeIds = (scopeIds || []).filter((scopeId) =>
    BANK_TEMPLATE_SCOPE_IDS.has(scopeId),
  );

  if (selectedScopeIds.length === 0) {
    return null;
  }

  const shouldLoadSubscriptionProducts = selectedScopeIds.includes(
    "subscriptionProducts",
  );

  const [settingsSnapshot, subscriptionProductsSnapshot] = await Promise.all([
    getDoc(getBankSettingsDoc(classId)),
    shouldLoadSubscriptionProducts
      ? getDocs(getSubscriptionProductsCollection(classId))
      : Promise.resolve(null),
  ]);

  const settingsData = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
  const payloadData = {};

  if (selectedScopeIds.includes("depositProducts")) {
    payloadData.depositProducts = normalizeDepositProducts(
      settingsData?.depositProducts,
    );
  }

  if (selectedScopeIds.includes("loanProducts")) {
    payloadData.loanProducts = normalizeLoanProducts(settingsData?.loanProducts);
  }

  if (selectedScopeIds.includes("subscriptionProducts")) {
    payloadData.subscriptionProducts = normalizeSubscriptionProducts(
      subscriptionProductsSnapshot?.docs.map((docSnapshot) => ({
        id: docSnapshot.id,
        ...docSnapshot.data(),
      })) || [],
    );
  }

  if (selectedScopeIds.includes("generalPolicies")) {
    payloadData.generalPolicies = buildExportedGeneralPolicies(settingsData);
  }

  return {
    version: 1,
    pageType: "bank",
    exportedAt: new Date().toISOString(),
    scopeIds: selectedScopeIds,
    data: payloadData,
  };
}

export async function applyBankTemplatePayload({
  classId,
  templatePayload,
  applyMode = "merge",
}) {
  if (!classId) {
    throw new Error("학급 정보가 없어 은행 템플릿을 적용할 수 없습니다.");
  }

  if (!templatePayload?.data) {
    throw new Error("적용할 은행 템플릿 데이터가 없습니다.");
  }

  const scopeIds = resolveScopeIds(templatePayload);
  if (scopeIds.length === 0) {
    throw new Error("적용할 은행 템플릿 범위를 찾을 수 없습니다.");
  }

  const settingsRef = getBankSettingsDoc(classId);
  const shouldLoadSubscriptionProducts = scopeIds.includes("subscriptionProducts");

  const [settingsSnapshot, subscriptionProductsSnapshot] = await Promise.all([
    getDoc(settingsRef),
    shouldLoadSubscriptionProducts
      ? getDocs(getSubscriptionProductsCollection(classId))
      : Promise.resolve(null),
  ]);

  const existingSettings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
  const existingSubscriptionProducts =
    subscriptionProductsSnapshot?.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data(),
    })) || [];

  const nextSettingsPatch = {};
  let depositProductsCreated = 0;
  let depositProductsUpdated = 0;
  let loanProductsCreated = 0;
  let loanProductsUpdated = 0;

  if (scopeIds.includes("depositProducts")) {
    const nextDepositProducts = mergeBankSettingsProducts({
      applyMode,
      existingProducts: existingSettings?.depositProducts,
      incomingProducts: templatePayload?.data?.depositProducts,
      tab: "deposit",
    });

    nextSettingsPatch.depositProducts = nextDepositProducts.nextProducts;
    depositProductsCreated = nextDepositProducts.createdCount;
    depositProductsUpdated = nextDepositProducts.updatedCount;
  }

  if (scopeIds.includes("loanProducts")) {
    const nextLoanProducts = mergeBankSettingsProducts({
      applyMode,
      existingProducts: existingSettings?.loanProducts,
      incomingProducts: templatePayload?.data?.loanProducts,
      tab: "loan",
    });

    nextSettingsPatch.loanProducts = nextLoanProducts.nextProducts;
    loanProductsCreated = nextLoanProducts.createdCount;
    loanProductsUpdated = nextLoanProducts.updatedCount;
  }

  if (scopeIds.includes("generalPolicies")) {
    Object.assign(
      nextSettingsPatch,
      buildGeneralPoliciesUpdate({
        applyMode,
        existingSettings,
        incomingGeneralPolicies: templatePayload?.data?.generalPolicies || {},
      }),
    );
  }

  const batch = writeBatch(db);
  let hasWrites = false;

  if (Object.keys(nextSettingsPatch).length > 0) {
    hasWrites = true;
    batch.set(
      settingsRef,
      {
        ...nextSettingsPatch,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  let subscriptionProductsCreated = 0;
  let subscriptionProductsUpdated = 0;
  if (scopeIds.includes("subscriptionProducts")) {
    const nextSubscriptionProducts = applySubscriptionProducts({
      batch,
      classId,
      incomingProducts: templatePayload?.data?.subscriptionProducts,
      existingProducts: existingSubscriptionProducts,
    });

    subscriptionProductsCreated = nextSubscriptionProducts.createdCount;
    subscriptionProductsUpdated = nextSubscriptionProducts.updatedCount;
    hasWrites =
      hasWrites ||
      nextSubscriptionProducts.createdCount > 0 ||
      nextSubscriptionProducts.updatedCount > 0;
  }

  if (hasWrites) {
    await batch.commit();
  }

  return {
    pageType: "bank",
    applyMode,
    depositProductsCreated,
    depositProductsUpdated,
    loanProductsCreated,
    loanProductsUpdated,
    subscriptionProductsCreated,
    subscriptionProductsUpdated,
    generalPoliciesApplied: BANK_GENERAL_POLICY_KEYS.filter((key) =>
      Object.prototype.hasOwnProperty.call(nextSettingsPatch, key),
    ).length,
    note:
      applyMode === "replace"
        ? "기존 은행 상품과 청약 기록을 보호하기 위해 템플릿에 없는 기존 항목은 삭제하지 않고 안전하게 덮어썼습니다."
        : "",
  };
}
