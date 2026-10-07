const CREDENTIAL_ID_MAX_LENGTH = 256;
const TITLE_REQUEST_MESSAGE_MAX_LENGTH = 1500;
const TITLE_REVEAL_VISIBILITIES = new Set(["public", "blur", "hidden"]);
const DEFAULT_TITLE_REVEAL_CONFIG = Object.freeze({
  name: "hidden",
  condition: "public",
  nameplate: "hidden",
});

function requireCredentialId(value, fieldName) {
  const containsForbiddenCharacter =
    typeof value === "string" &&
    (
      value.includes("/") ||
      Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint <= 31 || codePoint === 127;
      })
    );

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > CREDENTIAL_ID_MAX_LENGTH ||
    containsForbiddenCharacter
  ) {
    throw new TypeError(`${fieldName} is not a valid credential identifier.`);
  }

  return value;
}

function boundedText(value, maxLength, fallback = "") {
  const normalized = String(value ?? fallback);
  return normalized.slice(0, maxLength);
}

function boundedNumber(value, fallback, min, max) {
  const normalized = Number(value);
  return Number.isFinite(normalized)
    ? Math.min(max, Math.max(min, normalized))
    : fallback;
}

function normalizeStudentNumber(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 9999) {
    return value;
  }

  return boundedText(value, 32);
}

function normalizeTitleRevealVisibility(value, fallback) {
  return TITLE_REVEAL_VISIBILITIES.has(value) ? value : fallback;
}

function normalizeTitleRevealConfig(config) {
  const source =
    config && typeof config === "object" && !Array.isArray(config)
      ? config
      : {};

  return {
    name: normalizeTitleRevealVisibility(
      source.name,
      DEFAULT_TITLE_REVEAL_CONFIG.name,
    ),
    condition: normalizeTitleRevealVisibility(
      source.condition,
      DEFAULT_TITLE_REVEAL_CONFIG.condition,
    ),
    nameplate: normalizeTitleRevealVisibility(
      source.nameplate,
      DEFAULT_TITLE_REVEAL_CONFIG.nameplate,
    ),
  };
}

export function buildCredentialTitleRequestId(studentUid, titleId) {
  const validStudentUid = requireCredentialId(studentUid, "studentUid");
  const validTitleId = requireCredentialId(titleId, "titleId");
  return `${validStudentUid}_${validTitleId}`;
}

export function buildStudentTitleRequestPayload({
  studentUid,
  studentName,
  studentNumber,
  titleId,
  titleDefinition = {},
  entry = {},
  categoryMeta = {},
  revealFields = {},
  defaultTitleGradeId = "",
  requestMessage = "",
  timestamp,
}) {
  const validStudentUid = requireCredentialId(studentUid, "studentUid");
  const validTitleId = requireCredentialId(titleId, "titleId");
  const requestId = buildCredentialTitleRequestId(
    validStudentUid,
    validTitleId,
  );
  const revealConfig = normalizeTitleRevealConfig(
    revealFields?.revealConfig,
  );

  return {
    requestId,
    titleId: validTitleId,
    titleName: boundedText(titleDefinition?.name, 200),
    acquisitionCondition: boundedText(
      entry?.acquisitionCondition ||
        titleDefinition?.acquisitionCondition,
      4000,
    ),
    categoryId: boundedText(categoryMeta?.id, 256),
    category: boundedText(categoryMeta?.label, 200),
    gradeId: boundedText(
      titleDefinition?.gradeId ||
        entry?.gradeId ||
        entry?.rarity ||
        defaultTitleGradeId,
      256,
    ),
    rarity: boundedText(
      entry?.rarity || titleDefinition?.rarity || "common",
      64,
    ),
    version: boundedNumber(
      titleDefinition?.version || entry?.version || 2,
      2,
      1,
      1000,
    ),
    icon: boundedText(
      titleDefinition?.icon || entry?.icon || "none",
      256,
    ),
    familyId: boundedText(
      titleDefinition?.familyId || entry?.familyId || "plaque",
      256,
    ),
    paletteId: boundedText(
      titleDefinition?.paletteId || entry?.paletteId || "sky",
      256,
    ),
    trimPaletteId: boundedText(
      titleDefinition?.trimPaletteId || entry?.trimPaletteId || "match",
      256,
    ),
    ornamentSetId: boundedText(
      titleDefinition?.ornamentSetId || entry?.ornamentSetId || "none",
      256,
    ),
    fontStyleId: boundedText(
      titleDefinition?.fontStyleId || entry?.fontStyleId || "basic",
      256,
    ),
    textScale: boundedNumber(
      titleDefinition?.textScale ?? entry?.textScale ?? 100,
      100,
      -1000,
      1000,
    ),
    textOffsetY: boundedNumber(
      titleDefinition?.textOffsetY ?? entry?.textOffsetY ?? 0,
      0,
      -1000,
      1000,
    ),
    textColorMode: boundedText(
      titleDefinition?.textColorMode || entry?.textColorMode || "auto",
      64,
    ),
    customTextColor: boundedText(
      titleDefinition?.customTextColor || entry?.customTextColor,
      64,
    ),
    customFrameColor: boundedText(
      titleDefinition?.customFrameColor || entry?.customFrameColor,
      64,
    ),
    customBannerColor: boundedText(
      titleDefinition?.customBannerColor || entry?.customBannerColor,
      64,
    ),
    customTrimColor: boundedText(
      titleDefinition?.customTrimColor || entry?.customTrimColor,
      64,
    ),
    topDecoId: boundedText(
      titleDefinition?.topDecoId || entry?.topDecoId || "none",
      256,
    ),
    sideDecoId: boundedText(
      titleDefinition?.sideDecoId || entry?.sideDecoId || "none",
      256,
    ),
    bottomDecoId: boundedText(
      titleDefinition?.bottomDecoId || entry?.bottomDecoId || "none",
      256,
    ),
    patternId: boundedText(
      titleDefinition?.patternId || entry?.patternId || "none",
      256,
    ),
    effectId: boundedText(
      titleDefinition?.effectId || entry?.effectId || "none",
      256,
    ),
    revealConfig,
    revealMode: boundedText(
      revealFields?.revealMode || "condition_only",
      64,
    ),
    sourceType: "claim_request",
    studentUid: validStudentUid,
    studentName: boundedText(studentName, 200),
    studentNumber: normalizeStudentNumber(studentNumber),
    status: "pending",
    requestMessage: boundedText(
      String(requestMessage || "").trim(),
      TITLE_REQUEST_MESSAGE_MAX_LENGTH,
    ),
    requestedAt: timestamp,
    approvedAt: null,
    rejectedAt: null,
    reviewedAt: null,
    reviewedByUid: null,
    reviewedByName: "",
    reviewMessage: "",
    updatedAt: timestamp,
  };
}

export function resolveCredentialTitleRequestForReview({
  request = {},
  titleDefinition = null,
  student = null,
}) {
  return {
    ...request,
    titleName: titleDefinition?.name || "삭제된 칭호",
    acquisitionCondition:
      titleDefinition?.acquisitionCondition ||
      titleDefinition?.condition ||
      "",
    categoryId:
      titleDefinition?.categoryId ||
      titleDefinition?.category ||
      "",
    category:
      titleDefinition?.categoryLabel ||
      titleDefinition?.category ||
      "",
    gradeId:
      titleDefinition?.gradeId ||
      titleDefinition?.rarity ||
      "",
    rarity: titleDefinition?.rarity || "",
    studentName:
      student?.name ||
      student?.displayName ||
      "학생",
    studentNumber: student?.studentNumber ?? "",
    definitionDeleted: !titleDefinition,
  };
}

export function buildStudentTitlePreferencePayload({
  titleId,
  timestamp,
}) {
  return {
    nextTargetTitleId: requireCredentialId(titleId, "titleId"),
    updatedAt: timestamp,
  };
}

export function buildStudentOwnedTitlePreferencePatch({
  equipped,
  equippedOrder,
  timestamp,
}) {
  const isEquipped = equipped === true;
  if (
    isEquipped &&
    (
      !Number.isInteger(equippedOrder) ||
      equippedOrder < 1 ||
      equippedOrder > 3
    )
  ) {
    throw new TypeError(
      "equippedOrder must be an integer from 1 through 3.",
    );
  }

  return {
    equipped: isEquipped,
    equippedOrder: isEquipped ? equippedOrder : null,
    updatedAt: timestamp,
  };
}
