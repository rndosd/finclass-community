import { appAlert } from "../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { motion } from "framer-motion";
import {
  BarChart3,
  Coins,
  ListChecks,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";

import AppLayout from "../../components/layout/AppLayout";
import {
  BulkActionFloatingBar,
  Button,
  Card,
  PageHeader,
  PageSkeleton,
  SurfaceLoader,
  TableSkeleton,
  Tabs,
} from "../../components/ui";
import {
  ACTIVITY_CATEGORY_GROUPS,
  ACTIVITY_EXPORT_COLUMNS,
  ASSET_EXPORT_COLUMNS,
  CREDIT_RECORD_TYPE_OPTIONS,
} from "../../constants/financeExportConfig";
import { PERMISSIONS } from "../../constants/permissions";
import { useUser } from "../../contexts/UserContext";
import { db, functions } from "../../firebase";
import useDragSelection from "../../hooks/useDragSelection";
import { useStockSettings } from "../../hooks/stock/useStockSettings";
import { useClassStudents } from "../../hooks/user/useClassStudents";
import {
  buildActivityLogQuery,
  convertFirestoreDocToActivity,
} from "../../utils/activityUtils";
import { resolveClassCurrencyUnit } from "../../utils/currencyUnit";
import {
  exportActivityLogToExcel,
  exportAssetSnapshotToExcel,
  exportCreditDataToExcel,
} from "../../utils/exportUtils";
import ActivityLogModal from "../dashboard/modals/ActivityLogModal";
import CreditLogModal from "../credit/modals/CreditLogModal";
import BankManagementModal from "./modals/BankManagementModal";
import ClassRelativeEconomyTab from "./components/ClassRelativeEconomyTab";
import MonetaryIndicators from "./components/MonetaryIndicators";
import StudentAssetTable, {
  DEFAULT_VISIBLE_COLUMNS,
} from "./components/StudentAssetTable";
import ClassActivityLogTab from "./components/ClassActivityLogTab";
import UnifiedAdjustmentModal from "./modals/UnifiedAdjustmentModal";
import FinanceDataExportModal from "./modals/FinanceDataExportModal";
import MyItemsModal from "../store/modals/MyItemsModal";
import { calculateActiveInventoryValue } from "../store/utils/itemExpiration";
import PortfolioModal from "../stock/modals/PortfolioModal";
import TradeAnalysisModal from "../stock/modals/TradeAnalysisModal";
import MissionTokenHistoryModal from "../missions/StudentDashboard/modals/MissionTokenHistoryModal";

const ACTIVITY_CATEGORY_KEYS = Object.keys(ACTIVITY_CATEGORY_GROUPS);
const exportAdminCreditData = httpsCallable(functions, "exportAdminCreditData");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

const isLocalRuntime = () => {
  if (typeof window === "undefined") return false;
  return LOCAL_HOSTS.has(String(window.location.hostname || "").trim().toLowerCase());
};

const matchesSelectedActivityCategory = (category, selectedCategories) => {
  if (!Array.isArray(selectedCategories) || selectedCategories.length === 0) {
    return false;
  }

  if (selectedCategories.length === ACTIVITY_CATEGORY_KEYS.length) {
    return true;
  }

  return selectedCategories.some((key) => {
    const groupedCategories = ACTIVITY_CATEGORY_GROUPS[key];
    if (Array.isArray(groupedCategories)) {
      return groupedCategories.includes(category);
    }

    return key === category;
  });
};

const toNumber = (value) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

const AdminFinanceManager = () => {
  const { isAdmin, isTeacher, classId, classData, hasPermission, missionTokenLabel } =
    useUser();
  const { conversionRate } = useStockSettings(classId);
  const canManageAllAssets = isAdmin || isTeacher;
  const hasAssetViewPermission = hasPermission(PERMISSIONS.ASSET_MANAGER_VIEW);
  const hasAssetManagePermission = hasPermission(
    PERMISSIONS.ASSET_MANAGER_MANAGE,
  );
  const canManageAssets = canManageAllAssets || hasAssetManagePermission;
  const canViewStatistics =
    canManageAllAssets || hasAssetViewPermission || hasAssetManagePermission;
  const canViewRelativeEconomy = canViewStatistics && isLocalRuntime();
  const canViewClassActivity = canManageAllAssets;
  const readOnly = !canManageAssets;
  const canExportFinanceData = canManageAllAssets;
  const allowedAdjustmentTypes = useMemo(() => {
    if (canManageAllAssets) {
      return ["asset", "credit", "missionToken", "usdBalance"];
    }

    if (hasAssetManagePermission) {
      return ["asset"];
    }

    return [];
  }, [canManageAllAssets, hasAssetManagePermission]);
  const currencyUnit = resolveClassCurrencyUnit(classData);
  const classDisplayName = classData?.className || classData?.name || "";
  const { data: rosterStudents = [], isLoading: isStudentsLoading } =
    useClassStudents(classId, {
      enabled: !!classId,
    });
  const [selectedUids, setSelectedUids] = useState([]);
  const [activeTab, setActiveTab] = useState("assets");

  const [adjustmentModal, setAdjustmentModal] = useState({
    isOpen: false,
    mode: null,
    adjustType: "asset",
    targets: [],
  });

  const [creditLogTarget, setCreditLogTarget] = useState(null);
  const [activityTarget, setActivityTarget] = useState(null);
  const [missionTokenHistoryTarget, setMissionTokenHistoryTarget] =
    useState(null);
  const [bankTarget, setBankTarget] = useState({
    student: null,
    tab: "savings",
  });
  const [portfolioTarget, setPortfolioTarget] = useState(null);
  const [tradeAnalysisTarget, setTradeAnalysisTarget] = useState(null);
  const [inventoryTarget, setInventoryTarget] = useState(null);
  const [assetVisibleColumns, setAssetVisibleColumns] = useState({
    ...DEFAULT_VISIBLE_COLUMNS,
  });
  const [exportModalType, setExportModalType] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [hasLoadedStudents, setHasLoadedStudents] = useState(false);
  const [activeInventoryValues, setActiveInventoryValues] = useState({});
  const students = useMemo(
    () =>
      rosterStudents.map((student) => ({
        ...student,
        assets: (() => {
          const assets = student.assets || {};
          const activeItemValue = activeInventoryValues[student.uid];
          if (!Number.isFinite(activeItemValue)) {
            return assets;
          }

          const storedItemValue = toNumber(assets.itemValue);
          const storedTotalNetWorth = toNumber(assets.totalNetWorth);

          return {
            ...assets,
            itemValue: activeItemValue,
            totalNetWorth: Math.max(
              0,
              storedTotalNetWorth - storedItemValue + activeItemValue,
            ),
          };
        })(),
        name: student.name || "이름 없음",
      })),
    [activeInventoryValues, rosterStudents],
  );
  const isInitialLoading = !!classId && isStudentsLoading && !hasLoadedStudents;
  const isRefreshing = !!classId && isStudentsLoading && hasLoadedStudents;

  useEffect(() => {
    const uidSet = new Set(students.map((student) => student.uid));
    setSelectedUids((prev) => prev.filter((uid) => uidSet.has(uid)));
  }, [students]);

  useEffect(() => {
    setHasLoadedStudents(false);
  }, [classId]);

  useEffect(() => {
    if (!isStudentsLoading) {
      setHasLoadedStudents(true);
    }
  }, [isStudentsLoading]);

  useEffect(() => {
    if (!classId || rosterStudents.length === 0) {
      setActiveInventoryValues({});
      return undefined;
    }

    let isCancelled = false;

    const loadInventoryValues = async () => {
      const nowMs = Date.now();

      try {
        const entries = await Promise.all(
          rosterStudents.map(async (student) => {
            if (!student.uid) return null;

            const inventorySnap = await getDocs(
              collection(db, `classes/${classId}/students/${student.uid}/inventory`),
            );
            const inventoryItems = inventorySnap.docs.map((inventoryDoc) => ({
              id: inventoryDoc.id,
              ...inventoryDoc.data(),
            }));

            return [
              student.uid,
              calculateActiveInventoryValue(inventoryItems, nowMs),
            ];
          }),
        );

        if (!isCancelled) {
          setActiveInventoryValues(
            Object.fromEntries(entries.filter(Boolean)),
          );
        }
      } catch (error) {
        console.error("[AdminFinanceManager] inventory value sync failed:", error);
        if (!isCancelled) {
          setActiveInventoryValues({});
        }
      }
    };

    void loadInventoryValues();

    return () => {
      isCancelled = true;
    };
  }, [classId, rosterStudents]);

  useEffect(() => {
    if (activeTab === "activity" && !canViewClassActivity) {
      setActiveTab("assets");
      return;
    }

    if (activeTab === "statistics" && !canViewStatistics) {
      setActiveTab("assets");
      return;
    }

    if (activeTab === "relativeEconomy" && !canViewRelativeEconomy) {
      setActiveTab(canViewStatistics ? "statistics" : "assets");
    }
  }, [activeTab, canViewClassActivity, canViewRelativeEconomy, canViewStatistics]);

  const studentMap = useMemo(
    () => new Map(students.map((student) => [student.uid, student])),
    [students],
  );

  const selectedStudents = useMemo(
    () => students.filter((student) => selectedUids.includes(student.uid)),
    [selectedUids, students],
  );

  const defaultAssetExportColumns = useMemo(
    () =>
      ASSET_EXPORT_COLUMNS.filter(
        (column) => assetVisibleColumns[column.key] !== false,
      ).map((column) => column.key),
    [assetVisibleColumns],
  );

  const openExportModal = useCallback((type) => {
    setExportModalType(type);
  }, []);

  const closeExportModal = useCallback(() => {
    if (isExporting) return;
    setExportModalType(null);
  }, [isExporting]);

  const getTargetStudents = useCallback(
    (studentInfo = []) =>
      studentInfo
        .map((student) => studentMap.get(student.uid))
        .filter(Boolean),
    [studentMap],
  );

  const fetchActivitiesForStudents = useCallback(
    async (targetStudents, exportOptions) => {
      const activityGroups = await Promise.all(
        targetStudents.map(async (student) => {
          const activityQuery = buildActivityLogQuery({
            db,
            classId,
            studentUid: student.uid,
            startDate: exportOptions.startDate || null,
            endDate: exportOptions.endDate || null,
            pageSize: null,
          });
          const snapshot = await getDocs(activityQuery);

          return snapshot.docs
            .map(convertFirestoreDocToActivity)
            .filter((activity) =>
              matchesSelectedActivityCategory(
                activity.category,
                exportOptions.selectedCategories,
              ),
            )
            .map((activity) => ({
              ...activity,
              studentUid: student.uid,
              studentName: student.name || "",
              studentNumber: student.studentNumber || "",
            }));
        }),
      );

      return activityGroups.flat();
    },
    [classId],
  );

  const fetchCreditDataForStudents = useCallback(
    async (targetStudents, exportOptions) => {
      const selectedRecordTypes = Array.isArray(exportOptions.selectedRecordTypes)
        ? exportOptions.selectedRecordTypes
        : [];
      const shouldFetchLogs = selectedRecordTypes.includes(
        CREDIT_RECORD_TYPE_OPTIONS[0].key,
      );
      const shouldFetchHistory = selectedRecordTypes.includes(
        CREDIT_RECORD_TYPE_OPTIONS[1].key,
      );

      if (!shouldFetchLogs && !shouldFetchHistory) {
        return { logs: [], history: [] };
      }

      const result = await exportAdminCreditData({
        classId,
        targetStudents: targetStudents.map((student) => ({
          uid: student.uid,
          name: student.name || "",
          studentNumber: student.studentNumber || "",
        })),
        selectedRecordTypes,
        startDate: exportOptions.startDate || null,
        endDate: exportOptions.endDate || null,
      });

      const logs = Array.isArray(result?.data?.logs) ? result.data.logs : [];
      const history = Array.isArray(result?.data?.history)
        ? result.data.history
        : [];

      return {
        logs,
        history,
      };
    },
    [classId],
  );

  const handleExport = useCallback(
    async (exportOptions) => {
      const targetStudents = getTargetStudents(exportOptions.studentInfo);

      if (targetStudents.length === 0) {
        appAlert("내보낼 학생을 먼저 선택해주세요.");
        return;
      }

      setIsExporting(true);

      try {
        if (exportOptions.mode === "asset") {
          exportAssetSnapshotToExcel(targetStudents, {
            selectedColumns: exportOptions.selectedColumns,
            sheetLayout: exportOptions.sheetLayout,
            className: classDisplayName,
            currencyUnit,
          });
          setExportModalType(null);
          return;
        }

        if (exportOptions.mode === "activity") {
          const activities = await fetchActivitiesForStudents(
            targetStudents,
            exportOptions,
          );

          if (activities.length === 0) {
            appAlert("선택한 조건에 맞는 활동 로그가 없습니다.");
            return;
          }

          exportActivityLogToExcel(activities, {
            selectedColumns: exportOptions.selectedColumns,
            selectedCategories: exportOptions.selectedCategories,
            sheetLayout: exportOptions.sheetLayout,
            students: targetStudents,
            startDate: exportOptions.startDate,
            endDate: exportOptions.endDate,
            className: classDisplayName,
            currencyUnit,
          });
          setExportModalType(null);
          return;
        }

        if (exportOptions.mode === "credit") {
          const creditData = await fetchCreditDataForStudents(
            targetStudents,
            exportOptions,
          );

          if (
            (!exportOptions.selectedRecordTypes.includes("creditLogs") ||
              creditData.logs.length === 0) &&
            (!exportOptions.selectedRecordTypes.includes("creditHistory") ||
              creditData.history.length === 0)
          ) {
            appAlert("선택한 조건에 맞는 신용 데이터가 없습니다.");
            return;
          }

          exportCreditDataToExcel(
            {
              ...creditData,
              students: targetStudents,
            },
            {
              selectedRecordTypes: exportOptions.selectedRecordTypes,
              sheetLayout: exportOptions.sheetLayout,
              startDate: exportOptions.startDate,
              endDate: exportOptions.endDate,
              className: classDisplayName,
            },
          );
          setExportModalType(null);
        }
      } catch (error) {
        console.error("[AdminFinanceManager] export failed:", error);
        appAlert("엑셀 내보내기 중 오류가 발생했습니다.");
      } finally {
        setIsExporting(false);
      }
    },
    [
      classDisplayName,
      currencyUnit,
      fetchActivitiesForStudents,
      fetchCreditDataForStudents,
      getTargetStudents,
    ],
  );

  const applySelectionMode = useCallback(
    (uid, mode) => {
      if (readOnly) return;

      setSelectedUids((prev) => {
        const next = new Set(prev);
        if (mode === "select") next.add(uid);
        if (mode === "deselect") next.delete(uid);
        return Array.from(next);
      });
    },
    [readOnly],
  );

  const { startDrag, enterDrag } = useDragSelection({
    isSelected: (uid) => selectedUids.includes(uid),
    onSelect: (uid) => applySelectionMode(uid, "select"),
    onDeselect: (uid) => applySelectionMode(uid, "deselect"),
    isItemEnabled: () => !readOnly,
  });

  const handleSelectionStart = useCallback(
    (uid, isSelected) => {
      if (readOnly) return;
      startDrag(uid, { selected: isSelected });
    },
    [readOnly, startDrag],
  );

  const handleSelectionDrag = useCallback(
    (uid) => {
      if (readOnly) return;
      enterDrag(uid);
    },
    [enterDrag, readOnly],
  );

  const openAdjustmentModal = useCallback(
    (mode, adjustType = "asset") => {
      if (!allowedAdjustmentTypes.includes(adjustType)) return;

      const targets = students.filter((student) => selectedUids.includes(student.uid));
      if (targets.length === 0) return;

      setAdjustmentModal({
        isOpen: true,
        mode,
        adjustType,
        targets,
      });
    },
    [allowedAdjustmentTypes, selectedUids, students],
  );

  const exportActionButtons =
    canExportFinanceData && activeTab === "assets" ? (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          kind="outline"
          tone="slate"
          size="sm"
          icon={Wallet}
          onClick={() => openExportModal("asset")}
        >
          자산 내보내기
        </Button>
        <Button
          kind="outline"
          tone="slate"
          size="sm"
          icon={ListChecks}
          onClick={() => openExportModal("activity")}
        >
          활동 로그 내보내기
        </Button>
        <Button
          kind="outline"
          tone="slate"
          size="sm"
          icon={ShieldCheck}
          onClick={() => openExportModal("credit")}
        >
          신용 로그 내보내기
        </Button>
      </div>
    ) : null;
  const exportModalColumns =
    exportModalType === "asset"
      ? ASSET_EXPORT_COLUMNS
      : exportModalType === "activity"
        ? ACTIVITY_EXPORT_COLUMNS
        : [];
  const exportModalDefaultColumns =
    exportModalType === "asset"
      ? defaultAssetExportColumns
      : exportModalType === "activity"
        ? ACTIVITY_EXPORT_COLUMNS.map((column) => column.key)
        : [];
  const adjustmentActions = useMemo(() => {
    const actions = [];

    if (allowedAdjustmentTypes.includes("asset")) {
      actions.push({
        key: "asset",
        label: "\uC790\uC0B0",
        icon: Coins,
        tone: "indigo",
        onClick: () => openAdjustmentModal("increment", "asset"),
      });
    }

    if (allowedAdjustmentTypes.includes("credit")) {
      actions.push({
        key: "credit",
        label: "\uC2E0\uC6A9",
        icon: Sparkles,
        tone: "blue",
        kind: "outline",
        onClick: () => openAdjustmentModal("increment", "credit"),
      });
    }

    if (allowedAdjustmentTypes.includes("missionToken")) {
      actions.push({
        key: "mission-token",
        label: "\uBBF8\uC158\uD1A0\uD070",
        icon: PlusCircle,
        tone: "emerald",
        kind: "outline",
        onClick: () => openAdjustmentModal("increment", "missionToken"),
      });
    }

    if (allowedAdjustmentTypes.includes("usdBalance")) {
      actions.push({
        key: "usdBalance",
        label: "외화(FIN)",
        icon: Coins,
        tone: "blue",
        kind: "outline",
        onClick: () => openAdjustmentModal("increment", "usdBalance"),
      });
    }

    return actions;
  }, [allowedAdjustmentTypes, openAdjustmentModal]);

  const manageAssetsQuestGuide = useMemo(
    () => ({
      type: "quest",
      title: "경제 관리 도우미",
      launcherTitle: "경제 관리 도우미",
      launcherDescription: "자산 현황, 활동 로그, 통계, 일괄 조정 흐름을 체크합니다.",
      subtitle: "학급 전체 경제 상태를 관리하는 핵심 운영 화면을 확인합니다.",
      storageKey: classId
        ? `finclass_manage_assets_quest_${classId}`
        : "finclass_manage_assets_quest",
      tourKey: "TEACHER_MANAGE_ASSETS_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "asset-overview",
          title: "종합 현황 확인하기",
          description: "학생별 자산, 신용, 미션토큰 상태를 확인합니다.",
          doneText: `${students.length}명의 경제 상태를 볼 수 있습니다.`,
          completed: activeTab === "assets" && students.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "assets-open",
              label: "종합 현황 탭 열기",
              completed: activeTab === "assets",
            },
            {
              id: "student-count",
              label: "학생 경제 데이터 확인",
              completed: students.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-assets-tabs"]',
              title: "경제 관리 탭",
              content: "종합 현황, 활동 로그, 통계 화면을 전환합니다.",
            },
            {
              target: '[data-tour="manage-assets-content"]',
              title: "학생 자산 표",
              content: "학생별 자산과 관련 활동으로 이동할 수 있는 표입니다.",
            },
          ],
        },
        {
          id: "bulk-adjustment",
          title: "일괄 조정 흐름 확인하기",
          description: "학생을 선택해 자산, 신용, 미션토큰을 일괄 조정할 수 있습니다.",
          completed: selectedUids.length > 0 || adjustmentModal?.isOpen,
          manualComplete: true,
          objectives: [
            {
              id: "student-selected",
              label: "조정할 학생 선택",
              completed: selectedUids.length > 0,
            },
            {
              id: "adjustment-open",
              label: "일괄 조정 모달 열기",
              completed: adjustmentModal?.isOpen,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-assets-content"]',
              title: "학생 선택",
              content: "학생을 선택한 뒤 일괄 조정 버튼으로 이어집니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "activity-log",
          title: "활동 로그 보기",
          description: "학급 경제 활동 기록을 확인합니다.",
          completed: activeTab === "activity",
          manualComplete: true,
          objectives: [
            {
              id: "activity-open",
              label: "활동 로그 탭 열기",
              completed: activeTab === "activity",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-assets-tabs"]',
              title: "활동 로그",
              content: "경제 활동 이력을 탭에서 확인합니다.",
            },
          ],
        },
        {
          id: "export-tools",
          title: "내보내기 도구 확인하기",
          description: "자산, 활동 로그, 신용 로그를 내려받는 위치를 확인합니다.",
          completed: Boolean(exportModalType),
          manualComplete: true,
          objectives: [
            {
              id: "export-open",
              label: "내보내기 설정 열기",
              completed: Boolean(exportModalType),
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-assets-actions"]',
              title: "내보내기",
              content: "상단 버튼에서 자산과 로그 데이터를 내려받습니다.",
            },
          ],
        },
        {
          id: "statistics",
          title: "경제 통계 보기",
          description: "학급 경제의 분포와 변화를 통계 화면에서 확인합니다.",
          completed: activeTab === "statistics",
          manualComplete: true,
          objectives: [
            {
              id: "statistics-open",
              label: "경제 통계 탭 열기",
              completed: activeTab === "statistics",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-assets-tabs"]',
              title: "경제 통계",
              content: "통계 탭에서 학급 경제 흐름을 확인합니다.",
            },
          ],
        },
        {
          id: "relative-economy",
          title: "상대 분석 보기",
          description: "학생 간 경제 상태를 비교하는 분석 화면을 확인합니다.",
          completed: activeTab === "relativeEconomy",
          manualComplete: true,
          objectives: [
            {
              id: "relative-open",
              label: "상대 분석 탭 열기",
              completed: activeTab === "relativeEconomy",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-assets-tabs"]',
              title: "상대 분석",
              content: "상대 분석 탭에서 학생 간 경제 상태를 비교합니다.",
            },
          ],
        },
      ],
    }),
    [
      activeTab,
      adjustmentModal?.isOpen,
      classId,
      exportModalType,
      selectedUids.length,
      students.length,
    ],
  );

  if (isInitialLoading) {
    return (
      <AppLayout showDefaultHeader={false}>
        <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-8">
          <PageSkeleton summaryCards={0} showChart={false} showTable={false} />
          <TableSkeleton columns={7} rows={9} />
        </div>
      </AppLayout>
    );
  }


  return (
    <AppLayout showDefaultHeader={false} pageGuide={manageAssetsQuestGuide}>
      <div className="relative min-h-screen overflow-hidden bg-[#f0f5ff] p-4 sm:p-8">
        <div className="pointer-events-none fixed right-0 top-0 z-0 h-[500px] w-[500px] rounded-full bg-blue-100/30 blur-[120px]" />
        <div className="pointer-events-none fixed bottom-0 left-0 z-0 h-[400px] w-[400px] rounded-full bg-indigo-50/40 blur-[100px]" />

        <div className="relative z-10 space-y-8">
          <PageHeader
            title="경제 관리"
            subtitle={`${
              classData?.className || "소속 학급"
            }의 자산 현황, 활동 로그, 경제 통계를 한곳에서 관리합니다.`}
            icon={Wallet}
            rightSlot={<div data-tour="manage-assets-actions">{exportActionButtons}</div>}
          />

          <div data-tour="manage-assets-tabs" data-active-tab={activeTab}>
            <Tabs
              idPrefix="finance-sections"
              ariaLabel="경제 관리 보기"
              variant="underline"
              size="md"
              activeTab={activeTab}
              onTabChange={setActiveTab}
              tabs={[
                { id: "assets", label: "종합 현황", icon: Users },
                ...(canViewClassActivity ? [{ id: "activity", label: "활동 로그", icon: ListChecks }] : []),
                ...(canViewStatistics ? [{ id: "statistics", label: "경제 통계", icon: BarChart3 }] : []),
                ...(canViewRelativeEconomy ? [{ id: "relativeEconomy", label: "상대 분석", icon: ShieldCheck }] : []),
              ]}
            />
          </div>
          <SurfaceLoader
            loading={isRefreshing}
            variant="refreshing"
            message="학급 경제 데이터를 새로고침하는 중입니다..."
          >
            <div className="relative">
            <div
              data-tour="manage-assets-content"
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[260px]"
            />
            {activeTab === "assets" ? (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <Card noPadding className="overflow-hidden">
                  <StudentAssetTable
                    students={students}
                    classId={classId}
                    readOnly={readOnly}
                    selectionEnabled={canManageAssets}
                    canCustomizeColumns={canManageAssets}
                    canOpenLog={canManageAllAssets}
                    canOpenActivityLog={canManageAllAssets}
                    canOpenMissionTokenHistory={canManageAllAssets}
                    canOpenBank={canManageAllAssets}
                    canOpenPortfolio={canManageAllAssets}
                    canOpenInventory={canManageAllAssets}
                    onVisibleColumnsChange={setAssetVisibleColumns}
                    selectedUids={selectedUids}
                    onSelectionMouseDown={handleSelectionStart}
                    onSelectionMouseEnter={handleSelectionDrag}
                    onSelectAll={() =>
                      setSelectedUids(
                        selectedUids.length === students.length
                          ? []
                          : students.map((student) => student.uid),
                      )
                    }
                    onToggleSelection={(uid) =>
                      setSelectedUids((prev) =>
                        prev.includes(uid)
                          ? prev.filter((itemUid) => itemUid !== uid)
                          : [...prev, uid],
                      )
                    }
                    onOpenLog={canManageAllAssets ? setCreditLogTarget : undefined}
                    onOpenActivityLog={
                      canManageAllAssets ? setActivityTarget : undefined
                    }
                    onOpenMissionTokenHistory={
                      canManageAllAssets ? setMissionTokenHistoryTarget : undefined
                    }
                    onOpenBank={
                      canManageAllAssets
                        ? (student, tab) => setBankTarget({ student, tab })
                        : undefined
                    }
                    onOpenPortfolio={canManageAllAssets ? setPortfolioTarget : undefined}
                    onOpenInventory={canManageAllAssets ? setInventoryTarget : undefined}
                  />
                </Card>
              </motion.div>
            ) : null}

            {activeTab === "activity" && canViewClassActivity ? (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <ClassActivityLogTab
                  classId={classId}
                  students={students}
                  currencyUnit={currencyUnit}
                />
              </motion.div>
            ) : null}

            {activeTab === "statistics" && canViewStatistics ? (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <MonetaryIndicators
                  classId={classId}
                  students={students}
                  conversionRate={conversionRate}
                  currencyUnit={currencyUnit}
                />
              </motion.div>
            ) : null}

            {activeTab === "relativeEconomy" && canViewRelativeEconomy ? (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <ClassRelativeEconomyTab
                  classId={classId}
                  students={students}
                  currencyUnit={currencyUnit}
                />
              </motion.div>
            ) : null}

            </div>
          </SurfaceLoader>
        </div>

        {activeTab === "assets" &&
        selectedUids.length > 0 &&
        adjustmentActions.length > 0 ? (
          <BulkActionFloatingBar
            count={selectedUids.length}
            tone="indigo"
            icon={Wallet}
            eyebrow="자산 조정"
            title={`${selectedUids.length}명 선택됨`}
            subtitle="선택한 학생 자산을 한 번에 조정할 수 있습니다."
            onClear={() => setSelectedUids([])}
            actions={adjustmentActions.length > 0 ? adjustmentActions : [
              {
                key: "asset",
                label: "자산",
                icon: Coins,
                tone: "indigo",
                onClick: () => openAdjustmentModal("increment", "asset"),
              },
              {
                key: "credit",
                label: "신용",
                icon: Sparkles,
                tone: "blue",
                kind: "outline",
                onClick: () => openAdjustmentModal("increment", "credit"),
              },
              {
                key: "mission-token",
                label: missionTokenLabel,
                icon: PlusCircle,
                tone: "emerald",
                kind: "outline",
                onClick: () => openAdjustmentModal("increment", "missionToken"),
              },
            ]}
          />
        ) : null}
      </div>

      {exportModalType ? (
        <FinanceDataExportModal
          isOpen={!!exportModalType}
          onClose={closeExportModal}
          mode={exportModalType}
          classId={classId}
          allStudents={students}
          selectedStudents={selectedStudents}
          availableColumns={exportModalColumns}
          defaultSelectedColumns={exportModalDefaultColumns}
          onExport={handleExport}
          isLoadingExport={isExporting}
        />
      ) : null}

      {creditLogTarget ? (
        <CreditLogModal
          student={creditLogTarget}
          onClose={() => setCreditLogTarget(null)}
        />
      ) : null}

      {activityTarget ? (
        <ActivityLogModal
          isOpen={!!activityTarget}
          onClose={() => setActivityTarget(null)}
          studentUid={activityTarget.uid}
          studentName={activityTarget.name}
        />
      ) : null}

      {missionTokenHistoryTarget ? (
        <MissionTokenHistoryModal
          isOpen={!!missionTokenHistoryTarget}
          onClose={() => setMissionTokenHistoryTarget(null)}
          classId={classId}
          studentUid={missionTokenHistoryTarget.uid}
        />
      ) : null}

      {portfolioTarget ? (
        <PortfolioModal
          isOpen={!!portfolioTarget}
          onClose={() => setPortfolioTarget(null)}
          uid={portfolioTarget.uid}
          studentName={portfolioTarget.name}
          isAdmin={true}
          onOpenTradeAnalysis={setTradeAnalysisTarget}
        />
      ) : null}

      {tradeAnalysisTarget ? (
        <TradeAnalysisModal
          isOpen={!!tradeAnalysisTarget}
          onClose={() => setTradeAnalysisTarget(null)}
          uid={tradeAnalysisTarget.uid}
          studentName={tradeAnalysisTarget.name}
        />
      ) : null}

      {inventoryTarget ? (
        <MyItemsModal
          isOpen={!!inventoryTarget}
          onClose={() => setInventoryTarget(null)}
          uid={inventoryTarget.uid}
          isAdminView={true}
        />
      ) : null}

      {bankTarget.student ? (
        <BankManagementModal
          isOpen={!!bankTarget.student}
          onClose={() => setBankTarget({ student: null, tab: "savings" })}
          student={bankTarget.student}
          initialTab={bankTarget.tab}
          classId={classId}
        />
      ) : null}


      {adjustmentModal.isOpen ? (
        <UnifiedAdjustmentModal
          targets={adjustmentModal.targets}
          initialMode={adjustmentModal.mode}
          initialType={adjustmentModal.adjustType}
          allowedTypes={allowedAdjustmentTypes}
          onClose={() =>
            setAdjustmentModal((prev) => ({
              ...prev,
              isOpen: false,
            }))
          }
        />
      ) : null}
    </AppLayout>
  );
};

export default AdminFinanceManager;
