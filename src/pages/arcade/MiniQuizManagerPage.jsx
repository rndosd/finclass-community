import { appConfirm } from "../../utils/appDialogs";
import React, { useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ArrowLeftIcon, PlusIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import AppLayout from "../../components/layout/AppLayout";
import { Badge, Button, ErrorState, PageHeader, PageLoader } from "../../components/ui";
import { useUser } from "../../contexts/UserContext";
import { useFeedback } from "../../contexts/FeedbackContext";
import MiniQuizEditor from "./components/MiniQuizEditor";
import MiniQuizPublishDialog from "./components/MiniQuizPublishDialog";
import { getArcadeSettings, getMiniQuizEditorData, pauseMiniQuiz, subscribeMiniQuizQuestionSets } from "./services/arcadeServices";

const displayDate = (timestamp) => timestamp?.toDate ? timestamp.toDate().toLocaleDateString("ko-KR") : "—";

function QuizList({ sets, onCreate, onEdit, onSettings, onPause, busy }) {
  return <div className="space-y-5">
    <Link to="/arcade" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600"><ArrowLeftIcon size={16} />놀이터로</Link>
    <PageHeader title="퀴즈 관리" useCustomTitle={false} subtitle="퀴즈를 만들고 학생에게 공개하세요." actions={sets.length ? <Button tone="blue" icon={PlusIcon} onClick={onCreate}>퀴즈 만들기</Button> : null} />
    {sets.length ? <>
      <p className="text-sm text-slate-500">전체 {sets.length}개 · 공개 중 {sets.filter((quiz) => quiz.visibility === "public").length}개</p>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="hidden grid-cols-[minmax(0,1fr)_80px_140px_100px_160px] gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold text-slate-500 lg:grid"><span>퀴즈</span><span>문제</span><span>상태</span><span>수정일</span><span className="text-right">작업</span></div>
        {sets.map((quiz) => {
          const live = quiz.visibility === "public";
          return <div key={quiz.id} className="grid items-center gap-3 border-b border-slate-100 px-5 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_80px_140px_100px_160px]">
            <div className="min-w-0"><button type="button" onClick={() => onEdit(quiz.id)} className="max-w-full truncate text-left text-sm font-semibold text-slate-900 hover:text-blue-600">{quiz.draft?.title || quiz.title || "제목 없는 퀴즈"}</button>{live && quiz.draft ? <p className="mt-1 text-xs text-slate-500">수정 초안이 있어요. 공개 중인 문제는 유지됩니다.</p> : null}</div>
            <span className="text-sm text-slate-600">{quiz.draft?.questions?.length ?? quiz.questionCount ?? 0}문제</span>
            <div><Badge tone={live ? "emerald" : "slate"}>{live ? "공개 중" : quiz.draft ? "작성 중" : "비공개"}</Badge></div>
            <span className="text-xs text-slate-500">{displayDate(quiz.updatedAt)}</span>
            <div className="flex flex-wrap justify-start gap-2 lg:justify-end"><Button size="sm" tone="slate" kind="outline" icon={PencilSimpleIcon} onClick={() => onEdit(quiz.id)} disabled={busy}>편집</Button><button type="button" className="text-xs font-medium text-blue-600 hover:text-blue-800" onClick={() => onSettings(quiz.id)} disabled={busy}>{live ? "공개 설정" : "공개"}</button>{live ? <><button type="button" className="text-xs font-medium text-slate-500 hover:text-rose-600 disabled:opacity-40" onClick={() => onPause(quiz.id)} disabled={busy}>공개 중단</button></> : null}</div>
          </div>;
        })}
      </div>
    </> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-16 text-center"><h2 className="text-lg font-bold text-slate-800">첫 퀴즈를 만들어 보세요</h2><p className="mt-2 text-sm text-slate-500">질문을 쓰거나 사진을 넣고 정답을 선택하면 돼요.</p><Button tone="blue" icon={PlusIcon} onClick={onCreate} className="mt-5">퀴즈 만들기</Button></div>}
  </div>;
}

function QuizEditorLoader({ classId, userId, config, currencyName, onBack, onSaved }) {
  const { quizId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false; setError(""); setData(null);
    if (!quizId) { setData({ quiz: null, questions: [] }); return () => { cancelled = true; }; }
    getMiniQuizEditorData(classId, quizId).then((next) => { if (!cancelled) setData(next); }).catch((loadError) => { if (!cancelled) setError(loadError.message || "퀴즈를 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [classId, quizId, retry]);
  if (error) return <div className="space-y-4"><ErrorState variant="section" title="퀴즈를 불러오지 못했습니다." description={error} onRetry={() => setRetry(previous => previous + 1)} retryLabel="다시 불러오기" /><Button tone="slate" kind="ghost" onClick={onBack}>목록으로</Button></div>;
  if (!data) return <PageLoader message="퀴즈를 불러오는 중입니다." />;
  return <MiniQuizEditor key={`${classId}:${quizId || "new"}:${retry}`} classId={classId} quiz={data.quiz ? { ...data.quiz, isLive: data.quiz.visibility === "public" } : null} initialQuestions={data.questions} settings={config} currencyName={currencyName} cacheKey={`finclass:quiz-draft:${userId}:${classId}:${quizId || "new"}`} onBack={onBack} onSaved={onSaved} />;
}

export default function MiniQuizManagerPage() {
  const { isTeacher, loading, classId, userData, currencyUnit } = useUser();
  const { showFeedback } = useFeedback();
  const navigate = useNavigate();
  const [sets, setSets] = useState(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [publishId, setPublishId] = useState(null);
  useEffect(() => {
    if (!isTeacher || !classId) return undefined;
    let cancelled = false; setSets(null); setConfig(null); setError("");
    getArcadeSettings(classId).then((settings) => { if (!cancelled) setConfig(settings.games.miniQuiz); }).catch(() => { if (!cancelled) setError("출제 설정을 불러오지 못했습니다."); });
    const unsubscribe = subscribeMiniQuizQuestionSets(classId, setSets, () => setError("퀴즈 목록을 불러오지 못했습니다. 학급과 권한을 확인해 주세요."));
    return () => { cancelled = true; unsubscribe(); };
  }, [classId, isTeacher, retry]);
  const pause = async (id) => {
    if (!(await appConfirm("이 퀴즈의 공개를 중단할까요? 학생은 더 이상 응시할 수 없습니다."))) return;
    setBusy(true);
    try { await pauseMiniQuiz(classId, id); setRetry((previous) => previous + 1); showFeedback("퀴즈 공개를 중단했습니다.", "success"); }
    catch (pauseError) { showFeedback(pauseError.message || "공개를 중단하지 못했습니다.", "error"); }
    finally { setBusy(false); }
  };
  const published = async () => {
    showFeedback("퀴즈를 학생에게 공개했습니다.", "success");
    setPublishId(null); navigate("/arcade/quizzes"); setRetry((previous) => previous + 1);
  };
  return <AppLayout><div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
    {loading ? <PageLoader /> : !isTeacher ? <div className="space-y-3"><h1 className="text-xl font-bold text-slate-900">교사 전용 퀴즈 관리</h1><p className="text-sm text-slate-600">학생은 놀이터에서 공개된 퀴즈를 풀 수 있어요.</p><Link to="/arcade" className="text-sm text-blue-600">놀이터로 돌아가기</Link></div> : !classId ? <p role="alert">학급을 선택한 뒤 퀴즈를 만들 수 있습니다.</p> : error ? <ErrorState title="퀴즈 목록을 불러오지 못했습니다." description={error} onRetry={() => setRetry(previous => previous + 1)} retryLabel="다시 불러오기" /> : !sets || !config ? <PageLoader message="퀴즈를 불러오는 중입니다." /> : <Routes>
      <Route index element={<QuizList sets={sets} busy={busy} onCreate={() => navigate("/arcade/quizzes/new")} onEdit={(id) => navigate(`/arcade/quizzes/${id}`)} onSettings={setPublishId} onPause={pause} />} />
      <Route path="new" element={<QuizEditorLoader classId={classId} userId={userData?.uid} config={config} currencyName={currencyUnit} onBack={() => navigate("/arcade/quizzes")} onSaved={() => { showFeedback("퀴즈를 저장했습니다. 목록에서 학생에게 공개할 수 있어요.", "success"); navigate("/arcade/quizzes"); }} />} />
      <Route path=":quizId" element={<QuizEditorLoader classId={classId} userId={userData?.uid} config={config} currencyName={currencyUnit} onBack={() => navigate("/arcade/quizzes")} onSaved={() => { showFeedback("퀴즈를 저장했습니다. 목록에서 학생에게 공개할 수 있어요.", "success"); navigate("/arcade/quizzes"); }} />} />
    </Routes>}
    {isTeacher && classId && publishId && config ? <MiniQuizPublishDialog classId={classId} quizId={publishId} defaults={config} currencyName={currencyUnit} onClose={() => setPublishId(null)} onPublished={published} onEdit={() => { const id = publishId; setPublishId(null); navigate(`/arcade/quizzes/${id}`); }} /> : null}
  </div></AppLayout>;
}
