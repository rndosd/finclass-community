export const STORE_CATEGORY_TYPE_VIP = "vip";

export const isVipLoungeCategory = (category = {}) =>
  [category?.type, category?.categoryType].some(
    (type) => String(type || "").trim() === STORE_CATEGORY_TYPE_VIP,
  );

export const getVipLoungeCategory = (categories = []) =>
  categories.find((category) => isVipLoungeCategory(category)) || null;

export const stripHtmlToText = (value = "") =>
  String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

export const getVipAllowedStudentUids = (category = {}) => {
  const raw =
    category?.allowedStudentUids ||
    category?.vipStudentUids ||
    category?.allowedStudents ||
    [];

  if (!Array.isArray(raw)) return [];

  return raw
    .map((student) =>
      typeof student === "string" ? student : String(student?.uid || "").trim(),
    )
    .filter(Boolean);
};

export const formatVipRequirementLabel = (category = {}) => {
  if (
    category?.vipAccessMode === "hybrid_or" ||
    category?.vipAccessMode === "credit_tier" ||
    category?.minCreditTierId
  ) {
    const tierName =
      String(category?.minCreditTierName || category?.minCreditTier?.name || "")
        .trim() || "\uC2E0\uC6A9\uB4F1\uAE09";
    return `${tierName} \uC774\uC0C1`;
  }

  const selectedCount = getVipAllowedStudentUids(category).length;
  return selectedCount > 0
    ? `\uC785\uC7A5 \uB300\uC0C1 ${selectedCount}\uBA85`
    : "\uC785\uC7A5 \uB300\uC0C1 \uC5C6\uC74C";
};

const getTierId = (tier = {}) =>
  typeof tier === "string" ? tier : String(tier?.id || "").trim();

const getTierName = (tier = {}) =>
  typeof tier === "string" ? tier : String(tier?.name || "").trim();

const getFirstFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

export const resolveRequiredTier = (category = {}, tierOptions = []) => {
  const requiredId = String(category?.minCreditTierId || "").trim();
  if (!requiredId) return null;

  const fromOptions =
    tierOptions.find((tier) => String(tier?.id || "").trim() === requiredId) ||
    null;
  const rawTier = category?.minCreditTier || {};

  return {
    id: requiredId,
    name:
      String(
        category?.minCreditTierName ||
          fromOptions?.name ||
          rawTier?.name ||
          requiredId,
      ).trim() || requiredId,
    minScore: getFirstFiniteNumber(
      category?.minCreditScore,
      category?.minCreditTierMinScore,
      rawTier?.minScore,
      fromOptions?.minScore,
    ),
  };
};

export const resolveStudentTier = (student = {}, tierOptions = []) => {
  const rawTier = student?.creditTier;
  const studentTierId = getTierId(rawTier);
  const studentTierName = getTierName(rawTier);

  const fromOptions =
    tierOptions.find((tier) => String(tier?.id || "").trim() === studentTierId) ||
    tierOptions.find((tier) => String(tier?.name || "").trim() === studentTierName) ||
    null;

  return {
    id: studentTierId || fromOptions?.id || "",
    name: studentTierName || fromOptions?.name || "",
    minScore: getFirstFiniteNumber(rawTier?.minScore, fromOptions?.minScore),
  };
};

export const canEnterVipLoungeByCredit = ({
  category,
  student,
  tierOptions = [],
  isTeacher = false,
} = {}) => {
  if (isTeacher) return true;

  const requiredTier = resolveRequiredTier(category, tierOptions);
  if (!requiredTier) {
    return ["credit_tier", "hybrid_or"].includes(category?.vipAccessMode)
      ? false
      : true;
  }

  const studentTier = resolveStudentTier(student, tierOptions);
  if (studentTier.id && studentTier.id === requiredTier.id) return true;

  const studentScore = getFirstFiniteNumber(student?.creditScore);
  if (
    studentScore !== null &&
    requiredTier.minScore !== null &&
    studentScore >= requiredTier.minScore
  ) {
    return true;
  }

  if (
    studentTier.minScore !== null &&
    requiredTier.minScore !== null &&
    studentTier.minScore >= requiredTier.minScore
  ) {
    return true;
  }

  return false;
};

export const canEnterVipLounge = ({
  category,
  student,
  tierOptions = [],
  isTeacher = false,
} = {}) => {
  if (isTeacher) return true;

  const accessMode = category?.vipAccessMode === "hybrid_or"
    ? "hybrid_or"
    : category?.vipAccessMode === "credit_tier" || category?.minCreditTierId
      ? "credit_tier"
      : "selected_students";
  const allowedUids = getVipAllowedStudentUids(category);
  const studentUid = String(student?.uid || student?.id || "").trim();
  const hasSelectedStudentAccess = Boolean(
    studentUid && allowedUids.includes(studentUid),
  );

  if (accessMode === "hybrid_or") {
    const hasCreditTierAccess = canEnterVipLoungeByCredit({
      category,
      student,
      tierOptions,
      isTeacher,
    });
    return hasSelectedStudentAccess || hasCreditTierAccess;
  }

  if (accessMode === "credit_tier") {
    return canEnterVipLoungeByCredit({
      category,
      student,
      tierOptions,
      isTeacher,
    });
  }

  if (allowedUids.length === 0) return false;
  return hasSelectedStudentAccess;
};

export const shouldLoadVipStoreItems = ({
  classId,
  category,
  student,
  isTeacher = false,
  includeHiddenItems = false,
} = {}) =>
  Boolean(
    classId &&
      !includeHiddenItems &&
      isVipLoungeCategory(category) &&
      canEnterVipLounge({ category, student, isTeacher }),
  );

export const isVipStoreItem = (item = {}, categoryMap = new Map()) => {
  const categoryId = String(item?.categoryId || item?.itemCategoryId || "").trim();
  return Boolean(categoryId && isVipLoungeCategory(categoryMap.get(categoryId)));
};
