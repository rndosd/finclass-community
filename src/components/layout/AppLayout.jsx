import { appConfirm } from "../../utils/appDialogs";
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";
import {
  ClassUiConfigProvider,
  useClassUiConfig,
} from "../../contexts/ClassUiConfigContext";
import { useUser } from "../../contexts/UserContext";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useFundMode } from "../../contexts/FundModeContext";
import { useStudentRoster } from "../../hooks/user/useStudentRoster";
import { sanitizeSwitchedStudentPath } from "../../utils/accountSwitch";
import { getSidebarMenuLabelByPath } from "./sidebarMenuUtils";

// 컴포넌트 및 가이드 로직
import Sidebar from "./Sidebar";
import MobileDrawerSidebar from "./MobileDrawerSidebar";
import GlobalShortcutsDock from "./GlobalShortcutsDock";
import FundModeRibbon from "./FundModeRibbon";
import NewsPopupGate from "./NewsPopupGate";
import ClassSettingsModal from "../../pages/admin/modals/ClassSettingsModal";
import PasswordResetModal from "../../pages/admin/modals/PasswordResetModal";
import NotificationDropdown from "../../notifications/NotificationDropdown";
import {
  PageQuestPanel,
  TutorialContainer,
  getTutorialConfig,
  resolveQuestGuideProgress,
} from "../../tutorial";
import IconButton from "../ui/IconButton";

// 아이콘
import { List as Bars3Icon } from "@phosphor-icons/react";
import {
  SignOut as LogOut,
  Key as KeyRound,
  UserCircle,
  CaretDown as ChevronDownIcon,
  ShieldCheck,
  SidebarSimple as PanelLeftClose,
  SidebarSimple as PanelLeftOpen,
  Question as HelpCircle
} from "@phosphor-icons/react";

const TEACHER_RETURN_PATH_KEY = "finclass_teacher_return_path";
const STUDENT_LAST_PATHS_KEY = "finclass_student_last_paths";

function normalizeDisplayText(value, fallback = "") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;

  try {
    return text.normalize("NFC");
  } catch (_error) {
    return text;
  }
}

function getSwitchAccountBadgeLabel(account) {
  const studentNumber = account?.studentNumber;
  if (studentNumber !== undefined && studentNumber !== null && studentNumber !== "") {
    return studentNumber;
  }

  const role = String(account?.role || "").toLowerCase();
  if (role === "teacher") return "교사";
  if (role === "admin") return "관리자";
  return "학생";
}

function LayoutHeaderTitle({ title, path }) {
  const { sidebarSettings } = useClassUiConfig();
  const resolvedHeaderTitle =
    getSidebarMenuLabelByPath(path, sidebarSettings) || title;

  return <h1 className="text-xl font-bold text-slate-800">{resolvedHeaderTitle}</h1>;
}

export default function AppLayout({
  children,
  title,
  showSidebar = true,
  customSidebar = null,
  alertSlot = null,
  showDefaultHeader = true,
  headerActions = null,
  showDisclaimer = true,
  globalConfig = null,
  pageGuide = null,
  onPageGuideAction = null,
  classUiConfigProvider = "firebase",
  classUiConfigSidebarSettings = null,
}) {
  // --- 상태 관리 ---
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isPasswordResetOpen, setIsPasswordResetOpen] = useState(false);
  const [isSwitchPanelOpen, setIsSwitchPanelOpen] = useState(false);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem("sidebarCollapsed");
    return saved ? JSON.parse(saved) : false;
  });

  // 🌟 가이드 실행 제어 상태
  const [remountCount, setRemountCount] = useState(0);
  const [selectedTutorial, setSelectedTutorial] = useState(null);
  const [isPageGuideOpen, setIsPageGuideOpen] = useState(false);
  const [, setPageGuideProgressVersion] = useState(0);

  const navigate = useNavigate();
  const location = useLocation();
  const {
    userData,
    classId,
    classData,
    isAdmin,
    canSwitchAccount,
    isAccountSwitching,
    switchedStudentUid,
    switchToStudent,
    clearAccountSwitch,
    accountOwnerData,
    authTransitioning,
  } = useUser();
  const { showFeedback } = useFeedback();
  const { isFundMode } = useFundMode();
  const dropdownRef = useRef(null);
  const { data: switchPanelStudents = [], isFetching: isSwitchStudentsFetching } =
    useStudentRoster(classId, {
      version: classData?.studentRosterVersion,
      enabled: !!classId && canSwitchAccount && isUserMenuOpen && isSwitchPanelOpen,
      ready: classData?.classId === classId,
    });

  const switchableStudents = useMemo(() => {
    if (!Array.isArray(switchPanelStudents)) return [];
    return [...switchPanelStudents].sort((a, b) => {
      const aNumber = Number(a?.studentNumber ?? Number.MAX_SAFE_INTEGER);
      const bNumber = Number(b?.studentNumber ?? Number.MAX_SAFE_INTEGER);
      return aNumber - bNumber;
    });
  }, [switchPanelStudents]);
  const canManageAccountSwitch = canSwitchAccount || isAccountSwitching;
  const contentTransitionKey =
    `${location.pathname || ""}${location.search || ""}${location.hash || ""}`;

  const getCurrentPath = () =>
    `${location.pathname || ""}${location.search || ""}${location.hash || ""}`;

  const readStudentLastPaths = () => {
    try {
      return JSON.parse(sessionStorage.getItem(STUDENT_LAST_PATHS_KEY) || "{}");
    } catch (_error) {
      return {};
    }
  };

  const getStudentLastPath = (studentUid) => {
    if (!studentUid) return null;
    const map = readStudentLastPaths();
    if (typeof map[studentUid] !== "string") return null;
    return sanitizeSwitchedStudentPath(map[studentUid]);
  };

  const setStudentLastPath = (studentUid, path) => {
    if (!studentUid || !path) return;
    const map = readStudentLastPaths();
    map[studentUid] = sanitizeSwitchedStudentPath(path);
    sessionStorage.setItem(STUDENT_LAST_PATHS_KEY, JSON.stringify(map));
  };

  // --- 튜토리얼 설정 매칭 ---
  const activeTutorial = getTutorialConfig(
    location.pathname,
    userData?.isAdmin,
    userData?.role === "teacher" || userData?.role === "admin",
    userData?.role,
  );
  const canUsePageHelper =
    userData?.isAdmin ||
    userData?.role === "teacher" ||
    userData?.role === "admin";
  const activePageGuide =
    canUsePageHelper && pageGuide?.type === "quest" ? pageGuide : null;
  const activeFallbackTutorial =
    canUsePageHelper && !activePageGuide ? activeTutorial : null;
  const pageGuideProgress = resolveQuestGuideProgress(activePageGuide);
  const hasPendingMainPageQuests = pageGuideProgress.pendingMainCount > 0;
  const shouldShowGuideButton = Boolean(activePageGuide || activeFallbackTutorial);

  // 🌟 [핵심 수정] 페이지 이동 시 가이드 상태 초기화
  // 페이지가 바뀌면 카운트를 0으로 리셋하여 새 페이지에서 가이드가 꼬이지 않게 합니다.
  useEffect(() => {
    setRemountCount(0);
    setSelectedTutorial(null);
    setIsPageGuideOpen(false);
    setIsUserMenuOpen(false); // 페이지 이동 시 메뉴 닫기
    setIsSwitchPanelOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsUserMenuOpen(false);
        setIsSwitchPanelOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // 🌟 [핵심 수정] 가이드 시작 핸들러
  const handleStartTutorial = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (activePageGuide) {
      setIsPageGuideOpen(true);
      return;
    }

    if (!activeFallbackTutorial) return;

    // 함수형 업데이트(prev + 1)를 사용하여 1 -> 2 -> 3... 확실히 숫자를 올립니다.
    // 숫자가 바뀌어야 TutorialContainer의 'key'가 바뀌면서 재실행됩니다.
    setSelectedTutorial(activeFallbackTutorial);
    setRemountCount((prev) => prev + 1);
  };

  const handleRunPageGuideLocation = useCallback(
    (quest) => {
      if (!quest?.locationSteps?.length) return;

      setIsPageGuideOpen(false);
      setSelectedTutorial({
        steps: quest.locationSteps,
        tourKey: `${activePageGuide?.tourKey || "PAGE_QUEST"}_${quest.id}`,
      });
      setRemountCount((prev) => prev + 1);
    },
    [activePageGuide?.tourKey],
  );

  const handleOpenPageGuideLink = useCallback(
    (path) => {
      if (!path) return;
      setIsPageGuideOpen(false);
      navigate(path);
    },
    [navigate],
  );

  const handleRunPageGuideOperation = useCallback(
    (operation) => {
      setIsPageGuideOpen(false);
      onPageGuideAction?.(operation);
    },
    [onPageGuideAction],
  );

  const handlePageGuideProgressChange = useCallback(() => {
    setPageGuideProgressVersion((value) => value + 1);
  }, []);

  // --- 사이드바 및 레이아웃 로직 ---
  useEffect(() => {
    localStorage.setItem(
      "sidebarCollapsed",
      JSON.stringify(isSidebarCollapsed),
    );
  }, [isSidebarCollapsed]);

  const handleLogout = async () => {
    if ((await appConfirm("정말 로그아웃 하시겠습니까?"))) {
      try {
        sessionStorage.removeItem(TEACHER_RETURN_PATH_KEY);
        await signOut(auth);
        showFeedback("성공적으로 로그아웃되었습니다.", "success");
        setTimeout(() => navigate("/login"), 50);
      } catch (error) {
        showFeedback("로그아웃 오류가 발생했습니다.", "error");
      }
    }
  };

  const handleSwitchStudent = async (student) => {
    if (!student?.uid || isSwitchingAccount) return;
    const currentPath = getCurrentPath();
    const targetPath = getStudentLastPath(student.uid) || "/dashboard";
    const studentName = normalizeDisplayText(student?.name, "학생");

    if (!isAccountSwitching) {
      sessionStorage.setItem(TEACHER_RETURN_PATH_KEY, currentPath);
    } else if (switchedStudentUid) {
      setStudentLastPath(switchedStudentUid, currentPath);
    }

    setIsSwitchingAccount(true);
    try {
      const switched = await switchToStudent(student.uid, targetPath);
      if (!switched) {
        showFeedback("계정 전환에 실패했습니다.", "error");
        return;
      }

      setIsUserMenuOpen(false);
      setIsSwitchPanelOpen(false);
      showFeedback(`${studentName} 계정으로 전환했습니다.`, "info");
    } finally {
      setIsSwitchingAccount(false);
    }
  };

  const handleReturnToTeacher = async () => {
    if (isSwitchingAccount) return;
    if (isAccountSwitching && switchedStudentUid) {
      setStudentLastPath(switchedStudentUid, getCurrentPath());
    }
    const teacherReturnPath =
      sessionStorage.getItem(TEACHER_RETURN_PATH_KEY) || "/dashboard";

    setIsSwitchingAccount(true);
    try {
      const restored = await clearAccountSwitch(teacherReturnPath);
      if (!restored) {
        showFeedback("교사 계정 복귀에 실패했습니다.", "error");
        return;
      }

      sessionStorage.removeItem(TEACHER_RETURN_PATH_KEY);
      setIsUserMenuOpen(false);
      setIsSwitchPanelOpen(false);
      showFeedback("교사 계정으로 돌아왔습니다.", "info");
    } finally {
      setIsSwitchingAccount(false);
    }
  };

  const handleNavItemClick = useCallback((item) => {
    if (item.onClick === "openClassSettingsModal")
      setIsSettingsModalOpen(true);
    else if (item.onClick === "openPasswordResetModal")
      setIsPasswordResetOpen(true);
    setIsMobileSidebarOpen(false);
  }, []);

  const sidebarToRender = customSidebar ? (
    React.cloneElement(customSidebar, {
      collapsed: isSidebarCollapsed,
      globalConfig,
    })
  ) : (
    <Sidebar
      onNavItemClick={handleNavItemClick}
      collapsed={isSidebarCollapsed}
      globalConfig={globalConfig}
    />
  );

  return (
    <ClassUiConfigProvider
      classId={authTransitioning ? null : classId}
      provider={classUiConfigProvider}
      sidebarSettings={classUiConfigSidebarSettings}
    >
      <div className="font-sans flex h-screen min-h-0 w-full overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_transparent_30%),linear-gradient(180deg,#f8fbff_0%,#eef4ff_42%,#f8fafc_100%)]">
      <NewsPopupGate />
      {/* 🌟 튜토리얼 엔진: key에 count를 포함시켜 누를 때마다 강제 리마운트 */}
      {selectedTutorial && remountCount > 0 && (
        <TutorialContainer
          key={`${selectedTutorial.tourKey}-${remountCount}`}
          steps={selectedTutorial.steps}
          tourKey={selectedTutorial.tourKey}
          forceRun={true}
        />
      )}

      {/* 사이드바 영역 */}
      {activePageGuide && (
        <PageQuestPanel
          guide={activePageGuide}
          isOpen={isPageGuideOpen}
          onClose={() => setIsPageGuideOpen(false)}
          onRunLocation={handleRunPageGuideLocation}
          onRunOperation={handleRunPageGuideOperation}
          onOpenGuide={handleOpenPageGuideLink}
          onProgressChange={handlePageGuideProgressChange}
        />
      )}
      {showSidebar && <div className="hidden lg:block">{sidebarToRender}</div>}
      <MobileDrawerSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
        onNavItemClick={handleNavItemClick}
        globalConfig={globalConfig}
      />

        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-all duration-200"
          style={{ "--sidebar-width": isSidebarCollapsed ? "4rem" : "16rem" }}
        >
        {/* 헤더 영역 */}
        <header className="sticky top-0 z-[70] flex h-16 min-w-0 items-center justify-between border-b border-white/60 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            {showSidebar && (
              <IconButton
                label="메뉴 열기"
                size="lg"
                className="lg:hidden text-slate-500"
                onClick={() => setIsMobileSidebarOpen(true)}
              >
                <Bars3Icon className="h-6 w-6" />
              </IconButton>
            )}
            {showSidebar && (
              <IconButton
                label={isSidebarCollapsed ? "메뉴 펼치기" : "메뉴 접기"}
                className="hidden lg:inline-flex text-slate-500"
                onClick={() => setIsSidebarCollapsed((v) => !v)}
              >
                {isSidebarCollapsed ? (
                  <PanelLeftOpen className="h-5 w-5" />
                ) : (
                  <PanelLeftClose className="h-5 w-5" />
                )}
              </IconButton>
            )}
            {showDefaultHeader && (
              <LayoutHeaderTitle title={title} path={location.pathname} />
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            <GlobalShortcutsDock
              desktopSidebarWidth={
                showSidebar ? (isSidebarCollapsed ? 64 : 256) : 0
              }
            />
            <div
              id="fund-mode-ribbon-collapsed-slot"
              className="relative z-[70] flex shrink-0 items-center"
            />

            {/* 🌟 도움말 버튼: activeTutorial이 존재할 때만 렌더링 */}
            {shouldShowGuideButton && (
              <div className="relative">
              <IconButton
                label="페이지 가이드 보기"
                onClick={handleStartTutorial}
                active={isPageGuideOpen}
                className={`p-2 rounded-full transition-all group ${remountCount === 0
                  ? "text-indigo-600 bg-indigo-50 animate-bounce"
                  : "text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                  }`}
                title="페이지 가이드 보기"
              >
                <HelpCircle className="h-5 w-5 group-hover:scale-110 transition-transform" />
              </IconButton>
              {hasPendingMainPageQuests ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white"
                />
              ) : null}
              </div>
            )}

            {userData?.classId && <NotificationDropdown />}

            {/* 유저 메뉴 */}
            <div className="relative ml-3 shrink-0" ref={dropdownRef}>
              <button
                type="button"
                className="flex max-w-[min(42vw,240px)] items-center rounded-full text-sm"
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              >
                <UserCircle className="h-8 w-8 shrink-0 text-slate-500" />
                <span className="ml-2 hidden max-w-[120px] truncate font-medium text-slate-700 sm:block lg:max-w-[160px] xl:max-w-[220px]">
                  {isAccountSwitching
                    ? `${normalizeDisplayText(userData?.name, "학생")} (학생)`
                    : normalizeDisplayText(userData?.name, "사용자")}
                </span>
                <ChevronDownIcon
                  className={`ml-1 hidden h-4 w-4 shrink-0 transition-transform sm:block ${isUserMenuOpen ? "rotate-180" : ""}`}
                />
              </button>

              {isUserMenuOpen && (
                <div
                  className={`absolute right-0 mt-2 rounded-md bg-white py-1 shadow-xl ring-1 ring-black ring-opacity-5 border z-[9999] ${canManageAccountSwitch ? "w-96 max-w-[calc(100vw-1rem)]" : "w-56"}`}
                >
                  {canManageAccountSwitch && (
                    <>
                      <div className="px-2 pt-1 pb-2">
                        {canSwitchAccount && (
                          <button
                            type="button"
                            onClick={() => setIsSwitchPanelOpen((prev) => !prev)}
                            disabled={isSwitchingAccount}
                            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          >
                            <span className="font-medium">계정 전환</span>
                            <span className="text-xs text-slate-500">
                              {isAccountSwitching
                                ? `${normalizeDisplayText(userData?.name, "학생")} 사용 중`
                                : "학생 선택"}
                            </span>
                          </button>
                        )}

                        {isAccountSwitching && (
                          <button
                            type="button"
                            onClick={handleReturnToTeacher}
                            disabled={isSwitchingAccount}
                            className="mt-2 flex w-full items-center justify-start rounded-md border border-slate-300 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          >
                            {normalizeDisplayText(accountOwnerData?.name)
                              ? `${normalizeDisplayText(accountOwnerData?.name)} 계정으로 돌아가기`
                              : "교사 계정으로 돌아가기"}
                          </button>
                        )}

                        {canSwitchAccount && isSwitchPanelOpen && (
                          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                            <p className="px-1 pb-2 text-xs text-slate-500">
                              학생 이름을 선택하면 바로 전환됩니다.
                            </p>
                            {isSwitchStudentsFetching && switchableStudents.length === 0 ? (
                              <p className="px-1 py-3 text-xs text-slate-500">
                                학생 목록을 불러오는 중입니다.
                              </p>
                            ) : switchableStudents.length === 0 ? (
                              <p className="px-1 py-3 text-xs text-slate-500">
                                전환 가능한 학생이 없습니다.
                              </p>
                            ) : (
                              <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto pr-1 sm:grid-cols-3">
                                {switchableStudents.map((student) => {
                                  const isActive = switchedStudentUid === student.uid;
                                  const badgeLabel = getSwitchAccountBadgeLabel(student);
                                  return (
                                    <button
                                      type="button"
                                      key={student.uid}
                                      onClick={() => handleSwitchStudent(student)}
                                      disabled={isSwitchingAccount}
                                      className={`relative flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition disabled:opacity-60 ${isActive
                                        ? "border-indigo-400 bg-white text-indigo-700 shadow-sm"
                                        : "border-transparent bg-slate-200/40 text-slate-600 hover:bg-slate-200"
                                        }`}
                                    >
                                      <span className={`flex h-6 w-8 shrink-0 items-center justify-center rounded-md text-[9px] font-black ${isActive ? "bg-indigo-50 text-indigo-500" : "bg-white/70 text-slate-400"}`}>
                                        {badgeLabel}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate text-[11px] font-bold leading-tight">
                                        {normalizeDisplayText(student?.name, "이름 없음")}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="my-1 border-t border-slate-100" />
                    </>
                  )}

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        navigate("/admin/master");
                      }}
                      className="flex w-full items-center justify-start px-4 py-2 text-left text-sm font-semibold text-indigo-600 hover:bg-slate-100"
                    >
                      <ShieldCheck className="h-4 w-4 mr-2" /> 운영 관리
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      navigate("/account");
                    }}
                    className="flex w-full items-center justify-start px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                  >
                    <KeyRound className="h-4 w-4 mr-2" /> 계정 관리
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center justify-start px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4 mr-2" /> 로그아웃
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <FundModeRibbon />

        {/* 메인 콘텐츠 */}
        <main className={`min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden ${isFundMode ? "border-l-4 border-emerald-400 bg-emerald-50/30" : ""}`}>
          <div
            key={contentTransitionKey}
            className="min-h-full min-w-0 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
          >
            {alertSlot}
            {children}
          </div>
        </main>

        {showDisclaimer && (
          <footer className="px-4 py-2 text-center text-[10px] text-gray-400 shrink-0">
            ※ 이 서비스는{" "}
            <span className="font-medium">
              교육 목적의 가상 경제 활동 플랫폼
            </span>
            이며, 실제 금융 서비스와 무관합니다.
          </footer>
        )}

        {/* 모달 레이어 */}
        {isSettingsModalOpen && (
          <ClassSettingsModal
            isOpen={isSettingsModalOpen}
            onClose={() => setIsSettingsModalOpen(false)}
          />
        )}
        <PasswordResetModal
          isOpen={isPasswordResetOpen}
          onClose={() => setIsPasswordResetOpen(false)}
        />
        </div>
      </div>
    </ClassUiConfigProvider>
  );
}
