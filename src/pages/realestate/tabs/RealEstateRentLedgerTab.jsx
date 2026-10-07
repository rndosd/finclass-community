import { appConfirm } from "../../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { FileText, Search, Trash2 } from 'lucide-react';
import { db } from '../../../firebase';
import { useUser } from '../../../contexts/UserContext';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { Button, BulkActionFloatingBar, EmptyState, InputField, SectionLoader } from '../../../components/ui';
import { updateRealEstateRentPaymentStateAPI } from '../services/realEstateService';
import { fetchCursorPage } from '../utils/firestoreCursorPaging';

const PAGE_SIZE = 20;

const mapDoc = (docSnap) => ({ id: docSnap.id, ...docSnap.data() });

const getTimestampValue = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const formatDateTimeText = (value) => {
  const timestamp = getTimestampValue(value);
  if (!timestamp) return '날짜 없음';
  return new Date(timestamp).toLocaleString('ko-KR');
};

const formatDateText = (value) => {
  const timestamp = getTimestampValue(value);
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString('ko-KR');
};

const formatCoverageRange = (record) => {
  const startText = formatDateText(record?.coverageStartAt);
  const endText = formatDateText(record?.coverageEndAt || record?.validUntil);

  if (!startText && !endText) return '기간 정보 없음';
  if (!startText) return `${endText}까지`;
  if (!endText) return `${startText}부터`;
  return `${startText} ~ ${endText}`;
};

const getPaymentDays = (record) => {
  const explicitDays = Math.max(0, Number(record?.days || 0));
  if (Number.isFinite(explicitDays) && explicitDays > 0) {
    return Math.floor(explicitDays);
  }

  const weeks = Math.max(0, Number(record?.weeks || 0));
  if (Number.isFinite(weeks) && weeks > 0) {
    return Math.floor(weeks * 7);
  }

  return 0;
};

const getSearchText = (item) => [
  item?.deskLabel,
  item?.tenantName,
  item?.ownerName,
  item?.contractTenantName,
]
  .filter(Boolean)
  .join(' ')
  .toLowerCase();

const RealEstateRentLedgerTab = ({ classId }) => {
  const { formatCurrency, userData } = useUser();
  const { showFeedback } = useFeedback();

  const [pageRecords, setPageRecords] = useState([]);
  const [searchRecords, setSearchRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busyAction, setBusyAction] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [searchLoaded, setSearchLoaded] = useState(false);
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [dragMode, setDragMode] = useState(null);

  const pageCursorRef = useRef([null]);
  const dragSelectionRef = useRef({ active: false, mode: 'select', visited: new Set() });

  const canManageHistory = userData?.role === 'teacher' || userData?.role === 'admin';
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const isSearchMode = normalizedSearchTerm.length > 0;

  const resetPagination = useCallback(() => {
    setPageRecords([]);
    setHasNextPage(false);
    setCurrentPage(1);
    setSelectedIds([]);
    pageCursorRef.current = [null];
  }, []);

  const loadSearchRecords = useCallback(async ({ force = false } = {}) => {
    if (!classId) {
      setSearchRecords([]);
      setSearchLoaded(false);
      return;
    }

    if (searchLoaded && !force) return;

    setLoading(true);
    try {
      const paymentsQuery = query(
        collection(db, 'classes', classId, 'real_estate', 'rent_payments', 'records'),
        orderBy('paidAt', 'desc'),
      );
      const snapshot = await getDocs(paymentsQuery);
      setSearchRecords(snapshot.docs.map(mapDoc));
      setSearchLoaded(true);
    } catch (error) {
      console.error('[RealEstateRentLedgerTab] failed to load search records:', error);
      showFeedback('임대기록을 불러오지 못했습니다.', 'error');
      setSearchRecords([]);
    } finally {
      setLoading(false);
    }
  }, [classId, searchLoaded, showFeedback]);

  const loadServerPage = useCallback(async (pageIndex) => {
    if (!classId) {
      setPageRecords([]);
      setHasNextPage(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const paymentsQuery = query(
        collection(db, 'classes', classId, 'real_estate', 'rent_payments', 'records'),
        orderBy('paidAt', 'desc'),
      );

      const { items, hasMore, nextCursor } = await fetchCursorPage({
        baseQuery: paymentsQuery,
        startCursor: pageCursorRef.current[pageIndex] || null,
        pageSize: PAGE_SIZE,
        mapDoc,
      });

      pageCursorRef.current[pageIndex + 1] = nextCursor;
      setPageRecords(items);
      setHasNextPage(hasMore);
    } catch (error) {
      console.error('[RealEstateRentLedgerTab] failed to load page:', error);
      showFeedback('임대기록을 불러오지 못했습니다.', 'error');
      setPageRecords([]);
      setHasNextPage(false);
    } finally {
      setLoading(false);
    }
  }, [classId, showFeedback]);

  useEffect(() => {
    setSearchRecords([]);
    setSearchLoaded(false);
    resetPagination();
  }, [classId, resetPagination]);

  useEffect(() => {
    resetPagination();
  }, [searchTerm, resetPagination]);

  useEffect(() => {
    if (!isSearchMode) return;
    loadSearchRecords();
  }, [isSearchMode, loadSearchRecords]);

  useEffect(() => {
    if (!classId || isSearchMode) return;
    loadServerPage(currentPage - 1);
  }, [classId, currentPage, isSearchMode, loadServerPage]);

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragSelecting(false);
      setDragMode(null);
      dragSelectionRef.current = { active: false, mode: 'select', visited: new Set() };
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const filteredSearchRecords = useMemo(() => (
    searchRecords.filter((item) => getSearchText(item).includes(normalizedSearchTerm))
  ), [normalizedSearchTerm, searchRecords]);

  const totalPages = isSearchMode
    ? Math.max(1, Math.ceil(filteredSearchRecords.length / PAGE_SIZE))
    : null;

  const safeCurrentPage = isSearchMode
    ? Math.min(currentPage, totalPages || 1)
    : currentPage;

  const displayedRecords = useMemo(() => {
    if (!isSearchMode) return pageRecords;
    const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
    return filteredSearchRecords.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredSearchRecords, isSearchMode, pageRecords, safeCurrentPage]);

  const selectedRecords = useMemo(
    () => displayedRecords.filter((item) => selectedIds.includes(item.id)),
    [displayedRecords, selectedIds],
  );

  const visibleCount = isSearchMode ? filteredSearchRecords.length : displayedRecords.length;
  const pageStart = visibleCount === 0 ? 0 : (safeCurrentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = visibleCount === 0 ? 0 : pageStart + displayedRecords.length - 1;
  const allVisibleSelected =
    displayedRecords.length > 0 && displayedRecords.every((item) => selectedIds.includes(item.id));
  const canGoNext = isSearchMode ? safeCurrentPage < (totalPages || 1) : hasNextPage;

  const setSelectionState = useCallback((paymentId, shouldSelect) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shouldSelect) next.add(paymentId);
      else next.delete(paymentId);
      return Array.from(next);
    });
  }, []);

  const isInteractiveTarget = useCallback((event) => {
    const target = event?.target;
    if (!target || typeof target.closest !== 'function') return false;

    return Boolean(
      target.closest('input, button, textarea, select, a, label, [data-no-drag]'),
    );
  }, []);

  const handleRowMouseDown = useCallback((item, event) => {
    if (!canManageHistory || isInteractiveTarget(event)) return;

    const shouldSelect = !selectedIds.includes(item.id);
    const nextMode = shouldSelect ? 'select' : 'deselect';

    setIsDragSelecting(true);
    setDragMode(nextMode);
    dragSelectionRef.current = {
      active: true,
      mode: nextMode,
      visited: new Set([item.id]),
    };
    setSelectionState(item.id, shouldSelect);
  }, [canManageHistory, isInteractiveTarget, selectedIds, setSelectionState]);

  const handleRowMouseEnter = useCallback((item) => {
    const dragState = dragSelectionRef.current;
    if (!dragState.active || dragState.visited.has(item.id)) return;

    dragState.visited.add(item.id);
    setSelectionState(item.id, dragState.mode === 'select');
  }, [setSelectionState]);

  const toggleSelection = (paymentId) => {
    if (!canManageHistory) return;
    setSelectionState(paymentId, !selectedIds.includes(paymentId));
  };

  const toggleSelectAllVisible = () => {
    if (!canManageHistory) return;

    if (allVisibleSelected) {
      setSelectedIds([]);
      return;
    }

    setSelectedIds(displayedRecords.map((item) => item.id));
  };

  const handlePageChange = (nextPage) => {
    if (nextPage < 1) return;
    if (isSearchMode) {
      if (nextPage > (totalPages || 1)) return;
    } else if (nextPage > currentPage && !hasNextPage) {
      return;
    }

    setCurrentPage(nextPage);
    setSelectedIds([]);
  };

  const handleDeleteSelected = async () => {
    if (!canManageHistory) {
      showFeedback('임대기록을 정리할 권한이 없습니다.', 'error');
      return;
    }

    if (selectedRecords.length === 0) {
      showFeedback('삭제할 임대기록을 먼저 선택해 주세요.', 'warning');
      return;
    }

    const confirmed = (await appConfirm(`선택한 임대기록 ${selectedRecords.length}건을 삭제할까요?\n\n기록 문서만 삭제되며, 관련 현금 이동은 되돌리지 않습니다. 현재 계약 납부 집계는 남은 기록 기준으로 다시 계산됩니다.`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}));
    if (!confirmed) return;

    setBusyAction('delete');
    try {
      const recordsByDesk = selectedRecords.reduce((map, item) => {
        const deskId = String(item?.deskId || '').trim();
        if (!deskId) return map;
        if (!map.has(deskId)) {
          map.set(deskId, []);
        }
        map.get(deskId).push(item.id);
        return map;
      }, new Map());

      for (const [deskId, paymentIds] of recordsByDesk.entries()) {
        await updateRealEstateRentPaymentStateAPI({
          classId,
          deskId,
          action: 'delete',
          paymentIds,
        });
      }

      if (isSearchMode) {
        const selectedIdSet = new Set(selectedRecords.map((item) => item.id));
        setSearchRecords((prev) => prev.filter((item) => !selectedIdSet.has(item.id)));
      } else {
        const shouldGoPrev = currentPage > 1 && selectedRecords.length === displayedRecords.length;
        if (shouldGoPrev) {
          setCurrentPage((prev) => Math.max(1, prev - 1));
        } else {
          await loadServerPage(currentPage - 1);
        }
      }

      setSelectedIds([]);
      showFeedback(`${selectedRecords.length}건의 임대기록을 삭제했습니다.`, 'success');
    } catch (error) {
      showFeedback(error.message || '임대기록 삭제 중 오류가 발생했습니다.', 'error');
    } finally {
      setBusyAction('');
    }
  };

  if (!canManageHistory) {
    return null;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <InputField
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="자리, 임차인, 소유자 검색"
              tone="slate"
              wrapperClassName="space-y-0"
              className="py-2.5 pl-11 pr-4 font-semibold text-slate-800"
            />
          </div>

          <Button
            onClick={toggleSelectAllVisible}
            disabled={displayedRecords.length === 0}
            tone="slate"
            kind="outline"
            size="xs"
            rounded="lg"
            
          >
            {allVisibleSelected ? '현재 페이지 선택 해제' : '현재 페이지 전체 선택'}
          </Button>
        </div>

      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <SectionLoader
            message={"\uC784\uB300\uB8CC \uAE30\uB85D\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4."}
            tone="slate"
            size="sm"
            showSkeleton={false}
            minHeightClassName="min-h-[320px]"
          />
        ) : displayedRecords.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="조건에 맞는 임대기록이 없습니다"
            description="검색어나 기간 조건을 조정해 다시 확인해 보세요."
            className="min-h-[320px]"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1080px] w-full text-sm">
              <thead className="bg-slate-50 text-[11px] font-black text-slate-500">
                <tr>
                  <th className="w-14 px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      data-no-drag
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      aria-label="현재 페이지 전체 선택"
                    />
                  </th>
                  <th className="px-4 py-3 text-left">납부일시</th>
                  <th className="px-4 py-3 text-left">자리</th>
                  <th className="px-4 py-3 text-left">임차인</th>
                  <th className="px-4 py-3 text-left">소유자</th>
                  <th className="px-4 py-3 text-left">납부기간</th>
                  <th className="px-4 py-3 text-right">납부일수</th>
                  <th className="px-4 py-3 text-right">금액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedRecords.map((item) => {
                  const isSelected = selectedIds.includes(item.id);

                  return (
                    <tr
                      key={item.id}
                      onMouseDown={(event) => handleRowMouseDown(item, event)}
                      onMouseEnter={() => handleRowMouseEnter(item)}
                      className={`cursor-pointer select-none transition-colors ${
                        isSelected ? 'bg-emerald-50' : 'hover:bg-slate-50'
                      } ${isDragSelecting && dragMode ? 'select-none' : ''}`}
                    >
                      <td className="px-4 py-3 align-middle text-center">
                        <input
                          type="checkbox"
                          data-no-drag
                          checked={isSelected}
                          onChange={() => toggleSelection(item.id)}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          aria-label={`${item.deskLabel || '임대기록'} 선택`}
                        />
                      </td>
                      <td className="px-4 py-3 align-middle text-slate-600">
                        {formatDateTimeText(item.paidAt)}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="font-bold text-slate-900">
                          {item.deskLabel || '자리 이름 없음'}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle font-bold text-slate-800">
                        {item.tenantName || '-'}
                      </td>
                      <td className="px-4 py-3 align-middle font-semibold text-slate-600">
                        {item.ownerName || '국유지'}
                      </td>
                      <td className="px-4 py-3 align-middle text-slate-600">
                        {formatCoverageRange(item)}
                      </td>
                      <td className="px-4 py-3 align-middle text-right font-bold text-slate-700">
                        {getPaymentDays(item)}일
                      </td>
                      <td className="px-4 py-3 align-middle text-right">
                        <div className="font-black text-emerald-600">
                          {formatCurrency(item.amount || 0)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && displayedRecords.length > 0 ? (
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3 text-sm">
            <span className="font-semibold text-slate-600">
              {isSearchMode
                ? `검색 ${visibleCount}건 중 ${pageStart}-${pageEnd} / ${safeCurrentPage}/${totalPages || 1}페이지`
                : `${pageStart}-${pageEnd} 표시 / ${safeCurrentPage}페이지`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => handlePageChange(safeCurrentPage - 1)}
                disabled={safeCurrentPage <= 1}
                tone="slate"
                kind="outline"
                size="sm"
                rounded="lg"
                
              >
                이전
              </Button>
              <Button
                onClick={() => handlePageChange(safeCurrentPage + 1)}
                disabled={!canGoNext}
                tone="slate"
                kind="outline"
                size="sm"
                rounded="lg"
                
              >
                다음
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {selectedIds.length > 0 ? (
        <BulkActionFloatingBar
          count={selectedIds.length}
          tone="rose"
          icon={Trash2}
          eyebrow="임대기록 삭제"
          title="선택한 임대기록을 삭제합니다"
          subtitle="임대기록 문서만 지워지고, 관련 현금 이동은 그대로 유지됩니다."
          actions={[
            {
              key: 'delete',
              label: `삭제 ${selectedIds.length}건`,
              onClick: handleDeleteSelected,
              icon: Trash2,
              tone: 'rose',
              kind: 'outline',
              disabled: busyAction === 'delete',
              isLoading: busyAction === 'delete',
            },
          ]}
          onClear={() => setSelectedIds([])}
          clearLabel="선택 해제"
        />
      ) : null}
    </div>
  );
};

export default RealEstateRentLedgerTab;
