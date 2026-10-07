"use strict";

const DAY_INDEX = Object.freeze({
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
});

const TARGET_MODES = new Set(["all_jobs", "selected_jobs"]);
const ALLOWED_INTERVAL_WEEKS = new Set([1, 2, 3, 4]);
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateKey(value) {
    const normalized = String(value || "").trim();
    if (!DATE_KEY_PATTERN.test(normalized)) return null;
    const [year, month, day] = normalized.split("-").map(Number);
    const utcMs = Date.UTC(year, month - 1, day);
    const parsed = new Date(utcMs);
    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
    ) {
        return null;
    }
    return { key: normalized, year, month, day, utcMs };
}

function addDaysToDateKey(value, days) {
    const parsed = parseDateKey(value);
    if (!parsed) throw new Error("급여 기간 시작일이 올바르지 않습니다.");
    return new Date(parsed.utcMs + Number(days || 0) * DAY_MS)
        .toISOString()
        .slice(0, 10);
}

function normalizeJobNames(value) {
    const raw = Array.isArray(value) ? value : value ? [value] : [];
    return Array.from(new Set(raw
        .map((entry) => String(entry || "").trim())
        .filter((entry) => entry && entry !== "없음")));
}

function normalizePayrollAutomationInput(input = {}) {
    const enabled = input.enabled === true;
    const numberOfWeeks = Number(input.numberOfWeeks || 1);
    const dayOfWeek = String(input.dayOfWeek || "friday").trim().toLowerCase();
    const time = String(input.time || "15:00").trim();
    const targetMode = TARGET_MODES.has(input.targetMode)
        ? input.targetMode
        : "all_jobs";
    const selectedJobNames = normalizeJobNames(input.selectedJobNames).slice(0, 100);
    const firstPaymentDate = String(input.firstPaymentDate || "").trim();
    let periodStartDate = String(input.periodStartDate || "").trim();

    if (!Object.prototype.hasOwnProperty.call(DAY_INDEX, dayOfWeek)) {
        throw new Error("자동 지급 요일이 올바르지 않습니다.");
    }
    if (!TIME_PATTERN.test(time)) {
        throw new Error("자동 지급 시간이 올바르지 않습니다.");
    }
    if (!ALLOWED_INTERVAL_WEEKS.has(numberOfWeeks)) {
        throw new Error("자동 지급 주기는 1주부터 4주까지 선택할 수 있습니다.");
    }
    const parsedFirstPaymentDate = parseDateKey(firstPaymentDate);
    if (firstPaymentDate && !parsedFirstPaymentDate) {
        throw new Error("첫 지급일이 올바르지 않습니다.");
    }
    if (
        parsedFirstPaymentDate &&
        new Date(parsedFirstPaymentDate.utcMs).getUTCDay() !== DAY_INDEX[dayOfWeek]
    ) {
        throw new Error("첫 지급일은 선택한 지급 요일과 같아야 합니다.");
    }
    if (parsedFirstPaymentDate) {
        periodStartDate = addDaysToDateKey(firstPaymentDate, numberOfWeeks * -7);
    }
    if (!parseDateKey(periodStartDate)) {
        throw new Error("급여 기간 시작일이 올바르지 않습니다.");
    }
    if (enabled && targetMode === "selected_jobs" && selectedJobNames.length === 0) {
        throw new Error("자동 지급 대상 직업을 하나 이상 선택해 주세요.");
    }

    return {
        enabled,
        cadence: "weekly",
        numberOfWeeks,
        dayOfWeek,
        time,
        targetMode,
        selectedJobNames,
        firstPaymentDate: parsedFirstPaymentDate ? firstPaymentDate : null,
        periodStartDate,
    };
}

function dateKeyTimeToKstInstant(dateKey, time) {
    const parsed = parseDateKey(dateKey);
    const match = TIME_PATTERN.exec(String(time || ""));
    if (!parsed || !match) throw new Error("자동 지급 일정이 올바르지 않습니다.");
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return new Date(Date.UTC(
        parsed.year,
        parsed.month - 1,
        parsed.day,
        hour - 9,
        minute,
    ));
}

function resolveFirstPayrollRunAt({
    periodStartDate,
    firstPaymentDate = null,
    numberOfWeeks = 1,
    dayOfWeek,
    time,
    now = new Date(),
}) {
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (firstPaymentDate) {
        const parsedFirstPaymentDate = parseDateKey(firstPaymentDate);
        if (
            !parsedFirstPaymentDate ||
            new Date(parsedFirstPaymentDate.utcMs).getUTCDay() !== DAY_INDEX[dayOfWeek]
        ) {
            throw new Error("첫 지급일은 선택한 지급 요일과 같아야 합니다.");
        }
        const firstRunAt = dateKeyTimeToKstInstant(firstPaymentDate, time);
        if (firstRunAt.getTime() <= nowMs) {
            throw new Error("첫 지급일과 시간은 현재보다 이후여야 합니다.");
        }
        return firstRunAt;
    }

    const periodEndDate = addDaysToDateKey(periodStartDate, numberOfWeeks * 7 - 1);
    const periodEnd = parseDateKey(periodEndDate);
    const targetDayIndex = DAY_INDEX[dayOfWeek];
    if (!periodEnd || targetDayIndex === undefined) {
        throw new Error("자동 지급 일정을 계산할 수 없습니다.");
    }

    const dayOffset = (targetDayIndex - new Date(periodEnd.utcMs).getUTCDay() + 7) % 7;
    let runDateKey = addDaysToDateKey(periodEndDate, dayOffset);
    let runAt = dateKeyTimeToKstInstant(runDateKey, time);
    while (runAt.getTime() <= nowMs) {
        runDateKey = addDaysToDateKey(runDateKey, 7);
        runAt = dateKeyTimeToKstInstant(runDateKey, time);
    }
    return runAt;
}

function advanceWeeklyPayrollSchedule({
    periodStartDate,
    firstPaymentDate = null,
    nextRunAt,
    numberOfWeeks = 1,
}) {
    const nextRunDate = nextRunAt instanceof Date
        ? nextRunAt
        : new Date(nextRunAt);
    if (Number.isNaN(nextRunDate.getTime())) {
        throw new Error("다음 자동 지급 시각이 올바르지 않습니다.");
    }
    return {
        periodStartDate: addDaysToDateKey(periodStartDate, numberOfWeeks * 7),
        firstPaymentDate: firstPaymentDate
            ? addDaysToDateKey(firstPaymentDate, numberOfWeeks * 7)
            : null,
        nextRunAt: new Date(nextRunDate.getTime() + numberOfWeeks * 7 * DAY_MS),
    };
}

function selectPayrollTargetUids(students = [], settings = {}) {
    const selectedJobs = new Set(normalizeJobNames(settings.selectedJobNames));
    const targetMode = settings.targetMode === "selected_jobs"
        ? "selected_jobs"
        : "all_jobs";

    return students
        .filter((student) => {
            if (!student?.uid) return false;
            if ((student.role || "student") !== "student") return false;
            if (student.deletedAt || student.isDeleted === true || student.status === "deleted") {
                return false;
            }
            const jobs = normalizeJobNames(student.jobs || student.job);
            if (jobs.length === 0) return false;
            if (targetMode === "all_jobs") return true;
            return jobs.some((jobName) => selectedJobs.has(jobName));
        })
        .map((student) => student.uid);
}

module.exports = {
    DAY_INDEX,
    addDaysToDateKey,
    advanceWeeklyPayrollSchedule,
    normalizeJobNames,
    normalizePayrollAutomationInput,
    parseDateKey,
    resolveFirstPayrollRunAt,
    selectPayrollTargetUids,
};
