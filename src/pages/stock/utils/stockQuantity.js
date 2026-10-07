export const STOCK_QUANTITY_DECIMALS = 3;
export const STOCK_QUANTITY_FACTOR = 10 ** STOCK_QUANTITY_DECIMALS;
export const STOCK_QUANTITY_MIN = 1 / STOCK_QUANTITY_FACTOR;
export const STOCK_QUANTITY_EPSILON = 1e-9;

const toSafeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

export const normalizeStockQuantity = (value) => {
  const numericValue = toSafeNumber(value, 0);
  if (!(numericValue > 0)) return 0;

  const normalized =
    Math.floor((numericValue + STOCK_QUANTITY_EPSILON) * STOCK_QUANTITY_FACTOR) /
    STOCK_QUANTITY_FACTOR;

  return normalized >= STOCK_QUANTITY_MIN ? normalized : 0;
};

export const roundStockQuantity = (value) => {
  const numericValue = toSafeNumber(value, 0);
  if (!(numericValue > 0)) return 0;

  const rounded =
    Math.round((numericValue + STOCK_QUANTITY_EPSILON) * STOCK_QUANTITY_FACTOR) /
    STOCK_QUANTITY_FACTOR;

  return rounded >= STOCK_QUANTITY_MIN ? rounded : 0;
};

export const formatStockQuantityInput = (value) => {
  const normalized = roundStockQuantity(value);
  if (!(normalized > 0)) return "";

  return normalized
    .toFixed(STOCK_QUANTITY_DECIMALS)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
};

export const isStockQuantityAvailable = (requested, available) =>
  normalizeStockQuantity(requested) <=
  roundStockQuantity(available) + STOCK_QUANTITY_EPSILON;
