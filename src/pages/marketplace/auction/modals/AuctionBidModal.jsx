import React, { useEffect, useMemo, useState } from "react";
import { X, ArrowUpRight } from "lucide-react";
import { Button, Card, Badge } from "../../../../components/ui";

export default function AuctionBidModal({
  isOpen,
  onClose,
  item,
  currencyName,
  formatNumber,
  userBalance,
  userAuctionHold,
  myPrevHold,
  onSubmitBid,
  isSubmitting,
}) {
  const isSealed = item?.auctionType === "sealed";
  const currentPrice = Number(item?.currentPrice || 0);
  const startPrice = Number(item?.startPrice || 0);
  const bidStep = Number(item?.bidStep || 1);
  const minBid = isSealed
    ? startPrice
    : currentPrice > 0 ? currentPrice + bidStep : startPrice;
  const antiSnipingSeconds = Math.max(0, Number(item?.antiSnipingSeconds || 0));

  const [amount, setAmount] = useState(minBid);
  useEffect(() => {
    setAmount(minBid);
  }, [minBid, item?.id]);

  const prevHold = Number(myPrevHold || 0);
  const nextAmount = Number(amount || 0);
  const additionalHold = Math.max(0, nextAmount - prevHold);
  const available = Math.max(0, Number(userBalance || 0) - Number(userAuctionHold || 0));

  const isValid = useMemo(() => {
    if (!Number.isFinite(nextAmount)) return false;
    if (nextAmount < minBid) return false;
    if (nextAmount <= 0) return false;
    if (additionalHold > available) return false;
    return true;
  }, [nextAmount, minBid, additionalHold, available]);

  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/45">
      <Card noPadding className="w-full max-w-lg border-0 shadow-2xl">
        <Card.Content noPadding className="p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xl font-extrabold text-slate-900">입찰하기</p>
              <p className="text-sm text-slate-500 line-clamp-1">
                {isSealed ? "블라인드 경매 · " : ""}{item.title}
              </p>
            </div>
            <Button tone="slate" kind="ghost" size="icon-md"
              onClick={onClose}
              
              aria-label="close"
            >
              <X size={18} />
            </Button>
          </div>

          <div className="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-4 space-y-2">
            {isSealed ? (
              <div className="flex justify-between text-sm text-slate-600">
                <span>다른 입찰 금액</span>
                <span className="font-bold text-indigo-700">비공개</span>
              </div>
            ) : (
              <div className="flex justify-between text-sm text-slate-600">
                <span>현재가</span>
                <span className="font-bold">
                  {formatNumber(currentPrice > 0 ? currentPrice : startPrice)} {currencyName}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm text-slate-600">
              <span>최소 입찰</span>
              <span className="font-bold">
                {formatNumber(minBid)} {currencyName}
              </span>
            </div>
            {!isSealed ? <div className="flex justify-between text-sm text-slate-600">
              <span>입찰 단위</span>
              <span className="font-bold">
                {formatNumber(bidStep)} {currencyName}
              </span>
            </div> : null}
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-600">입찰 금액</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={minBid}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-blue-50/50"
              />
              <span className="text-slate-500">{currencyName}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {isSealed
                ? "제출한 금액은 마감까지 보류되며 입찰 후 변경하거나 취소할 수 없습니다."
                : "최고 입찰자일 때만 입찰금이 보류되며, 밀리면 자동 해제됩니다."}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="blue" variant="soft" size="sm">
              사용 가능 {formatNumber(available)} {currencyName}
            </Badge>
            <Badge tone="indigo" variant="soft" size="sm">
              추가 보류 {formatNumber(additionalHold)} {currencyName}
            </Badge>
            {prevHold > 0 && (
              <Badge tone="slate" variant="soft" size="sm">
                기존 보류 {formatNumber(prevHold)} {currencyName}
              </Badge>
            )}
          </div>

          {isSealed ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              블라인드 경매는 한 사람당 한 번만 입찰할 수 있습니다. 금액을 확인한 뒤 제출해 주세요.
            </div>
          ) : antiSnipingSeconds > 0 ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700">
              종료 {antiSnipingSeconds}초 이내 입찰이면 남은 시간이 다시 {antiSnipingSeconds}초가 됩니다.
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button kind="outline" tone="slate" onClick={onClose}>
              취소
            </Button>
            <Button
              kind="solid"
              tone="blue"
              icon={ArrowUpRight}
              disabled={!isValid || isSubmitting}
              isLoading={isSubmitting}
              onClick={() => onSubmitBid(nextAmount)}
            >
              {isSealed ? "블라인드 입찰 확정" : "입찰 확정"}
            </Button>
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}
