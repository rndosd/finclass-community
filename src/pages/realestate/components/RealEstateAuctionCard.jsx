import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Circle,
  Clock3,
  Gavel,
  Landmark,
  ShieldAlert,
  Timer,
  Trash2,
  Wallet,
  XCircle,
} from "lucide-react";
import { Badge, Button, Card, IconButton } from "../../../components/ui";
import { formatDateInKST, toDate } from "../../../utils/kstDate";
import realEstateAuctionGavel from "../../../assets/realestate/realestate-auction-gavel.webp";

function pad2(n) {
  return String(Math.max(0, Number(n || 0))).padStart(2, "0");
}

function toMs(value) {
  const date = toDate(value);
  return date ? date.getTime() : 0;
}

function toRemainingClock(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return {
      text: "\uB9C8\uAC10",
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
    text: day > 0 ? `${day}\uC77C ${clock}` : clock,
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

function getSellerText(auction) {
  if (auction?.source === "public") {
    return "\uD310\uB9E4\uC790 \uAD6D\uAC00(\uAD50\uC0AC)";
  }
  if (auction?.originalOwnerName) {
    return `\uC6D0\uC18C\uC720\uC790 ${auction.originalOwnerName}`;
  }
  return "\uC555\uB958 \uC790\uC0B0";
}

function getStatusBadge(status, remaining, options = {}) {
  const { hasFutureScheduledStart = false } = options;

  if (status === "active") {
    return {
      tone: "blue",
      icon: Timer,
      label: "\uACBD\uB9E4 \uC9C4\uD589 \uC911",
    };
  }

  if (status === "queued") {
    return {
      tone: "amber",
      icon: AlertTriangle,
      label: hasFutureScheduledStart ? "\uC608\uC57D \uC2DC\uC791 \uB300\uAE30" : "\uACBD\uB9E4 \uB300\uAE30",
    };
  }

  if (status === "awaiting_payment") {
    return {
      tone: remaining.isExpired ? "rose" : "amber",
      icon: Clock3,
      label: "\uB099\uCC30 \uACB0\uC81C \uB300\uAE30",
    };
  }

  if (status === "settled") {
    return {
      tone: "slate",
      icon: CheckCircle2,
      label: "\uB099\uCC30 \uC644\uB8CC",
    };
  }

  if (status === "cancelled") {
    return {
      tone: "rose",
      icon: Ban,
      label: "\uACBD\uB9E4 \uCDE8\uC18C",
    };
  }

  if (status === "ended_no_bid") {
    return {
      tone: "slate",
      icon: Ban,
      label: "\uC720\uCC30 \uC5C6\uC74C",
    };
  }

  return {
    tone: "slate",
    icon: AlertTriangle,
    label: status || "\uC0C1\uD0DC \uD655\uC778",
  };
}

function getCountdownToneClass(status, remaining) {
  if (status === "awaiting_payment") {
    return remaining.isExpired
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (status === "queued") {
    return "border-slate-200 bg-slate-50 text-slate-700";
  }

  return remaining.isUrgent
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : "border-blue-200 bg-blue-50 text-blue-800";
}

export default function RealEstateAuctionCard({
  auction,
  formatCurrency,
  isTeacher,
  isWinner,
  minimumBid,
  bidValue,
  onBidValueChange,
  onActivate,
  onClose,
  onCancel,
  onPlaceBid,
  onPay,
  selectable = false,
  selected = false,
  onToggleSelect,
  canDeleteRecord = false,
  onDeleteRecord,
  isBusy = false,
  variant = "default",
  auctionNumber,
}) {
  const status = String(auction?.status || "");
  const scheduledStartMs = useMemo(() => toMs(auction?.scheduledStartAt), [auction?.scheduledStartAt]);
  const targetMs = useMemo(() => {
    if (auction?.status === "awaiting_payment") {
      return toMs(auction?.paymentDueAt);
    }
    if (auction?.status === "active") {
      return toMs(auction?.endAt);
    }
    if (auction?.status === "queued" && scheduledStartMs > 0) {
      return scheduledStartMs;
    }
    return 0;
  }, [auction?.endAt, auction?.paymentDueAt, auction?.status, scheduledStartMs]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!targetMs) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [targetMs]);

  const isPublic = auction?.source === "public";
  const hasFutureScheduledStart = status === "queued" && scheduledStartMs > now;
  const remaining = toRemainingClock(targetMs - now);
  const badge = getStatusBadge(status, remaining, { hasFutureScheduledStart });
  const Icon = badge.icon;
  const sourceIconTone = isPublic
    ? "bg-indigo-50 text-indigo-600"
    : "bg-rose-50 text-rose-600";
  const SourceIcon = isPublic ? Landmark : ShieldAlert;

  const startPrice = Number(auction?.startPrice || 0);
  const currentBid = Number(auction?.currentBid || 0);
  const finalPrice = Number(auction?.finalPrice || 0);
  const bidStep = Number(auction?.bidStep || 1);
  const displayPrice =
    status === "settled" && finalPrice > 0
      ? finalPrice
      : currentBid > 0
        ? currentBid
        : startPrice;
  const showBidActions = !isTeacher && status === "active";
  const showTeacherActions = isTeacher && ["queued", "active", "awaiting_payment"].includes(status);
  const showPaymentAction = status === "awaiting_payment" && isWinner;
  const showDeleteAction = isTeacher && canDeleteRecord && !selectable;
  const canActivateQueued = status === "queued" && !hasFutureScheduledStart;
  const showCountdown = ["queued", "active", "awaiting_payment"].includes(status) && targetMs > 0;
  const startedAtLabel = formatDateTimeLabel(auction?.startedAt || auction?.scheduledStartAt);
  const endAtLabel = formatDateTimeLabel(auction?.endAt);
  const paymentDueLabel = formatDateTimeLabel(auction?.paymentDueAt);
  const countdownLabel =
    status === "awaiting_payment"
      ? "\uACB0\uC81C \uB0A8\uC740 \uC2DC\uAC04"
      : status === "active"
        ? "\uACBD\uB9E4 \uB0A8\uC740 \uC2DC\uAC04"
        : "\uC2DC\uC791\uAE4C\uC9C0 \uB0A8\uC740 \uC2DC\uAC04";
  const countdownToneClass = getCountdownToneClass(status, remaining);
  const countdownTargetLabel =
    status === "awaiting_payment"
      ? paymentDueLabel
      : status === "active"
        ? endAtLabel
        : startedAtLabel;

  const isFeatured = variant === "featured";
  const isCompact = variant === "compact";
  const isListCard = isCompact || variant === "default";
  const lotLabel = auctionNumber ? `\uACBD\uB9E4 ${auctionNumber}\uBC88` : "\uACBD\uB9E4";

  const sharedContent = (
    <>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`p-2 rounded-xl shrink-0 ${sourceIconTone}`}>
              <SourceIcon size={18} />
            </div>
            <div className="min-w-0">
              <p className="font-extrabold text-slate-800 truncate">
                {auction?.deskLabel || `${auction?.deskNumber ?? "-"}\uBC88 \uC790\uB9AC`}
              </p>
              <p className="text-xs text-slate-500 truncate">{getSellerText(auction)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {selectable ? (
              <IconButton
                icon={selected ? CheckCircle2 : Circle}
                label={selected ? "선택 해제" : "기록 선택"}
                onClick={onToggleSelect}
                size="sm"
                tone="indigo"
                active={selected}
                className="rounded-full"
                title={selected ? "선택 해제" : "기록 선택"}
              />
            ) : null}

            <Badge tone={badge.tone} variant="soft" size="sm" className="gap-2 shrink-0">
              <Icon className="h-3.5 w-3.5" />
              <span>{badge.label}</span>
            </Badge>
          </div>
        </div>

        <div className={`space-y-3 rounded-[1.5rem] border border-slate-200 bg-white ${isFeatured ? "p-5" : "p-4"}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-black tracking-[0.18em] text-slate-500">
                {status === "settled" ? "\uB099\uCC30\uAC00" : "\uD604\uC7AC\uAC00"}
              </div>
              <div className={`${isFeatured ? "text-4xl" : "text-3xl"} mt-1 font-black leading-none break-keep text-slate-900`}>
                {formatCurrency(displayPrice)}
              </div>
            </div>

            <div className="shrink-0 space-y-1 text-right text-xs text-slate-500">
              <div>{`\uC2DC\uC791\uAC00 ${formatCurrency(startPrice)}`}</div>
              <div>{`\uC785\uCC30 \uB2E8\uC704 ${formatCurrency(bidStep)}`}</div>
            </div>
          </div>

          {showCountdown ? (
            <div className={`rounded-2xl border px-4 py-3 ${countdownToneClass}`}>
              <div className="text-[11px] font-black tracking-[0.18em] opacity-70">
                {countdownLabel}
              </div>
              <div className="mt-1 flex items-end justify-between gap-3">
                <span className="font-sans text-2xl font-black tracking-tight tabular-nums">{remaining.text}</span>
                {countdownTargetLabel ? (
                  <span className="text-xs font-semibold opacity-80">{countdownTargetLabel}</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {["active", "awaiting_payment"].includes(status) ? (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600">
              <span>
                {status === "awaiting_payment"
                  ? "\uACB0\uC81C \uB300\uC0C1\uAE08\uC561"
                  : "\uB2E4\uC74C \uC785\uCC30\uAC00"}
              </span>
              <span className="font-bold">
                {formatCurrency(status === "awaiting_payment" ? displayPrice : minimumBid)}
              </span>
            </div>
          ) : null}

          <div className="rounded-xl bg-slate-50/80 px-3 py-3 text-xs text-slate-500">
            {auction?.highestBidName ? (
              <div>
              {`\uCD5C\uACE0 \uC785\uCC30\uC790 `}
                <span className="font-semibold">{auction.highestBidName}</span>
              </div>
            ) : (
              <div>{"\uC544\uC9C1 \uB4F1\uB85D\uB41C \uC785\uCC30\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</div>
            )}
          </div>

        </div>

        {showBidActions ? (
          <div className="mt-auto space-y-2">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
              <input
                type="number"
                min={minimumBid}
                value={bidValue}
                onChange={(event) => onBidValueChange?.(event.target.value)}
                disabled={isBusy}
                className="min-w-0 flex-1 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 disabled:bg-slate-100"
              />
              <Button
                kind="solid"
                tone="blue"
                icon={ArrowUpRight}
                disabled={isBusy}
                onClick={onPlaceBid}
              >
                {"\uC785\uCC30\uD558\uAE30"}
              </Button>
            </div>
          </div>
        ) : null}

        {showTeacherActions ? (
          <div
            className={
              canActivateQueued || status === "active"
                ? "mt-auto grid grid-cols-1 sm:grid-cols-2 gap-2"
                : "mt-auto grid grid-cols-1 gap-2"
            }
          >
            {canActivateQueued ? (
              <Button
                kind="solid"
                tone="blue"
                icon={Gavel}
                disabled={isBusy}
                onClick={onActivate}
              >
                {"\uACBD\uB9E4 \uC2DC\uC791"}
              </Button>
            ) : null}

            {status === "active" ? (
              <Button
                kind="outline"
                tone="slate"
                icon={CheckCircle2}
                disabled={isBusy}
                onClick={onClose}
              >
                {"\uB9C8\uAC10 \uCC98\uB9AC"}
              </Button>
            ) : null}

            <Button
              kind="soft"
              tone="rose"
              icon={XCircle}
              disabled={isBusy}
              onClick={onCancel}
            >
              {"\uACBD\uB9E4 \uCDE8\uC18C"}
            </Button>
          </div>
        ) : null}

        {showPaymentAction ? (
          <div className="mt-auto">
            <Button
              kind="solid"
              tone="emerald"
              className="w-full whitespace-nowrap"
              icon={Wallet}
              disabled={isBusy}
              onClick={onPay}
            >
              {"\uB099\uCC30 \uACB0\uC81C"}
            </Button>
          </div>
        ) : null}

        {showDeleteAction ? (
          <div className="mt-auto">
            <Button
              kind="soft"
              tone="rose"
              className="w-full whitespace-nowrap"
              icon={Trash2}
              disabled={isBusy}
              onClick={onDeleteRecord}
            >
              {"기록 삭제"}
            </Button>
          </div>
        ) : null}
    </>
  );

  const cardClass = `h-full overflow-hidden border border-slate-200 bg-white ${selected ? "ring-2 ring-indigo-200 shadow-md shadow-indigo-100/70" : "shadow-sm shadow-slate-200/70 transition hover:shadow-md"}`;
  const featuredCountdownClass = remaining.isExpired || remaining.isUrgent
    ? "border-rose-200 bg-rose-50 text-rose-600"
    : "border-orange-200 bg-orange-50 text-orange-600";

  const renderAuctionActions = (compact = false) => {
    if (showBidActions) {
      return (
        <div className={`grid gap-2 ${compact ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"}`}>
          <input
            type="number"
            min={minimumBid}
            value={bidValue}
            onChange={(event) => onBidValueChange?.(event.target.value)}
            disabled={isBusy}
            className="min-w-0 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 disabled:bg-slate-100"
          />
          <Button
            kind="solid"
            tone="blue"
            className="w-full whitespace-nowrap"
            icon={ArrowUpRight}
            disabled={isBusy}
            onClick={onPlaceBid}
          >
            {"\uC785\uCC30\uD558\uAE30"}
          </Button>
        </div>
      );
    }

    if (showTeacherActions) {
      return (
        <div className={`grid gap-2 ${canActivateQueued || status === "active" ? "grid-cols-2" : "grid-cols-1"}`}>
          {canActivateQueued ? (
            <Button kind="solid" tone="blue" className="w-full whitespace-nowrap" icon={Gavel} disabled={isBusy} onClick={onActivate}>
              {"\uACBD\uB9E4 \uC2DC\uC791"}
            </Button>
          ) : null}
          {status === "active" ? (
            <Button kind="outline" tone="slate" className="w-full whitespace-nowrap" icon={CheckCircle2} disabled={isBusy} onClick={onClose}>
              {"\uB9C8\uAC10 \uCC98\uB9AC"}
            </Button>
          ) : null}
          <Button kind="soft" tone="rose" className="w-full whitespace-nowrap" icon={XCircle} disabled={isBusy} onClick={onCancel}>
            {"\uACBD\uB9E4 \uCDE8\uC18C"}
          </Button>
        </div>
      );
    }

    if (showPaymentAction) {
      return (
        <Button kind="solid" tone="emerald" className="w-full whitespace-nowrap" icon={Wallet} disabled={isBusy} onClick={onPay}>
          {"\uB099\uCC30 \uACB0\uC81C"}
        </Button>
      );
    }

    if (showDeleteAction) {
      return (
        <Button kind="soft" tone="rose" className="w-full whitespace-nowrap" icon={Trash2} disabled={isBusy} onClick={onDeleteRecord}>
          {"\uAE30\uB85D \uC0AD\uC81C"}
        </Button>
      );
    }

    return null;
  };

  if (isFeatured) {
    return (
      <Card noPadding className={cardClass}>
        <Card.Content noPadding className="p-5">
          <div className="grid min-h-[430px] gap-6 lg:grid-cols-[minmax(280px,0.95fr)_minmax(0,0.85fr)]">
            <div className="relative flex min-h-[360px] items-center justify-center overflow-hidden rounded-2xl bg-slate-50">
              <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
                {status === "active" ? (
                  <Badge tone="rose" variant="solid" size="sm" className="font-black">LIVE</Badge>
                ) : (
                  <Badge tone={badge.tone} variant="soft" size="sm" className="font-black">{badge.label}</Badge>
                )}
                {remaining.isUrgent || remaining.isExpired ? (
                  <Badge tone="rose" variant="soft" size="sm" className="font-black">{"\uB9C8\uAC10 \uC784\uBC15"}</Badge>
                ) : null}
              </div>
              <img src={realEstateAuctionGavel} alt="" aria-hidden="true" className="h-[72%] w-[72%] object-contain drop-shadow-xl" />
            </div>

            <div className="flex min-w-0 flex-col py-1">
              <p className="text-sm font-bold text-indigo-600">{lotLabel}</p>
              <h3 className="mt-3 break-words text-3xl font-black leading-tight text-slate-900">
                {auction?.deskLabel || `${auction?.deskNumber ?? "-"}\uBC88 \uC790\uB9AC`}
              </h3>
              <p className="mt-4 text-sm font-semibold text-slate-500">{getSellerText(auction)}</p>

              <div className="mt-5 border-t border-slate-200 pt-5">
                <p className="text-sm font-bold text-slate-500">{status === "settled" ? "\uB099\uCC30\uAC00" : "\uD604\uC7AC\uAC00"}</p>
                <p className="mt-2 text-5xl font-black tracking-tight text-slate-950">
                  {formatCurrency(displayPrice)}
                </p>
                <p className="mt-2 text-base font-semibold text-slate-500">{"\uC2DC\uC791\uAC00 "}{formatCurrency(startPrice)}</p>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-200 pt-4 text-sm">
                <div>
                  <p className="font-semibold text-slate-500">{"\uD604\uC7AC \uC785\uCC30"}</p>
                  <p className="mt-1 font-black text-indigo-600">{auction?.highestBidName || "\uC5C6\uC74C"}</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-500">{"\uB2E4\uC74C \uC785\uCC30\uAC00"}</p>
                  <p className="mt-1 font-black text-indigo-600">{formatCurrency(minimumBid)}</p>
                </div>
              </div>

              {showCountdown ? (
                <div className={`mt-5 rounded-xl border px-4 py-3 ${featuredCountdownClass}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-sm font-black"><Timer className="h-5 w-5" />{"\uB0A8\uC740 \uC2DC\uAC04"}</span>
                    <span className="font-sans text-3xl font-black tracking-tight tabular-nums">{remaining.text}</span>
                  </div>
                </div>
              ) : null}

              <div className="mt-auto pt-4">{renderAuctionActions()}</div>
            </div>
          </div>
        </Card.Content>
      </Card>
    );
  }

  if (isListCard) {
    return (
      <Card noPadding className={cardClass}>
        <Card.Content noPadding className="flex h-full flex-col p-5">
          <div className="flex items-center justify-between gap-3">
            {status === "active" ? (
              <Badge tone="rose" variant="solid" size="sm" className="font-black">LIVE</Badge>
            ) : (
              <Badge tone={badge.tone} variant="soft" size="sm" className="font-black">{badge.label}</Badge>
            )}
            <span className="text-sm font-bold text-indigo-600">{lotLabel}</span>
          </div>

          <div className="mt-4 grid flex-1 grid-cols-[128px_minmax(0,1fr)] gap-5">
            <div className="flex min-h-36 items-center justify-center rounded-xl bg-slate-50 p-3">
              <img src={realEstateAuctionGavel} alt="" aria-hidden="true" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <h3 className="line-clamp-2 break-words text-xl font-black leading-tight text-slate-900">
                {auction?.deskLabel || `${auction?.deskNumber ?? "-"}\uBC88 \uC790\uB9AC`}
              </h3>
              <p className="mt-2 truncate text-sm font-semibold text-slate-500">{getSellerText(auction)}</p>
              <div className="mt-4 border-t border-slate-200 pt-3">
                <p className="text-xs font-bold text-slate-500">{"\uD604\uC7AC\uAC00"}</p>
                <p className="mt-1 text-2xl font-black text-slate-950">{formatCurrency(displayPrice)}</p>
              </div>
              {showCountdown ? <p className="mt-3 font-sans text-lg font-black tabular-nums text-orange-600">{remaining.text}</p> : null}
            </div>
          </div>

          <div className="mt-4 border-t border-slate-200 pt-4">{renderAuctionActions(true)}</div>
        </Card.Content>
      </Card>
    );
  }
  return (
    <Card noPadding className={cardClass}>
      <Card.Content noPadding className="flex h-full flex-col gap-4 p-5">{sharedContent}</Card.Content>
    </Card>
  );
}
