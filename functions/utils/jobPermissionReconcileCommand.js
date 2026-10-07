"use strict";

const {
    computeJobPermissionsFromLookup,
} = require("./permissionSync");

const normalizeStudentUids = (studentUids = []) =>
    Array.from(
        new Set(
            (Array.isArray(studentUids) ? studentUids : [])
                .map((uid) => String(uid || "").trim())
                .filter(Boolean),
        ),
    );

const EMPTY_JOB_VALUE = "없음";

const normalizeJobs = (jobs = []) =>
    Array.from(
        new Set(
            (Array.isArray(jobs) ? jobs : [jobs])
                .map((job) => String(job || "").trim())
                .filter((job) => job && job !== EMPTY_JOB_VALUE),
        ),
    );

const normalizeAssignments = (assignments = []) => {
    const normalizedByStudent = new Map();
    (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
        const studentUid = String(assignment?.studentUid || "").trim();
        if (!studentUid) return;
        normalizedByStudent.set(studentUid, {
            studentUid,
            jobs: normalizeJobs(assignment?.jobs),
        });
    });
    return Array.from(normalizedByStudent.values());
};

const createJobPermissionReconcileCommand = ({
    loadJobPermissionLookup,
    loadStudents,
    synchronizeStudent,
}) => async ({ classId, studentUids = [] } = {}) => {
    const normalizedClassId = String(classId || "").trim();
    const normalizedStudentUids = normalizeStudentUids(studentUids);
    const jobPermissionLookup = await loadJobPermissionLookup(normalizedClassId);
    const students = await loadStudents(normalizedClassId, normalizedStudentUids);
    let updatedCount = 0;

    for (const student of students) {
        const result = await synchronizeStudent({
            classId: normalizedClassId,
            targetUid: student.uid,
            studentData: student.data,
            studentRef: student.ref,
            jobPermissions: computeJobPermissionsFromLookup(
                student.data,
                jobPermissionLookup,
            ),
        });
        if (result?.updated) updatedCount += 1;
    }

    return {
        studentCount: students.length,
        updatedCount,
    };
};

const createStudentJobAssignmentCommand = ({
    loadJobPermissionLookup,
    loadStudents,
    synchronizeStudent,
    writeAssignment,
}) => async ({ classId, assignments = [], source = "" } = {}) => {
    const normalizedClassId = String(classId || "").trim();
    const normalizedSource = String(source || "").trim();
    const normalizedAssignments = normalizeAssignments(assignments);
    const assignmentByStudent = new Map(
        normalizedAssignments.map((assignment) => [assignment.studentUid, assignment]),
    );
    const studentUids = normalizedAssignments.map(({ studentUid }) => studentUid);
    const [jobPermissionLookup, students] = await Promise.all([
        loadJobPermissionLookup(normalizedClassId),
        loadStudents(normalizedClassId, studentUids),
    ]);
    if (students.some((student) => (student.data?.role || "student") !== "student")) {
        throw new Error("학생만 직업을 배정할 수 있습니다.");
    }

    for (const student of students) {
        const assignment = assignmentByStudent.get(student.uid);
        if (!assignment) continue;

        const effectiveStudentData = {
            ...student.data,
            jobs: assignment.jobs,
            job: assignment.jobs[0] || EMPTY_JOB_VALUE,
        };
        await synchronizeStudent({
            classId: normalizedClassId,
            targetUid: student.uid,
            studentData: effectiveStudentData,
            studentRef: student.ref,
            jobPermissions: computeJobPermissionsFromLookup(
                effectiveStudentData,
                jobPermissionLookup,
            ),
            extraUpdates: {
                jobs: effectiveStudentData.jobs,
                job: effectiveStudentData.job,
            },
        });
        await writeAssignment({
            classId: normalizedClassId,
            studentUid: student.uid,
            jobs: assignment.jobs,
            source: normalizedSource,
        });
    }

    return {
        studentCount: students.length,
        updatedCount: students.length,
    };
};

module.exports = {
    createJobPermissionReconcileCommand,
    createStudentJobAssignmentCommand,
    normalizeAssignments,
    normalizeStudentUids,
};
