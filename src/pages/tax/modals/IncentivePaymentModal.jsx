import { useNumberFormat as useConfiguredMoney } from "../../../contexts/NumberFormatContext";
import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useState } from "react";
import { Calculator, Gift, Hash, Wallet } from "lucide-react";

import { Button, Modal } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { getBonusDeductionPolicy } from "../../../utils/taxPolicy";
import { payIndividualIncentive } from "../services/payrollService";

const parseNumericInput = (value) => {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return 0;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};



const formatRateLabel = (value) =>
  Number(value || 0).toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

export default function IncentivePaymentModal({
  isOpen,
  onClose,
  classId,
  student,
  onSuccess,
}) {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatCurrency = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { classData } = useUser();
  const { showFeedback } = useFeedback();
  const currencyUnit = classData?.currencyUnit || "미르";
  const bonusDeductionPolicy = getBonusDeductionPolicy(classData);
  const bonusDeductionRate = Number(bonusDeductionPolicy?.taxRate || 0);
  const isBonusDeductionEnabled =
    bonusDeductionPolicy?.enabled === true && bonusDeductionRate > 0;

  const [reason, setReason] = useState("");
  const [incentiveMode, setIncentiveMode] = useState("fixed");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitAmount, setUnitAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setReason("");
    setIncentiveMode("fixed");
    setAmount("");
    setQuantity("1");
    setUnitAmount("");
    setIsSubmitting(false);
  }, [isOpen]);

  const parsedAmount = Math.round(parseNumericInput(amount));
  const parsedQuantity = parseNumericInput(quantity);
  const parsedUnitAmount = Math.round(parseNumericInput(unitAmount));
  const trimmedReason = reason.trim();
  const totalAmount =
    incentiveMode === "quantity"
      ? Math.round(parsedQuantity * parsedUnitAmount)
      : parsedAmount;
  const previewDeductionAmount =
    isBonusDeductionEnabled && totalAmount > 0
      ? Math.min(totalAmount, Math.round(totalAmount * (bonusDeductionRate / 100)))
      : 0;
  const previewNetAmount = Math.max(0, totalAmount - previewDeductionAmount);

  const canSubmit =
    Boolean(trimmedReason) &&
    totalAmount > 0 &&
    !isSubmitting &&
    (incentiveMode === "fixed" ||
      (parsedQuantity > 0 && parsedUnitAmount > 0));

  const handleClose = () => {
    if (isSubmitting) return;
    onClose?.();
  };

  const handleSubmit = async () => {
    if (!trimmedReason) {
      showFeedback("지급 사유를 입력해 주세요.", "warning");
      return;
    }

    if (incentiveMode === "quantity") {
      if (!(parsedQuantity > 0) || !(parsedUnitAmount > 0) || !(totalAmount > 0)) {
        showFeedback("건수와 건당 금액을 모두 0보다 크게 입력해 주세요.", "warning");
        return;
      }
    } else if (!(parsedAmount > 0)) {
      showFeedback("지급 금액을 0보다 크게 입력해 주세요.", "warning");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await payIndividualIncentive(classId, student.uid, {
        jobName: "",
        reason: trimmedReason,
        incentiveMode,
        amount: parsedAmount,
        quantity: parsedQuantity,
        unitAmount: parsedUnitAmount,
        note: "",
      });

      if (!result?.success) {
        showFeedback("인센티브 지급에 실패했습니다.", "error");
        return;
      }

      showFeedback(
        result?.data?.deductionAmount > 0
          ? `${student.name} 인센티브 지급 완료: 실지급 ${formatCurrency(
              result?.data?.amount ?? previewNetAmount,
              currencyUnit,
            )} (공제 ${formatCurrency(
              result?.data?.deductionAmount ?? previewDeductionAmount,
              currencyUnit,
            )})`
          : `${student.name} 인센티브 지급 완료: ${formatCurrency(
              result?.data?.amount ?? previewNetAmount,
              currencyUnit,
            )}`,
        "success",
      );

      onSuccess?.(result.data);
      handleClose();
    } catch (error) {
      showFeedback(error?.message || "인센티브 지급 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="md" showDefaultCloseButton={false}>
      <div className="space-y-5 px-5 pb-6 pt-5 sm:px-6 sm:pb-7 sm:pt-6">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700">
              <Gift className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">인센티브 지급</h2>
              <p className="text-sm text-slate-500">
                {student?.name || "학생"}에게 직업 구분 없이 지급합니다.
              </p>
            </div>
          </div>
          <Button kind="ghost" tone="slate" size="sm" onClick={handleClose}>
            닫기
          </Button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.1fr,0.9fr]">
          <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="space-y-2">
              <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                지급 사유
              </label>
              <input
                type="text"
                maxLength={60}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="예: 발표 우수, 활동 보상"
                className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button size="sm"
                kind={incentiveMode === "fixed" ? "solid" : "soft"}
                tone={incentiveMode === "fixed" ? "emerald" : "slate"}
                icon={Wallet}
                className="h-[46px] whitespace-nowrap"
                onClick={() => setIncentiveMode("fixed")}
              >
                고정액
              </Button>
              <Button size="sm"
                kind={incentiveMode === "quantity" ? "solid" : "soft"}
                tone={incentiveMode === "quantity" ? "emerald" : "slate"}
                icon={Calculator}
                className="h-[46px] whitespace-nowrap"
                onClick={() => setIncentiveMode("quantity")}
              >
                건수 x 단가
              </Button>
            </div>

            {incentiveMode === "fixed" ? (
              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                  지급 금액
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="예: 3000"
                    className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 pr-14 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                    {currencyUnit}
                  </span>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                    건수
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                      placeholder="예: 3"
                      className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 pr-12 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <Hash className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                    건당 금액
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={unitAmount}
                      onChange={(event) => setUnitAmount(event.target.value)}
                      placeholder="예: 1000"
                      className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 pr-14 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                      {currencyUnit}
                    </span>
                  </div>
                </div>
              </div>
            )}

          </div>

          <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4">
            <div className="rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-5 text-slate-900 shadow-[0_12px_30px_-18px_rgba(16,185,129,0.35)]">
              <div className="flex items-center gap-2 text-emerald-700">
                <Gift className="h-4 w-4" />
                <span className="text-xs font-black uppercase tracking-[0.2em]">
                  지급 미리보기
                </span>
              </div>

              <div className="mt-3">
                <div className="inline-flex rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
                  {isBonusDeductionEnabled
                    ? `공제 ${formatRateLabel(bonusDeductionRate)}% 적용`
                    : "공제 없음"}
                </div>
              </div>

              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">지급 대상</span>
                  <span className="font-bold">{student?.name || "-"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">지급 방식</span>
                  <span className="font-bold">
                    {incentiveMode === "quantity" ? "건수 x 단가" : "고정액"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">지급 사유</span>
                  <span className="max-w-[60%] truncate text-right font-bold">
                    {trimmedReason || "-"}
                  </span>
                </div>

                {incentiveMode === "quantity" && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">건수</span>
                      <span className="font-bold">{parsedQuantity || 0}건</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">건당 금액</span>
                      <span className="font-bold">
                        {formatCurrency(parsedUnitAmount, currencyUnit)}
                      </span>
                    </div>
                  </>
                )}

                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">총 지급액</span>
                    <span className="font-bold">
                      {formatCurrency(totalAmount, currencyUnit)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-rose-500">예상 공제</span>
                    <span className="font-bold text-rose-500">
                      -{formatCurrency(previewDeductionAmount, currencyUnit)}
                    </span>
                  </div>

                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-500">
                    예상 실지급액
                  </div>
                  <div className="mt-2 text-3xl font-black">
                    {formatDisplayMoney(Number(previewNetAmount || 0))}
                    <span className="ml-2 text-sm font-bold text-slate-500">{currencyUnit}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              인센티브는 특정 직업이 아니라 학생에게 직접 지급됩니다.
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 -mx-5 mt-1 flex justify-end gap-3 border-t border-slate-200 bg-white/95 px-5 pb-1 pt-4 backdrop-blur sm:-mx-6 sm:px-6">
          <Button kind="outline" tone="slate" onClick={handleClose}>
            취소
          </Button>
          <Button
            tone="emerald"
            icon={Gift}
            isLoading={isSubmitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            인센티브 지급
          </Button>
        </div>
      </div>
    </Modal>
  );
}
