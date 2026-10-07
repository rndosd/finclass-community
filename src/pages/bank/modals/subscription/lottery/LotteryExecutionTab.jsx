// src/pages/bank/modals/subscription/lottery/LotteryExecutionTab.jsx
import React, { useEffect, useRef, useState } from 'react';
import { TrophyIcon, UserGroupIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { Button, CardSkeleton, SectionLoader, Spinner } from '../../../../../components/ui';
import { formatBankMoney } from '../../../../../utils/bankMoney';

const LotteryExecutionTab = ({
    mode = 'participants',
    currentRound,
    participants,
    loadingParticipants,
    executeRound,
    currencyUnit,
    showFeedback,
    onClose,
}) => {
    const safeParticipants = Array.isArray(participants) ? participants : [];

    // 상태 관리
    const [drawingPhase, setDrawingPhase] = useState('ready'); // ready | countdown | drawing | results
    const [countdown, setCountdown] = useState(3);
    const [winners, setWinners] = useState(currentRound?.winners || []);
    const [isExecuting, setIsExecuting] = useState(false);
    const [lockResults, setLockResults] = useState(false);

    const hasExecutedRef = useRef(false);
    const countdownTimerRef = useRef(null);
    const prevRoundIdRef = useRef(currentRound?.id || null);

    // 🔄 회차나 상태 변경 시 리셋
    useEffect(() => {
        if (lockResults) return; // 결과가 고정된 상태면 무시

        const roundId = currentRound?.id ?? null;
        if (prevRoundIdRef.current !== roundId) {
            prevRoundIdRef.current = roundId;
            hasExecutedRef.current = false;
            setDrawingPhase('ready');
            setWinners(currentRound?.winners || []);
            return;
        }

        const winnersLen = currentRound?.winners?.length ?? 0;
        if (winnersLen > 0) {
            setWinners(currentRound.winners || []);
            setDrawingPhase('results');
            hasExecutedRef.current = true;
        } else {
            setWinners([]);
            setDrawingPhase('ready');
            hasExecutedRef.current = false;
        }
    }, [currentRound?.id, currentRound?.status, currentRound?.winners, currentRound?.winners?.length, lockResults]);

    // 언마운트 시 타이머 정리
    useEffect(() => {
        return () => {
            if (countdownTimerRef.current) {
                clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
            }
        };
    }, []);

    /** 🕒 카운트다운 시작 */
    const startCountdown = () => {
        if (hasExecutedRef.current || isExecuting || drawingPhase !== 'ready') return;
        setDrawingPhase('countdown');
        setCountdown(3);

        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(countdownTimerRef.current);
                    countdownTimerRef.current = null;
                    setTimeout(handleExecuteLottery, 300);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    /** 🎲 추첨 실행 */
    const handleExecuteLottery = async () => {
        if (hasExecutedRef.current || isExecuting) return;
        if (!currentRound?.id) {
            showFeedback?.('진행할 회차가 없습니다.', 'error');
            setDrawingPhase('ready');
            return;
        }

        setIsExecuting(true);
        setDrawingPhase('drawing');

        try {
            const result = await executeRound(currentRound.id);

            if (result?.success) {
                const nextWinners =
                    Array.isArray(result?.winners) && result.winners.length > 0
                        ? result.winners
                        : currentRound?.winners || [];

                if (nextWinners.length > 0) {
                    setWinners(nextWinners);
                    setDrawingPhase('results');
                    hasExecutedRef.current = true;
                    setLockResults(true); // ✅ 결과 고정
                } else {
                    setTimeout(() => {
                        const latest = currentRound?.winners || [];
                        if (latest.length > 0) {
                            setWinners(latest);
                            setDrawingPhase('results');
                            hasExecutedRef.current = true;
                            setLockResults(true);
                        } else {
                            setDrawingPhase('ready');
                        }
                    }, 400);
                }
            } else {
                showFeedback?.(result?.message || '추첨 실행 실패', 'error');
                setDrawingPhase('ready');
            }
        } catch (e) {
            showFeedback?.('추첨 실행 중 오류가 발생했습니다.', 'error');
            setDrawingPhase('ready');
        } finally {
            setIsExecuting(false);
        }
    };

    const handleClose = () => {
        setLockResults(false);
        hasExecutedRef.current = false;
        onClose?.();
    };

    /* -------------------- 참가자 섹션 -------------------- */
    const ParticipantsSection = () => (
        <div className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900 text-center">
                {currentRound?.title || '추첨'} 참여자 목록
            </h3>
            {loadingParticipants ? (
                <SectionLoader
                    loading
                    message="참여자 정보를 불러오는 중..."
                    minHeightClassName="min-h-[240px]"
                    skeleton={<CardSkeleton bare className="h-full min-h-full" rows={4} />}
                />
            ) : safeParticipants.length === 0 ? (
                <div className="text-center py-12">
                    <UserGroupIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">추첨 자격을 충족한 참여자가 없습니다.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {safeParticipants.map((p) => (
                        <div key={p.uid} className="bg-white p-4 rounded-lg border shadow-sm">
                            <h4 className="font-semibold text-gray-900">{p.name}</h4>
                            <p className="text-sm text-gray-600 mt-2">납입 {p.paymentCount}회</p>
                            <p className="text-sm text-gray-600">총 납입액: {formatBankMoney(p.totalAmount || 0)} {currencyUnit}</p>
                            {p.score != null && <p className="text-sm text-indigo-600">점수: {p.score}점</p>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    /* -------------------- 추첨 실행 섹션 -------------------- */
    const ExecuteSection = () => (
        <div className="text-center space-y-8">
            {drawingPhase === 'ready' && (
                <>
                    <h3 className="text-2xl font-bold">추첨 준비 완료!</h3>
                    <p className="text-gray-600">
                        {safeParticipants.length}명이 참여했습니다. 당첨자 {currentRound?.winnerCount}명을 선발합니다.
                    </p>
                    <Button
                        type="button"
                        onClick={startCountdown}
                        disabled={safeParticipants.length === 0 || isExecuting || hasExecutedRef.current}
                        tone="blue"
                        size="xl"
                        rounded="xl"
                        className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-12 py-6 rounded-xl text-xl font-bold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                    >
                        {isExecuting ? '추첨 중...' : '추첨 시작하기'}
                    </Button>
                </>
            )}

            {drawingPhase === 'countdown' && (
                <div>
                    <h3 className="text-3xl font-bold mb-8">추첨 시작!</h3>
                    <div className="text-9xl font-bold text-purple-600 animate-pulse">{countdown}</div>
                </div>
            )}

            {drawingPhase === 'drawing' && (
                <div>
                    <h3 className="text-2xl font-bold mb-8">추첨 중...</h3>
                    <Spinner
                        size="xl"
                        tone="indigo"
                        message={"\uB2F9\uCCA8\uC790\uB97C \uC120\uC815\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4..."}
                    />
                </div>
            )}

            {drawingPhase === 'results' && (
                <div className="space-y-6">
                    <div className="flex items-center justify-center gap-2 text-green-700 bg-green-50 p-3 rounded-lg">
                        <CheckCircleIcon className="h-6 w-6" />
                        <span className="font-semibold text-lg">
                            ✅ 추첨이 완료되었습니다! 다음 회차({(currentRound?.roundNumber || 0) + 1}회차)도 계속 참여할 수 있습니다.
                        </span>
                    </div>

                    {winners.map((w, i) => (
                        <div key={`${w.uid}-${i}`} className="bg-yellow-100 p-6 rounded-xl border-2 border-yellow-300 shadow-sm">
                            <TrophyIcon className="h-10 w-10 text-yellow-600 mx-auto mb-2" />
                            <h4 className="text-2xl font-bold text-yellow-900">{i + 1}등: {w.name}</h4>
                            <p className="text-yellow-800">
                                납입 {w.paymentCount}회 · 총 {formatBankMoney(w.totalAmount || 0)} {currencyUnit}
                                {w.score != null && <> · {w.score}점</>}
                            </p>
                        </div>
                    ))}

                    <div className="flex gap-4 justify-center mt-6">

                        <Button
                            type="button"
                            onClick={handleClose}
                            tone="slate"
                            size="md"
                            rounded="lg"
                            className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-medium"
                        >
                            닫기
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );

    if (mode === 'participants') return <ParticipantsSection />;
    if (mode === 'execute') return <ExecuteSection />;
    return <ExecuteSection />;
};

export default LotteryExecutionTab;
