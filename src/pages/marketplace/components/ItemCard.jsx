import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React from "react";
import {
  Ban,
  CheckCircle,
  Edit,
  Eye,
  Package,
  ShoppingCart,
  Trash2,
  User,
} from "lucide-react";

import { Badge, Button } from "../../../components/ui";
import { getProductTypeAsset } from "../../../assets/illustrations/productTypes";
import TradePartySummary from "./TradePartySummary";

const getCardToneClass = ({ isPending, isRejected, isSold }) => {
  if (isPending) {
    return "bg-white ring-2 ring-amber-200 shadow-xl shadow-amber-100/30";
  }

  if (isRejected) {
    return "bg-white ring-2 ring-rose-200 shadow-xl shadow-rose-100/30";
  }

  if (isSold) {
    return "bg-white ring-1 ring-slate-200 shadow-lg shadow-slate-200/20";
  }

  return "bg-white ring-1 ring-slate-100 shadow-xl shadow-slate-200/20 hover:-translate-y-1 hover:shadow-2xl hover:shadow-slate-200/40";
};

const getStatusMeta = ({ isPending, isRejected, isSold }) => {
  if (isPending) {
    return {
      label: "승인 대기",
      tone: "amber",
      chipClass: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
      priceClass: "border-amber-200 bg-amber-50/40",
    };
  }

  if (isRejected) {
    return {
      label: "반려됨",
      tone: "rose",
      chipClass: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
      priceClass: "border-rose-200 bg-rose-50/40",
    };
  }

  if (isSold) {
    return {
      label: "판매 완료",
      tone: "slate",
      chipClass: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
      priceClass: "border-slate-200 bg-slate-50",
    };
  }

  return {
    label: "판매중",
    tone: "emerald",
    chipClass: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
    priceClass: "border-slate-100 bg-slate-50",
  };
};

const fallbackName = (value, emptyLabel) => {
  const normalized = String(value || "").trim();
  return normalized || emptyLabel;
};

const ItemCard = ({
  item,
  currentUser,
  userBalance,
  isMarketplaceAdmin,
  currencyName,
  formatNumber,
  formatWholeNumber,
  onViewDetails,
  onApprove,
  onReject,
  onDelete,
  onEdit,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const isOwner = currentUser?.uid === item.sellerId;
  const isBuyer = currentUser?.uid === item.buyerId;
  const isSold = item.status === "sold";
  const isRejected = item.status === "rejected";
  const isPending = item.status === "pending" || (!item.approved && !isRejected);

  const balance = Number(userBalance || 0);
  const price = Math.max(0, Math.trunc(Number(item.price || 0)));
  const rawStock = Number(item.stock === undefined || item.stock === null ? 1 : item.stock);
  const stock = Number.isFinite(rawStock) ? Math.max(0, Math.trunc(rawStock)) : 0;
  const hasStockAvailable = stock > 0;
  const canAfford = balance >= price;
  const canPurchase =
    !isOwner &&
    !isSold &&
    item.approved &&
    !isRejected &&
    !isPending &&
    hasStockAvailable;
  const canDelete = (isOwner && !isSold) || isMarketplaceAdmin;
  const canModerate = isMarketplaceAdmin && (isPending || isRejected);

  const statusMeta = getStatusMeta({ isPending, isRejected, isSold });
  const cardToneClass = getCardToneClass({ isPending, isRejected, isSold });
  const formattedPrice = formatWholeNumber
    ? formatWholeNumber(price)
    : formatDisplayMoney(price);
  const sellerName = fallbackName(item.sellerName, "이름 없음");
  const buyerName = fallbackName(item.buyerName, "구매자 미기록");
  const itemAsset = getProductTypeAsset({ ...item, assetContext: "marketplace" });

  let actionLabel = "구매";
  if (!canPurchase) {
    if (isOwner) {
      actionLabel = "내 상품";
    } else if (isSold) {
      actionLabel = "판매완료";
    } else if (isPending) {
      actionLabel = "승인 대기";
    } else if (isRejected) {
      actionLabel = "반려됨";
    } else {
      actionLabel = "구매 불가";
    }
  } else if (!canAfford) {
    actionLabel = "잔액 부족";
  }

  if (!hasStockAvailable && !isOwner && !isSold && !isPending && !isRejected) {
    actionLabel = "품절";
  }

  return (
    <div
      className={`group relative flex h-full flex-col justify-between overflow-hidden rounded-[1.6rem] p-4 transition-all duration-300 ${cardToneClass}`}
    >
      {canDelete ? (
        <div className="absolute right-4 top-4 z-20 flex gap-1.5 opacity-100 transition-opacity duration-200 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {isMarketplaceAdmin && !isSold ? (
            <Button tone="slate" kind="outline" size="icon-md"
              type="button"
              onClick={() => onEdit(item)}
              className="transition-all"
              aria-label="상품 수정"
            >
              <Edit size={16} />
            </Button>
          ) : null}
          <Button tone="slate" kind="outline" size="icon-md"
            type="button"
            onClick={() => onDelete(item)}
            className="transition-all"
            aria-label="상품 삭제"
          >
            <Trash2 size={16} />
          </Button>
        </div>
      ) : null}

      <div>
        <div className={`mb-3 flex h-7 items-center overflow-hidden ${canDelete ? "pr-16" : ""}`}>
          <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden whitespace-nowrap">
            <Badge tone={statusMeta.tone} variant="soft" size="sm" className="font-bold">
              {statusMeta.label}
            </Badge>

            {isOwner ? (
              <Badge tone="blue" variant="soft" size="sm" className="gap-1 font-bold">
                <User size={10} />
                내 상품
              </Badge>
            ) : null}

            {isBuyer ? (
              <Badge tone="emerald" variant="soft" size="sm" className="gap-1 font-bold">
                <User size={10} />
                내가 구매
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="relative mb-3 pl-[3.75rem]">
          <img
            src={itemAsset}
            alt=""
            className={`absolute -left-1 top-0 h-14 w-14 object-contain ${
              isSold ? "opacity-50 grayscale" : ""
            }`}
            aria-hidden="true"
          />
          <div className="mb-1 overflow-hidden">
            <h3
              className={`line-clamp-2 break-words text-lg font-black leading-tight tracking-tight ${
                isSold ? "text-slate-500" : "text-slate-800"
              }`}
            >
              {item.title}
            </h3>
          </div>
          <div className="overflow-hidden">
            <p className="line-clamp-2 break-words text-xs leading-[1.15rem] text-slate-500">
              {item.description || "설명이 아직 등록되지 않았습니다."}
            </p>
          </div>
        </div>
        <div className={`mb-3 rounded-2xl border px-3.5 py-3 ${statusMeta.priceClass}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div
                className={`text-xl font-black ${
                  isSold ? "text-slate-700" : "text-slate-900"
                }`}
              >
                {formattedPrice} {currencyName}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                판매자 {sellerName}
              </div>
            </div>

            <div className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-slate-500">
              <Package size={13} />
              재고 {isSold ? 0 : stock}개
            </div>
          </div>
        </div>

        {isSold ? (
          <div className="mb-6 rounded-[1.6rem] border border-slate-200 bg-slate-50/90 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                거래 완료
              </p>
              <Badge tone="emerald" variant="soft" size="sm" className="font-bold">
                판매완료
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TradePartySummary
                title="판매자"
                name={sellerName}
                tone="seller"
                isCurrentUser={isOwner}
              />
              <TradePartySummary
                title="구매자"
                name={buyerName}
                tone="buyer"
                isCurrentUser={isBuyer}
              />
            </div>
          </div>
        ) : null}

        {isRejected && isOwner && item.rejectedReason ? (
          <div className="mb-6 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-700">
            <span className="font-bold">승인 안 된 이유:</span> {item.rejectedReason}
          </div>
        ) : null}
      </div>

      <div className="mt-auto">
        {canModerate ? (
          <div className="grid grid-cols-2 gap-2">
            {isPending ? (
              <>
                <Button
                  onClick={onApprove}
                  tone="emerald"
                  kind="soft"
                  size="md"
                  icon={CheckCircle}
                  className="w-full"
                >
                  승인
                </Button>
                <Button
                  onClick={onReject}
                  tone="red"
                  kind="soft"
                  size="md"
                  icon={Ban}
                  className="w-full"
                >
                  반려
                </Button>
              </>
            ) : (
              <Button
                onClick={onApprove}
                tone="emerald"
                kind="soft"
                size="md"
                icon={CheckCircle}
                className="col-span-2 w-full"
              >
                재승인
              </Button>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              onClick={() => onViewDetails(item)}
              tone="slate"
              kind="outline"
              size="md"
              icon={Eye}
              className="shrink-0"
            >
              상세
            </Button>
            <Button
              onClick={() => onViewDetails(item)}
              tone="blue"
              kind="solid"
              size="md"
              icon={ShoppingCart}
              className={`min-w-0 flex-1  ${
                canPurchase && canAfford
                  ? ""
                  : ""
              }`}
              disabled={!canPurchase || !canAfford}
            >
              {actionLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ItemCard;
