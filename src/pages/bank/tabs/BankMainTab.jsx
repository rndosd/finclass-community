import React, { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Landmark,
  PiggyBank,
  Send,
  ShieldCheck,
} from "lucide-react";

import { Button, Card, Modal, ErrorState, SectionLoader } from "../../../components/ui";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useFundMode } from "../../../contexts/FundModeContext";
import { db } from "../../../firebase";
import { formatBankMoney } from "../../../utils/bankMoney";
import { getUserFacingRecordDescription } from "../../../utils/userFacingRecordDescription";
import { getActivityDisplayInfo } from "../../../utils/activityUtils";
import { loadRecentBankActivities } from "../services/recentBankActivities";
import TransferCard from "../components/TransferCard";
import ClassFundPayoutModal from "../modals/ClassFundPayoutModal";
import walletIllustration from "../../../assets/dashboard/wallet-2p5d-v1.webp";


const formatRateModifier = (value) => {
  const rate = Number(value || 0);
  return (rate >= 0 ? "+" : "") + rate.toFixed(1) + "%p";
};

function BankMainTab({
  studentAssets,
  creditScore,
  currentTierInfo,
  currentRateModifiers,
  currencyUnit = "단위",
  classId,
  currentStudentUid,
  studentInfo,
  bankSettings,
  savings = [],
  loans = [],
  onTabChange,
  onTransferSuccess,
  hasPermission,
}) {
  const { formatClassCurrency } = useNumberFormat();
  const { activeFund, activeFundId, getChannelAccess, isFundMode } = useFundMode();
  const bankPayoutAccess = getChannelAccess("bankPayout");
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isFundPayoutOpen, setIsFundPayoutOpen] = useState(false);
  const [recentActivities, setRecentActivities] = useState([]);
  const [recentActivityLoading, setRecentActivityLoading] = useState(true);
  const [recentActivityError, setRecentActivityError] = useState(false);
  const [recentActivityRetry, setRecentActivityRetry] = useState(0);

  const currentStudent =
    studentInfo && currentStudentUid
      ? {
          ...studentInfo,
          uid: currentStudentUid,
          assets: studentAssets,
          creditTier: currentTierInfo,
        }
      : null;

  const cash = Number(studentAssets?.cash || 0);
  const reservedCash = Number(studentAssets?.reserved?.cash || 0);
  const availableCash = cash - reservedCash;
  const deposit = Number(studentAssets?.deposit || 0);
  const currentLoan = Number(studentAssets?.loan || 0);
  const totalNetWorth = Number(studentAssets?.totalNetWorth || 0);

  const bankFundsTotal = Math.max(0, availableCash) + Math.max(0, deposit);
  const depositRatio =
    bankFundsTotal > 0 ? (Math.max(0, deposit) / bankFundsTotal) * 100 : 0;

  const isLoanLimitEnabled = Boolean(bankSettings?.isLoanLimitRatioEnabled);
  const loanLimitRatio = Number(
    studentInfo?.loanLimitRatio ??
      bankSettings?.defaultLoanLimitRatio ??
      bankSettings?.loanLimitRatio ??
      0.5,
  );
  const loanLimit = isLoanLimitEnabled
    ? Math.max(0, totalNetWorth * loanLimitRatio)
    : null;
  const loanUsed = Math.max(0, currentLoan);
  const remainingLoanLimit =
    loanLimit === null ? null : Math.max(0, loanLimit - loanUsed);
  const loanUsageRatio =
    loanLimit && loanLimit > 0
      ? Math.min(100, Math.max(0, (loanUsed / loanLimit) * 100))
      : 0;

  useEffect(() => {
    if (!classId || !currentStudentUid) {
      setRecentActivities([]);
      setRecentActivityError(false);
      setRecentActivityLoading(false);
      return undefined;
    }

    let cancelled = false;
    setRecentActivityLoading(true);
    setRecentActivityError(false);

    const loadRecentActivities = async () => {
      try {
        const activities = await loadRecentBankActivities({
          db,
          classId,
          studentUid: currentStudentUid,
          currencyUnit,
        });
        if (cancelled) return;
        setRecentActivities(activities);
      } catch {
        if (cancelled) return;
        setRecentActivities([]);
        setRecentActivityError(true);
      } finally {
        if (!cancelled) setRecentActivityLoading(false);
      }
    };

    void loadRecentActivities();

    return () => {
      cancelled = true;
    };
  }, [classId, currencyUnit, currentStudentUid, availableCash, deposit, currentLoan, recentActivityRetry]);

  const handleTransferSuccess = () => {
    setIsTransferOpen(false);
    onTransferSuccess?.();
  };

  const activeDepositProductCount = (
    Array.isArray(bankSettings?.depositProducts)
      ? bankSettings.depositProducts
      : []
  ).filter((product) => product?.active !== false).length;
  const activeSavingCount = (Array.isArray(savings) ? savings : []).filter(
    (saving) => saving?.status === "active",
  ).length;
  const activeLoanCount = (Array.isArray(loans) ? loans : []).filter((loan) =>
    ["ongoing", "approved"].includes(String(loan?.status || "")),
  ).length;
  const hasLoanHint = currentLoan > 0 || activeLoanCount > 0;

  return (
    <>
      <div className="space-y-4 sm:space-y-6">
        <Card
          noPadding
          variant="flat"
          className="overflow-hidden rounded-3xl border border-slate-200 bg-white"
        >
          <Card.Content noPadding>
            <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="relative overflow-hidden bg-slate-50/80 px-5 py-5 sm:px-6 sm:py-6">
                <div className="relative z-10 max-w-[70%] sm:max-w-[74%]">
                  <p className="text-xs font-semibold text-slate-500">
                    사용 가능 현금
                  </p>
                  <p className="mt-2 flex flex-wrap items-baseline gap-1.5">
                    <strong className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                      {formatBankMoney(availableCash)}
                    </strong>
                    <span className="text-sm font-bold text-slate-400">
                      {currencyUnit}
                    </span>
                  </p>
                  <p className="mt-2 text-xs font-medium text-slate-500">
                    예약금을 제외하고 지금 사용할 수 있는 금액입니다.
                  </p>

                  <div
                    className="mt-4 flex max-w-full flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-500"
                    aria-label="신용과 이율 보정 정보"
                  >
                    <span className="max-w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 leading-5">
                      신용{" "}
                      <strong className="text-slate-800">
                        {currentTierInfo?.name || "등급 정보 없음"} ·{" "}
                        {formatBankMoney(creditScore || 0)}점
                      </strong>
                    </span>
                    <span className="whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-emerald-700">
                      예금{" "}
                      <strong>
                        {formatRateModifier(
                          currentRateModifiers?.depositRateModifier,
                        )}
                      </strong>
                    </span>
                    <span className="whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-rose-700">
                      대출{" "}
                      <strong>
                        {formatRateModifier(
                          currentRateModifiers?.loanRateModifier,
                        )}
                      </strong>
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {!isFundMode && hasPermission("action_bank_transfer") ? (
                      <Button
                        tone="blue"
                        icon={Send}
                        onClick={() => setIsTransferOpen(true)}
                      >
                        송금
                      </Button>
                    ) : !isFundMode ? (
                      <span className="text-xs font-bold text-slate-400">
                        송금 권한 없음
                      </span>
                    ) : null}
                    {isFundMode ? (
                      <div className="flex flex-col items-start gap-1">
                        <button
                          type="button"
                          onClick={() => setIsFundPayoutOpen(true)}
                          disabled={!bankPayoutAccess.allowed}
                          title={
                            bankPayoutAccess.allowed
                              ? `${activeFund?.name || "기금"}에서 학생에게 지급`
                              : bankPayoutAccess.reason
                          }
                          className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-bold text-emerald-700 transition hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-white"
                        >
                          <Landmark size={17} />
                          학생에게 지급
                        </button>
                        {!bankPayoutAccess.allowed ? (
                          <span className="text-xs font-bold text-amber-700">
                            {bankPayoutAccess.reason}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <img
                  src={walletIllustration}
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-1 right-3 h-32 w-32 object-contain opacity-90 sm:right-7 sm:h-36 sm:w-36"
                />
              </div>

              <div className="border-t border-slate-100 bg-white p-5 sm:p-6 lg:border-l lg:border-t-0">
                <div>
                  <p className="text-xs font-semibold text-slate-500">
                    은행 가이드
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    다음에 할 일을 확인해 보세요
                  </p>
                </div>

                <div className="mt-4 divide-y divide-slate-100">
                  <button
                    type="button"
                    onClick={() => onTabChange?.("deposit_apply")}
                    className="group flex w-full items-center gap-3 py-3 text-left"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <PiggyBank size={19} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block text-sm font-bold text-slate-800">
                        저축
                      </strong>
                      <small className="mt-0.5 block text-xs font-medium leading-5 text-slate-500">
                        {activeSavingCount > 0
                          ? "예금 " +
                            activeSavingCount +
                            "건을 차곡차곡 모으고 있어요."
                          : activeDepositProductCount > 0
                            ? "가입 가능한 예금 상품이 " +
                              activeDepositProductCount +
                              "개 있어요."
                            : "현재 가입 가능한 예금 상품이 없어요."}
                      </small>
                    </span>
                    <ArrowRight
                      size={17}
                      className="shrink-0 text-slate-300 transition group-hover:text-blue-600"
                    />
                  </button>

                  {hasLoanHint ? (
                    <button
                      type="button"
                      onClick={() => onTabChange?.("loan_apply")}
                      className="group flex w-full items-center gap-3 py-3 text-left"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                        <Landmark size={19} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block text-sm font-bold text-slate-800">
                          대출
                        </strong>
                        <small className="mt-0.5 block text-xs font-medium leading-5 text-slate-500">
                          {activeLoanCount > 0
                            ? "진행 중인 대출 " +
                              activeLoanCount +
                              "건의 상환 일정을 확인해 보세요."
                            : "갚아야 할 대출의 상환 일정을 확인해 보세요."}
                        </small>
                      </span>
                      <ArrowRight
                        size={17}
                        className="shrink-0 text-slate-300 transition group-hover:text-blue-600"
                      />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </Card.Content>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <Card noPadding className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <Card.Content className="p-4 sm:p-6">
              <div className="mb-4">
                <h2 className="text-base font-black text-slate-800">
                  내 금융 현황
                </h2>
                <p className="mt-1 text-xs font-medium text-slate-400">
                  현금·예금 배분과 이용 가능한 대출을 확인합니다.
                </p>
              </div>

              <button
                type="button"
                onClick={() => onTabChange?.("deposit_apply")}
                className="group w-full rounded-xl px-2 py-4 text-left transition-colors hover:bg-slate-50"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <PiggyBank size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-700">
                          현금과 예금
                        </p>
                        <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                          내 은행 자금 중 예금 비중 {depositRatio.toFixed(1)}%
                        </p>
                      </div>
                      <ArrowRight
                        size={17}
                        className="shrink-0 text-slate-300 transition-colors group-hover:text-blue-500"
                      />
                    </div>

                    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-300">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: depositRatio + "%" }}
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] font-bold text-slate-500">
                      <span>
                        사용 가능 현금{" "}
                        <strong className="text-slate-700">
                          {formatBankMoney(availableCash)}
                          {currencyUnit}
                        </strong>
                      </span>
                      <span>
                        현재 예금{" "}
                        <strong className="text-emerald-600">
                          {formatBankMoney(deposit)}
                          {currencyUnit}
                        </strong>
                      </span>
                      <span>
                        은행 자금 합계{" "}
                        <strong className="text-slate-700">
                          {formatBankMoney(bankFundsTotal)}
                          {currencyUnit}
                        </strong>
                      </span>
                    </div>
                  </div>
                </div>
              </button>

              <div className="border-t border-slate-100" />

              <button
                type="button"
                onClick={() => onTabChange?.("loan_apply")}
                className="group w-full rounded-xl px-2 py-4 text-left transition-colors hover:bg-slate-50"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                    <Landmark size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-700">
                          대출
                        </p>
                        <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                          {isLoanLimitEnabled
                            ? "자산 비율에 따른 전체 대출 한도"
                            : "상품마다 정해진 한도가 적용됩니다."}
                        </p>
                      </div>
                      <ArrowRight
                        size={17}
                        className="shrink-0 text-slate-300 transition-colors group-hover:text-blue-500"
                      />
                    </div>

                    {isLoanLimitEnabled ? (
                      <>
                        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-rose-500 transition-all"
                            style={{ width: loanUsageRatio + "%" }}
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] font-bold text-slate-500">
                          <span>
                            이용 중{" "}
                            <strong className="text-rose-600">
                              {formatBankMoney(loanUsed)}
                              {currencyUnit}
                            </strong>
                          </span>
                          <span>
                            추가 가능{" "}
                            <strong className="text-slate-700">
                              {formatBankMoney(remainingLoanLimit)}
                              {currencyUnit}
                            </strong>
                          </span>
                          <span>
                            한도{" "}
                            <strong className="text-slate-700">
                              {formatBankMoney(loanLimit)}
                              {currencyUnit}
                            </strong>
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-500">
                          <span>한도 산정 기준</span>
                          <span className="text-slate-700">
                            순자산 {formatBankMoney(totalNetWorth)}
                            {currencyUnit} · {(loanLimitRatio * 100).toFixed(0)}
                            %
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-3 text-[11px] font-bold text-slate-500">
                        <span>
                          현재 대출{" "}
                          <strong className="text-rose-600">
                            {formatBankMoney(loanUsed)}
                            {currencyUnit}
                          </strong>
                        </span>
                        <span className="text-slate-700">
                          상품별 한도는 대출 탭에서 확인
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            </Card.Content>
          </Card>

          <Card noPadding className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <Card.Content className="p-4 sm:p-6">
              <div className="mb-4">
                <h2 className="text-base font-black text-slate-800">
                  최근 은행 내역
                </h2>
                <p className="mt-1 text-xs font-medium text-slate-400">
                  최근 30일의 송금·예금·대출 활동입니다.
                </p>
              </div>

              {recentActivityLoading ? (
                <SectionLoader message="최근 은행 내역을 불러오는 중입니다." minHeightClassName="min-h-44" showSkeleton={false} />
              ) : recentActivityError ? (
                <ErrorState variant="section" title="최근 은행 내역을 불러오지 못했습니다."
                  onRetry={() => setRecentActivityRetry(value => value + 1)} />
              ) : recentActivities.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {recentActivities.map((activity) => (
                    <BankActivityRow
                      key={activity.id}
                      activity={activity}
                      currencyUnit={currencyUnit}
                      formatClassCurrency={formatClassCurrency}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 text-center">
                  <ShieldCheck className="h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-bold text-slate-500">
                    최근 은행 내역이 없습니다.
                  </p>
                </div>
              )}

              <div className="mt-4 rounded-lg bg-blue-50 px-3 py-3 text-[11px] font-medium leading-relaxed text-blue-700">
                예금과 대출의 전체 내역은 각 탭의 기존 내역 버튼에서 확인할 수
                있습니다.
              </div>
            </Card.Content>
          </Card>
        </div>
      </div>

      <Modal
        isOpen={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        title="송금하기"
        size="md"
      >
        <TransferCard
          classId={classId}
          currentStudent={currentStudent}
          currentRateModifiers={currentRateModifiers}
          onTransferSuccess={handleTransferSuccess}
          currencyUnit={currencyUnit}
          embedded
        />
      </Modal>

      <ClassFundPayoutModal
        isOpen={isFundPayoutOpen}
        onClose={() => setIsFundPayoutOpen(false)}
        classId={classId}
        currencyUnit={currencyUnit}
        fixedFundId={activeFundId}
      />
    </>
  );
}

function BankActivityRow({ activity, currencyUnit, formatClassCurrency }) {
  const info = getActivityDisplayInfo(
    activity,
    currencyUnit,
    formatClassCurrency,
  );
  const isIncome = info.icon === "income";
  const date =
    activity.timestamp instanceof Date
      ? activity.timestamp.toLocaleDateString("ko-KR", {
          month: "long",
          day: "numeric",
        })
      : "날짜 정보 없음";

  return (
    <div className="flex items-center justify-between gap-3 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
            (isIncome
              ? "bg-emerald-50 text-emerald-600"
              : "bg-rose-50 text-rose-600")
          }
        >
          {isIncome ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-700">
            {getUserFacingRecordDescription(activity, "은행 활동")}
          </p>
          <p className="mt-1 text-[10px] font-medium text-slate-400">{date}</p>
        </div>
      </div>
      <span className={"shrink-0 text-sm font-black " + info.color}>
        {info.amountText}
      </span>
    </div>
  );
}

export default BankMainTab;
