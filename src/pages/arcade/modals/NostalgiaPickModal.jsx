import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Coins,
  Info,
  Loader2,
  Ticket,
  X,
} from "lucide-react";
import { Button } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  buyNostalgiaPickEntry,
  subscribeNostalgiaPickRoundEntries,
} from "../services/arcadeServices";
import {
  getPaymentPolicyMeta,
  getPrimaryPaymentType,
  isPaymentTypeAllowed,
} from "../utils/paymentPolicy";
import {
  formatArcadeChargeDetail,
  formatArcadeChargeLabel,
  getArcadeFeeAmount,
} from "../utils/chargeUtils";

const formatDateTime = (value) => {
  if (!value) return "마감 시간 없음";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "마감 시간 없음";
  return date.toLocaleString();
};

const NostalgiaPickModal = ({
  isOpen,
  onClose,
  classId,
  settings = {},
  roundData = null,
  roundStatus = null,
  initialPaymentType = "cash",
  userTickets = 0,
  currencyName = "단위",
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { userData } = useUser();
  const { showFeedback } = useFeedback();
  const userId = userData?.uid;
  const boardSize = Math.max(0, Number(settings?.boardSize || 0));
  const price = settings?.price ?? 100;
  const feeAmount = getArcadeFeeAmount(settings?.feeAmount);
  const isRoundOpen = roundStatus === "open";
  const cashAllowed = isPaymentTypeAllowed(settings?.allowedPaymentTypes, "cash");
  const ticketAllowed = isPaymentTypeAllowed(settings?.allowedPaymentTypes, "ticket");
  const paymentPolicy = getPaymentPolicyMeta(settings?.allowedPaymentTypes);
  const fallbackPaymentType = useMemo(() => {
    if (isPaymentTypeAllowed(settings?.allowedPaymentTypes, initialPaymentType)) {
      return initialPaymentType;
    }
    return getPrimaryPaymentType(settings?.allowedPaymentTypes);
  }, [initialPaymentType, settings?.allowedPaymentTypes]);

  const [entries, setEntries] = useState([]);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [paymentType, setPaymentType] = useState(fallbackPaymentType);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setPaymentType((current) =>
      isPaymentTypeAllowed(settings?.allowedPaymentTypes, current)
        ? current
        : fallbackPaymentType,
    );
  }, [fallbackPaymentType, settings?.allowedPaymentTypes]);

  useEffect(() => {
    if (!isOpen || !classId || !roundData?.id) {
      setEntries([]);
      setEntriesLoaded(false);
      return undefined;
    }

    setEntriesLoaded(false);
    return subscribeNostalgiaPickRoundEntries(classId, roundData.id, (nextEntries) => {
      setEntries(nextEntries || []);
      setEntriesLoaded(true);
    });
  }, [classId, isOpen, roundData?.id]);

  const activeEntries = useMemo(
    () => entries.filter((entry) => String(entry.status || "active") === "active"),
    [entries],
  );
  const entryMap = useMemo(() => {
    const map = new Map();
    activeEntries.forEach((entry) => {
      map.set(Number(entry.slotNumber), entry);
    });
    return map;
  }, [activeEntries]);
  const myEntries = useMemo(
    () => activeEntries.filter((entry) => entry.studentUid === userId),
    [activeEntries, userId],
  );
  const maxEntriesPerStudent = Number(settings?.maxEntriesPerStudent || 0);
  const hasEntryLimit =
    Number.isFinite(maxEntriesPerStudent) && maxEntriesPerStudent > 0;
  const isEntryLimitReached =
    hasEntryLimit && myEntries.length >= maxEntriesPerStudent;
  const isSelectedPaymentUnavailable =
    paymentType === "ticket" && userTickets <= 0;
  const selectedChargeDetail = formatArcadeChargeDetail({formatAmount: formatDisplayMoney,
    price,
    feeAmount,
    isTicketUsed: paymentType === "ticket",
    currencyName,
  });

  const handleSelectSlot = (slotNumber) => {
    if (!isRoundOpen || isSubmitting || entryMap.has(slotNumber)) return;
    if (isEntryLimitReached) {
      showFeedback("이번 회차에서 더 이상 이름을 적을 수 없습니다.", "warning");
      return;
    }
    setSelectedSlot(slotNumber);
  };

  const handleSubmit = async () => {
    if (!selectedSlot) {
      showFeedback("이름을 적을 번호를 선택해 주세요.", "warning");
      return;
    }
    if (!isRoundOpen) {
      showFeedback("현재 이름을 적을 수 있는 회차가 없습니다.", "warning");
      return;
    }
    if (!isPaymentTypeAllowed(settings?.allowedPaymentTypes, paymentType)) {
      showFeedback("현재 설정에서 사용할 수 없는 결제 방식입니다.", "warning");
      return;
    }
    if (isSelectedPaymentUnavailable) {
      showFeedback("보유 티켓이 부족합니다.", "warning");
      return;
    }

    try {
      setIsSubmitting(true);
      await buyNostalgiaPickEntry(classId, {
        slotNumber: selectedSlot,
        paymentType,
      });
      showFeedback(`${selectedSlot}번에 이름을 적었습니다.`, "success");
      setSelectedSlot(null);
    } catch (error) {
      showFeedback(error?.message || "이름을 적는 중 문제가 발생했습니다.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-rose-500">
              추억의 뽑기
            </p>
            <h2 className="mt-1 text-2xl font-black text-slate-800">
              {roundData?.title || "진행 중인 회차 없음"}
            </h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              원하는 번호에 이름을 적고 마감 후 추첨을 기다립니다.
            </p>
          </div>
          <Button tone="slate" kind="outline" size="icon-md"
            type="button"
            onClick={onClose}
            className="flex w-10 items-center justify-center transition"
            aria-label="닫기"
          >
            <X size={18} />
          </Button>
        </div>

        <div className="grid gap-0 overflow-hidden lg:grid-cols-[1fr_280px]">
          <div className="min-h-0 overflow-y-auto bg-slate-50 p-5">
            {!entriesLoaded ? (
              <div className="flex min-h-[360px] items-center justify-center text-slate-500">
                <Loader2 className="mr-2 animate-spin" size={20} />
                번호판을 불러오는 중입니다.
              </div>
            ) : boardSize <= 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm font-bold text-slate-500">
                아직 열려 있는 추억의 뽑기 회차가 없습니다.
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-11">
                {Array.from({ length: boardSize }).map((_, index) => {
                  const slotNumber = index + 1;
                  const entry = entryMap.get(slotNumber);
                  const isMine = entry?.studentUid === userId;
                  const isSelected = selectedSlot === slotNumber;

                  return (
                    <Button
                      key={slotNumber}
                      type="button"
                      onClick={() => handleSelectSlot(slotNumber)}
                      disabled={!isRoundOpen || isSubmitting || Boolean(entry)}
                      className={[
                        "flex aspect-square min-h-[54px] flex-col items-center justify-center rounded-xl border text-center transition",
                        isSelected
                          ? "border-rose-400 bg-rose-500 text-white shadow-md"
                          : entry
                            ? isMine
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-white text-slate-400"
                            : "border-slate-200 bg-white text-slate-700 hover:border-rose-300 hover:text-rose-600",
                      ].join(" ")}
                    >
                      <span className="text-sm font-black">{slotNumber}</span>
                      {entry ? (
                        <span className="mt-1 max-w-full truncate px-1 text-[10px] font-bold">
                          {entry.studentName || "학생"}
                        </span>
                      ) : isSelected ? (
                        <Check size={16} strokeWidth={4} />
                      ) : null}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="space-y-4 border-t border-slate-100 bg-white p-5 lg:border-l lg:border-t-0">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                참여 현황
              </p>
              <p className="mt-2 text-2xl font-black text-slate-800">
                {activeEntries.length} / {boardSize || 0}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                내 번호 {myEntries.length}
                {hasEntryLimit ? ` / ${maxEntriesPerStudent}` : ""}
              </p>
            </div>

            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-sm font-black text-amber-800">
                <CalendarClock size={16} />
                {formatDateTime(settings?.endTime)}
              </div>
              <p className="mt-2 text-xs font-semibold text-amber-700">
                마감 후 선생님이 추첨하면 당첨자가 공개됩니다.
              </p>
            </div>

            {paymentPolicy.id !== "both" && (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-black text-slate-700">
                  <Info size={16} />
                  {paymentPolicy.shortLabel}
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  현재 설정된 결제 방식만 사용할 수 있습니다.
                </p>
              </div>
            )}

            <div
              className={`grid gap-2 rounded-2xl bg-slate-100 p-2 ${
                cashAllowed && ticketAllowed ? "grid-cols-2" : "grid-cols-1"
              }`}
            >
              {cashAllowed && (
                <Button
                  type="button"
                  onClick={() => setPaymentType("cash")}
                  disabled={!isRoundOpen}
                  className={`rounded-xl px-3 py-3 text-xs font-black transition ${
                    paymentType === "cash"
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-400"
                  }`}
                >
                  <Coins className="mx-auto mb-1" size={15} />
                  {formatArcadeChargeLabel({formatAmount: formatDisplayMoney,  price, feeAmount, currencyName })}
                </Button>
              )}

              {ticketAllowed && (
                <Button
                  type="button"
                  onClick={() => setPaymentType("ticket")}
                  disabled={!isRoundOpen || userTickets <= 0}
                  className={`rounded-xl px-3 py-3 text-xs font-black transition ${
                    paymentType === "ticket"
                      ? "bg-white text-blue-600 shadow-sm"
                      : "text-slate-400"
                  } ${userTickets <= 0 ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <Ticket className="mx-auto mb-1" size={15} />
                  {formatArcadeChargeLabel({formatAmount: formatDisplayMoney,
                    feeAmount,
                    isTicketUsed: true,
                    currencyName,
                  })}
                </Button>
              )}
            </div>

            <p className="text-center text-[11px] font-bold text-slate-500">
              선택한 결제: {selectedChargeDetail}
            </p>

            <Button
              tone="rose"
              size="lg"
              fullWidth
              onClick={handleSubmit}
              isLoading={isSubmitting}
              disabled={
                !isRoundOpen ||
                !selectedSlot ||
                isEntryLimitReached ||
                isSelectedPaymentUnavailable
              }
              
            >
              {selectedSlot ? `${selectedSlot}번에 이름 적기` : "번호 선택"}
            </Button>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default NostalgiaPickModal;
