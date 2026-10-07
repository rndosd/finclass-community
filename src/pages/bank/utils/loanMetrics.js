import {
  calculateRepaymentDate,
  getElapsedLoanDays,
  startOfDayInKST,
  toDate,
} from "./dateUtils";

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_LOAN_STATUSES = new Set([
  "repaid",
  "cancelled_request",
  "rejected",
]);

export function isDecliningBalanceLoan(loan = {}) {
  return loan.interestModel === "declining_balance";
}

export function getLoanPrincipal(loan = {}) {
  return toSafeNumber(loan.principal ?? loan.amount);
}

export function getLoanOutstandingPrincipal(loan = {}) {
  const principal = getLoanPrincipal(loan);
  const status = String(loan.status || "");

  if (status === "pending") {
    return principal;
  }

  return toSafeNumber(loan.amountLeft ?? principal);
}

export function getLoanTotalInterest(loan = {}) {
  return toSafeNumber(
    loan.normalInterestAmount ??
      loan.interestCalculatedOnRequest ??
      loan.expectedProfit ??
      loan.interestLeft,
  );
}

function getDecliningInterestBaseDate(loan = {}) {
  return (
    toDate(loan.interestState?.baseDate) ||
    toDate(loan.startedAt) ||
    toDate(loan.processedAt) ||
    toDate(loan.appliedAt)
  );
}

function getElapsedDecliningInterestDays(loan = {}, now = new Date()) {
  const baseDate = getDecliningInterestBaseDate(loan);
  if (!baseDate) return 0;

  const dueDate = calculateRepaymentDate(loan);
  const today = startOfDayInKST(now);
  const baseDay = startOfDayInKST(baseDate);
  if (!today || !baseDay) return 0;

  const accrualEndDay =
    dueDate && today.getTime() > dueDate.getTime() ? dueDate : today;

  const diffMs = accrualEndDay.getTime() - baseDay.getTime();
  if (diffMs <= 0) return 0;

  return Math.floor(diffMs / ONE_DAY_MS);
}

export function calculateLoanInterestDue(loan = {}, now = new Date()) {
  const status = String(loan.status || "");
  if (CLOSED_LOAN_STATUSES.has(status)) {
    return {
      accruedAmount: 0,
      elapsedDays: 0,
      interestDue: 0,
      newlyAccrued: 0,
      paidAmount: toSafeNumber(loan.interestPaid),
      waivedAmount: toSafeNumber(loan.interestState?.waivedAmount),
    };
  }

  if (isDecliningBalanceLoan(loan)) {
    const state = loan.interestState || {};
    const principalLeft = getLoanOutstandingPrincipal(loan);
    const rate = toSafeNumber(
      loan.finalRateApplied ?? loan.rate ?? loan.baseRate,
    );
    const totalDays = Math.max(1, toSafeNumber(loan.days || 1));
    const elapsedDays = getElapsedDecliningInterestDays(loan, now);
    const newlyAccrued = Math.max(
      0,
      Math.round(principalLeft * (rate / 100) * (elapsedDays / totalDays)),
    );
    const accruedAmount = Math.max(
      0,
      toSafeNumber(state.accruedAmount) + newlyAccrued,
    );
    const paidAmount = toSafeNumber(loan.interestPaid ?? state.paidAmount);
    const waivedAmount = toSafeNumber(state.waivedAmount);

    return {
      accruedAmount,
      elapsedDays,
      interestDue: Math.max(0, accruedAmount - paidAmount - waivedAmount),
      newlyAccrued,
      paidAmount,
      waivedAmount,
    };
  }

  const totalTargetInterest = getLoanTotalInterest(loan);
  const totalDays = Math.max(1, toSafeNumber(loan.days || 1));
  const interestPaid = toSafeNumber(loan.interestPaid);
  const elapsedDays = Math.max(
    0,
    Math.min(totalDays, getElapsedLoanDays(loan, now)),
  );
  const accruedAmount = Math.round(
    (totalTargetInterest / totalDays) * elapsedDays,
  );

  return {
    accruedAmount,
    elapsedDays,
    interestDue: Math.max(0, accruedAmount - interestPaid),
    newlyAccrued: 0,
    paidAmount: interestPaid,
    waivedAmount: 0,
  };
}

export function getLoanRemainingInterest(loan = {}) {
  const status = String(loan.status || "");
  if (CLOSED_LOAN_STATUSES.has(status)) {
    return 0;
  }

  if (status === "ongoing" && isDecliningBalanceLoan(loan)) {
    return calculateLoanInterestDue(loan).interestDue;
  }

  const totalInterest = getLoanTotalInterest(loan);
  const interestPaid = toSafeNumber(loan.interestPaid);

  if (totalInterest > 0 || interestPaid > 0) {
    return Math.max(0, totalInterest - interestPaid);
  }

  return toSafeNumber(loan.interestLeft);
}
