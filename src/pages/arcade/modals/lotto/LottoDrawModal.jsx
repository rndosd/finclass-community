import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  FastForward,
  Play,
  Sparkles,
  Trophy,
  Volume2,
  X,
} from "lucide-react";
import { Modal, Button } from "../../../../components/ui";

const AUTO_REVEAL_DELAY_MS = 1200;
const STEP_REVEAL_DELAY_MS = 1100;
const SHUFFLE_INTERVAL_MS = 70;

const FLOATING_BALLS = [
  { top: "12%", left: "18%", size: "h-10 w-10", delay: "0s" },
  { top: "18%", right: "15%", size: "h-8 w-8", delay: "0.4s" },
  { bottom: "22%", left: "13%", size: "h-9 w-9", delay: "0.2s" },
  { bottom: "16%", right: "19%", size: "h-7 w-7", delay: "0.6s" },
];

const getBallColor = (num, isBonus = false) => {
  if (isBonus) return "from-amber-400 to-yellow-600 ring-yellow-300";
  if (num <= 10) return "from-yellow-300 to-yellow-500 ring-yellow-200";
  if (num <= 20) return "from-blue-400 to-blue-600 ring-blue-300";
  if (num <= 30) return "from-rose-400 to-rose-600 ring-rose-300";
  if (num <= 40) return "from-slate-400 to-slate-600 ring-slate-300";
  return "from-emerald-400 to-emerald-600 ring-emerald-300";
};

const getRankNumber = (rank) => Number(String(rank || "").match(/\d+/)?.[0] || 0);

const formatRankLabel = (rank) => {
  const rankNumber = getRankNumber(rank);
  return rankNumber > 0 ? `${rankNumber}등` : rank || "당첨";
};

const normalizeWinners = (winners) => (Array.isArray(winners) ? winners : []);

const buildWinnerCounts = (winners, winnerCounts) => {
  const entries = Object.entries(winnerCounts || {});
  if (entries.length > 0) {
    return entries
      .map(([rank, count]) => ({ rank, count: Number(count) || 0 }))
      .filter((entry) => entry.count > 0)
      .sort((left, right) => {
        const leftRank = getRankNumber(left.rank) || 999;
        const rightRank = getRankNumber(right.rank) || 999;
        return leftRank - rightRank;
      });
  }

  const counts = new Map();
  normalizeWinners(winners).forEach((winner) => {
    const rank = winner.rank || "winner";
    counts.set(rank, (counts.get(rank) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([rank, count]) => ({ rank, count }))
    .sort((left, right) => {
      const leftRank = getRankNumber(left.rank) || 999;
      const rightRank = getRankNumber(right.rank) || 999;
      return leftRank - rightRank;
    });
};

const Ball = ({
  number,
  isBonus = false,
  sizeClass = "h-20 w-20 text-3xl",
  className = "",
}) => (
  <div
    className={`relative ${sizeClass} rounded-full bg-gradient-to-br ${getBallColor(
      number,
      isBonus,
    )} ring-4 ${className} flex items-center justify-center font-black text-white shadow-[0_16px_35px_rgba(0,0,0,0.35)]`}
  >
    <span>{number}</span>
    <div className="absolute left-4 top-3 h-3 w-7 rounded-full bg-white/30 rotate-[-18deg]" />
  </div>
);

const WinnersOverlay = ({
  winners,
  winnerCounts,
  totalTickets,
  onClose,
}) => {
  const counts = buildWinnerCounts(winners, winnerCounts);
  const normalizedWinners = normalizeWinners(winners);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-md">
      <div className="w-full max-w-3xl overflow-hidden rounded-[2.5rem] border border-white/10 bg-slate-950 text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-7 py-6">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-emerald-300">
              Winners
            </p>
            <h3 className="mt-1 text-2xl font-black">당첨자 확인</h3>
            <p className="mt-1 text-xs font-bold text-slate-400">
              참여 복권 {Number(totalTickets || 0).toLocaleString()}장 · 당첨 {normalizedWinners.length.toLocaleString()}명
            </p>
          </div>
          <Button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
            aria-label="닫기"
          >
            <X size={18} />
          </Button>
        </div>

        <div className="max-h-[62vh] space-y-4 overflow-y-auto px-7 py-6">
          {counts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {counts.map((entry) => (
                <span
                  key={entry.rank}
                  className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm font-black text-emerald-100"
                >
                  {formatRankLabel(entry.rank)} {entry.count}명
                </span>
              ))}
            </div>
          )}

          {normalizedWinners.length === 0 ? (
            <div className="rounded-[2rem] border border-white/10 bg-white/5 py-16 text-center">
              <Trophy size={42} className="mx-auto mb-4 text-slate-600" />
              <p className="text-lg font-black text-slate-300">이번 회차는 당첨자가 없습니다.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {normalizedWinners.map((winner, index) => (
                <div
                  key={`${winner.uid || winner.name || "winner"}-${index}`}
                  className="rounded-[1.75rem] border border-white/10 bg-white/5 p-4"
                >
                  <p className="text-lg font-black">{winner.name || "학생"}</p>
                  <p className="mt-1 text-sm font-bold text-emerald-200">
                    {formatRankLabel(winner.rank)} · {winner.prizeLabel || "보상"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const LottoDrawModal = ({
  winningNumbers = [],
  bonusNumber = null,
  drawMode = "auto",
  winners = [],
  winnerCounts = {},
  totalTickets = 0,
  isStandalone = false,
  onOpenPopout,
  onFinish,
  onClose,
}) => {
  const revealTimeoutRef = useRef(null);

  const normalizedWinningNumbers = useMemo(
    () =>
      (Array.isArray(winningNumbers) ? winningNumbers : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value)),
    [winningNumbers],
  );

  const normalizedBonusNumber = useMemo(() => {
    if (bonusNumber == null || bonusNumber === "") return null;
    const parsed = Number(bonusNumber);
    return Number.isFinite(parsed) ? parsed : null;
  }, [bonusNumber]);

  const drawNumbers = useMemo(() => {
    if (normalizedBonusNumber == null) return normalizedWinningNumbers;
    return [...normalizedWinningNumbers, normalizedBonusNumber];
  }, [normalizedBonusNumber, normalizedWinningNumbers]);
  const drawNumbersKey = drawNumbers.join(",");
  const firstDrawNumber = Number(drawNumbersKey.split(",")[0]) || 1;

  const [revealedNumbers, setRevealedNumbers] = useState([]);
  const [isRevealing, setIsRevealing] = useState(false);
  const [hasStarted, setHasStarted] = useState(drawMode !== "auto");
  const [currentShuffle, setCurrentShuffle] = useState(drawNumbers[0] || 1);
  const [showWinnersModal, setShowWinnersModal] = useState(false);
  const [publishFeedback, setPublishFeedback] = useState(null);

  const hasBonusBall = normalizedBonusNumber != null;
  const isTeacherStepMode = drawMode === "auto";
  const allRevealed = drawNumbers.length > 0 && revealedNumbers.length >= drawNumbers.length;
  const nextRevealIndex = revealedNumbers.length;
  const nextIsBonusBall = hasBonusBall && nextRevealIndex === drawNumbers.length - 1;
  const nextBallLabel = nextIsBonusBall ? "보너스 공" : `${nextRevealIndex + 1}번째 공`;

  const revealNext = useCallback(
    (delayMs = STEP_REVEAL_DELAY_MS) => {
      if (allRevealed || isRevealing || drawNumbers.length === 0) return;

      setHasStarted(true);
      setIsRevealing(true);
      revealTimeoutRef.current = window.setTimeout(() => {
        setRevealedNumbers((prev) => [...prev, drawNumbers[prev.length]]);
        setIsRevealing(false);
        revealTimeoutRef.current = null;
      }, delayMs);
    },
    [allRevealed, drawNumbers, isRevealing],
  );

  const revealAll = useCallback(() => {
    if (revealTimeoutRef.current) {
      window.clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
    }
    setHasStarted(true);
    setIsRevealing(false);
    setRevealedNumbers(drawNumbers);
  }, [drawNumbers]);

  useEffect(() => {
    setRevealedNumbers([]);
    setIsRevealing(false);
    setHasStarted(!isTeacherStepMode);
    setCurrentShuffle(firstDrawNumber);
    setShowWinnersModal(false);
    setPublishFeedback(null);
  }, [drawNumbersKey, firstDrawNumber, isTeacherStepMode]);

  useEffect(() => {
    if (drawNumbers.length === 0) return undefined;

    const upperBound = Math.max(...drawNumbers, 45);
    const timer = window.setInterval(() => {
      setCurrentShuffle(Math.floor(Math.random() * upperBound) + 1);
    }, SHUFFLE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [drawNumbers]);

  useEffect(() => {
    if (isTeacherStepMode || !hasStarted || allRevealed || isRevealing) {
      return undefined;
    }

    revealNext(AUTO_REVEAL_DELAY_MS);
    return undefined;
  }, [allRevealed, hasStarted, isRevealing, isTeacherStepMode, revealNext]);

  useEffect(
    () => () => {
      if (revealTimeoutRef.current) window.clearTimeout(revealTimeoutRef.current);
    },
    [],
  );

  const handleFinish = async () => {
    if (publishFeedback?.type === "loading") return;

    setPublishFeedback({
      type: "loading",
      message: "추첨 결과를 학생 화면에 공개하는 중입니다.",
    });

    try {
      await onFinish?.();
      setPublishFeedback({
        type: "success",
        message: "추첨 결과가 학생 화면에 공개되었습니다.",
      });
    } catch (error) {
      setPublishFeedback({
        type: "error",
        message: error?.message || "추첨 확정 중 오류가 발생했습니다.",
      });
    }
  };

  const surfaceClassName = isStandalone
    ? "relative min-h-screen overflow-hidden rounded-none bg-slate-950 p-0"
    : "relative min-h-[740px] overflow-hidden rounded-[3.5rem] bg-slate-950 p-0";
  const stageClassName = isStandalone
    ? "relative z-10 flex min-h-screen flex-col justify-between px-12 py-8"
    : "relative z-10 flex min-h-[740px] flex-col justify-between px-10 py-12";
  const machineSizeClass = isStandalone ? "h-80 w-80 xl:h-96 xl:w-96" : "h-72 w-72";
  const machineBallSizeClass = isStandalone ? "h-36 w-36 text-5xl" : "h-32 w-32 text-5xl";
  const revealedBallSizeClass = isStandalone ? "h-20 w-20 text-3xl xl:h-24 xl:w-24 xl:text-4xl" : "h-20 w-20 text-3xl";

  const content = (
    <Modal.Body className={surfaceClassName}>
      <Button
        type="button"
        className="absolute left-8 top-8 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white"
        title="소리"
        aria-label="소리"
      >
        <Volume2 size={18} />
      </Button>

      {onOpenPopout && !isStandalone && (
        <div className="absolute left-24 top-8 z-20">
          <Button
            size="sm"
            kind="ghost"
            tone="slate"
            onClick={onOpenPopout}
            className="rounded-xl border border-white/20 bg-white/10 text-white hover:bg-white/20"
            icon={ExternalLink}
          >
            팝업
          </Button>
        </div>
      )}

      {!allRevealed && (
        <div className="absolute right-24 top-8 z-20">
          <Button
            size="sm"
            kind="ghost"
            tone="slate"
            onClick={revealAll}
            className="rounded-xl border border-white/20 bg-white/10 text-white hover:bg-white/20"
            icon={FastForward}
          >
            전체 공개
          </Button>
        </div>
      )}

      <Button
        type="button"
        onClick={onClose}
        className="absolute right-8 top-8 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
        title="닫기"
        aria-label="닫기"
      >
        <X size={18} />
      </Button>

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-[-10%] h-[52%] w-[52%] rounded-full bg-rose-600/20 blur-[120px]" />
        <div className="absolute bottom-[-12%] right-[-10%] h-[48%] w-[48%] rounded-full bg-indigo-600/20 blur-[120px]" />
        {FLOATING_BALLS.map((ball, index) => (
          <div
            key={`floating-ball-${index}`}
            className={`absolute ${ball.size} animate-bounce rounded-full border border-white/10 bg-white/5 shadow-inner`}
            style={{
              top: ball.top,
              left: ball.left,
              right: ball.right,
              bottom: ball.bottom,
              animationDelay: ball.delay,
              animationDuration: "2.8s",
            }}
          />
        ))}
      </div>

      <div className={stageClassName}>
        {publishFeedback && (
          <div
            className={`absolute left-1/2 top-8 z-40 -translate-x-1/2 rounded-full border px-5 py-3 text-sm font-black shadow-2xl backdrop-blur-md ${
              publishFeedback.type === "success"
                ? "border-emerald-300/30 bg-emerald-400/20 text-emerald-100"
                : publishFeedback.type === "error"
                  ? "border-rose-300/30 bg-rose-400/20 text-rose-100"
                  : "border-white/15 bg-white/10 text-white"
            }`}
          >
            {publishFeedback.message}
          </div>
        )}

        <div className="h-6" />

        <div className="flex flex-1 flex-col items-center justify-center gap-10">
          <div className="relative flex flex-col items-center">
            <div className="absolute -bottom-12 left-1/2 h-28 w-10 -translate-x-1/2 rounded-b-[2rem] bg-gradient-to-b from-slate-600 to-slate-900 opacity-80" />
            <div className="absolute -bottom-20 left-1/2 h-10 w-52 -translate-x-1/2 rounded-full bg-slate-900/70 blur-md" />

            <div className={`relative ${machineSizeClass}`}>
              <div className="absolute inset-0 rounded-full border-[14px] border-slate-700 bg-gradient-to-b from-slate-700 via-slate-800 to-slate-950 shadow-[0_0_80px_rgba(0,0,0,0.5)]" />
              <div className="absolute inset-5 overflow-hidden rounded-full border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.2),_rgba(15,23,42,0.16)_58%,_rgba(2,6,23,0.94)_100%)]">
                <div className="absolute inset-0 rounded-full border border-white/5" />
                <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-white/5" />
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <Ball
                    number={currentShuffle}
                    isBonus={nextIsBonusBall && isRevealing}
                    sizeClass={`${machineBallSizeClass} ${isRevealing ? "animate-bounce" : "animate-pulse"}`}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="w-full max-w-6xl rounded-[2.75rem] border border-white/10 bg-white/5 px-8 py-7 backdrop-blur-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="mt-1 text-base font-black text-slate-200">
                  {revealedNumbers.length} / {drawNumbers.length}개 공개
                </p>
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  {allRevealed
                    ? "모든 번호가 공개되었습니다."
                    : hasStarted
                      ? `${nextBallLabel} 공개 대기 중`
                      : "추첨 시작 대기 중"}
                </p>
              </div>
              {hasBonusBall && (
                <div className="rounded-full border border-amber-300/25 bg-amber-400/10 px-4 py-2 text-[11px] font-black text-amber-200">
                  보너스 공은 마지막에 공개됩니다.
                </div>
              )}
            </div>

            <div className="mt-7 flex min-h-[120px] flex-wrap items-center justify-center gap-5">
              {revealedNumbers.map((num, index) => {
                const isBonusBall = hasBonusBall && index === drawNumbers.length - 1;
                return (
                  <React.Fragment key={`revealed-${index}-${num}`}>
                    {isBonusBall && (
                      <div className="px-2 text-4xl font-black text-white">+</div>
                    )}
                    <Ball
                      number={num}
                      isBonus={isBonusBall}
                      sizeClass={revealedBallSizeClass}
                      className="animate-in zoom-in-50 slide-in-from-top-10 duration-700"
                    />
                  </React.Fragment>
                );
              })}

              {!allRevealed && (
                <div className="rounded-full border border-dashed border-white/15 px-6 py-4 text-base font-black text-slate-500">
                  다음 공 대기 중
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-7">
          {allRevealed ? (
            <div className="animate-in fade-in slide-in-from-bottom-6 space-y-5 duration-700">
              <div className="text-center">
                <p className="flex items-center justify-center gap-2 text-xl font-black text-emerald-300">
                  <Sparkles size={22} />
                  추첨이 완료되었습니다.
                  <Sparkles size={22} />
                </p>
                <p className="mt-2 text-sm font-bold text-slate-500">
                  당첨자 확인 후 추첨 확정을 누르면 학생 화면에 결과가 공개됩니다.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Button
                  tone="indigo"
                  size="lg"
                  fullWidth
                  onClick={() => setShowWinnersModal(true)}
                  disabled={publishFeedback?.type === "loading"}
                  className="h-20 rounded-[2rem] text-xl font-black"
                  icon={Trophy}
                >
                  당첨자 확인
                </Button>
                <Button
                  tone="rose"
                  size="lg"
                  fullWidth
                  onClick={handleFinish}
                  disabled={publishFeedback?.type === "loading"}
                  className="h-20 rounded-[2rem] border-b-8 border-rose-800 text-xl font-black shadow-[0_20px_50px_rgba(225,29,72,0.35)]"
                >
                  {publishFeedback?.type === "loading" ? "공개 중..." : "추첨 확정"}
                </Button>
              </div>
            </div>
          ) : isTeacherStepMode ? (
            <div className="space-y-4">
              <div className="text-center text-xs font-bold tracking-wide text-slate-400">
                {isRevealing ? `${nextBallLabel} 공개 중` : "버튼을 눌러 진행"}
              </div>
              <Button
                tone={nextIsBonusBall ? "amber" : "rose"}
                size="lg"
                fullWidth
                icon={hasStarted ? Trophy : Play}
                onClick={() => revealNext(STEP_REVEAL_DELAY_MS)}
                disabled={isRevealing}
                className="h-20 rounded-[2.5rem] text-2xl font-black shadow-[0_20px_50px_rgba(15,23,42,0.35)] transition-all hover:scale-[1.02] active:scale-95"
              >
                {isRevealing ? `${nextBallLabel} 공개 중...` : hasStarted ? `${nextBallLabel} 공개` : "추첨 시작"}
              </Button>
            </div>
          ) : (
            <div className="pb-6 text-center">
              <div className="inline-flex items-center gap-3 text-sm font-black uppercase tracking-[0.2em] text-indigo-300">
                <div className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" />
                자동 공개 중
                <div className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:140ms]" />
              </div>
            </div>
          )}
        </div>
      </div>

      {showWinnersModal && (
        <WinnersOverlay
          winners={winners}
          winnerCounts={winnerCounts}
          totalTickets={totalTickets}
          onClose={() => setShowWinnersModal(false)}
        />
      )}
    </Modal.Body>
  );

  if (isStandalone) {
    return <div className="min-h-screen bg-slate-950">{content}</div>;
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      size="2xl"
      closeOnOverlayClick={false}
      showDefaultCloseButton={false}
    >
      {content}
    </Modal>
  );
};

export default LottoDrawModal;
