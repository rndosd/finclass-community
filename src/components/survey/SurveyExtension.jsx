import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ListChecks,
} from "lucide-react";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { useFeedback } from "../../contexts/FeedbackContext";
import QuestionEditor from "./QuestionEditor";
import SurveyResultsSettings from "./SurveyResultsSettings";
import { Button } from "../ui";

const defaultQuestion = () => ({
  id: Date.now() + Math.random(),
  type: "multiple_choice",
  question: "",
  required: true,
  options: ["", ""],
  allowMultiple: false,
  placeholder: "",
  maxLength: null,
  maxScore: 5,
});

const defaultResultSettings = {
  resultsRelease: "after_deadline",
  resultsWhitelistUids: [],
  exposeIdentifiableResponses: false,
  minResponsesToShow: 0,
  deadline: null,
  isActive: true,
};

const QUESTION_TYPE_LABEL = {
  multiple_choice: "객관식",
  text: "주관식",
  rating: "평점",
};

function normalizeDeadline(deadline) {
  if (!deadline) return null;
  try {
    if (deadline?.toDate) {
      const d = deadline.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (deadline instanceof Date) {
      return Number.isNaN(deadline.getTime()) ? null : deadline;
    }
    const parsed = new Date(deadline);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

export default function SurveyExtension({
  editingSurvey = null,
  classId,
  userId,
  onInsertSurvey,
  onClose,
}) {
  const { showFeedback } = useFeedback();
  const [currentStep, setCurrentStep] = useState(1);
  const [activeQuestionId, setActiveQuestionId] = useState(null);

  const [survey, setSurvey] = useState({
    title: "",
    description: "",
    questions: [defaultQuestion()],
    ...defaultResultSettings,
  });

  useEffect(() => {
    if (editingSurvey) {
      const normalizedQuestions = (editingSurvey.questions || []).map((q) => ({
        ...defaultQuestion(),
        ...q,
        id: q.id || Date.now() + Math.random(),
      }));

      const nextQuestions =
        normalizedQuestions.length > 0 ? normalizedQuestions : [defaultQuestion()];

      setSurvey({
        title: editingSurvey.title || "",
        description: editingSurvey.description || "",
        questions: nextQuestions,
        ...defaultResultSettings,
        resultsRelease:
          editingSurvey.resultsRelease ?? defaultResultSettings.resultsRelease,
        resultsWhitelistUids:
          editingSurvey.resultsWhitelistUids ??
          defaultResultSettings.resultsWhitelistUids,
        exposeIdentifiableResponses:
          editingSurvey.exposeIdentifiableResponses ??
          defaultResultSettings.exposeIdentifiableResponses,
        minResponsesToShow:
          editingSurvey.minResponsesToShow ??
          defaultResultSettings.minResponsesToShow,
        deadline: editingSurvey.deadline ?? defaultResultSettings.deadline,
        isActive: editingSurvey.isActive ?? defaultResultSettings.isActive,
      });
      setActiveQuestionId(nextQuestions[0]?.id || null);
      setCurrentStep(1);
      return;
    }

    const firstQuestion = defaultQuestion();
    setSurvey({
      title: "",
      description: "",
      questions: [firstQuestion],
      ...defaultResultSettings,
    });
    setActiveQuestionId(firstQuestion.id);
    setCurrentStep(1);
  }, [editingSurvey]);

  useEffect(() => {
    if (!survey.questions.length) {
      setActiveQuestionId(null);
      return;
    }

    const hasActive = survey.questions.some((q) => q.id === activeQuestionId);
    if (!hasActive) {
      setActiveQuestionId(survey.questions[0].id);
    }
  }, [survey.questions, activeQuestionId]);

  const questionCount = survey.questions.length;
  const requiredCount = useMemo(
    () => survey.questions.filter((q) => q.required).length,
    [survey.questions],
  );
  const optionalCount = Math.max(0, questionCount - requiredCount);
  const activeQuestionIndex = useMemo(
    () => survey.questions.findIndex((q) => q.id === activeQuestionId),
    [survey.questions, activeQuestionId],
  );
  const activeQuestion =
    activeQuestionIndex >= 0 ? survey.questions[activeQuestionIndex] : null;

  const addQuestion = () => {
    const nextQuestion = defaultQuestion();
    setSurvey((prev) => ({
      ...prev,
      questions: [...prev.questions, nextQuestion],
    }));
    setActiveQuestionId(nextQuestion.id);
  };

  const updateQuestion = (idx, updated) => {
    setSurvey((prev) => {
      const next = [...prev.questions];
      next[idx] = updated;
      return { ...prev, questions: next };
    });
  };

  const removeQuestion = (idx) => {
    if (survey.questions.length <= 1) {
      showFeedback("질문은 최소 1개 이상 필요합니다.", "warning");
      return;
    }

    setSurvey((prev) => ({
      ...prev,
      questions: prev.questions.filter((_, i) => i !== idx),
    }));
  };

  const moveUp = (idx) => {
    setSurvey((prev) => {
      if (idx === 0) return prev;
      const next = [...prev.questions];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return { ...prev, questions: next };
    });
  };

  const moveDown = (idx) => {
    setSurvey((prev) => {
      if (idx === prev.questions.length - 1) return prev;
      const next = [...prev.questions];
      [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
      return { ...prev, questions: next };
    });
  };

  const addOption = (qIdx) => {
    setSurvey((prev) => {
      const next = [...prev.questions];
      const q = { ...next[qIdx] };
      q.options = [...(q.options || []), ""];
      next[qIdx] = q;
      return { ...prev, questions: next };
    });
  };

  const removeOption = (qIdx, optIdx) => {
    setSurvey((prev) => {
      const next = [...prev.questions];
      const q = { ...next[qIdx] };
      const opts = q.options || [];
      if (opts.length <= 2) return prev;
      q.options = opts.filter((_, i) => i !== optIdx);
      next[qIdx] = q;
      return { ...prev, questions: next };
    });
  };

  const handleResultSettingsChange = (partial) => {
    setSurvey((prev) => ({ ...prev, ...partial }));
  };

  const goStep1 = () => setCurrentStep(1);
  const goStep2 = () => setCurrentStep(2);

  const validate = () => {
    if (!survey.title.trim()) {
      showFeedback("설문 제목을 입력해 주세요.", "warning");
      return false;
    }

    if (survey.questions.length === 0) {
      showFeedback("최소 1개의 질문을 추가해 주세요.", "warning");
      return false;
    }

    for (const q of survey.questions) {
      if (!q.question?.trim()) {
        showFeedback("모든 질문에 질문 내용을 입력해 주세요.", "warning");
        return false;
      }

      if (q.type === "multiple_choice") {
        const opts = (q.options || []).map((s) => s.trim()).filter(Boolean);
        if (opts.length < 2) {
          showFeedback(
            `"${q.question}"은 최소 2개의 보기 옵션이 필요합니다.`,
            "warning",
          );
          return false;
        }
      }

      if (q.type === "rating") {
        const maxScore = Number(q.maxScore) || 5;
        if (maxScore < 3 || maxScore > 10) {
          showFeedback(
            `"${q.question}"의 최대 점수는 3~10 사이여야 합니다.`,
            "warning",
          );
          return false;
        }
      }
    }

    return true;
  };

  const handleSave = async () => {
    if (!classId || !userId) {
      showFeedback("학급 또는 사용자 정보를 확인할 수 없습니다.", "error");
      return;
    }
    if (!validate()) return;

    const cleanedQuestions = survey.questions.map((q) => {
      const base = {
        id: q.id || Date.now() + Math.random(),
        type: q.type,
        question: q.question.trim(),
        required: !!q.required,
      };

      if (q.type === "multiple_choice") {
        return {
          ...base,
          options: (q.options || []).map((s) => s.trim()).filter(Boolean),
          allowMultiple: !!q.allowMultiple,
        };
      }

      if (q.type === "text") {
        return {
          ...base,
          placeholder: q.placeholder || "",
          maxLength: q.maxLength ? Number(q.maxLength) : null,
        };
      }

      if (q.type === "rating") {
        return { ...base, maxScore: Number(q.maxScore) || 5 };
      }

      return base;
    });

    const settings = {
      resultsRelease: survey.resultsRelease || "after_deadline",
      resultsWhitelistUids: Array.isArray(survey.resultsWhitelistUids)
        ? survey.resultsWhitelistUids
        : [],
      exposeIdentifiableResponses: !!survey.exposeIdentifiableResponses,
      minResponsesToShow: Math.max(
        0,
        Number.isFinite(Number(survey.minResponsesToShow))
          ? Number(survey.minResponsesToShow)
          : 0,
      ),
      deadline: normalizeDeadline(survey.deadline),
      isActive: survey.isActive !== false,
    };

    try {
      let surveyId;
      let payload;

      if (editingSurvey?.id) {
        surveyId = editingSurvey.id;
        payload = {
          ...editingSurvey,
          title: survey.title.trim(),
          description: survey.description.trim(),
          questions: cleanedQuestions,
          ownerUid: editingSurvey.ownerUid || editingSurvey.createdBy || userId,
          updatedAt: new Date(),
          updatedBy: userId,
          ...settings,
        };

        await updateDoc(doc(db, `classes/${classId}/surveys/${surveyId}`), payload);
        document.dispatchEvent(
          new CustomEvent("surveyUpdated", { detail: { surveyId } }),
        );
        showFeedback("설문이 수정되었습니다.", "success");
        onClose?.();
        return;
      }

      surveyId = `survey_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      payload = {
        id: surveyId,
        title: survey.title.trim(),
        description: survey.description.trim(),
        questions: cleanedQuestions,
        createdAt: new Date(),
        createdBy: userId,
        ownerUid: userId,
        isActive: true,
        responseCount: 0,
        ...settings,
      };

      await setDoc(doc(db, `classes/${classId}/surveys/${surveyId}`), payload);
      showFeedback("설문이 저장되었습니다.", "success");

      onInsertSurvey?.({
        surveyId,
        title: payload.title,
        description: payload.description,
        questionCount: cleanedQuestions.length,
      });

      onClose?.();
    } catch (e) {
      console.error("설문 저장 오류:", {
        code: e?.code,
        message: e?.message,
        classId,
        userId,
        isEdit: !!editingSurvey?.id,
      });
      if (e?.code === "permission-denied") {
        showFeedback(
          "설문 저장 권한이 없습니다. 규칙 또는 계정 권한을 확인해 주세요.",
          "error",
        );
      } else {
        showFeedback("설문 저장 중 오류가 발생했습니다.", "error");
      }
    }
  };

  return (
    <div className="max-w-none">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-cyan-50 p-4 md:p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-2 text-white shadow-sm">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {editingSurvey ? "설문 수정" : "설문 만들기"}
              </h2>
              <p className="text-sm text-slate-600">
                직관적인 화면 구성으로 질문을 관리해요
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-700">
              질문 {questionCount}개
            </span>
            <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
              필수 {requiredCount}개
            </span>
            <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-600">
              선택 {optionalCount}개
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <Button variant="ghost" kind="ghost"
          type="button"
          onClick={goStep1}
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
            currentStep === 1
              ? "bg-blue-600 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          1단계 · 기본 정보
        </Button>
        <Button variant="ghost" kind="ghost"
          type="button"
          onClick={goStep2}
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
            currentStep === 2
              ? "bg-blue-600 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          2단계 · 질문 만들기
        </Button>
      </div>

      {currentStep === 1 ? (
        <div className="mt-4 space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-slate-900">
              <ListChecks className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-bold">기본 정보</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  설문 제목
                </label>
                <input
                  value={survey.title}
                  onChange={(e) =>
                    setSurvey((prev) => ({ ...prev, title: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="설문 제목을 입력하세요"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  설명
                </label>
                <textarea
                  value={survey.description}
                  onChange={(e) =>
                    setSurvey((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="설문 안내 문구를 입력하세요"
                  rows={3}
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SurveyResultsSettings
              survey={survey}
              onChange={handleResultSettingsChange}
            />
          </section>

          <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <Button variant="ghost" kind="ghost"
              type="button"
              onClick={() => onClose?.()}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              닫기
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" kind="ghost"
                type="button"
                onClick={handleSave}
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
              >
                {editingSurvey ? "수정 저장" : "설문 저장"}
              </Button>
              <Button variant="ghost" kind="ghost"
                type="button"
                onClick={goStep2}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                2단계로 이동
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
          <aside className="space-y-4 xl:col-span-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">질문 목록</h3>
                <Button variant="ghost" kind="ghost"
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                  onClick={addQuestion}
                >
                  <Plus className="h-3.5 w-3.5" />
                  질문 추가
                </Button>
              </div>

              <div className="max-h-[56vh] space-y-2 overflow-y-auto pr-1">
                {survey.questions.map((q, idx) => {
                  const isActive = q.id === activeQuestionId;
                  const label = QUESTION_TYPE_LABEL[q.type] || "질문";

                  return (
                    <Button variant="ghost" kind="ghost"
                      key={q.id}
                      type="button"
                      onClick={() => setActiveQuestionId(q.id)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        isActive
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-500">
                          질문 {idx + 1}
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                            {label}
                          </span>
                          {q.required && (
                            <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-600">
                              필수
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-slate-800">
                        {q.question?.trim() || "질문 내용을 입력하세요"}
                      </p>
                    </Button>
                  );
                })}
              </div>
            </section>
          </aside>

          <main className="space-y-4 xl:col-span-8">
            {activeQuestion ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-500">
                      편집 중 · 질문 {activeQuestionIndex + 1}
                    </p>
                    <h3 className="mt-1 text-base font-bold text-slate-900">
                      {activeQuestion.question?.trim() || "질문 내용을 입력하세요"}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" kind="ghost"
                      type="button"
                      onClick={() => moveUp(activeQuestionIndex)}
                      disabled={activeQuestionIndex === 0}
                      className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      title="위로 이동"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>

                    <Button variant="ghost" kind="ghost"
                      type="button"
                      onClick={() => moveDown(activeQuestionIndex)}
                      disabled={activeQuestionIndex === survey.questions.length - 1}
                      className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      title="아래로 이동"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>

                    <Button variant="ghost" kind="ghost"
                      type="button"
                      onClick={() => removeQuestion(activeQuestionIndex)}
                      disabled={survey.questions.length <= 1}
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      title="질문 삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      삭제
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                  <QuestionEditor
                    question={activeQuestion}
                    onChange={(updated) =>
                      updateQuestion(activeQuestionIndex, updated)
                    }
                    onAddOption={() => addOption(activeQuestionIndex)}
                    onRemoveOption={(optIdx) =>
                      removeOption(activeQuestionIndex, optIdx)
                    }
                  />
                </div>
              </section>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
                편집할 질문을 선택해 주세요
              </div>
            )}

            <div className="sticky bottom-0 z-20 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-md backdrop-blur">
              <div className="mb-2 text-xs font-semibold text-slate-500">
                단계 이동해도 작성한 데이터는 유지됩니다
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" kind="ghost"
                  type="button"
                  onClick={goStep1}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  1단계로 이동
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" kind="ghost"
                    type="button"
                    onClick={() => onClose?.()}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    닫기
                  </Button>
                  <Button variant="ghost" kind="ghost"
                    type="button"
                    className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    onClick={handleSave}
                  >
                    {editingSurvey ? "수정 저장" : "설문 저장"}
                  </Button>
                </div>
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
