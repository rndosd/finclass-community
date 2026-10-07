import { appConfirm } from "../../../../utils/appDialogs";
import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ArrowUpCircle,
  Calendar,
  ListFilter,
  Wallet,
} from 'lucide-react';
import { useFeedback } from '../../../../contexts/FeedbackContext';
import { useUser } from '../../../../contexts/UserContext';
import {
  formatDateKeyInKST,
  parseDateKeyAsKST,
  startOfDayInKST,
} from '../../../../utils/kstDate';
import { useRealEstate } from '../../hooks/useRealEstate';
import {
  calculateCumulativeRentCharge,
  calculateRentAmountFromDays,
  getDeskRentStatus,
  getWeeklyRentAmount,
} from '../../utils/rentStatus';
import { Button } from '../../../../components/ui';
import RentHistoryModal from './RentHistoryModal';

const PAYMENT_PRESETS = [7, 14, 28];

const toWholeNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

const formatDateLabel = (value) => {
  const normalized = startOfDayInKST(value);
  return normalized ? format(normalized, 'MM월 dd일') : '-';
};

const RentManager = ({
  desk,
  classId,
  rentLimitEnabled,
  rentLimitRate,
  officialPriceRatio = 70,
  systemEnabled = true,
}) => {
  const { userData: user, isTeacher, isAccountSwitching, formatCurrency } = useUser();
  const { showFeedback } = useFeedback();
  const {
    payRent,
    payRentDeposit,
    replaceRentContract,
    settleRentDeposit,
    terminateRentContract,
    updateRentFee,
    loading,
  } = useRealEstate(classId, user, showFeedback);

  const weeklyRent = getWeeklyRentAmount(desk);
  const rentStatus = getDeskRentStatus(desk);
  const {
    hasRentConfigured,
    isRentApplicable,
    rentStartDate,
    contractLastDate,
    paidUntilDate,
    paidDays,
    paidAmount,
    accruedDays,
    accruedAmount,
    amountDue,
    overdueAmount,
    isPendingStart,
    isOverdue,
    hasActiveContract,
    needsContract,
    isContractEnded,
    remainingContractDays,
    unpaidDays,
    isContractPaymentPending,
    initialPaymentDays,
    initialRentAmount,
    initialPaymentTotal,
  } = rentStatus;

  const [rentInput, setRentInput] = useState(weeklyRent > 0 ? String(weeklyRent) : '');
  const [depositInput, setDepositInput] = useState(String(Number(desk?.rentDepositAmount || 0)));
  const [deductionInput, setDeductionInput] = useState('0');
  const [settlementReason, setSettlementReason] = useState('');
  const [startDateInput, setStartDateInput] = useState('');
  const [lastDateInput, setLastDateInput] = useState('');
  const [paymentDaysInput, setPaymentDaysInput] = useState('7');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isEditingContract, setIsEditingContract] = useState(false);
  const [isReplacingContract, setIsReplacingContract] = useState(false);
  const rentStartDateKey = rentStartDate ? formatDateKeyInKST(rentStartDate) : '';
  const contractLastDateKey = contractLastDate ? formatDateKeyInKST(contractLastDate) : '';

  useEffect(() => {
    // Use stable primitive keys here so user-selected payment days do not reset on every render.
    setRentInput(weeklyRent > 0 ? String(weeklyRent) : '');
    setDepositInput(String(Number(desk?.rentDepositAmount || 0)));
    setStartDateInput(rentStartDateKey);
    setLastDateInput(contractLastDateKey);

    const suggestedDays = hasActiveContract
      ? Math.max(
          1,
          Math.min(
            remainingContractDays || 1,
            unpaidDays > 0 ? unpaidDays : Math.min(7, remainingContractDays || 7),
          ),
        )
      : 7;
    setPaymentDaysInput(String(suggestedDays));
  }, [
    contractLastDateKey,
    desk?.id,
    desk?.rentDepositAmount,
    hasActiveContract,
    remainingContractDays,
    rentStartDateKey,
    unpaidDays,
    weeklyRent,
  ]);

  useEffect(() => {
    setIsEditingContract(!(hasActiveContract && !needsContract && !isContractPaymentPending));
  }, [desk?.id, hasActiveContract, isContractPaymentPending, needsContract]);

  const currentUserUid = String(user?.uid || '').trim();
  const ownerId = String(desk?.ownerId || '').trim();
  const occupantId = String(desk?.studentId || '').trim();
  const isOwner = Boolean(currentUserUid && ownerId && currentUserUid === ownerId);
  const canManageRent = (isTeacher && !isAccountSwitching) || isOwner;
  const isTenant = Boolean(currentUserUid && occupantId && currentUserUid === occupantId && !isOwner);
  const depositAmount = Math.max(0, toWholeNumber(desk?.rentDepositAmount));
  const depositPaidAmount = Math.max(0, toWholeNumber(desk?.rentDepositPaidAmount));
  const depositReturnedAmount = Math.max(0, toWholeNumber(desk?.rentDepositReturnedAmount));
  const depositDeductedAmount = Math.max(0, toWholeNumber(desk?.rentDepositDeductedAmount));
  const depositOutstandingAmount = Math.max(
    0,
    depositPaidAmount - depositReturnedAmount - depositDeductedAmount,
  );
  const depositStatus = desk?.rentDepositStatus || (depositAmount > 0 ? 'pending' : 'not_required');
  const isDepositReturnPending = depositStatus === 'return_pending';
  const canSettleDeposit = canManageRent && depositOutstandingAmount > 0 && (isContractEnded || isTeacher);

  const safeOfficialPriceRatio = Number.isFinite(Number(officialPriceRatio))
    ? Number(officialPriceRatio)
    : 70;
  const safeRentLimitRate = Number.isFinite(Number(rentLimitRate))
    ? Number(rentLimitRate)
    : 0;
  const officialPrice = Number(desk?.price || 0);
  const maxRent = Math.floor(Math.max(0, officialPrice) * (safeRentLimitRate / 100));

  const requestedPaymentDays = toWholeNumber(paymentDaysInput);
  const normalizedPaymentDays = hasActiveContract && remainingContractDays != null
    ? Math.min(requestedPaymentDays, Math.max(0, remainingContractDays))
    : requestedPaymentDays;
  const paymentAmount = hasActiveContract
    ? calculateCumulativeRentCharge({
        weeklyRent,
        paidDays,
        paidAmount,
        requestedDays: normalizedPaymentDays,
      })
    : calculateRentAmountFromDays(weeklyRent, normalizedPaymentDays);
  const paymentLabel = normalizedPaymentDays > 0 && normalizedPaymentDays % 7 === 0
    ? `${normalizedPaymentDays / 7}주`
    : `${normalizedPaymentDays}일`;
  const requiresWeeklyOnly = !hasActiveContract;
  const isContractRunning = hasActiveContract && !isContractPaymentPending && !isPendingStart && !isContractEnded;
  const tenantPaymentBlockedByEndedContract =
    hasActiveContract && isContractEnded && (remainingContractDays || 0) <= 0;

  const ensureSystemEnabled = () => {
    if (systemEnabled) return true;
    showFeedback('부동산 시스템이 비활성화되어 있어 이 작업을 진행할 수 없습니다.', 'warning');
    return false;
  };

  const handleApplyRent = async () => {
    if (!ensureSystemEnabled()) return;

    if (!String(rentInput).trim()) {
      showFeedback('주 임대료를 입력해주세요. 계약을 해제하려면 0을 직접 입력해주세요.', 'error');
      return;
    }

    const numericRent = Number(rentInput);
    const numericDeposit = Number(depositInput);
    if (!Number.isFinite(numericRent) || numericRent < 0) {
      showFeedback('임대료는 0 이상으로 입력해주세요.', 'error');
      return;
    }
    if (!Number.isFinite(numericDeposit) || numericDeposit < 0) {
      showFeedback('보증금은 0 이상으로 입력해주세요.', 'error');
      return;
    }

    if (rentLimitEnabled && numericRent > maxRent) {
      showFeedback(`임대료 상한은 ${formatCurrency(maxRent)}입니다.`, 'error');
      return;
    }

    if (numericRent === 0 && hasRentConfigured && !(await appConfirm(
      '임대료를 0으로 저장하면 기존 계약이 해제됩니다. 계약을 해제할까요?',
      { title: '계약 해제 확인', confirmLabel: '계약 해제', cancelLabel: '계속 수정하기', tone: 'rose' },
    ))) return;

    if (numericRent > 0 && !desk?.studentId) {
      showFeedback('현재 입주자가 있는 자리에서만 임대 계약을 등록할 수 있습니다.', 'error');
      return;
    }

    let rentStartDateKey = null;
    let rentLastDateKey = null;

    if (numericRent > 0) {
      const parsedStartDate = startOfDayInKST(parseDateKeyAsKST(startDateInput));
      const parsedLastDate = startOfDayInKST(parseDateKeyAsKST(lastDateInput));

      if (!parsedStartDate || !parsedLastDate) {
        showFeedback('계약 시작일과 실제거주 마지막일을 모두 입력해주세요.', 'error');
        return;
      }

      if (parsedLastDate.getTime() < parsedStartDate.getTime()) {
        showFeedback('실제거주 마지막일은 계약 시작일보다 빠를 수 없습니다.', 'error');
        return;
      }

      rentStartDateKey = formatDateKeyInKST(parsedStartDate);
      rentLastDateKey = formatDateKeyInKST(parsedLastDate);
    }

    const contractPayload = {
      weeklyRent: numericRent,
      rentStartDateKey,
      rentLastDateKey,
      depositAmount: numericDeposit,
    };
    if (isReplacingContract && !(await appConfirm(
      '기존 보증금과 사용하지 않은 선납 임대료를 반환하고 새 계약으로 바꿀까요?',
    ))) return;

    const success = isReplacingContract
      ? await replaceRentContract(desk.id, contractPayload)
      : await updateRentFee(desk.id, numericRent, contractPayload);

    if (success) {
      setIsEditingContract(false);
      setIsReplacingContract(false);
    }
  };

  const handleTerminateContract = async () => {
    if (!ensureSystemEnabled()) return;
    if (!(await appConfirm('계약을 종료하고 보증금을 임차인에게 반환할까요? 납부한 임대료는 반환되지 않습니다.', {"title":"계약 종료 확인","confirmLabel":"계약 종료","tone":"rose"}))) {
      return;
    }
    await terminateRentContract(desk.id);
  };

  const handlePayDeposit = async () => {
    if (!ensureSystemEnabled()) return;
    await payRentDeposit({
      deskId: desk.id,
      amount: initialPaymentTotal,
      depositAmount,
      rentAmount: initialRentAmount,
      prepaidDays: initialPaymentDays,
    });
  };

  const handleSettleDeposit = async (forceSettle = false) => {
    if (!ensureSystemEnabled()) return;
    const deductionAmount = toWholeNumber(deductionInput);
    if (deductionAmount > 0 && !settlementReason.trim()) {
      showFeedback('보증금 차감 사유를 입력해주세요.', 'error');
      return;
    }
    const message = forceSettle
      ? '임대인 잔액이 부족한 금액을 시스템에서 보전해 강제 정산할까요?'
      : `보증금을 정산할까요? 차감 ${formatCurrency(deductionAmount)}`;
    if (!(await appConfirm(message))) return;
    await settleRentDeposit({
      deskId: desk.id,
      deductionAmount,
      reason: settlementReason.trim(),
      forceSettle,
    });
  };

  const handlePayRent = async () => {
    if (!ensureSystemEnabled()) return;

    if (normalizedPaymentDays <= 0) {
      showFeedback('납부 일수를 먼저 입력해주세요.', 'error');
      return;
    }

    if (requiresWeeklyOnly && normalizedPaymentDays % 7 !== 0) {
      showFeedback('계약 등록 전에는 7일 단위로만 납부할 수 있습니다.', 'error');
      return;
    }

    if (hasActiveContract && remainingContractDays != null && normalizedPaymentDays > remainingContractDays) {
      showFeedback(`현재 계약에서는 최대 ${remainingContractDays}일까지만 납부할 수 있습니다.`, 'error');
      return;
    }

    if (paymentAmount <= 0) {
      showFeedback('납부 금액을 계산할 수 없습니다. 계약 정보를 먼저 확인해주세요.', 'error');
      return;
    }

    await payRent({
      deskId: desk.id,
      amount: paymentAmount,
      days: normalizedPaymentDays,
      label: paymentLabel,
    });
  };

  const statusContainerClasses = isOverdue
    ? 'bg-rose-50 border-rose-100'
    : isContractPaymentPending
    ? 'bg-blue-50 border-blue-100'
    : isPendingStart
      ? 'bg-amber-50 border-amber-100'
      : hasActiveContract
        ? 'bg-emerald-50 border-emerald-100'
        : 'bg-slate-50 border-slate-100';
  const statusIconClasses = isOverdue
    ? 'text-rose-500'
    : isContractPaymentPending
    ? 'text-blue-500'
    : isPendingStart
      ? 'text-amber-500'
      : hasActiveContract
        ? 'text-emerald-500'
        : 'text-slate-500';
  const statusTextClasses = isOverdue
    ? 'text-rose-700'
    : isContractPaymentPending
    ? 'text-blue-700'
    : isPendingStart
      ? 'text-amber-700'
      : hasActiveContract
        ? 'text-emerald-700'
        : 'text-slate-700';

  let statusLabel = '임대 상태를 확인해주세요.';
  if (!isRentApplicable) {
    statusLabel = '자가 소유 자리라 임대 대상이 아닙니다.';
  } else if (!hasRentConfigured) {
    statusLabel = '임대료가 아직 설정되지 않았습니다.';
  } else if (needsContract) {
    statusLabel = '임대 계약을 먼저 등록해야 정확한 연체 계산이 가능합니다.';
  } else if (isContractPaymentPending) {
    statusLabel = isOverdue
      ? `첫 납부 대기 · 연체 ${formatCurrency(overdueAmount)} · ${unpaidDays}일 미납`
      : '첫 납부가 필요합니다.';
  } else if (isPendingStart && rentStartDate) {
    statusLabel = `${formatDateLabel(rentStartDate)}부터 계약이 시작됩니다.`;
  } else if (isOverdue) {
    statusLabel = `연체 ${formatCurrency(overdueAmount)} · ${unpaidDays}일 미납`;
  } else if (amountDue > 0) {
    statusLabel = `임대료 ${formatCurrency(amountDue)} 납부가 필요합니다.`;
  } else if (hasActiveContract) {
    statusLabel = `${formatDateLabel(contractLastDate)}까지 계약 · 정상 납부 중`;
  } else if (paidUntilDate) {
    statusLabel = `${formatDateLabel(paidUntilDate)} 기준으로 납부되어 있습니다.`;
  }

  const contractBadgeClasses = isContractPaymentPending
    ? 'bg-blue-100 text-blue-700'
    : isContractRunning
    ? 'bg-emerald-100 text-emerald-700'
    : isPendingStart
      ? 'bg-amber-100 text-amber-700'
      : 'bg-slate-100 text-slate-700';
  const contractBadgeLabel = isContractPaymentPending
    ? '첫 납부 대기'
    : isContractRunning
    ? '진행 중 계약'
    : isPendingStart
      ? '시작 전 계약'
      : '종료 계약';

  return (
    <div className="space-y-3 p-4">
      {!systemEnabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
          부동산 시스템이 비활성화되어 있어 계약 저장과 임대료 납부를 진행할 수 없습니다.
        </div>
      )}

      <div className="space-y-2.5">
        {hasActiveContract ? (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black ${contractBadgeClasses}`}>
                      {contractBadgeLabel}
                    </span>
                    {isOverdue && (
                      <span className="inline-flex rounded-full bg-rose-100 px-3 py-1 text-[11px] font-black text-rose-700">
                        연체 {formatCurrency(overdueAmount)}
                      </span>
                    )}
                  </div>

                  <div className="grid gap-x-5 gap-y-2 text-sm font-semibold text-slate-700 sm:grid-cols-3">
                    <div>
                      <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">임차인</p>
                      <p>{desk?.studentName || '입주자 없음'}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">계약 기간</p>
                      <p>{formatDateLabel(rentStartDate)} ~ {formatDateLabel(contractLastDate)}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">주 임대료</p>
                      <p>{formatCurrency(weeklyRent)}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => setIsHistoryOpen(true)}
                    tone="emerald"
                    kind="outline"
                    size="xs"
                    rounded="lg"
                    icon={ListFilter}
                    
                  >
                    납부 기록
                  </Button>
                  {canManageRent && isContractPaymentPending && (
                    <>
                      {isEditingContract && (
                        <Button
                          onClick={() => {
                            setRentInput(weeklyRent > 0 ? String(weeklyRent) : '');
                            setStartDateInput(rentStartDate ? formatDateKeyInKST(rentStartDate) : '');
                            setLastDateInput(contractLastDate ? formatDateKeyInKST(contractLastDate) : '');
                            setIsEditingContract(false);
                          }}
                          tone="slate"
                          kind="outline"
                          size="xs"
                          rounded="lg"
                          
                        >
                          취소
                        </Button>
                      )}
                      <Button
                        onClick={() => setIsEditingContract((prev) => !prev)}
                        tone="amber"
                        kind="solid"
                        size="xs"
                        rounded="lg"
                        
                      >
                        {isEditingContract ? '수정 닫기' : '계약 수정'}
                      </Button>
                    </>
                  )}
                  {isTeacher && !isAccountSwitching && !isContractPaymentPending && (
                    <>
                      <Button
                        onClick={handleTerminateContract}
                        tone="red"
                        kind="outline"
                        size="xs"
                        rounded="lg"
                        
                      >
                        계약 종료
                      </Button>
                      <Button
                        onClick={() => {
                          setIsReplacingContract((current) => !current);
                          setIsEditingContract((current) => !current);
                        }}
                        tone="amber"
                        kind="solid"
                        size="xs"
                        rounded="lg"
                        
                      >
                        {isReplacingContract ? '재계약 취소' : '재계약'}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-slate-100 bg-white p-3">
                <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">누적 발생액</p>
                <p className="text-base font-black text-slate-800">{formatCurrency(accruedAmount)}</p>
                <p className="mt-1 text-[11px] font-semibold text-slate-500">현재까지 {accruedDays}일</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-white p-3">
                <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">총 납부액</p>
                <p className="text-base font-black text-emerald-600">{formatCurrency(paidAmount)}</p>
                <p className="mt-1 text-[11px] font-semibold text-slate-500">누적 {paidDays}일 납부</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-white p-3">
                <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">
                  {isOverdue ? '연체 금액' : amountDue > 0 ? '납부 필요' : '남은 계약 일수'}
                </p>
                <p className={`text-base font-black ${isOverdue ? 'text-rose-600' : amountDue > 0 ? 'text-blue-600' : 'text-slate-800'}`}>
                  {isOverdue
                    ? formatCurrency(overdueAmount)
                    : amountDue > 0
                      ? formatCurrency(amountDue)
                      : `${remainingContractDays || 0}일`}
                </p>
                <p className="mt-1 text-[11px] font-semibold text-slate-500">
                  {isOverdue
                    ? `${unpaidDays}일 미납`
                    : amountDue > 0
                      ? '오늘까지 발생한 금액'
                      : '계약 잔여 기간'}
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className={`rounded-xl border p-3.5 ${statusContainerClasses}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Calendar size={18} className={statusIconClasses} />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase leading-none text-slate-500">임대 상태</p>
                    <p className={`mt-1 text-sm font-bold ${statusTextClasses}`}>{statusLabel}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase text-slate-400">주 임대료</p>
                    <p className="text-sm font-black text-slate-800">
                      {hasRentConfigured ? formatCurrency(weeklyRent) : '미설정'}
                    </p>
                  </div>
                  <Button
                    onClick={() => setIsHistoryOpen(true)}
                    tone="slate"
                    kind="outline"
                    size="xs"
                    rounded="lg"
                    icon={ListFilter}
                    
                  >
                    납부 기록
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {needsContract && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
          현재 임대료는 설정되어 있지만 임차인, 계약 시작일, 실제거주 마지막일이 묶인 계약 정보가 없습니다.
          {canManageRent
            ? ' 선생님이 현재 자리 기준으로 계약을 등록하면 과거 연체도 다시 계산됩니다.'
            : ' 선생님이 계약을 등록하면 연체 금액이 정확하게 표시됩니다.'}
        </div>
      )}

      {hasActiveContract && (depositAmount > 0 || isContractPaymentPending) && (
        <div className={`space-y-2.5 rounded-xl border p-3.5 ${
          isDepositReturnPending
            ? 'border-rose-200 bg-rose-50'
            : isContractPaymentPending
              ? 'border-blue-200 bg-blue-50'
              : 'border-emerald-200 bg-emerald-50'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-black text-slate-800">
                {isContractPaymentPending ? '첫 납부' : '임대 보증금'}
              </p>
              {isContractPaymentPending && (
                <p className="mt-0.5 text-[11px] font-semibold text-slate-600">
                  {depositAmount > 0
                    ? '보증금과 첫 임대료를 함께 납부합니다.'
                    : '보증금 없이 첫 임대료만 납부합니다.'}
                </p>
              )}
              <p className="mt-0.5 text-base font-black text-slate-900">
                {formatCurrency(isContractPaymentPending ? initialPaymentTotal : depositAmount)}
              </p>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-600">
                {isContractPaymentPending && (
                  `보증금 ${formatCurrency(depositAmount)} + 임대료 ${initialPaymentDays}일치 ${formatCurrency(initialRentAmount)}`
                )}
                {depositStatus === 'paid' && '납부 완료 · 계약 종료 후 반환 대상입니다.'}
                {isDepositReturnPending && `임대인 잔액 부족 · ${formatCurrency(depositOutstandingAmount)} 반환 대기`}
                {depositStatus === 'settled' && '보증금 정산이 완료되었습니다.'}
              </p>
            </div>
            {isTenant && isContractPaymentPending && (
              <Button size="md"
                onClick={handlePayDeposit}
                disabled={loading || !systemEnabled}
                tone="blue"
                kind="solid"
                rounded="lg"
                
              >
                첫 납부
              </Button>
            )}
          </div>

          {canSettleDeposit && (
            <div className="space-y-3 rounded-xl border border-white/80 bg-white/80 p-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[11px] font-bold text-slate-600">차감 금액</span>
                  <input
                    type="number"
                    min="0"
                    max={depositOutstandingAmount}
                    value={deductionInput}
                    onChange={(event) => setDeductionInput(event.target.value)}
                    className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-bold text-slate-600">차감 사유</span>
                  <input
                    value={settlementReason}
                    onChange={(event) => setSettlementReason(event.target.value)}
                    placeholder="미납 임대료 또는 교사 확인 사유"
                    className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => handleSettleDeposit(false)}
                  disabled={loading || !systemEnabled}
                  tone="emerald"
                  kind="solid"
                  size="sm"
                  rounded="lg"
                  
                >
                  보증금 정산
                </Button>
                {isTeacher && !isAccountSwitching && isDepositReturnPending && (
                  <Button
                    onClick={() => handleSettleDeposit(true)}
                    disabled={loading || !systemEnabled}
                    tone="red"
                    kind="outline"
                    size="sm"
                    rounded="lg"
                    
                  >
                    교사 강제 정산
                  </Button>
                )}
              </div>
              {!ownerId && (
                <p className="text-[11px] font-semibold text-slate-500">
                  국유지는 만료 다음 날 자동 정산됩니다. 교사는 필요할 때 직접 정산할 수 있습니다.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {canManageRent && (!hasActiveContract || needsContract || isContractPaymentPending || isEditingContract) && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-amber-700">
              <ArrowUpCircle size={16} /> {
                isReplacingContract
                  ? '새 조건으로 재계약'
                  : hasActiveContract
                    ? '시작 전 계약 수정'
                    : '임대 계약 설정'
              }
            </p>
            <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600">
              임차인 {desk?.studentName || '없음'}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] font-bold text-amber-800">주 임대료</span>
              <input
                type="number"
                min="0"
                value={rentInput}
                onChange={(event) => setRentInput(event.target.value)}
                placeholder="주 임대료 입력"
                className="w-full rounded-xl border border-amber-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-400"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-bold text-amber-800">보증금</span>
              <input
                type="number"
                min="0"
                value={depositInput}
                onChange={(event) => setDepositInput(event.target.value)}
                placeholder="없으면 0"
                className="w-full rounded-xl border border-amber-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-400"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] font-bold text-amber-800">계약 시작일</span>
              <input
                type="date"
                value={startDateInput}
                onChange={(event) => setStartDateInput(event.target.value)}
                disabled={!desk?.studentId}
                className="w-full rounded-xl border border-amber-200 bg-blue-50/50 px-3 py-2 text-sm font-semibold outline-none focus:border-amber-400 disabled:cursor-not-allowed disabled:bg-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-bold text-amber-800">실제거주 마지막일</span>
              <input
                type="date"
                min={startDateInput || undefined}
                value={lastDateInput}
                onChange={(event) => setLastDateInput(event.target.value)}
                disabled={!desk?.studentId}
                className="w-full rounded-xl border border-amber-200 bg-blue-50/50 px-3 py-2 text-sm font-semibold outline-none focus:border-amber-400 disabled:cursor-not-allowed disabled:bg-slate-100"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-amber-200 bg-white/80 px-3 py-2 text-[11px] font-semibold text-amber-800">
            <p>보증금은 임차인이 별도 납부 · {ownerId ? '종료 후 임대인/교사 정산' : '만료 다음 날 자동 정산'}</p>
            <p>
              {rentLimitEnabled
                ? `임대료 상한 ${formatCurrency(maxRent)} · 공시가 ${safeOfficialPriceRatio}% · 상한율 ${safeRentLimitRate}%`
                : '임대료 상한 없음'}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold text-amber-700">
              {isReplacingContract
                ? '기존 보증금과 미사용 선납 임대료를 정산한 뒤 새 계약은 첫 납부 대기가 됩니다.'
                : isContractPaymentPending
                ? '첫 납부 전에는 조건을 수정하거나 임대료 0으로 계약을 취소할 수 있습니다.'
                : '임대료를 0으로 저장하면 계약이 해제됩니다.'}
            </p>
            <Button
              onClick={handleApplyRent}
              disabled={loading || !systemEnabled}
              tone="blue"
              kind="solid"
              size="sm"
              rounded="lg"
              className="shrink-0"
            >
              {isReplacingContract ? '정산 후 재계약' : '계약 저장'}
            </Button>
          </div>
        </div>
      )}

      {isTenant && needsContract && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
          선생님이 현재 자리 계약을 등록하면 연체 금액이 정확하게 다시 계산됩니다.
        </div>
      )}

      {isTenant && hasRentConfigured && !isContractPaymentPending && !isPendingStart && !tenantPaymentBlockedByEndedContract && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-bold text-slate-700">임대료 납부</p>
              <p className="mt-1 text-[11px] font-semibold text-slate-500">
                {hasActiveContract
                  ? '계약 기간 안에서는 원하는 일수만큼 납부할 수 있습니다.'
                  : '계약 등록 전에는 기존 방식대로 7일 단위 납부만 가능합니다.'}
              </p>
            </div>
            {isOverdue && (
              <div className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-[11px] font-bold text-rose-600">
                <AlertTriangle size={14} /> {formatCurrency(overdueAmount)} 연체
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_PRESETS.map((days) => {
              const disabled = hasActiveContract && remainingContractDays != null && days > remainingContractDays;
              return (
                <Button
                  key={days}
                  onClick={() => setPaymentDaysInput(String(days))}
                  disabled={disabled}
                  tone={String(days) === String(normalizedPaymentDays) ? 'blue' : 'slate'}
                  kind={String(days) === String(normalizedPaymentDays) ? 'soft' : 'outline'}
                  size="sm"
                  rounded="lg"
                  
                >
                  {days / 7}주 납부
                </Button>
              );
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_170px] sm:items-end">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-600">납부 일수</label>
              <input
                type="number"
                min="1"
                max={hasActiveContract && remainingContractDays != null ? remainingContractDays : undefined}
                value={paymentDaysInput}
                onChange={(event) => setPaymentDaysInput(event.target.value)}
                className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
              />
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right">
              <p className="text-[10px] font-bold uppercase text-slate-400">예상 납부 금액</p>
              <p className="mt-0.5 text-base font-black text-slate-800">{formatCurrency(paymentAmount)}</p>
              <p className="text-[11px] font-semibold text-slate-500">{paymentLabel}</p>
            </div>
          </div>

          {requiresWeeklyOnly && normalizedPaymentDays > 0 && normalizedPaymentDays % 7 !== 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
              계약 등록 전에는 7일 단위로만 납부할 수 있습니다.
            </div>
          )}

          {hasActiveContract && remainingContractDays != null && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
              이번 계약에서 남은 납부 가능 일수는 {remainingContractDays}일입니다.
            </div>
          )}

          <Button size="md"
            onClick={handlePayRent}
            disabled={
              loading ||
              !systemEnabled ||
              isContractPaymentPending ||
              normalizedPaymentDays <= 0 ||
              (requiresWeeklyOnly && normalizedPaymentDays % 7 !== 0)
            }
            tone={isOverdue ? 'red' : 'blue'}
            kind="solid"
            fullWidth
            rounded="lg"
            icon={Wallet}
            
          >
            {isContractPaymentPending
              ? '위의 ‘첫 납부’를 먼저 완료해주세요'
              : `${formatCurrency(paymentAmount)} · ${paymentLabel} 납부`}
          </Button>
        </div>
      )}

      {isTenant && tenantPaymentBlockedByEndedContract && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
          이 계약은 종료되었고 남은 미납 기간도 없습니다.
        </div>
      )}

      {isTenant && isPendingStart && rentStartDate && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
          임대 계약은 {formatDateLabel(rentStartDate)}부터 시작됩니다. 시작일 이후에 납부가 가능합니다.
        </div>
      )}

      {!hasRentConfigured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
          {canManageRent
            ? '현재 자리에 임대 계약을 등록하면 임차인 기준으로 연체 계산이 시작됩니다.'
            : '아직 임대 계약이 등록되지 않았습니다.'}
        </div>
      )}

      <RentHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        desk={desk}
        classId={classId}
      />
    </div>
  );
};

export default RentManager;
