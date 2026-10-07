import { httpsCallable } from "firebase/functions";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import { auth, db, functions } from "../../../firebase";

const moderateJobSeekerServiceFn = httpsCallable(functions, "moderateJobSeekerService");
const createJobSeekerServiceFn = httpsCallable(functions, "createJobSeekerService");
const updateJobSeekerServiceFn = httpsCallable(functions, "updateJobSeekerService");
const createJobSeekerRequestFn = httpsCallable(functions, "createJobSeekerRequest");
const reviewJobSeekerRequestFn = httpsCallable(functions, "reviewJobSeekerRequest");
const completeJobSeekerRequestFn = httpsCallable(functions, "completeJobSeekerRequest");
const payJobSeekerRequestRewardFn = httpsCallable(functions, "payJobSeekerRequestReward");

const ERROR_MESSAGES = [
  {
    includes: "Only students can register services",
    message: "학생만 서비스를 등록할 수 있습니다.",
  },
  {
    includes: "not accepting requests",
    message: "현재 의뢰를 받을 수 없는 서비스입니다.",
  },
  {
    includes: "cannot request your own service",
    message: "내 서비스에는 의뢰할 수 없습니다.",
  },
  {
    includes: "Only requested items can be reviewed",
    message: "요청됨 상태의 의뢰만 수락하거나 거절할 수 있습니다.",
  },
  {
    includes: "Only accepted requests can be completed",
    message: "수락된 의뢰만 완료 처리할 수 있습니다.",
  },
  {
    includes: "Only accepted or completed requests can be paid",
    message: "수락된 의뢰만 보상 지급할 수 있습니다.",
  },
  {
    includes: "Only completed requests can be paid",
    message: "수락된 의뢰만 보상 지급할 수 있습니다.",
  },
  {
    includes: "permission-denied",
    message: "권한이 없어 처리할 수 없습니다.",
  },
];

const translateErrorMessage = (message, fallbackMessage) => {
  const rawMessage = String(message || "").trim();
  const matched = ERROR_MESSAGES.find((entry) => rawMessage.includes(entry.includes));
  if (matched) return matched.message;
  return rawMessage || fallbackMessage || "요청을 처리하지 못했습니다.";
};

const unwrapCallableResult = async (callable, payload, fallbackMessage) => {
  try {
    const result = await callable(payload);
    return result.data;
  } catch (error) {
    const rawMessage =
      error?.message ||
      error?.details?.message ||
      fallbackMessage ||
      "요청을 처리하지 못했습니다.";
    throw new Error(translateErrorMessage(rawMessage, fallbackMessage));
  }
};

const normalizeText = (value, fallback = "") => String(value ?? "").trim() || fallback;

const normalizeRequiredText = (value, message, maxLength = 200) => {
  const text = normalizeText(value);
  if (!text) throw new Error(message);
  return text.slice(0, maxLength);
};

const normalizeOptionalText = (value, maxLength = 2000) => {
  const text = normalizeText(value);
  return text ? text.slice(0, maxLength) : null;
};

const normalizeAmount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
};

const normalizePriceMode = (value) =>
  ["fixed", "from", "negotiable"].includes(value) ? value : "from";

const normalizeServicePayload = (service = {}) => {
  const priceMode = normalizePriceMode(service.priceMode);
  return {
    title: normalizeRequiredText(service.title, "서비스 이름을 입력해 주세요.", 80),
    summary: normalizeRequiredText(service.summary, "서비스 설명을 입력해 주세요.", 140),
    description: normalizeRequiredText(
      service.description || service.summary,
      "서비스 설명을 입력해 주세요.",
      3000,
    ),
    category: normalizeRequiredText(service.category || "서비스", "카테고리 정보가 없습니다.", 40),
    priceMode,
    priceAmount: priceMode === "negotiable" ? 0 : normalizeAmount(service.priceAmount),
    availabilityText: normalizeOptionalText(service.availabilityText, 160),
    averageDurationText: normalizeOptionalText(service.averageDurationText, 80),
    strengthsText: normalizeOptionalText(service.strengthsText, 1200),
    requirementsText: normalizeOptionalText(service.requirementsText, 1200),
  };
};

const normalizeDueAt = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeRequestPayload = (request = {}, service = {}, requester = {}) => ({
  requestMessage: normalizeRequiredText(request.requestMessage, "의뢰 내용을 입력해 주세요.", 1500),
  proposedRewardAmount: normalizeAmount(
    request.proposedRewardAmount || service.priceAmount || 0,
  ),
  dueAt: normalizeDueAt(request.dueAt),
  note: normalizeOptionalText(request.note, 1000),
  requesterName: normalizeText(requester.name || auth.currentUser?.displayName, "학생"),
  requesterRole: normalizeText(requester.role, "student"),
  requesterStudentNumber: normalizeText(requester.studentNumber),
});

export const createJobSeekerService = async ({ classId, service }) => {
  const ownerUid = auth.currentUser?.uid;
  if (!classId) throw new Error("학급 정보가 없습니다.");
  if (!ownerUid) throw new Error("로그인이 필요합니다.");
  return unwrapCallableResult(
    createJobSeekerServiceFn,
    { classId, service: normalizeServicePayload(service) },
    "서비스를 등록하지 못했습니다.",
  );
};

export const updateJobSeekerService = async ({ classId, serviceId, updates }) => {
  if (!classId || !serviceId) throw new Error("서비스 정보가 없습니다.");
  const payload = {};
  if (Object.prototype.hasOwnProperty.call(updates || {}, "title")) {
    payload.title = normalizeRequiredText(updates.title, "서비스 이름을 입력해 주세요.", 80);
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "summary")) {
    payload.summary = normalizeRequiredText(updates.summary, "서비스 설명을 입력해 주세요.", 140);
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "description")) {
    payload.description = normalizeRequiredText(
      updates.description || updates.summary,
      "서비스 설명을 입력해 주세요.",
      3000,
    );
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "category")) {
    payload.category = normalizeRequiredText(
      updates.category || "서비스",
      "카테고리 정보가 없습니다.",
      40,
    );
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "priceMode")) {
    const priceMode = normalizePriceMode(updates.priceMode);
    payload.priceMode = priceMode;
    payload.priceAmount =
      priceMode === "negotiable" ? 0 : normalizeAmount(updates.priceAmount);
  } else if (Object.prototype.hasOwnProperty.call(updates || {}, "priceAmount")) {
    payload.priceAmount = normalizeAmount(updates.priceAmount);
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "availabilityText")) {
    payload.availabilityText = normalizeOptionalText(updates.availabilityText, 160);
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "averageDurationText")) {
    payload.averageDurationText = normalizeOptionalText(updates.averageDurationText, 80);
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "strengthsText")) {
    payload.strengthsText = normalizeOptionalText(updates.strengthsText, 1200);
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "requirementsText")) {
    payload.requirementsText = normalizeOptionalText(updates.requirementsText, 1200);
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "status")) {
    payload.status = ["active", "hidden", "deleted"].includes(updates.status) ? updates.status : "active";
  }
  return unwrapCallableResult(
    updateJobSeekerServiceFn,
    { classId, serviceId, updates: payload },
    "서비스를 수정하지 못했습니다.",
  );
};

export const moderateJobSeekerService = async ({
  classId,
  serviceId,
  status,
  moderationNote,
}) =>
  unwrapCallableResult(
    moderateJobSeekerServiceFn,
    { classId, serviceId, status, moderationNote },
    "서비스 상태를 변경하지 못했습니다.",
  );

export const createJobSeekerRequest = async ({
  classId,
  serviceId,
  request,
  requester = {},
}) => {
  const requesterUid = requester.uid || auth.currentUser?.uid;
  if (!classId || !serviceId) throw new Error("의뢰할 서비스 정보가 없습니다.");
  if (!requesterUid) throw new Error("로그인이 필요합니다.");

  return unwrapCallableResult(
    createJobSeekerRequestFn,
    {
      classId,
      serviceId,
      request: normalizeRequestPayload(request, {}, requester),
    },
    "의뢰를 보내지 못했습니다.",
  );
};

export const reviewJobSeekerRequest = async ({
  classId,
  serviceId,
  requestId,
  action,
  rejectionReason,
}) =>
  unwrapCallableResult(
    reviewJobSeekerRequestFn,
    { classId, serviceId, requestId, action, rejectionReason },
    "의뢰 상태를 변경하지 못했습니다.",
  );

export const completeJobSeekerRequest = async ({ classId, serviceId, requestId }) =>
  unwrapCallableResult(
    completeJobSeekerRequestFn,
    { classId, serviceId, requestId },
    "의뢰를 완료 처리하지 못했습니다.",
  );

const getJobSeekerCategoriesRef = (classId) =>
  collection(db, `classes/${classId}/jobSeekerCategories`);

export const createJobSeekerCategory = async ({ classId, category }) => {
  const name = String(category?.name || "").trim();
  if (!classId || !name) throw new Error("카테고리 이름을 입력해 주세요.");

  const docRef = await addDoc(getJobSeekerCategoriesRef(classId), {
    name,
    iconKey: category?.iconKey || "Tag",
    colorKey: category?.colorKey || "blue",
    isActive: category?.isActive !== false,
    order: Number(category?.order || Date.now()),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: docRef.id };
};

export const updateJobSeekerCategory = async ({ classId, categoryId, updates }) => {
  if (!classId || !categoryId) throw new Error("카테고리 정보가 없습니다.");
  const payload = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(updates || {}, "name")) {
    payload.name = String(updates.name || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "iconKey")) {
    payload.iconKey = updates.iconKey || "Tag";
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "colorKey")) {
    payload.colorKey = updates.colorKey || "blue";
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "isActive")) {
    payload.isActive = updates.isActive !== false;
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "order")) {
    payload.order = Number(updates.order || Date.now());
  }
  if (payload.name === "") throw new Error("카테고리 이름을 입력해 주세요.");

  await updateDoc(doc(db, `classes/${classId}/jobSeekerCategories/${categoryId}`), payload);
  return { ok: true };
};

export const deleteJobSeekerCategory = async ({ classId, categoryId }) => {
  if (!classId || !categoryId) throw new Error("카테고리 정보가 없습니다.");
  await deleteDoc(doc(db, `classes/${classId}/jobSeekerCategories/${categoryId}`));
  return { ok: true };
};

export const reorderJobSeekerCategories = async ({ classId, categories = [] }) => {
  if (!classId) throw new Error("학급 정보가 없습니다.");
  const batch = writeBatch(db);
  categories
    .filter((category) => category?.id)
    .forEach((category, index) => {
      batch.update(doc(db, `classes/${classId}/jobSeekerCategories/${category.id}`), {
        order: index + 1,
        updatedAt: serverTimestamp(),
      });
    });
  await batch.commit();
  return { ok: true };
};

export const payJobSeekerRequestReward = async ({
  classId,
  serviceId,
  requestId,
  note,
}) =>
  unwrapCallableResult(
    payJobSeekerRequestRewardFn,
    { classId, serviceId, requestId, note },
    "의뢰 보상을 지급하지 못했습니다.",
  );
