import {
  addCalendarDaysInKST,
  formatDateKeyInKST,
  startOfDayInKST,
  toDate,
} from "../../../utils/kstDate";

const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const DAYS_PER_WEEK = 7;

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toWholeDays = (value) => Math.max(0, Math.floor(toSafeNumber(value)));

export const getWeeklyRentAmount = (desk) =>
  Number(desk?.weeklyRent || desk?.rentPrice || 0);

export const calculateRentAmountFromDays = (weeklyRent, days) => {
  const normalizedWeeklyRent = Math.max(0, toSafeNumber(weeklyRent));
  const normalizedDays = toWholeDays(days);
  if (normalizedWeeklyRent <= 0 || normalizedDays <= 0) return 0;
  return Math.floor((normalizedWeeklyRent * normalizedDays) / DAYS_PER_WEEK);
};

export const calculateCumulativeRentCharge = ({ weeklyRent, paidDays, paidAmount, requestedDays }) => {
  const targetAmount = calculateRentAmountFromDays(
    weeklyRent,
    toWholeDays(paidDays) + toWholeDays(requestedDays),
  );
  return Math.max(0, targetAmount - Math.max(0, toSafeNumber(paidAmount)));
};

export const calculateInitialPrepaidDays = ({ totalContractDays, elapsedContractDays }) => {
  const totalDays = toWholeDays(totalContractDays);
  if (totalDays <= 0) return 0;
  const elapsedDays = Math.max(1, toWholeDays(elapsedContractDays));
  return Math.min(totalDays, Math.max(1, Math.ceil(elapsedDays / DAYS_PER_WEEK)) * DAYS_PER_WEEK);
};

const countInclusiveDaysInKST = (startValue, endValue) => {
  const startDate = startOfDayInKST(toDate(startValue));
  const endDate = startOfDayInKST(toDate(endValue));
  if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) return 0;
  return Math.floor((endDate.getTime() - startDate.getTime()) / ONE_DAY_MS) + 1;
};

const countExclusiveDaysInKST = (startValue, endValue) => {
  const startDate = startOfDayInKST(toDate(startValue));
  const endDate = startOfDayInKST(toDate(endValue));
  if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) return 0;
  return Math.floor((endDate.getTime() - startDate.getTime()) / ONE_DAY_MS);
};

const resolveTrackedPaidDays = (desk, contractStartDate) => {
  const explicitPaidDays = toWholeDays(desk?.rentPaidDays);
  if (explicitPaidDays > 0) return explicitPaidDays;

  const paidUntilDate = startOfDayInKST(toDate(desk?.rentPaidUntil));
  if (!contractStartDate || !paidUntilDate) return 0;
  return countExclusiveDaysInKST(contractStartDate, paidUntilDate);
};

const buildLegacyStatus = ({ desk, weeklyRent, isRentApplicable, hasRentConfigured, rentStartDate }) => {
  const paidUntil = toDate(desk?.rentPaidUntil);
  const paidUntilDate =
    paidUntil && !Number.isNaN(paidUntil.getTime())
      ? startOfDayInKST(paidUntil)
      : null;

  if (!isRentApplicable || !hasRentConfigured) {
    return {
      weeklyRent,
      hasRentConfigured,
      isRentApplicable,
      rentStartDate,
      contractLastDate: null,
      paidUntilDate: null,
      paidDays: 0,
      paidAmount: 0,
      accruedDays: 0,
      accruedAmount: 0,
      overdueAmount: 0,
      dDay: null,
      isPendingStart: false,
      isOverdue: false,
      overdueDays: null,
      hasActiveContract: false,
      needsContract: false,
      isContractEnded: false,
      contractTenantMismatch: false,
      remainingContractDays: null,
      unpaidDays: 0,
      paidThroughDateKey: "",
      statusMode: "not_applicable",
    };
  }

  const todayDate = startOfDayInKST(new Date());
  if (
    rentStartDate &&
    todayDate &&
    rentStartDate.getTime() > todayDate.getTime() &&
    !paidUntilDate
  ) {
    const dDay = Math.floor((rentStartDate - todayDate) / ONE_DAY_MS);
    return {
      weeklyRent,
      hasRentConfigured,
      isRentApplicable,
      rentStartDate,
      contractLastDate: null,
      paidUntilDate: null,
      paidDays: 0,
      paidAmount: 0,
      accruedDays: 0,
      accruedAmount: 0,
      overdueAmount: 0,
      dDay,
      isPendingStart: true,
      isOverdue: false,
      overdueDays: null,
      hasActiveContract: false,
      needsContract: false,
      isContractEnded: false,
      contractTenantMismatch: false,
      remainingContractDays: null,
      unpaidDays: 0,
      paidThroughDateKey: "",
      statusMode: "legacy_pending",
    };
  }

  if (!paidUntilDate) {
    return {
      weeklyRent,
      hasRentConfigured,
      isRentApplicable,
      rentStartDate,
      contractLastDate: null,
      paidUntilDate: null,
      paidDays: 0,
      paidAmount: 0,
      accruedDays: 0,
      accruedAmount: 0,
      overdueAmount: weeklyRent,
      dDay: 0,
      isPendingStart: false,
      isOverdue: true,
      overdueDays: 0,
      hasActiveContract: false,
      needsContract: false,
      isContractEnded: false,
      contractTenantMismatch: false,
      remainingContractDays: null,
      unpaidDays: 0,
      paidThroughDateKey: "",
      statusMode: "legacy_overdue",
    };
  }

  if (!todayDate) {
    return {
      weeklyRent,
      hasRentConfigured,
      isRentApplicable,
      rentStartDate,
      contractLastDate: null,
      paidUntilDate,
      paidDays: 0,
      paidAmount: 0,
      accruedDays: 0,
      accruedAmount: 0,
      overdueAmount: 0,
      dDay: null,
      isPendingStart: false,
      isOverdue: false,
      overdueDays: null,
      hasActiveContract: false,
      needsContract: false,
      isContractEnded: false,
      contractTenantMismatch: false,
      remainingContractDays: null,
      unpaidDays: 0,
      paidThroughDateKey: formatDateKeyInKST(paidUntilDate),
      statusMode: "legacy_unknown",
    };
  }

  const dDay = Math.floor((paidUntilDate - todayDate) / ONE_DAY_MS);
  const isOverdue = dDay <= 0;
  return {
    weeklyRent,
    hasRentConfigured,
    isRentApplicable,
    rentStartDate,
    contractLastDate: null,
    paidUntilDate,
    paidDays: 0,
    paidAmount: 0,
    accruedDays: 0,
    accruedAmount: 0,
    overdueAmount: isOverdue ? weeklyRent : 0,
    dDay,
    isPendingStart: false,
    isOverdue,
    overdueDays: dDay > 0 ? null : Math.abs(dDay),
    hasActiveContract: false,
    needsContract: false,
    isContractEnded: false,
    contractTenantMismatch: false,
    remainingContractDays: null,
    unpaidDays: 0,
    paidThroughDateKey: formatDateKeyInKST(paidUntilDate),
    statusMode: "legacy_active",
  };
};

export const isDeskRentApplicable = (desk) =>
  Boolean(desk?.studentId) &&
  desk?.ownerType !== 'classFund' &&
  desk?.ownerId !== desk?.studentId;

export const getDeskRentStatus = (desk) => {
  const weeklyRent = getWeeklyRentAmount(desk);
  const isRentApplicable = isDeskRentApplicable(desk);
  const hasRentConfigured = weeklyRent > 0;
  const rentStartDate = startOfDayInKST(toDate(desk?.rentStartAt));
  const contractLastDate = startOfDayInKST(toDate(desk?.rentLastDateAt));
  const currentTenantId = String(desk?.studentId || "").trim();
  const contractTenantId = String(desk?.rentTenantId || "").trim();
  const contractTenantMismatch =
    Boolean(contractTenantId) &&
    Boolean(currentTenantId) &&
    contractTenantId !== currentTenantId;
  const hasContractDates = Boolean(rentStartDate && contractLastDate);
  const hasBoundTenant = Boolean(contractTenantId) && contractTenantId === currentTenantId;
  const hasContract = hasRentConfigured && hasContractDates && hasBoundTenant;
  const needsContract = Boolean(
    isRentApplicable &&
      hasRentConfigured &&
      (!hasContract || contractTenantMismatch),
  );

  if (!hasContract) {
    const legacyStatus = buildLegacyStatus({
      desk,
      weeklyRent,
      isRentApplicable,
      hasRentConfigured,
      rentStartDate,
    });

    return {
      ...legacyStatus,
      contractLastDate,
      contractTenantMismatch,
      needsContract:
        legacyStatus.isPendingStart || !isRentApplicable || !hasRentConfigured
          ? false
          : needsContract,
      statusMode: needsContract ? "needs_contract" : legacyStatus.statusMode,
    };
  }

  const todayDate = startOfDayInKST(new Date());
  const paidDays = resolveTrackedPaidDays(desk, rentStartDate);
  const explicitPaidAmount = Math.max(0, toSafeNumber(desk?.rentPaidAmount));
  const paidAmount =
    explicitPaidAmount > 0
      ? explicitPaidAmount
      : calculateRentAmountFromDays(weeklyRent, paidDays);
  const totalContractDays = countInclusiveDaysInKST(rentStartDate, contractLastDate);
  const paidUntilDate = addCalendarDaysInKST(rentStartDate, paidDays);
  const paidThroughDateKey = paidUntilDate ? formatDateKeyInKST(paidUntilDate) : "";
  const depositAmount = Math.max(0, toSafeNumber(desk?.rentDepositAmount));
  const depositStatus = String(desk?.rentDepositStatus || '').trim();
  const lifecycleStatus = String(desk?.rentContractStatus || '').trim() || (
    depositAmount > 0 && depositStatus !== 'paid' ? 'pending_payment' : 'active'
  );
  const isContractPaymentPending = lifecycleStatus !== 'active';
  const elapsedContractDays = todayDate && todayDate.getTime() >= rentStartDate.getTime()
    ? countInclusiveDaysInKST(
        rentStartDate,
        todayDate.getTime() > contractLastDate.getTime() ? contractLastDate : todayDate,
      )
    : 0;
  const initialPaymentDays = calculateInitialPrepaidDays({
    totalContractDays,
    elapsedContractDays,
  });
  const initialRentAmount = calculateCumulativeRentCharge({
    weeklyRent,
    paidDays,
    paidAmount,
    requestedDays: initialPaymentDays,
  });

  // First-payment eligibility is separate from rent accrued since the start date.
  const paymentStatus = {
    isContractPaymentPending,
    lifecycleStatus,
    ...(isContractPaymentPending ? {
      initialPaymentDays,
      initialRentAmount,
      initialPaymentTotal: depositAmount + initialRentAmount,
    } : {}),
  };

  if (todayDate && rentStartDate.getTime() > todayDate.getTime()) {
    const dDay = Math.floor((rentStartDate - todayDate) / ONE_DAY_MS);
    return {
      weeklyRent,
      hasRentConfigured,
      isRentApplicable,
      rentStartDate,
      contractLastDate,
      paidUntilDate,
      paidDays,
      paidAmount,
      accruedDays: 0,
      accruedAmount: 0,
      overdueAmount: 0,
      dDay,
      isPendingStart: true,
      isOverdue: false,
      overdueDays: null,
      hasActiveContract: true,
      ...paymentStatus,
      needsContract: false,
      isContractEnded: false,
      contractTenantMismatch: false,
      remainingContractDays: totalContractDays,
      unpaidDays: 0,
      paidThroughDateKey,
      statusMode: isContractPaymentPending ? "contract_payment_pending" : "contract_pending",
    };
  }

  const effectiveAccrualEnd =
    todayDate && contractLastDate.getTime() < todayDate.getTime()
      ? contractLastDate
      : todayDate;
  const accruedDays = effectiveAccrualEnd
    ? countInclusiveDaysInKST(rentStartDate, effectiveAccrualEnd)
    : 0;
  const accruedAmount = calculateRentAmountFromDays(weeklyRent, accruedDays);
  const unpaidDays = Math.max(0, accruedDays - paidDays);
  const amountDue = Math.max(0, accruedAmount - paidAmount);
  const yesterdayDate = todayDate ? addCalendarDaysInKST(todayDate, -1) : null;
  const overdueAccrualEnd = yesterdayDate && yesterdayDate.getTime() >= rentStartDate.getTime()
    ? (yesterdayDate.getTime() > contractLastDate.getTime() ? contractLastDate : yesterdayDate)
    : null;
  const overdueAccruedDays = overdueAccrualEnd
    ? countInclusiveDaysInKST(rentStartDate, overdueAccrualEnd)
    : 0;
  const overdueDays = Math.max(0, overdueAccruedDays - paidDays);
  const overdueAmount = Math.max(
    0,
    calculateRentAmountFromDays(weeklyRent, overdueAccruedDays) - paidAmount,
  );
  const isContractEnded =
    Boolean(todayDate && contractLastDate.getTime() < todayDate.getTime());
  const remainingContractDays = Math.max(0, totalContractDays - paidDays);
  const dDay =
    paidUntilDate && todayDate
      ? Math.floor((paidUntilDate.getTime() - todayDate.getTime()) / ONE_DAY_MS)
      : null;

  return {
    weeklyRent,
    hasRentConfigured,
    isRentApplicable,
    rentStartDate,
    contractLastDate,
    paidUntilDate,
    paidDays,
    paidAmount,
    accruedDays,
    accruedAmount,
    amountDue,
    overdueAmount,
    dDay,
    isPendingStart: false,
    isOverdue: overdueDays > 0,
    overdueDays: overdueDays > 0 ? overdueDays : null,
    hasActiveContract: true,
    ...paymentStatus,
    needsContract: false,
    isContractEnded,
    contractTenantMismatch: false,
    remainingContractDays,
    unpaidDays,
    paidThroughDateKey,
    statusMode: isContractPaymentPending
      ? "contract_payment_pending"
      : isContractEnded ? "contract_ended" : "contract_active",
  };
};
