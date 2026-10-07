import { doc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../firebase";

export const ASSEMBLY_SUMMARY_VERSION = 3;

const assemblySummaryRepairRequests = new Map();
const assemblySummaryCache = new Map();
const ASSEMBLY_SUMMARY_CACHE_STORAGE_PREFIX = "finclass_assembly_summary:";

export const getAssemblyClassSummaryRef = (classId) =>
  doc(db, `classes/${classId}/notificationSummary/assembly`);

export const getAssemblyUserSummaryRef = (classId, userUid) =>
  doc(db, `classes/${classId}/notificationSummary/assembly/users/${userUid}`);

const toSafeCount = (value) => {
  const numericValue = Number(value || 0);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : null;
};

const getAssemblySummaryCacheKey = (classId, userUid) =>
  `${ASSEMBLY_SUMMARY_CACHE_STORAGE_PREFIX}${classId}:${userUid}`;

const deriveAssemblyPendingVoteCount = (
  openVotingBillCount,
  votedOpenBillCount,
) => {
  if (openVotingBillCount == null || votedOpenBillCount == null) {
    return null;
  }

  return Math.max(
    0,
    openVotingBillCount - Math.min(openVotingBillCount, votedOpenBillCount),
  );
};

const getCurrentAssemblySummaryState = ({
  classSummary,
  userSummary,
  userSummaryExists,
}) => {
  if (Number(classSummary?.summaryVersion || 0) < ASSEMBLY_SUMMARY_VERSION) {
    return null;
  }

  const openVotingBillCount = toSafeCount(classSummary?.openVotingBillCount);
  if (openVotingBillCount == null) {
    return null;
  }

  if (!userSummaryExists) {
    return {
      openVotingBillCount,
      votedOpenBillCount: 0,
      pendingVoteCount: deriveAssemblyPendingVoteCount(openVotingBillCount, 0),
      voteChoicesByBill: {},
      hasUserSummary: false,
    };
  }

  if (Number(userSummary?.summaryVersion || 0) < ASSEMBLY_SUMMARY_VERSION) {
    return null;
  }

  const votedOpenBillCount = toSafeCount(userSummary?.votedOpenBillCount);
  if (votedOpenBillCount == null) {
    return null;
  }

  return {
    openVotingBillCount,
    votedOpenBillCount,
    pendingVoteCount: deriveAssemblyPendingVoteCount(
      openVotingBillCount,
      votedOpenBillCount,
    ),
    voteChoicesByBill: sanitizeAssemblyVoteChoices(userSummary?.voteChoicesByBill),
    hasUserSummary: true,
  };
};

const normalizeAssemblySummaryCache = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const openVotingBillCount = toSafeCount(value.openVotingBillCount);
  const votedOpenBillCount = toSafeCount(value.votedOpenBillCount);
  const pendingVoteCount =
    deriveAssemblyPendingVoteCount(openVotingBillCount, votedOpenBillCount) ??
    toSafeCount(value.pendingVoteCount);
  const voteChoicesByBill = sanitizeAssemblyVoteChoices(value.voteChoicesByBill);

  if (
    openVotingBillCount == null &&
    votedOpenBillCount == null &&
    pendingVoteCount == null &&
    Object.keys(voteChoicesByBill).length === 0
  ) {
    return null;
  }

  return {
    summaryVersion: ASSEMBLY_SUMMARY_VERSION,
    openVotingBillCount,
    votedOpenBillCount,
    pendingVoteCount,
    voteChoicesByBill,
    cachedAt: Number(value.cachedAt || Date.now()),
  };
};

export const readCachedAssemblySummary = (classId, userUid) => {
  if (!classId || !userUid) {
    return null;
  }

  const cacheKey = getAssemblySummaryCacheKey(classId, userUid);
  if (assemblySummaryCache.has(cacheKey)) {
    return assemblySummaryCache.get(cacheKey);
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = sessionStorage.getItem(cacheKey);
    if (!rawValue) {
      return null;
    }

    const normalizedValue = normalizeAssemblySummaryCache(JSON.parse(rawValue));
    if (!normalizedValue) {
      sessionStorage.removeItem(cacheKey);
      return null;
    }

    assemblySummaryCache.set(cacheKey, normalizedValue);
    return normalizedValue;
  } catch (_error) {
    return null;
  }
};

export const writeCachedAssemblySummary = (classId, userUid, value) => {
  if (!classId || !userUid) {
    return null;
  }

  const cacheKey = getAssemblySummaryCacheKey(classId, userUid);
  const normalizedValue = normalizeAssemblySummaryCache({
    ...value,
    cachedAt: Date.now(),
  });

  if (!normalizedValue) {
    assemblySummaryCache.delete(cacheKey);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(cacheKey);
      } catch (_error) {
        // Ignore storage errors.
      }
    }
    return null;
  }

  assemblySummaryCache.set(cacheKey, normalizedValue);

  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(normalizedValue));
    } catch (_error) {
      // Ignore storage quota and serialization errors.
    }
  }

  return normalizedValue;
};

export const getAssemblyPendingCountFromCachedSummary = (cachedSummary) =>
  toSafeCount(cachedSummary?.pendingVoteCount);

export const getAssemblyVotedOpenCountFromCachedSummary = (cachedSummary) =>
  toSafeCount(cachedSummary?.votedOpenBillCount);

export const getAssemblyVoteChoicesFromCachedSummary = (cachedSummary) =>
  sanitizeAssemblyVoteChoices(cachedSummary?.voteChoicesByBill);

export const buildAssemblySummaryCacheFromCurrentSummary = ({
  classSummary,
  userSummary,
  userSummaryExists,
}) => {
  const currentSummaryState = getCurrentAssemblySummaryState({
    classSummary,
    userSummary,
    userSummaryExists,
  });
  if (!currentSummaryState) {
    return null;
  }

  return normalizeAssemblySummaryCache({
    openVotingBillCount: currentSummaryState.openVotingBillCount,
    votedOpenBillCount: currentSummaryState.votedOpenBillCount,
    pendingVoteCount: currentSummaryState.pendingVoteCount,
    voteChoicesByBill: currentSummaryState.voteChoicesByBill,
  });
};

export const buildAssemblySummaryCacheFromLegacySummary = (
  classSummary,
  userUid,
  cachedSummary = null,
) => {
  const openVotingBillCount = toSafeCount(classSummary?.openVotingBillCount);
  const votedOpenBillCount = toSafeCount(
    classSummary?.votedOpenBillCounts?.[userUid],
  );
  if (openVotingBillCount == null || votedOpenBillCount == null) {
    return null;
  }

  return normalizeAssemblySummaryCache({
    openVotingBillCount,
    votedOpenBillCount,
    pendingVoteCount: Math.max(
      0,
      openVotingBillCount - Math.min(openVotingBillCount, votedOpenBillCount),
    ),
    voteChoicesByBill: cachedSummary?.voteChoicesByBill || {},
  });
};

export const getAssemblyPendingCountFromCurrentSummary = ({
  classSummary,
  userSummary,
  userSummaryExists,
}) =>
  getCurrentAssemblySummaryState({
    classSummary,
    userSummary,
    userSummaryExists,
  })?.pendingVoteCount ?? null;

export const getAssemblyPendingCountFromLegacySummary = (classSummary, userUid) => {
  const openVotingBillCount = toSafeCount(classSummary?.openVotingBillCount);
  if (openVotingBillCount == null) {
    return null;
  }

  if (
    !classSummary?.votedOpenBillCounts ||
    typeof classSummary.votedOpenBillCounts !== "object"
  ) {
    return null;
  }

  const votedOpenBillCount = toSafeCount(
    classSummary.votedOpenBillCounts?.[userUid],
  );
  if (votedOpenBillCount == null) {
    return null;
  }

  return Math.max(
    0,
    openVotingBillCount - Math.min(openVotingBillCount, votedOpenBillCount),
  );
};

export const getAssemblyVotedOpenCountFromCurrentSummary = ({
  classSummary,
  userSummary,
  userSummaryExists,
}) =>
  getCurrentAssemblySummaryState({
    classSummary,
    userSummary,
    userSummaryExists,
  })?.votedOpenBillCount ?? null;

export const getAssemblyVotedOpenCountFromLegacySummary = (classSummary, userUid) => {
  if (
    !classSummary?.votedOpenBillCounts ||
    typeof classSummary.votedOpenBillCounts !== "object"
  ) {
    return null;
  }

  return toSafeCount(classSummary.votedOpenBillCounts?.[userUid]);
};

export const sanitizeAssemblyVoteChoices = (source = {}) =>
  Object.fromEntries(
    Object.entries(source || {}).filter(
      ([billId, vote]) =>
        Boolean(billId) && (vote === "agree" || vote === "disagree"),
    ),
  );

export const getVoteChoicesFromAssemblySummaries = ({
  classSummary,
  userSummary,
  userSummaryExists,
}) => {
  if (!userSummaryExists) {
    return null;
  }

  return (
    getCurrentAssemblySummaryState({
      classSummary,
      userSummary,
      userSummaryExists,
    })?.voteChoicesByBill ?? null
  );
};

export const requestAssemblySummaryRepair = async ({
  classId,
  studentUid = null,
  scope = "self",
}) => {
  if (!classId) {
    return null;
  }

  const normalizedScope = scope === "class" ? "class" : "self";
  const requestKey = `${classId}:${normalizedScope}:${studentUid || "self"}`;

  if (assemblySummaryRepairRequests.has(requestKey)) {
    return assemblySummaryRepairRequests.get(requestKey);
  }

  const rebuildAssemblyNotificationSummary = httpsCallable(
    functions,
    "rebuildAssemblyNotificationSummary",
  );

  const requestPromise = rebuildAssemblyNotificationSummary({
    classId,
    studentUid,
    scope: normalizedScope,
  }).finally(() => {
    assemblySummaryRepairRequests.delete(requestKey);
  });

  assemblySummaryRepairRequests.set(requestKey, requestPromise);
  return requestPromise;
};
