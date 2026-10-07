"use strict";

const crypto = require("node:crypto");

const OBSERVATION_PERIODS_PER_YEAR = 52;
const LOOKBACK_PERIODS = 104;
const REQUIRED_PRICE_OBSERVATIONS = LOOKBACK_PERIODS + 1;
const MIN_CLASSIFIABLE_PRICE_OBSERVATIONS = 27;
const MIN_OBSERVED_PRICE_OBSERVATIONS = 3;
const RISK_OBSERVATION_INTERVAL = "weekly";
const RISK_MODEL_VERSION = "portfolio-weekly-volatility-v3";
const RISK_DETAILS_VERSION = "portfolio-risk-details-v1";

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function normalizeHoldings(holdings = []) {
  const merged = new Map();
  for (const holding of Array.isArray(holdings) ? holdings : []) {
    const symbol = String(holding?.symbol || "").trim().toUpperCase();
    const weightBps = Math.max(0, Math.round(Number(holding?.weightBps) || 0));
    if (!symbol || !weightBps) continue;
    merged.set(symbol, (merged.get(symbol) || 0) + weightBps);
  }
  return [...merged.entries()]
    .map(([symbol, weightBps]) => ({ symbol, weightBps }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function buildHoldingsHash(holdings = [], cashWeightBps = 0) {
  const payload = {
    holdings: normalizeHoldings(holdings),
    cashWeightBps: Math.max(0, Math.round(Number(cashWeightBps) || 0)),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

function normalizePriceSeries(points = []) {
  const byDate = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    const dateKey = String(point?.dateKey || point?.date || "");
    const price = Number(point?.adjustedClose ?? point?.adjClose ?? point?.price);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isFinite(price) || price <= 0) continue;
    byDate.set(dateKey, price);
  }
  return [...byDate.entries()]
    .map(([dateKey, price]) => ({ dateKey, price }))
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}

function sampleStandardDeviation(values = []) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// Target is 0% per week. The denominator includes every observation, not
// only losing weeks. This describes historical shortfall, not a loss forecast.
function calculateHistoricalDownside(values = []) {
  if (values.length < 2) return null;
  const squaredShortfalls = values.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0);
  // Rebase at each peak so long compounded paths cannot overflow.
  let relativeNav = 1;
  let maxDrawdown = 0;
  for (const value of values) {
    relativeNav = Math.min(1, relativeNav * (1 + value));
    maxDrawdown = Math.max(maxDrawdown, 1 - relativeNav);
  }
  return {
    annualizedDownsideDeviationPct: round4(Math.sqrt(squaredShortfalls / values.length) * Math.sqrt(OBSERVATION_PERIODS_PER_YEAR) * 100),
    historicalMaxDrawdownPct: round4(maxDrawdown * 100),
  };
}

function calculateConcentration(holdings, cashWeightBps) {
  const ranked = [...holdings].sort((left, right) => right.weightBps - left.weightBps || left.symbol.localeCompare(right.symbol));
  if (ranked.reduce((sum, holding) => sum + holding.weightBps, 0) + cashWeightBps !== 10000) return null;
  return {
    largestPosition: ranked[0] || null,
    top3WeightBps: ranked.slice(0, 3).reduce((sum, holding) => sum + holding.weightBps, 0),
    securityCount: ranked.length,
    cashWeightBps,
  };
}

function normalizeRiskThresholds(thresholds = null) {
  if (!thresholds || typeof thresholds !== "object") return null;
  const stableMaxPct = Number(thresholds.stableMaxPct);
  const neutralMaxPct = Number(thresholds.neutralMaxPct);
  if (
    !Number.isFinite(stableMaxPct)
    || !Number.isFinite(neutralMaxPct)
    || stableMaxPct < 0
    || stableMaxPct >= neutralMaxPct
  ) {
    return null;
  }
  return { stableMaxPct, neutralMaxPct };
}

function classifyAnnualizedVolatility(value, thresholds = null) {
  const normalizedThresholds = normalizeRiskThresholds(thresholds);
  if (!Number.isFinite(value) || !normalizedThresholds) return null;
  if (value <= normalizedThresholds.stableMaxPct) return "stable";
  if (value <= normalizedThresholds.neutralMaxPct) return "neutral";
  return "aggressive";
}

function makeUnavailable({ reason, holdingsHash, coverageWeightBps = 0, missingSymbols = [], datasetVersion = null }) {
  return {
    annualizedVolatilityPct: null,
    category: null,
    sampleStart: null,
    sampleEnd: null,
    observations: 0,
    historyQuality: null,
    coverageWeightBps,
    status: "unavailable",
    reason,
    missingSymbols,
    holdingsHash,
    datasetVersion,
    modelVersion: RISK_MODEL_VERSION,
    observationInterval: RISK_OBSERVATION_INTERVAL,
    lookbackPeriods: LOOKBACK_PERIODS,
  };
}

function calculatePortfolioRisk({
  holdings = [],
  cashWeightBps = 0,
  priceSeriesBySymbol = {},
  datasetVersion = null,
  thresholds = null,
  requiredPriceObservations = REQUIRED_PRICE_OBSERVATIONS,
  excludedSymbols = [],
} = {}) {
  const normalizedHoldings = normalizeHoldings(holdings);
  const holdingsHash = buildHoldingsHash(normalizedHoldings, cashWeightBps);
  const normalizedCashWeight = Math.max(0, Math.round(Number(cashWeightBps) || 0));
  const concentration = calculateConcentration(normalizedHoldings, normalizedCashWeight);
  const unavailable = (input) => ({
    ...makeUnavailable(input),
    riskDetailsVersion: RISK_DETAILS_VERSION,
    annualizedDownsideDeviationPct: null,
    historicalMaxDrawdownPct: null,
    concentration,
  });
  const totalWeightBps = normalizedHoldings.reduce((sum, holding) => sum + holding.weightBps, 0)
    + Math.max(0, Math.round(Number(cashWeightBps) || 0));
  if (totalWeightBps !== 10000) {
    return unavailable({ reason: "invalid_total_weight", holdingsHash, datasetVersion });
  }
  if (normalizedHoldings.length === 0) {
    return unavailable({
      reason: "cash_only_portfolio",
      holdingsHash,
      coverageWeightBps: Math.max(0, Math.round(Number(cashWeightBps) || 0)),
      datasetVersion,
    });
  }

  const exclusions = new Set(excludedSymbols);
  const identityConflicts = normalizedHoldings.filter((holding) => exclusions.has(holding.symbol)).map((holding) => holding.symbol);
  if (identityConflicts.length) {
    return unavailable({ reason: "security_identity_conflict", holdingsHash, missingSymbols: identityConflicts, datasetVersion });
  }

  const series = new Map();
  const missingSymbols = [];
  let coverageWeightBps = Math.max(0, Math.round(Number(cashWeightBps) || 0));
  for (const holding of normalizedHoldings) {
    const normalized = normalizePriceSeries(priceSeriesBySymbol?.[holding.symbol]);
    if (normalized.length < MIN_OBSERVED_PRICE_OBSERVATIONS) {
      missingSymbols.push(holding.symbol);
      continue;
    }
    series.set(holding.symbol, new Map(normalized.map((point) => [point.dateKey, point.price])));
    coverageWeightBps += holding.weightBps;
  }
  if (missingSymbols.length) {
    return unavailable({ reason: "missing_price_history", holdingsHash, coverageWeightBps, missingSymbols, datasetVersion });
  }

  const dateCounts = new Map();
  for (const priceMap of series.values()) {
    for (const dateKey of priceMap.keys()) dateCounts.set(dateKey, (dateCounts.get(dateKey) || 0) + 1);
  }
  const commonDates = [...dateCounts.entries()]
    .filter(([, count]) => count === normalizedHoldings.length)
    .map(([dateKey]) => dateKey)
    .sort()
    .slice(-requiredPriceObservations);
  if (commonDates.length < MIN_OBSERVED_PRICE_OBSERVATIONS) {
    return unavailable({ reason: "insufficient_common_dates", holdingsHash, coverageWeightBps, datasetVersion });
  }

  const portfolioReturns = [];
  for (let index = 1; index < commonDates.length; index += 1) {
    let portfolioReturn = 0;
    for (const holding of normalizedHoldings) {
      const priceMap = series.get(holding.symbol);
      const previous = priceMap.get(commonDates[index - 1]);
      const current = priceMap.get(commonDates[index]);
      portfolioReturn += (holding.weightBps / 10000) * ((current / previous) - 1);
    }
    portfolioReturns.push(portfolioReturn);
  }

  const periodVolatility = sampleStandardDeviation(portfolioReturns);
  if (!Number.isFinite(periodVolatility)) {
    return unavailable({ reason: "insufficient_returns", holdingsHash, coverageWeightBps, datasetVersion });
  }
  const annualizedVolatilityPct = round4(periodVolatility * Math.sqrt(OBSERVATION_PERIODS_PER_YEAR) * 100);
  const normalizedThresholds = normalizeRiskThresholds(thresholds);
  const minimumClassifiable = Math.min(MIN_CLASSIFIABLE_PRICE_OBSERVATIONS, requiredPriceObservations);
  const historyQuality = commonDates.length >= requiredPriceObservations ? "full"
    : commonDates.length >= minimumClassifiable ? "short" : "insufficient";
  const canClassify = historyQuality !== "insufficient";
  return {
    annualizedVolatilityPct,
    ...calculateHistoricalDownside(portfolioReturns),
    concentration,
    riskDetailsVersion: RISK_DETAILS_VERSION,
    category: canClassify ? classifyAnnualizedVolatility(annualizedVolatilityPct, normalizedThresholds) : null,
    sampleStart: commonDates[0],
    sampleEnd: commonDates.at(-1),
    observations: portfolioReturns.length,
    historyQuality,
    coverageWeightBps,
    status: !canClassify ? "limited_history" : normalizedThresholds ? "complete" : "pending_classification",
    reason: !canClassify ? "short_price_history" : normalizedThresholds ? null : "thresholds_not_configured",
    missingSymbols: [],
    holdingsHash,
    datasetVersion,
    modelVersion: RISK_MODEL_VERSION,
    observationInterval: RISK_OBSERVATION_INTERVAL,
    lookbackPeriods: LOOKBACK_PERIODS,
  };
}

module.exports = {
  REQUIRED_PRICE_OBSERVATIONS,
  MIN_CLASSIFIABLE_PRICE_OBSERVATIONS,
  MIN_OBSERVED_PRICE_OBSERVATIONS,
  LOOKBACK_PERIODS,
  OBSERVATION_PERIODS_PER_YEAR,
  RISK_OBSERVATION_INTERVAL,
  RISK_MODEL_VERSION,
  RISK_DETAILS_VERSION,
  buildHoldingsHash,
  calculatePortfolioRisk,
  classifyAnnualizedVolatility,
  normalizePriceSeries,
  normalizeRiskThresholds,
  sampleStandardDeviation,
};
