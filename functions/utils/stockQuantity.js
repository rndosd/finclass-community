const STOCK_QUANTITY_DECIMALS = 3;
const STOCK_QUANTITY_FACTOR = 10 ** STOCK_QUANTITY_DECIMALS;
const STOCK_QUANTITY_MIN = 1 / STOCK_QUANTITY_FACTOR;
const STOCK_QUANTITY_EPSILON = 1e-9;

const toSafeNumber = (value, fallback = 0) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeStockQuantity = (value) => {
    const numericValue = toSafeNumber(value, 0);
    if (!(numericValue > 0)) return 0;

    const normalized =
        Math.floor((numericValue + STOCK_QUANTITY_EPSILON) * STOCK_QUANTITY_FACTOR) /
        STOCK_QUANTITY_FACTOR;

    return normalized >= STOCK_QUANTITY_MIN ? normalized : 0;
};

const roundStockQuantity = (value) => {
    const numericValue = toSafeNumber(value, 0);
    if (!(numericValue > 0)) return 0;

    const rounded =
        Math.round((numericValue + STOCK_QUANTITY_EPSILON) * STOCK_QUANTITY_FACTOR) /
        STOCK_QUANTITY_FACTOR;

    return rounded >= STOCK_QUANTITY_MIN ? rounded : 0;
};

const isStockQuantityAvailable = (requested, available) =>
    normalizeStockQuantity(requested) <=
    roundStockQuantity(available) + STOCK_QUANTITY_EPSILON;

module.exports = {
    STOCK_QUANTITY_DECIMALS,
    STOCK_QUANTITY_FACTOR,
    STOCK_QUANTITY_MIN,
    STOCK_QUANTITY_EPSILON,
    normalizeStockQuantity,
    roundStockQuantity,
    isStockQuantityAvailable,
};
