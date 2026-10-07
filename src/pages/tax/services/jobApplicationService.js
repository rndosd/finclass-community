import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "../../../firebase";
import {
  EMPTY_JOB_VALUE,
  queueStudentJobWrite,
} from "../utils/studentJobAssignments";
import { assignStudentJobs } from "./jobPermissionSyncService";

const toJobArray = (studentData = {}) => {
  if (Array.isArray(studentData.jobs)) {
    return studentData.jobs
      .map((job) => String(job || "").trim())
      .filter((job) => job && job !== EMPTY_JOB_VALUE);
  }

  const fallbackJob = String(studentData.job || "").trim();
  return fallbackJob && fallbackJob !== EMPTY_JOB_VALUE ? [fallbackJob] : [];
};

const getRoundJobSnapshot = (round, jobDefinitionId) =>
  (round?.jobs || []).find(
    (job) => String(job?.id || "").trim() === String(jobDefinitionId || "").trim(),
  );

export const buildJobApplicationId = (studentUid, roundId, jobDefinitionId) =>
  [
    String(roundId || "").trim(),
    String(studentUid || "").trim(),
    String(jobDefinitionId || "").trim(),
  ].join("__");

const getStudentRoundApplications = async ({ classId, roundId, studentUid }) => {
  const applicationsRef = collection(db, `classes/${classId}/jobApplications`);
  const snapshot = await getDocs(
    query(
      applicationsRef,
      where("roundId", "==", roundId),
      where("studentUid", "==", studentUid),
    ),
  );

  return snapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    ...docSnapshot.data(),
  })).filter((application) => application.studentUid === studentUid);
};

export const submitJobApplication = async ({
  classId,
  student,
  round,
  jobDefinition,
  experience = "",
  reason = "",
}) => {
  if (!classId || !student?.uid || !round?.id || !jobDefinition?.id) {
    throw new Error("직업 지원에 필요한 정보가 부족합니다.");
  }

  if (round.status !== "open") {
    throw new Error("현재는 직업 지원을 받을 수 없는 회차입니다.");
  }

  const roundJob = getRoundJobSnapshot(round, jobDefinition.id);
  if (!roundJob) {
    throw new Error("현재 모집 중인 직업만 지원할 수 있습니다.");
  }

  const currentJobs = toJobArray(student);
  if (!round.allowCurrentJobApplications && currentJobs.includes(roundJob.name)) {
    throw new Error("현재 맡고 있는 직업에는 다시 지원할 수 없습니다.");
  }

  const applicationId = buildJobApplicationId(student.uid, round.id, jobDefinition.id);
  const applicationRef = doc(
    db,
    `classes/${classId}/jobApplications/${applicationId}`,
  );
  const roundRef = doc(
    db,
    `classes/${classId}/jobRecruitmentRounds/${round.id}`,
  );

  const existingApplications = await getStudentRoundApplications({
    classId,
    roundId: round.id,
    studentUid: student.uid,
  });

  const activeApplications = existingApplications.filter((application) =>
    ["submitted", "approved"].includes(String(application.status || "")),
  );
  const existingApplication = existingApplications.find(
    (application) => application.id === applicationId,
  );
  const existingStatus = String(existingApplication?.status || "");

  if (existingStatus === "submitted") {
    throw new Error("이미 이 직업에 지원서를 제출했습니다.");
  }

  if (existingStatus === "approved") {
    throw new Error("이미 승인된 직업입니다.");
  }

  const maxApplicationsPerStudent = round.allowMultipleApplications
    ? Math.max(1, Number(round.maxApplicationsPerStudent || 1))
    : 1;
  const activeApplicationsExcludingCurrent = activeApplications.filter(
    (application) => application.id !== applicationId,
  );

  if (activeApplicationsExcludingCurrent.length >= maxApplicationsPerStudent) {
    throw new Error(
      maxApplicationsPerStudent <= 1
        ? "이 모집 회차에서는 학생당 한 직업만 지원할 수 있습니다."
        : `이 모집 회차에서는 학생당 최대 ${maxApplicationsPerStudent}개까지 지원할 수 있습니다.`,
    );
  }

  await runTransaction(db, async (transaction) => {
    const roundSnapshot = await transaction.get(roundRef);

    if (!roundSnapshot.exists()) {
      throw new Error("모집 회차를 찾을 수 없습니다.");
    }

    const roundData = roundSnapshot.data();
    if (String(roundData?.status || "") !== "open") {
      throw new Error("현재는 직업 지원을 받을 수 없는 회차입니다.");
    }

    const transactionRoundJobIndex = (roundData.jobs || []).findIndex(
      (job) => String(job?.id || "").trim() === String(jobDefinition.id).trim(),
    );
    if (transactionRoundJobIndex < 0) {
      throw new Error("현재 모집 중인 직업만 지원할 수 있습니다.");
    }
    const transactionRoundJob = roundData.jobs[transactionRoundJobIndex];

    transaction.set(applicationRef, {
      classId,
      roundId: round.id,
      roundTitle: roundData.title || "직업 모집",
      roundJobIndex: transactionRoundJobIndex,
      studentUid: student.uid,
      studentName: student.name || "학생",
      studentNumber: student.studentNumber || "",
      jobDefinitionId: transactionRoundJob.id,
      jobName: transactionRoundJob.name || "",
      jobDescription: transactionRoundJob.description || "",
      baseSalary: Number(transactionRoundJob.baseSalary || 0),
      experience: String(experience || "").trim(),
      reason: String(reason || "").trim(),
      status: "submitted",
      allowMultipleApplications: !!roundData.allowMultipleApplications,
      allowCurrentJobApplications: !!roundData.allowCurrentJobApplications,
      replaceExistingJobsOnApproval: !!roundData.replaceExistingJobsOnApproval,
      maxApplicationsPerStudent: Math.max(
        1,
        Number(roundData.maxApplicationsPerStudent || 1),
      ),
      maxApprovedJobsPerStudent: Math.max(
        1,
        Number(roundData.maxApprovedJobsPerStudent || 1),
      ),
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      reviewedAt: null,
      approvedAt: null,
      approvedByUid: null,
      approvedByName: null,
      reviewerNote: null,
      rejectionReason: null,
    });

    // Round counters are synchronized by syncJobRecruitmentRoundCounts.
    // Keeping them server-owned prevents clients from forging aggregate state.
  });

  return { success: true, id: applicationId };
};

export const approveJobApplication = async ({
  classId,
  applicationId,
  reviewer,
  reviewerNote = "",
}) => {
  if (!classId || !applicationId || !reviewer?.uid) {
    throw new Error("직업 승인에 필요한 정보가 부족합니다.");
  }

  const applicationRef = doc(
    db,
    `classes/${classId}/jobApplications/${applicationId}`,
  );
  const applicationSnapshot = await getDoc(applicationRef);

  if (!applicationSnapshot.exists()) {
    throw new Error("지원서를 찾을 수 없습니다.");
  }

  const applicationData = applicationSnapshot.data();
  const maxApprovedJobsPerStudent = Math.max(
    1,
    Number(applicationData.maxApprovedJobsPerStudent || 1),
  );
  const existingApplications = await getStudentRoundApplications({
    classId,
    roundId: applicationData.roundId,
    studentUid: applicationData.studentUid,
  });
  const approvedCount = existingApplications.filter(
    (application) => application.status === "approved",
  ).length;

  if (approvedCount >= maxApprovedJobsPerStudent) {
    throw new Error(
      `이 모집 회차에서는 학생당 최대 ${maxApprovedJobsPerStudent}개까지만 승인할 수 있습니다.`,
    );
  }

  let approvedJobs = [];
  await runTransaction(db, async (transaction) => {
    const applicationSnapshotInTransaction = await transaction.get(applicationRef);

    if (!applicationSnapshotInTransaction.exists()) {
      throw new Error("지원서를 찾을 수 없습니다.");
    }

    const application = applicationSnapshotInTransaction.data();
    if (application.status !== "submitted") {
      throw new Error("대기 중인 지원서만 승인할 수 있습니다.");
    }
    const studentRef = doc(
      db,
      `classes/${classId}/students/${application.studentUid}`,
    );
    const studentSnapshot = await transaction.get(studentRef);

    if (!studentSnapshot.exists()) {
      throw new Error("학생 정보를 찾을 수 없습니다.");
    }

    const currentJobs = toJobArray(studentSnapshot.data());
    const nextJobs = application.replaceExistingJobsOnApproval
      ? [application.jobName].filter(Boolean)
      : currentJobs.includes(application.jobName)
        ? currentJobs
        : [...currentJobs, application.jobName].filter(Boolean);
    approvedJobs = nextJobs;

    queueStudentJobWrite(transaction, {
      classId,
      studentUid: application.studentUid,
      studentRef,
      jobs: nextJobs,
      source: "application_approval",
    });

    transaction.update(applicationRef, {
      status: "approved",
      updatedAt: serverTimestamp(),
      reviewedAt: serverTimestamp(),
      approvedAt: serverTimestamp(),
      approvedByUid: reviewer.uid,
      approvedByName: reviewer.name || "교사",
      previousJobs: currentJobs,
      previousPrimaryJob:
        String(studentSnapshot.data()?.job || "").trim() || EMPTY_JOB_VALUE,
      nextJobs,
      reviewerNote: String(reviewerNote || "").trim() || null,
      rejectionReason: null,
    });
  });

  await assignStudentJobs({
    classId,
    source: "application_approval",
    assignments: [{
      studentUid: applicationData.studentUid,
      jobs: approvedJobs,
    }],
  });

  return { success: true };
};

export const rejectJobApplication = async ({
  classId,
  applicationId,
  reviewer,
  rejectionReason = "",
}) => {
  if (!classId || !applicationId || !reviewer?.uid) {
    throw new Error("직업 반려에 필요한 정보가 부족합니다.");
  }

  const applicationRef = doc(
    db,
    `classes/${classId}/jobApplications/${applicationId}`,
  );

  await runTransaction(db, async (transaction) => {
    const applicationSnapshot = await transaction.get(applicationRef);

    if (!applicationSnapshot.exists()) {
      throw new Error("지원서를 찾을 수 없습니다.");
    }

    const application = applicationSnapshot.data();
    if (application.status !== "submitted") {
      throw new Error("대기 중인 지원서만 반려할 수 있습니다.");
    }
    transaction.update(applicationRef, {
      status: "rejected",
      updatedAt: serverTimestamp(),
      reviewedAt: serverTimestamp(),
      approvedAt: null,
      approvedByUid: reviewer.uid,
      approvedByName: reviewer.name || "교사",
      reviewerNote: null,
      rejectionReason: String(rejectionReason || "").trim() || null,
    });
  });

  return { success: true };
};
