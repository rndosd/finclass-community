"use strict";

const {
  calculatePortfolioRisk,
  REQUIRED_PRICE_OBSERVATIONS,
  RISK_MODEL_VERSION,
  RISK_OBSERVATION_INTERVAL,
} = require("./portfolioRisk");
const { getPortfolioStructureTags, getPortfolioStructureEvidence } = require("./securityRiskMetadata");
const { IDENTITY_CONFLICT_SYMBOLS } = require("./verifiedSecurityStructures");

// Apply the same identity quarantine to previews, approvals and scheduled refreshes.
function calculateVerifiedPortfolioRisk(input) {
  return calculatePortfolioRisk({ ...input, excludedSymbols: IDENTITY_CONFLICT_SYMBOLS });
}

const ACTIVE_RISK_CONFIG_PATH = "riskConfig/active";
const COMPARABLE_RISK_FIELDS = [
  "annualizedVolatilityPct",
  "category",
  "sampleStart",
  "sampleEnd",
  "observations",
  "historyQuality",
  "coverageWeightBps",
  "status",
  "reason",
  "missingSymbols",
  "holdingsHash",
  "datasetVersion",
  "modelVersion",
  "observationInterval",
  "lookbackPeriods",
  "structureTags",
  "riskDetailsVersion",
  "annualizedDownsideDeviationPct",
  "historicalMaxDrawdownPct",
  "concentration",
  "structureEvidence",
];

function comparableRiskSummary(value = {}) {
  return Object.fromEntries(COMPARABLE_RISK_FIELDS.map((field) => [field, value?.[field] ?? null]));
}

function areRiskSummariesEquivalent(left = {}, right = {}) {
  return JSON.stringify(comparableRiskSummary(left)) === JSON.stringify(comparableRiskSummary(right));
}

async function calculateFundRiskForConfig(
  db,
  config = {},
  { holdings = [], cashWeightBps = 0 } = {},
  { reader = null } = {},
) {
  const structureTags = getPortfolioStructureTags(holdings);
  const structureEvidence = getPortfolioStructureEvidence(holdings);
  const datasetVersion = String(config.datasetVersion || "").trim();
  if (!datasetVersion || config.status !== "active") {
    return { ...calculateVerifiedPortfolioRisk({ holdings, cashWeightBps, datasetVersion: datasetVersion || null }), structureTags, structureEvidence };
  }
  if (config.modelVersion !== RISK_MODEL_VERSION) {
    return {
      ...calculateVerifiedPortfolioRisk({ holdings, cashWeightBps, datasetVersion }),
      status: "unavailable",
      reason: "unsupported_model_version",
      structureTags,
      structureEvidence,
    };
  }

  const datasetRef = db.doc(`riskDatasets/${datasetVersion}`);
  const datasetSnap = reader ? await reader.get(datasetRef) : await datasetRef.get();
  if (!datasetSnap.exists || datasetSnap.data()?.status !== "complete") {
    return {
      ...calculateVerifiedPortfolioRisk({ holdings, cashWeightBps, datasetVersion }),
      reason: "dataset_not_ready",
      structureTags,
      structureEvidence,
    };
  }
  const datasetMetadata = datasetSnap.data() || {};
  if (
    datasetMetadata.modelVersion !== RISK_MODEL_VERSION
    || datasetMetadata.observationInterval !== RISK_OBSERVATION_INTERVAL
    || Number(datasetMetadata.requiredPriceObservations) !== REQUIRED_PRICE_OBSERVATIONS
  ) {
    return {
      ...calculateVerifiedPortfolioRisk({ holdings, cashWeightBps, datasetVersion }),
      status: "unavailable",
      reason: "dataset_model_mismatch",
      structureTags,
      structureEvidence,
    };
  }

  const symbols = [...new Set(holdings.map((holding) => String(holding?.symbol || "").trim().toUpperCase()).filter(Boolean))];
  const refs = symbols.map((symbol) => db.doc(`riskDatasets/${datasetVersion}/securities/${symbol}`));
  const snapshots = refs.length
    ? await (reader ? reader.getAll(...refs) : db.getAll(...refs))
    : [];
  const priceSeriesBySymbol = {};
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) return;
    const data = snapshot.data() || {};
    priceSeriesBySymbol[symbols[index]] = Array.isArray(data.prices) ? data.prices : [];
  });

  return { ...calculateVerifiedPortfolioRisk({
    holdings,
    cashWeightBps,
    priceSeriesBySymbol,
    datasetVersion,
    thresholds: config.thresholds || null,
  }), structureTags, structureEvidence };
}

async function calculateActiveFundRisk(
  db,
  input = {},
  { reader = null } = {},
) {
  const configRef = db.doc(ACTIVE_RISK_CONFIG_PATH);
  const configSnap = reader ? await reader.get(configRef) : await configRef.get();
  if (!configSnap.exists) {
    const structureTags = getPortfolioStructureTags(input.holdings);
    return { ...calculateVerifiedPortfolioRisk(input), structureTags, structureEvidence: getPortfolioStructureEvidence(input.holdings) };
  }
  return calculateFundRiskForConfig(db, configSnap.data() || {}, input, { reader });
}

function buildFailedRiskSummary(input = {}) {
  const structureTags = getPortfolioStructureTags(input.holdings);
  return {
    ...calculateVerifiedPortfolioRisk({
      holdings: input.holdings,
      cashWeightBps: input.cashWeightBps,
    }),
    status: "unavailable",
    reason: "risk_calculation_failed",
    structureTags,
    structureEvidence: getPortfolioStructureEvidence(input.holdings),
  };
}

async function calculateActiveFundRiskSafe(
  db,
  input = {},
  { logger = console, reader = null } = {},
) {
  try {
    return await calculateActiveFundRisk(db, input, { reader });
  } catch (error) {
    logger?.error?.("[fundRisk] calculation unavailable", {
      code: error?.code || null,
      message: String(error?.message || "unknown error").slice(0, 200),
    });
    return buildFailedRiskSummary(input);
  }
}

async function calculateFundRiskForConfigSafe(
  db,
  config = {},
  input = {},
  { logger = console, reader = null } = {},
) {
  try {
    return await calculateFundRiskForConfig(db, config, input, { reader });
  } catch (error) {
    logger?.error?.("[fundRisk] fixed-config calculation unavailable", {
      code: error?.code || null,
      message: String(error?.message || "unknown error").slice(0, 200),
    });
    return buildFailedRiskSummary(input);
  }
}

module.exports = {
  ACTIVE_RISK_CONFIG_PATH,
  areRiskSummariesEquivalent,
  calculateActiveFundRisk,
  calculateActiveFundRiskSafe,
  calculateFundRiskForConfig,
  calculateFundRiskForConfigSafe,
};
