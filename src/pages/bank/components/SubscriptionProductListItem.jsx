import React, { useMemo } from "react";
import dayjs from "dayjs";
import {
  CalendarIcon,
  ChevronDownIcon,
  Cog6ToothIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";

import { Button } from "../../../components/ui";
import { getSubscriptionTypeAsset } from "../../../assets/illustrations/subscriptionTypes";
import { formatBankMoney } from "../../../utils/bankMoney";
import { getSubscriptionDisplayState } from "../utils/subscriptionDisplayState";

const toDay = (value) => {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : value;
  const parsed = dayjs(date);
  return parsed.isValid() ? parsed : null;
};

const totalValid = (history = []) =>
  history.reduce((total, entry) => total + (entry?.isCancelled ? 0 : Number(entry?.amount || 0)), 0);

export default function SubscriptionProductListItem({
  product,
  participation,
  isOpen,
  isLast,
  showDetail = true,
  userRole,
  currencyUnit,
  currentRound,
  onSelect,
  onOpenDepositModal,
  onOpenHistoryModal,
  onOpenLotteryModal,
  onWithdraw,
  onTerminate,
  isSubmitting,
}) {
  const isManager = userRole === "teacher" || userRole === "admin";
  const asset = getSubscriptionTypeAsset(product);

  const state = useMemo(() => {
    const now = dayjs();
    const nextDate = toDay(participation?.nextPaymentDate);
    const endDate = toDay(product?.endDate);
    const isTerminated = !!participation?.isTerminated;
    const isWithdrawn = !!participation?.isWithdrawn;
    const isEnded = !!endDate && now.isAfter(endDate);
    const isPaused = product?.status === "paused" || product?.status === "closed";
    const canDeposit = !isTerminated && !isWithdrawn && !isEnded && !isPaused &&
      (!nextDate || now.isAfter(nextDate) || now.isSame(nextDate, "day"));
    const paymentCount = Number(participation?.paymentCount || 0);
    const requiredPayments = Number(currentRound?.requiredPayments || 0);
    const progress = requiredPayments
      ? Math.min(100, (paymentCount / requiredPayments) * 100)
      : 0;

    let label = "가입 가능";
    let tone = "emerald";
    if (isTerminated) { label = "해지 완료"; tone = "slate"; }
    else if (isPaused) { label = "운영 중단"; tone = "slate"; }
    else if (isEnded) { label = isWithdrawn ? "수령 완료" : "만기"; tone = "amber"; }
    else if (participation) { label = canDeposit ? "납입 가능" : "다음 납입 대기"; tone = canDeposit ? "blue" : "slate"; }

    return {
      canDeposit,
      isMatured: isEnded && !!participation && !isWithdrawn,
      isTerminated,
      paymentCount,
      requiredPayments,
      progress,
      validAmount: totalValid(participation?.paymentHistory || []),
      validCount: (participation?.paymentHistory || []).filter((entry) => !entry?.isCancelled).length,
      nextDateLabel: nextDate ? nextDate.format("M월 D일") : null,
      label,
      tone,
      ...getSubscriptionDisplayState({ product, participation }),
    };
  }, [currentRound, participation, product]);

  const toneClass = {
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-100 text-slate-500",
  }[state.tone];

  return (
    <article className={(isLast ? "" : "border-b border-slate-200") + (isOpen ? " bg-blue-50/40" : "")}>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-4 px-5 py-5 text-left transition hover:bg-slate-50 sm:px-7"
      >
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-50 p-2">
          <img src={asset} alt="" aria-hidden="true" className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-black text-slate-900">{product?.title || "청약 상품"}</h3>
            <span className={"rounded-full px-2.5 py-1 text-[11px] font-black " + toneClass}>{state.label}</span>
          </div>
          <p className="mt-1 truncate text-sm font-medium text-slate-500">
            {product?.description || "차곡차곡 납입하고 추첨 기회를 쌓아보세요."}
          </p>
          <p className="mt-2 text-xs font-bold text-slate-400">
            1회 {formatBankMoney(product?.minAmount || 0)}{currencyUnit}부터 · {product?.paymentCycle || 7}일마다 납입
          </p>
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-xs font-bold text-slate-400">{participation ? "현재 납입액" : "다음 단계"}</p>
          <p className="mt-1 font-black text-slate-800">
            {participation ? formatBankMoney(participation.totalAmount || 0) + currencyUnit : "청약하기"}
          </p>
        </div>
        <ChevronDownIcon className={"h-5 w-5 shrink-0 text-slate-400 transition-transform " + (isOpen ? "rotate-180" : "")} />
      </button>

      {isOpen && showDetail ? (
        <div className="bg-slate-50 px-5 pb-6 pt-1 sm:px-7">
          <div className="border-t border-slate-200 pt-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat label="총 납입액" value={formatBankMoney(participation?.totalAmount || 0) + currencyUnit} />
                  <Stat label="유효 납입" value={formatBankMoney(state.validAmount) + currencyUnit} />
                  <Stat label={state.nextDateLabel ? "다음 납입일" : "납입 횟수"} value={state.nextDateLabel || state.paymentCount + "회"} />
                </div>

                {currentRound ? (
                  <div className="mt-5 rounded-2xl border border-blue-100 bg-white px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 font-black text-slate-800">
                        <TrophyIcon className="h-5 w-5 text-blue-600" />
                        {currentRound.roundNumber}회차 추첨 참여 현황
                      </p>
                      <span className="text-sm font-black text-blue-600">
                        {Math.max(0, state.requiredPayments - state.paymentCount)}회 더 납입
                      </span>
                    </div>
                    <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-blue-600" style={{ width: state.progress + "%" }} />
                    </div>
                    <p className="mt-2 text-xs font-bold text-slate-500">
                      {state.paymentCount}회 납입 · 추첨 조건 {state.requiredPayments}회
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col justify-end gap-2">
                <Button size="md"
                  kind="solid"
                  tone="blue"
                  className="w-full"
                  onClick={state.isMatured ? onWithdraw : onOpenDepositModal}
                  disabled={(!state.canDeposit && !state.isMatured) || isSubmitting}
                  isLoading={isSubmitting}
                >
                  {state.isMatured ? "만기 금액 수령하기" : state.canDeposit ? "납입하기" : state.label}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button kind="outline" tone="blue" className="w-full" onClick={onOpenHistoryModal} disabled={!participation}>
                    <CalendarIcon className="mr-1.5 h-4 w-4" />
                    내역
                  </Button>
                  {isManager ? (
                    <Button kind="outline" tone="slate" className="w-full" onClick={onOpenLotteryModal}>
                      <Cog6ToothIcon className="mr-1.5 h-4 w-4" />
                      추첨 설정
                    </Button>
                  ) : (
                    <Button
                      kind="outline"
                      tone="red"
                      className="w-full"
                      onClick={onTerminate}
                      disabled={!participation || isSubmitting || state.isMatured || state.isTerminated || product?.earlyTerminationBlocked}
                    >
                      해지
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {participation ? (
              <p className="mt-4 text-xs font-medium text-slate-400">
                유효 납입 {state.validCount}회 · 납입 금액과 추첨 조건은 상품별로 달라질 수 있어요.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-bold text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-800">{value}</p>
    </div>
  );
}
