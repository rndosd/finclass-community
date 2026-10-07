"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildActivityLineId,
    buildPeriodSettlementId,
    buildPeriodTaxIncomeDescription,
    buildPreview,
    getPreviousKstDateKey,
    getOutstandingDailyDateKeys,
    groupRows,
    isDailyScheduleEnabled,
} = require("../src/taxPeriodSettlement").__private;

const row = ({ id, path, sourceKey, taxCategory, amount, taxableAmount }) => ({
    id,
    path,
    studentUid: `student-${id}`,
    studentName: id,
    description: id,
    taxEvent: {
        sourceKey,
        taxCategory,
        taxType: `${sourceKey}_tax`,
        amount,
        taxableAmount,
        taxRate: null,
        dateKey: "2026-07-11",
    },
});

test("groups period rows by category and source", () => {
    const rows = [
        row({
            id: "a",
            path: "classes/c/students/s1/activityLogs/a",
            sourceKey: "payrollSalary",
            taxCategory: "withholding",
            amount: 100,
            taxableAmount: 1000,
        }),
        row({
            id: "b",
            path: "classes/c/students/s2/activityLogs/b",
            sourceKey: "payrollSalary",
            taxCategory: "withholding",
            amount: 50,
            taxableAmount: 500,
        }),
    ];

    const groups = groupRows(rows);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].amount, 150);
    assert.equal(groups[0].taxableAmount, 1500);
    assert.equal(groups[0].detailCount, 2);

    const preview = buildPreview({
        rows,
        groups,
        startDateKey: "2026-07-11",
        endDateKey: "2026-07-11",
    });
    assert.equal(preview.amount, 150);
    assert.equal(preview.detailCount, 2);
});

test("uses a stable path-based line id to avoid cross-student collisions", () => {
    const first = buildActivityLineId({ path: "classes/c/students/s1/activityLogs/same" });
    const second = buildActivityLineId({ path: "classes/c/students/s2/activityLogs/same" });

    assert.equal(first, buildActivityLineId({
        path: "classes/c/students/s1/activityLogs/same",
    }));
    assert.notEqual(first, second);
});

test("builds a deterministic period settlement id", () => {
    assert.equal(
        buildPeriodSettlementId("2026-07-01", "2026-07-10"),
        "tax_period_2026-07-01__2026-07-10",
    );
});

test("uses a concise Korean source label in treasury entries", () => {
    assert.equal(
        buildPeriodTaxIncomeDescription({
            startDateKey: "2026-08-27",
            endDateKey: "2026-08-27",
            sourceKey: "marketplaceFee",
        }),
        "중고마켓 수수료 합계",
    );
    assert.equal(
        buildPeriodTaxIncomeDescription({
            startDateKey: "2026-08-01",
            endDateKey: "2026-08-27",
            sourceKey: "payrollSalary",
        }),
        "급여 합계",
    );
});

test("daily settlement targets the completed previous Seoul date", () => {
    assert.equal(
        getPreviousKstDateKey("2026-08-27T15:15:00.000Z"),
        "2026-08-27",
    );
});

test("collects unique outstanding tax dates in chronological order", () => {
    assert.deepEqual(
        getOutstandingDailyDateKeys([
            { taxEvent: { dateKey: "2026-08-26" } },
            { taxEvent: { dateKey: "2026-08-24" } },
            { taxEvent: { dateKey: "2026-08-26" } },
            { taxEvent: { dateKey: null } },
        ]),
        ["2026-08-24", "2026-08-26"],
    );
});

test("daily settlement runs only when every schedule gate is enabled", () => {
    const enabled = {
        taxPolicy: {
            periodIncomeSettlement: {
                enabled: true,
                dailyAggregationEnabled: true,
                scheduleEnabled: true,
            },
        },
    };
    assert.equal(isDailyScheduleEnabled(enabled), true);
    assert.equal(
        isDailyScheduleEnabled({
            taxPolicy: {
                periodIncomeSettlement: {
                    ...enabled.taxPolicy.periodIncomeSettlement,
                    scheduleEnabled: false,
                },
            },
        }),
        false,
    );
});
