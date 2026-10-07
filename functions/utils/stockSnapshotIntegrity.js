"use strict";

const MAX_STOCK_POSITION_QUANTITY = 1_000_000_000_000;
const MAX_STOCK_SNAPSHOT_SYMBOLS = 500;
const STOCK_SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;

const normalizeIdentifier = (value) => String(value || "").trim();
const normalizeSymbol = (value) =>
  normalizeIdentifier(value).toUpperCase();

const isValidDateKey = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

const getEligibleStockSnapshotQuantity = ({
  snapshotId,
  pathClassId,
  pathStudentId,
  entitlementDateNY,
  symbol,
  snapshotData = {},
}) => {
  const normalizedSnapshotId = normalizeIdentifier(snapshotId);
  const normalizedClassId = normalizeIdentifier(pathClassId);
  const normalizedStudentId = normalizeIdentifier(pathStudentId);
  const normalizedEntitlementDate = normalizeIdentifier(entitlementDateNY);
  const normalizedSymbol = normalizeSymbol(symbol);
  const holdingSymbols = snapshotData.holdingSymbols;
  const positionsBySymbol = snapshotData.positionsBySymbol;

  if (
    !normalizedSnapshotId ||
    !normalizedClassId ||
    !normalizedStudentId ||
    !normalizedEntitlementDate ||
    !normalizedSymbol ||
    !isValidDateKey(normalizedSnapshotId) ||
    !isValidDateKey(normalizedEntitlementDate) ||
    normalizeIdentifier(snapshotData.classId) !== normalizedClassId ||
    normalizeIdentifier(snapshotData.studentId) !== normalizedStudentId ||
    normalizeIdentifier(snapshotData.snapshotDateNY) !== normalizedEntitlementDate ||
    normalizedSnapshotId !== normalizedEntitlementDate ||
    !STOCK_SYMBOL_PATTERN.test(normalizedSymbol) ||
    !Array.isArray(holdingSymbols) ||
    holdingSymbols.length === 0 ||
    holdingSymbols.length > MAX_STOCK_SNAPSHOT_SYMBOLS ||
    !holdingSymbols.includes(normalizedSymbol) ||
    !positionsBySymbol ||
    typeof positionsBySymbol !== "object" ||
    Array.isArray(positionsBySymbol)
  ) {
    return null;
  }

  const uniqueHoldingSymbols = new Set(holdingSymbols);
  const positionEntries = Object.entries(positionsBySymbol);
  if (
    uniqueHoldingSymbols.size !== holdingSymbols.length ||
    positionEntries.length !== holdingSymbols.length ||
    positionEntries.length > MAX_STOCK_SNAPSHOT_SYMBOLS ||
    holdingSymbols.some(
      (holdingSymbol) =>
        typeof holdingSymbol !== "string" ||
        !STOCK_SYMBOL_PATTERN.test(holdingSymbol),
    ) ||
    positionEntries.some(
      ([positionSymbol, positionQuantity]) =>
        !uniqueHoldingSymbols.has(positionSymbol) ||
        !STOCK_SYMBOL_PATTERN.test(positionSymbol) ||
        typeof positionQuantity !== "number" ||
        !Number.isFinite(positionQuantity) ||
        positionQuantity <= 0 ||
        positionQuantity > MAX_STOCK_POSITION_QUANTITY,
    )
  ) {
    return null;
  }

  const quantity = positionsBySymbol[normalizedSymbol];
  if (
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > MAX_STOCK_POSITION_QUANTITY
  ) {
    return null;
  }

  return quantity;
};

module.exports = {
  MAX_STOCK_POSITION_QUANTITY,
  MAX_STOCK_SNAPSHOT_SYMBOLS,
  getEligibleStockSnapshotQuantity,
};
