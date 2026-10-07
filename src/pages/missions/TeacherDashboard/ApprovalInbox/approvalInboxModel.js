export const isPendingRequest = (status) => status === "pending" || status === "late";
export const usesSubmission = (mission) => mission?.type === "challenge" || !!mission?.requireSubmissionForm;
export const studentUid = (student) => student.uid || student.id;
export const requestKey = (missionId, uid, attemptId = "regular") => `${missionId}/${uid}/${attemptId}`;

export function toRequestDate(value) {
  if (!value) return null;
  const date = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Canonical state owns the pending status. Legacy roots are read only for
// missions that have not been migrated; never resurrect a stale root status.
export function buildPendingGroups(missions, states, students) {
  const members = new Map(students.map((student) => [studentUid(student), student]));
  return missions.filter((mission) => !mission.autoApprove).map((mission) => {
    const ownStates = states.filter((state) => state.missionId === mission.id);
    const always = mission.type === "always";
    const rows = always ? [] : (mission.stateStorageVersion === 2
      ? ownStates.filter((state) => state.kind === "regular" && state.sourceStorageVersion === 2)
        .map((state) => [state.studentUid, state.completion, state.submissionId])
      : Object.entries(mission.completions || {}).map(([uid, completion]) => [uid, completion, mission.submissionsIndex?.[uid]]))
      .filter(([uid, completion]) => members.has(uid) && isPendingRequest(completion?.status))
      .map(([uid, completion, submissionId]) => ({
        key: requestKey(mission.id, uid, submissionId || completion.submissionId || "regular"), uid, student: members.get(uid),
        submissionId: submissionId || completion.submissionId || null,
        feedback: completion.feedback || "", status: completion.status,
        submittedAt: completion.submittedAt || completion.completedAt || completion.requestedAt,
        preview: completion.contentPreview || "", completion,
      })).sort((a, b) => (toRequestDate(a.submittedAt)?.getTime() || 0) - (toRequestDate(b.submittedAt)?.getTime() || 0));
    const pendingCount = always ? ownStates.reduce((sum, state) => sum + Math.max(0, Number(state.pendingCount) || 0), 0) : rows.length;
    return { mission, rows, count: pendingCount, states: ownStates, always };
  }).filter((group) => group.count > 0)
    .sort((a, b) => Number(a.always) - Number(b.always) || Number(usesSubmission(a.mission)) - Number(usesSubmission(b.mission)) || a.mission.title.localeCompare(b.mission.title, "ko"));
}
