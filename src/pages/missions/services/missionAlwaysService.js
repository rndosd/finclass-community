import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase";
const CLONE_TOKEN_STORAGE_KEY = "";
const cloneRequest = () => {
  throw new Error("Experimental provider is excluded from this installation.");
};
const recordAlwaysAttemptFn = httpsCallable(functions, "alwaysRecordAttempt");
const approveAlwaysAttemptFn = httpsCallable(functions, "alwaysApproveAttempt");
const approveAlwaysAttemptBatchFn = httpsCallable(functions, "alwaysApproveAttemptBatch");
const rejectAlwaysAttemptBatchFn = httpsCallable(functions, "alwaysRejectAttemptBatch");
const listAlwaysAttemptsFn = httpsCallable(functions, "alwaysListAttempts");
const cancelAlwaysAttemptBatchFn = httpsCallable(functions, "alwaysCancelAttemptBatch");
const ALWAYS_ATTEMPTS_CACHE_TTL_MS = 3 * 60 * 1000;
export const MISSION_ALWAYS_PROVIDER_STORAGE_KEY = "finclass.missionAlways.provider";
const alwaysAttemptsCache = new Map();
export function getMissionAlwaysProvider() {
  const envProvider = String(process.env.REACT_APP_MISSION_ALWAYS_PROVIDER || "").trim().toLowerCase();
  if (envProvider === "firebase") return "firebase";
  if (typeof window !== "undefined") {
    const storedProvider = String(window.localStorage.getItem(MISSION_ALWAYS_PROVIDER_STORAGE_KEY) || "").trim().toLowerCase();
    if (storedProvider === "firebase") return "firebase";
  }
  return "firebase";
}
export function setMissionAlwaysProvider(provider) {
  if (typeof window === "undefined") return;
  const nextProvider = "firebase";
  window.localStorage.setItem(MISSION_ALWAYS_PROVIDER_STORAGE_KEY, nextProvider);
}
function getSelfhostToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(CLONE_TOKEN_STORAGE_KEY) || "";
}
function normalizeSelfhostAttempt(item = {}) {
  const createdAt = item.createdAt || item.submittedAt || null;
  const approvedAt = item.approvedAt || item.reviewedAt || null;
  return {
    ...item,
    studentUid: item.studentUid || item.studentUserId,
    createdAt,
    createdAtMs: createdAt ? new Date(createdAt).getTime() : null,
    approvedAt,
    approvedAtMs: approvedAt ? new Date(approvedAt).getTime() : null,
    canceledAt: item.canceledAt || (item.status === "canceled" ? item.reviewedAt : null),
    canceledAtMs: item.canceledAt || item.status === "canceled" && item.reviewedAt ? new Date(item.canceledAt || item.reviewedAt).getTime() : null,
    lastAttemptAt: item.lastAttemptAt || item.latestAt || item.submittedAt || null,
    updatedAt: item.updatedAt || item.latestAt || item.submittedAt || null
  };
}
async function selfhostAlwaysRequest(path, options = {}) {
  const token = getSelfhostToken();
  if (!token) {
    const error = new Error("Selfhost mission session is required.");
    error.code = "unauthenticated";
    throw error;
  }
  return cloneRequest(path, {
    ...options,
    token
  });
}
function buildSelfhostQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}
function normalizeCacheValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || "").trim()).filter(Boolean).sort();
  }
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeCacheValue(value[key]);
      return acc;
    }, {});
  }
  return value ?? null;
}
function buildAlwaysAttemptsCacheKey(payload) {
  return JSON.stringify({
    provider: getMissionAlwaysProvider(),
    classId: String(payload.classId || "").trim(),
    missionId: String(payload.missionId || "").trim(),
    studentUid: String(payload.studentUid || "").trim(),
    allStudents: payload.allStudents === true,
    studentUids: normalizeCacheValue(payload.studentUids || []),
    dateFrom: payload.dateFrom || null,
    dateTo: payload.dateTo || null,
    limit: Number(payload.limit || 0),
    cursor: normalizeCacheValue(payload.cursor || null),
    view: payload.view || "attempts"
  });
}
function getCachedAlwaysAttempts(cacheKey) {
  const cached = alwaysAttemptsCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    alwaysAttemptsCache.delete(cacheKey);
    return null;
  }
  return cached;
}
function setCachedAlwaysAttempts(cacheKey, payload) {
  alwaysAttemptsCache.set(cacheKey, {
    ...payload,
    expiresAt: Date.now() + ALWAYS_ATTEMPTS_CACHE_TTL_MS
  });
}
function clearMissionAlwaysAttemptsCache(classId, missionId) {
  const prefix = `"classId":"${String(classId || "").trim()}","missionId":"${String(missionId || "").trim()}",`;
  Array.from(alwaysAttemptsCache.keys()).forEach(cacheKey => {
    if (cacheKey.includes(prefix)) {
      alwaysAttemptsCache.delete(cacheKey);
    }
  });
}
function normalizeFunctionsError(err, fallbackMessage) {
  const raw = err?.code || "";
  const code = raw.startsWith("functions/") ? raw.replace("functions/", "") : raw || "unknown";
  const detailMsg = typeof err?.details === "string" ? err.details : err?.details?.message || err?.message;
  let message = fallbackMessage || "요청 처리 중 오류가 발생했습니다.";
  if (code === "permission-denied" && detailMsg) {
    const error = new Error(detailMsg);
    error.code = code;
    error.raw = err;
    return error;
  }
  switch (code) {
    case "permission-denied":
      message = "권한이 없습니다.";
      break;
    case "not-found":
      message = "대상을 찾을 수 없습니다.";
      break;
    case "failed-precondition":
      message = detailMsg || "현재 상태에서는 수행할 수 없는 작업입니다.";
      break;
    case "already-exists":
      message = "이미 처리된 상시 과제입니다.";
      break;
    case "invalid-argument":
      message = "요청 인자가 올바르지 않습니다.";
      break;
    case "unauthenticated":
      message = "로그인이 필요합니다.";
      break;
    default:
      message = detailMsg || fallbackMessage || "요청 처리 중 오류가 발생했습니다.";
  }
  const error = new Error(message);
  error.code = code;
  error.raw = err;
  return error;
}
export async function recordAlwaysAttempt({
  classId,
  missionId,
  contentHtml = ""
}) {
  if (!classId || !missionId) {
    const error = new Error("classId와 missionId가 필요합니다.");
    error.code = "invalid-argument";
    throw error;
  }
  try {
    const res = await recordAlwaysAttemptFn({
      classId,
      missionId,
      contentHtml
    });
    clearMissionAlwaysAttemptsCache(classId, missionId);
    return {
      success: true,
      message: res?.data?.message || "오늘 상시 과제가 기록되었습니다.",
      data: res?.data || null
    };
  } catch (err) {
    throw normalizeFunctionsError(err, "상시 과제를 기록하는 중 오류가 발생했습니다.");
  }
}
export async function approveAlwaysAttempt({
  classId,
  missionId,
  studentUid,
  attemptId,
  feedback = "",
  rewardOverride = null
}) {
  if (!classId || !missionId || !studentUid || !attemptId) {
    const error = new Error("classId, missionId, studentUid, attemptId가 필요합니다.");
    error.code = "invalid-argument";
    throw error;
  }
  try {
    const res = await approveAlwaysAttemptFn({
      classId,
      missionId,
      studentUid,
      attemptId,
      feedback,
      rewardOverride
    });
    clearMissionAlwaysAttemptsCache(classId, missionId);
    return {
      success: true,
      message: res?.data?.message || "승인되었습니다.",
      data: res?.data || null
    };
  } catch (err) {
    throw normalizeFunctionsError(err, "상시 과제 승인 중 오류가 발생했습니다.");
  }
}
export async function cancelAlwaysAttempt() {
  const error = new Error("상시 과제 승인 취소 단건 함수는 구현되어 있지 않습니다.");
  error.code = "not-implemented";
  throw error;
}
export async function approveAlwaysAttemptBatch({
  classId,
  missionId,
  items = []
}) {
  if (!classId || !missionId) {
    const error = new Error("classId와 missionId가 필요합니다.");
    error.code = "invalid-argument";
    throw error;
  }
  if (!Array.isArray(items) || items.length === 0) {
    return {
      success: true,
      message: "승인할 항목이 없습니다.",
      data: null
    };
  }
  try {
    const res = await approveAlwaysAttemptBatchFn({
      classId,
      missionId,
      items: items.map(it => ({
        studentUid: it.studentUid,
        attemptId: it.attemptId,
        feedback: it.feedback ?? null,
        rewardOverride: it.rewardOverride ?? null
      }))
    });
    clearMissionAlwaysAttemptsCache(classId, missionId);
    return {
      success: true,
      message: res?.data?.message || "일괄 승인이 완료되었습니다.",
      data: res?.data || null
    };
  } catch (err) {
    throw normalizeFunctionsError(err, "상시 과제 일괄 승인 중 오류가 발생했습니다.");
  }
}
export async function rejectAlwaysAttemptBatch({
  classId,
  missionId,
  items = [],
  reason = ""
}) {
  if (!classId || !missionId) {
    const error = new Error("classId와 missionId가 필요합니다.");
    error.code = "invalid-argument";
    throw error;
  }
  if (!Array.isArray(items) || items.length === 0) {
    return {
      success: true,
      message: "반려할 항목이 없습니다.",
      data: null
    };
  }
  try {
    const res = await rejectAlwaysAttemptBatchFn({
      classId,
      missionId,
      reason,
      items: items.map(it => ({
        studentUid: it.studentUid,
        attemptId: it.attemptId,
        reason: it.reason ?? null
      }))
    });
    clearMissionAlwaysAttemptsCache(classId, missionId);
    return {
      success: true,
      message: res?.data?.message || "일괄 반려가 완료되었습니다.",
      data: res?.data || null
    };
  } catch (err) {
    throw normalizeFunctionsError(err, "상시 과제 일괄 반려 중 오류가 발생했습니다.");
  }
}
export async function cancelAlwaysAttemptBatch({
  classId,
  missionId,
  items = []
}) {
  if (!classId || !missionId) {
    const error = new Error("classId와 missionId가 필요합니다.");
    error.code = "invalid-argument";
    throw error;
  }
  if (!Array.isArray(items) || items.length === 0) {
    return {
      success: true,
      message: "취소할 항목이 없습니다.",
      data: null
    };
  }
  try {
    const res = await cancelAlwaysAttemptBatchFn({
      classId,
      missionId,
      items: items.map(it => ({
        studentUid: it.studentUid,
        attemptId: it.attemptId
      }))
    });
    clearMissionAlwaysAttemptsCache(classId, missionId);
    return {
      success: true,
      message: res?.data?.message || "일괄 승인 취소가 완료되었습니다.",
      data: res?.data || null
    };
  } catch (err) {
    throw normalizeFunctionsError(err, "상시 과제 일괄 승인 취소 중 오류가 발생했습니다.");
  }
}
async function alwaysListAttemptsUncached({
  classId,
  missionId,
  studentUid = null,
  allStudents = false,
  studentUids = [],
  dateFrom = null,
  dateTo = null,
  limit = 50,
  cursor = null,
  view = "attempts"
}) {
  if (!classId || !missionId) {
    const error = new Error("classId와 missionId가 필요합니다.");
    error.code = "invalid-argument";
    throw error;
  }
  try {
    const res = await listAlwaysAttemptsFn({
      classId,
      missionId,
      studentUid,
      allStudents,
      studentUids,
      dateFrom,
      dateTo,
      limit,
      cursor,
      view
    });
    return {
      success: true,
      attempts: res?.data?.attempts || [],
      hasMore: !!res?.data?.hasMore,
      nextCursor: res?.data?.nextCursor || null
    };
  } catch (err) {
    throw normalizeFunctionsError(err, "상시 과제 시도 목록 조회 중 오류가 발생했습니다.");
  }
}
export async function alwaysListAttempts(options) {
  const {
    classId,
    missionId,
    studentUid = null,
    allStudents = false,
    studentUids = [],
    dateFrom = null,
    dateTo = null,
    limit = 50,
    cursor = null,
    view = "attempts"
  } = options || {};
  const cacheKey = buildAlwaysAttemptsCacheKey({
    classId,
    missionId,
    studentUid,
    allStudents,
    studentUids,
    dateFrom,
    dateTo,
    limit,
    cursor,
    view
  });
  const cached = getCachedAlwaysAttempts(cacheKey);
  if (cached?.value) {
    return cached.value;
  }
  if (cached?.promise) {
    return cached.promise;
  }
  const requestPromise = alwaysListAttemptsUncached({
    classId,
    missionId,
    studentUid,
    allStudents,
    studentUids,
    dateFrom,
    dateTo,
    limit,
    cursor,
    view
  }).then(value => {
    setCachedAlwaysAttempts(cacheKey, {
      value
    });
    return value;
  }).catch(error => {
    alwaysAttemptsCache.delete(cacheKey);
    throw error;
  });
  setCachedAlwaysAttempts(cacheKey, {
    promise: requestPromise
  });
  return requestPromise;
}
