import React from 'react';
import { DollarSign, Wallet, ArrowRight, Calculator, AlertCircle, X, Check } from 'lucide-react';
import { Button, IconButton } from '../../../components/ui';

const PaymentConfirmationModal = ({ 
    isOpen, 
    onClose, 
    onConfirm, 
    desk, 
    user, 
    price, 
    acquisitionTax, 
    totalCost, 
    formatCurrency, 
    deskLabel,
    taxRate // ✅ 0 또는 설정된 세율이 넘어옵니다.
}) => {
    if (!isOpen) return null;

    // 잔고 계산
    const currentBalance = user?.assets?.cash || 0;
    const remainingBalance = currentBalance - totalCost;
    const isInsufficient = remainingBalance < 0;

    return (
        <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                
                {/* 1. 헤더 */}
                <div className="bg-slate-900 text-white p-4 flex justify-between items-center shrink-0">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                        <DollarSign size={20} className="text-yellow-400"/> 최종 송금 확인
                    </h3>
                    <IconButton icon={X} label="닫기" onClick={onClose} className="text-slate-300 hover:bg-white/10 hover:text-white" />
                </div>

                {/* 2. 본문 */}
                <div className="p-5 overflow-y-auto custom-scrollbar">
                    {/* 대상 부동산 정보 */}
                    <div className="text-center mb-6">
                        <p className="text-slate-500 text-sm mb-1">계약 대상 부동산</p>
                        <h4 className="text-xl font-extrabold text-slate-800">{deskLabel || desk.label || '이름 없는 자리'}</h4>
                    </div>

                    {/* 금액 명세서 */}
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2 mb-6">
                        <div className="flex justify-between text-sm text-slate-600">
                            <span>매매 대금</span>
                            <span>{formatCurrency(price)}</span>
                        </div>
                        
                        {/* 취득세 표시 (0원이면 회색, 있으면 빨간색 강조) */}
                        <div className={`flex justify-between text-sm ${acquisitionTax > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
                            <span>취득세 ({taxRate}%)</span>
                            <span className={acquisitionTax > 0 ? "text-red-500" : ""}>
                                + {formatCurrency(acquisitionTax)}
                            </span>
                        </div>

                        {/* 구분선 및 총계 */}
                        <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between items-center font-bold text-slate-900">
                            <span>총 결제 금액</span>
                            <span className="text-lg text-blue-600">{formatCurrency(totalCost)}</span>
                        </div>
                    </div>

                    {/* 내 지갑 변동 예상 (Before & After) */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-1.5 text-slate-500">
                                <Wallet size={14} /> 현재 내 보유금
                            </span>
                            <span className="font-medium text-slate-700">{formatCurrency(currentBalance)}</span>
                        </div>
                        
                        <div className="flex justify-center text-slate-300 my-1">
                            <ArrowRight size={16} className="rotate-90" />
                        </div>

                        <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-1.5 text-slate-500">
                                <Calculator size={14} /> 결제 후 잔액
                            </span>
                            {/* 잔액 부족 시 빨간색 표시 */}
                            <span className={`font-bold text-lg ${isInsufficient ? 'text-red-600' : 'text-green-600'}`}>
                                {formatCurrency(remainingBalance)}
                            </span>
                        </div>
                    </div>

                    {/* 🚨 잔액 부족 경고 메시지 */}
                    {isInsufficient && (
                        <div className="mt-4 bg-red-50 text-red-600 text-xs p-3 rounded-lg flex items-start gap-2 animate-pulse">
                            <AlertCircle size={16} className="shrink-0 mt-0.5" />
                            <span>
                                잔액이 부족합니다. (부족 금액: {formatCurrency(Math.abs(remainingBalance))})
                            </span>
                        </div>
                    )}
                </div>

                {/* 3. 하단 버튼 */}
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
                    <Button
                        tone="slate"
                        kind="outline"
                        fullWidth
                        onClick={onClose}
                    >
                        취소
                    </Button>
                    <Button
                        tone="blue"
                        fullWidth
                        onClick={onConfirm}
                        disabled={isInsufficient} // 돈 없으면 클릭 불가
                        className={`flex-1 text-white flex items-center justify-center gap-2 transition-all  ${isInsufficient 
                                ? 'bg-slate-300 cursor-not-allowed' 
                                : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
                            }`}
                    >
                        <Check size={18} /> 송금하기
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default PaymentConfirmationModal;
