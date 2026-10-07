import { appConfirm } from "../../../utils/appDialogs";
import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
// src/pages/tax/modals/RebuildTaxSummaryModal.jsx
import React, { useState, useMemo, useEffect } from 'react';
import Modal from '../../../components/ui/Modal';
import { Button } from '../../../components/ui';
import { useFeedback } from '../../../contexts/FeedbackContext';
import {
    rebuildTaxSummary,
    rebuildTaxSummaryInRange,
} from '../../tax/services/dashboardTaxService';
// [ADD] meta 갱신을 위해 요약 문서 단발성 조회
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';

const RebuildTaxSummaryModal = ({
    isOpen,
    onClose,
    classId,
    defaultStart = '',
    defaultEnd = '',
    onAfterRebuild, // 선택
    // [ADD] 카드에서 현재 메타를 넘겨받아 초기 표시
    summaryMeta, // { rebuiltRange?: {startDate,endDate}, lastRebuiltAt?: Timestamp } | undefined
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

    const { showFeedback } = useFeedback();
    const [startDate, setStartDate] = useState(defaultStart);
    const [endDate, setEndDate] = useState(defaultEnd);
    const [loadingFull, setLoadingFull] = useState(false);
    const [loadingRange, setLoadingRange] = useState(false);

    // [ADD] 모달 상단에 보여줄 메타 상태
    const [meta, setMeta] = useState({
        rebuiltRange: summaryMeta?.rebuiltRange ?? null,
        lastRebuiltAt: summaryMeta?.lastRebuiltAt ?? null,
    });

    // [ADD] 외부 prop이 바뀌면 초기화
    useEffect(() => {
        setMeta({
            rebuiltRange: summaryMeta?.rebuiltRange ?? null,
            lastRebuiltAt: summaryMeta?.lastRebuiltAt ?? null,
        });
    }, [summaryMeta?.rebuiltRange, summaryMeta?.lastRebuiltAt]);

    const rangeValid = useMemo(() => {
        if (!startDate || !endDate) return false;
        return startDate <= endDate;
    }, [startDate, endDate]);

    // [ADD] 재계산 후 최신 메타를 한 번 읽어와서 즉시 반영
    const refreshMeta = async () => {
        if (!classId) return;
        const snap = await getDoc(doc(db, `classes/${classId}/dashboardSummary/taxSummary`));
        if (snap.exists()) {
            const d = snap.data();
            setMeta({
                rebuiltRange: d.rebuiltRange ?? null,
                lastRebuiltAt: d.lastRebuiltAt ?? null,
            });
        }
    };

    const runFull = async () => {
        if (!classId) return;
        if (!(await appConfirm('반 전체 기간을 재계산할까요?'))) return;
        setLoadingFull(true);
        try {
            const res = await rebuildTaxSummary(classId);
            if (res?.success) {
                await refreshMeta();
                showFeedback(
                    `재계산 완료 (전체). 일수: ${res.daysCount}, 수입: ${formatDisplayMoney(Number(res.totalIncome || 0))}, 지출: ${formatDisplayMoney(Number(res.totalExpense || 0))}`,
                    'success',
                    { toastId: `rebuild-full-${classId}` }
                );
                // onAfterRebuild?.(res);  // ✅ 중복 토스트 방지를 위해 제거
            } else {
                showFeedback(`재계산 실패: ${res?.message || '알 수 없는 오류'}`, 'error', { toastId: `rebuild-full-err-${classId}` });
            }
        } catch (e) {
            showFeedback(`재계산 실패: ${e?.message || '알 수 없는 오류'}`, 'error', { toastId: `rebuild-full-err-${classId}` });
        } finally {
            setLoadingFull(false);
        }
    };

    const runRange = async () => {
        if (!classId) return;
        if (!rangeValid) {
            showFeedback('기간이 올바르지 않습니다. 시작일과 종료일을 확인하세요.', 'warning', { toastId: `rebuild-range-warn-${classId}` });
            return;
        }
        if (!(await appConfirm(`${startDate} ~ ${endDate} 범위를 재계산할까요?`))) return;
        setLoadingRange(true);
        try {
            const res = await rebuildTaxSummaryInRange(classId, startDate, endDate);
            if (res?.success) {
                await refreshMeta();
                showFeedback(
                    `재계산 완료 (기간). 일수: ${res.daysCount}, 수입: ${formatDisplayMoney(Number(res.totalIncome || 0))}, 지출: ${formatDisplayMoney(Number(res.totalExpense || 0))}`,
                    'success',
                    { toastId: `rebuild-range-${classId}-${startDate}-${endDate}` }
                );
                // onAfterRebuild?.(res);  // ✅ 중복 토스트 방지를 위해 제거
            } else {
                showFeedback(`재계산 실패: ${res?.message || '알 수 없는 오류'}`, 'error', { toastId: `rebuild-range-err-${classId}` });
            }
        } catch (e) {
            showFeedback(`재계산 실패: ${e?.message || '알 수 없는 오류'}`, 'error', { toastId: `rebuild-range-err-${classId}` });
        } finally {
            setLoadingRange(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="세금 요약 재계산"
            size="sm"
            closeOnOverlayClick={!loadingFull && !loadingRange}
        >
            {/* [ADD] 현재 메타 표시 영역 */}
            <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-1 mb-4">
                <div className="text-slate-600">
                    표시 범위:&nbsp;
                    {meta.rebuiltRange
                        ? `${meta.rebuiltRange.startDate} ~ ${meta.rebuiltRange.endDate} (기간 재계산)`
                        : '전체 기간'}
                </div>
                {meta.lastRebuiltAt && (
                    <div className="text-slate-500">
                        마지막 재계산:&nbsp;
                        {meta.lastRebuiltAt.toDate().toLocaleString('ko-KR')}
                    </div>
                )}
            </div>

            <div className="space-y-4 text-sm">
                <p className="text-slate-600">
                    전체 기간 또는 특정 기간을 선택할 수 있어요.
                </p>

                <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500">시작일</label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500">종료일</label>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                </div>

                {!rangeValid && (startDate || endDate) && (
                    <div className="text-xs text-red-500">시작일은 종료일보다 늦을 수 없습니다.</div>
                )}
            </div>

            <Modal.Footer>
                <Button
                    variant="secondary"
                    onClick={onClose}
                    disabled={loadingFull || loadingRange}
                >
                    닫기
                </Button>
                <Button tone="blue" kind="solid" size="md"
                    onClick={runFull}
                    disabled={loadingFull || loadingRange}
                    
                >
                    {loadingFull ? '전체 재계산 중…' : '전체 재계산'}
                </Button>
                <Button tone="blue" kind="solid" size="md"
                    onClick={runRange}
                    disabled={!rangeValid || loadingFull || loadingRange}
                    
                >
                    {loadingRange ? '기간 재계산 중…' : '기간 재계산'}
                </Button>
            </Modal.Footer>
        </Modal>
    );
};

export default RebuildTaxSummaryModal;
