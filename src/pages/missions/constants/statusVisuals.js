// src/pages/missions/constants/statusVisuals.js

// 상태별 아이콘 / 색 / 레이블 / 힌트
export const STATUS_VISUALS = {
  unsubmitted: {
    icon: "file-text",
    label: "미제출",
    bg: "bg-slate-100",
    ring: "ring-slate-300",
    text: "text-slate-800",
    iconColor: "text-slate-500",
  },
  pending: {
    icon: "clock",
    label: "승인 대기",
    hint: "클릭 시 승인",
    bg: "bg-blue-100",
    ring: "ring-blue-300",
    text: "text-blue-800",
    iconColor: "text-blue-600",
  },
  late: {
    icon: "clock",
    label: "지각 제출",
    hint: "클릭 시 승인 (보상 없음)",
    bg: "bg-orange-100", // 지각은 오렌지 배경으로 구분
    ring: "ring-orange-300",
    text: "text-orange-800",
    iconColor: "text-orange-600",
  },
  approved: {
    icon: "check-circle",
    label: "승인 완료",
    hint: "클릭 시 취소",
    bg: "bg-emerald-100",
    ring: "ring-emerald-300",
    text: "text-emerald-800",
    iconColor: "text-emerald-600",
  },
  "late-approved": {
    icon: "check-circle", // 같은 체크 아이콘
    label: "늦은 제출 승인",
    hint: "클릭 시 취소",
    bg: "bg-yellow-100", // 노란색 배경으로 변경
    ring: "ring-yellow-300",
    text: "text-yellow-800",
    iconColor: "text-yellow-600",
  },
  rejected: {
    icon: "x-circle",
    label: "반려됨",
    hint: "사유 확인 후 재제출",
    bg: "bg-red-100",
    ring: "ring-red-300",
    text: "text-red-800",
    iconColor: "text-red-600",
  },
  before_start: {
    icon: "clock",
    label: "곧 시작",
    hint: "시작 시간 이후 제출 가능",
    bg: "bg-violet-100",
    ring: "ring-violet-300",
    text: "text-violet-800",
    iconColor: "text-violet-600",
  },

  // 참고: 레전드·UI용 가상 상태 키 (실제 승인/취소 액션은 StatusIcon에서 props로 처리)
  "progress-pending": {
    icon: "clock",
    label: "프로그레스 승인 대기",
    hint: "기록 접수됨 — 교사 승인 필요",
    bg: "bg-blue-100",
    ring: "ring-blue-300",
    text: "text-blue-800",
    iconColor: "text-blue-600",
  },

  // 과거 키 보정 - closed 상태 제거
  deadline_missed: null,
};

export function getStatusVisual(status) {
  if (STATUS_VISUALS[status]) return STATUS_VISUALS[status];
  return STATUS_VISUALS.unsubmitted;
}

export const STATUS_BADGE_STYLES = {
  before_start: "bg-violet-100 text-violet-700",
  unsubmitted: "bg-slate-100 text-slate-500",
  pending: "bg-blue-100 text-blue-700 border border-blue-200",
  late: "bg-orange-100 text-orange-700 border border-orange-200 animate-pulse",
  approved: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  "late-approved": "bg-amber-100 text-amber-700 border border-amber-200",
  rejected: "bg-red-100 text-red-600",
  "progress-pending": "bg-blue-100 text-blue-700 border border-blue-200",
};

export function getStatusBadgeStyle(status, fallback = STATUS_BADGE_STYLES.unsubmitted) {
  return STATUS_BADGE_STYLES[status] || fallback;
}

/**
 * Legend에 쓸 아이템(표시 순서 포함)
 * - 기본 상태들은 icon 기반
 * - 챌린지 전용 항목은 demo(원형 배지)로 렌더할 수 있게 정보 제공
 *   - Legend.jsx가 demo가 있으면 원형 배지로, 없으면 icon으로 표시
 */
export const LEGEND_ITEMS = [
  // --- 챌린지 전용 (상단 배치) ---
  {
    key: "progress-pending",
    label: "프로그레스 승인 대기",
    hint: "제출(기록) 접수됨 — 교사 승인 후 누적",
    // 원형 배지 데모 (챌린지용)
    demo: { bg: "bg-amber-500", text: "!" },
  },
  {
    key: "challenge_progress",
    label: "프로그레스 진행(승인 누적)",
    hint: "원 안 숫자 = 승인된 진행 횟수\n목표 달성 시 초록색",
    // 파랑=진행 중, 초록=목표 달성 예시
    demo: { bg: "bg-blue-500", text: "3" },
    demoAlt: { bg: "bg-green-500", text: "5" },
  },

  // --- 일반 상태들 ---
  { key: "unsubmitted", icon: "file-text", label: "미제출", hint: null },
  { key: "pending", icon: "clock", label: "승인 대기", hint: "클릭 시 승인" },
  {
    key: "late",
    icon: "clock",
    label: "지각 제출",
    hint: "클릭 시 승인\n(보상 없음)",
  },
  {
    key: "approved",
    icon: "check-circle",
    label: "승인 완료",
    hint: "클릭 시 취소",
  },
  {
    key: "late-approved",
    icon: "check-circle",
    label: "늦은 제출 승인",
    hint: "클릭 시 취소",
  },
  {
    key: "rejected",
    icon: "x-circle",
    label: "반려됨",
    hint: "사유 확인 후 재제출",
  },
  {
    key: "before_start",
    icon: "clock",
    label: "곧 시작",
    hint: "시작 시간 이후 제출 가능",
  },
];

// 자동 생성 버전(참고용): 챌린지 demo 항목은 포함되지 않으므로 레전드엔 위 LEGEND_ITEMS 사용 권장
export const LEGEND_ITEMS_AUTO = Object.entries(STATUS_VISUALS)
  .filter(([key, value]) => value !== null)
  .map(([key, value]) => ({
    key,
    icon: value.icon,
    label: value.label,
    hint: value.hint || null,
  }));
