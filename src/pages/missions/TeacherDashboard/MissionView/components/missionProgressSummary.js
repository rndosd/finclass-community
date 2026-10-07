import { isMissionAssignedToStudent } from "../../../utils/missionEligibility";

const APPROVED_STATUSES = new Set(["approved", "late-approved"]);
const PENDING_STATUSES = new Set(["pending", "late"]);

function buildStatusSet(values = []) {
  return new Set(
    Array.isArray(values) ? values.filter((value) => typeof value === "string" && value) : [],
  );
}

function buildFallbackStatusSummary(mission = {}) {
  const completions =
    mission?.completions && typeof mission.completions === "object"
      ? mission.completions
      : {};
  const submissionsIndex =
    mission?.submissionsIndex && typeof mission.submissionsIndex === "object"
      ? mission.submissionsIndex
      : {};
  const approvedStudentUids = new Set();
  const pendingStudentUids = new Set();

  [
    ...Object.keys(completions),
    ...Object.keys(submissionsIndex),
  ].forEach((studentUid) => {
    const status = completions?.[studentUid]?.status;
    if (APPROVED_STATUSES.has(status)) {
      approvedStudentUids.add(studentUid);
      return;
    }
    if (
      PENDING_STATUSES.has(status) ||
      (!!mission?.requireSubmissionForm && !!submissionsIndex?.[studentUid])
    ) {
      pendingStudentUids.add(studentUid);
    }
  });

  return {
    approvedStudentUids,
    pendingStudentUids,
  };
}

export function getMissionProgressSummary(mission = {}, studentMatrix = []) {
  const statusSummary =
    mission?.statusSummary && typeof mission.statusSummary === "object"
      ? {
          approvedStudentUids: buildStatusSet(
            mission.statusSummary.approvedStudentUids,
          ),
          pendingStudentUids: buildStatusSet(
            mission.statusSummary.pendingStudentUids,
          ),
        }
      : buildFallbackStatusSummary(mission);

  const targetUids = (studentMatrix || [])
    .filter((student) => student?.role !== "teacher" && student?.role !== "admin")
    .filter((student) => isMissionAssignedToStudent(mission, student, student.uid))
    .map((student) => student.uid);

  let approvedCount = 0;
  let pendingCount = 0;
  targetUids.forEach((studentUid) => {
    if (statusSummary.approvedStudentUids.has(studentUid)) {
      approvedCount += 1;
      return;
    }
    if (statusSummary.pendingStudentUids.has(studentUid)) {
      pendingCount += 1;
    }
  });

  const targetCount = targetUids.length;
  const completionRate =
    targetCount > 0 ? Math.round((approvedCount / targetCount) * 100) : 0;

  return {
    approvedCount,
    pendingCount,
    targetCount,
    completionRate,
    isAllApproved: targetCount > 0 && approvedCount >= targetCount,
  };
}

export default getMissionProgressSummary;
