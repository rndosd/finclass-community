import { appConfirm } from "../../utils/appDialogs";
import { useNumberFormat as useMoneyDisplay } from "../../contexts/NumberFormatContext";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase";
import { useUser } from "../../contexts/UserContext";
import { useFeedback } from "../../contexts/FeedbackContext";
import AppLayout from "../../components/layout/AppLayout";
import { Alert, Button, Checkbox, PageSkeleton, SurfaceLoader , Tabs} from "../../components/ui";
import useClassMaintenance from "./hooks/useClassMaintenance";
import ClassResetPanel from "./components/ClassResetPanel";
import { getMaintenanceStatus } from "./utils/maintenanceStatus";

const TABS = [
  { id: "delete", label: "학생 계정 삭제" },
  { id: "activity", label: "활동 초기화" },
  { id: "full", label: "학급 전체 초기화" },
];

export default function DeleteStudents() {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { classId } = useUser();
  const classScope = useRef(classId);
  classScope.current = classId;
  const { showFeedback } = useFeedback();
  const [activeTab, setActiveTab] = useState("delete");
  const [students, setStudents] = useState([]);
  const [selectedUids, setSelectedUids] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [className, setClassName] = useState("");
  const [initialCapital, setInitialCapital] = useState("0");
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState(null);
  const maintenance = useClassMaintenance(classId, showFeedback);
  const disabled = maintenance.busy || maintenance.checking || Boolean(maintenance.pending);
  const pendingStatus = maintenance.pending ? getMaintenanceStatus(maintenance.pending, maintenance.busy) : null;

  const fetchStudents = useCallback(async (refresh = false) => {
    if (!classId) { setLoading(false); return; }
    if (refresh) setRefreshing(true);
    try {
      const [snapshot, classSnap] = await Promise.all([
        getDocs(query(collection(db, "classes", classId, "students"), orderBy("studentNumber", "asc"))),
        getDoc(doc(db, "classes", classId)),
      ]);
      if (classScope.current !== classId) return;
      setStudents(snapshot.docs.map((snap) => ({ ...snap.data(), uid: snap.id })).filter((student) => student.role === "student"));
      setClassName(classSnap.data()?.className || classSnap.data()?.name || "학급");
    } catch {
      showFeedback("학생 목록을 불러오지 못했습니다.", "error");
    } finally { if (classScope.current === classId) { setLoading(false); setRefreshing(false); } }
  }, [classId, showFeedback]);

  useEffect(() => { setLoading(true); setStudents([]); setSelectedUids(new Set()); setConfirmation(""); setClassName(""); setResult(null); fetchStudents(); }, [fetchStudents]);

  useEffect(() => {
    if (!maintenance.completedOperationId) return;
    setSelectedUids(new Set());
    setResult("데이터 정리 작업이 완료되었습니다.");
    fetchStudents(true);
  }, [maintenance.completedOperationId, fetchStudents]);

  const pageGuide = useMemo(() => ({
    type: "quest", title: "학생 정리 도우미", launcherTitle: "학생 정리 도우미",
    launcherDescription: "학생 삭제와 두 가지 초기화의 범위를 확인합니다.",
    subtitle: "유지·삭제 범위를 확인하고 필요한 작업을 선택하세요.",
    storageKey: `finclass_delete_students_quest_${classId || "none"}`,
    tourKey: "TEACHER_DELETE_STUDENTS_QUEST_TOUR", guidePath: "/case-library",
    quests: [{ id: "scope", title: "작업 범위 확인하기", description: "학생 삭제, 활동 초기화, 전체 초기화의 범위를 확인합니다.", manualComplete: true,
      locationSteps: [{ target: '[data-tour="delete-students-tabs"]', title: "관리 탭", content: "활동 초기화는 계정을 보존하며 전체 초기화은 학생 계정도 삭제합니다." }] }],
    extraQuests: [{ id: "result", title: "처리 결과 확인하기", description: "중단된 작업은 새로운 작업을 시작하지 않고 재시도합니다.", completed: Boolean(result), manualComplete: true,
      locationSteps: [{ target: '[data-tour="delete-students-content"]', title: "처리 상태", content: "실패 시 같은 작업을 재시도하고 완료 여부를 확인합니다." }] }],
  }), [classId, result]);

  const toggleSelect = (uid) => {
    if (disabled) return;
    setSelectedUids((previous) => { const next = new Set(previous); if (next.has(uid)) next.delete(uid); else next.add(uid); return next; });
  };
  const complete = async (response) => {
    if (classScope.current !== classId) return;
    if (!response?.success) { await fetchStudents(true); return; }
    setResult(response.message || "데이터 정리 작업이 완료되었습니다.");
    setSelectedUids(new Set());
    setConfirmation("");
    await fetchStudents(true);
  };
  const handleDelete = async () => {
    if (disabled || !selectedUids.size) return;
    if (!(await appConfirm(`선택한 ${selectedUids.size}명의 로그인 계정·명단·개인 데이터를 삭제할까요? 다른 학생의 거래 증빙은 유지되며 이 작업은 되돌릴 수 없습니다.`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;
    setResult(null);
    await complete(await maintenance.execute("delete", { studentUids: [...selectedUids] }));
  };
  const handleReset = async () => {
    if (disabled || confirmation !== className) return;
    const capital = Number(initialCapital);
    if (activeTab === "activity" && (!initialCapital.trim() || !Number.isSafeInteger(capital) || capital < 0 || capital > 100000000)) {
      showFeedback("초기 현금은 0~100,000,000 사이의 정수로 입력해 주세요.", "error"); return;
    }
    const message = activeTab === "activity"
      ? `${students.length}명의 계정과 수업 설정을 유지하고 경제 상태와 활동을 초기화할까요? 학생 현금은 ${formatDisplayMoney(capital)}으로 복원됩니다.`
      : `${students.length}명의 로그인 계정과 명단, 활동 기록, 수업 데이터를 삭제할까요?`;
    if (!(await appConfirm(message))) return;
    setResult(null);
    await complete(await maintenance.execute(activeTab, { confirmation, initialCapital: capital }));
  };
  const handleRetry = async () => {
    if (!maintenance.pending) return;
    await complete(await maintenance.execute(maintenance.pending.type, {}, true));
  };

  if (loading) return <AppLayout><div className="mx-auto max-w-5xl p-6"><PageSkeleton variant="admin" /></div></AppLayout>;

  return (
    <AppLayout pageGuide={pageGuide}>
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-slate-900 text-[28px] leading-9 font-extrabold sm:text-[32px] sm:leading-10">학생 계정 관리</h1><p className="mt-2 text-sm text-slate-600">학생을 삭제하거나, 명단을 유지한 채 활동 기록을 초기화할 수 있습니다.</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600">등록 학생 {students.length}명</span></div>
        <p className="text-sm text-slate-600">이름만 바꾸려면 계정을 삭제할 필요가 없습니다. <Link to="/manage/students/create?tab=existing" className="font-semibold text-blue-600 underline">기존 학생 이름 수정</Link></p>
        <div data-tour="delete-students-tabs"><Tabs ariaLabel="학생 및 학급 데이터 관리" idPrefix="maintenance" tabs={TABS.map(tab=>({...tab,panelId:`maintenance-panel-${tab.id}`}))} activeTab={activeTab} onTabChange={id=>{setActiveTab(id);setConfirmation("");}} variant="pills" size="md" fullWidth wrapLabels /></div>
        {maintenance.checking && <div className="space-y-3"><Alert type="warning" message="초기화 상태를 확인해야 새 작업을 실행할 수 있습니다." /><Button variant="outline" onClick={maintenance.check} disabled={maintenance.busy}>상태 확인</Button></div>}
        {maintenance.pending && <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4" aria-live="polite">
          <p className="text-sm text-slate-700"><strong>{TABS.find((tab) => tab.id === maintenance.pending.type)?.label}</strong> · {pendingStatus.title}</p>
          <p className="text-sm text-slate-600">{pendingStatus.message}</p>
          {maintenance.pending.completedSteps > 0 && <p className="text-xs text-slate-500">완료한 단계 {maintenance.pending.completedSteps}개 · 완료한 단계는 다시 처리하지 않습니다.</p>}
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={maintenance.check} disabled={maintenance.busy}>상태 확인</Button><Button onClick={handleRetry} disabled={maintenance.busy || maintenance.checking || maintenance.pending.canRetry === false} isLoading={maintenance.busy}>이어서 정리하기</Button></div>
        </div>}
        {result && <Alert type="success" message={result} />}
        <SurfaceLoader loading={refreshing} variant="refreshing" message="학생 목록을 새로고침하는 중입니다...">
          <div data-tour="delete-students-content" id={`maintenance-panel-${activeTab}`} role="tabpanel" aria-labelledby={`maintenance-tab-${activeTab}`}>
            {activeTab === "delete" ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="space-y-4 border-b border-slate-100 bg-slate-50 p-5"><h2 className="text-lg font-bold text-slate-900">삭제할 학생 선택</h2><p className="text-sm leading-relaxed text-slate-600">삭제할 학생을 선택해 주세요. 로그인 계정과 명단, 개인 활동 기록을 함께 정리합니다.</p>
                <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Checkbox checked={students.length > 0 && selectedUids.size === students.length} disabled={disabled || !students.length} onChange={(event) => setSelectedUids(event.target.checked ? new Set(students.map((student) => student.uid)) : new Set())} />전체 선택 <span className="font-normal text-slate-500">{selectedUids.size}명 선택됨</span></label><Button variant="destructive" onClick={handleDelete} disabled={disabled || !selectedUids.size} isLoading={maintenance.busy && maintenance.pending?.type === "delete"}>{selectedUids.size ? `선택한 ${selectedUids.size}명 삭제` : "선택한 학생 삭제"}</Button></div>
              </div>
              <div className="border-b border-slate-100 px-5 py-3 text-sm text-rose-700">삭제한 학생은 로그인할 수 없으며, 삭제된 기록은 되돌릴 수 없습니다. 다른 학생의 거래 기록과 수업 설정은 유지됩니다.</div>
              <div className="p-5">{students.length ? <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{students.map((student) => <label key={student.uid} className={`flex items-center gap-3 rounded-xl border p-4 transition-colors ${disabled ? "opacity-60" : "cursor-pointer hover:border-blue-300"} ${selectedUids.has(student.uid) ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}><Checkbox checked={selectedUids.has(student.uid)} disabled={disabled} onChange={() => toggleSelect(student.uid)} /><span className="min-w-0 space-y-1"><span className="block truncate font-semibold text-slate-900"><span className="mr-2 text-sm font-normal text-slate-500">{student.studentNumber}번</span>{student.name}</span><span className="block truncate text-xs text-slate-500"><span className="mr-1.5">로그인 아이디</span>{student.email || "등록된 아이디 없음"}</span></span></label>)}</div> : <p className="py-10 text-center text-sm text-slate-500">현재 등록된 학생이 없습니다.</p>}</div>
            </div> : <ClassResetPanel type={activeTab} studentCount={students.length} initialCapital={initialCapital} onCapitalChange={(event) => setInitialCapital(event.target.value)} confirmation={confirmation} onConfirmationChange={(event) => setConfirmation(event.target.value)} className={className} disabled={disabled} busy={maintenance.busy} onExecute={handleReset} />}
          </div>
        </SurfaceLoader>
      </div>
    </AppLayout>
  );
}
