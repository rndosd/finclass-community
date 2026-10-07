const admin = require("../firebaseAdminCompat");
const { FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

const { hasPermission } = require("../utils/permissions");
const { stageActivityLog, stageCreditLog } = require("../utils/logUtils");
const { stageTaxIncome } = require("../utils/taxIncome");
const {
  stageActivityTaxCancellation,
  stageTaxPostingLink,
} = require("../utils/taxReversal");
const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { getWithholdingPolicy } = require("../utils/taxPolicy");
const { buildIncomeTaxSnapshot } = require("../utils/incomeTaxUtils");
const {
  buildMissionRewardDescriptions,
  normalizeMissionLabel,
} = require("../utils/missionRewardDescription");

dayjs.extend(utc);
dayjs.extend(timezone);

const db = admin.firestore();
const KST = "Asia/Seoul";
const permCache = new Map();

const MSG_LOGIN_REQUIRED = "로그인이 필요합니다.";
const MSG_ALWAYS_MISSION_NOT_FOUND = "상시 과제를 찾을 수 없습니다.";
const MSG_ALWAYS_MISSION_TYPE_INVALID = "상시 과제가 아닙니다.";
const MSG_ALWAYS_MISSION_AVAILABILITY_REQUIRED =
  "상시 과제의 수행 가능 시간이 설정되지 않았습니다.";
const MSG_ALWAYS_MISSION_INACTIVE = "비활성화된 상시 과제입니다.";
const MSG_ALWAYS_MISSION_DAY_NOT_ALLOWED =
  "오늘은 이 상시 과제를 수행할 수 없는 요일입니다.";
const MSG_ALWAYS_MISSION_TIME_NOT_ALLOWED =
  "지금은 이 상시 과제를 수행할 수 없는 시간입니다.";
const MSG_ALWAYS_SUBMISSION_REQUIRED =
  "제출 내용을 입력한 뒤 상시 과제를 제출해주세요.";
const MSG_ALWAYS_MISSION_ADMIN_REQUIRED =
  "상시 과제를 관리할 권한이 없습니다.";
const MSG_CLASS_AND_MISSION_REQUIRED = "classId와 missionId가 필요합니다.";
const MSG_CLASS_MISSION_STUDENT_ATTEMPT_REQUIRED =
  "classId, missionId, studentUid, attemptId가 필요합니다.";
const MSG_CLASS_MISSION_ITEMS_REQUIRED =
  "classId, missionId, items가 필요합니다.";
const MSG_STUDENT_AND_ATTEMPT_REQUIRED =
  "studentUid와 attemptId가 필요합니다.";
const MSG_STUDENT_NOT_FOUND = "학생 정보를 찾을 수 없습니다.";
const MSG_ATTEMPT_NOT_FOUND = "제출 기록을 찾을 수 없습니다.";
const MSG_PLAN_NOT_AVAILABLE =
  "현재 요금제에서는 상시 과제를 사용할 수 없습니다.";
const MSG_ALWAYS_MISSION_NOT_ASSIGNED =
  "이 상시 과제의 대상 학생이 아닙니다.";
const MSG_ALWAYS_MISSION_MAX_PER_DAY_REACHED =
  "오늘 허용된 상시 과제 제출 횟수를 모두 사용했습니다.";
const MSG_ALWAYS_AUTO_APPROVED =
  "상시 과제가 자동 승인되어 완료되었습니다.";
const MSG_ALWAYS_PENDING_REVIEW =
  "상시 과제가 제출되어 승인 대기 중입니다.";
const MSG_ALWAYS_APPROVED = "상시 과제를 승인했습니다.";
const MSG_PENDING_REQUIRED_FOR_APPROVAL =
  "승인 대기 상태인 제출만 승인할 수 있습니다.";
const MSG_PENDING_REQUIRED_FOR_REJECTION =
  "승인 대기 상태인 제출만 반려할 수 있습니다.";
const MSG_APPROVE_EMPTY = "승인할 항목이 없습니다.";
const MSG_REJECT_EMPTY = "반려할 항목이 없습니다.";
const MSG_REJECT_LIMIT = "한 번에 최대 50건까지 반려할 수 있습니다.";
const MSG_LIST_OTHER_STUDENT_PERMISSION =
  "다른 학생의 상시 과제 이력을 조회할 권한이 없습니다.";
const MSG_LIST_ALL_DAYS_PERMISSION =
  "전체 학생의 상시 과제 일별 이력을 조회할 권한이 없습니다.";
const MSG_LIST_ALL_MONTHS_PERMISSION =
  "전체 학생의 상시 과제 월별 이력을 조회할 권한이 없습니다.";

function toDateSafe(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeAttemptDoc(docSnap) {
  const data = docSnap.data() || {};
  const createdAt = toDateSafe(data.createdAt);
  const approvedAt = toDateSafe(data.approvedAt);
  const rejectedAt = toDateSafe(data.rejectedAt);
  const canceledAt = toDateSafe(data.canceledAt);

  return {
    id: docSnap.id,
    ...data,
    createdAtMs: createdAt ? createdAt.getTime() : null,
    approvedAtMs: approvedAt ? approvedAt.getTime() : null,
    rejectedAtMs: rejectedAt ? rejectedAt.getTime() : null,
    canceledAtMs: canceledAt ? canceledAt.getTime() : null,
  };
}

function serializeDayDoc(docSnap) {
  const data = docSnap.data() || {};
  const updatedAt = toDateSafe(data.updatedAt);
  const lastAttemptAt = toDateSafe(data.lastAttemptAt);

  return {
    id: docSnap.id,
    ...data,
    dayKey: data.dayKey || docSnap.id,
    updatedAtMs: updatedAt ? updatedAt.getTime() : null,
    lastAttemptAtMs: lastAttemptAt ? lastAttemptAt.getTime() : null,
  };
}

function serializeMonthDoc(docSnap) {
  const data = docSnap.data() || {};
  const updatedAt = toDateSafe(data.updatedAt);
  const lastAttemptAt = toDateSafe(data.lastAttemptAt);

  return {
    id: docSnap.id,
    ...data,
    monthKey: data.monthKey || docSnap.id,
    updatedAtMs: updatedAt ? updatedAt.getTime() : null,
    lastAttemptAtMs: lastAttemptAt ? lastAttemptAt.getTime() : null,
  };
}

function isWithinDayRange(dayKey, dateFrom, dateTo) {
  if (!dayKey) return false;
  if (dateFrom && dayKey < dateFrom) return false;
  if (dateTo && dayKey > dateTo) return false;
  return true;
}

function isIndexErrorMessage(message = "") {
  return (
    message.includes("requires an index") ||
    message.includes("FAILED_PRECONDITION")
  );
}

async function fetchAttemptsByDayRangeFallback({
  baseQueryRef,
  pageSize,
  cursorDate,
  dateFrom,
  dateTo,
}) {
  const batchSize = Math.max(pageSize * 3, 100);
  const maxRounds = 5;
  const collected = [];
  let rounds = 0;
  let currentCursorDate = cursorDate;
  let exhausted = false;

  while (collected.length < pageSize && !exhausted && rounds < maxRounds) {
    let fallbackQuery = baseQueryRef.orderBy("createdAt", "desc").limit(batchSize);
    if (currentCursorDate) {
      fallbackQuery = fallbackQuery.startAfter(currentCursorDate);
    }

    const snap = await fallbackQuery.get();
    if (snap.empty) {
      exhausted = true;
      break;
    }

    const attempts = snap.docs.map(serializeAttemptDoc);
    attempts.forEach((attempt) => {
      if (isWithinDayRange(attempt.dayKey, dateFrom, dateTo)) {
        collected.push(attempt);
      }

    });

    const lastAttempt = attempts[attempts.length - 1] || null;
    currentCursorDate = toDateSafe(lastAttempt?.createdAtMs);

    if (snap.docs.length < batchSize || !currentCursorDate) {
      exhausted = true;
    }

    rounds += 1;
  }

  const limited = collected.slice(0, pageSize);
  const last = limited[limited.length - 1] || null;

  return {
    attempts: limited,
    hasMore:
      limited.length === pageSize &&
      (!exhausted || collected.length > pageSize),
    nextCursor:
      limited.length === pageSize && last?.createdAtMs
        ? { createdAtMs: last.createdAtMs }
        : null,
  };
}

function buildDayKeysFromRange(dateFrom, dateTo) {
  const startKey = String(dateFrom || dateTo || "").trim();
  const endKey = String(dateTo || dateFrom || "").trim();

  if (!startKey || !endKey) {
    throw new HttpsError(
      "invalid-argument",
      "Teacher day summary queries require a date range.",
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startKey) || !/^\d{4}-\d{2}-\d{2}$/.test(endKey)) {
    throw new HttpsError(
      "invalid-argument",
      "dateFrom/dateTo must be in YYYY-MM-DD format.",
    );
  }

  const start = dayjs.tz(`${startKey}T00:00:00`, KST);
  const end = dayjs.tz(`${endKey}T00:00:00`, KST);

  if (!start.isValid() || !end.isValid()) {
    throw new HttpsError(
      "invalid-argument",
      "Teacher day summary queries require valid dates.",
    );
  }

  if (end.isBefore(start)) {
    throw new HttpsError(
      "invalid-argument",
      "dateTo must be the same as or later than dateFrom.",
    );
  }

  const dayCount = end.diff(start, "day") + 1;
  if (dayCount > 120) {
    throw new HttpsError(
      "failed-precondition",
      "Teacher day summary queries support up to 120 days at once.",
    );
  }

  return Array.from({ length: dayCount }, (_, index) =>
    start.add(index, "day").format("YYYY-MM-DD"),
  );
}

function buildMonthKeysFromRange(dateFrom, dateTo) {
  const startKey = String(dateFrom || dateTo || "").trim();
  const endKey = String(dateTo || dateFrom || "").trim();

  if (!startKey || !endKey) {
    throw new HttpsError(
      "invalid-argument",
      "Teacher month summary queries require a date range.",
    );
  }

  const startMonthKey = monthKeyFromDayKey(startKey);
  const endMonthKey = monthKeyFromDayKey(endKey);
  if (!startMonthKey || !endMonthKey) {
    throw new HttpsError(
      "invalid-argument",
      "dateFrom/dateTo must resolve to valid month keys.",
    );
  }

  const start = dayjs.tz(`${startMonthKey}-01T00:00:00`, KST);
  const end = dayjs.tz(`${endMonthKey}-01T00:00:00`, KST);

  if (!start.isValid() || !end.isValid()) {
    throw new HttpsError(
      "invalid-argument",
      "Teacher month summary queries require valid dates.",
    );
  }

  if (end.isBefore(start, "month")) {
    throw new HttpsError(
      "invalid-argument",
      "dateTo must be the same as or later than dateFrom.",
    );
  }

  const monthCount = end.diff(start, "month") + 1;
  if (monthCount > 24) {
    throw new HttpsError(
      "failed-precondition",
      "Teacher month summary queries support up to 24 months at once.",
    );
  }

  return Array.from({ length: monthCount }, (_, index) =>
    start.add(index, "month").format("YYYY-MM"),
  );
}

function sortTeacherDayDocs(left, right) {
  const dayCompare = String(right.dayKey || "").localeCompare(
    String(left.dayKey || ""),
  );
  if (dayCompare !== 0) return dayCompare;

  const timeCompare =
    num(right.lastAttemptAtMs) - num(left.lastAttemptAtMs);
  if (timeCompare !== 0) return timeCompare;

  return String(left.studentUid || "").localeCompare(
    String(right.studentUid || ""),
  );
}

function sortTeacherMonthDocs(left, right) {
  const monthCompare = String(right.monthKey || "").localeCompare(
    String(left.monthKey || ""),
  );
  if (monthCompare !== 0) return monthCompare;

  const timeCompare =
    num(right.lastAttemptAtMs) - num(left.lastAttemptAtMs);
  if (timeCompare !== 0) return timeCompare;

  return String(left.studentUid || "").localeCompare(
    String(right.studentUid || ""),
  );
}

async function fetchTeacherDayDocsByRange({
  classId,
  missionId,
  studentUids,
  dateFrom,
  dateTo,
}) {
  const dayKeys = buildDayKeysFromRange(dateFrom, dateTo);
  const studentUidSet = new Set(
    (studentUids || [])
      .map((studentUid) => String(studentUid || "").trim())
      .filter(Boolean),
  );

  if (dayKeys.length === 1) {
    const exactDayKey = dayKeys[0];
    const daySnap = await db
      .collectionGroup("days")
      .where("classId", "==", classId)
      .where("missionId", "==", missionId)
      .where("dayKey", "==", exactDayKey)
      .get();

    return daySnap.docs
      .filter((docSnap) => {
        if (!docSnap.exists) return false;
        if (studentUidSet.size === 0) return true;
        const studentUid = String(docSnap.data()?.studentUid || "").trim();
        return studentUidSet.has(studentUid);
      })
      .map((docSnap) => serializeDayDoc(docSnap))
      .sort(sortTeacherDayDocs);
  }

  const refs = [];

  studentUidSet.forEach((studentUid) => {
    dayKeys.forEach((dayKey) => {
      refs.push(missionDayRef(classId, studentUid, missionId, dayKey));
    });
  });

  if (refs.length === 0) {
    return [];
  }

  const chunkSize = 450;
  const docSnaps = [];

  for (let index = 0; index < refs.length; index += chunkSize) {
    const chunk = refs.slice(index, index + chunkSize);
    const snaps = await db.getAll(...chunk);
    docSnaps.push(...snaps);
  }

  return docSnaps
    .filter((snap) => snap.exists)
    .map((snap) => serializeDayDoc(snap))
    .sort(sortTeacherDayDocs);
}

async function fetchTeacherMonthDocsByRange({
  classId,
  missionId,
  studentUids,
  dateFrom,
  dateTo,
}) {
  const monthKeys = buildMonthKeysFromRange(dateFrom, dateTo);
  const studentUidSet = new Set(
    (studentUids || [])
      .map((studentUid) => String(studentUid || "").trim())
      .filter(Boolean),
  );

  if (monthKeys.length === 1) {
    const exactMonthKey = monthKeys[0];
    const monthSnap = await db
      .collectionGroup("months")
      .where("classId", "==", classId)
      .where("missionId", "==", missionId)
      .where("monthKey", "==", exactMonthKey)
      .get();

    return monthSnap.docs
      .filter((docSnap) => {
        if (!docSnap.exists) return false;
        if (studentUidSet.size === 0) return true;
        const studentUid = String(docSnap.data()?.studentUid || "").trim();
        return studentUidSet.has(studentUid);
      })
      .map((docSnap) => serializeMonthDoc(docSnap))
      .sort(sortTeacherMonthDocs);
  }

  const refs = [];

  studentUidSet.forEach((studentUid) => {
    monthKeys.forEach((monthKey) => {
      refs.push(missionMonthRef(classId, studentUid, missionId, monthKey));
    });
  });

  if (refs.length === 0) {
    return [];
  }

  const chunkSize = 450;
  const docSnaps = [];

  for (let index = 0; index < refs.length; index += chunkSize) {
    const chunk = refs.slice(index, index + chunkSize);
    const snaps = await db.getAll(...chunk);
    docSnaps.push(...snaps);
  }

  return docSnaps
    .filter((snap) => snap.exists)
    .map((snap) => serializeMonthDoc(snap))
    .sort(sortTeacherMonthDocs);
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const REWARD_TYPES = ["currency", "credit", "missionToken"];
const DEFAULT_TIER_COLOR = "#64748b";

function normalizeRewardNumber(value) {
  return Math.max(0, num(value));
}

function normalizeRewardConfig(type, rawReward = {}) {
  if (!REWARD_TYPES.includes(type)) return null;

  const amount = normalizeRewardNumber(rawReward?.amount);
  const hasRangeFields =
    rawReward?.isRange === true ||
    rawReward?.mode === "range" ||
    rawReward?.minAmount !== undefined ||
    rawReward?.maxAmount !== undefined;

  let minAmount = hasRangeFields
    ? normalizeRewardNumber(rawReward?.minAmount ?? amount)
    : amount;
  let maxAmount = hasRangeFields
    ? normalizeRewardNumber(rawReward?.maxAmount ?? amount)
    : amount;

  if (maxAmount < minAmount) {
    [minAmount, maxAmount] = [maxAmount, minAmount];
  }

  return {
    type,
    amount: hasRangeFields ? maxAmount : amount,
    minAmount,
    maxAmount,
    isRange: hasRangeFields && maxAmount !== minAmount,
  };
}

function getRewardConfigs(mission = {}) {
  const base = {
    currency: normalizeRewardConfig("currency"),
    credit: normalizeRewardConfig("credit"),
    missionToken: normalizeRewardConfig("missionToken"),
  };
  const rewards = mission?.rewards;

  if (Array.isArray(rewards)) {
    rewards.forEach((reward) => {
      const type = reward?.type;
      if (!REWARD_TYPES.includes(type)) return;
      base[type] = normalizeRewardConfig(type, reward);
    });
    return base;
  }

  if (rewards && typeof rewards === "object") {
    base.currency = normalizeRewardConfig("currency", {
      amount: rewards.currency,
    });
    base.credit = normalizeRewardConfig("credit", {
      amount: rewards.credit,
    });
    base.missionToken = normalizeRewardConfig("missionToken", {
      amount: rewards.missionToken ?? rewards.token,
    });
  }

  return base;
}

function missionHasRewardRange(mission = {}) {
  return Object.values(getRewardConfigs(mission)).some(
    (reward) => reward.isRange && reward.maxAmount > 0,
  );
}

function resolveRewardSnapshot(mission, rewardOverride = null, allowReward = true) {
  if (!allowReward) {
    return { currency: 0, credit: 0, missionToken: 0 };
  }

  const configs = getRewardConfigs(mission);
  const override =
    rewardOverride && typeof rewardOverride === "object" ? rewardOverride : {};
  const rewardSnapshot = {};

  REWARD_TYPES.forEach((type) => {
    const config = configs[type];
    if (!config || config.maxAmount <= 0) {
      rewardSnapshot[type] = 0;
      return;
    }

    if (!config.isRange) {
      rewardSnapshot[type] = config.maxAmount;
      return;
    }

    const rawValue = override[type];
    const resolvedValue =
      rawValue === undefined || rawValue === null || rawValue === ""
        ? config.maxAmount
        : normalizeRewardNumber(rawValue);

    if (resolvedValue < config.minAmount || resolvedValue > config.maxAmount) {
      throw new Error(
        `${type} reward must be within ${config.minAmount} to ${config.maxAmount}.`,
      );
    }

    rewardSnapshot[type] = resolvedValue;
  });

  return rewardSnapshot;
}

function normalizeTierMeta(rawTier = null) {
  if (!rawTier) return null;

  if (typeof rawTier === "string") {
    const value = rawTier.trim();
    if (!value) return null;
    return {
      id: value,
      name: value,
      color: DEFAULT_TIER_COLOR,
      minScore: 0,
    };
  }

  const id = String(rawTier?.id || rawTier?.name || "").trim();
  const name = String(rawTier?.name || rawTier?.id || "").trim();
  if (!id && !name) return null;

  const parsedMinScore = Number(rawTier?.minScore);
  return {
    id: id || name,
    name: name || id,
    color: String(rawTier?.color || DEFAULT_TIER_COLOR),
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
  };
}

function getMissionMinTierRequirement(mission = {}) {
  const tierFromObject = normalizeTierMeta(mission?.minCreditTier);
  if (tierFromObject) return tierFromObject;

  const tierId = String(mission?.minCreditTierId || "").trim();
  if (!tierId) return null;

  const parsedMinScore = Number(mission?.minCreditTierMinScore);
  return {
    id: tierId,
    name: String(mission?.minCreditTierName || tierId).trim(),
    color: String(mission?.minCreditTierColor || DEFAULT_TIER_COLOR),
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
  };
}

function getStudentTierInfo(studentData = {}) {
  return normalizeTierMeta(studentData?.creditTier);
}

function meetsMissionTierRequirement(mission = {}, studentData = {}) {
  const minTier = getMissionMinTierRequirement(mission);
  if (!minTier) return true;

  const studentScore = Number(studentData?.creditScore);
  if (Number.isFinite(studentScore)) {
    return studentScore >= Number(minTier.minScore || 0);
  }

  const studentTier = getStudentTierInfo(studentData);
  if (!studentTier) return false;

  if (studentTier.id && minTier.id && studentTier.id === minTier.id) {
    return true;
  }

  return Number(studentTier.minScore || 0) >= Number(minTier.minScore || 0);
}

function isMissionAssignedToStudent(mission = {}, studentUid, studentData = {}) {
  const resolvedUid = String(studentUid || "").trim();
  if (!resolvedUid) return false;

  const targets = Array.isArray(mission?.targetStudentUids)
    ? mission.targetStudentUids
    : [];

  if (targets.length > 0 && !targets.includes(resolvedUid)) {
    return false;
  }

  return meetsMissionTierRequirement(mission, studentData);
}

function assertMissionEligibility(mission = {}, studentUid, studentData = {}) {
  const resolvedUid = String(studentUid || "").trim();
  if (!resolvedUid) {
    throw new Error("Invalid student information.");
  }

  const targets = Array.isArray(mission?.targetStudentUids)
    ? mission.targetStudentUids
    : [];

  if (targets.length > 0 && !targets.includes(resolvedUid)) {
    throw new Error("This always mission is not assigned to the student.");
  }

  const minTier = getMissionMinTierRequirement(mission);
  if (minTier && !isMissionAssignedToStudent(mission, resolvedUid, studentData)) {
    throw new Error(
      `This mission requires ${minTier.name || minTier.id} or higher credit tier.`,
    );
  }
}

function todayKeyKST(nowKST = dayjs().tz(KST)) {
  return nowKST.format("YYYY-MM-DD");
}

function monthKeyFromDayKey(dayKey) {
  const normalized = String(dayKey || "").trim();
  if (!normalized) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized.slice(0, 7);
  }

  const parsed = dayjs.tz(normalized, KST);
  return parsed.isValid() ? parsed.format("YYYY-MM") : "";
}

function missionRef(classId, missionId) {
  return db.doc(`classes/${classId}/missions/${missionId}`);
}

function classRef(classId) {
  return db.doc(`classes/${classId}`);
}

function studentRef(classId, studentUid) {
  return db.doc(`classes/${classId}/students/${studentUid}`);
}

function missionStateRef(classId, studentUid, missionId) {
  return db.doc(
    `classes/${classId}/students/${studentUid}/missionState/${missionId}`,
  );
}

function missionDayRef(classId, studentUid, missionId, dayKey) {
  return db.doc(
    `classes/${classId}/students/${studentUid}/missionState/${missionId}/days/${dayKey}`,
  );
}

function missionMonthRef(classId, studentUid, missionId, monthKey) {
  return db.doc(
    `classes/${classId}/students/${studentUid}/missionState/${missionId}/months/${monthKey}`,
  );
}

function missionAttemptsCol(classId, studentUid, missionId) {
  return db.collection(
    `classes/${classId}/students/${studentUid}/missionState/${missionId}/attempts`,
  );
}

function missionAttemptRef(classId, studentUid, missionId, attemptId) {
  return db.doc(
    `classes/${classId}/students/${studentUid}/missionState/${missionId}/attempts/${attemptId}`,
  );
}

function ensureAlwaysMission(mission) {
  if (!mission) {
    throw new HttpsError("not-found", MSG_ALWAYS_MISSION_NOT_FOUND);
  }
  if (mission.type !== "always") {
    throw new HttpsError("failed-precondition", MSG_ALWAYS_MISSION_TYPE_INVALID);
  }
  if (!mission.availability) {
    throw new HttpsError(
      "failed-precondition",
      MSG_ALWAYS_MISSION_AVAILABILITY_REQUIRED,
    );
  }
  if (mission.isActive === false) {
    throw new HttpsError("failed-precondition", MSG_ALWAYS_MISSION_INACTIVE);
  }
}

function normalizeAlwaysDays(days) {
  if (!Array.isArray(days) || days.length === 0) return [1, 2, 3, 4, 5];

  const normalized = days
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

  return normalized.length > 0 ? [...new Set(normalized)] : [1, 2, 3, 4, 5];
}

function checkAvailabilityNow(mission, nowKST) {
  const availability = mission?.availability || {};
  const days = normalizeAlwaysDays(availability.daysOfWeek || availability.days);

  if (!days.includes(nowKST.day())) {
    return {
      ok: false,
      reason: MSG_ALWAYS_MISSION_DAY_NOT_ALLOWED,
    };
  }

  const start = availability.startTime || "00:00";
  const end = availability.endTime || "23:59";
  const [startHour, startMinute] = start.split(":").map((value) => num(value));
  const [endHour, endMinute] = end.split(":").map((value) => num(value));

  const nowMinutes = nowKST.hour() * 60 + nowKST.minute();
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  if (nowMinutes < startMinutes || nowMinutes > endMinutes) {
    return {
      ok: false,
      reason: MSG_ALWAYS_MISSION_TIME_NOT_ALLOWED,
    };
  }

  return { ok: true };
}

function extractRewardsSafe(mission) {
  return resolveRewardSnapshot(mission);
}

function hasPositiveReward(reward) {
  if (!reward) return false;
  return (
    num(reward.currency) > 0 ||
    num(reward.credit) > 0 ||
    num(reward.missionToken) > 0
  );
}

function buildMissionRewardIncomeTax(classData, grossAmount) {
  return buildIncomeTaxSnapshot({
    sourceKey: "missionReward",
    grossAmount,
    policy: getWithholdingPolicy(classData, "missionReward") || {},
  });
}

function buildMissionRewardPayoutSnapshot(reward, classData = {}) {
  const grossCurrency = num(reward?.currency);
  if (!(grossCurrency > 0)) return { ...reward };

  const incomeTaxSnapshot = buildMissionRewardIncomeTax(classData, grossCurrency);
  return {
    ...reward,
    currency: incomeTaxSnapshot.netAmount,
    grossCurrency: incomeTaxSnapshot.grossAmount,
    withheldCurrency: incomeTaxSnapshot.withheldAmount,
    netCurrency: incomeTaxSnapshot.netAmount,
    incomeTax: incomeTaxSnapshot.incomeTax,
  };
}

function getStudentProfile(studentSnap, auth) {
  const student = studentSnap?.data?.() || {};
  return {
    studentName:
      student.name ||
      student.displayName ||
      auth?.token?.name ||
      auth?.token?.displayName ||
      "",
    studentNumber: student.studentNumber ?? null,
  };
}

function getMissionStats(mission) {
  return {
    totalCount: num(mission?.stats?.totalCount ?? mission?.["stats.totalCount"]),
    approvedCount: num(
      mission?.stats?.approvedCount ?? mission?.["stats.approvedCount"],
    ),
    pendingCount: num(
      mission?.stats?.pendingCount ?? mission?.["stats.pendingCount"],
    ),
  };
}

function getStateStats(state, dayKey) {
  return {
    todayCount: state?.todayKey === dayKey ? num(state?.todayCount) : 0,
    totalCount: num(state?.totalCount),
    approvedCount: num(state?.approvedCount),
    pendingCount: num(state?.pendingCount),
    rewardTotal: getRewardTotalStats(state),
  };
}

function getRewardTotalStats(data) {
  return {
    currency: num(
      data?.rewardTotal?.currency,
      num(data?.["rewardTotal.currency"]),
    ),
    credit: num(
      data?.rewardTotal?.credit,
      num(data?.["rewardTotal.credit"]),
    ),
    missionToken: num(
      data?.rewardTotal?.missionToken,
      num(data?.["rewardTotal.missionToken"]),
    ),
  };
}

function getDayStats(dayData) {
  return {
    attemptCount: num(dayData?.attemptCount),
    approvedCount: num(dayData?.approvedCount),
    pendingCount: num(dayData?.pendingCount),
    rewardTotal: getRewardTotalStats(dayData),
  };
}

function getMonthStats(monthData) {
  return {
    attemptCount: num(monthData?.attemptCount),
    approvedCount: num(monthData?.approvedCount),
    pendingCount: num(monthData?.pendingCount),
    activeDayCount: num(monthData?.activeDayCount),
    rewardTotal: getRewardTotalStats(monthData),
  };
}

function isFirstAttemptForDayFromState(stateData, dayKey) {
  return (
    String(stateData?.todayKey || "").trim() !== String(dayKey || "").trim() ||
    num(stateData?.todayCount) <= 0
  );
}

function buildMissionDayIncrementPatch({
  classId,
  missionId,
  studentUid,
  studentName,
  studentNumber,
  missionTitle,
  dayKey,
  approvedDelta = 0,
  pendingDelta = 0,
  rewardCurrencyDelta = 0,
  rewardCreditDelta = 0,
  rewardMissionTokenDelta = 0,
}) {
  return {
    classId,
    missionId,
    studentUid,
    studentName,
    studentNumber,
    missionTitle: missionTitle || "",
    dayKey,
    attemptCount: FieldValue.increment(1),
    approvedCount: FieldValue.increment(approvedDelta),
    pendingCount: FieldValue.increment(pendingDelta),
    rewardTotal: {
      currency: FieldValue.increment(rewardCurrencyDelta),
      credit: FieldValue.increment(rewardCreditDelta),
      missionToken: FieldValue.increment(rewardMissionTokenDelta),
    },
    updatedAt: FieldValue.serverTimestamp(),
    lastAttemptAt: FieldValue.serverTimestamp(),
  };
}

function buildMissionMonthIncrementPatch({
  classId,
  missionId,
  studentUid,
  studentName,
  studentNumber,
  missionTitle,
  monthKey,
  approvedDelta = 0,
  pendingDelta = 0,
  activeDayDelta = 0,
  rewardCurrencyDelta = 0,
  rewardCreditDelta = 0,
  rewardMissionTokenDelta = 0,
}) {
  return {
    classId,
    missionId,
    studentUid,
    studentName,
    studentNumber,
    missionTitle: missionTitle || "",
    monthKey,
    attemptCount: FieldValue.increment(1),
    approvedCount: FieldValue.increment(approvedDelta),
    pendingCount: FieldValue.increment(pendingDelta),
    activeDayCount: FieldValue.increment(activeDayDelta),
    rewardTotal: {
      currency: FieldValue.increment(rewardCurrencyDelta),
      credit: FieldValue.increment(rewardCreditDelta),
      missionToken: FieldValue.increment(rewardMissionTokenDelta),
    },
    updatedAt: FieldValue.serverTimestamp(),
    lastAttemptAt: FieldValue.serverTimestamp(),
  };
}

function validateSubmissionContent(contentHtml, requireSubmissionForm) {
  if (!requireSubmissionForm) return;
  const plain = String(contentHtml || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .trim();
  if (!plain) {
    throw new HttpsError("failed-precondition", MSG_ALWAYS_SUBMISSION_REQUIRED);
  }
}

function makeMissionStatePatch({
  classId,
  missionId,
  mission,
  studentUid,
  studentName,
  studentNumber,
  existingState,
  dayKey,
  status,
  reward,
  attemptId = null,
  contentHtml = "",
}) {
  const stateStats = getStateStats(existingState, dayKey);
  const nextRewardTotal = {
    currency:
      stateStats.rewardTotal.currency +
      (status === "approved" ? num(reward.currency) : 0),
    credit:
      stateStats.rewardTotal.credit +
      (status === "approved" ? num(reward.credit) : 0),
    missionToken:
      stateStats.rewardTotal.missionToken +
      (status === "approved" ? num(reward.missionToken) : 0),
  };

  return {
    classId,
    missionId,
    studentUid,
    studentName,
    studentNumber,
    missionTitle: mission.title || "",
    autoApprove: !!mission.autoApprove,
    requireSubmissionForm: !!mission.requireSubmissionForm,
    todayKey: dayKey,
    todayCount: stateStats.todayCount + 1,
    totalCount: stateStats.totalCount + 1,
    approvedCount:
      stateStats.approvedCount + (status === "approved" ? 1 : 0),
    pendingCount: stateStats.pendingCount + (status === "pending" ? 1 : 0),
    rewardTotal: nextRewardTotal,
    latestStatus: status,
    latestAttemptId: attemptId,
    latestContentPreview: contentHtml
      ? String(contentHtml).replace(/<[^>]*>/g, " ").slice(0, 120).trim()
      : "",
    lastDayKey: dayKey,
    updatedAt: FieldValue.serverTimestamp(),
    lastAttemptAt: FieldValue.serverTimestamp(),
  };
}

function makeMissionStatsPatch(
  mission,
  { totalDelta = 0, approvedDelta = 0, pendingDelta = 0 },
) {
  const stats = getMissionStats(mission);
  return {
    ...makeMissionStatsValuePatch({
      totalCount: stats.totalCount + totalDelta,
      approvedCount: stats.approvedCount + approvedDelta,
      pendingCount: stats.pendingCount + pendingDelta,
    }),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function makeMissionStatsValuePatch(stats) {
  return {
    "stats.totalCount": Math.max(0, num(stats?.totalCount)),
    "stats.approvedCount": Math.max(0, num(stats?.approvedCount)),
    "stats.pendingCount": Math.max(0, num(stats?.pendingCount)),
  };
}

async function hasPermissionCached(uid, classId, permission, cache, ttlMs = 120000) {
  const key = `${uid}:${classId}:${permission}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < ttlMs) return hit.allowed;
  const allowed = await hasPermission(uid, classId, permission);
  cache.set(key, { allowed, ts: now });
  return allowed;
}

async function ensureTeacherLike(callerUid, callerRole, classId) {
  const allowed =
    callerRole === "teacher" ||
    callerRole === "admin" ||
    (await hasPermissionCached(callerUid, classId, "mission_admin", permCache));
  if (!allowed) {
    throw new HttpsError("permission-denied", MSG_ALWAYS_MISSION_ADMIN_REQUIRED);
  }
}

function giveRewardInTx(
  tx,
  classId,
  studentUid,
  reward,
  mission,
  context,
  currencyUnit,
  classData = {},
) {
  if (!hasPositiveReward(reward)) return null;

  const payoutReward = buildMissionRewardPayoutSnapshot(reward, classData);
  const rewardDescriptions = buildMissionRewardDescriptions(mission.title);
  const targetStudentRef = studentRef(classId, studentUid);
  const updates = {};

  if (num(payoutReward.currency) > 0) {
    updates["assets.cash"] = FieldValue.increment(num(payoutReward.currency));
  }
  if (num(reward.credit) > 0) {
    updates.creditScore = FieldValue.increment(num(reward.credit));
  }
  if (num(reward.missionToken) > 0) {
    updates["assets.missionToken"] = FieldValue.increment(num(reward.missionToken));
  }

  if (Object.keys(updates).length > 0) {
    tx.update(targetStudentRef, updates);
  }

  if (num(payoutReward.currency) > 0) {
    const taxActivityLogId = stageActivityLog(
      tx,
      classId,
      {
        studentUid,
        type: "income",
        category: "mission",
        amount: num(payoutReward.currency),
        description: rewardDescriptions.granted,
        relatedDoc: { collection: "missions", id: mission.id },
        currency: currencyUnit,
        grossAmount: payoutReward.grossCurrency,
        withheldAmount: payoutReward.withheldCurrency,
        netAmount: payoutReward.netCurrency,
        incomeTax: payoutReward.incomeTax,
      },
      context,
    );

    if (num(payoutReward.withheldCurrency) > 0) {
      const withholdingTaxRecord = stageTaxIncome(
        tx,
        classId,
        {
          amount: payoutReward.withheldCurrency,
          source: "mission_reward_withholding",
          taxType: "income_tax",
          description: rewardDescriptions.withholding,
          studentUid,
          breakdown: {
            baseAmount: payoutReward.grossCurrency,
            taxAmount: payoutReward.withheldCurrency,
            taxRate: payoutReward.incomeTax?.taxRate,
          },
        },
        context?.issuedByUid || "system_auto",
        {
          ...context,
          classData,
          sourceKey: "missionReward",
          detailLines: [
            {
              amount: payoutReward.withheldCurrency,
              source: "mission_reward_withholding",
              taxType: "income_tax",
              description: rewardDescriptions.withholding,
              studentUid,
              relatedDoc: { collection: "missions", id: mission.id },
              meta: {
                incomeTax: payoutReward.incomeTax,
              },
            },
          ],
        },
      );
      if (taxActivityLogId) {
        stageTaxPostingLink(
          tx,
          db.doc(
            `classes/${classId}/students/${studentUid}/activityLogs/${taxActivityLogId}`,
          ),
          withholdingTaxRecord,
        );
      }
      payoutReward.taxActivityLogId = taxActivityLogId;
    }
  }

  if (num(reward.credit) > 0) {
    stageCreditLog(
      tx,
      classId,
      {
        studentUid,
        delta: num(reward.credit),
        reason: rewardDescriptions.creditGranted,
        relatedDoc: { collection: "missions", id: mission.id },
        source: "mission",
        issuedByUid: context?.issuedByUid || "system_auto",
      },
      context,
    );
  }

  return payoutReward;
}

function takeRewardBackInTx(
  tx,
  classId,
  studentUid,
  reward,
  mission,
  context,
  currencyUnit,
) {
  if (!hasPositiveReward(reward)) return;

  const rewardDescriptions = buildMissionRewardDescriptions(mission.title);

  const targetStudentRef = studentRef(classId, studentUid);
  const updates = {};

  if (num(reward.currency) > 0) {
    updates["assets.cash"] = FieldValue.increment(-num(reward.currency));
  }
  if (num(reward.credit) > 0) {
    updates.creditScore = FieldValue.increment(-num(reward.credit));
  }
  if (num(reward.missionToken) > 0) {
    updates["assets.missionToken"] = FieldValue.increment(-num(reward.missionToken));
  }

  if (Object.keys(updates).length > 0) {
    tx.update(targetStudentRef, updates);
  }

  if (num(reward.currency) > 0) {
    stageActivityLog(
      tx,
      classId,
      {
        studentUid,
        type: "expense",
        category: "mission_penalty",
        amount: num(reward.currency),
        description: rewardDescriptions.reversed,
        relatedDoc: { collection: "missions", id: mission.id },
        currency: currencyUnit,
      },
      context,
    );
  }

  if (num(reward.credit) > 0) {
    stageCreditLog(
      tx,
      classId,
      {
        studentUid,
        delta: -num(reward.credit),
        reason: rewardDescriptions.creditReversed,
        relatedDoc: { collection: "missions", id: mission.id },
        source: "mission",
        issuedByUid: context?.issuedByUid || "system_auto",
      },
      context,
    );
  }
}

function isValidDayKey(dayKey) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || "").trim());
}

function getAttemptEventTimeMs(attempt) {
  const candidates = [
    attempt?.createdAt,
    attempt?.submittedAt,
    attempt?.approvedAt,
    attempt?.rejectedAt,
    attempt?.canceledAt,
    attempt?.updatedAt,
  ];

  let latestMs = 0;
  candidates.forEach((candidate) => {
    const date = toDateSafe(candidate);
    if (date) {
      latestMs = Math.max(latestMs, date.getTime());
    }
  });
  return latestMs;
}

function makeEmptyRewardTotal() {
  return { currency: 0, credit: 0, missionToken: 0 };
}

function buildBackfillSummaryMaps({ attempts, mission, includeMonths }) {
  const dayMap = new Map();
  const monthMap = new Map();
  let activeAttemptCount = 0;

  attempts.forEach((attempt) => {
    const status = String(attempt?.status || "").trim();
    if (status !== "approved" && status !== "pending") return;

    const studentUid = String(attempt?.studentUid || "").trim();
    const dayKey = String(attempt?.dayKey || "").trim();
    if (!studentUid || !isValidDayKey(dayKey)) return;

    const monthKey = monthKeyFromDayKey(dayKey);
    if (!monthKey) return;

    activeAttemptCount += 1;

    const eventTimeMs = getAttemptEventTimeMs(attempt);
    const rewardSnapshot =
      status === "approved"
        ? attempt?.rewardSnapshot || extractRewardsSafe(mission)
        : makeEmptyRewardTotal();

    const dayMapKey = studentUid + "::" + dayKey;
    const dayEntry = dayMap.get(dayMapKey) || {
      classId: attempt.classId || "",
      missionId: attempt.missionId || mission?.id || "",
      missionTitle: mission?.title || "",
      studentUid,
      studentName: attempt.studentName || "",
      studentNumber: attempt.studentNumber ?? null,
      dayKey,
      attemptCount: 0,
      approvedCount: 0,
      pendingCount: 0,
      rewardTotal: makeEmptyRewardTotal(),
      lastAttemptAtMs: 0,
    };

    dayEntry.attemptCount += 1;
    if (status === "approved") dayEntry.approvedCount += 1;
    if (status === "pending") dayEntry.pendingCount += 1;
    dayEntry.rewardTotal.currency += num(rewardSnapshot.currency);
    dayEntry.rewardTotal.credit += num(rewardSnapshot.credit);
    dayEntry.rewardTotal.missionToken += num(rewardSnapshot.missionToken);
    if (!dayEntry.studentName && attempt.studentName) {
      dayEntry.studentName = attempt.studentName;
    }
    if (dayEntry.studentNumber == null && attempt.studentNumber != null) {
      dayEntry.studentNumber = attempt.studentNumber;
    }
    dayEntry.lastAttemptAtMs = Math.max(dayEntry.lastAttemptAtMs, eventTimeMs);
    dayMap.set(dayMapKey, dayEntry);

    if (!includeMonths) return;

    const monthMapKey = studentUid + "::" + monthKey;
    const monthEntry = monthMap.get(monthMapKey) || {
      classId: attempt.classId || "",
      missionId: attempt.missionId || mission?.id || "",
      missionTitle: mission?.title || "",
      studentUid,
      studentName: attempt.studentName || "",
      studentNumber: attempt.studentNumber ?? null,
      monthKey,
      attemptCount: 0,
      approvedCount: 0,
      pendingCount: 0,
      rewardTotal: makeEmptyRewardTotal(),
      lastAttemptAtMs: 0,
      activeDayKeys: new Set(),
    };

    monthEntry.attemptCount += 1;
    if (status === "approved") monthEntry.approvedCount += 1;
    if (status === "pending") monthEntry.pendingCount += 1;
    monthEntry.rewardTotal.currency += num(rewardSnapshot.currency);
    monthEntry.rewardTotal.credit += num(rewardSnapshot.credit);
    monthEntry.rewardTotal.missionToken += num(rewardSnapshot.missionToken);
    monthEntry.activeDayKeys.add(dayKey);
    if (!monthEntry.studentName && attempt.studentName) {
      monthEntry.studentName = attempt.studentName;
    }
    if (monthEntry.studentNumber == null && attempt.studentNumber != null) {
      monthEntry.studentNumber = attempt.studentNumber;
    }
    monthEntry.lastAttemptAtMs = Math.max(monthEntry.lastAttemptAtMs, eventTimeMs);
    monthMap.set(monthMapKey, monthEntry);
  });

  const dayEntries = Array.from(dayMap.values());
  const monthEntries = Array.from(monthMap.values()).map((entry) => ({
    ...entry,
    activeDayCount: entry.activeDayKeys.size,
  }));

  return { dayEntries, monthEntries, activeAttemptCount };
}

async function listExistingMissionSummaryDocs({
  summaryKind,
  classId,
  missionId,
  studentUidSet,
  dateFrom,
  dateTo,
}) {
  const studentUids = Array.from(studentUidSet || []).filter(Boolean);
  const docs = [];

  for (const studentUid of studentUids) {
    const summarySnap = await missionStateRef(classId, studentUid, missionId)
      .collection(summaryKind)
      .get();

    summarySnap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (String(data.missionId || missionId || "").trim() !== String(missionId || "").trim()) {
        return;
      }

      if (summaryKind === "days") {
        const dayKey = String(data.dayKey || docSnap.id || "").trim();
        if (dateFrom && dayKey < dateFrom) return;
        if (dateTo && dayKey > dateTo) return;
        docs.push(docSnap);
        return;
      }

      const monthKey = String(data.monthKey || docSnap.id || "").trim();
      const monthFrom = dateFrom ? monthKeyFromDayKey(dateFrom) : "";
      const monthTo = dateTo ? monthKeyFromDayKey(dateTo) : "";
      if (monthFrom && monthKey < monthFrom) return;
      if (monthTo && monthKey > monthTo) return;
      docs.push(docSnap);
    });
  }

  return docs;
}

async function commitWriteOps(writeOps, chunkSize = 400) {
  let batch = db.batch();
  let opCount = 0;

  for (const writeOp of writeOps) {
    if (writeOp.type === "delete") {
      batch.delete(writeOp.ref);
    } else {
      batch.set(writeOp.ref, writeOp.data, { merge: true });
    }

    opCount += 1;
    if (opCount >= chunkSize) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await batch.commit();
  }
}

exports.alwaysRecordAttempt = onCall(
  { region: "asia-northeast3", timeoutSeconds: 30 },
  async (request) => {
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError("unauthenticated", MSG_LOGIN_REQUIRED);
    }

    const { classId, missionId, contentHtml = "" } = request.data || {};
    if (!classId || !missionId) {
      throw new HttpsError("invalid-argument", MSG_CLASS_AND_MISSION_REQUIRED);
    }

    const globalConfig = await getGlobalConfig();
    const studentUid = auth.uid;
    const nowKST = dayjs().tz(KST);
    const dayKey = todayKeyKST(nowKST);
    const monthKey = monthKeyFromDayKey(dayKey);

    return db.runTransaction(async (tx) => {
      const targetMissionRef = missionRef(classId, missionId);
      const targetStudentRef = studentRef(classId, studentUid);
      const targetClassRef = classRef(classId);
      const targetStateRef = missionStateRef(classId, studentUid, missionId);
      const targetDayRef = missionDayRef(classId, studentUid, missionId, dayKey);
      const targetMonthRef = missionMonthRef(
        classId,
        studentUid,
        missionId,
        monthKey,
      );

      const [missionSnap, studentSnap, classSnap, stateSnap] = await tx.getAll(
        targetMissionRef,
        targetStudentRef,
        targetClassRef,
        targetStateRef,
      );

      if (!missionSnap.exists) {
        throw new HttpsError("not-found", MSG_ALWAYS_MISSION_NOT_FOUND);
      }
      if (!studentSnap.exists) {
        throw new HttpsError("not-found", MSG_STUDENT_NOT_FOUND);
      }

      const mission = { id: missionSnap.id, ...missionSnap.data() };
      const classData = classSnap.data() || {};
      const planType = classData.planType || "FREE";

      if (!canUseFeature(globalConfig, planType, "mission", "accessible")) {
        throw new HttpsError("permission-denied", MSG_PLAN_NOT_AVAILABLE);
      }

      ensureAlwaysMission(mission);

      if (
        Array.isArray(mission.targetStudentUids) &&
        mission.targetStudentUids.length > 0 &&
        !mission.targetStudentUids.includes(studentUid)
      ) {
        throw new HttpsError("permission-denied", MSG_ALWAYS_MISSION_NOT_ASSIGNED);
      }

      const studentData = studentSnap.data() || {};
      try {
        assertMissionEligibility(mission, studentUid, studentData);
      } catch (error) {
        throw new HttpsError(
          "permission-denied",
          error?.message || "This mission is not available for the student.",
        );
      }

      const availabilityCheck = checkAvailabilityNow(mission, nowKST);
      if (!availabilityCheck.ok) {
        throw new HttpsError("failed-precondition", availabilityCheck.reason);
      }

      validateSubmissionContent(contentHtml, !!mission.requireSubmissionForm);

      const stateData = stateSnap.exists ? stateSnap.data() : {};
      const currentTodayCount =
        stateData?.todayKey === dayKey ? num(stateData?.todayCount) : 0;
      const isFirstAttemptForDay = isFirstAttemptForDayFromState(
        stateData,
        dayKey,
      );
      const maxPerDay = Math.max(1, num(mission?.availability?.maxPerDay, 1));

      if (currentTodayCount >= maxPerDay) {
        throw new HttpsError(
          "failed-precondition",
          MSG_ALWAYS_MISSION_MAX_PER_DAY_REACHED,
        );
      }

      if (mission.autoApprove && missionHasRewardRange(mission)) {
        throw new HttpsError(
          "failed-precondition",
          "Range rewards are only available for manual approval.",
        );
      }

      const { studentName, studentNumber } = getStudentProfile(studentSnap, auth);
      const reward = extractRewardsSafe(mission);
      const status = mission.autoApprove ? "approved" : "pending";
      const needsAttemptDoc = !mission.autoApprove || !!mission.requireSubmissionForm;
      const attemptDocRef = needsAttemptDoc
        ? missionAttemptsCol(classId, studentUid, missionId).doc()
        : null;

      const statePatch = makeMissionStatePatch({
        classId,
        missionId,
        mission,
        studentUid,
        studentName,
        studentNumber,
        existingState: stateData,
        dayKey,
        status,
        reward,
        attemptId: attemptDocRef?.id || null,
        contentHtml,
      });

      if (status === "approved") {
        statePatch.lastApprovedAt = FieldValue.serverTimestamp();
      }
      if (status === "pending") {
        statePatch.lastPendingAt = FieldValue.serverTimestamp();
      }

      tx.set(targetStateRef, statePatch, { merge: true });

      const approvedDelta = status === "approved" ? 1 : 0;
      const pendingDelta = status === "pending" ? 1 : 0;
      const rewardCurrencyDelta = approvedDelta ? num(reward.currency) : 0;
      const rewardCreditDelta = approvedDelta ? num(reward.credit) : 0;
      const rewardMissionTokenDelta = approvedDelta ? num(reward.missionToken) : 0;
      const monthActiveDayDelta = isFirstAttemptForDay ? 1 : 0;

      if (needsAttemptDoc) {
        tx.set(attemptDocRef, {
          classId,
          missionId,
          studentUid,
          studentName,
          studentNumber,
          dayKey,
          status,
          autoApproved: !!mission.autoApprove,
          requireSubmissionForm: !!mission.requireSubmissionForm,
          contentHtml: contentHtml || "",
          rewardSnapshot: reward,
          rewardPayoutSnapshot:
            status === "approved"
              ? buildMissionRewardPayoutSnapshot(reward, classData)
              : null,
          submittedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          approvedAt:
            status === "approved" ? FieldValue.serverTimestamp() : null,
          approvedByUid: status === "approved" ? "system_auto" : null,
          approvedByName: status === "approved" ? "system_auto" : null,
          feedback: "",
        });
      }

      tx.set(
        targetDayRef,
        buildMissionDayIncrementPatch({
          classId,
          missionId,
          studentUid,
          studentName,
          studentNumber,
          missionTitle: mission.title,
          dayKey,
          approvedDelta,
          pendingDelta,
          rewardCurrencyDelta,
          rewardCreditDelta,
          rewardMissionTokenDelta,
        }),
        { merge: true },
      );

      tx.set(
        targetMonthRef,
        buildMissionMonthIncrementPatch({
          classId,
          missionId,
          studentUid,
          studentName,
          studentNumber,
          missionTitle: mission.title,
          monthKey,
          approvedDelta,
          pendingDelta,
          activeDayDelta: monthActiveDayDelta,
          rewardCurrencyDelta,
          rewardCreditDelta,
          rewardMissionTokenDelta,
        }),
        { merge: true },
      );

      const missionPatch = {
        ...makeMissionStatsPatch(mission, {
          totalDelta: 1,
          approvedDelta: status === "approved" ? 1 : 0,
          pendingDelta: status === "pending" ? 1 : 0,
        }),
        ["lastAttempts." + studentUid]: {
          attemptId: attemptDocRef?.id || null,
          dayKey,
          status,
          submittedAt: FieldValue.serverTimestamp(),
          approvedAt:
            status === "approved" ? FieldValue.serverTimestamp() : null,
          studentName,
        },
      };
      tx.set(targetMissionRef, missionPatch, { merge: true });

      if (status === "approved") {
        const payoutReward = giveRewardInTx(
          tx,
          classId,
          studentUid,
          reward,
          mission,
          {
            config: globalConfig,
            planType,
            serviceName: "mission",
            issuedByUid: "system_auto",
          },
          classData.currencyUnit || "",
          classData,
        );
        if (attemptDocRef && payoutReward?.taxActivityLogId) {
          tx.set(
            attemptDocRef,
            { rewardPayoutSnapshot: payoutReward },
            { merge: true },
          );
        }
      }

      return {
        success: true,
        status,
        missionId,
        dayKey,
        attemptId: attemptDocRef?.id || null,
        message:
          status === "approved"
            ? MSG_ALWAYS_AUTO_APPROVED
            : MSG_ALWAYS_PENDING_REVIEW,
      };
    });
  },
);

exports.alwaysApproveAttempt = onCall(
  { region: "asia-northeast3", timeoutSeconds: 30 },
  async (request) => {
    const callerUid = request.auth?.uid;
    const callerRole = request.auth?.token?.role;
    const {
      classId,
      missionId,
      studentUid,
      attemptId,
      feedback = "",
      rewardOverride = null,
    } = request.data || {};

    if (!callerUid) {
      throw new HttpsError("unauthenticated", MSG_LOGIN_REQUIRED);
    }
    if (!classId || !missionId || !studentUid || !attemptId) {
      throw new HttpsError(
        "invalid-argument",
        MSG_CLASS_MISSION_STUDENT_ATTEMPT_REQUIRED,
      );
    }

    await ensureTeacherLike(callerUid, callerRole, classId);

    const globalConfig = await getGlobalConfig();

    return db.runTransaction(async (tx) => {
      const targetMissionRef = missionRef(classId, missionId);
      const targetClassRef = classRef(classId);
      const targetAttemptRef = missionAttemptRef(
        classId,
        studentUid,
        missionId,
        attemptId,
      );
      const targetStudentRef = studentRef(classId, studentUid);
      const targetStateRef = missionStateRef(classId, studentUid, missionId);

      const [missionSnap, classSnap, attemptSnap, studentSnap, stateSnap] = await tx.getAll(
        targetMissionRef,
        targetClassRef,
        targetAttemptRef,
        targetStudentRef,
        targetStateRef,
      );

      if (!missionSnap.exists) {
        throw new HttpsError("not-found", MSG_ALWAYS_MISSION_NOT_FOUND);
      }
      if (!attemptSnap.exists) {
        throw new HttpsError("not-found", MSG_ATTEMPT_NOT_FOUND);
      }

      const mission = { id: missionSnap.id, ...missionSnap.data() };
      const classData = classSnap.data() || {};
      const planType = classData.planType || "FREE";
      const attempt = attemptSnap.data() || {};
      const studentData = studentSnap.exists ? studentSnap.data() || {} : null;

      if (!studentData) {
        throw new HttpsError("not-found", "Student data was not found.");
      }

      ensureAlwaysMission(mission);

      try {
        assertMissionEligibility(mission, studentUid, studentData);
      } catch (error) {
        throw new HttpsError(
          "permission-denied",
          error?.message || "This mission is not available for the student.",
        );
      }

      if (attempt.status !== "pending") {
        throw new HttpsError(
          "failed-precondition",
          MSG_PENDING_REQUIRED_FOR_APPROVAL,
        );
      }

      const stateData = stateSnap.exists ? stateSnap.data() : {};
      const stateStats = getStateStats(stateData, stateData?.todayKey);
      let reward;
      try {
        reward = resolveRewardSnapshot(mission, rewardOverride);
      } catch (error) {
        throw new HttpsError(
          "invalid-argument",
          error?.message || "Invalid reward override.",
        );
      }
      const targetDayKey = String(attempt.dayKey || stateData?.todayKey || "").trim();
      const targetMonthKey = monthKeyFromDayKey(targetDayKey);
      const targetDayRef = targetDayKey
        ? missionDayRef(classId, studentUid, missionId, targetDayKey)
        : null;
      const targetMonthRef = targetMonthKey
        ? missionMonthRef(classId, studentUid, missionId, targetMonthKey)
        : null;
      const [daySnap, monthSnap] =
        targetDayRef && targetMonthRef
          ? await tx.getAll(targetDayRef, targetMonthRef)
          : [null, null];
      const dayStats = getDayStats(daySnap?.exists ? daySnap.data() : null);
      const monthStats = getMonthStats(monthSnap?.exists ? monthSnap.data() : null);
      const nextDayAttemptCount = Math.max(1, dayStats.attemptCount);
      const nextMonthAttemptCount = Math.max(1, monthStats.attemptCount);
      const nextMonthActiveDayCount = Math.max(1, monthStats.activeDayCount);
      const rewardCurrencyDelta = num(reward.currency);
      const rewardCreditDelta = num(reward.credit);
      const rewardMissionTokenDelta = num(reward.missionToken);

      tx.update(targetAttemptRef, {
        status: "approved",
        rewardSnapshot: reward,
        rewardPayoutSnapshot: buildMissionRewardPayoutSnapshot(reward, classData),
        approvedAt: FieldValue.serverTimestamp(),
        approvedByUid: callerUid,
        approvedByName: request.auth?.token?.name || "",
        feedback: feedback || "",
      });

      tx.set(
        targetStateRef,
        {
          approvedCount: stateStats.approvedCount + 1,
          pendingCount: Math.max(0, stateStats.pendingCount - 1),
          rewardTotal: {
            currency: stateStats.rewardTotal.currency + num(reward.currency),
            credit: stateStats.rewardTotal.credit + num(reward.credit),
            missionToken:
              stateStats.rewardTotal.missionToken + num(reward.missionToken),
          },
          latestStatus: "approved",
          latestAttemptId: attemptId,
          updatedAt: FieldValue.serverTimestamp(),
          lastApprovedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      if (targetDayRef) {
        tx.set(
          targetDayRef,
          {
            classId,
            missionId,
            studentUid,
            studentName: attempt.studentName || studentData.name || "",
            studentNumber:
              attempt.studentNumber ?? studentData.studentNumber ?? null,
            missionTitle: mission.title || "",
            dayKey: targetDayKey,
            attemptCount: nextDayAttemptCount,
            approvedCount: dayStats.approvedCount + 1,
            pendingCount: Math.max(0, dayStats.pendingCount - 1),
            rewardTotal: {
              currency: dayStats.rewardTotal.currency + rewardCurrencyDelta,
              credit: dayStats.rewardTotal.credit + rewardCreditDelta,
              missionToken:
                dayStats.rewardTotal.missionToken + rewardMissionTokenDelta,
            },
            updatedAt: FieldValue.serverTimestamp(),
            lastAttemptAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      if (targetMonthRef) {
        tx.set(
          targetMonthRef,
          {
            classId,
            missionId,
            studentUid,
            studentName: attempt.studentName || studentData.name || "",
            studentNumber:
              attempt.studentNumber ?? studentData.studentNumber ?? null,
            missionTitle: mission.title || "",
            monthKey: targetMonthKey,
            attemptCount: nextMonthAttemptCount,
            approvedCount: monthStats.approvedCount + 1,
            pendingCount: Math.max(0, monthStats.pendingCount - 1),
            activeDayCount: nextMonthActiveDayCount,
            rewardTotal: {
              currency: monthStats.rewardTotal.currency + rewardCurrencyDelta,
              credit: monthStats.rewardTotal.credit + rewardCreditDelta,
              missionToken:
                monthStats.rewardTotal.missionToken + rewardMissionTokenDelta,
            },
            updatedAt: FieldValue.serverTimestamp(),
            lastAttemptAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      tx.set(
        targetMissionRef,
        {
          ...makeMissionStatsPatch(mission, {
            approvedDelta: 1,
            pendingDelta: -1,
          }),
          ["lastAttempts." + studentUid]: {
            attemptId,
            dayKey: targetDayKey || null,
            status: "approved",
            approvedAt: FieldValue.serverTimestamp(),
            approvedByUid: callerUid,
            studentName: attempt.studentName || "",
          },
        },
        { merge: true },
      );

      const payoutReward = giveRewardInTx(
        tx,
        classId,
        studentUid,
        reward,
        mission,
        {
          config: globalConfig,
          planType,
          serviceName: "mission",
          issuedByUid: callerUid,
        },
        classData.currencyUnit || "",
        classData,
      );
      if (payoutReward?.taxActivityLogId) {
        tx.update(targetAttemptRef, { rewardPayoutSnapshot: payoutReward });
      }

      return {
        success: true,
        message: MSG_ALWAYS_APPROVED,
      };
    });
  },
);

exports.alwaysListAttempts = onCall(
  { region: "asia-northeast3", timeoutSeconds: 30 },
  async (request) => {
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError("unauthenticated", MSG_LOGIN_REQUIRED);
    }

    const {
      classId,
      missionId,
      studentUid: requestedStudentUid = null,
      allStudents = false,
      studentUids = [],
      dateFrom = null,
      dateTo = null,
      limit = 50,
      cursor = null,
      view = "attempts",
    } = request.data || {};

    if (!classId || !missionId) {
      throw new HttpsError("invalid-argument", MSG_CLASS_AND_MISSION_REQUIRED);
    }

    const listView =
      view === "days" || view === "months" ? view : "attempts";
    const requestedStudentUids = Array.isArray(studentUids)
      ? [...new Set(
          studentUids
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        )]
      : [];

    const callerUid = auth.uid;
    const callerRole = auth.token?.role;
    const teacherLike =
      callerRole === "teacher" ||
      callerRole === "admin" ||
      (await hasPermissionCached(callerUid, classId, "mission_admin", permCache));

    let effectiveStudentUid = callerUid;
    if (requestedStudentUid && requestedStudentUid !== callerUid) {
      if (!teacherLike) {
        throw new HttpsError(
          "permission-denied",
          MSG_LIST_OTHER_STUDENT_PERMISSION,
        );
      }
      effectiveStudentUid = requestedStudentUid;
    } else if (requestedStudentUid) {
      effectiveStudentUid = requestedStudentUid;
    }

    const pageSize = Math.max(1, Math.min(num(limit, 50), 500));
    const hasDayRange = Boolean(dateFrom || dateTo);
    const cursorDate = toDateSafe(cursor?.createdAtMs);
    const cursorDayKey =
      typeof cursor?.dayKey === "string" && cursor.dayKey.trim()
        ? cursor.dayKey.trim()
        : null;
    const cursorMonthKey =
      typeof cursor?.monthKey === "string" && cursor.monthKey.trim()
        ? cursor.monthKey.trim()
        : null;

    if (listView === "days") {
      if (allStudents) {
        if (!teacherLike) {
          throw new HttpsError(
            "permission-denied",
            MSG_LIST_ALL_DAYS_PERMISSION,
          );
        }

        if (requestedStudentUids.length === 0) {
          return {
            success: true,
            attempts: [],
            hasMore: false,
            nextCursor: null,
          };
        }

        const days = await fetchTeacherDayDocsByRange({
          classId,
          missionId,
          studentUids: requestedStudentUids,
          dateFrom,
          dateTo,
        });

        return {
          success: true,
          attempts: days,
          hasMore: false,
          nextCursor: null,
        };
      }

      let dayQuery = db.collection(
        `classes/${classId}/students/${effectiveStudentUid}/missionState/${missionId}/days`,
      );
      if (dateFrom) dayQuery = dayQuery.where("dayKey", ">=", dateFrom);
      if (dateTo) dayQuery = dayQuery.where("dayKey", "<=", dateTo);

      dayQuery = dayQuery.orderBy("dayKey", "desc").limit(pageSize);

      if (cursorDayKey) {
        dayQuery = dayQuery.startAfter(cursorDayKey);
      }

      const daySnap = await dayQuery.get();
      const days = daySnap.docs.map(serializeDayDoc);
      const last = days[days.length - 1] || null;

      return {
        success: true,
        attempts: days,
        hasMore: days.length === pageSize,
        nextCursor:
          days.length === pageSize && last?.dayKey
            ? { dayKey: last.dayKey }
            : null,
      };
    }

    if (listView === "months") {
      if (allStudents) {
        if (!teacherLike) {
          throw new HttpsError(
            "permission-denied",
            MSG_LIST_ALL_MONTHS_PERMISSION,
          );
        }

        if (requestedStudentUids.length === 0) {
          return {
            success: true,
            attempts: [],
            hasMore: false,
            nextCursor: null,
          };
        }

        const months = await fetchTeacherMonthDocsByRange({
          classId,
          missionId,
          studentUids: requestedStudentUids,
          dateFrom,
          dateTo,
        });

        return {
          success: true,
          attempts: months,
          hasMore: false,
          nextCursor: null,
        };
      }

      let monthQuery = db.collection(
        `classes/${classId}/students/${effectiveStudentUid}/missionState/${missionId}/months`,
      );
      const monthFrom = dateFrom ? monthKeyFromDayKey(dateFrom) : "";
      const monthTo = dateTo ? monthKeyFromDayKey(dateTo) : "";
      if (monthFrom) monthQuery = monthQuery.where("monthKey", ">=", monthFrom);
      if (monthTo) monthQuery = monthQuery.where("monthKey", "<=", monthTo);

      monthQuery = monthQuery.orderBy("monthKey", "desc").limit(pageSize);

      if (cursorMonthKey) {
        monthQuery = monthQuery.startAfter(cursorMonthKey);
      }

      const monthSnap = await monthQuery.get();
      const months = monthSnap.docs.map(serializeMonthDoc);
      const last = months[months.length - 1] || null;

      return {
        success: true,
        attempts: months,
        hasMore: months.length === pageSize,
        nextCursor:
          months.length === pageSize && last?.monthKey
            ? { monthKey: last.monthKey }
            : null,
      };
    }

    let baseQueryRef;
    if (allStudents && teacherLike) {
      baseQueryRef = db
        .collectionGroup("attempts")
        .where("classId", "==", classId)
        .where("missionId", "==", missionId);
    } else {
      baseQueryRef = missionAttemptsCol(classId, effectiveStudentUid, missionId);
    }

    let queryRef = baseQueryRef;
    if (dateFrom) queryRef = queryRef.where("dayKey", ">=", dateFrom);
    if (dateTo) queryRef = queryRef.where("dayKey", "<=", dateTo);

    if (hasDayRange) {
      queryRef = queryRef
        .orderBy("dayKey", "desc")
        .orderBy("createdAt", "desc")
        .limit(pageSize);

      if (cursorDayKey && cursorDate) {
        queryRef = queryRef.startAfter(cursorDayKey, cursorDate);
      }
    } else {
      queryRef = queryRef.orderBy("createdAt", "desc").limit(pageSize);
      if (cursorDate) {
        queryRef = queryRef.startAfter(cursorDate);
      }
    }

    let snap;
    try {
      snap = await queryRef.get();
    } catch (error) {
      const message = String(error?.message || "");
      if (hasDayRange && isIndexErrorMessage(message)) {
        return fetchAttemptsByDayRangeFallback({
          baseQueryRef,
          pageSize,
          cursorDate,
          dateFrom,
          dateTo,
        });
      }
      if (message) {
        if (isIndexErrorMessage(message)) {
          throw new HttpsError("failed-precondition", message);
        }
        if (
          message.includes("inequality filter property and first sort order") ||
          message.includes("INVALID_ARGUMENT")
        ) {
          throw new HttpsError("invalid-argument", message);
        }
      }
      throw error;
    }
    const attempts = snap.docs.map(serializeAttemptDoc);

    const last = attempts[attempts.length - 1] || null;

    return {
      success: true,
      attempts,
      hasMore: attempts.length === pageSize,
      nextCursor:
        attempts.length === pageSize && last?.createdAtMs
          ? hasDayRange
            ? { dayKey: last.dayKey || null, createdAtMs: last.createdAtMs }
            : { createdAtMs: last.createdAtMs }
          : null,
    };
  },
);

exports.alwaysApproveAttemptBatch = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60 },
  async (request) => {
    const callerUid = request.auth?.uid;
    const callerRole = request.auth?.token?.role;
    const { classId, missionId, items = [] } = request.data || {};

    if (!callerUid) {
      throw new HttpsError("unauthenticated", MSG_LOGIN_REQUIRED);
    }
    if (!classId || !missionId || !Array.isArray(items)) {
      throw new HttpsError("invalid-argument", MSG_CLASS_MISSION_ITEMS_REQUIRED);
    }

    await ensureTeacherLike(callerUid, callerRole, classId);

    if (items.length === 0) {
      return {
        success: true,
        message: MSG_APPROVE_EMPTY,
        results: { success: [], failed: [] },
      };
    }

    const globalConfig = await getGlobalConfig();
    const results = { success: [], failed: [] };

    await db.runTransaction(async (tx) => {
      const [missionSnap, classSnap] = await tx.getAll(
        missionRef(classId, missionId),
        classRef(classId),
      );

      if (!missionSnap.exists) {
        throw new HttpsError("not-found", MSG_ALWAYS_MISSION_NOT_FOUND);
      }

      const mission = { id: missionSnap.id, ...missionSnap.data() };
      const classData = classSnap.data() || {};
      const planType = classData.planType || "FREE";
      ensureAlwaysMission(mission);
      const targetMissionRef = missionRef(classId, missionId);
      const missionStats = getMissionStats(mission);
      const stateCache = new Map();
      const preparedItems = [];
      const attemptRefs = [];
      const studentRefsByUid = new Map();
      const stateRefsByUid = new Map();

      for (const item of items) {
        const {
          studentUid,
          attemptId,
          feedback = "",
          rewardOverride = null,
        } = item || {};
        if (!studentUid || !attemptId) {
          results.failed.push({ ...item, error: MSG_STUDENT_AND_ATTEMPT_REQUIRED });
          continue;
        }

        const targetAttemptRef = missionAttemptRef(
          classId,
          studentUid,
          missionId,
          attemptId,
        );
        const targetStudentRef =
          studentRefsByUid.get(studentUid) || studentRef(classId, studentUid);
        const targetStateRef =
          stateRefsByUid.get(studentUid) ||
          missionStateRef(classId, studentUid, missionId);

        studentRefsByUid.set(studentUid, targetStudentRef);
        stateRefsByUid.set(studentUid, targetStateRef);
        attemptRefs.push(targetAttemptRef);
        preparedItems.push({
          item,
          studentUid,
          attemptId,
          feedback,
          rewardOverride,
          targetAttemptRef,
          targetStudentRef,
          targetStateRef,
        });
      }

      const attemptSnaps = attemptRefs.length ? await tx.getAll(...attemptRefs) : [];
      const studentRefList = Array.from(studentRefsByUid.values());
      const studentSnaps = studentRefList.length
        ? await tx.getAll(...studentRefList)
        : [];
      const stateRefList = Array.from(stateRefsByUid.values());
      const stateSnaps = stateRefList.length ? await tx.getAll(...stateRefList) : [];

      const attemptSnapMap = new Map(
        attemptRefs.map((ref, index) => [ref.path, attemptSnaps[index]]),
      );
      const studentSnapMap = new Map(
        studentRefList.map((ref, index) => [ref.path, studentSnaps[index]]),
      );
      const stateSnapMap = new Map(
        stateRefList.map((ref, index) => [ref.path, stateSnaps[index]]),
      );
      const summaryRefsByPath = new Map();
      const readyItems = [];

      for (const preparedItem of preparedItems) {
        const {
          item,
          studentUid,
          attemptId,
          feedback,
          rewardOverride,
          targetAttemptRef,
          targetStudentRef,
          targetStateRef,
        } = preparedItem;
        const attemptSnap = attemptSnapMap.get(targetAttemptRef.path);
        const studentSnap = studentSnapMap.get(targetStudentRef.path);
        const stateSnap = stateSnapMap.get(targetStateRef.path);

        if (!attemptSnap.exists) {
          results.failed.push({ ...item, error: MSG_ATTEMPT_NOT_FOUND });
          continue;
        }

        if (!studentSnap.exists) {
          results.failed.push({ ...item, error: "Student data was not found." });
          continue;
        }

        const attempt = attemptSnap.data() || {};
        const studentData = studentSnap.data() || {};
        try {
          assertMissionEligibility(mission, studentUid, studentData);
        } catch (error) {
          results.failed.push({
            ...item,
            error: error?.message || "This mission is not available for the student.",
          });
          continue;
        }
        if (attempt.status !== "pending") {
          results.failed.push({
            ...item,
            error: MSG_PENDING_REQUIRED_FOR_APPROVAL,
          });
          continue;
        }

        const stateEntry =
          stateCache.get(studentUid) ||
          (() => {
            const stateData = stateSnap.exists ? stateSnap.data() : {};
            const entry = {
              todayKey: stateData?.todayKey || null,
              stats: getStateStats(stateData, stateData?.todayKey),
            };
            stateCache.set(studentUid, entry);
            return entry;
          })();
        let reward;
        try {
          reward = resolveRewardSnapshot(mission, rewardOverride);
        } catch (error) {
          results.failed.push({
            ...item,
            error: error?.message || "Invalid reward override.",
          });
          continue;
        }

        const targetDayKey = String(
          attempt.dayKey || stateEntry.todayKey || "",
        ).trim();
        const targetMonthKey = monthKeyFromDayKey(targetDayKey);
        const targetDayRef = targetDayKey
          ? missionDayRef(classId, studentUid, missionId, targetDayKey)
          : null;
        const targetMonthRef = targetMonthKey
          ? missionMonthRef(classId, studentUid, missionId, targetMonthKey)
          : null;

        if (targetDayRef) summaryRefsByPath.set(targetDayRef.path, targetDayRef);
        if (targetMonthRef) summaryRefsByPath.set(targetMonthRef.path, targetMonthRef);

        readyItems.push({
          studentUid,
          attemptId,
          feedback,
          reward,
          attempt,
          studentData,
          stateEntry,
          targetAttemptRef,
          targetStateRef,
          targetDayKey,
          targetMonthKey,
          targetDayRef,
          targetMonthRef,
        });
        continue;

        stateEntry.stats.approvedCount += 1;
        stateEntry.stats.pendingCount = Math.max(
          0,
          stateEntry.stats.pendingCount - 1,
        );
        stateEntry.stats.rewardTotal = {
          currency:
            stateEntry.stats.rewardTotal.currency + num(reward.currency),
          credit: stateEntry.stats.rewardTotal.credit + num(reward.credit),
          missionToken:
            stateEntry.stats.rewardTotal.missionToken +
            num(reward.missionToken),
        };

        tx.update(targetAttemptRef, {
          status: "approved",
          rewardSnapshot: reward,
          rewardPayoutSnapshot: buildMissionRewardPayoutSnapshot(reward, classData),
          approvedAt: FieldValue.serverTimestamp(),
          approvedByUid: callerUid,
          approvedByName: request.auth?.token?.name || "",
          feedback: feedback || "",
        });

        tx.set(
          targetStateRef,
          {
            approvedCount: stateEntry.stats.approvedCount,
            pendingCount: stateEntry.stats.pendingCount,
            rewardTotal: stateEntry.stats.rewardTotal,
            latestStatus: "approved",
            latestAttemptId: attemptId,
            updatedAt: FieldValue.serverTimestamp(),
            lastApprovedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        missionStats.approvedCount += 1;
        missionStats.pendingCount = Math.max(0, missionStats.pendingCount - 1);

        tx.set(
          targetMissionRef,
          {
            ...makeMissionStatsValuePatch(missionStats),
            updatedAt: FieldValue.serverTimestamp(),
            ["lastAttempts." + studentUid]: {
              attemptId,
              dayKey: attempt.dayKey || null,
              status: "approved",
              approvedAt: FieldValue.serverTimestamp(),
              approvedByUid: callerUid,
              studentName: attempt.studentName || "",
            },
          },
          { merge: true },
        );

        const payoutReward = giveRewardInTx(
          tx,
          classId,
          studentUid,
          reward,
          mission,
          {
            config: globalConfig,
            planType,
            serviceName: "mission",
            issuedByUid: callerUid,
          },
          classData.currencyUnit || "",
          classData,
        );
        if (payoutReward?.taxActivityLogId) {
          tx.update(targetAttemptRef, { rewardPayoutSnapshot: payoutReward });
        }

        results.success.push({ studentUid, attemptId });
      }

      const summaryRefs = Array.from(summaryRefsByPath.values());
      const summarySnaps = summaryRefs.length ? await tx.getAll(...summaryRefs) : [];
      const summarySnapMap = new Map(
        summaryRefs.map((ref, index) => [ref.path, summarySnaps[index]]),
      );
      const daySummaryCache = new Map();
      const monthSummaryCache = new Map();

      for (const readyItem of readyItems) {
        const {
          studentUid,
          attemptId,
          feedback,
          reward,
          attempt,
          studentData,
          stateEntry,
          targetAttemptRef,
          targetStateRef,
          targetDayKey,
          targetMonthKey,
          targetDayRef,
          targetMonthRef,
        } = readyItem;
        const dayCacheKey = targetDayKey ? studentUid + "::" + targetDayKey : null;
        const monthCacheKey = targetMonthKey ? studentUid + "::" + targetMonthKey : null;
        let dayStats = null;
        let monthStats = null;

        if (targetDayRef && dayCacheKey) {
          dayStats = daySummaryCache.get(dayCacheKey);
          if (!dayStats) {
            const daySnap = summarySnapMap.get(targetDayRef.path);
            dayStats = getDayStats(daySnap?.exists ? daySnap.data() : null);
            daySummaryCache.set(dayCacheKey, dayStats);
          }
        }
        if (targetMonthRef && monthCacheKey) {
          monthStats = monthSummaryCache.get(monthCacheKey);
          if (!monthStats) {
            const monthSnap = summarySnapMap.get(targetMonthRef.path);
            monthStats = getMonthStats(monthSnap?.exists ? monthSnap.data() : null);
            monthSummaryCache.set(monthCacheKey, monthStats);
          }
        }

        const nextDayAttemptCount = dayStats
          ? Math.max(1, dayStats.attemptCount)
          : 0;
        const nextMonthAttemptCount = monthStats
          ? Math.max(1, monthStats.attemptCount)
          : 0;
        const nextMonthActiveDayCount = monthStats
          ? Math.max(1, monthStats.activeDayCount)
          : 0;
        const rewardCurrencyDelta = num(reward.currency);
        const rewardCreditDelta = num(reward.credit);
        const rewardMissionTokenDelta = num(reward.missionToken);

        stateEntry.stats.approvedCount += 1;
        stateEntry.stats.pendingCount = Math.max(
          0,
          stateEntry.stats.pendingCount - 1,
        );
        stateEntry.stats.rewardTotal = {
          currency:
            stateEntry.stats.rewardTotal.currency + rewardCurrencyDelta,
          credit: stateEntry.stats.rewardTotal.credit + rewardCreditDelta,
          missionToken:
            stateEntry.stats.rewardTotal.missionToken +
            rewardMissionTokenDelta,
        };

        tx.update(targetAttemptRef, {
          status: "approved",
          rewardSnapshot: reward,
          rewardPayoutSnapshot: buildMissionRewardPayoutSnapshot(reward, classData),
          approvedAt: FieldValue.serverTimestamp(),
          approvedByUid: callerUid,
          approvedByName: request.auth?.token?.name || "",
          feedback: feedback || "",
        });

        tx.set(
          targetStateRef,
          {
            approvedCount: stateEntry.stats.approvedCount,
            pendingCount: stateEntry.stats.pendingCount,
            rewardTotal: stateEntry.stats.rewardTotal,
            latestStatus: "approved",
            latestAttemptId: attemptId,
            updatedAt: FieldValue.serverTimestamp(),
            lastApprovedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        if (targetDayRef && dayStats) {
          dayStats.attemptCount = nextDayAttemptCount;
          dayStats.approvedCount += 1;
          dayStats.pendingCount = Math.max(0, dayStats.pendingCount - 1);
          dayStats.rewardTotal = {
            currency: dayStats.rewardTotal.currency + rewardCurrencyDelta,
            credit: dayStats.rewardTotal.credit + rewardCreditDelta,
            missionToken:
              dayStats.rewardTotal.missionToken + rewardMissionTokenDelta,
          };

          tx.set(
            targetDayRef,
            {
              classId,
              missionId,
              studentUid,
              studentName: attempt.studentName || studentData.name || "",
              studentNumber:
                attempt.studentNumber ?? studentData.studentNumber ?? null,
              missionTitle: mission.title || "",
              dayKey: targetDayKey,
              attemptCount: dayStats.attemptCount,
              approvedCount: dayStats.approvedCount,
              pendingCount: dayStats.pendingCount,
              rewardTotal: dayStats.rewardTotal,
              updatedAt: FieldValue.serverTimestamp(),
              lastAttemptAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }

        if (targetMonthRef && monthStats) {
          monthStats.attemptCount = nextMonthAttemptCount;
          monthStats.activeDayCount = nextMonthActiveDayCount;
          monthStats.approvedCount += 1;
          monthStats.pendingCount = Math.max(0, monthStats.pendingCount - 1);
          monthStats.rewardTotal = {
            currency: monthStats.rewardTotal.currency + rewardCurrencyDelta,
            credit: monthStats.rewardTotal.credit + rewardCreditDelta,
            missionToken:
              monthStats.rewardTotal.missionToken + rewardMissionTokenDelta,
          };

          tx.set(
            targetMonthRef,
            {
              classId,
              missionId,
              studentUid,
              studentName: attempt.studentName || studentData.name || "",
              studentNumber:
                attempt.studentNumber ?? studentData.studentNumber ?? null,
              missionTitle: mission.title || "",
              monthKey: targetMonthKey,
              attemptCount: monthStats.attemptCount,
              approvedCount: monthStats.approvedCount,
              pendingCount: monthStats.pendingCount,
              activeDayCount: monthStats.activeDayCount,
              rewardTotal: monthStats.rewardTotal,
              updatedAt: FieldValue.serverTimestamp(),
              lastAttemptAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }

        missionStats.approvedCount += 1;
        missionStats.pendingCount = Math.max(0, missionStats.pendingCount - 1);

        tx.set(
          targetMissionRef,
          {
            ...makeMissionStatsValuePatch(missionStats),
            updatedAt: FieldValue.serverTimestamp(),
            ["lastAttempts." + studentUid]: {
              attemptId,
              dayKey: targetDayKey || null,
              status: "approved",
              approvedAt: FieldValue.serverTimestamp(),
              approvedByUid: callerUid,
              studentName: attempt.studentName || "",
            },
          },
          { merge: true },
        );

        const payoutReward = giveRewardInTx(
          tx,
          classId,
          studentUid,
          reward,
          mission,
          {
            config: globalConfig,
            planType,
            serviceName: "mission",
            issuedByUid: callerUid,
          },
          classData.currencyUnit || "",
          classData,
        );
        if (payoutReward?.taxActivityLogId) {
          tx.update(targetAttemptRef, { rewardPayoutSnapshot: payoutReward });
        }

        results.success.push({ studentUid, attemptId });
      }

    });

    return {
      success: true,
      message: String(results.success.length) + " attempts approved.",
      results,
    };
  },
);

exports.alwaysRejectAttemptBatch = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60 },
  async (request) => {
    const callerUid = request.auth?.uid;
    const callerRole = request.auth?.token?.role;
    const { classId, missionId, items = [] } = request.data || {};

    if (!callerUid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }
    if (!classId || !missionId || !Array.isArray(items)) {
      throw new HttpsError(
        "invalid-argument",
        "classId, missionId, and items are required.",
      );
    }
    if (items.length === 0) {
      return {
        success: true,
        message: "No attempts to reject.",
        results: { success: [], failed: [] },
      };
    }
    if (items.length > 50) {
      throw new HttpsError(
        "invalid-argument",
        "You can reject up to 50 attempts at a time.",
      );
    }

    await ensureTeacherLike(callerUid, callerRole, classId);

    const results = { success: [], failed: [] };

    await db.runTransaction(async (tx) => {
      const missionSnap = await tx.get(missionRef(classId, missionId));

      if (!missionSnap.exists) {
        throw new HttpsError("not-found", "Mission not found.");
      }

      const mission = { id: missionSnap.id, ...missionSnap.data() };
      ensureAlwaysMission(mission);

      const targetMissionRef = missionRef(classId, missionId);
      const missionStats = getMissionStats(mission);
      const stateCache = new Map();
      const preparedItems = [];
      const attemptRefs = [];
      const stateRefsByUid = new Map();

      for (const item of items) {
        const { studentUid, attemptId, reason = "" } = item || {};
        if (!studentUid || !attemptId) {
          results.failed.push({
            ...item,
            error: "studentUid and attemptId are required.",
          });
          continue;
        }

        const targetAttemptRef = missionAttemptRef(
          classId,
          studentUid,
          missionId,
          attemptId,
        );
        const targetStateRef =
          stateRefsByUid.get(studentUid) ||
          missionStateRef(classId, studentUid, missionId);

        stateRefsByUid.set(studentUid, targetStateRef);
        attemptRefs.push(targetAttemptRef);
        preparedItems.push({
          item,
          studentUid,
          attemptId,
          reason,
          targetAttemptRef,
          targetStateRef,
        });
      }

      const attemptSnaps = attemptRefs.length ? await tx.getAll(...attemptRefs) : [];
      const stateRefList = Array.from(stateRefsByUid.values());
      const stateSnaps = stateRefList.length ? await tx.getAll(...stateRefList) : [];

      const attemptSnapMap = new Map(
        attemptRefs.map((ref, index) => [ref.path, attemptSnaps[index]]),
      );
      const stateSnapMap = new Map(
        stateRefList.map((ref, index) => [ref.path, stateSnaps[index]]),
      );
      for (const preparedItem of preparedItems) {
        const {
          item,
          studentUid,
          attemptId,
          reason,
          targetAttemptRef,
          targetStateRef,
        } = preparedItem;
        const attemptSnap = attemptSnapMap.get(targetAttemptRef.path);
        const stateSnap = stateSnapMap.get(targetStateRef.path);

        if (!attemptSnap.exists) {
          results.failed.push({ ...item, error: "Attempt record was not found." });
          continue;
        }

        const attempt = attemptSnap.data() || {};
        if (attempt.status !== "pending") {
          results.failed.push({
            ...item,
            error: "Only pending attempts can be rejected.",
          });
          continue;
        }

        const stateEntry =
          stateCache.get(studentUid) ||
          (() => {
            const stateData = stateSnap.exists ? stateSnap.data() : {};
            const entry = {
              todayKey: stateData?.todayKey || null,
              stats: getStateStats(stateData, stateData?.todayKey),
            };
            stateCache.set(studentUid, entry);
            return entry;
          })();
        const targetDayKey = attempt.dayKey || stateEntry.todayKey || null;

        stateEntry.stats.totalCount = Math.max(0, stateEntry.stats.totalCount - 1);
        stateEntry.stats.pendingCount = Math.max(
          0,
          stateEntry.stats.pendingCount - 1,
        );

        const statePatch = {
          totalCount: stateEntry.stats.totalCount,
          approvedCount: stateEntry.stats.approvedCount,
          pendingCount: stateEntry.stats.pendingCount,
          rewardTotal: stateEntry.stats.rewardTotal,
          latestStatus: "rejected",
          latestAttemptId: attemptId,
          updatedAt: FieldValue.serverTimestamp(),
          lastRejectedAt: FieldValue.serverTimestamp(),
        };

        if (stateEntry.todayKey === targetDayKey) {
          stateEntry.stats.todayCount = Math.max(0, stateEntry.stats.todayCount - 1);
          statePatch.todayCount = stateEntry.stats.todayCount;
        }

        tx.update(targetAttemptRef, {
          status: "rejected",
          rejectedAt: FieldValue.serverTimestamp(),
          rejectedByUid: callerUid,
          rejectedByName: request.auth?.token?.name || "",
          rejectReason: String(reason || "").trim() || null,
        });

        tx.set(targetStateRef, statePatch, { merge: true });

        missionStats.totalCount = Math.max(0, missionStats.totalCount - 1);
        missionStats.pendingCount = Math.max(0, missionStats.pendingCount - 1);

        const missionPatch = {
          ...makeMissionStatsValuePatch(missionStats),
          updatedAt: FieldValue.serverTimestamp(),
        };
        missionPatch["lastAttempts." + studentUid] = {
          attemptId,
          dayKey: attempt.dayKey || null,
          status: "rejected",
          rejectedAt: FieldValue.serverTimestamp(),
          rejectedByUid: callerUid,
          studentName: attempt.studentName || "",
        };

        tx.set(targetMissionRef, missionPatch, { merge: true });

        results.success.push({ studentUid, attemptId });
      }
    });

    return {
      success: true,
      message: String(results.success.length) + " attempts rejected.",
      results,
    };
  },
);

exports.alwaysBackfillMissionSummaries = onCall(
  { region: "asia-northeast3", timeoutSeconds: 300 },
  async (request) => {
    const callerUid = request.auth?.uid;
    const callerRole = request.auth?.token?.role;
    const data = request.data || {};
    const classId = String(data.classId || "").trim();
    const missionId = String(data.missionId || "").trim();
    const rawStudentUids = data.studentUids;
    const requestedDateFrom = String(data.dateFrom || "").trim();
    const requestedDateTo = String(data.dateTo || "").trim();
    const dryRun = data.dryRun === true;
    const clearExisting = data.clearExisting !== false;

    if (!callerUid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }
    if (!classId || !missionId) {
      throw new HttpsError(
        "invalid-argument",
        "classId and missionId are required.",
      );
    }
    if (rawStudentUids !== undefined && !Array.isArray(rawStudentUids)) {
      throw new HttpsError(
        "invalid-argument",
        "studentUids must be an array when provided.",
      );
    }
    if (requestedDateFrom && !isValidDayKey(requestedDateFrom)) {
      throw new HttpsError(
        "invalid-argument",
        "dateFrom must be in YYYY-MM-DD format.",
      );
    }
    if (requestedDateTo && !isValidDayKey(requestedDateTo)) {
      throw new HttpsError(
        "invalid-argument",
        "dateTo must be in YYYY-MM-DD format.",
      );
    }
    if (requestedDateFrom && requestedDateTo && requestedDateTo < requestedDateFrom) {
      throw new HttpsError(
        "invalid-argument",
        "dateTo must be the same as or later than dateFrom.",
      );
    }

    await ensureTeacherLike(callerUid, callerRole, classId);

    const [missionSnap, studentsSnap] = await Promise.all([
      missionRef(classId, missionId).get(),
      rawStudentUids && rawStudentUids.length > 0
        ? Promise.resolve(null)
        : db.collection(`classes/${classId}/students`).get(),
    ]);

    if (!missionSnap.exists) {
      throw new HttpsError("not-found", "Mission not found.");
    }

    const mission = { id: missionSnap.id, ...missionSnap.data() };
    ensureAlwaysMission(mission);

    const targetStudentUids = Array.from(
      new Set(
        (Array.isArray(rawStudentUids) && rawStudentUids.length > 0
          ? rawStudentUids
          : studentsSnap?.docs.map((docSnap) => docSnap.id) || []
        )
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    );

    if (targetStudentUids.length === 0) {
      return {
        success: true,
        classId,
        missionId,
        studentCount: 0,
        attemptDocCount: 0,
        activeAttemptCount: 0,
        rebuiltDayDocCount: 0,
        rebuiltMonthDocCount: 0,
        deletedDayDocCount: 0,
        deletedMonthDocCount: 0,
        includeMonths: !requestedDateFrom && !requestedDateTo,
        dryRun,
        clearExisting,
        message: "No target students found.",
      };
    }

    const dateFrom = requestedDateFrom || "";
    const dateTo = requestedDateTo || "";
    const includeMonths = !dateFrom && !dateTo;
    const studentUidSet = new Set(targetStudentUids);
    const attemptSnapshots = await Promise.all(
      targetStudentUids.map(async (studentUid) => ({
        studentUid,
        snap: await missionAttemptsCol(classId, studentUid, missionId).get(),
      })),
    );

    const attempts = [];

    attemptSnapshots.forEach(({ studentUid, snap }) => {
      snap.docs.forEach((docSnap) => {
        const attempt = serializeAttemptDoc(docSnap);
        const fallbackDayKey = (() => {
          const fallbackDate =
            toDateSafe(attempt.createdAt) ||
            toDateSafe(attempt.submittedAt) ||
            (attempt.createdAtMs ? new Date(attempt.createdAtMs) : null);
          return fallbackDate
            ? dayjs(fallbackDate).tz(KST).format("YYYY-MM-DD")
            : "";
        })();
        const resolvedDayKey = String(attempt.dayKey || fallbackDayKey || "").trim();

        if (!resolvedDayKey || !isWithinDayRange(resolvedDayKey, dateFrom, dateTo)) {
          return;
        }

        attempts.push({
          ...attempt,
          classId: attempt.classId || classId,
          missionId: attempt.missionId || missionId,
          studentUid: String(attempt.studentUid || studentUid || "").trim(),
          studentName: attempt.studentName || "",
          studentNumber:
            attempt.studentNumber === undefined ? null : attempt.studentNumber,
          dayKey: resolvedDayKey,
        });
      });
    });

    const { dayEntries, monthEntries, activeAttemptCount } = buildBackfillSummaryMaps({
      attempts,
      mission,
      includeMonths,
    });

    const existingDayDocs = clearExisting
      ? await listExistingMissionSummaryDocs({
          summaryKind: "days",
          classId,
          missionId,
          studentUidSet,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
        })
      : [];
    const existingMonthDocs = clearExisting && includeMonths
      ? await listExistingMissionSummaryDocs({
          summaryKind: "months",
          classId,
          missionId,
          studentUidSet,
          dateFrom: null,
          dateTo: null,
        })
      : [];

    if (dryRun) {
      return {
        success: true,
        classId,
        missionId,
        studentCount: targetStudentUids.length,
        attemptDocCount: attempts.length,
        activeAttemptCount,
        rebuiltDayDocCount: dayEntries.length,
        rebuiltMonthDocCount: includeMonths ? monthEntries.length : 0,
        deletedDayDocCount: existingDayDocs.length,
        deletedMonthDocCount: existingMonthDocs.length,
        includeMonths,
        dryRun: true,
        clearExisting,
        message: "Mission summaries dry run completed.",
      };
    }

    const writeOps = [];

    existingDayDocs.forEach((docSnap) => {
      writeOps.push({ type: "delete", ref: docSnap.ref });
    });
    existingMonthDocs.forEach((docSnap) => {
      writeOps.push({ type: "delete", ref: docSnap.ref });
    });

    dayEntries.forEach((entry) => {
      writeOps.push({
        type: "set",
        ref: missionDayRef(classId, entry.studentUid, missionId, entry.dayKey),
        data: {
          classId,
          missionId,
          studentUid: entry.studentUid,
          studentName: entry.studentName || "",
          studentNumber:
            entry.studentNumber === undefined ? null : entry.studentNumber,
          missionTitle: mission.title || "",
          dayKey: entry.dayKey,
          attemptCount: entry.attemptCount,
          approvedCount: entry.approvedCount,
          pendingCount: entry.pendingCount,
          rewardTotal: entry.rewardTotal,
          updatedAt: FieldValue.serverTimestamp(),
          lastAttemptAt:
            entry.lastAttemptAtMs > 0
              ? admin.firestore.Timestamp.fromMillis(entry.lastAttemptAtMs)
              : FieldValue.serverTimestamp(),
        },
      });
    });

    if (includeMonths) {
      monthEntries.forEach((entry) => {
        writeOps.push({
          type: "set",
          ref: missionMonthRef(classId, entry.studentUid, missionId, entry.monthKey),
          data: {
            classId,
            missionId,
            studentUid: entry.studentUid,
            studentName: entry.studentName || "",
            studentNumber:
              entry.studentNumber === undefined ? null : entry.studentNumber,
            missionTitle: mission.title || "",
            monthKey: entry.monthKey,
            attemptCount: entry.attemptCount,
            approvedCount: entry.approvedCount,
            pendingCount: entry.pendingCount,
            activeDayCount: entry.activeDayCount,
            rewardTotal: entry.rewardTotal,
            updatedAt: FieldValue.serverTimestamp(),
            lastAttemptAt:
              entry.lastAttemptAtMs > 0
                ? admin.firestore.Timestamp.fromMillis(entry.lastAttemptAtMs)
                : FieldValue.serverTimestamp(),
          },
        });
      });
    }

    await commitWriteOps(writeOps);

    return {
      success: true,
      classId,
      missionId,
      studentCount: targetStudentUids.length,
      attemptDocCount: attempts.length,
      activeAttemptCount,
      rebuiltDayDocCount: dayEntries.length,
      rebuiltMonthDocCount: includeMonths ? monthEntries.length : 0,
      deletedDayDocCount: existingDayDocs.length,
      deletedMonthDocCount: existingMonthDocs.length,
      includeMonths,
      dryRun: false,
      clearExisting,
      message: "Mission summaries backfill completed.",
    };
  },
);

exports.alwaysCancelAttemptBatch = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60 },
  async (request) => {
    const callerUid = request.auth?.uid;
    const callerRole = request.auth?.token?.role;
    const { classId, missionId, items = [] } = request.data || {};

    if (!callerUid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }
    if (!classId || !missionId || !Array.isArray(items)) {
      throw new HttpsError(
        "invalid-argument",
        "classId, missionId, and items are required.",
      );
    }
    if (items.length === 0) {
      throw new HttpsError("invalid-argument", "At least one attempt is required.");
    }
    if (items.length > 50) {
      throw new HttpsError(
        "invalid-argument",
        "You can cancel up to 50 attempts at once.",
      );
    }

    await ensureTeacherLike(callerUid, callerRole, classId);

    const globalConfig = await getGlobalConfig();
    const results = { success: [], failed: [] };

    await db.runTransaction(async (tx) => {
      const [missionSnap, classSnap] = await tx.getAll(
        missionRef(classId, missionId),
        classRef(classId),
      );

      if (!missionSnap.exists) {
        throw new HttpsError("not-found", "Mission not found.");
      }

      const mission = { id: missionSnap.id, ...missionSnap.data() };
      const classData = classSnap.data() || {};
      const planType = classData.planType || "FREE";
      ensureAlwaysMission(mission);
      const targetMissionRef = missionRef(classId, missionId);
      const missionStats = getMissionStats(mission);
      const stateCache = new Map();
      const preparedItems = [];
      const attemptRefs = [];
      const stateRefsByUid = new Map();

      for (const item of items) {
        const { studentUid, attemptId } = item || {};
        if (!studentUid || !attemptId) {
          results.failed.push({
            ...item,
            error: "studentUid and attemptId are required.",
          });
          continue;
        }

        const targetAttemptRef = missionAttemptRef(
          classId,
          studentUid,
          missionId,
          attemptId,
        );
        const targetStateRef =
          stateRefsByUid.get(studentUid) ||
          missionStateRef(classId, studentUid, missionId);
        stateRefsByUid.set(studentUid, targetStateRef);
        attemptRefs.push(targetAttemptRef);
        preparedItems.push({
          item,
          studentUid,
          attemptId,
          targetAttemptRef,
          targetStateRef,
        });
      }

      const attemptSnaps = attemptRefs.length ? await tx.getAll(...attemptRefs) : [];
      const stateRefList = Array.from(stateRefsByUid.values());
      const stateSnaps = stateRefList.length ? await tx.getAll(...stateRefList) : [];

      const attemptSnapMap = new Map(
        attemptRefs.map((ref, index) => [ref.path, attemptSnaps[index]]),
      );
      const stateSnapMap = new Map(
        stateRefList.map((ref, index) => [ref.path, stateSnaps[index]]),
      );
      const summaryRefsByPath = new Map();
      const readyItems = [];

      for (const preparedItem of preparedItems) {
        const { item, studentUid, attemptId, targetAttemptRef, targetStateRef } =
          preparedItem;
        const attemptSnap = attemptSnapMap.get(targetAttemptRef.path);
        const stateSnap = stateSnapMap.get(targetStateRef.path);

        if (!attemptSnap.exists) {
          results.failed.push({ ...item, error: "Attempt record was not found." });
          continue;
        }

        const attempt = attemptSnap.data() || {};
        if (attempt.status !== "approved") {
          results.failed.push({
            ...item,
            error: "Only approved attempts can be canceled.",
          });
          continue;
        }

        const stateEntry =
          stateCache.get(studentUid) ||
          (() => {
            const stateData = stateSnap.exists ? stateSnap.data() : {};
            const entry = {
              todayKey: stateData?.todayKey || null,
              stats: getStateStats(stateData, stateData?.todayKey),
            };
            stateCache.set(studentUid, entry);
            return entry;
          })();
        const reward =
          attempt.rewardPayoutSnapshot ||
          attempt.rewardSnapshot ||
          extractRewardsSafe(mission);
        const targetDayKey = String(
          attempt.dayKey || stateEntry.todayKey || "",
        ).trim();
        const targetMonthKey = monthKeyFromDayKey(targetDayKey);
        const targetDayRef = targetDayKey
          ? missionDayRef(classId, studentUid, missionId, targetDayKey)
          : null;
        const targetMonthRef = targetMonthKey
          ? missionMonthRef(classId, studentUid, missionId, targetMonthKey)
          : null;

        if (targetDayRef) summaryRefsByPath.set(targetDayRef.path, targetDayRef);
        if (targetMonthRef) summaryRefsByPath.set(targetMonthRef.path, targetMonthRef);

        readyItems.push({
          studentUid,
          attemptId,
          attempt,
          reward,
          stateEntry,
          targetAttemptRef,
          targetStateRef,
          targetDayKey,
          targetMonthKey,
          targetDayRef,
          targetMonthRef,
        });
      }

      const summaryRefs = Array.from(summaryRefsByPath.values());
      const taxActivityLogRefs = readyItems
        .map(({ studentUid, reward }) => {
          const taxActivityLogId = reward?.taxActivityLogId;
          return taxActivityLogId
            ? db.doc(
              `classes/${classId}/students/${studentUid}/activityLogs/${taxActivityLogId}`,
            )
            : null;
        })
        .filter(Boolean);
      const readRefs = [...summaryRefs, ...taxActivityLogRefs];
      const readSnaps = readRefs.length ? await tx.getAll(...readRefs) : [];
      const summarySnaps = readSnaps.slice(0, summaryRefs.length);
      const taxActivityLogSnaps = readSnaps.slice(summaryRefs.length);
      const summarySnapMap = new Map(
        summaryRefs.map((ref, index) => [ref.path, summarySnaps[index]]),
      );
      const taxActivityLogSnapMap = new Map(
        taxActivityLogRefs.map((ref, index) => [
          ref.path,
          taxActivityLogSnaps[index],
        ]),
      );
      const daySummaryCache = new Map();
      const monthSummaryCache = new Map();

      for (const readyItem of readyItems) {
        const {
          studentUid,
          attemptId,
          attempt,
          reward,
          stateEntry,
          targetAttemptRef,
          targetStateRef,
          targetDayKey,
          targetMonthKey,
          targetDayRef,
          targetMonthRef,
        } = readyItem;
        const dayCacheKey = targetDayKey ? studentUid + "::" + targetDayKey : null;
        const monthCacheKey = targetMonthKey ? studentUid + "::" + targetMonthKey : null;
        let dayStats = null;
        let monthStats = null;

        if (targetDayRef && dayCacheKey) {
          dayStats = daySummaryCache.get(dayCacheKey);
          if (!dayStats) {
            const daySnap = summarySnapMap.get(targetDayRef.path);
            dayStats = getDayStats(daySnap?.exists ? daySnap.data() : null);
            daySummaryCache.set(dayCacheKey, dayStats);
          }
        }
        if (targetMonthRef && monthCacheKey) {
          monthStats = monthSummaryCache.get(monthCacheKey);
          if (!monthStats) {
            const monthSnap = summarySnapMap.get(targetMonthRef.path);
            monthStats = getMonthStats(monthSnap?.exists ? monthSnap.data() : null);
            monthSummaryCache.set(monthCacheKey, monthStats);
          }
        }

        const rewardCurrencyDelta = num(reward.currency);
        const rewardCreditDelta = num(reward.credit);
        const rewardMissionTokenDelta = num(reward.missionToken);
        const nextDayAttemptCount = dayStats
          ? Math.max(0, dayStats.attemptCount - 1)
          : 0;
        const nextDayApprovedCount = dayStats
          ? Math.max(0, dayStats.approvedCount - 1)
          : 0;
        const dayBecameEmpty = dayStats
          ? dayStats.attemptCount > 0 && nextDayAttemptCount === 0
          : false;
        const nextMonthAttemptCount = monthStats
          ? Math.max(0, monthStats.attemptCount - 1)
          : 0;
        const nextMonthApprovedCount = monthStats
          ? Math.max(0, monthStats.approvedCount - 1)
          : 0;
        const nextMonthActiveDayCount = monthStats
          ? Math.max(0, monthStats.activeDayCount - (dayBecameEmpty ? 1 : 0))
          : 0;

        stateEntry.stats.totalCount = Math.max(0, stateEntry.stats.totalCount - 1);
        stateEntry.stats.approvedCount = Math.max(
          0,
          stateEntry.stats.approvedCount - 1,
        );
        stateEntry.stats.rewardTotal = {
          currency: Math.max(
            0,
            stateEntry.stats.rewardTotal.currency - rewardCurrencyDelta,
          ),
          credit: Math.max(
            0,
            stateEntry.stats.rewardTotal.credit - rewardCreditDelta,
          ),
          missionToken: Math.max(
            0,
            stateEntry.stats.rewardTotal.missionToken - rewardMissionTokenDelta,
          ),
        };

        tx.update(targetAttemptRef, {
          status: "canceled",
          canceledAt: FieldValue.serverTimestamp(),
          canceledByUid: callerUid,
          canceledByName: request.auth?.token?.name || "",
        });

        const statePatch = {
          totalCount: stateEntry.stats.totalCount,
          approvedCount: stateEntry.stats.approvedCount,
          pendingCount: stateEntry.stats.pendingCount,
          rewardTotal: stateEntry.stats.rewardTotal,
          latestStatus: "canceled",
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (stateEntry.todayKey === targetDayKey) {
          stateEntry.stats.todayCount = Math.max(0, stateEntry.stats.todayCount - 1);
          statePatch.todayCount = stateEntry.stats.todayCount;
        }

        tx.set(targetStateRef, statePatch, { merge: true });

        if (targetDayRef && dayStats) {
          dayStats.attemptCount = nextDayAttemptCount;
          dayStats.approvedCount = nextDayApprovedCount;
          dayStats.rewardTotal = {
            currency: Math.max(0, dayStats.rewardTotal.currency - rewardCurrencyDelta),
            credit: Math.max(0, dayStats.rewardTotal.credit - rewardCreditDelta),
            missionToken: Math.max(
              0,
              dayStats.rewardTotal.missionToken - rewardMissionTokenDelta,
            ),
          };

          if (dayStats.attemptCount === 0) {
            tx.delete(targetDayRef);
          } else {
            tx.set(
              targetDayRef,
              {
                classId,
                missionId,
                studentUid,
                studentName: attempt.studentName || "",
                studentNumber: attempt.studentNumber ?? null,
                missionTitle: mission.title || "",
                dayKey: targetDayKey,
                attemptCount: dayStats.attemptCount,
                approvedCount: dayStats.approvedCount,
                pendingCount: dayStats.pendingCount,
                rewardTotal: dayStats.rewardTotal,
                updatedAt: FieldValue.serverTimestamp(),
                lastAttemptAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          }
        }

        if (targetMonthRef && monthStats) {
          monthStats.attemptCount = nextMonthAttemptCount;
          monthStats.approvedCount = nextMonthApprovedCount;
          monthStats.activeDayCount = nextMonthActiveDayCount;
          monthStats.rewardTotal = {
            currency: Math.max(
              0,
              monthStats.rewardTotal.currency - rewardCurrencyDelta,
            ),
            credit: Math.max(0, monthStats.rewardTotal.credit - rewardCreditDelta),
            missionToken: Math.max(
              0,
              monthStats.rewardTotal.missionToken - rewardMissionTokenDelta,
            ),
          };

          if (monthStats.attemptCount === 0) {
            tx.delete(targetMonthRef);
          } else {
            tx.set(
              targetMonthRef,
              {
                classId,
                missionId,
                studentUid,
                studentName: attempt.studentName || "",
                studentNumber: attempt.studentNumber ?? null,
                missionTitle: mission.title || "",
                monthKey: targetMonthKey,
                attemptCount: monthStats.attemptCount,
                approvedCount: monthStats.approvedCount,
                pendingCount: monthStats.pendingCount,
                activeDayCount: monthStats.activeDayCount,
                rewardTotal: monthStats.rewardTotal,
                updatedAt: FieldValue.serverTimestamp(),
                lastAttemptAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          }
        }

        missionStats.totalCount = Math.max(0, missionStats.totalCount - 1);
        missionStats.approvedCount = Math.max(
          0,
          missionStats.approvedCount - 1,
        );

        tx.set(
          targetMissionRef,
          {
            ...makeMissionStatsValuePatch(missionStats),
            updatedAt: FieldValue.serverTimestamp(),
            ["lastAttempts." + studentUid]: {
              attemptId,
              dayKey: targetDayKey || null,
              status: "canceled",
              canceledAt: FieldValue.serverTimestamp(),
              canceledByUid: callerUid,
              studentName: attempt.studentName || "",
            },
          },
          { merge: true },
        );

        takeRewardBackInTx(
          tx,
          classId,
          studentUid,
          reward,
          mission,
          {
            config: globalConfig,
            planType,
            serviceName: "mission",
            issuedByUid: callerUid,
          },
          classData.currencyUnit || "",
        );

        const taxActivityLogId = reward?.taxActivityLogId;
        if (taxActivityLogId) {
          const taxActivityLogRef = db.doc(
            `classes/${classId}/students/${studentUid}/activityLogs/${taxActivityLogId}`,
          );
          const taxActivityLogSnap = taxActivityLogSnapMap.get(
            taxActivityLogRef.path,
          );
          if (taxActivityLogSnap?.exists) {
            stageActivityTaxCancellation({
              tx,
              classId,
              activityLogRef: taxActivityLogRef,
              activityLogData: taxActivityLogSnap.data(),
              actorUid: callerUid,
              reason: "always_mission_attempt_cancelled",
              context: {
                config: globalConfig,
                planType,
                serviceName: "mission",
                pageKey: "missions",
              },
            });
          }
        }

        results.success.push({ studentUid, attemptId });
      }
    });

    return {
      success: true,
      message: String(results.success.length) + " attempts canceled.",
      results,
    };
  },
);

exports.alwaysRejectAttemptBatch = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60 },
  async (request) => {
    const callerUid = request.auth?.uid;
    const callerRole = request.auth?.token?.role;
    const { classId, missionId, items = [], reason = "" } = request.data || {};

    if (!callerUid) {
      throw new HttpsError("unauthenticated", MSG_LOGIN_REQUIRED);
    }
    if (!classId || !missionId || !Array.isArray(items)) {
      throw new HttpsError("invalid-argument", MSG_CLASS_MISSION_ITEMS_REQUIRED);
    }
    if (items.length === 0) {
      throw new HttpsError("invalid-argument", MSG_REJECT_EMPTY);
    }
    if (items.length > 50) {
      throw new HttpsError("invalid-argument", MSG_REJECT_LIMIT);
    }

    await ensureTeacherLike(callerUid, callerRole, classId);

    const globalConfig = await getGlobalConfig();
    const results = { success: [], failed: [] };

    await db.runTransaction(async (tx) => {
      const [missionSnap, classSnap] = await tx.getAll(
        missionRef(classId, missionId),
        classRef(classId),
      );

      if (!missionSnap.exists) {
        throw new HttpsError("not-found", MSG_ALWAYS_MISSION_NOT_FOUND);
      }

      const mission = { id: missionSnap.id, ...missionSnap.data() };
      const classData = classSnap.data() || {};
      const planType = classData.planType || "FREE";
      ensureAlwaysMission(mission);
      const targetMissionRef = missionRef(classId, missionId);
      const missionStats = getMissionStats(mission);
      const stateCache = new Map();
      const preparedItems = [];
      const attemptRefs = [];
      const stateRefsByUid = new Map();
      const reasonText = String(reason || "").trim();

      for (const item of items) {
        const { studentUid, attemptId } = item || {};
        if (!studentUid || !attemptId) {
          results.failed.push({
            ...item,
            error: MSG_STUDENT_AND_ATTEMPT_REQUIRED,
          });
          continue;
        }

        const targetAttemptRef = missionAttemptRef(
          classId,
          studentUid,
          missionId,
          attemptId,
        );
        const targetStateRef =
          stateRefsByUid.get(studentUid) ||
          missionStateRef(classId, studentUid, missionId);
        stateRefsByUid.set(studentUid, targetStateRef);
        attemptRefs.push(targetAttemptRef);
        preparedItems.push({
          item,
          studentUid,
          attemptId,
          targetAttemptRef,
          targetStateRef,
        });
      }

      const attemptSnaps = attemptRefs.length ? await tx.getAll(...attemptRefs) : [];
      const stateRefList = Array.from(stateRefsByUid.values());
      const stateSnaps = stateRefList.length ? await tx.getAll(...stateRefList) : [];

      const attemptSnapMap = new Map(
        attemptRefs.map((ref, index) => [ref.path, attemptSnaps[index]]),
      );
      const stateSnapMap = new Map(
        stateRefList.map((ref, index) => [ref.path, stateSnaps[index]]),
      );
      const summaryRefsByPath = new Map();
      const readyItems = [];

      for (const preparedItem of preparedItems) {
        const { item, studentUid, attemptId, targetAttemptRef, targetStateRef } =
          preparedItem;
        const attemptSnap = attemptSnapMap.get(targetAttemptRef.path);
        const stateSnap = stateSnapMap.get(targetStateRef.path);

        if (!attemptSnap.exists) {
          results.failed.push({ ...item, error: MSG_ATTEMPT_NOT_FOUND });
          continue;
        }

        const attempt = attemptSnap.data() || {};
        if (attempt.status !== "pending") {
          results.failed.push({
            ...item,
            error: MSG_PENDING_REQUIRED_FOR_REJECTION,
          });
          continue;
        }

        const stateEntry =
          stateCache.get(studentUid) ||
          (() => {
            const stateData = stateSnap.exists ? stateSnap.data() : {};
            const entry = {
              todayKey: stateData?.todayKey || null,
              stats: getStateStats(stateData, stateData?.todayKey),
            };
            stateCache.set(studentUid, entry);
            return entry;
          })();
        const targetDayKey = String(
          attempt.dayKey || stateEntry.todayKey || "",
        ).trim();
        const targetMonthKey = monthKeyFromDayKey(targetDayKey);
        const targetDayRef = targetDayKey
          ? missionDayRef(classId, studentUid, missionId, targetDayKey)
          : null;
        const targetMonthRef = targetMonthKey
          ? missionMonthRef(classId, studentUid, missionId, targetMonthKey)
          : null;

        if (targetDayRef) summaryRefsByPath.set(targetDayRef.path, targetDayRef);
        if (targetMonthRef) summaryRefsByPath.set(targetMonthRef.path, targetMonthRef);

        readyItems.push({
          studentUid,
          attemptId,
          attempt,
          stateEntry,
          targetAttemptRef,
          targetStateRef,
          targetDayKey,
          targetMonthKey,
          targetDayRef,
          targetMonthRef,
        });
      }

      const summaryRefs = Array.from(summaryRefsByPath.values());
      const summarySnaps = summaryRefs.length ? await tx.getAll(...summaryRefs) : [];
      const summarySnapMap = new Map(
        summaryRefs.map((ref, index) => [ref.path, summarySnaps[index]]),
      );
      const daySummaryCache = new Map();
      const monthSummaryCache = new Map();

      for (const readyItem of readyItems) {
        const {
          studentUid,
          attemptId,
          attempt,
          stateEntry,
          targetAttemptRef,
          targetStateRef,
          targetDayKey,
          targetMonthKey,
          targetDayRef,
          targetMonthRef,
        } = readyItem;
        const dayCacheKey = targetDayKey ? studentUid + "::" + targetDayKey : null;
        const monthCacheKey = targetMonthKey ? studentUid + "::" + targetMonthKey : null;
        let dayStats = null;
        let monthStats = null;

        if (targetDayRef && dayCacheKey) {
          dayStats = daySummaryCache.get(dayCacheKey);
          if (!dayStats) {
            const daySnap = summarySnapMap.get(targetDayRef.path);
            dayStats = getDayStats(daySnap?.exists ? daySnap.data() : null);
            daySummaryCache.set(dayCacheKey, dayStats);
          }
        }
        if (targetMonthRef && monthCacheKey) {
          monthStats = monthSummaryCache.get(monthCacheKey);
          if (!monthStats) {
            const monthSnap = summarySnapMap.get(targetMonthRef.path);
            monthStats = getMonthStats(monthSnap?.exists ? monthSnap.data() : null);
            monthSummaryCache.set(monthCacheKey, monthStats);
          }
        }

        const nextDayAttemptCount = dayStats
          ? Math.max(0, dayStats.attemptCount - 1)
          : 0;
        const nextDayPendingCount = dayStats
          ? Math.max(0, dayStats.pendingCount - 1)
          : 0;
        const dayBecameEmpty = dayStats
          ? dayStats.attemptCount > 0 && nextDayAttemptCount === 0
          : false;
        const nextMonthAttemptCount = monthStats
          ? Math.max(0, monthStats.attemptCount - 1)
          : 0;
        const nextMonthPendingCount = monthStats
          ? Math.max(0, monthStats.pendingCount - 1)
          : 0;
        const nextMonthActiveDayCount = monthStats
          ? Math.max(0, monthStats.activeDayCount - (dayBecameEmpty ? 1 : 0))
          : 0;

        stateEntry.stats.totalCount = Math.max(0, stateEntry.stats.totalCount - 1);
        stateEntry.stats.pendingCount = Math.max(
          0,
          stateEntry.stats.pendingCount - 1,
        );

        tx.update(targetAttemptRef, {
          status: "rejected",
          rejectedAt: FieldValue.serverTimestamp(),
          rejectedByUid: callerUid,
          rejectedByName: request.auth?.token?.name || "",
          rejectReason: reasonText,
          feedback: reasonText || attempt.feedback || "",
        });

        const statePatch = {
          totalCount: stateEntry.stats.totalCount,
          approvedCount: stateEntry.stats.approvedCount,
          pendingCount: stateEntry.stats.pendingCount,
          rewardTotal: stateEntry.stats.rewardTotal,
          latestStatus: "rejected",
          latestAttemptId: attemptId,
          updatedAt: FieldValue.serverTimestamp(),
          lastRejectedAt: FieldValue.serverTimestamp(),
        };

        if (stateEntry.todayKey === targetDayKey) {
          stateEntry.stats.todayCount = Math.max(0, stateEntry.stats.todayCount - 1);
          statePatch.todayCount = stateEntry.stats.todayCount;
        }

        tx.set(targetStateRef, statePatch, { merge: true });

        if (targetDayRef && dayStats) {
          dayStats.attemptCount = nextDayAttemptCount;
          dayStats.pendingCount = nextDayPendingCount;

          if (dayStats.attemptCount === 0) {
            tx.delete(targetDayRef);
          } else {
            tx.set(
              targetDayRef,
              {
                classId,
                missionId,
                studentUid,
                studentName: attempt.studentName || "",
                studentNumber: attempt.studentNumber ?? null,
                missionTitle: mission.title || "",
                dayKey: targetDayKey,
                attemptCount: dayStats.attemptCount,
                approvedCount: dayStats.approvedCount,
                pendingCount: dayStats.pendingCount,
                rewardTotal: dayStats.rewardTotal,
                updatedAt: FieldValue.serverTimestamp(),
                lastAttemptAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          }
        }

        if (targetMonthRef && monthStats) {
          monthStats.attemptCount = nextMonthAttemptCount;
          monthStats.pendingCount = nextMonthPendingCount;
          monthStats.activeDayCount = nextMonthActiveDayCount;

          if (monthStats.attemptCount === 0) {
            tx.delete(targetMonthRef);
          } else {
            tx.set(
              targetMonthRef,
              {
                classId,
                missionId,
                studentUid,
                studentName: attempt.studentName || "",
                studentNumber: attempt.studentNumber ?? null,
                missionTitle: mission.title || "",
                monthKey: targetMonthKey,
                attemptCount: monthStats.attemptCount,
                approvedCount: monthStats.approvedCount,
                pendingCount: monthStats.pendingCount,
                activeDayCount: monthStats.activeDayCount,
                rewardTotal: monthStats.rewardTotal,
                updatedAt: FieldValue.serverTimestamp(),
                lastAttemptAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          }
        }

        missionStats.totalCount = Math.max(0, missionStats.totalCount - 1);
        missionStats.pendingCount = Math.max(0, missionStats.pendingCount - 1);

        tx.set(
          targetMissionRef,
          {
            ...makeMissionStatsValuePatch(missionStats),
            updatedAt: FieldValue.serverTimestamp(),
            ["lastAttempts." + studentUid]: {
              attemptId,
              dayKey: targetDayKey || null,
              status: "rejected",
              rejectedAt: FieldValue.serverTimestamp(),
              rejectedByUid: callerUid,
              studentName: attempt.studentName || "",
            },
          },
          { merge: true },
        );

        results.success.push({ studentUid, attemptId });
      }

      if (results.success.length > 0) {
        stageActivityLog(
          tx,
          classId,
          {
            studentUid: callerUid,
            type: "system",
            category: "mission_reject_batch",
            description: `${normalizeMissionLabel(mission.title)} 제출 ${results.success.length}건 반려`,
            relatedDoc: { collection: "missions", id: missionId },
          },
          {
            config: globalConfig,
            planType,
            serviceName: "mission",
          },
        );
      }
    });

    return {
      success: true,
      message: String(results.success.length) + " attempts rejected.",
      results,
    };
  },
);
