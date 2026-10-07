"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");
const { cutoverMissionStudentStates } = require("../utils/cutoverMissionStudentStates");
const { assertMissionApprovalVersions } = require("../utils/missionApprovalVersion");
const root = "classes/sample/missions/task";
const learner = "classes/sample/students/learner";
const statePath = `${learner}/missionState/task`;
const teacherAuth = { uid: "teacher", token: { role: "teacher", classId: "sample" } };
const studentAuth = { uid: "learner", token: { role: "student", classId: "sample" } };
const request = (auth, data = {}) => ({ auth, data: { classId: "sample", missionId: "task", ...data } });
function setup(mission = {}, extra = {}, options = {}) {
    return createCallableHarness({
        "classes/sample": { planType: "FREE" },
        "classes/sample/students/teacher": { role: "teacher", name: "Synthetic Teacher" },
        [learner]: { role: "student", name: "Synthetic Learner", assets: { cash: 0, missionToken: 0 }, creditScore: 0 },
        [root]: { type: "single", stateStorageVersion: 2, title: "Synthetic Task",
            timeWindow: { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" },
            rewards: [{ type: "currency", amount: 10 }, { type: "credit", amount: 2 }, { type: "missionToken", amount: 3 }], ...mission },
        ...extra,
    }, options);
}
const cutover = (h, apply) => cutoverMissionStudentStates(h.db, h.db.doc(root), { apply,
    FieldValue: h.admin.firestore.FieldValue, FieldPath: h.admin.firestore.FieldPath });
const unchangedRoot = (h, original) => {
    assert.deepEqual(h.data.get(root), original);
    assert.equal(h.data.get(statePath).sourceStorageVersion, 2);
};

test("cutover archives exact original fields, deletes nested/literal state only, and reruns without writes", async () => {
    const completion = { status: "late-approved", rewardGranted: true, rewardPayout: { currency: 7 }, taxPostingId: "tax-link", unknownAudit: "keep" };
    const h = setup({ stateStorageVersion: 1, completions: { learner: completion }, "submissionsIndex.learner": "form", updatedAt: "original-date" }, {}, { retryTransaction: true });
    assert.equal((await cutover(h, false)).states, 1);
    assert.equal(h.writes.length, 0);
    await cutover(h, true);
    assert.deepEqual(h.data.get(statePath).completion, completion);
    assert.equal(h.data.get(statePath).submissionId, "form");
    assert.equal(h.data.get(root).updatedAt, "original-date");
    assert.equal(h.data.get(root).completions, undefined);
    assert.equal(h.data.get(root)["submissionsIndex.learner"], undefined);
    const archive = [...h.data.entries()].find(([key]) => key.startsWith("internalMigrations/missionStudentStates/missions/"))[1];
    assert.deepEqual(archive.originalStateFields.completions.learner, completion);
    assert.equal(archive.originalStateFields["submissionsIndex.learner"], "form");
    const count = h.writes.length;
    assert.equal((await cutover(h, true)).outcome, "unchanged");
    assert.equal(h.writes.length, count);
    assert.equal(h.data.get(learner).assets.cash, 0);
});

test("explicit orphan policy archives missing rejected accounts without recreating students or replaying rewards", async () => {
    const orphan = { status: "rejected", feedback: "Historical", unknownAudit: "keep" };
    const h = setup({ stateStorageVersion: 1, completions: { learner: { status: "pending" }, absent: orphan } });
    assert.equal((await cutover(h, false)).outcome, "blocked");
    const options = { archiveMissingRejectedStudents: true, FieldValue: h.admin.firestore.FieldValue, FieldPath: h.admin.firestore.FieldPath };
    const preview = await cutoverMissionStudentStates(h.db, h.db.doc(root), options);
    assert.equal(preview.states, 1);
    assert.equal(preview.archivedMissingStudents, 1);
    assert.equal(h.writes.length, 0);
    await cutoverMissionStudentStates(h.db, h.db.doc(root), { ...options, apply: true });
    assert.equal(h.data.get(root).stateStorageVersion, 2);
    assert.equal(h.data.has("classes/sample/students/absent"), false);
    assert.equal(h.data.has("classes/sample/students/absent/missionState/task"), false);
    const archive = [...h.data.entries()].find(([key]) => key.startsWith("internalMigrations/missionStudentStates/missions/"))[1];
    assert.deepEqual(archive.originalStateFields.completions.absent, orphan);
    assert.equal(h.data.get(learner).assets.cash, 0);
    const count = h.writes.length;
    assert.equal((await cutoverMissionStudentStates(h.db, h.db.doc(root), { ...options, apply: true })).outcome, "unchanged");
    assert.equal(h.writes.length, count);
    for (const completion of [{ status: "pending" }, { status: "rejected", rewardGranted: true }, { status: "rejected", submissionId: "form" }]) {
        const blocked = setup({ stateStorageVersion: 1, completions: { absent: completion } });
        assert.equal((await cutoverMissionStudentStates(blocked.db, blocked.db.doc(root), options)).outcome, "blocked");
        assert.equal(blocked.writes.length, 0);
    }
    const activeProfile = setup({ stateStorageVersion: 1, completions: { absent: orphan } }, { "users/absent": { role: "teacher" } });
    assert.equal((await cutoverMissionStudentStates(activeProfile.db, activeProfile.db.doc(root), options)).outcome, "blocked");
});

test("canonical submission, approval retry, repeated approval and reversal preserve all three rewards without root status writes", async () => {
    const h = setup({}, {}, { retryTransaction: true });
    const original = structuredClone(h.data.get(root));
    const api = h.load("functions/src/missions.js");
    await api.submitMission(request(studentAuth));
    assert.equal(h.data.get(statePath).latestStatus, "pending");
    unchangedRoot(h, original);
    await api.approveMissionBatch(request(teacherAuth, { items: [{ uid: "learner" }] }));
    assert.equal(h.data.get(learner).assets.cash, 10);
    assert.equal(h.data.get(learner).creditScore, 2);
    assert.equal(h.data.get(learner).assets.missionToken, 3);
    unchangedRoot(h, original);
    await api.approveMissionBatch(request(teacherAuth, { items: [{ uid: "learner" }] }));
    await assert.rejects(api.submitMission(request(studentAuth)), error => error.code === "already-exists");
    assert.equal(h.data.get(learner).assets.cash, 10);
    await api.cancelMissionApprovalBatch(request(teacherAuth, { studentUids: ["learner", "learner"] }));
    assert.equal(h.data.get(statePath).latestStatus, "pending");
    assert.equal(h.data.get(statePath).completion.rewardGranted, undefined);
    assert.equal(h.data.get(learner).assets.cash, 0);
    assert.equal(h.data.get(learner).creditScore, 0);
    assert.equal(h.data.get(learner).assets.missionToken, 0);
    await api.cancelMissionApprovalBatch(request(teacherAuth, { studentUids: ["learner"] }));
    assert.equal(h.data.get(learner).assets.cash, 0);
    unchangedRoot(h, original);
});

test("canonical auto approval and form rejection/resubmission/feedback use personal state and original submission body paths", async () => {
    const automatic = setup({ autoApprove: true }, {}, { retryTransaction: true });
    const autoApi = automatic.load("functions/src/missions.js");
    await autoApi.processAutoApproveMission(request(studentAuth));
    await assert.rejects(autoApi.processAutoApproveMission(request(studentAuth)), error => error.code === "already-exists");
    assert.equal(automatic.data.get(learner).assets.cash, 10);
    const h = setup({ requireSubmissionForm: true }, {}, { retryTransaction: true });
    const original = structuredClone(h.data.get(root));
    const api = h.load("functions/src/missions.js");
    await api.submitMission(request(studentAuth, { contentHtml: "<p>Synthetic</p>" }));
    const submissionId = h.data.get(statePath).submissionId;
    await api.rejectSubmissionBatch(request(teacherAuth, { submissionIds: [submissionId], reason: "Revise" }));
    assert.equal(h.data.get(statePath).latestStatus, "rejected");
    await api.submitMission(request(studentAuth, { contentHtml: "<p>Revised</p>" }));
    await api.approveMissionBatch(request(teacherAuth, { items: [{ uid: "learner", submissionId, feedback: "Reviewed" }] }));
    await h.load("functions/src/missionFeedback.js").saveMissionFeedback(request(teacherAuth, { submissionId, feedback: "Feedback" }));
    assert.equal(h.data.get(statePath).completion.feedback, "Feedback");
    assert.equal(h.data.get(`${root}/submissions/${submissionId}`).feedback, "Feedback");
    unchangedRoot(h, original);
});

test("canonical reader permits self and manager, denies peer/class crossover and malformed keys", async () => {
    const h = setup();
    const api = h.load("functions/src/missions.js");
    await api.submitMission(request(studentAuth));
    const read = h.load("functions/src/missionStateReads.js").listRegularMissionStates;
    assert.equal((await read(request(studentAuth, { missionIds: ["task"], studentUid: "learner" }))).missions.task.completions.learner.status, "pending");
    assert.equal((await read(request(teacherAuth, { missionIds: ["task"] }))).missions.task.completions.learner.status, "pending");
    await assert.rejects(read(request(studentAuth, { missionIds: ["task"], studentUid: "other" })), error => error.code === "permission-denied");
    await assert.rejects(read(request({ ...teacherAuth, token: { ...teacherAuth.token, classId: "other" } }, { missionIds: ["task"] })), error => error.code === "permission-denied");
    await assert.rejects(read(request(teacherAuth, { missionIds: ["task"], studentUid: { bad: true } })), error => error.code === "invalid-argument");
});

test("reviewed approvals guard individual state revisions after root updates stop", () => {
    const snap = { exists: true, updateTime: { seconds: 1, nanoseconds: 2 } };
    const resolved = { stateStorageVersion: 2, _studentStateRevisions: { learner: 4 } };
    const fail = (code, message) => Object.assign(new Error(message), { code });
    assert.throws(() => assertMissionApprovalVersions({ expectedMissionUpdateTime: "1:2", expectedStudentStateRevisions: { learner: 3 } }, snap, snap, fail, resolved, ["learner"]), error => error.code === "failed-precondition");
    assert.doesNotThrow(() => assertMissionApprovalVersions({ expectedMissionUpdateTime: "1:2", expectedStudentStateRevisions: { learner: 4 } }, snap, snap, fail, resolved, ["learner"]));
});

test("single form rejection and no-form batch rejection read canonical completion before staging writes", async () => {
    const h = setup({ requireSubmissionForm: true }, {}, { retryTransaction: true });
    const api = h.load("functions/src/missions.js");
    await api.submitMission(request(studentAuth, { contentHtml: "Synthetic" }));
    const submissionId = h.data.get(statePath).submissionId;
    await api.rejectSubmission(request(teacherAuth, { submissionId, reason: "Single review" }));
    assert.equal(h.data.get(statePath).latestStatus, "rejected");
    assert.equal(h.data.get(statePath).completion.feedback, "Single review");
    assert.equal(h.data.get(root).completions, undefined);
    const plain = setup({}, {}, { retryTransaction: true });
    const plainApi = plain.load("functions/src/missions.js");
    await plainApi.submitMission(request(studentAuth));
    await plainApi.rejectMissionCompletionBatch(request(teacherAuth, { studentUids: ["learner"], reason: "Plain review" }));
    assert.equal(plain.data.get(statePath).latestStatus, "rejected");
    assert.equal(plain.data.get(statePath).completion.feedback, "Plain review");
    assert.equal(plain.data.get(root).completions, undefined);
});

test("historical submission feedback does not replace latest state; delegated mission managers can edit current feedback", async () => {
    const h = setup({ requireSubmissionForm: true }, {
        "classes/sample/students/manager": { role: "student", permissions: { mission_admin: true }, name: "Synthetic Manager" },
    });
    await h.load("functions/src/missions.js").submitMission(request(studentAuth, { contentHtml: "Synthetic" }));
    h.data.set(`${root}/submissions/old`, { studentUid: "learner", status: "rejected", feedback: "Old" });
    const api = h.load("functions/src/missionFeedback.js");
    await api.saveMissionFeedback(request(teacherAuth, { submissionId: "old", feedback: "Historical" }));
    assert.equal(h.data.get(`${root}/submissions/old`).feedback, "Historical");
    assert.equal(h.data.get(statePath).completion.feedback, undefined);
    await api.saveMissionFeedback(request({ uid: "manager", token: { role: "student", classId: "sample" } }, { items: [{ uid: "learner", feedback: "Current" }] }));
    assert.equal(h.data.get(statePath).completion.feedback, "Current");
    assert.equal(h.data.get(statePath).completion.feedbackUpdatedBy, "manager");
});
test("an obsolete pending form cannot reapprove an already paid student or replace their current submission state", async () => {
    const h = setup({ requireSubmissionForm: true });
    const api = h.load("functions/src/missions.js");
    await api.submitMission(request(studentAuth, { contentHtml: "Synthetic" }));
    const latest = h.data.get(statePath).submissionId;
    h.data.set(`${root}/submissions/obsolete`, { studentUid: "learner", status: "pending" });
    const oldResult = await api.approveMissionBatch(request(teacherAuth, { items: [{ uid: "learner", submissionId: "obsolete" }] }));
    assert.equal(oldResult.results.success.length, 0);
    assert.equal(h.data.get(learner).assets.cash, 0);
    await api.approveMissionBatch(request(teacherAuth, { items: [{ uid: "learner", submissionId: latest }] }));
    await assert.rejects(api.rejectSubmission(request(teacherAuth, { submissionId: latest })), error => error.code === "failed-precondition");
    const rejected = await api.rejectSubmissionBatch(request(teacherAuth, { submissionIds: ["obsolete"] }));
    assert.equal(rejected.results.success.length, 0);
    assert.equal(h.data.get(statePath).submissionId, latest);
    assert.equal(h.data.get(statePath).latestStatus, "approved");
    assert.equal(h.data.get(learner).assets.cash, 10);
});
test("repeating creation uses the new class version, rejects ordinary students and preserves teacher/mission-manager authorization", async () => {
    for (const auth of [teacherAuth, { uid: "manager", token: { role: "student", classId: "sample" } }]) {
        const h = setup({}, { "classes/sample": { planType: "FREE", missionStudentStateVersion: 2 },
            "classes/sample/students/manager": { role: "student", permissions: { mission_admin: true } } });
        const api = h.load("functions/src/missions.js");
        const payload = { missionTemplate: { title: "Repeated", timeWindow: { start: "2026-09-08T09:00:00Z", end: "2026-09-08T10:00:00Z" }, completions: { learner: { status: "approved" } } },
            repeatConfig: { startDate: "2026-09-08", endDate: "2026-09-08", days: [2], dayBase: "sun0" } };
        await assert.rejects(api.createRepeatingMissions(request(studentAuth, payload)), error => error.code === "permission-denied");
        await api.createRepeatingMissions(request(auth, payload));
        const created = [...h.data.entries()].filter(([key]) => key.startsWith("classes/sample/missions/") && key !== root);
        assert.equal(created.length, 1);
        assert.equal(created[0][1].stateStorageVersion, 2);
        assert.equal(created[0][1].completions, undefined);
    }
});
