import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Coins,
  Frown,
  Gift,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";

import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { formatArcadeChargeDetail } from "../utils/chargeUtils";
import { hasItemReward } from "../utils/prizeAnalytics";
import { playScratch } from "../services/arcadeServices";
import { Button } from "../../../components/ui";
import scratchFoilTexture from "../../../assets/arcade/scratch-foil-texture-v1.webp";
import ArcadeInfoChip from "./ArcadeInfoChip";
import "./arcadeMaterials.css";

const PAYMENT_TRIGGER_THRESHOLD = 90;
const REVEAL_THRESHOLD = PAYMENT_TRIGGER_THRESHOLD;
const BASE_BRUSH_SIZE = 28;
const AUTO_REVEAL_DURATION_MS = 420;
const SCRATCH_GRID_COLS = 28;
const SCRATCH_GRID_ROWS = 21;
const SCRATCH_GRID_SIZE = SCRATCH_GRID_COLS * SCRATCH_GRID_ROWS;

const fmt = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : "0";
};

const easeOutCubic = (progress) => 1 - Math.pow(1 - progress, 3);

const resultHasItemReward = (result) =>
  hasItemReward(result) || Boolean(result?.itemName);

const getResultIcon = (result, price) => {
  const hasItem = resultHasItemReward(result);
  if (hasItem && Number(result?.amount || 0) > 0) {
    return <Trophy className="h-16 w-16 text-yellow-500" />;
  }
  if (hasItem) return <Gift className="h-16 w-16 text-pink-500" />;

  const amount = Number(result?.amount || 0);
  const multiplier = Number(result?.multiplier || 0);
  const relativePayout =
    amount > 0 ? (Number(price) > 0 ? amount / Number(price) : 1) : multiplier;

  if (!(amount > 0 || multiplier > 0)) {
    return <Frown className="h-16 w-16 text-slate-300" />;
  }
  if (relativePayout <= 1) return <Coins className="h-16 w-16 text-amber-400" />;
  if (relativePayout <= 3) {
    return <Sparkles className="h-16 w-16 text-yellow-500" />;
  }
  return <Trophy className="h-16 w-16 text-yellow-500" />;
};

const ScratchCard = ({
  price = 0,
  feeAmount = 0,
  isTeacher = false,
  isTicketUsed = false,
  currencyName = "coins",
  scratchUsage = { daily: 0, weekly: 0 },
  dailyLimit = null,
  onComplete,
  onClose,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { classId } = useUser();
  const { showFeedback } = useFeedback();

  const canvasRef = useRef(null);
  const isProcessingRef = useRef(false);
  const autoRevealRafRef = useRef(null);
  const lastPointRef = useRef(null);
  const lastScratchTimeRef = useRef(null);
  const revealTriggeredRef = useRef(false);
  const scratchGridRef = useRef(new Uint8Array(SCRATCH_GRID_SIZE));
  const scratchedCellCountRef = useRef(0);
  const lastScratchPercentRef = useRef(0);

  const [status, setStatus] = useState("ready");
  const [result, setResult] = useState(null);
  const [chargeMeta, setChargeMeta] = useState(null);
  const [scratchPercent, setScratchPercent] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [coverOpacity, setCoverOpacity] = useState(1);

  const currentDailyCount = Number(scratchUsage?.daily || 0);
  const dailyLimitNum = Number(dailyLimit || 0);
  const hasDailyLimit =
    !isTeacher && Number.isFinite(dailyLimitNum) && dailyLimitNum > 0;
  const remainingBeforeCharge = hasDailyLimit
    ? Math.max(dailyLimitNum - currentDailyCount, 0)
    : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d");
    const { width, height } = canvas;
    let cancelled = false;

    const drawFoil = (foilImage) => {
      if (cancelled) return;

      context.clearRect(0, 0, width, height);
      const baseGradient = context.createLinearGradient(0, 0, width, height);
      baseGradient.addColorStop(0, "#a1a7aa");
      baseGradient.addColorStop(0.5, "#d1d5d5");
      baseGradient.addColorStop(1, "#949da0");
      context.fillStyle = baseGradient;
      context.fillRect(0, 0, width, height);

      if (foilImage) {
        context.save();
        context.globalAlpha = 0.32;
        context.filter = "grayscale(1)";
        const scale = Math.max(width / foilImage.width, height / foilImage.height);
        const drawWidth = foilImage.width * scale;
        const drawHeight = foilImage.height * scale;
        context.drawImage(
          foilImage,
          (width - drawWidth) / 2,
          (height - drawHeight) / 2,
          drawWidth,
          drawHeight,
        );
        context.restore();
      }

      const sheen = context.createLinearGradient(0, 0, width, height);
      sheen.addColorStop(0, "rgba(255, 255, 255, 0.34)");
      sheen.addColorStop(0.42, "rgba(255, 255, 255, 0.04)");
      sheen.addColorStop(0.7, "rgba(71, 85, 105, 0.12)");
      sheen.addColorStop(1, "rgba(255, 255, 255, 0.2)");
      context.fillStyle = sheen;
      context.fillRect(0, 0, width, height);

      // Fine engraved lines and a bevel belong to the foil and erase with it.
      context.strokeStyle = "rgba(255,255,255,0.12)";
      context.lineWidth = 0.5;
      for (let y = 1; y < height; y += 3) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y - 12);
        context.stroke();
      }
      context.strokeStyle = "rgba(255,255,255,0.6)";
      context.strokeRect(1, 1, width - 2, height - 2);
      context.strokeStyle = "rgba(51,65,85,0.3)";
      context.strokeRect(3, 3, width - 6, height - 6);

      context.fillStyle = "rgba(15, 23, 42, 0.7)";
      context.font = '600 16px "Pretendard"';
      context.textAlign = "center";
      context.fillText("긁어서 결과 확인", width / 2, height / 2 + 8);
    };

    drawFoil(null);

    const foilImage = new Image();
    foilImage.decoding = "async";
    foilImage.onload = () => {
      if (scratchedCellCountRef.current === 0) drawFoil(foilImage);
    };
    foilImage.src = scratchFoilTexture;

    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    return () => {
      if (autoRevealRafRef.current) {
        window.cancelAnimationFrame(autoRevealRafRef.current);
      }
    };
  }, []);

  const updateScratchPercent = useCallback(() => {
    const nextPercent = Math.round(
      (scratchedCellCountRef.current / SCRATCH_GRID_SIZE) * 100,
    );

    if (nextPercent === lastScratchPercentRef.current) {
      return nextPercent;
    }

    lastScratchPercentRef.current = nextPercent;
    setScratchPercent(nextPercent);
    return nextPercent;
  }, []);

  const markScratchedCircle = useCallback((x, y, radius, canvas) => {
    const grid = scratchGridRef.current;
    const cellWidth = canvas.width / SCRATCH_GRID_COLS;
    const cellHeight = canvas.height / SCRATCH_GRID_ROWS;
    const minCol = Math.max(0, Math.floor((x - radius) / cellWidth));
    const maxCol = Math.min(
      SCRATCH_GRID_COLS - 1,
      Math.floor((x + radius) / cellWidth),
    );
    const minRow = Math.max(0, Math.floor((y - radius) / cellHeight));
    const maxRow = Math.min(
      SCRATCH_GRID_ROWS - 1,
      Math.floor((y + radius) / cellHeight),
    );

    let touchedNewCell = false;

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const index = row * SCRATCH_GRID_COLS + col;
        if (grid[index]) continue;

        const centerX = (col + 0.5) * cellWidth;
        const centerY = (row + 0.5) * cellHeight;
        const dx = centerX - x;
        const dy = centerY - y;

        if (dx * dx + dy * dy <= radius * radius * 1.15) {
          grid[index] = 1;
          scratchedCellCountRef.current += 1;
          touchedNewCell = true;
        }
      }
    }

    return touchedNewCell;
  }, []);

  const startAutoReveal = useCallback(() => {
    if (autoRevealRafRef.current) {
      window.cancelAnimationFrame(autoRevealRafRef.current);
    }

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const startedAt = window.performance.now();

    const animate = (now) => {
      const progress = Math.min(
        1,
        (now - startedAt) / AUTO_REVEAL_DURATION_MS,
      );
      const easedProgress = easeOutCubic(progress);

      setCoverOpacity(1 - easedProgress);

      if (canvas && context) {
        context.save();
        context.globalCompositeOperation = "destination-out";
        context.globalAlpha = 0.12 + easedProgress * 0.34;
        context.beginPath();
        context.ellipse(
          canvas.width / 2,
          canvas.height / 2,
          canvas.width * (0.18 + easedProgress * 0.46),
          canvas.height * (0.24 + easedProgress * 0.52),
          0,
          0,
          Math.PI * 2,
        );
        context.fill();
        context.restore();
      }

      if (progress < 1) {
        autoRevealRafRef.current = window.requestAnimationFrame(animate);
        return;
      }

      if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
      setCoverOpacity(0);
      setStatus("revealed");
    };

    autoRevealRafRef.current = window.requestAnimationFrame(animate);
  }, []);

  const triggerPayment = async () => {
    if (isProcessingRef.current || result) return;
    isProcessingRef.current = true;

    try {
      const response = await playScratch(classId, {
        paymentType: isTicketUsed ? "ticket" : "cash",
      });

      if (!response?.success) {
        throw new Error(response.message || "Scratch payment failed.");
      }

      const serverResult = response.result || {};
      const safePrice = Number(price) || 0;

      setResult({
        ...serverResult,
        amount:
          serverResult.amount ??
          (serverResult.type === "money" || serverResult.type === "bundle"
            ? safePrice * (Number(serverResult.multiplier) || 0)
            : 0),
        netChange: response.netChange ?? 0,
      });

      setChargeMeta({
        chargedAt: response.chargedAt || null,
        attemptNumberToday: Number.isFinite(Number(response.attemptNumberToday))
          ? Number(response.attemptNumberToday)
          : currentDailyCount + 1,
        remainingToday:
          response.remainingToday == null
            ? null
            : Math.max(Number(response.remainingToday), 0),
      });
    } catch (error) {
      showFeedback(error?.message || "Unable to process scratch card.", "error");
      onClose?.();
    } finally {
      isProcessingRef.current = false;
    }
  };

  useEffect(() => {
    if (
      result &&
      scratchPercent >= REVEAL_THRESHOLD &&
      !revealTriggeredRef.current &&
      status === "ready"
    ) {
      revealTriggeredRef.current = true;
      setShowResult(true);
      setStatus("finishing");
      startAutoReveal();
    }
  }, [result, scratchPercent, startAutoReveal, status]);

  const handleScratch = (event) => {
    if (status !== "ready") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? null;
    const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? null;
    if (clientX == null || clientY == null) return;

    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    const nextPoint = { x, y };
    const previousPoint = lastPointRef.current;
    const now = window.performance.now();
    const previousTime = lastScratchTimeRef.current;

    context.globalCompositeOperation = "destination-out";
    context.lineCap = "round";
    context.lineJoin = "round";

    const dx = previousPoint ? nextPoint.x - previousPoint.x : 0;
    const dy = previousPoint ? nextPoint.y - previousPoint.y : 0;
    const distance = previousPoint ? Math.hypot(dx, dy) : 0;
    const deltaMs = previousPoint && previousTime ? Math.max(now - previousTime, 1) : 0;
    const speed = deltaMs > 0 ? distance / deltaMs : 0;
    const brushSize = Math.max(
      22,
      Math.min(46, BASE_BRUSH_SIZE + speed * 13),
    );
    const steps = Math.max(1, Math.ceil(distance / (brushSize * 0.32)));
    let scratchedNewArea = false;

    for (let step = 0; step < steps; step += 1) {
      const ratio = previousPoint ? (step + 1) / steps : 1;
      const baseX = previousPoint ? previousPoint.x + dx * ratio : nextPoint.x;
      const baseY = previousPoint ? previousPoint.y + dy * ratio : nextPoint.y;
      const strokeStartRatio = previousPoint ? step / steps : 0;
      const strokeEndRatio = previousPoint ? (step + 1) / steps : 1;
      const strokeStartX = previousPoint
        ? previousPoint.x + dx * strokeStartRatio
        : baseX - brushSize * 0.3;
      const strokeStartY = previousPoint
        ? previousPoint.y + dy * strokeStartRatio
        : baseY;
      const strokeEndX = previousPoint
        ? previousPoint.x + dx * strokeEndRatio
        : baseX + brushSize * 0.3;
      const strokeEndY = previousPoint
        ? previousPoint.y + dy * strokeEndRatio
        : baseY;
      const strokeDx = strokeEndX - strokeStartX;
      const strokeDy = strokeEndY - strokeStartY;
      const strokeLength = Math.max(Math.hypot(strokeDx, strokeDy), 1);
      const normalX = -strokeDy / strokeLength;
      const normalY = strokeDx / strokeLength;

      for (let streak = -1; streak <= 1; streak += 1) {
        const offset = streak * brushSize * 0.16 + (Math.random() - 0.5) * 2;
        context.globalAlpha = 0.5 + Math.random() * 0.3;
        context.lineWidth = brushSize * (0.2 + Math.random() * 0.12);
        context.beginPath();
        context.moveTo(
          strokeStartX + normalX * offset,
          strokeStartY + normalY * offset,
        );
        context.lineTo(
          strokeEndX + normalX * offset,
          strokeEndY + normalY * offset,
        );
        context.stroke();
      }

      if (markScratchedCircle(baseX, baseY, brushSize * 0.48, canvas)) {
        scratchedNewArea = true;
      }

      for (let dab = 0; dab < 3; dab += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radiusSpread = Math.random() * brushSize * 0.42;
        const dabRadius = brushSize * (0.1 + Math.random() * 0.14);

        context.globalAlpha = 0.46 + Math.random() * 0.46;
        context.beginPath();
        context.arc(
          baseX + Math.cos(angle) * radiusSpread,
          baseY + Math.sin(angle) * radiusSpread,
          dabRadius,
          0,
          Math.PI * 2,
        );
        context.fill();

        if (markScratchedCircle(
          baseX + Math.cos(angle) * radiusSpread,
          baseY + Math.sin(angle) * radiusSpread,
          dabRadius,
          canvas,
        )) {
          scratchedNewArea = true;
        }
      }
    }

    context.globalAlpha = 1;
    context.lineWidth = 1;
    context.lineCap = "butt";
    lastPointRef.current = nextPoint;
    lastScratchTimeRef.current = now;

    if (scratchedNewArea) {
      const nextPercent = updateScratchPercent();
      if (
        nextPercent >= PAYMENT_TRIGGER_THRESHOLD &&
        !result &&
        !isProcessingRef.current
      ) {
        triggerPayment();
      }
    }
  };

  const handleScratchEnd = useCallback(() => {
    lastPointRef.current = null;
    lastScratchTimeRef.current = null;
  }, []);

  const handleCloseAttempt = () => {
    if (isProcessingRef.current || result) {
      setShowExitConfirm(true);
      return;
    }

    onClose?.();
  };

  const handleActualClose = () => {
    if (result && onComplete) onComplete(result);
    onClose?.();
  };

  const netChange = Number(result?.netChange) || 0;
  const hasItemPayout = resultHasItemReward(result);
  const hasCashPayout = Number(result?.amount || 0) > 0;
  const chargedTimeText = chargeMeta?.chargedAt
    ? new Date(chargeMeta.chargedAt).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;
  const attemptCount = Number.isFinite(Number(chargeMeta?.attemptNumberToday))
    ? Number(chargeMeta.attemptNumberToday)
    : currentDailyCount;
  const remainingCount = chargeMeta
    ? chargeMeta.remainingToday == null
      ? null
      : Number(chargeMeta.remainingToday)
    : remainingBeforeCharge;
  const usedTodayCount = hasDailyLimit
    ? Math.max(dailyLimitNum - Math.max(remainingCount ?? 0, 0), 0)
    : attemptCount;
  const usedRatio = hasDailyLimit
    ? Math.min((usedTodayCount / Math.max(dailyLimitNum, 1)) * 100, 100)
    : 0;
  const revealProgress = result
    ? Math.min(showResult ? 1 : scratchPercent / REVEAL_THRESHOLD, 1)
    : 0;
  const previewOpacity = result ? 0.16 + revealProgress * 0.84 : 1;
  const previewBlur = result ? Math.max((1 - revealProgress) * 12, 0) : 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
      onMouseUp={handleScratchEnd}
      onTouchEnd={handleScratchEnd}
    >
      <div className="arcade-game-dialog arcade-game-dialog--scratch relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[2.5rem] border border-emerald-100/90 bg-gradient-to-b from-white to-emerald-50/75 shadow-[0_28px_72px_rgba(2,6,23,0.45)] animate-in zoom-in-95 duration-200">

        <Button
          aria-label="스크래치 닫기"
          onClick={handleCloseAttempt}
          className="arcade-game-close absolute right-6 top-6 z-50 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          <X size={20} />
        </Button>

        <div className="arcade-game-header relative z-10 px-5 pb-4 pt-6 pr-16 text-left sm:px-7">
<span className="arcade-game-kicker" aria-hidden="true">ARCADE · SCRATCH</span>
          <h3 className="mt-3 text-[28px] font-black tracking-tight text-slate-800 sm:text-[32px]">
            스크래치 복권
          </h3>
          <ArcadeInfoChip tone="emerald" className="mx-auto mt-2 text-[11px]">
            {formatArcadeChargeDetail({formatAmount: formatDisplayMoney,
              price,
              feeAmount,
              isTicketUsed,
              currencyName,
            })}
          </ArcadeInfoChip>
        </div>

        <div className="relative z-10 px-5 pb-6 sm:px-7">
          <div className="arcade-game-note mb-4">
            <p className="text-[10px] font-black text-slate-500">플레이 안내</p>
            <p className="mt-1 text-[11px] font-bold leading-relaxed text-slate-700">
              일정 이상 긁으면 결제가 진행됩니다. 끝까지 긁으면 결과가 공개되고,
              이후 닫아도 보상과 정산은 정상 반영됩니다.
            </p>
          </div>

          <div className="arcade-game-stats mb-5 border-y border-slate-200 py-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] font-black text-slate-500">결제 시각</p>
                <p className="mt-1 text-[12px] font-black text-slate-800">
                  {chargeMeta ? chargedTimeText || "기록됨" : "대기 중"}
                </p>
              </div>
              <div className="border-x border-slate-100">
                <p className="text-[10px] font-black text-slate-500">오늘 시도</p>
                <p className="mt-1 text-[12px] font-black text-slate-800">
                  {attemptCount}회
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-500">오늘 남은 횟수</p>
                <p className="mt-1 text-[12px] font-black text-slate-800">
                  {remainingCount == null ? "무제한" : `${Math.max(remainingCount, 0)}`}
                </p>
              </div>
            </div>

            {hasDailyLimit ? (
              <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2">
                <div className="mb-1 flex items-center justify-between text-[10px] font-black text-slate-500">
                  <span>오늘 사용량</span>
                  <span>
                    {usedTodayCount}/{dailyLimitNum}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-300"
                    style={{
                      width: `${Math.max(usedRatio, usedTodayCount > 0 ? 6 : 0)}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="arcade-scratch-ticket">
            <div className="arcade-scratch-ticket-heading">
              <span className="arcade-ticket-mark" aria-hidden="true"><Sparkles size={20} /></span>
              <div>
                <p className="arcade-scratch-ticket-edition">FINCLASS · GAME TICKET</p>
                <p className="arcade-scratch-ticket-label">행운의 스크래치</p>
              </div>
              <span className="arcade-ticket-stamp" aria-hidden="true">행운<br />한 장</span>
            </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-slate-300 bg-[#fffaf0] shadow-[inset_0_1px_5px_rgba(86,69,39,0.12)]">
            <div className="pointer-events-none absolute -left-8 -top-10 h-32 w-32 rounded-full bg-cyan-100/60 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-10 -right-8 h-32 w-32 rounded-full bg-emerald-100/60 blur-2xl" />

            <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
              {result ? (
                <div
                  className="transition-all duration-300"
                  style={{
                    opacity: previewOpacity,
                    transform: `scale(${0.92 + revealProgress * 0.08})`,
                    filter: `blur(${previewBlur}px)`,
                  }}
                >
                  <div className="mb-3 flex justify-center">
                    {getResultIcon(result, price)}
                  </div>
                  <h4 className="text-xl font-black tracking-tight text-slate-700">
                    {result.label}
                  </h4>
                  {hasCashPayout ? (
                    <div className="mt-1 text-4xl font-black text-emerald-600">
                      +{fmt(result.amount)}
                    </div>
                  ) : null}
                  {hasItemPayout ? (
                    <div className="mt-2 inline-flex rounded-full bg-pink-100 px-3 py-1 text-sm font-black text-pink-600">
                      아이템 보상 포함
                    </div>
                  ) : null}
                </div>
              ) : (
                <span className="px-5 text-xs font-bold leading-relaxed text-slate-500">
                  충분히 긁으면 결과를 확인할 수 있어요.
                </span>
              )}
            </div>

            {status !== "revealed" ? (
              <canvas
                ref={canvasRef}
                width={400}
                height={300}
                className={`absolute inset-0 z-20 h-full w-full touch-none transition-opacity duration-200 ${
                  status === "ready" ? "cursor-pointer" : ""
                }`}
                style={{ opacity: coverOpacity }}
                onMouseMove={(event) => event.buttons === 1 && handleScratch(event)}
                onMouseDown={handleScratch}
                onMouseLeave={handleScratchEnd}
                onTouchMove={handleScratch}
                onTouchStart={handleScratch}
                onTouchCancel={handleScratchEnd}
              />
            ) : null}
          </div>
            <div className="arcade-scratch-ticket-footer">
              <span>은박을 긁어 숨겨진 결과를 확인하세요</span>
              <span className="arcade-ticket-bars" aria-hidden="true" />
            </div>
          </div>

          <div className="mt-6">
            {status === "revealed" ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
                <p className="text-[11px] font-black tracking-wider text-slate-400">
                  결과 확인
                </p>
                <div
                  className={`mt-1 text-2xl font-black ${
                    netChange >= 0 ? "text-emerald-600" : "text-rose-500"
                  }`}
                >
                  {result?.type === "item"
                    ? "아이템 보상 지급 완료"
                    : `${netChange >= 0 ? "+" : ""}${fmt(netChange)} ${currencyName}`}
                </div>
                <Button
                  onClick={handleActualClose}
                  className="mt-5 w-full rounded-2xl bg-slate-900 py-3.5 text-lg font-black text-white transition-all active:scale-95"
                >
                  확인하고 닫기
                </Button>
              </div>
            ) : (
              <div className="rounded-[1.35rem] border border-emerald-100 bg-emerald-50/65 px-4 py-3">
                <div className="mb-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-200"
                    style={{
                      width: `${Math.min(
                        (scratchPercent / REVEAL_THRESHOLD) * 100,
                        100,
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-center text-[11px] font-black text-slate-500">
                  {scratchPercent < 5
                    ? "카드를 긁어 결과를 확인하세요."
                    : scratchPercent < REVEAL_THRESHOLD
                      ? `${scratchPercent}% 공개됨`
                      : "거의 다 왔어요. 결과가 곧 공개됩니다."}
                </p>
              </div>
            )}
          </div>
        </div>

        {showExitConfirm ? (
          <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-white/95 p-10 text-center backdrop-blur-sm">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50">
              <AlertCircle size={36} className="text-rose-500" />
            </div>
            <h4 className="text-2xl font-black text-slate-800">스크래치를 종료할까요?</h4>
            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
              지금 나가면 진행 중인 결과를 끝까지 확인할 수 없습니다.
              <br />
              결제가 진행된 뒤에는 결과 확인 후 닫는 것을 권장합니다.
            </p>
            <div className="mt-6 flex w-full flex-col gap-2.5">
              <Button
                onClick={() => setShowExitConfirm(false)}
                className="w-full rounded-2xl bg-emerald-500 py-3.5 text-lg font-black text-white transition-all active:scale-95"
              >
                계속 진행하기
              </Button>
              <Button
                onClick={handleActualClose}
                className="w-full rounded-2xl py-2.5 text-sm font-bold text-slate-400"
              >
                나가기
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ScratchCard;
