import React, { useEffect, useState } from 'react';
import { FileSignature, Check, ShieldCheck, Calculator, DollarSign, User, AlertCircle, XCircle, TrendingUp, CalendarDays } from 'lucide-react';
import { Button } from '../../../components/ui';
import SignaturePad from '../../../components/ui/SignaturePad';
import PaymentConfirmationModal from './PaymentConfirmationModal';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { renderRealEstateContractTemplate } from '../utils/contractTemplate';
import { sanitizeRichHtml } from '../../../utils/sanitizeRichHtml';
import { formatDateInKST, formatDateKeyInKST } from '../../../utils/kstDate';

const CONTRACT_CONFIRMATION_TEXT = '위 계약 내용을 확인했습니다.';

const CONTRACT_REVIEW_CHECKLIST = {
    seller: [
        { id: 'seller-desk', label: '내가 파는 자리와 매수인을 확인했습니다.' },
        { id: 'seller-settlement', label: '판매 후 정산되는 금액을 확인했습니다.' },
        { id: 'seller-transfer', label: '계약이 완료되면 소유권이 매수인에게 넘어가는 것을 확인했습니다.' },
    ],
    buyer: [
        { id: 'buyer-desk', label: '내가 사는 자리와 매도인을 확인했습니다.' },
        { id: 'buyer-payment', label: '내가 내야 하는 금액을 확인했습니다.' },
        { id: 'buyer-transfer', label: '결제가 끝나면 소유권이 나에게 넘어오는 것을 확인했습니다.' },
    ],
};

const normalizeConfirmationText = (value) =>
    String(value || '').replace(/\s+/g, ' ').trim();

const getContractDeskLabel = (desk) => {
    const label = String(desk?.label || '').trim();
    if (label) return label;

    const number = String(desk?.number || '').trim();
    if (number) return `${number}번 자리`;

    return '이름 없는 자리';
};

const ContractPaper = ({ 
    desk, 
    user, 
    isSeller, 
    isBuyer, 
    isStateOwned, 
    formatCurrency, 
    onSubmitSignature, 
    onExecutePayment, 
    onCancelContract,
    canManageContract = false,
    loading,
    acquisitionTaxRate = null,  // ✅ 기본값 null (미적용)
    capitalGainsTaxRate = null, // ✅ 기본값 null (미적용)
    contractTemplate = '',      // ✅ 계약서 양식 추가
    classDisplayName = ''
}) => {
    const { showFeedback } = useFeedback();
    // DB에 저장된 계약 상태 + 서명 이미지 URL
    const { 
        sellerSigned, buyerSigned, buyerName,
        sellerSignatureImg, buyerSignatureImg 
    } = desk.contractState || {};
    
    // UI 로컬 상태
    const [isStamped, setIsStamped] = useState(false);
    const [mySignatureBlob, setMySignatureBlob] = useState(null);
    const [checkedReviewIds, setCheckedReviewIds] = useState([]);
    const [signerNameInput, setSignerNameInput] = useState('');
    const [confirmationInput, setConfirmationInput] = useState('');
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

    const iHaveSignedDB = (isSeller && sellerSigned) || (isBuyer && buyerSigned);
    const contractComplete = sellerSigned && buyerSigned;
    const canCancelContract = canManageContract || ((isSeller || isBuyer) && !contractComplete);
    const myContractRole = isBuyer ? 'buyer' : isSeller ? 'seller' : null;
    const myContractRoleLabel = myContractRole === 'seller' ? '매도인' : '매수인';
    const reviewChecklist = myContractRole ? CONTRACT_REVIEW_CHECKLIST[myContractRole] : [];
    const allReviewChecked = reviewChecklist.every((item) => checkedReviewIds.includes(item.id));
    const normalizedSignerName = signerNameInput.trim();
    const normalizedConfirmationInput = normalizeConfirmationText(confirmationInput);
    const confirmationMatches = normalizedConfirmationInput === CONTRACT_CONFIRMATION_TEXT;
    const contractDateKey = formatDateKeyInKST(new Date());
    const contractDateLabel = formatDateInKST(new Date(), 'ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const canSubmitSignature =
        allReviewChecked &&
        Boolean(normalizedSignerName) &&
        confirmationMatches &&
        isStamped;

    useEffect(() => {
        setIsStamped(false);
        setMySignatureBlob(null);
        setCheckedReviewIds([]);
        setSignerNameInput('');
        setConfirmationInput('');
    }, [desk?.id, myContractRole]);

    // ----------------------------------------------------
    // 💰 세금 및 정산 금액 계산 로직
    // ✅ 세율이 null이면 세금 0원 (미적용)
    // ----------------------------------------------------
    
    const price = desk.askingPrice;
    const officialPrice = Number.isFinite(Number(desk.price)) ? Number(desk.price) : 0;
    const stateSellerName = String(classDisplayName || '').trim() || '학급';
    const sellerDisplayName = isStateOwned
        ? stateSellerName
        : desk.ownerName || desk.studentName || '\uC18C\uC720\uC790 \uBBF8\uC0C1';
    const buyerDisplayName = buyerName || '\uB9E4\uC218 \uB300\uAE30';
    const contractDeskLabel = getContractDeskLabel(desk);

    // 1. [매수인] 취득세 계산 (세율이 null이면 0)
    const acquisitionTax = acquisitionTaxRate != null 
        ? Math.floor(price * (acquisitionTaxRate / 100)) 
        : 0;
    const totalCost = price + acquisitionTax;

    // 2. [매도인] 양도소득세 계산 (세율이 null이면 0)
    const lastPrice = desk.lastPurchasePrice || 0; 
    const profit = price - lastPrice;
    
    // 이익이 0보다 클 때만 과세 (손해보고 팔면 세금 0원)
    const capitalGainsTax = (capitalGainsTaxRate != null && profit > 0) 
        ? Math.floor(profit * (capitalGainsTaxRate / 100)) 
        : 0;
    const sellerRevenue = price - capitalGainsTax;

    // ----------------------------------------------------
    // 📄 계약서 양식 변수 치환
    // ----------------------------------------------------
    const renderTemplate = (html) =>
        renderRealEstateContractTemplate(html, {
            sellerName: sellerDisplayName,
            buyerName: buyerDisplayName,
            deskLabel: contractDeskLabel,
            priceLabel: formatCurrency(price),
            acquisitionTaxLabel: formatCurrency(acquisitionTax),
            acquisitionTaxRate,
            totalCostLabel: formatCurrency(totalCost),
            capitalGainsTaxLabel: formatCurrency(capitalGainsTax),
            capitalGainsTaxRate,
            sellerRevenueLabel: formatCurrency(sellerRevenue),
            officialPriceLabel: formatCurrency(officialPrice),
        });

    // ----------------------------------------------------

    const handleFinalAction = () => {
        // 계약 완료 상태에서 매수인이 결제할 때는 모달 오픈
        if (contractComplete && isBuyer) {
            setIsPaymentModalOpen(true);
            return;
        }
        
        // 서명 제출 시 체크
        if (!allReviewChecked) {
            showFeedback("계약서 핵심 내용을 모두 확인해 주세요.", "warning");
            return;
        }
        if (!normalizedSignerName) {
            showFeedback("내 이름을 입력해 주세요.", "warning");
            return;
        }
        if (!confirmationMatches) {
            showFeedback(`확인 문구를 "${CONTRACT_CONFIRMATION_TEXT}"로 입력해 주세요.`, "warning");
            return;
        }
        if (!isStamped && !iHaveSignedDB) {
            showFeedback("서명 패드에 이름을 써서 서명을 완료해주세요.", "warning");
            return;
        }

        if (!iHaveSignedDB && (isSeller || isBuyer)) {
            onSubmitSignature(desk, isSeller, isBuyer, mySignatureBlob, {
                signerName: normalizedSignerName,
                confirmationText: normalizedConfirmationInput,
                reviewChecklistIds: checkedReviewIds,
                contractDateKey,
            });
        }
    };

    const handleConfirmPayment = () => {
        onExecutePayment(desk);
        setIsPaymentModalOpen(false);
    };
    
    const handleSignatureEnd = (dataUrl) => {
        setMySignatureBlob(dataUrl);
        if (dataUrl) {
            setIsStamped(true);
        } else {
            setIsStamped(false);
        }
    };

    const handleSignatureChange = (signed) => {
        if (!signed) {
            setMySignatureBlob(null);
            setIsStamped(false);
        }
    };

    const toggleReviewItem = (itemId) => {
        setCheckedReviewIds((prev) =>
            prev.includes(itemId)
                ? prev.filter((id) => id !== itemId)
                : [...prev, itemId],
        );
    };

    return (
        <div className="relative bg-white m-3 md:m-4 rounded-2xl border border-slate-100 flex flex-col h-[calc(100%-1.5rem)] md:h-[calc(100%-2rem)] font-sans overflow-hidden">
            
            {/* ✅ 최종 결제 확인 모달 */}
            <PaymentConfirmationModal 
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                onConfirm={handleConfirmPayment}
                desk={desk}
                user={user}
                price={price}
                acquisitionTax={acquisitionTax}
                totalCost={totalCost}
                formatCurrency={formatCurrency}
                taxRate={acquisitionTaxRate}
                deskLabel={contractDeskLabel}
            />

            {/* 1. 헤더 */}
            <div className="shrink-0 text-center py-5 border-b border-slate-100 bg-slate-50/50">
                <div className="flex justify-center items-center gap-2 mb-1">
                    <FileSignature size={24} className="text-blue-900" />
                    <h2 className="text-xl font-bold text-slate-900">부동산 매매 계약서</h2>
                </div>
                <p className="text-[10px] text-slate-400 tracking-widest uppercase">Class Real Estate Contract</p>
            </div>

            {/* 2. 본문 (스크롤) */}
            <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
                
                {/* 부동산 정보 */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-6">
                    <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                        <div className="col-span-2 flex justify-between border-b border-slate-200 pb-2 mb-1">
                            <span className="text-slate-500 font-medium">대상 부동산</span>
                            <span className="font-bold text-slate-800">{contractDeskLabel}</span>
                        </div>
                        
                        <div>
                            <span className="block text-xs text-slate-400 mb-0.5">매도인</span>
                            <div className="font-bold text-slate-700 flex items-center gap-1">
                                <User size={14} />
                                {sellerDisplayName}
                            </div>
                        </div>
                        <div>
                            <span className="block text-xs text-slate-400 mb-0.5">매수인</span>
                            <div className="font-bold text-blue-700 flex items-center gap-1">
                                <User size={14} />
                                {buyerDisplayName}
                            </div>
                        </div>
                        <div className="col-span-2 pt-2 mt-1 border-t border-slate-200 flex justify-between items-center">
                            <span className="text-slate-500 font-medium">매매 대금</span>
                            <span className="text-xl font-extrabold text-slate-900">{formatCurrency(desk.askingPrice)}</span>
                        </div>
                    </div>
                </div>

                {/* ✅ [추가] 계약서 양식 (특약 사항) 렌더링 */}
                {contractTemplate && (
                    <div className="mb-6">
                        <h4 className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                            계약서 본문
                        </h4>
                        <div 
                            className="realestate-contract-body prose prose-sm max-w-none rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                            dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(renderTemplate(contractTemplate)) }}
                        />
                    </div>
                )}

                {/* 🧾 [매수인용] 취득세 명세서 (내가 살 때) - 세율이 설정된 경우만 표시 */}
                {isBuyer && !iHaveSignedDB && acquisitionTaxRate != null && (
                    <div className="mb-6 border border-blue-100 bg-blue-50/50 p-4 rounded-xl">
                        <h4 className="font-bold text-slate-700 mb-2 flex items-center gap-1 text-xs">
                            <Calculator size={14} className="text-blue-500" /> 매수인 결제 예상 금액
                        </h4>
                        <div className="space-y-1 text-xs">
                            <div className="flex justify-between text-slate-500">
                                <span>매매 대금</span>
                                <span>{formatCurrency(price)}</span>
                            </div>
                            <div className="flex justify-between text-slate-500">
                                <span>취득세 ({acquisitionTaxRate}%)</span>
                                <span className="text-red-500">+ {formatCurrency(acquisitionTax)}</span>
                            </div>
                            <div className="border-t border-blue-200 my-2 pt-2 flex justify-between items-center">
                                <span className="font-bold text-slate-800">최종 출금액</span>
                                <span className="font-bold text-blue-600 text-base">{formatCurrency(totalCost)}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* 🧾 [매도인용] 양도소득세 명세서 (내가 팔 때) - 세율이 설정된 경우만 표시 */}
                {isSeller && !iHaveSignedDB && capitalGainsTaxRate != null && (
                    <div className="mb-6 border border-emerald-100 bg-emerald-50/50 p-4 rounded-xl">
                        <h4 className="font-bold text-slate-700 mb-2 flex items-center gap-1 text-xs">
                            <TrendingUp size={14} className="text-emerald-500" /> 매도인 정산 예상 금액
                        </h4>
                        <div className="space-y-1 text-xs">
                            <div className="flex justify-between text-slate-500">
                                <span>매매 대금 (수입)</span>
                                <span>{formatCurrency(price)}</span>
                            </div>
                            <div className="flex justify-between text-slate-400">
                                <span>(매입가: {lastPrice > 0 ? formatCurrency(lastPrice) : '기록 없음'})</span>
                                <span>차익: {formatCurrency(profit)}</span>
                            </div>
                            
                            {profit > 0 ? (
                                <div className="flex justify-between text-slate-500">
                                    <span>양도소득세 ({capitalGainsTaxRate}%)</span>
                                    <span className="text-red-500">- {formatCurrency(capitalGainsTax)}</span>
                                </div>
                            ) : (
                                <div className="text-slate-400 text-[10px] text-right">
                                    ※ 시세차익이 없어 양도세가 면제됩니다.
                                </div>
                            )}

                            <div className="border-t border-emerald-200 my-2 pt-2 flex justify-between items-center">
                                <span className="font-bold text-slate-800">최종 입금액</span>
                                <span className="font-bold text-emerald-600 text-base">{formatCurrency(sellerRevenue)}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* 확인 및 서명 준비 */}
                {((isSeller || isBuyer) && !iHaveSignedDB) && (
                    <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm font-black text-slate-800">{myContractRoleLabel} 확인란</p>
                                <p className="text-xs font-medium text-slate-500">
                                    계약서 본문을 읽고 아래 내용을 직접 확인해 주세요.
                                </p>
                            </div>
                            <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600">
                                <CalendarDays size={14} className="text-blue-500" />
                                계약일자 {contractDateLabel}
                            </div>
                        </div>

                        <div className="space-y-2">
                            {reviewChecklist.map((item) => {
                                const checked = checkedReviewIds.includes(item.id);
                                return (
                                    <label
                                        key={item.id}
                                        className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-sm font-bold transition-colors ${
                                            checked
                                                ? 'border-blue-200 bg-blue-50 text-blue-800'
                                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                                        }`}
                                    >
                                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                                            checked ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
                                        }`}>
                                            {checked && <Check size={14} className="text-white" />}
                                        </span>
                                        <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={checked}
                                            onChange={() => toggleReviewItem(item.id)}
                                        />
                                        <span>{item.label}</span>
                                    </label>
                                );
                            })}
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:items-end">
                            <label className="block">
                                <span className="mb-1 block text-xs font-bold text-slate-500">내 이름</span>
                                <input
                                    type="text"
                                    value={signerNameInput}
                                    onChange={(event) => setSignerNameInput(event.target.value)}
                                    placeholder={`${myContractRoleLabel} 이름 입력`}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-1 flex flex-col gap-1 text-xs font-bold text-slate-500">
                                    <span>확인 문구</span>
                                    <span className="inline-flex w-fit rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">
                                        {CONTRACT_CONFIRMATION_TEXT}
                                    </span>
                                </span>
                                <input
                                    type="text"
                                    value={confirmationInput}
                                    onChange={(event) => setConfirmationInput(event.target.value)}
                                    placeholder="위 문구를 그대로 입력"
                                    className={`w-full rounded-lg border bg-white px-3 py-2 text-sm font-bold outline-none transition focus:ring-4 ${
                                        confirmationInput && !confirmationMatches
                                            ? 'border-amber-300 text-amber-800 focus:border-amber-400 focus:ring-amber-100'
                                            : 'border-slate-200 text-slate-800 focus:border-blue-400 focus:ring-blue-100'
                                    }`}
                                />
                            </label>
                        </div>
                    </div>
                )}

                {/* 서명란 */}
                <div className="grid grid-cols-2 gap-4">
                    {/* [왼쪽] 매도인 서명란 */}
                    <div className="flex flex-col gap-2">
                        <span className="text-xs font-bold text-slate-500 text-center">매도인 ({sellerDisplayName})</span>
                        <div className={`
                            h-28 rounded-xl border-2 flex items-center justify-center relative overflow-hidden bg-white
                            ${isSeller && !iHaveSignedDB ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200 bg-slate-50'}
                        `}>
                            {sellerSignatureImg ? (
                                <img src={sellerSignatureImg} alt="서명" className="w-full h-full object-contain p-2" />
                            ) : sellerSigned ? (
                                <span className="text-red-600 font-handwriting text-xl border-2 border-red-600 rounded-full px-3 py-1 transform -rotate-12 opacity-80">서명완료</span>
                            ) : isSeller ? (
                                <div className="w-full h-full">
                                    <SignaturePad 
                                        onSign={handleSignatureChange} 
                                        onEnd={handleSignatureEnd}
                                        isLocked={false} 
                                    />
                                </div>
                            ) : (
                                <span className="text-xs text-slate-400">서명 대기 중...</span>
                            )}
                        </div>
                    </div>

                    {/* [오른쪽] 매수인 서명란 */}
                    <div className="flex flex-col gap-2">
                        <span className="text-xs font-bold text-slate-500 text-center">매수인 ({buyerDisplayName})</span>
                        <div className={`
                            h-28 rounded-xl border-2 flex items-center justify-center relative overflow-hidden bg-white
                            ${isBuyer && !iHaveSignedDB ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200 bg-slate-50'}
                        `}>
                            {buyerSignatureImg ? (
                                <img src={buyerSignatureImg} alt="서명" className="w-full h-full object-contain p-2" />
                            ) : buyerSigned ? (
                                <span className="text-red-600 font-handwriting text-xl border-2 border-red-600 rounded-full px-3 py-1 transform -rotate-12 opacity-80">서명완료</span>
                            ) : isBuyer ? (
                                <div className="w-full h-full">
                                    <SignaturePad 
                                        onSign={handleSignatureChange} 
                                        onEnd={handleSignatureEnd}
                                        isLocked={false} 
                                    />
                                </div>
                            ) : (
                                <span className="text-xs text-slate-400">서명 대기 중...</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 3. 하단 고정 버튼 */}
            <div className="shrink-0 p-4 border-t border-slate-100 bg-white relative z-20">
                {/* 메인 버튼 */}
                {((isSeller || isBuyer) && !iHaveSignedDB) && (
                    <Button
                        icon={FileSignature}
                        fullWidth
                        size="lg"
                        tone="slate"
                        onClick={handleFinalAction}
                        disabled={loading || !canSubmitSignature}
                    >
                        {loading ? '저장 중...' : '서명 제출하기'}
                    </Button>
                )}

                {(contractComplete && isBuyer) && (
                    <Button
                        icon={DollarSign}
                        fullWidth
                        size="lg"
                        tone="emerald"
                        onClick={handleFinalAction}
                        disabled={loading}
                    >
                        최종 송금 및 소유권 이전
                    </Button>
                )}

                {/* 대기 상태 메시지 */}
                {iHaveSignedDB && !contractComplete && (
                    <div className="text-center text-orange-600 font-bold py-2 bg-orange-50 rounded-lg flex items-center justify-center gap-2 text-sm">
                        <AlertCircle size={16}/> 상대방의 서명을 기다리는 중입니다.
                    </div>
                )}

                {contractComplete && !isBuyer && (
                    <div className="text-center text-green-600 font-bold py-2 bg-green-50 rounded-lg flex items-center justify-center gap-2 text-sm">
                        <ShieldCheck size={16} /> 매수인의 최종 송금을 대기 중입니다.
                    </div>
                )}

                {/* 계약 당사자는 서명 완료 전까지, 교사는 진행 중 계약이면 언제든 취소할 수 있다. */}
                {canCancelContract && (
                    <Button
                        icon={XCircle}
                        fullWidth
                        tone="red"
                        kind="soft"
                        className="mt-3"
                        onClick={() => onCancelContract(desk.id)}
                        disabled={loading}
                    >
                        계약 파기 및 취소
                    </Button>
                )}
            </div>
        </div>
    );
};

export default ContractPaper;
