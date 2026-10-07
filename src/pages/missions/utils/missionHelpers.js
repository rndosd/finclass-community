// src/pages/missions/utils/missionHelpers.js

import dayjs from "dayjs";
import {
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  MinusCircle,
  HelpCircle,
} from "lucide-react";

import {
  MISSION_STATUS_LABELS,
  MISSION_STATUS_STYLES,
  normalizeStatus,
} from "../constants/missionStatusConstants";
import { toDayKeyKST } from "./dateScope";
import { isMissionAssignedToStudent } from "./missionEligibility";

/* ============================================================================
 * Rewards
 * ==========================================================================*/

/**
 * 미션 보상을 안전하게 추출 (배열/객체 호환)
 * @param {object} mission
 * @returns {{ currency:number, credit:number }}
 */
export const extractRewards = (mission) => {
  const r = mission?.rewards;
  if (Array.isArray(r)) {
    return {
      currency: Number(r.find((x) => x?.type === "currency")?.amount) || 0,
      credit: Number(r.find((x) => x?.type === "credit")?.amount) || 0,
    };
  }
  if (r && typeof r === "object") {
    return {
      currency: Number(r.currency) || 0,
      credit: Number(r.credit) || 0,
    };
  }
  return { currency: 0, credit: 0 };
};

/* ============================================================================
 * Completion / Status
 * ==========================================================================*/

/**
 * 학생의 미션 제출 상태 (없으면 'not_submitted')
 * @param {object} mission
 * @param {string} studentUid
 * @returns {'not_submitted'|'pending'|'late'|'approved'|'rejected'|'cancelled'|'late-approved'}
 */
export const getMissionStatus = (mission, studentUid) => {
  if (!studentUid) return "not_submitted";
  if (mission?.type === "always") {
    const latestAttempt = mission?.lastAttempts?.[studentUid];
    if (!latestAttempt || latestAttempt.dayKey !== toDayKeyKST()) {
      return "not_submitted";
    }

    if (latestAttempt.status === "approved") return "approved";
    if (latestAttempt.status === "pending") return "pending";
    if (latestAttempt.status === "canceled") return "cancelled";

    return "not_submitted";
  }

  const completion = mission?.completions?.[studentUid];

  if (!completion?.status) return "not_submitted";

  // 지각 플래그 확인해서 late-approved로 변환
  if (completion.status === "approved" && completion.late === true) {
    return "late-approved";
  }

  return completion.status;
};

/* ============================================================================
 * Time Window
 * ==========================================================================*/

/**
 * timeWindow 해석 (시작 전 / 진행 중 / 마감됨 / 상시)
 * 정책:
 *  - 시작 전: canSubmit=false
 *  - 마감 후: canSubmit=true (지각 제출 허용)
 *  - 상시(마감 없음): canSubmit=true
 * @param {object} mission
 * @returns {{status:string,label:string,canSubmit:boolean,start:Date|null,end:Date|null}}
 */
export const getMissionTimeStatus = (mission) => {
  const toDate = (v) => (v?.toDate ? v.toDate() : v || null);

  const now = new Date();
  const start = toDate(mission?.timeWindow?.start ?? mission?.startDate);
  const end = toDate(mission?.timeWindow?.end ?? mission?.endDate);
  const allowLateSubmission = mission?.allowLateSubmission !== false;

  if (start && now < start) {
    return {
      status: "not_started",
      label: `${dayjs(start).format("M/D HH:mm")} 시작`,
      canSubmit: false,
      start,
      end,
    };
  }

  if (end && now > end && !allowLateSubmission) {
    return {
      status: "expired",
      label: "마감됨",
      canSubmit: false,
      start,
      end,
    };
  }

  if (end && now > end) {
    return {
      status: "expired",
      label: "마감됨",
      canSubmit: true, // 지각 제출 허용 정책
      start,
      end,
    };
  }

  if (end) {
    return {
      status: "ongoing",
      label: `${dayjs(end).format("M/D HH:mm")} 마감`,
      canSubmit: true,
      start,
      end,
    };
  }

  // 마감 없음 (상시)
  return {
    status: "ongoing",
    label: "상시 진행",
    canSubmit: true,
    start,
    end: null,
  };
};

/* ============================================================================
 * Submit guard
 * ==========================================================================*/

/**
 * 학생이 지금 이 미션을 제출(또는 재제출)할 수 있는지 판단
 * - 대상 제한/시간/현재 제출 상태를 모두 고려
 * - 교사 뷰에서 가시성만 판단하고 싶다면 opts.ignoreTarget=true 로 사용
 *
 * @param {object} mission
 * @param {string} studentUid
 * @param {{ ignoreTarget?: boolean, allowBeforeStart?: boolean }} opts
 *   - ignoreTarget: 타겟 제한 무시(교사 뷰)
 *   - allowBeforeStart: 시작 전 제출 허용(특수 권한)
 * @returns {boolean}
 */
export const canSubmitMission = (mission, studentUid, opts = {}) => {
  const { ignoreTarget = false, allowBeforeStart = false, studentData = null } = opts;

  // 현재 제출 상태(대기/승인 등)는 재제출 가능성에 영향
  const status = getMissionStatus(mission, studentUid);
  const canResubmit =
    status === "not_submitted" ||
    status === "cancelled" ||
    status === "rejected";
  if (!canResubmit) return false;

  // 대상 제한 (교사뷰 무시 가능)
  if (
    !ignoreTarget &&
    !isMissionAssignedToStudent(
      mission,
      studentData ? { ...studentData, uid: studentUid } : { uid: studentUid },
      studentUid,
    )
  ) {
    return false;
  }

  // 시간 제한
  const t = getMissionTimeStatus(mission);
  if (t.status === "not_started" && !allowBeforeStart) return false;

  return true;
};

/* ============================================================================
 * Misc
 * ==========================================================================*/

/**
 * 마감까지 남은 시간 표시 (예: "2시간 10분 남음", "3시간 지남")
 * @param {Date|Timestamp|null} endDate
 * @returns {string|null}
 */
export const getTimeRemaining = (endDate) => {
  if (!endDate) return null;
  const end = endDate?.toDate ? endDate.toDate() : endDate;
  if (!(end instanceof Date) || isNaN(end)) return null;

  const now = new Date();
  const diffMinutes = Math.floor((end - now) / (1000 * 60));

  const abs = Math.abs(diffMinutes);
  const days = Math.floor(abs / (60 * 24));
  const hours = Math.floor((abs % (60 * 24)) / 60);
  const minutes = abs % 60;

  if (diffMinutes <= 0) {
    if (days > 0) return `${days}일 지남`;
    if (hours > 0) return `${hours}시간 지남`;
    return `${minutes}분 지남`;
  } else {
    if (days > 0) return `${days}일 ${hours}시간 남음`;
    if (hours > 0) return `${hours}시간 ${minutes}분 남음`;
    return `${minutes}분 남음`;
  }
};

/* ============================================================================
 * UI Config (labels/styles/icons)
 * ==========================================================================*/

/**
 * 상태 라벨/스타일/아이콘 구성
 * - unknown 상태에도 폴백 제공
 * @param {string} status
 * @returns {{icon:any,text:string,actionText:string,bgColor:string,textColor:string}}
 */
export const getStatusConfig = (status) => {
  const normalized = normalizeStatus(status);

  const iconMap = {
    pending: Clock,
    late: Clock,
    approved: CheckCircle,
    completed: CheckCircle,
    "late-approved": CheckCircle,
    urgent: XCircle,
    overdue: XCircle,
    available: FileText,
    not_submitted: FileText,
    expired: XCircle,
    cancelled: MinusCircle,
    rejected: XCircle,
    none: HelpCircle,
  };

  const actionTextMap = {
    pending: "승인 대기",
    late: "승인 대기(지각)",
    approved: "승인됨",
    completed: "완료됨",
    "late-approved": "승인됨(지각)",
    not_submitted: "미제출",
    expired: "마감됨",
    cancelled: "취소됨",
    rejected: "반려됨",
    none: "기록 없음",
  };

  const textColorFromBg = (bg) => {
    const map = {
      "bg-blue-100 text-blue-700": "text-blue-700",
      "bg-purple-100 text-purple-700": "text-purple-700",
      "bg-green-100 text-green-700": "text-green-700",
      "bg-orange-100 text-orange-700": "text-orange-700",
      "bg-red-100 text-red-700": "text-red-700",
      "bg-red-100 text-red-600": "text-red-600",
      "bg-gray-100 text-gray-700": "text-gray-700",
      "bg-gray-100 text-gray-500": "text-gray-500",
      "bg-slate-100 text-slate-500": "text-slate-500",
    };
    return map[bg] || "text-gray-700";
  };

  if (MISSION_STATUS_LABELS[normalized] && MISSION_STATUS_STYLES[normalized]) {
    return {
      icon: iconMap[normalized] || HelpCircle,
      text: MISSION_STATUS_LABELS[normalized],
      actionText: actionTextMap[normalized] || "상태",
      bgColor: MISSION_STATUS_STYLES[normalized],
      textColor: textColorFromBg(MISSION_STATUS_STYLES[normalized]),
    };
  }

  if (MISSION_STATUS_LABELS[status] && MISSION_STATUS_STYLES[status]) {
    return {
      icon: iconMap[status] || HelpCircle,
      text: MISSION_STATUS_LABELS[status],
      actionText: actionTextMap[status] || "상태",
      bgColor: MISSION_STATUS_STYLES[status],
      textColor: textColorFromBg(MISSION_STATUS_STYLES[status]),
    };
  }

  return {
    icon: HelpCircle,
    text:
      MISSION_STATUS_LABELS[normalized] ||
      MISSION_STATUS_LABELS[status] ||
      status ||
      "알 수 없음",
    actionText: "알 수 없는 상태",
    bgColor: "bg-gray-200",
    textColor: "text-gray-700",
  };
};
