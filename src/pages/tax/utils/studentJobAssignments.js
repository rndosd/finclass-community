import { doc, serverTimestamp } from "firebase/firestore";

import { db } from "../../../firebase";
import { getPath } from "./taxPathUtils";

export const EMPTY_JOB_VALUE = "\uC5C6\uC74C";

export const normalizeStudentJobList = (jobs = []) => {
  const rawJobs = Array.isArray(jobs) ? jobs : [jobs];

  return Array.from(
    new Set(
      rawJobs
        .map((job) => String(job || "").trim())
        .filter((jobName) => jobName && jobName !== EMPTY_JOB_VALUE),
    ),
  );
};

const buildStudentJobPayload = (jobs = []) => ({
  jobs,
  job: jobs[0] || EMPTY_JOB_VALUE,
  lastUpdated: serverTimestamp(),
});

const buildStudentJobAssignmentPayload = ({
  studentUid,
  jobs = [],
  source = "",
} = {}) => {
  const trimmedSource = String(source || "").trim();

  return {
    studentUid: String(studentUid || "").trim(),
    jobs,
    job: jobs[0] || EMPTY_JOB_VALUE,
    updatedAt: serverTimestamp(),
    ...(trimmedSource ? { source: trimmedSource } : {}),
  };
};

export const getStudentJobAssignmentRef = (classId, studentUid) =>
  doc(db, `classes/${classId}/studentJobAssignments/${studentUid}`);

export const queueStudentJobWrite = (
  writer,
  {
    classId,
    studentUid,
    jobs = [],
    studentRef = null,
    source = "",
  } = {},
) => {
  const normalizedStudentUid = String(studentUid || "").trim();
  if (!classId || !normalizedStudentUid || !writer?.update || !writer?.set) {
    return [];
  }

  const normalizedJobs = normalizeStudentJobList(jobs);
  const resolvedStudentRef =
    studentRef ||
    doc(db, getPath("student", classId, { studentUid: normalizedStudentUid }));

  writer.update(resolvedStudentRef, buildStudentJobPayload(normalizedJobs));
  writer.set(
    getStudentJobAssignmentRef(classId, normalizedStudentUid),
    buildStudentJobAssignmentPayload({
      studentUid: normalizedStudentUid,
      jobs: normalizedJobs,
      source,
    }),
    { merge: true },
  );

  return normalizedJobs;
};
