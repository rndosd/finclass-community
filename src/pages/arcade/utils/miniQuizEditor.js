export const MAX_QUIZ_QUESTIONS = 100;
export const QUIZ_SETTING_FIELDS = ["questionCount", "dailyLimit", "weeklyLimit", "participationReward", "rewardPerCorrect", "perfectBonus"];

export const createQuizQuestion = () => ({
  id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  type: "multiple_choice", prompt: "", imageUrl: "", options: ["", "", "", ""], correctAnswers: [], explanation: "",
});

const text = (value) => String(value ?? "").trim();

export function questionForEditing(question) {
  const type = question.type || "multiple_choice";
  return {
    ...createQuizQuestion(), ...question, type,
    options: type === "multiple_choice"
      ? [...(question.options || []), "", ""].slice(0, Math.max(2, (question.options || []).length))
      : type === "ox" ? ["O", "X"] : [],
    correctAnswers: Array.isArray(question.correctAnswers) ? question.correctAnswers : [],
  };
}

export function normalizeQuizQuestion(question) {
  const type = ["multiple_choice", "ox", "short_answer"].includes(question.type) ? question.type : "multiple_choice";
  const options = type === "ox" ? ["O", "X"] : type === "short_answer" ? [] : (question.options || []).map(text).filter(Boolean);
  const answers = (question.correctAnswers || []).map(text).filter(Boolean);
  return {
    id: question.id, type, prompt: text(question.prompt), imageUrl: text(question.imageUrl), options,
    correctAnswers: type === "short_answer" ? [...new Set(answers.flatMap((answer) => answer.split(/[,;|]/).map(text).filter(Boolean)))] : answers,
    explanation: text(question.explanation),
  };
}

export function quizQuestionError(raw) {
  const question = normalizeQuizQuestion(raw);
  if (!question.prompt && !question.imageUrl) return "질문을 쓰거나 사진을 추가해 주세요.";
  if (question.type !== "short_answer") {
    if (question.options.length < 2 || question.options.length > 5) return "보기를 2~5개 입력해 주세요.";
    if (new Set(question.options).size !== question.options.length) return "보기 내용을 서로 다르게 입력해 주세요.";
    if (question.correctAnswers.length !== 1 || !question.options.includes(question.correctAnswers[0])) return "정답을 하나 선택해 주세요.";
  } else if (!question.correctAnswers.length) return "정답을 입력해 주세요.";
  return "";
}

export function validateQuizPublication(title, questions, settings) {
  if (!text(title)) return "퀴즈 제목을 입력해 주세요.";
  if (!questions.length || questions.length > MAX_QUIZ_QUESTIONS) return `문제를 1~${MAX_QUIZ_QUESTIONS}개 작성해 주세요.`;
  if (new Set(questions.map((question) => question.id)).size !== questions.length || questions.some((question) => !/^[A-Za-z0-9_-]+$/.test(question.id || ""))) return "문제 식별자가 올바르지 않습니다. 문제를 다시 추가해 주세요.";
  for (let index = 0; index < questions.length; index += 1) {
    const error = quizQuestionError(questions[index]);
    if (error) return `문제 ${index + 1}: ${error}`;
  }
  if (QUIZ_SETTING_FIELDS.some((field) => !Number.isSafeInteger(Number(settings[field])) || Number(settings[field]) < 0 || settings[field] === "")) return "응시 횟수와 보상은 0 이상의 정수로 입력해 주세요.";
  if (Number(settings.questionCount) < 1 || Number(settings.questionCount) > questions.length) return "출제 문항 수를 작성한 문제 수 안에서 정해 주세요.";
  if (!Number.isSafeInteger(maxQuizReward(settings))) return "보상 금액이 너무 큽니다. 금액을 줄여 주세요.";
  return "";
}

export const maxQuizReward = (settings) =>
  Number(settings.participationReward || 0) + Number(settings.questionCount || 0) * Number(settings.rewardPerCorrect || 0) + Number(settings.perfectBonus || 0);

export function buildQuizConfig(settings, setId) {
  return {
    ...Object.fromEntries(QUIZ_SETTING_FIELDS.map((field) => [field, Number(settings[field])])),
    enabled: true, price: 0, feeAmount: 0, allowedPaymentTypes: ["cash"],
    showCorrectAfterSubmit: settings.showCorrectAfterSubmit !== false,
    sourceSetId: setId, sourceSetVisibility: "public", questions: [],
  };
}
