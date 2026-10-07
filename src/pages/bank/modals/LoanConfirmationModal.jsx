import React, { useEffect, useState } from "react";
import { Modal, Button } from "../../../components/ui";
import SignaturePad from "../../../components/ui/SignaturePad";
import {
  CheckCircleIcon,
  CreditCardIcon,
  StarIcon,
  CalendarDaysIcon,
  ArrowUpRightIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/solid";
import { formatBankMoney } from "../../../utils/bankMoney";

function LoanConfirmationLegacy({
  isOpen,
  onClose,
  onConfirm,
  product,
  loanAmount,
  studentCreditInfo,
  finalCalculations,
  currencyUnit,
  isSubmitting,
}) {
  // 🚀 [방어 1] 필수 데이터 체크
  if (!isOpen || !product || !finalCalculations) return null;

  const amount = Number(loanAmount || 0);
  const {
    baseInterestAmount = 0,
    tierBonusInterestAmount = 0,
    totalEstimatedInterest = 0,
    finalPeriodRate = 0,
  } = finalCalculations;

  const productBaseRate = Number(product?.periodRate ?? 0);
  const overdueRate = Number(product?.overdueRate ?? 0);
  const tierName = studentCreditInfo?.tierFullName || "일반";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="">
      <div className="p-8 space-y-7">
        <div className="pr-8 text-left">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-tight">
            대출 신청을 진행할까요?
          </h2>
          <p className="text-sm text-slate-400 font-bold mt-2">
            상환 조건과 연체 시 벌금 규정을 확인해 주세요.
          </p>
        </div>

        <div className="bg-gradient-to-br from-rose-50 via-white to-pink-50 p-6 rounded-[2.5rem] border border-rose-100 shadow-sm relative text-left">
          <div className="flex justify-between items-start mb-6">
            <div>
              <span className="text-[10px] font-black text-rose-600 bg-rose-100/50 px-2 py-1 rounded-md uppercase tracking-tighter">
                {product?.label || "정기 대출"}
              </span>
              <h3 className="text-3xl font-black text-slate-900 mt-2 tracking-tighter">
                {formatBankMoney(amount)}
                <span className="text-lg font-bold text-slate-400 ml-1.5">
                  {currencyUnit}
                </span>
              </h3>
            </div>
            <div className="p-3 bg-white rounded-2xl shadow-sm border border-rose-50">
              <CreditCardIcon className="w-6 h-6 text-rose-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-5 border-t border-slate-100">
            <div className="space-y-1">
              <p className="text-[11px] text-slate-400 font-bold flex items-center gap-1">
                <CalendarDaysIcon className="w-3.5 h-3.5" /> 대출 기간
              </p>
              <p className="text-md font-black text-slate-700">
                {product?.days || 0}일
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-slate-400 font-bold flex items-center gap-1">
                <ArrowUpRightIcon className="w-3.5 h-3.5 text-rose-500" /> 최종
                적용 이율
              </p>
              <p className="text-md font-black text-rose-600">
                {(finalPeriodRate || 0).toFixed(2)}%
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-slate-400">상품 한도</p>
              <p className="text-md font-black text-slate-700">
                {product?.maxLoanProductLimit
                  ? formatBankMoney(product.maxLoanProductLimit) + currencyUnit
                  : "무제한"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-slate-400">연체 벌금</p>
              <p className="text-md font-black text-amber-600">
                하루 {formatBankMoney(overdueRate)}%
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 text-left">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 px-1">
            <InformationCircleIcon className="w-4 h-4 text-slate-300" /> 예상
            비용 분석 리포트
          </p>

          <div className="bg-slate-50/50 rounded-[1.5rem] p-5 border border-slate-100 space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500 font-bold">
                기본 이자 ({productBaseRate.toFixed(1)}%)
              </span>
              <span className="font-bold text-slate-700">
                +{formatBankMoney(baseInterestAmount)}
              </span>
            </div>

            <div className="flex justify-between items-center text-sm">
              <div className="flex items-center gap-1.5">
                <div className="p-1 bg-blue-100 rounded-md">
                  <StarIcon className="w-3.5 h-3.5 text-blue-500" />
                </div>
                <span className="text-slate-500 font-bold">
                  {tierName} 등급 우대 적용
                </span>
              </div>
              <span
                className={`font-bold ${tierBonusInterestAmount <= 0 ? "text-blue-500" : "text-rose-500"}`}
              >
                {tierBonusInterestAmount > 0 ? "+" : ""}
                {formatBankMoney(tierBonusInterestAmount)}
              </span>
            </div>

            <div className="pt-3 border-t border-dashed border-slate-200 flex justify-between items-center text-xs">
              <span className="text-amber-600 font-black flex items-center gap-1">
                <ExclamationTriangleIcon className="w-3.5 h-3.5" /> 만기 이후
                하루 벌금
              </span>
              <span className="font-black text-amber-600">
                원금의 {overdueRate}%씩 추가
              </span>
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-between items-end">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 font-bold">
                  정상 상환 시 내야 할 총 이자
                </span>
                <span className="text-sm font-black text-slate-800">
                  최종 예상 비용
                </span>
              </div>
              <span className="text-2xl font-black text-rose-600">
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
            취소하기
          </Button>
          <Button tone="rose" kind="solid" size="md"
            onClick={onConfirm}
            isLoading={isSubmitting}
            className="flex-[2] transition-all"
          >
            <div className="flex items-center justify-center gap-2">
              <CheckCircleIcon className="w-5 h-5" />
              <span>대출 신청 확정</span>
            </div>
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const CONTRACT_CHECKLIST = [
  "빌리는 금액과 갚는 날짜를 확인했습니다.",
  "정상 상환액에 원금과 이자가 포함되는 것을 확인했습니다.",
  "늦게 갚으면 하루 연체료가 추가되는 것을 확인했습니다.",
];

function LoanContractConfirmation({
  isOpen,
  onClose,
  onConfirm,
  product,
  loanAmount,
  studentCreditInfo,
  finalCalculations,
  currencyUnit,
  isSubmitting,
  studentName = "학생",
  classDisplayName = "우리 반",
}) {
  const [checkedItems, setCheckedItems] = useState([]);
  const [signatureImage, setSignatureImage] = useState(null);
  const amount = Number(loanAmount || 0);
  const overdueRate = Number(product?.overdueRate ?? 0.5);
  const totalInterest = Number(finalCalculations?.totalEstimatedInterest || 0);
  const totalRepayment = amount + totalInterest;
  const allChecked = checkedItems.length === CONTRACT_CHECKLIST.length;

  useEffect(() => {
    if (!isOpen) return;
    setCheckedItems([]);
    setSignatureImage(null);
  }, [isOpen]);

  if (!isOpen || !product || !finalCalculations) return null;

  const toggleChecklist = (index) => {
    setCheckedItems((previous) =>
      previous.includes(index)
        ? previous.filter((item) => item !== index)
        : [...previous, index],
    );
  };

  const canSubmit = allChecked && Boolean(signatureImage) && !isSubmitting;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="xl">
      <div className="max-h-[82vh] space-y-5 overflow-y-auto p-5 text-left sm:p-7">
        <div className="flex items-start justify-between gap-4 border-b-2 border-rose-500 pb-4">
          <div>
            <p className="text-[11px] font-black tracking-[0.16em] text-rose-500">LOAN CONTRACT</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
              {classDisplayName} 대출 계약서
            </h2>
            <p className="mt-1 text-sm font-bold text-slate-500">대출 신청 내용을 확인하고 서명해 주세요.</p>
          </div>
          <DocumentTextIcon className="h-9 w-9 shrink-0 text-rose-500" />
        </div>

        <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4">
          <h3 className="mb-2 text-xs font-black text-rose-600">계약 기본 정보</h3>
          <dl className="grid overflow-hidden rounded-xl border border-rose-200 bg-white sm:grid-cols-2">
            <div className="flex border-b border-rose-100 sm:border-r"><dt className="w-28 shrink-0 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">대출 상품</dt><dd className="px-3 py-2 text-sm font-black text-slate-800">{product.label || "대출 상품"}</dd></div>
            <div className="flex border-b border-rose-100"><dt className="w-28 shrink-0 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">대출자</dt><dd className="px-3 py-2 text-sm font-black text-slate-800">{studentName}</dd></div>
            <div className="flex sm:border-r"><dt className="w-28 shrink-0 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">대출 기간</dt><dd className="px-3 py-2 text-sm font-black text-slate-800">{product.days || 0}일</dd></div>
            <div className="flex"><dt className="w-28 shrink-0 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">적용 이율</dt><dd className="px-3 py-2 text-sm font-black text-rose-600">{Number(finalCalculations.finalPeriodRate || 0).toFixed(2)}%</dd></div>
          </dl>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-black text-rose-600">대출 조건</h3>
          <dl className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2">
            <div className="flex border-b border-slate-100 sm:border-r"><dt className="w-28 shrink-0 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">대출 원금</dt><dd className="px-3 py-2 text-sm font-black text-slate-800">{formatBankMoney(amount)} {currencyUnit}</dd></div>
            <div className="flex border-b border-slate-100"><dt className="w-28 shrink-0 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">정상 상환액</dt><dd className="px-3 py-2 text-sm font-black text-slate-800">{formatBankMoney(totalRepayment)} {currencyUnit}</dd></div>
            <div className="flex sm:border-r"><dt className="w-28 shrink-0 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">신용 등급</dt><dd className="px-3 py-2 text-sm font-black text-slate-800">{studentCreditInfo?.tierFullName || "일반"}</dd></div>
            <div className="flex"><dt className="w-28 shrink-0 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">연체료</dt><dd className="px-3 py-2 text-sm font-black text-amber-600">하루 원금의 {overdueRate}%</dd></div>
          </dl>
        </section>

        <section className="rounded-xl border border-rose-200 border-l-4 p-4">
          <h3 className="mb-2 text-xs font-black text-rose-600">계약 내용</h3>
          <ol className="list-decimal space-y-1.5 pl-5 text-xs font-medium leading-relaxed text-slate-700">
            <li>{studentName}은(는) {classDisplayName}에서 {formatBankMoney(amount)} {currencyUnit}를 빌립니다.</li>
            <li>대출 기간은 {product.days || 0}일이며, 정해진 상환일까지 정상 상환합니다.</li>
            <li>정상 상환액은 원금과 약정 이자를 합산한 {formatBankMoney(totalRepayment)} {currencyUnit}입니다.</li>
            <li>상환일 이후에는 원금의 하루 {overdueRate}% 연체료가 추가됩니다.</li>
            <li>대출 신청, 승인, 상환과 정산은 학급 은행 규칙에 따라 처리합니다.</li>
          </ol>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <h3 className="mb-2 text-xs font-black text-rose-600">대출자 확인</h3>
          <div className="space-y-1.5">
            {CONTRACT_CHECKLIST.map((label, index) => (
              <label key={label} className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={checkedItems.includes(index)} onChange={() => toggleChecklist(index)} className="h-4 w-4 rounded border-slate-300 text-rose-500 focus:ring-rose-400" />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="h-[170px] w-full flex-none overflow-hidden rounded-xl border border-slate-200 bg-white sm:h-[190px] sm:w-2/3">
              <SignaturePad onSign={() => {}} onEnd={setSignatureImage} />
            </div>
            <div className="flex items-end justify-end sm:w-44">
              <p className="text-right text-lg font-black leading-relaxed text-slate-700">
                {studentName}
                <br />
                <span className="text-sm font-bold text-slate-400">대출자 서명</span>
              </p>
            </div>
          </div>
        </section>

        <div className="flex gap-3 pt-1">
          <Button size="md" kind="soft" onClick={onClose} disabled={isSubmitting} className="flex-1">취소하기</Button>
          <Button tone="rose" kind="solid" size="md" onClick={() => onConfirm({ borrowerSignatureImg: signatureImage })} disabled={!canSubmit} isLoading={isSubmitting} className="flex-[2]">
            <CheckCircleIcon className="mr-2 inline h-5 w-5" /> 계약서 확인 후 대출 신청
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function LoanConfirmationModal(props) {
  if (props.loanContractEnabled) {
    return <LoanContractConfirmation {...props} />;
  }

  return <LoanConfirmationLegacy {...props} />;
}
