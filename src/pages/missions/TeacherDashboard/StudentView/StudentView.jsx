import { Clock, CheckCircle, FileText, XCircle } from "lucide-react";
import React, { useMemo, useState } from "react";
import { Button } from "../../../../components/ui";

import { useUser } from "../../../../contexts/UserContext";
import DesktopTableView from "./components/DesktopTableView";
import StudentStatsTableView from "./components/StudentStatsTableView";
import MissionDetailModal from "../modals/MissionDetailModal";

const StudentView = ({
  studentMatrix,
  missions,
  allMissions = [],
  onMissionAction,
  isProcessing,
  onApproveMany,
  onCancelMany,
  onRejectMany,
  onSaveFeedbackMany,
  isBusy = false,
  missionsLoading = false,
  allMissionsLoading = false,
  displayMode = "status",
}) => {
  const { isTeacher, hasPermission } = useUser();
  const canManageStudentStatus = isTeacher || hasPermission("mission_admin");
  const [bulkMode, setBulkMode] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const displayedStudents = useMemo(() => (studentMatrix || []).filter((student) =>
    (student.name || "").includes(studentSearch.trim()) && (!pendingOnly || (student.missionStatuses || []).some((entry) =>
      missions?.some((mission) => mission.id === entry.missionId) && ["pending", "late"].includes(entry.status)
    ))
  ), [studentMatrix, studentSearch, pendingOnly, missions]);
  const [selectedMissionId, setSelectedMissionId] = useState(null);
  const isStatsMode = displayMode === "stats";

  const hasStatusMissions = Array.isArray(missions) && missions.length > 0;
  const hasStudents = Array.isArray(studentMatrix) && studentMatrix.length > 0;

  const selectedMission = useMemo(
    () => missions?.find((entry) => entry.id === selectedMissionId) || null,
    [missions, selectedMissionId],
  );

  const handleOpenDetailModal = (mission) => {
    if (!mission?.id) return;
    setSelectedMissionId(mission.id);
  };

  const commonProps = {
    studentMatrix: displayedStudents,
    missions,
    onMissionAction,
    isProcessing,
    readOnly: !canManageStudentStatus,
    allowOpenDetail: !bulkMode,
    onOpenDetailModal: handleOpenDetailModal,
    bulkMode: bulkMode && canManageStudentStatus,
    onApproveMany,
    onCancelMany,
    onRejectMany,
    isBusy,
  };

  return (
    <div className="space-y-3">
      {isStatsMode ? <div className="px-1 py-1"><p className="text-sm font-semibold text-slate-800">통계</p><p className="text-xs text-slate-500">기간별 참여·꾸준함·수행량을 비교하고 학생을 선택해 제출 기록을 확인합니다.</p></div> : <>
        <div className="teacher-student-controls"><div className="teacher-student-search"><input aria-label="학생 검색" placeholder="학생 이름 검색" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} disabled={isBusy || bulkMode}/><label><input type="checkbox" checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} disabled={isBusy || bulkMode}/>승인 대기 학생만</label></div>{canManageStudentStatus && hasStatusMissions && <Button size="sm" kind={bulkMode ? "solid" : "outline"} tone="blue" onClick={() => setBulkMode((value) => !value)} disabled={isBusy}>{bulkMode ? "선택 모드 종료" : "여러 요청 선택"}</Button>}</div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-1"><p className="text-xs text-slate-500">{displayedStudents.length}명 표시 · 과제 {missions?.length || 0}개</p><div className="teacher-student-status-key"><span className="text-blue-600"><Clock/>승인 대기</span><span className="text-emerald-700"><CheckCircle/>완료</span><span><FileText/>미제출</span><span className="text-rose-600"><XCircle/>반려</span></div></div>
        {canManageStudentStatus && hasStatusMissions && <p className="px-1 text-xs text-slate-500">{bulkMode ? "셀을 클릭하거나 드래그해 선택한 뒤 승인·반려·취소하세요." : "대기 아이콘에서 승인·반려를 선택하고, 과제명을 누르면 제출물을 검토할 수 있습니다."}</p>}
      </>}

      {!isStatsMode ? (
        missionsLoading ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-500">
            <div className="font-semibold text-slate-700">
              선택 과제 상태를 불러오는 중입니다.
            </div>
          </div>
        ) : !hasStudents ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-500">
            <div className="font-semibold text-slate-700">
              표시할 학생이 없습니다.
            </div>
            <div className="mt-2 text-sm text-slate-400">
              학생 데이터를 확인한 뒤 다시 시도해주세요.
            </div>
          </div>
        ) : !hasStatusMissions ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-slate-500">
            <div className="font-semibold text-slate-700">
              상태표에 표시할 과제가 없습니다.
            </div>
            <div className="mt-2 text-sm text-slate-400">
              과제별 보기에서 과제를 선택하면 상태표에 바로 반영됩니다.
            </div>
          </div>
        ) : displayedStudents.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">조건에 맞는 학생이 없습니다.</div>
        ) : (
          <DesktopTableView {...commonProps} />
        )
      ) : allMissionsLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-500">
          <div className="font-semibold text-slate-700">
            학생 통계를 계산하는 중입니다.
          </div>
        </div>
      ) : (
        <StudentStatsTableView
          studentMatrix={studentMatrix}
          missions={allMissions}
        />
      )}

      {!isStatsMode && selectedMission && (
        <MissionDetailModal
          isOpen={!!selectedMission}
          onClose={() => setSelectedMissionId(null)}
          mission={selectedMission}
          studentMatrix={studentMatrix}
          onApproveMany={onApproveMany}
          onCancelMany={onCancelMany}
          onRejectMany={onRejectMany}
          onSaveFeedbackMany={onSaveFeedbackMany}
        />
      )}
    </div>
  );
};

export default StudentView;
