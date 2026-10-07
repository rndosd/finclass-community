import { isMissionAssignedToStudent } from "../utils/missionEligibility";
import { normalizeMission } from "../utils/normalizeMission";
const CLONE_TOKEN_STORAGE_KEY = "";
const cloneRequest = () => {
  throw new Error("Experimental provider is excluded from this installation.");
};
export const MISSION_READ_PROVIDER_STORAGE_KEY = "finclass.missionRead.provider";
function toDateSafe(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function toMillis(value) {
  return toDateSafe(value)?.getTime?.() ?? 0;
}
function sortMissions(left, right) {
  const leftMillis = Math.max(toMillis(left?.updatedAt), toMillis(left?.timeWindow?.start), toMillis(left?.createdAt));
  const rightMillis = Math.max(toMillis(right?.updatedAt), toMillis(right?.timeWindow?.start), toMillis(right?.createdAt));
  return rightMillis - leftMillis;
}
export function getMissionReadProvider() {
  const envProvider = String(process.env.REACT_APP_MISSION_READ_PROVIDER || "").trim().toLowerCase();
  if (envProvider === "firebase") return "firebase";
  if (typeof window !== "undefined") {
    const storedProvider = String(window.localStorage.getItem(MISSION_READ_PROVIDER_STORAGE_KEY) || "").trim().toLowerCase();
    if (storedProvider === "firebase") return "firebase";
  }
  return "firebase";
}
export function setMissionReadProvider(provider) {
  if (typeof window === "undefined") return;
  const nextProvider = "firebase";
  window.localStorage.setItem(MISSION_READ_PROVIDER_STORAGE_KEY, nextProvider);
}
function getSelfhostToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(CLONE_TOKEN_STORAGE_KEY) || "";
}
function buildRewards(mission = {}) {
  if (Array.isArray(mission.rewards)) return mission.rewards;
  const cash = Number(mission.rewardCash || 0);
  return cash > 0 ? [{
    type: "cash",
    amount: cash
  }] : [];
}
function normalizeSubmissionStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "approved") return "approved";
  if (value === "rejected") return "rejected";
  if (value === "canceled" || value === "cancelled") return "canceled";
  return value || "pending";
}
function buildCompletionsFromSubmissions(mission = {}) {
  const completions = {
    ...(mission.completions && typeof mission.completions === "object" ? mission.completions : {})
  };
  const submissionsIndex = {
    ...(mission.submissionsIndex && typeof mission.submissionsIndex === "object" ? mission.submissionsIndex : {})
  };
  (Array.isArray(mission.submissions) ? mission.submissions : []).forEach(submission => {
    const uid = submission?.studentUid || submission?.studentUserId || submission?.student?.id;
    if (!uid || !submission?.id) return;
    const status = normalizeSubmissionStatus(submission.status);
    submissionsIndex[uid] = submission.id;
    completions[uid] = {
      ...(completions[uid] || {}),
      submissionId: submission.id,
      status,
      submittedAt: submission.submittedAt || submission.createdAt || null,
      reviewedAt: submission.reviewedAt || null,
      feedback: submission.feedback ?? completions[uid]?.feedback ?? "",
      transactionId: submission.transactionId || null,
      contentHtml: submission.contentHtml || "",
      studentUid: uid,
      studentUserId: uid,
      name: submission.student?.displayName || submission.studentName || completions[uid]?.name || ""
    };
  });
  return {
    completions,
    submissionsIndex
  };
}
export function normalizeSelfhostMissionForProduction(mission = {}, {
  selfUid = null
} = {}) {
  const type = mission.type === "always" ? "always" : "mission";
  const dueAt = mission.dueAt || mission.endAt || mission.timeWindow?.end || null;
  const {
    completions,
    submissionsIndex
  } = buildCompletionsFromSubmissions(mission);
  return normalizeMission({
    ...mission,
    classId: mission.classId,
    type,
    title: mission.title || "",
    description: typeof mission.description === "string" ? mission.description : "",
    timeWindow: mission.timeWindow || {
      start: mission.startAt || null,
      end: type === "always" ? null : dueAt
    },
    createdAt: mission.createdAt || null,
    updatedAt: mission.updatedAt || mission.createdAt || null,
    rewards: buildRewards(mission),
    autoApprove: typeof mission.autoApprove === "boolean" ? mission.autoApprove : String(mission.approvalPolicy || "").toUpperCase() === "AUTO",
    requireSubmissionForm: mission.requireSubmissionForm === true,
    allowLateSubmission: mission.allowLateSubmission !== false,
    availability: type === "always" ? mission.availability || {
      maxPerDay: mission.maxPerDay || 1
    } : mission.availability,
    isActive: typeof mission.isActive === "boolean" ? mission.isActive : true,
    displayOrder: mission.displayOrder ?? null,
    maxPerDay: mission.maxPerDay ?? mission.availability?.maxPerDay ?? (type === "always" ? 1 : null),
    completions,
    submissionsIndex,
    submissions: (Array.isArray(mission.submissions) ? mission.submissions : []).map(submission => ({
      ...submission,
      studentUid: submission.studentUid || submission.studentUserId || submission.student?.id || null,
      status: normalizeSubmissionStatus(submission.status)
    })),
    _selfhostReadModel: true
  }, {
    selfUid
  });
}
export async function fetchSelfhostMissionList({
  classId,
  selfUid = null,
  teacherLike = false,
  studentData = null
} = {}) {
  const token = getSelfhostToken();
  if (!token) {
    const error = new Error("Selfhost mission session is required.");
    error.code = "unauthenticated";
    throw error;
  }
  const missions = await cloneRequest(`/clone/classes/${classId}/missions`, {
    token
  });
  return (Array.isArray(missions) ? missions : []).map(mission => normalizeSelfhostMissionForProduction(mission, {
    selfUid
  })).filter(mission => {
    if (teacherLike) return true;
    return isMissionAssignedToStudent(mission, studentData, selfUid);
  }).sort(sortMissions);
}
