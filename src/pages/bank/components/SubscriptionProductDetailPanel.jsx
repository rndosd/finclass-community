import React, { useMemo } from "react";
import dayjs from "dayjs";
import {
  CalendarIcon,
  Cog6ToothIcon,
  InformationCircleIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";

import { Button } from "../../../components/ui";
import { getSubscriptionTypeAsset } from "../../../assets/illustrations/subscriptionTypes";
import { formatBankMoney } from "../../../utils/bankMoney";
import { getSubscriptionDisplayState } from "../utils/subscriptionDisplayState";

const toDay = (value) => {
  if (!value) return null;
  const parsed = dayjs(value?.toDate ? value.toDate() : value);
  return parsed.isValid() ? parsed : null;
};

export default function SubscriptionProductDetailPanel({
  product,
  participation,
  userRole,
  currencyUnit,
  currentRound,
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
    const next = toDay(participation?.nextPaymentDate);
    const start = toDay(product?.startDate);
    const end = toDay(product?.endDate);
    const ended = !!end && now.isAfter(end);
    const terminated = !!participation?.isTerminated;
    const withdrawn = !!participation?.isWithdrawn;
    const paused = product?.status === "paused" || product?.status === "closed";
    const canDeposit = !terminated && !withdrawn && !ended && !paused &&
      (!next || now.isAfter(next) || now.isSame(next, "day"));
    const count = Number(participation?.paymentCount || 0);
    const required = Number(currentRound?.requiredPayments || 0);
    return {
      canDeposit,
      isMatured: ended && !!participation && !withdrawn,
      terminated,
      count,
      required,
      progress: required ? Math.min(100, (count / required) * 100) : 0,
      nextLabel: next ? next.format("M월 D일") : "지금 가능",
      minAmount: Number(product?.minAmount || 0),
      paymentCycle: Number(product?.paymentCycle || 7),
      periodLabel: start || end
        ? (start ? start.format("M/D") : "시작일 미정") + " ~ " + (end ? end.format("M/D") : "상시")
        : "상시 운영",
      ...getSubscriptionDisplayState({ product, participation }),
    };
  }, [currentRound, participation, product]);

  if (!product) {
    return (
      <section className="flex min-h-[420px] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <div>
          <p className="font-black text-slate-700">청약 상품을 선택하세요</p>
          <p className="mt-2 text-sm text-slate-500">왼쪽 목록에서 상품을 고르면 상세 정보를 볼 수 있어요.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-[590px] flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
      <div className="flex items-start gap-4 border-b border-slate-200 pb-6">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-blue-50 p-3">
          <img src={asset} alt="" aria-hidden="true" className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-black tracking-tight text-slate-900">{product.title}</h2>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-600">
              {state.label}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-500">
            {product.description || "차곡차곡 납입하고 추첨 기회를 쌓아보세요."}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="총 납입액" value={formatBankMoney(participation?.totalAmount || 0) + currencyUnit} />
        <Stat label="납입 횟수" value={state.count + "회"} />
        <Stat label="다음 납입일" value={state.nextLabel} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-black text-slate-800">상품 조건</h3>
          <div className="mt-4 divide-y divide-slate-100">
            <InfoLine label="1회 납입" value={formatBankMoney(state.minAmount) + currencyUnit + "부터"} />
            <InfoLine label="납입 주기" value={state.paymentCycle + "일마다"} />
            <InfoLine label="운영 기간" value={state.periodLabel} />
          </div>
        </section>
        <section className="rounded-2xl border border-blue-100 bg-blue-50/40 p-5">
          <h3 className="text-sm font-black text-slate-800">현재 해야 할 일</h3>
          <p className="mt-3 text-lg font-black text-blue-700">
            {state.actionText}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {currentRound
              ? "납입을 완료하면 이번 추첨 참여 조건에 반영돼요."
              : "추첨 일정은 선생님이 등록하면 이곳에 표시돼요."}
          </p>
        </section>
      </div>

      {currentRound ? (
        <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TrophyIcon className="h-5 w-5 text-blue-600" />
              <p className="font-black text-slate-800">{currentRound.roundNumber}회차 추첨 참여 현황</p>
            </div>
            <span className="font-black text-blue-600">
              {Math.max(0, state.required - state.count)}회 더 납입
            </span>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: state.progress + "%" }} />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-500">
            {state.count}회 납입 완료 · {state.required}회 납입하면 추첨에 참여할 수 있어요.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-500">
          <InformationCircleIcon className="h-5 w-5 text-blue-500" />
          추첨 일정이 등록되면 참여 조건을 확인할 수 있어요.
        </div>
      )}

      <div className="mt-auto grid gap-3 pt-7 sm:grid-cols-[1fr_auto]">
        <Button size="md"
          kind="solid"
          tone="blue"
          
          onClick={state.isMatured ? onWithdraw : onOpenDepositModal}
          disabled={(!state.canDeposit && !state.isMatured) || isSubmitting}
          isLoading={isSubmitting}
        >
          {state.isMatured ? "만기 금액 수령하기" : state.canDeposit ? "납입하기" : state.label}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button kind="outline" tone="blue" onClick={onOpenHistoryModal} disabled={!participation}>
            <CalendarIcon className="mr-1.5 h-4 w-4" />
            내역
          </Button>
          {isManager ? (
            <Button kind="outline" tone="slate" onClick={onOpenLotteryModal}>
              <Cog6ToothIcon className="mr-1.5 h-4 w-4" />
              추첨 설정
            </Button>
          ) : (
            <Button
              kind="outline"
              tone="red"
              onClick={onTerminate}
              disabled={!participation || isSubmitting || state.isMatured || state.terminated || product.earlyTerminationBlocked}
            >
              해지
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function InfoLine({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="font-semibold text-slate-500">{label}</span>
      <span className="font-black text-slate-800">{value}</span>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
      <p className="text-xs font-bold text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-800">{value}</p>
    </div>
  );
}
