import React, { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Coins } from "lucide-react";
import {
  Alert,
  Button,
  CardSkeleton,
  InputField,
  Modal,
  SurfaceLoader,
  TabButton,
} from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { useStockContext } from "../../../contexts/StockContext";
import { resolveClassCurrencyUnit } from "../../../utils/currencyUnit";
import {
  TRANSACTION_TYPE_EXCHANGE_BIL_TO_USD,
  TRANSACTION_TYPE_EXCHANGE_USD_TO_BIL,
} from "../constants/transactionTypes";
import { calculateExchange } from "../utils/exchangeUtils";

const formatEditableAmount = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return "";

  const roundedValue = Math.round(numericValue * 10000) / 10000;
  return String(roundedValue);
};

const clampAmountInput = (value, maxValue) => {
  if (value === "") return "";

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return value;
  if (!Number.isFinite(maxValue) || maxValue <= 0) return value;
  if (numericValue <= 0) return value;

  return numericValue > maxValue ? formatEditableAmount(maxValue) : value;
};

function Row({ left, right, rightClass = "" }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{left}</span>
      <span className={`font-semibold ${rightClass}`}>{right}</span>
    </div>
  );
}

const ExchangeModal = ({
  isOpen,
  onClose,
  onSubmitExchange,
  exchangeFeeRate: exchangeFeeRateOverride,
  isSubmitting: parentIsSubmitting,
  hasPendingExchange,
} = {}) => {
  const { classData } = useUser();
  const {
    formatClassCurrency,
    formatExchangeRate,
    formatFin,
    conversionRate,
    exchangeFeeRate: contextExchangeFeeRate,
    balanceBIL,
    availableBalanceBIL = balanceBIL,
    balanceUSD: balanceFIN,
    isLoading: isStockLoading,
  } = useStockContext();
  const currencyUnit = resolveClassCurrencyUnit(classData);
  const exchangeFeeRate =
    Number.isFinite(Number(exchangeFeeRateOverride)) &&
    Number(exchangeFeeRateOverride) >= 0
      ? Number(exchangeFeeRateOverride)
      : contextExchangeFeeRate;

  const [direction, setDirection] = useState(
    TRANSACTION_TYPE_EXCHANGE_BIL_TO_USD,
  );
  const [amountInput, setAmountInput] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const isPendingRetry = Boolean(hasPendingExchange?.({ direction, amount: Number(amountInput) }));

  const exchangeDirections = useMemo(
    () => [
      {
        key: TRANSACTION_TYPE_EXCHANGE_BIL_TO_USD,
        label: `${currencyUnit} -> FIN`,
      },
      {
        key: TRANSACTION_TYPE_EXCHANGE_USD_TO_BIL,
        label: `FIN -> ${currencyUnit}`,
      },
    ],
    [currencyUnit],
  );

  useEffect(() => {
    if (!isOpen) return;
    setAmountInput("");
    setErrorMessage("");
    setDirection(TRANSACTION_TYPE_EXCHANGE_BIL_TO_USD);
  }, [isOpen]);

  const calculatedResult = useMemo(
    () =>
      calculateExchange({
        direction,
        amount: parseFloat(amountInput),
        conversionRate,
        exchangeFeeRate,
        balanceBIL: availableBalanceBIL,
        balanceUSD: balanceFIN,
        currencyUnit,
      }),
    [
      amountInput,
      availableBalanceBIL,
      balanceFIN,
      conversionRate,
      currencyUnit,
      direction,
      exchangeFeeRate,
    ],
  );

  const sourceBalance =
    direction === TRANSACTION_TYPE_EXCHANGE_BIL_TO_USD
      ? Number(availableBalanceBIL || 0)
      : Number(balanceFIN || 0);

  useEffect(() => {
    if (!isOpen || isPendingRetry) return;
    setAmountInput((prev) =>
      prev === "" ? prev : clampAmountInput(prev, sourceBalance),
    );
  }, [isOpen, sourceBalance, isPendingRetry]);

  const handleUseMaxAmount = () => {
    setAmountInput(formatEditableAmount(sourceBalance));
    setErrorMessage("");
  };

  const handleSubmit = async () => {
    if ((!calculatedResult.success || !calculatedResult.canExchange) && !isPendingRetry) {
      setErrorMessage(
        calculatedResult.errorMsg || "환전을 진행할 수 없습니다.",
      );
      return;
    }

    setErrorMessage("");

    const result = await onSubmitExchange({
      direction,
      amount: Number(amountInput),
    });

    if (!result?.success && result?.message) {
      setErrorMessage(result.message);
    }
  };

  if (!isOpen) return null;

  const formatExchangeAmount = (amount, unit) =>
    unit === "FIN"
      ? `${formatFin(amount)} FIN`
      : `${formatClassCurrency(amount)} ${unit}`;

  const sourceBalanceDisplay =
    direction === TRANSACTION_TYPE_EXCHANGE_BIL_TO_USD
      ? `${formatClassCurrency(balanceBIL)} ${currencyUnit}`
      : `${formatFin(balanceFIN)} FIN`;

  const canDisplayQuote =
    parseFloat(amountInput) > 0 &&
    calculatedResult.success &&
    calculatedResult.canExchange;

  const shouldShowQuoteError =
    parseFloat(amountInput) > 0 && !canDisplayQuote && !errorMessage;
  const hasExchangeContext =
    amountInput !== "" ||
    Number(balanceBIL || 0) > 0 ||
    Number(balanceFIN || 0) > 0;

  return (
    <Modal isOpen={isOpen} title="학급 화폐 환전" onClose={onClose} size="lg">
      <SurfaceLoader
        loading={isStockLoading}
        variant={hasExchangeContext ? "refreshing" : "surface-loading"}
        preserveContent={hasExchangeContext}
        skeleton={<CardSkeleton bare className="h-full min-h-full" rows={6} />}
        minHeightClassName="min-h-[420px]"
      >
        <div className="space-y-5">
          <div className="flex border-b border-slate-200">
            {exchangeDirections.map((item) => (
              <TabButton
                key={item.key}
                isActive={direction === item.key}
                onClick={() => setDirection(item.key)}
              >
                {item.label}
              </TabButton>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <InputField
              id="exchangeAmountInput"
              label={`환전할 금액 (보유: ${sourceBalanceDisplay})`}
              type="number"
              value={amountInput}
              onChange={(event) => {
                setAmountInput(
                  clampAmountInput(event.target.value, sourceBalance),
                );
                setErrorMessage("");
              }}
              placeholder="0"
              className="bg-white text-2xl font-bold"
            />
            <div className="mt-3 flex justify-end">
              <Button
                onClick={handleUseMaxAmount}
                disabled={sourceBalance <= 0}
                tone="blue"
                kind="outline"
                size="xs"
                rounded="lg"
                
              >
                최대 금액
              </Button>
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <p className="flex justify-between text-xs text-slate-500">
                <span>현재 환율</span>
                <span className="font-medium text-slate-700">
                  1 {currencyUnit} = {formatExchangeRate(conversionRate)} FIN
                </span>
              </p>
              <p className="flex justify-between text-xs text-slate-500">
                <span>환전 수수료</span>
                <span className="font-medium text-rose-500">
                  {(exchangeFeeRate * 100).toFixed(1)}%
                </span>
              </p>
            </div>
          </div>

          {canDisplayQuote ? (
            <div className="space-y-3 rounded-2xl border-2 border-cyan-100 bg-cyan-50/50 p-5 shadow-inner">
              <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-cyan-800">
                <Coins className="h-4 w-4" />
                환전 예상 결과
              </h4>
              <div className="space-y-2">
                <Row
                  left="요청 금액"
                  right={formatExchangeAmount(
                    calculatedResult.inputAmount,
                    calculatedResult.sourceCurrency,
                  )}
                />
                <Row
                  left="수수료 차감"
                  right={`- ${formatExchangeAmount(
                    calculatedResult.feeAmount,
                    calculatedResult.sourceCurrency,
                  )}`}
                  rightClass="text-rose-500"
                />
                <div className="my-1 border-t border-cyan-200" />
                <Row
                  left={<span className="font-bold text-slate-700">최종 수령액</span>}
                  right={formatExchangeAmount(
                    calculatedResult.finalReceivedAmount,
                    calculatedResult.targetCurrency,
                  )}
                  rightClass={`text-xl font-black ${
                    direction === TRANSACTION_TYPE_EXCHANGE_BIL_TO_USD
                      ? "text-green-600"
                      : "text-blue-600"
                  }`}
                />
              </div>
            </div>
          ) : null}

          {shouldShowQuoteError ? (
            <Alert
              type="error"
              message={
                calculatedResult.errorMsg ||
                "환전 정보를 계산할 수 없습니다."
              }
            />
          ) : null}
          {errorMessage ? <Alert type="error" message={errorMessage} /> : null}

          <div className="mt-4 flex gap-3">
            <Button onClick={onClose} variant="secondary" className="flex-1">
              취소
            </Button>
            <Button size="md"
              onClick={handleSubmit}
              color="cyan"
              icon={ArrowRightLeft}
              className="flex-[2]"
              disabled={(!calculatedResult.canExchange && !isPendingRetry) || parentIsSubmitting}
              isLoading={parentIsSubmitting}
              loadingText="환전 중…"
            >
              {isPendingRetry ? "환전 결과 확인" : "환전 완료하기"}
            </Button>
          </div>
        </div>
      </SurfaceLoader>
    </Modal>
  );
};

export default ExchangeModal;
