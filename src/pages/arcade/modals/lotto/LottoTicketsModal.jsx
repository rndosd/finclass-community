import React, { useState, useEffect } from 'react';
import {
    Ticket, Clock, PartyPopper,
    Sparkles, Trophy, Info
} from 'lucide-react';
import { Modal, Button, Badge } from '../../../../components/ui';

const LottoTicketsModal = ({ isOpen, onClose, tickets, roundData }) => {
    const [timeLeft, setTimeLeft] = useState("");
    const settings = roundData?.settings;
    const isRoundFinished = roundData?.status === 'finished';
    const resultsVisible = isRoundFinished && roundData?.resultsPublished !== false;
    const isFinished = resultsVisible;
    const winningNumbers = roundData?.winningNumbers || [];
    const bonusNumber = roundData?.bonusNumber;

    // 🕒 카운트다운 로직 (판매 중일 때만 작동)
    useEffect(() => {
        if (!settings?.endTime || isFinished) return;

        const timer = setInterval(() => {
            const now = new Date().getTime();
            const end = new Date(settings.endTime).getTime();
            const diff = end - now;

            if (diff <= 0) {
                setTimeLeft("판매 종료");
                clearInterval(timer);
            } else {
                const h = Math.floor(diff / (1000 * 60 * 60));
                const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const s = Math.floor((diff % (1000 * 60)) / 1000);
                setTimeLeft(`${h}시간 ${m}분 ${s}초 남음`);
            }
        }, 1000);

        return () => clearInterval(timer);
    }, [settings?.endTime, isFinished]);

    // 번호대별 공 색상 (가독성을 위해 로또 테마 적용)
    const getBallColor = (num, isMatched = false) => {
        if (!isMatched && isFinished) return 'bg-slate-100 text-slate-400 border-slate-200'; // 미당첨 번호
        if (num <= 10) return 'bg-yellow-400 text-white border-yellow-500 shadow-yellow-100';
        if (num <= 20) return 'bg-blue-400 text-white border-blue-500 shadow-blue-100';
        if (num <= 30) return 'bg-rose-400 text-white border-rose-500 shadow-rose-100';
        if (num <= 40) return 'bg-slate-500 text-white border-slate-600 shadow-slate-100';
        return 'bg-emerald-500 text-white border-emerald-600 shadow-emerald-100';
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="lg"
            closeOnOverlayClick={false}
        >
            <Modal.Header>
                <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-2xl text-white shadow-lg ${isFinished ? 'bg-indigo-600' : 'bg-rose-500'}`}>
                        {isFinished ? <Trophy size={20} /> : <Ticket size={20} />}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-black text-slate-800">{settings?.title || "행운의 복권 확인"}</h2>
                            <Badge tone="slate" size="xs">#{roundData?.id?.split('_')[1]?.slice(-4)}</Badge>
                        </div>
                        {isFinished ? (
                            <p className="text-[10px] font-black text-indigo-500 flex items-center gap-1 uppercase tracking-widest">
                                <Sparkles size={12} /> 추첨 결과 발표 완료
                            </p>
                        ) : settings?.endTime && (
                            <div className="flex items-center gap-1 text-rose-500 font-black text-[10px] animate-pulse">
                                <Clock size={12} /> {timeLeft}
                            </div>
                        )}
                    </div>
                </div>
            </Modal.Header>

            <Modal.Body className="space-y-6 max-h-[65vh] overflow-y-auto pr-2 custom-scrollbar">
                {isRoundFinished && !resultsVisible && (
                    <div className="rounded-[2rem] border border-amber-100 bg-amber-50 px-5 py-4 text-center">
                        <p className="text-sm font-black text-amber-700">
                            선생님이 추첨 결과를 확정하면 당첨 결과가 공개됩니다.
                        </p>
                    </div>
                )}

                {/* 🏆 [상단] 당첨 번호 결과판 (추첨 완료 시에만 노출) */}
                {isFinished && (
                    <div className="p-6 bg-slate-900 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10"><PartyPopper size={80} className="text-white" /></div>
                        <h4 className="text-center text-[10px] font-black uppercase tracking-[0.4em] text-indigo-400 mb-4">당첨 번호</h4>
                        <div className="flex justify-center items-center gap-2">
                            {winningNumbers.map((num, i) => (
                                <div key={i} className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-black ${getBallColor(num, true)}`}>
                                    {num}
                                </div>
                            ))}
                            {bonusNumber && (
                                <>
                                    <span className="text-white font-black mx-1">+</span>
                                    <div className="w-10 h-10 rounded-full border-2 bg-amber-400 text-white border-amber-500 flex items-center justify-center text-sm font-black shadow-lg shadow-amber-900/20">
                                        {bonusNumber}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* 🎫 [중단] 티켓 리스트 */}
                <div className="space-y-3">
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest px-2">나의 보유 티켓 ({tickets.length})</h4>

                    {tickets.length === 0 ? (
                        <div className="py-12 text-center bg-slate-50 rounded-[2.5rem] border-2 border-dashed border-slate-100">
                            <Ticket size={40} className="mx-auto text-slate-200 mb-2" />
                            <p className="text-slate-400 font-bold text-sm">구매한 티켓이 없습니다.</p>
                        </div>
                    ) : (
                        tickets.map((ticket, idx) => {
                            // 당첨 여부 계산
                            const matchedCount = ticket.numbers.filter(n => winningNumbers.includes(n)).length;
                            const isBonusMatched = bonusNumber != null && ticket.numbers.includes(bonusNumber);

                            return (
                                <div key={ticket.id} className={`group bg-white border-2 rounded-[2rem] p-5 transition-all shadow-sm ${isFinished && ticket.rankName ? 'border-indigo-500 bg-indigo-50/30' : 'border-slate-100'}`}>
                                    <div className="flex justify-between items-center mb-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-black text-slate-300 uppercase">티켓 번호 {tickets.length - idx}</span>
                                            {isFinished && matchedCount > 0 && (
                                                <span className="text-[10px] font-black text-indigo-500">{matchedCount}개 일치</span>
                                            )}
                                            {isFinished && isBonusMatched && (
                                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-600 border border-amber-200">
                                                    보너스 일치
                                                </span>
                                            )}
                                        </div>
                                        {isFinished && ticket.rankName ? (
                                            <Badge tone="indigo" kind="solid" size="xs" className="animate-bounce">🎉 {ticket.rankName} 당첨!</Badge>
                                        ) : isFinished && (
                                            <span className="text-[10px] font-bold text-slate-300 italic">미당첨</span>
                                        )}
                                    </div>

                                    <div className="flex justify-center gap-2">
                                        {ticket.numbers.map((num, nIdx) => {
                                            const isMatched = winningNumbers.includes(num);
                                            const isBonus = num === bonusNumber;
                                            return (
                                                <div
                                                    key={nIdx}
                                                    className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-black transition-all duration-500 ${getBallColor(num, isMatched || isBonus)} ${isMatched || isBonus ? 'scale-110' : 'opacity-40'}`}
                                                >
                                                    {num}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </Modal.Body>

            <Modal.Footer className="bg-slate-50/50">
                <div className="flex flex-col w-full gap-3">
                    {!isFinished && (
                        <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-2xl border border-slate-200 shadow-sm">
                            <Info size={16} className="text-slate-400" />
                            <p className="text-[10px] font-bold text-slate-500 leading-tight">
                                추첨 결과는 판매 마감 후 선생님이 직접 <br />추첨을 진행해야 공개됩니다! 조금만 기다려주세요.
                            </p>
                        </div>
                    )}
                    <Button size="md" tone="slate" kind="ghost" fullWidth onClick={onClose} >닫기</Button>
                </div>
            </Modal.Footer>
        </Modal>
    );
};

export default LottoTicketsModal;
