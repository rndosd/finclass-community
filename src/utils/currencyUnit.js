export const DEFAULT_CLASS_CURRENCY_UNIT = "원";

const PLACEHOLDER_CURRENCY_UNITS = new Set(["BIL", "빌", "단위"]);

const normalizeCurrencyUnitValue = (value) => String(value ?? "").trim();

const flattenCandidates = (candidates = []) =>
  candidates.flatMap((candidate) =>
    Array.isArray(candidate) ? candidate : [candidate],
  );

export const resolveClassCurrencyUnit = (
  classData = {},
  fallback = DEFAULT_CLASS_CURRENCY_UNIT,
  extraCandidates = [],
) => {
  const primaryCurrencyUnit = normalizeCurrencyUnitValue(classData?.currencyUnit);
  const legacyCurrencyUnit = normalizeCurrencyUnitValue(
    classData?.currencySettings?.name,
  );
  const normalizedExtraCandidates = flattenCandidates(extraCandidates)
    .map(normalizeCurrencyUnitValue)
    .filter(Boolean);

  if (
    legacyCurrencyUnit &&
    primaryCurrencyUnit &&
    legacyCurrencyUnit !== primaryCurrencyUnit &&
    PLACEHOLDER_CURRENCY_UNITS.has(primaryCurrencyUnit)
  ) {
    return legacyCurrencyUnit;
  }

  return (
    primaryCurrencyUnit ||
    legacyCurrencyUnit ||
    normalizedExtraCandidates[0] ||
    fallback
  );
};

export const normalizeClassCurrencyData = (
  classData,
  fallback = DEFAULT_CLASS_CURRENCY_UNIT,
) => {
  if (!classData || typeof classData !== "object" || Array.isArray(classData)) {
    return classData;
  }

  const currencyUnit = resolveClassCurrencyUnit(classData, fallback);
  if (classData.currencyUnit === currencyUnit) {
    return classData;
  }

  return {
    ...classData,
    currencyUnit,
  };
};
