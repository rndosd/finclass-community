import React, { useMemo } from "react";
import { AlertCircle, Clock3, Minus, Plus, ShoppingCart, Trash2, Wallet } from "lucide-react";

import { Button, IconButton, Modal } from "../../../components/ui";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useUser } from "../../../contexts/UserContext";
import { getStoreTreasuryMode } from "../../../utils/taxPolicy";
import {
  getStoreCurrencyUnit,
  normalizeStoreCurrencyType,
} from "../utils/storeCurrency";
import { getCompactTimeSaleLabel } from "../utils/timeSale";
import { getStorePurchaseLimitInfo } from "../utils/storeUsage";
import {
  formatItemValidityDuration,
  hasItemExpiration,
} from "../utils/itemExpiration";
import { getStoreItemSaleStatusMeta } from "../utils/storeSaleStatus";

const buildValidationState = (item, usageData) => {
  const limitInfo = getStorePurchaseLimitInfo(item, usageData);
  const isMissingFromStore = item?.isMissingFromStore === true;
  const saleStatusMeta = getStoreItemSaleStatusMeta(item);
  const isUnavailableForPurchase = !saleStatusMeta.isPurchasable;
  const isOverDaily =
    Number(item?.dailyLimit || 0) > 0 &&
    Number(item?.quantity || 0) > limitInfo.dailyRemaining;
  const isOverWeekly =
    Number(item?.weeklyLimit || 0) > 0 &&
    Number(item?.quantity || 0) > limitInfo.weeklyRemaining;
  const isOverTotal =
    Number(item?.totalLimit || 0) > 0 &&
    Number(item?.quantity || 0) > limitInfo.totalRemaining;
  const isOverStock =
    item?.stock !== -1 &&
    item?.stock !== null &&
    item?.stock !== undefined &&
    Number(item?.quantity || 0) > limitInfo.stockRemaining;

  let errorMessage = null;
  if (isMissingFromStore) errorMessage = "상품을 찾을 수 없어요";
  else if (isUnavailableForPurchase)
    errorMessage = "현재 구매할 수 없는 상품이에요";
  else if (isOverDaily) errorMessage = "하루 구매 한도를 넘었어요";
  else if (isOverWeekly) errorMessage = "이번 주 구매 한도를 넘었어요";
  else if (isOverTotal) errorMessage = "전체 구매 한도를 넘었어요";
  else if (isOverStock) errorMessage = "재고가 부족해요";

  return {
    limitInfo,
    isInvalid: Boolean(errorMessage),
    errorMessage,
  };
};

const getTaxBreakdown = (totalPrice, taxRate, isTaxable) => {
  const finalAmount = Number(totalPrice) || 0;
  const rate = Number(taxRate) || 0;

  if (!isTaxable || rate <= 0) {
    return {
      baseAmount: finalAmount,
      taxAmount: 0,
      finalAmount,
      rate: 0,
      isTaxable: false,
    };
  }

  const baseAmount = Math.round((finalAmount / (1 + rate / 100)) * 100) / 100;
  const taxAmount = Math.round((finalAmount - baseAmount) * 100) / 100;

  return {
    baseAmount,
    taxAmount,
    finalAmount,
    rate,
    isTaxable: true,
  };
};

const StoreCartModal = ({
  isOpen,
  onClose,
  cartItems,
  allUsageData,
  isUsageLoading = false,
  onUpdateQty,
  onRemoveItem,
  onCheckout,
  isSubmitting,
  classCurrencyUnit,
  studentBalances = {},
}) => {
  const { formatClassCurrency: formatConfiguredCurrency } = useNumberFormat();
  const formatClassCurrency = (value) => formatConfiguredCurrency(value, {
    fractionDigits: 8,
    trimTrailingZeros: true,
  });
  const { classData, missionTokenLabel } = useUser();
  const isConsumptionTaxEnabled = getStoreTreasuryMode(classData) !== "NONE";

  const defaultTaxRate = useMemo(() => {
    if (typeof classData?.settings?.taxRate === "number") {
      return classData.settings.taxRate;
    }
    if (typeof classData?.taxRate === "number") {
      return classData.taxRate;
    }
    return 10;
  }, [classData]);

  const cartValidation = useMemo(
    () =>
      cartItems.map((item) => ({
        id: item.id,
        ...buildValidationState(item, allUsageData?.[item.id]),
      })),
    [allUsageData, cartItems],
  );

  const validationMap = useMemo(
    () =>
      cartValidation.reduce((acc, validation) => {
        acc[validation.id] = validation;
        return acc;
      }, {}),
    [cartValidation],
  );

  const totalsByCurrency = useMemo(() => {
    const totals = {};

    for (const item of cartItems) {
      const currencyType = normalizeStoreCurrencyType(item?.currencyType);
      const currencyUnit = getStoreCurrencyUnit(
        currencyType,
        classCurrencyUnit,
        missionTokenLabel,
      );

      if (!totals[currencyType]) {
        totals[currencyType] = {
          currencyType,
          currencyUnit,
          baseAmount: 0,
          taxAmount: 0,
          totalAmount: 0,
        };
      }

      const effectiveRate =
        item?.customTaxRate !== undefined && item?.customTaxRate !== null
          ? Number(item.customTaxRate)
          : Number(defaultTaxRate);
      const isTaxable =
        isConsumptionTaxEnabled &&
        currencyType === "cash" &&
        effectiveRate > 0 &&
        item?.isTaxable !== false;
      const itemUnitPrice = Number(item?.effectivePrice ?? item?.price ?? 0);
      const itemTotal = itemUnitPrice * Number(item?.quantity || 0);
      const taxBreakdown = getTaxBreakdown(itemTotal, effectiveRate, isTaxable);

      totals[currencyType].baseAmount += taxBreakdown.baseAmount;
      totals[currencyType].taxAmount += taxBreakdown.taxAmount;
      totals[currencyType].totalAmount += taxBreakdown.finalAmount;
    }

    return totals;
  }, [
    cartItems,
    classCurrencyUnit,
    defaultTaxRate,
    isConsumptionTaxEnabled,
    missionTokenLabel,
  ]);

  const shortageByCurrency = useMemo(() => {
    const result = {};

    for (const [currencyType, totals] of Object.entries(totalsByCurrency)) {
      const balance = Number(studentBalances?.[currencyType] ?? 0);
      if (balance < totals.totalAmount) {
        result[currencyType] = {
          shortage: totals.totalAmount - balance,
          unit: totals.currencyUnit,
        };
      }
    }

    return result;
  }, [studentBalances, totalsByCurrency]);

  const summaryItems = Object.values(totalsByCurrency);
  const hasLimitError = cartValidation.some((validation) => validation.isInvalid);
  const hasShortage = Object.keys(shortageByCurrency).length > 0;
  const hasTimeSaleItem = cartItems.some((item) => item?.timeSaleActive);
  const totalQuantity = cartItems.reduce(
    (sum, item) => sum + Number(item?.quantity || 0),
    0,
  );
  const canCheckout =
    cartItems.length > 0 &&
    !isUsageLoading &&
    !hasLimitError &&
    !hasShortage &&
    !isSubmitting;

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" closeOnOverlayClick={true}>
      <Modal.Header>
        <div>
          <h2 className="text-lg font-bold text-slate-900">장바구니</h2>
          <p className="text-xs font-medium text-slate-500">
            담아둔 상품과 예상 결제 금액만 간단히 확인해 주세요.
          </p>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-4">
        {cartItems.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-300">
              <ShoppingCart size={22} />
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-500">
              장바구니가 비어 있어요.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 px-1 text-xs font-medium text-slate-400">
              <span>
                상품 {cartItems.length}종 · 수량 {totalQuantity}개
              </span>
              {hasTimeSaleItem ? (
                <span className="text-rose-500">
                  세일 가격은 결제 시점 기준으로 다시 계산돼요.
                </span>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white">
              {cartItems.map((item, index) => {
                const validation = validationMap[item.id];
                const itemCurrencyUnit = getStoreCurrencyUnit(
                  item.currencyType,
                  classCurrencyUnit,
                  missionTokenLabel,
                );
                const validityLabel = hasItemExpiration(item)
                  ? formatItemValidityDuration(item.validityHours)
                  : "";
                const timeSaleBadgeLabel = getCompactTimeSaleLabel(
                  item.timeSaleCountdownLabel,
                );
                const itemUnitPrice = Number(item.effectivePrice ?? item.price ?? 0);
                const basePrice = Number(item.basePrice ?? item.price ?? 0);
                const itemTotal = itemUnitPrice * Number(item.quantity || 0);
                const disableIncrease =
                  validation?.isInvalid ||
                  (validation?.limitInfo?.maxPossible !== undefined &&
                    item.quantity >= validation.limitInfo.maxPossible);

                return (
                  <div
                    key={item.id}
                    className={`relative px-5 py-4 pr-14 ${
                      index !== cartItems.length - 1 ? "border-b border-slate-100" : ""
                    } ${validation?.isInvalid ? "bg-rose-50/50" : ""}`}
                  >
                    <IconButton
                      type="button"
                      onClick={() => onRemoveItem(item.id)}
                      disabled={isSubmitting}
                      icon={Trash2}
                      tone="rose"
                      size="sm"
                      className="absolute right-5 top-4"
                      aria-label={`${item.name} 장바구니에서 제거`}
                    />

                    <div className="min-h-6 flex flex-wrap items-center gap-2">
                      {item.timeSaleActive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">
                          <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] leading-none text-white">
                            {item.timeSaleDiscountPercent || 0}%
                          </span>
                          <Clock3 size={12} />
                          {timeSaleBadgeLabel || "진행 중"}
                        </span>
                      ) : null}
                      {validation?.isInvalid ? (
                        <span className="rounded-full border border-rose-100 bg-rose-50 px-3 py-1 text-xs font-black text-rose-600">
                          {validation.errorMessage}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2">
                      <h3 className="truncate text-lg font-black text-slate-900">
                        {item.name}
                      </h3>
                      {validityLabel ? (
                        <p className="mt-1 text-xs font-bold text-sky-600">
                          사용기한 {validityLabel}
                        </p>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
                      {item.timeSaleActive ? (
                        <span className="text-sm font-black text-slate-300 line-through">
                          정가 {formatClassCurrency(basePrice)} {itemCurrencyUnit}
                        </span>
                      ) : null}
                      <span className="text-xl font-black text-slate-900">
                        {formatClassCurrency(itemUnitPrice)} {itemCurrencyUnit}
                      </span>
                      <span className="text-xs font-bold text-slate-400">개당</span>
                    </div>

                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-1.5 py-1.5">
                          <Button
                            size="icon-sm"
                            kind="soft"
                            tone="slate"
                            icon={Minus}
                            onClick={() =>
                              item.quantity > 1
                                ? onUpdateQty(item.id, item.quantity - 1)
                                : onRemoveItem(item.id)
                            }
                            disabled={isSubmitting || isUsageLoading}
                            
                          />
                          <span className="min-w-[1.75rem] text-center text-sm font-black text-slate-800">
                            {item.quantity}
                          </span>
                          <Button
                            size="icon-sm"
                            kind="soft"
                            tone="slate"
                            icon={Plus}
                            onClick={() => onUpdateQty(item.id, item.quantity + 1)}
                            disabled={isSubmitting || isUsageLoading || disableIncrease}
                            
                          />
                      </div>

                      <div className="text-right">
                        <p className="text-xs font-medium text-slate-400">예상 합계</p>
                        <p className="mt-1 text-base font-black text-slate-900">
                          {formatClassCurrency(itemTotal)} {itemCurrencyUnit}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-black tracking-[0.16em] text-slate-400">
                <Wallet size={14} />
                결제 요약
              </div>

              <div className="mt-4 space-y-3">
                {summaryItems.map((summary) => {
                  const balance = Number(studentBalances?.[summary.currencyType] ?? 0);
                  const nextBalance = balance - summary.totalAmount;

                  return (
                    <div
                      key={summary.currencyType}
                      className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
                    >
                      <div className="mb-3 text-xs font-black tracking-[0.14em] text-slate-400">
                        {summary.currencyUnit} 결제
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between text-slate-500">
                          <span>상품 금액</span>
                          <span>
                            {formatClassCurrency(summary.baseAmount)} {summary.currencyUnit}
                          </span>
                        </div>
                        {isConsumptionTaxEnabled && summary.currencyType === "cash" ? (
                          <div className="flex items-center justify-between text-slate-500">
                            <span>소비세</span>
                            <span>
                              {formatClassCurrency(summary.taxAmount)} {summary.currencyUnit}
                            </span>
                          </div>
                        ) : null}
                        <div className="h-px bg-slate-200" />
                        <div className="flex items-center justify-between font-black text-slate-900">
                          <span>최종 결제 금액</span>
                          <span>
                            {formatClassCurrency(summary.totalAmount)} {summary.currencyUnit}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-500">
                          <span>현재 잔액</span>
                          <span>
                            {formatClassCurrency(balance)} {summary.currencyUnit}
                          </span>
                        </div>
                        <div className="flex items-center justify-between font-black">
                          <span className="text-slate-500">결제 후 잔액</span>
                          <span
                            className={
                              nextBalance >= 0 ? "text-emerald-600" : "text-rose-600"
                            }
                          >
                            {formatClassCurrency(nextBalance)} {summary.currencyUnit}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {hasShortage ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
            <div className="space-y-2">
              {Object.entries(shortageByCurrency).map(([currencyType, info]) => (
                <div
                  key={currencyType}
                  className="flex items-center gap-2 text-xs font-bold text-rose-700"
                >
                  <AlertCircle size={15} className="shrink-0" />
                  <span>
                    {info.unit} 잔액이 {formatClassCurrency(info.shortage)}만큼 부족해요.
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {isUsageLoading ? (
          <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-xs font-bold text-sky-700">
            구매 제한 정보를 불러오는 중입니다. 확인이 끝나면 결제할 수 있어요.
          </div>
        ) : null}

        {hasLimitError ? (
          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs font-bold text-amber-700">
            한도나 재고를 초과한 상품이 있어 지금은 결제를 진행할 수 없어요.
          </div>
        ) : null}
      </Modal.Body>

      <Modal.Footer>
        <div className="grid w-full grid-cols-2 gap-3">
          <Button size="md"
            kind="outline"
            tone="slate"
            onClick={onClose}
            disabled={isSubmitting}
            
          >
            닫기
          </Button>
          <Button size="md"
            kind="solid"
            tone={canCheckout ? "blue" : "slate"}
            onClick={onCheckout}
            isLoading={isSubmitting}
            disabled={!canCheckout}
            
          >
            결제하기
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default StoreCartModal;
