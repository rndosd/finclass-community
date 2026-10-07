import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Loader2,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  AlertCircle,
} from "lucide-react";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { Button } from "../../../components/ui";
import { playPaperPick, subscribePaperPickBoard } from "../services/arcadeServices";
import { formatArcadeChargeDetail } from "../utils/chargeUtils";
import { hasItemReward, resolveMoneyPrizeAmount } from "../utils/prizeAnalytics";
import paperPickSlip from "../../../assets/arcade/paper-fiber-v2.svg";
import ArcadeInfoChip from "./ArcadeInfoChip";
import "./arcadeMaterials.css";

const formatNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : "0";
};

const getPickedCount = (board) => {
  const slots = Array.isArray(board?.slots) ? board.slots : [];
  return slots.filter((slot) => slot?.picked).length;
};

const getResultDisplayMeta = (result) => {
  const amount = Number(result?.amount || 0);
  const itemName = String(result?.itemName || "").trim();
  const hasItemReward =
    result?.type === "item" || result?.type === "bundle" || Boolean(itemName);
  const hasMoneyReward = amount > 0;

  return {
    amount,
    itemName,
    hasItemReward,
    hasMoneyReward,
    isMiss: !hasItemReward && !hasMoneyReward,
  };
};

const buildPrizeSignature = (prize = {}) => ({
  label: String(prize?.label || "").trim(),
  itemId: String(prize?.itemId || "").trim(),
  rewardMode: String(prize?.rewardMode || "").trim(),
  amount: Number(prize?.amount || 0),
  multiplier: Number(prize?.multiplier || 0),
  moneyEnabled: prize?.moneyEnabled !== false,
  itemEnabled: prize?.itemEnabled === true || Boolean(prize?.itemId),
});

const isSamePrizeSignature = (left, right) =>
  left.label === right.label &&
  left.itemId === right.itemId &&
  left.rewardMode === right.rewardMode &&
  left.amount === right.amount &&
  left.multiplier === right.multiplier &&
  left.moneyEnabled === right.moneyEnabled &&
  left.itemEnabled === right.itemEnabled;

const PaperPickBoard = ({
  price = 100,
  feeAmount = 0,
  isTicketUsed = false,
  currencyName = "coins",
  configuredPrizes = [],
  onClose,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { classId, isTeacher } = useUser();
  const { showFeedback } = useFeedback();

  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [boardData, setBoardData] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [pendingResult, setPendingResult] = useState(null);
  const [result, setResult] = useState(null);
  const [isUnfolding, setIsUnfolding] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showTeacherTopPrizes, setShowTeacherTopPrizes] = useState(true);
  const [showTeacherSlotPreview, setShowTeacherSlotPreview] = useState(false);
  const pickLockRef = useRef(false);
  const pickTimerRef = useRef(null);
  const unfoldTimerRef = useRef(null);

  useEffect(() => () => {
    window.clearTimeout(pickTimerRef.current);
    window.clearTimeout(unfoldTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isTeacher) setShowTeacherSlotPreview(false);
  }, [isTeacher]);

  useEffect(() => {
    if (!classId) return undefined;

    setLoading(true);
    const unsubscribe = subscribePaperPickBoard(classId, (data) => {
      if (!data) {
        showFeedback(
          "종이 뽑기 보드 정보를 불러오지 못했습니다. 보드가 초기화되었거나 설정이 변경되었을 수 있으니 다시 열어 확인해 주세요.",
          "warning",
        );
        onClose?.();
        return;
      }

      setBoardData((prev) => {
        const prevExists = !!prev;
        const prevPicked = getPickedCount(prev);
        const nextPicked = getPickedCount(data);
        const prevSize = Number(prev?.boardSize || prev?.slots?.length || 0);
        const nextSize = Number(data?.boardSize || data?.slots?.length || 0);
        const boardResetLikely =
          prevExists &&
          nextPicked === 0 &&
          (prevPicked > 0 || prevSize !== nextSize);

        if (boardResetLikely) {
          window.clearTimeout(pickTimerRef.current);
          window.clearTimeout(unfoldTimerRef.current);
          setResult(null);
          setPendingResult(null);
          setIsUnfolding(false);
          setSelectedSlot(null);
          setPlaying(false);
          pickLockRef.current = false;
          setShowTeacherTopPrizes(true);
          setShowTeacherSlotPreview(false);
        }

        return data;
      });
      setLoading(false);
    });

    return () => unsubscribe && unsubscribe();
  }, [classId, onClose, showFeedback]);

  const handlePick = async (index) => {
    if (
      pickLockRef.current ||
      playing ||
      selectedSlot !== null ||
      boardData?.slots?.[index]?.picked ||
      pendingResult ||
      isUnfolding ||
      result
    ) {
      return;
    }

    try {
      pickLockRef.current = true;
      setPlaying(true);
      setSelectedSlot(index);

      if (window.navigator?.vibrate) {
        window.navigator.vibrate([40, 30, 40]);
      }

      const response = await playPaperPick(classId, {
        slotIndex: index,
        paymentType: isTicketUsed ? "ticket" : "cash",
      });

      if (!response?.success) {
        throw new Error("Unable to load paper pick result.");
      }

      pickTimerRef.current = window.setTimeout(() => {
        setPendingResult(response.result);
        setPlaying(false);
      }, 700);
    } catch (error) {
      showFeedback(
        error.message || "There was a problem processing paper pick.",
        "error",
      );
      setSelectedSlot(null);
      setPendingResult(null);
      setIsUnfolding(false);
      setPlaying(false);
      pickLockRef.current = false;
    }
  };

  const handleCloseAttempt = () => {
    if (playing || isUnfolding || (selectedSlot !== null && !result)) {
      setShowExitConfirm(true);
      return;
    }
    onClose?.();
  };

  const handleRevealPaper = () => {
    if (!pendingResult || isUnfolding) return;

    setIsUnfolding(true);

    if (window.navigator?.vibrate) {
      window.navigator.vibrate([25, 20, 35]);
    }

    unfoldTimerRef.current = window.setTimeout(() => {
      setResult(pendingResult);
      setPendingResult(null);
      setIsUnfolding(false);
    }, 980);
  };

  const totalSlots = Number(boardData?.boardSize || boardData?.slots?.length || 0);
  const pickedCount = getPickedCount(boardData);
  const remainingCount = Math.max(totalSlots - pickedCount, 0);
  const progressPercent =
    totalSlots > 0 ? Math.round((pickedCount / totalSlots) * 100) : 0;
  const isAwaitingResult = selectedSlot !== null && !result && !pendingResult;
  const hasFoldedPaper = selectedSlot !== null && pendingResult && !result;
  const entryCostText = formatArcadeChargeDetail({formatAmount: formatDisplayMoney,
    price,
    feeAmount,
    isTicketUsed,
    currencyName,
  });
  const paperReward = result || pendingResult;
  const resultMeta = getResultDisplayMeta(paperReward);

  const teacherTopPrizeStatus = useMemo(() => {
    if (!isTeacher || !boardData?.slots?.length) return [];

    return (Array.isArray(configuredPrizes) ? configuredPrizes : [])
      .slice(0, 3)
      .map((prize, index) => {
        const signature = buildPrizeSignature(prize);
        const matchingSlots = boardData.slots.filter((slot) =>
          isSamePrizeSignature(buildPrizeSignature(slot), signature),
        );
        const totalCountForPrize = matchingSlots.length;
        const pickedCountForPrize = matchingSlots.filter((slot) => slot?.picked).length;
        const remainingCountForPrize = Math.max(
          totalCountForPrize - pickedCountForPrize,
          0,
        );

        return {
          id: prize?.id || `${index}-${signature.label}-${signature.itemId}`,
          rank: index + 1,
          label: String(prize?.label || "").trim() || `${index + 1} prize`,
          totalCount: totalCountForPrize,
          remainingCount: remainingCountForPrize,
          isDrawn: totalCountForPrize > 0 && remainingCountForPrize === 0,
        };
      });
  }, [boardData?.slots, configuredPrizes, isTeacher]);

  if (loading) {
    return (
      <div className="absolute inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <Loader2 size={42} className="animate-spin text-white" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="arcade-game-dialog arcade-game-dialog--paper relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2.75rem] border border-cyan-100/90 bg-gradient-to-b from-white to-cyan-50 shadow-[0_34px_84px_rgba(2,6,23,0.45)] animate-in zoom-in-95 duration-200">

        <Button
          aria-label="종이 뽑기 닫기"
          onClick={handleCloseAttempt}
          className="arcade-game-close absolute right-5 top-5 z-50 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          <X size={20} />
        </Button>

        <div className="arcade-game-header relative z-10 border-b border-slate-200 px-5 pb-5 pt-6 sm:px-7">
<span className="arcade-game-kicker" aria-hidden="true">ARCADE · PAPER PICK</span>
          <h3 className="mt-3 text-3xl font-black tracking-tight text-slate-800 sm:text-[34px]">
            종이 뽑기
          </h3>
          <p className="mt-1 text-[12px] font-bold text-slate-500">
            남은 칸과 진행 상황을 보며 원하는 순간에 한 칸을 선택해 보세요.
          </p>

          <div className="arcade-game-stats mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-cyan-100 bg-white/80 px-4 py-3 shadow-sm">
              <p className="text-[10px] font-black text-slate-500">입장 비용</p>
              <p className="mt-1 text-sm font-black text-slate-800">{entryCostText}</p>
            </div>
            <div className="rounded-2xl border border-cyan-100 bg-white/80 px-4 py-3 shadow-sm">
              <p className="text-[10px] font-black text-slate-500">남은 칸</p>
              <p className="mt-1 text-sm font-black text-cyan-700">
                {remainingCount} / {totalSlots}
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-100 bg-white/80 px-4 py-3 shadow-sm">
              <p className="text-[10px] font-black text-slate-500">진행률</p>
              <p className="mt-1 text-sm font-black text-slate-800">
                {progressPercent}% 열림
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto bg-[#f8f9f8] p-5 custom-scrollbar sm:p-7">
          <div className="arcade-game-note mb-4">
            <p className="text-[11px] font-black text-slate-700">
              원하는 칸을 하나 선택한 뒤 종이를 펼쳐 결과를 확인하세요. 이미 열린 칸은 다시 선택할 수 없습니다.
            </p>
            <p className="mt-1 text-[10px] font-bold text-slate-500">
              교사 화면에서는 상위 보상 남은 수량도 함께 확인할 수 있습니다.
            </p>
          </div>

          {isTeacher && teacherTopPrizeStatus.length > 0 ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-4">
              <Button
                type="button"
                onClick={() => setShowTeacherTopPrizes((prev) => !prev)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-700">
                  상위 보상 현황
                </p>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-300 bg-white text-amber-700">
                  {showTeacherTopPrizes ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </span>
              </Button>
              {!showTeacherTopPrizes ? (
                <p className="mt-3 text-[11px] font-bold text-amber-900">
                  {teacherTopPrizeStatus
                    .map((prize) => [prize.rank, prize.isDrawn ? "소진" : "남음"].join(" "))
                    .join(", ")}
                </p>
              ) : (
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {teacherTopPrizeStatus.map((prize) => (
                    <div
                      key={prize.id}
                      className="rounded-2xl border border-white/80 bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-black text-slate-800">{prize.rank}</p>
                        <span
                          className={[
                            "rounded-full px-2.5 py-1 text-[10px] font-black",
                            prize.isDrawn ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-700",
                          ].join(" ")}
                        >
                        >
                          {prize.isDrawn ? "소진" : "남음"}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm font-bold text-slate-700">
                        {prize.label}
                      </p>
                      <p className="mt-2 text-[11px] font-bold text-slate-500">
                        남은 수량 {prize.remainingCount} / 전체 {prize.totalCount}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {isTeacher ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">교사용 · 번호별 상품과 사용 여부를 확인합니다.</p>
              <Button
                type="button"
                aria-expanded={showTeacherSlotPreview}
                aria-controls="paper-pick-teacher-preview"
                disabled={selectedSlot !== null}
                onClick={() => setShowTeacherSlotPreview((value) => !value)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {showTeacherSlotPreview ? <EyeOff size={15} /> : <Eye size={15} />}
                {showTeacherSlotPreview ? "칸별 상품 숨기기" : "칸별 상품 미리 보기"}
              </Button>
            </div>
          ) : null}

          {isTeacher && showTeacherSlotPreview ? (
            <section id="paper-pick-teacher-preview" aria-label="칸별 상품 미리 보기" className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {boardData?.slots?.map((slot, index) => {
                const amount = resolveMoneyPrizeAmount(slot, boardData?.price ?? price);
                const hasItem = hasItemReward(slot);
                return (
                  <div key={`preview-${index}`} className={`min-w-0 rounded-lg border p-3 ${slot.picked ? "border-slate-200 bg-slate-100" : "border-[#d8cfbc] bg-[#fffaf0]"}`}>
                    <div className="flex items-center justify-between gap-1 text-[10px] text-slate-500">
                      <span className="rounded-md bg-teal-100 px-1.5 py-0.5 font-semibold text-teal-800">{index + 1}번</span>
                      <span>{slot.picked ? "사용됨" : "남음"}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-800 [overflow-wrap:anywhere]">{slot.label || (hasItem || amount > 0 ? "보상" : "꽝")}</p>
                    {amount > 0 ? <p className="mt-1 text-xs text-emerald-700">+{formatDisplayMoney(amount)} {currencyName}</p> : null}
                    {hasItem ? <p className="mt-1 text-xs text-slate-500 [overflow-wrap:anywhere]">{slot.itemName || "아이템 보상"}</p> : null}
                  </div>
                );
              })}
            </section>
          ) : null}

          <div hidden={isTeacher && showTeacherSlotPreview} className="relative overflow-hidden rounded-[2rem] border border-[#bfd6df] bg-[#def4ee] p-4 shadow-[inset_0_2px_18px_rgba(57,91,109,0.16)] sm:p-5">
            <div className="pointer-events-none absolute -right-14 -top-16 h-36 w-36 rounded-full bg-cyan-100/70 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-16 h-36 w-36 rounded-full bg-amber-100/60 blur-2xl" />

            <div className="relative grid grid-cols-5 gap-2.5 sm:grid-cols-8 md:grid-cols-10">
              {boardData?.slots?.map((slot, index) => {
                const isSelectedSlot = selectedSlot === index;
                const shouldHoldSelectedReveal =
                  isSelectedSlot &&
                  (isAwaitingResult || Boolean(pendingResult) || Boolean(result));
                const isBeingPicked = isSelectedSlot && playing;

                return (
                  <Button
                    key={`slot-${index}`}
                    disabled={
                      slot.picked ||
                      selectedSlot !== null ||
                      Boolean(pendingResult) ||
                      isUnfolding ||
                      Boolean(result)
                    }
                    onClick={() => handlePick(index)}
                    style={
                      !shouldHoldSelectedReveal && !slot.picked
                        ? {
                            backgroundImage: `url(${paperPickSlip})`,
                            backgroundPosition: "center",
                            backgroundSize: "cover",
                          }
                        : undefined
                    }
                    className={`arcade-paper-slot relative flex aspect-square items-center justify-center overflow-hidden rounded-xl text-[11px] font-black transition-all duration-200 [perspective:700px] ${
                      shouldHoldSelectedReveal
                        ? "bg-transparent"
                        : slot.picked
                          ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                          : "border border-[#dcc8a6] bg-[#f8f0df] text-[#6f5838] shadow-[0_8px_15px_rgba(105,79,43,0.18)] hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-[0_12px_22px_rgba(180,132,50,0.22)]"
                    }`}
                  >
                    {shouldHoldSelectedReveal ? (
                      <>
                        <div className="absolute inset-0 z-0 rounded-xl bg-amber-50/70" />
                        <div
                          style={{
                            backgroundImage: `url(${paperPickSlip})`,
                            backgroundPosition: "center",
                            backgroundSize: "cover",
                          }}
                          className={`absolute inset-0 z-20 flex items-center justify-center rounded-xl border border-[#dcc8a6] bg-[#f8f0df] text-[#6f5838] shadow-[0_18px_32px_rgba(105,79,43,0.2)] [backface-visibility:hidden] [transform-style:preserve-3d] ${
                            isBeingPicked ? "animate-paper-flip-up" : ""
                          }`}
                        >
                          <span className="relative z-10">{index + 1}</span>
                          <span className="absolute right-0 top-0 h-4 w-4 rounded-bl-md border-b border-l border-slate-300 bg-slate-100/80 shadow-[-1px_1px_3px_rgba(15,23,42,0.08)]" />
                        </div>
                        <div className="absolute inset-x-[22%] top-1/2 z-30 h-[2px] -translate-y-1/2 rounded-full bg-white/80" />
                        <div className="absolute inset-0 z-10 rounded-xl bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.82),rgba(255,255,255,0.1)_62%,transparent_100%)] opacity-80" />
                      </>
                    ) : slot.picked ? (
                      <Check size={16} strokeWidth={3.5} />
                    ) : (
                      <>
                        <span className="relative z-10">{index + 1}</span>
                      </>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-cyan-100 bg-white/70 px-6 py-4 sm:px-8">
          <p className="text-[11px] font-bold text-slate-500">
            남은 칸이 줄어들수록 보드 정보도 계속 갱신됩니다. 이미 선택된 칸은 다시 고를 수 없습니다.
          </p>
          <ArcadeInfoChip tone="cyan">남은 칸 {remainingCount}개</ArcadeInfoChip>
        </div>

        {showExitConfirm && (
          <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-white/95 p-10 text-center backdrop-blur-sm animate-in fade-in duration-200">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50">
              <AlertCircle size={36} className="text-rose-500" />
            </div>
            <h4 className="text-2xl font-black text-slate-800">종이 뽑기를 종료할까요?</h4>
            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
              지금 나가면 진행 중인 결과를 끝까지 확인할 수 없습니다.
              <br />
              결제가 진행된 뒤에는 결과 확인 후 닫는 것을 권장합니다.
            </p>
            <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5">
              <Button
                onClick={() => setShowExitConfirm(false)}
                className="w-full rounded-2xl bg-cyan-600 py-3.5 text-lg font-black text-white transition-all active:scale-95"
              >
                계속 진행하기              </Button>
              <Button
                onClick={() => onClose?.()}
                className="w-full rounded-2xl py-2.5 text-sm font-bold text-slate-400"
              >
                나가기
              </Button>
            </div>
          </div>
        )}
      </div>

      {(hasFoldedPaper || result) && (
        <div className="absolute inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[3px]">
          <div className="max-h-[92vh] w-full max-w-lg overflow-x-hidden overflow-y-auto px-2 pb-4 text-center">
            <span className="inline-flex rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-700">
              {selectedSlot + 1}번 종이 · {result ? "결과 확인" : "접힌 종이를 펼쳐 보세요"}
            </span>
            <div className="arcade-paper-stage">
              <div
                className={`arcade-paper-sheet ${isUnfolding || result ? "is-open" : ""}`}
                style={{ "--paper-texture": `url(${paperPickSlip})` }}
              >
                <div className="arcade-paper-center">
                  <div className="arcade-paper-prize" aria-hidden={!result}>
                    <h2 className="font-extrabold text-slate-800">
                      {resultMeta.isMiss ? "꽝" : paperReward?.label}
                    </h2>
                    {resultMeta.hasItemReward && resultMeta.itemName ? (
                      <p className="font-bold text-pink-700">{resultMeta.itemName} 획득</p>
                    ) : null}
                    {resultMeta.hasMoneyReward ? (
                      <p className="font-bold text-emerald-700">+{formatNumber(resultMeta.amount)} {currencyName}</p>
                    ) : null}
                  </div>
                </div>
                {["left", "right", "bottom", "top"].map((side) => (
                  <div key={side} aria-hidden="true" className={`arcade-paper-flap arcade-paper-flap--${side}`} />
                ))}
                <span className="arcade-paper-seal" aria-hidden="true">{selectedSlot + 1}</span>
              </div>
            </div>
            {result ? (
              <div aria-live="polite" className="mb-4 rounded-xl bg-white/95 px-4 py-3 text-sm font-bold text-slate-700">
                <p>{resultMeta.isMiss ? "이번 종이는 꽝입니다." : `${result.label} · 보상 결과를 확인했습니다.`}</p>
                {resultMeta.hasItemReward && resultMeta.hasMoneyReward ? (
                  <p className="mt-1 text-xs text-slate-500">아이템과 금액 보상이 함께 지급됩니다.</p>
                ) : null}
              </div>
            ) : null}
            <Button
              size="xl"
              fullWidth
              disabled={isUnfolding}
              className="h-12 rounded-xl bg-cyan-700 text-base font-bold text-white shadow-sm hover:bg-cyan-800"
              onClick={result ? () => {
                setResult(null);
                setPendingResult(null);
                setIsUnfolding(false);
                setSelectedSlot(null);
                pickLockRef.current = false;
              } : handleRevealPaper}
            >
              {result ? "확인하고 돌아가기" : isUnfolding ? "펼치는 중..." : "펼치기"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaperPickBoard;
