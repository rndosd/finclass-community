import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useMemo, useRef, useState } from "react";
import { Brain, CheckCircle2, XCircle, Trophy } from "lucide-react";
import Modal from "../../../components/ui/Modal";
import { Button, Badge, Spinner } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { submitMiniQuiz } from "../services/arcadeServices";

const normalizeText = (value) => String(value ?? "").trim();

const getTypeLabel = (type) => {
  if (type === "ox") return "OX";
  if (type === "short_answer") return "단답형";
  return "객관식";
};

export default function MiniQuizModal({
  classId,
  settings = {},
  questions: providedQuestions = [],
  currencyName = "미소",
  onClose,
  quizId,
  title,
}) {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { showFeedback } = useFeedback();
  const [answers, setAnswers] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const submissionRef = useRef(null);
  const submittingRef = useRef(false);
  const [answersLocked, setAnswersLocked] = useState(false);
  const [requestId] = useState(() =>
    window.crypto?.randomUUID?.() || `quiz-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const questions = useMemo(() => {
    const sourceQuestions = providedQuestions;
    const configuredQuestions = Array.isArray(sourceQuestions)
      ? sourceQuestions.filter((question) => normalizeText(question?.prompt) || question?.imageUrl)
      : [];
    const playableQuestions = configuredQuestions.filter(
      (question) =>
        question.type === "short_answer" || (question.options || []).length >= 2,
    );
    const questionCount = Math.max(1, Number(settings.questionCount || 3));
    return playableQuestions.slice(0, questionCount);
  }, [providedQuestions, settings.questionCount]);

  const allAnswered = questions.length > 0 && questions.every((question) => normalizeText(answers[question.id]));

  const handleSelect = (questionId, value) => {
    if (result || submissionRef.current) return;
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleSubmit = async () => {
    if (submittingRef.current || result) return;
    if (!questions.length) {
      showFeedback("풀 수 있는 퀴즈 문제가 없습니다.", "warning");
      return;
    }

    const hasEmpty = questions.some(
      (question) => !normalizeText(answers[question.id]),
    );
    if (hasEmpty) {
      showFeedback("모든 문제의 답을 선택하거나 입력해 주세요.", "warning");
      return;
    }

    try {
      submittingRef.current = true;
      setIsSubmitting(true);
      // A lost response may already have committed. Retry the same answers and ID.
      const payload = submissionRef.current || questions.map((question) => ({
        questionId: question.id,
        answer: answers[question.id],
      }));
      submissionRef.current = payload;
      setAnswersLocked(true);
      const nextResult = await submitMiniQuiz(classId, { answers: payload, requestId, quizId });
      setResult(nextResult);
      showFeedback("퀴즈 결과를 확인해 주세요.", "success");
    } catch (error) {
      console.error("[miniQuiz] submit failed:", error);
      showFeedback(
        error?.message || "간단퀴즈 제출 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} size="lg">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white">
            <Brain size={22} />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-900">{title || "오늘의 퀴즈 상자"}</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {questions.length}문제를 풀고 보상을 받아요.
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-4">
        {answersLocked && !isSubmitting && !result ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{"\uC81C\uCD9C\uD55C \uB2F5\uC548\uC73C\uB85C \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694. \uC911\uBCF5 \uBCF4\uC0C1\uC740 \uC9C0\uAE09\uB418\uC9C0 \uC54A\uC544\uC694."}</p> : null}
        {quizId ? <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">재도전은 이전에 받은 보상을 넘는 차액만 지급해요. 같은 점수나 낮은 점수에는 추가 보상이 없어요.</p> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-400">참여 보상</p>
            <p className="mt-1 text-lg font-black text-slate-900">
              {formatDisplayMoney(Number(settings.participationReward || 0))}
              {currencyName}
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-400">정답 보상</p>
            <p className="mt-1 text-lg font-black text-slate-900">
              {formatDisplayMoney(Number(settings.rewardPerCorrect || 0))}
              {currencyName}
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-400">만점 보너스</p>
            <p className="mt-1 text-lg font-black text-slate-900">
              {formatDisplayMoney(Number(settings.perfectBonus || 0))}
              {currencyName}
            </p>
          </div>
        </div>

        {questions.length ? (
          <div className="space-y-3">
            {questions.map((question, index) => {
              const selectedAnswer = answers[question.id] || "";
              const resultRow = result?.results?.find(
                (item) => item.questionId === question.id,
              );

              return (
                <div
                  key={question.id}
                  className="rounded-3xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="indigo">문제 {index + 1}</Badge>
                    <Badge tone="slate">{getTypeLabel(question.type)}</Badge>
                    {resultRow ? (
                      <Badge tone={resultRow.isCorrect ? "emerald" : "rose"}>
                        {resultRow.isCorrect ? "정답" : "오답"}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-3 text-base font-black leading-7 text-slate-900">
                    {question.prompt}
                  </p>
                  {question.imageUrl ? (
                    <a href={question.imageUrl} target="_blank" rel="noopener noreferrer" className="mt-3 block" aria-label={`문제 ${index + 1} 사진 크게 보기`}>
                      <img src={question.imageUrl} alt={`문제 ${index + 1} 자료`} className="max-h-96 w-full rounded-2xl border border-slate-200 object-contain" />
                      <span className="mt-1 block text-xs font-bold text-indigo-600">사진 크게 보기</span>
                    </a>
                  ) : null}

                  {question.type === "short_answer" ? (
                    <input
                      type="text"
                      value={selectedAnswer}
                      disabled={answersLocked || Boolean(result)}
                      onChange={(event) =>
                        handleSelect(question.id, event.target.value)
                      }
                      className="mt-3 w-full rounded-xl border border-blue-200 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
                      placeholder="답을 입력하세요"
                    />
                  ) : (
                    <div className="mt-3 grid gap-2">
                      {(question.options || []).map((option) => {
                        const isSelected = selectedAnswer === option;
                        return (
                          <Button
                            key={option}
                            type="button"
                            disabled={answersLocked || Boolean(result)}
                            onClick={() => handleSelect(question.id, option)}
                            className={`rounded-2xl border px-4 py-3 text-left text-sm font-bold transition ${
                              isSelected
                                ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                                : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white"
                            } disabled:cursor-not-allowed`}
                          >
                            {option}
                          </Button>
                        );
                      })}
                    </div>
                  )}

                  {resultRow && settings.showCorrectAfterSubmit !== false ? (
                    <div
                      className={`mt-3 rounded-2xl px-4 py-3 text-sm font-semibold ${
                        resultRow.isCorrect
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-rose-50 text-rose-800"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {resultRow.isCorrect ? (
                          <CheckCircle2 size={16} />
                        ) : (
                          <XCircle size={16} />
                        )}
                        <span>
                          정답: {(resultRow.correctAnswers || []).join(", ")}
                        </span>
                      </div>
                      {resultRow.explanation ? (
                        <p className="mt-2 leading-6">{resultRow.explanation}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <p className="text-sm font-bold text-slate-500">
              아직 등록된 간단퀴즈 문제가 없습니다.
            </p>
          </div>
        )}

        {result ? (
          <div className="rounded-3xl border border-indigo-100 bg-indigo-50 p-5">
            <div className="flex items-center gap-3">
              <Trophy className="h-6 w-6 text-indigo-600" />
              <div>
                <p className="text-lg font-black text-slate-900">
                  {result.correctCount} / {result.questionCount} 정답
                </p>
                <p className="text-sm font-bold text-indigo-700">
                  총 {formatDisplayMoney(Number(result.rewardAmount || 0))}
                  {currencyName} 지급
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </Modal.Body>

      <Modal.Footer>
        <Button kind="outline" tone="slate" onClick={onClose}>
          닫기
        </Button>
        {!result ? (
          <Button tone="indigo" onClick={handleSubmit} disabled={isSubmitting || !allAnswered}>
            {isSubmitting ? (
              <span className="inline-flex items-center gap-2">
                <Spinner size="sm" /> 제출 중
              </span>
            ) : (
              "제출하고 보상 받기"
            )}
          </Button>
        ) : null}
      </Modal.Footer>
    </Modal>
  );
}
