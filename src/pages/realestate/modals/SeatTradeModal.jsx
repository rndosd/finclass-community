import { appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useState } from 'react';
import {
  ArrowRightCircle,
  Building,
  DollarSign,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import { Button, EmptyState, Tabs } from '../../../components/ui';
import Modal from '../../../components/ui/Modal';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { useFundMode } from '../../../contexts/FundModeContext';
import { useUser } from '../../../contexts/UserContext';
import ContractPaper from '../components/ContractPaper';
import PropertySummary from '../components/PropertySummary';
import { useRealEstate } from '../hooks/useRealEstate';
import RentPaymentHistory from './components/RentPaymentHistory';
import RentManager from './components/RentManager';
import TransactionHistory from './components/TransactionHistory';
import { getDeskRentStatus, getWeeklyRentAmount } from '../utils/rentStatus';
import { resolveSaleContractTemplate } from '../utils/contractTemplate';
import { getFundRealEstateTradeLockReason } from '../utils/fundRealEstateTradeState';
import { getClassroomSeatStatus } from '../utils/classroomSeatStatus';

const isSelectedContractDesk = (desk) => {
  const contractState = desk?.contractState || {};
  return (
    String(desk?.tradeStatus || '') === 'contracting' &&
    (
      contractState.selectedAt ||
      contractState.sellerSigned === true ||
      contractState.buyerSigned === true
    )
  );
};

const resolvePurchaseRequests = (desk) => {
  const requests = Array.isArray(desk?.purchaseRequests)
    ? desk.purchaseRequests
    : [];
  const seenBuyerIds = new Set();
  const normalized = requests.reduce((items, request) => {
    const buyerId = String(request?.buyerId || '').trim();
    if (!buyerId || seenBuyerIds.has(buyerId)) return items;

    seenBuyerIds.add(buyerId);
    items.push({
      buyerId,
      buyerName: String(request?.buyerName || '익명').trim() || '익명',
      requestedAt: request?.requestedAt || null,
    });
    return items;
  }, []);

  const isLegacyPendingRequest =
    String(desk?.tradeStatus || '') === 'contracting' &&
    desk?.buyerId &&
    !isSelectedContractDesk(desk);

  if (isLegacyPendingRequest && !seenBuyerIds.has(desk.buyerId)) {
    normalized.push({
      buyerId: desk.buyerId,
      buyerName: String(desk?.contractState?.buyerName || '익명').trim() || '익명',
      requestedAt: desk?.contractState?.requestedAt || null,
    });
  }

  return normalized;
};

const SeatTradeModal = ({
  isOpen,
  onClose,
  desk,
  classId,
  acquisitionTaxRate = 0,
  capitalGainsTaxRate = 0,
  saleTemplate = '',
  saleSpecialTerms = '',
  rentLimitEnabled = false,
  rentLimitRate = 0,
  officialPriceRatio = 70,
  systemEnabled = true,
}) => {
  const {
    userData: user,
    isTeacher,
    isAccountSwitching,
    formatCurrency,
    currencyUnit,
    classData,
  } = useUser();
  const { showFeedback } = useFeedback();
  const {
    activeFund,
    activeFundId,
    getChannelAccess,
    isFundMode,
  } = useFundMode();
  const {
    loading: hookLoading,
    registerSale,
    cancelSale,
    requestPurchase,
    selectContractBuyer,
    cancelPurchaseRequest,
    submitSignature,
    cancelContract,
    executePayment,
    executeFundTrade,
  } = useRealEstate(classId, user, showFeedback);

  const [askingPrice, setAskingPrice] = useState(0);
  const [viewMode, setViewMode] = useState('info');
  const [historyMode, setHistoryMode] = useState('trade');
  const [saleEditorOpen, setSaleEditorOpen] = useState(false);
  const resolvedDesk = desk || null;
  const currentUserUid = String(user?.uid || '').trim();
  const canActAsTeacher = isTeacher && !isAccountSwitching;

  const canOpenContract =
    isSelectedContractDesk(resolvedDesk) &&
    (
      canActAsTeacher ||
      (currentUserUid && String(resolvedDesk.ownerId || '').trim() === currentUserUid) ||
      (currentUserUid && String(resolvedDesk.buyerId || '').trim() === currentUserUid) ||
      (!resolvedDesk.ownerId && canActAsTeacher)
    );


  useEffect(() => {
    if (!isOpen || !resolvedDesk) return;

    setAskingPrice(
      resolvedDesk.isForSale
        ? resolvedDesk.askingPrice
        : (resolvedDesk.lastPurchasePrice || resolvedDesk.price || 0),
    );

    if (canOpenContract) {
      setViewMode('contract');
      return;
    }
    setViewMode((prev) => (prev === 'contract' ? 'info' : prev));
    setHistoryMode('trade');
  }, [canOpenContract, isOpen, resolvedDesk]);

  useEffect(() => {
    if (!isOpen) {
      setViewMode('info');
      setHistoryMode('trade');
      setSaleEditorOpen(false);
    }
  }, [isOpen]);

  if (!isOpen || !resolvedDesk) return null;

  const ownerId = String(resolvedDesk.ownerId || '').trim();
  const buyerId = String(resolvedDesk.buyerId || '').trim();
  const occupantId = String(resolvedDesk.studentId || '').trim();
  const isOwner = Boolean(currentUserUid && ownerId && currentUserUid === ownerId);
  const isStateOwned = !ownerId;
  const isFundOwned = resolvedDesk.ownerType === 'classFund';
  const activeFundOwnsDesk =
    isFundOwned && String(resolvedDesk.ownerFundId || '') === String(activeFundId || '');
  const isSeller = isOwner || (isStateOwned && canActAsTeacher);
  const isBuyer = Boolean(currentUserUid && buyerId && currentUserUid === buyerId);
  const isTenant = Boolean(currentUserUid && occupantId && currentUserUid === occupantId && !isOwner);
  const weeklyRent = getWeeklyRentAmount(resolvedDesk);
  const { isOverdue } = getDeskRentStatus(resolvedDesk);
  const isRentDue = isTenant && weeklyRent > 0 && isOverdue;
  const purchaseRequests = resolvePurchaseRequests(resolvedDesk);
  const myPurchaseRequest = purchaseRequests.find(
    (request) => currentUserUid && request?.buyerId === currentUserUid,
  );
  const resolvedContractTemplate = resolveSaleContractTemplate({
    saleSpecialTerms,
    saleTemplate,
    acquisitionTaxRate,
    capitalGainsTaxRate,
  });
  const classDisplayName = String(
    classData?.className ||
    classData?.name ||
    classData?.title ||
    '',
  ).trim();
  const propertyPrice = Math.max(
    0,
    Math.floor(Number(resolvedDesk.lastPurchasePrice || resolvedDesk.price || 0)),
  );
  const acquisitionTax = Math.floor(
    propertyPrice * (Math.max(0, Number(acquisitionTaxRate || 0)) / 100),
  );
  const fundPurchaseTotal = propertyPrice + acquisitionTax;
  const fundPurchaseAccess = getChannelAccess('realEstatePurchase', {
    amount: fundPurchaseTotal,
  });
  const fundTradeLockReason = getFundRealEstateTradeLockReason(resolvedDesk);
  const fundPurchaseDisabledReason = fundTradeLockReason ||
    (!fundPurchaseAccess.allowed ? fundPurchaseAccess.reason : '');

  const tabItems = [
    { id: 'info', label: '자리·거래' },
    ...(canOpenContract ? [{ id: 'contract', label: '계약서' }] : []),
    { id: 'rent', label: '임대 관리', showAlert: isRentDue },
    { id: 'history', label: '거래 기록' },
  ];

  const ensureSystemEnabled = () => {
    if (systemEnabled) return true;
    showFeedback('부동산 시스템이 비활성화 상태입니다. 정책 설정에서 활성화해 주세요.', 'warning');
    return false;
  };

  const handleRequestPurchase = async () => {
    if (!ensureSystemEnabled()) return;
    if (isOwner) return;

    const confirmed = (await appConfirm('이 부동산 구매 신청을 보낼까요?'));
    if (!confirmed) return;

    const success = await requestPurchase(resolvedDesk.id);
    if (success) {
      showFeedback('구매 신청을 보냈습니다. 매도자가 계약자를 선택하면 계약서 작성이 시작됩니다.', 'success');
    }
  };

  const handleSelectContractBuyer = async (request) => {
    if (!ensureSystemEnabled()) return;
    if (!isSeller || !request?.buyerId) return;

    const confirmed = (await appConfirm(`${request.buyerName || '신청자'} 학생을 계약자로 선택할까요?`));
    if (!confirmed) return;

    const success = await selectContractBuyer(resolvedDesk.id, request.buyerId);
    if (success) {
      showFeedback('계약자를 선택했습니다. 이제 계약서를 작성할 수 있습니다.', 'success');
    }
  };

  const handleCancelPurchaseRequest = async () => {
    if (!myPurchaseRequest) return;

    const confirmed = (await appConfirm('이 매물 구매 신청을 취소할까요?'));
    if (!confirmed) return;

    const success = await cancelPurchaseRequest(resolvedDesk.id);
    if (success) {
      showFeedback('구매 신청을 취소했습니다.', 'info');
    }
  };

  const handleFundTrade = async (action) => {
    if (!ensureSystemEnabled() || !activeFundId || hookLoading) return;

    const isPurchase = action === 'purchase';
    const amount = isPurchase ? fundPurchaseTotal : propertyPrice;
    const confirmed = (await appConfirm(
      isPurchase
        ? `${activeFund?.name || '선택한 기금'}에서 ${formatCurrency(amount)}을 사용해 이 부동산을 구매할까요?`
        : `${activeFund?.name || '선택한 기금'} 소유 부동산을 국가에 ${formatCurrency(amount)}으로 매각할까요?`,
    ));
    if (!confirmed) return;

    await executeFundTrade({
      deskId: resolvedDesk.id,
      classFundId: activeFundId,
      action,
    });
  };


  const seatStatus = getClassroomSeatStatus(resolvedDesk, { userUid: currentUserUid, isTeacher, isAccountSwitching });
  const showSaleFooter = viewMode === 'info' && isSeller && !isFundMode && !canOpenContract && !resolvedDesk.isForSale;
  const cancelSaleInput = () => {
    setSaleEditorOpen(false);
    setAskingPrice(resolvedDesk.lastPurchasePrice || resolvedDesk.price || 0);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      placement="right"
      size="max-w-[560px]"
      title={<span className="flex flex-wrap items-center gap-3"><span>{resolvedDesk.label || `${resolvedDesk.number}번 자리`}</span>{seatStatus && <span className={`rounded-full px-3 py-1 text-sm font-bold ${seatStatus.tone === 'overdue' ? 'bg-red-700 text-white' : 'bg-blue-50 text-blue-700'}`}>{seatStatus.label}</span>}</span>}
      footer={showSaleFooter ? <div className="flex gap-3">
        {saleEditorOpen && <Button kind="outline" tone="slate" className="min-h-12 flex-1 text-base" onClick={cancelSaleInput} disabled={hookLoading}>입력 취소</Button>}
        <Button tone="blue" kind="solid" className="min-h-12 flex-1 text-base" disabled={!systemEnabled || hookLoading} onClick={() => {
          if (!saleEditorOpen) { setSaleEditorOpen(true); return; }
          if (!ensureSystemEnabled()) return;
          registerSale(resolvedDesk.id, askingPrice);
        }}>판매 등록</Button>
      </div> : undefined}
      subtitle="가격과 소유 정보를 확인하고 거래·임대를 관리합니다."
    >
      <Tabs ariaLabel="부동산 상세 업무" idPrefix="seat-trade" tabs={tabItems.map(tab=>({...tab,disabled:!systemEnabled && tab.id==='rent',label:<><span>{tab.label}</span>{tab.showAlert && <span aria-label="확인 필요" className="inline-block h-2 w-2 rounded-full bg-rose-500" />}</>}))} activeTab={viewMode} onTabChange={setViewMode} variant="underline" size="md" fullWidth wrapLabels className="sticky top-0 z-10 mb-2 bg-white" />

      <div className="min-w-0">
        {viewMode === 'info' && (
          <div className="space-y-4 py-3 md:py-4 animate-in fade-in slide-in-from-bottom-3 duration-300">
            {!systemEnabled && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                지금은 거래·임대를 이용할 수 없어요.
              </div>
            )}

            <div className="flex flex-col gap-6">
              <PropertySummary desk={resolvedDesk} price={Number(resolvedDesk.lastPurchasePrice || resolvedDesk.price || 0)} currencyUnit={currencyUnit}
                 />
              <div className="min-w-0 space-y-4">
            {isRentDue && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-xs md:text-sm font-bold text-rose-700">
                  임대료 납부가 필요합니다. 임대 관리 탭에서 바로 납부할 수 있습니다.
                </p>
                <Button
                  onClick={() => setViewMode('rent')}
                  tone="red"
                  kind="solid"
                  size="xs"
                  rounded="lg"
                  className="shrink-0"
                >
                  임대 관리로 이동
                </Button>
              </div>
            )}

            <div className="mt-2">
              {canOpenContract ? (
                <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
                  <h3 className="font-bold text-violet-900">계약 진행 중</h3>
                  <p className="mt-2 text-sm text-slate-600">계약 내용과 서명·결제 진행 상태를 확인하세요.</p>
                  <Button className="mt-4" onClick={() => setViewMode('contract')}>계약서 확인하기</Button>
                </div>
              ) : isFundMode ? (
                <div className="space-y-4 rounded-2xl border-2 border-blue-100 bg-blue-50/60 p-4 md:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wider text-blue-500">
                        기금 모드
                      </p>
                      <p className="mt-1 text-lg font-black text-slate-900">
                        {activeFund?.name || '선택한 기금'}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-blue-700 shadow-sm">
                      현금 {formatCurrency(activeFund?.cashBalance || 0)}
                    </span>
                  </div>

                  {isStateOwned ? (
                    <>
                      <div className="rounded-xl border border-blue-100 bg-white p-4 text-sm font-bold text-slate-600">
                        <div className="flex justify-between gap-3">
                          <span>매입가</span>
                          <span className="text-slate-900">{formatCurrency(propertyPrice)}</span>
                        </div>
                        <div className="mt-2 flex justify-between gap-3">
                          <span>취득세</span>
                          <span className="text-slate-900">{formatCurrency(acquisitionTax)}</span>
                        </div>
                        <div className="mt-3 flex justify-between gap-3 border-t border-slate-100 pt-3 text-base font-black text-blue-700">
                          <span>총 사용액</span>
                          <span>{formatCurrency(fundPurchaseTotal)}</span>
                        </div>
                      </div>
                      {fundPurchaseDisabledReason && (
                        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                          {fundPurchaseDisabledReason}
                        </p>
                      )}
                      <Button size="md"
                        onClick={() => handleFundTrade('purchase')}
                        disabled={
                          !systemEnabled ||
                          hookLoading ||
                          Boolean(fundPurchaseDisabledReason)
                        }
                        tone="blue"
                        kind="solid"
                        fullWidth
                        rounded="lg"
                        
                        icon={Building}
                      >
                        기금으로 구매하기
                      </Button>
                    </>
                  ) : activeFundOwnsDesk ? (
                    <>
                      <p className="rounded-xl border border-blue-100 bg-white px-4 py-3 text-sm font-bold text-slate-600">
                        이 부동산은 현재 선택한 기금의 자산입니다. 국가에 매각하면 매각대금이 기금 현금으로 돌아옵니다.
                      </p>
                      {fundTradeLockReason && (
                        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                          {fundTradeLockReason}
                        </p>
                      )}
                      <Button size="md"
                        onClick={() => handleFundTrade('sell')}
                        disabled={!systemEnabled || hookLoading || Boolean(fundTradeLockReason)}
                        tone="emerald"
                        kind="solid"
                        fullWidth
                        rounded="lg"
                        
                        icon={ArrowRightCircle}
                      >
                        국가에 {formatCurrency(propertyPrice)}으로 매각
                      </Button>
                    </>
                  ) : isFundOwned ? (
                    <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                      다른 기금이 소유한 부동산입니다. 해당 기금으로 전환해야 관리할 수 있습니다.
                    </p>
                  ) : (
                    <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-600">
                      학생 소유 부동산은 기금으로 직접 거래할 수 없습니다.
                    </p>
                  )}
                </div>
              ) : isSeller ? (
                resolvedDesk.isForSale ? (
                  <div className="space-y-4">
                    <div className="bg-indigo-50/50 p-4 md:p-5 rounded-2xl text-center border-2 border-indigo-100 border-dashed">
                      <p className="text-xs font-bold text-indigo-400 mb-2 uppercase tracking-wider">설정된 매물 가격</p>
                      <p className="text-3xl font-black text-indigo-600">{formatCurrency(resolvedDesk.askingPrice)}</p>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Users size={17} className="text-indigo-500" />
                          <p className="text-sm font-black text-slate-800">계약자 선택</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-500">
                          {purchaseRequests.length}명 신청
                        </span>
                      </div>

                      {purchaseRequests.length > 0 ? (
                        <div className="space-y-2">
                          {purchaseRequests.map((request) => (
                            <div
                              key={request.buyerId}
                              className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-black text-slate-800">
                                  {request.buyerName || '이름 없음'}
                                </p>
                                <p className="text-[11px] font-bold text-slate-400">
                                  구매 신청자
                                </p>
                              </div>
                              <Button
                                onClick={() => handleSelectContractBuyer(request)}
                                disabled={!systemEnabled || hookLoading}
                                tone="blue"
                                kind="solid"
                                size="xs"
                                rounded="lg"
                                className="shrink-0"
                              >
                                선택
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyState
                          icon={Users}
                          title="아직 구매 신청자가 없습니다"
                          description="학생이 구매 신청을 보내면 이곳에서 계약자를 고를 수 있습니다."
                          size="sm"
                          className="min-h-[150px] rounded-xl border-slate-200 bg-slate-50 px-4 py-5"
                        />
                      )}
                    </div>

                    <Button size="md"
                      onClick={() => {
                        if (!ensureSystemEnabled()) return;
                        cancelSale(resolvedDesk.id);
                      }}
                      disabled={!systemEnabled || hookLoading}
                      tone="red"
                      kind="outline"
                      fullWidth
                      rounded="lg"
                      
                    >
                      매물 내리기
                    </Button>
                  </div>
                ) : (
                  <section className="space-y-5" aria-label="판매 등록">
                    <div>
                      <h3 className="text-xl font-extrabold text-slate-900">판매 등록</h3>
                      <p className="mt-2 text-base leading-relaxed text-slate-500">이 자리를 다른 학생에게 판매할 수 있습니다.</p>
                    </div>
                    {saleEditorOpen && <div>
                      <label htmlFor="seat-sale-price" className="mb-2 block text-base font-bold text-slate-600">판매 가격</label>
                      <div className="relative">
                        <input id="seat-sale-price" type="number" aria-label="희망 매매가" value={askingPrice}
                          onChange={(event) => setAskingPrice(event.target.value)}
                          className="w-full min-w-0 rounded-xl border border-slate-300 bg-white py-4 pl-4 pr-20 text-xl sm:text-2xl font-bold tabular-nums text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-base font-bold text-slate-500">{currencyUnit}</span>
                      </div>
                    </div>}
                  </section>
                )
              ) : resolvedDesk.isForSale ? (
                <div className="space-y-4 mt-2">
                  <div className="text-center space-y-2">
                    <p className="text-xs md:text-sm font-bold text-slate-400 italic bg-slate-50 inline-block px-4 py-1.5 rounded-full border border-slate-100">
                      매도자가 구매 신청자 중 계약자를 선택합니다.
                    </p>
                    {purchaseRequests.length > 0 && (
                      <p className="text-xs font-bold text-indigo-500">
                        현재 {purchaseRequests.length}명이 구매 신청했습니다.
                      </p>
                    )}
                  </div>

                  {myPurchaseRequest ? (
                    <div className="rounded-[22px] border-2 border-indigo-100 bg-indigo-50 p-5 text-center shadow-sm">
                      <UserCheck size={28} className="mx-auto mb-2 text-indigo-500" />
                      <p className="text-base font-black text-indigo-700">구매 신청 완료</p>
                      <p className="mt-1 text-xs font-bold text-indigo-400">
                        매도자가 계약자를 선택하면 계약서 작성이 시작됩니다.
                      </p>
                      <Button
                        onClick={handleCancelPurchaseRequest}
                        disabled={hookLoading}
                        tone="blue"
                        kind="outline"
                        size="xs"
                        rounded="lg"
                        className="mt-4"
                      >
                        신청 취소
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={handleRequestPurchase}
                      disabled={!systemEnabled || hookLoading}
                      tone="emerald"
                      kind="solid"
                      fullWidth
                      rounded="xl"
                      className="flex-col py-5 font-bold shadow-2xl shadow-emerald-100 md:py-6"
                    >
                      <div className="flex items-center gap-2.5 text-xl md:text-2xl">
                        <DollarSign size={24} />
                        {formatCurrency(resolvedDesk.askingPrice)} 구매 신청
                      </div>
                      <span className="text-xs opacity-90 font-medium tracking-wide bg-black/10 px-4 py-1.5 rounded-full mt-1">
                        신청 후 매도자의 계약자 선택을 기다립니다.
                      </span>
                    </Button>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center bg-slate-50/80 rounded-[24px] border-2 border-dashed border-slate-200 text-slate-400">
                  <ShieldCheck size={44} className="mx-auto mb-3 opacity-20 text-slate-500" />
                  <p className="text-lg font-bold text-slate-500">거래 가능한 매물이 아닙니다</p>
                  <p className="text-xs mt-2 opacity-70 font-medium text-slate-400">
                    현재 소유주가 매매를 진행하고 있지 않습니다.
                  </p>
                </div>
              )}
            </div>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'contract' && canOpenContract && (
          <div className="space-y-3">
            <Button kind="outline" tone="slate" onClick={() => setViewMode('info')}>자리 정보로 돌아가기</Button>
        <ContractPaper
          desk={resolvedDesk}
          user={user}
          isSeller={isSeller}
          isBuyer={isBuyer}
          isStateOwned={isStateOwned}
          formatCurrency={formatCurrency}
          onSubmitSignature={submitSignature}
          onExecutePayment={executePayment}
          onCancelContract={cancelContract}
          canManageContract={canActAsTeacher}
          loading={hookLoading}
          acquisitionTaxRate={acquisitionTaxRate}
          capitalGainsTaxRate={capitalGainsTaxRate}
          contractTemplate={resolvedContractTemplate}
          classDisplayName={classDisplayName}
        />
          </div>
        )}

        {viewMode === 'rent' && (
          <RentManager
            desk={resolvedDesk}
            classId={classId}
            rentLimitEnabled={rentLimitEnabled}
            rentLimitRate={rentLimitRate}
            officialPriceRatio={officialPriceRatio}
            systemEnabled={systemEnabled}
          />
        )}

        {viewMode === 'history' && (
          <div className="flex h-[380px] md:h-[460px] flex-col px-1">
            <div className="mb-3 flex shrink-0 gap-2">
              <Button
                onClick={() => setHistoryMode('trade')}
                tone={historyMode === 'trade' ? 'blue' : 'slate'}
                kind={historyMode === 'trade' ? 'soft' : 'outline'}
                size="sm"
                rounded="lg"
                fullWidth
                className="flex-1"
              >
                거래기록
              </Button>
              <Button
                onClick={() => setHistoryMode('rent')}
                tone={historyMode === 'rent' ? 'emerald' : 'slate'}
                kind={historyMode === 'rent' ? 'soft' : 'outline'}
                size="sm"
                rounded="lg"
                fullWidth
                className="flex-1"
              >
                임대기록
              </Button>
            </div>

            <div className="min-h-0 flex-1">
              {historyMode === 'trade' ? (
                <TransactionHistory desk={resolvedDesk} classId={classId} embedded />
              ) : (
                <RentPaymentHistory desk={resolvedDesk} classId={classId} embedded />
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default SeatTradeModal;
