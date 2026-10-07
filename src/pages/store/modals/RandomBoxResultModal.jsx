import React, { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Gift, Sparkles } from "lucide-react";

import { Button, Modal } from "../../../components/ui";

const REEL_CARD_WIDTH = 112;
const REEL_CARD_GAP = 12;
const REEL_STRIDE = REEL_CARD_WIDTH + REEL_CARD_GAP;

const SPIN_CONFIG = {
  normal: {
    cycles: 5,
    startDelay: 120,
    duration: 3200,
    revealDelay: 180,
  },
  premium: {
    cycles: 6,
    startDelay: 150,
    duration: 4300,
    revealDelay: 240,
  },
};

const BOX_VISUALS = {
  normal: {
    label: "일반 박스",
    accentIcon: "bg-amber-100 text-amber-700",
    background: "from-amber-50 via-white to-sky-50 ring-amber-100",
    glow: "bg-amber-200/50",
    reelFrame: "border-amber-100 bg-white/80",
    cardBase: "border-amber-100 bg-white/92",
    winningCard:
      "border-amber-300 bg-gradient-to-br from-amber-100 to-white shadow-amber-100/70",
    resultCard:
      "border-amber-100 bg-gradient-to-br from-white via-amber-50 to-sky-50",
    badge: "bg-amber-100 text-amber-700",
    dot: "bg-amber-400",
  },
  premium: {
    label: "프리미엄 박스",
    accentIcon: "bg-rose-100 text-rose-700",
    background: "from-rose-100 via-amber-50 to-fuchsia-100 ring-rose-100",
    glow: "bg-rose-300/40",
    reelFrame: "border-rose-100 bg-white/82",
    cardBase: "border-rose-100 bg-white/92",
    winningCard:
      "border-rose-300 bg-gradient-to-br from-rose-100 to-white shadow-rose-100/80",
    resultCard:
      "border-rose-100 bg-gradient-to-br from-white via-rose-50 to-amber-50",
    badge: "bg-rose-100 text-rose-700",
    dot: "bg-rose-400",
  },
};

const DECORATION_DELAYS = ["0ms", "160ms", "320ms"];

const normalizeReward = (reward = {}) => ({
  itemId: String(reward?.itemId || "").trim(),
  itemName: String(reward?.itemName || "").trim(),
  quantity: Math.max(1, Math.floor(Number(reward?.quantity || 1))),
});

const buildReel = (result = {}, boxType = "normal") => {
  const previewRewards = Array.isArray(result?.previewRewards)
    ? result.previewRewards.map((reward) => normalizeReward(reward))
    : [];

  const rewardItem = normalizeReward({
    itemId: result?.rewardItemId,
    itemName: result?.rewardItemName || "보상 아이템",
    quantity: result?.rewardQuantity || 1,
  });

  const reelRewards = (previewRewards.filter((reward) => reward.itemName).length
    ? previewRewards.filter((reward) => reward.itemName)
    : [rewardItem]
  ).slice(0, 6);

  const cycleCount = SPIN_CONFIG[boxType]?.cycles || SPIN_CONFIG.normal.cycles;
  const repeatedRewards = Array.from({ length: cycleCount }, () => reelRewards).flat();
  const winningIndex = repeatedRewards.length;
  const entries = [...repeatedRewards, rewardItem, ...reelRewards.slice(0, 2)];
  const travelDistance = Math.max(0, (winningIndex - 1) * REEL_STRIDE);

  return {
    entries,
    winningIndex,
    travelDistance,
  };
};

const easeOutQuint = (progress) => 1 - Math.pow(1 - progress, 5);

const RandomBoxResultModal = ({ isOpen, onClose, result }) => {
  const boxType =
    String(result?.boxType || "normal").trim() === "premium"
      ? "premium"
      : "normal";
  const visuals = useMemo(() => BOX_VISUALS[boxType] || BOX_VISUALS.normal, [boxType]);
  const spinConfig = useMemo(() => SPIN_CONFIG[boxType] || SPIN_CONFIG.normal, [boxType]);
  const reel = useMemo(() => buildReel(result, boxType), [boxType, result]);
  const shouldReduceMotion = useReducedMotion();

  const [phase, setPhase] = useState("idle");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!isOpen || !result) {
      setPhase("idle");
      setOffset(0);
      return undefined;
    }

    let animationFrameId = null;
    let startTimerId = null;
    let revealTimerId = null;
    let isCancelled = false;

    setPhase("spinning");
    setOffset(0);

    startTimerId = window.setTimeout(() => {
      const startAt = window.performance.now();

      const tick = (now) => {
        if (isCancelled) return;

        const progress = Math.min(1, (now - startAt) / spinConfig.duration);
        const easedProgress = easeOutQuint(progress);
        setOffset(Math.round(reel.travelDistance * easedProgress));

        if (progress < 1) {
          animationFrameId = window.requestAnimationFrame(tick);
          return;
        }

        setOffset(reel.travelDistance);
        setPhase("settling");

        revealTimerId = window.setTimeout(() => {
          if (isCancelled) return;
          setPhase("result");
        }, spinConfig.revealDelay);
      };

      animationFrameId = window.requestAnimationFrame(tick);
    }, spinConfig.startDelay);

    return () => {
      isCancelled = true;
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
      if (startTimerId) window.clearTimeout(startTimerId);
      if (revealTimerId) window.clearTimeout(revealTimerId);
    };
  }, [
    isOpen,
    result,
    boxType,
    reel.travelDistance,
    spinConfig.duration,
    spinConfig.revealDelay,
    spinConfig.startDelay,
  ]);

  if (!isOpen || !result) return null;

  const isResultVisible = phase === "result";

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div className={`rounded-2xl p-2.5 ${visuals.accentIcon}`}>
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900">랜덤박스 개봉 결과</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-slate-500">
                {result.boxItemName || "랜덤박스"}를 열었어요
              </p>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${visuals.badge}`}
              >
                {visuals.label}
              </span>
            </div>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-5">
        <div
          className={`relative overflow-hidden rounded-[2rem] bg-gradient-to-br p-6 ring-1 ${visuals.background}`}
        >
          <div
            className={`absolute -left-8 top-8 h-24 w-24 rounded-full blur-2xl ${visuals.glow}`}
          />
          <div
            className={`absolute -right-6 bottom-6 h-28 w-28 rounded-full blur-2xl ${visuals.glow}`}
          />

          {DECORATION_DELAYS.map((delay, index) => (
            <div
              key={delay}
              className="absolute rounded-full bg-white/65 animate-pulse"
              style={{
                width: `${12 + index * 6}px`,
                height: `${12 + index * 6}px`,
                top: `${18 + index * 18}%`,
                left: index === 1 ? "12%" : `${70 + index * 8}%`,
                animationDelay: delay,
              }}
            />
          ))}

          <div className="relative mx-auto w-full max-w-[372px] pt-2">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-white/95 via-white/75 to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-white/95 via-white/75 to-transparent" />
            <div
              className={`pointer-events-none absolute inset-y-3 left-1/2 z-20 w-[3px] -translate-x-1/2 rounded-full ${visuals.dot}`}
            />

            <div
              className={`overflow-hidden rounded-[1.7rem] border px-3 py-4 backdrop-blur-sm ${visuals.reelFrame}`}
            >
              <div
                className="flex gap-3"
                style={{
                  transform: `translateX(-${offset}px)`,
                  willChange: "transform",
                }}
              >
                {reel.entries.map((reward, index) => {
                  const isWinningSlot = index === reel.winningIndex;
                  const showWinningState = isResultVisible && isWinningSlot;

                  return (
                    <div
                      key={`${reward.itemId || reward.itemName}-${index}`}
                      className={`w-28 shrink-0 rounded-[1.35rem] border px-3 py-4 text-center shadow-lg transition-all duration-200 ${
                        showWinningState ? visuals.winningCard : visuals.cardBase
                      }`}
                    >
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
                        <Gift
                          className={`h-5 w-5 ${
                            boxType === "premium" ? "text-rose-500" : "text-amber-500"
                          }`}
                        />
                      </div>
                      <p className="mt-3 truncate text-sm font-black text-slate-800">
                        {reward.itemName}
                      </p>
                      <p className="mt-1 text-[11px] font-semibold text-slate-400">
                        {reward.quantity}개
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {!isResultVisible ? (
            <div className="relative mt-5 flex items-center justify-center gap-2">
              {DECORATION_DELAYS.map((delay) => (
                <span
                  key={`dot-${delay}`}
                  className={`h-2.5 w-2.5 rounded-full ${visuals.dot} animate-bounce`}
                  style={{ animationDelay: delay }}
                />
              ))}
            </div>
          ) : null}

          {isResultVisible ? (
            <motion.div
              className="relative mt-6"
              initial={
                shouldReduceMotion
                  ? false
                  : { opacity: 0, y: 14, scale: 0.97 }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 22, mass: 0.8 }}
            >
              <div
                className={`rounded-[1.9rem] border px-6 py-7 text-center shadow-xl ${visuals.resultCard}`}
              >
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg shadow-slate-200/60">
                  <Gift
                    className={`h-9 w-9 ${
                      boxType === "premium" ? "text-rose-500" : "text-amber-500"
                    }`}
                  />
                </div>
                <p
                  className={`mt-5 inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${visuals.badge}`}
                >
                  당첨 보상
                </p>
                <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">
                  {result.rewardItemName || "보상 아이템"}
                </p>
                <p className="mt-2 text-sm font-bold text-slate-500">
                  {Number(result.rewardQuantity || 1)}개 지급됨
                </p>
                <p className="mt-4 text-xs font-semibold text-slate-500">
                  가방에서 바로 확인할 수 있어요.
                </p>
              </div>
            </motion.div>
          ) : null}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button
          kind="solid"
          tone={boxType === "premium" ? "rose" : "amber"}
          onClick={onClose}
          fullWidth
          className="rounded-2xl py-3 font-black"
        >
          확인
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default RandomBoxResultModal;
