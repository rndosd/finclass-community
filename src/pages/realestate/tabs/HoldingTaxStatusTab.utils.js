import {
  addCalendarDaysInKST,
  formatDateInKST,
  formatDateKeyInKST,
  startOfDayInKST,
  toDate,
} from '../../../utils/kstDate';

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const MAX_HOLDING_TAX_PERIOD_DAYS = 28;

export const DEFAULT_HOLDING_TAX_DUE_OFFSET_DAYS = 3;

export const getCurrentWeekStart = (value = new Date()) => {
  const baseDate = toDate(value) || new Date();
  const shifted = new Date(baseDate.getTime() + 9 * 60 * 60 * 1000);
  const kstWeekday = shifted.getUTCDay();
  const diffToMonday = kstWeekday === 0 ? -6 : 1 - kstWeekday;
  return addCalendarDaysInKST(baseDate, diffToMonday);
};

export const countInclusiveDaysInKST = (startValue, endValue) => {
  const start = startOfDayInKST(startValue);
  const end = startOfDayInKST(endValue);
  if (!start || !end || start.getTime() > end.getTime()) return 0;
  return Math.floor((end.getTime() - start.getTime()) / ONE_DAY_MS) + 1;
};

export const getLatestDateInKST = (...values) =>
  values.reduce((latest, value) => {
    const current = startOfDayInKST(value);
    if (!current) return latest;
    if (!latest || current.getTime() > latest.getTime()) return current;
    return latest;
  }, null);

export const buildHoldingTaxPeriod = (periodStart, periodEnd) => ({
  periodStart,
  periodEnd,
  periodDays: countInclusiveDaysInKST(periodStart, periodEnd),
  periodKey: `${formatDateKeyInKST(periodStart)}__${formatDateKeyInKST(periodEnd)}`,
  label: `${formatDateKeyInKST(periodStart)} ~ ${formatDateKeyInKST(periodEnd)}`,
});

export const formatDateRangeLabel = (startValue, endValue) => {
  const start = startOfDayInKST(startValue);
  const end = startOfDayInKST(endValue);
  if (!start || !end) return '-';

  const startLabel = formatDateKeyInKST(start);
  const endLabel = formatDateKeyInKST(end);
  return startLabel === endLabel ? startLabel : `${startLabel} ~ ${endLabel}`;
};

export const splitDateRangeInKST = (
  startValue,
  endValue,
  maxDays = MAX_HOLDING_TAX_PERIOD_DAYS,
) => {
  const start = startOfDayInKST(startValue);
  const end = startOfDayInKST(endValue);
  if (!start || !end || start.getTime() > end.getTime()) return [];

  const segments = [];
  let cursor = start;

  while (cursor.getTime() <= end.getTime()) {
    const chunkEndCandidate =
      addCalendarDaysInKST(cursor, Math.max(0, maxDays - 1)) || cursor;
    const chunkEnd =
      chunkEndCandidate.getTime() < end.getTime() ? chunkEndCandidate : end;

    segments.push({
      start: cursor,
      end: chunkEnd,
      days: countInclusiveDaysInKST(cursor, chunkEnd),
      label: formatDateRangeLabel(cursor, chunkEnd),
    });

    cursor = addCalendarDaysInKST(chunkEnd, 1) || chunkEnd;
  }

  return segments;
};

export const buildMissingHoldingTaxRanges = ({
  runs = [],
  cutoverAt,
  todayAt,
}) => {
  const windowStart = startOfDayInKST(cutoverAt);
  const windowEnd = startOfDayInKST(todayAt);
  if (!windowStart || !windowEnd || windowStart.getTime() > windowEnd.getTime()) {
    return [];
  }

  const issuedRanges = runs
    .map((run) => {
      const periodStart = startOfDayInKST(run?.periodStart);
      const periodEnd = startOfDayInKST(run?.periodEnd);
      if (!periodStart || !periodEnd) return null;

      const clippedStart = getLatestDateInKST(periodStart, windowStart);
      const clippedEnd =
        periodEnd.getTime() > windowEnd.getTime() ? windowEnd : periodEnd;

      if (!clippedStart || clippedStart.getTime() > clippedEnd.getTime()) {
        return null;
      }

      return {
        start: clippedStart,
        end: clippedEnd,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.start.getTime() - right.start.getTime());

  const mergedRanges = [];
  issuedRanges.forEach((range) => {
    const lastRange = mergedRanges[mergedRanges.length - 1];
    if (!lastRange) {
      mergedRanges.push({ ...range });
      return;
    }

    const lastNextDay = addCalendarDaysInKST(lastRange.end, 1) || lastRange.end;
    if (range.start.getTime() <= lastNextDay.getTime()) {
      if (range.end.getTime() > lastRange.end.getTime()) {
        lastRange.end = range.end;
      }
      return;
    }

    mergedRanges.push({ ...range });
  });

  const missingRanges = [];
  let cursor = windowStart;

  mergedRanges.forEach((range) => {
    if (cursor.getTime() < range.start.getTime()) {
      const gapEnd = addCalendarDaysInKST(range.start, -1) || range.start;
      missingRanges.push(...splitDateRangeInKST(cursor, gapEnd));
    }

    const nextCursor = addCalendarDaysInKST(range.end, 1) || range.end;
    if (nextCursor.getTime() > cursor.getTime()) {
      cursor = nextCursor;
    }
  });

  if (cursor.getTime() <= windowEnd.getTime()) {
    missingRanges.push(...splitDateRangeInKST(cursor, windowEnd));
  }

  return missingRanges;
};

export const getDefaultHoldingTaxSelection = (cutoverAt) => {
  const today = startOfDayInKST(new Date()) || new Date();
  const currentWeekStart = getCurrentWeekStart(today) || today;
  const safeCutover = startOfDayInKST(cutoverAt) || today;
  const periodStart =
    safeCutover.getTime() > currentWeekStart.getTime()
      ? safeCutover
      : currentWeekStart;
  const periodEnd = today;
  const dueDate =
    addCalendarDaysInKST(periodEnd, DEFAULT_HOLDING_TAX_DUE_OFFSET_DAYS) ||
    periodEnd;

  return {
    periodStartKey: formatDateKeyInKST(periodStart),
    periodEndKey: formatDateKeyInKST(periodEnd),
    dueDateKey: formatDateKeyInKST(dueDate),
  };
};

export const calculateDeskHoldingTaxPreview = ({
  desk,
  holdingTaxRate,
  cutoverAt,
  periodStart,
  periodEnd,
}) => {
  const officialPrice = Math.max(0, Number(desk?.price || 0));
  const ownerSinceAt = toDate(desk?.ownerSinceAt) || cutoverAt;
  const taxableStartAt = getLatestDateInKST(ownerSinceAt, cutoverAt, periodStart);
  const holdingDaysInPeriod = countInclusiveDaysInKST(taxableStartAt, periodEnd);
  const expectedTax =
    officialPrice > 0 && holdingDaysInPeriod > 0
      ? Math.max(
          0,
          Math.floor(
            officialPrice *
              (Number(holdingTaxRate || 0) / 100) *
              (holdingDaysInPeriod / 7),
          ),
        )
      : 0;

  return {
    officialPrice,
    ownerSinceAt,
    taxableStartAt,
    holdingDaysInPeriod,
    expectedTax,
  };
};

export const isBillPaid = (bill) =>
  bill?.isPaid === true || bill?.status === 'paid';

export const getHoldingDays = (value) => {
  const date = toDate(value);
  if (!date) return null;

  const start = startOfDayInKST(date);
  const today = startOfDayInKST(new Date());
  if (!start || !today) return null;

  const diffDays = Math.floor((today - start) / ONE_DAY_MS);
  return Math.max(1, diffDays + 1);
};

export const formatHoldingDuration = (days) => {
  if (!Number.isFinite(days) || days <= 0) return '보유 정보 없음';

  const weeks = Math.floor(days / 7);
  const remainDays = days % 7;

  if (weeks <= 0) return `${days}일`;
  if (remainDays === 0) return `${weeks}주`;
  return `${weeks}주 ${remainDays}일`;
};

export const formatHoldingWindow = (longestDays, shortestDays) => {
  if (!Number.isFinite(longestDays) || longestDays <= 0) return '보유 정보 없음';
  if (
    !Number.isFinite(shortestDays) ||
    shortestDays <= 0 ||
    longestDays === shortestDays
  ) {
    return `최대 ${formatHoldingDuration(longestDays)}`;
  }

  return `최대 ${formatHoldingDuration(longestDays)} / 최소 ${formatHoldingDuration(shortestDays)}`;
};

export const formatHoldingStartedAt = (value) => {
  const date = toDate(value);
  return date ? formatDateInKST(date) : '보유 정보 없음';
};

export const getStudentLabel = (student) => {
  if (!student) return '미상';
  return student.name || student.displayName || `학생 ${student.studentNumber || ''}`.trim();
};

export const getDeskStatus = ({
  isSystemEnabled,
  holdingTaxEnabled,
  expectedTax,
  bill,
  hasOwner,
  isOverdue,
  showBillState = true,
}) => {
  if (!hasOwner) {
    return {
      label: '국가',
      issueLabel: '-',
      paymentLabel: '-',
      cardTone: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white text-amber-800',
      accentTone: 'bg-amber-400',
      badgeTone: 'bg-amber-100 text-amber-700',
      issueTone: 'text-slate-400',
      paymentTone: 'text-slate-400',
      panelTone: 'border-amber-200 bg-amber-50/80',
    };
  }

  if (!isSystemEnabled || !holdingTaxEnabled) {
    return {
      label: '비활성',
      issueLabel: '-',
      paymentLabel: '-',
      cardTone: 'border-slate-200 bg-slate-50 text-slate-700',
      accentTone: 'bg-slate-300',
      badgeTone: 'bg-slate-200 text-slate-600',
      issueTone: 'text-slate-400',
      paymentTone: 'text-slate-400',
      panelTone: 'border-slate-200 bg-slate-50/80',
    };
  }

  if (expectedTax <= 0) {
    return {
      label: '과세 없음',
      issueLabel: '-',
      paymentLabel: '-',
      cardTone: 'border-slate-200 bg-slate-50 text-slate-700',
      accentTone: 'bg-slate-300',
      badgeTone: 'bg-slate-200 text-slate-600',
      issueTone: 'text-slate-400',
      paymentTone: 'text-slate-400',
      panelTone: 'border-slate-200 bg-slate-50/80',
    };
  }

  if (!showBillState) {
    return {
      label: '정산 대상',
      issueLabel: '탭에서 확인',
      paymentLabel: '-',
      cardTone: 'border-sky-200 bg-gradient-to-br from-sky-50 to-white text-sky-900',
      accentTone: 'bg-sky-400',
      badgeTone: 'bg-sky-100 text-sky-700',
      issueTone: 'text-sky-600',
      paymentTone: 'text-slate-400',
      panelTone: 'border-sky-200 bg-sky-50/80',
    };
  }

  if (!bill) {
    return {
      label: '미발급',
      issueLabel: '미발급',
      paymentLabel: '-',
      cardTone: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white text-amber-900',
      accentTone: 'bg-amber-400',
      badgeTone: 'bg-amber-100 text-amber-700',
      issueTone: 'text-amber-600',
      paymentTone: 'text-slate-400',
      panelTone: 'border-amber-200 bg-amber-50/80',
    };
  }

  if (isBillPaid(bill)) {
    return {
      label: '납부 완료',
      issueLabel: '발급됨',
      paymentLabel: '납부 완료',
      cardTone: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white text-emerald-900',
      accentTone: 'bg-emerald-400',
      badgeTone: 'bg-emerald-100 text-emerald-700',
      issueTone: 'text-slate-600',
      paymentTone: 'text-emerald-600',
      panelTone: 'border-emerald-200 bg-emerald-50/80',
    };
  }

  if (isOverdue) {
    return {
      label: '연체',
      issueLabel: '발급됨',
      paymentLabel: '연체',
      cardTone: 'border-rose-200 bg-gradient-to-br from-rose-50 to-white text-rose-900',
      accentTone: 'bg-rose-500',
      badgeTone: 'bg-rose-100 text-rose-700',
      issueTone: 'text-slate-600',
      paymentTone: 'text-rose-600',
      panelTone: 'border-rose-200 bg-rose-50/80',
    };
  }

  return {
    label: '납부 대기',
    issueLabel: '발급됨',
    paymentLabel: '납부 대기',
    cardTone: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white text-amber-900',
    accentTone: 'bg-amber-400',
    badgeTone: 'bg-amber-100 text-amber-700',
    issueTone: 'text-slate-600',
    paymentTone: 'text-amber-600',
    panelTone: 'border-amber-200 bg-amber-50/80',
  };
};

export const getSpotlightTitle = (index) => {
  if (index === 0) return '예상 보유세 1위';
  if (index === 1) return '상위 과세 대상';
  return '주목할 정산 대상';
};
