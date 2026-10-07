import { doc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { functions } from "../../firebase";
import { toMillis } from "./CredentialsPage.parts";

export const CREDENTIAL_TEACHER_SUMMARY_DOC_ID = "teacherTitles";
export const CREDENTIAL_TEACHER_RECENT_REVIEW_LIMIT = 20;

const rebuildCredentialTeacherSummaryCallable = httpsCallable(
  functions,
  "rebuildCredentialTeacherSummary",
);
const deleteTitleDefinitionsWithCleanupCallable = httpsCallable(
  functions,
  "deleteTitleDefinitionsWithCleanup",
);

function getStudentFallback(student = {}) {
  return {
    studentName: student?.name || student?.displayName || "Student",
    studentNumber: student?.studentNumber || "",
  };
}

export function getCredentialTeacherSummaryRef(db, classId) {
  return doc(
    db,
    "classes",
    classId,
    "credentialSummary",
    CREDENTIAL_TEACHER_SUMMARY_DOC_ID,
  );
}

export function normalizeCredentialTeacherSummary(data = {}, roster = []) {
  const rosterList = Array.isArray(roster)
    ? roster.filter((student) => student?.uid)
    : [];
  const fallbackStudentUids = Object.keys(data?.studentTitleStats || {}).filter(
    Boolean,
  );
  const studentUids = rosterList.length
    ? rosterList.map((student) => student.uid)
    : fallbackStudentUids;
  const nextStudentTitleStats = {};

  studentUids.forEach((studentUid) => {
    const rawStat = data?.studentTitleStats?.[studentUid] || {};
    nextStudentTitleStats[studentUid] = {
      ownedTitleIds: Array.isArray(rawStat?.ownedTitleIds)
        ? rawStat.ownedTitleIds.filter(Boolean)
        : [],
      ownedCount: Number(rawStat?.ownedCount || 0),
      equippedTitleNames: Array.isArray(rawStat?.equippedTitleNames)
        ? rawStat.equippedTitleNames.filter(Boolean)
        : [],
      pendingRequestCount: Number(rawStat?.pendingRequestCount || 0),
      pendingRequestPreview: Array.isArray(rawStat?.pendingRequestPreview)
        ? rawStat.pendingRequestPreview.filter(Boolean)
        : [],
      extraPendingRequestCount: Number(rawStat?.extraPendingRequestCount || 0),
    };
  });

  return {
    summaryVersion: Number(data?.summaryVersion || 1),
    studentTitleStats: nextStudentTitleStats,
    ownedTitleCountByDefinition:
      data?.ownedTitleCountByDefinition &&
      typeof data.ownedTitleCountByDefinition === "object"
        ? data.ownedTitleCountByDefinition
        : {},
    requestCountByDefinition:
      data?.requestCountByDefinition &&
      typeof data.requestCountByDefinition === "object"
        ? data.requestCountByDefinition
        : {},
    pendingRequests: Array.isArray(data?.pendingRequests)
      ? data.pendingRequests.map((item) => ({ ...item }))
      : [],
    recentReviewedRequests: Array.isArray(data?.recentReviewedRequests)
      ? data.recentReviewedRequests.map((item) => ({ ...item }))
      : [],
  };
}

export function cloneCredentialTeacherSummary(data = {}, roster = []) {
  const normalized = normalizeCredentialTeacherSummary(data, roster);
  return {
    ...normalized,
    studentTitleStats: Object.fromEntries(
      Object.entries(normalized.studentTitleStats || {}).map(
        ([studentUid, stat]) => [
          studentUid,
          {
            ownedTitleIds: [...(stat?.ownedTitleIds || [])],
            ownedCount: Number(stat?.ownedCount || 0),
            equippedTitleNames: [...(stat?.equippedTitleNames || [])],
            pendingRequestCount: Number(stat?.pendingRequestCount || 0),
            pendingRequestPreview: [...(stat?.pendingRequestPreview || [])],
            extraPendingRequestCount: Number(
              stat?.extraPendingRequestCount || 0,
            ),
          },
        ],
      ),
    ),
    ownedTitleCountByDefinition: {
      ...(normalized.ownedTitleCountByDefinition || {}),
    },
    requestCountByDefinition: {
      ...(normalized.requestCountByDefinition || {}),
    },
    pendingRequests: (normalized.pendingRequests || []).map((item) => ({
      ...item,
    })),
    recentReviewedRequests: (normalized.recentReviewedRequests || []).map(
      (item) => ({
        ...item,
      }),
    ),
  };
}

export function normalizeCredentialTeacherSummaryRequest(
  record = {},
  rosterMap = new Map(),
) {
  const studentUid = String(record?.studentUid || "").trim();
  const fallbackStudent = rosterMap.get(studentUid) || null;
  const fallback = getStudentFallback(fallbackStudent);

  return {
    id: String(record?.id || record?.requestId || "").trim(),
    requestId: String(record?.requestId || record?.id || "").trim(),
    definitionDeleted: Boolean(record?.definitionDeleted),
    studentUid,
    studentName: String(
      record?.studentName || fallback.studentName || "Student",
    ).trim(),
    studentNumber: String(
      record?.studentNumber || fallback.studentNumber || "",
    ).trim(),
    titleId: String(record?.titleId || "").trim(),
    titleName: String(record?.titleName || "").trim(),
    acquisitionCondition: String(record?.acquisitionCondition || "").trim(),
    status: String(record?.status || "pending").trim() || "pending",
    requestMessage: String(record?.requestMessage || "").trim(),
    reviewMessage: String(record?.reviewMessage || "").trim(),
    reviewedByUid: String(record?.reviewedByUid || "").trim(),
    reviewedByName: String(record?.reviewedByName || "").trim(),
    category: String(record?.category || "").trim(),
    gradeId: String(record?.gradeId || "").trim(),
    rarity: String(record?.rarity || "common").trim() || "common",
    requestedAt: record?.requestedAt || null,
    reviewedAt: record?.reviewedAt || null,
    updatedAt: record?.updatedAt || null,
  };
}

export function sortCredentialTeacherPendingRequests(left, right) {
  return (
    toMillis(right?.requestedAt || right?.updatedAt) -
      toMillis(left?.requestedAt || left?.updatedAt) ||
    String(left?.studentName || "").localeCompare(
      String(right?.studentName || ""),
      "ko",
    )
  );
}

export function sortCredentialTeacherReviewedRequests(left, right) {
  return (
    toMillis(right?.reviewedAt || right?.updatedAt || right?.requestedAt) -
      toMillis(left?.reviewedAt || left?.updatedAt || left?.requestedAt) ||
    String(left?.studentName || "").localeCompare(
      String(right?.studentName || ""),
      "ko",
    )
  );
}

export async function requestCredentialTeacherSummaryRebuild(classId) {
  if (!classId) return null;
  const response = await rebuildCredentialTeacherSummaryCallable({ classId });
  return response?.data?.summary || null;
}

export async function deleteTitleDefinitionsWithCleanup({
  classId,
  titleIds = [],
  actorName = "",
}) {
  if (!classId || !Array.isArray(titleIds) || !titleIds.length) {
    return null;
  }

  const response = await deleteTitleDefinitionsWithCleanupCallable({
    classId,
    titleIds,
    actorName,
  });
  return response?.data || null;
}
