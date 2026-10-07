import {
  addCalendarDaysInKST as addCalendarDaysInKSTBase,
  startOfDayInKST as startOfDayInKSTBase,
  toDate as toDateBase,
} from "../../../utils/kstDate";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Firestore Timestamp | Date | ISO -> Date 객체로 변환 */
export const toDate = toDateBase;

/** UI 비교 기준도 항상 KST 자정으로 통일 */
export const startOfDayInKST = startOfDayInKSTBase;

/** KST 달력 일수 더하기 */
export const addCalendarDaysInKST = addCalendarDaysInKSTBase;

/**
 * 예금 만기일 계산
 * 우선순위: expectedMaturityDate(DB 확정값) -> (시작일 + 기간)
 */
export function calculateMaturityDate(saving) {
  const start =
    toDate(saving?.startedAt) ||
    toDate(saving?.processedAt) ||
    toDate(saving?.appliedAt);

  const days = Number(saving?.days || 0);
  const priorityFields = [
    "expectedMaturityDate",
    "actualMaturityDate",
    "maturityDate",
  ];

  for (const field of priorityFields) {
    const fixedValue = toDate(saving?.[field]);
    if (fixedValue) return startOfDayInKST(fixedValue);
  }

  if (start && days > 0) {
    return addCalendarDaysInKST(start, days);
  }
  return null;
}

/** 만기 도래 여부 */
export function isClaimableByMaturity(saving, now = new Date()) {
  const maturity = calculateMaturityDate(saving);
  if (!maturity) return false;

  const today = startOfDayInKST(now);
  const targetMaturity = startOfDayInKST(maturity);
  return today.getTime() >= targetMaturity.getTime();
}

/** 이자 계산 (확정값 우선) */
export function calculateFinalInterest(saving) {
  if (
    saving.finalInterestPaid !== undefined &&
    saving.finalInterestPaid !== null
  ) {
    return Number(saving.finalInterestPaid);
  }
  return Number(
    saving.interestCalculatedOnRequest ?? saving.expectedProfit ?? 0,
  );
}

/** 대출 상환 예정일 계산 */
export function calculateRepaymentDate(loan) {
  const start =
    toDate(loan?.startedAt) ||
    toDate(loan?.processedAt) ||
    toDate(loan?.appliedAt);

  const days = Number(loan?.days || 0);
  const priorityFields = [
    "expectedRepaymentDate",
    "actualRepaymentDate",
    "repaymentDate",
  ];

  for (const field of priorityFields) {
    const fixedValue = toDate(loan?.[field]);
    if (fixedValue) return startOfDayInKST(fixedValue);
  }

  if (start && days > 0) {
    return addCalendarDaysInKST(start, days);
  }
  return null;
}

/** 대출 상환일 도래 여부 */
export function getElapsedLoanDays(loan, now = new Date()) {
  const startDate =
    toDate(loan?.startedAt) ||
    toDate(loan?.processedAt) ||
    toDate(loan?.appliedAt);
  const startDay = startOfDayInKST(startDate);
  const today = startOfDayInKST(now);

  if (!startDay || !today) return 0;

  const diffMs = today.getTime() - startDay.getTime();
  if (diffMs <= 0) return 0;

  return Math.floor(diffMs / ONE_DAY_MS);
}

export function resolveLoanPenaltyBaseDate(loan) {
  const repaymentDate = calculateRepaymentDate(loan);
  const penaltyBaseDate = toDate(loan?.penaltyBaseDate);
  const effectiveBaseDate =
    repaymentDate && penaltyBaseDate
      ? penaltyBaseDate.getTime() > repaymentDate.getTime()
        ? penaltyBaseDate
        : repaymentDate
      : penaltyBaseDate || repaymentDate;

  return effectiveBaseDate ? startOfDayInKST(effectiveBaseDate) : null;
}

export function getLoanOverdueDays(loan, now = new Date()) {
  const baseDate = resolveLoanPenaltyBaseDate(loan);
  const today = startOfDayInKST(now);

  if (!baseDate || !today) return 0;

  const diffMs = today.getTime() - baseDate.getTime();
  if (diffMs <= 0) return 0;

  return Math.floor(diffMs / ONE_DAY_MS);
}

export function hasLoanOverduePenalty(loan, now = new Date()) {
  return getLoanOverdueDays(loan, now) > 0;
}

export function isDueForRepayment(loan, now = new Date()) {
  const repay = calculateRepaymentDate(loan);
  if (!repay) return false;

  const today = startOfDayInKST(now);
  const targetRepay = startOfDayInKST(repay);
  return today.getTime() >= targetRepay.getTime();
}
