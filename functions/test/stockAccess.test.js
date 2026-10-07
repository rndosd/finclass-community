const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveStockAccess } = require("../utils/stockAccess");

const snap = (data, id = "doc") => ({
    id,
    exists: data !== undefined,
    data: () => data,
});

const createDb = ({ settings = {}, categories = [], registrations = {} } = {}) => ({
    doc(path) {
        return {
            async get() {
                if (path.endsWith("/config/stockMarket")) return snap(settings);
                if (path.startsWith("stockCatalogRegistrations/")) {
                    const ticker = path.split("/").pop();
                    return snap(registrations[ticker]);
                }
                return snap(undefined);
            },
        };
    },
    collection() {
        return {
            async get() {
                return {
                    forEach(callback) {
                        categories.forEach((category, index) =>
                            callback(snap(category, category.id || `category-${index}`)),
                        );
                    },
                };
            },
        };
    },
});

test("selected-student category reveals a hidden stock to an allowed student", async () => {
    const db = createDb({
        settings: { hiddenStocks: { CPER: true } },
        categories: [{
            accessMode: "selected_students",
            allowedStudentUids: ["student-a"],
            symbols: [{ ticker: "CPER" }],
        }],
    });

    const result = await resolveStockAccess({
        db,
        classId: "class-a",
        uid: "student-a",
        symbol: "cper",
        role: "student",
    });

    assert.deepEqual(result, { allowed: true, reason: "category_student_grant" });
});

test("restricted stock is denied to a student outside the category allowlist", async () => {
    const db = createDb({
        categories: [{
            accessMode: "selected_students",
            allowedStudentUids: ["student-b"],
            symbols: ["USO"],
        }],
    });

    const result = await resolveStockAccess({
        db,
        classId: "class-a",
        uid: "student-a",
        symbol: "USO",
        role: "student",
    });

    assert.equal(result.allowed, false);
    assert.equal(result.reason, "category_student_required");
});

test("duplicate categories grant access when any active category is public", async () => {
    const db = createDb({
        categories: [
            {
                accessMode: "selected_students",
                allowedStudentUids: ["student-b"],
                symbols: ["USO"],
            },
            {
                accessMode: "all_students",
                symbols: ["USO"],
            },
        ],
    });

    const result = await resolveStockAccess({
        db,
        classId: "class-a",
        uid: "student-a",
        symbol: "USO",
        role: "student",
    });

    assert.deepEqual(result, { allowed: true, reason: "public" });
});

test("duplicate restricted categories grant access when any allowlist contains the student", async () => {
    const db = createDb({
        categories: [
            {
                accessMode: "selected_students",
                allowedStudentUids: ["student-b"],
                symbols: ["CPER"],
            },
            {
                accessMode: "selected_students",
                allowedStudentUids: ["student-a"],
                symbols: ["CPER"],
            },
        ],
    });

    const result = await resolveStockAccess({
        db,
        classId: "class-a",
        uid: "student-a",
        symbol: "CPER",
        role: "student",
    });

    assert.deepEqual(result, { allowed: true, reason: "category_student_grant" });
});

test("legacy credential category stays restricted until a teacher selects students", async () => {
    const db = createDb({
        categories: [{
            accessMode: "credential_required",
            requiredCertificateId: "fund-manager",
            symbols: ["IBIT"],
        }],
    });

    const result = await resolveStockAccess({
        db,
        classId: "class-a",
        uid: "student-a",
        symbol: "IBIT",
        role: "student",
    });

    assert.equal(result.allowed, false);
});

test("teacher bypasses class visibility restrictions", async () => {
    const result = await resolveStockAccess({
        db: createDb({ settings: { hiddenStocks: { WOOD: true } } }),
        classId: "class-a",
        uid: "teacher-a",
        symbol: "WOOD",
        role: "teacher",
    });

    assert.deepEqual(result, { allowed: true, reason: "staff" });
});

test("advanced ETF cannot be bought before a teacher assigns it", async () => {
    const result = await resolveStockAccess({
        db: createDb(),
        classId: "class-a",
        uid: "student-a",
        symbol: "EWY",
        role: "student",
    });

    assert.deepEqual(result, { allowed: false, reason: "advanced_unassigned" });
});

test("advanced ETF assigned to all students becomes buyable", async () => {
    const result = await resolveStockAccess({
        db: createDb({
            categories: [{ accessMode: "all_students", symbols: [{ ticker: "EWY" }] }],
        }),
        classId: "class-a",
        uid: "student-a",
        symbol: "EWY",
        role: "student",
    });

    assert.deepEqual(result, { allowed: true, reason: "public" });
});

test("advanced stock cannot be bought before a teacher assigns it", async () => {
    const result = await resolveStockAccess({
        db: createDb(),
        classId: "class-a",
        uid: "student-a",
        symbol: "AON",
        role: "student",
    });

    assert.deepEqual(result, { allowed: false, reason: "advanced_unassigned" });
});

test("advanced stock assigned to all students becomes buyable", async () => {
    const result = await resolveStockAccess({
        db: createDb({
            categories: [{ accessMode: "all_students", symbols: [{ ticker: "AON" }] }],
        }),
        classId: "class-a",
        uid: "student-a",
        symbol: "AON",
        role: "student",
    });

    assert.deepEqual(result, { allowed: true, reason: "public" });
});

test("teacher-registered stock stays denied until it is assigned", async () => {
    const result = await resolveStockAccess({
        db: createDb({ registrations: { NEW: { defaultVisible: false } } }),
        classId: "class-a",
        uid: "student-a",
        symbol: "NEW",
        role: "student",
    });

    assert.deepEqual(result, { allowed: false, reason: "advanced_unassigned" });
});

test("teacher-registered stock becomes buyable after public assignment", async () => {
    const result = await resolveStockAccess({
        db: createDb({
            registrations: { NEW: { defaultVisible: false } },
            categories: [{ accessMode: "all_students", symbols: ["NEW"] }],
        }),
        classId: "class-a",
        uid: "student-a",
        symbol: "NEW",
        role: "student",
    });

    assert.deepEqual(result, { allowed: true, reason: "public" });
});

test("all-students category does not override the teacher hidden list", async () => {
    const result = await resolveStockAccess({
        db: createDb({
            settings: { hiddenStocks: { USO: true } },
            categories: [{ accessMode: "all_students", symbols: ["USO"] }],
        }),
        classId: "class-a",
        uid: "student-a",
        symbol: "USO",
        role: "student",
    });

    assert.deepEqual(result, { allowed: false, reason: "class_hidden" });
});
