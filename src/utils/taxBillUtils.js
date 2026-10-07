const BILL_KIND_META = {
  manual: {
    label: '직접 고지',
    badgeColor: 'slate',
  },
  income_settlement: {
    label: '소득세',
    badgeColor: 'indigo',
  },
  month_end_settlement: {
    label: '월말정산',
    badgeColor: 'emerald',
  },
  realestate_holding: {
    label: '보유세',
    badgeColor: 'amber',
  },
};

const SOURCE_TYPE_LABELS = {
  missionReward: '미션 상금',
  policeReward: '경찰 상금',
  assetAdjustment: '자산 조정',
  arcadePrize: '아케이드 상금',
  stockCapitalGain: '주식 실현차익',
  dividend: '배당금',
};

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toDateValue = (value) => {
  if (!value) return null;

  if (typeof value.toDate === 'function') {
    return value.toDate();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (isPlainObject(value) && typeof value.seconds === 'number') {
    return new Date(
      value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6),
    );
  }

  if (isPlainObject(value) && typeof value._seconds === 'number') {
    return new Date(
      value._seconds * 1000 + Math.floor(Number(value._nanoseconds || 0) / 1e6),
    );
  }

  return null;
};

export const normalizeTaxBillKind = (billKind) =>
  BILL_KIND_META[billKind] ? billKind : 'manual';

export const getTaxBillKindMeta = (billOrKind) => {
  const billKind =
    typeof billOrKind === 'string'
      ? normalizeTaxBillKind(billOrKind)
      : normalizeTaxBillKind(billOrKind?.billKind);

  return {
    key: billKind,
    ...BILL_KIND_META[billKind],
  };
};

export const formatTaxBillDate = (value, locale = 'ko-KR') => {
  const parsed = toDateValue(value);
  return parsed ? parsed.toLocaleDateString(locale) : '-';
};

export const getTaxBillDueDate = (bill) =>
  toDateValue(bill?.dueAt ?? bill?.dueDate ?? null);

export const isTaxBillPaid = (bill) =>
  bill?.isPaid === true || bill?.status === 'paid';

export const isTaxBillOverdue = (bill, now = new Date()) => {
  if (!bill || isTaxBillPaid(bill)) return false;

  const dueDate = getTaxBillDueDate(bill);
  if (!dueDate) return false;

  return dueDate.getTime() < now.getTime();
};

export const getTaxBillOverdueDays = (bill, now = new Date()) => {
  if (!isTaxBillOverdue(bill, now)) return 0;

  const dueDate = getTaxBillDueDate(bill);
  if (!dueDate) return 0;

  const diffMs = now.getTime() - dueDate.getTime();
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
};

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeTaxBillLateFeePolicy = (policy = {}) => {
  const mode = policy.mode === 'rate' ? 'rate' : 'fixed';
  return {
    enabled: policy.enabled === true,
    mode,
    dailyAmount: Math.max(0, toSafeNumber(policy.dailyAmount)),
    dailyRate: Math.max(0, toSafeNumber(policy.dailyRate)),
    graceDays: Math.max(0, Math.floor(toSafeNumber(policy.graceDays))),
  };
};

export const calculateTaxBillLateFee = (bill, now = new Date()) => {
  const policy = normalizeTaxBillLateFeePolicy(bill?.lateFeePolicy);
  const paid = isTaxBillPaid(bill);
  const paidLateFee = Math.max(0, toSafeNumber(bill?.lateFeePaid));

  if (paid) {
    return {
      ...policy,
      amount: paidLateFee,
      overdueDays: 0,
      chargeableDays: 0,
      principalAmount: Math.max(0, toSafeNumber(bill?.amount)),
      isActive: paidLateFee > 0,
    };
  }

  const overdueDays = getTaxBillOverdueDays(bill, now);
  const chargeableDays = policy.enabled
    ? Math.max(0, overdueDays - policy.graceDays)
    : 0;
  const principalAmount = Math.max(
    0,
    toSafeNumber(bill?.amount) - toSafeNumber(bill?.amountPaid),
  );
  const rawAmount =
    policy.mode === 'rate'
      ? principalAmount * (policy.dailyRate / 100) * chargeableDays
      : policy.dailyAmount * chargeableDays;
  const amount = policy.enabled ? Math.max(0, Math.round(rawAmount)) : 0;

  return {
    ...policy,
    amount,
    overdueDays,
    chargeableDays,
    principalAmount,
    isActive: amount > 0,
  };
};

export const getTaxBillPrincipalDue = (bill) =>
  isTaxBillPaid(bill)
    ? 0
    : Math.max(0, toSafeNumber(bill?.amount) - toSafeNumber(bill?.amountPaid));

export const getTaxBillTotalDue = (bill, now = new Date()) =>
  isTaxBillPaid(bill)
    ? 0
    : getTaxBillPrincipalDue(bill) + calculateTaxBillLateFee(bill, now).amount;

export const formatTaxBillPeriod = (bill, locale = 'ko-KR') => {
  const start = toDateValue(bill?.periodStart);
  const end = toDateValue(bill?.periodEnd);
  if (!start || !end) return null;

  return `${start.toLocaleDateString(locale)} ~ ${end.toLocaleDateString(locale)}`;
};

export const getTaxBillSourceLabels = (bill) => {
  if (!Array.isArray(bill?.sourceTypes)) return [];

  return bill.sourceTypes
    .map((sourceType) => SOURCE_TYPE_LABELS[sourceType] || sourceType)
    .filter(Boolean);
};

export const getTaxBillSourceLabel = (sourceType) =>
  SOURCE_TYPE_LABELS[sourceType] || sourceType;

export const formatTaxRatePercent = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `${numericValue}%` : null;
};

export const getTaxBillSourceSummary = (bill) => {
  if (bill?.billKind === 'realestate_holding') {
    const deskCount = Number(bill?.meta?.deskCount || 0);
    const totalOfficialPrice = Number(bill?.meta?.totalOfficialPrice || 0);
    const totalHoldingDays = Number(bill?.meta?.totalHoldingDays || 0);
    const rateLabel = formatTaxRatePercent(bill?.meta?.taxRate);
    const parts = [];

    if (deskCount > 0) parts.push(`좌석 ${deskCount}개`);
    if (totalOfficialPrice > 0) parts.push(`공시가 ${totalOfficialPrice.toLocaleString()}`);
    if (totalHoldingDays > 0) parts.push(`과세 ${totalHoldingDays}일`);
    if (rateLabel) parts.push(`세율 ${rateLabel}`);

    return parts.length > 0 ? parts.join(' · ') : null;
  }

  const labels = getTaxBillSourceLabels(bill);
  if (labels.length === 0) return null;
  if (labels.length <= 2) return labels.join(', ');
  return `${labels.slice(0, 2).join(', ')} 외 ${labels.length - 2}개`;
};
