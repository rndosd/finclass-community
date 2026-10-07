const toSafeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

export const buildStockPriceMap = (allPrices = {}) => {
  const pricesFlatMap = {};

  Object.entries(allPrices || {}).forEach(([symbol, data]) => {
    const normalizedSymbol = String(symbol || "").trim().toUpperCase();
    if (normalizedSymbol) {
      pricesFlatMap[normalizedSymbol] = toSafeNumber(data?.current, 0);
    }
  });

  return pricesFlatMap;
};

export const buildPortfolioEntries = (
  portfolioMap = {},
  allPrices = {},
  options = {},
) => {
  const pricesFlatMap = buildStockPriceMap(allPrices);
  const fallbackToAveragePrice = options.fallbackToAveragePrice === true;

  const entries = Object.entries(portfolioMap || {}).map(([symbol, data]) => {
    const normalizedSymbol = String(symbol || data?.symbol || "")
      .trim()
      .toUpperCase();
    const quantity = toSafeNumber(data?.quantity, 0);
    const avgPriceUSD = toSafeNumber(
      data?.avgPriceUSD ?? data?.averagePriceUSD,
      0,
    );
    const priceFromMarket = pricesFlatMap[normalizedSymbol];
    const currentPriceUSD =
      typeof priceFromMarket === "number" && priceFromMarket > 0
        ? priceFromMarket
        : fallbackToAveragePrice
          ? avgPriceUSD
          : null;
    const totalInvestmentUSD = toSafeNumber(
      data?.totalInvestmentUSD,
      avgPriceUSD * quantity,
    );
    const evalAmountUSD =
      currentPriceUSD !== null ? currentPriceUSD * quantity : 0;
    const profitLossUSD = evalAmountUSD - totalInvestmentUSD;
    const profitRate =
      currentPriceUSD !== null && totalInvestmentUSD > 0
        ? (profitLossUSD / totalInvestmentUSD) * 100
        : 0;

    return {
      symbol: normalizedSymbol,
      ...data,
      companyName:
        data?.companyName || data?.name || normalizedSymbol || "알 수 없음",
      quantity,
      avgPriceUSD,
      averagePriceUSD: avgPriceUSD,
      currentPriceUSD,
      currentPrice: currentPriceUSD,
      totalInvestmentUSD,
      totalInvestedUSD: totalInvestmentUSD,
      evalAmountUSD,
      totalCurrentValueUSD: evalAmountUSD,
      profitLossUSD,
      profitRate: Number.isFinite(profitRate) ? profitRate : 0,
      profitLossPercentage: Number.isFinite(profitRate) ? profitRate : 0,
    };
  });

  return {
    pricesFlatMap,
    entries,
  };
};

export const buildPortfolioSummary = (entries = [], conversionRate = 1) => {
  const totalInvestedUSD = entries.reduce(
    (sum, entry) => sum + toSafeNumber(entry?.totalInvestmentUSD, 0),
    0,
  );
  const totalCurrentValueUSD = entries.reduce(
    (sum, entry) => sum + toSafeNumber(entry?.evalAmountUSD, 0),
    0,
  );
  const totalProfitLossUSD = totalCurrentValueUSD - totalInvestedUSD;
  const totalProfitRate =
    totalInvestedUSD > 0 ? (totalProfitLossUSD / totalInvestedUSD) * 100 : 0;
  const safeConversionRate = toSafeNumber(conversionRate, 1) || 1;

  return {
    totalInvestedUSD,
    totalCurrentValueUSD,
    totalProfitLossUSD,
    totalProfitRate,
    totalProfitLossPercentage: totalProfitRate,
    totalInvestedLocal: totalInvestedUSD / safeConversionRate,
    totalCurrentValueLocal: totalCurrentValueUSD / safeConversionRate,
    totalProfitLossLocal: totalProfitLossUSD / safeConversionRate,
    totalValueUSD: totalCurrentValueUSD,
    totalValueBIL: totalCurrentValueUSD / safeConversionRate,
    hasPositions: entries.length > 0,
  };
};
