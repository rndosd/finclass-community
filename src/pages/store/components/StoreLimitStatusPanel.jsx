import { appConfirm } from "../../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { RefreshCw, RotateCcw, Search, Users } from "lucide-react";

import {
  BulkActionFloatingBar,
  Button,
  DataTable,
  EmptyState,
  Spinner,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import useDragSelection from "../../../hooks/useDragSelection";
import {
  rebuildStoreItemLimitSummary,
  resetAllStoreTotalPurchases,
  resetStoreItemTotalPurchases,
} from "../services/storeAdminService";
import { normalizeStoreUsage } from "../utils/storeUsage";

const isRowSelectionExcludedTarget = (target) => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("button,a,input,textarea,select,[data-no-row-select='true']"),
  );
};

const sortStudents = (students = []) =>
  [...students].sort((a, b) => {
    const numberA = Number(a.studentNumber ?? Number.MAX_SAFE_INTEGER);
    const numberB = Number(b.studentNumber ?? Number.MAX_SAFE_INTEGER);

    if (numberA !== numberB) return numberA - numberB;
    return String(a.name || "").localeCompare(String(b.name || ""), "ko");
  });

const defaultSelectedItemId = (items = []) =>
  items.find((item) => Number(item?.totalLimit || 0) > 0)?.id || items[0]?.id || "";

const buildRowsFromUsageMap = ({
  sortedStudents = [],
  usageByStudentUid = {},
  selectedItem = null,
}) => {
  const totalLimit = Number(selectedItem?.totalLimit || 0) || null;

  return sortedStudents.map((student) => {
    const rawUsage = usageByStudentUid?.[student.uid] || null;
    const usage = normalizeStoreUsage(rawUsage || {});

    return {
      uid: student.uid,
      name: student.name || "이름 없음",
      studentNumber: student.studentNumber ?? null,
      daily: usage.daily,
      weekly: usage.weekly,
      totalPurchased: usage.totalPurchased,
      totalLimit,
      totalRemaining:
        totalLimit === null ? null : Math.max(0, totalLimit - usage.totalPurchased),
      hasUsageDoc: Boolean(rawUsage?.hasUsageDoc),
    };
  });
};

const StoreLimitStatusPanel = ({
  isOpen,
  items = [],
  students = [],
  studentsLoading = false,
}) => {
  const { classId } = useUser();
  const { showFeedback } = useFeedback();
  const rowsCacheRef = useRef(new Map());

  const [selectedItemId, setSelectedItemId] = useState(() =>
    defaultSelectedItemId(items),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isRefreshingSummary, setIsRefreshingSummary] = useState(false);
  const [selectedStudentUids, setSelectedStudentUids] = useState([]);

  useEffect(() => {
    if (!items.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(defaultSelectedItemId(items));
    }
  }, [items, selectedItemId]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) || null,
    [items, selectedItemId],
  );
  const sortedStudents = useMemo(() => sortStudents(students), [students]);
  const studentRosterSignature = useMemo(
    () =>
      sortedStudents
        .map(
          (student) =>
            `${student.uid}:${student.studentNumber || ""}:${student.name || ""}`,
        )
        .join("|"),
    [sortedStudents],
  );

  const selectedItemTotalLimitLabel = selectedItem?.totalLimit
    ? `${selectedItem.totalLimit}개`
    : "무제한";
  const selectedItemDailyLabel = selectedItem?.dailyLimit
    ? `${selectedItem.dailyLimit}개`
    : "없음";
  const selectedItemWeeklyLabel = selectedItem?.weeklyLimit
    ? `${selectedItem.weeklyLimit}개`
    : "없음";

  useEffect(() => {
    if (!isOpen) {
      rowsCacheRef.current.clear();
    }
  }, [isOpen]);

  useEffect(() => {
    rowsCacheRef.current.clear();
  }, [classId, studentRosterSignature]);

  useEffect(() => {
    rowsCacheRef.current.clear();
  }, [items]);

  const refreshSelectedItemSummary = useCallback(
    async ({ showErrorFeedback = true } = {}) => {
      if (!classId || !selectedItemId) {
        return { success: false, skipped: true };
      }

      setIsRefreshingSummary(true);

      try {
        const result = await rebuildStoreItemLimitSummary({
          classId,
          itemId: selectedItemId,
        });

        if (!result?.success && showErrorFeedback) {
          showFeedback(
            result?.message || "구매 제한 summary를 다시 만들지 못했습니다.",
            "error",
          );
        }

        return result;
      } catch (error) {
        console.error("Failed to refresh store limit summary:", error);

        if (showErrorFeedback) {
          showFeedback("구매 제한 summary를 새로고침하지 못했습니다.", "error");
        }

        return {
          success: false,
          error,
        };
      } finally {
        setIsRefreshingSummary(false);
      }
    },
    [classId, selectedItemId, showFeedback],
  );

  useEffect(() => {
    let isCancelled = false;

    if (!isOpen || !classId || !selectedItemId) {
      setRows([]);
      setIsLoading(false);
      return () => {
        isCancelled = true;
      };
    }

    const cachedRows = rowsCacheRef.current.get(selectedItemId);

    if (studentsLoading) {
      if (cachedRows) {
        setRows(cachedRows);
        setIsLoading(false);
      } else {
        setRows([]);
        setIsLoading(true);
      }

      return () => {
        isCancelled = true;
      };
    }

    if (cachedRows) {
      setRows(cachedRows);
      setIsLoading(false);
    } else {
      setRows([]);
      setIsLoading(true);
    }

    let hasRequestedSummaryRebuild = false;
    const summaryRef = doc(
      db,
      "classes",
      classId,
      "storeLimitSummaries",
      selectedItemId,
    );

    const unsubscribe = onSnapshot(
      summaryRef,
      (summarySnap) => {
        if (isCancelled) return;

        if (summarySnap.exists()) {
          const summaryData = summarySnap.data() || {};
          const usageByStudentUid =
            summaryData?.rows && typeof summaryData.rows === "object"
              ? summaryData.rows
              : {};
          const nextRows = buildRowsFromUsageMap({
            sortedStudents,
            usageByStudentUid,
            selectedItem,
          });

          rowsCacheRef.current.set(selectedItemId, nextRows);
          setRows(nextRows);
          setIsLoading(false);
          return;
        }

        if (hasRequestedSummaryRebuild) {
          if (!cachedRows) {
            setRows([]);
            setIsLoading(true);
          }
          return;
        }

        hasRequestedSummaryRebuild = true;
        if (!cachedRows) {
          setRows([]);
          setIsLoading(true);
        }

        void refreshSelectedItemSummary({ showErrorFeedback: false }).then(
          (result) => {
            if (isCancelled || result?.success) return;

            setRows(cachedRows || []);
            setIsLoading(false);
          },
        );
      },
      (error) => {
        console.error("Failed to subscribe to store limit summary:", error);
        if (isCancelled) return;

        setRows(cachedRows || []);
        setIsLoading(false);
        showFeedback("구매 제한 현황을 불러오지 못했습니다.", "error");
      },
    );

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [
    classId,
    isOpen,
    refreshSelectedItemSummary,
    selectedItem,
    selectedItemId,
    showFeedback,
    sortedStudents,
    studentsLoading,
  ]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;

    return rows.filter((row) => {
      const name = String(row.name || "").toLowerCase();
      const studentNumber = String(row.studentNumber || "");
      return name.includes(query) || studentNumber.includes(query);
    });
  }, [rows, searchQuery]);

  const resettableRows = useMemo(
    () => rows.filter((row) => row.hasUsageDoc),
    [rows],
  );

  const resettableIdSet = useMemo(
    () => new Set(resettableRows.map((row) => row.uid)),
    [resettableRows],
  );

  useEffect(() => {
    setSelectedStudentUids((prev) => prev.filter((uid) => resettableIdSet.has(uid)));
  }, [resettableIdSet]);

  const visibleResettableRows = useMemo(
    () => filteredRows.filter((row) => row.hasUsageDoc),
    [filteredRows],
  );

  const visibleResettableIdSet = useMemo(
    () => new Set(visibleResettableRows.map((row) => row.uid)),
    [visibleResettableRows],
  );

  const allVisibleSelected =
    visibleResettableRows.length > 0 &&
    visibleResettableRows.every((row) => selectedStudentUids.includes(row.uid));

  const toggleSelection = (row, forceMode = null) => {
    if (!row?.hasUsageDoc || isResetting) return;

    setSelectedStudentUids((prev) => {
      const next = new Set(prev);
      const isSelected = next.has(row.uid);
      const shouldSelect =
        forceMode === "select"
          ? true
          : forceMode === "deselect"
            ? false
            : !isSelected;

      if (shouldSelect) next.add(row.uid);
      else next.delete(row.uid);

      return Array.from(next);
    });
  };

  const { startDrag, enterDrag } = useDragSelection({
    isSelected: (row) => selectedStudentUids.includes(row?.uid),
    onSelect: (row) => toggleSelection(row, "select"),
    onDeselect: (row) => toggleSelection(row, "deselect"),
    isItemEnabled: (row) => Boolean(row?.hasUsageDoc) && !isResetting,
  });

  const reloadRows = async () => {
    rowsCacheRef.current.delete(selectedItemId);
    setSelectedStudentUids([]);
    await refreshSelectedItemSummary();
  };

  const handleResetItemTotals = async (studentUids) => {
    if (!classId || !selectedItemId || !Array.isArray(studentUids) || studentUids.length === 0) {
      return;
    }

    setIsResetting(true);
    try {
      const result = await resetStoreItemTotalPurchases({
        classId,
        itemId: selectedItemId,
        studentUids,
      });

      showFeedback(
        result?.message || "전체 구매 횟수를 초기화했습니다.",
        result?.success ? "success" : "error",
      );

      if (result?.success) {
        rowsCacheRef.current.clear();
        setSelectedStudentUids([]);
      }
    } catch (error) {
      showFeedback("전체 구매 횟수 초기화 중 오류가 발생했습니다.", "error");
    } finally {
      setIsResetting(false);
    }
  };

  const handleResetSelectedItemForAll = async () => {
    if (!selectedItem) return;

    const targetStudentUids = resettableRows.map((row) => row.uid);
    if (targetStudentUids.length === 0) {
      showFeedback("초기화할 구매 기록이 없습니다.", "warning");
      return;
    }

    const confirmed = (await appConfirm(`"${selectedItem.name}" 상품의 전체 구매 횟수를 모든 학생 기준으로 초기화할까요?`, {"title":"초기화 확인","confirmLabel":"초기화하기","tone":"rose"}));
    if (!confirmed) return;

    await handleResetItemTotals(targetStudentUids);
  };

  const handleResetAllItems = async () => {
    if (!classId) return;

    const confirmed = (await appConfirm("모든 상품의 전체 구매 횟수를 초기화할까요? 이 작업은 모든 학생의 전체 제한 카운트를 리셋합니다.", {"title":"초기화 확인","confirmLabel":"초기화하기","tone":"rose"}));
    if (!confirmed) return;

    setIsResetting(true);
    try {
      const result = await resetAllStoreTotalPurchases({ classId });

      showFeedback(
        result?.message || "모든 상품의 전체 구매 횟수를 초기화했습니다.",
        result?.success ? "success" : "error",
      );

      if (result?.success) {
        rowsCacheRef.current.clear();
        setSelectedStudentUids([]);
      }
    } catch (error) {
      showFeedback("모든 상품 초기화 중 오류가 발생했습니다.", "error");
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <label htmlFor="store-limit-item" className="text-sm font-semibold text-slate-700">상품 선택</label>
        <p className="mt-1 text-xs text-slate-500">상품을 선택하면 학생별 구매 횟수와 남은 전체 한도를 확인할 수 있습니다.</p>
        <select id="store-limit-item" value={selectedItemId}
          onChange={(event) => { setSelectedItemId(event.target.value); setSelectedStudentUids([]); }}
          className="mt-3 h-11 w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100">
          {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <dl className="mt-3 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-sm tabular-nums">
          <div><dt className="text-xs text-slate-500">일일 한도</dt><dd className="mt-1 font-bold text-slate-900">{selectedItemDailyLabel}</dd></div>
          <div><dt className="text-xs text-slate-500">주간 한도</dt><dd className="mt-1 font-bold text-slate-900">{selectedItemWeeklyLabel}</dd></div>
          <div><dt className="text-xs text-slate-500">전체 한도</dt><dd className="mt-1 font-bold text-slate-900">{selectedItemTotalLimitLabel}</dd></div>
        </dl>
      </div>

      <div className="rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Search className="mr-2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="학생 이름 또는 번호 검색"
                aria-label="학생 이름 또는 번호 검색"
                className="w-40 min-w-0 bg-transparent text-sm font-medium text-slate-700 outline-none"
              />
            </div>
            <Button
              size="sm"
              kind="outline"
              tone="slate"
              icon={RefreshCw}
              onClick={reloadRows}
              isLoading={isRefreshingSummary}
            >
              새로고침
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
            <Users className="h-4 w-4" />
            <span>드래그로 학생을 여러 명 선택해 선택 학생만 초기화할 수 있습니다.</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-4">
              <Spinner size="lg" />
              <p className="text-sm font-medium text-slate-400">
                학생별 구매 제한 현황을 불러오는 중입니다.
              </p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="표시할 학생이 없습니다"
                description="검색어를 지우거나 다른 상품을 선택해 보세요."
              />
            </div>
          ) : (
            <DataTable minWidth="min-w-[640px] w-full" tableClassName="whitespace-nowrap">
              <DataTable.Header className="sticky top-0 z-10">
                <DataTable.Row interactive={false}>
                  <DataTable.HeadCell align="center" className="px-4">
                    <input
                      type="checkbox"
                      aria-label="표시된 학생 전체 선택"
                      checked={allVisibleSelected}
                      onChange={() =>
                        setSelectedStudentUids((prev) => {
                          if (allVisibleSelected) {
                            return prev.filter((uid) => !visibleResettableIdSet.has(uid));
                          }

                          return Array.from(
                            new Set([
                              ...prev,
                              ...visibleResettableRows.map((row) => row.uid),
                            ]),
                          );
                        })
                      }
                      disabled={visibleResettableRows.length === 0 || isResetting}
                      className="h-4 w-4 accent-indigo-600"
                    />
                  </DataTable.HeadCell>
                  <DataTable.HeadCell className="px-6">학생</DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="px-6">
                    일일
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="px-6">
                    주간
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="px-6">
                    전체
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="px-6">
                    전체 한도
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="px-6">
                    남은 전체
                  </DataTable.HeadCell>
                </DataTable.Row>
              </DataTable.Header>
              <DataTable.Body>
                {filteredRows.map((row) => {
                  const isSelected = selectedStudentUids.includes(row.uid);

                  return (
                    <tr
                      key={row.uid}
                      onMouseDown={(event) => {
                        if (
                          !row.hasUsageDoc ||
                          isResetting ||
                          isRowSelectionExcludedTarget(event.target)
                        ) {
                          return;
                        }
                        event.preventDefault();
                        startDrag(row, { selected: isSelected });
                      }}
                      onMouseEnter={() => {
                        if (!row.hasUsageDoc || isResetting) return;
                        enterDrag(row);
                      }}
                      className={`transition-colors ${
                        isSelected
                          ? "bg-indigo-50/70"
                          : row.hasUsageDoc
                            ? "cursor-pointer hover:bg-slate-50/70"
                            : "hover:bg-slate-50/40"
                      }`}
                    >
                      <td className="px-4 py-4 text-center">
                        {row.hasUsageDoc ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            aria-label={row.name + " 선택"}
                            disabled={isResetting}
                            onChange={() => toggleSelection(row)}
                            className="h-4 w-4 accent-indigo-600"
                          />
                        ) : (
                          <span className="text-slate-200">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-bold text-slate-900">{row.name}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {row.studentNumber ? `${row.studentNumber}번` : "번호 없음"}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center font-bold text-slate-700">
                        {row.daily}
                      </td>
                      <td className="px-6 py-4 text-center font-bold text-slate-700">
                        {row.weekly}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`font-black ${
                            row.totalPurchased > 0 ? "text-blue-700" : "text-slate-400"
                          }`}
                        >
                          {row.totalPurchased}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center font-bold text-slate-500">
                        {row.totalLimit === null ? "-" : row.totalLimit}
                      </td>
                      <td className="px-6 py-4 text-center font-bold text-slate-500">
                        {row.totalRemaining === null ? "-" : row.totalRemaining}
                      </td>
                    </tr>
                  );
                })}
              </DataTable.Body>
            </DataTable>
          )}
        </div>
      </div>

      <details className="rounded-2xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">관리 작업 · 구매 횟수 초기화</summary>
        <p className="mt-3 text-xs leading-5 text-slate-600">일일·주간 횟수는 한국시간 기준으로 자동 정리됩니다. 아래 작업은 전체 구매 횟수만 초기화합니다.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button size="sm" kind="outline" tone="rose" icon={RotateCcw}
            onClick={handleResetSelectedItemForAll} disabled={!selectedItem || resettableRows.length === 0 || isResetting}>
            선택 상품 전체 구매 횟수 초기화
          </Button>
          <Button size="sm" kind="ghost" tone="rose" onClick={handleResetAllItems} disabled={isResetting}>
            모든 상품 전체 구매 횟수 초기화
          </Button>
        </div>
      </details>

      {selectedStudentUids.length > 0 ? (
        <BulkActionFloatingBar
          count={selectedStudentUids.length}
          tone="rose"
          icon={RotateCcw}
          eyebrow="선택 학생"
          title="선택한 학생의 전체 구매 횟수를 초기화할 수 있습니다"
          subtitle="일일/주간 횟수는 그대로 두고, 현재 선택한 상품의 전체 구매 횟수만 초기화합니다."
          actions={[
            {
              key: "reset-total",
              label: "선택 학생 전체 구매 횟수 초기화",
              icon: RotateCcw,
              tone: "rose",
              onClick: () => handleResetItemTotals(selectedStudentUids),
              disabled: isResetting,
              isLoading: isResetting,
            },
          ]}
          onClear={() => setSelectedStudentUids([])}
        />
      ) : null}
    </div>
  );
};

export default StoreLimitStatusPanel;
