import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useUser } from "../../contexts/UserContext";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useNotifications } from "../../contexts/NotificationContext";
import { useClassStudents } from "../../hooks/user/useClassStudents";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import dayjs from "dayjs";

import { Badge, Button, Card, Tabs, PageHeader, PageLoader } from "../../components/ui";
import {
  AlertTriangle,
  ArrowRight,
  CircleSlash,
  Eye,
  Landmark,
  ShieldCheck,
} from "lucide-react";

import PoliceRuleTab from "./tabs/PoliceRuleTab";
import ReportListTab from "./tabs/ReportListTab";
import FineHistoryTab from "./tabs/FineHistoryTab";
import PoliceStatsTab from "./tabs/PoliceStatsTab";
import ReflectionReviewTab from "./tabs/ReflectionReviewTab";
import FineFormModal from "./modals/FineFormModal";
import ReflectionModal from "./modals/ReflectionModal";
import ReportModal from "./modals/ReportModal";
import VisibilitySettingsModal from "./tabs/modals/VisibilitySettingsModal";
import { isReflectionFeatureEnabled } from "./utils/reflectionSettings";
import { hasReflectionSummary } from "./utils/reflectionFirestoreUtils";

import AppLayout from "../../components/layout/AppLayout";

// ✅ React Query Hook들
import {
  usePoliceRuleCatalogQuery,
  usePoliceRulesQuery,
  useReportsQuery,
  useFineHistoryQuery,
  useRecentHistoryRealtime,
  usePoliceSettingsQuery,
  invalidatePoliceStatsHistoryCache,
  useReflectionQuery,
  useReflectionSummaryFallback,
} from "./hooks/usePoliceQuery";

// Logic Hook
import { useFineHistory } from "./hooks/useFineHistory";
import {
  getIncomeSettlementPolicy,
  getPoliceTreasuryPolicy,
} from "../../utils/taxPolicy";

const LOCAL_STORAGE_ACTIVE_POLICE_TAB_KEY = "finclassPoliceActiveTab";
const LOCAL_STORAGE_STATS_FILTER_PREFIX = "finclassPoliceStatsDateFilters";

const buildDefaultStatsFilters = () => ({
  dateStart: dayjs().subtract(7, "day").format("YYYY-MM-DD"),
  dateEnd: dayjs().subtract(1, "day").format("YYYY-MM-DD"),
});

const getStatsFilterStorageKey = (classId) =>
  classId ? `${LOCAL_STORAGE_STATS_FILTER_PREFIX}:${classId}` : null;

const normalizeStatsDateFilters = (filters, fallback = buildDefaultStatsFilters()) => {
  const dateStart =
    typeof filters?.dateStart === "string" && filters.dateStart
      ? filters.dateStart
      : fallback.dateStart;
  const dateEnd =
    typeof filters?.dateEnd === "string" && filters.dateEnd
      ? filters.dateEnd
      : fallback.dateEnd;

  if (!dateStart || !dateEnd || dateStart > dateEnd) {
    return fallback;
  }

  return { dateStart, dateEnd };
};

const readStatsDateFilters = (classId, fallback) => {
  const storageKey = getStatsFilterStorageKey(classId);
  if (!storageKey || typeof window === "undefined") {
    return fallback;
  }

  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored ? normalizeStatsDateFilters(JSON.parse(stored), fallback) : fallback;
  } catch (error) {
    console.warn("[PolicePage] failed to read stats date filters", error);
    return fallback;
  }
};

const PolicePage = () => {
  const {
    userData,
    classId,
    classData,
    loading: userContextLoading,
    isTeacher,
    hasPermission,
  } = useUser();
  const isPoliceAdmin = isTeacher || hasPermission("permission_group_police");
  const canManagePoliceRules =
    isTeacher || hasPermission("police_rules_manage");

  const { showFeedback } = useFeedback();
  const { badgeCounts } = useNotifications();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const policeTreasuryPolicy = getPoliceTreasuryPolicy(classData);
  const policeRewardIncomePolicy =
    getIncomeSettlementPolicy(classData, "policeReward") || {};

  // =========================================================================
  // 1) 상태
  // =========================================================================
  const [activeTab, setActiveTab] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isStudentRosterRequested, setIsStudentRosterRequested] = useState(false);

  // 벌금 내역 날짜 필터 (주력: appliedAt)
  const [fineFilters, setFineFilters] = useState({
    studentName: "",
    ruleIds: [],
    dateStart: dayjs().subtract(1, "month").format("YYYY-MM-DD"),
    dateEnd: dayjs().format("YYYY-MM-DD"),
    status: "active",
    sensitiveOnly: false,
  });
  const defaultStatsFilters = useMemo(() => buildDefaultStatsFilters(), []);
  const [statsFilters, setStatsFiltersState] = useState(defaultStatsFilters);
  const setStatsFilters = useCallback(
    (nextFilters) => {
      const normalized = normalizeStatsDateFilters(nextFilters, defaultStatsFilters);
      setStatsFiltersState(normalized);

      const storageKey = getStatsFilterStorageKey(classId);
      if (!storageKey || typeof window === "undefined") {
        return;
      }

      try {
        window.localStorage.setItem(storageKey, JSON.stringify(normalized));
      } catch (error) {
        console.warn("[PolicePage] failed to persist stats date filters", error);
      }
    },
    [classId, defaultStatsFilters],
  );

  useEffect(() => {
    if (!classId) return;
    setStatsFiltersState(readStatsDateFilters(classId, defaultStatsFilters));
    setIsStudentRosterRequested(false);
  }, [classId, defaultStatsFilters]);

  const needsReports = activeTab === "reports";
  const needsHistory = activeTab === "fineHistory";
  const needsPoliceSettings = activeTab === "reports" || activeTab === "fineHistory" || activeTab === "reflections";
  const needsStudentRoster =
    isStudentRosterRequested ||
    showReportModal ||
    activeTab === "reports" ||
    activeTab === "fineHistory" ||
    activeTab === "stats";

  const { data: studentList = [] } = useClassStudents(classId, {
    enabled: !!classId && needsStudentRoster,
    realtime: true,
  });

  // =========================================================================
  // 2) 데이터 로딩 (React Query)
  // =========================================================================
  // ✅ 학생명단은 UserContext 단일 소스
  const allStudents = studentList || [];

  const shouldUseRuleCatalogSummary =
    !isPoliceAdmin && !canManagePoliceRules;
  const {
    data: policeRuleCatalog = [],
    isLoading: isRuleCatalogLoading,
    isReady: isRuleCatalogReady,
    hasSummary: hasPoliceRuleCatalog,
  } = usePoliceRuleCatalogQuery(classId, shouldUseRuleCatalogSummary);
  const shouldLoadFullRules =
    !!classId &&
    (!shouldUseRuleCatalogSummary ||
      (isRuleCatalogReady && !hasPoliceRuleCatalog));
  const {
    data: policeRuleCollection = [],
    isLoading: isRuleCollectionLoading,
  } = usePoliceRulesQuery(classId, shouldLoadFullRules);
  const policeRules =
    shouldUseRuleCatalogSummary && hasPoliceRuleCatalog
      ? policeRuleCatalog
      : policeRuleCollection;
  const isRulesLoading = shouldUseRuleCatalogSummary
    ? (!isRuleCatalogReady
        ? isRuleCatalogLoading
        : hasPoliceRuleCatalog
          ? isRuleCatalogLoading
          : isRuleCollectionLoading)
    : isRuleCollectionLoading;
  const { data: reports = [], isLoading: isReportsLoading } = useReportsQuery(
    classId,
    needsReports,
  );

  // 🔥 벌금 내역 (무한 스크롤 + 서버 필터링)
  const {
    data: fineHistoryPages,
    isLoading: isHistoryLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useFineHistoryQuery(
    classId,
    fineFilters.dateStart,
    fineFilters.dateEnd,
    "all",
    needsHistory,
  );

  const {
    data: policeSettings = {},
    isLoading: isSettingsLoading,
  } = usePoliceSettingsQuery(classId, needsPoliceSettings);
  const reflectionFeatureEnabled = isReflectionFeatureEnabled(policeSettings);
  const reflectionEnabled =
    needsPoliceSettings && reflectionFeatureEnabled;
  const enableRecentHistoryFeed = needsHistory && isPoliceAdmin;
  const { data: latestRealtime = [] } = useRecentHistoryRealtime(
    classId,
    enableRecentHistoryFeed,
  );
  const latestHistoryFeed = latestRealtime;
  const fineHistoryBase = useMemo(() => {
    const past = fineHistoryPages?.pages ? fineHistoryPages.pages.flatMap((p) => p.items) : [];

    // 최신 실시간 + 과거를 합치되, id 기준으로 중복 제거 (최신이 우선)
    const map = new Map();
    (Array.isArray(latestHistoryFeed) ? latestHistoryFeed : []).forEach((r) => map.set(r.id, r));
    past.forEach((r) => {
      if (!map.has(r.id)) {
        map.set(r.id, r);
        return;
      }

      map.set(r.id, { ...map.get(r.id), ...r });
    });

    // appliedAt 기준 정렬(없으면 createdAt fallback)
    const list = Array.from(map.values());
    list.sort((a, b) => {
      const atA = a?.appliedAt?.toMillis ? a.appliedAt.toMillis() : (a?.createdAt?.toMillis ? a.createdAt.toMillis() : 0);
      const atB = b?.appliedAt?.toMillis ? b.appliedAt.toMillis() : (b?.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
      return atB - atA;
    });
    return list;
  }, [fineHistoryPages, latestHistoryFeed]);

  const { data: reflectionFallbackById = {} } = useReflectionSummaryFallback(
    classId,
    fineHistoryBase,
    needsHistory && reflectionEnabled,
  );

  const fineHistory = useMemo(
    () =>
      fineHistoryBase.map((record) => {
        if (hasReflectionSummary(record)) {
          return record;
        }

        const fallback = reflectionFallbackById?.[record.id];
        return fallback ? { ...record, ...fallback } : record;
      }),
    [fineHistoryBase, reflectionFallbackById],
  );

  // ✅ 전역 로딩: 유저컨텍스트 + 필수 데이터(규칙)만
  const isGlobalLoading =
    userContextLoading ||
    !classId ||
    (isRulesLoading && policeRules.length === 0);

  // =========================================================================
  // 3) 캐시 갱신
  // =========================================================================
  const refreshRules = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["policeRules", classId] }),
    [queryClient, classId]
  );

  const refreshReports = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["policeReports", classId] }),
    [queryClient, classId]
  );

  const refreshFineHistory = useCallback(() => {
    invalidatePoliceStatsHistoryCache(classId);
    queryClient.invalidateQueries({ queryKey: ["policeFineHistory", classId], exact: false });
    queryClient.invalidateQueries({ queryKey: ["policeStatsHistory", classId], exact: false });
  }, [queryClient, classId]);

  const refreshSettings = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["policeSettings", classId] }),
    [queryClient, classId]
  );

  // =========================================================================
  // 4) 로직 Hook
  // =========================================================================
  const fineHistoryHook = useFineHistory({
    classId,
    allStudents,
    policeRules,
    fineHistoryData: fineHistory,
    policeSettings,
    reflectionEnabled,
    filters: fineFilters,
    refreshFineHistory,
    refreshReports,
  });

  const selectedFineId = fineHistoryHook.reflectionModal?.fine?.id;
  const { data: reflectionData } = useReflectionQuery(
    classId,
    selectedFineId,
    reflectionEnabled,
  );

  // =========================================================================
  // 5) 핸들러
  // =========================================================================
  const updateVisibilitySettings = async (newSettings) => {
    try {
      const settingsRef = doc(db, `classes/${classId}/policeSettings/config`);
      await updateDoc(settingsRef, newSettings);
      showFeedback("공개 설정이 저장되었습니다.", "success");
      refreshSettings();
    } catch (e) {
      showFeedback("설정 저장 실패", "error");
    }
  };

  const updateRuleVisibility = async (ruleId, settings) => {
    try {
      const ruleRef = doc(db, `classes/${classId}/policeRules`, ruleId);
      await updateDoc(ruleRef, settings);
      showFeedback("규칙 설정이 업데이트되었습니다.", "success");
      refreshRules();
    } catch (error) {
      showFeedback("설정 업데이트 실패", "error");
    }
  };

  const handleReportSubmitSuccess = (message) => {
    showFeedback(message, "success");
    refreshReports();
  };

  const handleOpenAutoTaxPolicy = useCallback(() => {
    navigate("/tax?tab=autoTaxPolicy");
  }, [navigate]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleOpenFineForm = useCallback(
    (rule = null) => {
      setIsStudentRosterRequested(true);
      fineHistoryHook.openFineForm(rule);
    },
    [fineHistoryHook],
  );

  // =========================================================================
  // 6) 탭 구성
  // =========================================================================


  const tabsData = useMemo(() => {
    const policeBadgeCount = Number(badgeCounts?.police || 0);
    const tabs = [{ id: "rulesAndStudents", label: "학급 규칙" }];

    tabs.push({
      id: "reports",
      label: isPoliceAdmin ? "신고 접수 내역" : "신고 내역",
      badge: isPoliceAdmin && policeBadgeCount > 0 ? policeBadgeCount : null,
    });

    tabs.push({
      id: "fineHistory",
      label: isPoliceAdmin ? "부과내역" : "벌금 및 상금",
      badge:
        !isPoliceAdmin && policeBadgeCount > 0 ? policeBadgeCount : null,
    });

    if (isPoliceAdmin) {
      tabs.push({ id: "reflections", label: "소명·반성" });
    }
    if (isTeacher) {
      tabs.push({
        id: "stats",
        label: "통계",
      });
    }
    return tabs;
  }, [isPoliceAdmin, isTeacher, badgeCounts?.police]);

  useEffect(() => {
    if (userContextLoading || !classId) return;
    if (!activeTab) {
      const saved = localStorage.getItem(LOCAL_STORAGE_ACTIVE_POLICE_TAB_KEY);
      const exists = tabsData.find((t) => t.id === saved);
      setActiveTab(exists ? saved : tabsData[0].id);
    }
  }, [userContextLoading, classId, tabsData, activeTab]);

  useEffect(() => {
    if (activeTab) localStorage.setItem(LOCAL_STORAGE_ACTIVE_POLICE_TAB_KEY, activeTab);
  }, [activeTab]);

  // =========================================================================
  // 7) 렌더
  // =========================================================================
  const renderTabContent = () => {
    const commonProps = {
      classId,
      currencyUnit: classData?.currencyUnit || "미르",
      userData,
      isPoliceAdmin,
    };

    switch (activeTab) {
      case "rulesAndStudents":
        return (
          <PoliceRuleTab
            {...commonProps}
            canManageRules={canManagePoliceRules}
            policeRules={policeRules}
            refreshRules={refreshRules}
            onApplyRule={handleOpenFineForm}
          />
        );

      case "reports":
        return (
          <ReportListTab
            {...commonProps}
            allStudents={allStudents}
            policeRules={policeRules}
            policeSettings={policeSettings}
            reports={reports}
            isLoading={isReportsLoading || isSettingsLoading}
            refreshReports={refreshReports}
            onTabChange={setActiveTab}
            onOpenCustomFineReport={fineHistoryHook.openCustomFineFromReport}
          />
        );

      case "fineHistory":
        return (
          <FineHistoryTab
            {...commonProps}
            allStudents={allStudents}
            policeRules={policeRules}
            policeSettings={policeSettings}
            fineHistoryHook={fineHistoryHook}
            reflectionEnabled={reflectionEnabled}
            isLoading={isHistoryLoading || isSettingsLoading}
            fineFilters={fineFilters}
            setFineFilters={setFineFilters}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onLoadMore={handleLoadMore}
          />
        );

      case "reflections":
        return <ReflectionReviewTab key={classId} classId={classId} currencyUnit={classData?.currencyUnit || "원"} enabled={!isSettingsLoading && reflectionEnabled} />;

      case "stats":
        return (
          <PoliceStatsTab
            policeRules={policeRules}
            fineFilters={statsFilters}
            setFineFilters={setStatsFilters}
            allStudents={allStudents}
            canHardDelete={fineHistoryHook.canHardDelete}
            onHardDeleteRecords={fineHistoryHook.handleBulkHardDelete}
            hardDeleteProcessingId={fineHistoryHook.processingId}
          />
        );

      default:
        return null;
    }
  };

  const policeQuestGuide = useMemo(() => {
    const hasRules = policeRules.length > 0;
    const hasReports = reports.length > 0 || Number(badgeCounts?.police || 0) > 0;
    const hasFineHistory = fineHistory.length > 0;

    return {
      type: "quest",
      title: "경찰청 도우미",
      launcherTitle: "경찰청 도우미",
      launcherDescription: "규칙, 신고, 벌금, 통계 흐름을 체크합니다.",
      subtitle: "학급 규칙을 만들고 신고와 벌금 처리 흐름을 확인합니다.",
      storageKey: classId ? `finclass_police_quest_${classId}` : "finclass_police_quest",
      tourKey: "TEACHER_POLICE_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "rule-list",
          title: "학급 규칙 확인하기",
          description: "학생들이 신고하거나 벌금이 부과될 기준 규칙을 확인합니다.",
          doneText: `${policeRules.length}개의 규칙이 있습니다.`,
          completed: hasRules,
          manualComplete: false,
          objectives: [
            {
              id: "rules-ready",
              label: "규칙 1개 이상 준비",
              completed: hasRules,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="police-tabs"]',
              title: "학급 규칙 탭",
              content: "규칙 탭에서 벌금 기준과 학생에게 보이는 규칙을 확인합니다.",
            },
            {
              target: '[data-tour="police-content"]',
              title: "규칙 목록",
              content: "규칙별 벌금, 공개 여부, 적용 버튼을 확인합니다.",
            },
          ],
        },
        {
          id: "report-flow",
          title: "신고 흐름 살펴보기",
          description: "학생 신고와 교사 접수 흐름을 확인합니다.",
          completed: activeTab === "reports" || hasReports,
          manualComplete: true,
          objectives: [
            {
              id: "reports-open",
              label: "신고 이력 탭 열기",
              completed: activeTab === "reports",
            },
            {
              id: "reports-exist",
              label: "신고 또는 알림 확인",
              completed: hasReports,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="police-actions"]',
              title: "신고하기",
              content: "상단 신고하기 버튼에서 신고 흐름을 시작합니다.",
            },
            {
              target: '[data-tour="police-report-action"]',
              title: "신고 모달 열기",
              content: "신고하기 버튼을 누르면 학생, 규칙, 사유를 입력하는 신고 모달이 열립니다.",
              waitForTarget: '[data-tour="police-report-modal"]',
            },
            {
              target: '[data-tour="police-report-modal"]',
              title: "신고 작성",
              content: "신고 대상과 내용을 확인하고 신고 접수 흐름을 살펴봅니다.",
            },
            {
              target: '[data-tour="police-content"]',
              title: "신고 접수 이력",
              content: "신고 탭에서 접수된 신고와 처리 상태를 확인합니다.",
            },
          ],
        },
        {
          id: "fine-flow",
          title: "벌금 부과 흐름 확인하기",
          description: "규칙을 학생에게 적용하고 벌금 이력을 확인합니다.",
          completed: activeTab === "fineHistory" || hasFineHistory,
          manualComplete: true,
          objectives: [
            {
              id: "fine-history-open",
              label: "벌금 이력 탭 열기",
              completed: activeTab === "fineHistory",
            },
            {
              id: "fine-history-exist",
              label: "벌금 이력 확인",
              completed: hasFineHistory,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="police-actions"]',
              title: "직접 부과",
              content: "권한이 있으면 상단에서 직접 벌금을 부과할 수 있습니다.",
            },
            {
              target: '[data-tour="police-fine-action"]',
              title: "직접 부과 열기",
              content: "직접 부과 버튼을 누르면 규칙 또는 직접 입력으로 벌금과 보상을 적용하는 모달이 열립니다.",
              waitForTarget: '[data-tour="police-fine-modal"]',
            },
            {
              target: '[data-tour="police-fine-modal"]',
              title: "벌금 부과 모달",
              content: "대상 학생, 규칙, 금액, 사유를 확인하고 부과 흐름을 살펴봅니다.",
            },
            {
              target: '[data-tour="police-content"]',
              title: "벌금 이력",
              content: "벌금 부과, 반성문, 취소 상태를 이 영역에서 확인합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "visibility-settings",
          title: "공개 설정 확인하기",
          description: "학생에게 어떤 규칙과 이력을 보여줄지 확인합니다.",
          completed: isSettingsModalOpen,
          manualComplete: true,
          objectives: [
            {
              id: "settings-open",
              label: "공개 설정 열기",
              completed: isSettingsModalOpen,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="police-actions"]',
              title: "공개 설정",
              content: "상단 공개 설정에서 학생에게 보이는 정보를 조정합니다.",
            },
            {
              target: '[data-tour="police-visibility-action"]',
              title: "공개 설정 열기",
              content: "공개 설정 버튼을 누르면 규칙과 이력의 학생 공개 범위를 조정하는 모달이 열립니다.",
              waitForTarget: '[data-tour="police-visibility-modal"]',
            },
            {
              target: '[data-tour="police-visibility-modal"]',
              title: "공개 설정 모달",
              content: "학생 화면에 보일 규칙, 이력, 반성문 관련 설정을 확인합니다.",
            },
          ],
        },
        {
          id: "stats",
          title: "통계 탭 보기",
          description: "벌금 기록이 쌓이면 통계로 규칙 운영 흐름을 볼 수 있습니다.",
          completed: activeTab === "stats",
          manualComplete: true,
          objectives: [
            {
              id: "stats-open",
              label: "통계 탭 열기",
              completed: activeTab === "stats",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="police-tabs"]',
              title: "통계",
              content: "통계 탭에서 기간별 벌금과 규칙 적용 흐름을 확인합니다.",
            },
          ],
        },
      ],
    };
  }, [
    activeTab,
    badgeCounts?.police,
    classId,
    fineHistory.length,
    isSettingsModalOpen,
    policeRules.length,
    reports.length,
  ]);

  if (isGlobalLoading && Date.now() < 0) {
    return <PageLoader message="경찰 데이터를 불러오는 중입니다..." />;
  }

  if (isGlobalLoading) {
    return (
      <AppLayout showDefaultHeader={false} showSidebar={true}>
        <PageLoader
          fullHeight={false}
          className="min-h-screen"
          message="경찰 데이터를 불러오는 중입니다..."
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout
      showDefaultHeader={false}
      showSidebar={true}
      pageGuide={policeQuestGuide}
    >
      <div className={`${activeTab === "reflections" ? "min-h-0" : "min-h-screen"} bg-[#f0f5ff]`}>
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
          <PageHeader
            title="경찰청"
            subtitle="학급 규칙과 위반 내역을 확인하고 관리합니다."
            icon={ShieldCheck}
            actions={
              <div
                data-tour="police-actions"
                className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto"
              >
                {canManagePoliceRules && (
                  <Button
                    onClick={() => setIsSettingsModalOpen(true)}
                    kind="outline"
                    tone="slate"
                    size="md"
                    icon={Eye}
                    data-tour="police-visibility-action"
                    data-tutorial-interactive="true"
                    className="justify-center"
                  >
                    공개 설정
                  </Button>
                )}
                <Button
                  onClick={() => {
                    setIsStudentRosterRequested(true);
                    setShowReportModal(true);
                  }}
                  kind="solid"
                  tone="rose"
                  size="md"
                  icon={AlertTriangle}
                  data-tour="police-report-action"
                  data-tutorial-interactive="true"
                  className="justify-center"
                >
                  신고하기
                </Button>
                {hasPermission("permission_group_police") && (
                  <Button
                    onClick={() => handleOpenFineForm()}
                    kind="solid"
                    tone="blue"
                    size="md"
                    icon={CircleSlash}
                    data-tour="police-fine-action"
                    data-tutorial-interactive="true"
                    className="justify-center"
                  >
                    직접 부과
                  </Button>
                )}
              </div>
            }
          />

          {false && isPoliceAdmin && (
            <Card variant="elevated" tone="white" rounded="3xl" className="border-0 shadow-xl shadow-slate-200/40 ring-1 ring-slate-100/70">
              <Card.Content className="space-y-4 p-5 sm:p-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Landmark className="h-4 w-4 text-slate-500" />
                      <h3 className="text-base font-black text-slate-900">경찰 세금 정책 요약</h3>
                    </div>
                    <p className="text-sm text-slate-500">
                      벌금 국고 반영, 상금 국고 지출, 상금 기간 소득세 대상 여부는 국세청에서 통합 관리합니다.
                    </p>
                  </div>
                  <Button
                    type="button"
                    tone="blue"
                    size="sm"
                    icon={ArrowRight}
                    onClick={handleOpenAutoTaxPolicy}
                  >
                    자동 세금 설정
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-black uppercase tracking-widest text-slate-400">
                      벌금 국고 반영
                    </div>
                    <div className="mt-2">
                      <Badge tone={policeTreasuryPolicy?.fineEnabled ? "emerald" : "slate"}>
                        {policeTreasuryPolicy?.fineEnabled ? "사용" : "중지"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      벌금은 즉시 차감되고, 국고 반영 여부만 이 정책을 따릅니다.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-black uppercase tracking-widest text-slate-400">
                      상금 국고 지출
                    </div>
                    <div className="mt-2">
                      <Badge
                        tone={policeTreasuryPolicy?.rewardExpenseEnabled ? "emerald" : "slate"}
                      >
                        {policeTreasuryPolicy?.rewardExpenseEnabled ? "사용" : "중지"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      경찰 상금은 지급 즉시 처리되고, 국고 지출 기록 여부만 여기서 관리합니다.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-black uppercase tracking-widest text-slate-400">
                      상금 기간 소득세
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge tone={policeRewardIncomePolicy?.enabled ? "indigo" : "slate"}>
                        {policeRewardIncomePolicy?.enabled ? "정산 대상" : "비대상"}
                      </Badge>
                      {policeRewardIncomePolicy?.enabled && (
                        <span className="text-sm font-bold text-slate-700">
                          세율 {Number(policeRewardIncomePolicy?.taxRate || 0)}%
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      경찰 상금은 건별 세금 문서를 만들지 않고 기간 정산 후 고지서로 발행됩니다.
                    </p>
                  </div>
                </div>
              </Card.Content>
            </Card>
          )}

          <div data-tour="police-tabs" data-active-tab={activeTab || ""}>
            <Tabs
              tabs={tabsData}
              activeTab={activeTab || ""}
              onTabChange={setActiveTab}
              variant="underline"
              size="md"
            />
          </div>

          <div className="relative mt-4">
            <div
              data-tour="police-content"
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[260px]"
            />
            {renderTabContent()}
          </div>

          {/* 모달 영역 */}
          <ReportModal
            isOpen={showReportModal}
            onClose={() => setShowReportModal(false)}
            allStudents={Array.isArray(allStudents) ? allStudents : []}
            policeRules={Array.isArray(policeRules) ? policeRules : []}
            onSubmitSuccess={handleReportSubmitSuccess}
            data-tour="police-report-modal"
          />

          {fineHistoryHook.showFineForm && (
            <FineFormModal
              isOpen={fineHistoryHook.showFineForm}
              allStudents={allStudents}
              policeRules={policeRules}
              fineForm={fineHistoryHook.fineForm}
              setFineForm={fineHistoryHook.setFineForm}
              defaultTab={fineHistoryHook.fineFormTab}
              onClose={() => fineHistoryHook.closeFineForm()}
              onSubmit={fineHistoryHook.handleApplyDirectFine}
              onApplyCustom={fineHistoryHook.handleApplyCustomFine}
              data-tour="police-fine-modal"
            />
          )}

          {isSettingsModalOpen && (
            <VisibilitySettingsModal
              isOpen={isSettingsModalOpen}
              onClose={() => setIsSettingsModalOpen(false)}
              policeSettings={policeSettings}
              policeRules={policeRules}
              updateVisibilitySettings={updateVisibilitySettings}
              updateRuleVisibility={updateRuleVisibility}
              classData={classData}
              data-tour="police-visibility-modal"
            />
          )}

          {reflectionEnabled ? (
            <ReflectionModal
            isOpen={fineHistoryHook.reflectionModal?.isOpen || false}
            fine={fineHistoryHook.reflectionModal?.fine}
            reflectionData={reflectionData}
            mode={fineHistoryHook.reflectionModal?.mode || "submit"}
            currencyUnit={classData?.currencyUnit || "원"}
            onClose={() => fineHistoryHook.closeReflectionModal()}
            onSubmit={fineHistoryHook.submitReflection}
            onUpdate={fineHistoryHook.updateReflection}
            onApprove={fineHistoryHook.approveReflection}
            onReject={fineHistoryHook.rejectReflection}
            onCancelSubmission={fineHistoryHook.cancelReflectionSubmission}
            />
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
};

export default PolicePage;
