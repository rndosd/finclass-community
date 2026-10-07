import { appConfirm } from "../../../utils/appDialogs";
import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import {
  BarChart3,
  ChevronDown,
  Coins,
  CreditCard,
  DollarSign,
  Filter,
  Gift,
  Play,
  RotateCcw,
  SlidersHorizontal,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import {
  BulkActionFloatingBar,
  Button,
  Checkbox,
  Spinner,
  Tabs,
} from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import {
  isPoliceFineRecord,
  isPoliceIgnoredReportRecord,
  isPoliceRewardRecord,
} from "../utils/historyRecordType";
import useDragSelection from "../../../hooks/useDragSelection";
import { usePoliceMutations } from "../hooks/usePoliceMutations";
import FineRecordTable from "./components/FineRecordTable";
import PoliceFilter from "./components/PoliceFilter";
import PoliceReasonModal from "./components/PoliceReasonModal";
import { usePoliceFilterStore } from "./hooks/usePoliceFilterStore";

const STATUS_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "active", label: "진행 중" },
  { value: "ignored", label: "반려" },
  { value: "cancelled", label: "취소됨" },
];

const normalizeSearchText = (value) =>
  String(value || "").trim().toLowerCase();

const getRecordSearchText = (record = {}) =>
  [
    record.studentName,
    record.accusedStudentName,
    record.reporterName,
    record.resolverName,
    record.actorName,
    record.ruleText,
    record.reason,
    record.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const FineHistoryTab = ({
  classId,
  fineHistoryHook,
  currencyUnit = "원",
  fineFilters,
  setFineFilters,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onTypeFilterChange,
  reflectionEnabled = true,
  policeSettings = {},
  isPoliceAdmin = false,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { isTeacher, missionTokenLabel } = useUser();
  const {
    updateSettings,
    isUpdatingSettings,
    updateReason,
    isUpdatingReason,
    updateSensitivity,
    isUpdatingSensitivity,
  } = usePoliceMutations(classId);

  const {
    records = [],
    selectedIds,
    setSelectedIds,
    handleCancelFine,
    handleBulkCancel,
    handleBulkHardDelete,
    processingId,
    openReflectionSubmitModal,
    openReflectionReviewModal,
    canHardDelete,
    canSelectRecords,
  } = fineHistoryHook || {};

  const [showFilters, setShowFilters] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const [typeFilter, setTypeFilter] = useState("fine");
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const displayOptionsRef = useRef(null);

  const [persistedFilters, setPersistedFilters] = usePoliceFilterStore(
    "fineHistoryTab",
    {
      studentName: "",
      dateStart: dayjs().subtract(1, "month").format("YYYY-MM-DD"),
      dateEnd: dayjs().format("YYYY-MM-DD"),
      status: "active",
    },
  );

  const [tempFilters, setTempFilters] = useState(persistedFilters);
  const configuredMissionTokenColumn =
    policeSettings?.fineHistoryDisplay?.showMissionTokenColumn === true;
  const [missionTokenColumnVisible, setMissionTokenColumnVisible] = useState(
    configuredMissionTokenColumn,
  );

  useEffect(() => {
    if (JSON.stringify(persistedFilters) !== JSON.stringify(fineFilters)) {
      setFineFilters(persistedFilters);
    }
  }, [fineFilters, persistedFilters, setFineFilters]);

  useEffect(() => {
    setMissionTokenColumnVisible(configuredMissionTokenColumn);
  }, [configuredMissionTokenColumn]);

  useEffect(() => {
    if (!showDisplayOptions) return undefined;

    const handlePointerDown = (event) => {
      if (displayOptionsRef.current?.contains(event.target)) return;
      setShowDisplayOptions(false);
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setShowDisplayOptions(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showDisplayOptions]);

  const toggleSelection = useCallback(
    (id, mode) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (mode === "select") next.add(id);
        else next.delete(id);
        return Array.from(next);
      });
    },
    [setSelectedIds],
  );

  const { startDrag, enterDrag } = useDragSelection({
    isSelected: (id) => selectedIds.includes(id),
    onSelect: (id) => toggleSelection(id, "select"),
    onDeselect: (id) => toggleSelection(id, "deselect"),
    isItemEnabled: (id) =>
      canSelectRecords &&
      records.some(
        (record) => record.id === id && record.visibilityLevel !== "summary",
      ),
  });

  const handleMouseDown = (id, isSelected) => {
    if (!canSelectRecords) return;
    startDrag(id, { selected: isSelected });
  };

  const handleMouseEnter = (id) => {
    if (!canSelectRecords) return;
    enterDrag(id);
  };

  const handleApplyFilters = (event) => {
    event?.preventDefault();
    setPersistedFilters(tempFilters);
    setFineFilters(tempFilters);
    setSelectedIds([]);
  };

  const handleTypeChange = (nextType) => {
    setTypeFilter(nextType);
    setSelectedIds([]);
    onTypeFilterChange?.(nextType);
  };

  const handleMissionTokenColumnToggle = useCallback(
    async (checked) => {
      setMissionTokenColumnVisible(checked);
      try {
        await updateSettings({
          settings: {
            fineHistoryDisplay: {
              showMissionTokenColumn: checked,
            },
          },
        });
      } catch {
        setMissionTokenColumnVisible(configuredMissionTokenColumn);
      }
    },
    [configuredMissionTokenColumn, updateSettings],
  );

  const handleReasonSave = useCallback(
    async (nextReason) => {
      if (!selectedRecordId) return;

      await updateReason({
        targetType: "history",
        recordId: selectedRecordId,
        reason: nextReason,
      });
    },
    [selectedRecordId, updateReason],
  );

  const displayRecords = useMemo(
    () =>
      records.filter((record) => {
        const isCancelled =
          record.isCancelled || record.status === "cancelled";
        const isIgnoredReport = isPoliceIgnoredReportRecord(record);
        const statusFilter = fineFilters?.status || "all";
        const searchTerm = normalizeSearchText(fineFilters?.studentName);

        if (searchTerm && !getRecordSearchText(record).includes(searchTerm)) {
          return false;
        }

        if (statusFilter === "active" && (isCancelled || isIgnoredReport)) {
          return false;
        }
        if (statusFilter === "cancelled" && !isCancelled) return false;
        if (statusFilter === "ignored" && !isIgnoredReport) return false;
        if (statusFilter !== "ignored" && statusFilter !== "all" && isIgnoredReport) {
          return false;
        }

        if (typeFilter === "fine") {
          return isPoliceFineRecord(record) || isIgnoredReport;
        }

        if (typeFilter === "reward") {
          return isPoliceRewardRecord(record);
        }

        return true;
      }),
    [fineFilters?.status, fineFilters?.studentName, records, typeFilter],
  );

  const selectedRecords = useMemo(
    () => displayRecords.filter((record) => selectedIds.includes(record.id)),
    [displayRecords, selectedIds],
  );

  const selectableRecordIds = useMemo(
    () =>
      displayRecords
        .filter((record) => record.visibilityLevel !== "summary")
        .map((record) => record.id),
    [displayRecords],
  );

  useEffect(() => {
    setSelectedIds((prev) =>
      prev.filter((id) => selectableRecordIds.includes(id)),
    );
  }, [selectableRecordIds, setSelectedIds]);

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) || null,
    [records, selectedRecordId],
  );

  const cancelableSelectedRecords = useMemo(
    () =>
      selectedRecords.filter(
        (record) =>
          !(record.isCancelled || record.status === "cancelled") &&
          !isPoliceIgnoredReportRecord(record),
      ),
    [selectedRecords],
  );

  const nonSensitiveSelectedRecords = useMemo(
    () => selectedRecords.filter((record) => record.isSensitive !== true),
    [selectedRecords],
  );

  const sensitiveSelectedRecords = useMemo(
    () => selectedRecords.filter((record) => record.isSensitive === true),
    [selectedRecords],
  );

  const stats = useMemo(
    () =>
      records.reduce(
        (acc, record) => {
          if (record.isCancelled || record.status === "cancelled") return acc;
          if (isPoliceIgnoredReportRecord(record)) return acc;

          const amount = Math.abs(record.amountSigned ?? 0);
          const isFine = isPoliceFineRecord(record);

          if (isFine) acc.fine += amount;
          else acc.reward += amount;

          return acc;
        },
        { fine: 0, reward: 0 },
      ),
    [records],
  );

  const isChanged = JSON.stringify(tempFilters) !== JSON.stringify(fineFilters);

  const handleBulkSensitivityUpdate = useCallback(
    async (targets, nextSensitive) => {
      if (!isTeacher || !targets.length) return;

      const count = targets.length;
      const actionLabel = nextSensitive ? "민감 지정" : "민감 해제";
      if (!(await appConfirm(`선택한 ${count}건을 ${actionLabel}하시겠습니까?`))) {
        return;
      }

      await updateSensitivity({
        targetType: "history",
        recordIds: targets.map((record) => record.id),
        isSensitive: nextSensitive,
      });
      setSelectedIds([]);
    },
    [isTeacher, setSelectedIds, updateSensitivity],
  );

  const floatingActions = useMemo(() => {
    const actions = [];

    if (isTeacher && nonSensitiveSelectedRecords.length > 0) {
      actions.push({
        key: "mark-sensitive",
        label: "민감 지정",
        onClick: () =>
          handleBulkSensitivityUpdate(nonSensitiveSelectedRecords, true),
        icon: ShieldAlert,
        tone: "rose",
        kind: "outline",
        disabled: processingId === "bulk-cancelling" || processingId === "bulk-delete" || isUpdatingSensitivity,
        isLoading: isUpdatingSensitivity,
      });
    }

    if (isTeacher && sensitiveSelectedRecords.length > 0) {
      actions.push({
        key: "unmark-sensitive",
        label: "민감 해제",
        onClick: () =>
          handleBulkSensitivityUpdate(sensitiveSelectedRecords, false),
        icon: ShieldAlert,
        tone: "slate",
        kind: "outline",
        disabled: processingId === "bulk-cancelling" || processingId === "bulk-delete" || isUpdatingSensitivity,
        isLoading: isUpdatingSensitivity,
      });
    }

    if (cancelableSelectedRecords.length > 0) {
      actions.push({
        key: "cancel",
        label:
          typeFilter === "fine" ? "선택 벌점 취소" : "선택 보상 취소",
        onClick: () => handleBulkCancel(cancelableSelectedRecords),
        icon: RotateCcw,
        tone: "rose",
        disabled: processingId === "bulk-cancelling" || isUpdatingSensitivity,
        isLoading: processingId === "bulk-cancelling",
      });
    }

    if (canHardDelete) {
      actions.push({
        key: "delete",
        label: "선택 삭제",
        onClick: () => handleBulkHardDelete(selectedRecords),
        icon: Trash2,
        tone: "rose",
        kind: "outline",
        disabled: processingId === "bulk-delete" || isUpdatingSensitivity,
        isLoading: processingId === "bulk-delete",
      });
    }

    return actions;
  }, [
    canHardDelete,
    cancelableSelectedRecords,
    handleBulkCancel,
    handleBulkHardDelete,
    handleBulkSensitivityUpdate,
    isTeacher,
    isUpdatingSensitivity,
    nonSensitiveSelectedRecords,
    processingId,
    selectedRecords,
    sensitiveSelectedRecords,
    typeFilter,
  ]);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 select-none">
      <div className="flex items-center justify-between border-b bg-white p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-rose-50 p-2 text-rose-600">
            <Coins className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">벌점 및 보상 내역</h2>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => setShowFilters((prev) => !prev)}
            icon={Filter}
            iconOnly
            kind="ghost"
            tone="blue"
            size="icon-sm"
            aria-pressed={showFilters}
            className={`rounded-lg border p-2 ${
              showFilters
                ? "border-indigo-200 bg-indigo-50 text-indigo-600"
                : "bg-white text-slate-400"
            }`}
            title="필터"
          />
          <Button
            type="button"
            onClick={() => setShowStats((prev) => !prev)}
            icon={BarChart3}
            iconOnly
            kind="ghost"
            tone="emerald"
            size="icon-sm"
            aria-pressed={showStats}
            className={`rounded-lg border p-2 ${
              showStats
                ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                : "bg-white text-slate-400"
            }`}
            title="통계"
          />
          {isPoliceAdmin ? (
            <div className="relative" ref={displayOptionsRef}>
              <Button
                type="button"
                onClick={() => setShowDisplayOptions((prev) => !prev)}
                icon={SlidersHorizontal}
                kind="ghost"
                tone="slate"
                size="sm"
                aria-pressed={showDisplayOptions || missionTokenColumnVisible}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                  showDisplayOptions || missionTokenColumnVisible
                    ? "border-slate-300 bg-slate-100 text-slate-700"
                    : "bg-white text-slate-500"
                }`}
              >
                <span>표시 항목</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    showDisplayOptions ? "rotate-180" : ""
                  }`}
                />
              </Button>

              {showDisplayOptions ? (
                <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/70">
                  <div className="space-y-1">
                    <div className="text-sm font-black text-slate-800">
                      부과내역 표시 항목
                    </div>
                    <p className="text-xs leading-relaxed text-slate-500">
                      이 설정은 현재 학급의 경찰 부과내역 화면 전체에 적용됩니다.
                    </p>
                  </div>

                  <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                    <Checkbox
                      id="fine-history-show-mission-token-column"
                      checked={missionTokenColumnVisible}
                      onChange={(event) =>
                        handleMissionTokenColumnToggle(event.target.checked)
                      }
                      disabled={isUpdatingSettings}
                      label={missionTokenLabel}
                      labelClassName="font-medium text-slate-700"
                    />
                    <p className="mt-2 pl-6 text-[11px] text-slate-400">
                      체크하면 {missionTokenLabel} 변동 컬럼이 같은 학급 교사 화면에 함께 표시됩니다.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {showStats ? (
        <div className="mt-6 grid grid-cols-1 gap-4 px-6 sm:grid-cols-3">
          <div className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="rounded-xl bg-rose-50 p-2.5 text-rose-600">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400">
                총 벌점
              </p>
              <p className="text-xl font-black text-slate-900">
                {formatDisplayMoney(stats.fine)}{" "}
                <span className="text-xs font-normal text-slate-400">
                  {currencyUnit}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
              <Gift className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400">
                총 보상
              </p>
              <p className="text-xl font-black text-emerald-600">
                +{formatDisplayMoney(stats.reward)}{" "}
                <span className="text-xs font-normal text-emerald-400">
                  {currencyUnit}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-indigo-50/40 p-4 shadow-sm">
            <div className="rounded-xl bg-indigo-600 p-2.5 text-white">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400">
                순합계
              </p>
              <p className="text-xl font-black text-indigo-700">
                {formatDisplayMoney(stats.reward - stats.fine)}{" "}
                <span className="text-xs font-normal text-indigo-400">
                  {currencyUnit}
                </span>
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {showFilters ? (
        <form
          onSubmit={handleApplyFilters}
          className="space-y-4 border-b bg-slate-50 p-5"
        >
          <PoliceFilter
            tempFilters={tempFilters}
            setTempFilters={setTempFilters}
            onEnter={handleApplyFilters}
          />

          <div className="flex items-center justify-between">
            <div className="flex gap-1.5">
              {STATUS_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setTempFilters((prev) => ({
                      ...prev,
                      status: option.value,
                    }))
                  }
                  kind="ghost"
                  tone="blue"
                  size="xs"
                  aria-pressed={tempFilters.status === option.value}
                  className={`rounded-xl border px-4 py-1.5 text-xs font-bold ${
                    tempFilters.status === option.value
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-500"
                  }`}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            <Button
              type="submit"
              disabled={!isChanged && !isLoading}
              icon={Play}
              kind="solid"
              tone="blue"
              size="sm"
              className={`flex items-center gap-2  ${
                isChanged
                  ? ""
                  : ""
              }`}
            >
              적용
            </Button>
          </div>
        </form>
      ) : null}

      <Tabs ariaLabel="경찰 내역 종류" tabs={[{id:"fine",label:"벌점 내역"},{id:"reward",label:"보상 내역"}]} activeTab={typeFilter} onTabChange={handleTypeChange} variant="underline" size="sm" fullWidth className="px-4 sm:px-6" />

      <div className="min-h-[400px] overflow-x-auto">
        {isLoading && records.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-32">
            <Spinner size="lg" />
            <span className="text-xs text-slate-400">
              내역을 불러오는 중입니다.
            </span>
          </div>
        ) : (
          <div className="pb-10">
            <FineRecordTable
              filteredRecords={displayRecords}
              selectedIds={selectedIds}
              onMouseDown={handleMouseDown}
              onMouseEnter={handleMouseEnter}
              allowSelection={canSelectRecords}
              currencyUnit={currencyUnit}
              showReflectionColumn={reflectionEnabled}
              showMissionTokenColumn={missionTokenColumnVisible}
              onReflectionSubmit={openReflectionSubmitModal}
              onReflectionReview={openReflectionReviewModal}
              onCancelFine={handleCancelFine}
              processingId={processingId}
              onReasonClick={(record) => setSelectedRecordId(record?.id || null)}
            />

            {hasNextPage ? (
              <div className="flex justify-center border-t bg-white p-8">
                <Button
                  kind="outline"
                  tone="blue"
                  size="md"
                  className="min-w-[280px]"
                  onClick={onLoadMore}
                  isLoading={isFetchingNextPage}
                  icon={ChevronDown}
                >
                  더 불러오기
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {selectedIds.length > 0 && floatingActions.length > 0 ? (
        <BulkActionFloatingBar
          count={selectedIds.length}
          tone="rose"
          icon={canHardDelete ? Trash2 : RotateCcw}
          eyebrow="선택한 내역"
          title="선택한 내역을 한 번에 처리할 수 있습니다"
          subtitle="드래그로 선택하고 취소 또는 삭제를 바로 실행하세요."
          actions={floatingActions}
          onClear={() => setSelectedIds([])}
        />
      ) : null}

      <PoliceReasonModal
        isOpen={Boolean(selectedRecord)}
        onClose={() => setSelectedRecordId(null)}
        data={selectedRecord}
        canEditReason={isTeacher}
        onSaveReason={handleReasonSave}
        isSavingReason={isUpdatingReason}
      />
    </div>
  );
};

export default React.memo(FineHistoryTab);
