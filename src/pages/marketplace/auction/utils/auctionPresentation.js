import { getAuctionEndAtMs } from "./auctionTiming";

export function getAuctionPresentation(item, now = Date.now()) {
  const status = String(item?.status || "active");
  const endAtMs = getAuctionEndAtMs(item);
  const pending = status === "pending" || (item?.approved === false && status !== "rejected");
  const ended = status === "ended";
  const hasWinner = ended && (!!item?.winnerUid || Number(item?.finalPrice || 0) > 0);
  const timedOut = status === "active" && !pending && endAtMs > 0 && endAtMs <= now;
  const label = pending ? "승인 대기" : status === "rejected" ? "반려됨"
    : ended ? (hasWinner ? "낙찰 · 정산 완료" : "미낙찰")
      : timedOut ? "마감 · 정산 대기" : "진행 중";
  return {
    label,
    tone: pending || timedOut ? "amber" : status === "rejected" ? "rose" : ended ? "slate" : "blue",
    timedOut,
    hasWinner,
    priceLabel: ended ? (hasWinner ? "최종 낙찰가" : "시작가")
      : item?.auctionType === "sealed" ? "블라인드 경매"
        : Number(item?.currentPrice || 0) > 0 ? "현재 최고가" : "시작가",
    price: ended ? (hasWinner ? Number(item?.finalPrice || 0) : Number(item?.startPrice || 0))
      : Number(item?.currentPrice || 0) || Number(item?.startPrice || 0),
  };
}
