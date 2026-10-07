"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_STOCK_POSITION_QUANTITY,
  MAX_STOCK_SNAPSHOT_SYMBOLS,
  getEligibleStockSnapshotQuantity,
} = require("../utils/stockSnapshotIntegrity");

const buildSnapshotInput = (overrides = {}) => ({
  snapshotId: "2026-07-28",
  pathClassId: "class-a",
  pathStudentId: "student-a",
  entitlementDateNY: "2026-07-28",
  symbol: "AAPL",
  snapshotData: {
    classId: "class-a",
    studentId: "student-a",
    snapshotDateNY: "2026-07-28",
    holdingSymbols: ["AAPL"],
    positionsBySymbol: { AAPL: 4.5 },
  },
  ...overrides,
});

test("accepts a stock snapshot only when path and payload ownership agree", () => {
  const quantity = getEligibleStockSnapshotQuantity(buildSnapshotInput());

  assert.equal(quantity, 4.5);
  assert.equal(
    getEligibleStockSnapshotQuantity(buildSnapshotInput({
      snapshotData: {
        classId: "class-b",
        studentId: "student-a",
        snapshotDateNY: "2026-07-28",
        holdingSymbols: ["AAPL"],
        positionsBySymbol: { AAPL: 4.5 },
      },
    })),
    null,
  );
});

test("rejects snapshot date and path identity mismatches", () => {
  assert.equal(
    getEligibleStockSnapshotQuantity(buildSnapshotInput({
      snapshotId: "2026-07-27",
    })),
    null,
  );
  assert.equal(
    getEligibleStockSnapshotQuantity(buildSnapshotInput({
      pathStudentId: "student-b",
    })),
    null,
  );
  assert.equal(
    getEligibleStockSnapshotQuantity(buildSnapshotInput({
      snapshotId: "2026-02-30",
      entitlementDateNY: "2026-02-30",
      snapshotData: {
        classId: "class-a",
        studentId: "student-a",
        snapshotDateNY: "2026-02-30",
        holdingSymbols: ["AAPL"],
        positionsBySymbol: { AAPL: 4.5 },
      },
    })),
    null,
  );
});

test("rejects unsafe stock position quantities and inconsistent symbol indexes", () => {
  for (const quantity of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0,
    -1,
    MAX_STOCK_POSITION_QUANTITY + 1,
  ]) {
    assert.equal(
      getEligibleStockSnapshotQuantity(buildSnapshotInput({
        snapshotData: {
          classId: "class-a",
          studentId: "student-a",
          snapshotDateNY: "2026-07-28",
          holdingSymbols: ["AAPL"],
          positionsBySymbol: { AAPL: quantity },
        },
      })),
      null,
    );
  }

  assert.equal(
    getEligibleStockSnapshotQuantity(buildSnapshotInput({
      snapshotData: {
        classId: "class-a",
        studentId: "student-a",
        snapshotDateNY: "2026-07-28",
        holdingSymbols: ["MSFT"],
        positionsBySymbol: { AAPL: 4.5 },
      },
    })),
    null,
  );
});

test("rejects oversized or malformed stock symbol indexes", () => {
  const oversizedSymbols = Array.from(
    { length: MAX_STOCK_SNAPSHOT_SYMBOLS + 1 },
    (_, index) => `S${index}`,
  );
  const oversizedPositions = Object.fromEntries(
    oversizedSymbols.map((symbol) => [symbol, 1]),
  );

  assert.equal(
    getEligibleStockSnapshotQuantity(buildSnapshotInput({
      symbol: "S0",
      snapshotData: {
        classId: "class-a",
        studentId: "student-a",
        snapshotDateNY: "2026-07-28",
        holdingSymbols: oversizedSymbols,
        positionsBySymbol: oversizedPositions,
      },
    })),
    null,
  );
  assert.equal(
    getEligibleStockSnapshotQuantity(buildSnapshotInput({
      symbol: "AAP L",
      snapshotData: {
        classId: "class-a",
        studentId: "student-a",
        snapshotDateNY: "2026-07-28",
        holdingSymbols: ["AAP L"],
        positionsBySymbol: { "AAP L": 1 },
      },
    })),
    null,
  );
});
