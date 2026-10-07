import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../../firebase";

const getReflectionRef = (classId, fineId) =>
  doc(db, `classes/${classId}/reflections`, fineId);

const getFineHistoryRef = (classId, fineId) =>
  doc(db, `classes/${classId}/policeFineHistory`, fineId);

const normalizeSubmissionType = (value) =>
  value === "appeal" ? "appeal" : "reflection";

const REFLECTION_SUMMARY_FIELDS = [
  "hasReflection",
  "reflectionStatus",
  "reflectionUpdatedAt",
  "reflectionSubmittedAt",
  "reflectionReviewedAt",
  "submissionType",
  "reviewOutcome",
];

const normalizeReflectionStatus = (value) => {
  if (value === "submitted" || value === "approved" || value === "rejected") {
    return value;
  }
  return "none";
};

export const hasReflectionSummary = (record = {}) =>
  REFLECTION_SUMMARY_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(record, field),
  );

export const buildReflectionSummaryFromData = (reflectionData) => {
  if (!reflectionData) {
    return {
      hasReflection: false,
      reflectionStatus: "none",
      reflectionUpdatedAt: null,
      reflectionSubmittedAt: null,
      reflectionReviewedAt: null,
      submissionType: null,
      reviewOutcome: null,
    };
  }

  const status = normalizeReflectionStatus(reflectionData.status);
  const hasReflection =
    Boolean(String(reflectionData.reflectionText ?? "").trim()) ||
    status !== "none";

  return {
    hasReflection,
    reflectionStatus: status,
    reflectionUpdatedAt:
      reflectionData.updatedAt ?? reflectionData.createdAt ?? null,
    reflectionSubmittedAt: reflectionData.submittedAt ?? null,
    reflectionReviewedAt: reflectionData.reviewedAt ?? null,
    submissionType:
      status === "none"
        ? null
        : normalizeSubmissionType(reflectionData.submissionType),
    reviewOutcome: reflectionData.reviewOutcome ?? null,
  };
};

const buildReflectionSummaryPatch = ({
  hasReflection = true,
  status = "none",
  submissionType = null,
  reviewOutcome = null,
  updatedAt = null,
  submittedAt,
  reviewedAt,
} = {}) => {
  const patch = {
    hasReflection,
    reflectionStatus: normalizeReflectionStatus(status),
    reflectionUpdatedAt: updatedAt ?? null,
    submissionType: submissionType
      ? normalizeSubmissionType(submissionType)
      : null,
    reviewOutcome: reviewOutcome ?? null,
  };

  if (submittedAt !== undefined) {
    patch.reflectionSubmittedAt = submittedAt;
  }
  if (reviewedAt !== undefined) {
    patch.reflectionReviewedAt = reviewedAt;
  }

  return patch;
};

export const submitReflectionToFirestore = async (
  classId,
  fineId,
  studentUid,
  studentName,
  reflectionText,
  submissionType = "reflection",
) => {
  try {
    const reflectionRef = getReflectionRef(classId, fineId);
    const fineRef = getFineHistoryRef(classId, fineId);
    const normalizedType = normalizeSubmissionType(submissionType);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(reflectionRef);
      const text = String(reflectionText || "").trim();
      const timestamp = serverTimestamp();

      if (!snap.exists()) {
        tx.set(reflectionRef, {
          fineId,
          studentUid,
          studentName,
          reflectionText: text,
          submissionType: normalizedType,
          status: "submitted",
          submittedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
          classId,
        });
      } else {
        const current = snap.data() || {};
        if (current.status === "approved") {
          throw new Error("이미 승인된 제출물은 다시 보낼 수 없습니다.");
        }

        tx.update(reflectionRef, {
          reflectionText: text,
          submissionType: normalizedType,
          status: "submitted",
          submittedAt: timestamp,
          updatedAt: timestamp,
          reviewedAt: null,
          reviewedByUid: null,
          reviewedByName: null,
          teacherComment: null,
        });
      }

      tx.update(
        fineRef,
        buildReflectionSummaryPatch({
          hasReflection: true,
          status: "submitted",
          submissionType: normalizedType,
          reviewOutcome: null,
          updatedAt: timestamp,
          submittedAt: timestamp,
          reviewedAt: null,
        }),
      );
    });

    return { success: true, message: "제출이 완료되었습니다." };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

export const approveReflectionInFirestore = async (
  classId,
  reflectionId,
  teacherUid,
  teacherName,
  teacherComment = "",
) => {
  try {
    const reflectionRef = getReflectionRef(classId, reflectionId);
    const fineRef = getFineHistoryRef(classId, reflectionId);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(reflectionRef);
      if (!snap.exists()) {
        throw new Error("제출 기록을 찾을 수 없습니다.");
      }

      if ((snap.data() || {}).status !== "submitted") {
        throw new Error("제출된 상태에서만 승인할 수 있습니다.");
      }

      const current = snap.data() || {};
      const timestamp = serverTimestamp();

      tx.update(reflectionRef, {
        status: "approved",
        reviewedAt: timestamp,
        reviewedByUid: teacherUid,
        reviewedByName: teacherName,
        teacherComment: String(teacherComment || "").trim(),
        finalFinePercent: 100,
        finalCreditPercent: 100,
        finalMissionTokenPercent: 100,
        reviewOutcome: "approved",
        updatedAt: timestamp,
      });

      tx.update(
        fineRef,
        buildReflectionSummaryPatch({
          hasReflection: true,
          status: "approved",
          submissionType: normalizeSubmissionType(current.submissionType),
          reviewOutcome: "approved",
          updatedAt: timestamp,
          submittedAt: current.submittedAt ?? null,
          reviewedAt: timestamp,
        }),
      );
    });

    return { success: true, message: "승인되었습니다." };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

export const rejectReflectionInFirestore = async (
  classId,
  reflectionId,
  teacherUid,
  teacherName,
  teacherComment,
) => {
  try {
    const comment = String(teacherComment || "").trim();
    if (!comment) {
      return { success: false, message: "반려 사유를 입력해 주세요." };
    }

    const reflectionRef = getReflectionRef(classId, reflectionId);
    const fineRef = getFineHistoryRef(classId, reflectionId);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(reflectionRef);
      if (!snap.exists()) {
        throw new Error("제출 기록을 찾을 수 없습니다.");
      }

      if ((snap.data() || {}).status !== "submitted") {
        throw new Error("제출된 상태에서만 반려할 수 있습니다.");
      }

      const current = snap.data() || {};
      const timestamp = serverTimestamp();

      tx.update(reflectionRef, {
        status: "rejected",
        reviewedAt: timestamp,
        reviewedByUid: teacherUid,
        reviewedByName: teacherName,
        teacherComment: comment,
        updatedAt: timestamp,
      });

      tx.update(
        fineRef,
        buildReflectionSummaryPatch({
          hasReflection: true,
          status: "rejected",
          submissionType: normalizeSubmissionType(current.submissionType),
          reviewOutcome: null,
          updatedAt: timestamp,
          submittedAt: current.submittedAt ?? null,
          reviewedAt: timestamp,
        }),
      );
    });

    return { success: true, message: "반려되었습니다." };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

export const updateReflectionInFirestore = async (
  classId,
  reflectionId,
  studentUid,
  reflectionText,
  submissionType = "reflection",
) => {
  try {
    const reflectionRef = getReflectionRef(classId, reflectionId);
    const fineRef = getFineHistoryRef(classId, reflectionId);
    const normalizedType = normalizeSubmissionType(submissionType);
    const text = String(reflectionText || "").trim();

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(reflectionRef);
      if (!snap.exists()) {
        throw new Error("제출 기록을 찾을 수 없습니다.");
      }

      const current = snap.data() || {};
      if (current.studentUid !== studentUid) {
        throw new Error("본인 제출물만 수정할 수 있습니다.");
      }

      const timestamp = serverTimestamp();

      tx.update(reflectionRef, {
        reflectionText: text,
        submissionType: normalizedType,
        status: "submitted",
        updatedAt: timestamp,
        submittedAt: timestamp,
        reviewedAt: null,
        reviewedByUid: null,
        reviewedByName: null,
        teacherComment: null,
      });

      tx.update(
        fineRef,
        buildReflectionSummaryPatch({
          hasReflection: true,
          status: "submitted",
          submissionType: normalizedType,
          reviewOutcome: null,
          updatedAt: timestamp,
          submittedAt: timestamp,
          reviewedAt: null,
        }),
      );
    });

    return { success: true, message: "다시 제출되었습니다." };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

export const cancelReflectionSubmissionInFirestore = async (
  classId,
  reflectionId,
) => {
  try {
    const reflectionRef = getReflectionRef(classId, reflectionId);
    const fineRef = getFineHistoryRef(classId, reflectionId);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(reflectionRef);
      if (!snap.exists()) {
        throw new Error("제출 기록을 찾을 수 없습니다.");
      }

      if ((snap.data() || {}).status === "approved") {
        throw new Error("이미 승인된 제출물은 취소할 수 없습니다.");
      }

      const current = snap.data() || {};
      const timestamp = serverTimestamp();

      tx.update(reflectionRef, {
        status: "draft",
        updatedAt: timestamp,
        reviewedAt: null,
        reviewedByUid: null,
        reviewedByName: null,
        teacherComment: null,
      });

      tx.update(
        fineRef,
        buildReflectionSummaryPatch({
          hasReflection: Boolean(String(current.reflectionText ?? "").trim()),
          status: "none",
          submissionType: null,
          reviewOutcome: null,
          updatedAt: timestamp,
          submittedAt: null,
          reviewedAt: null,
        }),
      );
    });

    return { success: true, message: "제출이 취소되었습니다." };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

export const getReflectionByFineId = async (classId, fineId) => {
  try {
    const snap = await getDoc(getReflectionRef(classId, fineId));
    return {
      success: true,
      data: snap.exists() ? { id: snap.id, ...snap.data() } : null,
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

export const updateReflectionCommentOnly = async (
  classId,
  reflectionId,
  teacherComment,
) => {
  try {
    const reflectionRef = getReflectionRef(classId, reflectionId);
    const fineRef = getFineHistoryRef(classId, reflectionId);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(reflectionRef);
      if (!snap.exists()) {
        throw new Error("제출 기록을 찾을 수 없습니다.");
      }

      const current = snap.data() || {};
      const timestamp = serverTimestamp();

      tx.update(reflectionRef, {
        teacherComment: String(teacherComment ?? "").trim(),
        updatedAt: timestamp,
      });
      tx.update(
        fineRef,
        buildReflectionSummaryPatch({
          hasReflection:
            Boolean(String(current.reflectionText ?? "").trim()) ||
            normalizeReflectionStatus(current.status) !== "none",
          status: current.status,
          submissionType:
            current.submissionType == null
              ? null
              : normalizeSubmissionType(current.submissionType),
          reviewOutcome: current.reviewOutcome ?? null,
          updatedAt: timestamp,
          submittedAt: current.submittedAt ?? null,
          reviewedAt: current.reviewedAt ?? null,
        }),
      );
    });
    return { success: true, message: "교사 메모가 저장되었습니다." };
  } catch (error) {
    return { success: false, message: error.message };
  }
};
