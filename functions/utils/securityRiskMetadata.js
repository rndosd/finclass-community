"use strict";

const { STOCK_CATALOG_BY_TICKER } = require("./stockCatalog");
const { VERIFIED_STRUCTURE_VERSION, getVerifiedStructure } = require("./verifiedSecurityStructures");

function getPortfolioStructureTags(holdings = [], catalogByTicker = STOCK_CATALOG_BY_TICKER) {
  const tagWeights = new Map();
  for (const holding of Array.isArray(holdings) ? holdings : []) {
    const symbol = String(holding?.symbol || "").trim().toUpperCase();
    const weightBps = Math.max(0, Math.round(Number(holding?.weightBps) || 0));
    const entry = catalogByTicker.get(symbol);
    const verified = getVerifiedStructure(symbol);
    const tags = new Set(Array.isArray(entry?.riskTags) ? entry.riskTags : []);
    if (verified) {
      tags.add("인버스");
      tags.add("일일 -1배");
    }
    for (const tag of tags) {
      const normalized = String(tag || "").trim();
      if (normalized) tagWeights.set(normalized, (tagWeights.get(normalized) || 0) + weightBps);
    }
  }
  return [...tagWeights.entries()]
    .map(([label, weightBps]) => ({ label, weightBps }))
    .sort((left, right) => right.weightBps - left.weightBps || left.label.localeCompare(right.label, "ko"));
}

function getPortfolioStructureEvidence(holdings = []) {
  let verifiedWeightBps = 0;
  let unverifiedWeightBps = 0;
  for (const holding of Array.isArray(holdings) ? holdings : []) {
    const symbol = String(holding?.symbol || "").trim().toUpperCase();
    const weightBps = Math.max(0, Math.round(Number(holding?.weightBps) || 0));
    if (getVerifiedStructure(symbol)) verifiedWeightBps += weightBps;
    else unverifiedWeightBps += weightBps;
  }
  return { version: VERIFIED_STRUCTURE_VERSION, verifiedWeightBps, unverifiedWeightBps };
}

module.exports = { getPortfolioStructureTags, getPortfolioStructureEvidence };
