import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDaysIcon, ClockIcon } from "@heroicons/react/24/outline";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import "dayjs/locale/ko";
import { BulkActionFloatingBar, Button, Modal } from "../../../../components/ui";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { useUser } from "../../../../contexts/UserContext";
import { getRewardToneClasses, getRewardVisual } from "../../constants/rewardVisuals";
import { approveAlwaysAttemptBatch, alwaysListAttempts, cancelAlwaysAttemptBatch, rejectAlwaysAttemptBatch } from "../../services/missionAlwaysService";
import { getMissionMinTierRequirement } from "../../utils/missionEligibility";
import { getRewardApprovalDefaults, getRewardConstraints, getRewardDisplayText, hasRewardRange, normalizeRewardList, sanitizeRewardOverride } from "../../utils/rewardUtils";
import ApprovalModeToggle from "./components/ApprovalModeToggle";
import StudentAlwaysRecordModal from "./components/StudentAlwaysRecordModal";
import MissionApprovalSection from "./components/MissionApprovalSection";
import { getMissionReadProvider } from "../../services/missionReadService";
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale("ko");
const KST = "Asia/Seoul";
const BULK_CHUNK_SIZE = 50;
const MAX_ATTEMPT_PAGES = 20;
const toDateSafe = value => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const normalizeItem = item => ({
  ...item,
  createdAt: typeof item?.createdAtMs === "number" ? new Date(item.createdAtMs) : toDateSafe(item?.createdAt),
  approvedAt: typeof item?.approvedAtMs === "number" ? new Date(item.approvedAtMs) : toDateSafe(item?.approvedAt),
  updatedAt: typeof item?.updatedAtMs === "number" ? new Date(item.updatedAtMs) : toDateSafe(item?.updatedAt),
  lastAttemptAt: typeof item?.lastAttemptAtMs === "number" ? new Date(item.lastAttemptAtMs) : toDateSafe(item?.lastAttemptAt)
});
const formatTime = value => {
  const date = toDateSafe(value);
  if (!date) return "-";
  return dayjs(date).tz(KST).format("MM.DD HH:mm");
};
const getStatusTone = status => {
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
const getRewardTypeLabel = (type, currencyUnit, missionTokenLabel = "토큰") => {
  if (type === "credit") return "신용점수";
  if (type === "currency") return currencyUnit;
  if (type === "missionToken") return missionTokenLabel;
  return "보상";
};
const buildRewardText = (rewardSnapshot = {}, currencyUnit, missionTokenLabel) => [{
  type: "currency",
  amount: Number(rewardSnapshot?.currency || 0)
}, {
  type: "credit",
  amount: Number(rewardSnapshot?.credit || 0)
}, {
  type: "missionToken",
  amount: Number(rewardSnapshot?.missionToken || 0)
}].filter(reward => reward.amount > 0).map(reward => getRewardDisplayText(reward, currencyUnit, missionTokenLabel)).join(" / ");
const sortStudents = (left, right) => (left.studentNumber ?? 9999) - (right.studentNumber ?? 9999) || (left.name || "").localeCompare(right.name || "", "ko") || (left.uid || "").localeCompare(right.uid || "");
const chunkItems = items => {
  const chunks = [];
  for (let index = 0; index < items.length; index += BULK_CHUNK_SIZE) {
    chunks.push(items.slice(index, index + BULK_CHUNK_SIZE));
  }
  return chunks;
};
const clampRangeRatio = ratio => Math.min(Math.max(ratio, 0), 1);
const getRangeRewardAmount = (reward, ratio) => {
  if (!reward?.isRange) return reward?.maxAmount ?? 0;
  const range = reward.maxAmount - reward.minAmount;
  if (range <= 0) return reward.maxAmount;
  return Math.round(reward.minAmount + range * clampRangeRatio(ratio));
};
const getRangeRewardRatio = (reward, amount) => {
  if (!reward?.isRange) return 1;
  const range = reward.maxAmount - reward.minAmount;
  if (range <= 0) return 1;
  const clamped = Math.min(Math.max(amount, reward.minAmount), reward.maxAmount);
  return (clamped - reward.minAmount) / range;
};
const isTeacherVisibleStudent = (mission, student) => {
  if (!student || student.role === "teacher" || student.role === "admin") {
    return false;
  }
  const targets = Array.isArray(mission?.targetStudentUids) ? mission.targetStudentUids.filter(Boolean) : [];
  if (targets.length > 0) {
    return targets.includes(student.uid);
  }
  return true;
};
export default function MissionAlwaysTeacherModal({
  isOpen,
  onClose,
  mission,
  classId,
  studentMatrix = []
}) {
  const {
    showFeedback
  } = useFeedback();
  const {
    classData,
    missionTokenLabel
  } = useUser();
  const effectiveClassId = classId || mission?.classId || mission?.classID || "";
  const currencyUnit = classData?.currencyUnit || "코인";
  const isManual = !mission?.autoApprove;
  const usesInbox = isManual && true;
  const [detailView, setDetailView] = useState("pending");
  const showInbox = usesInbox && detailView === "pending";
  const usesDayBuckets = !!mission?.autoApprove && !mission?.requireSubmissionForm;
  const hasRangeRewards = useMemo(() => hasRewardRange(mission), [mission]);
  const detailAllowsApproval = isManual;
  const rewardDefaults = useMemo(() => getRewardApprovalDefaults(mission), [mission]);
  const rewardConstraints = useMemo(() => getRewardConstraints(mission), [mission]);
  const rewardSummary = useMemo(() => normalizeRewardList(mission?.rewards || []), [mission?.rewards]);
  const minTier = useMemo(() => getMissionMinTierRequirement(mission), [mission]);
  const defaultDateKey = useMemo(() => dayjs().tz(KST).format("YYYY-MM-DD"), []);
  const missionDescription = useMemo(() => {
    const raw = typeof mission?.description === "string" ? mission.description.trim() : "";
    return raw || "과제 설명이 없습니다.";
  }, [mission?.description]);
  const eligibleStudents = useMemo(() => (studentMatrix || []).filter(student => isTeacherVisibleStudent(mission, student)).sort(sortStudents), [mission, studentMatrix]);
  const [dateFrom, setDateFrom] = useState(defaultDateKey);
  const [dateTo, setDateTo] = useState(defaultDateKey);
  const [mode, setMode] = useState("approve");
  const [items, setItems] = useState([]);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [rewardOverrideMap, setRewardOverrideMap] = useState({});
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [detailMode, setDetailMode] = useState("record");
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [dragMode, setDragMode] = useState(null);
  const isApproveMode = mode === "approve";
  const isCancelMode = mode === "cancel";
  const normalizedDateRange = useMemo(() => {
    const start = String(dateFrom || dateTo || defaultDateKey).trim();
    const end = String(dateTo || dateFrom || defaultDateKey).trim();
    if (!start || !end) {
      return {
        dateFrom: defaultDateKey,
        dateTo: defaultDateKey
      };
    }
    return start <= end ? {
      dateFrom: start,
      dateTo: end
    } : {
      dateFrom: end,
      dateTo: start
    };
  }, [dateFrom, dateTo, defaultDateKey]);
  const selectedDate = normalizedDateRange.dateFrom;
  const setSelectedDate = useCallback(value => {
    const nextValue = String(value || defaultDateKey).trim() || defaultDateKey;
    setDateFrom(nextValue);
    setDateTo(nextValue);
  }, [defaultDateKey]);
  useEffect(() => {
    if (!isOpen) {
      setSelectedStudent(null);
      setDetailMode("record");
      setIsDragSelecting(false);
      setDragMode(null);
      return;
    }
    setDateFrom(defaultDateKey);
    setDateTo(defaultDateKey);
    setMode("approve");
    setDetailView("pending");
    setItems([]);
    setSelectedRows(new Set());
  }, [defaultDateKey, isOpen, mission?.id]);
  const loadRows = useCallback(async () => {
    if (!isOpen || showInbox || !effectiveClassId || !mission?.id) return;
    setLoading(true);
    try {
      if (usesDayBuckets) {
        const response = await alwaysListAttempts({
          classId: effectiveClassId,
          missionId: mission.id,
          allStudents: true,
          studentUids: eligibleStudents.map(student => student.uid),
          dateFrom: normalizedDateRange.dateFrom,
          dateTo: normalizedDateRange.dateTo,
          limit: Math.max(eligibleStudents.length, 50),
          view: "days"
        });
        setItems((response?.attempts || []).map(item => normalizeItem(item)));
      } else {
        const loadedItems = [];
        let nextCursor = null;
        for (let page = 0; page < MAX_ATTEMPT_PAGES; page += 1) {
          const response = await alwaysListAttempts({
            classId: effectiveClassId,
            missionId: mission.id,
            allStudents: true,
            dateFrom: normalizedDateRange.dateFrom,
            dateTo: normalizedDateRange.dateTo,
            limit: 500,
            cursor: nextCursor,
            view: "attempts"
          });
          loadedItems.push(...(response?.attempts || []).map(item => normalizeItem(item)));
          if (!response?.hasMore || !response?.nextCursor) {
            break;
          }
          nextCursor = response.nextCursor;
        }
        setItems(loadedItems);
      }
    } catch (error) {
      console.error("always teacher rows load failed:", error);
      showFeedback(error?.message || "목록을 불러오는 중 문제가 발생했습니다.", "error");
    } finally {
      setLoading(false);
    }
  }, [effectiveClassId, eligibleStudents, isOpen, mission?.id, normalizedDateRange.dateFrom, normalizedDateRange.dateTo, showFeedback, usesDayBuckets, showInbox]);
  useEffect(() => {
    loadRows();
  }, [loadRows]);
  useEffect(() => {
    if (!hasRangeRewards || usesDayBuckets) {
      setRewardOverrideMap({});
      return;
    }
    setRewardOverrideMap(prev => {
      const next = {};
      items.forEach(item => {
        if (item.status !== "pending") return;
        next[item.id] = sanitizeRewardOverride(mission, prev[item.id] ?? rewardDefaults);
      });
      return next;
    });
  }, [hasRangeRewards, items, mission, rewardDefaults, usesDayBuckets]);
  const rows = useMemo(() => {
    if (usesDayBuckets) {
      const dayMap = new Map(items.map(item => [String(item.studentUid || ""), item]));
      return eligibleStudents.map(student => {
        const dayRow = dayMap.get(String(student.uid)) || null;
        const attemptCount = Number(dayRow?.attemptCount || 0);
        return {
          rowKey: student.uid,
          student,
          actionItems: [],
          latestAt: dayRow?.lastAttemptAt || dayRow?.updatedAt || null,
          statusTone: attemptCount > 0 ? "approved" : "none",
          statusLabel: attemptCount > 0 ? attemptCount > 1 ? `수행 ${attemptCount}건` : "수행" : "미수행",
          rewardText: attemptCount > 0 ? buildRewardText(dayRow?.rewardTotal || {}, currencyUnit, missionTokenLabel) : "",
          selectable: false
        };
      });
    }
    const attemptMap = items.reduce((map, item) => {
      const key = String(item.studentUid || "");
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
      return map;
    }, new Map());
    return eligibleStudents.map(student => {
      const studentItems = [...(attemptMap.get(String(student.uid)) || [])].sort((left, right) => (right.createdAt?.getTime?.() ?? 0) - (left.createdAt?.getTime?.() ?? 0));
      const pendingItems = studentItems.filter(item => item.status === "pending");
      const approvedItems = studentItems.filter(item => item.status === "approved");
      const rejectedItems = studentItems.filter(item => item.status === "rejected");
      const actionItems = isCancelMode ? approvedItems : pendingItems;
      const latestItem = studentItems[0] || null;
      let statusTone = "none";
      let statusLabel = "제출 없음";
      if (!isCancelMode && pendingItems.length > 0) {
        statusTone = "pending";
        statusLabel = pendingItems.length > 1 ? "대기 " + pendingItems.length + "건" : "대기";
      } else if (approvedItems.length > 0) {
        statusTone = "approved";
        statusLabel = approvedItems.length > 1 ? "승인 " + approvedItems.length + "건" : "승인";
      } else if (rejectedItems.length > 0) {
        statusTone = "rejected";
        statusLabel = rejectedItems.length > 1 ? "반려 " + rejectedItems.length + "건" : "반려";
      } else if (studentItems.length > 0) {
        statusLabel = studentItems.length > 1 ? "기록 " + studentItems.length + "건" : "기록 있음";
      }
      return {
        rowKey: student.uid,
        student,
        actionItems,
        latestAt: latestItem?.createdAt || latestItem?.approvedAt || latestItem?.updatedAt || null,
        statusTone,
        statusLabel,
        rewardText: buildRewardText(latestItem?.rewardSnapshot || {}, currencyUnit, missionTokenLabel),
        selectable: isManual && actionItems.length > 0
      };
    });
  }, [currencyUnit, eligibleStudents, isCancelMode, isManual, items, missionTokenLabel, usesDayBuckets]);
  const selectableRowKeys = useMemo(() => rows.filter(row => row.selectable).map(row => row.rowKey), [rows]);
  const selectedRowList = useMemo(() => rows.filter(row => selectedRows.has(row.rowKey)), [rows, selectedRows]);
  const selectedAttemptCount = useMemo(() => selectedRowList.reduce((sum, row) => sum + row.actionItems.length, 0), [selectedRowList]);
  const allSelected = selectableRowKeys.length > 0 && selectableRowKeys.every(rowKey => selectedRows.has(rowKey));
  useEffect(() => {
    setSelectedRows(prev => {
      const next = new Set();
      selectableRowKeys.forEach(rowKey => {
        if (prev.has(rowKey)) next.add(rowKey);
      });
      return next;
    });
  }, [selectableRowKeys]);
  const toggleRow = rowKey => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);else next.add(rowKey);
      return next;
    });
  };
  const toggleAll = () => {
    setSelectedRows(allSelected ? new Set() : new Set(selectableRowKeys));
  };
  const applyDrag = useCallback((rowKey, selectable, nextMode) => {
    if (!isManual || !selectable || processing || !nextMode) return;
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (nextMode === "select") next.add(rowKey);else next.delete(rowKey);
      return next;
    });
  }, [isManual, processing]);
  const startDrag = useCallback(row => {
    if (!isManual || !row?.selectable || processing) return;
    const nextMode = selectedRows.has(row.rowKey) ? "deselect" : "select";
    setIsDragSelecting(true);
    setDragMode(nextMode);
    applyDrag(row.rowKey, row.selectable, nextMode);
  }, [applyDrag, isManual, processing, selectedRows]);
  const isInteractiveTarget = useCallback(event => {
    const target = event?.target;
    if (!target || typeof target.closest !== "function") return false;
    return Boolean(target.closest("input, button, textarea, select, a, label, [data-no-drag]"));
  }, []);
  const enterDrag = useCallback(row => {
    if (!isDragSelecting || !dragMode) return;
    applyDrag(row?.rowKey, row?.selectable, dragMode);
  }, [applyDrag, dragMode, isDragSelecting]);
  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragSelecting(false);
      setDragMode(null);
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);
  const openRecordDetail = useCallback(student => {
    setDetailMode("record");
    setSelectedStudent(student);
  }, []);
  const openActionDetail = useCallback(student => {
    setDetailMode("action");
    setSelectedStudent(student);
  }, []);
  const closeDetail = useCallback(() => {
    setSelectedStudent(null);
    setDetailMode("record");
  }, []);
  const bulkRewardRatio = useMemo(() => {
    if (!(mode === "approve" && hasRangeRewards) || selectedRowList.length === 0) {
      return 100;
    }
    const ratios = [];
    selectedRowList.forEach(row => {
      row.actionItems.forEach(item => {
        const override = sanitizeRewardOverride(mission, rewardOverrideMap[item.id] ?? rewardDefaults);
        ["credit", "currency", "missionToken"].forEach(type => {
          const reward = rewardConstraints[type];
          if (!reward?.isRange) return;
          ratios.push(getRangeRewardRatio(reward, override[type]));
        });
      });
    });
    if (!ratios.length) return 100;
    return Math.round(ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length * 100);
  }, [hasRangeRewards, mission, mode, rewardConstraints, rewardDefaults, rewardOverrideMap, selectedRowList]);
  const applyBulkRatio = useCallback(ratio => {
    if (!hasRangeRewards) return;
    setRewardOverrideMap(prev => {
      const next = {
        ...prev
      };
      selectedRowList.forEach(row => {
        row.actionItems.forEach(item => {
          next[item.id] = sanitizeRewardOverride(mission, {
            credit: getRangeRewardAmount(rewardConstraints.credit, ratio),
            currency: getRangeRewardAmount(rewardConstraints.currency, ratio),
            missionToken: getRangeRewardAmount(rewardConstraints.missionToken, ratio)
          });
        });
      });
      return next;
    });
  }, [hasRangeRewards, mission, rewardConstraints, selectedRowList]);
  const executeBulkAction = useCallback(async (actionType, rowList, successMessage) => {
    if (!rowList.length) return;
    const batchItems = rowList.flatMap(row => row.actionItems.map(item => actionType === "approve" ? {
      studentUid: row.student.uid,
      attemptId: item.id,
      rewardOverride: hasRangeRewards ? sanitizeRewardOverride(mission, rewardOverrideMap[item.id] ?? rewardDefaults) : null
    } : {
      studentUid: row.student.uid,
      attemptId: item.id
    }));
    try {
      setProcessing(true);
      for (const chunk of chunkItems(batchItems)) {
        if (actionType === "approve") {
          await approveAlwaysAttemptBatch({
            classId: effectiveClassId,
            missionId: mission.id,
            items: chunk
          });
        } else if (actionType === "reject") {
          await rejectAlwaysAttemptBatch({
            classId: effectiveClassId,
            missionId: mission.id,
            items: chunk
          });
        } else {
          await cancelAlwaysAttemptBatch({
            classId: effectiveClassId,
            missionId: mission.id,
            items: chunk
          });
        }
      }
      showFeedback(successMessage, "success");
      await loadRows();
      setSelectedRows(new Set());
    } catch (error) {
      console.error("always batch action failed:", error);
      showFeedback(error?.message || "일괄 처리 중 문제가 발생했습니다.", "error");
    } finally {
      setProcessing(false);
    }
  }, [effectiveClassId, hasRangeRewards, loadRows, mission, rewardDefaults, rewardOverrideMap, showFeedback]);
  const handleSelectedApprove = async () => {
    if (!selectedRowList.length) return;
    await executeBulkAction("approve", selectedRowList, "선택한 제출을 승인했습니다.");
  };
  const handleSelectedReject = async () => {
    if (!selectedRowList.length) return;
    await executeBulkAction("reject", selectedRowList, "선택한 제출을 반려했습니다.");
  };
  const handleSelectedCancel = async () => {
    if (!selectedRowList.length) return;
    await executeBulkAction("cancel", selectedRowList, "선택한 승인 내역을 취소했습니다.");
  };
  if (!isOpen || !mission) return null;
  return <>
      <Modal isOpen={isOpen} onClose={onClose} size="xl">
        <Modal.Header>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <h2 className="truncate text-lg font-bold text-slate-900">{mission?.title || "상시과제"}</h2>
              {minTier ? <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                  신용등급 {minTier.name} 이상
                </span> : null}
            </div>

            <details><summary className="cursor-pointer text-sm text-slate-500">과제 설명 보기</summary>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{missionDescription}</p>
            </details>

            <div className="flex flex-wrap gap-2">
              {rewardSummary.length > 0 ? rewardSummary.map((reward, index) => {
              const visual = getRewardVisual(reward.type);
              const VisualIcon = visual.icon;
              return <span key={`${reward.type}-${index}`} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${getRewardToneClasses(visual.tone)}`}>
                      <VisualIcon size={12} strokeWidth={2.5} />
                      <span title={getRewardTypeLabel(reward.type, currencyUnit, missionTokenLabel)}>
                        +{getRewardDisplayText(reward, currencyUnit, missionTokenLabel)}
                      </span>
                    </span>;
            }) : <span className="text-xs text-slate-500">보상 없음</span>}
            </div>
          </div>
        </Modal.Header>

        {usesInbox && <div className="flex flex-wrap gap-2 border-b px-6 py-3">
          <Button size="sm" tone={showInbox ? "blue" : "slate"} kind={showInbox ? "solid" : "outline"} onClick={() => {
          setSelectedRows(new Set());
          setDetailView("pending");
        }}>승인 대기</Button>
          <Button size="sm" tone={!showInbox ? "blue" : "slate"} kind={!showInbox ? "solid" : "outline"} onClick={() => setDetailView("records")}>전체 현황·기록</Button>
        </div>}

        {showInbox ? <Modal.Body><MissionApprovalSection mission={mission} classId={effectiveClassId} students={eligibleStudents} /></Modal.Body> : <>

        <div className="border-b bg-slate-50/70 px-6 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-500">조회 날짜</span>
                  <div className="relative">
                    <CalendarDaysIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} className="h-10 rounded-xl border border-blue-200 bg-blue-50/50 pl-10 pr-3 text-sm font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                  </div>
                </label>

                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  대상 <span className="font-semibold text-slate-900">{rows.length}명</span>
                </div>
              </div>

              <p className="text-xs text-slate-500">
                {isManual ? hasRangeRewards ? "승인 모드에서는 선택 후 플로팅바에서 일괄 승인/반려하고, 상세에서 제출별 보상 금액 조정이 가능합니다." : "승인 모드에서는 플로팅바로 일괄 승인/반려하고, 상세에서 제출별 개별 승인/반려가 가능합니다." : "선택한 날짜 기준 수행 기록입니다."}
              </p>
            </div>

            {isManual ? <ApprovalModeToggle mode={mode} onChange={setMode} /> : null}
          </div>
        </div>

        <div className="relative flex max-h-[70vh] flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-4 pb-28">
            {isManual ? <div className="mb-3 text-xs font-semibold text-slate-400">
                마우스를 누른 채 드래그해 여러 학생을 빠르게 선택할 수 있습니다.
              </div> : null}

            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="border-b bg-slate-50">
                  <tr>
                    {isManual ? <th className="w-12 px-3 py-3 text-center">
                        <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                      </th> : null}
                    <th className="px-4 py-3 text-left font-medium text-slate-700">학생</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-700">상태</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-700">최신 시간</th>
                    <th className="px-4 py-3 text-center font-medium text-slate-700">작업</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {loading ? <tr>
                      <td colSpan={isManual ? 5 : 4} className="px-4 py-10 text-center text-slate-500">
                        불러오는 중...
                      </td>
                    </tr> : rows.length === 0 ? <tr>
                      <td colSpan={isManual ? 5 : 4} className="px-4 py-10 text-center text-slate-500">
                        표시할 학생이 없습니다.
                      </td>
                    </tr> : rows.map(row => {
                    const canDetailAction = detailAllowsApproval && row.actionItems.length > 0;
                    return <tr key={row.rowKey} onMouseDown={event => {
                      if (isInteractiveTarget(event)) return;
                      startDrag(row);
                    }} onMouseEnter={() => enterDrag(row)} className={`transition-colors ${selectedRows.has(row.rowKey) ? "bg-blue-50/60" : "hover:bg-slate-50"} ${row.selectable && isManual ? "cursor-pointer" : ""}`}>
                          {isManual ? <td className="px-3 py-3 text-center">
                              <input type="checkbox" checked={selectedRows.has(row.rowKey)} disabled={!row.selectable || processing} onChange={() => toggleRow(row.rowKey)} className="rounded" />
                            </td> : null}

                          <td className="px-4 py-3">
                            <Button tone="blue" kind="ghost" size="md" type="button" onClick={() => openRecordDetail(row.student)}>
                              {row.student?.name || "학생"}
                            </Button>
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${getStatusTone(row.statusTone)}`}>
                                {row.statusLabel}
                              </span>
                              {row.rewardText ? <span className="text-xs text-slate-500">{row.rewardText}</span> : null}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="inline-flex items-center gap-1 text-slate-600">
                              <ClockIcon className="h-4 w-4 text-slate-400" />
                              <span>{formatTime(row.latestAt)}</span>
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-2">
                              <Button size="sm" variant="secondary" onClick={() => openRecordDetail(row.student)}>
                                기록
                              </Button>
                              {canDetailAction ? <Button size="sm" tone={isApproveMode ? "indigo" : "rose"} onClick={() => openActionDetail(row.student)} disabled={processing}>
                                  {isApproveMode ? "개별 승인/반려" : "개별 취소"}
                                </Button> : null}
                            </div>
                          </td>
                        </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {isManual && selectedRowList.length > 0 ? <BulkActionFloatingBar count={selectedAttemptCount} eyebrow={isApproveMode ? "승인 대기 선택" : "승인 취소 선택"} title={isApproveMode ? `선택 검토 ${selectedAttemptCount}건` : `선택 취소 ${selectedAttemptCount}건`} subtitle={`학생 ${selectedRowList.length}명 선택됨`} tone={isApproveMode ? "indigo" : "rose"} actions={[{
            key: "toggle-all",
            label: allSelected ? "전체 해제" : "전체 선택",
            onClick: toggleAll,
            kind: "outline",
            tone: "slate"
          }, ...(isApproveMode ? [{
            key: "approve",
            label: `선택 승인 ${selectedAttemptCount}건`,
            onClick: handleSelectedApprove,
            disabled: processing,
            tone: "indigo"
          }, {
            key: "reject",
            label: `선택 반려 ${selectedAttemptCount}건`,
            onClick: handleSelectedReject,
            disabled: processing,
            tone: "rose"
          }] : [{
            key: "cancel",
            label: `선택 취소 ${selectedAttemptCount}건`,
            onClick: handleSelectedCancel,
            disabled: processing,
            tone: "rose"
          }])]} onClear={() => setSelectedRows(new Set())} clearLabel="선택 해제">
              {isApproveMode && hasRangeRewards ? <div className="min-w-[220px] rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-500">
                      빠른 보상 조절
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
                      {bulkRewardRatio === 0 ? "최소" : bulkRewardRatio === 50 ? "중간" : bulkRewardRatio === 100 ? "최대" : `${bulkRewardRatio}%`}
                    </span>
                  </div>

                  <input type="range" min="0" max="100" step="1" value={bulkRewardRatio} onChange={event => applyBulkRatio(Number(event.target.value) / 100)} className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600" />

                  <div className="mt-1 flex items-center justify-between">
                    {[{
                  key: "min",
                  label: "최소",
                  ratio: 0
                }, {
                  key: "mid",
                  label: "중간",
                  ratio: 0.5
                }, {
                  key: "max",
                  label: "최대",
                  ratio: 1
                }].map(option => <Button tone="slate" kind="ghost" size="xs" key={option.key} type="button" onClick={() => applyBulkRatio(option.ratio)} className="transition">
                        {option.label}
                      </Button>)}
                  </div>
                </div> : null}
            </BulkActionFloatingBar> : null}
        </div>
        </>}
      </Modal>

      <StudentAlwaysRecordModal isOpen={Boolean(selectedStudent)} onClose={closeDetail} student={selectedStudent} mission={mission} classId={effectiveClassId} currencyUnit={currencyUnit} initialDateKey={selectedDate} actionMode={mode} allowActions={detailAllowsApproval && detailMode === "action"} onUpdated={loadRows} />
    </>;
}
