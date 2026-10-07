import { appConfirm } from "../../../utils/appDialogs";
import React, { useMemo, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import {
  BanknotesIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  NoSymbolIcon,
  RocketLaunchIcon,
  TrophyIcon,
  WalletIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";

import {
  Button,
  CardSkeleton,
  Modal,
  SurfaceLoader,
} from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { useStudentBankHistory } from "../../../hooks/bank/useBankHistory";
import { getDepositInterestWithholdingPolicy } from "../../../utils/taxPolicy";
import DepositHistoryFilterBar from "../components/DepositHistoryFilterBar";
import SavingTerminationSummary from "../components/SavingTerminationSummary";
import {
  calculateMaturityDate,
  isClaimableByMaturity,
} from "../utils/dateUtils";
import { buildSavingClaimBreakdown } from "../utils/savingPayoutUtils";
import {
  formatDateKeyInKST,
  parseDateKeyAsKST,
} from "../../../utils/kstDate";
import { formatBankMoney } from "../../../utils/bankMoney";

dayjs.locale("ko");

const INITIAL_START_DATE = formatDateKeyInKST(
  dayjs().subtract(30, "day").toDate(),
);
const INITIAL_END_DATE = formatDateKeyInKST(new Date());
const INITIAL_STATUSES = ["pending", "active"];

const formatMoney = (value, currencyUnit) =>
  `${formatBankMoney(value)}${currencyUnit || ""}`;

const STATUS_THEME_MAP = {
  pending: { label: "승인 대기", color: "amber", Icon: ClockIcon },
  completed: { label: "수령 완료", color: "slate", Icon: CheckCircleIcon },
  cancelled_request: {
    label: "신청 취소",
    color: "slate",
    Icon: XMarkIcon,
  },
  terminated: { label: "중도 해지", color: "rose", Icon: XCircleIcon },
  rejected: { label: "승인 거절", color: "rose", Icon: NoSymbolIcon },
  fallback: { label: "진행 중", color: "slate", Icon: ClockIcon },
};

export default function DepositHistoryModal({
  open,
  onClose,
  studentName,
  savings: initialSavings = [],
  processSavingAction,
  isMyBankPage: isMyBankPageProp,
  currencyUnit,
  isProcessing,
  studentInfo,
  uid,
  classId,
}) {
  const { userData, classData } = useUser();
  const withholdingPolicy = getDepositInterestWithholdingPolicy(classData);
  const { data: savings = [], isLoading: isSavingsLoading } =
    useStudentBankHistory(classId, uid, "savings", {
      enabled: open,
      initialData: initialSavings,
    });

  const [startDate, setStartDate] = useState(INITIAL_START_DATE);
  const [endDate, setEndDate] = useState(INITIAL_END_DATE);
  const [selectedStatuses, setSelectedStatuses] = useState(INITIAL_STATUSES);

  const isActuallyMe = useMemo(() => {
    if (isMyBankPageProp) return true;
    return userData?.uid === studentInfo?.uid;
  }, [isMyBankPageProp, studentInfo?.uid, userData?.uid]);

  const filteredSavings = useMemo(() => {
    return (savings || []).filter((saving) => {
      const hiddenStatuses = [
        "cancelled_request",
        "completed",
        "terminated",
        "rejected",
      ];

      if (selectedStatuses.length > 0) {
        if (!selectedStatuses.includes(saving.status)) return false;
      } else if (hiddenStatuses.includes(saving.status)) {
        return false;
      }

      const createdAt = saving.createdAt?.toDate?.() || saving.createdAt;
      const recordDate = createdAt ? new Date(createdAt) : null;
      const fromDate = parseDateKeyAsKST(startDate);
      const toDateBound = parseDateKeyAsKST(endDate, { endOfDay: true });

      if (fromDate && recordDate && recordDate < fromDate) return false;
      if (toDateBound && recordDate && recordDate > toDateBound) return false;

      return true;
    });
  }, [endDate, savings, selectedStatuses, startDate]);

  const handleClearFilters = () => {
    setSelectedStatuses(INITIAL_STATUSES);
    setStartDate(INITIAL_START_DATE);
    setEndDate(INITIAL_END_DATE);
  };

  const getStatusTheme = (status, isMatured) => {
    if (status === "active") {
      return isMatured
        ? { label: "만기 도래", color: "emerald", Icon: TrophyIcon }
        : { label: "운용 중", color: "blue", Icon: RocketLaunchIcon };
    }

    return STATUS_THEME_MAP[status] || STATUS_THEME_MAP.fallback;
  };

  if (!open) return null;
  const hasFilteredSavings = filteredSavings.length > 0;

  return (
    <Modal isOpen={open} onClose={onClose} title="" size="4xl">
      <div className="flex max-h-[85vh] min-h-[600px] flex-col bg-slate-50">
        <div className="border-b border-slate-100 bg-white px-8 pb-6 pt-8">
          <div className="mb-6 flex items-center gap-4">
            <div className="rounded-2xl bg-blue-600 p-3 shadow-lg shadow-blue-100">
              <WalletIcon className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight text-slate-900">
                {studentName} 예금 내역
              </h2>
              <p className="mt-0.5 text-xs font-bold text-slate-400">
                기간과 상태를 기준으로 예금 신청, 진행, 수령 이력을 확인할 수
                있어요.
              </p>
            </div>
          </div>

          <DepositHistoryFilterBar
            selectedStatuses={selectedStatuses}
            onStatusChange={setSelectedStatuses}
            onClearFilters={handleClearFilters}
            startDate={startDate}
            endDate={endDate}
            onChangeStartDate={setStartDate}
            onChangeEndDate={setEndDate}
            filteredCount={filteredSavings.length}
            totalCount={savings.length}
          />
        </div>

        <div className="scrollbar-hide flex-grow overflow-y-auto p-6">
          <SurfaceLoader
            loading={isSavingsLoading}
            variant={hasFilteredSavings ? "refreshing" : "surface-loading"}
            preserveContent={hasFilteredSavings}
            skeleton={
              <div className="grid grid-cols-1 gap-4 p-2 md:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <CardSkeleton
                    key={`deposit-history-skeleton-${index}`}
                    bare
                    className="min-h-[210px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                    rows={5}
                    showFooter
                  />
                ))}
              </div>
            }
            minHeightClassName="min-h-[360px]"
          >
            {hasFilteredSavings ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {filteredSavings.map((saving) => {
                const isMatured =
                  saving.status === "active" &&
                  isClaimableByMaturity(saving, new Date());
                const theme = getStatusTheme(saving.status, isMatured);

                const maturityTimestamp = saving.expectedMaturityDate;
                const maturityDate =
                  maturityTimestamp &&
                  typeof maturityTimestamp.toDate === "function"
                    ? maturityTimestamp.toDate()
                    : saving.status === "active"
                      ? calculateMaturityDate(saving)
                      : null;

                const startRaw = saving.startedAt || saving.createdAt;
                const start = dayjs(startRaw?.toDate?.() || startRaw);
                const progress =
                  saving.status === "active"
                    ? Math.min(
                        100,
                        (dayjs().diff(start, "day") / (saving.days || 1)) * 100,
                      )
                    : saving.status === "completed"
                      ? 100
                      : 0;

                const dDay =
                  maturityDate && dayjs(maturityDate).isValid()
                    ? dayjs(maturityDate).diff(dayjs(), "day")
                    : null;

                const claimBreakdown = buildSavingClaimBreakdown({
                  saving,
                  withholdingPolicy,
                });
                const showPayoutBreakdown =
                  claimBreakdown.hasInterest &&
                  (saving.status === "completed" ||
                    (saving.status === "active" && isMatured));
                const showWithholdingDetails =
                  claimBreakdown.shouldShowWithholding;

                return (
                  <div
                    key={saving.id}
                    className="relative flex min-h-[210px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="flex items-start justify-between p-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`rounded-xl bg-${theme.color}-50 p-2 text-${theme.color}-500`}
                        >
                          <theme.Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="w-32 truncate text-sm font-black text-slate-800">
                            {saving.productLabel}
                          </h4>
                          <span
                            className={`text-[10px] font-bold text-${theme.color}-600`}
                          >
                            {theme.label}
                          </span>
                        </div>
                      </div>
                      {saving.status === "active" && dDay !== null && (
                        <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">
                          {dDay > 0 ? `D-${dDay}` : "오늘 만기"}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between border-y border-slate-100 bg-slate-50/50 px-4 py-3">
                      <div>
                        <p className="text-[9px] font-bold uppercase text-slate-400">
                          원금
                        </p>
                        <p className="text-sm font-black text-slate-900">
                          {formatBankMoney(saving.amount)}
                          {currencyUnit}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-bold uppercase text-slate-400">
                          예정 이자 ({saving.finalRate || saving.rate}%)
                        </p>
                        <p className="text-sm font-black text-emerald-500">
                          +{formatBankMoney(saving.expectedProfit || 0)}
                          {currencyUnit}
                        </p>
                      </div>
                    </div>

                    {saving.status === "terminated" && <SavingTerminationSummary saving={saving} currencyUnit={currencyUnit} />}

                    {showPayoutBreakdown && (
                      <div className="border-b border-slate-100 bg-amber-50/60 px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-black uppercase tracking-wide text-amber-700">
                            {claimBreakdown.isEstimate
                              ? "만기 수령 예상"
                              : "수령 내역"}
                          </p>
                          {showWithholdingDetails && (
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-100">
                              원천징수 {claimBreakdown.taxRate}%
                            </span>
                          )}
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                          <div className="rounded-xl bg-white/80 px-3 py-2">
                            <p className="text-slate-400">세전 이자</p>
                            <p className="mt-1 font-black text-emerald-600">
                              +{formatMoney(claimBreakdown.grossInterest, currencyUnit)}
                            </p>
                          </div>
                          {showWithholdingDetails && (
                            <div className="rounded-xl bg-white/80 px-3 py-2">
                              <p className="text-slate-400">원천징수세</p>
                              <p className="mt-1 font-black text-rose-500">
                                -{formatMoney(claimBreakdown.taxAmount, currencyUnit)}
                              </p>
                            </div>
                          )}
                          <div className="rounded-xl bg-white/80 px-3 py-2">
                            <p className="text-slate-400">실수령 이자</p>
                            <p className="mt-1 font-black text-slate-900">
                              +{formatMoney(claimBreakdown.netInterest, currencyUnit)}
                            </p>
                          </div>
                          <div className="rounded-xl bg-white/80 px-3 py-2">
                            <p className="text-slate-400">최종 수령액</p>
                            <p className="mt-1 font-black text-slate-900">
                              {formatMoney(claimBreakdown.totalPaid, currencyUnit)}
                            </p>
                          </div>
                        </div>

                        <p className="mt-2 text-[10px] leading-4 text-amber-700">
                          {showWithholdingDetails
                            ? claimBreakdown.isEstimate
                              ? "세전 이자에서 원천징수세를 차감한 예상 수령액입니다."
                              : "실제 지급된 원천징수 내역이 반영된 수령액입니다."
                            : claimBreakdown.isLegacyWithoutWithholdingData
                              ? "이 예금은 원천징수 기준이 저장되기 전에 생성되어 세금 차감 없이 지급됩니다."
                              : "원천징수 없이 만기 이자가 지급됩니다."}
                        </p>
                      </div>
                    )}

                    <div className="mt-auto p-4">
                      <div className="mb-3 flex items-center justify-between text-[10px] font-bold text-slate-400">
                        <div className="flex items-center gap-1">
                          <CalendarIcon className="h-3 w-3" />
                          {saving.status === "pending"
                            ? "승인 후 만기일이 확정됩니다"
                            : maturityDate && dayjs(maturityDate).isValid()
                              ? `${dayjs(maturityDate).format("YYYY.MM.DD")} 만기`
                              : "만기일 정보 없음"}
                        </div>
                        <span>{Math.floor(progress)}%</span>
                      </div>

                      {isActuallyMe &&
                        saving.status === "active" &&
                        isMatured &&
                        showWithholdingDetails && (
                          <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[10px] font-medium leading-4 text-amber-700">
                            이 예금은 만기 수령 시 세전 이자에서{" "}
                            {claimBreakdown.taxRate}%가 원천징수됩니다.
                          </div>
                        )}

                      <div className="flex gap-1.5">
                        {isActuallyMe &&
                          saving.status === "active" &&
                          isMatured && (
                            <Button
                              size="sm"
                              tone="emerald"
                              className="w-full"
                              onClick={() => processSavingAction(saving, "claim")}
                              isLoading={isProcessing}
                            >
                              만기 수령
                            </Button>
                          )}
                        {isActuallyMe && saving.status === "pending" && (
                          <Button
                            size="sm"
                            tone="slate"
                            kind="soft"
                            className="w-full"
                            onClick={() => processSavingAction(saving, "cancel_request")}
                            isLoading={isProcessing}
                          >
                            신청 취소
                          </Button>
                        )}
                        {isActuallyMe &&
                          saving.status === "active" &&
                          !isMatured && (
                            <Button
                              size="sm"
                              tone="rose"
                              kind="ghost"
                              className="w-full"
                              disabled={saving.earlyTerminationBlocked === true}
                              onClick={async () =>
                                saving.earlyTerminationBlocked !== true &&
                                (await appConfirm("예금을 중도 해지할까요?", {"title":"중도 해지 확인","confirmLabel":"중도 해지","tone":"rose"})) &&
                                processSavingAction(saving, "terminate")
                              }
                              isLoading={isProcessing}
                            >
                              {saving.earlyTerminationBlocked === true
                                ? "중도해지 불가"
                                : "중도 해지"}
                            </Button>
                          )}
                      </div>
                    </div>

                    <div className="absolute bottom-0 left-0 h-[3px] w-full bg-slate-100">
                      <div
                        style={{ width: `${progress}%` }}
                        className="h-full bg-blue-500 transition-all duration-700"
                      />
                    </div>
                  </div>
                );
                })}
              </div>
            ) : (
              <div className="py-24 text-center opacity-30">
                <BanknotesIcon className="mx-auto mb-4 h-16 w-16" />
                <p className="font-bold">조건에 맞는 예금 내역이 없습니다.</p>
              </div>
            )}
          </SurfaceLoader>
        </div>
      </div>
    </Modal>
  );
}
