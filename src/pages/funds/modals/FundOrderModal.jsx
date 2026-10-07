import React, { useEffect, useMemo, useState } from "react";

import { Alert, Button, InputField, Modal } from "../../../components/ui";
import { formatUnits } from "../utils/displayFormat";

const INPUT_CLASSNAME =
  "min-h-[52px] rounded-xl border-2 border-slate-200 px-4 text-sm shadow-none";

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export default function FundOrderModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
  mode = "subscribe",
  fund = null,
  position = null,
  balanceUSD = 0,
  currencyUnit = "FIN",
  formatFin,
  orderCutoffTime = "15:00",
}) {
  const [amount, setAmount] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const currentNav = useMemo(() => {
    const numeric = Number(fund?.currentNav ?? fund?.baseNav ?? 100);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 100;
  }, [fund?.baseNav, fund?.currentNav]);

  const availableUnits = Math.max(
    0,
    toNumber(position?.units) - toNumber(position?.reservedUnits),
  );
  const availableRedeemAmount = availableUnits * currentNav;
  const minSubscribeAmount = Math.max(10, toNumber(fund?.minInvestmentUSD, 10));

  useEffect(() => {
    if (!isOpen) return;

    if (mode === "subscribe") {
      setAmount(String(minSubscribeAmount));
    } else {
      setAmount("");
    }

    setErrorMessage("");
  }, [isOpen, minSubscribeAmount, mode]);

  if (!isOpen || !fund) return null;

  const title = mode === "redeem" ? "환매 신청" : "가입 신청";
  const helperText =
    mode === "redeem"
      ? `보유 좌수 ${formatUnits(availableUnits)}주 범위 안에서 환매할 수 있습니다.`
      : `최소 ${formatFin(minSubscribeAmount, {
          fractionDigits: 2,
          trimTrailingZeros: true,
        })} ${currencyUnit}부터 가입할 수 있습니다.`;

  const amountLabel = `거래 금액 (${currencyUnit})`;

  const balanceLabel =
    mode === "redeem"
      ? "환매 가능 금액"
      : "보유 FIN 잔액";

  const handleSubmit = async () => {
    const amountNumber = toNumber(amount, 0);
    if (amountNumber <= 0) {
      setErrorMessage("거래 금액을 입력해 주세요.");
      return;
    }

    if (mode === "subscribe") {
      if (amountNumber < minSubscribeAmount) {
        setErrorMessage(
          `최소 가입 금액은 ${formatFin(minSubscribeAmount, {
            fractionDigits: 2,
            trimTrailingZeros: true,
          })} ${currencyUnit}입니다.`,
        );
        return;
      }

      if (amountNumber > toNumber(balanceUSD, 0)) {
        setErrorMessage("보유한 FIN 잔액보다 큰 금액은 거래할 수 없습니다.");
        return;
      }
    }

    if (mode === "redeem" && amountNumber > availableRedeemAmount + 0.01) {
      setErrorMessage(
        `환매 가능한 금액은 ${formatFin(availableRedeemAmount, {
          fractionDigits: 2,
          trimTrailingZeros: true,
        })} ${currencyUnit}까지입니다.`,
      );
      return;
    }

    try {
      const result = await onSubmit?.({
        fundId: fund.id,
        type: mode,
        amountUSD: amountNumber,
      });

      if (result?.success === false) {
        setErrorMessage(result.message || "주문 처리에 실패했습니다.");
        return;
      }

      onClose?.();
    } catch (error) {
      setErrorMessage(error?.message || "주문 처리 중 오류가 발생했습니다.");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" title={`${fund.fundName} ${title}`}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-slate-400">
                현재 기준가
              </p>
              <p className="mt-1 text-2xl font-black text-slate-900">
                {formatFin(currentNav, { fractionDigits: 2, trimTrailingZeros: true })}{" "}
                {currencyUnit}
              </p>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-slate-400">
                거래 가능 시간
              </p>
              <p className="mt-1 text-lg font-black text-slate-900">
                평일 07:45 ~ {orderCutoffTime}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 text-sm text-emerald-900">
          거래 가능 시간 안에는 가입과 환매가 모두 요청 즉시 현재 기준가로 체결됩니다.
        </div>

        <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-4 text-sm text-blue-900">
          {helperText}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <InputField
            id="fundOrderAmount"
            label={amountLabel}
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setErrorMessage("");
            }}
            className={INPUT_CLASSNAME}
          />
          <InputField
            id="fundOrderBalance"
            label={balanceLabel}
            value={`${formatFin(mode === "redeem" ? availableRedeemAmount : balanceUSD, {
              fractionDigits: 2,
              trimTrailingZeros: true,
            })} ${currencyUnit}`}
            readOnly
            className={INPUT_CLASSNAME}
          />
        </div>

        {errorMessage ? <Alert type="error" message={errorMessage} /> : null}

        <div className="flex justify-end gap-3">
          <Button onClick={onClose} kind="soft" tone="slate" disabled={isSubmitting}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            isLoading={isSubmitting}
            tone={mode === "redeem" ? "red" : "indigo"}
            kind="solid"
          >
            {title}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
