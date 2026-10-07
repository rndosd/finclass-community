import React from "react";
import {
  ArrowDownTrayIcon,
  BanknotesIcon,
  InformationCircleIcon,
  ReceiptPercentIcon,
} from "@heroicons/react/24/solid";

import { Button, Modal } from "../../../components/ui";
import { formatBankMoney } from "../../../utils/bankMoney";

const formatMoney = (value, currencyUnit) =>
  `${formatBankMoney(value)}${currencyUnit || ""}`;

export default function SavingClaimConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  saving,
  breakdown,
  payoutAmount,
  currencyUnit,
  isSubmitting,
}) {
  if (!isOpen || !saving || !breakdown) return null;

  const showWithholdingSection = breakdown.shouldShowWithholding;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="">
      <div className="space-y-7 p-8">
        <div className="pr-8 text-left">
          <h2 className="text-2xl font-black leading-tight tracking-tight text-slate-900">
            만기 수령을 진행할까요?
          </h2>
          <p className="mt-2 text-sm font-bold text-slate-400">
            원금과 이자 지급 내역을 확인한 뒤 만기 수령을 실행할 수 있어요.
          </p>
        </div>

        <div className="relative rounded-[2.5rem] border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-emerald-50 p-6 text-left shadow-sm">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <span className="rounded-md bg-amber-100/70 px-2 py-1 text-[10px] font-black uppercase tracking-tight text-amber-700">
                만기 수령
              </span>
              <h3 className="mt-2 text-3xl font-black tracking-tighter text-slate-900">
                {saving.productLabel}
              </h3>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                최종 수령액 {formatMoney(payoutAmount, currencyUnit)}
              </p>
            </div>
            <div className="rounded-2xl border border-amber-50 bg-white p-3 shadow-sm">
              <BanknotesIcon className="h-6 w-6 text-amber-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-5">
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-slate-400">원금</p>
              <p className="text-lg font-black text-slate-800">
                {formatMoney(breakdown.principal, currencyUnit)}
              </p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-[11px] font-bold text-slate-400">최종 수령액</p>
              <p className="text-lg font-black text-emerald-600">
                {formatMoney(breakdown.totalPaid, currencyUnit)}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 text-left">
          <p className="flex items-center gap-1.5 px-1 text-[11px] font-black uppercase tracking-widest text-slate-400">
            <ReceiptPercentIcon className="h-4 w-4 text-slate-300" />
            수령 금액 안내
          </p>

          <div className="space-y-4 rounded-[1.5rem] border border-slate-100 bg-slate-50/60 p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold text-slate-500">세전 이자</span>
              <span className="font-bold text-emerald-600">
                +{formatMoney(breakdown.grossInterest, currencyUnit)}
              </span>
            </div>

            {showWithholdingSection && (
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-slate-500">
                  원천징수세 ({breakdown.taxRate}%)
                </span>
                <span className="font-bold text-rose-500">
                  -{formatMoney(breakdown.taxAmount, currencyUnit)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-sm">
              <span className="font-bold text-slate-500">실수령 이자</span>
              <span className="font-bold text-slate-700">
                +{formatMoney(breakdown.netInterest, currencyUnit)}
              </span>
            </div>

            <div className="flex items-start gap-2 rounded-2xl bg-white px-4 py-3 text-xs leading-5 text-slate-500 ring-1 ring-slate-100">
              <InformationCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p>
                {showWithholdingSection
                  ? "세전 이자에서 원천징수세를 차감한 뒤 실제 지급 금액이 계산됩니다."
                  : breakdown.isLegacyWithoutWithholdingData
                    ? "이 예금은 원천징수 기준이 저장되기 전에 생성되어 세금 차감 없이 지급됩니다."
                    : "원천징수 없이 만기 이자가 지급됩니다."}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button size="md"
            kind="soft"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1"
          >
            다시 보기
          </Button>
          <Button tone="emerald" kind="solid" size="md"
            onClick={onConfirm}
            isLoading={isSubmitting}
            className="flex-[2] transition-all"
          >
            <div className="flex items-center justify-center gap-2">
              <ArrowDownTrayIcon className="h-5 w-5" />
              <span>만기 수령 실행</span>
            </div>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
