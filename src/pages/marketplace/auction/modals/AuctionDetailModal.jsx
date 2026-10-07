import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FileText,
  Gavel,
  User,
  XCircle,
} from "lucide-react";
import { Badge, Button, Modal } from "../../../../components/ui";
import { db } from "../../../../firebase";
import { formatDateInKST } from "../../../../utils/kstDate";
import { getAuctionPresentation } from "../utils/auctionPresentation";
import { getAuctionEndAtMs } from "../utils/auctionTiming";

const fallbackText = (value, emptyLabel) => {
  const normalized = String(value || "").trim();
  return normalized || emptyLabel;
};

function formatDateTime(value) {
  if (!value) return "";
  return formatDateInKST(value, "ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function AuctionDetailModal({
  isOpen,
  onClose,
  item,
  classId,
  canViewBidders = false,
  currencyName,
  formatNumber,
  currentUserUid,
  onBid,
}) {
  const endAtMs = useMemo(() => getAuctionEndAtMs(item), [item]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isOpen) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isOpen]);
  const [bidState, setBidState] = useState({
    queryKey: null,
    bids: [],
    loading: false,
    error: false,
  });

  useEffect(() => {
    if (
      !isOpen || !item?.id || !classId || !canViewBidders ||
      item.status === "pending" || item.status === "rejected"
    ) return;

    const itemId = item.id;
    const queryKey = `${classId}/${itemId}`;
    setBidState({ queryKey, bids: [], loading: true, error: false });
    return onSnapshot(
      collection(db, "classes", classId, "auction", itemId, "bids"),
      (snapshot) => {
        setBidState({
          queryKey,
          bids: snapshot.docs.map((doc) => doc.data()),
          loading: false,
          error: false,
        });
      },
      () => setBidState({ queryKey, bids: [], loading: false, error: true }),
    );
  }, [isOpen, item?.id, item?.status, classId, canViewBidders]);

  if (!isOpen || !item) return null;

  const status = String(item?.status || "active");
  const statusMeta = getAuctionPresentation(item, now);
  const isOwner = !!currentUserUid && currentUserUid === item?.sellerUid;
  const isActive = status === "active" && item.approved !== false;
  const isSealed = item?.auctionType === "sealed";
  const isMyHighestBid = isActive && !isSealed && !!currentUserUid &&
    currentUserUid === item?.highestBidUid;
  const hideActivePrice = isSealed && status !== "ended";
  const isTimedOut = statusMeta.timedOut;
  const canBid = isActive && !isOwner && !isTimedOut && !isMyHighestBid;
  const startPrice = Number(item?.startPrice || 0);
  const bidStep = Number(item?.bidStep || 1);
  const currentPrice = Number(item?.currentPrice || 0);
  const displayPrice = statusMeta.price;
  const minNextBid = currentPrice > 0 ? currentPrice + bidStep : startPrice;
  const sellerName = fallbackText(item?.sellerName, "판매자 정보 없음");
  const winnerName = fallbackText(
    item?.winnerName || item?.highestBidName,
    "낙찰자 없음",
  );
  const endAtLabel = endAtMs > 0 ? formatDateTime(new Date(endAtMs)) : "승인 후 시작";
  const antiSnipingSeconds = Math.max(0, Number(item?.antiSnipingSeconds || 0));
  const currentBidState = bidState.queryKey === `${classId}/${item.id}`
    ? bidState
    : { bids: [], loading: true, error: false };
  const biddersByUid = new Map();
  currentBidState.bids.forEach((bid) => {
    const previous = biddersByUid.get(bid.bidderUid);
    if (!previous || Number(bid.amount || 0) > Number(previous.amount || 0)) {
      biddersByUid.set(bid.bidderUid, bid);
    }
  });
  const bidders = [...biddersByUid.values()].sort((a, b) =>
    isSealed && isActive
      ? Number(a.sequence || 0) - Number(b.sequence || 0)
      : Number(b.amount || 0) - Number(a.amount || 0),
  );

  const renderAmount = (value) => `${formatNumber(value)} ${currencyName}`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" title="경매 상세">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusMeta.tone} variant="soft" size="sm" className="font-bold">
                {statusMeta.label}
              </Badge>
              {isOwner ? (
                <Badge tone="blue" variant="soft" size="sm" className="font-bold">
                  내 출품
                </Badge>
              ) : null}
              {isSealed ? (
                <Badge tone="indigo" variant="soft" size="sm" className="font-bold">
                  블라인드 · 1인 1회
                </Badge>
              ) : null}
            </div>
            <h2 className="break-words text-2xl font-black leading-tight text-slate-900">
              {fallbackText(item?.title, "제목 없음")}
            </h2>
            {isActive && !isSealed ? (
              <p className={`text-sm font-semibold ${isMyHighestBid ? "text-emerald-700" : "text-slate-600"}`}>
                {isMyHighestBid ? "내가 최고 입찰자" : item?.highestBidUid
                  ? `현재 최고 입찰자 ${fallbackText(item.highestBidName, "이름 없음")}`
                  : "아직 입찰이 없습니다."}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <User className="h-4 w-4" />
                판매자 {sellerName}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-4 w-4" />
                {endAtLabel}
              </span>
            </div>
          </div>

          <div className="shrink-0 rounded-2xl border border-indigo-100 bg-indigo-50 px-5 py-4 text-right">
            <p className="text-xs font-bold text-indigo-500">
              {statusMeta.priceLabel}
            </p>
            <p className="mt-1 text-2xl font-black text-indigo-700">
              {hideActivePrice ? "입찰 금액 비공개" : renderAmount(displayPrice)}
            </p>
            {status === "ended" && !statusMeta.hasWinner ? <p className="mt-2 text-sm text-slate-600">낙찰 없음</p> : null}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
            <FileText className="h-4 w-4 text-slate-400" />
            출품 설명
          </h3>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
            {fallbackText(item?.description, "등록된 설명이 없습니다.")}
          </p>
        </div>

        <div className={`grid grid-cols-1 gap-3 ${isSealed ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
          <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-xs font-bold text-slate-500">{isSealed ? "최소 입찰 금액" : "시작가"}</p>
            <p className="mt-1 font-black text-slate-900">{renderAmount(startPrice)}</p>
          </div>
          {!isSealed ? <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-xs font-bold text-slate-500">입찰 단위</p>
            <p className="mt-1 font-black text-slate-900">{renderAmount(bidStep)}</p>
          </div> : null}
          <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-xs font-bold text-slate-500">{status === "ended" || isTimedOut ? "입찰 상태" : isSealed ? "입찰 규칙" : "다음 최소 입찰"}</p>
            <p className="mt-1 font-black text-slate-900">{status === "ended" || isTimedOut ? "입찰 종료" : isSealed ? "한 사람당 한 번" : renderAmount(minNextBid)}</p>
          </div>
        </div>

        {isActive && isSealed ? (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800">
            다른 참가자의 금액은 마감 전까지 공개되지 않습니다. 같은 최고 금액이면 먼저 입찰한 사람이 낙찰됩니다.
          </div>
        ) : null}

        {isActive && !isTimedOut && !isSealed && antiSnipingSeconds > 0 ? (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800">
            <p className="font-bold">마감 시간 자동 연장 {antiSnipingSeconds}초 적용 중</p>
            <p className="mt-1 text-xs leading-5 text-indigo-700">
              종료 {antiSnipingSeconds}초 이내에 입찰되면 남은 시간이 다시 {antiSnipingSeconds}초가 됩니다.
            </p>
          </div>
        ) : null}

        {status === "ended" ? (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
            <div className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="h-4 w-4" />
              {statusMeta.hasWinner ? `낙찰자 ${winnerName}` : "낙찰 없이 종료되었습니다."}
            </div>
          </div>
        ) : null}

        {canViewBidders && classId && status !== "pending" && status !== "rejected" ? (
          <section className="border-t border-slate-200 pt-5">
            <h3 className="mb-3 text-sm font-bold text-slate-700">
              입찰자 {currentBidState.loading || currentBidState.error ? "" : `${bidders.length}명`}
            </h3>
            {currentBidState.loading ? (
              <p className="text-sm text-slate-500">입찰자를 불러오는 중입니다.</p>
            ) : currentBidState.error ? (
              <p className="text-sm text-rose-600">입찰자를 불러오지 못했습니다.</p>
            ) : bidders.length === 0 ? (
              <p className="text-sm text-slate-500">아직 입찰자가 없습니다.</p>
            ) : (
              <div className="divide-y divide-slate-100 border-y border-slate-100">
                {bidders.map((bid) => (
                  <div key={bid.bidderUid} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 break-words font-semibold text-slate-800">
                      {fallbackText(bid.bidderName, "이름 없음")}
                    </span>
                    {!hideActivePrice ? (
                      <span className="shrink-0 tabular-nums text-slate-600">{renderAmount(bid.amount)}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {status === "rejected" && item?.rejectedReason ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">
            <div className="flex items-start gap-2">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <span className="font-bold">승인 안 된 이유:</span> {item.rejectedReason}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button kind="outline" tone="slate" onClick={onClose}>
          닫기
        </Button>
        {isActive ? (
          <Button
            kind="solid"
            tone="blue"
            icon={canBid ? ArrowUpRight : Gavel}
            disabled={!canBid}
            onClick={() => onBid?.(item)}
          >
            {isOwner ? "내 출품" : isTimedOut ? "마감됨" : isMyHighestBid ? "최고 입찰 중" : "입찰하기"}
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}
