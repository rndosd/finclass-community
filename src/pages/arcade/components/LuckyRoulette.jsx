import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Frown,
  Gift,
  Play,
  RotateCw,
  Star,
  Trophy,
  X,
} from "lucide-react";

import { useFeedback } from "../../../contexts/FeedbackContext";
import { formatArcadeChargeDetail } from "../utils/chargeUtils";
import { playRoulette } from "../services/arcadeServices";
import { Button } from "../../../components/ui";
import rouletteMarqueeRim from "../../../assets/arcade/roulette-matte-rim-v3.svg";
import "./arcadeMaterials.css";

const ROULETTE_SPIN_DURATION_MS = 6100;
const ROULETTE_REVEAL_DELAY_MS = 900;

const normalizeAngle = (angle) => {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const easeOutQuint = (progress) => 1 - Math.pow(1 - progress, 5);

const mapSpinProgress = (progress) => {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;

  // Keep the spin curve continuous so it never "bumps" mid-way.
  return easeOutQuint(progress);
};

const isLightHexColor = (color) => {
  if (typeof color !== "string" || !color.startsWith("#")) return false;

  let hex = color.slice(1);
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }

  if (hex.length !== 6) return false;

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((value) => Number.isNaN(value))) return false;

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance >= 0.72;
};

const getSegmentPath = (startPercent, endPercent) => {
  const startAngle = (startPercent / 100) * 360 - 90;
  const endAngle = (endPercent / 100) * 360 - 90;
  const x1 = 50 + 45 * Math.cos((Math.PI * startAngle) / 180);
  const y1 = 50 + 45 * Math.sin((Math.PI * startAngle) / 180);
  const x2 = 50 + 45 * Math.cos((Math.PI * endAngle) / 180);
  const y2 = 50 + 45 * Math.sin((Math.PI * endAngle) / 180);
  const largeArcFlag = endPercent - startPercent > 50 ? 1 : 0;

  return `M 50 50 L ${x1} ${y1} A 45 45 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;
};

const getCompactWheelLabel = (label, chance, index, fontSize, measureText) => {
  const value = String(label || "").trim();
  if (!value || chance <= 0) return "";
  // Fit inside the chord at the label's radius, allowing for its height.
  const radius = 23 - fontSize * 0.55;
  const availableWidth = Math.max(0, 2 * radius * Math.sin(Math.min(chance, 50) * Math.PI / 100) - 2);
  const measure = measureText || ((text) => Array.from(text).reduce(
    (width, char) => width + fontSize * (/^[\x20-\x7e]$/.test(char) ? 0.65 : 1), 0,
  ));
  if (chance < 10) {
    const number = String(index + 1);
    return measure(number) <= availableWidth ? number : "";
  }
  if (measure(value) <= availableWidth) return value;
  const chars = typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(value), (part) => part.segment)
    : Array.from(value);
  let short = "";
  for (const char of chars) {
    if (measure(`${short}${char}…`) > availableWidth) break;
    short += char;
  }
  const number = String(index + 1);
  return short ? `${short.trimEnd()}…` : measure(number) <= availableWidth ? number : "";
};

const LuckyRoulette = ({
  classId,
  allPrizes = [],
  price = 50,
  feeAmount = 0,
  isTicketUsed = false,
  currencyName = "coins",
  onComplete,
  onClose,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { showFeedback } = useFeedback();

  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [highlightedPrizeId, setHighlightedPrizeId] = useState(null);
  const [spinPhase, setSpinPhase] = useState("idle");

  const revealTimerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const rotationRef = useRef(0);
  const lastNeedlePrizeIdRef = useRef(null);
  const needleRef = useRef(null);
  const wheelRef = useRef(null);
  const labelRefs = useRef([]);
  const [fittedLabels, setFittedLabels] = useState({ ranges: null, labels: [] });

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
      if (animationFrameRef.current) window.cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  const prizeRanges = useMemo(() => {
    let total = 0;

    return allPrizes.map((prize) => {
      const chance = Number(prize.chance) || 0;
      const start = total;
      total += chance;
      const end = total;
      const startAngleDeg = start * 3.6;
      const endAngleDeg = end * 3.6;
      const midAngleDeg = ((start + end) / 2) * 3.6;
      const lightColor = isLightHexColor(prize.color);
      const fontSize = chance < 10 ? "3.7px" : chance < 18 ? "4.6px" : "5.4px";

      return {
        ...prize,
        start,
        end,
        startAngleDeg,
        endAngleDeg,
        midAngleDeg,
        fontSize,
        labelFill: lightColor ? "#0f172a" : "#ffffff",
        labelStroke: lightColor
          ? "rgba(255,255,255,0.5)"
          : "rgba(2,6,23,0.45)",
      };
    });
  }, [allPrizes]);

  useEffect(() => {
    let cancelled = false;
    const fitLabels = () => {
      if (cancelled) return;
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return;
      const labels = prizeRanges.map((prize, index) => {
        const textNode = labelRefs.current[index];
        const family = textNode ? window.getComputedStyle(textNode).fontFamily : "sans-serif";
        context.font = `950 ${prize.fontSize} ${family}`;
        return getCompactWheelLabel(prize.label, Number(prize.chance) || 0, index,
          parseFloat(prize.fontSize), (text) => context.measureText(text).width);
      });
      setFittedLabels({ ranges: prizeRanges, labels });
    };
    fitLabels();
    document.fonts?.ready.then(fitLabels);
    return () => { cancelled = true; };
  }, [prizeRanges]);

  const getPrizeUnderNeedle = (wheelRotation) => {
    if (!prizeRanges.length) return null;

    const pointerAngle = normalizeAngle(360 - normalizeAngle(wheelRotation));
    return (
      prizeRanges.find(
        (prize) =>
          pointerAngle >= prize.startAngleDeg && pointerAngle < prize.endAngleDeg,
      ) || prizeRanges[0]
    );
  };

  const triggerNeedleTick = (progress = 0) => {
    if (!needleRef.current) return;

    const nearEnd = progress > 0.74;
    const amplitude = nearEnd ? 10 : 6;
    const duration = nearEnd ? 150 : 95;

    needleRef.current.animate(
      [
        { transform: "translateX(-50%) rotate(0deg)" },
        { transform: `translateX(-50%) rotate(${amplitude}deg)` },
        { transform: "translateX(-50%) rotate(0deg)" },
      ],
      {
        duration,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
  };

  const handleStartSpin = async () => {
    if (spinning || result || !prizeRanges.length) return;

    try {
      setSpinning(true);
      setSpinPhase("charging");
      setShowResultModal(false);
      setHighlightedPrizeId(null);
      const response = await playRoulette(classId, {
        paymentType: isTicketUsed ? "ticket" : "cash",
      });

      if (!response.success) {
        throw new Error(response.message || "룰렛 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }

      const targetPrize =
        prizeRanges.find((prize) => prize.id === response.result?.id) ||
        prizeRanges[0];
      const startRotation = rotationRef.current;
      const fullTurns = targetPrize?.chance >= 15 ? 8 : 10;
      const finalRotation =
        startRotation + 360 * fullTurns + (360 - (targetPrize?.midAngleDeg || 0));

      setResult({
        ...response.result,
        amount:
          response.result?.type === "money" || response.result?.type === "bundle"
            ? response.result?.amount ??
              response.prizeAmount ??
              Number(price || 0) * (Number(response.result?.multiplier) || 0)
            : 0,
      });
      setSpinPhase("spinning");
      lastNeedlePrizeIdRef.current = getPrizeUnderNeedle(startRotation)?.id || null;

      const applyRotation = (nextRotation, progress = 0) => {
        rotationRef.current = nextRotation;
        if (wheelRef.current) {
          wheelRef.current.style.transform = `rotate(${nextRotation}deg)`;
        }

        const currentPrize = getPrizeUnderNeedle(nextRotation);
        if (currentPrize?.id && currentPrize.id !== lastNeedlePrizeIdRef.current) {
          lastNeedlePrizeIdRef.current = currentPrize.id;
          triggerNeedleTick(progress);
        }
      };

      const animationStartAt = window.performance.now();
      const animate = (now) => {
        const progress = Math.min(
          1,
          (now - animationStartAt) / ROULETTE_SPIN_DURATION_MS,
        );
        const distanceProgress = mapSpinProgress(progress);
        const nextRotation =
          startRotation +
          (finalRotation - startRotation) * distanceProgress;

        applyRotation(nextRotation, progress);

        if (progress < 1) {
          animationFrameRef.current = window.requestAnimationFrame(animate);
          return;
        }

        applyRotation(finalRotation, 1);
        setSpinning(false);
        setSpinPhase("revealing");
        setHighlightedPrizeId(targetPrize?.id || null);
        // The needle only ticks when a segment crosses it, never after stopping.
        revealTimerRef.current = window.setTimeout(() => {
          setShowResultModal(true);
          setSpinPhase("result");
        }, ROULETTE_REVEAL_DELAY_MS);
      };

      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = window.requestAnimationFrame(animate);
    } catch (error) {
      showFeedback(
        error?.message || "룰렛을 처리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        "error",
      );
      setSpinning(false);
      setSpinPhase("idle");
      setHighlightedPrizeId(null);
      setResult(null);
    }
  };

  const handleCloseAttempt = () => {
    if (spinning || (result && !showResultModal)) {
      setShowExitConfirm(true);
      return;
    }

    onClose?.();
  };

  const handleActualClose = () => {
    if (result && onComplete) onComplete(result);
    onClose?.();
  };

  const hasItemPayout =
    Boolean(result?.itemName || result?.itemId) ||
    result?.type === "item" ||
    result?.type === "bundle";
  const winByMoney =
    Number(result?.amount) > 0 || Number(result?.multiplier) > 0;
  const isWin = hasItemPayout || winByMoney;
  const chargeDetail = formatArcadeChargeDetail({formatAmount: formatDisplayMoney,
    price,
    feeAmount,
    isTicketUsed,
    currencyName,
  });
  const isInteractionLocked = spinning || spinPhase === "revealing" || Boolean(result);
  const helpText =
    spinPhase === "charging"
      ? "회전 준비 중입니다. 잠시만 기다려 주세요."
      : spinPhase === "spinning"
        ? "룰렛이 돌아가는 중입니다. 결과가 결정되면 자동으로 멈춥니다."
        : spinPhase === "revealing"
          ? "결과를 정리하고 있습니다. 곧 보상을 확인할 수 있어요."
          : "버튼을 눌러 룰렛을 돌려 보세요.";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="arcade-game-dialog arcade-game-dialog--roulette relative max-h-[92vh] w-full max-w-lg overflow-x-hidden overflow-y-auto rounded-[2.75rem] border border-teal-100/90 bg-gradient-to-b from-white to-teal-50 px-5 pb-6 pt-5 shadow-[0_34px_84px_rgba(2,6,23,0.45)] sm:px-8 sm:pb-6 sm:pt-6">

        <Button
          aria-label="룰렛 닫기"
          onClick={handleCloseAttempt}
          className="arcade-game-close absolute right-5 top-5 z-50 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          <X size={20} />
        </Button>

        <div className="arcade-game-header relative z-10 pr-12 text-left">
<span className="arcade-game-kicker" aria-hidden="true">ARCADE · LUCKY WHEEL</span>
          <h3 className="mt-2 text-[30px] font-black tracking-tight text-slate-800 sm:text-[34px]">
            행운의 룰렛
          </h3>
          <p className="mt-1 text-[12px] font-bold text-slate-500">
            버튼을 눌러 룰렛을 돌리고 멈춘 칸의 보상을 바로 확인해 보세요.
          </p>
        </div>

        <div className="arcade-game-note relative z-10 mx-auto mt-4 max-w-sm border-y border-slate-200 py-3">
          <div className="flex items-center justify-between text-[11px] font-black">
            <span className="text-slate-500">입장 비용</span>
            <span className="text-slate-800">{chargeDetail}</span>
          </div>
          <p className="mt-1 text-[10px] font-bold text-teal-800/70">
            입장 후에는 결과가 확정될 때까지 화면을 닫지 마세요.
          </p>
        </div>

        <div className="relative z-10 mx-auto mt-5 flex aspect-square w-full max-w-[350px] items-center justify-center">
          <img
            src={rouletteMarqueeRim}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 h-full w-full select-none object-contain drop-shadow-[0_5px_5px_rgba(63,58,44,0.14)]"
          />
          <div className="absolute inset-[6%] z-[1] rounded-full bg-[radial-gradient(circle_at_35%_28%,#ffffff_0%,#f8fafc_62%,#e2e8f0_100%)] shadow-[inset_0_1px_16px_rgba(15,23,42,0.08)]" />

          <div
            ref={needleRef}
            className="absolute left-1/2 z-30 w-7"
            style={{
              top: "calc(11.75% - 40px)",
              transform: "translateX(-50%)",
              transformOrigin: "center 14px",
            }}
          >
            <div className="arcade-wheel-needle-pin mx-auto h-7 w-7 rounded-full" />
            <div className="arcade-wheel-needle mx-auto -mt-1 h-0 w-0 border-x-[11px] border-t-[24px] border-x-transparent" />
          </div>

          {highlightedPrizeId ? (
            <div className="pointer-events-none absolute inset-[8%] rounded-full border-[6px] border-amber-300/80 shadow-[0_0_30px_rgba(251,191,36,0.35)] animate-pulse" />
          ) : null}

          <div className="arcade-wheel-face relative z-10 h-[85%] w-[85%] overflow-hidden rounded-full border-[5px] border-[#6f8076] bg-[#f9f5e9] shadow-[0_3px_0_#526358,0_6px_10px_rgba(15,23,42,0.15)]">
            <div
              ref={wheelRef}
              className="h-full w-full will-change-transform"
              style={{ transform: `rotate(${rotationRef.current}deg)` }}
            >
              <svg viewBox="0 0 100 100" className="h-full w-full">
                <defs>
                  {prizeRanges.map((prize, index) => (
                    <linearGradient
                      key={`roulette-segment-gradient-${index}`}
                      id={`roulette-segment-${index}`}
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="100%"
                    >
                      <stop offset="0%" stopColor={prize.color} stopOpacity="1" />
                      <stop offset="100%" stopColor={prize.color} stopOpacity="0.72" />
                    </linearGradient>
                  ))}
                </defs>

                {prizeRanges.map((prize, index) => {
                  const isHighlighted = highlightedPrizeId === prize.id;
                  const compactLabel = fittedLabels.ranges === prizeRanges
                    ? fittedLabels.labels[index]
                    : getCompactWheelLabel(prize.label, Number(prize.chance) || 0, index, parseFloat(prize.fontSize));
                  const labelColor = prize.labelFill;

                  return (
                    <g key={prize.id}>
                      <title>{prize.label}</title>
                      <path
                        d={getSegmentPath(prize.start, prize.end)}
                        fill={`url(#roulette-segment-${index})`}
                        stroke={isHighlighted ? "#fef3c7" : "white"}
                        strokeWidth={isHighlighted ? "1.6" : "0.65"}
                        style={{
                          filter: isHighlighted
                            ? "saturate(0.78) drop-shadow(0 0 8px rgba(251,191,36,0.6))"
                            : "saturate(0.78)",
                        }}
                      />
                      <g transform={`rotate(${prize.midAngleDeg}, 50, 50)`}>
                        <text
                          ref={(node) => { labelRefs.current[index] = node; }}
                          x="50"
                          y="27"
                          textAnchor="middle"
                          style={{
                            fontSize: prize.fontSize,
                            fontWeight: 950,
                            fill: labelColor,
                            paintOrder: "stroke",
                            stroke: prize.labelStroke,
                            strokeWidth: "0.16px",
                            letterSpacing: "0",
                          }}
                        >
                          {compactLabel}
                        </text>
                      </g>
                    </g>
                  );
                })}

                <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.62)" strokeWidth="0.9" />
                <circle cx="50" cy="50" r="39" fill="none" stroke="rgba(15,23,42,0.12)" strokeWidth="0.55" />
              </svg>
            </div>

            <div className="arcade-wheel-hub absolute left-1/2 top-1/2 z-20 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-[#788578]">
              <Star size={22} className="fill-[#9d8153] text-[#9d8153]" />
            </div>
          </div>
        </div>

        <div className="relative z-10 mt-5 flex flex-col items-center">
          <Button
            onClick={handleStartSpin}
            disabled={isInteractionLocked}
            className={`inline-flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-xl px-6 text-base font-semibold transition-all active:scale-95 ${
              isInteractionLocked
                ? "border-slate-200 bg-slate-100 text-slate-300"
                : "arcade-game-primary bg-indigo-600 text-white hover:bg-indigo-700"
            }`}
          >
            {spinning || spinPhase === "charging" ? (
              <RotateCw className="animate-spin" size={22} />
            ) : (
              <Play size={22} className="fill-current" />
            )}
            <span>
              {spinning || spinPhase === "charging" ? "돌리는 중..." : "룰렛 돌리기"}
            </span>
          </Button>
          <p className="mt-3 text-[11px] font-black text-teal-800/75">{helpText}</p>
        </div>

        <details className="arcade-wheel-prizes relative z-10 mt-5 border-t border-slate-200 pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            상품 이름 전체 보기 · {prizeRanges.length}개
          </summary>
          <p className="mt-2 text-xs text-slate-500">짧은 이름과 번호의 전체 내용을 확인하세요.</p>
          <ol className="mt-3 space-y-2">
            {prizeRanges.map((prize, index) => (
              <li key={prize.id} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200 text-[10px] font-bold">{index + 1}</span>
                <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: prize.color, filter: "saturate(0.78)" }} />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{prize.label}</span>
              </li>
            ))}
          </ol>
        </details>

        {showExitConfirm ? (
          <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/58 p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_26px_60px_rgba(2,6,23,0.35)] animate-in zoom-in-95 duration-200">
              <div className="mb-5 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50">
                  <AlertCircle size={36} className="text-rose-500" />
                </div>
              </div>
              <h4 className="text-2xl font-black text-slate-800">룰렛을 종료할까요?</h4>
              <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
                지금 나가면 진행 중인 결과를 끝까지 확인할 수 없습니다.
                <br />
                결제가 진행된 뒤에는 결과 확인 후 닫는 것을 권장합니다.
              </p>
              <div className="mt-6 flex flex-col gap-2.5">
                <Button
                  onClick={() => setShowExitConfirm(false)}
                  className="w-full rounded-2xl bg-emerald-500 py-3.5 text-lg font-black text-white transition-all active:scale-95"
                >
                  계속 진행하기
                </Button>
                <Button
                  onClick={handleActualClose}
                  className="w-full rounded-2xl border border-slate-200 bg-white py-3 text-sm font-bold text-slate-600 transition-all active:scale-95"
                >
                  나가기
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {showResultModal && result ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/58 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-slate-200 bg-white p-7 text-center [overflow-wrap:anywhere] shadow-[0_26px_60px_rgba(2,6,23,0.35)]">
            <div className="mb-5 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-slate-200 bg-slate-50">
                {hasItemPayout && !winByMoney ? (
                  <Gift size={40} className="text-pink-500" />
                ) : isWin ? (
                  <Trophy size={40} className="text-amber-500" />
                ) : (
                  <Frown size={40} className="text-slate-300" />
                )}
              </div>
            </div>

            <p className="text-[11px] font-black tracking-wider text-slate-400">
              결과 확인
            </p>
            <h2 className="mt-1 text-3xl font-black text-slate-800">
              {result.label}
            </h2>
            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
              {isWin
                ? "축하합니다! 보상을 획득했어요."
                : "아쉽지만 이번에는 당첨되지 않았어요."}
            </p>

            {Number(result.amount) > 0 ? (
              <p className="mt-2 text-xl font-black text-emerald-600">
                +{formatDisplayMoney(Number(result.amount))} {currencyName}
              </p>
            ) : null}
            {hasItemPayout ? (
              <p className="mt-2 text-sm font-bold text-pink-600">
                {result.itemName || result.label} 획득
              </p>
            ) : null}

            <Button
              onClick={handleActualClose}
              className="mt-6 w-full rounded-2xl bg-slate-900 py-3.5 text-lg font-black text-white transition-all active:scale-95"
            >
              확인하고 닫기
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default LuckyRoulette;
