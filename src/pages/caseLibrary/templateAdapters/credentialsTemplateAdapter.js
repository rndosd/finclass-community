import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../../firebase";

const CREDENTIALS_TEMPLATE_SCOPE_IDS = new Set(["titleSettings"]);
const TITLE_REVEAL_MODE_VALUES = new Set([
  "condition_only",
  "name_only",
  "name_and_condition",
  "blurred",
  "hidden",
]);

function normalizeString(value) {
  return String(value || "").trim();
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

function normalizeNumber(value, fallback = 0, minimum = null, maximum = null) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  let nextValue = numericValue;
  if (minimum != null) {
    nextValue = Math.max(minimum, nextValue);
  }
  if (maximum != null) {
    nextValue = Math.min(maximum, nextValue);
  }

  return nextValue;
}

function slugify(value, fallback = "item") {
  const normalizedValue = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalizedValue || fallback;
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function buildTitleGradeKey(grade = {}) {
  return [
    normalizeString(grade.id).toLowerCase(),
    normalizeString(grade.label).toLowerCase(),
  ].join("::");
}

function buildTitleCategoryKey(category = {}) {
  return [
    normalizeString(category.id).toLowerCase(),
    normalizeString(category.label).toLowerCase(),
  ].join("::");
}

function buildTitleCollectionStageKey(stage = {}) {
  return [
    normalizeString(stage.id).toLowerCase(),
    normalizeString(stage.label).toLowerCase(),
  ].join("::");
}

function buildTitleDefinitionKey(item = {}) {
  return [
    normalizeString(item.name).toLowerCase(),
    normalizeString(item.categoryId || item.category).toLowerCase(),
    normalizeString(item.gradeId || item.rarity).toLowerCase(),
  ].join("::");
}

function isArchivedTitleDefinition(definition = {}) {
  if (definition?.isDeleted === true) {
    return true;
  }

  return definition?.isActive === false && definition?.isVisible === false;
}

function normalizeTitleGradeRecord(grade = {}, index = 0) {
  const label = normalizeString(grade.label);
  return {
    id: normalizeString(grade.id) || `grade-${index + 1}`,
    label: label || `등급 ${index + 1}`,
    tone: normalizeString(grade.tone) || "slate",
    order: normalizeInteger(grade.order, index + 1, 1),
  };
}

function normalizeTitleCategoryRecord(category = {}, index = 0) {
  const label = normalizeString(category.label);
  return {
    id:
      normalizeString(category.id) ||
      slugify(label || `category-${index + 1}`, `category-${index + 1}`),
    label: label || `카테고리 ${index + 1}`,
    iconKey: normalizeString(category.iconKey) || "Tag",
    colorKey: normalizeString(category.colorKey) || "slate",
    order: normalizeInteger(category.order, index + 1, 1),
  };
}

function normalizeTitleCollectionStageRecord(stage = {}, index = 0) {
  const label = normalizeString(stage.label);
  return {
    id:
      normalizeString(stage.id) ||
      slugify(label || `stage-${index + 1}`, `stage-${index + 1}`),
    label: label || `단계 ${index + 1}`,
    minRate: normalizeNumber(stage.minRate ?? stage.threshold, 0, 0, 100),
    tone: normalizeString(stage.tone) || "slate",
    order: normalizeInteger(stage.order, index + 1, 1),
  };
}

function createLookupMap(items = [], fields = []) {
  const lookupMap = new Map();

  items.forEach((item) => {
    fields.forEach((field) => {
      const key = normalizeString(item?.[field]).toLowerCase();
      if (key && !lookupMap.has(key)) {
        lookupMap.set(key, item);
      }
    });
  });

  return lookupMap;
}

function resolveLookupItem(lookupMap, values = []) {
  for (const value of values) {
    const normalizedValue = normalizeString(value).toLowerCase();
    if (normalizedValue && lookupMap.has(normalizedValue)) {
      return lookupMap.get(normalizedValue);
    }
  }

  return null;
}

function deriveTitleGradesFromDefinitions(definitions = []) {
  const usedIds = new Set();

  return definitions
    .map((definition, index) => {
      const rawId =
        normalizeString(definition.gradeId) ||
        normalizeString(definition.rarity) ||
        `grade-${index + 1}`;
      if (usedIds.has(rawId)) {
        return null;
      }

      usedIds.add(rawId);
      return {
        id: rawId,
        label: normalizeString(definition.gradeLabel) || rawId,
        tone: normalizeString(definition.gradeTone) || "slate",
        order: usedIds.size,
      };
    })
    .filter(Boolean);
}

function deriveTitleCategoriesFromDefinitions(definitions = []) {
  const usedIds = new Set();

  return definitions
    .map((definition, index) => {
      const rawLabel = normalizeString(definition.category);
      const rawId =
        normalizeString(definition.categoryId) ||
        slugify(rawLabel || `category-${index + 1}`, `category-${index + 1}`);

      if (usedIds.has(rawId)) {
        return null;
      }

      usedIds.add(rawId);
      return {
        id: rawId,
        label: rawLabel || `카테고리 ${usedIds.size}`,
        iconKey: "Tag",
        colorKey: "slate",
        order: usedIds.size,
      };
    })
    .filter(Boolean);
}

function normalizeTitleRevealMode(value) {
  const revealMode = normalizeString(value);
  return TITLE_REVEAL_MODE_VALUES.has(revealMode)
    ? revealMode
    : "condition_only";
}

function normalizeTitleDefinitionRecord(
  definition = {},
  index = 0,
  gradeLookupMap = new Map(),
  categoryLookupMap = new Map(),
) {
  const name = normalizeString(definition.name);
  if (!name) {
    return null;
  }

  const resolvedCategoryId =
    normalizeString(definition.categoryId) ||
    normalizeString(definition.category) ||
    "";
  const resolvedGradeId =
    normalizeString(definition.gradeId) ||
    normalizeString(definition.rarity) ||
    "";
  const categoryMeta = resolveLookupItem(categoryLookupMap, [
    definition.categoryId,
    definition.category,
    resolvedCategoryId,
  ]);
  const gradeMeta = resolveLookupItem(gradeLookupMap, [
    definition.gradeId,
    definition.rarity,
    resolvedGradeId,
  ]);

  return {
    id: normalizeString(definition.id),
    name,
    description: normalizeString(definition.description),
    acquisitionCondition: normalizeString(definition.acquisitionCondition),
    categoryId: categoryMeta?.id || resolvedCategoryId,
    category:
      categoryMeta?.label || normalizeString(definition.category) || "기본 칭호",
    gradeId: gradeMeta?.id || resolvedGradeId || "common",
    rarity: normalizeString(definition.rarity) || resolvedGradeId || "common",
    icon: normalizeString(definition.icon) || "none",
    familyId: normalizeString(definition.familyId) || "plaque",
    paletteId: normalizeString(definition.paletteId) || "sky",
    trimPaletteId: normalizeString(definition.trimPaletteId) || "match",
    customFrameColor: normalizeString(definition.customFrameColor),
    customBannerColor: normalizeString(definition.customBannerColor),
    customTrimColor: normalizeString(definition.customTrimColor),
    topDecoId: normalizeString(definition.topDecoId) || "none",
    sideDecoId: normalizeString(definition.sideDecoId) || "none",
    bottomDecoId: normalizeString(definition.bottomDecoId) || "none",
    patternId: normalizeString(definition.patternId) || "none",
    effectId: normalizeString(definition.effectId) || "none",
    displayOrder: normalizeInteger(definition.displayOrder, index + 1, 1),
    revealMode: normalizeTitleRevealMode(definition.revealMode),
    sourceType: normalizeString(definition.sourceType) || "manual",
    allowStudentRequest: definition.allowStudentRequest !== false,
    isVisible: definition.isVisible !== false,
    isActive: definition.isActive !== false,
  };
}

function normalizeTitleDefinitionList(
  definitions = [],
  gradeLookupMap = new Map(),
  categoryLookupMap = new Map(),
) {
  const seenKeys = new Set();

  return definitions
    .filter((definition) => !isArchivedTitleDefinition(definition))
    .map((definition, index) =>
      normalizeTitleDefinitionRecord(
        definition,
        index,
        gradeLookupMap,
        categoryLookupMap,
      ),
    )
    .filter(Boolean)
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .filter((definition) => {
      const definitionKey = buildTitleDefinitionKey(definition);
      if (!definitionKey || seenKeys.has(definitionKey)) {
        return false;
      }

      seenKeys.add(definitionKey);
      return true;
    });
}

function mergeOrderedRecords({
  applyMode,
  existingItems = [],
  incomingItems = [],
  normalizeRecord,
  buildKey,
}) {
  const normalizedExistingItems = (Array.isArray(existingItems) ? existingItems : [])
    .map((item, index) => normalizeRecord(item, index))
    .filter(Boolean);
  const normalizedIncomingItems = (Array.isArray(incomingItems) ? incomingItems : [])
    .map((item, index) => normalizeRecord(item, index))
    .filter(Boolean);

  if (applyMode === "replace") {
    return normalizedIncomingItems;
  }

  const nextItems = [...normalizedExistingItems];
  const matchIndexByKey = new Map(
    normalizedExistingItems.map((item, index) => [buildKey(item), index]),
  );

  normalizedIncomingItems.forEach((item) => {
    const matchKey = buildKey(item);
    if (!matchIndexByKey.has(matchKey)) {
      nextItems.push(item);
      matchIndexByKey.set(matchKey, nextItems.length - 1);
      return;
    }

    const matchIndex = matchIndexByKey.get(matchKey);
    nextItems[matchIndex] = {
      ...nextItems[matchIndex],
      ...item,
    };
  });

  return nextItems.map((item, index) => normalizeRecord(item, index));
}

function getCredentialSettingsDoc(classId) {
  return doc(db, "classes", classId, "settings", "credentials");
}

function getTitlesCollection(classId) {
  return collection(db, "classes", classId, "titles");
}

function resolveScopeIds(templatePayload = {}) {
  if (Array.isArray(templatePayload?.scopeIds) && templatePayload.scopeIds.length > 0) {
    return templatePayload.scopeIds.filter((scopeId) =>
      CREDENTIALS_TEMPLATE_SCOPE_IDS.has(scopeId),
    );
  }

  return Object.keys(templatePayload?.data || {}).filter((scopeId) =>
    CREDENTIALS_TEMPLATE_SCOPE_IDS.has(scopeId),
  );
}

function buildTitleSettingsPayload(settingsData = {}, titleDefinitions = []) {
  const rawTitleGrades = Array.isArray(settingsData?.titleGrades)
    ? settingsData.titleGrades
    : [];
  const rawTitleCategories = Array.isArray(settingsData?.titleCategories)
    ? settingsData.titleCategories
    : [];
  const rawTitleCollectionStages = Array.isArray(settingsData?.titleCollectionStages)
    ? settingsData.titleCollectionStages
    : [];

  const titleGrades = (
    rawTitleGrades.length > 0
      ? rawTitleGrades
      : deriveTitleGradesFromDefinitions(titleDefinitions)
  )
    .map((grade, index) => normalizeTitleGradeRecord(grade, index))
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);

  const titleCategories = (
    rawTitleCategories.length > 0
      ? rawTitleCategories
      : deriveTitleCategoriesFromDefinitions(titleDefinitions)
  )
    .map((category, index) => normalizeTitleCategoryRecord(category, index))
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);

  const titleCollectionStages = rawTitleCollectionStages
    .map((stage, index) => normalizeTitleCollectionStageRecord(stage, index))
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);

  const gradeLookupMap = createLookupMap(titleGrades, ["id", "label"]);
  const categoryLookupMap = createLookupMap(titleCategories, ["id", "label"]);
  const titles = normalizeTitleDefinitionList(
    titleDefinitions,
    gradeLookupMap,
    categoryLookupMap,
  );

  return {
    titleGrades,
    titleCategories,
    titleCollectionStages,
    titles,
  };
}

export function summarizeCredentialsTemplatePayload(templatePayload = {}) {
  const titleSettings = buildTitleSettingsPayload(
    templatePayload?.data?.titleSettings || {},
    templatePayload?.data?.titleSettings?.titles || [],
  );

  return {
    titleSettings,
    titleDefinitionsCount: titleSettings.titles.length,
    titleGradesCount: titleSettings.titleGrades.length,
    titleCategoriesCount: titleSettings.titleCategories.length,
    titleCollectionStagesCount: titleSettings.titleCollectionStages.length,
  };
}

function buildTitleDefinitionWritePayload(definition = {}) {
  return {
    name: definition.name,
    description: definition.description,
    acquisitionCondition: definition.acquisitionCondition,
    categoryId: definition.categoryId,
    category: definition.category,
    gradeId: definition.gradeId,
    rarity: definition.rarity,
    icon: definition.icon,
    familyId: definition.familyId,
    paletteId: definition.paletteId,
    trimPaletteId: definition.trimPaletteId,
    customFrameColor: definition.customFrameColor,
    customBannerColor: definition.customBannerColor,
    customTrimColor: definition.customTrimColor,
    topDecoId: definition.topDecoId,
    sideDecoId: definition.sideDecoId,
    bottomDecoId: definition.bottomDecoId,
    patternId: definition.patternId,
    effectId: definition.effectId,
    displayOrder: definition.displayOrder,
    revealMode: definition.revealMode,
    sourceType: definition.sourceType,
    allowStudentRequest: definition.allowStudentRequest,
    isVisible: definition.isVisible,
    isActive: definition.isActive,
  };
}

export async function exportCredentialsTemplatePayload({ classId, scopeIds = [] }) {
  if (!classId) {
    throw new Error("학급 정보를 찾을 수 없어 칭호 템플릿을 불러올 수 없습니다.");
  }

  if (!scopeIds.includes("titleSettings")) {
    return null;
  }

  const [settingsSnapshot, titlesSnapshot] = await Promise.all([
    getDoc(getCredentialSettingsDoc(classId)),
    getDocs(getTitlesCollection(classId)),
  ]);

  const settingsData = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
  const titleDefinitions = titlesSnapshot.docs
    .map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data(),
    }))
    .filter((definition) => definition?.isDeleted !== true);

  return {
    version: 1,
    pageType: "credentials",
    exportedAt: new Date().toISOString(),
    scopeIds: ["titleSettings"],
    data: {
      titleSettings: buildTitleSettingsPayload(settingsData, titleDefinitions),
    },
  };
}

export async function applyCredentialsTemplatePayload({
  classId,
  templatePayload,
  applyMode = "merge",
}) {
  if (!classId) {
    throw new Error("학급 정보를 찾을 수 없어 칭호 템플릿을 적용할 수 없습니다.");
  }

  if (!templatePayload?.data) {
    throw new Error("적용할 칭호 템플릿 데이터가 없습니다.");
  }

  const scopeIds = resolveScopeIds(templatePayload);
  if (!scopeIds.includes("titleSettings")) {
    throw new Error("칭호 템플릿에서 적용할 설정을 찾지 못했습니다.");
  }

  const [settingsSnapshot, titlesSnapshot] = await Promise.all([
    getDoc(getCredentialSettingsDoc(classId)),
    getDocs(getTitlesCollection(classId)),
  ]);

  const existingSettings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
  const existingTitles = titlesSnapshot.docs
    .map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data(),
    }))
    .filter((definition) => definition?.isDeleted !== true);
  const incomingTitleSettings = buildTitleSettingsPayload(
    templatePayload?.data?.titleSettings || {},
    templatePayload?.data?.titleSettings?.titles || [],
  );

  const nextTitleGrades = mergeOrderedRecords({
    applyMode,
    existingItems: existingSettings?.titleGrades,
    incomingItems: incomingTitleSettings.titleGrades,
    normalizeRecord: normalizeTitleGradeRecord,
    buildKey: buildTitleGradeKey,
  });
  const nextTitleCategories = mergeOrderedRecords({
    applyMode,
    existingItems: existingSettings?.titleCategories,
    incomingItems: incomingTitleSettings.titleCategories,
    normalizeRecord: normalizeTitleCategoryRecord,
    buildKey: buildTitleCategoryKey,
  });
  const nextTitleCollectionStages = mergeOrderedRecords({
    applyMode,
    existingItems: existingSettings?.titleCollectionStages,
    incomingItems: incomingTitleSettings.titleCollectionStages,
    normalizeRecord: normalizeTitleCollectionStageRecord,
    buildKey: buildTitleCollectionStageKey,
  });

  const nextGradeLookupMap = createLookupMap(nextTitleGrades, ["id", "label"]);
  const nextCategoryLookupMap = createLookupMap(nextTitleCategories, [
    "id",
    "label",
  ]);
  const normalizedIncomingTitles = incomingTitleSettings.titles
    .map((definition, index) =>
      normalizeTitleDefinitionRecord(
        definition,
        index,
        nextGradeLookupMap,
        nextCategoryLookupMap,
      ),
    )
    .filter(Boolean);

  const normalizedExistingTitles = existingTitles
    .map((definition, index) => {
      const normalizedDefinition = normalizeTitleDefinitionRecord(
        definition,
        index,
        nextGradeLookupMap,
        nextCategoryLookupMap,
      );

      if (!normalizedDefinition) {
        return null;
      }

      return {
        id: definition.id || normalizedDefinition.id,
        ...normalizedDefinition,
      };
    })
    .filter(Boolean);

  const existingTitleIdByKey = new Map(
    normalizedExistingTitles.map((item) => [buildTitleDefinitionKey(item), item.id]),
  );
  const existingTitleIds = new Set(existingTitles.map((item) => normalizeString(item.id)));

  const batch = writeBatch(db);
  batch.set(
    getCredentialSettingsDoc(classId),
    {
      titleGrades: clonePlainObject(nextTitleGrades),
      titleCategories: clonePlainObject(nextTitleCategories),
      titleCollectionStages: clonePlainObject(nextTitleCollectionStages),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  let titleDefinitionsCreated = 0;
  let titleDefinitionsUpdated = 0;

  normalizedIncomingTitles.forEach((definition, index) => {
    const definitionKey = buildTitleDefinitionKey(definition);
    const matchedId =
      (definition.id && existingTitleIds.has(definition.id) && definition.id) ||
      existingTitleIdByKey.get(definitionKey) ||
      "";
    const definitionRef = matchedId
      ? doc(getTitlesCollection(classId), matchedId)
      : doc(getTitlesCollection(classId));
    const writePayload = {
      ...buildTitleDefinitionWritePayload({
        ...definition,
        displayOrder: normalizeInteger(definition.displayOrder, index + 1, 1),
      }),
      updatedAt: serverTimestamp(),
    };

    if (matchedId) {
      titleDefinitionsUpdated += 1;
      batch.set(definitionRef, writePayload, { merge: true });
      return;
    }

    titleDefinitionsCreated += 1;
    batch.set(definitionRef, {
      ...writePayload,
      createdAt: serverTimestamp(),
    });
  });

  await batch.commit();

  return {
    pageType: "credentials",
    applyMode,
    titleDefinitionsCreated,
    titleDefinitionsUpdated,
    titleGradesApplied: incomingTitleSettings.titleGrades.length,
    titleCategoriesApplied: incomingTitleSettings.titleCategories.length,
    titleCollectionStagesApplied: incomingTitleSettings.titleCollectionStages.length,
    note: "",
  };
}
