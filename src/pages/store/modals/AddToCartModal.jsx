import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import { Clock3, Minus, Plus } from "lucide-react";

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

const AddToCartModal = ({
  isOpen,
  onClose,
  item,
  usageData,
  isUsageLoading = false,
  currencyUnit,
  onConfirm,
}) => {
  const { formatClassCurrency } = useNumberFormat();
  const { classData } = useUser();
  const [quantity, setQuantity] = useState(1);
  const isConsumptionTaxEnabled = getStoreTreasuryMode(classData) !== "NONE";
  const isConsumptionTaxApplicable =
    isConsumptionTaxEnabled &&
    normalizeStoreCurrencyType(item?.currencyType) === "cash";

  useEffect(() => {
    if (isOpen) setQuantity(1);
  }, [isOpen]);

  const defaultTaxRate = useMemo(
    () =>
      typeof classData?.settings?.taxRate === "number"
        ? classData.settings.taxRate
        : 10,
    [classData],
  );

  const { effectiveTaxRate, isTaxable } = useMemo(() => {
    const hasCustom =
      item?.customTaxRate !== undefined && item?.customTaxRate !== null;
    const rate = hasCustom ? Number(item.customTaxRate) : defaultTaxRate;
    const taxable =
      isConsumptionTaxApplicable &&
      rate > 0 &&
      item?.isTaxable !== false;

    return {
      effectiveTaxRate: rate,
      isTaxable: taxable,
    };
  }, [item, defaultTaxRate, isConsumptionTaxApplicable]);

  const limitInfo = useMemo(() => {
    if (!item) return null;
    return getStorePurchaseLimitInfo(item, usageData);
  }, [item, usageData]);

  if (!isOpen || !item || !limitInfo) return null;

  const safeQuantity = Number(quantity) || 0;
  const unitPrice = Number(item.effectivePrice ?? item.price ?? 0);
  const basePrice = Number(item.basePrice ?? item.price ?? 0);
  const totalPrice = unitPrice * safeQuantity;
  const limitItems = buildLimitItems(item, limitInfo);
  const isPurchasable = isStoreItemPurchasableByStudents(item);
  const canAddToCart =
    !isUsageLoading &&
    isPurchasable &&
    safeQuantity >= 1 &&
    safeQuantity <= limitInfo.maxPossible &&
    limitInfo.maxPossible > 0;
  const validityLabel = hasItemExpiration(item)
    ? formatItemValidityDuration(item.validityHours)
    : "";
  const timeSaleBadgeLabel = getCompactTimeSaleLabel(item.timeSaleCountdownLabel);

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

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <Modal.Header>
        <div>
          <h2 className="text-lg font-bold text-slate-900">장바구니 담기</h2>
          <p className="text-xs font-medium text-slate-500">
            필요한 수량만 먼저 담아두세요.
          </p>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-3 !py-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          {item.timeSaleActive ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <>
                <span className="rounded-full bg-rose-600 px-2.5 py-1 text-xs font-black text-white">
                  {item.timeSaleDiscountPercent || 0}% 할인
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">
                  <Clock3 size={12} />
                  {timeSaleBadgeLabel || "진행 중"}
                </span>
              </>
            </div>
          ) : null}

          <h3 className="break-words text-lg font-bold leading-tight text-slate-900">
            {item.name}
          </h3>
          {item.description ? (
            <p className="mt-1.5 line-clamp-3 break-words text-sm leading-relaxed text-slate-500">
              {item.description}
            </p>
          ) : null}
          {validityLabel ? (
            <p className="mt-2 text-xs font-bold text-sky-600">
              구매 후 {validityLabel} 동안 사용 가능
            </p>
          ) : null}


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

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black tracking-[0.16em] text-slate-400">
                수량
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {limitInfo.maxPossible === 0
                  ? "지금은 담을 수 없어요."
                  : `최대 ${limitInfo.maxPossible}개`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="icon-md"
                kind="soft"
                tone="slate"
                aria-label="수량 줄이기"
                icon={Minus}
                onClick={() => setQuantity((prev) => Math.max(1, Number(prev) - 1))}
                disabled={isUsageLoading || quantity <= 1}
                
              />
              <input
                aria-label="담을 수량"
                min={1}
                max={limitInfo.maxPossible}
                type="number"
                value={quantity}
                onChange={handleInputChange}
                onBlur={handleBlur}
                disabled={isUsageLoading}
                className="h-11 w-20 rounded-xl border border-blue-200 bg-blue-50/50 text-center text-xl font-black text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
              <Button
                size="icon-md"
                kind="soft"
                tone="slate"
                aria-label="수량 늘리기"
                icon={Plus}
                onClick={() =>
                  setQuantity((prev) =>
                    Math.min(limitInfo.maxPossible, Number(prev) + 1),
                  )
                }
                disabled={isUsageLoading || quantity >= limitInfo.maxPossible}
                
              />
            </div>
          </div>
        </div>

        {isUsageLoading ? (
          <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
            <p className="text-xs font-bold text-sky-700">
              구매 제한 정보를 불러오는 중입니다. 확인이 끝나면 장바구니에 담을 수 있어요.
            </p>
          </div>
        ) : null}

        {!isPurchasable ? (
          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
            <p className="text-xs font-bold text-amber-700">
              지금은 이 상품을 구매하거나 담을 수 없어요.
            </p>
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
            <span>단가 × 수량</span>
            <span className="font-semibold text-slate-700">
              {item.timeSaleActive ? <span className="mr-2 text-slate-400 line-through">{formatClassCurrency(basePrice)}</span> : null}
              {formatClassCurrency(unitPrice)} {currencyUnit} × {safeQuantity}개
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 font-bold text-slate-900">
            <span>예상 합계</span>
            <span className="break-all text-xl">{formatClassCurrency(totalPrice)} {currencyUnit}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {isTaxable ? "소비세 " + effectiveTaxRate + "% 포함" : !isConsumptionTaxApplicable ? "소비세 적용 안 함" : "면세 상품"}
          </p>
          {item.timeSaleActive ? (
            <p className="mt-3 text-xs font-semibold text-rose-600">
              실제 결제 금액은 결제 시점 타임세일 상태에 따라 다시 계산됩니다.
            </p>
          ) : null}
        </div>
      </Modal.Body>

      <Modal.Footer className="sticky bottom-0 z-10 !bg-white !py-3">
        <div className="grid w-full grid-cols-2 gap-3">
          <Button size="md"
            kind="outline"
            tone="slate"
            onClick={onClose}
            
          >
            취소
          </Button>
          <Button size="md"
            kind="solid"
            tone={
              canAddToCart ? (item.timeSaleActive ? "rose" : "blue") : "slate"
            }
            onClick={() => onConfirm(item, safeQuantity)}
            disabled={!canAddToCart}
            
          >
            {!isPurchasable
              ? "구매 불가"
              : limitInfo.maxPossible === 0
                ? "한도 초과"
                : "담기 완료"}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default AddToCartModal;
