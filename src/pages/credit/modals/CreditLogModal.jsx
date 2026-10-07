import { appConfirm } from "../../../utils/appDialogs";
import { fetchCreditLogsSince } from "../utils/creditLogReads";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
} from "firebase/firestore";
import {
  Award,
  CheckSquare,
  History,
  Minus,
  Plus,
  ShieldCheck,
  Square,
  Trash,
  X,
} from "lucide-react";

import {
  Badge,
  BulkActionFloatingBar,
  Button,
  Card,
  Modal,
  Spinner,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import useDragSelection from "../../../hooks/useDragSelection";
import { bulkDeleteStudentLogs } from "../../../services/studentLogDeleteService";
import CreditTrendChart from "../components/CreditTrendChart";
import CreditScoreChange from "../components/CreditScoreChange";
import { getTierInfoByScore } from "../utils/tierUtils";

const PAGE_SIZE = 10;

const isRowSelectionExcludedTarget = (target) => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("button,a,input,textarea,select,[data-no-row-select='true']"),
  );
};

const CreditLogRow = ({
  log,
  canDelete,
  isSelected,
  onMouseDown,
  onMouseEnter,
}) => {
  const delta = Number(log?.delta ?? log?.amount ?? 0);
  const isPositive = delta > 0;

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      className={`flex items-center justify-between gap-3 border-b border-slate-50 px-2 py-3 transition-colors last:border-0 ${
        isSelected
          ? "bg-rose-50/70"
          : canDelete
            ? "cursor-pointer hover:bg-slate-50/70"
            : "hover:bg-slate-50/50"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {canDelete ? (
          <div className="shrink-0 text-slate-300">
            {isSelected ? (
              <CheckSquare className="h-5 w-5 text-rose-600" />
            ) : (
              <Square className="h-5 w-5" />
            )}
          </div>
        ) : null}

        <div
          className={`shrink-0 rounded-lg p-2 ${
            isPositive
              ? "bg-emerald-50 text-emerald-600"
              : "bg-rose-50 text-rose-600"
          }`}
        >
          {isPositive ? (
            <Plus size={14} strokeWidth={3} />
          ) : (
            <Minus size={14} strokeWidth={3} />
          )}
        </div>

        <div className="min-w-0">
          <div className="break-words text-sm font-bold text-slate-700">
            {log.reason || "사유 없음"}
          </div>
          <CreditScoreChange log={log} />
          <div className="mt-0.5 text-[10px] text-slate-400">
            {log.timestamp?.toDate
              ? log.timestamp.toDate().toLocaleDateString("ko-KR")
              : "날짜 정보 없음"}
          </div>
        </div>
      </div>

      <div
        className={`shrink-0 pl-2 text-sm font-black ${
          isPositive ? "text-emerald-600" : "text-rose-600"
        }`}
      >
        {isPositive ? "+" : ""}
        {delta}점
      </div>
    </div>
  );
};

export default function CreditLogModal({ student, onClose }) {
  const { classId, isTeacher, isAdmin } = useUser();
  const { showFeedback } = useFeedback();

  const [logs, setLogs] = useState([]);
  const [lastVisible, setLastVisible] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [selectedLogIds, setSelectedLogIds] = useState(new Set());
  const [lastHistoryScore, setLastHistoryScore] = useState(null);
  const [tierCriteria, setTierCriteria] = useState([]);
  const [recentStats, setRecentStats] = useState({
    plus: 0,
    minus: 0,
    loading: true,
  });

  const canDelete = isTeacher || isAdmin;
  const currentTier = useMemo(
    () => getTierInfoByScore(student?.creditScore || 0, tierCriteria),
    [student?.creditScore, tierCriteria],
  );
  const tierColor = currentTier?.color || "#6366f1";

  useEffect(() => {
    if (!classId) {
      setTierCriteria([]);
      return;
    }

    const tierRef = doc(db, `classes/${classId}/tierCriteria/default`);
    const unsubscribe = onSnapshot(
      tierRef,
      (snapshot) => {
        setTierCriteria(snapshot.exists() ? snapshot.data().tiers || [] : []);
      },
      () => {
        setTierCriteria([]);
      },
    );

    return () => unsubscribe();
  }, [classId]);

  const fetchRecentStats = useCallback(async () => {
    if (!classId || !student?.uid) return;

    setRecentStats((prev) => ({ ...prev, loading: true }));

    try {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 2);
      threeDaysAgo.setHours(0, 0, 0, 0);

      const snapshot = await fetchCreditLogsSince(classId, student.uid, threeDaysAgo);
      const stats = snapshot.docs.reduce(
        (accumulator, logDoc) => {
          const data = logDoc.data();
          const delta = Number(data.delta ?? data.amount ?? 0);
          if (delta > 0) accumulator.plus += delta;
          else accumulator.minus += Math.abs(delta);
          return accumulator;
        },
        { plus: 0, minus: 0 },
      );

      setRecentStats({ ...stats, loading: false });
    } catch (error) {
      console.error("[CreditLogModal] recent stats fetch failed:", error);
      setRecentStats({ plus: 0, minus: 0, loading: false });
    }
  }, [classId, student?.uid]);

  const fetchInitialLogs = useCallback(async () => {
    if (!classId || !student?.uid) return;

    setIsLogsLoading(true);
    setHasMore(true);
    setLastVisible(null);

    try {
      const logQuery = query(
        collection(db, `classes/${classId}/students/${student.uid}/creditLogs`),
        orderBy("timestamp", "desc"),
        limit(PAGE_SIZE),
      );
      const snapshot = await getDocs(logQuery);

      if (snapshot.empty) {
        setLogs([]);
        setHasMore(false);
        return;
      }

      const nextLogs = snapshot.docs.map((logDoc) => ({
        id: logDoc.id,
        ...logDoc.data(),
      }));

      setLogs(nextLogs);
      setLastVisible(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (error) {
      console.error("[CreditLogModal] log fetch failed:", error);
      showFeedback("신용로그를 불러오지 못했습니다.", "error");
    } finally {
      setIsLogsLoading(false);
    }
  }, [classId, showFeedback, student?.uid]);

  const fetchLogs = useCallback(async () => {
    if (
      !classId ||
      !student?.uid ||
      !lastVisible ||
      !hasMore ||
      isFetchingMore
    ) {
      return;
    }

    setIsFetchingMore(true);

    try {
      const nextQuery = query(
        collection(db, `classes/${classId}/students/${student.uid}/creditLogs`),
        orderBy("timestamp", "desc"),
        startAfter(lastVisible),
        limit(PAGE_SIZE),
      );
      const snapshot = await getDocs(nextQuery);

      if (snapshot.empty) {
        setHasMore(false);
        return;
      }

      const nextLogs = snapshot.docs.map((logDoc) => ({
        id: logDoc.id,
        ...logDoc.data(),
      }));

      setLogs((prev) => [...prev, ...nextLogs]);
      setLastVisible(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (error) {
      console.error("[CreditLogModal] fetch more failed:", error);
      showFeedback("신용로그를 더 불러오지 못했습니다.", "error");
    } finally {
      setIsFetchingMore(false);
    }
  }, [
    classId,
    hasMore,
    isFetchingMore,
    lastVisible,
    showFeedback,
    student?.uid,
  ]);

  const fetchHistory = useCallback(async () => {
    if (!classId || !student?.uid) return;

    try {
      const historyQuery = query(
        collection(db, `classes/${classId}/students/${student.uid}/creditHistory`),
        orderBy("date", "desc"),
        limit(1),
      );
      const snapshot = await getDocs(historyQuery);
      if (!snapshot.empty) {
        setLastHistoryScore(snapshot.docs[0].data().score);
      } else {
        setLastHistoryScore(null);
      }
    } catch (error) {
      console.error("[CreditLogModal] history fetch failed:", error);
      setLastHistoryScore(null);
    }
  }, [classId, student?.uid]);

  useEffect(() => {
    if (!classId || !student?.uid) return;

    setSelectedLogIds(new Set());
    fetchRecentStats();
    fetchInitialLogs();
    fetchHistory();
  }, [classId, fetchHistory, fetchInitialLogs, fetchRecentStats, student?.uid]);

  const growth = useMemo(() => {
    const currentScore = student?.creditScore || 0;
    const previousScore = lastHistoryScore ?? currentScore;
    const rate =
      previousScore > 0 ? ((currentScore - previousScore) / previousScore) * 100 : 0;
    return { rate };
  }, [lastHistoryScore, student?.creditScore]);

  const toggleLogSelection = useCallback(
    (logId, forceMode = null) => {
      if (!canDelete || !logId || isBulkDeleting) return;

      setSelectedLogIds((prev) => {
        const next = new Set(prev);
        const isSelected = next.has(logId);
        const shouldSelect =
          forceMode === "select"
            ? true
            : forceMode === "deselect"
              ? false
              : !isSelected;

        if (shouldSelect) next.add(logId);
        else next.delete(logId);

        return next;
      });
    },
    [canDelete, isBulkDeleting],
  );

  const { startDrag, enterDrag } = useDragSelection({
    isSelected: (logId) => selectedLogIds.has(logId),
    onSelect: (logId) => toggleLogSelection(logId, "select"),
    onDeselect: (logId) => toggleLogSelection(logId, "deselect"),
    isItemEnabled: () => canDelete && !isBulkDeleting,
  });

  const handleRowMouseDown = (event, logId) => {
    if (!canDelete || event.button !== 0) return;
    if (isRowSelectionExcludedTarget(event.target)) return;

    event.preventDefault();
    startDrag(logId, { selected: selectedLogIds.has(logId) });
  };

  const handleRowMouseEnter = (logId) => {
    if (!canDelete) return;
    enterDrag(logId);
  };

  const handleBulkDelete = async () => {
    if (selectedLogIds.size === 0) return;

    if (
      !(await appConfirm(`선택한 신용로그 ${selectedLogIds.size}건을 삭제할까요?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"})) ||
      !(await appConfirm("삭제한 신용로그는 복구할 수 없습니다. 계속할까요?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))
    ) {
      return;
    }

    setIsBulkDeleting(true);

    try {
      const result = await bulkDeleteStudentLogs({
        classId,
        studentUid: student.uid,
        creditLogIds: Array.from(selectedLogIds),
      });

      if (!result.success) {
        throw new Error(result.message || "신용로그 삭제에 실패했습니다.");
      }

      setSelectedLogIds(new Set());
      await Promise.all([fetchRecentStats(), fetchInitialLogs()]);
      showFeedback(result.message || "선택한 신용로그를 삭제했습니다.", "success");
    } catch (error) {
      showFeedback(
        error.message || "신용로그 삭제 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsBulkDeleting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      size="5xl"
      showDefaultCloseButton={false}
    >
      <Modal.Header className="border-b border-slate-100 px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="shrink-0 rounded-xl p-2 text-white shadow-lg sm:p-2.5"
              style={{ backgroundColor: tierColor }}
            >
              <ShieldCheck size={20} className="sm:h-6 sm:w-6" />
            </div>

            <div className="min-w-0">
              <h2 className="text-lg font-black tracking-tight text-slate-800 sm:text-xl">
                신용점수 변화 기록
              </h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="truncate text-xs font-bold text-slate-500 sm:text-sm">
                  {student?.name} 학생
                </span>
                <Badge
                  style={{
                    backgroundColor: `${tierColor}15`,
                    color: tierColor,
                    borderColor: `${tierColor}30`,
                  }}
                  variant="outline"
                  size="xs"
                >
                  {currentTier?.name || "등급 없음"}
                </Badge>
              </div>
            </div>
          </div>

          <Button tone="slate" kind="ghost" size="icon-md"
            onClick={onClose}
            className="shrink-0 transition-colors"
            aria-label="닫기"
          >
            <X size={20} />
          </Button>
        </div>
      </Modal.Header>

      <Modal.Body className="bg-slate-50/30 px-3 py-3 sm:px-8 sm:py-6">
        <div className="grid h-auto grid-cols-1 gap-3 sm:gap-6 lg:h-[650px] lg:grid-cols-12 lg:gap-8">
          <div className="flex min-h-0 flex-col gap-3 sm:gap-6 lg:col-span-5">
            <Card className="rounded-3xl border-0 bg-white p-4 text-center shadow-xl shadow-slate-200/50 sm:rounded-[2.5rem] sm:p-8">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                현재 신용점수
              </p>
              <div className="flex items-baseline justify-center">
                <span
                  className="text-5xl font-black tracking-tighter sm:text-7xl"
                  style={{ color: tierColor }}
                >
                  {student?.creditScore || 0}
                </span>
                <span className="ml-2 text-xl font-bold text-slate-300 sm:text-2xl">
                  점
                </span>
              </div>
            </Card>

            <div className="flex min-h-[260px] flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm sm:min-h-[320px] sm:rounded-[2rem]">
              <div className="flex items-center justify-between border-b border-slate-50 bg-slate-50/50 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 sm:px-6 sm:py-4">
                <span>
                  신용로그 {canDelete ? "· 드래그해서 여러 건 선택 가능" : ""}
                </span>
                <History size={14} />
              </div>

              <div className="custom-scrollbar flex-1 overflow-y-auto p-2 sm:p-4">
                {isLogsLoading ? (
                  <div className="flex h-full min-h-[180px] items-center justify-center">
                    <Spinner size="sm" tone="indigo" />
                  </div>
                ) : logs.length === 0 ? (
                  <div className="flex h-full min-h-[180px] items-center justify-center text-xs font-semibold text-slate-400">
                    신용로그가 없습니다.
                  </div>
                ) : (
                  <>
                    <div className="select-none">
                      {logs.map((log) => (
                        <CreditLogRow
                          key={log.id}
                          log={log}
                          canDelete={canDelete}
                          isSelected={selectedLogIds.has(log.id)}
                          onMouseDown={(event) =>
                            handleRowMouseDown(event, log.id)
                          }
                          onMouseEnter={() => handleRowMouseEnter(log.id)}
                        />
                      ))}
                    </div>

                    {hasMore ? (
                      <Button tone="slate" kind="ghost" size="xs"
                        onClick={fetchLogs}
                        disabled={isFetchingMore}
                        className="w-full transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isFetchingMore ? "불러오는 중..." : "기록 더 보기 +"}
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-3 sm:gap-6 lg:col-span-7">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-[2rem] sm:p-6">
                <span className="mb-4 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                  최근 3일 점수 변화
                </span>

                {recentStats.loading ? (
                  <div className="flex h-[56px] items-center justify-center">
                    <Spinner size="sm" tone="indigo" />
                  </div>
                ) : (
                  <div className="flex items-center justify-around">
                    <div className="text-center">
                      <p className="mb-1 text-[9px] font-bold text-emerald-500">
                        상승
                      </p>
                      <p className="text-xl font-black text-emerald-600">
                        +{recentStats.plus}
                      </p>
                    </div>
                    <div className="h-8 w-px bg-slate-100" />
                    <div className="text-center">
                      <p className="mb-1 text-[9px] font-bold text-rose-500">
                        하락
                      </p>
                      <p className="text-xl font-black text-rose-600">
                        -{recentStats.minus}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col justify-center rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-[2rem] sm:p-6">
                <span className="mb-2 block text-center text-[10px] font-black uppercase tracking-widest text-slate-400">
                  직전 기록 대비 변화율
                </span>
                <div className="text-center">
                  <span
                    className={`text-3xl font-black tracking-tighter sm:text-4xl ${
                      growth.rate >= 0 ? "text-indigo-600" : "text-rose-600"
                    }`}
                  >
                    {growth.rate >= 0 ? "+" : ""}
                    {growth.rate.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            <Card className="flex min-h-[300px] flex-1 flex-col rounded-3xl border-0 bg-white p-4 shadow-xl shadow-slate-200/40 ring-1 ring-slate-200/60 sm:min-h-[360px] sm:rounded-[2.5rem] sm:p-8">
              <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-slate-700 sm:mb-8 sm:text-lg">
                <Award size={20} style={{ color: tierColor }} />
                신용점수 추이 (30일)
              </h3>

              <div className="relative min-h-[220px] flex-1 overflow-hidden rounded-2xl border border-slate-100/50 bg-slate-50/50 p-3 sm:rounded-[2rem] sm:p-6">
                <CreditTrendChart
                  classId={classId}
                  studentUid={student?.uid}
                  embedded
                />
              </div>
            </Card>
          </div>
        </div>
      </Modal.Body>

      {canDelete ? (
        <BulkActionFloatingBar
          count={selectedLogIds.size}
          tone="rose"
          icon={Trash}
          eyebrow="선택한 신용로그"
          title="선택한 신용로그를 삭제합니다"
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
          onClear={() => setSelectedLogIds(new Set())}
          clearLabel="선택 해제"
        />
      ) : null}

      <Modal.Footer className="px-4 py-3 sm:px-8 sm:py-5">
        <Button size="md"
          variant="secondary"
          onClick={onClose}
          className="w-full sm:w-auto sm:min-w-[120px]"
        >
          닫기
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
