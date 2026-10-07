import { useCallback, useState } from "react";

import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import {
  EMPTY_JOB_VALUE,
  normalizeStudentJobList,
} from "../utils/studentJobAssignments";
import { assignStudentJobs } from "../services/jobPermissionSyncService";

const normalizeStudentUids = (studentUids = []) =>
  Array.from(
    new Set((studentUids || []).map((uid) => String(uid || "").trim()).filter(Boolean)),
  );

const normalizeAssignmentRows = (assignments = []) => {
  const assignmentMap = new Map();

  (assignments || []).forEach((assignment) => {
    const studentUid = String(assignment?.studentUid || "").trim();
    if (!studentUid) return;

    assignmentMap.set(studentUid, normalizeStudentJobList(assignment?.jobs || []));
  });

  return Array.from(assignmentMap.entries()).map(([studentUid, jobs]) => ({
    studentUid,
    jobs,
  }));
};

export const useStudentJobAssignmentManager = (classId) => {
  const { hasPermission, isTeacher } = useUser();
  const { showFeedback } = useFeedback();
  const [isSavingAssignments, setIsSavingAssignments] = useState(false);

  const canManageJobAssignments = isTeacher || hasPermission("labor_admin");

  const handleAssignJobsToStudents = useCallback(
    async ({ studentUids = [], jobs = [] }) => {
      if (!canManageJobAssignments) {
        showFeedback("직업을 배정할 권한이 없습니다.", "error");
        return { success: false };
      }

      if (!classId) {
        showFeedback("학급 정보를 확인한 뒤 다시 시도해 주세요.", "error");
        return { success: false };
      }

      const normalizedStudentUids = normalizeStudentUids(studentUids);
      const normalizedJobs = normalizeStudentJobList(jobs);

      if (normalizedStudentUids.length === 0) {
        showFeedback("직업을 배정할 학생을 먼저 선택해 주세요.", "info");
        return { success: false };
      }

      if (normalizedJobs.length === 0) {
        showFeedback("배정할 직업을 한 개 이상 선택해 주세요.", "info");
        return { success: false };
      }

      setIsSavingAssignments(true);
      try {
        const result = await assignStudentJobs({
          classId,
          source: "manual_assign",
          assignments: normalizedStudentUids.map((studentUid) => ({
            studentUid,
            jobs: normalizedJobs,
          })),
        });
        const updateCount = result.updatedCount;
        showFeedback(`${updateCount}명의 직업을 저장했습니다.`, "success");
        return { success: true, updatedCount: updateCount };
      } catch (error) {
        showFeedback(
          error?.message || "직업 배정을 저장하는 중 문제가 발생했습니다.",
          "error",
        );
        return { success: false, error };
      } finally {
        setIsSavingAssignments(false);
      }
    },
    [canManageJobAssignments, classId, showFeedback],
  );

  const handleSyncStudentsForJob = useCallback(
    async ({ jobName = "", studentUids = [], students = [] }) => {
      if (!canManageJobAssignments) {
        showFeedback("직업을 배정할 권한이 없습니다.", "error");
        return { success: false };
      }

      if (!classId) {
        showFeedback("학급 정보를 확인한 뒤 다시 시도해 주세요.", "error");
        return { success: false };
      }

      const normalizedJobName = String(jobName || "").trim();
      if (!normalizedJobName || normalizedJobName === EMPTY_JOB_VALUE) {
        showFeedback("배정 기준이 되는 직업을 먼저 선택해 주세요.", "info");
        return { success: false };
      }

      const normalizedStudents = (students || [])
        .filter((student) => student?.uid)
        .map((student) => ({
          uid: String(student.uid || "").trim(),
          currentJobs: normalizeStudentJobList(
            student.jobs || (student.job ? [student.job] : []),
          ),
        }))
        .filter((student) => student.uid);

      if (normalizedStudents.length === 0) {
        showFeedback("배정할 학생 정보를 먼저 불러와 주세요.", "info");
        return { success: false };
      }

      const selectedStudentUidSet = new Set(normalizeStudentUids(studentUids));
      const changedAssignments = [];

      setIsSavingAssignments(true);
      try {
        normalizedStudents.forEach((student) => {
          const hasJob = student.currentJobs.includes(normalizedJobName);
          const shouldHaveJob = selectedStudentUidSet.has(student.uid);

          if (hasJob === shouldHaveJob) return;

          const nextJobs = shouldHaveJob
            ? normalizeStudentJobList([...student.currentJobs, normalizedJobName])
            : student.currentJobs.filter((currentJob) => currentJob !== normalizedJobName);
          changedAssignments.push({
            studentUid: student.uid,
            jobs: nextJobs,
          });
        });

        if (changedAssignments.length === 0) {
          showFeedback("변경된 직업 배정이 없습니다.", "info");
          return { success: true, updatedCount: 0 };
        }

        const result = await assignStudentJobs({
          classId,
          source: "job_target_sync",
          assignments: changedAssignments,
        });
        const updateCount = result.updatedCount;
        showFeedback(
          `${normalizedJobName} 배정을 ${updateCount}명에게 반영했습니다.`,
          "success",
        );
        return { success: true, updatedCount: updateCount };
      } catch (error) {
        showFeedback(
          error?.message || "직업 배정을 저장하는 중 문제가 발생했습니다.",
          "error",
        );
        return { success: false, error };
      } finally {
        setIsSavingAssignments(false);
      }
    },
    [canManageJobAssignments, classId, showFeedback],
  );

  const handleApplyStudentJobAssignments = useCallback(
    async ({ assignments = [] } = {}) => {
      if (!canManageJobAssignments) {
        showFeedback("직업을 배정할 권한이 없습니다.", "error");
        return { success: false };
      }

      if (!classId) {
        showFeedback("학급 정보를 확인한 뒤 다시 시도해 주세요.", "error");
        return { success: false };
      }

      const normalizedAssignments = normalizeAssignmentRows(assignments);
      if (normalizedAssignments.length === 0) {
        showFeedback("적용할 직업 변경이 없습니다.", "info");
        return { success: false };
      }

      setIsSavingAssignments(true);
      try {
        const result = await assignStudentJobs({
          classId,
          source: "assignment_queue",
          assignments: normalizedAssignments,
        });
        showFeedback(
          `${result.updatedCount}명의 직업 변경을 적용했습니다.`,
          "success",
        );
        return {
          success: true,
          updatedCount: result.updatedCount,
        };
      } catch (error) {
        showFeedback(
          error?.message || "직업 변경을 적용하는 중 문제가 발생했습니다.",
          "error",
        );
        return { success: false, error };
      } finally {
        setIsSavingAssignments(false);
      }
    },
    [canManageJobAssignments, classId, showFeedback],
  );

  return {
    canManageJobAssignments,
    isSavingAssignments,
    handleAssignJobsToStudents,
    handleReplaceStudentJobs: handleAssignJobsToStudents,
    handleSyncStudentsForJob,
    handleApplyStudentJobAssignments,
  };
};
