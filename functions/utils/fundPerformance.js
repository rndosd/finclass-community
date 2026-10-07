"use strict";

const PERFORMANCE_SUMMARY_VERSION = "fund-performance-v1";
const MAX_ALLOWED_GAP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateKey(value) {
  const dateKey = String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(timestamp).toISOString().slice(0, 10) === dateKey ? timestamp : null;
}

function subtractCalendarMonth(dateKey) {
  const timestamp = parseDateKey(dateKey);
  if (timestamp === null) return null;
  const end = new Date(timestamp);
  const year = end.getUTCFullYear();
  const month = end.getUTCMonth();
  const day = end.getUTCDate();
  const targetMonthLastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(day, targetMonthLastDay)))
    .toISOString()
    .slice(0, 10);
}

function normalizeNavPoints(points = []) {
  const byDate = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    const dateKey = String(point?.dateKey || "");
    const nav = Number(point?.nav ?? point?.currentNav);
    if (parseDateKey(dateKey) === null || !Number.isFinite(nav) || nav <= 0) continue;
    byDate.set(dateKey, { dateKey, nav });
  }
  return [...byDate.values()].sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}

function roundPct(value) {
  return Math.round(value * 10000) / 10000;
}

function getMaxGapDays(points) {
  let maxGapDays = 0;
  for (let index = 1; index < points.length; index += 1) {
    const gapDays = Math.round(
      (parseDateKey(points[index].dateKey) - parseDateKey(points[index - 1].dateKey)) / DAY_MS,
    );
    maxGapDays = Math.max(maxGapDays, gapDays);
  }
  return maxGapDays;
}

function calculateMaxDrawdownPct(points) {
  const normalized = normalizeNavPoints(points);
  if (normalized.length < 2) return null;
  let peak = normalized[0].nav;
  let maximum = 0;
  for (const point of normalized) {
    peak = Math.max(peak, point.nav);
    maximum = Math.max(maximum, 1 - point.nav / peak);
  }
  return roundPct(maximum * 100);
}

function makeUnavailable(reason, points = []) {
  return {
    returnPct: null,
    maxDrawdownPct: null,
    startDate: points[0]?.dateKey || null,
    endDate: points.at(-1)?.dateKey || null,
    observations: points.length,
    status: "unavailable",
    reason,
  };
}

function summarizePeriod(points, { requireCompleteHistory = true, allowSinglePoint = false } = {}) {
  const normalized = normalizeNavPoints(points);
  if (allowSinglePoint && normalized.length === 1) {
    return {
      returnPct: 0,
      maxDrawdownPct: 0,
      startDate: normalized[0].dateKey,
      endDate: normalized[0].dateKey,
      observations: 1,
      status: "complete",
      reason: null,
    };
  }
  if (normalized.length < 2) return makeUnavailable("insufficient_observations", normalized);

  const first = normalized[0];
  const last = normalized.at(-1);
  const hasLargeGap = getMaxGapDays(normalized) > MAX_ALLOWED_GAP_DAYS;
  return {
    returnPct: roundPct(((last.nav / first.nav) - 1) * 100),
    maxDrawdownPct:
      requireCompleteHistory && hasLargeGap ? null : calculateMaxDrawdownPct(normalized),
    startDate: first.dateKey,
    endDate: last.dateKey,
    observations: normalized.length,
    status: hasLargeGap ? "partial" : "complete",
    reason: hasLargeGap ? "history_gap" : null,
  };
}

function selectOneMonthPoints(points, endDate) {
  const normalized = normalizeNavPoints(points).filter((point) => point.dateKey <= endDate);
  const targetStart = subtractCalendarMonth(endDate);
  if (!targetStart || normalized.length < 2) return [];

  let anchor = null;
  for (const point of normalized) {
    if (point.dateKey <= targetStart) anchor = point;
  }
  if (!anchor) return [];
  const anchorDistance = Math.round((parseDateKey(targetStart) - parseDateKey(anchor.dateKey)) / DAY_MS);
  if (anchorDistance > MAX_ALLOWED_GAP_DAYS) return [];
  return normalized.filter((point) => point.dateKey >= anchor.dateKey);
}

function buildFundPerformanceSummary({ history = [], currentPoint = null, endDate = null } = {}) {
  const points = normalizeNavPoints(currentPoint ? [...history, currentPoint] : history);
  const effectiveEndDate = endDate || points.at(-1)?.dateKey || null;
  if (!effectiveEndDate || parseDateKey(effectiveEndDate) === null) {
    return {
      sinceInception: makeUnavailable("missing_end_date", points),
      oneMonth: makeUnavailable("missing_end_date"),
      version: PERFORMANCE_SUMMARY_VERSION,
    };
  }

  const throughEnd = points.filter((point) => point.dateKey <= effectiveEndDate);
  const oneMonthPoints = selectOneMonthPoints(throughEnd, effectiveEndDate);
  return {
    sinceInception: summarizePeriod(throughEnd, { allowSinglePoint: true }),
    oneMonth: oneMonthPoints.length
      ? summarizePeriod(oneMonthPoints)
      : makeUnavailable("fund_younger_than_one_month"),
    version: PERFORMANCE_SUMMARY_VERSION,
  };
}

module.exports = {
  MAX_ALLOWED_GAP_DAYS,
  PERFORMANCE_SUMMARY_VERSION,
  buildFundPerformanceSummary,
  calculateMaxDrawdownPct,
  normalizeNavPoints,
  selectOneMonthPoints,
  subtractCalendarMonth,
};
