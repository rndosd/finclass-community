"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");
const { calculateMiniQuizReward } = require("../utils/miniQuizSubmission");
const settings = { questionCount: 2, dailyLimit: 0, weeklyLimit: 0, participationReward: 10, rewardPerCorrect: 20, perfectBonus: 30 };
const auth = { uid: "student-a", token: { role: "student", classId: "class-a" } };
const quizPath = "classes/class-a/miniQuizQuestionSets";
const seed = () => ({
  "classes/class-a": { planType: "FREE" },
  "classes/class-a/students/student-a": { name: "Synthetic student", assets: { cash: 0 } },
  "classes/class-a/arcade/config": { games: { miniQuiz: { enabled: true, selectionMode: "multiple" } } },
  ...Object.fromEntries(["quiz-a", "quiz-b"].flatMap(id => [
    [`${quizPath}/${id}`, { title: id, visibility: "public", questionCount: 2, settings }],
    [`${quizPath}/${id}/questions/q1`, { id: "q1", order: 0, type: "ox", prompt: "One", correctAnswers: ["O"] }],
    [`${quizPath}/${id}/questions/q2`, { id: "q2", order: 1, type: "ox", prompt: "Two", correctAnswers: ["O"] }],
  ])),
});
const request = (quizId, requestId, answers = ["O", "O"]) => ({ auth, data: { classId: "class-a", quizId, requestId, answers: answers.map((answer, index) => ({ questionId: `q${index + 1}`, answer })) } });

test("score improvement pays only the difference and same/lower scores pay zero", () => {
  assert.equal(calculateMiniQuizReward(settings, 0, 2).grossRewardAmount, 10);
  assert.equal(calculateMiniQuizReward(settings, 1, 2, 10, 0).grossRewardAmount, 20);
  assert.equal(calculateMiniQuizReward(settings, 2, 2, 30, 1).grossRewardAmount, 50);
  assert.equal(calculateMiniQuizReward(settings, 2, 2, 80, 2).grossRewardAmount, 0);
  assert.equal(calculateMiniQuizReward({ ...settings, perfectBonus: 100 }, 2, 2, 80, 2).grossRewardAmount, 0);
});
test("transaction retries, request retries, and new attempts cannot duplicate a quiz reward", async () => {
  const h = createCallableHarness(seed(), { retryTransaction: true });
  const api = h.load("functions/src/playGame.js");
  const first = await api.submitMiniQuiz(request("quiz-a", "request-00001", ["X", "X"]));
  const second = await api.submitMiniQuiz(request("quiz-a", "request-00002"));
  const duplicate = await api.submitMiniQuiz(request("quiz-a", "request-00002"));
  const repeat = await api.submitMiniQuiz(request("quiz-a", "request-00003"));
  assert.equal(first.grossRewardAmount, 10);
  assert.equal(second.grossRewardAmount, 70);
  assert.equal(duplicate.grossRewardAmount, 70);
  assert.equal(repeat.grossRewardAmount, 0);
  assert.equal(h.data.get("classes/class-a/students/student-a").assets.cash, 80);
  const logs = [...h.data.values()].filter(row => row.subCategory === "mini_quiz");
  assert.equal(logs.length, 3);
  assert.equal(logs.reduce((sum, row) => sum + row.amount, 0), 80);
  const other = await api.submitMiniQuiz(request("quiz-b", "request-00004"));
  assert.equal(other.grossRewardAmount, 80);
  assert.equal(h.data.get("classes/class-a/students/student-a").assets.cash, 160);
});
test("private quizzes and cross-class requests cannot pay; listing hides answers and drafts", async () => {
  const records = seed(); records[`${quizPath}/quiz-b`].visibility = "private";
  records[`${quizPath}/quiz-a`].draft = { title: "Secret draft", questions: [{ correctAnswers: ["O"] }] };
  const h = createCallableHarness(records); const api = h.load("functions/src/playGame.js");
  await assert.rejects(api.submitMiniQuiz(request("quiz-b", "request-00005")), { code: "failed-precondition" });
  await assert.rejects(api.getMiniQuizQuestions({ auth, data: { classId: "other", list: true } }), { code: "permission-denied" });
  const list = await api.getMiniQuizQuestions({ auth, data: { classId: "class-a", list: true } });
  assert.equal(list.quizzes.length, 1);
  assert.equal(JSON.stringify(list).includes("correctAnswers"), false);
  assert.equal(JSON.stringify(list).includes("Secret draft"), false);
  assert.equal(h.writes.length, 0);
});
test("historical payouts count toward the cap and daily limits are scoped per quiz", async () => {
  const records = seed();
  records[`${quizPath}/quiz-a`].settings = { ...settings, dailyLimit: 1 };
  records["classes/class-a/arcade/config/miniQuizAttempts/old"] = { studentUid: "student-a", sourceSetId: "quiz-a", grossRewardAmount: 80, correctCount: 2, usageDate: "2026-09-07" };
  const h = createCallableHarness(records); const api = h.load("functions/src/playGame.js");
  const repeat = await api.submitMiniQuiz(request("quiz-a", "request-00006"));
  assert.equal(repeat.grossRewardAmount, 0);
  await assert.rejects(api.submitMiniQuiz(request("quiz-a", "request-00007")), { code: "resource-exhausted" });
  assert.equal((await api.submitMiniQuiz(request("quiz-b", "request-00008"))).grossRewardAmount, 80);
});

test("weekly limits are per quiz and committed retries do not consume attempts", async () => {
  const records = seed(); records[`${quizPath}/quiz-a`].settings = { ...settings, weeklyLimit: 1 };
  const h = createCallableHarness(records); const api = h.load("functions/src/playGame.js");
  const first = await api.submitMiniQuiz(request("quiz-a", "weekly-request-01"));
  assert.equal(JSON.stringify(await api.submitMiniQuiz(request("quiz-a", "weekly-request-01"))), JSON.stringify(first));
  await assert.rejects(api.submitMiniQuiz(request("quiz-a", "weekly-request-02")), { code: "resource-exhausted" });
  assert.equal((await api.submitMiniQuiz(request("quiz-b", "weekly-request-03"))).grossRewardAmount, 80);
  assert.equal(h.data.get("classes/class-a/students/student-a").assets.cash, 160);
});

test("request collisions, malformed IDs and missing membership do not write", async () => {
  const h = createCallableHarness(seed()); const api = h.load("functions/src/playGame.js");
  await api.submitMiniQuiz(request("quiz-a", "collision-request-01"));
  const writes = h.writes.length;
  await assert.rejects(api.submitMiniQuiz(request("quiz-b", "collision-request-01")), { code: "invalid-argument" });
  await assert.rejects(api.submitMiniQuiz(request("../bad", "collision-request-02")), { code: "invalid-argument" });
  await assert.rejects(api.submitMiniQuiz({ ...request("quiz-a", "collision-request-03"), auth: null }), { code: "unauthenticated" });
  await assert.rejects(api.submitMiniQuiz({ ...request("quiz-a", "collision-request-04"), auth: { uid: "synthetic-outsider", token: auth.token } }), { code: "not-found" });
  assert.equal(h.writes.length, writes);
});

test("hidden answers stay hidden on retry", async () => {
  const records = seed(); records[`${quizPath}/quiz-a`].settings = { ...settings, showCorrectAfterSubmit: false };
  const h = createCallableHarness(records); const api = h.load("functions/src/playGame.js");
  for (const value of [await api.submitMiniQuiz(request("quiz-a", "hidden-request-01")), await api.submitMiniQuiz(request("quiz-a", "hidden-request-01"))]) {
    assert.equal(JSON.stringify(value).includes("correctAnswers"), false);
    assert.deepEqual(JSON.parse(JSON.stringify(value.results)), [{ questionId: "q1", isCorrect: true }, { questionId: "q2", isCorrect: true }]);
  }
  assert.equal(h.data.get("classes/class-a/students/student-a").assets.cash, 80);
});

test("legacy overpayment remains without refund or additional payout", async () => {
  const records = seed();
  records["classes/class-a/arcade/config/miniQuizAttempts/legacy-overpaid"] = { studentUid: "student-a", sourceSetId: "quiz-a", grossRewardAmount: 200, correctCount: 1, usageDate: "2026-09-07" };
  const h = createCallableHarness(records); const api = h.load("functions/src/playGame.js");
  assert.equal((await api.submitMiniQuiz(request("quiz-a", "overpaid-request-01"))).grossRewardAmount, 0);
  assert.equal(h.data.get("classes/class-a/students/student-a").assets.cash, 0);
  assert.equal(h.data.get("classes/class-a/arcade/config/miniQuizAttempts/student-a_progress_quiz-a").paidGross, 200);
});
