import { appConfirm } from "../../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { FileText, Gavel, Search, Trash2 } from 'lucide-react';
import { db } from '../../../firebase';
import { useUser } from '../../../contexts/UserContext';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { Button, BulkActionFloatingBar, EmptyState, InputField, SectionLoader } from '../../../components/ui';
import { updateRealEstateLedgerStateAPI } from '../services/realEstateService';
import RealEstateRentLedgerTab from './RealEstateRentLedgerTab';
import { fetchFilteredCursorPage } from '../utils/firestoreCursorPaging';

const PAGE_SIZE = 20;

const TYPE_FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'sale', label: '매매' },
  { id: 'auction_sale', label: '경매 낙찰' },
  { id: 'market_adjustment', label: '시세 조정' },
  { id: 'reclaim', label: '강제 회수' },
];

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

const formatDateText = (value) => {
  const timestamp = getTimestampValue(value);
  if (!timestamp) return '날짜 없음';
  return new Date(timestamp).toLocaleDateString('ko-KR');
};

const getTypeInfo = (item) => {
  if (item.type === 'sale') {
    return { label: '부동산 매매', color: 'bg-blue-100 text-blue-700' };
  }
  if (item.type === 'auction_sale') {
    return {
      label: item.source === 'foreclosure' ? '압류 경매 낙찰' : '공공 경매 낙찰',
      color:
        item.source === 'foreclosure'
          ? 'bg-rose-100 text-rose-700'
          : 'bg-indigo-100 text-indigo-700',
    };
  }
  if (item.type === 'reclaim') {
    return { label: '강제 회수', color: 'bg-rose-100 text-rose-700' };
  }
  if (item.type === 'market_adjustment') {
    if (item.changeMode === 'fixed') {
      return { label: '시세 직접 수정', color: 'bg-amber-100 text-amber-700' };
    }
    if (Number(item.changePercent || 0) > 0) {
      return { label: '시세 상승', color: 'bg-red-100 text-red-600' };
    }
    if (Number(item.changePercent || 0) < 0) {
      return { label: '시세 하락', color: 'bg-blue-100 text-blue-600' };
    }
    return { label: '시세 조정', color: 'bg-slate-100 text-slate-600' };
  }
  return { label: '기타', color: 'bg-slate-100 text-slate-600' };
};

const getTradeCounterparty = (item) => {
  if (item.type === 'reclaim') {
    return {
      leftLabel: '회수 대상',
      leftName: item.previousOwnerName || item.sellerName || '-',
      rightLabel: '회수처',
      rightName: '국유지',
    };
  }

  return {
    leftLabel: item.type === 'auction_sale' ? '매각 주체' : '매도자',
    leftName: item.sellerName || item.previousOwnerName || '-',
    rightLabel: item.type === 'auction_sale' ? '낙찰자' : '매수자',
    rightName: item.buyerName || '-',
  };
};

const getLedgerAmount = (item) => (
  item.type === 'market_adjustment'
    ? Number(item.newPrice || 0)
    : Number(item.finalPrice || item.amount || item.refundAmount || 0)
);

const getSearchText = (item) => [
  item?.deskLabel,
  item?.buyerName,
  item?.sellerName,
  item?.previousOwnerName,
  item?.reason,
  item?.ownerName,
]
  .filter(Boolean)
  .join(' ')
  .toLowerCase();

const getDetailText = (item, formatCurrency) => {
  if (item.type === 'market_adjustment') {
    const modeText = item.changeMode === 'fixed'
      ? '직접 금액 지정'
      : `${Number(item.changePercent || 0) > 0 ? '+' : ''}${Number(item.changePercent || 0)}%`;

    return {
      title: item.reason || '사유 없음',
      caption: `${formatCurrency(item.previousPrice || 0)} -> ${formatCurrency(item.newPrice || 0)} / ${modeText}`,
    };
  }

  const counterparty = getTradeCounterparty(item);
  return {
    title: `${counterparty.leftName} ${item.type === 'auction_sale' ? '→' : '→'} ${counterparty.rightName}`,
    caption: `${counterparty.leftLabel} / ${counterparty.rightLabel}`,
  };
};

const RealEstateLedgerTab = ({ classId }) => {
  const { formatCurrency, userData } = useUser();
  const { showFeedback } = useFeedback();

  const [pageRecords, setPageRecords] = useState([]);
  const [searchRecords, setSearchRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busyAction, setBusyAction] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [searchLoaded, setSearchLoaded] = useState(false);
  const [ledgerMode, setLedgerMode] = useState('trade');
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
      const ledgerQuery = query(
        collection(db, 'classes', classId, 'real_estate', 'ledger', 'transactions'),
        orderBy('timestamp', 'desc'),
      );
      const snapshot = await getDocs(ledgerQuery);
      setSearchRecords(snapshot.docs.map(mapDoc));
      setSearchLoaded(true);
    } catch (error) {
      console.error('[RealEstateLedgerTab] failed to load search records:', error);
      showFeedback('거래기록을 불러오지 못했습니다.', 'error');
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
      const ledgerQuery = query(
        collection(db, 'classes', classId, 'real_estate', 'ledger', 'transactions'),
        orderBy('timestamp', 'desc'),
      );

      const { items, hasMore, nextCursor } = await fetchFilteredCursorPage({
        baseQuery: ledgerQuery,
        startCursor: pageCursorRef.current[pageIndex] || null,
        pageSize: PAGE_SIZE,
        filterFn: (item) => typeFilter === 'all' || item.type === typeFilter,
        mapDoc,
      });

      pageCursorRef.current[pageIndex + 1] = nextCursor;
      setPageRecords(items);
      setHasNextPage(hasMore);
    } catch (error) {
      console.error('[RealEstateLedgerTab] failed to load page:', error);
      showFeedback('거래기록을 불러오지 못했습니다.', 'error');
      setPageRecords([]);
      setHasNextPage(false);
    } finally {
      setLoading(false);
    }
  }, [classId, showFeedback, typeFilter]);

  useEffect(() => {
    setSearchRecords([]);
    setSearchLoaded(false);
    resetPagination();
  }, [classId, resetPagination]);

  useEffect(() => {
    resetPagination();
  }, [typeFilter, searchTerm, resetPagination]);

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
    searchRecords
      .filter((item) => typeFilter === 'all' || item.type === typeFilter)
      .filter((item) => getSearchText(item).includes(normalizedSearchTerm))
  ), [normalizedSearchTerm, searchRecords, typeFilter]);

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

  const setSelectionState = useCallback((ledgerId, shouldSelect) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shouldSelect) next.add(ledgerId);
      else next.delete(ledgerId);
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

  const toggleSelection = (ledgerId) => {
    if (!canManageHistory) return;
    setSelectionState(ledgerId, !selectedIds.includes(ledgerId));
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
      showFeedback('거래기록을 정리할 권한이 없습니다.', 'error');
      return;
    }

    if (selectedRecords.length === 0) {
      showFeedback('삭제할 거래기록을 먼저 선택해 주세요.', 'warning');
      return;
    }

    const confirmed = (await appConfirm(`선택한 거래기록 ${selectedRecords.length}건을 삭제할까요?\n\n기록 문서만 삭제되며, 관련 현금 이동·세금·소유권은 되돌리지 않습니다.`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}));
    if (!confirmed) return;

    setBusyAction('delete');
    try {
      await updateRealEstateLedgerStateAPI({
        classId,
        action: 'delete',
        ledgerIds: selectedRecords.map((item) => item.id),
      });

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
      showFeedback(`${selectedRecords.length}건의 거래기록을 삭제했습니다.`, 'success');
    } catch (error) {
      showFeedback(error.message || '거래기록 삭제 중 오류가 발생했습니다.', 'error');
    } finally {
      setBusyAction('');
    }
  };

  if (!canManageHistory) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => setLedgerMode('trade')}
          tone={ledgerMode === 'trade' ? 'blue' : 'slate'}
          kind={ledgerMode === 'trade' ? 'soft' : 'outline'}
          size="sm"
          rounded="lg"
          
        >
          거래기록
        </Button>
        <Button
          onClick={() => setLedgerMode('rent')}
          tone={ledgerMode === 'rent' ? 'emerald' : 'slate'}
          kind={ledgerMode === 'rent' ? 'soft' : 'outline'}
          size="sm"
          rounded="lg"
          
        >
          임대기록
        </Button>
      </div>

      {ledgerMode === 'rent' ? (
        <RealEstateRentLedgerTab classId={classId} />
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-md">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <InputField
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="자리, 매수자, 매도자, 사유 검색"
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

            <div className="mt-3 flex flex-wrap gap-2">
              {TYPE_FILTERS.map((filter) => (
                <Button
                  key={filter.id}
                  onClick={() => setTypeFilter(filter.id)}
                  tone="slate"
                  kind={typeFilter === filter.id ? 'solid' : 'outline'}
                  size="xs"
                  rounded="lg"
                  
                >
                  {filter.label}
                </Button>
              ))}
            </div>

          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {loading ? (
              <SectionLoader
                message={"\uAC70\uB798 \uAE30\uB85D\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4."}
                tone="slate"
                size="sm"
                showSkeleton={false}
                minHeightClassName="min-h-[320px]"
              />
            ) : displayedRecords.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="조건에 맞는 거래기록이 없습니다"
                description="검색어나 거래 유형 필터를 조정해 다시 확인해 보세요."
                className="min-h-[320px]"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[920px] w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] font-black text-slate-500">
                    <tr>
                      <th className="w-14 px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          data-no-drag
                          checked={allVisibleSelected}
                          onChange={toggleSelectAllVisible}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          aria-label="현재 페이지 전체 선택"
                        />
                      </th>
                      <th className="px-4 py-3 text-left">날짜</th>
                      <th className="px-4 py-3 text-left">자리</th>
                      <th className="px-4 py-3 text-left">유형</th>
                      <th className="px-4 py-3 text-left">내용</th>
                      <th className="px-4 py-3 text-right">금액</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedRecords.map((item) => {
                      const typeInfo = getTypeInfo(item);
                      const isSelected = selectedIds.includes(item.id);
                      const detail = getDetailText(item, formatCurrency);
                      const amount = getLedgerAmount(item);

                      return (
                        <tr
                          key={item.id}
                          onMouseDown={(event) => handleRowMouseDown(item, event)}
                          onMouseEnter={() => handleRowMouseEnter(item)}
                          className={`cursor-pointer select-none transition-colors ${
                            isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50'
                          } ${isDragSelecting && dragMode ? 'select-none' : ''}`}
                        >
                          <td className="px-4 py-3 align-middle text-center">
                            <input
                              type="checkbox"
                              data-no-drag
                              checked={isSelected}
                              onChange={() => toggleSelection(item.id)}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              aria-label={`${item.deskLabel || '거래기록'} 선택`}
                            />
                          </td>
                          <td className="px-4 py-3 align-middle text-slate-600">
                            {formatDateText(item.timestamp)}
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <div className="font-bold text-slate-900">
                              {item.deskLabel || '자리 이름 없음'}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-black ${typeInfo.color}`}>
                              {typeInfo.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-middle">
                            {item.type === 'auction_sale' ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 font-bold text-slate-800">
                                  <span>{detail.title.split(' → ')[0] || detail.title}</span>
                                  <Gavel size={14} className="text-slate-300" />
                                  <span>{detail.title.split(' → ')[1] || ''}</span>
                                </div>
                                <div className="text-xs text-slate-500">{detail.caption}</div>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <div className="font-bold text-slate-800">{detail.title}</div>
                                <div className="text-xs text-slate-500">{detail.caption}</div>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 align-middle text-right">
                            <div className="font-black text-indigo-600">{formatCurrency(amount)}</div>
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
              eyebrow="거래기록 삭제"
              title="선택한 거래기록을 삭제합니다"
              subtitle="거래기록 문서만 지워지고, 관련 현금 이동과 소유권 반영은 그대로 유지됩니다."
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
        </>
      )}
    </div>
  );
};

export default RealEstateLedgerTab;
