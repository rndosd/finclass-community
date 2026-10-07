const toSafeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export function formatTrimmedNumber(value, maximumFractionDigits = 2) {
  return toSafeNumber(value, 0).toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

export function formatUnits(value, maximumFractionDigits = 4) {
  return formatTrimmedNumber(value, maximumFractionDigits);
}

export function formatPercentValue(value, maximumFractionDigits = 1) {
  return `${formatTrimmedNumber(value, maximumFractionDigits)}%`;
}

export function formatSignedPercentValue(value, maximumFractionDigits = 1) {
  const numeric = toSafeNumber(value, 0);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${formatTrimmedNumber(numeric, maximumFractionDigits)}%`;
}

export function formatWeightBps(weightBps) {
  return formatPercentValue(toSafeNumber(weightBps, 0) / 100, 1);
}

export function formatManagementFeeLabel(fund = {}) {
  const label = String(fund.managementFeeLabel || "운용보수").trim();
  if (fund.managementFeeBpsAnnual !== null && fund.managementFeeBpsAnnual !== undefined) {
    return `${label} (연 ${formatPercentValue(toSafeNumber(fund.managementFeeBpsAnnual) / 100, 2)})`;
  }
  return `${label} (${formatPercentValue(toSafeNumber(fund.managementFeeBpsWeekly) / 100, 2)} / 주)`;
}

export function getFundReturnPct(fund = {}) {
  const currentNav = toSafeNumber(fund.currentNav ?? fund.baseNav, 100);
  const baseNav = toSafeNumber(fund.baseNav, 100);
  if (baseNav <= 0) return 0;
  return ((currentNav - baseNav) / baseNav) * 100;
}
