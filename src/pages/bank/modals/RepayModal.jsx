import React, { useState, useEffect, useMemo } from "react";
import {
  Modal as GenericModal,
  Button,
  InputField,
} from "../../../components/ui";
import {
  BanknotesIcon,
  InformationCircleIcon,
  WalletIcon,
  FireIcon,
  CheckBadgeIcon,
} from "@heroicons/react/24/solid";
import { getLoanOverdueDays } from "../utils/dateUtils";
import { calculateLoanInterestDue } from "../utils/loanMetrics";
import { formatBankMoney } from "../../../utils/bankMoney";

export default function RepayModal({
  isOpen,
  onClose,
  loan,
  studentCashBalance,
  onRepay,
  isSubmitting = false,
  currencyUnit,
}) {
  const [repayAmountStr, setRepayAmountStr] = useState("");
  const [isLocked, setIsLocked] = useState(false);

  // 모달 열릴 때마다 초기화
  useEffect(() => {
    if (isOpen) {
      setRepayAmountStr("");
      setIsLocked(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isSubmitting) {
      setIsLocked(false);
    }
  }, [isSubmitting]);

  // --- 1. 실시간 채무 계산 (백엔드 로직과 일치) ---
  const debtState = useMemo(() => {
    if (!loan) return { principal: 0, interest: 0, penalty: 0, total: 0 };

    const now = new Date();

    // 원금
    const principalTotal = Number(loan.principal || loan.amount || 0);
    const principalLeft = Number(loan.amountLeft ?? principalTotal);

    // 이자 (일할 계산)
    const interestDue =
      loan.status === "ongoing"
        ? calculateLoanInterestDue(loan, now).interestDue
        : 0;

    // 연체료 (기준일 기반 독립 계산)
    let penaltyDue = 0;
    const overdueDays = getLoanOverdueDays(loan, now);
    if (loan.status === "ongoing" && overdueDays > 0) {
      const overdueRate = Number(loan.overdueRate || 0);
      penaltyDue = Math.round(
        principalLeft * (overdueRate / 100) * overdueDays,
      );

    }

    return {
      principal: principalLeft,
      interest: interestDue,
      penalty: penaltyDue,
      total: principalLeft + interestDue + penaltyDue,
      hasPenalty: penaltyDue > 0,
    };
  }, [loan]);

  // --- 렌더링 차단 ---
  if (!isOpen || !loan) return null;

  // --- 2. 입력값 검증 ---
  const currentCash = studentCashBalance ?? 0;
  const repayAmountNum = Number(repayAmountStr.replaceAll(",", ""));
  const isActionPending = isSubmitting || isLocked;

  let validationMessage = "";
  let isValidAmount = false;

  if (!repayAmountStr) {
    // 입력 없음
  } else if (isNaN(repayAmountNum) || repayAmountNum <= 0) {
    validationMessage = "올바른 금액을 입력해주세요.";
  } else if (repayAmountNum > currentCash) {
    validationMessage = "보유 현금이 부족합니다.";
  } else if (repayAmountNum > debtState.total + 1) {
    validationMessage = `총 상환액(${formatBankMoney(debtState.total)} ${currencyUnit})을 초과할 수 없습니다.`;
  } else {
    isValidAmount = true;
  }

  // 폭포수 시뮬레이션
  const simulateRepayment = () => {
    if (!isValidAmount || repayAmountNum <= 0) return null;
    let money = repayAmountNum;
    const payPenalty = Math.min(money, debtState.penalty);
    money -= payPenalty;
    const payInterest = Math.min(money, debtState.interest);
    money -= payInterest;
    const payPrincipal = Math.min(money, debtState.principal);

    return (
      <div className="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 animate-in fade-in slide-in-from-top-2">
        <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1">
          <InformationCircleIcon className="w-3.5 h-3.5 text-indigo-300" />
          상환 미리보기
        </p>
        <div className="space-y-2">
          {payPenalty > 0 && (
            <div className="flex justify-between items-center text-sm bg-rose-50 p-2 rounded-lg">
              <span className="text-rose-600 font-bold flex items-center gap-1">
                <FireIcon className="w-3.5 h-3.5" /> 연체료 납부
              </span>
              <span className="font-black text-rose-600">
                -{formatBankMoney(payPenalty)} {currencyUnit}
              </span>
            </div>
          )}
          {payInterest > 0 && (
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500 font-medium">밀린 이자 납부</span>
              <span className="font-bold text-blue-500">
                -{formatBankMoney(payInterest)} {currencyUnit}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-500 font-medium">대출 원금 상환</span>
            <span className="font-bold text-slate-700">
              -{formatBankMoney(payPrincipal)} {currencyUnit}
            </span>
          </div>
          <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between items-center">
            <span className="text-xs text-slate-400 font-bold">
              상환 후 남는 빚
            </span>
            <span className="text-sm font-black text-slate-800">
              {formatBankMoney(debtState.total - repayAmountNum)}{" "}
              {currencyUnit}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const handleSetMaxAmount = () => {
    if (isActionPending) return;

    const maxPayable = Math.min(debtState.total, currentCash);
    setRepayAmountStr(maxPayable.toString());
  };

  const handleConfirmRepay = async () => {
    if (!isValidAmount || isActionPending) return;

    setIsLocked(true);
    try {
      const result = await onRepay?.(loan, repayAmountNum);
      if (result?.success) {
        onClose?.();
      }
    } finally {
      setIsLocked(false);
    }
  };

  const isUrgent = debtState.hasPenalty;
  const themeColor = isUrgent ? "rose" : "indigo";
  const totalPenaltyPaid = Number(loan.penaltyPaid || 0);

  return (
    <GenericModal
      onClose={onClose}
      title="대출 상환하기"
      isOpen={true}
      className="!z-[9999] relative"
    >
      <div className="space-y-5">
        {/* 1. 상단 현황 카드 */}
        <div
          className={`p-5 rounded-3xl border shadow-sm transition-colors
          ${
            isUrgent
              ? "bg-gradient-to-br from-rose-50/80 to-orange-50/50 border-rose-100"
              : "bg-gradient-to-br from-blue-50/50 to-indigo-50/50 border-blue-100"
          }`}
        >
          <div className="flex justify-between items-start mb-4">
            <div>
              <p
                className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isUrgent ? "text-rose-400" : "text-indigo-300"}`}
              >
                {loan.productLabel || "대출 상품"}
              </p>
              <h4 className="text-xl font-black text-slate-800">
                총 {formatBankMoney(debtState.total)}{" "}
                <span className="text-sm font-medium text-slate-400">
                  {currencyUnit}
                </span>
              </h4>
            </div>
            <div
              className={`p-2 bg-white rounded-xl border shadow-sm ${isUrgent ? "border-rose-100" : "border-blue-50"}`}
            >
              {isUrgent ? (
                <FireIcon className="w-6 h-6 text-rose-500 animate-pulse" />
              ) : (
                <BanknotesIcon className="w-6 h-6 text-indigo-300" />
              )}
            </div>
          </div>

          {/* 상세 내역 그리드 */}
          <div
            className={`grid grid-cols-3 gap-2 pt-4 border-t ${isUrgent ? "border-rose-100/50" : "border-indigo-100/50"}`}
          >
            <div>
              <p className="text-[10px] font-bold text-slate-400 mb-0.5">
                남은 원금
              </p>
              <p className="text-sm font-bold text-slate-600">
                {formatBankMoney(debtState.principal)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 mb-0.5">
                밀린 이자
              </p>
              <p className="text-sm font-bold text-blue-500">
                +{formatBankMoney(debtState.interest)}
              </p>
            </div>

            {/* 🚀 연체료 섹션: 미납액과 납부총액 분리 표시 */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 mb-0.5">
                연체료 (미납)
              </p>
              <p
                className={`text-sm font-bold ${debtState.penalty > 0 ? "text-rose-500" : "text-slate-300"}`}
              >
                +{formatBankMoney(debtState.penalty)}
              </p>
              {totalPenaltyPaid > 0 && (
                <p className="text-[9px] font-medium text-slate-400 mt-0.5">
                  (납부됨: {formatBankMoney(totalPenaltyPaid)})
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 2. 내 지갑 정보 */}
        <div className="flex items-center justify-between px-2">
          <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <WalletIcon className="w-4 h-4 text-slate-300" /> 상환 가능 현금
          </span>
          <span className="text-sm font-black text-slate-700">
            {formatBankMoney(currentCash)} {currencyUnit}
          </span>
        </div>

        {/* 3. 입력창 (버튼 정렬 수정됨) */}
        <div className="relative group">
          <InputField
            id="repayAmountInputModal"
            label="얼마를 갚을까요?"
            type="number"
            value={repayAmountStr}
            onChange={(e) => setRepayAmountStr(e.target.value)}
            disabled={isActionPending}
            placeholder="0"
            className={`!mb-0 text-right font-black text-lg pr-24 focus:border-${themeColor}-400 transition-all`}
          />

          <Button
            size="xs"
            tone="slate"
            kind="soft"
            rounded="lg"
            onClick={handleSetMaxAmount}
            disabled={isActionPending}
            className="absolute bottom-[11px] right-3 z-10 text-[10px]"
          >
            전액 입력
          </Button>

          {validationMessage && (
            <p className="absolute -bottom-5 left-1 text-[10px] font-bold text-rose-500 flex items-center gap-1 animate-pulse">
              <InformationCircleIcon className="w-3 h-3" /> {validationMessage}
            </p>
          )}
        </div>

        {/* 4. 시뮬레이션 결과 */}
        {simulateRepayment()}

        {/* 5. 하단 버튼 */}
        <div className="flex gap-3 pt-4">
          <Button size="md"
            kind="soft"
            tone="slate"
            onClick={onClose}
            disabled={isActionPending}
            className="flex-1 transition-colors"
          >
            취소
          </Button>
          <Button
            tone={isUrgent ? "rose" : "blue"}
            onClick={handleConfirmRepay}
            icon={isUrgent ? FireIcon : CheckBadgeIcon}
            isLoading={isActionPending}
            loadingText={isUrgent ? "연체 해결 중..." : "상환 중…"}
            disabled={!isValidAmount || isActionPending}
            className={`flex-[1.5] transition-all  ${!isValidAmount || isActionPending ? "opacity-50 cursor-not-allowed" : ""}  ${isUrgent ? "" : ""}  `}
          >
            {isUrgent ? "연체 해결하기" : "상환하기"}
          </Button>
        </div>
      </div>
    </GenericModal>
  );
}
