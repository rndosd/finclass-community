import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Settings,
  Eye,
  EyeOff,
  Ticket as TicketIcon,
  Coins,
  Search,
  Clock,
  CircleHelp,
  ChevronDown,
} from "lucide-react";
import { Button, Card } from "../../../components/ui";
import { isPaymentTypeAllowed } from "../utils/paymentPolicy";
import {
  formatArcadeChargeDetail,
  getArcadeFeeAmount,
} from "../utils/chargeUtils";
import {
  buildBoardProbabilityRows,
  buildChanceProbabilityRows,
} from "../utils/prizeAnalytics";
import { getGameArtwork } from "../gameArtwork";

const formatProbabilityLabel = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0%";
  if (Math.abs(numeric) >= 10) return `${numeric.toFixed(0)}%`;
  if (Math.abs(numeric) >= 1) return `${numeric.toFixed(1)}%`;
  return `${numeric.toFixed(2)}%`;
};

const PROBABILITY_DROPDOWN_GAP = 8;
const PROBABILITY_DROPDOWN_VIEWPORT_PADDING = 16;
const PROBABILITY_DROPDOWN_WIDTH = 224;
const PROBABILITY_DROPDOWN_MAX_HEIGHT = 320;

const GameCard = ({
  game,
  config,
  gameUsage = { daily: 0, weekly: 0 },
  isTeacher,
  currencyName,
  onPlay,
  onEdit,
  onToggleVisibility,
  onShowTickets,
  userCash = 0,
  userTickets = 0,
  usageLoaded = true,
  ticketInventoryLoaded = true,
  roundStatus = null,
  showProbabilityTable = false,
  isVisibilityUpdating = false,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const isLotto = game.id === "lotto";
  const isMatchPrediction = game.id === "matchPrediction";
  const isMiniQuiz = game.id === "miniQuiz";
  const artwork = getGameArtwork(game.id);
  const isFreeActionGame = isMatchPrediction || isMiniQuiz;
  const isEnabled = config?.enabled !== false;
  const isLottoOpen = !isLotto || roundStatus === "open";
  const hasUnlimitedAccess = Boolean(isTeacher);
  const dailyUsed = Number(gameUsage?.daily || 0);
  const weeklyUsed = Number(gameUsage?.weekly || 0);
  const dailyLimit = Number(config?.dailyLimit || 0);
  const weeklyLimit = Number(config?.weeklyLimit || 0);
  const hasConfiguredDailyLimit =
    Number.isFinite(dailyLimit) && dailyLimit > 0;
  const hasConfiguredWeeklyLimit =
    Number.isFinite(weeklyLimit) && weeklyLimit > 0;
  const hasDailyLimit =
    !hasUnlimitedAccess && Number.isFinite(dailyLimit) && dailyLimit > 0;
  const hasWeeklyLimit =
    !hasUnlimitedAccess && Number.isFinite(weeklyLimit) && weeklyLimit > 0;
  const remainingDaily = hasDailyLimit
    ? Math.max(dailyLimit - dailyUsed, 0)
    : null;
  const remainingWeekly = hasWeeklyLimit
    ? Math.max(weeklyLimit - weeklyUsed, 0)
    : null;
  const isUsageLimitReached =
    !hasUnlimitedAccess &&
    ((hasDailyLimit && remainingDaily <= 0) ||
      (hasWeeklyLimit && remainingWeekly <= 0));
  const lottoStatusLabel =
    roundStatus === "open"
      ? "판매 중"
      : roundStatus === "paused"
        ? "일시 정지"
      : roundStatus === "closed"
        ? "판매 대기"
        : roundStatus === "finished"
          ? "추첨 완료"
          : "회차 없음";
  const [timeLeft, setTimeLeft] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [isProbabilityOpen, setIsProbabilityOpen] = useState(false);
  const [probabilityPlacement, setProbabilityPlacement] = useState("bottom");
  const [probabilityMenuStyle, setProbabilityMenuStyle] = useState(null);
  const [portalRoot, setPortalRoot] = useState(null);
  const probabilityTriggerRef = useRef(null);
  const probabilityMenuRef = useRef(null);
  const showLottoTimer =
    game.id === "lotto" && isEnabled && isLottoOpen && config?.endTime;
  const cashAllowed =
    isFreeActionGame || isPaymentTypeAllowed(config?.allowedPaymentTypes, "cash");
  const ticketAllowed = isPaymentTypeAllowed(
    config?.allowedPaymentTypes,
    "ticket",
  ) && !isFreeActionGame;
  const feeAmount = getArcadeFeeAmount(config?.feeAmount);
  const canPlayByUsage = hasUnlimitedAccess || !isUsageLimitReached;
  const usageReady = hasUnlimitedAccess || usageLoaded;
  const canTeacherPreview = isTeacher && !isEnabled;
  const canEnterGame =
    (isEnabled || canTeacherPreview) && isLottoOpen && canPlayByUsage && usageReady;
  const priceAmount = Math.max(0, Number(config?.price || 0));
  const availableCash = Number(userCash || 0);
  const cashChargeAmount = priceAmount + feeAmount;
  const cashCompactChargeLabel =
    `${formatDisplayMoney(cashChargeAmount)}${currencyName}`;
  const ticketCompactChargeLabel =
    feeAmount > 0
      ? `1장+${formatDisplayMoney(feeAmount)}${currencyName}`
      : "1장";
  const cashChargeDetail = formatArcadeChargeDetail({formatAmount: formatDisplayMoney,
    price: config?.price,
    feeAmount,
    currencyName,
  });
  const ticketChargeDetail = formatArcadeChargeDetail({formatAmount: formatDisplayMoney,
    feeAmount,
    isTicketUsed: true,
    currencyName,
  });
  const hasEnoughCashForCash =
    hasUnlimitedAccess || availableCash >= cashChargeAmount;
  const hasEnoughCashForTicketFee = hasUnlimitedAccess || availableCash >= feeAmount;
  const cashPlayable =
    cashAllowed && canEnterGame && (isFreeActionGame || hasEnoughCashForCash);
  const ticketPlayable =
    ticketAllowed &&
    canEnterGame &&
    (hasUnlimitedAccess || ticketInventoryLoaded) &&
    userTickets > 0 &&
    hasEnoughCashForTicketFee;
  const cashBlockedByFunds =
    cashAllowed &&
    !hasUnlimitedAccess &&
    canEnterGame &&
    !isFreeActionGame &&
    !hasEnoughCashForCash;
  const ticketBlockedByInventory =
    ticketAllowed &&
    !hasUnlimitedAccess &&
    canEnterGame &&
    ticketInventoryLoaded &&
    userTickets <= 0;
  const ticketBlockedByFee =
    ticketAllowed &&
    !hasUnlimitedAccess &&
    canEnterGame &&
    ticketInventoryLoaded &&
    userTickets > 0 &&
    !hasEnoughCashForTicketFee;
  const entryBlockMessage = !usageReady
    ? "입장 정보를 확인하는 중입니다."
    : isUsageLimitReached
      ? hasDailyLimit && remainingDaily <= 0
        ? "오늘 이용 가능 횟수를 모두 사용했습니다."
        : "이번 주 이용 가능 횟수를 모두 사용했습니다."
    : cashBlockedByFunds
      ? "잔액이 부족합니다."
      : ticketBlockedByInventory
        ? "보유 티켓이 없습니다."
        : ticketBlockedByFee
          ? "수수료를 낼 잔액이 부족합니다."
          : "";
  const actionGridClass =
    cashAllowed && ticketAllowed ? "grid-cols-2" : "grid-cols-1";
  const compactUsageLabel = hasConfiguredDailyLimit
    ? `오늘 ${dailyUsed}/${dailyLimit}회`
    : `오늘 ${dailyUsed}회`;

  const updateProbabilityMenuLayout = useCallback(() => {
    if (!probabilityTriggerRef.current) return;

    const anchorRect = probabilityTriggerRef.current.getBoundingClientRect();
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight;
    const availableWidth = Math.max(
      0,
      viewportWidth - PROBABILITY_DROPDOWN_VIEWPORT_PADDING * 2,
    );
    const width = Math.min(PROBABILITY_DROPDOWN_WIDTH, availableWidth);
    const left = Math.min(
      Math.max(
        anchorRect.right - width,
        PROBABILITY_DROPDOWN_VIEWPORT_PADDING,
      ),
      viewportWidth - PROBABILITY_DROPDOWN_VIEWPORT_PADDING - width,
    );
    const spaceBelow = Math.max(
      0,
      viewportHeight -
        PROBABILITY_DROPDOWN_VIEWPORT_PADDING -
        anchorRect.bottom -
        PROBABILITY_DROPDOWN_GAP,
    );
    const spaceAbove = Math.max(
      0,
      anchorRect.top -
        PROBABILITY_DROPDOWN_VIEWPORT_PADDING -
        PROBABILITY_DROPDOWN_GAP,
    );
    const nextPlacement =
      spaceBelow >= 220 || spaceBelow >= spaceAbove ? "bottom" : "top";
    const nextMaxHeight = Math.min(
      PROBABILITY_DROPDOWN_MAX_HEIGHT,
      nextPlacement === "bottom" ? spaceBelow : spaceAbove,
    );

    setProbabilityPlacement(nextPlacement);
    setProbabilityMenuStyle({
      left,
      top:
        nextPlacement === "bottom"
          ? anchorRect.bottom + PROBABILITY_DROPDOWN_GAP
          : anchorRect.top - PROBABILITY_DROPDOWN_GAP,
      width,
      maxHeight: Math.max(0, nextMaxHeight),
    });
  }, []);

  const probabilityRows = useMemo(() => {
    if (!showProbabilityTable || isLotto) return [];

    const sortRows = (rows) =>
      [...rows].sort(
        (left, right) =>
          Number(left?.probabilityPercent || 0) -
          Number(right?.probabilityPercent || 0),
      );

    if (game.id === "scratch" || game.id === "roulette") {
      return sortRows(buildChanceProbabilityRows(config?.prizes || []));
    }

    if (game.id === "paperpick") {
      return sortRows(
        buildBoardProbabilityRows(config?.prizes || [], config?.boardSize || 0),
      );
    }

    return [];
  }, [showProbabilityTable, isLotto, game.id, config]);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    if (!probabilityRows.length) {
      setIsProbabilityOpen(false);
    }
  }, [probabilityRows.length]);

  useEffect(() => {
    if (!isProbabilityOpen) return undefined;

    const handlePointerDown = (event) => {
      const isInsideTrigger = probabilityTriggerRef.current?.contains(event.target);
      const isInsideMenu = probabilityMenuRef.current?.contains(event.target);

      if (!isInsideTrigger && !isInsideMenu) {
        setIsProbabilityOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsProbabilityOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProbabilityOpen]);

  useEffect(() => {
    if (!isProbabilityOpen) return undefined;

    updateProbabilityMenuLayout();

    const handleViewportChange = () => {
      window.requestAnimationFrame(updateProbabilityMenuLayout);
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isProbabilityOpen, updateProbabilityMenuLayout]);

  useEffect(() => {
    if (game.id !== "lotto" || !config?.endTime || !isEnabled || !isLottoOpen) {
      return undefined;
    }

    const timer = setInterval(() => {
      const now = Date.now();
      const end = new Date(config.endTime).getTime();
      const diff = end - now;

      if (diff <= 0) {
        setTimeLeft("마감 완료");
        setIsUrgent(false);
        clearInterval(timer);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setIsUrgent(diff < 1000 * 60 * 60);
      setTimeLeft(`${hours}시간 ${minutes}분 ${seconds}초`);
    }, 1000);

    return () => clearInterval(timer);
  }, [game.id, config?.endTime, isEnabled, isLottoOpen]);

  if (!isEnabled && !isTeacher) return null;

  return (
    <Card
      noPadding
      className={`group relative overflow-hidden border p-3 transition-all duration-300 sm:p-4 ${
        !isEnabled
          ? "scale-[0.99] border-slate-200 bg-slate-100 opacity-75 shadow-none"
          : "border-white/80 bg-white/90 backdrop-blur-sm shadow-[0_10px_30px_rgba(15,23,42,0.08)] hover:-translate-y-1 hover:shadow-[0_18px_38px_rgba(15,23,42,0.12)]"
      }`}
    >
      {artwork ? (
        <div className="relative aspect-[16/9] overflow-hidden bg-slate-100">
          <img
            src={artwork.src}
            alt={artwork.alt}
            loading="lazy"
            decoding="async"
            className={`h-full w-full object-cover transition duration-500 ${
              isEnabled ? "group-hover:scale-[1.025]" : "grayscale"
            }`}
            onError={(event) => {
              if (event.currentTarget.src !== artwork.fallbackSrc) {
                event.currentTarget.src = artwork.fallbackSrc;
              }
            }}
          />
        </div>
      ) : null}
      <div className="absolute left-3 top-3 z-30 flex items-center gap-1.5">
        {game.id === "lotto" && isEnabled && (
          <Button
            onClick={(event) => {
              event.stopPropagation();
              onShowTickets?.(game.id);
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600 active:scale-95"
            title="내 티켓 보기"
          >
            <Search size={14} />
          </Button>
        )}

        {isTeacher && !isMiniQuiz && (
          <>
            <Button
              onClick={(event) => {
                event.stopPropagation();
                onEdit(game.id);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-800 hover:bg-slate-800 hover:text-white active:scale-95"
              title="게임 설정"
            >
              <Settings size={14} />
            </Button>
            <Button
              onClick={(event) => {
                event.stopPropagation();
                if (isVisibilityUpdating) return;
                onToggleVisibility(game.id, !isEnabled);
              }}
              disabled={isVisibilityUpdating}
              aria-label={isVisibilityUpdating ? "변경 중" : isEnabled ? "학생에게 숨기기" : "학생에게 공개"}
              className={`inline-flex h-8 items-center gap-1 rounded-xl border px-2 text-[10px] font-black shadow-sm transition active:scale-95 ${
                isEnabled
                  ? "border-slate-200 bg-white text-slate-500 hover:border-rose-300 hover:text-rose-600"
                  : "border-amber-200 bg-white text-amber-700 hover:bg-amber-50"
              } ${isVisibilityUpdating ? "cursor-not-allowed opacity-60" : ""}`}
              title={isEnabled ? "학생에게 숨기기" : "학생에게 공개"}
            >
              {isEnabled ? <EyeOff size={14} /> : <Eye size={14} />}
              <span>
                {isVisibilityUpdating ? "변경 중" : isEnabled ? "숨기기" : "공개"}
              </span>
            </Button>
          </>
        )}
      </div>

      {probabilityRows.length > 0 && (
        <div className="absolute right-3 top-3 z-20">
          <Button
            ref={probabilityTriggerRef}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsProbabilityOpen((prev) => !prev);
            }}
            aria-expanded={isProbabilityOpen}
            aria-haspopup="dialog"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/95 px-2.5 py-1.5 text-[10px] font-black text-slate-600 shadow-[0_4px_12px_rgba(15,23,42,0.10)] backdrop-blur-sm transition hover:border-indigo-200 hover:text-indigo-600"
            title="보상 확률표"
          >
            <CircleHelp size={12} />
            <span>확률표</span>
            <ChevronDown
              size={12}
              className={`transition-transform ${
                isProbabilityOpen ? "rotate-180" : ""
              }`}
            />
          </Button>

          {false && isProbabilityOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-3 text-left shadow-xl">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                보상 확률표
              </p>
              <div className="space-y-2">
                {probabilityRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 rounded-2xl bg-white/90 px-3 py-2 ring-1 ring-white/80"
                  >
                    <p className="min-w-0 truncate text-xs font-bold text-slate-800">
                      {row.label}
                    </p>
                    <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-1 text-[11px] font-black text-indigo-700">
                      {formatProbabilityLabel(row.probabilityPercent)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {probabilityRows.length > 0 &&
      isProbabilityOpen &&
      portalRoot &&
      probabilityMenuStyle
        ? createPortal(
            <div
              ref={probabilityMenuRef}
              className={`fixed z-[160] rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-3 text-left shadow-xl animate-in duration-200 ${
                probabilityPlacement === "top"
                  ? "slide-in-from-bottom-1"
                  : "slide-in-from-top-1"
              }`}
              style={{
                top: probabilityMenuStyle.top,
                left: probabilityMenuStyle.left,
                width: probabilityMenuStyle.width,
                transform:
                  probabilityPlacement === "top"
                    ? "translateY(-100%)"
                    : undefined,
              }}
            >
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                확률표
              </p>
              <div
                className="space-y-2 overflow-y-auto"
                style={{ maxHeight: `${probabilityMenuStyle.maxHeight}px` }}
              >
                {probabilityRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 rounded-2xl bg-white/90 px-3 py-2 ring-1 ring-white/80"
                  >
                    <p className="min-w-0 truncate text-xs font-bold text-slate-800">
                      {row.label}
                    </p>
                    <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-1 text-[11px] font-black text-indigo-700">
                      {formatProbabilityLabel(row.probabilityPercent)}
                    </span>
                  </div>
                ))}
              </div>
            </div>,
            portalRoot,
          )
        : null}

      {showLottoTimer && (
        <div className="absolute right-3 top-3 z-10">
          <div
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-black shadow-[0_4px_12px_rgba(15,23,42,0.10)] backdrop-blur-sm ${
              isUrgent
                ? "border-rose-200 bg-rose-50/95 text-rose-600"
                : "border-slate-200/90 bg-white/95 text-slate-600"
            }`}
          >
            <Clock size={11} />
            {timeLeft}
          </div>
        </div>
      )}

      {isLotto && (
        <div
          className={`absolute right-3 z-10 ${showLottoTimer ? "top-14" : "top-3"}`}
        >
          <div
            className={`whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[10px] font-black shadow-[0_4px_12px_rgba(15,23,42,0.10)] backdrop-blur-sm ${
              isLottoOpen
                ? "border-emerald-200 bg-emerald-50/95 text-emerald-700"
                : "border-amber-200 bg-amber-50/95 text-amber-700"
            }`}
          >
            {lottoStatusLabel}
          </div>
        </div>
      )}

      <div
        className={`relative -mt-px flex flex-col gap-2 bg-gradient-to-r ${game.color} p-3.5 text-white transition-all duration-300 ${
          !isEnabled ? "opacity-85" : ""
        }`}
      >
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
              <game.icon size={20} />
            </span>
            <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-base font-black">{game.name}</h3>
                {isTeacher ? (
                  <span className="shrink-0 rounded-md bg-white/18 px-2 py-0.5 text-[9px] font-black ring-1 ring-white/25">
                    교사
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[11px] font-bold text-white/75">
                {compactUsageLabel}
                {hasConfiguredWeeklyLimit
                ? ` · 주간 ${weeklyUsed}/${weeklyLimit}회`
                : ""}
              </p>
              {isTeacher && isMiniQuiz ? (
                <p className="mt-0.5 text-[11px] font-bold text-white/85">
                  {config?.sourceSetId
                    ? (isEnabled && config.sourceSetVisibility === "public" ? "퀴즈 공개 중" : "퀴즈 비공개")
                    : (config?.questions || []).length ? "기존 퀴즈 사용 중" : "등록된 퀴즈 없음"}
                </p>
              ) : null}
            </div>
          </div>

          {isTeacher && isMiniQuiz ? (
            <Button onClick={() => onEdit(game.id)} className="h-10 shrink-0 rounded-xl bg-white px-5 text-xs font-bold text-slate-900 hover:bg-white/90">퀴즈 설정</Button>
          ) : isFreeActionGame ? (
            <Button
              onClick={() => onPlay(game.id, "cash")}
              disabled={!cashPlayable}
              className={`flex h-10 shrink-0 items-center justify-center rounded-xl border px-5 text-xs font-black transition active:scale-[0.98] ${
                cashPlayable
                  ? "border-white/40 bg-white text-slate-900 shadow-sm hover:bg-white/90"
                  : "border-white/10 bg-white/15 text-white/50"
              }`}
            >
              {game.freePlayLabel || "참여하기"}
            </Button>
          ) : (
            <div className={`grid shrink-0 gap-1.5 ${actionGridClass}`}>
              {cashAllowed ? (
                <Button
                  onClick={() => onPlay(game.id, "cash")}
                  disabled={!cashPlayable}
                  title={cashChargeDetail}
                  className={`flex h-10 min-w-[104px] items-center justify-between gap-2 rounded-xl border px-3 text-left transition active:scale-[0.98] ${
                    cashPlayable
                      ? "border-white/40 bg-white text-slate-900 shadow-sm hover:bg-white/90"
                      : "border-white/10 bg-white/15 text-white/50"
                  }`}
                >
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-black leading-none">
                    <Coins size={13} />
                    현금
                  </span>
                  <span className="whitespace-nowrap text-[11px] font-black leading-none tabular-nums">
                    {cashCompactChargeLabel}
                  </span>
                </Button>
              ) : null}

              {ticketAllowed ? (
                <Button
                  onClick={() => onPlay(game.id, "ticket")}
                  disabled={!ticketPlayable}
                  title={ticketChargeDetail}
                  className={`flex h-10 min-w-[104px] items-center justify-between gap-2 rounded-xl border px-3 text-left transition active:scale-[0.98] ${
                    ticketPlayable
                      ? "border-white/40 bg-white text-slate-900 shadow-sm hover:bg-white/90"
                      : "border-white/10 bg-white/15 text-white/50"
                  }`}
                >
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-black leading-none">
                    <TicketIcon size={13} />
                    티켓
                  </span>
                  <span className="whitespace-nowrap text-[11px] font-black leading-none tabular-nums">
                    {ticketCompactChargeLabel}
                  </span>
                </Button>
              ) : null}
            </div>
          )}
        </div>

        {entryBlockMessage ? (
          <p className="rounded-lg bg-slate-950/20 px-3 py-1.5 text-center text-[10px] font-black text-white">
            {entryBlockMessage}
          </p>
        ) : null}
      </div>


    </Card>
  );
};

export default GameCard;
