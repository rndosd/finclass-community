import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Clock3, Crown, Gift, Minus, Plus, Wallet } from "lucide-react";

import { Button, Modal } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { getStoreTreasuryMode } from "../../../utils/taxPolicy";
import { getCompactTimeSaleLabel } from "../utils/timeSale";
import { getStorePurchaseLimitInfo } from "../utils/storeUsage";
import {
  formatItemValidityDuration,
  hasItemExpiration,
} from "../utils/itemExpiration";
import { isStoreItemPurchasableByStudents } from "../utils/storeSaleStatus";
import { getStoreItemAsset } from "../utils/storeItemVisuals";
import { normalizeStoreCurrencyType } from "../utils/storeCurrency";

const buildLimitItems = (item, limitInfo) => {
  const items = [];

  if (item?.dailyLimit) {
    items.push({
      key: "daily",
      label: `오늘 ${limitInfo.dailyRemaining}개`,
      className: "border-amber-100 bg-amber-50 text-amber-700",
    });
  }

  if (item?.weeklyLimit) {
    items.push({
      key: "weekly",
      label: `이번 주 ${limitInfo.weeklyRemaining}개`,
      className: "border-indigo-100 bg-indigo-50 text-indigo-700",
    });
  }

  if (item?.totalLimit) {
    items.push({
      key: "total",
      label: `전체 ${limitInfo.totalRemaining}개`,
      className: "border-rose-100 bg-rose-50 text-rose-700",
    });
  }

  return items;
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

const BuyItemModal = ({
  isOpen,
  onClose,
  itemToBuy,
  usageData,
  isUsageLoading = false,
  currencyUnit,
  studentClassCurrencyBalance,
  onSubmitPurchase,
  isSubmitting,
  isVipLoungeItem = false,
}) => {
  const { formatClassCurrency: formatConfiguredCurrency } = useNumberFormat();
  const formatClassCurrency = (value) => formatConfiguredCurrency(value, {
    fractionDigits: 8,
    trimTrailingZeros: true,
  });
  const { classData } = useUser();
  const [quantity, setQuantity] = useState(1);
  const [purchaseState, setPurchaseState] = useState("idle");
  const activePurchaseTokenRef = useRef(0);
  const successCloseTimerRef = useRef(null);
  const vipTheme = Boolean(isVipLoungeItem);
  const isConsumptionTaxEnabled = getStoreTreasuryMode(classData) !== "NONE";
  const isConsumptionTaxApplicable =
    isConsumptionTaxEnabled &&
    normalizeStoreCurrencyType(itemToBuy?.currencyType) === "cash";

  useLayoutEffect(() => {
    activePurchaseTokenRef.current += 1;

    if (!isOpen) return undefined;

    setQuantity(1);
    setPurchaseState("idle");

    return () => {
      if (successCloseTimerRef.current) {
        window.clearTimeout(successCloseTimerRef.current);
        successCloseTimerRef.current = null;
      }
    };
  }, [isOpen, itemToBuy?.id]);

  const defaultTaxRate = useMemo(
    () =>
      typeof classData?.settings?.taxRate === "number"
        ? classData.settings.taxRate
        : 10,
    [classData],
  );

  const { effectiveTaxRate, isTaxable } = useMemo(() => {
    const hasCustom =
      itemToBuy?.customTaxRate !== undefined &&
      itemToBuy?.customTaxRate !== null;
    const rate = hasCustom ? Number(itemToBuy.customTaxRate) : defaultTaxRate;
    const taxable =
      isConsumptionTaxApplicable &&
      rate > 0 &&
      itemToBuy?.isTaxable !== false;

    return {
      effectiveTaxRate: rate,
      isTaxable: taxable,
    };
  }, [defaultTaxRate, isConsumptionTaxApplicable, itemToBuy]);

  const limitInfo = useMemo(() => {
    if (!itemToBuy) return null;
    return getStorePurchaseLimitInfo(itemToBuy, usageData);
  }, [itemToBuy, usageData]);

  if (!isOpen || !itemToBuy || !limitInfo) return null;

  const safeQuantity = Number(quantity) || 0;
  const unitPrice = Number(itemToBuy.effectivePrice ?? itemToBuy.price ?? 0);
  const basePrice = Number(itemToBuy.basePrice ?? itemToBuy.price ?? 0);
  const totalPrice = unitPrice * safeQuantity;
  const currentBalance = Number(studentClassCurrencyBalance) || 0;
  const canAfford = currentBalance >= totalPrice;
  const isPurchasable = isStoreItemPurchasableByStudents(itemToBuy);
  const canPurchase =
    !isUsageLoading &&
    isPurchasable &&
    canAfford &&
    safeQuantity > 0 &&
    limitInfo.maxPossible > 0;
  const taxBreakdown = getTaxBreakdown(totalPrice, effectiveTaxRate, isTaxable);
  const limitItems = buildLimitItems(itemToBuy, limitInfo);
  const validityLabel = hasItemExpiration(itemToBuy)
    ? formatItemValidityDuration(itemToBuy.validityHours)
    : "";
  const timeSaleBadgeLabel = getCompactTimeSaleLabel(
    itemToBuy.timeSaleCountdownLabel,
  );

  const itemAsset = getStoreItemAsset(itemToBuy);

  const handleInputChange = (event) => {
    const nextValue = event.target.value;
    if (nextValue === "") {
      setQuantity("");
      return;
    }

    let nextQuantity = parseInt(nextValue, 10);
    if (Number.isNaN(nextQuantity)) return;
    if (nextQuantity < 1) nextQuantity = 1;
    if (nextQuantity > limitInfo.maxPossible) {
      nextQuantity = limitInfo.maxPossible;
    }

    setQuantity(nextQuantity);
  };

  const handleBlur = () => {
    if (quantity === "" || quantity < 1) setQuantity(1);
  };

  const handlePurchase = async () => {
    if (!canPurchase || isSubmitting || purchaseState !== "idle") return;

    const purchaseToken = activePurchaseTokenRef.current;
    const didPurchase = await onSubmitPurchase?.(itemToBuy, safeQuantity);
    if (!didPurchase || purchaseToken !== activePurchaseTokenRef.current) return;

    setPurchaseState("success");
    successCloseTimerRef.current = window.setTimeout(() => {
      onClose?.();
    }, 420);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size={vipTheme ? "md" : "sm"}>
      <Modal.Header
        className={
          vipTheme
            ? "!border-[#b89a56]/25 !bg-[#080d18] text-white"
            : ""
        }
      >
        <div>
          {vipTheme ? (
            <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.24em] text-[#e7c873]">
              <Crown className="h-4 w-4" />
              VIP LOUNGE
            </p>
          ) : null}
          <h2
            className={
              vipTheme
                ? "mt-1 text-xl font-bold text-[#fff9e7]"
                : "text-lg font-bold text-slate-900"
            }
          >
            {vipTheme ? "\uB77C\uC6B4\uC9C0 \uC804\uC6A9 \uC0C1\uD488" : "\uC0C1\uD488 \uAD6C\uB9E4"}
          </h2>
          <p className={vipTheme ? "text-xs font-medium text-slate-400" : "text-xs font-medium text-slate-500"}>
            {vipTheme
              ? "\uB77C\uC6B4\uC9C0 \uC804\uC6A9 \uC0C1\uD488\uC744 \uC2E0\uCCAD\uD569\uB2C8\uB2E4."
              : "\uC218\uB7C9\uACFC \uACB0\uC81C \uAE08\uC561\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694."}
          </p>
        </div>
      </Modal.Header>

      <Modal.Body className={vipTheme ? "space-y-3 bg-[#070b14] text-white" : "space-y-3 !py-4"}>
        <div
          className={`relative overflow-hidden rounded-2xl border p-4 ${
            vipTheme
              ? "border-[#b89a56]/35 bg-[linear-gradient(135deg,rgba(25,31,47,0.98),rgba(8,12,22,0.98))]"
              : itemToBuy.timeSaleActive
                ? "border-rose-200 bg-gradient-to-br from-rose-50 via-white to-amber-50"
                : "border-slate-200 bg-slate-50"
          }`}
        >
          <img
            src={itemAsset}
            alt=""
            className="absolute right-3 top-3 h-14 w-14 object-contain"
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-center gap-2 pr-14">
            {vipTheme ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e2c676]/35 bg-[#e2c676]/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-[#f2d98e]">
                  <Crown className="h-3.5 w-3.5" />
                  VIP LOUNGE
                </span>
                {itemToBuy.timeSaleActive ? (
                  <span className="rounded-full border border-rose-300/30 bg-rose-300/10 px-2.5 py-1 text-xs font-black text-rose-200">
                    {itemToBuy.timeSaleDiscountPercent || 0}% \uD560\uC778
                  </span>
                ) : null}
              </>
            ) : itemToBuy.timeSaleActive ? (
              <>
                <span className="rounded-full bg-rose-600 px-2.5 py-1 text-xs font-black text-white">
                  {itemToBuy.timeSaleDiscountPercent || 0}% 할인
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">
                  <Clock3 size={12} />
                  {timeSaleBadgeLabel || "\uC9C4\uD589 \uC911"}
                </span>
              </>
            ) : (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">
                기본 상품
              </span>
            )}
          </div>

          <h3 className={vipTheme ? "mt-2 pr-14 text-lg font-bold leading-tight text-[#fff9e7]" : "mt-2 pr-14 text-lg font-bold leading-tight text-slate-900"}>
            {itemToBuy.name}
          </h3>
          {itemToBuy.description ? (
            <p className={vipTheme ? "mt-1 line-clamp-2 break-words text-xs leading-relaxed text-slate-300" : "mt-1 line-clamp-2 break-words text-xs leading-relaxed text-slate-500"}>
              {itemToBuy.description}
            </p>
          ) : null}
          {validityLabel ? (
            <p className={vipTheme ? "mt-2 text-xs font-bold text-[#e7c873]" : "mt-2 text-xs font-bold text-sky-700"}>
              구매 후 {validityLabel} 동안 사용 가능
            </p>
          ) : null}

          <p className={vipTheme ? "mt-2 flex items-center gap-1.5 text-xs font-bold text-slate-300" : "mt-2 flex items-center gap-1.5 text-xs font-bold text-slate-600"}>
            <Gift size={13} aria-hidden="true" />
            {itemToBuy.isGiftAllowed === false ? "선물 불가" : "선물 가능"}
          </p>

          <div className="mt-2 text-sm">
            {itemToBuy.timeSaleActive ? (
              <div className="space-y-1.5">
                <div className="text-sm font-black text-slate-300 line-through">
                  정가 {formatClassCurrency(basePrice)} {currencyUnit}
                </div>
                <div className={vipTheme ? "font-bold text-rose-200" : "font-bold text-rose-700"}>
                  단가 {formatClassCurrency(unitPrice)} {currencyUnit}
                </div>
              </div>
            ) : (
              <div className={vipTheme ? "font-semibold text-[#fff9e7]" : "font-semibold text-slate-700"}>
                단가 {formatClassCurrency(unitPrice)} {currencyUnit}
              </div>
            )}
          </div>
        </div>

        {limitItems.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {limitItems.map((limitItem) => (
              <span
                key={limitItem.key}
                className={`rounded-full border px-3 py-1 text-xs font-black ${limitItem.className}`}
              >
                {limitItem.label}
              </span>
            ))}
          </div>
        ) : null}

        <div className={vipTheme ? "rounded-2xl border border-[#b89a56]/25 bg-[#111827] p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black tracking-[0.16em] text-slate-400">
                수량
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {limitInfo.maxPossible === 0
                  ? "지금은 구매할 수 없어요."
                  : `최대 ${limitInfo.maxPossible}개`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="icon-md"
                kind="soft"
                tone="slate"
                icon={Minus}
                aria-label="수량 줄이기"
                onClick={() => setQuantity((prev) => Math.max(1, Number(prev) - 1))}
                disabled={isSubmitting || isUsageLoading || quantity <= 1}
                
              />
              <input
                type="number"
                aria-label="구매 수량"
                min={1}
                max={limitInfo.maxPossible}
                value={quantity}
                onChange={handleInputChange}
                onBlur={handleBlur}
                disabled={isSubmitting || isUsageLoading}
                className="h-11 w-20 rounded-xl border border-blue-200 bg-blue-50/50 text-center text-xl font-black text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
              <Button
                size="icon-md"
                kind="soft"
                tone="slate"
                icon={Plus}
                aria-label="수량 늘리기"
                onClick={() =>
                  setQuantity((prev) =>
                    Math.min(limitInfo.maxPossible, Number(prev) + 1),
                  )
                }
                disabled={
                  isSubmitting ||
                  isUsageLoading ||
                  quantity >= limitInfo.maxPossible
                }
                
              />
            </div>
          </div>
        </div>

        {isUsageLoading ? (
          <div className={vipTheme ? "rounded-2xl border border-[#b89a56]/20 bg-[#111827] p-4" : "rounded-2xl border border-sky-100 bg-sky-50 p-4"}>
            <p className="text-xs font-bold text-sky-700">
              구매 제한 정보를 불러오는 중입니다. 확인이 끝나면 결제할 수 있어요.
            </p>
          </div>
        ) : null}

        <div
          className={`relative overflow-hidden rounded-2xl border p-4 tabular-nums ${
            vipTheme
              ? "border-[#b89a56]/35 bg-[linear-gradient(135deg,rgba(25,31,47,0.98),rgba(8,12,22,0.98))]"
              : itemToBuy.timeSaleActive
                ? "border-rose-200 bg-gradient-to-br from-rose-50 via-white to-amber-50"
                : "border-slate-200 bg-white"
          }`}
        >
          <div className={vipTheme ? "flex items-center gap-2 text-xs font-black tracking-[0.16em] text-[#e7c873]" : "flex items-center gap-2 text-xs font-black tracking-[0.16em] text-slate-400"}>
            <Wallet size={14} />
            결제 요약
          </div>

          <div className="mt-3 space-y-2 text-sm">
            {taxBreakdown.isTaxable ? (
              <>
                <div className="flex items-center justify-between text-slate-500">
                  <span>공급가</span>
                  <span>
                    {formatClassCurrency(taxBreakdown.baseAmount)} {currencyUnit}
                  </span>
                </div>
                <div className="flex items-center justify-between text-blue-600">
                  <span>소비세 ({taxBreakdown.rate}%)</span>
                  <span>
                    +{formatClassCurrency(taxBreakdown.taxAmount)} {currencyUnit}
                  </span>
                </div>
              </>
            ) : !isConsumptionTaxApplicable ? (
              <div className="flex items-center justify-between text-slate-500">
                <span>소비세</span>
                <span>적용 안 함</span>
              </div>
            ) : (
              <div className="flex items-center justify-between text-emerald-600">
                <span>면세 상품</span>
                <span>
                  {formatClassCurrency(taxBreakdown.finalAmount)} {currencyUnit}
                </span>
              </div>
            )}

            <div className={vipTheme ? "h-px bg-white/10" : "h-px bg-slate-100"} />

            <div className={vipTheme ? "flex items-center justify-between font-black text-[#fff9e7]" : "flex items-center justify-between font-black text-slate-900"}>
              <span>최종 결제 금액</span>
              <span>
                {formatClassCurrency(taxBreakdown.finalAmount)} {currencyUnit}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-500">
              <span>현재 잔액</span>
              <span className={vipTheme ? "font-bold text-slate-200" : "font-bold text-slate-700"}>
                {formatClassCurrency(currentBalance)} {currencyUnit}
              </span>
            </div>
            <div className="flex items-center justify-between font-black">
              <span className="text-slate-500">결제 후 잔액</span>
              <span className={canAfford ? "text-emerald-600" : "text-rose-600"}>
                {formatClassCurrency(currentBalance - totalPrice)} {currencyUnit}
              </span>
            </div>
          </div>
        </div>

        {!isPurchasable ? (
          <div className={vipTheme ? "rounded-2xl border border-[#b89a56]/20 bg-[#211a0c] p-4" : "rounded-2xl border border-amber-100 bg-amber-50 p-4"}>
            <p className="text-xs font-bold text-amber-700">
              지금은 이 상품을 구매할 수 없어요.
            </p>
          </div>
        ) : null}

        {!canAfford ? (
          <div role="status" className={vipTheme ? "flex items-center gap-3 rounded-xl border border-rose-300/20 bg-rose-300/10 p-3" : "flex items-center gap-3 rounded-xl border border-rose-100 bg-rose-50 p-3"}>
            <AlertCircle size={18} className="text-rose-500" />
            <p className={`text-xs font-bold ${vipTheme ? "text-rose-200" : "text-rose-700"}`}>
              잔액이 {formatClassCurrency(totalPrice - currentBalance)} {currencyUnit}
              만큼 부족합니다.
            </p>
          </div>
        ) : null}
      </Modal.Body>

      <Modal.Footer
        className={
          vipTheme
            ? "sticky bottom-0 z-10 !border-[#b89a56]/20 !bg-[#080d18] !py-3"
            : "sticky bottom-0 z-10 !bg-white !py-3"
        }
      >
        <div className="grid w-full grid-cols-2 gap-3">
          <Button
            kind={vipTheme ? undefined : "outline"}
            tone={vipTheme ? undefined : "slate"}
            onClick={onClose}
            disabled={isSubmitting || purchaseState === "success"}
            className={
              vipTheme
                ? "rounded-2xl border border-[#b89a56]/35 bg-transparent py-6 font-bold text-[#f2d98e] hover:bg-[#e2c676]/10"
                : "h-11 rounded-xl font-bold"
            }
          >
            {vipTheme ? "\uB2EB\uAE30" : "닫기"}
          </Button>
          <Button
            kind={vipTheme ? undefined : "solid"}
            tone={
              vipTheme
                ? undefined
                : canPurchase
                  ? itemToBuy.timeSaleActive
                    ? "rose"
                    : "blue"
                  : "slate"
            }
            onClick={handlePurchase}
            isLoading={isSubmitting}
            loadingText="\uACB0\uC81C \uCC98\uB9AC \uC911"
            icon={purchaseState === "success" ? Check : undefined}
            disabled={!canPurchase || purchaseState === "success"}
            className={
              vipTheme
                ? "rounded-2xl bg-[linear-gradient(135deg,#f6dfa1,#c5973e)] py-6 font-bold text-[#171209] shadow-[0_10px_24px_rgba(184,133,38,0.24)] hover:brightness-105 disabled:opacity-40"
                : "h-11 rounded-xl font-bold"
            }
          >
            {purchaseState === "success"
              ? "\uAD6C\uB9E4 \uC644\uB8CC"
              : vipTheme
              ? !isPurchasable
                ? "\uAD6C\uB9E4 \uBD88\uAC00"
                : limitInfo.maxPossible === 0
                  ? "\uD55C\uB3C4 \uCD08\uACFC"
                  : "\uC804\uC6A9 \uC0C1\uD488 \uAD6C\uB9E4"
              : !isPurchasable
                ? "구매 불가"
                : limitInfo.maxPossible === 0
                  ? "구매 한도 초과"
                  : `${formatClassCurrency(totalPrice)} ${currencyUnit} 구매`}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default BuyItemModal;
