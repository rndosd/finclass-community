const REFERENCE_FREQUENCY_FACTOR = {
  "Monthly dividend": 12,
  "Quarterly dividend": 4,
  "Semiannual dividend": 2,
  "Annual dividend": 1,
};

export const DIVIDEND_POLICY_FREQUENCY_OPTIONS = [
  { key: "weekly", label: "\uC8FC 1\uD68C", cycleDays: 7, payoutsPerYear: 52 },
  { key: "biweekly", label: "2\uC8FC 1\uD68C", cycleDays: 14, payoutsPerYear: 26 },
  { key: "monthly", label: "\uC6D4 1\uD68C", cycleDays: 30, payoutsPerYear: 12 },
  { key: "quarterly", label: "\uBD84\uAE30 1\uD68C", cycleDays: 90, payoutsPerYear: 4 },
  { key: "semiannual", label: "\uBC18\uAE30 1\uD68C", cycleDays: 180, payoutsPerYear: 2 },
  { key: "annual", label: "\uC5F0 1\uD68C", cycleDays: 365, payoutsPerYear: 1 },
];

const roundNumber = (value, digits = 4) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  const unit = 10 ** digits;
  return Math.round(numericValue * unit) / unit;
};

const clampInteger = (value, fallback = 0, minimum = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.max(minimum, Math.round(numericValue));
};

export const normalizeTicker = (value) => String(value || "").trim().toUpperCase();

const EXCEL_SERIAL_DATE_OFFSET = 25569;
const MS_PER_DAY = 86400 * 1000;

const formatDateKeyFromDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 1900 || year > 2100) return null;
  return date.toISOString().slice(0, 10);
};

const normalizeExcelSerialDateKey = (value) => {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 1) return null;
  const parsed = new Date(Math.round((serial - EXCEL_SERIAL_DATE_OFFSET) * MS_PER_DAY));
  return formatDateKeyFromDate(parsed);
};

export const normalizeDateKey = (value) => {
  if (value instanceof Date) {
    return formatDateKeyFromDate(value);
  }

  if (typeof value === "number") {
    return normalizeExcelSerialDateKey(value);
  }

  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  if (/^\d{8}$/.test(normalized)) {
    const compactDate = `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
    return formatDateKeyFromDate(new Date(`${compactDate}T00:00:00.000Z`));
  }
  if (/^\d+(\.\d+)?$/.test(normalized)) {
    return normalizeExcelSerialDateKey(normalized);
  }

  const parsed = new Date(normalized);
  return formatDateKeyFromDate(parsed);
};

export const getDividendFrequencyOption = (key) =>
  DIVIDEND_POLICY_FREQUENCY_OPTIONS.find((option) => option.key === key) || null;

export const getReferenceFrequencyOptionKey = (frequencyLabel) => {
  switch (String(frequencyLabel || "").trim()) {
    case "Monthly dividend":
      return "monthly";
    case "Quarterly dividend":
      return "quarterly";
    case "Semiannual dividend":
      return "semiannual";
    case "Annual dividend":
      return "annual";
    default:
      return "monthly";
  }
};

export const estimateReferenceAnnualDividendUSD = (amountUSDPerShare, frequencyLabel) => {
  const factor = REFERENCE_FREQUENCY_FACTOR[String(frequencyLabel || "").trim()] || 0;
  return factor > 0 ? roundNumber(Number(amountUSDPerShare || 0) * factor, 4) : 0;
};

export const estimateYieldPercent = (annualDividendUSD, referencePriceUSD) => {
  const annualDividend = Number(annualDividendUSD);
  const referencePrice = Number(referencePriceUSD);
  if (!Number.isFinite(annualDividend) || !Number.isFinite(referencePrice) || referencePrice <= 0) {
    return 0;
  }
  return roundNumber((annualDividend / referencePrice) * 100, 2);
};

const resolveUseCustomPolicy = (policy) => {
  if (!policy) return false;
  if (policy.useCustomPolicy != null) return Boolean(policy.useCustomPolicy);
  return Boolean(policy.enabled);
};

export const hasPositiveCustomDividendPayout = (policy) =>
  Number(policy?.classPayoutUSDPerShare) > 0;

export const recalculateDividendPolicyRow = (row, overrides = {}) => {
  const nextRow = {
    ...row,
    ...overrides,
  };
  const selectedFrequency =
    getDividendFrequencyOption(nextRow.classFrequencyKey) || DIVIDEND_POLICY_FREQUENCY_OPTIONS[2];
  const classYieldPercent = roundNumber(nextRow.classYieldPercent, 2);
  const referencePriceUSD = roundNumber(nextRow.referencePriceUSD, 4);
  const classAnnualDividendUSD = roundNumber((referencePriceUSD * classYieldPercent) / 100, 4);
  const classPayoutUSDPerShare = roundNumber(
    selectedFrequency.payoutsPerYear > 0 ? classAnnualDividendUSD / selectedFrequency.payoutsPerYear : 0,
    4,
  );

  return {
    ...nextRow,
    dividendEnabled: nextRow.dividendEnabled !== false,
    useCustomPolicy: Boolean(nextRow.useCustomPolicy),
    classFrequencyKey: selectedFrequency.key,
    classFrequencyLabel: selectedFrequency.label,
    classCycleDays: selectedFrequency.cycleDays,
    classPayoutsPerYear: selectedFrequency.payoutsPerYear,
    classYieldPercent,
    classAnnualDividendUSD,
    classPayoutUSDPerShare,
    classExDividendLeadTradingDays: clampInteger(nextRow.classExDividendLeadTradingDays, 1, 1),
    classFirstPayoutDateNY: normalizeDateKey(nextRow.classFirstPayoutDateNY),
  };
};

export const buildDividendPolicyDraft = ({ stock, policy, dividendInfo, currentPriceUSD }) => {
  const referencePrice = roundNumber(currentPriceUSD, 4);
  const referenceAmountUSDPerShare = roundNumber(dividendInfo?.amountUSDPerShare, 4);
  const referenceFrequencyLabel = dividendInfo?.frequencyLabel || "";
  const referenceAnnualDividendUSD = estimateReferenceAnnualDividendUSD(
    referenceAmountUSDPerShare,
    referenceFrequencyLabel,
  );
  const referenceYieldPercent = estimateYieldPercent(referenceAnnualDividendUSD, referencePrice);
  const selectedFrequencyKey =
    policy?.classFrequencyKey || getReferenceFrequencyOptionKey(referenceFrequencyLabel);
  const classYieldPercent =
    policy?.classYieldPercent != null && policy?.classYieldPercent !== ""
      ? roundNumber(policy.classYieldPercent, 2)
      : referenceYieldPercent;
  const classFirstPayoutDateNY =
    normalizeDateKey(policy?.classFirstPayoutDateNY) || normalizeDateKey(policy?.nextPayoutDateNY);

  return recalculateDividendPolicyRow(
    {
      symbol: normalizeTicker(stock?.symbol || stock?.ticker),
      companyName: String(stock?.companyName || stock?.name || ""),
      categoryName: String(stock?._categoryName || stock?.categoryName || ""),
      dividendEnabled: policy?.dividendEnabled !== false,
      useCustomPolicy: resolveUseCustomPolicy(policy),
      referencePriceUSD: referencePrice,
      referenceAmountUSDPerShare,
      referenceFrequencyLabel,
      referenceAnnualDividendUSD,
      referenceYieldPercent,
      classFrequencyKey: selectedFrequencyKey,
      classYieldPercent,
      classExDividendLeadTradingDays: clampInteger(policy?.classExDividendLeadTradingDays, 1, 1),
      classFirstPayoutDateNY,
      nextPayoutDateNY: normalizeDateKey(policy?.nextPayoutDateNY),
      nextExDateNY: normalizeDateKey(policy?.nextExDateNY),
      lastPaidDateNY: normalizeDateKey(policy?.lastPaidDateNY),
      overrideNextPayoutDateNY: normalizeDateKey(policy?.overrideNextPayoutDateNY),
      overrideNextExDateNY: normalizeDateKey(policy?.overrideNextExDateNY),
      pendingPayoutDateNY: normalizeDateKey(policy?.pendingPayoutDateNY),
      pendingExDateNY: normalizeDateKey(policy?.pendingExDateNY),
      pendingEntitlementDateNY: normalizeDateKey(policy?.pendingEntitlementDateNY),
      scheduleActionType: null,
      updatedAt: policy?.updatedAt || null,
    },
    {},
  );
};

export const buildDividendPolicyPayload = ({ row, updatedBy, updatedByName }) => {
  const classFirstPayoutDateNY = normalizeDateKey(row.classFirstPayoutDateNY);
  const hasStartedSchedule = Boolean(normalizeDateKey(row.lastPaidDateNY));
  const scheduleActionType = String(row.scheduleActionType || "").trim();
  const actionDateNY = normalizeDateKey(row.overrideNextPayoutDateNY);
  const resolveNextProcessingDateNY = (payload) =>
    normalizeDateKey(payload.pendingPayoutDateNY) ||
    normalizeDateKey(payload.overrideNextPayoutDateNY) ||
    normalizeDateKey(payload.nextPayoutDateNY) ||
    normalizeDateKey(payload.classFirstPayoutDateNY) ||
    null;
  const payload = {
    symbol: row.symbol,
    companyName: row.companyName,
    categoryName: row.categoryName,
    enabled: Boolean(row.useCustomPolicy),
    dividendEnabled: row.dividendEnabled !== false,
    useCustomPolicy: Boolean(row.useCustomPolicy),
    referencePriceUSD: roundNumber(row.referencePriceUSD, 4),
    referenceAmountUSDPerShare: roundNumber(row.referenceAmountUSDPerShare, 4),
    referenceFrequencyLabel: row.referenceFrequencyLabel || null,
    referenceAnnualDividendUSD: roundNumber(row.referenceAnnualDividendUSD, 4),
    referenceYieldPercent: roundNumber(row.referenceYieldPercent, 2),
    classFrequencyKey: row.classFrequencyKey,
    classFrequencyLabel: row.classFrequencyLabel,
    classCycleDays: Number(row.classCycleDays) || 30,
    classPayoutsPerYear: Number(row.classPayoutsPerYear) || 12,
    classYieldPercent: roundNumber(row.classYieldPercent, 2),
    classAnnualDividendUSD: roundNumber(row.classAnnualDividendUSD, 4),
    classPayoutUSDPerShare: roundNumber(row.classPayoutUSDPerShare, 4),
    classExDividendLeadTradingDays: clampInteger(row.classExDividendLeadTradingDays, 1, 1),
    classFirstPayoutDateNY,
    nextPayoutDateNY: normalizeDateKey(row.nextPayoutDateNY),
    nextExDateNY: normalizeDateKey(row.nextExDateNY),
    lastPaidDateNY: normalizeDateKey(row.lastPaidDateNY),
    overrideNextPayoutDateNY: normalizeDateKey(row.overrideNextPayoutDateNY),
    overrideNextExDateNY: normalizeDateKey(row.overrideNextExDateNY),
    pendingPayoutDateNY: normalizeDateKey(row.pendingPayoutDateNY),
    pendingExDateNY: normalizeDateKey(row.pendingExDateNY),
    pendingEntitlementDateNY: normalizeDateKey(row.pendingEntitlementDateNY),
    updatedBy,
    updatedByName,
    updatedAt: new Date(),
  };

  if (!Boolean(row.useCustomPolicy)) {
    payload.overrideNextPayoutDateNY = null;
    payload.overrideNextExDateNY = null;
    payload.pendingPayoutDateNY = null;
    payload.pendingExDateNY = null;
    payload.pendingEntitlementDateNY = null;
    payload.nextProcessingDateNY = null;
    return payload;
  }

  if (scheduleActionType === "restart" && actionDateNY) {
    payload.classFirstPayoutDateNY = actionDateNY;
    payload.nextPayoutDateNY = actionDateNY;
    payload.nextExDateNY = null;
    payload.lastPaidDateNY = null;
    payload.overrideNextPayoutDateNY = null;
    payload.overrideNextExDateNY = null;
    payload.pendingPayoutDateNY = null;
    payload.pendingExDateNY = null;
    payload.pendingEntitlementDateNY = null;
    payload.nextProcessingDateNY = actionDateNY;
    return payload;
  }

  if (!hasStartedSchedule) {
    payload.nextPayoutDateNY = classFirstPayoutDateNY;
    payload.nextExDateNY = null;
    payload.lastPaidDateNY = null;
    payload.pendingPayoutDateNY = null;
    payload.pendingExDateNY = null;
    payload.pendingEntitlementDateNY = null;
  }

  payload.nextProcessingDateNY = resolveNextProcessingDateNY(payload);
  return payload;
};

const parseDateKey = (value) => {
  const normalized = normalizeDateKey(value);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const offsetDateKey = (dateKey, amount) => {
  const baseDate = parseDateKey(dateKey);
  if (!baseDate) return null;
  baseDate.setUTCDate(baseDate.getUTCDate() + amount);
  return formatDateKey(baseDate);
};

const isWeekendDateKey = (dateKey) => {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return true;
  const weekday = parsed.getUTCDay();
  return weekday === 0 || weekday === 6;
};

const getNextTradingDateKey = (dateKey) => {
  let cursor = normalizeDateKey(dateKey);
  while (cursor && isWeekendDateKey(cursor)) {
    cursor = offsetDateKey(cursor, 1);
  }
  return cursor;
};

const getTradingDateKeyOffset = (dateKey, offsetDays = 0) => {
  let cursor = getNextTradingDateKey(dateKey);
  if (!cursor) return null;

  let remaining = Math.abs(Math.round(Number(offsetDays) || 0));
  if (remaining === 0) return cursor;

  const step = offsetDays >= 0 ? 1 : -1;
  while (cursor && remaining > 0) {
    cursor = offsetDateKey(cursor, step);
    while (cursor && isWeekendDateKey(cursor)) {
      cursor = offsetDateKey(cursor, step);
    }
    remaining -= 1;
  }

  return cursor;
};

const buildPolicyExDividendDateKey = (payDateNY, leadTradingDays) =>
  getTradingDateKeyOffset(payDateNY, -clampInteger(leadTradingDays, 1, 1));

export const buildDividendPreviewInfo = (policy, fallbackInfo = null) => {
  if (!policy) {
    return fallbackInfo;
  }
  if (policy.dividendEnabled === false) {
    return null;
  }

  const useCustomPolicy = resolveUseCustomPolicy(policy);
  if (!useCustomPolicy) {
    return fallbackInfo;
  }
  if (!hasPositiveCustomDividendPayout(policy)) {
    return null;
  }

  const pendingPayDateNY = normalizeDateKey(policy.pendingPayoutDateNY);
  const pendingExDateNY = normalizeDateKey(policy.pendingExDateNY);
  const overridePayDateNY = normalizeDateKey(policy.overrideNextPayoutDateNY);
  const overrideExDateNY = normalizeDateKey(policy.overrideNextExDateNY);
  const nextPayoutDateNY = normalizeDateKey(policy.nextPayoutDateNY);
  const nextExDateNY = normalizeDateKey(policy.nextExDateNY);
  const firstPayoutDateNY = normalizeDateKey(policy.classFirstPayoutDateNY);
  const hasStartedSchedule = Boolean(normalizeDateKey(policy.lastPaidDateNY));

  let payDateNY =
    (hasStartedSchedule ? nextPayoutDateNY || firstPayoutDateNY : firstPayoutDateNY || nextPayoutDateNY) || null;
  let exDateNY = nextExDateNY || null;

  if (pendingPayDateNY) {
    payDateNY = pendingPayDateNY;
    exDateNY = pendingExDateNY || null;
  } else if (overridePayDateNY) {
    payDateNY = overridePayDateNY;
    exDateNY = overrideExDateNY || null;
  }
  if (!exDateNY && payDateNY) {
    exDateNY = buildPolicyExDividendDateKey(payDateNY, policy.classExDividendLeadTradingDays);
  }

  return {
    eventId: fallbackInfo?.eventId || `class_policy_${policy.symbol}`,
    symbol: policy.symbol,
    amountUSDPerShare: roundNumber(policy.classPayoutUSDPerShare, 4),
    exDateNY,
    payDateNY,
    currency: fallbackInfo?.currency || "USD",
    frequencyLabel: policy.classFrequencyLabel || fallbackInfo?.frequencyLabel || null,
    status: "announced",
    isClassPolicy: true,
    isPendingPolicy: Boolean(pendingPayDateNY),
    hasManualNextPayout: Boolean(overridePayDateNY),
    classYieldPercent: roundNumber(policy.classYieldPercent, 2),
    referenceYieldPercent: roundNumber(policy.referenceYieldPercent, 2),
    classExDividendLeadTradingDays: clampInteger(policy.classExDividendLeadTradingDays, 1, 1),
  };
};
