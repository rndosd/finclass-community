export const BANK_MONEY_FRACTION_DIGITS = 2;
export const DEFAULT_BANK_MONEY_FORMAT_SETTINGS = Object.freeze({
  fractionDigits: BANK_MONEY_FRACTION_DIGITS,
  showLessThanThreshold: true,
  trimTrailingZeros: true,
});

let bankMoneyFormatSettings = { ...DEFAULT_BANK_MONEY_FORMAT_SETTINGS };

export const toSafeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

export const getSpendableBankBalance = (assets = {}, currencyField = "cash") => {
  assets = assets || {};
  const reserved = assets.reserved && typeof assets.reserved === "object"
    ? assets.reserved[currencyField]
    : assets.reserved;
  const auctionHold = currencyField === "cash" ? assets.auctionHold : 0;
  return toSafeNumber(assets[currencyField]) -
    Math.max(0, toSafeNumber(reserved)) -
    Math.max(0, toSafeNumber(auctionHold));
};

export const roundBankMoney = (
  value,
  fractionDigits = BANK_MONEY_FRACTION_DIGITS,
) => {
  const numericValue = toSafeNumber(value, 0);
  const safeFractionDigits = Math.max(0, Number(fractionDigits) || 0);
  const factor = 10 ** safeFractionDigits;
  const adjusted =
    numericValue >= 0
      ? numericValue + Number.EPSILON
      : numericValue - Number.EPSILON;
  const rounded = Math.round(adjusted * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const normalizeFractionDigits = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), 3);
};

export const normalizeBankMoneyFormatSettings = (value = {}) => ({
  fractionDigits: normalizeFractionDigits(
    value?.fractionDigits,
    DEFAULT_BANK_MONEY_FORMAT_SETTINGS.fractionDigits,
  ),
  showLessThanThreshold: value?.showLessThanThreshold !== false,
  trimTrailingZeros: true,
});

export const getBankMoneyFormatSettings = () => bankMoneyFormatSettings;

export const setBankMoneyFormatSettings = (value = {}) => {
  bankMoneyFormatSettings = normalizeBankMoneyFormatSettings(value);
  return bankMoneyFormatSettings;
};

export const calculatePeriodRateAdjustment = (weeklyModifier, productDays) => {
  const rawAdjustment =
    (toSafeNumber(weeklyModifier) / 7) * toSafeNumber(productDays);
  return roundBankMoney(rawAdjustment, 2);
};

export const resolveTierRateModifier = (
  useTierRateAdjustment,
  weeklyModifier,
) => (useTierRateAdjustment === false ? 0 : toSafeNumber(weeklyModifier));

export const calculateSavingInterest = (principal, ratePercentage) =>
  Math.max(
    0,
    roundBankMoney(
      toSafeNumber(principal) * (toSafeNumber(ratePercentage) / 100),
    ),
  );

export const calculateInterestTax = (baseAmount, taxRatePercentage) => {
  const grossAmount = Math.max(0, toSafeNumber(baseAmount));
  const calculatedTax = Math.max(
    0,
    roundBankMoney(grossAmount * (toSafeNumber(taxRatePercentage) / 100)),
  );

  return roundBankMoney(Math.min(grossAmount, calculatedTax));
};

const formatDecimal = (value, fractionDigits, trimTrailingZeros = true) =>
  toSafeNumber(value, 0).toLocaleString("ko-KR", {
    minimumFractionDigits: trimTrailingZeros ? 0 : fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

export const formatBankMoney = (value, options = {}) => {
  const baseSettings =
    options.settings !== undefined
      ? normalizeBankMoneyFormatSettings(options.settings)
      : bankMoneyFormatSettings;
  const fractionDigits =
    typeof options.fractionDigits === "number"
      ? normalizeFractionDigits(
          options.fractionDigits,
          baseSettings.fractionDigits,
        )
      : baseSettings.fractionDigits;
  const numericValue = toSafeNumber(value, 0);
  const roundedValue = roundBankMoney(numericValue, fractionDigits);
  const showLessThan =
    options.showLessThan ?? baseSettings.showLessThanThreshold;
  const trimTrailingZeros = true;

  if (roundedValue === 0) {
    if (showLessThan && numericValue > 0) {
      const threshold = fractionDigits > 0 ? 1 / (10 ** fractionDigits) : 1;
      return `<${formatDecimal(threshold, fractionDigits, false)}`;
    }

    return "0";
  }

  return formatDecimal(roundedValue, fractionDigits, trimTrailingZeros);
};

export const formatBankMoneyWithUnit = (value, unit = "", options = {}) =>
  `${formatBankMoney(value, options)}${unit || ""}`;
