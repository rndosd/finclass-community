// src/pages/bank/modals/subscription/lottery/LotteryHistoryTab.jsx
import React, { useMemo } from 'react';
import { ClockIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { formatBankMoney } from '../../../../../utils/bankMoney';

const fmtDateTime = (d) => {
    try {
        const date = d?.toDate ? d.toDate() : d instanceof Date ? d : null;
        return date ? date.toLocaleString() : '';
    } catch {
        return '';
    }
};

const Badge = ({ children, tone = 'slate' }) => {
    const tones = {
        slate: 'bg-slate-100 text-slate-700 ring-slate-200',
        yellow: 'bg-yellow-100 text-yellow-800 ring-yellow-200',
        green: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
        purple: 'bg-purple-100 text-purple-700 ring-purple-200',
    };
    return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${tones[tone] || tones.slate}`}>
            {children}
        </span>
    );
};

const WinnerPill = ({ w, i, currencyUnit }) => (
    <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-100 border border-yellow-200 text-yellow-800 text-sm font-semibold">
            {i + 1}
        </div>
        <div className="min-w-0">
            <div className="truncate font-semibold text-yellow-900">{w.name}</div>
            <div className="text-xs text-yellow-800">
                납입 {w.paymentCount}회 · {formatBankMoney(w.totalAmount || 0)} {currencyUnit}
                {w.score != null && <> · {w.score}점</>}
            </div>
        </div>
    </div>
);

const HistoryItem = ({ r, currencyUnit }) => {
    const methodLabel = r.selectionMethod === 'lottery' ? '추첨제' : '가점제';
    const dateStr = fmtDateTime(r.lotteryDate) || fmtDateTime(r.updatedAt) || fmtDateTime(r.createdAt);

    return (
        <li className="relative pl-8">
            {/* 타임라인 점 */}
            <span className="absolute left-0 top-2 h-3 w-3 rounded-full bg-purple-500 ring-4 ring-purple-100" />

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Badge tone="purple">{r.roundNumber}회차</Badge>
                        <Badge tone={r.selectionMethod === 'lottery' ? 'yellow' : 'green'}>
                            {methodLabel}
                        </Badge>
                        {r.preventDuplicateWinners && <Badge>중복 방지</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                        <ClockIcon className="h-4 w-4" />
                        <span>{dateStr}</span>
                    </div>
                </div>

                <div className="p-4 space-y-3">
                    {r.title && <div className="text-slate-800 font-medium">{r.title}</div>}

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <Badge>필요 납입 {r.requiredPayments}회</Badge>
                        <Badge tone="green">당첨 {r.winnerCount}명</Badge>
                        <Badge>참여 {r.totalParticipants || 0}명</Badge>
                    </div>

                    {/* 당첨자 리스트 */}
                    {Array.isArray(r.winners) && r.winners.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                            {r.winners.map((w, i) => (
                                <WinnerPill key={`${w.uid}-${i}`} w={w} i={i} currencyUnit={currencyUnit} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <CheckCircleIcon className="h-5 w-5 text-slate-400" />
                            당첨자 정보가 없습니다.
                        </div>
                    )}
                </div>
            </div>
        </li>
    );
};

const LotteryHistoryTab = ({ completedRounds = [], pastRounds = [], currencyUnit = '' }) => {
    // ✅ completedRounds 우선 사용, 없으면 과거 값 폴백
    const data = useMemo(() => {
        const base = Array.isArray(completedRounds) && completedRounds.length > 0
            ? completedRounds
            : (Array.isArray(pastRounds) ? pastRounds : []);
        // 최신 회차 우선 (roundNumber desc)
        return [...base].sort((a, b) => (b.roundNumber || 0) - (a.roundNumber || 0));
    }, [completedRounds, pastRounds]);

    const stats = useMemo(() => {
        const totalRounds = data.length;
        const totalWinners = data.reduce((sum, r) => sum + (Array.isArray(r.winners) ? r.winners.length : 0), 0);
        return { totalRounds, totalWinners };
    }, [data]);

    if (!data.length) {
        return (
            <div className="text-center py-12">
                <ClockIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-600">아직 기록된 과거 추첨 회차가 없습니다.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* 상단 요약 배지 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-slate-800 font-semibold">과거 추첨 히스토리</div>
                <div className="flex items-center gap-2">
                    <Badge tone="purple">회차 {stats.totalRounds}건</Badge>
                    <Badge tone="green">총 당첨 {stats.totalWinners}명</Badge>
                </div>
            </div>

            {/* 타임라인 */}
            <ol className="relative border-l border-purple-200 pl-3 space-y-6">
                {data.map((r) => (
                    <HistoryItem key={r.id} r={r} currencyUnit={currencyUnit} />
                ))}
            </ol>
        </div>
    );
};

export default LotteryHistoryTab;
