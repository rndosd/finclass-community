import { getDeskRentStatus } from './rentStatus';

export const canSeeDeskOverdue = (desk, { userUid, isTeacher, isAccountSwitching } = {}) =>
  Boolean((!desk?.rentTenantId || String(desk.rentTenantId) === String(desk.studentId || '')) &&
    ((isTeacher && !isAccountSwitching) ||
      (userUid && desk?.studentId && String(desk.studentId) === String(userUid))));

export const getClassroomSeatStatus = (desk, viewer = {}) => {
  if (canSeeDeskOverdue(desk, viewer) && getDeskRentStatus(desk).isOverdue) {
    return { label: '임대료 연체', tone: 'overdue' };
  }
  if (desk.tradeStatus === 'contracting') return { label: '계약 중', tone: 'contract' };
  if (desk.isForSale) return { label: '판매 중', tone: 'sale' };
  if (desk.ownerId && desk.ownerId === viewer.userUid) return { label: '내 소유', tone: 'mine' };
  return { label: '보유 중', tone: 'owned' };
};
