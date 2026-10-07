"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    advanceWeeklyPayrollSchedule,
    normalizePayrollAutomationInput,
    resolveFirstPayrollRunAt,
    selectPayrollTargetUids,
} = require("../utils/payrollAutomation");

test("normalizes a weekly selected-job payroll setting", () => {
    assert.deepEqual(normalizePayrollAutomationInput({
        enabled: true,
        numberOfWeeks: 2,
        dayOfWeek: "friday",
        time: "15:00",
        targetMode: "selected_jobs",
        selectedJobNames: ["은행원", "은행원", "세무사"],
        firstPaymentDate: "2026-09-11",
    }), {
        enabled: true,
        cadence: "weekly",
        numberOfWeeks: 2,
        dayOfWeek: "friday",
        time: "15:00",
        targetMode: "selected_jobs",
        selectedJobNames: ["은행원", "세무사"],
        firstPaymentDate: "2026-09-11",
        periodStartDate: "2026-08-28",
    });
});

test("rejects selected-job mode without a selected job", () => {
    assert.throws(
        () => normalizePayrollAutomationInput({
            enabled: true,
            dayOfWeek: "friday",
            time: "15:00",
            targetMode: "selected_jobs",
            selectedJobNames: [],
            periodStartDate: "2026-08-26",
        }),
        /하나 이상 선택/,
    );
});

test("allows an invalidated selected-job setting to be disabled", () => {
    const normalized = normalizePayrollAutomationInput({
        enabled: false,
        dayOfWeek: "friday",
        time: "15:00",
        targetMode: "selected_jobs",
        selectedJobNames: [],
        periodStartDate: "2026-08-26",
    });

    assert.equal(normalized.enabled, false);
    assert.deepEqual(normalized.selectedJobNames, []);
});

test("schedules the first payday on the configured weekday after the period starts", () => {
    const runAt = resolveFirstPayrollRunAt({
        periodStartDate: "2026-08-26",
        dayOfWeek: "friday",
        time: "15:00",
        now: new Date("2026-08-25T00:00:00.000Z"),
    });
    assert.equal(runAt.toISOString(), "2026-09-04T06:00:00.000Z");
});

test("uses the teacher-selected first payment date exactly", () => {
    const runAt = resolveFirstPayrollRunAt({
        periodStartDate: "2026-08-28",
        firstPaymentDate: "2026-09-11",
        numberOfWeeks: 2,
        dayOfWeek: "friday",
        time: "15:00",
        now: new Date("2026-08-25T00:00:00.000Z"),
    });
    assert.equal(runAt.toISOString(), "2026-09-11T06:00:00.000Z");
});

test("rejects a first payment date on a different weekday", () => {
    assert.throws(
        () => normalizePayrollAutomationInput({
            enabled: true,
            numberOfWeeks: 1,
            dayOfWeek: "friday",
            time: "15:00",
            targetMode: "all_jobs",
            firstPaymentDate: "2026-09-10",
        }),
        /지급 요일과 같아야/,
    );
});

test("schedules a multi-week payroll after the full pay period", () => {
    const runAt = resolveFirstPayrollRunAt({
        periodStartDate: "2026-08-26",
        numberOfWeeks: 2,
        dayOfWeek: "friday",
        time: "15:00",
        now: new Date("2026-08-25T00:00:00.000Z"),
    });
    assert.equal(runAt.toISOString(), "2026-09-11T06:00:00.000Z");
});

test("advances period and run time by the configured interval", () => {
    const next = advanceWeeklyPayrollSchedule({
        periodStartDate: "2026-08-26",
        firstPaymentDate: "2026-09-04",
        nextRunAt: new Date("2026-09-04T06:00:00.000Z"),
        numberOfWeeks: 3,
    });
    assert.equal(next.periodStartDate, "2026-09-16");
    assert.equal(next.firstPaymentDate, "2026-09-25");
    assert.equal(next.nextRunAt.toISOString(), "2026-09-25T06:00:00.000Z");
});

test("selects all employed students or only students holding selected jobs", () => {
    const students = [
        { uid: "a", role: "student", jobs: ["은행원"] },
        { uid: "b", role: "student", jobs: ["세무사", "방송부"] },
        { uid: "c", role: "student", jobs: [] },
        { uid: "d", role: "teacher", jobs: ["은행원"] },
        { uid: "e", role: "student", jobs: ["은행원"], status: "deleted" },
    ];

    assert.deepEqual(selectPayrollTargetUids(students, { targetMode: "all_jobs" }), ["a", "b"]);
    assert.deepEqual(selectPayrollTargetUids(students, {
        targetMode: "selected_jobs",
        selectedJobNames: ["세무사"],
    }), ["b"]);
});
