import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FastForward,
  Play,
  Sparkles,
  Ticket,
  Trophy,
  X,
} from "lucide-react";
import { Modal, Button } from "../../../components/ui";

const SHUFFLE_INTERVAL_MS = 62;
const REVEAL_DELAY_MS = 850;

const normalizeRows = (rows) => (Array.isArray(rows) ? rows : []);

const getDisplayName = (row = {}) =>
  row.studentName || row.name || row.displayName || "학생";

const getDisplaySlot = (row = {}) =>
  Number(row.slotNumber || row.number || 0) || "?";

const formatRank = (rank) => {
  const numeric = Number(rank);
  return Number.isFinite(numeric) && numeric > 0 ? `${numeric}등` : "당첨";
};

const getRankNumber = (rank) => {
  const numeric = Number(rank);
  if (Number.isFinite(numeric)) return numeric;
  return Number(String(rank || "").match(/\d+/)?.[0] || 999);
};

const buildShufflePool = (entries, winners) => {
  const entryRows = normalizeRows(entries).map((entry) => ({
    slotNumber: getDisplaySlot(entry),
    studentName: getDisplayName(entry),
  }));

  if (entryRows.length > 0) return entryRows;

  return normalizeRows(winners).map((winner) => ({
    slotNumber: getDisplaySlot(winner),
    studentName: getDisplayName(winner),
  }));
};

const WinnerCard = ({ winner, index }) => (
  <div className="animate-nostalgia-ticket-reveal rounded-[2rem] border border-white/12 bg-white/[0.08] p-4 text-left shadow-[0_18px_42px_rgba(0,0,0,0.28)] backdrop-blur">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-rose-200">
          {formatRank(winner.rank)}
        </p>
        <p className="mt-1 text-2xl font-black text-white">
          {winner.studentName || "학생"}
        </p>
      </div>
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-amber-200/30 bg-amber-300 text-2xl font-black text-slate-950 shadow-[0_14px_30px_rgba(251,191,36,0.28)]">
        {winner.slotNumber}
      </div>
    </div>
    <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3">
      <p className="text-sm font-black text-amber-100">
        {winner.prizeLabel || "보상"}
      </p>
      <p className="mt-1 text-[11px] font-bold text-slate-400">
        {index + 1}번째 공개
      </p>
    </div>
  </div>
);

const NostalgiaPickDrawModal = ({
  roundTitle,
  winners = [],
  entries = [],
  totalEntries = 0,
  isStandalone = false,
  onFinish,
  onClose,
}) => {
  const revealTimeoutRef = useRef(null);
  const normalizedWinners = useMemo(
    () =>
      normalizeRows(winners)
        .slice()
        .sort((left, right) => {
          const rankDiff = getRankNumber(right.rank) - getRankNumber(left.rank);
          if (rankDiff !== 0) return rankDiff;
          return getDisplaySlot(left) - getDisplaySlot(right);
        }),
    [winners],
  );
  const shufflePool = useMemo(
    () => buildShufflePool(entries, normalizedWinners),
    [entries, normalizedWinners],
  );

  const [hasStarted, setHasStarted] = useState(false);
  const [revealedCount, setRevealedCount] = useState(0);
  const [isRevealing, setIsRevealing] = useState(false);
  const [shuffleIndex, setShuffleIndex] = useState(0);
  const [publishFeedback, setPublishFeedback] = useState(null);

  const allRevealed =
    normalizedWinners.length === 0 ||
    revealedCount >= normalizedWinners.length;
  const nextWinner = normalizedWinners[revealedCount] || null;
  const currentShuffle =
    shufflePool[shuffleIndex % Math.max(shufflePool.length, 1)] || nextWinner || {};
  const revealedWinners = normalizedWinners.slice(0, revealedCount);
  const nextRankLabel = nextWinner ? formatRank(nextWinner.rank) : "다음 당첨자";

  useEffect(() => {
    if (shufflePool.length === 0) return undefined;

    const timer = window.setInterval(() => {
      setShuffleIndex((prev) => (prev + 1) % shufflePool.length);
    }, SHUFFLE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [shufflePool.length]);

  useEffect(
    () => () => {
      if (revealTimeoutRef.current) {
        window.clearTimeout(revealTimeoutRef.current);
      }
    },
    [],
  );

  const revealNext = () => {
    if (isRevealing || allRevealed) return;

    setHasStarted(true);
    setIsRevealing(true);
    if (window.navigator?.vibrate) {
      window.navigator.vibrate([25, 30, 45]);
    }

    revealTimeoutRef.current = window.setTimeout(() => {
      setRevealedCount((prev) => Math.min(prev + 1, normalizedWinners.length));
      setIsRevealing(false);
      revealTimeoutRef.current = null;
    }, REVEAL_DELAY_MS);
  };

  const revealAll = () => {
    if (revealTimeoutRef.current) {
      window.clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
    }
    setHasStarted(true);
    setIsRevealing(false);
    setRevealedCount(normalizedWinners.length);
  };

  const handleFinish = async () => {
    if (publishFeedback?.type === "loading") return;

    setPublishFeedback({
      type: "loading",
      message: "결과를 확정하고 보상을 지급하는 중입니다.",
    });

    try {
      await onFinish?.();
      setPublishFeedback({
        type: "success",
        message: "결과가 확정되었습니다.",
      });
    } catch (error) {
      setPublishFeedback({
        type: "error",
        message: error?.message || "결과 확정 중 오류가 발생했습니다.",
      });
    }
  };

  const content = (
      <Modal.Body className={`relative min-h-[720px] overflow-hidden bg-slate-950 p-0 text-white ${isStandalone ? "rounded-none" : "rounded-[3.25rem]"}`}>
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-12%] top-[-18%] h-[48%] w-[48%] rounded-full bg-rose-500/20 blur-[110px]" />
          <div className="absolute bottom-[-18%] right-[-12%] h-[48%] w-[48%] rounded-full bg-cyan-500/20 blur-[110px]" />
          <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/5" />
        </div>

        <Button
          type="button"
          onClick={onClose}
          className="absolute right-8 top-8 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
          aria-label="닫기"
          title="닫기"
        >
          <X size={18} />
        </Button>

        {!allRevealed && (
          <div className="absolute right-24 top-8 z-30">
            <Button
              size="sm"
              tone="slate"
              kind="ghost"
              icon={FastForward}
              onClick={revealAll}
              className="rounded-xl border border-white/20 bg-white/10 text-white hover:bg-white/20"
            >
              전체 공개
            </Button>
          </div>
        )}

        <div className="relative z-10 flex min-h-[720px] flex-col px-10 py-10">
          {publishFeedback ? (
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
          ) : null}

          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-200/20 bg-rose-300/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-rose-100">
              <Ticket size={14} />
              추억의 뽑기 추첨
            </div>
            <h2 className="mt-4 text-4xl font-black tracking-tight text-white">
              {roundTitle || "추억의 뽑기"}
            </h2>
            <p className="mt-2 text-sm font-bold text-slate-400">
              참여 {Number(totalEntries || shufflePool.length || 0).toLocaleString()}칸 · 당첨 {normalizedWinners.length.toLocaleString()}명
            </p>
          </div>

          <div className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <div className="flex flex-col items-center">
              <div className="relative h-80 w-80">
                <div className="absolute inset-0 rounded-[4rem] border border-white/10 bg-[linear-gradient(145deg,#7f1d1d_0%,#be123c_42%,#0f172a_100%)] shadow-[0_34px_80px_rgba(0,0,0,0.42)]" />
                <div className="absolute inset-8 rounded-[3rem] border border-white/15 bg-slate-950/55 shadow-inner" />
                <div className="absolute left-1/2 top-8 h-12 w-40 -translate-x-1/2 rounded-b-[2rem] border border-amber-200/30 bg-amber-300/95 shadow-[0_14px_32px_rgba(251,191,36,0.25)]" />
                <div className="absolute inset-x-12 bottom-9 h-16 rounded-[2rem] border border-white/10 bg-white/8" />

                <div
                  className={`absolute left-1/2 top-1/2 flex h-44 w-56 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-[2rem] border border-amber-200/40 bg-[linear-gradient(160deg,#fff7ed_0%,#ffffff_54%,#e0f2fe_100%)] text-slate-950 shadow-[0_24px_44px_rgba(0,0,0,0.34)] ${
                    isRevealing ? "animate-nostalgia-ticket-spin" : "animate-nostalgia-ticket-float"
                  }`}
                >
                  <div className="absolute inset-x-5 top-1/2 h-px bg-amber-200/70" />
                  <div className="absolute inset-y-5 left-1/2 w-px bg-cyan-200/70" />
                  <p className="relative text-[11px] font-black uppercase tracking-[0.16em] text-rose-600">
                    번호표
                  </p>
                  <p className="relative mt-2 text-6xl font-black">
                    {isRevealing && nextWinner
                      ? nextWinner.slotNumber
                      : getDisplaySlot(currentShuffle)}
                  </p>
                  <p className="relative mt-1 max-w-[160px] truncate text-sm font-black text-slate-500">
                    {isRevealing && nextWinner
                      ? getDisplayName(nextWinner)
                      : getDisplayName(currentShuffle)}
                  </p>
                </div>
              </div>

              <div className="mt-7 w-full max-w-xs rounded-[2rem] border border-white/10 bg-white/5 px-5 py-4 text-center">
                <p className="text-sm font-black text-slate-200">
                  {allRevealed
                    ? "모든 당첨자가 공개되었습니다."
                    : isRevealing
                      ? `${formatRank(nextWinner?.rank)} 번호표를 뽑는 중`
                      : hasStarted
                        ? "다음 번호표 공개 대기"
                        : "추첨 시작 대기"}
                </p>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {revealedCount} / {normalizedWinners.length} 공개
                </p>
              </div>
            </div>

            <div className="min-h-[430px] rounded-[2.5rem] border border-white/10 bg-white/[0.05] p-5 backdrop-blur-sm">
              {normalizedWinners.length === 0 ? (
                <div className="flex h-full min-h-[390px] flex-col items-center justify-center text-center">
                  <Trophy size={46} className="mb-4 text-slate-600" />
                  <p className="text-2xl font-black text-slate-200">
                    이번 회차는 당첨자가 없습니다.
                  </p>
                  <p className="mt-2 text-sm font-bold text-slate-500">
                    참여 칸이나 보상 설정을 확인해 주세요.
                  </p>
                </div>
              ) : revealedWinners.length === 0 ? (
                <div className="flex h-full min-h-[390px] flex-col items-center justify-center text-center">
                  <Sparkles size={42} className="mb-4 animate-pulse text-amber-300" />
                  <p className="text-2xl font-black text-white">
                    아직 공개된 번호표가 없습니다.
                  </p>
                  <p className="mt-2 text-sm font-bold text-slate-500">
                    버튼을 눌러 첫 번째 당첨자를 공개하세요.
                  </p>
                </div>
              ) : (
                <div className="grid max-h-[430px] gap-3 overflow-y-auto pr-1 custom-scrollbar md:grid-cols-2">
                  {revealedWinners.map((winner, index) => (
                    <WinnerCard
                      key={`${winner.rank}-${winner.slotNumber}-${index}`}
                      winner={winner}
                      index={index}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            {allRevealed ? (
              <div className="grid gap-3 md:grid-cols-[1fr_1.2fr]">
                <Button
                  tone="slate"
                  size="lg"
                  fullWidth
                  onClick={onClose}
                  disabled={publishFeedback?.type === "loading"}
                  className="h-18 rounded-[2rem] border border-white/15 bg-white/10 text-lg font-black text-white hover:bg-white/20"
                >
                  나중에 확정
                </Button>
                <Button
                  tone="rose"
                  size="lg"
                  fullWidth
                  icon={Trophy}
                  onClick={handleFinish}
                  disabled={publishFeedback?.type === "loading"}
                  className="h-18 rounded-[2rem] border-b-8 border-rose-900 text-lg font-black shadow-[0_20px_50px_rgba(225,29,72,0.32)]"
                >
                  {publishFeedback?.type === "loading" ? "확정 중..." : "결과 확정"}
                </Button>
              </div>
            ) : (
              <Button
                tone="rose"
                size="lg"
                fullWidth
                icon={hasStarted ? Ticket : Play}
                onClick={revealNext}
                disabled={isRevealing}
                className="h-20 rounded-[2.5rem] border-b-8 border-rose-900 text-2xl font-black shadow-[0_22px_60px_rgba(225,29,72,0.34)] transition-all hover:scale-[1.01] active:scale-95"
              >
                {isRevealing
                  ? "번호표 뽑는 중..."
                  : hasStarted
                    ? `${nextRankLabel} 공개`
                    : "추첨 시작"}
              </Button>
            )}
          </div>
        </div>
      </Modal.Body>
  );

  if (isStandalone) {
    return <div className="min-h-screen bg-slate-950">{content}</div>;
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      size="xl"
      closeOnOverlayClick={false}
      showDefaultCloseButton={false}
    >
      {content}
    </Modal>
  );
};

export default NostalgiaPickDrawModal;
