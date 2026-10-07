import React from "react";
import { Modal, Button } from "../../../components/ui";
import {
  CheckCircleIcon,
  BanknotesIcon,
  StarIcon,
  CalendarDaysIcon,
  ArrowUpRightIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/solid";
import { formatBankMoney } from "../../../utils/bankMoney";

export default function DepositConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  product,
  depositAmount,
  studentCreditInfo,
  finalCalculations,
  currencyUnit,
  isSubmitting,
}) {
  // 🚀 [방어 1] 모달이 닫혀있거나 필수 데이터가 없으면 아예 렌더링하지 않음
  if (!isOpen || !product || !finalCalculations) return null;

  // 🚀 [방어 2] 숫자 및 데이터 안전 확보
  const amount = Number(depositAmount || 0);
  const {
    baseInterestAmount = 0,
    tierBonusInterestAmount = 0,
    totalEstimatedInterest = 0,
    finalPeriodRate = 0,
  } = finalCalculations;

  const productBaseRate = Number(product?.rate ?? 0);
  const tierName = studentCreditInfo?.tierFullName || "일반";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="">
      <div className="p-8 space-y-7">
        <div className="pr-8 text-left">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-tight">
            예금 가입을 진행할까요?
          </h2>
          <p className="text-sm text-slate-400 font-bold mt-2">
            선택하신 상품과 우대 혜택을 확인해 주세요.
          </p>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-6 rounded-[2.5rem] border border-emerald-100 shadow-sm relative text-left">
          <div className="flex justify-between items-start mb-6">
            <div>
              <span className="text-[10px] font-black text-emerald-600 bg-emerald-100/50 px-2 py-1 rounded-md uppercase tracking-tighter">
                {product?.label || "정기 예금"}
              </span>
              <h3 className="text-3xl font-black text-slate-900 mt-2 tracking-tighter">
                {formatBankMoney(amount)}
                <span className="text-lg font-bold text-slate-400 ml-1.5">
                  {currencyUnit}
                </span>
              </h3>
            </div>
            <div className="p-3 bg-white rounded-2xl shadow-sm border border-emerald-50">
              <BanknotesIcon className="w-6 h-6 text-emerald-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-5 border-t border-slate-100">
            <div className="space-y-1">
              <p className="text-[11px] text-slate-400 font-bold flex items-center gap-1">
                <CalendarDaysIcon className="w-3.5 h-3.5" /> 예치 기간
              </p>
              <p className="text-md font-black text-slate-700">
                {product?.days || 0}일
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-slate-400 font-bold flex items-center gap-1">
                <ArrowUpRightIcon className="w-3.5 h-3.5 text-emerald-500" />{" "}
                최종 금리
              </p>
              <p className="text-md font-black text-emerald-600">
                {(finalPeriodRate || 0).toFixed(2)}%
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-slate-400">가입 한도</p>
              <p className="text-md font-black text-slate-700">
                {product?.maxDepositProductLimit
                  ? formatBankMoney(product.maxDepositProductLimit) +
                    currencyUnit
                  : "무제한"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-slate-400">중도해지</p>
              <p
                className={
                  "text-md font-black " +
                  (product?.earlyTerminationBlocked === true
                    ? "text-rose-600"
                    : "text-emerald-600")
                }
              >
                {product?.earlyTerminationBlocked === true ? "불가" : "가능"}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 text-left">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 px-1">
            <InformationCircleIcon className="w-4 h-4 text-slate-300" /> 예상
            수익 리포트
          </p>

          <div className="bg-slate-50/50 rounded-[1.5rem] p-5 border border-slate-100 space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500 font-bold">
                기본 금리 이자 ({productBaseRate.toFixed(1)}%)
              </span>
              <span className="font-bold text-slate-700">
                +{formatBankMoney(baseInterestAmount)}
              </span>
            </div>

            <div className="flex justify-between items-center text-sm">
              <div className="flex items-center gap-1.5">
                <div className="p-1 bg-amber-100 rounded-md">
                  <StarIcon className="w-3.5 h-3.5 text-amber-500" />
                </div>
                <span className="text-slate-500 font-bold">
                  {tierName} 등급 우대
                </span>
              </div>
              <span className="font-bold text-emerald-500">
                {tierBonusInterestAmount > 0
                  ? "+"
                  : tierBonusInterestAmount < 0
                    ? "-"
                    : ""}
                {formatBankMoney(Math.abs(tierBonusInterestAmount))}
              </span>
            </div>

            <div className="pt-4 border-t border-dashed border-slate-200 flex justify-between items-end">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 font-bold">
                  만기 시 받을 총 이자
                </span>
                <span className="text-sm font-black text-slate-800">
                  최종 예상 수익
                </span>
              </div>
              <span className="text-2xl font-black text-emerald-600">
                +{formatBankMoney(totalEstimatedInterest)}{" "}
                <span className="text-sm">{currencyUnit}</span>
              </span>
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
            다음에 할게요
          </Button>
          <Button tone="emerald" kind="solid" size="md"
            onClick={onConfirm}
            isLoading={isSubmitting}
            className="flex-[2] transition-all"
          >
            <div className="flex items-center justify-center gap-2">
              <CheckCircleIcon className="w-5 h-5" />
              <span>가입 신청하기</span>
            </div>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
