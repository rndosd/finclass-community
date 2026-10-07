import { normalizeStockQuantity } from "./stockQuantity";

const toSafeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const round4 = (value) => Math.round(toSafeNumber(value) * 10000) / 10000;
const ceil4 = (value) =>
  Math.ceil((toSafeNumber(value) - Number.EPSILON) * 10000) / 10000;

export const calculateAutoExchangeBuyPayment = ({
  totalUSD,
  balanceUSD,
  localBalance,
  conversionRate,
  exchangeFeeRate,
  enabled,
}) => {
  const requiredUSD = Math.max(0, round4(totalUSD));
  const availableUSD = Math.max(0, round4(balanceUSD));
  const availableLocal = Math.max(0, round4(localBalance));
  const usdUsed = Math.min(requiredUSD, availableUSD);
  const autoExchangeUSD = round4(requiredUSD - usdUsed);

  if (!(autoExchangeUSD > 0)) {
    return {
      canAfford: true,
      autoExchangeApplied: false,
      usdUsed,
      autoExchangeUSD: 0,
      autoExchangeSourceAmount: 0,
      autoExchangeFeeInClassCurrency: 0,
    };
  }

  const rate = toSafeNumber(conversionRate, 0);
  const feeRate = Math.max(0, toSafeNumber(exchangeFeeRate, 0));
  if (!enabled || !(rate > 0) || feeRate >= 1) {
    return {
      canAfford: false,
      autoExchangeApplied: false,
      usdUsed,
      autoExchangeUSD,
      autoExchangeSourceAmount: 0,
      autoExchangeFeeInClassCurrency: 0,
    };
  }

  const sourceAmount = ceil4(autoExchangeUSD / rate / (1 - feeRate));
  const feeInClassCurrency = round4(sourceAmount * feeRate);

  return {
    canAfford: availableLocal >= sourceAmount,
    autoExchangeApplied: true,
    usdUsed,
    autoExchangeUSD,
    autoExchangeSourceAmount: sourceAmount,
    autoExchangeFeeInClassCurrency: feeInClassCurrency,
  };
};

const normalizeTradeInputs = ({
  priceUSD,
  quantity,
  tradeFeeRate,
  tradeFeeMinUSD,
}) => {
  const normalizedPrice = toSafeNumber(priceUSD, 0);
  const normalizedQuantity = normalizeStockQuantity(quantity);
  const normalizedFeeRate = Math.max(0, toSafeNumber(tradeFeeRate, 0));
  const normalizedFeeMinUSD = Math.max(0, toSafeNumber(tradeFeeMinUSD, 0));

  return {
    priceUSD: normalizedPrice,
    quantity: normalizedQuantity,
    tradeFeeRate: normalizedFeeRate,
    tradeFeeMinUSD: normalizedFeeMinUSD,
  };
};

export const calculateBuyQuote = (inputs = {}) => {
  const { priceUSD, quantity, tradeFeeRate, tradeFeeMinUSD } =
    normalizeTradeInputs(inputs);

  if (!(priceUSD > 0) || !(quantity > 0)) {
    return null;
  }

  const grossUSD = round4(priceUSD * quantity);
  const feeUSD = Math.max(round4(grossUSD * tradeFeeRate), tradeFeeMinUSD);
  const totalUSD = round4(grossUSD + feeUSD);

  return {
    priceUSD,
    quantity,
    grossUSD,
    feeUSD,
    totalUSD,
    tradeFeeRate,
    tradeFeeMinUSD,
  };
};

export const calculateSellQuote = (inputs = {}) => {
  const { priceUSD, quantity, tradeFeeRate, tradeFeeMinUSD } =
    normalizeTradeInputs(inputs);

  if (!(priceUSD > 0) || !(quantity > 0)) {
    return null;
  }

  const grossUSD = round4(priceUSD * quantity);
  const feeUSD = Math.max(round4(grossUSD * tradeFeeRate), tradeFeeMinUSD);
  const netUSD = round4(grossUSD - feeUSD);

  return {
    priceUSD,
    quantity,
    grossUSD,
    feeUSD,
    netUSD,
    tradeFeeRate,
    tradeFeeMinUSD,
  };
};

export const calculateBuyQuoteByBudget = (inputs = {}) => {
  const normalizedPrice = toSafeNumber(inputs.priceUSD, 0);
  const normalizedBudget = Math.max(0, toSafeNumber(inputs.budgetUSD, 0));
  const normalizedFeeRate = Math.max(0, toSafeNumber(inputs.tradeFeeRate, 0));
  const normalizedFeeMinUSD = Math.max(0, toSafeNumber(inputs.tradeFeeMinUSD, 0));

  if (!(normalizedPrice > 0) || !(normalizedBudget > 0)) {
    return null;
  }

  const maxGrossByRate = normalizedBudget / (1 + normalizedFeeRate);
  const maxGrossByMinFee = normalizedBudget - normalizedFeeMinUSD;
  const maxGrossUSD = Math.min(maxGrossByRate, maxGrossByMinFee);

  if (!(maxGrossUSD > 0)) {
    return null;
  }

  const quantity = normalizeStockQuantity(maxGrossUSD / normalizedPrice);
  if (!(quantity > 0)) {
    return null;
  }

  const quote = calculateBuyQuote({
    priceUSD: normalizedPrice,
    quantity,
    tradeFeeRate: normalizedFeeRate,
    tradeFeeMinUSD: normalizedFeeMinUSD,
  });

  if (!quote || quote.totalUSD > normalizedBudget) {
    return null;
  }

  return {
    ...quote,
    budgetUSD: normalizedBudget,
    unusedUSD: round4(normalizedBudget - quote.totalUSD),
  };
};
