import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { db } from "../../../firebase";
import {
  EMPTY_JOB_VALUE,
  normalizeStudentJobList,
  queueStudentJobWrite,
} from "../utils/studentJobAssignments";
import { assignStudentJobs } from "./jobPermissionSyncService";

const MAX_BATCH_OPERATIONS = 450;

const normalizeRoundJobs = (jobDefinitions = []) =>
  jobDefinitions
    .map((job) => ({
      id: String(job?.id || "").trim(),
      name: String(job?.name || "").trim(),
      description: String(job?.description || "").trim(),
      baseSalary: Number(job?.baseSalary || 0),
    }))
    .filter((job) => job.id && job.name);

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const normalizeRoundLimits = ({
  allowMultipleApplications = false,
  replaceExistingJobsOnApproval = true,
  maxApplicationsPerStudent = 1,
  maxApprovedJobsPerStudent = 1,
}) => {
  const normalizedMaxApplications = allowMultipleApplications
    ? Math.max(1, Number(maxApplicationsPerStudent || 1))
    : 1;
  const normalizedMaxApprovedJobs = !allowMultipleApplications || replaceExistingJobsOnApproval
    ? 1
    : Math.min(
        normalizedMaxApplications,
        Math.max(1, Number(maxApprovedJobsPerStudent || 1)),
      );

  return {
    normalizedMaxApplications,
    normalizedMaxApprovedJobs,
  };
};

const commitBatchOperations = async (operations = []) => {
  let batch = writeBatch(db);
  let opCount = 0;

  for (const operation of operations) {
    operation(batch);
    opCount += 1;

    if (opCount >= MAX_BATCH_OPERATIONS) {
      await batch.commit();
      batch = writeBatch(db);
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await batch.commit();
  }
};

export const createJobRecruitmentRound = async ({
  classId,
  title,
  teacher,
  selectedJobs = [],
  allowMultipleApplications = false,
  allowCurrentJobApplications = false,
  replaceExistingJobsOnApproval = true,
  maxApplicationsPerStudent = 1,
  maxApprovedJobsPerStudent = 1,
}) => {
  const trimmedTitle = String(title || "").trim();
  const normalizedJobs = normalizeRoundJobs(selectedJobs);
  const { normalizedMaxApplications, normalizedMaxApprovedJobs } = normalizeRoundLimits({
    allowMultipleApplications,
    replaceExistingJobsOnApproval,
    maxApplicationsPerStudent,
    maxApprovedJobsPerStudent,
  });

  if (!classId || !teacher?.uid) {
    throw new Error("모집 회차를 만들기 위한 정보가 부족합니다.");
  }

  if (!trimmedTitle) {
    throw new Error("모집 회차 제목을 입력해 주세요.");
  }

  if (normalizedJobs.length === 0) {
    throw new Error("모집할 직업을 하나 이상 선택해 주세요.");
  }

  const roundsRef = collection(db, `classes/${classId}/jobRecruitmentRounds`);
  const openRoundsSnapshot = await getDocs(
    query(roundsRef, where("status", "==", "open")),
  );

  if (!openRoundsSnapshot.empty) {
    throw new Error("이미 진행 중인 직업 모집 회차가 있습니다. 먼저 마감해 주세요.");
  }

  const payload = {
    classId,
    title: trimmedTitle,
    status: "open",
    allowMultipleApplications: !!allowMultipleApplications,
    allowCurrentJobApplications: !!allowCurrentJobApplications,
    replaceExistingJobsOnApproval: !!replaceExistingJobsOnApproval,
    maxApplicationsPerStudent: normalizedMaxApplications,
    maxApprovedJobsPerStudent: normalizedMaxApprovedJobs,
    jobs: normalizedJobs,
    jobDefinitionIds: normalizedJobs.map((job) => job.id),
    jobCount: normalizedJobs.length,
    applicationCount: 0,
    submittedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    startedAt: serverTimestamp(),
    closedAt: null,
    createdByUid: teacher.uid,
    createdByName: teacher.name || "교사",
    closedByUid: null,
    closedByName: null,
  };

  const roundRef = await addDoc(roundsRef, payload);

  return {
    success: true,
    id: roundRef.id,
  };
};

export const closeJobRecruitmentRound = async ({
  classId,
  roundId,
  teacher,
}) => {
  if (!classId || !roundId || !teacher?.uid) {
    throw new Error("모집 회차를 마감하기 위한 정보가 부족합니다.");
  }

  const roundRef = doc(db, `classes/${classId}/jobRecruitmentRounds/${roundId}`);
  await updateDoc(roundRef, {
    status: "closed",
    updatedAt: serverTimestamp(),
    closedAt: serverTimestamp(),
    closedByUid: teacher.uid,
    closedByName: teacher.name || "교사",
  });

  return { success: true };
};

export const updateJobRecruitmentRound = async ({
  classId,
  roundId,
  teacher,
  title,
  selectedJobs = null,
  allowMultipleApplications = false,
  allowCurrentJobApplications = false,
  replaceExistingJobsOnApproval = true,
  maxApplicationsPerStudent = 1,
  maxApprovedJobsPerStudent = 1,
}) => {
  const trimmedTitle = String(title || "").trim();
  const hasSelectedJobsInput = Array.isArray(selectedJobs);
  const normalizedJobs = hasSelectedJobsInput ? normalizeRoundJobs(selectedJobs) : null;
  const { normalizedMaxApplications, normalizedMaxApprovedJobs } = normalizeRoundLimits({
    allowMultipleApplications,
    replaceExistingJobsOnApproval,
    maxApplicationsPerStudent,
    maxApprovedJobsPerStudent,
  });

  if (!classId || !roundId || !teacher?.uid) {
    throw new Error("모집 규칙을 수정하기 위한 정보가 부족합니다.");
  }

  if (!trimmedTitle) {
    throw new Error("모집 회차 제목을 입력해 주세요.");
  }

  if (hasSelectedJobsInput && normalizedJobs.length === 0) {
    throw new Error("모집할 직업을 하나 이상 선택해 주세요.");
  }

  const roundRef = doc(db, `classes/${classId}/jobRecruitmentRounds/${roundId}`);
  const roundSnapshot = await getDoc(roundRef);

  if (!roundSnapshot.exists()) {
    throw new Error("수정할 모집 회차를 찾을 수 없습니다.");
  }

  const roundData = roundSnapshot.data();
  if (String(roundData.status || "") !== "open") {
    throw new Error("진행 중인 모집 회차만 모집 규칙을 수정할 수 있습니다.");
  }

  const applicationsRef = collection(db, `classes/${classId}/jobApplications`);
  const applicationsSnapshot = await getDocs(
    query(applicationsRef, where("roundId", "==", roundId)),
  );

  if (normalizedJobs) {
    const nextJobIds = new Set(normalizedJobs.map((job) => job.id));
    const removedJob = normalizeRoundJobs(roundData.jobs || []).find(
      (job) => !nextJobIds.has(job.id),
    );

    if (removedJob) {
      throw new Error(
        "진행 중인 모집 회차에서는 기존 모집 직업을 제거할 수 없습니다. 필요한 직업만 추가해 주세요.",
      );
    }
  }

  const currentAllowMultipleApplications = !!roundData.allowMultipleApplications;
  const currentAllowCurrentJobApplications = !!roundData.allowCurrentJobApplications;
  const currentReplaceExistingJobsOnApproval =
    roundData.replaceExistingJobsOnApproval !== false;
  const currentMaxApplications = currentAllowMultipleApplications
    ? Math.max(1, Number(roundData.maxApplicationsPerStudent || 1))
    : 1;
  const currentMaxApprovedJobs =
    !currentAllowMultipleApplications || currentReplaceExistingJobsOnApproval
      ? 1
      : Math.max(1, Number(roundData.maxApprovedJobsPerStudent || 1));

  if (currentAllowMultipleApplications && !allowMultipleApplications) {
    throw new Error("진행 중인 모집 회차에서는 다중 지원 허용을 제한 쪽으로 바꿀 수 없습니다.");
  }

  if (currentAllowCurrentJobApplications && !allowCurrentJobApplications) {
    throw new Error("진행 중인 모집 회차에서는 현재 직업 재지원 허용을 제한 쪽으로 바꿀 수 없습니다.");
  }

  if (currentReplaceExistingJobsOnApproval !== !!replaceExistingJobsOnApproval) {
    throw new Error("진행 중인 모집 회차에서는 승인 시 기존 직업 처리 방식을 바꿀 수 없습니다.");
  }

  if (normalizedMaxApplications < currentMaxApplications) {
    throw new Error("진행 중인 모집 회차에서는 학생당 최대 지원 수를 줄일 수 없습니다.");
  }

  if (normalizedMaxApprovedJobs < currentMaxApprovedJobs) {
    throw new Error("진행 중인 모집 회차에서는 학생당 최대 승인 수를 줄일 수 없습니다.");
  }

  const operations = [
    (batch) => {
      const roundUpdate = {
        title: trimmedTitle,
        allowMultipleApplications: !!allowMultipleApplications,
        allowCurrentJobApplications: !!allowCurrentJobApplications,
        replaceExistingJobsOnApproval: !!replaceExistingJobsOnApproval,
        maxApplicationsPerStudent: normalizedMaxApplications,
        maxApprovedJobsPerStudent: normalizedMaxApprovedJobs,
        updatedAt: serverTimestamp(),
      };

      if (normalizedJobs) {
        roundUpdate.jobs = normalizedJobs;
        roundUpdate.jobDefinitionIds = normalizedJobs.map((job) => job.id);
        roundUpdate.jobCount = normalizedJobs.length;
      }

      batch.update(roundRef, roundUpdate);
    },
  ];

  applicationsSnapshot.docs.forEach((applicationSnapshot) => {
    const applicationData = applicationSnapshot.data();
    const nextPayload = {
      roundTitle: trimmedTitle,
      updatedAt: serverTimestamp(),
    };

    if (String(applicationData.status || "") === "submitted") {
      nextPayload.allowMultipleApplications = !!allowMultipleApplications;
      nextPayload.allowCurrentJobApplications = !!allowCurrentJobApplications;
      nextPayload.replaceExistingJobsOnApproval = !!replaceExistingJobsOnApproval;
      nextPayload.maxApplicationsPerStudent = normalizedMaxApplications;
      nextPayload.maxApprovedJobsPerStudent = normalizedMaxApprovedJobs;
    }

    operations.push((batch) => {
      batch.update(applicationSnapshot.ref, nextPayload);
    });
  });

  await commitBatchOperations(operations);

  return { success: true };
};

export const deleteJobRecruitmentRound = async ({
  classId,
  roundId,
  teacher,
}) => {
  if (!classId || !roundId || !teacher?.uid) {
    throw new Error("모집 회차를 삭제하기 위한 정보가 부족합니다.");
  }

  const roundRef = doc(db, `classes/${classId}/jobRecruitmentRounds/${roundId}`);
  const applicationsRef = collection(db, `classes/${classId}/jobApplications`);
  const applicationsSnapshot = await getDocs(
    query(applicationsRef, where("roundId", "==", roundId)),
  );

  const applications = applicationsSnapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    ref: docSnapshot.ref,
    ...docSnapshot.data(),
  }));

  const approvedRestoreByStudent = new Map();
  applications
    .filter((application) => application.status === "approved")
    .sort(
      (left, right) =>
        toMillis(left.approvedAt || left.reviewedAt || left.updatedAt) -
        toMillis(right.approvedAt || right.reviewedAt || right.updatedAt),
    )
    .forEach((application) => {
      const studentUid = String(application.studentUid || "").trim();
      if (!studentUid || approvedRestoreByStudent.has(studentUid)) return;

      const previousJobs = normalizeStudentJobList(application.previousJobs);
      const previousPrimaryJob =
        String(application.previousPrimaryJob || "").trim() || EMPTY_JOB_VALUE;

      if (!Array.isArray(application.previousJobs) && !application.previousPrimaryJob) {
        return;
      }

      approvedRestoreByStudent.set(studentUid, {
        previousJobs,
        previousPrimaryJob:
          previousJobs[0] || previousPrimaryJob || EMPTY_JOB_VALUE,
      });
    });

  const operations = [];

  approvedRestoreByStudent.forEach((restoreSnapshot, studentUid) => {
    const studentRef = doc(db, `classes/${classId}/students/${studentUid}`);
    operations.push((batch) => {
      queueStudentJobWrite(batch, {
        classId,
        studentUid,
        studentRef,
        jobs:
          restoreSnapshot.previousJobs.length > 0
            ? restoreSnapshot.previousJobs
            : restoreSnapshot.previousPrimaryJob || EMPTY_JOB_VALUE,
        source: "round_delete_restore",
      });
    });
  });

  applications.forEach((application) => {
    operations.push((batch) => {
      batch.delete(application.ref);
    });
  });

  operations.push((batch) => {
    batch.delete(roundRef);
  });

  await commitBatchOperations(operations);
  if (approvedRestoreByStudent.size > 0) {
    await assignStudentJobs({
      classId,
      source: "round_delete_restore",
      assignments: Array.from(
        approvedRestoreByStudent.entries(),
        ([studentUid, restoreSnapshot]) => ({
          studentUid,
          jobs:
            restoreSnapshot.previousJobs.length > 0
              ? restoreSnapshot.previousJobs
              : [restoreSnapshot.previousPrimaryJob],
        }),
      ),
    });
  }

  return {
    success: true,
    deletedApplicationCount: applications.length,
    restoredStudentCount: approvedRestoreByStudent.size,
  };
};
