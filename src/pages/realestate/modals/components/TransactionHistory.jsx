import { appConfirm } from "../../../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { ArrowLeft, FileText, Gavel, Trash2 } from 'lucide-react';
import { db } from '../../../../firebase';
import { useUser } from '../../../../contexts/UserContext';
import { useFeedback } from '../../../../contexts/FeedbackContext';
import {
  BulkActionFloatingBar,
  Button,
  EmptyState,
  IconButton,
  SurfaceLoader,
  TableSkeleton,
} from '../../../../components/ui';
import { updateRealEstateLedgerStateAPI } from '../../services/realEstateService';
import { fetchCursorPage } from '../../utils/firestoreCursorPaging';

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
    title: `${counterparty.leftName} → ${counterparty.rightName}`,
    caption: `${counterparty.leftLabel} / ${counterparty.rightLabel}`,
  };
};

const TransactionHistory = ({ desk, classId, onBack, embedded = false }) => {
  const { formatCurrency, userData } = useUser();
  const { showFeedback } = useFeedback();

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busyAction, setBusyAction] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [dragMode, setDragMode] = useState(null);

  const pageCursorRef = useRef([null]);
  const dragSelectionRef = useRef({ active: false, mode: 'select', visited: new Set() });

  const canManageHistory = userData?.role === 'teacher' || userData?.role === 'admin';

  const loadPage = useCallback(async (pageIndex) => {
    if (!desk?.id || !classId) {
      setRecords([]);
      setHasNextPage(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const baseQuery = query(
        collection(db, 'classes', classId, 'real_estate', 'ledger', 'transactions'),
        where('deskId', '==', desk.id),
        orderBy('timestamp', 'desc'),
      );

      const { items, hasMore, nextCursor } = await fetchCursorPage({
        baseQuery,
        startCursor: pageCursorRef.current[pageIndex] || null,
        pageSize: PAGE_SIZE,
        mapDoc,
      });

      pageCursorRef.current[pageIndex + 1] = nextCursor;
      setRecords(items);
      setHasNextPage(hasMore);
    } catch (error) {
      console.error('[TransactionHistory] failed to load:', error);
      showFeedback('거래기록을 불러오지 못했습니다.', 'error');
      setRecords([]);
      setHasNextPage(false);
    } finally {
      setLoading(false);
    }
  }, [classId, desk?.id, showFeedback]);

  useEffect(() => {
    setRecords([]);
    setSelectedIds([]);
    setCurrentPage(1);
    setHasNextPage(false);
    pageCursorRef.current = [null];
  }, [classId, desk?.id]);

  useEffect(() => {
    if (!classId || !desk?.id) return;
    loadPage(currentPage - 1);
  }, [classId, currentPage, desk?.id, loadPage]);

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragSelecting(false);
      setDragMode(null);
      dragSelectionRef.current = { active: false, mode: 'select', visited: new Set() };
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const selectedRecords = useMemo(
    () => records.filter((item) => selectedIds.includes(item.id)),
    [records, selectedIds],
  );

  const pageStart = records.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = records.length === 0 ? 0 : pageStart + records.length - 1;
  const allVisibleSelected =
    records.length > 0 && records.every((item) => selectedIds.includes(item.id));
  const hasRecords = records.length > 0;

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

    setSelectedIds(records.map((item) => item.id));
  };

  const handlePageChange = (nextPage) => {
    if (nextPage < 1) return;
    if (nextPage > currentPage && !hasNextPage) return;

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

      const shouldGoPrev = currentPage > 1 && selectedRecords.length === records.length;
      setSelectedIds([]);

      if (shouldGoPrev) {
        setCurrentPage((prev) => Math.max(1, prev - 1));
      } else {
        await loadPage(currentPage - 1);
      }

      showFeedback(`${selectedRecords.length}건의 거래기록을 삭제했습니다.`, 'success');
    } catch (error) {
      showFeedback(error.message || '거래기록 삭제 중 오류가 발생했습니다.', 'error');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className={`flex h-full flex-col ${embedded ? '' : 'pt-2'}`}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        {!embedded ? (
          <div className="flex items-center gap-2">
            <IconButton
              icon={ArrowLeft}
              label="뒤로가기"
              onClick={onBack}
              className="rounded-full"
            />
            <div>
              <div className="text-lg font-black text-slate-800">거래기록</div>
              <div className="text-xs text-slate-400">이 자리의 거래기록만 20개씩 불러옵니다.</div>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-sm font-black text-slate-800">거래기록</div>
            <div className="text-[11px] text-slate-400">이 자리의 거래기록만 표시합니다.</div>
          </div>
        )}

        {canManageHistory ? (
          <Button
            size="sm"
            tone="slate"
            kind="outline"
            rounded="full"
            onClick={toggleSelectAllVisible}
            disabled={records.length === 0}
          >
            {allVisibleSelected ? '현재 페이지 선택 해제' : '현재 페이지 전체 선택'}
          </Button>
        ) : null}
      </div>

      <div className="mb-3 shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        거래기록 문서만 삭제됩니다. 관련 현금 이동, 세금, 소유권은 그대로 유지됩니다.
      </div>

      <div className={`flex-1 overflow-y-auto custom-scrollbar ${embedded ? 'pr-2' : 'pr-1'}`}>
        <SurfaceLoader
          loading={loading}
          variant={hasRecords ? 'refreshing' : 'surface-loading'}
          preserveContent={hasRecords}
          skeleton={(
            <TableSkeleton
              bare
              columns={5}
              rows={6}
              className="h-full min-h-full"
            />
          )}
          minHeightClassName="min-h-[280px]"
        >
          {hasRecords ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="min-w-[900px] w-full text-sm">
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
                    <th className="px-4 py-3 text-left">유형</th>
                    <th className="px-4 py-3 text-left">내용</th>
                    <th className="px-4 py-3 text-right">금액</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((item) => {
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
                            aria-label="거래기록 선택"
                          />
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-600">
                          {formatDateText(item.timestamp)}
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
                                <span>{getTradeCounterparty(item).leftName}</span>
                                <Gavel size={14} className="text-slate-300" />
                                <span>{getTradeCounterparty(item).rightName}</span>
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
          ) : (
            <EmptyState
              icon={FileText}
              title="거래기록이 없습니다"
              description="거래가 발생하면 이곳에서 기록을 확인할 수 있습니다."
              className="min-h-[220px]"
            />
          )}
        </SurfaceLoader>
      </div>

      {hasRecords ? (
        <div className="mt-3 flex shrink-0 items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <span className="font-semibold text-slate-600">
            {pageStart}-{pageEnd} 표시 / {currentPage}페이지
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              tone="slate"
              kind="outline"
              rounded="full"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              이전
            </Button>
            <Button
              size="sm"
              tone="slate"
              kind="outline"
              rounded="full"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={!hasNextPage}
            >
              다음
            </Button>
          </div>
        </div>
      ) : null}

      {canManageHistory && selectedIds.length > 0 ? (
        <BulkActionFloatingBar
          count={selectedIds.length}
          tone="rose"
          icon={Trash2}
          eyebrow="거래기록 삭제"
          title="선택한 거래기록을 삭제합니다"
          subtitle="거래기록 문서만 삭제되고, 관련 현금 이동과 소유권 반영은 유지됩니다."
          zIndex={1105}
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

export default TransactionHistory;
