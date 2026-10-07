import React, { useEffect, useMemo, useState } from "react";
import { Modal, Button, Alert, IconButton } from "../../../components/ui";
import {
  Minus,
  Plus,
  CornerUpLeft,
  TrendingDown,
} from "lucide-react";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useStockContext } from "../../../contexts/StockContext";
import { calculateSellQuote } from "../utils/tradeQuote";
import {
  STOCK_QUANTITY_EPSILON,
  STOCK_QUANTITY_MIN,
  formatStockQuantityInput,
  isStockQuantityAvailable,
  normalizeStockQuantity,
  roundStockQuantity,
} from "../utils/stockQuantity";

const SellStockModal = ({
  isOpen,
  onClose,
  symbol,
  companyName,
  currentPriceUSD,
  quantityOwned,
  tradeFeeRate,
  tradeFeeMinUSD = 0,
  onSubmitSellOrder,
  currencyUnit = "FIN",
  localCurrencyUnit = "코인",
  conversionRate = 10,
  exchangeFeeRate = 0,
  sellRestriction = null,
  fundName = "",
  hasPendingOrder,
}) => {
  const { showFeedback } = useFeedback();
  const { formatFin, formatPercent, formatShareQuantity, formatStockPrice } =
    useStockContext();
  const [quantityToSellInput, setQuantityToSellInput] = useState("1");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedQuantityOwned = roundStockQuantity(quantityOwned);
  const quantityToSell = useMemo(
    () => normalizeStockQuantity(quantityToSellInput),
    [quantityToSellInput],
  );

  useEffect(() => {
    if (!isOpen) return;
    const initialQuantity =
      normalizedQuantityOwned > 0 ? Math.min(1, normalizedQuantityOwned) : 0;
    setQuantityToSellInput(
      initialQuantity > 0 ? formatStockQuantityInput(initialQuantity) : "0",
    );
    setErrorMessage("");
    setIsSubmitting(false);
  }, [isOpen, normalizedQuantityOwned, symbol]);

  const quote = useMemo(
    () =>
      calculateSellQuote({
        priceUSD: currentPriceUSD,
        quantity: quantityToSell,
        tradeFeeRate,
        tradeFeeMinUSD,
      }),
    [currentPriceUSD, quantityToSell, tradeFeeMinUSD, tradeFeeRate],
  );
  const isQuoteLoading = false;
  const quoteErrorMessage =
    isOpen && quantityToSell > 0 && !(currentPriceUSD > 0)
      ? "현재 시세를 불러오지 못해 매도 견적을 계산할 수 없습니다."
      : "";
  const itemValue = quote?.grossUSD ?? 0;
  const fee = quote?.feeUSD ?? 0;
  const totalProceeds = quote?.netUSD ?? 0;
  const fundExchangeFeeUSD = fundName
    ? Math.round(totalProceeds * exchangeFeeRate * 10000) / 10000
    : 0;
  const fundNetProceedsUSD = Math.max(
    0,
    Math.round((totalProceeds - fundExchangeFeeUSD) * 10000) / 10000,
  );
  const fundNetProceedsInClassCurrency =
    fundName && conversionRate > 0
      ? Math.round((fundNetProceedsUSD / conversionRate) * 10000) / 10000
      : 0;
  const appliedTradeFeeRate = quote?.tradeFeeRate ?? tradeFeeRate;
  const isSellLocked = sellRestriction?.locked === true;
  const sellLockMessage = isSellLocked
    ? `보유 기간 규칙에 따라 ${sellRestriction.remainingDays}일 뒤 매도할 수 있습니다. 매수 후 ${sellRestriction.minHoldingDays}일 동안은 가격 변화를 관찰합니다.`
    : "";
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

  const canSell =
    normalizedQuantityOwned > 0 &&
    quantityToSell > 0 &&
    isStockQuantityAvailable(quantityToSell, normalizedQuantityOwned) &&
    !isSellLocked &&
    !!quote;
  const isPendingRetry = Boolean(hasPendingOrder?.(quantityToSell));

  const handleQuantityChange = (event) => {
    const nextValue = event.target.value;
    const parsedQuantity = normalizeStockQuantity(nextValue);

    if (
      parsedQuantity > 0 &&
      parsedQuantity > normalizedQuantityOwned + STOCK_QUANTITY_EPSILON
    ) {
      setQuantityToSellInput(formatStockQuantityInput(normalizedQuantityOwned));
    } else {
      setQuantityToSellInput(nextValue);
    }

    setErrorMessage("");
  };

  const handleQuantityBlur = () => {
    if (!(quantityToSell > 0)) {
      setQuantityToSellInput(
        normalizedQuantityOwned > 0
          ? formatStockQuantityInput(Math.min(1, normalizedQuantityOwned))
          : "0",
      );
      return;
    }

    setQuantityToSellInput(
      formatStockQuantityInput(Math.min(quantityToSell, normalizedQuantityOwned)),
    );
  };

  const adjustQuantity = (delta) => {
    const baseQuantity = quantityToSell || STOCK_QUANTITY_MIN;
    const nextQuantity = roundStockQuantity(
      Math.min(
        normalizedQuantityOwned,
        Math.max(STOCK_QUANTITY_MIN, baseQuantity + delta),
      ),
    );
    setQuantityToSellInput(formatStockQuantityInput(nextQuantity));
    setErrorMessage("");
  };

  const handleSubmit = async () => {
    if (isSellLocked && !isPendingRetry) {
      setErrorMessage(sellLockMessage);
      showFeedback(sellLockMessage, "warning");
      return;
    }

    if (!quote && !isPendingRetry) {
      const message = quoteErrorMessage || "매도 견적을 불러오지 못했습니다.";
      setErrorMessage(message);
      showFeedback(message, "error");
      return;
    }

    if (
      !isPendingRetry && !(
        normalizedQuantityOwned > 0 &&
        quantityToSell > 0 &&
        isStockQuantityAvailable(quantityToSell, normalizedQuantityOwned)
      )
    ) {
      const message = "보유 수량이 부족하여 매도할 수 없습니다.";
      setErrorMessage(message);
      showFeedback(message, "error");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await onSubmitSellOrder(quantityToSell);
      if (result?.success) {
        showFeedback(
          `${companyName || symbol} ${formatShareQuantity(quantityToSell)}주를 성공적으로 매도했습니다.`,
          "success",
        );
        onClose();
      } else {
        setErrorMessage(result?.message || "매도 중 오류가 발생했습니다.");
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
      title={fundName ? "기금 주식 매도 주문" : "주식 매도 주문"}
      onClose={onClose}
      size="md"
    >
      <div className="space-y-6">
        {fundName ? (
          <Alert
            type="info"
            message={`${fundName}의 보유 주식을 매도하며 순매도금은 같은 기금으로 돌아갑니다.`}
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
            <div className="text-2xl font-black text-rose-600">
              {formatStockPrice(currentPriceUSD)}{" "}
              <span className="text-sm font-bold text-rose-400">
                {currencyUnit}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 text-slate-500">
            <TrendingDown size={16} />
            <span className="text-sm font-bold">보유 수량</span>
          </div>
          <div className="text-sm font-black text-slate-700">
            {formatShareQuantity(normalizedQuantityOwned)}주
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-black text-slate-700">
              매도 수량 설정
            </label>
            <Button
              onClick={() =>
                setQuantityToSellInput(formatStockQuantityInput(normalizedQuantityOwned))
              }
              tone="blue"
              kind="soft"
              size="xs"
              rounded="lg"
              
            >
              최대 수량
            </Button>
          </div>
          <div className="flex items-center justify-between rounded-2xl border-2 border-slate-100 bg-white p-2 transition-all focus-within:border-rose-500">
            <IconButton
              icon={Minus}
              onClick={() => adjustQuantity(-1)}
              disabled={quantityToSell <= STOCK_QUANTITY_MIN || isSubmitting}
              tone="slate"
              size="lg"
              label="수량 줄이기"
            />
            <input
              type="number"
              min={STOCK_QUANTITY_MIN}
              step={STOCK_QUANTITY_MIN}
              value={quantityToSellInput}
              onChange={handleQuantityChange}
              onBlur={handleQuantityBlur}
              className="w-full bg-transparent text-center text-2xl font-black text-slate-800 outline-none"
              disabled={isSubmitting}
            />
            <IconButton
              icon={Plus}
              onClick={() => adjustQuantity(1)}
              disabled={
                quantityToSell >= normalizedQuantityOwned || isSubmitting
              }
              tone="red"
              size="lg"
              label="수량 늘리기"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-5 space-y-3">
          {isQuoteLoading ? (
            <div className="text-sm font-medium text-rose-900/60">
              매도 견적을 계산하는 중입니다...
            </div>
          ) : (
            <>
              <div className="flex justify-between text-sm font-medium text-rose-900/60">
                <span>주식 매도 금액</span>
                <span>
                  {formatFin(itemValue)} {currencyUnit}
                </span>
              </div>
              <div className="flex justify-between text-sm font-medium text-rose-900/60">
                <span>거래 수수료 ({feeLabel})</span>
                <span>
                  {formatFin(fee)} {currencyUnit}
                </span>
              </div>
              {fundName ? (
                <div className="flex justify-between text-sm font-medium text-rose-900/60">
                  <span>
                    환전 수수료 ({formatPercent(exchangeFeeRate * 100, {
                      fractionDigits: 1,
                      trimTrailingZeros: true,
                    })}%)
                  </span>
                  <span>
                    {formatFin(fundExchangeFeeUSD)} {currencyUnit}
                  </span>
                </div>
              ) : null}
              <div className="pt-3 border-t border-rose-100 flex justify-between items-center">
                <span className="font-black text-rose-900">최종 예상 정산액</span>
                <span className="text-xl font-black text-rose-700">
                  {fundName
                    ? formatFin(fundNetProceedsInClassCurrency)
                    : formatFin(totalProceeds)}{" "}
                  {fundName ? localCurrencyUnit : currencyUnit}
                </span>
              </div>
            </>
          )}
        </div>

        {quoteErrorMessage ? (
          <Alert type="error" message={quoteErrorMessage} />
        ) : null}
        {sellLockMessage ? (
          <Alert type="info" message={sellLockMessage} />
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
            tone={canSell ? "red" : "slate"}
            kind="solid"
            className={` ${
              canSell ? "" : ""
            }`}
            icon={CornerUpLeft}
            disabled={(!canSell && !isPendingRetry) || isSubmitting || isQuoteLoading}
            isLoading={isSubmitting}
          >
            {isPendingRetry ? "주문 결과 확인" : "매도 확정"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default SellStockModal;
