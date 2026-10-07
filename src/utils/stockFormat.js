export const DEFAULT_STOCK_DISPLAY_SETTINGS = Object.freeze({
  moneyFractionDigits: 2,
  priceFractionDigits: 1,
  classCurrencyFractionDigits: 0,
  exchangeRateFractionDigits: 2,
  percentFractionDigits: 1,
  quantityFractionDigits: 3,
  useCompactNotation: true,
  showLessThanThreshold: true,
  trimTrailingZeros: true,
});

let stockDisplaySettings = { ...DEFAULT_STOCK_DISPLAY_SETTINGS };

const COMPACT_NUMBER_UNITS = [
  { threshold: 1_000_000_000_000, suffix: "조" },
  { threshold: 100_000_000, suffix: "억" },
  { threshold: 10_000, suffix: "만" },
];

export const toSafeStockNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeFractionDigits = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), 4);
};

export const normalizeStockDisplaySettings = (value = {}) => ({
  moneyFractionDigits: normalizeFractionDigits(
    value?.moneyFractionDigits,
    DEFAULT_STOCK_DISPLAY_SETTINGS.moneyFractionDigits,
  ),
  priceFractionDigits: normalizeFractionDigits(
    value?.priceFractionDigits,
    DEFAULT_STOCK_DISPLAY_SETTINGS.priceFractionDigits,
  ),
  classCurrencyFractionDigits: normalizeFractionDigits(
    value?.classCurrencyFractionDigits,
    DEFAULT_STOCK_DISPLAY_SETTINGS.classCurrencyFractionDigits,
  ),
  exchangeRateFractionDigits: normalizeFractionDigits(
    value?.exchangeRateFractionDigits,
    DEFAULT_STOCK_DISPLAY_SETTINGS.exchangeRateFractionDigits,
  ),
  percentFractionDigits: normalizeFractionDigits(
    value?.percentFractionDigits,
    DEFAULT_STOCK_DISPLAY_SETTINGS.percentFractionDigits,
  ),
  quantityFractionDigits: normalizeFractionDigits(
    value?.quantityFractionDigits,
    DEFAULT_STOCK_DISPLAY_SETTINGS.quantityFractionDigits,
  ),
  useCompactNotation: value?.useCompactNotation !== false,
  showLessThanThreshold: value?.showLessThanThreshold !== false,
  trimTrailingZeros: true,
});

export const getStockDisplaySettings = () => stockDisplaySettings;

export const setStockDisplaySettings = (value = {}) => {
  stockDisplaySettings = normalizeStockDisplaySettings(value);
  return stockDisplaySettings;
};

const roundDisplayValue = (value, fractionDigits) => {
  const numericValue = toSafeStockNumber(value, 0);
  const safeFractionDigits = Math.max(0, Number(fractionDigits) || 0);
  const factor = 10 ** safeFractionDigits;
  const adjusted =
    numericValue >= 0
      ? numericValue + Number.EPSILON
      : numericValue - Number.EPSILON;
  const rounded = Math.round(adjusted * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const formatDecimal = (value, fractionDigits, trimTrailingZeros = true) =>
  toSafeStockNumber(value, 0).toLocaleString("ko-KR", {
    minimumFractionDigits: trimTrailingZeros ? 0 : fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

const formatCompactSuffix = (value, fractionDigits = 1) => {
  const numericValue = toSafeStockNumber(value, 0);
  const absValue = Math.abs(numericValue);
  const unit = COMPACT_NUMBER_UNITS.find(
    ({ threshold }) => absValue >= threshold,
  );

  if (!unit) return null;

  return `${(numericValue / unit.threshold).toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })}${unit.suffix}`;
};

const resolveBaseSettings = (value) =>
  value !== undefined
    ? normalizeStockDisplaySettings(value)
    : stockDisplaySettings;

const formatStockNumericValue = (value, options = {}, digitKey) => {
  const baseSettings = resolveBaseSettings(options.settings);
  const fractionDigits =
    typeof options.fractionDigits === "number"
      ? normalizeFractionDigits(options.fractionDigits, baseSettings[digitKey])
      : baseSettings[digitKey];
  const numericValue = toSafeStockNumber(value, 0);
  const roundedValue = roundDisplayValue(numericValue, fractionDigits);
  const trimTrailingZeros = true;
  const showLessThan =
    options.showLessThan ?? baseSettings.showLessThanThreshold;

  if (options.compact && baseSettings.useCompactNotation) {
    const compact = formatCompactSuffix(
      numericValue,
      options.compactFractionDigits ?? 1,
    );
    if (compact) return compact;
  }

  if (roundedValue === 0) {
    if (showLessThan && numericValue > 0) {
      return `<${formatDecimal(1 / (10 ** fractionDigits), fractionDigits, false)}`;
    }

    return "0";
  }

  return formatDecimal(roundedValue, fractionDigits, trimTrailingZeros);
};

export const formatStockMoney = (value, options = {}) =>
  formatStockNumericValue(value, options, "moneyFractionDigits");

export const formatStockPrice = (value, options = {}) =>
  formatStockNumericValue(value, options, "priceFractionDigits");

export const formatStockClassCurrency = (value, options = {}) =>
  formatStockNumericValue(value, options, "classCurrencyFractionDigits");

export const formatStockExchangeRate = (value, options = {}) =>
  formatStockNumericValue(value, options, "exchangeRateFractionDigits");

export const formatStockPercent = (value, options = {}) =>
  formatStockNumericValue(value, options, "percentFractionDigits");

export const formatStockQuantity = (value, options = {}) => {
  const baseSettings = resolveBaseSettings(options.settings);
  const fractionDigits =
    typeof options.fractionDigits === "number"
      ? normalizeFractionDigits(
          options.fractionDigits,
          baseSettings.quantityFractionDigits,
        )
      : baseSettings.quantityFractionDigits;

  return formatStockNumericValue(
    value,
    {
      ...options,
      fractionDigits,
      showLessThan: options.showLessThan ?? true,
    },
    "quantityFractionDigits",
  );
};
