import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Box,
  ChevronDown,
  Clock3,
  Edit,
  Gift,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Trash2,
} from "lucide-react";

import { PERMISSIONS } from "../../../constants/permissions";
import { Badge, Button, IconButton } from "../../../components/ui";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useUser } from "../../../contexts/UserContext";
import {
  getStoreCurrencyUnit,
  normalizeStoreCurrencyType,
} from "../utils/storeCurrency";
import {
  getRandomBoxBoxType,
  getRandomBoxRewardEntries,
  isRandomBoxItem,
} from "../utils/randomBox";
import {
  formatItemValidityDuration,
  hasItemExpiration,
} from "../utils/itemExpiration";
import {
  STORE_ITEM_SALE_STATUS,
  getStoreItemSaleStatusMeta,
} from "../utils/storeSaleStatus";
import {
  getStoreItemAsset,
  isStoreItemIconHidden,
} from "../utils/storeItemVisuals";

const REWARD_DROPDOWN_GAP = 8;
const REWARD_DROPDOWN_VIEWPORT_PADDING = 16;
const REWARD_DROPDOWN_MAX_HEIGHT = 320;

const getStockInfo = (stock) => {
  if (stock === null || stock === -1) {
    return {
      label: "재고 제한 없음",
      className: "bg-blue-50 text-blue-600 ring-1 ring-blue-100",
    };
  }

  if (Number(stock) <= 0) {
    return {
      label: "품절",
      className: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
    };
  }

  if (Number(stock) <= 10) {
    return {
      label: `${stock}개`,
      className: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
    };
  }

  return {
    label: `${stock}개`,
    className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  };
};

const StoreItemCard = ({
  item,
  currencyUnit,
  onBuyItem,
  onAddToCart,
  onEditItem,
  onDeleteItem,
  isStoreAdmin: isStoreAdminProp = false,
  isVipLounge = false,
  purchaseDisabled = false,
  orderDragHandle,
}) => {
  const { hasPermission, missionTokenLabel } = useUser();
  const { formatClassCurrency } = useNumberFormat();
  const [isRewardTableOpen, setIsRewardTableOpen] = useState(false);
  const [rewardDropdownPlacement, setRewardDropdownPlacement] = useState("bottom");
  const [rewardDropdownStyle, setRewardDropdownStyle] = useState(null);
  const [portalRoot, setPortalRoot] = useState(null);
  const rewardDropdownRef = useRef(null);
  const rewardMenuRef = useRef(null);
  const isStoreAdmin =
    isStoreAdminProp || hasPermission(PERMISSIONS.STORE_ADMIN);

  const updateRewardDropdownLayout = useCallback(() => {
    if (!rewardDropdownRef.current) return;

    const anchorRect = rewardDropdownRef.current.getBoundingClientRect();
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight;
    const availableWidth = Math.max(
      0,
      viewportWidth - REWARD_DROPDOWN_VIEWPORT_PADDING * 2,
    );
    const width = Math.min(anchorRect.width, availableWidth);
    const left = Math.min(
      Math.max(anchorRect.left, REWARD_DROPDOWN_VIEWPORT_PADDING),
      viewportWidth - REWARD_DROPDOWN_VIEWPORT_PADDING - width,
    );
    const spaceBelow = Math.max(
      0,
      viewportHeight -
        REWARD_DROPDOWN_VIEWPORT_PADDING -
        anchorRect.bottom -
        REWARD_DROPDOWN_GAP,
    );
    const spaceAbove = Math.max(
      0,
      anchorRect.top -
        REWARD_DROPDOWN_VIEWPORT_PADDING -
        REWARD_DROPDOWN_GAP,
    );
    const nextPlacement =
      spaceBelow >= 220 || spaceBelow >= spaceAbove ? "bottom" : "top";
    const nextMaxHeight = Math.min(
      REWARD_DROPDOWN_MAX_HEIGHT,
      nextPlacement === "bottom" ? spaceBelow : spaceAbove,
    );

    setRewardDropdownPlacement(nextPlacement);
    setRewardDropdownStyle({
      left,
      top:
        nextPlacement === "bottom"
          ? anchorRect.bottom + REWARD_DROPDOWN_GAP
          : anchorRect.top - REWARD_DROPDOWN_GAP,
      width,
      maxHeight: Math.max(0, nextMaxHeight),
    });
  }, []);

  useEffect(() => {
    setIsRewardTableOpen(false);
  }, [item?.id]);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    if (!isRewardTableOpen) return undefined;

    const handlePointerDown = (event) => {
      const isInsideTrigger = rewardDropdownRef.current?.contains(event.target);
      const isInsideMenu = rewardMenuRef.current?.contains(event.target);

      if (!isInsideTrigger && !isInsideMenu) {
        setIsRewardTableOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsRewardTableOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isRewardTableOpen]);

  useEffect(() => {
    if (!isRewardTableOpen) return undefined;

    updateRewardDropdownLayout();

    const handleViewportChange = () => {
      window.requestAnimationFrame(updateRewardDropdownLayout);
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isRewardTableOpen, updateRewardDropdownLayout]);

  if (!item) return null;

  const itemCurrencyType = normalizeStoreCurrencyType(item.currencyType);
  const itemCurrencyUnit = getStoreCurrencyUnit(
    itemCurrencyType,
    currencyUnit,
    missionTokenLabel,
  );
  const saleStatusMeta = getStoreItemSaleStatusMeta(item);
  const isSoldOut =
    item.stock !== null && item.stock !== -1 && Number(item.stock) === 0;
  const canPurchase =
    saleStatusMeta.isPurchasable && !isSoldOut && !purchaseDisabled;
  const hasTierRestriction = Boolean(item.minCreditTierId);
  const isGiftDisabled = item.isGiftAllowed === false;
  const isTimeSaleActive = item.timeSaleActive === true;
  const isRandomBox = isRandomBoxItem(item);
  const effectivePrice = Number(item.effectivePrice ?? item.price ?? 0);
  const basePrice = Number(item.basePrice ?? item.price ?? 0);
  const effectivePriceLabel = formatClassCurrency(effectivePrice);
  const stockInfo = getStockInfo(item.stock);
  const validityLabel = hasItemExpiration(item)
    ? formatItemValidityDuration(item.validityHours)
    : "";
  const randomBoxRewards = getRandomBoxRewardEntries(item);
  const randomBoxType = getRandomBoxBoxType(item);
  const hasRewardTable = isRandomBox && randomBoxRewards.length > 0;
  const snapshotPriceChangePercent = Number(item.snapshotPriceChangePercent ?? 0);
  const hasSnapshotPriceChange =
    Number.isFinite(snapshotPriceChangePercent) && snapshotPriceChangePercent !== 0;
  const isPriceUp = snapshotPriceChangePercent > 0;
  const priceChangeArrow = isPriceUp ? "▲" : "▼";
  const itemAsset = getStoreItemAsset(item);
  const isItemIconHidden = isStoreItemIconHidden(item);
  const cardClassName = isVipLounge
    ? `border border-white/10 bg-white/[0.035] text-white shadow-2xl shadow-black/30 backdrop-blur-md hover:-translate-y-0.5 hover:border-amber-200/35 hover:bg-white/[0.06] hover:shadow-amber-500/5 ${
        isSoldOut ? "opacity-70" : ""
      }`
    : `${
        isRandomBox
          ? randomBoxType === "premium"
            ? "border-2 border-amber-300 bg-gradient-to-br from-amber-100 via-white to-rose-100 shadow-xl shadow-amber-200/55 ring-1 ring-amber-200"
            : "border-2 border-indigo-300 bg-gradient-to-br from-indigo-100 via-white to-violet-100 shadow-xl shadow-indigo-200/55 ring-1 ring-indigo-200"
          : isTimeSaleActive
            ? "bg-white ring-2 ring-rose-200 shadow-xl shadow-rose-100/35"
            : "bg-white ring-1 ring-slate-100 shadow-xl shadow-slate-200/20"
      } ${
        isSoldOut
          ? "opacity-75"
          : "hover:-translate-y-1 hover:shadow-2xl hover:shadow-slate-200/40"
      }`;
  const formatProbabilityLabel = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "0%";
    if (Math.abs(numeric) >= 10) return `${numeric.toFixed(0)}%`;
    if (Math.abs(numeric) >= 1) return `${numeric.toFixed(1)}%`;
    return `${numeric.toFixed(2)}%`;
  };

  return (
    <div
      style={{ containerType: "inline-size" }}
      className={`group relative flex h-full flex-col justify-between overflow-hidden rounded-[1.6rem] p-5 transition-all duration-300 ${cardClassName}`}
    >
      {isStoreAdmin ? (
        <div
          data-tour="store-item-admin-actions"
          className="absolute right-4 top-4 z-20 flex gap-1.5 opacity-100 transition-opacity duration-200 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
        >
          {orderDragHandle}
          <IconButton
            icon={Edit}
            label="상품 수정"
            onClick={() => onEditItem(item)}
            tone={isVipLounge ? "amber" : "blue"}
            className={isVipLounge ? "bg-black/40 text-slate-300" : "bg-white text-slate-400"}
          />
          <IconButton
            icon={Trash2}
            label="상품 삭제"
            onClick={() => onDeleteItem(item)}
            tone="red"
            className={isVipLounge ? "bg-black/40 text-slate-300" : "bg-white text-slate-400"}
          />
        </div>
      ) : null}

      <div>
        <div
          ref={rewardDropdownRef}
          className={`relative ${!saleStatusMeta.isPurchasable || hasTierRestriction || hasRewardTable || isStoreAdmin ? "mb-3" : ""} ${isStoreAdmin ? orderDragHandle ? "min-h-7 pr-36" : "min-h-7 pr-20" : ""}`}
        >
          <div
            className={`flex flex-wrap items-center gap-2 text-[11px] font-semibold ${isVipLounge ? "text-slate-300" : "text-slate-500"}`}
          >
              {!saleStatusMeta.isPurchasable ? (
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 font-black ${
                    isVipLounge
                      ? "border border-slate-300/15 bg-slate-500/10 text-slate-300"
                      : saleStatusMeta.badgeClassName
                  }`}
                >
                  {saleStatusMeta.label}
                </span>
              ) : null}

              {hasTierRestriction ? (
                <Badge
                  tone="violet"
                  variant="soft"
                  size="sm"
                  className={`shrink-0 gap-1 font-bold ${
                    isVipLounge
                      ? "border border-violet-300/20 bg-violet-500/10 text-violet-200"
                      : ""
                  }`}
                >
                  <ShieldCheck size={10} />
                  {item.minCreditTierName || "등급 제한"}
                </Badge>
              ) : null}

              {hasRewardTable ? (
                <button
                  type="button"
                  onClick={() => setIsRewardTableOpen((prev) => !prev)}
                  aria-expanded={isRewardTableOpen}
                  aria-haspopup="dialog"
                  className={`inline-flex shrink-0 items-center gap-1 font-black underline-offset-2 hover:underline ${
                    isVipLounge
                      ? "text-amber-200"
                      : randomBoxType === "premium"
                        ? "text-amber-700"
                        : "text-indigo-600"
                  }`}
                >
                  확률 보기
                  <ChevronDown
                    size={12}
                    className={`transition-transform ${isRewardTableOpen ? "rotate-180" : ""}`}
                  />
                </button>
              ) : null}
          </div>
          {hasRewardTable &&
          isRewardTableOpen &&
          portalRoot &&
          rewardDropdownStyle ? (
            createPortal(
              <div
                ref={rewardMenuRef}
                className={`fixed z-[160] rounded-[1.5rem] border p-4 shadow-2xl animate-in duration-200 ${
                  rewardDropdownPlacement === "top"
                    ? "slide-in-from-bottom-1"
                    : "slide-in-from-top-1"
                } ${
                  isVipLounge
                    ? "border-white/10 bg-slate-950/95 text-slate-100 shadow-black/80 backdrop-blur-xl"
                    : randomBoxType === "premium"
                      ? "border-amber-100 bg-gradient-to-br from-amber-50 via-white to-rose-50 shadow-amber-100/60"
                      : "border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-sky-50 shadow-indigo-100/60"
                }`}
                style={{
                  top: rewardDropdownStyle.top,
                  left: rewardDropdownStyle.left,
                  width: rewardDropdownStyle.width,
                  transform:
                    rewardDropdownPlacement === "top"
                      ? "translateY(-100%)"
                      : undefined,
                }}
              >
              <div className="mb-3">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                  보상 확률표
                </p>
                <p className="mt-1 text-sm font-bold text-slate-700">
                  공개 확률 기준으로 표시됩니다.
                </p>
              </div>

              <div
                className="space-y-2 overflow-y-auto pr-1"
                style={{ maxHeight: `${rewardDropdownStyle.maxHeight}px` }}
              >
                {randomBoxRewards.map((reward) => (
                  <div
                    key={`${reward.itemId || reward.itemName}-${reward.quantity}`}
                    className={`flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 ${
                      isVipLounge
                        ? "bg-white/[0.055] ring-1 ring-white/10"
                        : "bg-white/85 ring-1 ring-white/80"
                    }`}
                  >
                    <div className="min-w-0">
                      <p
                        className={`truncate text-sm font-bold ${
                          isVipLounge ? "text-slate-100" : "text-slate-800"
                        }`}
                      >
                        {reward.itemName}
                      </p>
                      {reward.quantity > 1 ? (
                        <p className="text-[11px] font-semibold text-slate-400">
                          지급 수량 {reward.quantity}개
                        </p>
                      ) : null}
                    </div>
                    <div
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${
                        isVipLounge
                          ? "border border-amber-300/20 bg-amber-500/10 text-amber-200"
                          : randomBoxType === "premium"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-indigo-100 text-indigo-700"
                      }`}
                    >
                      {formatProbabilityLabel(reward.probabilityPercent)}
                    </div>
                  </div>
                ))}
              </div>
              </div>,
              portalRoot,
            )
          ) : null}
        </div>

        {isRandomBox ? (
          <div
            className={`relative mb-3 min-h-[4.5rem] border-b pb-3 ${isVipLounge ? "border-white/10" : "border-slate-100"} ${isItemIconHidden ? "" : "pl-[5rem]"}`}
          >
            {!isItemIconHidden ? (
              <img
                src={itemAsset}
                alt=""
                className="absolute -left-3 -top-2 h-20 w-20 object-contain"
                aria-hidden="true"
              />
            ) : null}
            <div className="mb-1 overflow-hidden">
              <p
                className={`text-[10px] font-black tracking-[0.14em] ${
                  randomBoxType === "premium" ? "text-amber-700" : "text-indigo-600"
                }`}
              >
                {randomBoxType === "premium" ? "\uD504\uB9AC\uBBF8\uC5C4 \uBB34\uC791\uC704 \uBCF4\uC0C1" : "\uBB34\uC791\uC704 \uBCF4\uC0C1"}
              </p>
              <h3 style={{ fontSize: "clamp(1.25rem, 5cqi, 1.5rem)" }} className="mt-0.5 line-clamp-2 break-words text-xl font-black leading-tight tracking-tight">
                {item.name}
              </h3>
            </div>
            <p
              className={`line-clamp-2 break-words text-sm leading-5 ${
                randomBoxType === "premium" ? "text-amber-800/75" : "text-indigo-800/70"
              }`}
            >
              {item.description || "\uBB34\uC5C7\uC774 \uB098\uC62C\uC9C0 \uC5F4\uC5B4 \uBCF4\uC138\uC694."}
            </p>
          </div>
        ) : (
          <div
            className={`relative mb-3 min-h-[4.5rem] border-b pb-3 ${isVipLounge ? "border-white/10" : "border-slate-100"} ${isItemIconHidden ? "" : "pl-[5rem]"}`}
          >
            {!isItemIconHidden ? (
              <img
                src={itemAsset}
                alt=""
                className="absolute -left-3 -top-2 h-20 w-20 object-contain"
                aria-hidden="true"
              />
            ) : null}
            <div className="mb-1 overflow-hidden">
              <h3
                style={{ fontSize: "clamp(1.25rem, 5cqi, 1.5rem)" }}
                className={`line-clamp-2 break-words text-xl font-black leading-tight tracking-tight ${
                  isVipLounge
                    ? isSoldOut
                      ? "text-slate-500 line-through"
                      : "text-slate-100 transition-colors group-hover:text-amber-200"
                    : isSoldOut
                      ? "text-slate-400 line-through"
                      : isTimeSaleActive
                        ? "text-rose-700"
                        : "text-slate-800"
                }`}
              >
                {item.name}
              </h3>
            </div>
            <div className="overflow-hidden">
              <p
                className={`min-h-[1.25rem] line-clamp-2 break-words text-sm leading-5 ${
                  isVipLounge ? "text-slate-400" : "text-slate-500"
                }`}
              >
                {item.description || ""}
              </p>
            </div>
          </div>
        )}
        <div
          data-tour="store-item-price"
          style={{ containerType: "inline-size" }}
          className="mb-4"
        >
          <div className="space-y-2.5">
            {isTimeSaleActive ? (
              <div
                className={`flex flex-wrap items-baseline gap-x-1.5 text-sm font-bold line-through tabular-nums ${
                  isVipLounge ? "text-slate-500" : "text-slate-400"
                }`}
              >
                <span>정가</span>
                <span className="whitespace-nowrap">{formatClassCurrency(basePrice)}</span>
                <span className="min-w-0 max-w-full break-keep [overflow-wrap:anywhere]">
                  {itemCurrencyUnit}
                </span>
              </div>
            ) : null}

            <div
              className={`flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 tabular-nums ${
                isVipLounge
                  ? "text-amber-100"
                  : isTimeSaleActive
                    ? "text-rose-800"
                    : "text-slate-900"
              }`}
            >
              <span
                className="whitespace-nowrap text-4xl font-black leading-tight"
                style={{
                  fontSize: `clamp(1rem, ${150 / Math.max(1, effectivePriceLabel.length)}cqi, 2.75rem)`,
                }}
              >
                {effectivePriceLabel}
              </span>
              <span className="min-w-0 max-w-full break-keep text-lg font-bold [overflow-wrap:anywhere]">
                {itemCurrencyUnit}
              </span>
            </div>

            <div style={{ fontSize: "clamp(0.75rem, 3cqi, 1rem)" }} className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-semibold ${isVipLounge ? "text-slate-300" : "text-slate-500"}`}>
              <span className="inline-flex items-center gap-1.5">
                <Box size={15} className="shrink-0" />
                {item.stock === null || item.stock === -1 || Number(item.stock) <= 0
                  ? stockInfo.label
                  : `재고 ${stockInfo.label}`}
              </span>
              {validityLabel ? (
                <span className={`inline-flex items-center gap-1.5 border-l pl-3 ${isVipLounge ? "border-white/15" : "border-slate-200"}`} title={`구매 후 ${validityLabel}`}>
                  <Clock3 size={15} className="shrink-0" />
                  사용기한 {validityLabel}
                </span>
              ) : null}
              <span className={`inline-flex items-center gap-1.5 border-l pl-3 ${isVipLounge ? "border-white/15" : "border-slate-200"}`}>
                <Gift size={15} className="shrink-0" />
                {isGiftDisabled ? "선물 불가" : "선물 가능"}
              </span>
              {isTimeSaleActive ? (
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-black ${
                    isVipLounge
                      ? "border border-amber-500/25 bg-amber-500/10 text-amber-300"
                      : "bg-rose-600 text-white"
                  }`}
                >
                  {item.timeSaleDiscountPercent || 0}% 할인
                </span>
              ) : null}
              {hasSnapshotPriceChange ? (
                <span className={`text-[11px] font-black ${isPriceUp ? "text-rose-600" : "text-emerald-600"}`}>
                  {priceChangeArrow} {Math.abs(snapshotPriceChangePercent).toFixed(1)}%
                </span>
              ) : null}
            </div>
          </div>
        </div>

      </div>

      <div className="mt-auto">
        <div data-tour="store-item-purchase-actions" className="flex gap-2">
          <Button
            onClick={() => onAddToCart(item)}
            tone={isVipLounge ? "slate" : "blue"}
            kind="outline"
            size="md"
            icon={ShoppingBag}
            className={`min-w-0 flex-1 whitespace-nowrap rounded-xl px-3 py-2.5 text-base font-bold ${
              isVipLounge
                ? !canPurchase
                  ? "border-white/10 bg-white/[0.03] text-slate-500"
                  : "border-white/15 bg-white/[0.05] text-slate-200 hover:border-amber-200/30 hover:bg-white/10"
                : !canPurchase
                  ? "border-slate-200 bg-slate-100 text-slate-400"
                  : "border-blue-200 text-blue-700"
            }`}
            disabled={!canPurchase}
          >
            담기
          </Button>
          <Button
            onClick={() => onBuyItem(item)}
            tone={
              isVipLounge
                ? "amber"
                : "blue"
            }
            kind="solid"
            size="md"
            icon={ShoppingCart}
            className={`min-w-0 flex-1 whitespace-nowrap rounded-xl px-3 py-2.5 text-base font-black ${
              isVipLounge
                ? !canPurchase
                  ? "bg-white/[0.08] text-slate-500"
                  : "bg-gradient-to-r from-amber-400 via-amber-200 to-amber-300 text-slate-950 shadow-lg shadow-amber-500/10 hover:brightness-110"
                : !canPurchase
                  ? "bg-slate-200 text-slate-400"
                  : ""
            }`}
            disabled={!canPurchase}
          >
            {saleStatusMeta.code === STORE_ITEM_SALE_STATUS.DISPLAY_ONLY
              ? "준비중"
              : saleStatusMeta.code === STORE_ITEM_SALE_STATUS.HIDDEN
                ? "숨김"
                : isSoldOut
                  ? "품절"
                  : purchaseDisabled
                    ? "POS 전용"
                    : "구매"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default StoreItemCard;
