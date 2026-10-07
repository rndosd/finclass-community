import React, { useEffect, useId, useMemo, useState } from "react";
import { Modal, Button, Alert, IconButton } from "../../../components/ui";
import { Coins, Minus, Plus, Wallet } from "lucide-react";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useStockContext } from "../../../contexts/StockContext";
import {
  calculateAutoExchangeBuyPayment,
  calculateBuyQuote,
  calculateBuyQuoteByBudget,
} from "../utils/tradeQuote";
import {
  STOCK_QUANTITY_MIN,
  formatStockQuantityInput,
  normalizeStockQuantity,
  roundStockQuantity,
} from "../utils/stockQuantity";

const formatDateLabel = (value) => {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("ko-KR");
};

const BuyStockModal = ({
  isOpen,
  onClose,
  symbol,
  companyName,
  currentPriceUSD,
  balanceUSD,
  paymentBalanceUSD = balanceUSD,
  tradeFeeRate,
  tradeFeeMinUSD = 0,
  onSubmitBuyOrder,
  currencyUnit = "FIN",
  localBalance = 0,
  localCurrencyUnit = "코인",
  conversionRate = 10,
  exchangeFeeRate = 0,
  autoExchangeEnabled = false,
  dividendInfo = null,
  fundName = "",
  hasPendingOrder,
}) => {
  const { showFeedback } = useFeedback();
  const { formatFin, formatPercent, formatShareQuantity, formatStockPrice } =
    useStockContext();
  const [orderMode, setOrderMode] = useState("quantity");
  const [quantityInput, setQuantityInput] = useState("1");
  const [budgetInput, setBudgetInput] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const orderReasonId = useId();

  const quantity = useMemo(
    () => normalizeStockQuantity(quantityInput),
    [quantityInput],
  );
  const budgetAmount = useMemo(() => {
    const numericValue = Number(budgetInput);
    return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
  }, [budgetInput]);

  useEffect(() => {
    if (!isOpen) return;
    setOrderMode("quantity");
    setQuantityInput("1");
    setBudgetInput("");
    setErrorMessage("");
    setIsSubmitting(false);
  }, [isOpen, symbol]);

  const quote = useMemo(() => {
    if (orderMode === "budget") {
      return calculateBuyQuoteByBudget({
        priceUSD: currentPriceUSD,
        budgetUSD: budgetAmount,
        tradeFeeRate,
        tradeFeeMinUSD,
      });
    }

    return calculateBuyQuote({
      priceUSD: currentPriceUSD,
      quantity,
      tradeFeeRate,
      tradeFeeMinUSD,
    });
  }, [
    budgetAmount,
    currentPriceUSD,
    orderMode,
    quantity,
    tradeFeeMinUSD,
    tradeFeeRate,
  ]);
  const isQuoteLoading = false;
  const hasPositiveOrderInput =
    orderMode === "budget" ? budgetAmount > 0 : quantity > 0;
  const quoteErrorMessage =
    isOpen && hasPositiveOrderInput && !(currentPriceUSD > 0)
      ? "현재 시세를 불러오지 못해 매수 견적을 계산할 수 없습니다."
      : "";
  const activeQuantity = quote?.quantity ?? (orderMode === "quantity" ? quantity : 0);

  const dividendPreview = useMemo(() => {
    const payoutPerShare = Number(dividendInfo?.amountUSDPerShare || 0);
    if (!(payoutPerShare > 0)) {
      return null;
    }

    return {
      label: dividendInfo?.isClassPolicy ? "학급 배당" : "배당 예정",
      frequencyLabel: dividendInfo?.frequencyLabel || "배당 주기 미정",
      payoutPerShare,
      totalPayout: payoutPerShare * activeQuantity,
      payDateLabel: formatDateLabel(dividendInfo?.payDateNY),
      exDateLabel: formatDateLabel(dividendInfo?.exDateNY),
    };
  }, [activeQuantity, dividendInfo]);

  const itemCost = quote?.grossUSD ?? 0;
  const fee = quote?.feeUSD ?? 0;
  const totalCost = quote?.totalUSD ?? 0;
  const autoExchangePayment = useMemo(
    () =>
      calculateAutoExchangeBuyPayment({
        totalUSD: totalCost,
        balanceUSD: paymentBalanceUSD,
        localBalance,
        conversionRate,
        exchangeFeeRate,
        enabled: autoExchangeEnabled,
      }),
    [
      autoExchangeEnabled,
      conversionRate,
      exchangeFeeRate,
      localBalance,
      paymentBalanceUSD,
      totalCost,
    ],
  );
  const appliedTradeFeeRate = quote?.tradeFeeRate ?? tradeFeeRate;
  const feeLabel =
    quote?.tradeFeeMinUSD > 0
      ? `${formatPercent((appliedTradeFeeRate || 0) * 100, {
          fractionDigits: 1,
          trimTrailingZeros: true,
        })}% · 최소 ${formatFin(quote.tradeFeeMinUSD)} ${currencyUnit}`
      : `${formatPercent((appliedTradeFeeRate || 0) * 100, {
          fractionDigits: 1,
          trimTrailingZeros: true,
        })}%`;
  const canAfford = Boolean(quote && autoExchangePayment.canAfford);
  const isPendingRetry = Boolean(hasPendingOrder?.(activeQuantity));
  const orderBlockedReason = isSubmitting
    ? "매수 요청을 처리하고 있습니다. 잠시 기다려 주세요."
    : isQuoteLoading
      ? "매수 견적을 불러오고 있습니다."
      : isPendingRetry
        ? ""
        : orderMode === "quantity" && !(quantity >= STOCK_QUANTITY_MIN)
          ? `최소 ${STOCK_QUANTITY_MIN}주 이상 입력해 주세요.`
          : orderMode === "budget" && !(budgetAmount > 0)
            ? "매수 금액을 0보다 크게 입력해 주세요."
            : quoteErrorMessage || (!quote
              ? `수수료를 포함해 최소 ${STOCK_QUANTITY_MIN}주를 살 수 있는 금액을 입력해 주세요.`
              : !canAfford
                ? autoExchangePayment.autoExchangeApplied
                  ? `${localCurrencyUnit} 잔액이 부족하여 자동환전 매수를 할 수 없습니다.`
                  : `${currencyUnit} 잔액이 부족하여 매수할 수 없습니다.`
                : "");

  const handleQuantityBlur = () => {
    setQuantityInput(
      quantity > 0
        ? formatStockQuantityInput(quantity)
        : formatStockQuantityInput(STOCK_QUANTITY_MIN),
    );
  };

  const adjustQuantity = (delta) => {
    const nextQuantity = roundStockQuantity(
      Math.max(STOCK_QUANTITY_MIN, (quantity || STOCK_QUANTITY_MIN) + delta),
    );
    setQuantityInput(formatStockQuantityInput(nextQuantity));
    setErrorMessage("");
  };

  const handleSubmit = async () => {
    if (!quote && !isPendingRetry) {
      const message = quoteErrorMessage || "매수 견적을 불러오지 못했습니다.";
      setErrorMessage(message);
      showFeedback(message, "error");
      return;
    }

    if (!canAfford && !isPendingRetry) {
      const message = autoExchangePayment.autoExchangeApplied
        ? `${localCurrencyUnit} 잔액이 부족하여 자동환전 매수를 할 수 없습니다.`
        : `${currencyUnit} 잔액이 부족하여 매수할 수 없습니다.`;
      setErrorMessage(message);
      showFeedback(message, "error");
      return;
    }

    setIsSubmitting(true);

    try {
      const orderQuantity = activeQuantity;
      const result = await onSubmitBuyOrder(orderQuantity);
      if (result?.success) {
        showFeedback(
          `${companyName || symbol} ${formatShareQuantity(orderQuantity)}주를 성공적으로 매수했습니다.`,
          "success",
        );
        onClose();
      } else {
        setErrorMessage(result?.message || "매수 중 오류가 발생했습니다.");
      }
    } catch (error) {
      setErrorMessage("통신 중 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !symbol) return null;

  return (
    <Modal
      isOpen={isOpen}
      title={fundName ? "기금 주식 매수 주문" : "주식 매수 주문"}
      onClose={onClose}
      size="md"
    >
      <div className="space-y-6">
        {fundName ? (
          <Alert
            type="info"
            message={`${fundName}의 현금으로 매수하며 거래 직후 기금 장부에 기록됩니다.`}
          />
        ) : null}
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {symbol}
            </span>
            <span className="text-xs font-medium text-slate-500">현재 시세</span>
          </div>
          <div className="flex items-end justify-between">
            <h3 className="text-xl font-black text-slate-800">
              {companyName || symbol}
            </h3>
            <div className="text-2xl font-black text-indigo-600">
              {formatStockPrice(currentPriceUSD)}{" "}
              <span className="text-sm font-bold text-indigo-400">
                {currencyUnit}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 text-slate-500">
            <Wallet size={16} />
            <span className="text-sm font-bold">
              {fundName ? "기금 현금" : `보유 ${currencyUnit}`}
            </span>
          </div>
          <div
            className={`text-sm font-black ${
              canAfford ? "text-slate-700" : "text-rose-500"
            }`}
          >
            {fundName ? formatFin(localBalance) : formatFin(balanceUSD)}{" "}
            {fundName ? localCurrencyUnit : currencyUnit}
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
            {[
              { id: "quantity", label: "수량으로" },
              { id: "budget", label: "금액으로" },
            ].map((mode) => (
              <Button
                key={mode.id}
                onClick={() => {
                  setOrderMode(mode.id);
                  setErrorMessage("");
                }}
                tone={orderMode === mode.id ? "blue" : "slate"}
                kind={orderMode === mode.id ? "solid" : "ghost"}
                size="sm"
                rounded="lg"
                
                disabled={isSubmitting}
              >
                {mode.label}
              </Button>
            ))}
          </div>

          {orderMode === "quantity" ? (
            <div className="space-y-3">
              <label className="text-sm font-black text-slate-700">
                매수 수량 설정
              </label>
              <div className="flex items-center justify-between rounded-2xl border-2 border-slate-100 bg-white p-2 transition-all focus-within:border-indigo-500">
                <IconButton
                  icon={Minus}
                  onClick={() => adjustQuantity(-1)}
                  disabled={quantity <= STOCK_QUANTITY_MIN || isSubmitting}
                  tone="slate"
                  size="lg"
                  label="수량 줄이기"
                />
                <input
                  type="number"
                  min={STOCK_QUANTITY_MIN}
                  aria-label="매수 수량"
                  step={STOCK_QUANTITY_MIN}
                  value={quantityInput}
                  onBlur={handleQuantityBlur}
                  onChange={(event) => {
                    setQuantityInput(event.target.value);
                    setErrorMessage("");
                  }}
                  className="w-full bg-transparent text-center text-2xl font-black text-slate-800 outline-none"
                  disabled={isSubmitting}
                />
                <IconButton
                  icon={Plus}
                  onClick={() => adjustQuantity(1)}
                  disabled={isSubmitting}
                  tone="blue"
                  size="lg"
                  label="수량 늘리기"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-sm font-black text-slate-700">
                사용할 금액
              </label>
              <div className="flex items-center gap-3 rounded-2xl border-2 border-slate-100 bg-white px-4 py-3 transition-all focus-within:border-indigo-500">
                <Wallet size={20} className="text-indigo-500" />
                <input
                  type="number"
                  min="0"
                  aria-label="매수 금액"
                  step="0.01"
                  value={budgetInput}
                  onChange={(event) => {
                    setBudgetInput(event.target.value);
                    setErrorMessage("");
                  }}
                  placeholder={`0 ${currencyUnit}`}
                  className="w-full bg-transparent text-2xl font-black text-slate-800 outline-none"
                  disabled={isSubmitting}
                />
                <span className="text-sm font-black text-slate-400">
                  {currencyUnit}
                </span>
              </div>
            </div>
          )}
        </div>
        {autoExchangeEnabled && !fundName ? (
          <div className="flex items-center justify-between px-1 text-xs font-medium text-slate-500">
            <span>자동환전에 사용할 수 있는 {localCurrencyUnit}</span>
            <span className="font-bold text-slate-700">
              {formatFin(localBalance)} {localCurrencyUnit}
            </span>
          </div>
        ) : null}

        <div className="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5">
          {isQuoteLoading ? (
            <div className="text-sm font-medium text-indigo-900/60">
              매수 견적을 계산하는 중입니다...
            </div>
          ) : (
            <>
              <div className="flex justify-between text-sm font-medium text-indigo-900/60">
                <span>예상 수량</span>
                <span>{formatShareQuantity(quote?.quantity || 0)}주</span>
              </div>
              <div className="flex justify-between text-sm font-medium text-indigo-900/60">
                <span>주식 구매 금액</span>
                <span>
                  {formatFin(itemCost)} {currencyUnit}
                </span>
              </div>
              <div className="flex justify-between text-sm font-medium text-indigo-900/60">
                <span>거래 수수료 ({feeLabel})</span>
                <span>
                  {formatFin(fee)} {currencyUnit}
                </span>
              </div>
              {autoExchangePayment.autoExchangeApplied ? (
                <>
                  {autoExchangePayment.usdUsed > 0 ? (
                    <div className="flex justify-between text-sm font-medium text-indigo-900/60">
                      <span>보유 FIN 사용</span>
                      <span>
                        {formatFin(autoExchangePayment.usdUsed)} {currencyUnit}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex justify-between text-sm font-medium text-indigo-900/60">
                    <span>부족분 자동환전</span>
                    <span>
                      {formatFin(autoExchangePayment.autoExchangeUSD)} {currencyUnit}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-medium text-indigo-900/60">
                    <span>
                      환전 수수료 ({formatPercent(exchangeFeeRate * 100, {
                        fractionDigits: 1,
                        trimTrailingZeros: true,
                      })}%)
                    </span>
                    <span>
                      {formatFin(
                        autoExchangePayment.autoExchangeFeeInClassCurrency,
                      )}{" "}
                      {localCurrencyUnit}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-indigo-900/70">
                    <span>{localCurrencyUnit} 차감액</span>
                    <span>
                      {formatFin(autoExchangePayment.autoExchangeSourceAmount)}{" "}
                      {localCurrencyUnit}
                    </span>
                  </div>
                </>
              ) : null}
              <div className="flex items-center justify-between border-t border-indigo-100 pt-3">
                <span className="font-black text-indigo-900">최종 결제 금액</span>
                <span className="text-xl font-black text-indigo-700">
                  {formatFin(totalCost)} {currencyUnit}
                </span>
              </div>
              {orderMode === "budget" && quote?.unusedUSD > 0 ? (
                <div className="flex justify-between text-xs font-bold text-indigo-900/50">
                  <span>남는 금액</span>
                  <span>
                    {formatFin(quote.unusedUSD)} {currencyUnit}
                  </span>
                </div>
              ) : null}
            </>
          )}
        </div>

        {dividendPreview ? (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-emerald-600">
                  {dividendPreview.label}
                </p>
                <p className="mt-1 text-sm font-black text-emerald-900">
                  {dividendPreview.frequencyLabel}마다{" "}
                  {formatFin(dividendPreview.totalPayout)} {currencyUnit}
                </p>
              </div>
              <div className="text-right text-xs text-emerald-700">
                <div>
                  1주당 {formatFin(dividendPreview.payoutPerShare)} {currencyUnit}
                </div>
                <div>{formatShareQuantity(activeQuantity)}주 보유 기준</div>
              </div>
            </div>
            {dividendPreview.payDateLabel || dividendPreview.exDateLabel ? (
              <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium text-emerald-800/80">
                {dividendPreview.payDateLabel ? (
                  <span>다음 지급일 {dividendPreview.payDateLabel}</span>
                ) : null}
                {dividendPreview.exDateLabel ? (
                  <span>배당락일 {dividendPreview.exDateLabel}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {orderBlockedReason ? (
          <p id={orderReasonId} role="status" className="text-sm font-medium text-rose-600">
            {orderBlockedReason}
          </p>
        ) : null}
        {errorMessage ? <Alert type="error" message={errorMessage} /> : null}

        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button size="md"
            onClick={onClose}
            tone="slate"
            kind="soft"
            
            disabled={isSubmitting}
          >
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            tone={canAfford ? "indigo" : "slate"}
            kind="solid"
            className={` ${
              canAfford ? "" : ""
            }`}
            icon={Coins}
            aria-describedby={orderBlockedReason ? orderReasonId : undefined}
            disabled={((!canAfford || !quote) && !isPendingRetry) || isSubmitting || isQuoteLoading}
            isLoading={isSubmitting}
          >
            {isPendingRetry ? "주문 결과 확인" : "매수 확정"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default BuyStockModal;
