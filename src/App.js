import React, { Suspense, useEffect, useRef } from "react";
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PageErrorBoundary from "./components/ui/PageErrorBoundary";
import { Login, ChangePasswordPage, TeacherSignup, AccountManagement, LandingPage, PrivacyPolicyPage, SupportInfoPage, MasterHub, MasterDashboard, MasterPlanManager, GlobalResetPage, TeacherApprovalPage, NoticeManagementPage, StockAdjustmentPage, StockCategoriesManagerPage, ClientTelemetryPage, StudentDashboard, AssetsPage, Bank, StockPage, TaxDash, LaborDash, JobBoardPage, JobSeekerBoardPage, JobBoardDashboardPage, Store, PolicePage, Credit, AssemblyHome, LawBoard, MissionDashboard, RealEstatePage, NewsPage, Marketplace, GameCenter, MiniQuizManagerPage, MiniQuizStudentPage, CredentialsPage, CaseLibraryPage, CaseLibraryDashboardPage, CaseLibraryDetailPage, CaseLibraryComposerPage, CaseLibraryRequestsPage, CaseLibraryRequestComposerPage, CaseLibraryRequestDetailPage, CaseLibraryPdfBuilderPage, FloatingAiAssistant, AdminFinanceManager, AdminPermissionManager, StudentRegistration, DeleteStudents, DashboardSettings, ClassTimeSettings, AccessDeniedPage, NotFoundPage, StockProvider, BankProvider } from "./routes/lazyPages";

// === Provider Contexts ===
import { UserProvider, useUser } from "./contexts/UserContext";
import { FeedbackProvider } from "./contexts/FeedbackContext";
import { NumberFormatProvider } from "./contexts/NumberFormatContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { ClassUiConfigProvider } from "./contexts/ClassUiConfigContext";
import { ShortcutDataProvider } from "./contexts/ShortcutDataContext";
import { PopupNewsDataProvider } from "./contexts/PopupNewsDataContext";
import { PlanConfigProvider, usePlanConfig } from "./contexts/PlanConfigContext";
import { FundModeProvider } from "./contexts/FundModeContext";

// === Toast ===
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// === Common & Auth Components ===
import LoadingSpinner from "./components/ui/LoadingSpinner";
import AppDialogHost from "./components/ui/AppDialogHost";
import PrivacyConsentModal from "./components/auth/PrivacyConsentModal";
import { RouteGuardLoader } from "./components/auth/ProtectedRouteWrapper";

// === Constants ===
import { PERMISSIONS } from "./constants/permissions";

// === Pages: Auth & Public ===

// === Pages: Master (System Admin) ===

// === Pages: Main Features (Student/User) ===

import { isCaseLibraryEnabled } from "./pages/caseLibrary/caseLibraryAccess";
import { markCaseLibrarySeen } from "./pages/caseLibrary/services/caseLibraryReadStateService";

// === Pages: Admin & Teacher ===

// === Pages: Feedback & Errors ===
import ProtectedRoute from "./pages/error/ProtectedRoute";
import FeatureGate from "./pages/error/FeatureGate";
import { isTeacherOnlyPath } from "./utils/accountSwitch";
// 1. React Query ?????곷섧????쇱젟
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 1000 * 60 * 5 // 5?브쑨而??怨쀬뵠???醫롪퐨???醫?
    }
  }
});
function App() {
  const location = useLocation();
  return <QueryClientProvider client={queryClient}>
      <UserProvider>
        <NumberFormatProvider>
          <FundModeProvider>
            <AppShell />
          </FundModeProvider>
        </NumberFormatProvider>
      </UserProvider>
    </QueryClientProvider>;
}
function AppShell() {
  const {
    userData,
    classId,
    loading: userLoading,
    authTransitioning
  } = useUser();
  const activeClassId = !userLoading && !authTransitioning && classId ? classId : null;
  const dialogLocation = useLocation();
  return <FeedbackProvider>
      <AppDialogHost scopeKey={`${dialogLocation.pathname}|${activeClassId || ""}|${userData?.uid || ""}|${authTransitioning}`} />
      <PlanConfigProvider>
        <ClassUiConfigProvider classId={activeClassId}>
          <ShortcutDataProvider>
            <PopupNewsDataProvider>
              <NotificationProvider>
                <AppRoutes />
                <PageErrorBoundary fallback={null}>
                  <Suspense fallback={null}><FloatingAiAssistant /></Suspense>
                </PageErrorBoundary>
              </NotificationProvider>
            </PopupNewsDataProvider>
          </ShortcutDataProvider>
        </ClassUiConfigProvider>
      </PlanConfigProvider>
      <ToastContainer containerId="global-toaster" position="top-right" autoClose={2500} theme="colored" limit={3} />
    </FeedbackProvider>;
}

/**
 * ??쇱춳?怨몄뵥 ??깆뒭??嚥≪뮇彛??뚮똾猷??곕뱜
 */
const AppRoutes = () => {
  const {
    userData,
    classId,
    loading: userLoading,
    isAccountSwitching,
    pendingAccountSwitchPath,
    completeAccountSwitchRedirect,
    authTransitioning
  } = useUser();
  const {
    loading: configLoading
  } = usePlanConfig();
  const location = useLocation();
  const currentPath = `${location.pathname || ""}${location.search || ""}${location.hash || ""}`;
  const hasEnteredCaseLibraryRef = useRef(false);
  const hasResolvedInitialLoadRef = useRef(false);
  useEffect(() => {
    if (!authTransitioning && !userLoading && !configLoading) {
      hasResolvedInitialLoadRef.current = true;
    }
  }, [authTransitioning, configLoading, userLoading]);
  useEffect(() => {
    if (!pendingAccountSwitchPath) return;
    if (currentPath === pendingAccountSwitchPath) {
      completeAccountSwitchRedirect();
    }
  }, [completeAccountSwitchRedirect, currentPath, pendingAccountSwitchPath]);
  useEffect(() => {
    if (!classId || !userData?.uid) return;
    if (!["admin", "teacher"].includes(String(userData?.role || ""))) return;
    if (!location.pathname.startsWith("/case-library")) {
      hasEnteredCaseLibraryRef.current = false;
      return;
    }
    if (hasEnteredCaseLibraryRef.current) {
      return;
    }
    hasEnteredCaseLibraryRef.current = true;
    void markCaseLibrarySeen({
      classId,
      uid: userData.uid,
      path: location.pathname
    }).catch(error => {
      console.error("[AppRoutes] failed to mark case library as seen:", error);
    });
  }, [classId, location.pathname, userData?.role, userData?.uid]);

  /**
   * 1. ?袁⑸열 嚥≪뮆逾???뽯선
   * UserContext?? PlanConfigContext揶쎛 筌뤴뫀紐?'餓Β???袁⑥┷' ?醫륁깈??癰귣?沅????돱筌왖
   * ??륁맄 Route?????쐭筌띻낱釉?쭪? ??꾪???쎈돗??? ?醫???몃빍??
   */
  if (pendingAccountSwitchPath && currentPath !== pendingAccountSwitchPath) {
    return <Navigate to={pendingAccountSwitchPath} replace />;
  }
  const shouldUseAppBlockingLoader = !hasResolvedInitialLoadRef.current && (userLoading || configLoading);
  if (shouldUseAppBlockingLoader) {
    return <LoadingSpinner open full message="앱을 준비하는 중입니다..." />;
  }
  if (authTransitioning) {
    return <RouteGuardLoader blocking message="계정을 전환하는 중입니다..." />;
  }
  if (userLoading || configLoading) {
    return <RouteGuardLoader message="페이지를 준비하는 중입니다..." />;
  }
  if (isAccountSwitching && userData?.role === "student" && isTeacherOnlyPath(currentPath)) {
    return <Navigate to="/dashboard" replace />;
  }

  // ?온?귐딆쁽 ??? ?癒??
  const isAdmin = userData?.role === "admin";
  const showCaseLibrary = isCaseLibraryEnabled();

  // 揶쏆뮇??類ｋ궖 ??덉벥 筌뤴뫀???紐꾪뀱 鈺곌퀗援?
  const showPrivacyModal = !!userData && userData.role !== "pending" && userData.privacyAgreed === false && location.pathname !== "/privacy";

  /**
   * ???[???? 野껊슣??紐꾩띃??????
   * ???삏 ??쀫립(FeatureGate)???醫? 亦낅슦釉?ProtectedRoute)????뽮컧?怨몄몵嚥??類ㅼ뵥??몃빍??
   */
  const withGate = (pageKey, permissionKey, element, routeOptions = {}) => <FeatureGate pageKey={pageKey}>
      <ProtectedRoute requiredPermission={permissionKey} {...routeOptions}>
        {element}
      </ProtectedRoute>
    </FeatureGate>;
  const withTeacherOnlyGate = (pageKey, element) => withGate(pageKey, null, element, {
    allowedRoles: ["admin", "teacher"]
  });
  return <>
      {/* 揶쏆뮇??類ｋ궖 筌ｌ꼶?곮쳸?밸쵟 ??덉벥 筌뤴뫀??*/}
      <PrivacyConsentModal isOpen={showPrivacyModal} userData={userData} />

      <PageErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<RouteGuardLoader message="페이지를 불러오는 중입니다..." />}>
      <Routes>
        {/* ???[PUBLIC ROUTES] */}
        <Route path="/" element={!userData ? <LandingPage /> : isAdmin ? <Navigate to="/admin/master" replace /> : <Navigate to="/dashboard" replace />} />
        <Route path="/login" element={!userData ? <Login /> : <Navigate to={isAdmin ? "/admin/master" : "/dashboard"} replace />} />
        <Route path="/signup/teacher" element={userData?.status !== "approved" ? <TeacherSignup /> : <Navigate to="/dashboard" replace />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/support-info" element={<SupportInfoPage />} />
        
        

        {/* ??녔닼?[MASTER ADMIN - ??뽯뮞???온?귐딆쁽] */}
        <Route path="/admin" element={<ProtectedRoute allowedRoles={["admin"]}>
              <Outlet />
            </ProtectedRoute>}>
          <Route path="master" element={<MasterHub />} />
          <Route path="dashboard" element={<MasterDashboard />} />
          <Route path="plans" element={<MasterPlanManager />} />
          <Route path="global-reset" element={<GlobalResetPage />} />
          <Route path="teachers" element={<TeacherApprovalPage />} />
          <Route path="notices" element={<NoticeManagementPage />} />
          <Route path="stock-adjustment" element={<StockAdjustmentPage />} />
          <Route path="stock-categories" element={<StockCategoriesManagerPage />} />
          <Route path="client-telemetry" element={<ClientTelemetryPage />} />
          
          
          
          
        </Route>

        {/* ?維??낆쐠?[TEACHER/MANAGE - ??놃닋 ?온?? */}
        <Route path="/manage" element={<ProtectedRoute allowedRoles={["admin", "teacher", "student"]}>
              <Outlet />
            </ProtectedRoute>}>
          <Route path="assets" element={withGate("assetManager", [PERMISSIONS.ASSET_MANAGER_VIEW, PERMISSIONS.ASSET_MANAGER_MANAGE], <StockProvider>
                <AdminFinanceManager />
              </StockProvider>)} />
          <Route path="permissions" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}>
                <AdminPermissionManager />
              </ProtectedRoute>} />
          <Route path="dashboard" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}>
                <DashboardSettings />
              </ProtectedRoute>} />
          <Route path="time-settings" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}>
                <ClassTimeSettings />
              </ProtectedRoute>} />
          <Route path="students/create" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}>
                <StudentRegistration />
              </ProtectedRoute>} />
          <Route path="students/delete" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}>
                <DeleteStudents />
              </ProtectedRoute>} />
        </Route>

        {/* ?猷?[STUDENT MAIN FEATURES - 筌롫뗄??疫꿸퀡?? */}
        <Route path="/dashboard" element={<ProtectedRoute>
              <StudentDashboard />
            </ProtectedRoute>} />
        <Route path="/assets" element={<ProtectedRoute>
              <AssetsPage />
            </ProtectedRoute>} />
        

        {/* ???疫뀀뜆??野껋럩????뺥돩???닌덉퍢 */}
        <Route path="/stock" element={withGate("stock", PERMISSIONS.STOCK, <StockProvider>
              <StockPage />
            </StockProvider>)} />
        <Route path="/bank" element={withGate("bank", PERMISSIONS.BANK, <BankProvider>
              <Bank />
            </BankProvider>)} />
        
        <Route path="/police" element={withGate("police", PERMISSIONS.POLICE, <PolicePage />)} />
        <Route path="/tax" element={withGate("tax", PERMISSIONS.TAX, <TaxDash />)} />
        <Route path="/labor" element={withGate("labor", PERMISSIONS.LABOR, <LaborDash />)} />
        <Route path="/job-board" element={withGate("jobBoard", PERMISSIONS.JOB_BOARD, <JobBoardPage />)} />
        <Route path="/job-board/seeker" element={withGate("jobBoard", PERMISSIONS.JOB_BOARD, <JobSeekerBoardPage />)} />
        <Route path="/job-board/me" element={withGate("jobBoard", PERMISSIONS.JOB_BOARD, <JobBoardDashboardPage />)} />
        <Route path="/store" element={withGate("store", PERMISSIONS.STORE, <Store />)} />
        <Route path="/credit" element={withGate("credit", PERMISSIONS.CREDIT, <Credit />)} />
        <Route path="/missions" element={withGate("mission", PERMISSIONS.MISSION_PAGE, <MissionDashboard />)} />
        <Route path="/realestate/*" element={withGate("realestate", PERMISSIONS.REALESTATE, <RealEstatePage />)} />
        <Route path="/arcade" element={withGate("arcade", PERMISSIONS.ARCADE, <GameCenter />)} />
        <Route path="/arcade/quizzes/*" element={withGate("arcade", PERMISSIONS.ARCADE, <MiniQuizManagerPage />)} />
        <Route path="/arcade/play-quizzes" element={withGate("arcade", PERMISSIONS.ARCADE, <MiniQuizStudentPage />)} />
        <Route path="/assembly" element={withGate("assembly", PERMISSIONS.ASSEMBLY_PAGE, <AssemblyHome />)} />
        <Route path="/assembly/laws" element={withGate("assembly", PERMISSIONS.ASSEMBLY_PAGE, <LawBoard />)} />
        <Route path="/news" element={withGate("news", PERMISSIONS.NEWS_PAGE, <NewsPage />)} />
        <Route path="/marketplace" element={withGate("marketplace", PERMISSIONS.MARKETPLACE_PAGE, <Marketplace />)} />
        <Route path="/credentials" element={withGate("credentials", [PERMISSIONS.CREDENTIALS, PERMISSIONS.CREDENTIALS_ADMIN], <CredentialsPage />)} />
          {showCaseLibrary ? <>
            <Route path="/case-library" element={withTeacherOnlyGate("caseLibrary", <CaseLibraryPage />)} />
            <Route path="/case-library/new" element={withTeacherOnlyGate("caseLibrary", <CaseLibraryComposerPage />)} />
            <Route path="/case-library/requests" element={withTeacherOnlyGate("caseLibrary", <CaseLibraryRequestsPage />)} />
            <Route path="/case-library/requests/new" element={withTeacherOnlyGate("caseLibrary", <CaseLibraryRequestComposerPage />)} />
            <Route path="/case-library/requests/:requestId" element={withTeacherOnlyGate("caseLibrary", <CaseLibraryRequestDetailPage />)} />
            <Route path="/case-library/requests/:requestId/edit" element={withTeacherOnlyGate("caseLibrary", <CaseLibraryRequestComposerPage />)} />
            <Route path="/case-library/:caseId/edit" element={withTeacherOnlyGate("caseLibrary", <CaseLibraryComposerPage />)} />
            <Route path="/case-library/dashboard" element={withTeacherOnlyGate("caseLibrary", <CaseLibraryDashboardPage />)} />
            <Route path="/case-library/pdf-builder" element={withTeacherOnlyGate("caseLibrary", <CaseLibraryPdfBuilderPage />)} />
            <Route path="/case-library/:caseId" element={withTeacherOnlyGate("caseLibrary", <CaseLibraryDetailPage />)} />
          </> : null}

        {/* ?逾?[AUTH/ERROR] */}
        <Route path="/changepassword" element={<ProtectedRoute>
              <ChangePasswordPage />
            </ProtectedRoute>} />
        <Route path="/account" element={<ProtectedRoute>
              <AccountManagement />
            </ProtectedRoute>} />
        <Route path="/access-denied" element={<AccessDeniedPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
      </PageErrorBoundary>
    </>;
};
export default App;
