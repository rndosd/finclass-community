import { appConfirm } from "../../../utils/appDialogs";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calendar as CalendarIcon,
  CheckSquare,
  ChevronDown,
  Filter,
  Gamepad2,
  HandHeart,
  Landmark,
  PiggyBank,
  Search,
  Send,
  ShieldAlert,
  ShoppingBag,
  Square,
  Star,
  Trash,
  WalletCards,
  X,
} from "lucide-react";
import { getDocs } from "firebase/firestore";

import {
  BulkActionFloatingBar,
  Button,
  IconButton,
  Modal,
  Spinner,
} from "../../../components/ui";
import {
  ACTIVITY_CATEGORY_GROUPS,
  ACTIVITY_CATEGORY_OPTIONS,
} from "../../../constants/financeExportConfig";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import useDragSelection from "../../../hooks/useDragSelection";
import { bulkDeleteStudentLogs } from "../../../services/studentLogDeleteService";
import {
  ACTIVITY_LOG_SCOPE,
  buildActivityLogQuery,
  calculateActivityStatistics,
  convertFirestoreDocToActivity,
  getActivityDisplayInfo,
  getDefaultDateRange,
} from "../../../utils/activityUtils";
import { getActivityPresentation } from "../../../utils/activityPresentation";

dayjs.locale("ko");

const PAGE_SIZE = 10;
const STUDENT_ACTIVITY_CATEGORY_OPTIONS = [
  { key: "all", label: "전체" },
  ...ACTIVITY_CATEGORY_OPTIONS,
];

const resolveStudentCategoryFilter = (categoryKey) => {
  if (!categoryKey || categoryKey === "all") return "all";
  return ACTIVITY_CATEGORY_GROUPS[categoryKey] || categoryKey;
};

const isRowSelectionExcludedTarget = (target) => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("button,a,input,textarea,select,[data-no-row-select='true']"),
  );
};

const TransactionIcon = ({ type, category, tone }) => {
  let Icon = type === "income" ? ArrowDownLeft : ArrowUpRight;

  if (
    category === "salary" ||
    category === "salary_deduction" ||
    category?.includes("incentive")
  ) {
    Icon = WalletCards;
  } else if (category?.includes("transfer")) Icon = Send;
  else if (category?.includes("store")) Icon = ShoppingBag;
  else if (category?.includes("donation")) Icon = HandHeart;
  else if (category?.includes("mission")) Icon = Star;
  else if (category?.includes("arcade")) Icon = Gamepad2;
  else if (category?.includes("deposit")) Icon = PiggyBank;
  else if (category?.includes("fine")) Icon = ShieldAlert;
  else if (category?.includes("tax") || category?.includes("loan")) {
    Icon = Landmark;
  }

  const toneClasses = {
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    slate: "bg-slate-50 text-slate-500",
  };

  return (
    <div
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
        toneClasses[tone] || toneClasses.slate
      }`}
    >
      <Icon size={20} strokeWidth={2.5} />
    </div>
  );
};

const ActivityLogModal = ({
  isOpen,
  onClose,
  studentUid,
  studentName = "학생",
  previewHistory = null,
  previewCurrencyUnit = null,
}) => {
  const { classId, classData, isTeacher, isAdmin, missionTokenLabel } = useUser();
  const { formatClassCurrency, formatFin, formatPercent } = useNumberFormat();
  const { showFeedback } = useFeedback();

  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [selectedActivityIds, setSelectedActivityIds] = useState(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const startInputRef = useRef(null);
  const endInputRef = useRef(null);

  const currencyUnit = previewCurrencyUnit || classData?.currencyUnit || "원";
  const canDelete = isTeacher || isAdmin;

  const renderStockSellPerformance = useCallback(
    (item) => {
      if (item?.category !== "stock_sell") return null;

      const realizedGainUSD = Number(item?.realizedGainUSD);
      const realizedReturnRate = Number(item?.realizedReturnRate);
      const hasGain = Number.isFinite(realizedGainUSD);
      const hasReturnRate = Number.isFinite(realizedReturnRate);

      if (!hasGain && !hasReturnRate) return null;

      const gainValue = hasGain ? realizedGainUSD : 0;
      const toneClass =
        gainValue > 0
          ? "text-emerald-500"
          : gainValue < 0
            ? "text-rose-500"
            : "text-slate-400";
      const gainText = hasGain
        ? `${gainValue >= 0 ? "+" : "-"}${formatFin(Math.abs(gainValue), {
            trimTrailingZeros: true,
          })} FIN`
        : null;
      const returnRateText = hasReturnRate
        ? `${realizedReturnRate >= 0 ? "+" : "-"}${formatPercent(
            Math.abs(realizedReturnRate),
            {
              fractionDigits: 2,
              trimTrailingZeros: true,
            },
          )}%`
        : null;

      return (
        <div
          className={`mt-1 flex items-center gap-1.5 text-[10px] font-bold ${toneClass}`}
        >
          {gainText ? <span>실현손익 {gainText}</span> : null}
          {gainText && returnRateText ? (
            <span className="h-0.5 w-0.5 rounded-full bg-slate-300" />
          ) : null}
          {returnRateText ? <span>수익률 {returnRateText}</span> : null}
        </div>
      );
    },
    [formatFin, formatPercent],
  );

  const loadData = useCallback(
    async ({ isMore = false, cursor = null } = {}) => {
      if (Array.isArray(previewHistory)) {
        setHistory(previewHistory);
        setLastDoc(null);
        setHasMore(false);
        setIsLoading(false);
        return;
      }

      if (!classId || !studentUid || !dateRange.start || !dateRange.end) return;

      setIsLoading(true);

      try {
        const activityQuery = buildActivityLogQuery({
          db,
          classId,
          studentUid,
          startDate: dateRange.start,
          endDate: dateRange.end,
          categoryFilter: resolveStudentCategoryFilter(selectedCategoryKey),
          pageSize: PAGE_SIZE,
          lastVisible: isMore ? cursor : null,
          logScope: ACTIVITY_LOG_SCOPE.GENERAL,
          currencyUnit,
        });

        const snapshot = await getDocs(activityQuery);
        const nextLogs = snapshot.docs.map(convertFirestoreDocToActivity);

        setHistory((prev) => (isMore ? [...prev, ...nextLogs] : nextLogs));
        setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
        setHasMore(snapshot.docs.length === PAGE_SIZE);
      } catch (error) {
        console.error("[ActivityLogModal] fetch failed:", error);
        showFeedback("활동로그를 불러오지 못했습니다.", "error");
      } finally {
        setIsLoading(false);
      }
    },
    [
      classId,
      dateRange.end,
      dateRange.start,
      currencyUnit,
      previewHistory,
      selectedCategoryKey,
      showFeedback,
      studentUid,
    ],
  );

  useEffect(() => {
    if (!isOpen) return;

    const range = getDefaultDateRange(30);
    setDateRange({ start: range.startDate, end: range.endDate });
    setHistory([]);
    setLastDoc(null);
    setHasMore(true);
    setSelectedCategoryKey("all");
    setShowFilters(false);
    setSelectedActivityIds(new Set());
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && dateRange.start) {
      setHistory([]);
      setLastDoc(null);
      setHasMore(true);
      setSelectedActivityIds(new Set());
      void loadData();
    }
  }, [dateRange.end, dateRange.start, isOpen, loadData]);

  const stats = useMemo(
    () => calculateActivityStatistics(history),
    [history],
  );

  const groupedHistory = useMemo(() => {
    const groups = [];
    const groupMap = new Map();
    const today = dayjs().startOf("day");

    history.forEach((item) => {
      const timestamp = dayjs(item.timestamp);
      const dateKey = timestamp.format("YYYY-MM-DD");

      if (!groupMap.has(dateKey)) {
        const dayDiff = today.diff(timestamp.startOf("day"), "day");
        const group = {
          key: dateKey,
          label: timestamp.format("M월 D일"),
          badge:
            dayDiff === 0 ? "오늘" : dayDiff === 1 ? "어제" : timestamp.format("dddd"),
          items: [],
        };
        groupMap.set(dateKey, group);
        groups.push(group);
      }

      groupMap.get(dateKey).items.push(item);
    });

    return groups;
  }, [history]);

  useEffect(() => {
    const visibleIds = new Set(history.map((item) => item.id));
    setSelectedActivityIds((prev) => {
      const next = new Set(
        Array.from(prev).filter((activityId) => visibleIds.has(activityId)),
      );

      if (next.size === prev.size) return prev;
      return next;
    });
  }, [history]);

  const toggleActivitySelection = useCallback(
    (activityId, forceMode = null) => {
      if (!canDelete || !activityId || isBulkDeleting) return;

      setSelectedActivityIds((prev) => {
        const next = new Set(prev);
        const isSelected = next.has(activityId);
        const shouldSelect =
          forceMode === "select"
            ? true
            : forceMode === "deselect"
              ? false
              : !isSelected;

        if (shouldSelect) next.add(activityId);
        else next.delete(activityId);

        return next;
      });
    },
    [canDelete, isBulkDeleting],
  );

  const { startDrag, enterDrag } = useDragSelection({
    isSelected: (activityId) => selectedActivityIds.has(activityId),
    onSelect: (activityId) => toggleActivitySelection(activityId, "select"),
    onDeselect: (activityId) => toggleActivitySelection(activityId, "deselect"),
    isItemEnabled: () => canDelete && !isBulkDeleting,
  });

  const handleRowMouseDown = (event, activityId) => {
    if (!canDelete || event.button !== 0) return;
    if (isRowSelectionExcludedTarget(event.target)) return;

    event.preventDefault();
    startDrag(activityId, { selected: selectedActivityIds.has(activityId) });
  };

  const handleRowMouseEnter = (activityId) => {
    if (!canDelete) return;
    enterDrag(activityId);
  };

  const handleBulkDelete = async () => {
    if (selectedActivityIds.size === 0) return;

    if (
      !(await appConfirm(`선택한 활동로그 ${selectedActivityIds.size}건을 삭제할까요?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"})) ||
      !(await appConfirm("삭제한 활동로그는 복구할 수 없습니다. 계속할까요?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))
    ) {
      return;
    }

    setIsBulkDeleting(true);

    try {
      const result = await bulkDeleteStudentLogs({
        classId,
        studentUid,
        activityLogIds: Array.from(selectedActivityIds),
      });

      if (!result.success) {
        throw new Error(result.message || "활동로그 삭제에 실패했습니다.");
      }

      setSelectedActivityIds(new Set());
      await loadData();
      showFeedback(result.message || "선택한 활동로그를 삭제했습니다.", "success");
    } catch (error) {
      showFeedback(
        error.message || "활동로그 삭제 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const renderBulkActionBar = ({ mobile = false } = {}) => (
    <BulkActionFloatingBar
      count={selectedActivityIds.size}
      tone="rose"
      icon={Trash}
      eyebrow="선택한 활동로그"
      title="선택한 활동 로그를 삭제합니다"
      subtitle="드래그하거나 눌러서 여러 건을 선택한 뒤 한 번에 정리할 수 있습니다."
      actions={[
        {
          key: "delete",
          label: "삭제",
          onClick: handleBulkDelete,
          icon: Trash,
          tone: "rose",
          disabled: isBulkDeleting,
          isLoading: isBulkDeleting,
        },
      ]}
      onClear={() => setSelectedActivityIds(new Set())}
      clearLabel="선택 해제"
      placement={mobile ? "sticky" : "fixed"}
      compact={mobile}
    />
  );

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={`${studentName} 활동로그`}
    >
      <div
        data-testid="activity-log-modal"
        className="flex h-[70vh] flex-col overflow-hidden bg-white"
      >
        {!showFilters ? (
          <div className="shrink-0 border-b border-slate-50 bg-white px-5 py-3">
            <div className="flex justify-end">
              <IconButton
                icon={Filter}
                label="활동 로그 필터 열기"
                onClick={() => setShowFilters(true)}
                tone="slate"
                size="md"
                className="rounded-xl bg-slate-50 p-2 text-slate-400 transition-all hover:bg-slate-100"
              />
            </div>
          </div>
        ) : null}

        {showFilters ? (
          <div className="shrink-0 border-b border-slate-50 bg-white px-5 py-4 animate-in slide-in-from-top-1">
            <div className="grid grid-cols-[minmax(0,1fr)_42px] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(9rem,0.8fr)_42px]">
              <div
                onClick={() => startInputRef.current?.showPicker()}
                className="relative col-span-2 flex min-h-[42px] cursor-pointer items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 hover:bg-slate-100 sm:col-span-1"
              >
                <CalendarIcon size={14} className="text-indigo-500" />
                <span className="text-xs font-bold text-slate-600">
                  {dateRange.start}
                </span>
                <input
                  ref={startInputRef}
                  type="date"
                  className="pointer-events-none absolute opacity-0"
                  value={dateRange.start}
                  onChange={(event) =>
                    setDateRange((prev) => ({
                      ...prev,
                      start: event.target.value,
                    }))
                  }
                />
              </div>

              <div
                onClick={() => endInputRef.current?.showPicker()}
                className="relative col-span-2 flex min-h-[42px] cursor-pointer items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 hover:bg-slate-100 sm:col-span-1"
              >
                <CalendarIcon size={14} className="text-indigo-500" />
                <span className="text-xs font-bold text-slate-600">
                  {dateRange.end}
                </span>
                <input
                  ref={endInputRef}
                  type="date"
                  className="pointer-events-none absolute opacity-0"
                  value={dateRange.end}
                  onChange={(event) =>
                    setDateRange((prev) => ({
                      ...prev,
                      end: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="relative">
                <Filter
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500"
                />
                <select
                  aria-label="활동 로그 카테고리"
                  value={selectedCategoryKey}
                  onChange={(event) => setSelectedCategoryKey(event.target.value)}
                  className="min-h-[42px] w-full appearance-none rounded-xl border border-slate-100 bg-slate-50 py-2.5 pl-9 pr-9 text-xs font-bold text-slate-600 outline-none transition hover:bg-slate-100 focus:border-indigo-200 focus:bg-blue-50/50 focus:ring-2 focus:ring-blue-500/20"
                >
                  {STUDENT_ACTIVITY_CATEGORY_OPTIONS.map((category) => (
                    <option key={category.key} value={category.key}>
                      {category.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
              </div>
              <IconButton
                icon={X}
                label="활동 로그 필터 닫기"
                onClick={() => setShowFilters(false)}
                tone="slate"
                size="lg"
                className="flex min-h-[42px] items-center justify-center rounded-xl bg-slate-800 text-white transition hover:bg-slate-700"
              />
            </div>

            <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
              <div className="px-3 py-2.5">
                <p className="mb-0.5 text-[9px] font-bold text-slate-400">
                  순변동
                </p>
                <p
                  className={`truncate text-sm font-black ${
                    stats.netAmount >= 0 ? "text-slate-800" : "text-rose-600"
                  }`}
                >
                  {stats.netAmount >= 0 ? "+" : ""}
                  {formatClassCurrency(stats.netAmount)}
                  <span className="ml-1 text-[10px] font-bold text-slate-400">
                    {currencyUnit}
                  </span>
                </p>
              </div>

              <div className="border-l border-slate-100 px-3 py-2.5">
                <p className="mb-0.5 text-[9px] font-bold text-emerald-500">
                  수입
                </p>
                <p className="truncate text-sm font-black text-emerald-600">
                  +{formatClassCurrency(stats.totalIncome)}
                </p>
              </div>

              <div className="border-l border-slate-100 px-3 py-2.5">
                <p className="mb-0.5 text-[9px] font-bold text-rose-400">
                  지출
                </p>
                <p className="truncate text-sm font-black text-rose-600">
                  -{formatClassCurrency(stats.totalExpense)}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="custom-scrollbar flex-1 overflow-y-auto bg-white px-5">
          {isLoading && history.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : groupedHistory.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-20 text-slate-300">
              <Search size={48} strokeWidth={1} className="mb-4 opacity-20" />
              <p className="text-sm font-bold">활동 로그가 없습니다.</p>
            </div>
          ) : (
            <div className="pb-10 select-none">
              {groupedHistory.map((group) => (
                <div key={group.key} className="mt-6 first:mt-3">
                  <div className="sticky top-0 z-10 flex items-center gap-2 bg-white/95 py-2.5 backdrop-blur-sm">
                    <h3 className="text-base font-black tracking-tight text-slate-900">
                      {group.label}
                    </h3>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
                      {group.badge}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100 border-b border-slate-100">
                    {group.items.map((item) => {
                      const info = getActivityDisplayInfo(
                        item,
                        currencyUnit,
                        formatClassCurrency,
                        missionTokenLabel,
                      );
                      const presentation = getActivityPresentation(item, {
                        currencyUnit,
                      });
                      const isSelected = selectedActivityIds.has(item.id);

                      return (
                        <div
                          key={item.id}
                          onMouseDown={(event) =>
                            handleRowMouseDown(event, item.id)
                          }
                          onMouseEnter={() => handleRowMouseEnter(item.id)}
                          className={`group flex flex-col items-stretch gap-2 px-1 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-3 ${
                            isSelected
                              ? "bg-rose-50/70"
                              : canDelete
                                ? "cursor-pointer hover:bg-slate-50/60"
                                : ""
                          }`}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3.5">
                            {canDelete ? (
                              <div className="shrink-0 text-slate-300">
                                {isSelected ? (
                                  <CheckSquare className="h-5 w-5 text-rose-600" />
                                ) : (
                                  <Square className="h-5 w-5" />
                                )}
                              </div>
                            ) : null}

                            <TransactionIcon
                              type={info.icon}
                              category={item.category}
                              tone={info.tone}
                            />

                            <div className="min-w-0 flex-1">
                              <span className="block break-words text-[15px] font-extrabold leading-5 text-slate-900 sm:truncate">
                                {presentation.title}
                              </span>
                              {renderStockSellPerformance(item)}
                              {presentation.subtitle ? (
                                <span className="mt-1 block break-words text-xs font-medium leading-5 text-slate-400 sm:truncate">
                                  {presentation.subtitle}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="shrink-0 pl-[4.75rem] text-left sm:w-36 sm:pl-0 sm:text-right">
                            <span
                              className={`text-[15px] font-black tracking-tight ${info.color}`}
                            >
                              {info.amountText}
                            </span>
                            <span className="mt-1 block text-[11px] font-medium text-slate-400">
                              {dayjs(item.timestamp).format("HH:mm")}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {hasMore ? (
                <div className="mt-6">
                  <Button size="xs"
                    onClick={() =>
                      void loadData({ isMore: true, cursor: lastDoc })
                    }
                    isLoading={isLoading}
                    kind="soft"
                    tone="slate"
                    fullWidth
                    icon={ChevronDown}
                    
                  >
                    기록 더 보기
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {canDelete ? (
          <>
            <div className="sm:hidden">{renderBulkActionBar({ mobile: true })}</div>
            <div className="hidden sm:block">{renderBulkActionBar()}</div>
          </>
        ) : null}

        <div className="shrink-0 border-t border-slate-50 bg-white p-4">
          <Button
            onClick={onClose}
            size="lg"
            kind="solid"
            tone="slate"
            fullWidth
            
          >
            닫기
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ActivityLogModal;
