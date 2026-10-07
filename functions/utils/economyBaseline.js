"use strict";

const admin = require("../firebaseAdminCompat");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const ECONOMY_BASELINE_VERSION = 1;
const STUDENT_PAYROLL_CACHE_VERSION = 1;
const WRITE_BATCH_SIZE = 450;
const EMPTY_JOB_VALUES = new Set(["\uC5C6\uC74C", "\uBB34\uC9C1"]);

const economyBaselineRef = (classId) =>
    db.doc(`classes/${classId}/dashboardSummary/economyBaseline`);

function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function roundMetric(value, digits = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    const multiplier = 10 ** digits;
    return Math.round(number * multiplier) / multiplier;
}

function normalizeJobNames(jobs = []) {
    const rawJobs = Array.isArray(jobs) ? jobs : (jobs ? [jobs] : []);
    return Array.from(
        new Set(
            rawJobs
                .map((job) => String(job || "").trim())
                .filter((job) => job && !EMPTY_JOB_VALUES.has(job)),
        ),
    );
}

function isActiveStudent(studentData = {}) {
    const role = String(studentData.role || "student").toLowerCase();
    const status = String(studentData.status || "").toLowerCase();
    return role === "student" && status !== "deleted" && status !== "inactive";
}

function isMonetaryAggregateExcluded(studentData = {}) {
    return studentData?.statsExclusion?.monetaryAggregates === true;
}

function normalizeJobDefinition(docSnap) {
    const data = docSnap.data() || {};
    const name = String(data.name || "").trim();
    if (!name) return null;

    return {
        id: docSnap.id,
        name,
        baseSalary: roundMetric(data.baseSalary),
        targetHeadcount: Number.isFinite(Number(data.targetHeadcount))
            ? Math.max(0, Math.floor(Number(data.targetHeadcount)))
            : null,
    };
}

function buildJobLookup(jobDefinitions = []) {
    const lookup = new Map();
    jobDefinitions.forEach((jobDefinition) => {
        if (!jobDefinition?.name) return;
        lookup.set(jobDefinition.name, jobDefinition);
    });
    return lookup;
}

async function loadJobDefinitions(classId) {
    const snapshot = await db.collection(`classes/${classId}/jobDefinitions`).get();
    return snapshot.docs
        .map((docSnap) => normalizeJobDefinition(docSnap))
        .filter(Boolean);
}

function buildStudentPayrollCache(studentData = {}, jobDefinitions = []) {
    const jobLookup = buildJobLookup(jobDefinitions);
    const jobs = normalizeJobNames(studentData.jobs || studentData.job);
    const jobSalaryBreakdown = [];
    const missingJobNames = [];
    let currentWeeklySalary = 0;

    jobs.forEach((jobName) => {
        const definition = jobLookup.get(jobName);
        if (!definition) {
            missingJobNames.push(jobName);
            return;
        }

        currentWeeklySalary += definition.baseSalary;
        jobSalaryBreakdown.push({
            jobId: definition.id,
            jobName,
            baseSalary: definition.baseSalary,
        });
    });

    return {
        salaryCacheVersion: STUDENT_PAYROLL_CACHE_VERSION,
        currentWeeklySalary: roundMetric(currentWeeklySalary),
        assignedJobCount: jobs.length,
        paidJobCount: jobSalaryBreakdown.length,
        jobSalaryBreakdown,
        missingJobNames,
    };
}

function normalizeExistingPayrollCache(payroll = {}) {
    return {
        salaryCacheVersion: Number(payroll.salaryCacheVersion || 0),
        currentWeeklySalary: roundMetric(payroll.currentWeeklySalary),
        assignedJobCount: Math.max(0, Math.floor(Number(payroll.assignedJobCount || 0))),
        paidJobCount: Math.max(0, Math.floor(Number(payroll.paidJobCount || 0))),
        jobSalaryBreakdown: Array.isArray(payroll.jobSalaryBreakdown)
            ? payroll.jobSalaryBreakdown.map((job) => ({
                jobId: String(job.jobId || ""),
                jobName: String(job.jobName || "").trim(),
                baseSalary: roundMetric(job.baseSalary),
            }))
            : [],
        missingJobNames: Array.isArray(payroll.missingJobNames)
            ? payroll.missingJobNames.map((name) => String(name || "").trim()).filter(Boolean)
            : [],
    };
}

function arePayrollCachesEqual(left = {}, right = {}) {
    if (left.salaryCacheVersion !== right.salaryCacheVersion) return false;
    if (left.currentWeeklySalary !== right.currentWeeklySalary) return false;
    if (left.assignedJobCount !== right.assignedJobCount) return false;
    if (left.paidJobCount !== right.paidJobCount) return false;

    const leftBreakdown = left.jobSalaryBreakdown || [];
    const rightBreakdown = right.jobSalaryBreakdown || [];
    if (leftBreakdown.length !== rightBreakdown.length) return false;
    for (let index = 0; index < leftBreakdown.length; index += 1) {
        const leftJob = leftBreakdown[index];
        const rightJob = rightBreakdown[index];
        if (leftJob.jobId !== rightJob.jobId) return false;
        if (leftJob.jobName !== rightJob.jobName) return false;
        if (leftJob.baseSalary !== rightJob.baseSalary) return false;
    }

    const leftMissing = left.missingJobNames || [];
    const rightMissing = right.missingJobNames || [];
    if (leftMissing.length !== rightMissing.length) return false;
    return leftMissing.every((jobName, index) => jobName === rightMissing[index]);
}

function buildStudentPayrollCachePatch(studentData = {}, jobDefinitions = []) {
    const nextCache = buildStudentPayrollCache(studentData, jobDefinitions);
    const currentCache = normalizeExistingPayrollCache(studentData.payroll || {});

    if (arePayrollCachesEqual(currentCache, nextCache)) {
        return null;
    }

    return {
        "payroll.salaryCacheVersion": nextCache.salaryCacheVersion,
        "payroll.currentWeeklySalary": nextCache.currentWeeklySalary,
        "payroll.assignedJobCount": nextCache.assignedJobCount,
        "payroll.paidJobCount": nextCache.paidJobCount,
        "payroll.jobSalaryBreakdown": nextCache.jobSalaryBreakdown,
        "payroll.missingJobNames": nextCache.missingJobNames,
        "payroll.salaryComputedAt": FieldValue.serverTimestamp(),
    };
}

function calculateMedian(values = []) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle];
    return roundMetric((sorted[middle - 1] + sorted[middle]) / 2);
}

function buildEconomyBaselineSummary({
    students = [],
    jobDefinitions = [],
    source = "rebuild",
} = {}) {
    const jobLookup = buildJobLookup(jobDefinitions);
    const headcountByJob = new Map(jobDefinitions.map((job) => [job.name, 0]));
    const assignedStudents = [];
    const unassignedStudents = [];
    let weeklyPayrollLiability = 0;

    students.forEach((student) => {
        const jobs = normalizeJobNames(student.jobs || student.job);
        if (jobs.length === 0) {
            unassignedStudents.push(student);
            return;
        }

        const weeklySalary = jobs.reduce((sum, jobName) => {
            const definition = jobLookup.get(jobName);
            if (definition) {
                headcountByJob.set(jobName, (headcountByJob.get(jobName) || 0) + 1);
            }
            return sum + toFiniteNumber(definition?.baseSalary);
        }, 0);

        weeklyPayrollLiability += weeklySalary;
        assignedStudents.push({
            uid: student.uid,
            name: student.name || student.displayName || "",
            studentNumber: student.studentNumber ?? null,
            jobs,
            weeklySalary: roundMetric(weeklySalary),
        });
    });

    const salaries = assignedStudents
        .map((student) => student.weeklySalary)
        .filter((salary) => salary > 0);
    const targetShortageJobs = jobDefinitions
        .filter((job) => (
            job.targetHeadcount !== null &&
            (headcountByJob.get(job.name) || 0) < job.targetHeadcount
        ))
        .map((job) => ({
            id: job.id,
            name: job.name,
            baseSalary: job.baseSalary,
            targetHeadcount: job.targetHeadcount,
            assignedHeadcount: headcountByJob.get(job.name) || 0,
            shortage: job.targetHeadcount - (headcountByJob.get(job.name) || 0),
        }))
        .sort((left, right) => right.shortage - left.shortage)
        .slice(0, 10);

    const medianWeeklySalary = calculateMedian(salaries);
    const averageWeeklySalary = assignedStudents.length
        ? roundMetric(weeklyPayrollLiability / assignedStudents.length)
        : 0;

    return {
        summaryVersion: ECONOMY_BASELINE_VERSION,
        source,
        baselineType: "medianWeeklySalary",
        baselineWeeklySalary: medianWeeklySalary,
        activeStudentCount: students.length,
        jobDefinitionCount: jobDefinitions.length,
        assignedStudentCount: assignedStudents.length,
        unassignedStudentCount: unassignedStudents.length,
        assignedStudentRate: students.length
            ? roundMetric(assignedStudents.length / students.length, 3)
            : 0,
        weeklyPayrollLiability: roundMetric(weeklyPayrollLiability),
        averageWeeklySalary,
        medianWeeklySalary,
        zeroSalaryAssignedCount: assignedStudents.filter(
            (student) => student.weeklySalary <= 0,
        ).length,
        targetShortageJobs,
        unassignedStudents: unassignedStudents.slice(0, 10).map((student) => ({
            uid: student.uid,
            name: student.name || student.displayName || "",
            studentNumber: student.studentNumber ?? null,
        })),
        updatedAt: FieldValue.serverTimestamp(),
    };
}

async function commitUpdatesInChunks(updates = []) {
    let updatedCount = 0;
    for (let index = 0; index < updates.length; index += WRITE_BATCH_SIZE) {
        const batch = db.batch();
        const chunk = updates.slice(index, index + WRITE_BATCH_SIZE);
        chunk.forEach(({ ref, patch }) => {
            batch.update(ref, patch);
        });
        await batch.commit();
        updatedCount += chunk.length;
    }
    return updatedCount;
}

async function rebuildEconomyBaselineCaches(classId, {
    source = "rebuild",
    writeStudentCaches = true,
} = {}) {
    const [jobDefinitions, studentsSnap] = await Promise.all([
        loadJobDefinitions(classId),
        db.collection(`classes/${classId}/students`).get(),
    ]);

    const activeStudents = [];
    const updates = [];

    studentsSnap.forEach((studentDoc) => {
        const studentData = studentDoc.data() || {};
        if (!isActiveStudent(studentData)) return;

        const student = { ...studentData, uid: studentDoc.id };
        if (!isMonetaryAggregateExcluded(studentData)) {
            activeStudents.push(student);
        }

        if (!writeStudentCaches) return;
        const patch = buildStudentPayrollCachePatch(studentData, jobDefinitions);
        if (patch) {
            updates.push({ ref: studentDoc.ref, patch });
        }
    });

    const updatedStudents = await commitUpdatesInChunks(updates);
    const summary = buildEconomyBaselineSummary({
        students: activeStudents,
        jobDefinitions,
        source,
    });

    await economyBaselineRef(classId).set(summary, { merge: false });

    return {
        totalStudents: studentsSnap.size,
        activeStudentCount: activeStudents.length,
        updatedStudents,
        summary,
    };
}

module.exports = {
    ECONOMY_BASELINE_VERSION,
    STUDENT_PAYROLL_CACHE_VERSION,
    buildEconomyBaselineSummary,
    buildStudentPayrollCachePatch,
    isActiveStudent,
    isMonetaryAggregateExcluded,
    loadJobDefinitions,
    normalizeJobNames,
    rebuildEconomyBaselineCaches,
};
