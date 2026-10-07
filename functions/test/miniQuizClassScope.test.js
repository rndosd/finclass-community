"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");
const makeSeed = () => ({
  "classes/class-a": { planType: "FREE" },
  "classes/class-a/students/student-a": { assets: { cash: 0 } },
  "classes/class-a/arcade/config": { games: { miniQuiz: { enabled: true,
    questionCount: 1, participationReward: 5,
    questions: [{ id: "q1", type: "ox", prompt: "Synthetic question", correctAnswers: ["O"] }] } } },
});
const request = (auth) => ({ auth, data: { classId: "class-a", answers: [{ questionId: "q1", answer: "O" }] } });
for (const role of ["student", "teacher"]) {
  test(`mini quiz rejects stale membership with a different active class (${role})`, async () => {
    const h = createCallableHarness(makeSeed());
    const api = h.load("functions/src/playGame.js");
    const auth = { uid: "student-a", token: { role, classId: "class-b" } };
    await assert.rejects(api.getMiniQuizQuestions(request(auth)), { code: "permission-denied" });
    await assert.rejects(api.submitMiniQuiz(request(auth)), { code: "permission-denied" });
    assert.equal(h.writes.length, 0);
  });
}
test("mini quiz without class claims follows the current user profile", async () => {
  const records = makeSeed();
  records["users/student-a"] = { role: "student", classId: "class-a", status: "approved" };
  const h = createCallableHarness(records);
  const api = h.load("functions/src/playGame.js");
  const auth = { uid: "student-a", token: { role: "student" } };
  const questions = await api.getMiniQuizQuestions(request(auth));
  assert.equal(questions.questions.length, 1);
  assert.equal(JSON.stringify(questions).includes("correctAnswers"), false);
  h.data.set("users/student-a", { role: "student", classId: "class-b", status: "approved" });
  await assert.rejects(api.getMiniQuizQuestions(request(auth)), { code: "permission-denied" });
  await assert.rejects(api.submitMiniQuiz(request(auth)), { code: "permission-denied" });
  assert.equal(h.writes.length, 0);
});
