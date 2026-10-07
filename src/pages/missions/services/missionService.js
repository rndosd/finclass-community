// src/pages/missions/services/missionService.js

import { httpsCallable } from "firebase/functions";
import { collection, doc, addDoc, setDoc, updateDoc, getDoc, deleteDoc, writeBatch, serverTimestamp, deleteField } from "firebase/firestore";
import { functions, db } from "../../../firebase";
const CLONE_TOKEN_STORAGE_KEY = "";
const cloneRequest = () => {
  throw new Error("Experimental provider is excluded from this installation.");
};
const processAutoApproveMissionFn = httpsCallable(functions, "processAutoApproveMission");
const approveMissionBatchFn = httpsCallable(functions, "approveMissionBatch");
const cancelMissionApprovalBatchFn = httpsCallable(functions, "cancelMissionApprovalBatch");
const submitMissionFn = httpsCallable(functions, "submitMission");
const rejectSubmissionFn = httpsCallable(functions, "rejectSubmission");
const rejectSubmissionBatchFn = httpsCallable(functions, "rejectSubmissionBatch");
const rejectMissionCompletionBatchFn = httpsCallable(functions, "rejectMissionCompletionBatch");
const saveMissionFeedbackFn = httpsCallable(functions, "saveMissionFeedback");
export const MISSION_ACTION_PROVIDER_STORAGE_KEY = "finclass.missionAction.provider";
export const MISSION_TEACHER_ACTION_PROVIDER_STORAGE_KEY = MISSION_ACTION_PROVIDER_STORAGE_KEY;
export function getMissionActionProvider() {
  const envProvider = String(process.env.REACT_APP_MISSION_ACTION_PROVIDER || "").trim().toLowerCase();
  if (envProvider === "firebase") return "firebase";
  if (typeof window !== "undefined") {
    const storedProvider = String(window.localStorage.getItem(MISSION_ACTION_PROVIDER_STORAGE_KEY) || "").trim().toLowerCase();
    if (storedProvider === "firebase") return "firebase";
  }
  return "firebase";
}
export const getMissionTeacherActionProvider = getMissionActionProvider;
export function setMissionActionProvider(provider) {
  if (typeof window === "undefined") return;
  const nextProvider = "firebase";
  window.localStorage.setItem(MISSION_ACTION_PROVIDER_STORAGE_KEY, nextProvider);
}
export const setMissionTeacherActionProvider = setMissionActionProvider;
function getSelfhostToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(CLONE_TOKEN_STORAGE_KEY) || "";
}
async function selfhostTeacherActionRequest(path, options = {}) {
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
function toIsoStringOrNull(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }
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
function buildSelfhostMissionCreatePayload(missionData = {}) {
  const isAlways = missionData.type === "always";
  const timeWindow = missionData.timeWindow || {};
  const dueAt = isAlways ? null : toIsoStringOrNull(timeWindow.end || missionData.dueAt);
  const maxPerDay = Number(missionData.maxPerDay ?? missionData.availability?.maxPerDay ?? 1);
  return {
    title: String(missionData.title || "").trim(),
    description: missionData.description || "",
    type: isAlways ? "always" : "mission",
    approvalPolicy: missionData.autoApprove ? "AUTO" : "MANUAL",
    requireSubmissionForm: !!missionData.requireSubmissionForm,
    rewardCash: getRewardCash(missionData.rewards),
    ...(Number.isInteger(Number(missionData.displayOrder)) ? {
      displayOrder: Number(missionData.displayOrder)
    } : {}),
    ...(dueAt ? {
      dueAt
    } : {}),
    ...(isAlways ? {
      availability: missionData.availability || {
        maxPerDay: Number.isFinite(maxPerDay) ? maxPerDay : 1
      },
      maxPerDay: Number.isInteger(maxPerDay) && maxPerDay > 0 ? maxPerDay : 1
    } : {})
  };
}
function buildSelfhostMissionUpdatePayload(patch = {}, opts = {}) {
  const payload = {};
  if (patch.title !== undefined) payload.title = String(patch.title || "").trim();
  if (patch.description !== undefined) payload.description = patch.description || "";
  if (patch.type !== undefined) payload.type = patch.type === "always" ? "always" : "mission";
  if (patch.autoApprove !== undefined) {
    payload.approvalPolicy = patch.autoApprove ? "AUTO" : "MANUAL";
  }
  if (patch.requireSubmissionForm !== undefined) {
    payload.requireSubmissionForm = !!patch.requireSubmissionForm;
  }
  if (Array.isArray(patch.rewards)) {
    payload.rewardCash = getRewardCash(patch.rewards);
  }
  if (patch.isActive !== undefined) payload.isActive = !!patch.isActive;
  if (patch.availability !== undefined) {
    payload.availability = patch.availability || {};
    const maxPerDay = Number(patch.availability?.maxPerDay);
    if (Number.isInteger(maxPerDay) && maxPerDay > 0) {
      payload.maxPerDay = maxPerDay;
    }
  }
  if (patch.maxPerDay !== undefined) {
    const maxPerDay = Number(patch.maxPerDay);
    if (Number.isInteger(maxPerDay) && maxPerDay > 0) {
      payload.maxPerDay = maxPerDay;
    }
  }
  if (patch.displayOrder !== undefined) {
    const displayOrder = Number(patch.displayOrder);
    if (Number.isInteger(displayOrder)) payload.displayOrder = displayOrder;
  }
  if (opts?.removeDeadline || patch.type === "always") {
    payload.clearDueAt = true;
  } else if (patch.timeWindow && Object.prototype.hasOwnProperty.call(patch.timeWindow, "end")) {
    const dueAt = toIsoStringOrNull(patch.timeWindow.end);
    if (dueAt) payload.dueAt = dueAt;else payload.clearDueAt = true;
  }
  return payload;
}
function normalizeFunctionsError(err, fallbackMessage) {
  const raw = err?.code || "";
  const code = raw.startsWith("functions/") ? raw.replace("functions/", "") : raw || "unknown";
  const detailMsg = typeof err?.details === "string" ? err.details : err?.details?.message || err?.message;
  let message = fallbackMessage || "요청 처리 중 오류가 발생했습니다.";
  if (code === "permission-denied" && detailMsg) {
    const e = new Error(detailMsg);
    e.code = code;
    e.raw = err;
    return e;
  }
  switch (code) {
    case "permission-denied":
      message = "권한이 없습니다.";
      break;
    case "not-found":
      message = "대상을 찾을 수 없습니다.";
      break;
    case "failed-precondition":
      message = detailMsg || "현재 상태에서 수행할 수 없는 작업입니다.";
      break;
    case "already-exists":
      message = "이미 존재하거나 이미 처리된 항목입니다.";
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
  const e = new Error(message);
  e.code = code;
  e.raw = err;
  return e;
}
export const approveMissionBatch = async (classId, missionId, items) => {
  try {
    const normalized = Array.isArray(items) ? items.map(it => ({
      uid: it.uid || it.studentUid || null,
      submissionId: it.submissionId || null,
      feedback: it.feedback ?? null,
      rewardOverride: it.rewardOverride || null
    })) : [];
    const result = await approveMissionBatchFn({
      classId,
      missionId,
      items: normalized
    });
    return {
      success: true,
      message: result?.data?.message || "일괄 승인이 완료되었습니다.",
      data: result?.data
    };
  } catch (err) {
    throw normalizeFunctionsError(err, "일괄 승인 처리 중 오류가 발생했습니다.");
  }
};
export const cancelMissionApprovalBatch = async (classId, missionId, studentUids) => {
  try {
    const result = await cancelMissionApprovalBatchFn({
      classId,
      missionId,
      studentUids
    });
    return {
      success: true,
      message: result?.data?.message || "일괄 승인 취소가 완료되었습니다.",
      data: result?.data
    };
  } catch (err) {
    throw normalizeFunctionsError(err, "일괄 승인 취소 처리 중 오류가 발생했습니다.");
  }
};
export const processAutoApproveMission = async (classId, missionId) => {
  try {
    const result = await processAutoApproveMissionFn({
      classId,
      missionId
    });
    return {
      success: true,
      message: result?.data?.message || "자동 승인되었습니다.",
      data: result?.data
    };
  } catch (err) {
    throw normalizeFunctionsError(err, "자동 승인 처리 중 오류가 발생했습니다.");
  }
};

/**
 * Cloud Function을 호출하여 제출
 * - 백엔드(submitMission)가 트랜잭션으로 안전하게 저장합니다.
 */
export const submitMission = async (mission, contentHtml) => {
  try {
    const payload = {
      classId: mission.classId || mission.classID,
      missionId: mission.id || mission.missionId,
      contentHtml: contentHtml || ""
    };
    const result = await submitMissionFn(payload);
    return {
      success: true,
      message: result.data.message || "제출이 성공적으로 저장되었습니다.",
      data: result.data
    };
  } catch (err) {
    throw normalizeFunctionsError(err, "제출 중 오류가 발생했습니다.");
  }
};
export const rejectSubmission = async (classId, missionId, submissionId, {
  revertTo = "rejected",
  reason = ""
} = {}) => {
  // 제출 ID 방어
  if (!submissionId) {
    const e = new Error("반려할 제출 ID가 없습니다. 다시 열어서 시도하세요.");
    e.code = "invalid-argument";
    throw e;
  }
  const result = await rejectSubmissionFn({
    classId,
    missionId,
    submissionId,
    revertTo,
    reason
  });
  return {
    success: true,
    message: result?.data?.message || "제출이 반려되었습니다.",
    data: result?.data
  };
};
export const getMissionSubmissionDetail = async (classId, missionId, submissionId) => {
  if (!classId || !missionId || !submissionId) {
    const error = new Error("classId, missionId, submissionId가 필요합니다.");
    error.code = "invalid-argument";
    throw error;
  }
  const snapshot = await getDoc(doc(db, `classes/${classId}/missions/${missionId}/submissions/${submissionId}`));
  if (!snapshot.exists()) return null;
  return {
    id: snapshot.id,
    ...snapshot.data()
  };
};
export const rejectSubmissionBatch = async (classId, missionId, submissionIds, {
  revertTo = "rejected",
  reason = ""
} = {}) => {
  const result = await rejectSubmissionBatchFn({
    classId,
    missionId,
    submissionIds,
    revertTo,
    reason
  });
  return {
    success: true,
    message: result?.data?.message || "일괄 반려가 완료되었습니다.",
    data: result?.data
  };
};
export const rejectMissionCompletionBatch = async (classId, missionId, studentUids, {
  reason = ""
} = {}) => {
  try {
    const result = await rejectMissionCompletionBatchFn({
      classId,
      missionId,
      studentUids,
      reason
    });
    return {
      success: true,
      message: result?.data?.message || "완료형 과제 반려가 완료되었습니다.",
      data: result?.data
    };
  } catch (err) {
    throw normalizeFunctionsError(err, "완료형 과제 반려 처리 중 오류가 발생했습니다.");
  }
};
export const addMission = async missionData => {
  if (!missionData?.classId) {
    const e = new Error("클래스 ID가 필요합니다.");
    e.code = "invalid-argument";
    throw e;
  }
  const missionsRef = collection(db, `classes/${missionData.classId}/missions`);
  const classSnap = await getDoc(doc(db, `classes/${missionData.classId}`));
  const canonical = missionData.type !== "always" && classSnap.exists() && classSnap.data()?.missionStudentStateVersion === 2;
  const payload = {
    ...missionData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    stateStorageVersion: canonical ? 2 : 1
  };
  delete payload.completions;
  delete payload.submissionsIndex;
  delete payload.studentStateMirrorVersion;
  delete payload.studentStatePreparedAt;
  delete payload.stateStorageMigratedAt;
  const docRef = await addDoc(missionsRef, payload);
  return {
    success: true,
    id: docRef.id,
    message: "과제가 성공적으로 등록되었습니다."
  };
};
export const deleteMission = async (classId, missionId) => {
  if (!classId || !missionId) {
    const e = new Error("클래스 ID와 과제 ID가 필요합니다.");
    e.code = "invalid-argument";
    throw e;
  }
  const missionRef = doc(db, `classes/${classId}/missions/${missionId}`);
  await deleteDoc(missionRef);
  return {
    success: true,
    message: "과제가 성공적으로 삭제되었습니다."
  };
};

// 상시과제 순서 저장
// src/pages/missions/services/missionService.js

export const reorderAlwaysMissions = async (classId, orderedMissions = []) => {
  if (!classId) {
    const e = new Error("클래스 ID가 필요합니다.");
    e.code = "invalid-argument";
    throw e;
  }
  if (!Array.isArray(orderedMissions) || orderedMissions.length === 0) {
    return {
      success: true,
      message: "정렬할 상시과제가 없습니다."
    };
  }
  const batch = writeBatch(db);
  orderedMissions.forEach((mission, index) => {
    if (!mission?.id) return;
    batch.update(doc(db, `classes/${classId}/missions/${mission.id}`), {
      displayOrder: index + 1,
      updatedAt: serverTimestamp()
    });
  });
  await batch.commit();
  return {
    success: true,
    message: "상시과제 정렬을 저장했습니다."
  };
};
export const updateMission = async (classId, missionId, patch = {}, opts = {}) => {
  if (!classId || !missionId) {
    const e = new Error("클래스 ID와 과제 ID가 필요합니다.");
    e.code = "invalid-argument";
    throw e;
  }
  const missionRef = doc(db, `classes/${classId}/missions/${missionId}`);

  // 1. 기본 업데이트 데이터 구성
  // patch에는 autoApprove, requireSubmissionForm, title, rewards 등이 포함됩니다.
  const updateData = {
    ...patch,
    updatedAt: serverTimestamp()
  };

  // 2. 마감일 제거 옵션 처리
  if (opts?.removeDeadline) {
    if (patch?.timeWindow?.start) {
      updateData.timeWindow = {
        start: patch.timeWindow.start,
        end: null
      };
    } else {
      updateData.timeWindow = {
        end: null
      };
    }
  }

  // 3. 선택 학생 해제 옵션
  if (opts?.removeTargetStudentUids) {
    updateData.targetStudentUids = deleteField();
  }
  if (opts?.removeMinCreditTier) {
    updateData.minCreditTierId = deleteField();
    updateData.minCreditTierName = deleteField();
    updateData.minCreditTierColor = deleteField();
    updateData.minCreditTierMinScore = deleteField();
    updateData.minCreditTier = deleteField();
  }
  if (opts?.removeAllowLateSubmission) {
    updateData.allowLateSubmission = deleteField();
  }
  try {
    // updateDoc으로 지정한 필드만 안전하게 갱신합니다.
    await updateDoc(missionRef, updateData);
    return {
      success: true,
      message: "과제가 수정되었습니다."
    };
  } catch (error) {
    console.error("updateMission Error:", error);
    // 문서가 없으면 updateDoc이 실패하므로 호출자가 오류를 처리합니다.
    throw error;
  }
};
export const createSubmission = async ({
  classId,
  missionId,
  studentUid,
  studentName,
  studentNumber,
  contentHtml,
  isLate,
  missionTitle
}) => {
  if (!classId || !missionId || !studentUid) {
    throw new Error("필수 정보가 누락되었습니다.");
  }
  try {
    const res = await submitMissionFn({
      classId,
      missionId,
      studentUid,
      contentHtml: contentHtml || "",
      studentName: studentName || "",
      studentNumber: studentNumber ?? null,
      missionTitle: missionTitle || "",
      isLate: !!isLate
    });
    return {
      success: true,
      message: res?.data?.message || "제출이 저장되었습니다.",
      data: res?.data || null
    };
  } catch (err) {
    throw normalizeFunctionsError(err, "제출 처리 중 오류가 발생했습니다.");
  }
};
export const saveSubmissionFeedback = async (classId, missionId, submissionId, feedback, teacher) => {
  const missionRef = doc(db, `classes/${classId}/missions/${missionId}`);
  const missionSnap = await getDoc(missionRef);
  if (missionSnap.exists() && (missionSnap.data()?.studentStateMirrorVersion === 1 || missionSnap.data()?.stateStorageVersion === 2)) {
    const result = await saveMissionFeedbackFn({
      classId,
      missionId,
      submissionId,
      feedback: (feedback ?? "").trim()
    });
    return result.data;
  }
  await setDoc(doc(db, `classes/${classId}/missions/${missionId}/submissions/${submissionId}`), {
    feedback: (feedback ?? "").trim(),
    feedbackEditedAt: serverTimestamp(),
    feedbackByUid: teacher?.uid || null,
    feedbackByName: teacher?.name || ""
  }, {
    merge: true
  });
  return {
    success: true,
    message: "피드백이 저장되었습니다."
  };
};
export const approveByType = async (type, payload = {}) => {
  const {
    classId,
    missionId,
    studentUid,
    submissionId,
    feedback
  } = payload;
  return approveMissionBatch(classId, missionId, [{
    uid: studentUid,
    submissionId,
    feedback
  }]);
};
export async function setMissionFeedbacks(classId, missionId, items = [], meta = {}) {
  if (!classId || !missionId) {
    throw new Error("classId 또는 missionId가 없습니다.");
  }
  if (!Array.isArray(items) || items.length === 0) {
    return {
      success: true,
      message: "저장할 피드백이 없습니다."
    };
  }
  const missionRef = doc(db, `classes/${classId}/missions/${missionId}`);
  const missionSnap = await getDoc(missionRef);
  if (missionSnap.exists() && (missionSnap.data()?.studentStateMirrorVersion === 1 || missionSnap.data()?.stateStorageVersion === 2)) {
    const result = await saveMissionFeedbackFn({
      classId,
      missionId,
      items
    });
    return result.data;
  }
  const updateData = {};
  items.forEach(({
    uid,
    feedback
  }) => {
    if (!uid) return;
    updateData[`completions.${uid}.feedback`] = feedback ?? "";
    updateData[`completions.${uid}.feedbackUpdatedBy`] = meta?.uid || null;
    updateData[`completions.${uid}.feedbackUpdatedByName`] = meta?.name || "";
    updateData[`completions.${uid}.feedbackEditedAt`] = serverTimestamp();
  });
  if (Object.keys(updateData).length) {
    updateData.updatedAt = serverTimestamp();
    await updateDoc(missionRef, updateData);
  }
  return {
    success: true,
    message: `피드백 ${items.length}건이 저장되었습니다.`
  };
}
