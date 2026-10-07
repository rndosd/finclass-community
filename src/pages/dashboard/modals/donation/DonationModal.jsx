import { useNumberFormat as useMoneyDisplay } from "../../../../contexts/NumberFormatContext";
// src/pages/dashboard/modals/DonationModal.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button, InputField, Spinner } from '../../../../components/ui';
import { makeDonation } from '../../services/donationService';
import { useUser } from '../../../../contexts/UserContext';
import { useFeedback } from '../../../../contexts/FeedbackContext';
import { auth, db } from '../../../../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { HandHeart } from 'lucide-react';
import { beginFirestoreSubscriptionDebug } from '../../../../utils/firestoreSubscriptionDebug';
import { getSpendableBankBalance } from '../../../../utils/bankMoney';
import { createFinancialRequestTracker } from '../../../../utils/financialRequests';

const DonationModal = ({ isOpen, onClose, classId }) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

    const { userData, classData, user } = useUser();
    const { showFeedback /*, clearFeedback */ } = useFeedback();
    const currencyUnit = classData?.currencyUnit || '단위';
    const uid = user?.uid || userData?.uid || auth.currentUser?.uid || null;
    // Each account/class needs a fresh request scope, including after a switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const requests = useMemo(() => createFinancialRequestTracker(), [classId, uid]);

    const [amount, setAmount] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [currentCash, setCurrentCash] = useState(0);
    const [isCashLoading, setIsCashLoading] = useState(true);
    const [cashReadError, setCashReadError] = useState(false);

    // 숫자 파싱/검증
    const parsedAmount = useMemo(() => Number(amount), [amount]);
    const isAmountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
    const requestKey = String(Math.floor(parsedAmount));
    const isPendingRetry = requests.has(requestKey);

    // 모달 열릴 때 상태 초기화 + 현금 실시간 구독
    useEffect(() => {
        if (!isOpen) return;

        setAmount('');
        setIsSubmitting(false);
        setIsCashLoading(true);
        setCashReadError(false);
        // clearFeedback?.();

        if (!classId || !uid) {
            setIsCashLoading(false);
            return;
        }

        const studentDocRef = doc(db, `classes/${classId}/students/${uid}`);
        const subscriptionDebug = beginFirestoreSubscriptionDebug({
            source: 'DonationModal.cash',
            pathKey: 'classes/{classId}/students/{uid}',
            classId,
            role: userData?.role,
        });
        const unsub = onSnapshot(
            studentDocRef,
            (snap) => {
                subscriptionDebug.recordSnapshot(snap);
                const cash = Math.max(0, getSpendableBankBalance(snap.data()?.assets));
                setCurrentCash(cash);
                setCashReadError(false);
                setIsCashLoading(false);
            },
            (err) => {
                subscriptionDebug.recordError(err);
                console.error('[DonationModal] listen cash error:', err);
                setCashReadError(true);
                setIsCashLoading(false);
                showFeedback("잔액을 불러오지 못했어요. 기부할 때 다시 확인해요.", 'warning');
            }
        );
        return () => {
            unsub();
            subscriptionDebug.stop();
        };
    }, [isOpen, classId, uid, showFeedback, userData?.role]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!isAmountValid) {
            showFeedback('올바른 금액을 입력해주세요.', 'warning');
            return;
        }
        if (!isPendingRetry && !cashReadError && parsedAmount > currentCash) {
            showFeedback(
                `보유 현금(${formatDisplayMoney(currentCash)} ${currencyUnit})보다 많은 금액은 기부할 수 없습니다.`,
                'warning'
            );
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await requests.run(requestKey, (clientRequestId) =>
                makeDonation({ classId, amount: parsedAmount, clientRequestId }));
            if (result?.success) {
                showFeedback(result.message || '기부가 완료되었습니다.', 'success');
                setAmount('');
                onClose?.();
            } else {
                showFeedback(result?.message || '기부 처리 중 오류가 발생했습니다.', 'error');
            }
        } catch (err) {
            console.error('[DonationModal] makeDonation error:', err);
            showFeedback('기부 처리 중 오류가 발생했습니다.', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                        <HandHeart className="h-4 w-4" />
                    </span>
                    <span className="font-semibold">기부하기</span>
                </div>
            }
        >
            <form onSubmit={handleSubmit} className="space-y-5">
                {/* 안내 텍스트 */}
                <p className="text-xs md:text-sm text-slate-500">
                    따뜻한 마음을 나눠주셔서 감사합니다. 기부금은 학급 공동 자산으로 소중히 사용됩니다.
                </p>

                {/* 잔액 카드 */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 shadow-sm p-4">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">사용 가능한 현금</span>
                        {/* 작게 숫자 업데이트 표시 여지 */}
                    </div>

                    <div className="mt-1">
                        {isCashLoading ? (
                            <div className="h-8 flex items-center">
                                <Spinner size="sm" />
                            </div>
                        ) : (
                            <div className="text-2xl font-extrabold tracking-tight text-slate-800">
                                {formatDisplayMoney(currentCash)} <span className="text-sm text-slate-500">{currencyUnit}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 입력 영역 */}
                <div className="space-y-2">
                    <label htmlFor="donation-amount" className="block text-sm font-medium text-slate-700">
                        기부할 금액
                    </label>
                    <InputField
                        id="donation-amount"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder={`예: 1000 (${currencyUnit})`}
                        required
                    />
                    {!isCashLoading && amount && !isAmountValid && (
                        <p className="text-xs text-rose-600">1 이상의 숫자를 입력하세요.</p>
                    )}
                    {!isCashLoading && !cashReadError && parsedAmount > currentCash && (
                        <p className="text-xs text-rose-600">
                            보유 현금({formatDisplayMoney(currentCash)} {currencyUnit})을 초과했습니다.
                        </p>
                    )}
                    {!isCashLoading && cashReadError && (
                        <p className="text-xs text-amber-600">
                            잔액을 불러오지 못했어요. 기부할 때 잔액을 다시 확인해요.
                        </p>
                    )}
                </div>

                {/* 액션 바 */}
                <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                    <Button type="button" onClick={onClose} variant="secondary" disabled={isSubmitting}>
                        취소
                    </Button>
                    <Button
                        type="submit"
                        disabled={
                            isSubmitting ||
                            isCashLoading ||
                            !isAmountValid ||
                            (!isPendingRetry && !cashReadError && parsedAmount > currentCash)
                        }
                    >
                        {isSubmitting ? (
                            <>
                                <Spinner size="xs" className="mr-2" /> 기부 중…
                            </>
                        ) : (
                            '기부하기'
                        )}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

export default DonationModal;
