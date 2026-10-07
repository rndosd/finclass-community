import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Eye,
  Gavel,
  Timer,
} from "lucide-react";
import { Badge, Button, Card } from "../../../../components/ui";
import { formatDateInKST } from "../../../../utils/kstDate";
import TradePartySummary from "../../components/TradePartySummary";
import { getAuctionPresentation } from "../utils/auctionPresentation";
import { getAuctionEndAtMs } from "../utils/auctionTiming";
import { getProductTypeAsset } from "../../../../assets/illustrations/productTypes";

function pad2(n) {
  return String(Math.max(0, Number(n || 0))).padStart(2, "0");
}

function toRemainingClock(ms) {
  if (ms <= 0) {
    return {
      text: "00:00:00",
      isExpired: true,
      isUrgent: false,
    };
  }

  const totalSec = Math.floor(ms / 1000);
  const day = Math.floor(totalSec / 86400);
  const hour = Math.floor((totalSec % 86400) / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const clock = `${pad2(hour)}:${pad2(min)}:${pad2(sec)}`;

  return {
    text: day > 0 ? `${day}일 ${clock}` : clock,
    isExpired: false,
    isUrgent: totalSec <= 10 * 60,
  };
}

function formatDateTimeLabel(value) {
  if (!value) return "";
  return formatDateInKST(value, "ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const fallbackName = (value, emptyLabel) => {
  const normalized = String(value || "").trim();
  return normalized || emptyLabel;
};

export default function AuctionItemCard({
  item,
  currencyName,
  formatNumber,
  onBid,
  onViewDetails,
  onCloseAuction,
  canCloseAuction,
  isForceSettle = false,
  isClosing,
  isMarketplaceAdmin,
  isProcessingApproval,
  onApprove,
  onReject,
  currentUserUid,
  variant = "default",
  auctionNumber,
  antiSnipingSeconds = 30,
}) {
  const endAtMs = useMemo(() => getAuctionEndAtMs(item), [item]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const presentation = getAuctionPresentation(item, now);
  const remainingMs = endAtMs - now;
  const status = String(item?.status || "");
  const isPending =
    status === "pending" || (item?.approved === false && status !== "rejected");
  const isRejected = status === "rejected";
  const isEndedStatus = status === "ended";
  const isSealed = item?.auctionType === "sealed";
  const hideActivePrice = isSealed && !isEndedStatus;
  const isTimedOut = presentation.timedOut;
  const isOwner = !!currentUserUid && currentUserUid === item?.sellerUid;
  const isWinner = !!currentUserUid && currentUserUid === item?.winnerUid;
  const isMyHighestBid = !isSealed && status === "active" && !!currentUserUid &&
    currentUserUid === item?.highestBidUid;

  const startPrice = Number(item?.startPrice || 0);
  const bidStep = Number(item?.bidStep || 1);
  const currentPrice = Number(item?.currentPrice || 0);
  const displayPrice = currentPrice > 0 ? currentPrice : startPrice;
  const minNextBid = currentPrice > 0 ? currentPrice + bidStep : startPrice;
  const remaining = toRemainingClock(remainingMs);
  const isFeatured = variant === "featured";
  const isCompact = variant === "compact";
  const isListCard = isCompact || variant === "default";
  const auctionLabel = auctionNumber ? `\uACBD\uB9E4 ${auctionNumber}\uBC88` : "\uACBD\uB9E4";
  const itemAsset = getProductTypeAsset({ ...item, assetContext: "marketplace" });
  const sellerName = fallbackName(item?.sellerName, "판매자 정보 없음");
  const winnerName = fallbackName(
    item?.winnerName || item?.highestBidName,
    "낙찰자 정보 없음",
  );

  const showBiddingActions = status === "active" && !isPending && !isRejected;
  const showCountdown = status === "active" && !isPending && !isRejected;
  const bidderSummary = showBiddingActions && !isSealed ? (
    isMyHighestBid ? (
      <p className="mt-2 flex items-center gap-1.5 text-sm font-bold text-emerald-700">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        내가 최고 입찰자
      </p>
    ) : (
      <p className="mt-2 break-words text-xs text-slate-500">
        {item?.highestBidUid ? `현재 최고 입찰자 ${item.highestBidName || "이름 없음"}` : "아직 입찰이 없습니다."}
      </p>
    )
  ) : null;
  const countdownToneClass = remaining.isExpired
    ? "border-amber-200 bg-amber-50 text-amber-800"
    : remaining.isUrgent
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-blue-200 bg-blue-50 text-blue-800";
  const countdownTargetLabel = endAtMs > 0 ? formatDateTimeLabel(new Date(endAtMs)) : "";
  const antiSnipingRuleSeconds = isSealed
    ? 0
    : Math.max(0, Number(antiSnipingSeconds || 0));

  if (isFeatured && showBiddingActions) {
    return (
      <Card noPadding className="overflow-hidden border-slate-200 bg-white shadow-sm">
        <Card.Content noPadding className="p-5">
          <div className="grid min-h-[430px] gap-6 lg:grid-cols-[minmax(280px,0.95fr)_minmax(0,0.85fr)]">
            <div className="relative flex min-h-[360px] items-center justify-center overflow-hidden rounded-2xl bg-slate-50">
              <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
                <Badge tone={presentation.tone} variant="soft" size="sm" className="font-bold">
                  {presentation.label}
                </Badge>
                {!isTimedOut && remaining.isUrgent ? (
                  <Badge tone="rose" variant="soft" size="sm" className="font-black">
                    마감 임박
                  </Badge>
                ) : null}
              </div>
              <img
                src={itemAsset}
                alt=""
                aria-hidden="true"
                className="h-[72%] w-[72%] object-contain drop-shadow-xl"
              />
            </div>

            <div className="flex min-w-0 flex-col py-1">
              <p className="text-sm font-bold text-indigo-600">{auctionLabel}</p>
              <h3 className="mt-3 break-words text-3xl font-black leading-tight text-slate-900">
                {item?.title || "제목 없음"}
              </h3>
              <p className="mt-4 text-sm font-semibold text-slate-500">
                판매자 {sellerName}
              </p>
              {bidderSummary}

              <div className="mt-5 border-t border-slate-200 pt-5">
                <p className="text-sm font-bold text-slate-500">
                  {presentation.priceLabel}
                </p>
                {hideActivePrice ? (
                  <p className="mt-2 text-4xl font-black tracking-tight text-indigo-700">입찰 금액 비공개</p>
                ) : (
                  <p className="mt-2 text-5xl font-black tracking-tight text-slate-950">
                    {formatNumber(displayPrice)}
                    <span className="ml-2 text-xl font-extrabold text-slate-700">
                      {currencyName}
                    </span>
                  </p>
                )}
                <p className="mt-2 text-base font-semibold text-slate-500">
                  {isSealed ? "최소 입찰" : "시작가"} {formatNumber(startPrice)} {currencyName}
                </p>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-200 pt-4 text-sm">
                <div>
                  <p className="font-semibold text-slate-500">{isSealed ? "입찰 방식" : "현재 입찰"}</p>
                  <p className="mt-1 font-black text-indigo-600">
                    {isSealed ? "1인 1회" : item?.highestBidName || "없음"}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-500">{isTimedOut ? "입찰 상태" : isSealed ? "최소 입찰" : "다음 입찰가"}</p>
                  <p className="mt-1 font-black text-indigo-600">
                    {isTimedOut ? "입찰 종료" : `${formatNumber(isSealed ? startPrice : minNextBid)} ${currencyName}`}
                  </p>
                </div>
              </div>

              <div className={"mt-5 rounded-xl border px-4 py-3 " + (
                remaining.isExpired || remaining.isUrgent
                  ? "border-rose-200 bg-rose-50 text-rose-600"
                  : "border-orange-200 bg-orange-50 text-orange-600"
              )}>
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-sm font-black">
                    <Timer className="h-5 w-5" />
                    {isTimedOut ? "입찰 상태" : "남은 시간"}
                  </span>
                  <span className="font-sans text-3xl font-black tracking-tight tabular-nums">
                    {isTimedOut ? "마감됨" : remaining.text}
                  </span>
                </div>
                {!isTimedOut && antiSnipingRuleSeconds > 0 ? (
                  <p className="mt-2 text-xs font-bold opacity-80">
                    종료 {antiSnipingRuleSeconds}초 이내 입찰 시 남은 시간을 {antiSnipingRuleSeconds}초로 재설정
                  </p>
                ) : null}
              </div>

              <div className={"mt-auto grid gap-2 pt-4 " + (
                canCloseAuction ? "grid-cols-[0.75fr_1.25fr_0.9fr]" : "grid-cols-[0.75fr_1.25fr]"
              )}>
                <Button
                  kind="outline"
                  tone="slate"
                  className="w-full whitespace-nowrap"
                  icon={Eye}
                  onClick={() => onViewDetails?.(item)}
                >
                  상세
                </Button>
                <Button
                  kind="solid"
                  tone="blue"
                  className="w-full whitespace-nowrap"
                  icon={ArrowUpRight}
                  disabled={isTimedOut || isMyHighestBid}
                  onClick={() => onBid?.(item)}
                >
                  {isTimedOut ? "마감됨" : isMyHighestBid ? "최고 입찰 중" : "입찰하기"}
                </Button>
                {canCloseAuction ? (
                  <Button
                    kind="outline"
                    tone="slate"
                    className="w-full whitespace-nowrap"
                    icon={CheckCircle2}
                    disabled={isClosing}
                    isLoading={isClosing}
                    onClick={() => onCloseAuction?.(item)}
                  >
                    {isForceSettle ? "강제 정산" : "마감 정산"}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </Card.Content>
      </Card>
    );
  }

  if (isListCard) {
    const listActions = showBiddingActions ? (
      <div className={`grid gap-2 border-t border-slate-200 pt-4 ${canCloseAuction ? "grid-cols-3" : "grid-cols-2"}`}>
        <Button size="xs" kind="outline" tone="slate" className="w-full whitespace-nowrap" icon={Eye} onClick={() => onViewDetails?.(item)}>
          상세
        </Button>
        <Button size="xs" kind="solid" tone="blue" className="w-full whitespace-nowrap" icon={ArrowUpRight} disabled={isTimedOut || isMyHighestBid} onClick={() => onBid?.(item)}>
          {isTimedOut ? "마감됨" : isMyHighestBid ? "최고 입찰 중" : "입찰하기"}
        </Button>
        {canCloseAuction ? (
          <Button size="xs" kind="outline" tone="slate" className="w-full whitespace-nowrap" icon={CheckCircle2} disabled={isClosing} isLoading={isClosing} onClick={() => onCloseAuction?.(item)}>
            {isForceSettle ? "강제 정산" : "마감 정산"}
          </Button>
        ) : null}
      </div>
    ) : isMarketplaceAdmin && isPending ? (
      <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-4">
        <Button size="xs" kind="soft" tone="emerald" className="w-full whitespace-nowrap" icon={CheckCircle2} disabled={isProcessingApproval} isLoading={isProcessingApproval} onClick={() => onApprove?.(item)}>
          승인
        </Button>
        <Button size="xs" kind="soft" tone="rose" className="w-full whitespace-nowrap" icon={Ban} disabled={isProcessingApproval} onClick={() => onReject?.(item)}>
          반려
        </Button>
      </div>
    ) : isMarketplaceAdmin && isRejected ? (
      <Button kind="soft" tone="emerald" className="w-full whitespace-nowrap text-xs border-t border-slate-200 pt-4" icon={CheckCircle2} disabled={isProcessingApproval} isLoading={isProcessingApproval} onClick={() => onApprove?.(item)}>
        다시 승인
      </Button>
    ) : (
      <Button kind="outline" tone="slate" className="w-full whitespace-nowrap text-xs border-t border-slate-200 pt-4" icon={Eye} onClick={() => onViewDetails?.(item)}>
        상세
      </Button>
    );

    return (
      <Card noPadding className="h-full overflow-hidden border-slate-200 bg-white shadow-sm">
        <Card.Content noPadding className="flex h-full flex-col p-5">
          <div className="flex items-center justify-between gap-3">
            {status === "active" ? (
              <Badge tone={presentation.tone} variant="soft" size="sm" className="font-bold">{presentation.label}</Badge>
            ) : (
              <Badge tone={isPending ? "amber" : isRejected ? "rose" : "slate"} variant="soft" size="sm" className="font-black">
                {presentation.label}
              </Badge>
            )}
            <span className="text-sm font-bold text-indigo-600">{auctionLabel}</span>
          </div>

          <div className="mt-4 grid flex-1 grid-cols-[112px_minmax(0,1fr)] gap-4">
            <div className="flex min-h-32 items-center justify-center rounded-xl bg-slate-50 p-3">
              <img src={itemAsset} alt="" aria-hidden="true" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <h3 className="line-clamp-2 break-words text-xl font-black leading-tight text-slate-900">
                {item?.title || "제목 없음"}
              </h3>
              <p className="mt-2 truncate text-sm font-semibold text-slate-500">판매자 {sellerName}</p>
              {bidderSummary}
              <div className="mt-4 border-t border-slate-200 pt-3">
                <p className="text-xs font-bold text-slate-500">{presentation.priceLabel}</p>
                {hideActivePrice ? (
                  <p className="mt-1 text-lg font-black text-indigo-700">입찰 금액 비공개</p>
                ) : (
                  <p className="mt-1 text-2xl font-black text-slate-950">
                    {formatNumber(presentation.price)}
                    <span className="ml-1 text-sm font-bold">{currencyName}</span>
                  </p>
                )}
              </div>
              {isEndedStatus && !presentation.hasWinner ? <p className="mt-2 text-sm text-slate-500">낙찰 없음</p> : null}
              {showCountdown ? (
                <div className="mt-3">
                  <p className="font-sans text-lg font-black tabular-nums text-orange-600">{isTimedOut ? "마감됨" : remaining.text}</p>
                  {!isTimedOut && antiSnipingRuleSeconds > 0 ? (
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">
                      마감 자동 연장 {antiSnipingRuleSeconds}초
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {listActions}
        </Card.Content>
      </Card>
    );
  }  return (
    <Card noPadding className={`h-full overflow-hidden ${isFeatured ? "border-amber-200 bg-gradient-to-br from-white via-amber-50/30 to-orange-50 shadow-xl shadow-amber-100/50 ring-1 ring-amber-100" : "border-slate-200 shadow-sm"}`}>
      <Card.Content className={isFeatured ? "flex h-full flex-col space-y-5 p-6" : isCompact ? "space-y-3 p-4" : "space-y-4 p-5"}>

        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <div className="shrink-0 rounded-xl bg-indigo-50 p-2 text-indigo-600">
              <Gavel size={18} />
            </div>
            <div className="min-w-0">
              <p className="line-clamp-2 break-words font-extrabold leading-snug text-slate-800">
                {item?.title || "제목 없음"}
              </p>
              <p className="truncate text-xs text-slate-500">
                판매자 {sellerName}
              </p>
            </div>
          </div>

          {isPending ? (
            <Badge tone="amber" variant="soft" size="sm" className="shrink-0 gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              승인 대기
            </Badge>
          ) : isRejected ? (
            <Badge tone="rose" variant="soft" size="sm" className="shrink-0 gap-1.5">
              <Ban className="h-3.5 w-3.5" />
              반려됨
            </Badge>
          ) : isEndedStatus ? (
            <Badge tone="slate" variant="soft" size="sm" className="shrink-0 gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {presentation.label}
            </Badge>
          ) : (
            <Badge tone={isFeatured ? (remaining.isUrgent ? "rose" : "amber") : "blue"} variant="soft" size="sm" className="shrink-0 gap-2">
              <Timer className="h-3.5 w-3.5" />
              <span>{presentation.label}</span>
            </Badge>
          )}
        </div>

        {!isFeatured && !isCompact ? (
          <div className="flex h-28 items-center justify-center rounded-2xl bg-slate-50 p-3">
            <img src={itemAsset} alt="" aria-hidden="true" className="h-full w-full object-contain" />
          </div>
        ) : null}

        {!isCompact ? (
        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
          <p className="mb-1 text-[11px] font-black tracking-[0.14em] text-slate-400">
            설명
          </p>
          <p className="line-clamp-2 min-h-[2.5rem] break-words text-sm leading-5 text-slate-600">
            {item?.description || "등록된 설명이 없습니다."}
          </p>
        </div>
        ) : null}

        <div className={`space-y-3 rounded-2xl bg-slate-50/80 ring-1 ring-slate-200 ${isFeatured ? "p-6" : isCompact ? "p-4" : "p-5"}`}>
          <div className="text-xs font-bold tracking-wider text-slate-500">
            {presentation.priceLabel}
          </div>
          {hideActivePrice ? (
            <div className={`${isFeatured ? "text-4xl" : isCompact ? "text-2xl" : "text-3xl"} font-black leading-none text-indigo-700`}>
              입찰 금액 비공개
            </div>
          ) : (
            <div className={`${isFeatured ? "text-4xl" : isCompact ? "text-2xl" : "text-3xl"} font-black leading-none text-slate-900`}>
              {formatNumber(presentation.price)}{" "}
              <span className="text-xl font-extrabold">{currencyName}</span>
            </div>
          )}

          {!isCompact && !isEndedStatus && !isPending && !isRejected ? (
            <div className="flex items-center justify-between pt-1 text-sm text-slate-600">
                <span>{isSealed ? "최소 입찰 금액" : "다음 입찰 최소 금액"}</span>
                <span className="font-bold">
                {formatNumber(isSealed ? startPrice : minNextBid)} {currencyName}
              </span>
            </div>
          ) : null}

          {isEndedStatus ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TradePartySummary
                title="판매자"
                name={sellerName}
                tone="seller"
                isCurrentUser={isOwner}
              />
              <TradePartySummary
                title="낙찰자"
                name={winnerName}
                tone="buyer"
                isCurrentUser={isWinner}
              />
            </div>
          ) : isSealed ? (
            <div className="text-xs text-slate-500">다른 참가자의 입찰 금액과 결과는 마감 후 공개됩니다.</div>
          ) : item?.highestBidName ? (
            <div className="text-xs text-slate-500">
              현재 최고 입찰자 <span className="font-semibold">{item.highestBidName}</span>
            </div>
          ) : (
            <div className="text-xs text-slate-500">아직 등록된 입찰이 없습니다.</div>
          )}

          {showCountdown ? (
            <div className={`rounded-2xl border px-4 py-3 ${countdownToneClass}`}>
              <div className="text-[11px] font-black tracking-[0.18em] opacity-70">
                남은 시간
              </div>
              <div className="mt-1 flex items-end justify-between gap-3">
                <span className="font-sans text-2xl font-black tracking-tight tabular-nums">
                  {isTimedOut ? "마감됨" : remaining.text}
                </span>
                {countdownTargetLabel ? (
                  <span className="text-xs font-semibold opacity-80">{countdownTargetLabel}</span>
                ) : null}
              </div>
              {!isTimedOut && antiSnipingRuleSeconds > 0 ? (
                <p className="mt-2 text-[11px] font-bold opacity-80">
                  종료 {antiSnipingRuleSeconds}초 이내 입찰 시 {antiSnipingRuleSeconds}초로 재설정
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {isRejected && item?.rejectedReason ? (
          <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-rose-200">
            승인 안 된 이유: <span className="font-semibold">{item.rejectedReason}</span>
          </div>
        ) : null}

        {showBiddingActions ? (
          <div
            className={
              canCloseAuction
                ? "grid grid-cols-1 gap-2 sm:grid-cols-3"
                : "grid grid-cols-1 gap-2 sm:grid-cols-2"
            }
          >
            <Button
              kind="outline"
              tone="slate"
              className="w-full whitespace-nowrap"
              icon={Eye}
              onClick={() => onViewDetails?.(item)}
            >
              상세
            </Button>
            <Button
              kind="solid"
              tone="blue"
              className="w-full whitespace-nowrap"
              icon={ArrowUpRight}
              disabled={isTimedOut || isMyHighestBid}
              onClick={() => onBid?.(item)}
            >
              {isTimedOut ? "마감됨" : isMyHighestBid ? "최고 입찰 중" : "입찰하기"}
            </Button>

            {canCloseAuction ? (
              <Button
                kind="outline"
                tone="slate"
                className="w-full whitespace-nowrap"
                icon={CheckCircle2}
                disabled={isClosing}
                isLoading={isClosing}
                onClick={() => onCloseAuction?.(item)}
              >
                {isForceSettle ? "강제 정산" : "마감 정산"}
              </Button>
            ) : null}
          </div>
        ) : (
          <Button
            kind="outline"
            tone="slate"
            className="w-full whitespace-nowrap"
            icon={Eye}
            onClick={() => onViewDetails?.(item)}
          >
            상세
          </Button>
        )}

        {isMarketplaceAdmin && isPending ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              kind="soft"
              tone="emerald"
              icon={CheckCircle2}
              disabled={isProcessingApproval}
              isLoading={isProcessingApproval}
              onClick={() => onApprove?.(item)}
            >
              승인
            </Button>
            <Button
              kind="soft"
              tone="rose"
              icon={Ban}
              disabled={isProcessingApproval}
              onClick={() => onReject?.(item)}
            >
              반려
            </Button>
          </div>
        ) : null}

        {isMarketplaceAdmin && isRejected ? (
          <Button
            kind="soft"
            tone="emerald"
            icon={CheckCircle2}
            className="w-full whitespace-nowrap"
            disabled={isProcessingApproval}
            isLoading={isProcessingApproval}
            onClick={() => onApprove?.(item)}
          >
            다시 승인
          </Button>
        ) : null}

        {isPending && !isMarketplaceAdmin && isOwner ? (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">
            출품이 아직 승인 대기 중입니다. 승인 후 경매 시간이 시작됩니다.
          </div>
        ) : null}
      </Card.Content>
    </Card>
  );
}
