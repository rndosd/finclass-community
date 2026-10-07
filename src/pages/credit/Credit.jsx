import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import {
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Edit3,
  GraduationCap,
  LayoutPanelTop,
  ListChecks,
  ShieldCheck,
  TableProperties,
  TrendingUp,
} from "lucide-react";

import { db } from "../../firebase";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useUser } from "../../contexts/UserContext";
import AppLayout from "../../components/layout/AppLayout";
import {
  BulkActionFloatingBar,
  Button,
  Card,
  CardSkeleton,
  PageHeader,
  SurfaceLoader,
  TableSkeleton,
} from "../../components/ui";
import useDragSelection from "../../hooks/useDragSelection";
import { useClassStudents } from "../../hooks/user/useClassStudents";
import CreditToolbar from "./components/CreditToolbar";
import CreditFlowTab from "./components/CreditFlowTab";
import MyCreditTab from "./components/MyCreditTab";
import CreditHistoryModal from "./modals/CreditHistoryModal";
import CreditScoreModal from "./modals/CreditScoreModal";
import CreditTierModal from "./modals/CreditTierModal";
import TierSettingsModal from "./modals/TierSettingsModal";
import { formatCreditScore, getTierInfoByScore, normalizeCreditScore } from "./utils/tierUtils";

function CreditPageSkeleton({ showManageLayout = true }) {
  return (
    <div className="min-h-screen bg-[#f0f5ff]">
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="space-y-3">
          <div className="h-10 w-48 animate-pulse rounded-2xl bg-slate-200/80" />
          <div className="h-5 w-80 max-w-full animate-pulse rounded-xl bg-slate-200/60" />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex max-w-xl gap-2 rounded-2xl border border-slate-200 bg-white/80 p-1.5 shadow-sm">
            {Array.from({ length: showManageLayout ? 2 : 1 }).map((_, index) => (
              <div
                key={`credit-tab-skeleton-${index}`}
                className="h-11 flex-1 animate-pulse rounded-xl bg-slate-200/70"
              />
            ))}
          </div>
          <div className="h-10 w-28 animate-pulse rounded-xl bg-white/90 shadow-sm" />
        </div>

        {showManageLayout ? (
          <TableSkeleton
            columns={6}
            rows={6}
            className="rounded-[1.75rem] border-0 bg-white shadow-xl shadow-slate-200/40"
          />
        ) : (
          <div className="space-y-6">
            <CardSkeleton
              rows={6}
              className="rounded-[1.75rem] border-0 bg-white shadow-xl shadow-slate-200/40"
            />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
              <CardSkeleton
                rows={7}
                className="rounded-[1.75rem] border-0 bg-white shadow-xl shadow-slate-200/40"
              />
              <CardSkeleton
                rows={6}
                className="rounded-[1.75rem] border-0 bg-white shadow-xl shadow-slate-200/40"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function parseCreditScoreMax(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }

  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : null;
}

function toSortableNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""), "ko");
}

function compareNullableNumbers(left, right) {
  const hasLeft = left !== null && left !== undefined;
  const hasRight = right !== null && right !== undefined;

  if (!hasLeft && !hasRight) return 0;
  if (!hasLeft) return 1;
  if (!hasRight) return -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function getStudentTierSortMeta(student, tierCriteria = []) {
  if (!Array.isArray(tierCriteria) || tierCriteria.length === 0) {
    return { threshold: null, name: "" };
  }

  const tierInfo = getTierInfoByScore(student?.creditScore, tierCriteria);
  const matchedTier =
    tierCriteria.find((tier) => tier?.id && tier.id === tierInfo?.id) ||
    tierCriteria.find(
      (tier) =>
        String(tier?.name || "").trim() === String(tierInfo?.name || "").trim(),
    );

  return {
    threshold: toSortableNumber(matchedTier?.minScore) ?? 0,
    name: String(tierInfo?.name || ""),
  };
}

function compareStudentsByKey(left, right, sortKey, tierCriteria = []) {
  const leftNumber = toSortableNumber(left?.studentNumber);
  const rightNumber = toSortableNumber(right?.studentNumber);
  const leftScore = toSortableNumber(left?.creditScore);
  const rightScore = toSortableNumber(right?.creditScore);

  switch (sortKey) {
    case "studentNumber":
      return (
        compareNullableNumbers(leftNumber, rightNumber) ||
        compareText(left?.name, right?.name)
      );

    case "name":
      return (
        compareText(left?.name, right?.name) ||
        compareNullableNumbers(leftNumber, rightNumber)
      );

    case "creditScore":
      return (
        compareNullableNumbers(leftScore, rightScore) ||
        compareNullableNumbers(leftNumber, rightNumber) ||
        compareText(left?.name, right?.name)
      );

    case "tier": {
      if (!tierCriteria.length) return 0;

      const leftTier = getStudentTierSortMeta(left, tierCriteria);
      const rightTier = getStudentTierSortMeta(right, tierCriteria);

      return (
        compareNullableNumbers(leftTier.threshold, rightTier.threshold) ||
        compareText(leftTier.name, rightTier.name) ||
        compareNullableNumbers(leftScore, rightScore) ||
        compareNullableNumbers(leftNumber, rightNumber) ||
        compareText(left?.name, right?.name)
      );
    }

    default:
      return 0;
  }
}

export default function Credit() {
  const location = useLocation();
  const {
    classId,
    loading: userLoading,
    isTeacher,
    hasPermission,
    userData,
  } = useUser();
  const { showFeedback } = useFeedback();
  const canManageCredit = isTeacher || hasPermission("credit_admin");
  const canReadCreditRoster = canManageCredit;

  const [activeTab, setActiveTab] = useState(canManageCredit ? "manage" : "my");
  const [selectedUids, setSelectedUids] = useState([]);
  const [mobileSelectionMode, setMobileSelectionMode] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editTargets, setEditTargets] = useState([]);
  const [editMode, setEditMode] = useState("increment");
  const [logTarget, setLogTarget] = useState(null);
  const [tierCriteria, setTierCriteria] = useState([]);
  const [creditScoreMax, setCreditScoreMax] = useState(null);
  const [tierCriteriaStatus, setTierCriteriaStatus] = useState("loading");
  const [showTierModal, setShowTierModal] = useState(false);
  const [showTierTable, setShowTierTable] = useState(false);
  const [sortConfig, setSortConfig] = useState({
    key: "studentNumber",
    direction: "asc",
  });

  const selectAllCheckboxRef = useRef(null);
  const { data: rawStudents } = useClassStudents(classId, {
    enabled: !!classId && !userLoading && canReadCreditRoster,
  });

  const students = useMemo(() => {
    if (!canReadCreditRoster) {
      return userData ? [userData] : [];
    }

    const nextStudents = Array.isArray(rawStudents) ? rawStudents : [];
    const teacher = nextStudents.find((student) => student.role === "teacher");
    const others = nextStudents.filter((student) => student.role !== "teacher");
    return teacher ? [teacher, ...others] : nextStudents;
  }, [canReadCreditRoster, rawStudents, userData]);

  const myTierInfo = useMemo(() => {
    return getTierInfoByScore(userData?.creditScore, tierCriteria);
  }, [tierCriteria, userData?.creditScore]);

  const availableTabs = useMemo(() => {
    const tabs = [{ id: "my", label: "\uB0B4 \uC2E0\uC6A9", icon: LayoutPanelTop }];

    if (canManageCredit) {
      if (isTeacher) {
      if (isTeacher) {
      tabs.push({
        id: "flow",
        label: "신용 흐름",
        icon: BarChart3,
      });


      }
      }      tabs.push({
        id: "manage",
        label: "\uC2E0\uC6A9 \uAD00\uB9AC",
        icon: TableProperties,
      });
    }

    return tabs;
  }, [canManageCredit, isTeacher]);

  const hasStudentSnapshot =
    !canReadCreditRoster || Array.isArray(rawStudents);
  const isInitialLoading =
    userLoading ||
    (tierCriteriaStatus === "loading" && tierCriteria.length === 0) ||
    (canReadCreditRoster && !!classId && !hasStudentSnapshot);
  const isContentRefreshing =
    !isInitialLoading &&
    tierCriteriaStatus === "loading" &&
    tierCriteria.length > 0;

  const sortedStudents = useMemo(() => {
    if (!sortConfig.key) return students;

    const nextStudents = [...students];
    nextStudents.sort((left, right) => {
      const result = compareStudentsByKey(
        left,
        right,
        sortConfig.key,
        tierCriteria,
      );

      if (result === 0) return 0;
      return sortConfig.direction === "desc" ? -result : result;
    });

    return nextStudents;
  }, [sortConfig.direction, sortConfig.key, students, tierCriteria]);

  useEffect(() => {
    const validTabIds = new Set(availableTabs.map((tab) => tab.id));
    if (!validTabIds.has(activeTab)) {
      setActiveTab(canManageCredit ? "manage" : "my");
    }
  }, [activeTab, availableTabs, canManageCredit]);

  useEffect(() => {
    const requestedTab = location.state?.defaultTab;
    if (!requestedTab) return;

    const validTabIds = new Set(availableTabs.map((tab) => tab.id));
    if (validTabIds.has(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [availableTabs, location.key, location.state]);

  useEffect(() => {
    setSelectedUids((prev) =>
      prev.filter((uid) => students.some((student) => student.uid === uid)),
    );
  }, [students]);

  useEffect(() => {
    if (userLoading) {
      setTierCriteriaStatus("loading");
      return;
    }

    if (!classId) {
      setTierCriteria([]);
      setCreditScoreMax(null);
      setTierCriteriaStatus("ready");
      return;
    }

    setTierCriteriaStatus("loading");
    const criteriaRef = doc(db, `classes/${classId}/tierCriteria/default`);
    const unsubscribe = onSnapshot(
      criteriaRef,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() || {} : {};
        setTierCriteria(data.tiers || []);
        setCreditScoreMax(parseCreditScoreMax(data.maxScore));
        setTierCriteriaStatus("ready");
      },
      () => {
        setTierCriteriaStatus("error");
      },
    );

    return () => unsubscribe();
  }, [classId, userLoading]);

  useEffect(() => {
    if (!selectAllCheckboxRef.current) return;

    const allCount = students.length;
    const selectedCount = selectedUids.length;
    selectAllCheckboxRef.current.checked =
      allCount > 0 && selectedCount === allCount;
    selectAllCheckboxRef.current.indeterminate =
      selectedCount > 0 && selectedCount < allCount;
  }, [selectedUids, students]);

  const applySelectionMode = useCallback(
    (uid, mode) => {
      if (!canManageCredit) return;

      setSelectedUids((prev) => {
        const next = new Set(prev);
        if (mode === "select") next.add(uid);
        else next.delete(uid);
        return Array.from(next);
      });
    },
    [canManageCredit],
  );

  const { startDrag, enterDrag } = useDragSelection({
    isSelected: (uid) => selectedUids.includes(uid),
    onSelect: (uid) => applySelectionMode(uid, "select"),
    onDeselect: (uid) => applySelectionMode(uid, "deselect"),
    isItemEnabled: () => canManageCredit,
  });

  const handleSelectionStart = (uid, isSelected) => {
    if (!canManageCredit) return;
    startDrag(uid, { selected: isSelected });
  };

  const handleSelectionDrag = (uid) => {
    if (!canManageCredit) return;
    enterDrag(uid);
  };

  const isRowSelectionExcludedTarget = (target) => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("button,a,[data-no-row-select='true']"));
  };

  const handleSelectAll = () => {
    setSelectedUids(
      selectedUids.length === students.length
        ? []
        : students.map((student) => student.uid),
    );
  };

  const requestSort = useCallback((key) => {
    setSortConfig((prev) => ({
      key,
      direction:
        prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  const getAriaSort = useCallback(
    (key) => {
      if (sortConfig.key !== key) return "none";
      return sortConfig.direction === "asc" ? "ascending" : "descending";
    },
    [sortConfig.direction, sortConfig.key],
  );

  const SortIcon = useCallback(
    ({ sortKey }) => (
      <ArrowUpDown
        className={`ml-1 inline h-3 w-3 ${
          sortConfig.key === sortKey ? "text-indigo-600" : "text-slate-300"
        }`}
      />
    ),
    [sortConfig.key],
  );

  const openMultiEdit = (mode) => {
    const targets = students.filter((student) => selectedUids.includes(student.uid));
    if (targets.length === 0) return;

    setEditTargets(targets);
    setEditMode(mode);
    setModalVisible(true);
  };

  const handleScoreModalClose = () => {
    setModalVisible(false);
    setEditTargets([]);
    setSelectedUids([]);
  };

  const handleSaveTierCriteria = async (config) => {
    try {
      const nextConfig = Array.isArray(config)
        ? { tiers: config, maxScore: null }
        : {
            tiers: config?.tiers || [],
            maxScore: config?.maxScore ?? null,
          };

      const payload = { tiers: nextConfig.tiers };
      const parsedMaxScore = parseCreditScoreMax(nextConfig.maxScore);
      if (parsedMaxScore !== null) {
        payload.maxScore = parsedMaxScore;
      }

      await setDoc(doc(db, `classes/${classId}/tierCriteria/default`), payload);
      showFeedback("등급 기준을 저장했습니다.", "success");
    } catch {
      showFeedback("등급 기준 저장 중 오류가 발생했습니다.", "error");
    }
  };

  const creditQuestGuide = useMemo(() => {
    if (!canManageCredit) return null;

    const studentsWithScore = students.filter((student) =>
      normalizeCreditScore(student?.creditScore) !== null,
    );
    const hasTierCriteria = tierCriteria.length > 0;
    const hasSelectedStudents = selectedUids.length > 0;

    return {
      type: "quest",
      title: "신용 도우미",
      launcherTitle: "신용 도우미",
      launcherDescription: "등급 기준, 학생 점수, 수정 흐름을 체크합니다.",
      subtitle: "학생의 신용 점수를 경제 활동의 조건으로 연결하는 구조를 확인합니다.",
      storageKey: classId ? `finclass_credit_quest_${classId}` : "finclass_credit_quest",
      tourKey: "TEACHER_CREDIT_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "tier-criteria",
          title: "신용 등급 기준 만들기",
          description: "점수에 따라 표시할 등급 기준을 확인합니다.",
          doneText: `${tierCriteria.length}개의 등급 기준이 있습니다.`,
          completed: hasTierCriteria,
          manualComplete: false,
          objectives: [
            {
              id: "tier-count",
              label: "등급 기준 1개 이상 만들기",
              completed: hasTierCriteria,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="credit-tier-table"]',
              title: "등급표",
              content: "등급표 버튼에서 현재 신용 등급 기준을 확인합니다.",
            },
          ],
        },
        {
          id: "student-score-list",
          title: "학생 신용 점수 확인하기",
          description: "학생 목록에서 현재 신용 점수와 등급을 확인합니다.",
          doneText: `${studentsWithScore.length}명의 점수가 확인됩니다.`,
          completed: studentsWithScore.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "manage-open",
              label: "신용 관리 탭 열기",
              completed: activeTab === "manage",
            },
            {
              id: "score-count",
              label: "학생 신용 점수 확인",
              completed: studentsWithScore.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="credit-table-preview"]',
              title: "신용 관리 표",
              content: "학생별 점수, 등급, 로그를 표에서 확인합니다.",
            },
            {
              target: '[data-tour="credit-select-column"]',
              title: "학생 선택",
              content: "학생을 선택해 여러 명의 점수를 한 번에 수정할 수 있습니다.",
            },
          ],
        },
        {
          id: "score-edit-flow",
          title: "점수 수정 흐름 확인하기",
          description: "학생을 선택하고 점수 증가/감소 처리를 할 수 있는지 확인합니다.",
          completed: hasSelectedStudents || modalVisible,
          manualComplete: true,
          objectives: [
            {
              id: "student-selected",
              label: "수정할 학생 선택",
              completed: hasSelectedStudents,
            },
            {
              id: "score-modal-open",
              label: "점수 수정 모달 열기",
              completed: modalVisible,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="credit-select-column"]',
              title: "학생 선택",
              content: "체크박스로 점수를 수정할 학생을 선택합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "flow-tab",
          title: "신용 흐름 보기",
          description: "점수 변화와 활동 흐름을 보는 탭을 확인합니다.",
          completed: activeTab === "flow",
          manualComplete: true,
          objectives: [
            {
              id: "flow-open",
              label: "신용 흐름 탭 열기",
              completed: activeTab === "flow",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="credit-table-preview"]',
              title: "신용 흐름",
              content: "탭을 전환해 신용 변화 흐름을 확인합니다.",
            },
          ],
        },
        {
          id: "my-credit",
          title: "학생 관점 확인하기",
          description: "학생이 자신의 신용 등급을 어떻게 보는지 확인합니다.",
          completed: activeTab === "my",
          manualComplete: true,
          objectives: [
            {
              id: "my-tab-open",
              label: "내 신용 탭 열기",
              completed: activeTab === "my",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="credit-table-preview"]',
              title: "내 신용",
              content: "학생 관점의 신용 정보 표시를 확인합니다.",
            },
          ],
        },
      ],
    };
  }, [
    activeTab,
    canManageCredit,
    classId,
    modalVisible,
    selectedUids.length,
    students,
    tierCriteria.length,
  ]);

  if (isInitialLoading) {
    return (
      <AppLayout showDefaultHeader={false}>
        <CreditPageSkeleton showManageLayout={userLoading || canManageCredit}
          fullHeight={false}
          className="min-h-screen"
          message="신용 데이터를 불러오는 중입니다..."
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout showDefaultHeader={false} pageGuide={creditQuestGuide}>
      <div className="min-h-screen bg-[#f0f5ff]">
        <div className="p-4 sm:p-6 lg:p-8">
          <PageHeader
            title="신용 점수"
            subtitle={
              canManageCredit
                ? "내 신용 정보와 학생 신용 관리 화면을 함께 확인할 수 있습니다."
                : "내 신용 현황과 등급 혜택을 확인할 수 있습니다."
            }
            icon={ShieldCheck}
          />

          <SurfaceLoader
            loading={isContentRefreshing}
            variant="refreshing"
            message="신용 정보를 업데이트하는 중입니다..."
          >
          <div className="mt-6">
            <CreditToolbar
              tabs={availableTabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              canManageCredit={canManageCredit}
              onViewTiers={() => setShowTierTable(true)}
              onEditTiers={() => setShowTierModal(true)}
            />
          </div>
          </SurfaceLoader>

          <div className="mt-6">
            {activeTab === "my" ? (
              <MyCreditTab
                classId={classId}
                student={userData}
                tierInfo={myTierInfo}
                tierCriteria={tierCriteria}
                creditScoreMax={creditScoreMax}
                onViewAllLogs={() => setLogTarget(userData)}
              />
            ) : null}

            {activeTab === "flow" ? (
              <CreditFlowTab classId={classId} students={students} tierCriteria={tierCriteria} />
            ) : null}

            {activeTab === "manage" ? (
              <>
                {canManageCredit &&
                tierCriteriaStatus === "ready" &&
                tierCriteria.length === 0 ? (
                  <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
                    <div>
                      <h4 className="text-sm font-bold text-amber-800">
                        아직 신용등급 기준이 없습니다.
                      </h4>
                      <p className="mt-1 text-xs text-amber-700">
                        신용 점수에 맞는 등급을 표시하려면 먼저 등급 기준을 설정해 주세요.
                      </p>
                    </div>
                  </div>
                ) : null}

                <Card noPadding className="relative z-10 overflow-hidden">
                  <div
                    data-tour="credit-table-preview"
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-[72px] z-10 h-[220px]"
                  />

                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-4 sm:p-6">
                    <h2
                      data-tour="credit-student-list"
                      className="flex items-center gap-2 font-bold text-slate-700"
                    >
                      <GraduationCap className="h-5 w-5 text-indigo-500" />
                      학생 목록
                      <span className="text-sm font-normal text-slate-400">
                        {students.length}명
                      </span>
                    </h2>

                    <span className="hidden text-[11px] font-semibold text-indigo-500 sm:block">
                      드래그해서 학생을 선택하고 한 번에 점수를 수정할 수 있습니다.
                    </span>
                  </div>

                  <div className="space-y-3 p-4 md:hidden">
                    {canManageCredit && sortedStudents.length > 0 ? (
                      <div className="flex items-center justify-between gap-2">
                        {mobileSelectionMode ? (
                          <label className="flex min-h-11 flex-1 items-center justify-between rounded-xl bg-slate-50 px-3 text-sm font-semibold text-slate-600">
                            전체 학생 선택
                            <input
                              type="checkbox"
                              checked={
                                students.length > 0 &&
                                selectedUids.length === students.length
                              }
                              onChange={handleSelectAll}
                              className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </label>
                        ) : (
                          <p className="text-xs font-medium text-slate-500">
                            학생을 선택하면 점수를 한 번에 수정할 수 있습니다.
                          </p>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          tone={mobileSelectionMode ? "blue" : "slate"}
                          aria-pressed={mobileSelectionMode}
                          kind={mobileSelectionMode ? "soft" : "outline"}
                          onClick={() => {
                            setMobileSelectionMode((current) => {
                              if (current) setSelectedUids([]);
                              return !current;
                            });
                          }}
                          className="shrink-0 justify-center"
                        >
                          {mobileSelectionMode ? "선택 종료" : "선택"}
                        </Button>
                      </div>
                    ) : null}

                    {sortedStudents.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center">
                        <p className="text-sm font-semibold text-slate-600">
                          표시할 학생이 없습니다.
                        </p>
                      </div>
                    ) : (
                      sortedStudents.map((student) => {
                        const tierInfo = getTierInfoByScore(
                          student.creditScore,
                          tierCriteria,
                        );
                        const isSelected = selectedUids.includes(student.uid);

                        return (
                          <section
                            key={student.uid}
                            className={`rounded-2xl border p-4 transition-colors ${
                              isSelected
                                ? "border-indigo-300 bg-indigo-50/60"
                                : "border-slate-200 bg-white"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              {canManageCredit && mobileSelectionMode ? (
                                <label className="flex min-h-11 min-w-11 items-center justify-center">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() =>
                                      applySelectionMode(
                                        student.uid,
                                        isSelected ? "deselect" : "select",
                                      )
                                    }
                                    className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    aria-label={`${student.name} 선택`}
                                  />
                                </label>
                              ) : null}

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">
                                    {student.studentNumber || "-"}
                                  </span>
                                  <p className="truncate font-bold text-slate-800">
                                    {student.name}
                                  </p>
                                </div>
                                <div className="mt-3 flex items-end justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-medium text-slate-400">
                                      신용 점수
                                    </p>
                                    <p className="text-2xl font-black text-indigo-600">
                                      {formatCreditScore(student.creditScore)}
                                    </p>
                                  </div>
                                  {tierCriteria.length > 0 ? (
                                    <span
                                      className="rounded-full border px-3 py-1 text-xs font-bold"
                                      style={{
                                        backgroundColor: `${tierInfo.color}10`,
                                        color: tierInfo.color,
                                        borderColor: `${tierInfo.color}30`,
                                      }}
                                    >
                                      {tierInfo.name}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => setLogTarget(student)}
                              className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                            >
                              <ListChecks size={18} />
                              신용 기록 보기
                            </button>
                          </section>
                        );
                      })
                    )}
                  </div>

                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
                        <tr>
                          <th
                            data-tour="credit-select-column"
                            className="w-12 p-4 text-center"
                          >
                            <input
                              type="checkbox"
                              ref={selectAllCheckboxRef}
                              onChange={handleSelectAll}
                              disabled={!canManageCredit}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </th>
                          <th
                            className="cursor-pointer p-4"
                            aria-sort={getAriaSort("studentNumber")}
                            onClick={() => requestSort("studentNumber")}
                          >
                            번호 <SortIcon sortKey="studentNumber" />
                          </th>
                          <th
                            className="cursor-pointer p-4"
                            aria-sort={getAriaSort("name")}
                            onClick={() => requestSort("name")}
                          >
                            이름 <SortIcon sortKey="name" />
                          </th>
                          <th
                            className="cursor-pointer p-4 text-right"
                            aria-sort={getAriaSort("creditScore")}
                            onClick={() => requestSort("creditScore")}
                          >
                            신용 점수 <SortIcon sortKey="creditScore" />
                          </th>
                          <th
                            className={`p-4 text-center ${
                              tierCriteria.length > 0
                                ? "cursor-pointer"
                                : "cursor-not-allowed text-slate-300"
                            }`}
                            aria-sort={getAriaSort("tier")}
                            onClick={() => {
                              if (tierCriteria.length === 0) return;
                              requestSort("tier");
                            }}
                          >
                            등급 <SortIcon sortKey="tier" />
                          </th>
                          <th className="p-4 text-center">로그</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {sortedStudents.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-16 text-center">
                              <div className="mx-auto flex max-w-sm flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-8">
                                <p className="text-sm font-semibold text-slate-600">
                                  표시할 학생이 없습니다.
                                </p>
                                <p className="text-xs text-slate-400">
                                  학생 목록이 준비되면 여기에서 바로 확인할 수 있습니다.
                                </p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          sortedStudents.map((student) => {
                            const tierInfo = getTierInfoByScore(
                              student.creditScore,
                              tierCriteria,
                            );
                            const isSelected = selectedUids.includes(student.uid);

                            return (
                              <tr
                                key={student.uid}
                                onMouseDown={(event) => {
                                  if (!canManageCredit) return;
                                  if (isRowSelectionExcludedTarget(event.target)) return;
                                  event.preventDefault();
                                  handleSelectionStart(student.uid, isSelected);
                                }}
                                onMouseEnter={() => handleSelectionDrag(student.uid)}
                                className={`transition-colors ${
                                  canManageCredit ? "cursor-pointer" : ""
                                } ${
                                  isSelected ? "bg-indigo-50/50" : "hover:bg-slate-50"
                                }`}
                              >
                                <td className="select-none p-4 text-center">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    readOnly
                                    disabled={!canManageCredit}
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                </td>
                                <td className="p-4 font-medium text-slate-500">
                                  {student.studentNumber || "-"}
                                </td>
                                <td className="p-4 font-bold text-slate-800">
                                  {student.name}
                                </td>
                                <td className="p-4 text-right text-lg font-black text-indigo-600">
                                  {formatCreditScore(student.creditScore)}
                                </td>
                                <td className="p-4 text-center">
                                  {tierCriteria.length > 0 ? (
                                    <span
                                      className="rounded-full border px-3 py-1 text-xs font-bold shadow-sm"
                                      style={{
                                        backgroundColor: `${tierInfo.color}10`,
                                        color: tierInfo.color,
                                        borderColor: `${tierInfo.color}30`,
                                      }}
                                    >
                                      {tierInfo.name}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-slate-300">-</span>
                                  )}
                                </td>
                                <td className="p-4 text-center">
                                  <button
                                    type="button"
                                    onClick={() => setLogTarget(student)}
                                    aria-label={`${student.name || "학생"} 신용 기록 보기`}
                                    data-no-row-select="true"
                                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white hover:text-indigo-600"
                                  >
                                    <ListChecks size={18} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {canManageCredit && selectedUids.length > 0 ? (
                  <BulkActionFloatingBar
                    count={selectedUids.length}
                    tone="indigo"
                    icon={TrendingUp}
                    eyebrow="신용 점수 수정"
                    title="선택한 학생의 점수를 한 번에 수정합니다"
                    subtitle="증감 방식 또는 직접 입력 방식 중 원하는 방법으로 빠르게 조정해 보세요."
                    actions={[
                      {
                        key: "increment",
                        label: "점수 증감",
                        onClick: () => openMultiEdit("increment"),
                        icon: TrendingUp,
                        tone: "indigo",
                      },
                      {
                        key: "absolute",
                        label: "점수 직접 입력",
                        onClick: () => openMultiEdit("absolute"),
                        icon: Edit3,
                        tone: "blue",
                      },
                    ]}
                    onClear={() => setSelectedUids([])}
                  />
                ) : null}
              </>
            ) : null}
          </div>

          {modalVisible ? (
            <CreditScoreModal
              targets={editTargets}
              onClose={handleScoreModalClose}
              initialMode={editMode}
            />
          ) : null}

          {logTarget ? (
            <CreditHistoryModal
              student={{ ...logTarget, classId }}
              onClose={() => setLogTarget(null)}
            />
          ) : null}

          {showTierModal ? (
            <TierSettingsModal
              criteria={tierCriteria}
              maxScore={creditScoreMax}
              onSave={handleSaveTierCriteria}
              onClose={() => setShowTierModal(false)}
            />
          ) : null}

          {showTierTable ? (
            <CreditTierModal
              isOpen={showTierTable}
              onClose={() => setShowTierTable(false)}
              criteria={tierCriteria}
              students={students}
              isAdmin={canManageCredit}
            />
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
}
