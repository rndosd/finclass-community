import { appConfirm } from "../../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { CheckSquare, ChevronDown, Play, Square, Trash, TrendingUp, X } from "lucide-react";
import { collection, getDocs, limit, orderBy, query, startAfter, Timestamp, where } from "firebase/firestore";
import BulkActionFloatingBar from "../../../components/ui/BulkActionFloatingBar";
import Button from "../../../components/ui/Button";
import DataTable from "../../../components/ui/DataTable";
import EmptyState from "../../../components/ui/EmptyState";
import IconButton from "../../../components/ui/IconButton";
import Modal from "../../../components/ui/Modal";
import SurfaceLoader from "../../../components/ui/SurfaceLoader";
import TableSkeleton from "../../../components/ui/TableSkeleton";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import useDragSelection from "../../../hooks/useDragSelection";
import { getUserFacingRecordDescription, getUserFacingRecordSource } from "../../../utils/userFacingRecordDescription";
import TaxIncomeFilterBar from "../components/TaxIncomeFilterBar";
import { getIncomeBadgeColor, getIncomeBadgeLabel, getFilterGroups } from "../constants/taxIncomeConstants";
import { bulkDeleteTaxData } from "../services/taxDeleteService";
import TaxLedgerHistoryModal from "../components/TaxLedgerHistoryModal";
const defaultStartDate = () => dayjs().subtract(2, "day").format("YYYY-MM-DD");
const todayYMD = () => dayjs().format("YYYY-MM-DD");
const LIMIT_COUNT = 20;
const dayToTsStart = value => Timestamp.fromDate(dayjs(value).startOf("day").toDate());
const dayToTsEnd = value => Timestamp.fromDate(dayjs(value).endOf("day").toDate());
const isRowSelectionExcludedTarget = target => {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button,a,input,textarea,select,[data-no-row-select='true']"));
};
const getDetailLines = income => Array.isArray(income?.detailLines) ? income.detailLines : [];
const FirestoreTaxIncomeHistoryModal = ({
  isOpen,
  onClose,
  classId,
  currencyUnit = "원"
}) => {
  const {
    formatNumber
  } = useNumberFormat();
  const {
    showFeedback
  } = useFeedback();
  const {
    isTeacher,
    hasPermission
  } = useUser();
  const [tempStartDate, setTempStartDate] = useState(defaultStartDate());
  const [tempEndDate, setTempEndDate] = useState(todayYMD());
  const [tempFilter, setTempFilter] = useState("all");
  const [applied, setApplied] = useState({
    start: defaultStartDate(),
    end: todayYMD(),
    filter: "all"
  });
  const [incomes, setIncomes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef(null);
  const [selectedIncomeIds, setSelectedIncomeIds] = useState(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [expandedIncomeIds, setExpandedIncomeIds] = useState(new Set());
  const filterGroups = useMemo(() => getFilterGroups(currencyUnit), [currencyUnit]);
  const canDelete = isTeacher || hasPermission("tax_admin");
  const isChanged = tempStartDate !== applied.start || tempEndDate !== applied.end || tempFilter !== applied.filter;
  const fetchIncomes = useCallback(async (isFirstPage = true) => {
    if (!classId) return;
    if (isFirstPage) {
      setIsLoading(true);
      lastDocRef.current = null;
      setHasMore(true);
    } else {
      setIsFetchingMore(true);
    }
    try {
      const baseCol = collection(db, `classes/${classId}/taxIncomes`);
      let incomeQuery = query(baseCol, orderBy("createdAt", "desc"));
      if (applied.start) {
        incomeQuery = query(incomeQuery, where("createdAt", ">=", dayToTsStart(applied.start)));
      }
      if (applied.end) {
        incomeQuery = query(incomeQuery, where("createdAt", "<=", dayToTsEnd(applied.end)));
      }
      if (applied.filter !== "all") {
        const group = filterGroups[applied.filter];
        if (group?.sources?.length) {
          incomeQuery = query(incomeQuery, where("source", "in", group.sources));
        } else {
          incomeQuery = query(incomeQuery, where("source", "==", applied.filter));
        }
      }
      if (!isFirstPage && lastDocRef.current) {
        incomeQuery = query(incomeQuery, startAfter(lastDocRef.current));
      }
      incomeQuery = query(incomeQuery, limit(LIMIT_COUNT));
      const snapshot = await getDocs(incomeQuery);
      if (snapshot.empty) {
        if (isFirstPage) setIncomes([]);
        setHasMore(false);
        return;
      }
      const nextItems = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      setIncomes(prev => isFirstPage ? nextItems : [...prev, ...nextItems]);
      lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.docs.length < LIMIT_COUNT) {
        setHasMore(false);
      }
    } catch (error) {
      console.error("[TaxIncomeHistoryModal] fetch failed:", error);
      showFeedback("내역을 불러오는 중 오류가 발생했습니다.", "error");
    } finally {
      setIsLoading(false);
      setIsFetchingMore(false);
    }
  }, [applied, classId, filterGroups, showFeedback]);
  useEffect(() => {
    if (isOpen && classId) {
      fetchIncomes(true);
    }
  }, [classId, fetchIncomes, isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    setTempStartDate(defaultStartDate());
    setTempEndDate(todayYMD());
    setTempFilter("all");
    setSelectedIncomeIds(new Set());
    setExpandedIncomeIds(new Set());
  }, [isOpen]);
  const handleApplyFilters = event => {
    event?.preventDefault();
    setApplied({
      start: tempStartDate,
      end: tempEndDate,
      filter: tempFilter
    });
    setSelectedIncomeIds(new Set());
    setExpandedIncomeIds(new Set());
    showFeedback("조회 조건이 적용되었습니다.", "success");
  };
  const toggleIncomeDetails = incomeId => {
    setExpandedIncomeIds(prev => {
      const next = new Set(prev);
      if (next.has(incomeId)) next.delete(incomeId);else next.add(incomeId);
      return next;
    });
  };
  const handleBulkDelete = async () => {
    if (selectedIncomeIds.size === 0 || !(await appConfirm(`선택한 ${selectedIncomeIds.size}건을 삭제하시겠습니까?`, {
      "title": "삭제 확인",
      "confirmLabel": "삭제하기",
      "tone": "rose"
    }))) {
      return;
    }
    if (!(await appConfirm("삭제 후에는 복구할 수 없습니다. 계속하시겠습니까?", {
      "title": "삭제 확인",
      "confirmLabel": "삭제하기",
      "tone": "rose"
    }))) {
      return;
    }
    setIsBulkDeleting(true);
    try {
      const selectedIdSet = new Set(selectedIncomeIds);
      const result = await bulkDeleteTaxData(classId, Array.from(selectedIdSet), []);
      if (!result.success) {
        throw new Error(result.message || "수입 일괄 삭제에 실패했습니다.");
      }
      showFeedback(result.message || "선택한 수입 내역을 삭제했습니다.", "success");
      setIncomes(prev => prev.filter(item => !selectedIdSet.has(item.id)));
      setSelectedIncomeIds(new Set());
      setExpandedIncomeIds(prev => {
        const next = new Set(prev);
        selectedIdSet.forEach(id => next.delete(id));
        return next;
      });
    } catch (error) {
      showFeedback(error.message || "수입 일괄 삭제 중 오류가 발생했습니다.", "error");
    } finally {
      setIsBulkDeleting(false);
    }
  };
  const toggleIncomeSelection = useCallback((incomeId, forceMode = null) => {
    if (!canDelete || !incomeId || isBulkDeleting) return;
    setSelectedIncomeIds(prev => {
      const next = new Set(prev);
      const isSelected = next.has(incomeId);
      const shouldSelect = forceMode === "select" ? true : forceMode === "deselect" ? false : !isSelected;
      if (shouldSelect) next.add(incomeId);else next.delete(incomeId);
      return next;
    });
  }, [canDelete, isBulkDeleting]);
  const {
    startDrag,
    enterDrag
  } = useDragSelection({
    isSelected: incomeId => selectedIncomeIds.has(incomeId),
    onSelect: incomeId => toggleIncomeSelection(incomeId, "select"),
    onDeselect: incomeId => toggleIncomeSelection(incomeId, "deselect"),
    isItemEnabled: () => canDelete && !isBulkDeleting
  });
  const handleRowMouseDown = (event, incomeId) => {
    if (!canDelete || event.button !== 0) return;
    if (isRowSelectionExcludedTarget(event.target)) return;
    event.preventDefault();
    startDrag(incomeId, {
      selected: selectedIncomeIds.has(incomeId)
    });
  };
  const handleRowMouseEnter = incomeId => {
    if (!canDelete) return;
    enterDrag(incomeId);
  };
  const totalLoadedIncome = incomes.reduce((sum, income) => sum + Number(income.amount || 0), 0);
  const columnCount = canDelete ? 5 : 4;
  const hasIncomes = incomes.length > 0;
  if (!isOpen) return null;
  return <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <div className="flex max-h-[90vh] flex-col select-none">
        <div className="flex items-center justify-between border-b border-slate-100 bg-white p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
              <TrendingUp className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">세금 수입 내역</h2>
          </div>
          <Button size="sm" kind="ghost" tone="slate" icon={X} onClick={onClose} />
        </div>

        <form onSubmit={handleApplyFilters} className="border-b border-slate-100 bg-slate-50/50 p-4">
          <div className="flex flex-col items-stretch gap-6 md:flex-row md:items-start">
            <div className="w-full flex-1 space-y-2">
              <TaxIncomeFilterBar filter={tempFilter} onFilterChange={setTempFilter} startDate={tempStartDate} endDate={tempEndDate} onDateChange={({
              startDate,
              endDate
            }) => {
              setTempStartDate(startDate);
              setTempEndDate(endDate);
            }} currencyUnit={currencyUnit} onRefresh={() => fetchIncomes(true)} onEnter={handleApplyFilters} showQuickButtons={false} />
            </div>

            <div className="flex w-full flex-col gap-4 md:w-auto md:self-start md:pt-5">
              <Button type="submit" disabled={!isChanged} icon={Play} tone="blue" size="sm" rounded="xl" className={`flex items-center justify-center gap-2 transition-all  ${isChanged ? "" : "cursor-not-allowed"}`}>
                조회 적용
              </Button>
            </div>
          </div>
        </form>

        <div className="flex-grow overflow-y-auto bg-white px-4 pb-4">
          <SurfaceLoader loading={isLoading} variant={hasIncomes ? "refreshing" : "surface-loading"} preserveContent={hasIncomes} skeleton={<TableSkeleton bare columns={columnCount} rows={6} className="h-full min-h-full" />} minHeightClassName="min-h-[360px]">
            {hasIncomes ? <div className="pb-10">
              <DataTable>
                <DataTable.Header className="sticky top-0 z-10">
                  <DataTable.Row interactive={false}>
                    {canDelete ? <DataTable.HeadCell align="center" className="w-10 px-6 py-4">
                        선택
                      </DataTable.HeadCell> : null}
                    <DataTable.HeadCell align="center" className="px-6 py-4">
                      날짜
                    </DataTable.HeadCell>
                    <DataTable.HeadCell className="px-6 py-4">
                      항목
                    </DataTable.HeadCell>
                    <DataTable.HeadCell align="center" className="px-6 py-4">
                      종류
                    </DataTable.HeadCell>
                    <DataTable.HeadCell align="right" className="px-6 py-4">
                      금액
                    </DataTable.HeadCell>
                  </DataTable.Row>
                </DataTable.Header>

                <DataTable.Body>
                  {incomes.map(income => {
                  const detailLines = getDetailLines(income);
                  const canExpand = detailLines.length > 1;
                  const isExpanded = expandedIncomeIds.has(income.id);
                  const isSelected = selectedIncomeIds.has(income.id);
                  return <React.Fragment key={income.id}>
                        <DataTable.Row onMouseDown={event => handleRowMouseDown(event, income.id)} onMouseEnter={() => handleRowMouseEnter(income.id)} className={`transition-colors ${isSelected ? "bg-emerald-50" : canDelete ? "cursor-pointer hover:bg-slate-50/60" : "hover:bg-slate-50/40"}`}>
                          {canDelete ? <td className="px-6 py-4 text-center">
                              <div className="inline-flex">
                                {isSelected ? <CheckSquare className="h-5 w-5 text-emerald-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                              </div>
                            </td> : null}

                          <td className="px-6 py-4 text-center font-mono text-xs text-slate-400">
                            {dayjs(income.source === "period_tax_settlement" && income.periodEnd ? income.periodEnd : income.createdAt?.toDate?.() || income.createdAt).format("MM.DD")}
                          </td>

                          <td className="px-6 py-4">
                            <div className="flex items-start gap-2">
                              {canExpand ? <IconButton type="button" onClick={() => toggleIncomeDetails(income.id)} icon={ChevronDown} tone="slate" size="sm" className={`mt-0.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 ${isExpanded ? "rotate-180" : ""}`} aria-label={isExpanded ? "상세 접기" : "상세 펼치기"} data-no-row-select="true" /> : <span className="mt-1 h-6 w-6 shrink-0" />}

                              <span className="font-bold text-slate-800">
                                {getUserFacingRecordDescription(income, "수입 기록")}
                              </span>
                            </div>
                          </td>

                          <td className="px-6 py-4 text-center">
                            <span className={`inline-flex rounded-lg border px-1.5 py-0.5 text-xs font-bold ${getIncomeBadgeColor(income)}`}>
                              {getIncomeBadgeLabel(income, currencyUnit)}
                            </span>
                          </td>

                          <td className="px-6 py-4 text-right text-base font-bold text-emerald-600">
                            +{formatNumber(income.amount)}
                            <span className="ml-1 text-xs font-normal text-slate-400">
                              {currencyUnit}
                            </span>
                          </td>
                        </DataTable.Row>

                        {canExpand && isExpanded ? <DataTable.Row interactive={false} className="bg-slate-50/70">
                            <td colSpan={columnCount} className="px-6 py-4">
                              <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="mb-2 text-xs font-bold text-slate-500">
                                  상세 {detailLines.length}건
                                </div>

                                <div className="space-y-2">
                                  {detailLines.map((line, index) => <div key={line.id || `${income.id}-line-${index}`} className="flex items-start justify-between gap-4 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                                      <div className="min-w-0">
                                        <div className="font-medium text-slate-700">
                                          {getUserFacingRecordDescription(line, "상세 항목")}
                                        </div>
                                        <div className="text-xs text-slate-400">
                                          {getUserFacingRecordSource(line.source, "-")}
                                        </div>
                                      </div>

                                      <div className="shrink-0 font-semibold text-emerald-600">
                                        +{formatNumber(line.amount || 0)}{" "}
                                        {currencyUnit}
                                      </div>
                                    </div>)}
                                </div>
                              </div>
                            </td>
                          </DataTable.Row> : null}
                      </React.Fragment>;
                })}
                </DataTable.Body>
              </DataTable>

              {hasMore ? <div className="flex justify-center border-t border-slate-50 p-8">
                  <Button kind="outline" tone="slate" size="md" className="min-w-[280px]" onClick={() => fetchIncomes(false)} isLoading={isFetchingMore} icon={ChevronDown}>
                    이전 내역 더 보기
                  </Button>
                </div> : <div className="py-12 text-center text-xs font-bold text-slate-400">
                  End Of List
                </div>}
              </div> : <EmptyState title="조회된 세금 수입 내역이 없습니다" description="기간이나 수입 유형 필터를 조정해 다시 확인해 보세요." className="py-24" />}
          </SurfaceLoader>
        </div>

        {canDelete ? <BulkActionFloatingBar count={selectedIncomeIds.size} tone="rose" icon={Trash} eyebrow="선택한 수입" title="선택한 수입 내역을 한 번에 삭제할 수 있습니다" subtitle="행을 드래그해서 여러 건을 빠르게 선택하세요." actions={[{
        key: "delete",
        label: "선택 삭제",
        onClick: handleBulkDelete,
        icon: Trash,
        tone: "rose",
        disabled: isBulkDeleting,
        isLoading: isBulkDeleting
      }]} onClear={() => setSelectedIncomeIds(new Set())} clearLabel="선택 해제" /> : null}

        {hasIncomes ? <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-500">
                현재 로드된 건수
              </span>
              <span className="text-sm font-bold text-slate-700">
                {incomes.length}건
              </span>
            </div>

            <div className="text-right">
              <p className="text-xs font-bold text-slate-500">
                총 수입 합계
              </p>
              <p className="text-xl font-bold text-emerald-600">
                +{formatNumber(totalLoadedIncome)}
                <span className="ml-1 text-xs font-medium text-slate-400">
                  {currencyUnit}
                </span>
              </p>
            </div>
          </div> : null}
      </div>
    </Modal>;
};
const TaxIncomeHistoryModal = ({
  adapterMode,
  records,
  filters,
  students,
  onFiltersChange,
  onApply,
  onReset,
  onLoadMore,
  hasMore,
  isLoading,
  isLoadingMore,
  ...props
}) => {
  return <FirestoreTaxIncomeHistoryModal {...props} />;
};
export default TaxIncomeHistoryModal;
