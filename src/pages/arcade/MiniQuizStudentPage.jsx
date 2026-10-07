import { useNumberFormat as useMoneyDisplay } from "../../contexts/NumberFormatContext";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppLayout from "../../components/layout/AppLayout";
import Button from "../../components/ui/Button";
import PageLoader from "../../components/ui/PageLoader";
import MiniQuizModal from "./modals/MiniQuizModal";
import { useUser } from "../../contexts/UserContext";
import { loadPublishedMiniQuizzes, loadMiniQuizQuestions } from "./services/arcadeServices";
import { maxQuizReward } from "./utils/miniQuizEditor";

export default function MiniQuizStudentPage() {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { classId, currencyUnit } = useUser();
  const [quizzes, setQuizzes] = useState(null);
  const [selected, setSelected] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setQuizzes(null); setError(""); setSelected(null);
    if (classId) loadPublishedMiniQuizzes(classId).then((next) => { if (!cancelled) setQuizzes(next); }).catch((failure) => { if (!cancelled) setError(failure.message || "퀴즈를 불러오지 못했어요."); });
    return () => { cancelled = true; };
  }, [classId, retry]);
  const open = async (quiz) => {
    setBusy(quiz.id); setError("");
    try { const next = await loadMiniQuizQuestions(classId, quiz.id); if (!next.length) throw new Error("풀 수 있는 문제가 없어요."); setQuestions(next); setSelected(quiz); }
    catch (failure) { setError(failure.message || "문제를 불러오지 못했어요."); }
    finally { setBusy(""); }
  };
  return <AppLayout><main className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
    <Link to="/arcade" className="text-sm text-slate-500 hover:text-blue-600">← 놀이터로</Link>
    <div><h1 className="text-2xl font-bold text-slate-900">풀고 싶은 퀴즈를 골라요</h1><p className="mt-2 text-sm text-slate-500">더 높은 점수에 도전하면 보상의 차액을 받을 수 있어요.</p></div>
    {error ? <div role="alert" className="space-y-3 rounded-xl bg-rose-50 p-4 text-sm text-rose-700"><p>{error}</p><Button tone="slate" kind="outline" size="sm" onClick={() => setRetry(retry + 1)}>다시 불러오기</Button></div> : null}
    {!classId ? <p>학급 정보를 확인해 주세요.</p> : !quizzes && !error ? <PageLoader /> : quizzes?.length ? <div className="space-y-3">{quizzes.map((quiz) => <section key={quiz.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="min-w-0"><h2 className="break-words font-bold text-slate-900">{quiz.title}</h2><p className="mt-2 text-sm text-slate-600">{quiz.questionCount}문제 · 최고 {quiz.bestCorrectCount}개 정답</p><p className="mt-1 text-sm text-slate-500">받은 보상 {formatDisplayMoney(quiz.paidGross)}{currencyUnit} · 최대 {formatDisplayMoney(maxQuizReward({ ...quiz.settings, questionCount: quiz.questionCount }))}{currencyUnit} <span className="text-xs">(세전)</span></p></div>
      <Button tone="blue" size="sm" onClick={() => open(quiz)} disabled={Boolean(busy)} isLoading={busy === quiz.id}>{quiz.paidGross || quiz.bestCorrectCount ? "다시 도전" : "퀴즈 풀기"}</Button>
    </section>)}</div> : quizzes ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">아직 공개된 퀴즈가 없어요.</p> : null}
    {selected ? <MiniQuizModal key={selected.id} classId={classId} quizId={selected.id} title={selected.title} questions={questions} settings={selected.settings} currencyName={currencyUnit} onClose={() => { setSelected(null); setRetry(retry + 1); }} /> : null}
  </main></AppLayout>;
}
