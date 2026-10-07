"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");

const root = "classes/sample/missions/task";
const student = "classes/sample/students/learner";
const state = `${student}/missionState/task`;
const json = (value) => JSON.parse(JSON.stringify(value));
const teacherAuth = { uid: "teacher", token: { role: "teacher", classId: "sample" } };
const studentAuth = { uid: "learner", token: { role: "student", classId: "sample" } };
function setup(mission = {}, extra = {}, options = {}) {
    return createCallableHarness({
        "classes/sample": { planType: "FREE" },
        "classes/sample/students/teacher": { role: "teacher", name: "Synthetic Teacher" },
        [student]: { role: "student", name: "Synthetic Learner", assets: { cash: 0, missionToken: 0 }, creditScore: 0 },
        [root]: {
            type: "single", title: "Synthetic Task", studentStateMirrorVersion: 1,
            timeWindow: { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" },
            rewards: [{ type: "currency", amount: 10 }, { type: "credit", amount: 2 }, { type: "missionToken", amount: 3 }],
            ...mission,
        },
        ...extra,
    }, options);
}
function sameState(h) {
    assert.deepEqual(json(h.data.get(state).completion), json(h.data.get(root).completions.learner));
}
const request = (auth, data = {}) => ({ auth, data: { classId: "sample", missionId: "task", ...data } });

test("general submission, approval, retry, repeated approval and cancellation keep state and rewards consistent", async () => {
    const h = setup({}, {}, { retryTransaction: true });
    const api = h.load("functions/src/missions.js");
    await api.submitMission(request(studentAuth));
    assert.equal(h.data.get(state).latestStatus, "pending");
    sameState(h);
    const approved = await api.approveMissionBatch(request(teacherAuth, { items: [{ uid: "learner" }] }));
    assert.equal(approved.results.success.length, 1);
    sameState(h);
    assert.equal(h.data.get(student).assets.cash, 10);
    assert.equal(h.data.get(student).creditScore, 2);
    assert.equal(h.data.get(student).assets.missionToken, 3);
    await api.approveMissionBatch(request(teacherAuth, { items: [{ uid: "learner" }] }));
    assert.equal(h.data.get(student).assets.cash, 10);
    await api.cancelMissionApprovalBatch(request(teacherAuth, { studentUids: ["learner", "learner"] }));
    sameState(h);
    assert.equal(h.data.get(state).latestStatus, "pending");
    assert.equal(h.data.get(state).completion.rewardGranted, undefined);
    assert.equal(h.data.get(student).assets.cash, 0);
    assert.equal(h.data.get(student).creditScore, 0);
    assert.equal(h.data.get(student).assets.missionToken, 0);
    await api.cancelMissionApprovalBatch(request(teacherAuth, { studentUids: ["learner"] }));
    assert.equal(h.data.get(student).assets.cash, 0);
});

test("one approval batch cannot contain duplicate students", async () => {
    const h = setup({ completions: { learner: { status: "pending" } } });
    const api = h.load("functions/src/missions.js");
    await assert.rejects(api.approveMissionBatch(request(teacherAuth, { items: [{ uid: "learner" }, { uid: "learner" }] })),
        (error) => error.code === "invalid-argument");
    assert.equal(h.writes.length, 0);
});

test("automatic completion is mirrored atomically and cannot pay twice", async () => {
    const h = setup({ autoApprove: true }, {}, { retryTransaction: true });
    const api = h.load("functions/src/missions.js");
    await api.processAutoApproveMission(request(studentAuth));
    sameState(h);
    assert.equal(h.data.get(student).assets.cash, 10);
    await assert.rejects(api.processAutoApproveMission(request(studentAuth)), (error) => error.code === "already-exists");
    assert.equal(h.data.get(student).assets.cash, 10);
});

test("submission rejection, resubmission and reviewed approval preserve the link and feedback", async () => {
    const h = setup({ requireSubmissionForm: true }, {}, { retryTransaction: true });
    const api = h.load("functions/src/missions.js");
    await api.submitMission(request(studentAuth, { contentHtml: "<p>Synthetic</p>" }));
    const submissionId = h.data.get(root).submissionsIndex.learner;
    assert(submissionId);
    sameState(h);
    await api.rejectSubmissionBatch(request(teacherAuth, { submissionIds: [submissionId], reason: "Revise" }));
    sameState(h);
    assert.equal(h.data.get(state).latestStatus, "rejected");
    await api.submitMission(request(studentAuth, { contentHtml: "<p>Revised</p>" }));
    await api.approveMissionBatch(request(teacherAuth, { items: [{ uid: "learner", submissionId, feedback: "Reviewed" }] }));
    sameState(h);
    assert.equal(h.data.get(state).completion.feedback, "Reviewed");
    assert.equal(h.data.get(state).submissionId, submissionId);
    assert.equal(h.data.get(`${root}/submissions/${submissionId}`).status, "approved");
});

test("server feedback validates roles/class and synchronizes the latest submission, root and mirror", async () => {
    const h = setup({ completions: { learner: { status: "approved", submissionId: "submission" } },
        submissionsIndex: { learner: "submission" } }, {
        [`${root}/submissions/submission`]: { studentUid: "learner", status: "approved", feedback: "Old" },
    }, { retryTransaction: true });
    const api = h.load("functions/src/missionFeedback.js");
    await assert.rejects(api.saveMissionFeedback(request(studentAuth, { items: [{ uid: "learner", feedback: "No" }] })),
        (error) => error.code === "permission-denied");
    await assert.rejects(api.saveMissionFeedback(request({ ...teacherAuth, token: { ...teacherAuth.token, classId: "other" } },
        { items: [{ uid: "learner", feedback: "No" }] })), (error) => error.code === "permission-denied");
    await api.saveMissionFeedback(request(teacherAuth, { submissionId: "submission", feedback: "New feedback" }));
    sameState(h);
    assert.equal(h.data.get(state).completion.feedback, "New feedback");
    assert.equal(h.data.get(`${root}/submissions/submission`).feedback, "New feedback");
    assert.equal(h.data.get(state).completion.feedbackUpdatedBy, "teacher");
    assert.equal(h.data.get(student).assets.cash, 0);
});
