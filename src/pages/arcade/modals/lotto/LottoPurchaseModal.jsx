import { useNumberFormat as useMoneyDisplay } from "../../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import {
  Ticket,
  Coins,
  Check,
  Sparkles,
  RefreshCw,
  Info,
  Trophy,
} from "lucide-react";
import { Modal, Button } from "../../../../components/ui";
import { buyLottoTicket } from "../../services/arcadeServices";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import {
  getPaymentPolicyMeta,
  getPrimaryPaymentType,
  isPaymentTypeAllowed,
} from "../../utils/paymentPolicy";
import {
  formatArcadeChargeDetail,
  formatArcadeChargeLabel,
  getArcadeFeeAmount,
} from "../../utils/chargeUtils";
import lottoArtwork from "../../../../assets/arcade/lotto-v1.webp";
import ArcadeInfoChip from "../../components/ArcadeInfoChip";

const LottoPurchaseModal = ({
  isOpen,
  onClose,
  settings,
  roundStatus = null,
  userTickets = 0,
  currencyName = "coins",
  classId,
  initialPaymentType = "cash",
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { showFeedback } = useFeedback();

  const maxNumber = settings?.maxNumber || 45;
  const pickCount = settings?.pickCount || 6;
  const price = settings?.price ?? 500;
  const feeAmount = getArcadeFeeAmount(settings?.feeAmount);
  const useBonus = settings?.useBonus !== false;
  const isRoundOpen = roundStatus === "open";
  const paymentPolicy = getPaymentPolicyMeta(settings?.allowedPaymentTypes);
  const cashAllowed = isPaymentTypeAllowed(settings?.allowedPaymentTypes, "cash");
  const ticketAllowed = isPaymentTypeAllowed(
    settings?.allowedPaymentTypes,
    "ticket",
  );
  const fallbackPaymentType = useMemo(() => {
    if (isPaymentTypeAllowed(settings?.allowedPaymentTypes, initialPaymentType)) {
      return initialPaymentType;
    }

    return getPrimaryPaymentType(settings?.allowedPaymentTypes);
  }, [initialPaymentType, settings?.allowedPaymentTypes]);
  const prizeRows = Array.isArray(settings?.prizes) ? settings.prizes : [];
  const [grandPrize, ...otherPrizes] = prizeRows;

  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentType, setPaymentType] = useState(fallbackPaymentType);
  const isSelectedPaymentUnavailable =
    paymentType === "ticket" && userTickets <= 0;
  const selectedChargeDetail = formatArcadeChargeDetail({formatAmount: formatDisplayMoney,
    price,
    feeAmount,
    isTicketUsed: paymentType === "ticket",
    currencyName,
  });

  useEffect(() => {
    setPaymentType((current) => {
      if (isPaymentTypeAllowed(settings?.allowedPaymentTypes, current)) {
        return current;
      }
      return fallbackPaymentType;
    });
  }, [fallbackPaymentType, settings?.allowedPaymentTypes]);

  const getPrizeConditionText = (index) => {
    if (pickCount <= 0) return "";
    if (index === 0) return `${pickCount}개 일치`;
    if (useBonus) {
      if (index === 1) return `${pickCount - 1}개 + 보너스 번호 일치`;
      return `${Math.max(0, pickCount - (index - 1))}개 일치`;
    }
    return `${Math.max(0, pickCount - index)}개 일치`;
  };

  const formatPrizeReward = (prize = {}) => {
    if (prize?.type === "item") {
      return prize?.label || "아이템 보상";
    }

    const amount = Number(prize?.amount);
    if (Number.isFinite(amount)) {
      return `${formatDisplayMoney(amount)} ${currencyName}`;
    }

    return prize?.label || "-";
  };

  const toggleNumber = (numberValue) => {
    if (selectedNumbers.includes(numberValue)) {
      setSelectedNumbers((prev) => prev.filter((value) => value !== numberValue));
      return;
    }

    if (selectedNumbers.length >= pickCount) {
      showFeedback(`${pickCount}개까지만 번호를 선택할 수 있습니다.`, "warning");
      return;
    }

    setSelectedNumbers((prev) =>
      [...prev, numberValue].sort((left, right) => left - right),
    );
  };

  const handleAutoPick = () => {
    if (
      !Number.isFinite(maxNumber) ||
      !Number.isFinite(pickCount) ||
      maxNumber <= 0 ||
      pickCount <= 0 ||
      pickCount > maxNumber
    ) {
      showFeedback("자동 선택을 할 수 없는 설정입니다. 번호 개수와 최대 숫자 범위를 먼저 확인해 주세요.", "warning");
      return;
    }

    const numbers = new Set();
    while (numbers.size < pickCount) {
      numbers.add(Math.floor(Math.random() * maxNumber) + 1);
    }
    setSelectedNumbers(Array.from(numbers).sort((left, right) => left - right));
  };

  const handlePurchase = async () => {
    if (!isRoundOpen || !settings) {
      showFeedback("현재 진행 중인 회차가 없어서 행운의 복권을 구매할 수 없습니다. 먼저 회차 상태를 확인해 주세요.", "warning");
      return;
    }

    if (selectedNumbers.length !== pickCount) {
      showFeedback(`${pickCount}개의 번호를 모두 선택한 뒤 구매해 주세요.`, "warning");
      return;
    }

    if (!isPaymentTypeAllowed(settings?.allowedPaymentTypes, paymentType)) {
      showFeedback("현재 설정에서는 선택한 결제 방식으로 구매할 수 없습니다.", "warning");
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await buyLottoTicket(classId, {
        numbers: selectedNumbers,
        paymentType,
      });

      if (response.success) {
        showFeedback("행운의 복권 구매가 완료되었습니다. 내 티켓 목록에서 방금 선택한 번호를 확인할 수 있습니다.", "success");
        onClose();
      }
    } catch (error) {
      showFeedback(
        error.message || "행운의 복권을 구매하는 중 문제가 발생했습니다.",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      closeOnOverlayClick={false}
    >
      <Modal.Header className="relative overflow-hidden border-none bg-transparent pb-8 pt-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-full bg-cover bg-center opacity-95"
          style={{ backgroundImage: `url(${lottoArtwork})` }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-white/70 to-white"
        />
        <div className="relative z-10 flex w-full items-center justify-between pr-8">
          <div>
            <h2 className="text-xl font-black tracking-tight text-slate-800">
              행운의 복권 구매
            </h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
               회차별 규칙에 맞는 번호를 모두 선택한 뒤 원하는 결제 방식으로 진행하세요.
            </p>
          </div>
          <Button
            size="sm"
            kind="ghost"
            tone="rose"
            onClick={handleAutoPick}
            icon={RefreshCw}
            
          >
             자동 선택
          </Button>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-6">
        {!isRoundOpen && (
          <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-black text-amber-700">
              {roundStatus === "paused"
                 ? "현재 회차는 일시 정지 상태입니다. 판매가 다시 열릴 때까지 기다려 주세요."
                : roundStatus === "closed"
                 ? "현재 회차는 아직 판매 전입니다."
                : roundStatus === "finished"
                   ? "이미 추첨이 끝난 회차입니다."
                   : "현재 구매 가능한 행운의 복권 회차가 없습니다. 회차 상태를 먼저 확인해 주세요."}
            </p>
          </div>
        )}

        {paymentPolicy.id !== "both" && (
          <div className="flex items-center gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm">
              <Info className="text-slate-500" size={18} />
            </div>
            <div>
              <p className="text-xs font-black text-slate-700">결제 방식 안내</p>
              <p className="text-[11px] font-bold text-slate-500">
                 현재 행운의 복권은 {paymentPolicy.shortLabel}만 사용할 수 있습니다.
              </p>
            </div>
          </div>
        )}

        {prizeRows.length > 0 && (
          <div className="rounded-[1.75rem] border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-4 shadow-[inset_0_1px_12px_rgba(99,102,241,0.06)] sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black tracking-tight text-slate-800">이번 회차 당첨 보상</p>
                <p className="mt-0.5 text-[10px] font-bold text-slate-500">가장 큰 행운부터 확인해 보세요.</p>
              </div>
              <ArcadeInfoChip tone="indigo">
                총 {prizeRows.length}개 보상
              </ArcadeInfoChip>
            </div>

            <div className="relative overflow-hidden rounded-[1.5rem] border border-indigo-100 bg-gradient-to-br from-indigo-100 via-violet-50 to-fuchsia-100 p-4 text-slate-800 shadow-[0_10px_22px_rgba(99,102,241,0.10)] sm:p-5">
              <div className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/70 blur-2xl" />
              <div className="pointer-events-none absolute -bottom-10 left-1/3 h-24 w-24 rounded-full bg-fuchsia-200/25 blur-2xl" />
              <div className="relative flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/90 bg-white/75 shadow-sm">
                    <Trophy size={23} className="text-indigo-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black tracking-[0.16em] text-indigo-500">1등 최고 보상</p>
                    <p className="mt-0.5 truncate text-lg font-black text-slate-800">{getPrizeConditionText(0)}</p>
                    {grandPrize?.label && (
                      <p className="mt-0.5 truncate text-[10px] font-bold text-slate-500">{grandPrize.label}</p>
                    )}
                  </div>
                </div>
                <p className="shrink-0 text-right text-lg font-black text-indigo-600 sm:text-xl">
                  {formatPrizeReward(grandPrize)}
                </p>
              </div>
            </div>

            {otherPrizes.length > 0 && (
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                {otherPrizes.map((prize, index) => {
                  const rank = index + 2;
                  return (
                    <div
                      key={`${prize?.rank || rank}-${prize?.label || "prize"}`}
                      className="rounded-2xl border border-white/90 bg-white/90 p-3.5 shadow-[0_4px_12px_rgba(99,102,241,0.05)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-indigo-50 px-2 text-[10px] font-black text-indigo-600 ring-1 ring-indigo-100">
                          {rank}등
                        </span>
                        <p className="text-right text-sm font-black text-indigo-600">
                          {formatPrizeReward(prize)}
                        </p>
                      </div>
                      <p className="mt-3 text-sm font-black text-slate-800">{getPrizeConditionText(rank - 1)}</p>
                      {prize?.label && (
                        <p className="mt-1 truncate text-[10px] font-bold text-slate-400">{prize.label}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="relative overflow-hidden rounded-[2.5rem] border border-slate-100 bg-slate-50 p-6 text-center shadow-inner">
          <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
             선택한 번호
          </p>
          <div className="flex min-h-[52px] items-center justify-center gap-2">
            {Array.from({ length: pickCount }).map((_, index) => (
              <div
                key={index}
                className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-lg font-black transition-all ${selectedNumbers[index]
                  ? "scale-110 border-rose-400 bg-rose-500 text-white shadow-md"
                  : "border-dashed border-slate-100 bg-white text-slate-200"
                  }`}
              >
                {selectedNumbers[index] || ""}
              </div>
            ))}

            {useBonus && (
              <>
                <div className="px-1 font-black text-slate-300">+</div>
                <div className="flex h-12 w-12 flex-col items-center justify-center rounded-full border-2 border-white bg-slate-200 text-slate-500 shadow-inner">
                  <span className="text-[7px] font-black leading-none opacity-60">
                    보너스
                  </span>
                  <span className="text-sm font-black">?</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
          {Array.from({ length: maxNumber }).map((_, index) => {
            const numberValue = index + 1;
            const isSelected = selectedNumbers.includes(numberValue);

            return (
              <Button
                key={numberValue}
                onClick={() => toggleNumber(numberValue)}
                disabled={!isRoundOpen || isSubmitting}
                className={`aspect-square rounded-2xl border-2 text-sm font-black transition-all flex items-center justify-center ${isSelected
                  ? "scale-90 border-rose-400 bg-rose-500 text-white shadow-inner"
                  : "border-slate-50 bg-white text-slate-400 hover:border-rose-200 hover:text-rose-500"
                  }`}
              >
                {isSelected ? <Check size={20} strokeWidth={4} /> : numberValue}
              </Button>
            );
          })}
        </div>

        <div
          className={`grid gap-3 rounded-[1.5rem] bg-slate-100 p-2 ${cashAllowed && ticketAllowed ? "grid-cols-2" : "grid-cols-1"
            }`}
        >
          {cashAllowed && (
            <Button
              onClick={() => setPaymentType("cash")}
              disabled={!isRoundOpen}
              className={`flex items-center justify-center gap-2 rounded-2xl py-3 text-xs font-bold transition-all ${paymentType === "cash"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-400"
                }`}
            >
              <Coins
                size={14}
                className={paymentType === "cash" ? "text-amber-500" : ""}
              />
              현금 결제{" "}
              {formatArcadeChargeLabel({formatAmount: formatDisplayMoney,
                price,
                feeAmount,
                currencyName,
              })}
            </Button>
          )}

          {ticketAllowed && (
            <Button
              onClick={() => setPaymentType("ticket")}
              disabled={!isRoundOpen || userTickets <= 0}
              className={`flex items-center justify-center gap-2 rounded-2xl py-3 text-xs font-bold transition-all ${paymentType === "ticket"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-400"
                } ${userTickets <= 0 ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <Ticket
                size={14}
                className={paymentType === "ticket" ? "text-blue-500" : ""}
              />
              {formatArcadeChargeLabel({formatAmount: formatDisplayMoney,
                feeAmount,
                isTicketUsed: true,
                currencyName,
              })}{" "}
               (보유 티켓: {userTickets}장)
            </Button>
          )}
        </div>

        <div className="flex items-center justify-center gap-1.5 text-slate-500">
          <Info size={12} />
          <span className="text-[10px] font-bold">선택한 결제 금액 {selectedChargeDetail}</span>
        </div>

        {useBonus && (
          <div className="flex items-center justify-center gap-1.5 text-slate-400">
            <Info size={12} />
            <span className="text-[10px] font-bold">
               보너스 번호는 추첨 시 별도로 공개되며, 등수 판정에 함께 반영됩니다.
            </span>
          </div>
        )}

        {isSelectedPaymentUnavailable && (
          <div className="flex items-center justify-center gap-1.5 text-amber-600">
            <Info size={12} />
            <span className="text-[10px] font-bold">
               티켓이 부족하면 티켓 결제를 선택할 수 없습니다. 현금 결제로 바꾸거나 티켓을 먼저 확보해 주세요.
            </span>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button
          tone="slate"
          kind="ghost"
          onClick={onClose}
          disabled={isSubmitting}
        >
           취소
        </Button>
        <Button
          tone="rose"
          fullWidth
          size="lg"
          onClick={handlePurchase}
          isLoading={isSubmitting}
          disabled={
            !isRoundOpen ||
            selectedNumbers.length !== pickCount ||
            isSelectedPaymentUnavailable
          }
          icon={Sparkles}
          className="h-16 rounded-3xl text-xl font-black shadow-xl shadow-rose-200 transition-all active:scale-95"
        >
           행운의 복권 구매하기
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default LottoPurchaseModal;
