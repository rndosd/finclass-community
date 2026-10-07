import { appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowUpIcon, ArrowDownIcon, CopyIcon, TrashIcon, PlusIcon, ImageIcon, FloppyDiskIcon, CheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import Badge from "../../../components/ui/Badge";
import Button from "../../../components/ui/Button";
import { uploadToR2 } from "../../../utils/uploadToR2";
import { createMiniQuizDraftId, saveMiniQuizEditorDraft } from "../services/arcadeServices";
import { createQuizQuestion, MAX_QUIZ_QUESTIONS, questionForEditing, quizQuestionError } from "../utils/miniQuizEditor";

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const typeLabels = { multiple_choice: "객관식", ox: "OX", short_answer: "단답형" };

export default function MiniQuizEditor({ classId, quiz, initialQuestions = [], settings, cacheKey, onBack, onSaved }) {
  const startingDraft = useMemo(() => ({
    title: quiz?.draft?.title ?? quiz?.title ?? "",
    description: quiz?.draft?.description ?? quiz?.description ?? "",
    difficulty: quiz?.draft?.difficulty ?? quiz?.difficulty ?? "normal",
    questions: initialQuestions.length ? initialQuestions.map(questionForEditing) : [createQuizQuestion()],
    settings: { ...settings, ...(quiz?.settings || {}), ...(quiz?.draft?.settings || {}),
      questionCount: quiz?.draft?.settings?.questionCount ?? quiz?.settings?.questionCount ?? (quiz ? settings.questionCount : initialQuestions.length || 1) },
  }), [quiz, initialQuestions, settings]);
  const [cached] = useState(() => {
    try { const value = JSON.parse(sessionStorage.getItem(cacheKey)); return Array.isArray(value?.draft?.questions) && value?.draft?.settings ? value : null; } catch { return null; }
  });
  const [draft, setDraft] = useState(cached?.draft || startingDraft);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(startingDraft));
  const [quizId, setQuizId] = useState(quiz?.id || cached?.quizId || "");
  const [selectedId, setSelectedId] = useState(draft.questions[0]?.id);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const titleRef = useRef(null);
  const snapshot = JSON.stringify(draft);
  const dirty = snapshot !== savedSnapshot;
  const activeIndex = Math.max(0, draft.questions.findIndex((question) => question.id === selectedId));
  const active = draft.questions[activeIndex];
  const completeCount = draft.questions.filter((question) => !quizQuestionError(question)).length;
  const isLive = quiz?.isLive;

  useEffect(() => {
    if (dirty) { try { sessionStorage.setItem(cacheKey, JSON.stringify({ quizId, draft })); } catch { /* Cloud save remains available. */ } }
    const warn = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [cacheKey, dirty, snapshot, quizId, draft]);

  const change = (patch) => { setDraft((previous) => ({ ...previous, ...patch })); setError(""); setNotice(""); };
  const changeQuestion = (patch) => change({ questions: draft.questions.map((question) => question.id === active.id ? { ...question, ...patch } : question) });
  const replaceQuestions = (questions) => change({ questions, settings: { ...draft.settings,
    questionCount: Number(draft.settings.questionCount) === draft.questions.length ? Math.max(1, questions.length) : Math.min(Number(draft.settings.questionCount) || 1, Math.max(1, questions.length)) } });
  const addQuestion = () => {
    if (draft.questions.length >= MAX_QUIZ_QUESTIONS) { setError(`한 퀴즈에는 최대 ${MAX_QUIZ_QUESTIONS}문제까지 넣을 수 있어요.`); return; }
    const next = createQuizQuestion(); replaceQuestions([...draft.questions, next]); setSelectedId(next.id);
  };
  const moveQuestion = (direction) => {
    const next = [...draft.questions]; const target = activeIndex + direction;
    if (target < 0 || target >= next.length) return;
    [next[activeIndex], next[target]] = [next[target], next[activeIndex]]; replaceQuestions(next);
  };
  const copyQuestion = () => {
    if (draft.questions.length >= MAX_QUIZ_QUESTIONS) { setError(`최대 ${MAX_QUIZ_QUESTIONS}문제까지 넣을 수 있어요.`); return; }
    const copied = { ...active, id: createQuizQuestion().id, options: [...active.options], correctAnswers: [...active.correctAnswers] };
    const next = [...draft.questions]; next.splice(activeIndex + 1, 0, copied); replaceQuestions(next); setSelectedId(copied.id);
  };
  const removeQuestion = () => {
    const next = draft.questions.filter((question) => question.id !== active.id);
    replaceQuestions(next); setSelectedId(next[Math.min(activeIndex, next.length - 1)]?.id);
  };
  const uploadImage = async (file) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 1024 * 1024) { setError("사진은 JPG·PNG·WebP 형식, 1MB 이하로 올려 주세요."); return; }
    const targetId = active.id;
    setBusy("upload"); setError("");
    try {
      const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
      const { fileUrl } = await uploadToR2(new File([file], `quiz-${Date.now()}.${extension}`, { type: file.type }), "newsImage");
      setDraft((previous) => ({ ...previous, questions: previous.questions.map((question) => question.id === targetId ? { ...question, imageUrl: fileUrl } : question) }));
    } catch (uploadError) { setError(uploadError.message || "사진을 올리지 못했습니다."); }
    finally { setBusy(""); }
  };
  const save = async () => {
    setError(""); setNotice("");
    setBusy("save");
    try {
      const targetId = quizId || createMiniQuizDraftId(classId); setQuizId(targetId);
      await saveMiniQuizEditorDraft(classId, targetId, draft);
      setSavedSnapshot(snapshot);
      try { sessionStorage.removeItem(cacheKey); } catch { /* Saving succeeded even if browser storage is unavailable. */ }
      onSaved?.();
      setNotice(isLive ? "초안을 저장했습니다. 공개 중인 문제는 다시 공개할 때 바뀝니다." : "초안을 저장했습니다. 학생에게는 아직 공개되지 않았어요.");
    } catch (saveError) { setError(saveError.message || "저장하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요."); }
    finally { setBusy(""); }
  };
  const goBack = async () => {
    if (dirty && !(await appConfirm(
      "저장하지 않은 변경사항이 있습니다.\n이 탭의 임시 보관 내용은 탭을 닫으면 사라질 수 있습니다. 보관하려면 먼저 저장해 주세요.\n저장하지 않고 목록으로 돌아갈까요?",
      { confirmLabel: "목록으로 돌아가기", cancelLabel: "계속 작성하기" },
    ))) return;
    onBack();
  };
  return (
    <div className="space-y-5 pb-6" aria-busy={Boolean(busy)}>
      <fieldset disabled={Boolean(busy)} className="m-0 min-w-0 space-y-4 border-0 p-0">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-[28px] font-bold leading-[34px] text-slate-900">문제 작성</h1>
        <Button tone="slate" kind="ghost" size="sm" icon={ArrowLeftIcon} onClick={goBack} className="ml-auto">퀴즈 목록으로</Button>
      </div>
      <p className="text-sm leading-6 text-slate-600">
        이 탭의 임시 보관은 학급 저장과 다릅니다. {isLive
          ? "저장해도 공개 중인 문제는 바뀌지 않으며, 목록에서 다시 공개해야 반영됩니다."
          : "초안을 보관하려면 저장하고, 학생 공개는 목록에서 별도로 설정하세요."}
      </p>
      {cached && dirty ? <p role="status" className="text-sm leading-6 text-slate-600">이 탭에 임시 보관된 작성 내용을 불러왔습니다. 학급에 보관하려면 저장해 주세요.</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">퀴즈 제목<input ref={titleRef} maxLength={120} value={draft.title} onChange={(event) => change({ title: event.target.value })} className={`${inputClass} mt-2`} placeholder="예: 한국사 수능 기출 1회" /></label>
        <Badge tone={isLive ? "emerald" : "slate"}>{isLive ? "공개 중 · 초안 편집" : "비공개 초안"}</Badge>
      </div>
      {error ? <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</p> : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-w-0 self-start rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-bold text-slate-900">문제 순서</h2>
          <p className="mt-1 text-xs text-slate-500">{draft.questions.length}개 중 {completeCount}개 완성</p>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2 lg:max-h-[480px] lg:flex-col lg:overflow-y-auto">
            {draft.questions.map((question, index) => <button key={question.id} type="button" aria-current={question.id === active?.id ? "step" : undefined} onClick={() => { setSelectedId(question.id); setError(""); }} className={`flex min-w-[130px] items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm lg:min-w-0 ${question.id === active?.id ? "border-blue-200 bg-blue-50 text-blue-700" : "border-transparent text-slate-600 hover:bg-slate-50"}`}>
              <span className="shrink-0 font-bold">{index + 1}.</span><span className="min-w-0 flex-1 truncate">{question.prompt || (question.imageUrl ? "사진 문제" : "새 문제")}</span>{!quizQuestionError(question) ? <CheckIcon size={16} aria-label="완성" /> : null}
            </button>)}
          </div>
          <Button fullWidth tone="slate" kind="outline" size="sm" icon={PlusIcon} onClick={addQuestion} disabled={Boolean(busy)} className="mt-3">문제 추가</Button>
        </aside>
        {active ? <section aria-label={`문제 ${activeIndex + 1} 편집`} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-bold text-slate-900">문제 {activeIndex + 1}</h2>
              <label><span className="sr-only">문제 유형</span><select value={active.type} onChange={(event) => changeQuestion({ type: event.target.value, options: event.target.value === "ox" ? ["O", "X"] : event.target.value === "short_answer" ? [] : ["", "", "", ""], correctAnswers: [] })} className={`${inputClass} !w-auto !py-2`}>
                {Object.entries(typeLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
              </select></label>
            </div>
            <div className="flex gap-1">
              <Button tone="slate" kind="outline" size="icon-md" aria-label="문제 위로 이동" onClick={() => moveQuestion(-1)} disabled={Boolean(busy) || activeIndex === 0}><ArrowUpIcon size={18} /></Button>
              <Button tone="slate" kind="outline" size="icon-md" aria-label="문제 아래로 이동" onClick={() => moveQuestion(1)} disabled={Boolean(busy) || activeIndex === draft.questions.length - 1}><ArrowDownIcon size={18} /></Button>
              <Button tone="slate" kind="outline" size="icon-md" aria-label="문제 복제" onClick={copyQuestion} disabled={Boolean(busy)}><CopyIcon size={18} /></Button>
              <Button tone="rose" kind="outline" size="icon-md" aria-label="문제 삭제" onClick={removeQuestion} disabled={Boolean(busy)}><TrashIcon size={18} /></Button>
            </div>
          </div>
          <label className="block text-sm font-medium text-slate-700">질문
            <textarea rows={2} maxLength={4000} value={active.prompt} onChange={(event) => changeQuestion({ prompt: event.target.value })} className={`${inputClass} mt-2 resize-y`} placeholder="질문을 입력하거나 아래에서 사진을 추가하세요" />
          </label>
          {active.imageUrl ? <div className="mt-3"><img src={active.imageUrl} alt="문제 자료" className="max-h-72 max-w-full rounded-xl border border-slate-200 object-contain" /><Button tone="rose" kind="ghost" size="sm" type="button" onClick={() => changeQuestion({ imageUrl: "" })} className="mt-2" disabled={Boolean(busy)}>사진 삭제</Button></div> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 focus-within:ring-2 focus-within:ring-blue-300"><ImageIcon size={18} />{busy === "upload" ? "사진 올리는 중" : "사진 추가"}
              <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={(event) => { void uploadImage(event.target.files?.[0]); event.target.value = ""; }} />
            </label><span className="text-xs text-slate-400">JPG·PNG·WebP · 1MB 이하</span>
          </div>
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium text-slate-700">{active.type === "short_answer" ? "정답" : "보기 · 동그라미를 눌러 정답을 선택하세요"}</p>
            {active.type === "short_answer" ? <input aria-label="단답형 정답" maxLength={500} value={active.correctAnswers.join(", ")} onChange={(event) => changeQuestion({ correctAnswers: [event.target.value] })} className={inputClass} placeholder="여러 정답은 쉼표로 구분하세요" /> : active.options.map((option, index) => <div key={index} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${option && active.correctAnswers[0] === option ? "border-blue-300 bg-blue-50/40" : "border-slate-200"}`}>
              <input type="radio" name={`answer-${active.id}`} aria-label={`보기 ${index + 1} 정답으로 선택`} checked={Boolean(option) && active.correctAnswers[0] === option} disabled={!option.trim()} onChange={() => changeQuestion({ correctAnswers: [option] })} className="h-5 w-5 shrink-0 accent-blue-600" />
              {active.type === "ox" ? <span className="py-1 text-sm font-semibold text-slate-800">{option}</span> : <input aria-label={`보기 ${index + 1}`} maxLength={500} value={option} onChange={(event) => changeQuestion({ options: active.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item), correctAnswers: option && active.correctAnswers[0] === option ? [event.target.value] : active.correctAnswers })} className="min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !px-0 !py-1 text-sm text-slate-800 !shadow-none outline-none focus:!ring-0" placeholder={`보기 ${index + 1}`} />}
            </div>)}
            {active.type === "multiple_choice" ? <div className="flex gap-3 pt-1">
              <Button tone="slate" kind="ghost" size="xs" type="button" onClick={() => changeQuestion({ options: [...active.options, ""] })} disabled={active.options.length >= 5} className="disabled:opacity-40">보기 추가</Button>
              <Button tone="rose" kind="ghost" size="xs" type="button" onClick={() => changeQuestion({ options: active.options.slice(0, -1), correctAnswers: active.correctAnswers[0] === active.options.at(-1) ? [] : active.correctAnswers })} disabled={active.options.length <= 2} className="disabled:opacity-40">마지막 보기 삭제</Button>
            </div> : null}
          </div>
          <details key={active.id} className="mt-5 border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-slate-500">해설 추가 (선택)</summary><textarea aria-label="문제 해설" rows={2} maxLength={4000} value={active.explanation} onChange={(event) => changeQuestion({ explanation: event.target.value })} className={`${inputClass} mt-3`} /></details>
        </section> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="text-slate-600">아직 문제가 없어요. 문제 추가로 시작하세요.</p></div>}
      </div>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 !pr-20 sm:p-4">
        <span className="flex items-center gap-2 text-xs text-slate-500">{dirty ? <WarningCircleIcon size={16} className="text-amber-600" /> : <CheckIcon size={16} />}{dirty ? "저장하지 않은 변경사항" : "초안 · 저장 후 목록에서 공개"}</span>
        <div className="flex flex-wrap gap-2">
          <Button tone="blue" size="sm" icon={FloppyDiskIcon} onClick={save} disabled={Boolean(busy)} isLoading={busy === "save"}>저장</Button>
        </div>
      </div>
      </fieldset>
    </div>
  );
}
