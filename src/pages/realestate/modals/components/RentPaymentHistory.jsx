import { appConfirm } from "../../../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { FileText, Trash2 } from 'lucide-react';
import { db } from '../../../../firebase';
import { useFeedback } from '../../../../contexts/FeedbackContext';
import { useUser } from '../../../../contexts/UserContext';
import {
  BulkActionFloatingBar,
  Button,
  EmptyState,
  SurfaceLoader,
  TableSkeleton,
} from '../../../../components/ui';
import { updateRealEstateRentPaymentStateAPI } from '../../services/realEstateService';
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

const RentPaymentHistory = ({ desk, classId, embedded = false, showHeader = true }) => {
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
        collection(db, 'classes', classId, 'real_estate', 'rent_payments', 'records'),
        where('deskId', '==', desk.id),
        orderBy('paidAt', 'desc'),
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
      console.error('[RentPaymentHistory] failed to load:', error);
      showFeedback('임대기록을 불러오지 못했습니다.', 'error');
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
      await updateRealEstateRentPaymentStateAPI({
        classId,
        deskId: desk.id,
        action: 'delete',
        paymentIds: selectedRecords.map((item) => item.id),
      });

      const shouldGoPrev = currentPage > 1 && selectedRecords.length === records.length;
      setSelectedIds([]);

      if (shouldGoPrev) {
        setCurrentPage((prev) => Math.max(1, prev - 1));
      } else {
        await loadPage(currentPage - 1);
      }

      showFeedback(`${selectedRecords.length}건의 임대기록을 삭제했습니다.`, 'success');
    } catch (error) {
      showFeedback(error.message || '임대기록 삭제 중 오류가 발생했습니다.', 'error');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className={`flex h-full flex-col ${embedded ? '' : 'pt-2'}`}>
      {showHeader ? (
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black text-slate-800">임대기록</div>
            <div className="text-[11px] text-slate-400">이 자리의 임대기록만 20개씩 불러옵니다.</div>
          </div>
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
      ) : null}

      {canManageHistory ? (
        <div className="mb-3 shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          임대기록 문서만 삭제됩니다. 관련 현금 이동은 그대로 유지되고, 현재 계약 납부 집계는 다시 계산됩니다.
        </div>
      ) : null}

      <div className={`flex-1 overflow-y-auto custom-scrollbar ${embedded ? 'pr-2' : 'pr-1'}`}>
        <SurfaceLoader
          loading={loading}
          variant={hasRecords ? 'refreshing' : 'surface-loading'}
          preserveContent={hasRecords}
          skeleton={(
            <TableSkeleton
              bare
              columns={canManageHistory ? 7 : 6}
              rows={6}
              className="h-full min-h-full"
            />
          )}
          minHeightClassName="min-h-[280px]"
        >
          {hasRecords ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="min-w-[860px] w-full text-sm">
                <thead className="bg-slate-50 text-[11px] font-black text-slate-500">
                  <tr>
                    {canManageHistory ? (
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
                    ) : null}
                    <th className="px-4 py-3 text-left">납부일시</th>
                    <th className="px-4 py-3 text-left">임차인</th>
                    <th className="px-4 py-3 text-left">소유자</th>
                    <th className="px-4 py-3 text-left">납부기간</th>
                    <th className="px-4 py-3 text-right">납부일수</th>
                    <th className="px-4 py-3 text-right">금액</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((item) => {
                    const isSelected = selectedIds.includes(item.id);

                    return (
                      <tr
                        key={item.id}
                        onMouseDown={(event) => handleRowMouseDown(item, event)}
                        onMouseEnter={() => handleRowMouseEnter(item)}
                        className={`${canManageHistory ? 'cursor-pointer' : ''} select-none transition-colors ${
                          isSelected ? 'bg-emerald-50' : canManageHistory ? 'hover:bg-slate-50' : ''
                        } ${isDragSelecting && dragMode ? 'select-none' : ''}`}
                      >
                        {canManageHistory ? (
                          <td className="px-4 py-3 align-middle text-center">
                            <input
                              type="checkbox"
                              data-no-drag
                              checked={isSelected}
                              onChange={() => toggleSelection(item.id)}
                              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              aria-label="임대기록 선택"
                            />
                          </td>
                        ) : null}
                        <td className="px-4 py-3 align-middle text-slate-600">
                          {formatDateTimeText(item.paidAt)}
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
                        <td className="px-4 py-3 align-middle text-right font-black text-emerald-600">
                          {formatCurrency(item.amount || 0)}
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
              title="임대기록이 없습니다"
              description="임대료 납부가 발생하면 이곳에서 기록을 확인할 수 있습니다."
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
          eyebrow="임대기록 삭제"
          title="선택한 임대기록을 삭제합니다"
          subtitle="임대기록 문서만 삭제되고, 관련 현금 이동은 유지됩니다."
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

export default RentPaymentHistory;
