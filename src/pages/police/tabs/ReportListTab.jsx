import { appConfirm } from "../../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  ArrowRight,
  Check,
  EyeOff,
  Filter,
  Gavel,
  Info,
  MessageSquare,
  ShieldAlert,
  Trash2,
  Zap,
} from "lucide-react";

import { useUser } from "../../../contexts/UserContext";
import {
  Badge,
  BulkActionFloatingBar,
  Button,
  DataTable,
  EmptyState,
  Modal,
  Spinner,
  Textarea,
} from "../../../components/ui";
import useDragSelection from "../../../hooks/useDragSelection";
import { usePoliceMutations } from "../hooks/usePoliceMutations";
import { useReportList } from "../hooks/useReportList";
import PoliceFilter from "./components/PoliceFilter";
import PoliceReasonModal from "./components/PoliceReasonModal";
import { usePoliceFilterStore } from "./hooks/usePoliceFilterStore";
import { policeHistoryTableStyles as tableStyles } from "./components/policeHistoryTableStyles";

const STATUS_OPTIONS = [
  { value: "pending", label: "대기 중" },
  { value: "resolved_applied", label: "벌점 반영" },
  { value: "resolved_ignored", label: "반려 처리" },
  { value: "all", label: "전체" },
];

const REPORT_TYPE_FREEFORM = "freeform";
const MAX_REJECT_REASON_LENGTH = 500;

const resolveReportType = (report = {}) =>
  typeof report?.reportType === "string" && report.reportType.trim()
    ? report.reportType.trim()
    : report?.ruleId
      ? "rule"
      : REPORT_TYPE_FREEFORM;

const renderHiddenSummary = () => (
  <span className="inline-flex items-center gap-1 text-xs text-slate-300">
    <EyeOff className="h-3.5 w-3.5" />
    숨김
  </span>
);

const ReportListTab = ({
  classId,
  reports = [],
  isLoading,
  policeRules = [],
  policeSettings,
  onTabChange,
  onOpenCustomFineReport,
}) => {
  const { isTeacher, hasPermission } = useUser();
  const {
    updateReason,
    isUpdatingReason,
    updateSensitivity,
    isUpdatingSensitivity,
  } = usePoliceMutations(classId);
  const canResolve = isTeacher || hasPermission("permission_group_police");

  const [persistedFilters, setPersistedFilters] = usePoliceFilterStore(
    "reportTab",
    {
      studentName: "",
      dateStart: dayjs().subtract(7, "day").format("YYYY-MM-DD"),
      dateEnd: dayjs().format("YYYY-MM-DD"),
      status: "pending",
    },
  );

  const [tempFilters, setTempFilters] = useState(persistedFilters);
  const [appliedFilters, setAppliedFilters] = useState(persistedFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [rejectConfirmState, setRejectConfirmState] = useState(null);
  const [commonRejectReasonDraft, setCommonRejectReasonDraft] = useState("");
  const [rejectReasonByReportId, setRejectReasonByReportId] = useState({});
  const [rejectReasonError, setRejectReasonError] = useState("");

  const { reports: filteredReports, processingId, handleBulkResolve } =
    useReportList({
      classId,
      reports,
      policeRules,
      filters: appliedFilters,
      policeSettings,
      onTabChange,
    });

  const toggleSelection = useCallback((id, mode) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (mode === "select") next.add(id);
      else next.delete(id);
      return Array.from(next);
    });
  }, []);

  const { startDrag, enterDrag } = useDragSelection({
    isSelected: (id) => selectedIds.includes(id),
    onSelect: (id) => toggleSelection(id, "select"),
    onDeselect: (id) => toggleSelection(id, "deselect"),
    isItemEnabled: (id) =>
      canResolve &&
      filteredReports.some(
        (report) => report.id === id && report.visibilityLevel !== "summary",
      ),
  });

  const isRowSelectionExcludedTarget = (target) => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        "button,a,input,select,textarea,[role='button'],[data-no-row-select='true']",
      ),
    );
  };

  const handleMouseDown = (event, id, isSelected) => {
    if (!canResolve) return;
    if (event.button !== 0) return;
    if (isRowSelectionExcludedTarget(event.target)) return;
    event.preventDefault();
    startDrag(id, { selected: isSelected });
  };

  const handleMouseEnter = (id) => {
    if (!canResolve) return;
    enterDrag(id);
  };

  const handleApplyFilters = (event) => {
    event?.preventDefault();
    setPersistedFilters(tempFilters);
    setAppliedFilters(tempFilters);
    setSelectedIds([]);
  };

  const handleBulkAction = useCallback(
    async (applyPenalty) => {
      const targets = filteredReports.filter(
        (report) =>
          selectedIds.includes(report.id) && report.status === "pending",
      );
      if (targets.length === 0) return;

      const didResolve = await handleBulkResolve(targets, applyPenalty);
      if (didResolve) {
        setSelectedIds([]);
      }
    },
    [filteredReports, handleBulkResolve, selectedIds],
  );

  const openRejectConfirmModal = useCallback(
    (actionLabel = "반려 처리") => {
      const targets = filteredReports.filter(
        (report) =>
          selectedIds.includes(report.id) && report.status === "pending",
      );
      if (targets.length === 0) return;

      setCommonRejectReasonDraft("");
      setRejectReasonByReportId(
        targets.reduce((acc, report) => {
          acc[report.id] = "";
          return acc;
        }, {}),
      );
      setRejectReasonError("");
      setRejectConfirmState({ targets, actionLabel });
    },
    [filteredReports, selectedIds],
  );

  const handleCloseRejectConfirmModal = useCallback(() => {
    if (processingId === "bulk-processing") return;
    setRejectConfirmState(null);
    setCommonRejectReasonDraft("");
    setRejectReasonByReportId({});
    setRejectReasonError("");
  }, [processingId]);

  const handleConfirmRejectReports = useCallback(async () => {
    const targets = rejectConfirmState?.targets || [];
    if (targets.length === 0) return;
    const normalizedRejectReasonByReportId = targets.reduce((acc, report) => {
      acc[report.id] = String(rejectReasonByReportId[report.id] || "").trim();
      return acc;
    }, {});
    const missingReason = targets.some(
      (report) => !normalizedRejectReasonByReportId[report.id],
    );
    const overLimitReason = targets.some(
      (report) =>
        normalizedRejectReasonByReportId[report.id].length >
        MAX_REJECT_REASON_LENGTH,
    );

    if (missingReason) {
      setRejectReasonError("모든 신고의 반려 사유를 입력해 주세요.");
      return;
    }

    if (overLimitReason) {
      setRejectReasonError(
        `반려 사유는 ${MAX_REJECT_REASON_LENGTH}자 이하로 입력해 주세요.`,
      );
      return;
    }

    const didResolve = await handleBulkResolve(targets, false, {
      skipConfirm: true,
      rejectReasonByReportId: normalizedRejectReasonByReportId,
    });

    if (didResolve) {
      setRejectConfirmState(null);
      setCommonRejectReasonDraft("");
      setRejectReasonByReportId({});
      setRejectReasonError("");
      setSelectedIds([]);
    }
  }, [handleBulkResolve, rejectConfirmState, rejectReasonByReportId]);

  const handleApplyCommonRejectReason = useCallback(() => {
    const commonReason = commonRejectReasonDraft.trim();
    const targets = rejectConfirmState?.targets || [];

    if (!commonReason) {
      setRejectReasonError("공통 반려 사유를 입력해 주세요.");
      return;
    }

    if (commonReason.length > MAX_REJECT_REASON_LENGTH) {
      setRejectReasonError(
        `반려 사유는 ${MAX_REJECT_REASON_LENGTH}자 이하로 입력해 주세요.`,
      );
      return;
    }

    setRejectReasonByReportId((prev) => {
      const next = { ...prev };
      targets.forEach((report) => {
        next[report.id] = commonReason;
      });
      return next;
    });
    setRejectReasonError("");
  }, [commonRejectReasonDraft, rejectConfirmState]);

  const handleRejectReasonChange = useCallback((reportId, value) => {
    setRejectReasonByReportId((prev) => ({
      ...prev,
      [reportId]: value,
    }));
    setRejectReasonError("");
  }, []);

  const handleRejectReasonPaste = useCallback(
    (event, startIndex) => {
      const targets = rejectConfirmState?.targets || [];
      const pastedText = event.clipboardData?.getData("text") || "";
      const rows = pastedText.split(/\r?\n/).filter((row) => row.trim());

      if (rows.length <= 1) return;

      event.preventDefault();
      setRejectReasonByReportId((prev) => {
        const next = { ...prev };
        rows.forEach((row, rowIndex) => {
          const target = targets[startIndex + rowIndex];
          if (!target) return;
          const reason = row.split("\t").pop()?.trim() || "";
          if (reason) next[target.id] = reason.slice(0, MAX_REJECT_REASON_LENGTH);
        });
        return next;
      });
      setRejectReasonError("");
    },
    [rejectConfirmState],
  );

  const handleReasonSave = useCallback(
    async (nextReason) => {
      if (!selectedReport?.id) return;

      await updateReason({
        targetType: "report",
        recordId: selectedReport.id,
        reason: nextReason,
      });

      setSelectedReport((prev) =>
        prev
          ? {
              ...prev,
              reason: nextReason,
              reportReason: nextReason,
            }
          : prev,
      );
    },
    [selectedReport, updateReason],
  );

  const isChanged =
    JSON.stringify(tempFilters) !== JSON.stringify(appliedFilters);

  const sortedReports = useMemo(
    () =>
      [...filteredReports].sort(
        (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
      ),
    [filteredReports],
  );

  const selectedReports = useMemo(
    () =>
      sortedReports.filter(
        (report) =>
          selectedIds.includes(report.id) &&
          report.visibilityLevel !== "summary",
      ),
    [selectedIds, sortedReports],
  );

  const selectableReportIds = useMemo(
    () =>
      sortedReports
        .filter((report) => report.visibilityLevel !== "summary")
        .map((report) => report.id),
    [sortedReports],
  );

  useEffect(() => {
    setSelectedIds((prev) =>
      prev.filter((id) => selectableReportIds.includes(id)),
    );
  }, [selectableReportIds]);

  const pendingSelectedReports = useMemo(
    () => selectedReports.filter((report) => report.status === "pending"),
    [selectedReports],
  );

  const pendingRuleSelectedReports = useMemo(
    () =>
      pendingSelectedReports.filter(
        (report) => resolveReportType(report) !== REPORT_TYPE_FREEFORM,
      ),
    [pendingSelectedReports],
  );

  const pendingFreeformSelectedReports = useMemo(
    () =>
      pendingSelectedReports.filter(
        (report) => resolveReportType(report) === REPORT_TYPE_FREEFORM,
      ),
    [pendingSelectedReports],
  );

  const customFineTargetReport = useMemo(() => {
    if (selectedReports.length !== 1) return null;
    if (pendingSelectedReports.length !== 1) return null;
    if (pendingFreeformSelectedReports.length !== 1) return null;
    if (pendingRuleSelectedReports.length !== 0) return null;
    return pendingFreeformSelectedReports[0] || null;
  }, [
    pendingFreeformSelectedReports,
    pendingRuleSelectedReports,
    pendingSelectedReports,
    selectedReports.length,
  ]);

  const nonSensitiveSelectedReports = useMemo(
    () => selectedReports.filter((report) => report.isSensitive !== true),
    [selectedReports],
  );

  const sensitiveSelectedReports = useMemo(
    () => selectedReports.filter((report) => report.isSensitive === true),
    [selectedReports],
  );

  const handleBulkSensitivityUpdate = useCallback(
    async (targets, nextSensitive) => {
      if (!isTeacher || !targets.length) return;

      const count = targets.length;
      const actionLabel = nextSensitive ? "민감 지정" : "민감 해제";
      if (!(await appConfirm(`선택한 ${count}건을 ${actionLabel}하시겠습니까?`))) {
        return;
      }

      await updateSensitivity({
        targetType: "report",
        recordIds: targets.map((report) => report.id),
        isSensitive: nextSensitive,
      });
      setSelectedIds([]);
    },
    [isTeacher, updateSensitivity],
  );

  const handleOpenCustomFineReport = useCallback(() => {
    if (!customFineTargetReport || typeof onOpenCustomFineReport !== "function") {
      return;
    }

    onOpenCustomFineReport(customFineTargetReport);
    setSelectedIds([]);
  }, [customFineTargetReport, onOpenCustomFineReport]);

  const floatingActions = useMemo(() => {
    const actions = [];

    if (isTeacher && nonSensitiveSelectedReports.length > 0) {
      actions.push({
        key: "mark-sensitive",
        label: "민감 지정",
        onClick: () =>
          handleBulkSensitivityUpdate(nonSensitiveSelectedReports, true),
        icon: ShieldAlert,
        tone: "rose",
        kind: "outline",
        disabled: processingId === "bulk-processing" || isUpdatingSensitivity,
        isLoading: isUpdatingSensitivity,
      });
    }

    if (isTeacher && sensitiveSelectedReports.length > 0) {
      actions.push({
        key: "unmark-sensitive",
        label: "민감 해제",
        onClick: () =>
          handleBulkSensitivityUpdate(sensitiveSelectedReports, false),
        icon: ShieldAlert,
        tone: "slate",
        kind: "outline",
        disabled: processingId === "bulk-processing" || isUpdatingSensitivity,
        isLoading: isUpdatingSensitivity,
      });
    }

    if (customFineTargetReport) {
      actions.push({
        key: "custom-fine",
        label: "\uc784\uc758\ubd80\uacfc",
        onClick: handleOpenCustomFineReport,
        icon: Zap,
        tone: "rose",
        disabled: processingId === "bulk-processing" || isUpdatingSensitivity,
      });
    }

    if (pendingFreeformSelectedReports.length > 0) {
      actions.push({
        key: "ignore-freeform",
        label: "\uae30\uac01",
        onClick: () => openRejectConfirmModal("기각"),
        icon: Trash2,
        tone: "slate",
        kind: "outline",
        disabled: processingId === "bulk-processing" || isUpdatingSensitivity,
      });
    }

    if (
      pendingRuleSelectedReports.length > 0 &&
      pendingFreeformSelectedReports.length === 0
    ) {
      actions.push({
        key: "apply",
        label: "벌점 반영",
        onClick: () => handleBulkAction(true),
        icon: Gavel,
        tone: "rose",
        disabled: processingId === "bulk-processing" || isUpdatingSensitivity,
      });
      actions.push({
        key: "ignore",
        label: "반려 처리",
        onClick: () => openRejectConfirmModal("반려 처리"),
        icon: Trash2,
        tone: "slate",
        kind: "outline",
        disabled: processingId === "bulk-processing" || isUpdatingSensitivity,
      });
    }

    return actions;
  }, [
    customFineTargetReport,
    handleBulkAction,
    handleOpenCustomFineReport,
    handleBulkSensitivityUpdate,
    isTeacher,
    isUpdatingSensitivity,
    nonSensitiveSelectedReports,
    openRejectConfirmModal,
    pendingFreeformSelectedReports,
    pendingRuleSelectedReports,
    processingId,
    sensitiveSelectedReports,
  ]);

  const rejectConfirmTargets = rejectConfirmState?.targets || [];
  const rejectActionLabel = rejectConfirmState?.actionLabel || "반려 처리";
  const rejectReasonEntries = rejectConfirmTargets.map((report) => ({
    report,
    reason: String(rejectReasonByReportId[report.id] || ""),
  }));
  const hasMissingRejectReason = rejectReasonEntries.some(
    ({ reason }) => !reason.trim(),
  );
  const hasOverLimitRejectReason = rejectReasonEntries.some(
    ({ reason }) => reason.trim().length > MAX_REJECT_REASON_LENGTH,
  );
  const canConfirmReject =
    rejectConfirmTargets.length > 0 &&
    !hasMissingRejectReason &&
    !hasOverLimitRejectReason &&
    processingId !== "bulk-processing";

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 select-none">
      <div className="flex items-center justify-between border-b bg-white p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600">
            <Info className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {canResolve ? "신고 내역 처리" : "신고 내역"}
            </h2>
            <p className="mt-1 text-sm leading-5 text-slate-500">
              {canResolve
                ? "학생 신고를 검토하고 벌점 반영 또는 반려 처리까지 한 번에 진행합니다."
                : "내 신고와 공개된 신고를 확인할 수 있습니다."}
            </p>
          </div>
        </div>

        <Button
          type="button"
          onClick={() => setShowFilters((prev) => !prev)}
          icon={Filter}
          iconOnly
          kind="ghost"
          tone="blue"
          size="icon-sm"
          aria-pressed={showFilters}
          className={`rounded-lg border p-2 transition-all ${
            showFilters
              ? "border-indigo-200 bg-indigo-50 text-indigo-600 shadow-inner"
              : "border-slate-200 bg-white text-slate-400"
          }`}
          title="필터"
        />
      </div>

      {showFilters ? (
        <form
          onSubmit={handleApplyFilters}
          className="space-y-4 border-b bg-slate-50 p-5"
        >
          <div className="flex flex-col items-end gap-6 md:flex-row">
            <div className="w-full flex-1 space-y-2">
              <span className="ml-1 text-[11px] font-black uppercase text-slate-400">
                검색 및 기간
              </span>
              <PoliceFilter
                tempFilters={tempFilters}
                setTempFilters={setTempFilters}
                onEnter={handleApplyFilters}
              />
            </div>

            <div className="flex w-full flex-col gap-4 md:w-auto">
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
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-slate-200 bg-white text-slate-500"
                    }`}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>

              <Button
                type="submit"
                disabled={!isChanged}
                kind="solid"
                tone="blue"
                size="sm"
                className={`transition-all  ${
                  isChanged
                    ? ""
                    : ""
                }`}
              >
                필터 적용
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      <div className="min-h-[400px] overflow-x-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-32">
            <Spinner size="lg" />
            <span className="text-xs font-medium text-slate-400">
              신고 내역을 불러오는 중입니다.
            </span>
          </div>
        ) : sortedReports.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="조건에 맞는 신고가 없습니다"
            description="기간, 학생, 상태 필터를 조정해 다시 확인해 보세요."
            className="py-24"
          />
        ) : (
          <>
          <div className="space-y-3 p-4 md:hidden">
            {sortedReports.map((report) => {
              const isSelected = selectedIds.includes(report.id);
              const isSensitive = report.isSensitive;
              const isSummaryView = report.visibilityLevel === "summary";
              const repeatCount = Math.max(
                1,
                Math.floor(Number(report.repeatCount || 1)),
              );

              return (
                <article
                  key={report.id}
                  className={`rounded-2xl border p-4 ${
                    isSelected
                      ? "border-indigo-300 bg-indigo-50/70"
                      : isSensitive
                        ? "border-rose-200 bg-rose-50/40"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {canResolve && !isSummaryView ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedIds((current) =>
                            current.includes(report.id)
                              ? current.filter((id) => id !== report.id)
                              : [...current, report.id],
                          )
                        }
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                          isSelected
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : "border-slate-300 bg-white text-transparent"
                        }`}
                        aria-label={`${report.studentName || report.accusedStudentName || "신고"} ${isSelected ? "선택 해제" : "선택"}`}
                      >
                        <Check size={16} strokeWidth={4} />
                      </button>
                    ) : null}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-black text-slate-900">
                          {report.studentName ||
                            report.accusedStudentName ||
                            "신고 대상 비공개"}
                        </p>
                        <Badge
                          tone={
                            report.status === "resolved_applied"
                              ? "rose"
                              : report.status === "resolved_ignored"
                                ? "slate"
                                : "amber"
                          }
                          size="xs"
                          variant="soft"
                        >
                          {report.status === "resolved_applied"
                            ? "벌점 반영"
                            : report.status === "resolved_ignored"
                              ? "반려 처리"
                              : "대기 중"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        신고자 {report.reporterName || "비공개"} ·{" "}
                        {dayjs(report.createdAt?.toDate?.()).format("MM.DD HH:mm")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-400">적용 규칙</p>
                    <p className="mt-1 text-sm font-bold leading-5 text-slate-700">
                      {isSummaryView ? "민감 정보 비공개" : report.ruleText || "자유 신고"}
                      {!isSummaryView && repeatCount > 1 ? ` × ${repeatCount}` : ""}
                    </p>
                  </div>

                  {!isSummaryView ? (
                    <Button
                      type="button"
                      onClick={() => setSelectedReport(report)}
                      kind="outline"
                      tone="slate"
                      size="sm"
                      icon={MessageSquare}
                      className="mt-3 w-full justify-center"
                    >
                      사유 확인
                    </Button>
                  ) : null}
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto md:block">
          <DataTable minWidth="min-w-[900px]" tableClassName={tableStyles.table}>
            <DataTable.Header>
              <tr>
                {canResolve ? (
                  <DataTable.HeadCell align="center" className={`${tableStyles.header} w-[48px] !text-center`}>
                    <input
                      type="checkbox"
                      checked={
                        selectedIds.length > 0 &&
                        selectedIds.length === selectableReportIds.length
                      }
                      onChange={() =>
                        setSelectedIds(
                          selectedIds.length === selectableReportIds.length
                            ? []
                            : selectableReportIds,
                        )
                      }
                      disabled={selectableReportIds.length === 0}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </DataTable.HeadCell>
                ) : null}
                <DataTable.HeadCell align="center" className={`${tableStyles.header} w-[112px] !text-center`}>접수 시각</DataTable.HeadCell>
                <DataTable.HeadCell className={`${tableStyles.header} w-[220px] !text-left`}>신고 대상</DataTable.HeadCell>
                <DataTable.HeadCell className={`${tableStyles.header} w-[180px] !text-left`}>적용 규칙</DataTable.HeadCell>
                <DataTable.HeadCell className={`${tableStyles.header} !text-left`}>사유</DataTable.HeadCell>
                <DataTable.HeadCell align="center" className={`${tableStyles.header} w-[144px] !text-center`}>상태</DataTable.HeadCell>
              </tr>
            </DataTable.Header>

            <DataTable.Body>
              {sortedReports.map((report) => {
                const isSelected = selectedIds.includes(report.id);
                const isSensitive = report.isSensitive;
                const isSummaryView = report.visibilityLevel === "summary";
                const repeatCount = Math.max(
                  1,
                  Math.floor(Number(report.repeatCount || 1)),
                );

                return (
                  <tr
                    key={report.id}
                    onMouseDown={(event) =>
                      handleMouseDown(event, report.id, isSelected)
                    }
                    onMouseEnter={() => handleMouseEnter(report.id)}
                    className={`border-l-4 transition-all ${
                      isSelected
                        ? "border-l-indigo-500 bg-indigo-50/70"
                        : isSensitive
                          ? "border-l-rose-500 bg-rose-50/40"
                          : "border-l-transparent hover:bg-slate-50/50"
                    } ${canResolve && !isSummaryView ? "cursor-pointer" : ""}`}
                  >
                    {canResolve ? (
                      <td
                        className={`${tableStyles.cell} text-center`}
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        <div
                          className={`mx-auto flex h-4 w-4 items-center justify-center rounded border transition-all ${
                            isSummaryView
                              ? "border-slate-200 bg-slate-100"
                              : isSelected
                              ? "border-indigo-600 bg-indigo-600 text-white"
                              : "border-slate-300 bg-white"
                          }`}
                        >
                          {!isSummaryView && isSelected ? (
                            <Check size={12} strokeWidth={4} />
                          ) : null}
                        </div>
                      </td>
                    ) : null}

                    <td className={`${tableStyles.cell} ${tableStyles.date}`}>
                      {dayjs(report.createdAt?.toDate?.()).format("MM.DD HH:mm")}
                    </td>

                    <td className={tableStyles.cell}>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={`${tableStyles.source} break-words`}>
                          {report.reporterName}
                        </span>
                        <ArrowRight
                          className={`h-3 w-3 ${
                            isSensitive ? "text-rose-300" : "text-slate-300"
                          }`}
                        />
                        <span className={`${tableStyles.name} break-words`}>
                          {report.studentName || report.accusedStudentName}
                        </span>
                      </div>
                    </td>

                    <td className={tableStyles.cell}>
                      {isSummaryView ? (
                        renderHiddenSummary()
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className={`${tableStyles.rule} line-clamp-2 text-slate-700`}>{report.ruleText}</span>
                          {repeatCount > 1 ? (
                            <span className={tableStyles.count}>
                              x {repeatCount}
                            </span>
                          ) : null}
                          {isSensitive ? (
                            <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
                          ) : null}
                        </div>
                      )}
                    </td>

                    <td className={tableStyles.cell}>
                      {isSummaryView ? (
                        renderHiddenSummary()
                      ) : (
                        <Button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedReport(report);
                          }}
                          kind="ghost"
                          tone="slate"
                          size="xs"
                          className="group flex w-full items-center justify-start gap-2 text-left outline-none"
                        >
                          <MessageSquare
                            className={`h-3.5 w-3.5 transition-colors ${
                              isSensitive
                                ? "text-rose-300 group-hover:text-rose-400"
                                : "text-slate-300 group-hover:text-indigo-400"
                            }`}
                          />
                          <p
                            className={`${tableStyles.reason} truncate ${
                              isSensitive
                                ? "text-rose-600/80"
                                : "text-slate-500 group-hover:text-slate-700"
                            }`}
                          >
                            {report.rejectReason
                              ? `반려: ${report.rejectReason}`
                              : report.reason || "사유 없음"}
                          </p>
                        </Button>
                      )}
                    </td>

                    <td className={`${tableStyles.cell} text-center`}>
                      <Badge
                        tone={
                          report.status === "resolved_applied"
                            ? "rose"
                            : report.status === "resolved_ignored"
                              ? "slate"
                              : "amber"
                        }
                        size="xs"
                        variant="soft"
                      >
                        {report.status === "resolved_applied"
                          ? "벌점 반영"
                          : report.status === "resolved_ignored"
                            ? "반려 처리"
                            : "대기 중"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </DataTable.Body>
          </DataTable>
          </div>
          </>
        )}
      </div>

      {canResolve && selectedIds.length > 0 ? (
        <BulkActionFloatingBar
          count={selectedIds.length}
          tone="indigo"
          icon={Gavel}
          eyebrow="선택된 신고"
          title="선택한 신고를 한 번에 처리할 수 있습니다"
          subtitle="민감 지정/해제 또는 벌점 반영/반려 처리를 선택해서 일괄 적용하세요."
          actions={floatingActions}
          onClear={() => setSelectedIds([])}
        />
      ) : null}

      <PoliceReasonModal
        isOpen={Boolean(selectedReport)}
        onClose={() => setSelectedReport(null)}
        data={selectedReport}
        canEditReason={isTeacher}
        onSaveReason={handleReasonSave}
        isSavingReason={isUpdatingReason}
      />

      <Modal
        isOpen={Boolean(rejectConfirmState)}
        onClose={handleCloseRejectConfirmModal}
        closeOnOverlayClick={processingId !== "bulk-processing"}
        size="lg"
      >
        <Modal.Header>
          <div className="flex items-center gap-3 pr-8">
            <div className="rounded-xl bg-rose-50 p-2 text-rose-600">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-black text-slate-900">
              신고 반려 처리 확인
            </h3>
          </div>
        </Modal.Header>

        <Modal.Body className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-bold">
                선택한 {rejectConfirmTargets.length}건을 {rejectActionLabel}
                합니다.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-rose-700">
                처리 후 해당 신고는 벌점에 반영되지 않고 상태가 반려 처리로
                변경됩니다.
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <label
                  htmlFor="commonPoliceRejectReason"
                  className="block pl-1 text-[11px] font-black uppercase text-slate-400"
                >
                  공통 반려 사유
                </label>
                <Textarea
                  id="commonPoliceRejectReason"
                  rows={2}
                  value={commonRejectReasonDraft}
                  maxLength={MAX_REJECT_REASON_LENGTH}
                  onChange={(event) => {
                    setCommonRejectReasonDraft(event.target.value);
                    if (rejectReasonError) setRejectReasonError("");
                  }}
                  placeholder="공통 사유를 입력한 뒤 일괄 입력을 누르세요."
                  className="rounded-xl border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed focus:ring-0"
                  disabled={processingId === "bulk-processing"}
                />
              </div>
              <Button size="sm"
                tone="slate"
                kind="outline"
                className="shrink-0"
                onClick={handleApplyCommonRejectReason}
                disabled={processingId === "bulk-processing"}
              >
                일괄 입력
              </Button>
            </div>
            <p className="px-1 text-[11px] font-semibold text-slate-400">
              공통 사유를 채운 뒤 필요한 신고만 개별 사유로 수정할 수 있습니다.
              여러 줄을 붙여넣으면 아래 행 순서대로 입력됩니다.
            </p>
          </div>

          <div className="max-h-[360px] overflow-y-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[760px] table-fixed text-xs">
              <thead className="sticky top-0 z-10 border-b bg-slate-50 text-[10px] font-black uppercase text-slate-400">
                <tr>
                  <th className="w-[170px] px-3 py-2 text-left">신고 대상</th>
                  <th className="w-[180px] px-3 py-2 text-left">규칙/신고</th>
                  <th className="px-3 py-2 text-left">반려 사유</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rejectReasonEntries.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-10">
                      <EmptyState
                        icon={ShieldAlert}
                        title="반려 처리할 신고가 없습니다"
                        description="신고를 선택하면 개별 반려 사유를 입력할 수 있습니다."
                      />
                    </td>
                  </tr>
                ) : (
                  rejectReasonEntries.map(({ report, reason }, index) => {
                  const reasonLength = reason.trim().length;
                  const hasError =
                    reasonLength === 0 || reasonLength > MAX_REJECT_REASON_LENGTH;

                  return (
                    <tr key={report.id} className={hasError ? "bg-rose-50/30" : ""}>
                      <td className="px-3 py-3 align-top">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-black text-slate-900">
                              {report.studentName ||
                                report.accusedStudentName ||
                                "이름 없음"}
                            </span>
                            {report.isSensitive ? (
                              <Badge tone="rose" size="sm" variant="soft">
                                민감
                              </Badge>
                            ) : null}
                          </div>
                          <span className="truncate text-[11px] font-semibold text-slate-400">
                            신고자 {report.reporterName || "-"}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <p className="line-clamp-2 font-bold text-slate-700">
                          {report.ruleText || "자유 신고"}
                        </p>
                        <span className="mt-1 block font-mono text-[10px] text-slate-400">
                          {dayjs(report.createdAt?.toDate?.()).format("MM.DD HH:mm")}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Textarea
                          rows={2}
                          value={reason}
                          maxLength={MAX_REJECT_REASON_LENGTH}
                          onChange={(event) =>
                            handleRejectReasonChange(report.id, event.target.value)
                          }
                          onPaste={(event) => handleRejectReasonPaste(event, index)}
                          placeholder="개별 반려 사유"
                          className={`rounded-xl bg-white px-3 py-2 text-xs leading-relaxed ${
                            hasError ? "border-rose-200 focus:ring-0" : "border-slate-200"
                          }`}
                          disabled={processingId === "bulk-processing"}
                        />
                        <div className="mt-1 flex justify-between text-[10px]">
                          <span className={hasError ? "font-bold text-rose-500" : "text-slate-300"}>
                            {reasonLength === 0
                              ? "필수"
                              : reasonLength > MAX_REJECT_REASON_LENGTH
                                ? "글자 수 초과"
                                : ""}
                          </span>
                          <span className="text-slate-300">
                            {reasonLength}/{MAX_REJECT_REASON_LENGTH}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className={rejectReasonError ? "font-bold text-rose-600" : "text-slate-400"}>
              {rejectReasonError || "각 신고 문서에 입력된 반려 사유가 개별 저장됩니다."}
            </span>
            <span className="shrink-0 text-slate-400">
              입력 완료 {rejectReasonEntries.filter(({ reason }) => reason.trim()).length}/
              {rejectReasonEntries.length}
            </span>
          </div>
        </Modal.Body>

        <Modal.Footer className="flex-col-reverse sm:flex-row">
          <Button
            tone="slate"
            kind="soft"
            fullWidth
            onClick={handleCloseRejectConfirmModal}
            disabled={processingId === "bulk-processing"}
          >
            취소
          </Button>
          <Button
            tone="rose"
            icon={Trash2}
            fullWidth
            onClick={handleConfirmRejectReports}
            isLoading={processingId === "bulk-processing"}
            disabled={!canConfirmReject}
            loadingText="처리 중"
          >
            {rejectActionLabel}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default React.memo(ReportListTab);
