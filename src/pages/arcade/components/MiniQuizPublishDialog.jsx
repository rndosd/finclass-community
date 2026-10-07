import React, { useEffect, useState } from "react";
import Modal from "../../../components/ui/Modal";
import Button from "../../../components/ui/Button";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { getMiniQuizEditorData, publishMiniQuiz } from "../services/arcadeServices";
import { maxQuizReward, questionForEditing, validateQuizPublication } from "../utils/miniQuizEditor";

const fields = [["questionCount", "출제 문항 수"], ["dailyLimit", "하루 풀이 횟수"], ["weeklyLimit", "주간 풀이 횟수"], ["participationReward", "참여 보상"], ["rewardPerCorrect", "정답당 보상"], ["perfectBonus", "만점 보너스"]];
const inputClass = "mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

export default function MiniQuizPublishDialog({ classId, quizId, defaults, currencyName, onClose, onPublished, onEdit }) {
  const { formatClassCurrency } = useNumberFormat();
  const [draft, setDraft] = useState(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setDraft(null); setError("");
    getMiniQuizEditorData(classId, quizId).then(({ quiz, questions }) => {
      if (cancelled) return;
      setLive(quiz.visibility === "public");
      setDraft({ title: quiz.draft?.title ?? quiz.title ?? "", description: quiz.draft?.description ?? quiz.description ?? "", difficulty: quiz.draft?.difficulty ?? quiz.difficulty ?? "normal", questions: questions.map(questionForEditing), settings: { ...defaults, ...quiz.settings, ...quiz.draft?.settings, questionCount: quiz.draft?.settings?.questionCount ?? quiz.settings?.questionCount ?? questions.length } });
    }).catch((loadError) => { if (!cancelled) setError(loadError.message || "퀴즈를 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [classId, quizId, defaults, retry]);
  const invalid = draft ? validateQuizPublication(draft.title, draft.questions, draft.settings) : "";
  const publish = async () => {
    if (!draft || invalid || busy) return;
    setBusy(true); setError("");
    try { await publishMiniQuiz(classId, quizId, draft); onPublished(); }
    catch (publishError) { setError(publishError.message || "공개하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  };
  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} title={live ? "변경사항 공개" : "퀴즈 공개"} size="md" closeOnOverlayClick={!busy}>
    {error ? <p role="alert" className="mb-4 text-sm text-rose-700">{error}</p> : null}
    {!draft ? <div className="space-y-4"><p className="text-sm text-slate-500">{error ? "불러오기에 실패했습니다." : "퀴즈를 불러오는 중입니다."}</p>{error ? <Button onClick={() => setRetry(retry + 1)} tone="slate" kind="outline">다시 불러오기</Button> : null}</div> : <div className="space-y-4">
      <div><h2 className="break-words text-lg font-semibold text-slate-900">{draft.title || "제목 없는 퀴즈"}</h2><p className="mt-1 text-sm text-slate-500">저장한 문제를 작성 순서대로 학생에게 공개합니다.</p></div>
      <dl className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-slate-500">출제</dt><dd>{draft.settings.questionCount}문제 / 전체 {draft.questions.length}문제</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-500">풀이 제한</dt><dd>하루 {Number(draft.settings.dailyLimit) > 0 ? `${draft.settings.dailyLimit}회` : "제한 없음"} · 주간 {Number(draft.settings.weeklyLimit) > 0 ? `${draft.settings.weeklyLimit}회` : "제한 없음"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-500">학생별 최대 보상</dt><dd className="font-semibold">{Number.isFinite(maxQuizReward(draft.settings)) ? formatClassCurrency(maxQuizReward(draft.settings)) : "—"}{currencyName}</dd></div>
      </dl>
      <p className="text-xs leading-5 text-slate-500">풀이 횟수는 첫 풀이와 재도전을 포함합니다. 재도전 보상은 최고 점수가 올라간 차액만 지급하며, 최대 보상은 세전 기준입니다.</p>
      <details className="border-t border-slate-200 pt-3"><summary className="cursor-pointer text-sm font-medium text-slate-600">문제 미리보기</summary><div className="mt-3 max-h-64 space-y-4 overflow-y-auto">
        {draft.questions.slice(0, Number(draft.settings.questionCount) || 0).map((question, index) => <div key={question.id} className="border-b border-slate-100 pb-3"><p className="whitespace-pre-wrap text-sm font-semibold">{index + 1}. {question.prompt || "사진을 보고 답하세요."}</p>{question.imageUrl ? <img src={question.imageUrl} alt={`문제 ${index + 1} 자료`} className="mt-2 max-h-48 max-w-full object-contain" /> : null}<div className="mt-2 space-y-1 text-sm text-slate-600">{question.type === "short_answer" ? <p>학생이 답을 입력하는 문제</p> : question.options.filter(Boolean).map((option, optionIndex) => <p key={optionIndex}>{optionIndex + 1}. {option}</p>)}</div></div>)}
      </div></details>
      <details className="border-t border-slate-200 pt-3"><summary className="cursor-pointer text-sm font-medium text-slate-600">출제 설정 변경</summary>
        <fieldset disabled={busy} className="mt-4 grid gap-3 sm:grid-cols-2">
          {fields.map(([field, label]) => <label key={field} className="text-sm text-slate-700">{label}<input type="number" min={field === "questionCount" ? 1 : 0} max={field === "questionCount" ? draft.questions.length : undefined} step={1} value={draft.settings[field]} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, [field]: event.target.value } })} className={inputClass} />{field.endsWith("Limit") ? <span className="text-xs text-slate-400">0은 제한 없음</span> : null}</label>)}
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2"><input type="checkbox" checked={draft.settings.showCorrectAfterSubmit !== false} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, showCorrectAfterSubmit: event.target.checked } })} />제출 후 정답과 해설 보여주기</label>
        </fieldset>
      </details>
      {invalid ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{invalid}</p> : null}
      {live ? <p className="text-xs text-slate-500">참여·보상 기록은 유지됩니다. 저장한 수정 초안이 있으면 함께 반영됩니다.</p> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
        <Button tone="slate" kind="ghost" onClick={onClose} disabled={busy}>취소</Button>
        {invalid ? <Button tone="slate" kind="outline" onClick={onEdit} disabled={busy}>문제 편집</Button> : null}
        <Button tone="blue" onClick={publish} disabled={Boolean(invalid) || busy} isLoading={busy}>{live ? "변경사항 공개" : "학생에게 공개"}</Button>
      </div>
    </div>}
  </Modal>;
}
