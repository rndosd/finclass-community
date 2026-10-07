"use strict";

function selectMiniQuizSubmission(questions, answers, questionLimit) {
    const selectedQuestions = questions.slice(0, Math.max(1, Number(questionLimit || 3)));
    if (!selectedQuestions.length || !Array.isArray(answers)) return null;
    const answerMap = new Map();
    for (const item of answers) {
        const id = String(item?.questionId || "").trim();
        const answer = String(item?.answer || "").trim();
        if (!id || !answer || answerMap.has(id)) return null;
        answerMap.set(id, answer);
    }
    if (answerMap.size !== selectedQuestions.length || selectedQuestions.some((question) => !answerMap.has(question.id))) return null;
    return { selectedQuestions, answerMap };
}

function calculateMiniQuizReward(settings, correctCount, questionCount, paidGross = 0, priorBestCorrectCount = -1) {
    const values = [settings.participationReward || 0, settings.rewardPerCorrect || 0, settings.perfectBonus || 0, paidGross];
    if (values.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > Number.MAX_SAFE_INTEGER)) throw new Error("Invalid quiz reward settings.");
    const target = Number(values[0]) + correctCount * Number(values[1]) + (correctCount === questionCount ? Number(values[2]) : 0);
    const cap = Number(values[0]) + questionCount * Number(values[1]) + Number(values[2]);
    if (!Number.isFinite(cap) || cap > Number.MAX_SAFE_INTEGER) throw new Error("Invalid quiz reward maximum.");
    const delta = correctCount > priorBestCorrectCount ? Math.max(0, Math.min(target, cap) - Number(paidGross)) : 0;
    return { grossRewardAmount: delta, cumulativeGrossReward: Number(paidGross) + delta, maximumGrossReward: cap };
}

function miniQuizProgressFromAttempts(attempts, quizId) {
    const rows = attempts.filter((row) => row.sourceSetId === quizId && row.kind !== "quiz-progress");
    return { attemptCount: rows.length, paidGross: rows.reduce((sum, row) => sum + Number(row.grossRewardAmount || 0), 0), bestCorrectCount: Math.max(0, ...rows.map((row) => Number(row.correctCount || 0))), usage: rows.reduce((usage, row) => { if (row.usageDate) usage[row.usageDate] = (usage[row.usageDate] || 0) + 1; return usage; }, {}) };
}

module.exports = { selectMiniQuizSubmission, calculateMiniQuizReward, miniQuizProgressFromAttempts };
