import MissionActionDialog from "./components/MissionActionDialog";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { GraduationCap, Lightbulb, Target } from "lucide-react";

import AppLayout from "../../components/layout/AppLayout";
import {
  CardSkeleton,
  PageHeader,
  SurfaceLoader,
  Tabs,
} from "../../components/ui";
import { useUser } from "../../contexts/UserContext";
import StudentDashboard from "./StudentDashboard/StudentDashboard";
import TeacherDashboard from "./TeacherDashboard/TeacherDashboard";
import useMissionsRQ from "./hooks/useMissionsRQ";

const STORAGE_KEY = "missionDashboard:lastRole";
const TEACHER_VIEW_STORAGE_KEY = "missionTeacherDashboard:lastView:v2";

const MISSION_TEXT = {
  missionListUpdating:
    "과제 목록을 업데이트하는 중입니다...",
  unavailableTitle:
    "과제 화면을 표시할 수 없습니다.",
  unavailableDescription:
    "\uC0AC\uC6A9\uC790 \uB610\uB294 \uD559\uAE09 \uC815\uBCF4\uB97C \uB2E4\uC2DC \uD655\uC778\uD574 \uC8FC\uC138\uC694.",
  pageTitle: "과제",
  pageSubtitle:
    "학생별 보기와 과제별 보기로 학급 과제 현황을 한눈에 확인해 보세요.",
  studentView: "\uD559\uC0DD",
  missionView: "\uAD00\uB9AC\uC790",
};

const MissionPanelSkeleton = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <CardSkeleton
          key={`mission-summary-skeleton-${index}`}
          rows={3}
          className="rounded-[1.5rem] border-0 bg-white shadow-sm shadow-slate-200/40"
        />
      ))}
    </div>

    <CardSkeleton
      rows={4}
      className="rounded-[1.5rem] border-0 bg-white shadow-sm shadow-slate-200/40"
    />

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <CardSkeleton
        rows={6}
        className="rounded-[1.5rem] border-0 bg-white shadow-sm shadow-slate-200/40"
      />
      <CardSkeleton
        rows={6}
        className="rounded-[1.5rem] border-0 bg-white shadow-sm shadow-slate-200/40"
      />
    </div>
  </div>
);

const MissionDashboardPageSkeleton = ({ showTeacherToggle = false }) => (
  <AppLayout>
    <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
      <div className="space-y-3">
        <div className="h-10 w-48 animate-pulse rounded-2xl bg-slate-200/80" />
        <div className="h-5 w-80 max-w-full animate-pulse rounded-xl bg-slate-200/60" />
      </div>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        {showTeacherToggle ? (
          <div className="mb-6 flex w-fit gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
            <div className="h-9 w-24 animate-pulse rounded-md bg-slate-200/70" />
            <div className="h-9 w-24 animate-pulse rounded-md bg-slate-200/70" />
          </div>
        ) : null}

        <MissionPanelSkeleton />
      </div>
    </div>
  </AppLayout>
);

const ActualStudentMissionPanel = ({ classId, onHeaderActionsChange }) => {
  const { missions, loading, refreshing, refetch, error } = useMissionsRQ(classId, {
    days: 60,
    realtime: true,
    studentMode: true,
  });
  const hasMissionData = Array.isArray(missions) && missions.length > 0;

  if (error) return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
    과제 목록을 불러오지 못했습니다. 페이지를 새로고침해주세요.
  </div>;

  if (loading && !hasMissionData) {
    return <MissionPanelSkeleton />;
  }

  return (
    <SurfaceLoader
      loading={refreshing && hasMissionData}
      variant="refreshing"
      message={MISSION_TEXT.missionListUpdating}
    >
      <StudentDashboard
        missions={missions || []}
        onRefresh={refetch}
        onHeaderActionsChange={onHeaderActionsChange}
        studentMode
      />
    </SurfaceLoader>
  );
};

const StudentMissionPanel = ({ classId, onHeaderActionsChange }) => {
  return <ActualStudentMissionPanel
    classId={classId}
    onHeaderActionsChange={onHeaderActionsChange}
  />;
};

const TeacherMissionPanel = ({ activeView, onViewChange }) => (
  <TeacherDashboard activeView={activeView} onViewChange={onViewChange} />
);

const MissionDashboard = () => {
  const {
    userData,
    classId,
    loading: userLoading,
    isTeacher,
    hasPermission,
  } = useUser();

  const isMissionAdminOnly = !isTeacher && hasPermission("mission_admin");
  const canViewTeacher = isTeacher || hasPermission("mission_admin");
  const canViewStudent = true;

  const getInitialRole = () => {
    if (typeof window === "undefined") {
      return isMissionAdminOnly
        ? "student"
        : canViewTeacher
          ? "teacher"
          : "student";
    }

    if (isMissionAdminOnly) return "student";

    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "teacher" && canViewTeacher) return "teacher";
    if (saved === "student") return "student";
    return canViewTeacher ? "teacher" : "student";
  };

  const [activeRole, setActiveRole] = useState(() => getInitialRole());
  const [activeTeacherView, setActiveTeacherView] = useState(() => {
    // The approval inbox is the entry point; other views stay one tab away.
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(TEACHER_VIEW_STORAGE_KEY) : null;
    if (["approvals", "missions", "students"].includes(saved)) return saved;
    return "approvals";
  });
  const [studentHeaderActions, setStudentHeaderActions] = useState(null);
  const resolvedTeacherView = isTeacher ? activeTeacherView : "students";
  const handleStudentHeaderActionsChange = useCallback((nextActions) => {
    setStudentHeaderActions(nextActions);
  }, []);

  useEffect(() => {
    setActiveRole((prev) => {
      if (isMissionAdminOnly && prev !== "student") return "student";
      if (prev === "teacher" && !canViewTeacher) return "student";
      return prev;
    });
  }, [canViewTeacher, isMissionAdminOnly]);

  const handleChangeRole = (role) => {
    setActiveRole(role);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, role);
    }
  };

  const handleChangeTeacherView = (view) => {
    setActiveTeacherView(view);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TEACHER_VIEW_STORAGE_KEY, view);
    }
  };

  const teacherViewTabs = [
    { id: "approvals", label: "승인 대기" },
    { id: "missions", label: "과제별 보기" },
    { id: "students", label: "학생별 보기" },
  ];

  const roleTabs = useMemo(
    () =>
      [
        canViewStudent
          ? {
              id: "student",
              label: MISSION_TEXT.studentView,
              icon: GraduationCap,
            }
          : null,
        {
          id: "teacher",
          label: MISSION_TEXT.missionView,
          icon: Lightbulb,
        },
      ].filter(Boolean),
    [canViewStudent],
  );

  const missionQuestGuide = useMemo(
    () => ({
      type: "quest",
      title: "과제 도우미",
      launcherTitle: "과제 도우미",
      launcherDescription:
        "학생 보기, 관리자 보기, 과제 패널 흐름을 체크합니다.",
      subtitle:
        "과제를 만들고 학생 수행 현황을 확인하는 기본 흐름을 살펴봅니다.",
      storageKey: classId
        ? `finclass_mission_quest_${classId}`
        : "finclass_mission_quest",
      tourKey: "TEACHER_MISSION_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "teacher-view",
          title: "관리자 과제 화면 확인하기",
          description:
            "과제 생성, 학생별 상태, 과제별 상태를 관리하는 화면을 확인합니다.",
          completed: activeRole === "teacher" && canViewTeacher,
          manualComplete: true,
          objectives: [
            {
              id: "teacher-role-open",
              label: "관리자 보기 열기",
              completed: activeRole === "teacher" && canViewTeacher,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="mission-role-toggle"]',
              title: "관리자 보기",
              content: "관리자 보기에서 과제 운영 화면으로 전환합니다.",
            },
            {
              target: '[data-tour="mission-panel"]',
              title: "과제 패널",
              content: "과제 생성과 제출 현황이 이 패널에 표시됩니다.",
            },
          ],
        },
        {
          id: "mission-panel",
          title: "과제 패널 위치 확인하기",
          description:
            "현재 선택한 보기의 핵심 과제 정보가 표시되는 영역을 확인합니다.",
          completed: true,
          manualComplete: true,
          objectives: [
            {
              id: "panel-ready",
              label: "과제 패널 확인",
              completed: true,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="mission-panel"]',
              title: "과제 패널",
              content: "학생별 또는 과제별 현황이 이 영역에 표시됩니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "student-view",
          title: "학생 과제 화면 확인하기",
          description: "학생에게 보이는 과제 목록과 제출 흐름을 확인합니다.",
          completed: activeRole === "student",
          manualComplete: true,
          objectives: [
            {
              id: "student-role-open",
              label: "학생 보기 열기",
              completed: activeRole === "student",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="mission-role-toggle"]',
              title: "보기 전환",
              content: "학생 보기와 관리자 보기를 전환합니다.",
            },
            {
              target: '[data-tour="mission-content"]',
              title: "학생 과제 목록",
              content: "학생에게 보이는 과제 수행 화면을 확인합니다.",
            },
          ],
        },
      ],
    }),
    [activeRole, canViewTeacher, classId],
  );

  if (userLoading) {
    return <MissionDashboardPageSkeleton showTeacherToggle={canViewTeacher} />;
  }

  if (!userData || !classId) {
    return (
      <AppLayout>
        <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/75 px-6 text-center shadow-sm">
            <p className="text-base font-semibold text-slate-600">
              {MISSION_TEXT.unavailableTitle}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {MISSION_TEXT.unavailableDescription}
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout pageGuide={missionQuestGuide}>
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <PageHeader
          title={activeRole === "teacher" && resolvedTeacherView === "approvals" ? "승인 대기함" : MISSION_TEXT.pageTitle}
          subtitle={activeRole === "teacher" && resolvedTeacherView === "approvals" ? "과제를 오가지 않고, 대기 중인 요청을 확인하세요." : MISSION_TEXT.pageSubtitle}
          useCustomTitle={!(activeRole === "teacher" && resolvedTeacherView === "approvals")}
          icon={activeRole === "teacher" && resolvedTeacherView === "approvals" ? null : Target}
          actions={
            <div className="flex flex-wrap items-center justify-end gap-3">
              {activeRole === "student" ? studentHeaderActions : null}
              {canViewTeacher ? (
                <div
                  data-tour="mission-role-toggle"
                  data-active-role={activeRole}
                >
                  <Tabs
                    tabs={roleTabs}
                    activeTab={activeRole}
                    onTabChange={handleChangeRole}
                    variant="pills"
                    size="sm"
                    ariaLabel="과제 화면 대상"
                    idPrefix="mission-role"
                  />
                </div>
              ) : null}
            </div>
          }
        />

        {activeRole === "teacher" && isTeacher ? (
          <div
            className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200"
            data-tour="teacher-mission-view-tabs"
          >
            <Tabs
              tabs={teacherViewTabs}
              activeTab={activeTeacherView}
              onTabChange={handleChangeTeacherView}
              variant="underline"
              size="md"
              idPrefix="teacher-mission-view"
            />
            <div
              id="teacher-mission-header-actions"
              className="flex flex-wrap items-center justify-end gap-2 pb-2"
            />
          </div>
        ) : null}

        <div
          data-tour="mission-panel"
          className={activeRole === "student" || resolvedTeacherView === "approvals" ? "relative" : "relative rounded-xl bg-white p-6 shadow-sm"}
        >
          <div
            data-tour="mission-content"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[220px]"
          />

          {activeRole === "student" ? (
            <StudentMissionPanel
              classId={classId}
              onHeaderActionsChange={handleStudentHeaderActionsChange}
            />
          ) : null}

          {activeRole === "teacher" && canViewTeacher ? (
            <TeacherMissionPanel
              activeView={resolvedTeacherView}
              onViewChange={handleChangeTeacherView}
            />
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
};

const MissionDashboardWithDialogs = () => (
  <>
    <MissionActionDialog />
    <MissionDashboard />
  </>
);

export default MissionDashboardWithDialogs;
