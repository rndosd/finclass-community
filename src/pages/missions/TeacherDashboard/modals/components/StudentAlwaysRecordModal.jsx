import { confirmMissionAction } from "../../../components/MissionActionDialog";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import "dayjs/locale/ko";

import Modal from "../../../../../components/ui/Modal";
import { Button } from "../../../../../components/ui";
import { useFeedback } from "../../../../../contexts/FeedbackContext";
import { useUser } from "../../../../../contexts/UserContext";
import {
  approveAlwaysAttemptBatch,
  alwaysListAttempts,
  cancelAlwaysAttemptBatch,
  rejectAlwaysAttemptBatch,
} from "../../../services/missionAlwaysService";
import RewardOverrideFields from "./RewardOverrideFields";
import {
  getRewardApprovalDefaults,
  getRewardDisplayText,
  hasRewardRange,
  sanitizeRewardOverride,
} from "../../../utils/rewardUtils";
import { sanitizeRichHtml } from "../../../../../utils/sanitizeRichHtml";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale("ko");

const KST = "Asia/Seoul";

const RANGE_PRESETS = [
  { key: "today", label: "오늘" },
  { key: "week", label: "최근 7일" },
  { key: "twoWeeks", label: "최근 2주" },
  { key: "month", label: "최근 30일" },
  { key: "all", label: "전체" },
  { key: "custom", label: "직접 선택" },
];

const DAY_OF_WEEK_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

const STATUS_LABELS = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "반려",
  canceled: "승인 취소",
};

const toDateSafe = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeItem = (item) => ({
  ...item,
  createdAt:
    typeof item?.createdAtMs === "number"
      ? new Date(item.createdAtMs)
      : toDateSafe(item?.createdAt),
  approvedAt:
    typeof item?.approvedAtMs === "number"
      ? new Date(item.approvedAtMs)
      : toDateSafe(item?.approvedAt),
  updatedAt:
    typeof item?.updatedAtMs === "number"
      ? new Date(item.updatedAtMs)
      : toDateSafe(item?.updatedAt),
  lastAttemptAt:
    typeof item?.lastAttemptAtMs === "number"
      ? new Date(item.lastAttemptAtMs)
      : toDateSafe(item?.lastAttemptAt),
});

const getRangeBounds = (rangeType, customStart, customEnd) => {
  const now = dayjs().tz(KST);

  if (rangeType === "today") {
    return { start: now.startOf("day"), end: now.endOf("day") };
  }
  if (rangeType === "week") {
    return { start: now.subtract(6, "day").startOf("day"), end: now.endOf("day") };
  }
  if (rangeType === "twoWeeks") {
    return { start: now.subtract(13, "day").startOf("day"), end: now.endOf("day") };
  }
  if (rangeType === "month") {
    return { start: now.subtract(29, "day").startOf("day"), end: now.endOf("day") };
  }
  if (rangeType === "custom") {
    return {
      start: customStart ? dayjs(customStart).tz(KST).startOf("day") : null,
      end: customEnd ? dayjs(customEnd).tz(KST).endOf("day") : null,
    };
  }

  return { start: null, end: null };
};

const getStatusTone = (status) => {
  if (status === "approved") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "pending") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
};

const buildRewardText = (rewardSnapshot = {}, currencyUnit, missionTokenLabel) =>
  [
    { type: "credit", amount: Number(rewardSnapshot?.credit || 0) },
    { type: "currency", amount: Number(rewardSnapshot?.currency || 0) },
    { type: "missionToken", amount: Number(rewardSnapshot?.missionToken || 0) },
  ]
    .filter((reward) => reward.amount > 0)
    .map((reward) =>
      getRewardDisplayText(reward, currencyUnit, missionTokenLabel),
    )
    .join(" / ");

export default function StudentAlwaysRecordModal({
  isOpen,
  onClose,
  student,
  mission,
  classId,
  currencyUnit: initialCurrencyUnit = "코인",
  initialDateKey = "",
  initialRange = null,
  actionMode = "approve",
  allowActions = true,
  onUpdated,
}) {
  const { showFeedback } = useFeedback();
  const { missionTokenLabel } = useUser();
  const [rangeType, setRangeType] = useState("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [expandedDates, setExpandedDates] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [rewardOverrideMap, setRewardOverrideMap] = useState({});

  const usesDayBuckets = !!mission?.autoApprove && !mission?.requireSubmissionForm;
  const hasRangeRewards = useMemo(() => hasRewardRange(mission), [mission]);
  const rewardDefaults = useMemo(() => getRewardApprovalDefaults(mission), [mission]);
  const showActionControls = allowActions && !usesDayBuckets;
  const detailViewMode = !allowActions
    ? "record"
    : actionMode === "cancel"
      ? "cancel"
      : "approve";
  const isApproveMode = detailViewMode === "approve";
  const isCancelMode = detailViewMode === "cancel";
  const resolvedCurrencyUnit = initialCurrencyUnit || "코인";

  useEffect(() => {
    if (!isOpen) return;

    if (initialRange?.start && initialRange?.end) {
      setRangeType("custom");
      setCustomStart(initialRange.start);
      setCustomEnd(initialRange.end);
      setExpandedDates(new Set());
      setSelectedIds(new Set());
      return;
    }

    if (initialDateKey) {
      setRangeType("custom");
      setCustomStart(initialDateKey);
      setCustomEnd(initialDateKey);
      setExpandedDates(new Set([initialDateKey]));
      setSelectedIds(new Set());
      return;
    }

    setRangeType("today");
    setCustomStart("");
    setCustomEnd("");
    setExpandedDates(new Set());
    setSelectedIds(new Set());
  }, [initialDateKey, initialRange?.end, initialRange?.start, isOpen]);

  const { start, end } = useMemo(
    () => getRangeBounds(rangeType, customStart, customEnd),
    [customEnd, customStart, rangeType],
  );

  const loadRecords = useCallback(async () => {
    if (!isOpen || !student?.uid || !mission?.id || !classId) return;

    setLoading(true);
    try {
      const response = await alwaysListAttempts({
        classId,
        missionId: mission.id,
        studentUid: student.uid,
        dateFrom: start ? start.format("YYYY-MM-DD") : null,
        dateTo: end ? end.format("YYYY-MM-DD") : null,
        limit: usesDayBuckets ? 120 : 150,
        view: usesDayBuckets ? "days" : "attempts",
      });

      setRecords((response?.attempts || []).map((item) => normalizeItem(item)));
    } catch (error) {
      console.error("always record load failed:", error);
      showFeedback(error?.message || "기록을 불러오는 중 문제가 발생했습니다.", "error");
    } finally {
      setLoading(false);
    }
  }, [classId, end, isOpen, mission?.id, showFeedback, start, student?.uid, usesDayBuckets]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (!isOpen || !showActionControls || !hasRangeRewards) {
      setRewardOverrideMap({});
      return;
    }

    setRewardOverrideMap((prev) => {
      const next = {};
      records.forEach((record) => {
        if (record.status !== "pending") return;
        next[record.id] = sanitizeRewardOverride(mission, prev[record.id] ?? rewardDefaults);
      });
      return next;
    });
  }, [hasRangeRewards, isOpen, mission, records, rewardDefaults, showActionControls]);

  const visibleRecords = useMemo(() => {
    if (usesDayBuckets) return records;
    if (detailViewMode === "record") return records;

    return records.filter((record) => {
      if (isCancelMode) return record.status === "approved";
      return record.status === "pending";
    });
  }, [detailViewMode, isCancelMode, records, usesDayBuckets]);

  const groupedByDate = useMemo(() => {
    const map = {};

    visibleRecords.forEach((record) => {
      const key = usesDayBuckets
        ? record.dayKey
        : dayjs(toDateSafe(record.createdAt)).tz(KST).format("YYYY-MM-DD");

      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(record);
    });

    return map;
  }, [usesDayBuckets, visibleRecords]);

  const sortedDates = useMemo(
    () => Object.keys(groupedByDate).sort((left, right) => right.localeCompare(left)),
    [groupedByDate],
  );

  useEffect(() => {
    if (!isOpen || loading || sortedDates.length === 0) return;

    setExpandedDates((prev) => {
      if (prev.size > 0) return prev;
      if (initialDateKey && sortedDates.includes(initialDateKey)) {
        return new Set([initialDateKey]);
      }
      return new Set([sortedDates[0]]);
    });
  }, [initialDateKey, isOpen, loading, sortedDates]);

  const selectableIds = useMemo(
    () => (showActionControls ? visibleRecords.map((record) => record.id) : []),
    [showActionControls, visibleRecords],
  );
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set();
      selectableIds.forEach((id) => {
        if (prev.has(id)) next.add(id);
      });
      return next;
    });
  }, [selectableIds]);

  const summary = useMemo(() => {
    if (usesDayBuckets) {
      return visibleRecords.reduce(
        (acc, record) => {
          acc.total += Number(record.attemptCount || 0);
          return acc;
        },
        { total: 0 },
      );
    }

    return { total: visibleRecords.length };
  }, [usesDayBuckets, visibleRecords]);

  const rangeLabel = useMemo(() => {
    if (rangeType === "all") return "전체 기간";
    if (rangeType !== "custom") {
      return RANGE_PRESETS.find((preset) => preset.key === rangeType)?.label || "오늘";
    }
    if (start && end) {
      return `${start.format("YYYY.MM.DD")} ~ ${end.format("YYYY.MM.DD")}`;
    }
    return "직접 선택";
  }, [end, rangeType, start]);

  const toggleDate = (dateKey) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  };

  const executeSelectedAction = useCallback(
    async (actionType) => {
      if (!showActionControls || selectedIds.size === 0) return;

      if (actionType === "cancel") {
        const confirmed = await confirmMissionAction(`"${mission?.title || "상시과제"}" · ${student?.name || "학생"}\n선택한 ${selectedIds.size}건의 승인을 취소할까요?`);
        if (!confirmed) return;
      }

      const selectedRecords = visibleRecords.filter((record) => selectedIds.has(record.id));

      try {
        setProcessing(true);

        if (actionType === "approve") {
          await approveAlwaysAttemptBatch({
            classId,
            missionId: mission.id,
            items: selectedRecords.map((record) => ({
              studentUid: student.uid,
              attemptId: record.id,
              rewardOverride: hasRangeRewards
                ? sanitizeRewardOverride(mission, rewardOverrideMap[record.id] ?? rewardDefaults)
                : null,
            })),
          });
        } else if (actionType === "reject") {
          await rejectAlwaysAttemptBatch({
            classId,
            missionId: mission.id,
            items: selectedRecords.map((record) => ({
              studentUid: student.uid,
              attemptId: record.id,
            })),
          });
        } else {
          await cancelAlwaysAttemptBatch({
            classId,
            missionId: mission.id,
            items: selectedRecords.map((record) => ({
              studentUid: student.uid,
              attemptId: record.id,
            })),
          });
        }

        showFeedback(
          actionType === "approve"
            ? "선택한 제출을 승인했습니다."
            : actionType === "reject"
              ? "선택한 제출을 반려했습니다."
              : "선택한 승인 내역을 취소했습니다.",
          "success",
        );
        setSelectedIds(new Set());
        await loadRecords();
        onUpdated?.();
      } catch (error) {
        console.error("always student modal batch action failed:", error);
        showFeedback(error?.message || "처리 중 문제가 발생했습니다.", "error");
      } finally {
        setProcessing(false);
      }
    },
    [
      classId,
      student?.name,
      hasRangeRewards,
      loadRecords,
      mission,
      onUpdated,
      rewardDefaults,
      rewardOverrideMap,
      selectedIds,
      showActionControls,
      showFeedback,
      student?.uid,
      visibleRecords,
    ],
  );

  const handleSelectedApprove = useCallback(
    () => executeSelectedAction("approve"),
    [executeSelectedAction],
  );
  const handleSelectedReject = useCallback(
    () => executeSelectedAction("reject"),
    [executeSelectedAction],
  );
  const handleSelectedCancel = useCallback(
    () => executeSelectedAction("cancel"),
    [executeSelectedAction],
  );

  const emptyMessage = usesDayBuckets
    ? "해당 기간에 기록이 없습니다."
    : detailViewMode === "record"
      ? "해당 기간에 기록이 없습니다."
      : isApproveMode
        ? "이 기간에 승인/반려할 제출이 없습니다."
        : "이 기간에 취소할 승인 내역이 없습니다.";

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <Modal.Header>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-slate-900">{`${student?.name || "학생"} 기록`}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {mission?.title} / {rangeLabel}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="닫기">
          X
        </Button>
      </Modal.Header>

      <div className="relative">
        <Modal.Body className="space-y-4 p-6 pb-28">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              {RANGE_PRESETS.map((preset) => (
                <Button
                  key={preset.key}
                  type="button"
                  onClick={() => setRangeType(preset.key)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                    rangeType === preset.key
                      ? "border-indigo-200 bg-indigo-100 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {preset.label}
                </Button>
              ))}

              {rangeType === "custom" ? (
                <div className="ml-2 flex items-center gap-2">
                  <input
                    type="date"
                    value={customStart}
                    onChange={(event) => setCustomStart(event.target.value)}
                    className="rounded border border-blue-200 px-2 py-1 text-sm"
                  />
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(event) => setCustomEnd(event.target.value)}
                    className="rounded border border-blue-200 px-2 py-1 text-sm"
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            {usesDayBuckets ? (
              <span>
                총 수행 <strong className="text-slate-900">{summary.total}회</strong>
              </span>
            ) : showActionControls ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {isApproveMode
                    ? "승인/반려할 제출"
                    : "취소할 승인"}{" "}
                  <strong className="text-slate-900">{summary.total}건</strong>
                </span>
                {selectableIds.length > 0 ? (
                  <Button tone="slate" kind="outline" size="xs"
                    type="button"
                    onClick={toggleSelectAll}
                    className="transition"
                  >
                    {allSelected ? "전체 해제" : "전체 선택"}
                  </Button>
                ) : null}
              </div>
            ) : (
              <span>
                전체 기록 <strong className="text-slate-900">{summary.total}건</strong>
              </span>
            )}
          </div>

          {loading ? (
            <div className="py-12 text-center text-slate-500">불러오는 중...</div>
          ) : visibleRecords.length === 0 ? (
            <div className="py-12 text-center">
              <CalendarIcon className="mx-auto mb-2 h-10 w-10 text-slate-300" />
              <p className="text-sm text-slate-500">{emptyMessage}</p>
            </div>
          ) : (
            <div className="max-h-[480px] space-y-2 overflow-y-auto">
              {sortedDates.map((dateKey) => {
                const list = groupedByDate[dateKey] || [];
                const date = dayjs(dateKey);
                const isExpanded = expandedDates.has(dateKey);
                const dateLabel = date.isValid()
                  ? `${date.format("M월 D일")} (${DAY_OF_WEEK_LABELS[date.day()]})`
                  : dateKey;

                return (
                  <div key={dateKey} className="space-y-2">
                    <Button tone="slate" kind="outline" size="sm"
                      type="button"
                      onClick={() => toggleDate(dateKey)}
                      className="flex w-full items-center gap-2 transition"
                    >
                      {isExpanded ? (
                        <ChevronDownIcon className="h-4 w-4 text-slate-600" />
                      ) : (
                        <ChevronRightIcon className="h-4 w-4 text-slate-600" />
                      )}
                      <span className="text-sm font-semibold text-slate-700">{dateLabel}</span>
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                        {usesDayBuckets ? `${Number(list[0]?.attemptCount || 0)}회` : `${list.length}건`}
                      </span>
                    </Button>

                    {isExpanded ? (
                      <div className="space-y-2 pl-6">
                        {usesDayBuckets ? (
                          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                            자동 승인 기록 {Number(list[0]?.attemptCount || 0)}회
                          </div>
                        ) : (
                          list.map((record) => {
                            const previewReward =
                              isApproveMode && showActionControls && hasRangeRewards
                                ? sanitizeRewardOverride(mission, rewardOverrideMap[record.id] ?? rewardDefaults)
                                : record.rewardSnapshot || {};
                            const rewardText = buildRewardText(
                              previewReward,
                              resolvedCurrencyUnit,
                              missionTokenLabel,
                            );
                            const createdAtLabel = record.createdAt
                              ? dayjs(record.createdAt).tz(KST).format("HH:mm")
                              : "-";

                            return (
                              <div
                                key={record.id}
                                className={`space-y-3 rounded-lg border bg-white px-4 py-3 ${
                                  showActionControls && selectedIds.has(record.id)
                                    ? "border-blue-200 ring-1 ring-blue-100"
                                    : "border-slate-200"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    {showActionControls ? (
                                      <input
                                        type="checkbox"
                                        checked={selectedIds.has(record.id)}
                                        onChange={() => toggleSelect(record.id)}
                                        className="rounded"
                                      />
                                    ) : null}
                                    <CheckCircleIcon
                                      className={`h-4 w-4 ${
                                        record.status === "approved"
                                          ? "text-emerald-600"
                                          : record.status === "rejected"
                                            ? "text-rose-600"
                                            : record.status === "canceled"
                                              ? "text-slate-400"
                                              : "text-amber-600"
                                      }`}
                                    />
                                    <span className="text-sm font-semibold text-slate-900">{createdAtLabel}</span>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${getStatusTone(
                                        record.status,
                                      )}`}
                                    >
                                      {STATUS_LABELS[record.status] || record.status}
                                    </span>
                                  </div>

                                  {rewardText ? <span className="text-xs text-slate-500">{rewardText}</span> : null}
                                </div>

                                {record.contentHtml ? (
                                  <div
                                    className="prose prose-sm max-w-none rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                                    dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(record.contentHtml) }}
                                  />
                                ) : null}

                                {isApproveMode && showActionControls && hasRangeRewards ? (
                                  <RewardOverrideFields
                                    mission={mission}
                                    currencyUnit={resolvedCurrencyUnit}
                                    value={rewardOverrideMap[record.id] ?? rewardDefaults}
                                    compact
                                    onChange={(value) => {
                                      setRewardOverrideMap((prev) => ({
                                        ...prev,
                                        [record.id]: sanitizeRewardOverride(mission, value),
                                      }));
                                    }}
                                  />
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Modal.Body>

        {showActionControls && selectedIds.size > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-6 pb-4">
            <div className="pointer-events-auto w-full rounded-2xl border border-slate-200 bg-white/98 shadow-lg shadow-slate-200/80 backdrop-blur">
              <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-600">
                  선택 <strong className="text-slate-900">{selectedIds.size}건</strong>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button tone="slate" kind="outline" size="xs"
                    type="button"
                    onClick={toggleSelectAll}
                    className="transition"
                  >
                    {allSelected ? "전체 해제" : "전체 선택"}
                  </Button>
                  {isApproveMode ? (
                    <>
                      <Button onClick={handleSelectedApprove} disabled={processing}>
                        {processing ? "처리 중..." : `선택 승인 ${selectedIds.size}건`}
                      </Button>
                      <Button tone="rose" onClick={handleSelectedReject} disabled={processing}>
                        {processing ? "처리 중..." : `선택 반려 ${selectedIds.size}건`}
                      </Button>
                    </>
                  ) : (
                    <Button tone="rose" onClick={handleSelectedCancel} disabled={processing}>
                      {processing ? "처리 중..." : `선택 취소 ${selectedIds.size}건`}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex justify-end px-6 pb-5">
        <Button variant="secondary" onClick={onClose}>
          닫기
        </Button>
      </div>
    </Modal>
  );
}
