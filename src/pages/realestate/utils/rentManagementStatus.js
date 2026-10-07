import { formatDateKeyInKST, startOfDayInKST, toDate } from '../../../utils/kstDate';
import { getDeskRentStatus, getWeeklyRentAmount } from './rentStatus';

export const RENT_FILTERS = [
  ['all', '전체'], ['active', '진행 중'], ['expired', '만료'],
  ['overdue', '연체'], ['settlement', '정산 필요'], ['none', '계약 없음'],
];

export const getRentManagementStatus = (desk) => {
  const tenantId = desk.rentTenantId || desk.studentId;
  // 계약의 임차인 기준으로 계산한다. 현재 착석 학생의 연체로 오인하지 않는다.
  const rent = getDeskRentStatus({ ...desk, studentId: tenantId });
  const start = startOfDayInKST(toDate(desk.rentStartAt));
  const end = startOfDayInKST(toDate(desk.rentLastDateAt));
  const today = startOfDayInKST(new Date());
  const hasContract = Boolean(desk.rentContractId || (tenantId && start && end) ||
    (tenantId && getWeeklyRentAmount(desk) > 0 && desk.rentPaidUntil));
  const closed = ['ended', 'terminated', 'cancelled', 'settled', 'closed'].includes(desk.rentContractStatus);
  const expired = Boolean(hasContract && end && today && end < today);
  const depositPaid = Math.max(0, Number(desk.rentDepositPaidAmount) || 0);
  const depositOutstanding = Math.max(0, depositPaid - (Number(desk.rentDepositReturnedAmount) || 0)
    - (Number(desk.rentDepositDeductedAmount) || 0));
  const prepaidRefund = expired ? Math.max(0, rent.paidAmount - rent.accruedAmount) : 0;
  const overdue = hasContract && !closed && rent.isOverdue;
  const returnPending = desk.rentDepositStatus === 'return_pending';
  const settlement = Boolean(returnPending || (hasContract && (expired || closed) &&
    (depositOutstanding > 0 || prepaidRefund > 0 || overdue)));
  const active = hasContract && !closed && !expired;
  const state = overdue ? ['임대료 연체', 'overdue'] : settlement ? ['정산 필요', 'sale'] :
    closed ? ['계약 종료', 'owned'] : expired ? ['계약 만료', 'sale'] :
      !hasContract ? ['계약 없음', 'owned'] : rent.isPendingStart ? ['시작 예정', 'contract'] :
        rent.isContractPaymentPending ? ['납부 대기', 'contract'] : ['진행 중', 'owned'];
  const mismatch = Boolean(desk.rentTenantId && desk.rentTenantId !== desk.studentId);
  return { rent, tenantName: desk.rentTenantName || (!mismatch ? desk.studentName : '') || '임차인 확인 필요',
    mismatch, hasContract, expired, closed, active, overdue, settlement,
    depositPaid, depositOutstanding, prepaidRefund, returnPending,
    unpaidRentAmount: hasContract && !closed ? (rent.amountDue ?? rent.overdueAmount) : 0,
    depositUnpaid: Math.max(0, (Number(desk.rentDepositAmount) || 0) - depositPaid),
    daysRemaining: end && today ? Math.max(0, Math.floor((end - today) / 86400000) + 1) : null,
    period: start && end ? `${formatDateKeyInKST(start)} ~ ${formatDateKeyInKST(end)}` : '기간 미설정',
    weeklyRent: getWeeklyRentAmount(desk), status: { label: state[0], tone: state[1] } };
};

export const matchesRentFilter = (row, filter) => filter === 'all' ||
  (filter === 'none' ? !row.hasContract : Boolean(row[filter]));
