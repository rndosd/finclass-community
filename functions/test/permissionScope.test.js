"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const { assertTeacherClassScope } = require("../utils/permissionScope");

describe("assertTeacherClassScope", () => {
    test("allows a teacher to access their own class", () => {
        const ctx = { role: "teacher", classId: "class-a" };

        assert.equal(assertTeacherClassScope(ctx, "class-a"), ctx);
    });

    test("rejects a teacher whose token has no classId", () => {
        assert.throws(
            () => assertTeacherClassScope({ role: "teacher", classId: null }, "class-a"),
            (error) => error?.code === "failed-precondition",
        );
    });

    test("rejects a teacher attempting another class", () => {
        assert.throws(
            () =>
                assertTeacherClassScope(
                    { role: "teacher", classId: "class-b" },
                    "class-a",
                ),
            (error) => error?.code === "permission-denied",
        );
    });

    test("does not impose teacher scope rules on an admin", () => {
        const ctx = { role: "admin", classId: null };

        assert.equal(assertTeacherClassScope(ctx, "class-a"), ctx);
    });
});
