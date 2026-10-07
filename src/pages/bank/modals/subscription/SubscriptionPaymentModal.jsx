import React, { useEffect, useMemo, useState } from "react";
import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import Modal from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui";
import { formatBankMoney } from "../../../../utils/bankMoney";

const DAY_MS = 24 * 60 * 60 * 1000;

const toJSDate = (value) => {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const converted = value.toDate();
    return Number.isNaN(converted?.getTime?.()) ? null : converted;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = toJSDate(value);
  if (!date) return "-";
  return date.toLocaleDateString("ko-KR");
};

const SubscriptionPaymentModal = ({
  isOpen,
  onClose,
  product,
  participation,
  currencyUnit = "원",
  studentAssets,
  onConfirm,
  isSubmitting,
}) => {
  const [amount, setAmount] = useState("");
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setAmount("");
    setIsLocked(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isSubmitting) {
      setIsLocked(false);
    }
  }, [isSubmitting]);

  const safeProduct = product || {};
  const minAmount = Number(safeProduct?.minAmount ?? 0);
  const maxAmount =
    safeProduct?.maxAmount != null ? Number(safeProduct.maxAmount) : null;
  const cycleDays = Math.max(1, Number(safeProduct?.paymentCycle || 7));

  const now = new Date();
  const startDate = toJSDate(safeProduct?.startDate);
  const endDate = toJSDate(safeProduct?.endDate);

  const amountNum = Number(amount || 0);
  const balance = Number(studentAssets?.cash || 0);
  const paidCount = Number(participation?.paymentCount || 0);
  const nextPaymentNumber = paidCount + 1;

  const lastPaidDate = toJSDate(participation?.lastPaymentDate);
  const nextPaymentDateMs = lastPaidDate
    ? lastPaidDate.getTime() + cycleDays * DAY_MS
    : null;

  const isStarted = !startDate || now >= startDate;
  const isBeforeEnd = !endDate || now <= endDate;
  const isInRange =
    amountNum > 0 &&
    amountNum >= minAmount &&
    (maxAmount == null || amountNum <= maxAmount);
  const hasBalance = balance >= amountNum;
  const isCyclePassed = !nextPaymentDateMs || now.getTime() >= nextPaymentDateMs;

  const isActionPending = !!isSubmitting || isLocked;
  const canConfirm =
    !!product &&
    !isActionPending &&
    isStarted &&
    isBeforeEnd &&
    isInRange &&
    hasBalance &&
    isCyclePassed;

  const issues = useMemo(() => {
    const list = [];

    if (!product) {
      list.push("상품 정보를 불러오지 못했습니다.");
      return list;
    }

    if (!isStarted) list.push("아직 납입 시작일 전입니다.");
    if (!isBeforeEnd) list.push("납입 가능 기간이 종료되었습니다.");

    if (!isCyclePassed && nextPaymentDateMs) {
      list.push(
        `다음 납입 가능일은 ${formatDate(new Date(nextPaymentDateMs))}입니다.`,
      );
    }

    if (amountNum > 0 && !isInRange) {
      const rangeText =
        maxAmount != null
          ? `${formatBankMoney(minAmount)} ~ ${formatBankMoney(maxAmount)}`
          : `${formatBankMoney(minAmount)} 이상`;
      list.push(`납입 금액은 ${rangeText} ${currencyUnit} 범위여야 합니다.`);
    }

    if (amountNum > 0 && !hasBalance) {
      list.push("보유 현금이 부족합니다.");
    }

    return list;
  }, [
    product,
    isStarted,
    isBeforeEnd,
    isCyclePassed,
    nextPaymentDateMs,
    amountNum,
    isInRange,
    hasBalance,
    minAmount,
    maxAmount,
    currencyUnit,
  ]);

  const handleClose = () => {
    if (isActionPending) return;
    setAmount("");
    setIsLocked(false);
    onClose?.();
  };

  const handleConfirm = async () => {
    if (!canConfirm || isLocked) return;

    setIsLocked(true);
    try {
      await onConfirm?.(amountNum);
    } finally {
      setIsLocked(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="청약 납입" size="md">
      <div className="space-y-6">
        <div className="rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-400 p-6 text-white shadow-md">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">
                선택한 상품
              </p>
              <h3 className="text-lg font-black">{safeProduct.title || "-"}</h3>
            </div>
            <div className="text-right">
              <p className="mb-1 text-[10px] font-bold text-white/70">보유 현금</p>
              <p className="text-2xl font-black">
                {formatBankMoney(balance)}{" "}
                <span className="text-sm font-normal opacity-80">{currencyUnit}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-3xl border border-slate-100 bg-slate-50/50 p-6">
          <div className="space-y-2 text-center">
            <label className="text-sm font-black text-slate-500">납입 금액 입력</label>
            <div className="group relative">
              <input
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0"
                disabled={isActionPending}
                className={`w-full rounded-xl border-2 py-5 text-center text-4xl font-black outline-none transition-all disabled:opacity-70 ${
                  amountNum > 0 && !hasBalance
                    ? "border-red-300 bg-red-50 text-red-500"
                    : "border-slate-100 bg-blue-50/50 text-slate-800 shadow-sm focus:border-blue-500"
                }`}
              />
              <span className="absolute right-6 top-1/2 -translate-y-1/2 font-bold text-slate-300 group-focus-within:text-blue-400">
                {currencyUnit}
              </span>
            </div>
          </div>
        </div>

        {amountNum > 0 && (
          <div className="grid animate-in grid-cols-2 gap-3 slide-in-from-top-2 fade-in px-1">
            <div className="rounded-2xl border border-blue-50 bg-white p-4 shadow-sm">
              <p className="mb-1 text-[10px] font-bold text-slate-400">이번 납입 회차</p>
              <p className="text-lg font-black text-blue-600">{nextPaymentNumber}회차</p>
            </div>
            <div className="rounded-2xl border border-blue-50 bg-white p-4 shadow-sm">
              <p className="mb-1 text-[10px] font-bold text-slate-400">납입 후 잔액</p>
              <p
                className={`text-lg font-black ${
                  hasBalance ? "text-slate-700" : "text-red-500"
                }`}
              >
                {formatBankMoney(balance - amountNum)}{" "}
                <span className="text-xs font-normal opacity-60">{currencyUnit}</span>
              </p>
            </div>
          </div>
        )}

        {issues.length > 0 && (
          <div className="rounded-2xl border border-orange-100 bg-orange-50/50 p-4">
            {issues.map((message, index) => (
              <div
                key={index}
                className="mb-1 flex items-start gap-2 text-orange-600 last:mb-0"
              >
                <ExclamationCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p className="break-keep text-[11px] font-bold">{message}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal.Footer>
        <div className="flex w-full gap-3 p-2">
          <Button size="md"
            variant="outline"
            onClick={handleClose}
            disabled={isActionPending}
            className="flex-1"
          >
            취소
          </Button>
          <Button
            onClick={handleConfirm}
            isLoading={isActionPending}
            loadingText="처리 중..."
            disabled={!canConfirm}
            className={`flex-[2] rounded-2xl py-4 font-black shadow-md transition-all ${
              canConfirm
                ? "bg-blue-500 text-white shadow-blue-100 hover:bg-blue-600"
                : "cursor-not-allowed bg-slate-100 text-slate-300"
            }`}
          >
            납입하기
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default SubscriptionPaymentModal;
