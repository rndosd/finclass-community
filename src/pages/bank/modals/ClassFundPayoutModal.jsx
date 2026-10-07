import React, { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";

import { Button, Modal } from "../../../components/ui";
import StudentSelector from "../../../components/ui/StudentSelector";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useFundMode } from "../../../contexts/FundModeContext";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import {
  getFundChannelAccess,
  getFundsAllowedForChannel,
} from "../../../domain/classFunds/fundPolicy";
import { payoutClassFund } from "../../tax/services/classFundService";

const toAmount = (value) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

export default function ClassFundPayoutModal({
  isOpen,
  onClose,
  classId,
  currencyUnit = "단위",
  fixedFundId = "",
}) {
  const { showFeedback } = useFeedback();
  const { formatNumber } = useNumberFormat();
  const { activeFunds: classFunds } = useFundMode();
  const [fundId, setFundId] = useState("");
  const [recipientUids, setRecipientUids] = useState([]);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const payoutFunds = useMemo(
    () => getFundsAllowedForChannel(
      classFunds.filter((fund) => Boolean(fixedFundId) && fund.id === fixedFundId),
      "bankPayout",
    ),
    [classFunds, fixedFundId],
  );
  const selectedFund =
    payoutFunds.find((fund) => fund.id === fundId) || payoutFunds[0] || null;
  const amountPerStudent = toAmount(amount);
  const totalAmount = amountPerStudent * recipientUids.length;
  const balance = Number(selectedFund?.cashBalance || 0);
  const requestedFund = classFunds.find((fund) => fund.id === fixedFundId) || null;
  const payoutAccess = getFundChannelAccess(
    selectedFund || requestedFund,
    "bankPayout",
    { amount: totalAmount },
  );
  const isBalanceShort = payoutAccess.code === "insufficient_balance";

  useEffect(() => {
    if (!isOpen) return;
    setFundId(fixedFundId);
    setRecipientUids([]);
    setAmount("");
    setDescription("");
  }, [fixedFundId, isOpen]);

  const handleSubmit = async () => {
    if (!selectedFund || !recipientUids.length || amountPerStudent <= 0) return;
    if (!payoutAccess.allowed || isSubmitting) {
      if (!payoutAccess.allowed) showFeedback(payoutAccess.reason, "warning");
      return;
    }

    setIsSubmitting(true);
    const result = await payoutClassFund({
      classId,
      fundId: selectedFund.id,
      recipientUids,
      amountPerStudent,
      description: description.trim() || selectedFund.name + " 지급",
    });
    setIsSubmitting(false);

    if (!result?.success) {
      showFeedback(result?.message || "기금 지급에 실패했습니다.", "error");
      return;
    }

    showFeedback(
      String(result.recipientCount || recipientUids.length) +
        "명에게 총 " +
        formatNumber(result.totalAmount || totalAmount) +
        currencyUnit +
        "을 지급했습니다.",
      "success",
    );
    onClose?.();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="기금 지급" size="lg">
      <div className="space-y-5 p-6">
        {payoutFunds.length === 0 ? (
          <div className="rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-800">
            {fixedFundId && requestedFund
              ? payoutAccess.reason
              : "은행 지급 사용처가 켜진 지출형 기금이 없습니다. 예산·기금에서 기금 사용처를 먼저 설정해 주세요."}
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs font-black text-emerald-700">지급 기금</p>
              <p className="mt-1 text-sm font-black text-emerald-950">
                {selectedFund?.name} · 잔액 {formatNumber(selectedFund?.cashBalance || 0)}
                {currencyUnit}
              </p>
            </div>

            <StudentSelector
              label="지급 대상"
              selectedUids={recipientUids}
              onChange={setRecipientUids}
              multiple
              excludeSelf
              disabled={isSubmitting}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-black text-slate-500">1인당 지급액</span>
                <input
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-blue-200 px-3 py-2 text-right text-sm font-bold outline-none focus:border-blue-500"
                  placeholder="0"
                />
              </label>
              <label className="block">
                <span className="text-xs font-black text-slate-500">지급 사유</span>
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  placeholder="예: 장학금 지급"
                />
              </label>
            </div>

            <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-bold text-slate-400">선택 인원</p>
                <p className="mt-1 text-lg font-black text-slate-900">
                  {recipientUids.length}명
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400">총 지급액</p>
                <p className="mt-1 text-lg font-black text-indigo-700">
                  {formatNumber(totalAmount)}
                  {currencyUnit}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400">지급 후 잔액</p>
                <p
                  className={
                    "mt-1 text-lg font-black " +
                    (isBalanceShort ? "text-red-600" : "text-slate-900")
                  }
                >
                  {formatNumber(balance - totalAmount)}
                  {currencyUnit}
                </p>
              </div>
            </div>
            {isBalanceShort ? (
              <p className="text-sm font-bold text-red-600">{payoutAccess.reason}</p>
            ) : null}
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" tone="slate" kind="soft" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            tone="blue"
            kind="solid"
            icon={Send}
            onClick={handleSubmit}
            isLoading={isSubmitting}
            disabled={
              !selectedFund ||
              !recipientUids.length ||
              amountPerStudent <= 0 ||
              !payoutAccess.allowed ||
              isSubmitting
            }
          >
            지급하기
          </Button>
        </div>
      </div>
    </Modal>
  );
}
