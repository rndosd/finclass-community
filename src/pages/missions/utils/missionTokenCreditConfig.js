export const DEFAULT_MISSION_TOKEN_CREDIT_CONFIG = Object.freeze({
  enabled: false,
  tokenUnit: 10,
  creditUnit: 1,
  tierRules: {},
});

function normalizePositiveInteger(value, fallbackValue) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

export function normalizeTierInfo(rawTier = null) {
  if (!rawTier) return null;

  if (typeof rawTier === "string") {
    const value = rawTier.trim();
    if (!value) return null;

    return {
      id: value,
      name: value,
      color: "#64748b",
      minScore: 0,
    };
  }

  const id = String(rawTier?.id || rawTier?.name || "").trim();
  if (!id) return null;

  const parsedMinScore = Number(rawTier?.minScore);

  return {
    id,
    name: String(rawTier?.name || id).trim(),
    color: String(rawTier?.color || "#64748b"),
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
  };
}

export function normalizeTierList(rawTiers = []) {
  return (Array.isArray(rawTiers) ? rawTiers : [])
    .map((tier) => normalizeTierInfo(tier))
    .filter(Boolean)
    .sort((left, right) => Number(right.minScore || 0) - Number(left.minScore || 0));
}

export function normalizeTierRules(rawTierRules = {}) {
  if (!rawTierRules || typeof rawTierRules !== "object" || Array.isArray(rawTierRules)) {
    return {};
  }

  return Object.entries(rawTierRules).reduce((accumulator, [rawTierId, rawRule]) => {
    const tierId = String(rawTierId || "").trim();
    if (!tierId || !rawRule || typeof rawRule !== "object") {
      return accumulator;
    }

    const tokenUnit = normalizePositiveInteger(
      rawRule?.tokenUnit ?? rawRule?.tokensPerCredit,
      null,
    );
    const creditUnit = normalizePositiveInteger(
      rawRule?.creditUnit ?? (rawRule?.tokensPerCredit !== undefined ? 1 : null),
      null,
    );

    if (!tokenUnit || !creditUnit) {
      return accumulator;
    }

    accumulator[tierId] = {
      tokenUnit,
      creditUnit,
    };
    return accumulator;
  }, {});
}

export function normalizeMissionTokenCreditConfig(raw = {}) {
  const usesNewModel =
    raw?.tokenUnit !== undefined || raw?.creditUnit !== undefined;
  const legacyTokenUnit = normalizePositiveInteger(
    raw?.tokensPerCredit,
    DEFAULT_MISSION_TOKEN_CREDIT_CONFIG.tokenUnit,
  );

  return {
    enabled: raw?.enabled === true,
    tokenUnit: normalizePositiveInteger(
      usesNewModel ? raw?.tokenUnit : legacyTokenUnit,
      DEFAULT_MISSION_TOKEN_CREDIT_CONFIG.tokenUnit,
    ),
    creditUnit: normalizePositiveInteger(
      usesNewModel ? raw?.creditUnit : 1,
      DEFAULT_MISSION_TOKEN_CREDIT_CONFIG.creditUnit,
    ),
    tierRules: normalizeTierRules(raw?.tierRules),
    updatedAt: raw?.updatedAt || null,
    updatedByUid: raw?.updatedByUid || null,
    updatedByName: raw?.updatedByName || "",
  };
}

export function resolveMissionTokenCreditRule(config = {}, rawTier = null) {
  const normalizedConfig = normalizeMissionTokenCreditConfig(config);
  const tier = normalizeTierInfo(rawTier);
  const tierRule = tier?.id ? normalizedConfig?.tierRules?.[tier.id] : null;

  return {
    tokenUnit: Number(
      tierRule?.tokenUnit ?? normalizedConfig.tokenUnit ?? DEFAULT_MISSION_TOKEN_CREDIT_CONFIG.tokenUnit,
    ),
    creditUnit: Number(
      tierRule?.creditUnit ?? normalizedConfig.creditUnit ?? DEFAULT_MISSION_TOKEN_CREDIT_CONFIG.creditUnit,
    ),
    tier,
    usesTierOverride: Boolean(tierRule),
  };
}
