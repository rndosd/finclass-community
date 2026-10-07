import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart3, PlusCircle, Settings2 } from "lucide-react";

import { Button } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { useClassStudents } from "../../../hooks/user/useClassStudents";
import { useMissionTokenCreditConfig } from "../hooks/useMissionTokenCreditConfig";
import { useTeacherMissionDashboardRQ } from "../hooks/useTeacherMissionDashboardRQ";
import { useMissionViewSettingsRQ as useMissionViewSettings } from "../hooks/useMissionViewSettingsRQ";
import { isMissionAssignedToStudent } from "../utils/missionEligibility";
import { getMissionStatus } from "../utils/missionHelpers";
import { getStudentStatusDisplayMissions } from "../utils/studentStatusMissions";
import { useTeacherMissionActions } from "./hooks/useTeacherMissionActions.js";
import MissionView from "./MissionView/MissionView";
import ApprovalInbox from "./ApprovalInbox/ApprovalInbox";
import StudentView from "./StudentView/StudentView";
import MissionAddModal from "./modals/MissionAddModal";
import MissionTokenCreditSettingsModal from "./modals/MissionTokenCreditSettingsModal";

const EMPTY_ARRAY = [];

const missionUsesSubmission = (mission) =>
  mission?.type === "challenge" || !!mission?.requireSubmissionForm;

const TeacherDashboard = ({
  onRefresh,
  onMissionAction: externalOnMissionAction,
  isProcessing: externalIsProcessing,
  activeView = "approvals",
  onViewChange,
}) => {
  const { classId, classData, userData, isTeacher, hasPermission } = useUser();
  const { data: studentList = [], isLoading: rosterLoading } = useClassStudents(classId, {
    enabled: !!classId,
    realtime: true,
  });

  const isMissionAdmin = hasPermission("mission_admin");
  const canAccess = isTeacher || isMissionAdmin;
  const canManageMissionEconomy = canAccess;
  const [isMissionEconomyModalOpen, setIsMissionEconomyModalOpen] =
    useState(false);

  const missionViewSettings = useMissionViewSettings();
  const { settings } = missionViewSettings;
  const missionTokenCreditConfig = useMissionTokenCreditConfig(classId, {
    enabled: canManageMissionEconomy && isMissionEconomyModalOpen,
  });
  const selectedMissionIds = Array.isArray(settings?.selectedMissionIds)
    ? settings.selectedMissionIds
    : EMPTY_ARRAY;

  const effectiveView = isTeacher ? activeView : "students";
  const [studentDisplayMode, setStudentDisplayMode] = useState("status");
  const [headerActionsTarget, setHeaderActionsTarget] = useState(null);
  const isStudentStatsView =
    effectiveView === "students" && studentDisplayMode === "stats";
  const isStudentStatusView =
    effectiveView === "students" && studentDisplayMode !== "stats";
  const [isMissionModalOpen, setIsMissionModalOpen] = useState(false);
  const [singleActionProcessing, setSingleActionProcessing] = useState(
    () => new Set(),
  );
  const [visibleMissionIds, setVisibleMissionIds] = useState(EMPTY_ARRAY);
  const [missionReadRange, setMissionReadRange] = useState(null);

  const teacherMissionData = useTeacherMissionDashboardRQ(classId, {
    enabled: canAccess && !!classId,
    selectedMissionIds: isStudentStatusView ? selectedMissionIds : EMPTY_ARRAY,
    loadAllRawMissions: false,
    allowRawFallback: false,
    studentUids: studentList.map((student) => student.uid || student.id),
    rosterReady: !rosterLoading,
    visibleMissionIds: effectiveView === "missions" ? visibleMissionIds : EMPTY_ARRAY,
    rangeStart: missionReadRange,
    includeLegacyCatalog: classData?.missionStudentStateVersion !== 2,
  });

  const { approveMany, cancelMany, rejectMany, saveFeedbackMany, isBusy } =
    useTeacherMissionActions();

  useEffect(() => {
    if (activeView !== "students") {
      setStudentDisplayMode("status");
    }
  }, [activeView]);

  useEffect(() => {
    setHeaderActionsTarget(
      document.getElementById("teacher-mission-header-actions"),
    );
  }, []);

  const handleOpenStats = () => {
    onViewChange?.("students");
    setStudentDisplayMode("stats");
  };

  const setProcessingState = useCallback((missionId, actionKey, isActive) => {
    if (!missionId || !actionKey) return;

    setSingleActionProcessing((prev) => {
      const next = new Set(prev);
      const key = `${missionId}:${actionKey}`;

      if (isActive) next.add(key);
      else next.delete(key);

      return next;
    });
  }, []);

  const localIsProcessing = useCallback(
    (missionId, actionKey) =>
      singleActionProcessing.has(`${missionId}:${actionKey}`),
    [singleActionProcessing],
  );

  const students = useMemo(
    () => (Array.isArray(studentList) ? studentList : []),
    [studentList],
  );

  const inboxStudents = useMemo(() => userData?.uid && !students.some((student) => (student.uid || student.id) === userData.uid)
    ? [...students, { uid: userData.uid, name: userData.name || "교사", role: userData.role }]
    : students, [students, userData]);

  const selectedRawMissions =
    teacherMissionData.selectedRawMissions || EMPTY_ARRAY;
  const allRawMissions = teacherMissionData.allRawMissions || EMPTY_ARRAY;
  const summaryMissions = teacherMissionData.summaryMissions || EMPTY_ARRAY;

  const selectedMissions = useMemo(
    () =>
      getStudentStatusDisplayMissions({
        allMissions: selectedRawMissions,
        selectedMissionIds,
      }),
    [selectedMissionIds, selectedRawMissions],
  );

  const studentMatrix = useMemo(() => {
    const base = Array.isArray(students) ? [...students] : [];

    if (userData && !base.some((student) => student.uid === userData.uid)) {
      base.unshift({
        uid: userData.uid,
        name: userData.name || (isTeacher ? "교사" : "학생"),
        role: isTeacher ? "teacher" : userData.role || "student",
        studentNumber: 0,
      });
    }

    if (!selectedMissions?.length) {
      return base.map((member) => ({
        ...member,
        missionStatuses: [],
        completionRate: 0,
      }));
    }

    return base.map((member) => {
      const applicableMissions = selectedMissions.filter((mission) =>
        isMissionAssignedToStudent(mission, member, member.uid),
      );

      const missionStatuses = applicableMissions.map((mission) => ({
        missionId: mission.id,
        status: getMissionStatus(mission, member.uid),
      }));

      const total = applicableMissions.length;
      const approved = missionStatuses.filter(
        (statusInfo) =>
          statusInfo.status === "approved" ||
          statusInfo.status === "late-approved",
      ).length;

      const completionRate =
        total > 0 ? Math.round((approved / total) * 100) : 0;

      return {
        ...member,
        missionStatuses,
        completionRate,
      };
    });
  }, [students, selectedMissions, userData, isTeacher]);

  const handleNewMission = () => setIsMissionModalOpen(true);

  const handleMissionModalSuccess = () => {
    setIsMissionModalOpen(false);
  };

  const actionMissionMap = useMemo(() => {
    const map = new Map();
    [...selectedRawMissions, ...allRawMissions].forEach((mission) => {
      if (!mission?.id) return;
      map.set(mission.id, mission);
    });
    return map;
  }, [allRawMissions, selectedRawMissions]);

  const localOnMissionAction = useCallback(
    async (action, missionId, studentUid) => {
      if (!missionId || !studentUid) return;

      const mission = actionMissionMap.get(missionId);
      if (!mission) {
        throw new Error("과제를 찾을 수 없습니다.");
      }

      const usesSubmission = missionUsesSubmission(mission);
      const submissionId =
        mission?.submissionsIndex?.[studentUid] ||
        mission?.completions?.[studentUid]?.submissionId ||
        null;
      const actionKey = action === "cancel" ? "cancel-approval" : action;

      try {
        setProcessingState(missionId, `${actionKey}-${studentUid}`, true);

        if (action === "approve") {
          await approveMany(missionId, [
            {
              uid: studentUid,
              submissionId: usesSubmission ? submissionId : null,
            },
          ]);
          return;
        }

        if (action === "cancel" || action === "cancel-approval") {
          await cancelMany(missionId, [studentUid]);
          return;
        }

        if (action === "reject") {
          if (usesSubmission) {
            if (!submissionId) {
              throw new Error("제출 정보를 찾을 수 없습니다.");
            }

            await rejectMany(missionId, {
              submissionIds: [submissionId],
              options: { revertTo: "rejected" },
            });
            return;
          }

          await rejectMany(missionId, {
            studentUids: [studentUid],
            options: { revertTo: "rejected" },
          });
        }
      } finally {
        setProcessingState(missionId, `${actionKey}-${studentUid}`, false);
      }
    },
    [actionMissionMap, approveMany, cancelMany, rejectMany, setProcessingState],
  );

  const resolvedOnMissionAction =
    externalOnMissionAction || localOnMissionAction;
  const resolvedIsProcessing = externalIsProcessing || localIsProcessing;

  return (
    <div className="space-y-6">
      {!canAccess ? (
        <div className="rounded-lg border bg-white p-6 text-sm text-slate-600">
          이 영역은 <b>교사</b> 또는 <b>과제 관리자(mission_admin)</b>만 사용할
          수 있습니다.
        </div>
      ) : (
        <>
          {headerActionsTarget && isTeacher
            ? createPortal(
                <>
                  <Button
                    onClick={handleOpenStats}
                    icon={BarChart3}
                    tone="lightBlue"
                    kind={isStudentStatsView ? "solid" : "outline"}
                  >
                    통계
                  </Button>
                  {canManageMissionEconomy ? (
                    <Button
                      onClick={() => setIsMissionEconomyModalOpen(true)}
                      icon={Settings2}
                      tone="lightBlue"
                      kind="outline"
                      disabled={missionTokenCreditConfig.isSaving}
                    >
                      토큰 전환 설정
                    </Button>
                  ) : null}
                  {isTeacher ? (
                    <Button
                      onClick={handleNewMission}
                      icon={PlusCircle}
                      tone="lightBlue"
                      disabled={isBusy}
                    >
                      새 과제 만들기
                    </Button>
                  ) : null}
                </>,
                headerActionsTarget,
              )
            : null}

          {teacherMissionData.error ? (
            <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
              과제 상태를 불러오지 못했습니다. 페이지를 새로고침해주세요.
            </div>
          ) : effectiveView === "approvals" ? (
            <ApprovalInbox classId={classId} students={inboxStudents} missions={summaryMissions}
              catalogLoading={teacherMissionData.loadingSummary || rosterLoading}
              approveMany={approveMany} rejectMany={rejectMany} onViewChange={onViewChange} />
          ) : effectiveView === "students" ? (
            <StudentView
              studentMatrix={studentMatrix}
              missions={selectedMissions}
              allMissions={summaryMissions}
              onMissionAction={resolvedOnMissionAction}
              isProcessing={resolvedIsProcessing}
              onApproveMany={approveMany}
              onCancelMany={cancelMany}
              onRejectMany={rejectMany}
              onSaveFeedbackMany={saveFeedbackMany}
              isBusy={isBusy}
              missionsLoading={teacherMissionData.loadingSelectedRaw}
              allMissionsLoading={teacherMissionData.loadingSummary}
              displayMode={studentDisplayMode}
            />
          ) : (
            <MissionView
              onVisibleMissionIdsChange={setVisibleMissionIds}
              onReadRangeChange={setMissionReadRange}
              missionStats={summaryMissions}
              onRefresh={onRefresh}
              loading={teacherMissionData.loadingSummary}
              missionViewSettings={missionViewSettings}
              studentMatrix={students}
              onApproveMany={approveMany}
              onCancelMany={cancelMany}
              onRejectMany={rejectMany}
              onSaveFeedbackMany={saveFeedbackMany}
            />
          )}

          {isTeacher && (
            <MissionAddModal
              isOpen={isMissionModalOpen}
              onClose={() => setIsMissionModalOpen(false)}
              onSuccess={handleMissionModalSuccess}
            />
          )}

          {canManageMissionEconomy ? (
            <MissionTokenCreditSettingsModal
              isOpen={isMissionEconomyModalOpen}
              onClose={() => setIsMissionEconomyModalOpen(false)}
              currentConfig={missionTokenCreditConfig.config}
              tiers={missionTokenCreditConfig.tiers}
              onSubmitSettings={missionTokenCreditConfig.saveConfig}
              isSubmitting={missionTokenCreditConfig.isSaving}
              isLoading={missionTokenCreditConfig.isLoading}
            />
          ) : null}
        </>
      )}
    </div>
  );
};

export default TeacherDashboard;
