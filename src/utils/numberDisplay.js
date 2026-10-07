export const DEFAULT_FORMAT_SETTINGS = {
  largeNumberDisplay: "first",
  smallDecimalPlaces: 2,
  useCompactNotation: true,
};

const DIGITS = { tens: 0, ones: 0, first: 1, second: 2, third: 3 };

export const normalizeNumberFormatSettings = (value = {}) => ({
  largeNumberDisplay: Object.prototype.hasOwnProperty.call(DIGITS, value?.largeNumberDisplay)
    ? value.largeNumberDisplay : DEFAULT_FORMAT_SETTINGS.largeNumberDisplay,
  smallDecimalPlaces: Number.isInteger(Number(value?.smallDecimalPlaces))
    ? Math.min(3, Math.max(0, Number(value.smallDecimalPlaces)))
    : DEFAULT_FORMAT_SETTINGS.smallDecimalPlaces,
  useCompactNotation: value?.useCompactNotation !== false,
});

// Display precision never changes the value used for a transaction or ledger.
export const formatConfiguredMoney = (value, settings = {}, options = {}) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return "0";
  const format = normalizeNumberFormatSettings(settings);
  const explicitDigits = Number.isFinite(options.fractionDigits);
  const digits = explicitDigits
    ? Math.min(8, Math.max(0, Math.trunc(options.fractionDigits)))
    : Math.abs(amount) < 1 ? format.smallDecimalPlaces : DIGITS[format.largeNumberDisplay];
  const step = !explicitDigits && Math.abs(amount) >= 1 && format.largeNumberDisplay === "tens"
    ? 10 : 10 ** -digits;
  const scaled = amount / step;
  const displayed = explicitDigits ? amount : Math.trunc(
    scaled + Math.sign(scaled) * Number.EPSILON * Math.max(1, Math.abs(scaled)) * 2,
  ) * step;
  const rounded = Number(displayed.toFixed(digits));
  if (rounded === 0 && options.showLessThan !== false) {
    const threshold = step.toLocaleString("ko-KR", { maximumFractionDigits: digits });
    return amount > 0 ? `<${threshold}` : `>-${threshold}`;
  }
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString("ko-KR", {
    minimumFractionDigits: explicitDigits && options.trimTrailingZeros !== true ? digits : 0,
    maximumFractionDigits: digits,
  });
};
