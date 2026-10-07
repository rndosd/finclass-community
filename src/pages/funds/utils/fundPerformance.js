import { getFundReturnPct } from "./displayFormat";

export const FUND_PERFORMANCE_PERIODS = {
  sinceInception: "개설 이후",
  oneMonth: "최근 1개월",
};

export const MIN_DRAWDOWN_OBSERVATIONS = 5;

export function isFundDrawdownComparable(metric = {}) {
  return Number.isFinite(metric.maxDrawdownPct)
    && Number.isFinite(metric.observations)
    && metric.observations >= MIN_DRAWDOWN_OBSERVATIONS;
}

export function getFundDrawdownUnavailableLabel(metric = {}) {
  return Number.isFinite(metric.maxDrawdownPct)
    ? "집계 중"
    : getPerformanceUnavailableLabel(metric);
}

export function getFundPerformanceMetric(fund = {}, period = "sinceInception") {
  const stored = fund?.performanceSummary?.[period];
  const storedReturn = Number(stored?.returnPct);
  const storedDrawdown = Number(stored?.maxDrawdownPct);
  const hasStoredReturn = stored?.returnPct !== null && Number.isFinite(storedReturn);
  const hasStoredDrawdown = stored?.maxDrawdownPct !== null && Number.isFinite(storedDrawdown);

  if (period === "sinceInception" && !stored) {
    return {
      returnPct: getFundReturnPct(fund),
      maxDrawdownPct: null,
      status: "legacy",
      reason: "summary_not_generated",
      startDate: null,
      endDate: fund.lastNavDate || null,
      observations: null,
    };
  }

  return {
    returnPct: hasStoredReturn ? storedReturn : null,
    maxDrawdownPct: hasStoredDrawdown ? storedDrawdown : null,
    status: stored?.status || "unavailable",
    reason: stored?.reason || null,
    startDate: stored?.startDate || null,
    endDate: stored?.endDate || null,
    observations: Number.isFinite(Number(stored?.observations))
      ? Number(stored.observations)
      : null,
  };
}

export function compareFundPerformance(left, right, sort = "return") {
  const leftValue = sort === "drawdown"
    ? (isFundDrawdownComparable(left.metric) ? left.metric.maxDrawdownPct : null)
    : left.metric.returnPct;
  const rightValue = sort === "drawdown"
    ? (isFundDrawdownComparable(right.metric) ? right.metric.maxDrawdownPct : null)
    : right.metric.returnPct;
  const leftMissing = !Number.isFinite(leftValue);
  const rightMissing = !Number.isFinite(rightValue);
  if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
  if (leftMissing) return String(left.fundName || left.id || "").localeCompare(String(right.fundName || right.id || ""), "ko");
  if (leftValue === rightValue) return String(left.fundName || left.id || "").localeCompare(String(right.fundName || right.id || ""), "ko");
  return sort === "drawdown" ? leftValue - rightValue : rightValue - leftValue;
}

export function getPerformanceUnavailableLabel(metric = {}) {
  if (metric.reason === "fund_younger_than_one_month") return "1개월 기록 전";
  if (metric.reason === "history_gap") return "기록 확인 필요";
  return "자료 없음";
}
