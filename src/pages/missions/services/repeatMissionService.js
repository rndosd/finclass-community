// src/pages/missions/services/repeatMissionService.js
import { getFunctions, httpsCallable } from "firebase/functions";
const CLONE_TOKEN_STORAGE_KEY = "";
const cloneRequest = () => {
  throw new Error("Experimental provider is excluded from this installation.");
};
// 🔥 리전 지정
const functions = getFunctions(undefined, "asia-northeast3");
const MISSION_ACTION_PROVIDER_STORAGE_KEY = "finclass.missionAction.provider";
function getMissionRepeatProvider() {
  const envProvider = String(process.env.REACT_APP_MISSION_ACTION_PROVIDER || "").trim().toLowerCase();
  if (envProvider === "firebase") return "firebase";
  if (typeof window !== "undefined") {
    const storedProvider = String(window.localStorage.getItem(MISSION_ACTION_PROVIDER_STORAGE_KEY) || "").trim().toLowerCase();
    if (storedProvider === "firebase") return "firebase";
  }
  return "firebase";
}
function getSelfhostToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(CLONE_TOKEN_STORAGE_KEY) || "";
}
function toIsoStringOrNull(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function getRewardCash(rewards) {
  const currencyReward = Array.isArray(rewards) ? rewards.find(reward => reward?.type === "currency" || reward?.type === "cash") : null;
  const value = currencyReward?.amount ?? currencyReward?.maxAmount ?? currencyReward?.minAmount ?? 0;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}
function applyTemplateTime(repeatDate, templateDate) {
  const base = new Date(repeatDate);
  const template = templateDate ? new Date(templateDate) : null;
  if (!template || Number.isNaN(template.getTime())) {
    base.setHours(0, 0, 0, 0);
    return base;
  }
  base.setHours(template.getHours(), template.getMinutes(), template.getSeconds(), template.getMilliseconds());
  return base;
}
function buildSelfhostMissionPayload(missionTemplate, repeatDate, repeatMeta = {}) {
  const templateStart = missionTemplate?.timeWindow?.start || null;
  const templateEnd = missionTemplate?.timeWindow?.end || null;
  const startAt = applyTemplateTime(repeatDate, templateStart);
  let dueAt = null;
  if (templateEnd) {
    const startTemplateDate = new Date(templateStart);
    const endTemplateDate = new Date(templateEnd);
    const durationMs = !Number.isNaN(startTemplateDate.getTime()) && !Number.isNaN(endTemplateDate.getTime()) ? endTemplateDate.getTime() - startTemplateDate.getTime() : 0;
    dueAt = new Date(startAt.getTime() + Math.max(0, durationMs));
  }
  return {
    title: String(missionTemplate?.title || "").trim(),
    description: missionTemplate?.description || "",
    type: missionTemplate?.type === "always" ? "always" : "mission",
    approvalPolicy: missionTemplate?.autoApprove ? "AUTO" : "MANUAL",
    requireSubmissionForm: !!missionTemplate?.requireSubmissionForm,
    rewardCash: getRewardCash(missionTemplate?.rewards),
    ...(repeatMeta.repeatGroupId ? {
      repeatGroupId: repeatMeta.repeatGroupId
    } : {}),
    repeatOccurrenceDate: toIsoStringOrNull(repeatDate),
    ...(repeatMeta.repeatConfig ? {
      repeatConfig: repeatMeta.repeatConfig
    } : {}),
    ...(dueAt ? {
      dueAt: toIsoStringOrNull(dueAt)
    } : {})
  };
}
function buildRepeatGroupId(classId) {
  return `repeat-${classId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function getRepeatGroupId(repeatInfo) {
  if (typeof repeatInfo === "string") return repeatInfo;
  return repeatInfo?.repeatGroupId || repeatInfo?.groupId || repeatInfo?.id || repeatInfo?.repeatId || "";
}
export const createRepeatingMissions = async ({
  classId,
  missionTemplate,
  repeatConfig
}) => {
  try {
    const createFunction = httpsCallable(functions, "createRepeatingMissions");
    const result = await createFunction({
      classId,
      missionTemplate,
      repeatConfig
    });
    return result.data;
  } catch (error) {
    console.error("반복 미션 생성 실패:", error);
    throw new Error(error.message || "반복 과제 생성에 실패했습니다.");
  }
};
export const deleteRepeatingMissions = async (classId, repeatInfo) => {
  try {
    const deleteFunction = httpsCallable(functions, "deleteRepeatingMissions");
    const result = await deleteFunction({
      classId,
      repeatInfo
    });
    return result.data;
  } catch (error) {
    console.error("반복 미션 삭제 실패:", error);
    throw new Error(error.message || "반복 과제 삭제에 실패했습니다.");
  }
};
export const simulateRepeatingMissions = repeatConfig => {
  const {
    startDate,
    endDate,
    days
  } = repeatConfig;
  if (!startDate || !days?.length) {
    return {
      dates: [],
      count: 0
    };
  }
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = endDate ? new Date(endDate) : new Date(start);
  if (!endDate) {
    end.setFullYear(start.getFullYear() + 1);
  }
  end.setHours(23, 59, 59, 999);
  const dates = [];
  const current = new Date(start);
  while (current <= end && dates.length < 365) {
    const currentDay = current.getDay();
    if (days.includes(currentDay)) {
      dates.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }
  return {
    dates,
    count: dates.length,
    preview: dates.slice(0, 10).map(d => d.toLocaleDateString("ko-KR"))
  };
};
