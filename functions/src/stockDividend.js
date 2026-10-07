"use strict";

const admin = require("../firebaseAdminCompat");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const axios = require("axios");

const db = admin.firestore();

const { getPrefetchContext, US_STOCK_MARKET_HOLIDAYS } = require("../utils/prefetchUtils");
const { getGlobalConfig } = require("../utils/planManager");
const { getMarketConfig } = require("../utils/marketConfig");
const { stageActivityLog } = require("../utils/logUtils");
const { stageTaxIncome } = require("../utils/taxIncome");
const { getWithholdingPolicy } = require("../utils/taxPolicy");
const { buildIncomeTaxSnapshot } = require("../utils/incomeTaxUtils");
const {
  ensureStockJobIndexBootstrapped,
  getClassesWithStockHolders,
  getHeldSymbolsAcrossClasses,
} = require("../utils/stockJobIndex");
const {
  getEligibleStockSnapshotQuantity,
} = require("../utils/stockSnapshotIntegrity");

const alphaVantageApiKeyParam = defineSecret("ALPHA_VANTAGE_API_KEY");

const DIVIDEND_EVENTS_COLLECTION = "stockDividendEvents";
const DIVIDEND_SUMMARY_COLLECTION = "stockDividendSummary";
const DIVIDEND_SUMMARY_DOC = "upcoming_by_symbol";
const DIVIDEND_SYNC_STATE_COLLECTION = "stockDividendSyncState";
const DIVIDEND_POLICY_COLLECTION = "stockDividendPolicies";
const STOCK_SNAPSHOT_STATUS_COLLECTION = "stockSnapshotStatus";
const CLASS_POLICY_PROCESSING_BACKFILL_DOC = "__classPolicyNextProcessingBackfill";
const BATCH_WRITE_LIMIT = 350;
const ALPHA_VANTAGE_API_URL = "https://www.alphavantage.co/query";
const ALPHA_VANTAGE_DAILY_REQUEST_LIMIT = 25;
const HOT_SYNC_REQUEST_LIMIT = 12;
const COLD_SYNC_REQUEST_LIMIT = 6;
const REQUEST_DELAY_MS = 15000;
const LOOKBACK_DAYS = 180;
const LOOKAHEAD_DAYS = 180;
const URGENT_SYNC_SLOT_LIMIT = 4;
const PRIORITY_SYNC_SLOT_LIMIT = 6;
const DISCOVERY_SYNC_SLOT_LIMIT = 13;
const COLD_SYNC_SLOT_LIMIT = 2;
const UPCOMING_EVENT_URGENT_WINDOW_DAYS = 14;
const CORE_DIVIDEND_SYMBOLS = new Set([
  "TLT",
  "NOBL",
  "DIA",
  "SCHD",
  "DGRO",
  "ABBV",
  "VZ",
  "MO",
  "O",
  "VNQ",
  "HDV",
  "T",
  "PM",
  "SO",
  "DUK",
  "SPY",
]);
const SOURCE_EVENT_RETRY_WINDOW_DAYS = 3;
const DEFAULT_SYNC_LANE_ORDER = ["urgent", "priority", "discovery", "cold"];

const asNum = (value, fallback = 0) => {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
};

const round4 = (value) => Math.round(asNum(value) * 10000) / 10000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatDateKey = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDateKeyInTimeZone = (timeZone, now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  const day = parts.find((part) => part.type === "day")?.value || "00";
  return `${year}-${month}-${day}`;
};

const parseDateKey = (value) => {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const offsetDateKey = (dateKey, amount) => {
  const baseDate = parseDateKey(dateKey);
  if (!baseDate) return null;
  baseDate.setUTCDate(baseDate.getUTCDate() + amount);
  return formatDateKey(baseDate);
};

const isTradingHolidayKey = (dateKey) => {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return true;
  const weekday = parsed.getUTCDay();
  if (weekday === 0 || weekday === 6) return true;
  return US_STOCK_MARKET_HOLIDAYS.has(dateKey);
};

const getPreviousTradingDateKey = (dateKey) => {
  let cursor = offsetDateKey(dateKey, -1);
  while (cursor && isTradingHolidayKey(cursor)) {
    cursor = offsetDateKey(cursor, -1);
  }
  return cursor;
};

const getNextTradingDateKey = (dateKey) => {
  let cursor = normalizeDateKey(dateKey);
  while (cursor && isTradingHolidayKey(cursor)) {
    cursor = offsetDateKey(cursor, 1);
  }
  return cursor;
};

const normalizeDateKey = (...candidates) => {
  for (const candidate of candidates) {
    const normalized = parseDateKey(candidate);
    if (normalized) {
      return formatDateKey(normalized);
    }
  }
  return null;
};

const compareDateKeys = (left, right) =>
  String(left || "").localeCompare(String(right || ""));

const getDateKeyDiffDays = (fromDateKey, toDateKey) => {
  const fromDate = parseDateKey(fromDateKey);
  const toDate = parseDateKey(toDateKey);
  if (!fromDate || !toDate) return null;
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
};

const minDateKey = (...candidates) =>
  candidates
    .map((candidate) => normalizeDateKey(candidate))
    .filter(Boolean)
    .sort(compareDateKeys)[0] || null;

const maxDateKey = (...candidates) =>
  candidates
    .map((candidate) => normalizeDateKey(candidate))
    .filter(Boolean)
    .sort(compareDateKeys)
    .slice(-1)[0] || null;

const buildDividendEventId = ({ symbol, exDateNY, payDateNY, amountUSDPerShare }) => {
  const amountToken = String(Math.round(asNum(amountUSDPerShare) * 1000000));
  return `${symbol}__${exDateNY || "na"}__${payDateNY || "na"}__${amountToken}`
    .replace(/[^A-Za-z0-9_-]+/g, "_");
};

const getFrequencyLabel = (gapDays) => {
  if (!Number.isFinite(gapDays)) return null;
  if (gapDays <= 45) return "Monthly dividend";
  if (gapDays <= 120) return "Quarterly dividend";
  if (gapDays <= 220) return "Semiannual dividend";
  return "Annual dividend";
};

const computeFrequencyLabel = (events = []) => {
  const sortedKeys = events
    .map((event) => event.exDateNY)
    .filter(Boolean)
    .sort();

  if (sortedKeys.length < 2) return null;

  const gaps = [];
  for (let index = 1; index < sortedKeys.length; index += 1) {
    const previous = parseDateKey(sortedKeys[index - 1]);
    const current = parseDateKey(sortedKeys[index]);
    if (!previous || !current) continue;
    const diffDays = Math.round((current.getTime() - previous.getTime()) / 86400000);
    if (diffDays > 0) {
      gaps.push(diffDays);
    }
  }

  if (gaps.length === 0) return null;

  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  return getFrequencyLabel(averageGap);
};

const getUpcomingDividendEventSortKey = (event, targetDateKey) => {
  if (!event) return null;
  if (event.exDateNY && event.exDateNY < targetDateKey && event.payDateNY) {
    return event.payDateNY;
  }
  return event.exDateNY || event.payDateNY || null;
};

const getUpcomingDividendEvent = (events = [], targetDateKey) =>
  [...events]
    .filter((event) => {
      if (event.payDateNY && event.payDateNY >= targetDateKey) return true;
      return event.exDateNY && event.exDateNY >= targetDateKey;
    })
    .sort((left, right) =>
      compareDateKeys(
        getUpcomingDividendEventSortKey(left, targetDateKey),
        getUpcomingDividendEventSortKey(right, targetDateKey),
      ),
    )[0] || null;

const getLatestDividendEventDateKey = (events = []) =>
  events.reduce(
    (latestDateKey, event) =>
      maxDateKey(
        latestDateKey,
        event.payDateNY,
        event.recordDateNY,
        event.exDateNY,
        event.declarationDateNY,
      ),
    null,
  );

const normalizeDividendEvent = (symbol, rawEvent = {}, source = "alphavantage") => {
  const normalizedSymbol = String(symbol || rawEvent.symbol || "")
    .trim()
    .toUpperCase();
  if (!normalizedSymbol) return null;

  const amountUSDPerShare = round4(
    rawEvent.amount ??
      rawEvent.dividend ??
      rawEvent.adjDividend ??
      rawEvent.cashAmount ??
      rawEvent.value ??
      0,
  );
  const exDateNY = normalizeDateKey(
    rawEvent.date,
    rawEvent.exDate,
    rawEvent.exDividendDate,
    rawEvent.exDividendDateNY,
    rawEvent.ex_dividend_date,
  );

  if (!exDateNY || !(amountUSDPerShare > 0)) {
    return null;
  }

  return {
    symbol: normalizedSymbol,
    amountUSDPerShare,
    adjustedAmountUSDPerShare: round4(
      rawEvent.adjustedAmount ??
        rawEvent.adjustedDividend ??
        rawEvent.adjDividend ??
        amountUSDPerShare,
    ),
    exDateNY,
    payDateNY: normalizeDateKey(
      rawEvent.payDate,
      rawEvent.paymentDate,
      rawEvent.payableDate,
      rawEvent.payment_date,
    ),
    recordDateNY: normalizeDateKey(
      rawEvent.recordDate,
      rawEvent.recordDateNY,
      rawEvent.record_date,
    ),
    declarationDateNY: normalizeDateKey(
      rawEvent.declarationDate,
      rawEvent.declaredDate,
      rawEvent.declaration_date,
    ),
    currency: String(rawEvent.currency || "USD").trim().toUpperCase() || "USD",
    rawFrequency:
      String(rawEvent.freq || rawEvent.frequency || rawEvent.Frequency || "").trim() || null,
    source,
  };
};

const getDividendTargetSymbols = async () => {
  const snap = await db.collection("stockCategories").get();
  const symbols = new Set();

  snap.forEach((docSnap) => {
    if (docSnap.id === "crypto_coin") return;
    const { symbols: categorySymbols = [] } = docSnap.data() || {};
    categorySymbols.forEach((item) => {
      const ticker = String(item?.ticker || "").trim().toUpperCase();
      if (ticker) {
        symbols.add(ticker);
      }
    });
  });

  return Array.from(symbols).sort();
};

const getHeldDividendSymbols = async () => {
  return getHeldSymbolsAcrossClasses();
};

const getDividendSyncStateMap = async () => {
  const snap = await db.collection(DIVIDEND_SYNC_STATE_COLLECTION).get();
  const stateMap = new Map();
  snap.forEach((docSnap) => {
    stateMap.set(docSnap.id, docSnap.data() || {});
  });
  return stateMap;
};

const compareSyncCandidates = (left, right) => {
  const leftUpcomingDistance =
    Number.isFinite(left.upcomingEventDistanceDays) ?
      left.upcomingEventDistanceDays :
      Number.POSITIVE_INFINITY;
  const rightUpcomingDistance =
    Number.isFinite(right.upcomingEventDistanceDays) ?
      right.upcomingEventDistanceDays :
      Number.POSITIVE_INFINITY;
  if (leftUpcomingDistance !== rightUpcomingDistance) {
    return leftUpcomingDistance - rightUpcomingDistance;
  }

  const leftChecked = left.hasChecked ? 1 : 0;
  const rightChecked = right.hasChecked ? 1 : 0;
  if (leftChecked !== rightChecked) {
    return leftChecked - rightChecked;
  }

  const leftHeld = left.isHeld ? 1 : 0;
  const rightHeld = right.isHeld ? 1 : 0;
  if (leftHeld !== rightHeld) {
    return rightHeld - leftHeld;
  }

  const leftCore = left.isCore ? 1 : 0;
  const rightCore = right.isCore ? 1 : 0;
  if (leftCore !== rightCore) {
    return rightCore - leftCore;
  }

  const leftCheckedAt = left.lastCheckedAt || "";
  const rightCheckedAt = right.lastCheckedAt || "";
  if (leftCheckedAt !== rightCheckedAt) {
    return leftCheckedAt.localeCompare(rightCheckedAt);
  }

  const leftEmptyCount = asNum(left.emptyResultCount, 0);
  const rightEmptyCount = asNum(right.emptyResultCount, 0);
  if (leftEmptyCount !== rightEmptyCount) {
    return leftEmptyCount - rightEmptyCount;
  }

  return left.symbol.localeCompare(right.symbol);
};

const getSyncLane = (candidate) => {
  if (
    Number.isFinite(candidate.upcomingEventDistanceDays) &&
    candidate.upcomingEventDistanceDays <= UPCOMING_EVENT_URGENT_WINDOW_DAYS
  ) {
    return "urgent";
  }

  if (candidate.isHeld || candidate.isCore || candidate.hasKnownEvents) {
    return "priority";
  }

  if (!candidate.hasChecked || candidate.emptyResultCount <= 2) {
    return "discovery";
  }

  return "cold";
};

const selectSymbolsForDividendSync = ({
  symbols,
  heldSymbols,
  stateBySymbol,
  marketDateKey,
  currentDateKey,
  limit = ALPHA_VANTAGE_DAILY_REQUEST_LIMIT,
  allowedLanes = DEFAULT_SYNC_LANE_ORDER,
  includeFallback = true,
}) => {
  const bucketTemplate = () => ({
    urgent: [],
    priority: [],
    discovery: [],
    cold: [],
  });
  const dueBuckets = bucketTemplate();
  const fallbackBuckets = bucketTemplate();
  const laneQuotas = {
    urgent: URGENT_SYNC_SLOT_LIMIT,
    priority: PRIORITY_SYNC_SLOT_LIMIT,
    discovery: DISCOVERY_SYNC_SLOT_LIMIT,
    cold: COLD_SYNC_SLOT_LIMIT,
  };
  const laneOrder = DEFAULT_SYNC_LANE_ORDER.filter((lane) =>
    allowedLanes.includes(lane),
  );

  if (laneOrder.length === 0 || limit <= 0) {
    return {
      selectedCandidates: [],
      selectionMeta: {
        dueCounts: {},
        fallbackCounts: {},
        selectedCounts: {},
      },
    };
  }

  symbols.forEach((symbol) => {
    const state = stateBySymbol.get(symbol) || {};
    const isHeld = heldSymbols.has(symbol);
    const isCore = CORE_DIVIDEND_SYMBOLS.has(symbol);
    const nextCheckAt = String(state.nextCheckAt || "").trim() || null;
    const hasChecked = Boolean(String(state.lastCheckedAt || "").trim());
    const nextUpcomingEventDate = normalizeDateKey(
      state.nextUpcomingEventDate,
      state.nextUpcomingPayDateNY,
      state.nextUpcomingExDateNY,
    );
    const eventCount = Math.max(0, asNum(state.eventCount, 0));
    const emptyResultCount = Math.max(0, asNum(state.emptyResultCount, 0));
    const candidate = {
      symbol,
      isHeld,
      isCore,
      hasChecked,
      hasKnownEvents: eventCount > 0 || Boolean(nextUpcomingEventDate),
      eventCount,
      emptyResultCount,
      lastCheckedAt: String(state.lastCheckedAt || "").trim() || "",
      nextUpcomingEventDate,
      upcomingEventDistanceDays: getDateKeyDiffDays(
        marketDateKey,
        nextUpcomingEventDate,
      ),
    };
    candidate.lane = getSyncLane(candidate);
    candidate.isDue = !nextCheckAt || nextCheckAt <= currentDateKey;

    if (candidate.isDue) {
      dueBuckets[candidate.lane].push(candidate);
      return;
    }

    fallbackBuckets[candidate.lane].push(candidate);
  });

  laneOrder.forEach((lane) => {
    dueBuckets[lane].sort(compareSyncCandidates);
    fallbackBuckets[lane].sort(compareSyncCandidates);
  });

  const selected = [];
  const selectedSet = new Set();
  const selectedCounts = {
    urgent: 0,
    priority: 0,
    discovery: 0,
    cold: 0,
  };
  const take = (list, lane, countLimit = Number.POSITIVE_INFINITY) => {
    for (const item of list) {
      if (selected.length >= limit || countLimit <= 0) break;
      if (selectedSet.has(item.symbol)) continue;
      selected.push(item);
      selectedSet.add(item.symbol);
      selectedCounts[lane] += 1;
      countLimit -= 1;
    }
    return countLimit;
  };

  laneOrder.forEach((lane) => {
    take(dueBuckets[lane], lane, laneQuotas[lane]);
  });

  laneOrder.forEach((lane) => {
    take(dueBuckets[lane], lane, limit - selected.length);
  });

  if (includeFallback) {
    laneOrder.forEach((lane) => {
      take(fallbackBuckets[lane], lane, limit - selected.length);
    });
  }

  return {
    selectedCandidates: selected,
    selectionMeta: {
      dueCounts: Object.fromEntries(
        laneOrder.map((lane) => [lane, dueBuckets[lane].length]),
      ),
      fallbackCounts: Object.fromEntries(
        laneOrder.map((lane) => [lane, fallbackBuckets[lane].length]),
      ),
      selectedCounts,
    },
  };
};

const computeNextCheckPlan = ({
  symbol,
  normalizedEvents,
  heldSymbols,
  frequencyLabel,
  currentDateKey,
  marketDateKey,
  previousState = {},
}) => {
  const isPrioritySymbol =
    heldSymbols.has(symbol) || CORE_DIVIDEND_SYMBOLS.has(symbol);
  const previousEmptyResultCount = Math.max(
    0,
    asNum(previousState.emptyResultCount, 0),
  );
  const emptyResultCount =
    normalizedEvents.length > 0 ? 0 : previousEmptyResultCount + 1;
  const upcomingEvent = getUpcomingDividendEvent(normalizedEvents, marketDateKey);
  const nextUpcomingEventDate = getUpcomingDividendEventSortKey(
    upcomingEvent,
    marketDateKey,
  );
  const upcomingEventDistanceDays = getDateKeyDiffDays(
    marketDateKey,
    nextUpcomingEventDate,
  );

  if (
    Number.isFinite(upcomingEventDistanceDays) &&
    upcomingEventDistanceDays <= 3
  ) {
    return {
      nextCheckAt: offsetDateKey(currentDateKey, 1),
      nextCheckReason: "event_within_3_days",
      emptyResultCount,
      nextUpcomingEventDate,
      upcomingEvent,
    };
  }

  if (
    Number.isFinite(upcomingEventDistanceDays) &&
    upcomingEventDistanceDays <= UPCOMING_EVENT_URGENT_WINDOW_DAYS
  ) {
    return {
      nextCheckAt: offsetDateKey(currentDateKey, isPrioritySymbol ? 2 : 4),
      nextCheckReason: "event_within_14_days",
      emptyResultCount,
      nextUpcomingEventDate,
      upcomingEvent,
    };
  }

  if (normalizedEvents.length > 0) {
    if (isPrioritySymbol) {
      return {
        nextCheckAt: offsetDateKey(currentDateKey, 7),
        nextCheckReason: "priority_symbol_with_events",
        emptyResultCount,
        nextUpcomingEventDate,
        upcomingEvent,
      };
    }

    if (frequencyLabel === "Monthly dividend") {
      return {
        nextCheckAt: offsetDateKey(currentDateKey, 14),
        nextCheckReason: "monthly_dividend",
        emptyResultCount,
        nextUpcomingEventDate,
        upcomingEvent,
      };
    }

    if (frequencyLabel === "Quarterly dividend") {
      return {
        nextCheckAt: offsetDateKey(currentDateKey, 30),
        nextCheckReason: "quarterly_dividend",
        emptyResultCount,
        nextUpcomingEventDate,
        upcomingEvent,
      };
    }

    if (frequencyLabel === "Semiannual dividend") {
      return {
        nextCheckAt: offsetDateKey(currentDateKey, 45),
        nextCheckReason: "semiannual_dividend",
        emptyResultCount,
        nextUpcomingEventDate,
        upcomingEvent,
      };
    }

    return {
      nextCheckAt: offsetDateKey(currentDateKey, 60),
      nextCheckReason: "annual_or_irregular_dividend",
      emptyResultCount,
      nextUpcomingEventDate,
      upcomingEvent,
    };
  }

  if (isPrioritySymbol) {
    if (emptyResultCount <= 1) {
      return {
        nextCheckAt: offsetDateKey(currentDateKey, 7),
        nextCheckReason: "priority_symbol_first_empty",
        emptyResultCount,
        nextUpcomingEventDate: null,
        upcomingEvent: null,
      };
    }

    if (emptyResultCount <= 3) {
      return {
        nextCheckAt: offsetDateKey(currentDateKey, 14),
        nextCheckReason: "priority_symbol_repeat_empty",
        emptyResultCount,
        nextUpcomingEventDate: null,
        upcomingEvent: null,
      };
    }

    return {
      nextCheckAt: offsetDateKey(currentDateKey, 30),
      nextCheckReason: "priority_symbol_cold_empty",
      emptyResultCount,
      nextUpcomingEventDate: null,
      upcomingEvent: null,
    };
  }

  if (emptyResultCount <= 1) {
    return {
      nextCheckAt: offsetDateKey(currentDateKey, 14),
      nextCheckReason: "discovery_first_empty",
      emptyResultCount,
      nextUpcomingEventDate: null,
      upcomingEvent: null,
    };
  }

  if (emptyResultCount <= 3) {
    return {
      nextCheckAt: offsetDateKey(currentDateKey, 45),
      nextCheckReason: "discovery_repeat_empty",
      emptyResultCount,
      nextUpcomingEventDate: null,
      upcomingEvent: null,
    };
  }

  return {
    nextCheckAt: offsetDateKey(currentDateKey, 90),
    nextCheckReason: "cold_non_payer_backoff",
    emptyResultCount,
    nextUpcomingEventDate: null,
    upcomingEvent: null,
  };
};
const buildAlphaVantageEvents = (payload = {}) => {
  if (payload.Note) {
    const error = new Error(payload.Note);
    error.code = "alpha_vantage_note";
    throw error;
  }
  if (payload.Information) {
    const error = new Error(payload.Information);
    error.code = "alpha_vantage_information";
    throw error;
  }
  if (payload["Error Message"]) {
    const error = new Error(payload["Error Message"]);
    error.code = "alpha_vantage_error";
    throw error;
  }
  return Array.isArray(payload.data) ? payload.data : [];
};

const filterDividendEventsByWindow = ({ events, fromDate, toDate }) =>
  events.filter((event) => {
    const exDateNY = event.exDateNY || null;
    const payDateNY = event.payDateNY || null;
    const isExDateInRange = exDateNY && exDateNY >= fromDate && exDateNY <= toDate;
    const isPayDateInRange = payDateNY && payDateNY >= fromDate && payDateNY <= toDate;
    return Boolean(isExDateInRange || isPayDateInRange);
  });

const chunkArray = (items = [], size = 30) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const normalizeSymbolList = (symbols = []) =>
  [...new Set(
    symbols
      .map((symbol) => String(symbol || "").trim().toUpperCase())
      .filter(Boolean),
  )].sort();

const collectDividendEventsBySymbol = (snap, source = "alphavantage") => {
  const eventsBySymbol = {};

  snap.forEach((docSnap) => {
    const event = docSnap.data() || {};
    if (source && String(event.source || "").trim() !== source) {
      return;
    }
    const symbol = String(event.symbol || "").trim().toUpperCase();
    if (!symbol) return;
    if (!eventsBySymbol[symbol]) {
      eventsBySymbol[symbol] = [];
    }
    eventsBySymbol[symbol].push({
      ...event,
      eventId: event.eventId || docSnap.id,
    });
  });

  Object.values(eventsBySymbol).forEach((events) => {
    events.sort((left, right) => String(left.exDateNY || "").localeCompare(String(right.exDateNY || "")));
  });

  return eventsBySymbol;
};

const loadPersistedDividendEventsBySymbol = async (source = "alphavantage", symbols = null) => {
  const normalizedSymbols = Array.isArray(symbols) ? normalizeSymbolList(symbols) : null;

  if (normalizedSymbols && normalizedSymbols.length === 0) {
    return {};
  }

  if (!normalizedSymbols) {
    const snap = await db
      .collection(DIVIDEND_EVENTS_COLLECTION)
      .where("source", "==", source)
      .get();
    return collectDividendEventsBySymbol(snap, source);
  }

  const mergedEventsBySymbol = {};
  for (const symbolChunk of chunkArray(normalizedSymbols, 30)) {
    const snap = await db
      .collection(DIVIDEND_EVENTS_COLLECTION)
      .where("symbol", "in", symbolChunk)
      .get();
    const chunkEventsBySymbol = collectDividendEventsBySymbol(snap, source);
    Object.entries(chunkEventsBySymbol).forEach(([symbol, events]) => {
      if (!mergedEventsBySymbol[symbol]) {
        mergedEventsBySymbol[symbol] = [];
      }
      mergedEventsBySymbol[symbol].push(...events);
    });
  }

  Object.values(mergedEventsBySymbol).forEach((events) => {
    events.sort((left, right) => String(left.exDateNY || "").localeCompare(String(right.exDateNY || "")));
  });

  return mergedEventsBySymbol;
};

const buildUpcomingDividendSummary = ({ eventsBySymbol, targetNY }) => {
  const summary = {};

  Object.entries(eventsBySymbol).forEach(([symbol, events]) => {
    const frequencyLabel = computeFrequencyLabel(events);
    const upcomingEvent = getUpcomingDividendEvent(events, targetNY);

    if (!upcomingEvent) return;

    summary[symbol] = {
      eventId: upcomingEvent.eventId,
      symbol,
      amountUSDPerShare: upcomingEvent.amountUSDPerShare,
      exDateNY: upcomingEvent.exDateNY,
      payDateNY: upcomingEvent.payDateNY || null,
      recordDateNY: upcomingEvent.recordDateNY || null,
      declarationDateNY: upcomingEvent.declarationDateNY || null,
      currency: upcomingEvent.currency || "USD",
      frequencyLabel,
      status:
        upcomingEvent.exDateNY && upcomingEvent.exDateNY < targetNY ?
          "earned" :
          "announced",
      updatedAt: Timestamp.now(),
    };
  });

  return summary;
};

const normalizePersistedSummaryEntry = (entry = {}, targetNY) => {
  const exDateNY = normalizeDateKey(entry.exDateNY);
  const payDateNY = normalizeDateKey(entry.payDateNY);
  if (!exDateNY && !payDateNY) {
    return null;
  }
  if (
    (!payDateNY || payDateNY < targetNY) &&
    (!exDateNY || exDateNY < targetNY)
  ) {
    return null;
  }

  return {
    ...entry,
    exDateNY,
    payDateNY: payDateNY || null,
    status: exDateNY && exDateNY < targetNY ? "earned" : "announced",
  };
};

const mergeUpcomingDividendSummary = ({
  currentSummary = {},
  refreshedEventsBySymbol = {},
  refreshedSymbols = [],
  targetNY,
}) => {
  const nextSummary = {};

  Object.entries(currentSummary || {}).forEach(([rawSymbol, entry]) => {
    const symbol = String(rawSymbol || entry?.symbol || "").trim().toUpperCase();
    if (!symbol) return;
    const normalizedEntry = normalizePersistedSummaryEntry(entry, targetNY);
    if (normalizedEntry) {
      nextSummary[symbol] = {
        ...normalizedEntry,
        symbol,
      };
    }
  });

  const refreshedSymbolSet = new Set(normalizeSymbolList(refreshedSymbols));
  const refreshedSummary = buildUpcomingDividendSummary({
    eventsBySymbol: refreshedEventsBySymbol,
    targetNY,
  });

  refreshedSymbolSet.forEach((symbol) => {
    if (refreshedSummary[symbol]) {
      nextSummary[symbol] = refreshedSummary[symbol];
      return;
    }
    delete nextSummary[symbol];
  });

  return nextSummary;
};
const flushBatchIfNeeded = async ({ batchState, force = false }) => {
  if (!force && batchState.writeCount < BATCH_WRITE_LIMIT) {
    return;
  }

  if (batchState.writeCount === 0) return;

  await batchState.batch.commit();
  batchState.batch = db.batch();
  batchState.writeCount = 0;
};

exports.syncStockDividendEvents = onSchedule(
  {
    schedule: "20 7 * * *",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3",
    timeoutSeconds: 540,
    memory: "256MiB",
    secrets: [alphaVantageApiKeyParam],
  },
  async () =>
    runStockDividendEventSync({
      syncMode: "hot",
      allowedLanes: ["urgent", "priority"],
      limit: HOT_SYNC_REQUEST_LIMIT,
      includeFallback: false,
    }),
);

exports.syncStockDividendEventsCold = onSchedule(
  {
    schedule: "35 7 * * 0",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3",
    timeoutSeconds: 540,
    memory: "256MiB",
    secrets: [alphaVantageApiKeyParam],
  },
  async () =>
    runStockDividendEventSync({
      syncMode: "cold",
      allowedLanes: ["discovery", "cold"],
      limit: COLD_SYNC_REQUEST_LIMIT,
      includeFallback: false,
    }),
);
const buildClassPolicyPayoutId = (symbol, payDateNY) =>
  `class_policy__${String(symbol || "").trim().toUpperCase()}__${payDateNY || "na"}`
    .replace(/[^A-Za-z0-9_-]+/g, "_");

const buildSourceEventPayoutId = ({
  symbol,
  exDateNY,
  entitlementDateNY,
}) =>
  `source_event__${String(symbol || "").trim().toUpperCase()}__${exDateNY || entitlementDateNY || "na"}`
    .replace(/[^A-Za-z0-9_-]+/g, "_");

const getTradingDateKeyOffset = (dateKey, offsetDays = 0) => {
  let cursor = getNextTradingDateKey(dateKey);
  if (!cursor) return null;

  let remaining = Math.abs(Math.round(asNum(offsetDays, 0)));
  if (remaining === 0) {
    return cursor;
  }

  const step = offsetDays >= 0 ? 1 : -1;
  while (cursor && remaining > 0) {
    cursor = offsetDateKey(cursor, step);
    while (cursor && isTradingHolidayKey(cursor)) {
      cursor = offsetDateKey(cursor, step);
    }
    remaining -= 1;
  }

  return cursor;
};

const buildNextPolicyPayoutDateKey = (baseDateKey, cycleDays) =>
  offsetDateKey(baseDateKey, Math.max(1, asNum(cycleDays, 30)));

const buildAnchoredPolicyPayoutDateKey = (
  anchorDateKey,
  cycleDays,
  targetDateKey,
  includeTarget = true,
) => {
  let cursor = normalizeDateKey(anchorDateKey);
  let guard = 0;

  while (cursor && (includeTarget ? cursor < targetDateKey : cursor <= targetDateKey) && guard < 400) {
    cursor = buildNextPolicyPayoutDateKey(cursor, cycleDays);
    guard += 1;
  }

  return cursor;
};

const buildPolicyExDividendDateKey = (payDateNY, leadTradingDays) =>
  getTradingDateKeyOffset(payDateNY, -Math.max(1, Math.round(asNum(leadTradingDays, 1))));

const alignPolicyNextPayoutDateKey = (nextPayoutDateNY, targetDateKey, cycleDays) => {
  let cursor = normalizeDateKey(nextPayoutDateNY);
  let shifted = false;
  let guard = 0;

  while (cursor && cursor < targetDateKey && guard < 400) {
    cursor = buildNextPolicyPayoutDateKey(cursor, cycleDays);
    shifted = true;
    guard += 1;
  }

  return {
    nextPayoutDateNY: cursor,
    shifted,
  };
};

const getStockSnapshotPathContext = (snapshotDoc) => {
  const studentRef = snapshotDoc?.ref?.parent?.parent || null;
  const classRef = studentRef?.parent?.parent || null;
  return {
    classId: String(classRef?.id || "").trim(),
    studentId: String(studentRef?.id || "").trim(),
    studentRef,
    classRef,
  };
};

const getValidatedStockSnapshotQuantity = ({
  snapshotDoc,
  entitlementDateNY,
  symbol,
  expectedClassId = null,
  expectedStudentId = null,
}) => {
  if (!snapshotDoc?.exists) {
    return null;
  }

  const {
    classId,
    studentId,
  } = getStockSnapshotPathContext(snapshotDoc);
  const normalizedExpectedClassId = String(expectedClassId || "").trim();
  const normalizedExpectedStudentId = String(expectedStudentId || "").trim();
  if (
    (normalizedExpectedClassId && normalizedExpectedClassId !== classId) ||
    (normalizedExpectedStudentId && normalizedExpectedStudentId !== studentId)
  ) {
    return null;
  }

  return getEligibleStockSnapshotQuantity({
    snapshotId: snapshotDoc.id,
    pathClassId: classId,
    pathStudentId: studentId,
    entitlementDateNY,
    symbol,
    snapshotData: snapshotDoc.data() || {},
  });
};

const getStudentSnapshotQuantityByDate = async ({
  studentDoc,
  entitlementDateNY,
  symbol,
  snapshotCache,
}) => {
  if (!entitlementDateNY || !symbol) return null;

  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const cacheKey = `${studentDoc.id}__${entitlementDateNY}__${normalizedSymbol}`;
  if (snapshotCache.has(cacheKey)) {
    return snapshotCache.get(cacheKey);
  }

  const snapshotSnap = await studentDoc.ref
    .collection("stockDailySnapshots")
    .doc(entitlementDateNY)
    .get();
  const classId = String(studentDoc.ref?.parent?.parent?.id || "").trim();
  const quantity = getValidatedStockSnapshotQuantity({
    snapshotDoc: snapshotSnap,
    entitlementDateNY,
    symbol: normalizedSymbol,
    expectedClassId: classId,
    expectedStudentId: studentDoc.id,
  });
  snapshotCache.set(cacheKey, quantity);
  return quantity;
};

const getEligibleSnapshotDocsBySymbolAndDate = async ({
  entitlementDateNY,
  symbol,
  snapshotQueryCache,
}) => {
  if (!entitlementDateNY || !symbol) {
    return [];
  }

  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  if (!normalizedSymbol) {
    return [];
  }

  const cacheKey = `${entitlementDateNY}__${normalizedSymbol}`;
  if (snapshotQueryCache.has(cacheKey)) {
    return snapshotQueryCache.get(cacheKey);
  }

  const snap = await db
    .collectionGroup("stockDailySnapshots")
    .where("snapshotDateNY", "==", entitlementDateNY)
    .where("holdingSymbols", "array-contains", normalizedSymbol)
    .get();
  const docs = snap.docs;
  snapshotQueryCache.set(cacheKey, docs);
  return docs;
};

const getEligibleSnapshotDocsByClassSymbolAndDate = async ({
  classId,
  entitlementDateNY,
  symbol,
  classSnapshotQueryCache,
}) => {
  if (!classId || !entitlementDateNY || !symbol) {
    return [];
  }

  const normalizedClassId = String(classId || "").trim();
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  if (!normalizedClassId || !normalizedSymbol) {
    return [];
  }

  const cacheKey = `${normalizedClassId}__${entitlementDateNY}__${normalizedSymbol}`;
  if (classSnapshotQueryCache.has(cacheKey)) {
    return classSnapshotQueryCache.get(cacheKey);
  }

  const snap = await db
    .collectionGroup("stockDailySnapshots")
    .where("classId", "==", normalizedClassId)
    .where("snapshotDateNY", "==", entitlementDateNY)
    .where("holdingSymbols", "array-contains", normalizedSymbol)
    .get();
  const docs = snap.docs;
  classSnapshotQueryCache.set(cacheKey, docs);
  return docs;
};

const loadSourceEventDocsForPayout = async (targetNY) => {
  const [dueEventsSnap, retryEventsSnap] = await Promise.all([
    db
      .collection(DIVIDEND_EVENTS_COLLECTION)
      .where("payDateNY", "==", targetNY)
      .get(),
    db
      .collection(DIVIDEND_EVENTS_COLLECTION)
      .where("payoutRetryPending", "==", true)
      .get(),
  ]);

  const docsById = new Map();
  dueEventsSnap.docs.forEach((docSnap) => {
    docsById.set(docSnap.id, docSnap);
  });
  retryEventsSnap.docs.forEach((docSnap) => {
    const payDateNY = normalizeDateKey(docSnap.data()?.payDateNY);
    if (!payDateNY || payDateNY <= targetNY) {
      docsById.set(docSnap.id, docSnap);
    }
  });

  const sourceEventDocs = [...docsById.values()].sort((left, right) => {
    const leftData = left.data() || {};
    const rightData = right.data() || {};
    const payDateDiff = compareDateKeys(
      normalizeDateKey(leftData.payDateNY),
      normalizeDateKey(rightData.payDateNY),
    );
    if (payDateDiff !== 0) {
      return payDateDiff;
    }

    const symbolDiff = String(leftData.symbol || "").localeCompare(
      String(rightData.symbol || ""),
    );
    if (symbolDiff !== 0) {
      return symbolDiff;
    }

    return left.id.localeCompare(right.id);
  });

  return {
    dueEventsSnap,
    retryEventsSnap,
    sourceEventDocs,
  };
};

const runStockDividendEventSync = async ({
  syncMode = "hot",
  allowedLanes = DEFAULT_SYNC_LANE_ORDER,
  limit = ALPHA_VANTAGE_DAILY_REQUEST_LIMIT,
  includeFallback = false,
} = {}) => {
  const apiKey = alphaVantageApiKeyParam.value();
  if (!apiKey) {
    console.error("[STOCK_DIVIDEND_SYNC] ALPHA_VANTAGE_API_KEY is missing.");
    return null;
  }

  await ensureStockJobIndexBootstrapped({
    source: `syncStockDividendEvents:${syncMode}`,
  });

  const syncDateKST = formatDateKeyInTimeZone("Asia/Seoul");
  const { targetNY } = getPrefetchContext();
  const fromDate = offsetDateKey(targetNY, -LOOKBACK_DAYS);
  const toDate = offsetDateKey(targetNY, LOOKAHEAD_DAYS);
  const symbols = await getDividendTargetSymbols();
  const heldSymbols = await getHeldDividendSymbols();
  const stateBySymbol = await getDividendSyncStateMap();
  const { selectedCandidates, selectionMeta } = selectSymbolsForDividendSync({
    symbols,
    heldSymbols,
    stateBySymbol,
    marketDateKey: targetNY,
    currentDateKey: syncDateKST,
    limit,
    allowedLanes,
    includeFallback,
  });

  if (symbols.length === 0) {
    await db.collection(DIVIDEND_SUMMARY_COLLECTION).doc(DIVIDEND_SUMMARY_DOC).set({
      symbols: {},
      source: "alphavantage",
      syncMode,
      targetNY,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return null;
  }

  const batchState = {
    batch: db.batch(),
    writeCount: 0,
  };
  let rateLimitReached = false;

  console.info("[STOCK_DIVIDEND_SYNC] Selected symbols.", {
    syncMode,
    allowedLanes,
    checkedSymbolCount: selectedCandidates.length,
    dueCounts: selectionMeta.dueCounts,
    fallbackCounts: selectionMeta.fallbackCounts,
    selectedCounts: selectionMeta.selectedCounts,
    sample: selectedCandidates
      .slice(0, 10)
      .map((candidate) => `${candidate.symbol}:${candidate.lane}`),
    syncDateKST,
    targetNY,
  });

  for (let index = 0; index < selectedCandidates.length; index += 1) {
    const selectedCandidate = selectedCandidates[index];
    const symbol = selectedCandidate.symbol;
    const previousState = stateBySymbol.get(symbol) || {};

    try {
      const response = await axios.get(ALPHA_VANTAGE_API_URL, {
        params: {
          function: "DIVIDENDS",
          symbol,
          apikey: apiKey,
        },
        timeout: 10000,
      });

      const rawEvents = buildAlphaVantageEvents(response.data);
      const normalizedEvents = filterDividendEventsByWindow({
        events: rawEvents
          .map((item) => normalizeDividendEvent(symbol, item, "alphavantage"))
          .filter(Boolean),
        fromDate,
        toDate,
      })
        .sort((left, right) => String(left.exDateNY).localeCompare(String(right.exDateNY)));

      normalizedEvents.forEach((event) => {
        const eventId = buildDividendEventId(event);
        const eventRef = db.collection(DIVIDEND_EVENTS_COLLECTION).doc(eventId);

        batchState.batch.set(
          eventRef,
          {
            ...event,
            eventId,
            lastSeenAt: FieldValue.serverTimestamp(),
            sourceWindowFrom: fromDate,
            sourceWindowTo: toDate,
            targetNY,
            syncedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        batchState.writeCount += 1;
      });

      const frequencyLabel = computeFrequencyLabel(normalizedEvents);
      const nextCheckPlan = computeNextCheckPlan({
        symbol,
        normalizedEvents,
        heldSymbols,
        frequencyLabel,
        currentDateKey: syncDateKST,
        marketDateKey: targetNY,
        previousState,
      });
      batchState.batch.set(
        db.collection(DIVIDEND_SYNC_STATE_COLLECTION).doc(symbol),
        {
          symbol,
          source: "alphavantage",
          isCore: CORE_DIVIDEND_SYMBOLS.has(symbol),
          isHeld: heldSymbols.has(symbol),
          eventCount: normalizedEvents.length,
          frequencyLabel: frequencyLabel || null,
          emptyResultCount: nextCheckPlan.emptyResultCount,
          nextUpcomingEventDate: nextCheckPlan.nextUpcomingEventDate || null,
          nextUpcomingExDateNY: nextCheckPlan.upcomingEvent?.exDateNY || null,
          nextUpcomingPayDateNY: nextCheckPlan.upcomingEvent?.payDateNY || null,
          lastEventDateNY: getLatestDividendEventDateKey(normalizedEvents),
          lastSelectedLane: selectedCandidate.lane,
          lastSyncMode: syncMode,
          syncDateKST,
          fromDate,
          toDate,
          targetNY,
          lastCheckedAt: syncDateKST,
          lastSuccessAt: FieldValue.serverTimestamp(),
          nextCheckAt: nextCheckPlan.nextCheckAt,
          nextCheckReason: nextCheckPlan.nextCheckReason,
          failureCount: 0,
          lastError: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      batchState.writeCount += 1;

      await flushBatchIfNeeded({ batchState });
    } catch (error) {
      console.error("[STOCK_DIVIDEND_SYNC] Failed to fetch dividends.", {
        syncMode,
        symbol,
        message: error.message,
        code: error.code || null,
        status: error.response?.status,
        data: error.response?.data,
      });

      batchState.batch.set(
        db.collection(DIVIDEND_SYNC_STATE_COLLECTION).doc(symbol),
        {
          symbol,
          source: "alphavantage",
          isCore: CORE_DIVIDEND_SYMBOLS.has(symbol),
          isHeld: heldSymbols.has(symbol),
          syncDateKST,
          targetNY,
          lastCheckedAt: syncDateKST,
          nextCheckAt: offsetDateKey(syncDateKST, 1),
          nextCheckReason: "retry_after_error",
          lastSelectedLane: selectedCandidate.lane,
          lastSyncMode: syncMode,
          lastError: error.message,
          failureCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      batchState.writeCount += 1;

      if (
        error.code === "alpha_vantage_note" ||
        error.code === "alpha_vantage_information"
      ) {
        rateLimitReached = true;
        await flushBatchIfNeeded({ batchState });
        break;
      }
    }

    if (index < selectedCandidates.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  await flushBatchIfNeeded({ batchState, force: true });
  const checkedSymbols = selectedCandidates.map((candidate) => candidate.symbol);
  const summaryInput = await loadPersistedDividendEventsBySymbol("alphavantage", checkedSymbols);
  const summaryRef = db.collection(DIVIDEND_SUMMARY_COLLECTION).doc(DIVIDEND_SUMMARY_DOC);
  const currentSummarySnap = await summaryRef.get();
  const currentSummary = currentSummarySnap.exists ?
    currentSummarySnap.data()?.symbols || {} :
    {};
  const upcomingSummary = buildUpcomingDividendSummary({
    eventsBySymbol: summaryInput,
    targetNY,
  });
  const mergedSummary = mergeUpcomingDividendSummary({
    currentSummary,
    refreshedEventsBySymbol: summaryInput,
    refreshedSymbols: checkedSymbols,
    targetNY,
  });

  await summaryRef.set(
    {
      symbols: mergedSummary,
      source: "alphavantage",
      syncMode,
      syncDateKST,
      targetNY,
      fromDate,
      toDate,
      symbolCount: symbols.length,
      checkedSymbolCount: selectedCandidates.length,
      refreshedSummarySymbolCount: Object.keys(upcomingSummary).length,
      summarySymbolCount: Object.keys(mergedSummary).length,
      heldSymbolCount: heldSymbols.size,
      rateLimitReached,
      allowedLanes,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: false },
  );

  console.info("[STOCK_DIVIDEND_SYNC] Completed.", {
    syncMode,
    symbolCount: symbols.length,
    checkedSymbolCount: selectedCandidates.length,
    heldSymbolCount: heldSymbols.size,
    rateLimitReached,
    dueCounts: selectionMeta.dueCounts,
    selectedCounts: selectionMeta.selectedCounts,
    targetNY,
  });

  return null;
};

const stageSourceEventPayoutState = ({
  batchState,
  eventRef,
  targetNY,
  isPending,
  entitlementDateNY = null,
  snapshotCount = 0,
  createdCount = 0,
  retryReason = null,
  readyClassCount = 0,
  pendingClassCount = 0,
}) => {
  const patch = {
    payoutRetryPending: isPending === true,
    pendingEntitlementDateNY: isPending ? entitlementDateNY || null : null,
    payoutLastAttemptAt: FieldValue.serverTimestamp(),
    payoutLastAttemptTargetNY: targetNY || null,
    payoutLastAttemptedSnapshotCount: Math.max(
      0,
      Math.round(asNum(snapshotCount, 0)),
    ),
    payoutLastCreatedCount: Math.max(0, Math.round(asNum(createdCount, 0))),
    payoutLastReadyClassCount: Math.max(0, Math.round(asNum(readyClassCount, 0))),
    payoutLastPendingClassCount: Math.max(0, Math.round(asNum(pendingClassCount, 0))),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (isPending) {
    patch.payoutLastRetryReason = retryReason || "unknown";
  } else {
    patch.payoutLastRetryReason = FieldValue.delete();
    patch.payoutLastSuccessAt = FieldValue.serverTimestamp();
  }

  batchState.batch.set(eventRef, patch, { merge: true });
  batchState.writeCount += 1;
};

const enqueueDividendPayout = async ({
  classId,
  studentDoc,
  studentData,
  symbol,
  eligibleQuantity,
  amountUSDPerShare,
  entitlementDateNY,
  exDateNY,
  payDateNY,
  payoutId,
  eventId,
  description,
  conversionRate,
  currencyUnit,
  classData = {},
  logContext,
  payoutMode = "source_event",
  legacyPayoutIds = [],
  extraTradeFields = {},
  extraPayoutFields = {},
}) => {
  const normalizedPayoutId = String(payoutId || "").trim();
  if (!normalizedPayoutId) {
    return false;
  }

  const grossDividendUSD = round4(eligibleQuantity * asNum(amountUSDPerShare, 0));
  if (!(grossDividendUSD > 0)) {
    return false;
  }

  const appliedConversionRate = asNum(conversionRate, 1) || 1;
  const grossDividendInClassCurrency = round4(grossDividendUSD / appliedConversionRate);
  const incomeTaxSnapshot = buildIncomeTaxSnapshot({
    sourceKey: "stockDividend",
    grossAmount: grossDividendInClassCurrency,
    policy: getWithholdingPolicy(classData, "stockDividend") || {},
  });
  const netDividendUSD = round4(incomeTaxSnapshot.netAmount * appliedConversionRate);
  const payoutRef = studentDoc.ref.collection("stockDividendPayouts").doc(normalizedPayoutId);
  const tradeRef = studentDoc.ref
    .collection("tradeHistory")
    .doc(`stock_dividend__${normalizedPayoutId}`);
  const legacyPayoutRefs = [...new Set(
    legacyPayoutIds
      .map((candidateId) => String(candidateId || "").trim())
      .filter(Boolean)
      .filter((candidateId) => candidateId !== normalizedPayoutId),
  )].map((candidateId) =>
    studentDoc.ref.collection("stockDividendPayouts").doc(candidateId),
  );

  return db.runTransaction(async (tx) => {
    const refsToRead = [studentDoc.ref, payoutRef, tradeRef, ...legacyPayoutRefs];
    const snaps = await Promise.all(refsToRead.map((ref) => tx.get(ref)));
    const studentSnap = snaps[0];
    const payoutSnap = snaps[1];
    const tradeSnap = snaps[2];
    const legacyPayoutSnaps = snaps.slice(3);

    if (
      !studentSnap.exists ||
      payoutSnap.exists ||
      tradeSnap.exists ||
      legacyPayoutSnaps.some((snap) => snap.exists)
    ) {
      return false;
    }

    tx.update(studentDoc.ref, {
      "assets.usdBalance": FieldValue.increment(netDividendUSD),
      "stockPerformance.cumulativeDividendsUSD": FieldValue.increment(grossDividendUSD),
      "stockPerformance.cumulativeDividendsInClassCurrency":
        FieldValue.increment(grossDividendInClassCurrency),
      "stockPerformance.lastDividendAt": FieldValue.serverTimestamp(),
      "stockPerformance.lastDividendSymbol": symbol,
      "stockPerformance.updatedAt": FieldValue.serverTimestamp(),
    });

    tx.set(tradeRef, {
      type: "STOCK_DIVIDEND",
      classId,
      userId: studentDoc.id,
      actorUid: "system",
      studentName: studentData.name || "",
      symbol,
      quantity: eligibleQuantity,
      amountUSDPerShare: round4(amountUSDPerShare),
      grossUSD: grossDividendUSD,
      grossInClassCurrency: grossDividendInClassCurrency,
      netUSD: netDividendUSD,
      withheldInClassCurrency: incomeTaxSnapshot.withheldAmount,
      incomeTax: incomeTaxSnapshot.incomeTax,
      conversionRate: appliedConversionRate,
      currencyUnit,
      exDateNY: exDateNY || null,
      payDateNY: payDateNY || null,
      entitlementDateNY,
      description,
      createdAt: FieldValue.serverTimestamp(),
      eventId,
      payoutId: normalizedPayoutId,
      payoutMode,
      ...extraTradeFields,
    });

    tx.set(payoutRef, {
      payoutId: normalizedPayoutId,
      classId,
      studentId: studentDoc.id,
      eventId,
      symbol,
      eligibleQuantity,
      amountUSDPerShare: round4(amountUSDPerShare),
      grossDividendUSD,
      grossDividendInClassCurrency,
      netDividendUSD,
      withheldInClassCurrency: incomeTaxSnapshot.withheldAmount,
      incomeTax: incomeTaxSnapshot.incomeTax,
      entitlementDateNY,
      exDateNY: exDateNY || null,
      payDateNY: payDateNY || null,
      createdAt: FieldValue.serverTimestamp(),
      paidAt: FieldValue.serverTimestamp(),
      currencyUnit,
      payoutMode,
      ...extraPayoutFields,
    });

    stageActivityLog(
      tx,
      classId,
      {
        studentUid: studentDoc.id,
        type: "income",
        category: "dividend",
        amount: netDividendUSD,
        currency: "USD",
        amountInClassCurrency: grossDividendInClassCurrency,
        netAmountUSD: netDividendUSD,
        withheldInClassCurrency: incomeTaxSnapshot.withheldAmount,
        conversionRate: appliedConversionRate,
        description,
        relatedDoc: { collection: "tradeHistory", id: tradeRef.id },
        incomeTax: incomeTaxSnapshot.incomeTax,
      },
      logContext,
    );

    if (incomeTaxSnapshot.withheldAmount > 0) {
      stageTaxIncome(
        tx,
        classId,
        {
          amount: incomeTaxSnapshot.withheldAmount,
          source: "stock_dividend_withholding",
          taxType: "income_tax",
          description: `${symbol} 배당 원천징수`,
          studentUid: studentDoc.id,
          studentName: studentData.name || "",
          breakdown: {
            baseAmount: incomeTaxSnapshot.grossAmount,
            taxAmount: incomeTaxSnapshot.withheldAmount,
            taxRate: incomeTaxSnapshot.incomeTax.taxRate,
          },
        },
        "system",
        {
          ...logContext,
          classData,
          sourceKey: "stockDividend",
          detailLines: [
            {
              id: normalizedPayoutId,
              amount: incomeTaxSnapshot.withheldAmount,
              source: "stock_dividend_withholding",
              taxType: "income_tax",
              description: `${symbol} 배당 원천징수`,
              studentUid: studentDoc.id,
              studentName: studentData.name || "",
              relatedDoc: { collection: "stockDividendPayouts", id: normalizedPayoutId },
              meta: {
                incomeTax: incomeTaxSnapshot.incomeTax,
              },
            },
          ],
        },
      );
    }

    return true;
  });
};

const resolveStoredUseCustomPolicy = (data = {}) =>
  data.useCustomPolicy != null ? data.useCustomPolicy === true : data.enabled === true;

const isFirestorePreconditionError = (error) =>
  Number(error?.code) === 9 ||
  String(error?.message || "").includes("FAILED_PRECONDITION");

const resolveClassPolicyNextProcessingDateNY = (data = {}) =>
  normalizeDateKey(data.nextProcessingDateNY) ||
  normalizeDateKey(data.pendingPayoutDateNY) ||
  normalizeDateKey(data.overrideNextPayoutDateNY) ||
  normalizeDateKey(data.nextPayoutDateNY) ||
  normalizeDateKey(data.classFirstPayoutDateNY) ||
  null;

const normalizeClassDividendPolicySnapshot = (docSnap) => {
  const data = docSnap.data() || {};
  const symbol = String(data.symbol || docSnap.id || "").trim().toUpperCase();
  if (!symbol) {
    return null;
  }

  return {
    docId: docSnap.id,
    ref: docSnap.ref,
    symbol,
    dividendEnabled: data.dividendEnabled !== false,
    useCustomPolicy: resolveStoredUseCustomPolicy(data),
    classFrequencyKey: String(data.classFrequencyKey || "monthly"),
    classFrequencyLabel: String(data.classFrequencyLabel || "") || null,
    classCycleDays: Math.max(1, Math.round(asNum(data.classCycleDays, 30))),
    classYieldPercent: round4(data.classYieldPercent),
    classPayoutUSDPerShare: round4(data.classPayoutUSDPerShare),
    classExDividendLeadTradingDays: Math.max(
      1,
      Math.round(asNum(data.classExDividendLeadTradingDays, 1)),
    ),
    classFirstPayoutDateNY: normalizeDateKey(data.classFirstPayoutDateNY),
    nextPayoutDateNY:
      normalizeDateKey(data.nextPayoutDateNY) ||
      normalizeDateKey(data.classFirstPayoutDateNY),
    nextExDateNY: normalizeDateKey(data.nextExDateNY),
    lastPaidDateNY: normalizeDateKey(data.lastPaidDateNY),
    overrideNextPayoutDateNY: normalizeDateKey(data.overrideNextPayoutDateNY),
    overrideNextExDateNY: normalizeDateKey(data.overrideNextExDateNY),
    pendingPayoutDateNY: normalizeDateKey(data.pendingPayoutDateNY),
    pendingExDateNY: normalizeDateKey(data.pendingExDateNY),
    pendingEntitlementDateNY: normalizeDateKey(data.pendingEntitlementDateNY),
    nextProcessingDateNY: resolveClassPolicyNextProcessingDateNY(data),
  };
};

const getClassPolicyProcessingDateNY = (policy = {}) =>
  normalizeDateKey(policy.nextProcessingDateNY) ||
  normalizeDateKey(policy.pendingPayoutDateNY) ||
  normalizeDateKey(policy.overrideNextPayoutDateNY) ||
  normalizeDateKey(policy.nextPayoutDateNY) ||
  normalizeDateKey(policy.classFirstPayoutDateNY) ||
  null;

const loadClassDividendPolicies = async (classRef) => {
  const snap = await classRef.collection(DIVIDEND_POLICY_COLLECTION).get();
  const policiesBySymbol = new Map();

  snap.forEach((docSnap) => {
    const policy = normalizeClassDividendPolicySnapshot(docSnap);
    if (!policy) {
      return;
    }

    policiesBySymbol.set(policy.symbol, policy);
  });

  return policiesBySymbol;
};

const getClassPolicyProcessingBackfillRef = () =>
  db.collection(DIVIDEND_SYNC_STATE_COLLECTION).doc(CLASS_POLICY_PROCESSING_BACKFILL_DOC);

const sortClassPolicyDocsByProcessingDate = (docs = []) =>
  [...docs].sort((left, right) => {
    const leftPolicy = normalizeClassDividendPolicySnapshot(left);
    const rightPolicy = normalizeClassDividendPolicySnapshot(right);
    const leftDate = getClassPolicyProcessingDateNY(leftPolicy) || "";
    const rightDate = getClassPolicyProcessingDateNY(rightPolicy) || "";
    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }
    return left.ref.path.localeCompare(right.ref.path);
  });

const loadCustomPolicyDocsForBackfillByClass = async () => {
  const classesSnap = await db.collection("classes").get();
  const docsByPath = new Map();

  for (const classDoc of classesSnap.docs) {
    const policySnap = await classDoc.ref.collection(DIVIDEND_POLICY_COLLECTION).get();
    policySnap.forEach((docSnap) => {
      const policy = normalizeClassDividendPolicySnapshot(docSnap);
      if (policy?.useCustomPolicy) {
        docsByPath.set(docSnap.ref.path, docSnap);
      }
    });
  }

  return [...docsByPath.values()];
};

const loadCustomPolicyDocsForBackfill = async () => {
  let customPolicySnap;
  let legacyCustomPolicySnap;

  try {
    [customPolicySnap, legacyCustomPolicySnap] = await Promise.all([
      db
        .collectionGroup(DIVIDEND_POLICY_COLLECTION)
        .where("useCustomPolicy", "==", true)
        .get(),
      db
        .collectionGroup(DIVIDEND_POLICY_COLLECTION)
        .where("enabled", "==", true)
        .get(),
    ]);
  } catch (error) {
    if (!isFirestorePreconditionError(error)) {
      throw error;
    }
    console.warn("[STOCK_DIVIDEND_POLICY] Falling back to class-scoped policy backfill query.", {
      message: error.message,
      code: error.code || null,
    });
    return loadCustomPolicyDocsForBackfillByClass();
  }

  const docsByPath = new Map();

  [customPolicySnap, legacyCustomPolicySnap].forEach((snap) => {
    snap.forEach((docSnap) => {
      docsByPath.set(docSnap.ref.path, docSnap);
    });
  });

  return [...docsByPath.values()];
};

const ensureClassPolicyNextProcessingDateBackfilled = async () => {
  const backfillRef = getClassPolicyProcessingBackfillRef();
  const backfillSnap = await backfillRef.get();
  if (backfillSnap.exists && backfillSnap.data()?.completedAt) {
    return backfillSnap.data() || {};
  }

  const docs = await loadCustomPolicyDocsForBackfill();
  const batchState = {
    batch: db.batch(),
    writeCount: 0,
  };
  let updatedCount = 0;
  let clearedCount = 0;

  for (const docSnap of docs) {
    const policy = normalizeClassDividendPolicySnapshot(docSnap);
    if (!policy) {
      continue;
    }

    const nextProcessingDateNY =
      policy.dividendEnabled !== false && policy.useCustomPolicy ?
        getClassPolicyProcessingDateNY(policy) :
        null;
    const currentNextProcessingDateNY =
      normalizeDateKey(docSnap.data()?.nextProcessingDateNY) || null;

    if (currentNextProcessingDateNY === nextProcessingDateNY) {
      continue;
    }

    batchState.batch.set(
      docSnap.ref,
      {
        nextProcessingDateNY,
      },
      { merge: true },
    );
    batchState.writeCount += 1;
    if (nextProcessingDateNY) {
      updatedCount += 1;
    } else {
      clearedCount += 1;
    }
    await flushBatchIfNeeded({ batchState });
  }

  await flushBatchIfNeeded({ batchState, force: true });
  await backfillRef.set(
    {
      completedAt: FieldValue.serverTimestamp(),
      updatedCount,
      clearedCount,
      totalDocCount: docs.length,
    },
    { merge: true },
  );

  console.info("[STOCK_DIVIDEND_POLICY] Backfilled nextProcessingDateNY.", {
    updatedCount,
    clearedCount,
    totalDocCount: docs.length,
  });

  return {
    completedAt: true,
    updatedCount,
    clearedCount,
    totalDocCount: docs.length,
  };
};

const loadDueCustomPolicyDocs = async (targetNY) => {
  const filterDueDocs = (docs = []) =>
    docs
    .filter((docSnap) => {
      const policy = normalizeClassDividendPolicySnapshot(docSnap);
      if (!policy || policy.dividendEnabled === false || !policy.useCustomPolicy) {
        return false;
      }
      const processingDateNY = getClassPolicyProcessingDateNY(policy);
      return Boolean(processingDateNY && processingDateNY <= targetNY);
    });

  try {
    const dueSnap = await db
      .collectionGroup(DIVIDEND_POLICY_COLLECTION)
      .where("nextProcessingDateNY", "<=", targetNY)
      .get();

    return sortClassPolicyDocsByProcessingDate(filterDueDocs(dueSnap.docs));
  } catch (error) {
    if (!isFirestorePreconditionError(error)) {
      throw error;
    }
    console.warn("[STOCK_DIVIDEND_PAYOUT] Falling back to class-scoped due policy query.", {
      targetNY,
      message: error.message,
      code: error.code || null,
    });
  }

  const stockHolderClassSnap = await getClassesWithStockHolders();
  const docsByPath = new Map();

  for (const classDoc of stockHolderClassSnap.docs) {
    const policySnap = await classDoc.ref.collection(DIVIDEND_POLICY_COLLECTION).get();
    filterDueDocs(policySnap.docs).forEach((docSnap) => {
      docsByPath.set(docSnap.ref.path, docSnap);
    });
  }

  return sortClassPolicyDocsByProcessingDate([...docsByPath.values()]);
};

exports.processStockDividendPayouts = onSchedule(
  {
    schedule: "30 7 * * 2-6",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const classPolicyProcessingBackfill = await ensureClassPolicyNextProcessingDateBackfilled();
    const { targetNY } = getPrefetchContext();
    const {
      dueEventsSnap,
      retryEventsSnap,
      sourceEventDocs,
    } = await loadSourceEventDocsForPayout(targetNY);

    const globalConfig = await getGlobalConfig();
    const snapshotQueryCache = new Map();
    const classSnapshotQueryCache = new Map();
    const classContextCache = new Map();
    const classDividendPoliciesCache = new Map();
    const classSnapshotStatusCache = new Map();
    const studentDocCache = new Map();
    let actualPayoutCount = 0;
    let classPolicyPayoutCount = 0;
    let classPolicyScheduleCount = 0;
    let initializedPolicyCount = 0;
    let stockHolderClassIdsPromise = null;
    const sourceEventLogCounts = {
      skippedNonUsdCount: 0,
      skippedByPolicyCount: 0,
      skippedByRoleCount: 0,
      skippedByQuantityCount: 0,
      snapshotRetryQueuedCount: 0,
    };
    const classPolicyLogCounts = {
      skippedByRoleCount: 0,
      skippedByQuantityCount: 0,
      snapshotRetryQueuedCount: 0,
      missingSnapshotStudentCount: 0,
    };

    const getClassContext = async (classId) => {
      const normalizedClassId = String(classId || "").trim();
      if (!normalizedClassId) {
        return null;
      }

      if (!classContextCache.has(normalizedClassId)) {
        classContextCache.set(normalizedClassId, (async () => {
          const classRef = db.doc(`classes/${normalizedClassId}`);
          const classDoc = await classRef.get();
          if (!classDoc.exists) {
            return null;
          }

          const classData = classDoc.data() || {};
          const planType = classData.planType || "FREE";
          const logContext = {
            config: globalConfig,
            planType,
            serviceName: "stock",
          };
          const marketConfig = await getMarketConfig(null, normalizedClassId);

          return {
            classId: normalizedClassId,
            classDoc,
            classRef,
            classData,
            logContext,
            conversionRate: marketConfig.conversionRate,
            currencyUnit: marketConfig.currencyUnit,
          };
        })());
      }

      return classContextCache.get(normalizedClassId);
    };

    const getClassDividendPolicies = async (classId) => {
      const normalizedClassId = String(classId || "").trim();
      if (!normalizedClassId) {
        return new Map();
      }

      if (!classDividendPoliciesCache.has(normalizedClassId)) {
        classDividendPoliciesCache.set(normalizedClassId, (async () => {
          const classContext = await getClassContext(normalizedClassId);
          if (!classContext) {
            return new Map();
          }
          return loadClassDividendPolicies(classContext.classRef);
        })());
      }

      return classDividendPoliciesCache.get(normalizedClassId);
    };

    const getStudentDocCached = async (studentRef) => {
      const cacheKey = studentRef?.path;
      if (!cacheKey) {
        return null;
      }

      if (!studentDocCache.has(cacheKey)) {
        studentDocCache.set(cacheKey, studentRef.get());
      }

      return studentDocCache.get(cacheKey);
    };

    const getClassSnapshotStatusByDate = async (classId, snapshotDateNY) => {
      const normalizedClassId = String(classId || "").trim();
      const normalizedSnapshotDateNY = normalizeDateKey(snapshotDateNY);
      if (!normalizedClassId || !normalizedSnapshotDateNY) {
        return null;
      }

      const cacheKey = `${normalizedClassId}__${normalizedSnapshotDateNY}`;
      if (!classSnapshotStatusCache.has(cacheKey)) {
        classSnapshotStatusCache.set(cacheKey, (async () => {
          const snap = await db
            .doc(
              `classes/${normalizedClassId}/${STOCK_SNAPSHOT_STATUS_COLLECTION}/${normalizedSnapshotDateNY}`,
            )
            .get();
          return snap.exists ? snap.data() || {} : null;
        })());
      }

      return classSnapshotStatusCache.get(cacheKey);
    };

    const getStockHolderClassIds = async () => {
      if (!stockHolderClassIdsPromise) {
        stockHolderClassIdsPromise = getClassesWithStockHolders()
          .then((snap) => snap.docs.map((docSnap) => docSnap.id).filter(Boolean));
      }
      return stockHolderClassIdsPromise;
    };

    const getSourceEventRetryPlan = async ({ event, entitlementDateNY }) => {
      const payDateNY = normalizeDateKey(event?.payDateNY);
      const retryAgeDays = getDateKeyDiffDays(payDateNY, targetNY);
      if (
        Number.isFinite(retryAgeDays) &&
        retryAgeDays > SOURCE_EVENT_RETRY_WINDOW_DAYS
      ) {
        return {
          shouldRetry: false,
          retryReason: "retry_window_expired",
          readyClassCount: 0,
          pendingClassCount: 0,
        };
      }

      const stockHolderClassIds = await getStockHolderClassIds();
      if (stockHolderClassIds.length === 0) {
        return {
          shouldRetry: false,
          retryReason: "no_stock_holder_classes",
          readyClassCount: 0,
          pendingClassCount: 0,
        };
      }

      let readyClassCount = 0;
      let pendingClassCount = 0;
      for (const classId of stockHolderClassIds) {
        const snapshotStatus = await getClassSnapshotStatusByDate(
          classId,
          entitlementDateNY,
        );
        if (snapshotStatus?.ready === true) {
          readyClassCount += 1;
          continue;
        }

        pendingClassCount += 1;
      }

      return {
        shouldRetry: pendingClassCount > 0,
        retryReason:
          pendingClassCount > 0 ?
            "snapshot_status_not_ready" :
            "all_snapshot_status_ready_no_matching_holders",
        readyClassCount,
        pendingClassCount,
      };
    };

    const sourceEventBatchState = {
      batch: db.batch(),
      writeCount: 0,
    };

    for (const eventDoc of sourceEventDocs) {
      const event = eventDoc.data() || {};
      const symbol = String(event.symbol || "").trim().toUpperCase();
      if (!symbol || !(asNum(event.amountUSDPerShare) > 0)) {
        continue;
      }

      const currency = String(event.currency || "USD").trim().toUpperCase();
      if (currency && currency !== "USD") {
        sourceEventLogCounts.skippedNonUsdCount += 1;
        console.warn("[STOCK_DIVIDEND_PAYOUT] Skipping non-USD event.", {
          eventId: eventDoc.id,
          symbol,
          currency,
        });
        continue;
      }

      const entitlementDateNY = getPreviousTradingDateKey(
        event.exDateNY || event.recordDateNY || event.payDateNY,
      );
      if (!entitlementDateNY) {
        continue;
      }

      const payoutId = buildSourceEventPayoutId({
        symbol,
        exDateNY: event.exDateNY || null,
        entitlementDateNY,
      });
      const snapshotDocs = await getEligibleSnapshotDocsBySymbolAndDate({
        entitlementDateNY,
        symbol,
        snapshotQueryCache,
      });
      if (snapshotDocs.length === 0) {
        const retryPlan = await getSourceEventRetryPlan({
          event,
          entitlementDateNY,
        });
        if (retryPlan.shouldRetry) {
          sourceEventLogCounts.snapshotRetryQueuedCount += 1;
        }
        stageSourceEventPayoutState({
          batchState: sourceEventBatchState,
          eventRef: eventDoc.ref,
          targetNY,
          isPending: retryPlan.shouldRetry,
          entitlementDateNY,
          snapshotCount: 0,
          createdCount: 0,
          retryReason: retryPlan.retryReason,
          readyClassCount: retryPlan.readyClassCount,
          pendingClassCount: retryPlan.pendingClassCount,
        });
        await flushBatchIfNeeded({ batchState: sourceEventBatchState });
        continue;
      }

      let createdForEventCount = 0;

      for (const snapshotDoc of snapshotDocs) {
        const {
          studentRef,
          classRef,
          classId,
        } = getStockSnapshotPathContext(snapshotDoc);
        if (!studentRef || !classRef || !classId) {
          continue;
        }

        const classContext = await getClassContext(classId);
        if (!classContext) {
          continue;
        }

        const classDividendPolicies = await getClassDividendPolicies(classId);
        const policy = classDividendPolicies.get(symbol);
        if (policy && (policy.dividendEnabled === false || policy.useCustomPolicy)) {
          sourceEventLogCounts.skippedByPolicyCount += 1;
          continue;
        }

        const studentDoc = await getStudentDocCached(studentRef);
        if (!studentDoc?.exists) {
          continue;
        }

        const studentData = studentDoc.data() || {};
        const role = String(studentData.role || "").trim().toLowerCase();
        if (role === "teacher" || role === "admin") {
          sourceEventLogCounts.skippedByRoleCount += 1;
          continue;
        }

        const eligibleQuantity = getValidatedStockSnapshotQuantity({
          snapshotDoc,
          entitlementDateNY,
          symbol,
          expectedClassId: classId,
          expectedStudentId: studentRef.id,
        });
        if (eligibleQuantity == null) {
          sourceEventLogCounts.skippedByQuantityCount += 1;
          continue;
        }

        const created = await enqueueDividendPayout({
          classId,
          studentDoc,
          studentData,
          symbol,
          eligibleQuantity,
          amountUSDPerShare: event.amountUSDPerShare,
          entitlementDateNY,
          exDateNY: event.exDateNY || null,
          payDateNY: event.payDateNY || null,
          payoutId,
          eventId: eventDoc.id,
          description: `${symbol} 배당 지급`,
          conversionRate: classContext.conversionRate,
          currencyUnit: classContext.currencyUnit,
          classData: classContext.classData,
          logContext: classContext.logContext,
          payoutMode: "source_event",
          legacyPayoutIds: [eventDoc.id],
        });

        if (created) {
          actualPayoutCount += 1;
          createdForEventCount += 1;
        }
      }

      stageSourceEventPayoutState({
        batchState: sourceEventBatchState,
        eventRef: eventDoc.ref,
        targetNY,
        isPending: false,
        snapshotCount: snapshotDocs.length,
        createdCount: createdForEventCount,
      });
      await flushBatchIfNeeded({ batchState: sourceEventBatchState });
    }

    await flushBatchIfNeeded({ batchState: sourceEventBatchState, force: true });

    const dueCustomPolicyDocs = await loadDueCustomPolicyDocs(targetNY);
    const classPolicyBatchStateCache = new Map();
    const classPolicyStudentsSnapCache = new Map();
    const classPolicySnapshotCache = new Map();
    const getClassPolicyBatchState = (classId) => {
      if (!classPolicyBatchStateCache.has(classId)) {
        classPolicyBatchStateCache.set(classId, {
          batch: db.batch(),
          writeCount: 0,
        });
      }
      return classPolicyBatchStateCache.get(classId);
    };
    const getClassStudentsSnap = async (classId) => {
      if (!classPolicyStudentsSnapCache.has(classId)) {
        classPolicyStudentsSnapCache.set(
          classId,
          db.collection(`classes/${classId}/students`).get(),
        );
      }
      return classPolicyStudentsSnapCache.get(classId);
    };
    const getClassPolicySnapshotCache = (classId) => {
      if (!classPolicySnapshotCache.has(classId)) {
        classPolicySnapshotCache.set(classId, new Map());
      }
      return classPolicySnapshotCache.get(classId);
    };

    for (const policyDoc of dueCustomPolicyDocs) {
      const policy = normalizeClassDividendPolicySnapshot(policyDoc);
      const classId = policyDoc.ref.parent.parent?.id;
      if (!policy || !classId) {
        continue;
      }
      if (
        policy.dividendEnabled === false ||
        !policy.useCustomPolicy ||
        !(policy.classPayoutUSDPerShare > 0)
      ) {
        continue;
      }

      const classContext = await getClassContext(classId);
      if (!classContext) {
        continue;
      }

      const batchState = getClassPolicyBatchState(classId);
      const snapshotCache = getClassPolicySnapshotCache(classId);
      const hasPendingSchedule = Boolean(
        policy.pendingPayoutDateNY && policy.pendingEntitlementDateNY,
      );
      let regularNextPayoutDateNY = policy.nextPayoutDateNY;
      let regularNextExDateNY = policy.nextExDateNY;
      let shouldPersistSchedule = false;

      if (!hasPendingSchedule) {
        if (!regularNextPayoutDateNY) {
          regularNextPayoutDateNY =
            buildAnchoredPolicyPayoutDateKey(
              policy.classFirstPayoutDateNY || targetNY,
              policy.classCycleDays,
              targetNY,
              true,
            ) ||
            policy.classFirstPayoutDateNY ||
            buildNextPolicyPayoutDateKey(targetNY, policy.classCycleDays);
          shouldPersistSchedule = true;
          initializedPolicyCount += 1;
        }

        if (!regularNextPayoutDateNY) {
          continue;
        }

        regularNextExDateNY = buildPolicyExDividendDateKey(
          regularNextPayoutDateNY,
          policy.classExDividendLeadTradingDays,
        );
        shouldPersistSchedule =
          shouldPersistSchedule || regularNextExDateNY !== policy.nextExDateNY;

        if (shouldPersistSchedule) {
          batchState.batch.set(
            policy.ref,
            {
              nextPayoutDateNY: regularNextPayoutDateNY,
              nextExDateNY: regularNextExDateNY,
              nextProcessingDateNY: regularNextPayoutDateNY,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          batchState.writeCount += 1;
          await flushBatchIfNeeded({ batchState });
        }
      }

      let payoutDateNY =
        policy.pendingPayoutDateNY ||
        policy.overrideNextPayoutDateNY ||
        regularNextPayoutDateNY;
      let exDateNY =
        policy.pendingExDateNY ||
        policy.overrideNextExDateNY ||
        regularNextExDateNY ||
        buildPolicyExDividendDateKey(payoutDateNY, policy.classExDividendLeadTradingDays);
      let entitlementDateNY = policy.pendingEntitlementDateNY || exDateNY;

      if (!payoutDateNY || !entitlementDateNY) {
        continue;
      }

      while (payoutDateNY && entitlementDateNY && payoutDateNY <= targetNY) {
        const payoutId = buildClassPolicyPayoutId(policy.symbol, payoutDateNY);
        let missingSnapshotCount = 0;
        const snapshotStatus = await getClassSnapshotStatusByDate(
          classId,
          entitlementDateNY,
        );
        const canUseClassSnapshotQuery = snapshotStatus?.ready === true;

        if (canUseClassSnapshotQuery) {
          const eligibleSnapshotDocs = await getEligibleSnapshotDocsByClassSymbolAndDate({
            classId,
            entitlementDateNY,
            symbol: policy.symbol,
            classSnapshotQueryCache,
          });

          for (const snapshotDoc of eligibleSnapshotDocs) {
            const {
              studentRef,
            } = getStockSnapshotPathContext(snapshotDoc);
            if (!studentRef) {
              continue;
            }

            const studentDoc = await getStudentDocCached(studentRef);
            if (!studentDoc?.exists) {
              continue;
            }

            const studentData = studentDoc.data() || {};
            const role = String(studentData.role || "").trim().toLowerCase();
            if (role === "teacher" || role === "admin") {
              classPolicyLogCounts.skippedByRoleCount += 1;
              continue;
            }

            const eligibleQuantity = getValidatedStockSnapshotQuantity({
              snapshotDoc,
              entitlementDateNY,
              symbol: policy.symbol,
              expectedClassId: classId,
              expectedStudentId: studentRef.id,
            });
            if (eligibleQuantity == null) {
              classPolicyLogCounts.skippedByQuantityCount += 1;
              continue;
            }

            const created = await enqueueDividendPayout({
              classId,
              studentDoc,
              studentData,
              symbol: policy.symbol,
              eligibleQuantity,
              amountUSDPerShare: policy.classPayoutUSDPerShare,
              entitlementDateNY,
              exDateNY,
              payDateNY: payoutDateNY,
              payoutId,
              eventId: payoutId,
              description: `${policy.symbol} 학급 배당 지급`,
              conversionRate: classContext.conversionRate,
              currencyUnit: classContext.currencyUnit,
              classData: classContext.classData,
              logContext: classContext.logContext,
              payoutMode: "class_policy",
              extraTradeFields: {
                policyDocId: policy.docId,
                classFrequencyKey: policy.classFrequencyKey,
                classFrequencyLabel: policy.classFrequencyLabel,
                classYieldPercent: round4(policy.classYieldPercent),
                classExDividendLeadTradingDays: policy.classExDividendLeadTradingDays,
              },
              extraPayoutFields: {
                policyDocId: policy.docId,
                classFrequencyKey: policy.classFrequencyKey,
                classFrequencyLabel: policy.classFrequencyLabel,
                classYieldPercent: round4(policy.classYieldPercent),
                classExDividendLeadTradingDays: policy.classExDividendLeadTradingDays,
              },
            });

            if (created) {
              classPolicyPayoutCount += 1;
            }
          }
        } else {
          const currentStudentsSnap = await getClassStudentsSnap(classId);
          if (!currentStudentsSnap.empty) {
            for (const studentDoc of currentStudentsSnap.docs) {
              const studentData = studentDoc.data() || {};
              const role = String(studentData.role || "").trim().toLowerCase();
              if (role === "teacher" || role === "admin") {
                classPolicyLogCounts.skippedByRoleCount += 1;
                continue;
              }

              const eligibleQuantity = await getStudentSnapshotQuantityByDate({
                studentDoc,
                entitlementDateNY,
                symbol: policy.symbol,
                snapshotCache,
              });
              if (eligibleQuantity == null) {
                missingSnapshotCount += 1;
                continue;
              }

              const created = await enqueueDividendPayout({
                classId,
                studentDoc,
                studentData,
                symbol: policy.symbol,
                eligibleQuantity,
                amountUSDPerShare: policy.classPayoutUSDPerShare,
                entitlementDateNY,
                exDateNY,
                payDateNY: payoutDateNY,
                payoutId,
                eventId: payoutId,
                description: `${policy.symbol} 학급 배당 지급`,
                conversionRate: classContext.conversionRate,
                currencyUnit: classContext.currencyUnit,
                classData: classContext.classData,
                logContext: classContext.logContext,
                payoutMode: "class_policy",
                extraTradeFields: {
                  policyDocId: policy.docId,
                  classFrequencyKey: policy.classFrequencyKey,
                  classFrequencyLabel: policy.classFrequencyLabel,
                  classYieldPercent: round4(policy.classYieldPercent),
                  classExDividendLeadTradingDays: policy.classExDividendLeadTradingDays,
                },
                extraPayoutFields: {
                  policyDocId: policy.docId,
                  classFrequencyKey: policy.classFrequencyKey,
                  classFrequencyLabel: policy.classFrequencyLabel,
                  classYieldPercent: round4(policy.classYieldPercent),
                  classExDividendLeadTradingDays: policy.classExDividendLeadTradingDays,
                },
              });

              if (created) {
                classPolicyPayoutCount += 1;
              }
            }
          }
        }

        if (missingSnapshotCount > 0) {
          classPolicyLogCounts.snapshotRetryQueuedCount += 1;
          classPolicyLogCounts.missingSnapshotStudentCount += missingSnapshotCount;
          batchState.batch.set(
            policy.ref,
            {
              pendingPayoutDateNY: payoutDateNY,
              pendingExDateNY: exDateNY || null,
              pendingEntitlementDateNY: entitlementDateNY,
              nextProcessingDateNY: payoutDateNY,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          batchState.writeCount += 1;
          await flushBatchIfNeeded({ batchState });
          console.warn("[STOCK_DIVIDEND_PAYOUT] Snapshot missing for class policy payout. Retry queued.", {
            classId,
            symbol: policy.symbol,
            payoutDateNY,
            entitlementDateNY,
            missingSnapshotCount,
          });
          break;
        }

        const anchorDateNY = policy.classFirstPayoutDateNY || payoutDateNY;
        const upcomingPayoutDateNY = buildAnchoredPolicyPayoutDateKey(
          anchorDateNY,
          policy.classCycleDays,
          payoutDateNY,
          false,
        );
        const upcomingExDateNY = buildPolicyExDividendDateKey(
          upcomingPayoutDateNY,
          policy.classExDividendLeadTradingDays,
        );

        batchState.batch.set(
          policy.ref,
          {
            nextPayoutDateNY: upcomingPayoutDateNY,
            nextExDateNY: upcomingExDateNY,
            nextProcessingDateNY: upcomingPayoutDateNY,
            lastPaidDateNY: payoutDateNY,
            pendingPayoutDateNY: null,
            pendingExDateNY: null,
            pendingEntitlementDateNY: null,
            overrideNextPayoutDateNY: null,
            overrideNextExDateNY: null,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        batchState.writeCount += 1;
        classPolicyScheduleCount += 1;
        await flushBatchIfNeeded({ batchState });

        payoutDateNY = upcomingPayoutDateNY;
        exDateNY = upcomingExDateNY;
        entitlementDateNY = upcomingExDateNY;
      }
    }

    for (const batchState of classPolicyBatchStateCache.values()) {
      await flushBatchIfNeeded({ batchState, force: true });
    }

    if (
      sourceEventDocs.length === 0 &&
      dueCustomPolicyDocs.length === 0 &&
      actualPayoutCount === 0 &&
      classPolicyPayoutCount === 0 &&
      initializedPolicyCount === 0
    ) {
      console.info("[STOCK_DIVIDEND_PAYOUT] No due dividend events.", {
        targetNY,
      });
      return null;
    }

    console.info("[STOCK_DIVIDEND_PAYOUT] Completed.", {
      targetNY,
      sourceEventCount: sourceEventDocs.length,
      dueSourceEventCount: dueEventsSnap.size,
      retrySourceEventCount: retryEventsSnap.size,
      dueClassPolicyCount: dueCustomPolicyDocs.length,
      classPolicyProcessingBackfill,
      actualPayoutCount,
      classPolicyPayoutCount,
      classPolicyScheduleCount,
      initializedPolicyCount,
      sourceEventLogCounts,
      classPolicyLogCounts,
    });
    return null;
  },
);


