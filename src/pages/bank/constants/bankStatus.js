// src/pages/bank/constants/bankStatus.js

/** 상태 → 한글 라벨 */
export const STATUS_LABELS = {
    pending: '대기중',
    active: '진행중',
    ongoing: '진행중',
    claimable: '수령가능',
    completed: '만료',
    rejected: '거절됨',
    cancelled: '취소됨',
    cancelled_request: '요청취소',
    approved: '승인됨',
    repaid: '상환완료',
    overdue: '연체중',
    defaulted: '부실',
    terminated: '중도해지',
};

/**
 * 상태 → Badge tone 매핑
 * Badge.jsx의 tone 키를 그대로 사용 (gradient 변형과 잘 어울리는 파스텔 톤)
 */
const STATUS_TONE = {
    pending: 'amber',
    approved: 'emerald',
    active: 'blue',
    ongoing: 'blue',
    claimable: 'teal',
    completed: 'emerald',
    repaid: 'emerald',
    overdue: 'orange',
    defaulted: 'red',
    rejected: 'slate',
    cancelled: 'slate',
    cancelled_request: 'slate',
    terminated: 'violet',
};

/** (옵션) 제품군별 상태 옵션 */
const SAVINGS_STATUS = [
    { value: 'all', label: '전체' },
    { value: 'pending', label: STATUS_LABELS.pending },
    { value: 'active', label: STATUS_LABELS.active },
    { value: 'terminated', label: STATUS_LABELS.terminated },
    { value: 'completed', label: STATUS_LABELS.completed },
    { value: 'rejected', label: STATUS_LABELS.rejected },
    { value: 'cancelled', label: STATUS_LABELS.cancelled },
    { value: 'cancelled_request', label: STATUS_LABELS.cancelled_request },
];

const LOANS_STATUS = [
    { value: 'all', label: '전체' },
    { value: 'pending', label: STATUS_LABELS.pending },
    { value: 'approved', label: STATUS_LABELS.approved },
    { value: 'ongoing', label: STATUS_LABELS.ongoing },
    { value: 'repaid', label: STATUS_LABELS.repaid },
    { value: 'overdue', label: STATUS_LABELS.overdue },
    { value: 'defaulted', label: STATUS_LABELS.defaulted },
];

/** 헬퍼: 상태 라벨 */
export function getStatusLabel(status) {
    return STATUS_LABELS[status] || status || '';
}

/**
 * ✅ 헬퍼: 상태 뱃지에 바로 전달할 props
 * - gradient + pill + sm 기본값 (핀클래스 입체감 스타일)
 * - 필요 시 size/variant/pill 덮어쓰기 가능
 */
export function getStatusBadgeProps(status, opts = {}) {
    const {
        size = 'sm',
        variant = 'gradient', // gradient | solid | soft | outline
        pill = true,
        className = '',       // 추가 커스텀 클래스가 필요하면 전달
        tone: toneOverride,   // 특정 화면에서 톤만 바꾸고 싶을 때
    } = opts;

    const tone = toneOverride || STATUS_TONE[status] || 'slate';

    return {
        tone,
        size,
        variant,
        pill,
        className,
    };
}

/** (옵션) 필터 드롭다운용 */
export function getStatusOptions(tab) {
    return tab === 'loans' ? LOANS_STATUS : SAVINGS_STATUS;
}

/* ─────────────────────────────────────────────────────────
   ⛳️ (하위호환) 기존 class 기반 호출이 남아있다면 임시 유지:
   - 새 코드에서는 getStatusBadgeProps 를 사용하세요.
   - 필요 없으면 아래 export 삭제해도 됩니다.
────────────────────────────────────────────────────────── */
export const STATUS_BADGE_CLASSES = {
    pending: 'bg-amber-100 text-amber-700 border-amber-200',
    approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    active: 'bg-blue-100 text-blue-700 border-blue-200',
    ongoing: 'bg-blue-100 text-blue-700 border-blue-200',
    completed: 'bg-emerald-200 text-emerald-800 border-emerald-300',
    repaid: 'bg-emerald-200 text-emerald-800 border-emerald-300',
    overdue: 'bg-orange-100 text-orange-700 border-orange-200',
    defaulted: 'bg-red-100 text-red-700 border-red-200',
    rejected: 'bg-slate-200 text-slate-700 border-slate-300',
    cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
    cancelled_request: 'bg-slate-100 text-slate-500 border-slate-200',
    terminated: 'bg-violet-100 text-violet-700 border-violet-200',
};

export function getStatusBadgeClasses(status) {
    return STATUS_BADGE_CLASSES[status] || 'bg-slate-100 text-slate-700 border-slate-200';
}
