// src/pages/missions/constants/missionStatusConstants.js
import {
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { getStatusBadgeStyle } from "./statusVisuals";

/**
 * ===============================
 *  상태 라벨 / 스타일 (statusVisuals.js와 일치)
 * ===============================
 */

// 미션 상태별 표시 텍스트 (영어 키 → 한글 라벨)
export const MISSION_STATUS_LABELS = {
  // 섹션성 상태
  urgent: "긴급",
  overdue: "마감",
  available: "제출 가능",
  upcoming: "예정",
  before_start: "곧 시작", // ✅ 추가

  // 제출/승인 흐름 (statusVisuals.js와 일치)
  pending: "승인 대기", // 제때 내고 기다리는 중
  late: "늦은 제출·대기", // 늦게 내고 기다리는 중 (🚨 변경)
  approved: "승인 완료", // 제때 내고 통과
  "late-approved": "늦은 제출 승인", //

  // 기타 상태
  not_submitted: "미제출",
  expired: "만료됨",
  cancelled: "취소됨",
  rejected: "반려됨",
  none: "미제출",
  completed: "완료",

  // (선택) 시작 1시간 전 예고 상태
  preview: "예고",
};

// 미션 상태별 스타일 클래스 (statusVisuals.js와 일치)
export const MISSION_STATUS_STYLES = {
  // 섹션성 상태
  urgent: "bg-red-600 text-white shadow-md animate-pulse",
  overdue: "bg-slate-900 text-white shadow-lg",
  available: "bg-gray-100 text-gray-700",
  upcoming: "bg-indigo-100 text-indigo-700",
  before_start: getStatusBadgeStyle("before_start"), // ✅ 추가

  // 제출/승인 흐름 (statusVisuals.js 색상과 일치)
  unsubmitted: getStatusBadgeStyle("unsubmitted"),
  pending: getStatusBadgeStyle("pending"),
  late: getStatusBadgeStyle("late"), // 지각 대기 시 살짝 깜빡임
  approved: getStatusBadgeStyle("approved"),
  "late-approved": getStatusBadgeStyle("late-approved"),

  // 기타 매핑
  not_submitted: getStatusBadgeStyle("unsubmitted"),
  expired: "bg-red-100 text-red-600",
  cancelled: getStatusBadgeStyle("unsubmitted"),
  rejected: getStatusBadgeStyle("rejected"),
  none: getStatusBadgeStyle("unsubmitted"),
  completed: getStatusBadgeStyle("approved"),

  // (선택) 예고 상태
  preview: "bg-indigo-50 text-indigo-600",
};

/**
 * ===============================
 *  액션 버튼 공통
 * ===============================
 */

export const MISSION_ACTION_STYLES = {
  overdue: "bg-orange-600 hover:bg-orange-700 text-white",
  urgent: "bg-red-600 hover:bg-red-700 text-white",
  default: "bg-blue-600 hover:bg-blue-700 text-white",
};

export const MISSION_ACTION_LABELS = {
  processing: "처리중...",
  overdue: "늦은제출",
  autoApprove: "완료하기",
  submit: "제출하기",
  record: "진행하기",
  before_start: "시작 후 가능", // ✅ 추가
};

/**
 * ===============================
 *  섹션 구성 상수
 * ===============================
 */

export const MISSION_SECTIONS = [
  {
    key: "urgent",
    title: "곧 마감",
    icon: ExclamationTriangleIcon,
    color: "text-red-600",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
    description: "24시간 이내 마감",
    defaultExpanded: true,
  },
  {
    key: "normal",
    title: "일반 과제",
    icon: DocumentTextIcon,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    description: "여유 있는 과제들",
    defaultExpanded: true,
  },
  {
    key: "overdue",
    title: "마감 지난 과제",
    icon: ClockIcon,
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-200",
    description: "늦은 제출 가능",
    defaultExpanded: true,
  },
  {
    key: "completed",
    title: "완료/대기 과제",
    icon: CheckCircleIcon,
    color: "text-green-600",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
    description: "제출 완료 및 승인 대기",
    defaultExpanded: false,
  },
];

// 섹션 필터
export const filterMissionsBySectionForStudent = (missions, selfUid) => {
  return {
    urgent: missions.filter((m) => m.displayStatus === "urgent"),
    // 아직 안 낸 것들 + 예정
    normal: missions.filter((m) => {
      const comp = m._completion ?? m.completions?.[selfUid];
      // 이미 제출한 애들은 normal에서 빼고 completed로 보내자
      if (
        comp &&
        ["pending", "approved", "late", "late-approved", "rejected"].includes(
          comp.status,
        )
      ) {
        return false;
      }
      return m.displayStatus === "available" || m.displayStatus === "upcoming";
    }),
    overdue: missions.filter((m) => m.displayStatus === "overdue"),
    // 🔥 여기 핵심: 학생 입장에서 완료/대기/반려 된 것
    completed: missions.filter((m) => {
      const comp = m._completion ?? m.completions?.[selfUid];
      if (!comp) return false;
      return [
        "pending", // 제출했는데 승인 대기
        "approved", // 승인됨
        "late", // 지각제출 (선생님 승인 전)
        "late-approved", // 지각 승인
        "rejected", // 선생님이 반려
      ].includes(comp.status);
    }),
  };
};

/**
 * ===============================
 *  진행도(챌린지) 계산
 * ===============================
 */

// 챌린지(프로그레스) 여부
export const isChallenge = (mission) =>
  mission?.type === "challenge" && Number(mission?.goalCount) > 0;

// ✅ 진행/목표 카운트를 한번에 (캐시 우선)
export const getProgressCounts = (mission, uid) => {
  const comp = mission?._completion ?? mission?.completions?.[uid] ?? {};
  const rawCount = comp?.progressCount ?? mission?.progressCount ?? 0;
  const rawGoal = comp?.goalCount ?? mission?.goalCount ?? 1;

  const count = Number(rawCount);
  const goal = Number(rawGoal);

  return {
    count: Number.isFinite(count) && count >= 0 ? count : 0,
    goal: Number.isFinite(goal) && goal > 0 ? goal : 1,
  };
};

// 진행도 a/b 라벨 (예: "1/5")
export const getProgressFractionLabel = (mission, uid) => {
  if (!isChallenge(mission)) return "";
  const { count, goal } = getProgressCounts(mission, uid);
  return `${Math.min(count, goal)}/${goal}`;
};

/**
 * ===============================
 *  시작 전 판정 헬퍼
 * ===============================
 */

// ✅ 시작일이 지나지 않았는지 체크
export const isBeforeStart = (mission) => {
  const toDate = (v) => (v?.toDate ? v.toDate() : v || null);
  const startAt = toDate(mission?.timeWindow?.start || mission?.startDate);
  if (!startAt) return false;
  return new Date() < startAt;
};

/**
 * ===============================
 *  상태 라벨/스타일 (백엔드 late 플래그 체계 적용)
 * ===============================
 */

// 지각 판정: completion.late 우선, 없으면 submittedAt vs deadline
const isLateCompletion = (mission, completion) => {
  if (!completion) return false;
  if (typeof completion.late === "boolean") return completion.late;
  const toDate = (v) => (v?.toDate ? v.toDate() : v || null);
  const submittedAt = toDate(completion.submittedAt);
  const end = toDate(mission?.timeWindow?.end || mission?.endDate);
  return !!(end && submittedAt && submittedAt > end);
};

// ✅ 상태 라벨 (시작 전 케이스 추가)
export const getMissionStatusLabel = (mission, completion) => {
  // ✅ 시작 전이면 "곧 시작"
  if (isBeforeStart(mission)) return MISSION_STATUS_LABELS.before_start;

  const status = completion?.status;

  if (status === "rejected") return MISSION_STATUS_LABELS.rejected;
  if (status === "approved") {
    return isLateCompletion(mission, completion)
      ? MISSION_STATUS_LABELS["late-approved"]
      : MISSION_STATUS_LABELS.approved;
  }
  if (status === "pending") return MISSION_STATUS_LABELS.pending;
  if (status === "late") return MISSION_STATUS_LABELS.late;

  // 제출 전: 섹션 상태 보조 표기
  if (mission.displayStatus === "urgent") return MISSION_STATUS_LABELS.urgent;
  if (mission.displayStatus === "overdue") return MISSION_STATUS_LABELS.overdue;
  if (mission.displayStatus === "upcoming")
    return MISSION_STATUS_LABELS.upcoming;

  return MISSION_STATUS_LABELS.available;
};

// ✅ 상태 스타일 (시작 전 케이스 추가)
export const getMissionStatusStyle = (mission, completion) => {
  // ✅ 시작 전이면 보라색
  if (isBeforeStart(mission)) return MISSION_STATUS_STYLES.before_start;

  const status = completion?.status;

  if (status === "rejected") return MISSION_STATUS_STYLES.rejected;
  if (status === "approved") {
    return isLateCompletion(mission, completion)
      ? MISSION_STATUS_STYLES["late-approved"] // 노란색
      : MISSION_STATUS_STYLES.approved; // 초록색
  }
  if (status === "pending") return MISSION_STATUS_STYLES.pending; // 파란색
  if (status === "late") return MISSION_STATUS_STYLES.late; // 오렌지색

  if (mission.displayStatus === "urgent") return MISSION_STATUS_STYLES.urgent;
  if (mission.displayStatus === "overdue") return MISSION_STATUS_STYLES.overdue;
  if (mission.displayStatus === "upcoming")
    return MISSION_STATUS_STYLES.upcoming;

  return MISSION_STATUS_STYLES.available;
};

/**
 * ===============================
 *  액션 버튼
 * ===============================
 */

// 스타일 (기존 유지)
export const getActionButtonStyle = (mission) => {
  if (mission.displayStatus === "overdue") return MISSION_ACTION_STYLES.overdue;
  if (mission.displayStatus === "urgent") return MISSION_ACTION_STYLES.urgent;
  return MISSION_ACTION_STYLES.default;
};

// 기본 텍스트 (레거시 호환)
export const getActionButtonText = (mission, isSubmitting) => {
  if (isSubmitting) return MISSION_ACTION_LABELS.processing;
  if (mission.displayStatus === "overdue") return MISSION_ACTION_LABELS.overdue;
  if (mission.autoApprove) return MISSION_ACTION_LABELS.autoApprove;
  return MISSION_ACTION_LABELS.submit;
};

// 정책 통합 ('auto' | 'manual')
const getApprovalPolicy = (mission) => {
  if (mission?.approvalPolicy) return mission.approvalPolicy;
  return mission?.autoApprove ? "auto" : "manual";
};

// ✅ 새 텍스트 V2 (시작 전 케이스 추가)
export const getActionButtonTextV2 = (
  mission,
  isSubmitting,
  { selfUid } = {},
) => {
  if (isSubmitting) return MISSION_ACTION_LABELS.processing;

  // ✅ 시작 전이면 "시작 후 가능"
  if (isBeforeStart(mission)) return MISSION_ACTION_LABELS.before_start;

  // 마감 경고 표현 유지
  if (mission.displayStatus === "overdue") return MISSION_ACTION_LABELS.overdue;

  if (isChallenge(mission)) {
    const { count, goal } = getProgressCounts(mission, selfUid);
    const willComplete = count + 1 >= goal;
    return willComplete ? "완료하기" : "진행하기";
  }

  const policy = getApprovalPolicy(mission);
  return policy === "auto"
    ? MISSION_ACTION_LABELS.autoApprove
    : MISSION_ACTION_LABELS.submit;
};

/**
 * ===============================
 *  상태 → 액션 키/라벨 (기존 유지)
 * ===============================
 */

export const STATUS_ACTION_KEYS = {
  not_submitted: "submit",
  unsubmitted: "submit",
  rejected: "submit",
  pending: "approve",
  late: "approve",
  approved: "cancel",
  "late-approved": "cancel",
  upcoming: null,
  before_start: null, // ✅ 추가
};

export const getActionKeyByStatus = (status) =>
  Object.prototype.hasOwnProperty.call(STATUS_ACTION_KEYS, status)
    ? STATUS_ACTION_KEYS[status]
    : null;

export const STATUS_ACTION_LABELS = {
  submit: "클릭 시 제출",
  approve: "클릭 시 승인",
  cancel: "클릭 시 취소",
};

// ✅ 외부에서 쓰는 상태 정규화 (late-approved 유지하도록 수정)
export const normalizeStatus = (status) => {
  if (status == null) return "none";
  const s = String(status);

  // completed → approved 로만 변환 (late-approved는 그대로 유지)
  if (s === "completed") return "approved";
  if (s === "not_submitted") return "unsubmitted";

  // late-approved는 그대로 유지 (중요!)
  return s;
};
