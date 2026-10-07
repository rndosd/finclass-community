import React, { useCallback, useEffect, useMemo, useState } from "react";
import {ArrowPathIcon,
  ArrowRightCircleIcon,
  BanknotesIcon,
} from "@heroicons/react/24/outline";
import {
  ClockIcon as ClockSolid,
  TrophyIcon as TrophySolid,
} from "@heroicons/react/24/solid";
import { Button, Modal, SectionLoader, Tabs } from "../../../../components/ui";
import { useClassStudents } from "../../../../hooks/user/useClassStudents";
import { formatBankMoney } from "../../../../utils/bankMoney";
import {
  formatDateKeyInKST,
  parseDateKeyAsKST,
  shiftDateKeyInKST,
} from "../../../../utils/kstDate";
import {
  calculateMaturityDate,
  calculateRepaymentDate,
  isClaimableByMaturity,
  hasLoanOverduePenalty,
} from "../../utils/dateUtils";
import BankOverviewFilters from "../components/BankOverviewFilters";
import SortableTable from "../components/SortableTable";
import useClassBankOverview from "../../hooks/useClassBankOverview";
import { getStatusLabel } from "../../constants/bankStatus";

const DEFAULT_SORT = [{ key: "startDate", direction: "desc" }];
const ALERT_SORT = [{ key: "maturityDate", direction: "asc" }];
const INITIAL_ROWS_REQUEST_STATE = Object.freeze({
  savings: false,
  loans: false,
});

function formatAmountWithUnit(value, currencyUnit) {
  if (value == null) return "\u2014";
  return `${formatBankMoney(value)} ${currencyUnit}`;
}

function formatCount(value) {
  if (value == null) return "조회 필요";
  return `${value}건`;
}

function tsToMillis(timestamp) {
  if (!timestamp) return null;
  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().getTime();
  }
  if (typeof timestamp.seconds === "number") {
    return timestamp.seconds * 1000;
  }
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function startOfDayFromInput(value) {
  return parseDateKeyAsKST(value);
}

function endOfDayFromInput(value) {
  return parseDateKeyAsKST(value, { endOfDay: true });
}

export default function ClassBankOverviewModal({
  isOpen,
  onClose,
  classId,
  currencyUnit = "캐시",
  ...modalProps
}) {
  const [tab, setTab] = useState("savings");
  const [sortConfigs, setSortConfigs] = useState(DEFAULT_SORT);
  const [qText, setQText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [startDate, setStartDate] = useState(() => shiftDateKeyInKST(new Date(), -29));
  const [endDate, setEndDate] = useState(() => formatDateKeyInKST(new Date()));
  const [rowsRequested, setRowsRequested] = useState(INITIAL_ROWS_REQUEST_STATE);
  const [todayKey, setTodayKey] = useState(() => formatDateKeyInKST(new Date()));
  useEffect(() => {
    if (!isOpen) return undefined;
    const updateDay = () => setTodayKey(formatDateKeyInKST(new Date()));
    updateDay();
    const timer = setInterval(updateDay, 60000);
    return () => clearInterval(timer);
  }, [isOpen]);

  const hasActiveRowsRequested = rowsRequested[tab] === true;
  const hasRequestedAnyRows = rowsRequested.savings || rowsRequested.loans;

  useEffect(() => {
    if (!isOpen || !classId) {
      setRowsRequested(INITIAL_ROWS_REQUEST_STATE);
    }
  }, [classId, isOpen]);

  const {
    data: students = [],
    isLoading: studentsLoading,
  } = useClassStudents(classId, {
    enabled: isOpen && !!classId && hasRequestedAnyRows,
    realtime: false,
  });

  const studentsMap = useMemo(() => {
    return students.reduce((acc, student) => {
      acc[student.uid] = student.name || student.uid;
      return acc;
    }, {});
  }, [students]);

  const {
    savings,
    loans,
    savingsSummary,
    loansSummary,
    savingsLoaded,
    loansLoaded,
    savingsRowsLoaded,
    loansRowsLoaded,
    activeTabLoading,
    error,
  } = useClassBankOverview(classId, {
    enabled: isOpen,
    activeTab: tab,
    rowsEnabled: hasActiveRowsRequested,
  });

  const totals = useMemo(() => {
    const savingAmount = savingsLoaded
      ? savingsSummary?.stats?.totalAmount ?? null
      : null;
    const countBuckets = (summary) => summary?.alertDateBuckets
      ? Object.entries(summary.alertDateBuckets).reduce((sum, [key, count]) =>
        sum + (key <= todayKey ? Number(count) || 0 : 0), 0)
      : null;
    const now = parseDateKeyAsKST(todayKey);
    const claimableCount = savingsRowsLoaded
      ? savings.filter((row) => row.status === "active" && isClaimableByMaturity(row, now)).length
      : countBuckets(savingsSummary);
    const loanPrincipal = loansLoaded
      ? loansSummary?.stats?.totalOutstandingPrincipal ?? null
      : null;
    const overdueCount = loansRowsLoaded
      ? loans.filter((row) => ["ongoing", "approved"].includes(row.status) && hasLoanOverduePenalty(row, now)).length
      : countBuckets(loansSummary);

    return {
      savingAmount,
      loanPrincipal,
      claimableCount,
      overdueCount,
    };
  }, [loansLoaded, loansSummary, savingsLoaded, savingsSummary, savingsRowsLoaded, loansRowsLoaded, savings, loans, todayKey]);

  const activeRows = tab === "savings" ? savings : loans;
  const loading = hasActiveRowsRequested && (studentsLoading || activeTabLoading);

  const handleSort = useCallback((key) => {
    setSortConfigs((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      const existing = current.find((config) => config.key === key);

      if (!existing) {
        return [{ key, direction: "asc" }, ...current];
      }

      if (existing.direction === "asc") {
        return [
          { key, direction: "desc" },
          ...current.filter((config) => config.key !== key),
        ];
      }

      return current.filter((config) => config.key !== key);
    });
  }, []);

  const handleResetSort = useCallback(() => {
    setSortConfigs(DEFAULT_SORT);
  }, []);

  const handleRequestRows = useCallback((targetTab = tab) => {
    setRowsRequested((prev) => (
      prev[targetTab]
        ? prev
        : {
            ...prev,
            [targetTab]: true,
          }
    ));
  }, [tab]);

  const handleTabChange = useCallback((nextTab) => {
    setTab(nextTab);
    setStatusFilter("all");
    setSortConfigs(DEFAULT_SORT);
  }, []);

  const handleAlertShortcut = useCallback((nextTab, nextStatusFilter) => {
    setTab(nextTab);
    setStatusFilter(nextStatusFilter);
    setQText("");
    setStartDate("");
    setEndDate("");
    setSortConfigs(nextStatusFilter === "open" ? DEFAULT_SORT : ALERT_SORT);
    handleRequestRows(nextTab);
  }, [handleRequestRows]);

  const handlePreset = useCallback((key) => {
    const presetDays = {
      "30d": 29,
      "60d": 59,
      "90d": 89,
    };

    const shiftDays = presetDays[key];
    if (shiftDays == null) return;

    const today = new Date();
    setStartDate(shiftDateKeyInKST(today, -shiftDays));
    setEndDate(formatDateKeyInKST(today));
  }, []);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="예금·대출 전체 현황"
      size="xl"
      {...modalProps}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="활성 예금 총액"
            value={formatAmountWithUnit(totals.savingAmount, currencyUnit)}
            icon={<BanknotesIcon className="h-5 w-5 text-emerald-600" />}
            bgColor="bg-emerald-50"
            borderColor="border-emerald-100"
            onClick={() => handleAlertShortcut("savings", "open")}
            selected={tab === "savings" && statusFilter === "open" && !qText && !startDate && !endDate}
          />
          <StatCard
            label="수령 가능한 예금"
            value={formatCount(totals.claimableCount)}
            icon={<TrophySolid className="h-5 w-5 text-teal-600" />}
            bgColor="bg-teal-50"
            borderColor="border-teal-100"
            isAlert={(totals.claimableCount ?? 0) > 0}
            onClick={() => handleAlertShortcut("savings", "claimable")}
            selected={tab === "savings" && statusFilter === "claimable" && !qText && !startDate && !endDate}
          />
          <StatCard
            label="활성 대출 잔액"
            value={formatAmountWithUnit(totals.loanPrincipal, currencyUnit)}
            icon={<ArrowPathIcon className="h-5 w-5 text-indigo-600" />}
            bgColor="bg-indigo-50"
            borderColor="border-indigo-100"
            onClick={() => handleAlertShortcut("loans", "open")}
            selected={tab === "loans" && statusFilter === "open" && !qText && !startDate && !endDate}
          />
          <StatCard
            label="상환 지연 대출"
            value={formatCount(totals.overdueCount)}
            icon={<ClockSolid className="h-5 w-5 text-rose-600" />}
            bgColor="bg-rose-50"
            borderColor="border-rose-100"
            isAlert={(totals.overdueCount ?? 0) > 0}
            onClick={() => handleAlertShortcut("loans", "overdue")}
            selected={tab === "loans" && statusFilter === "overdue" && !qText && !startDate && !endDate}
          />
        </div>

        <p className="px-1 text-xs text-slate-500">
          카드를 누르면 전체 기간의 해당 내역을 조회합니다. 활성 총액에는 승인 대기 건도 포함됩니다.
          {(totals.claimableCount == null || totals.overdueCount == null) && " 날짜별 요약이 없는 항목은 내역을 조회하면 건수를 확인할 수 있습니다."}
        </p>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <Tabs ariaLabel="학급 금융 현황" idPrefix="class-bank-overview" tabs={[{id:"savings",label:"예금 현황",badge:savingsLoaded ? String(savingsSummary?.stats?.rowCount ?? "…") : "…"},{id:"loans",label:"대출 현황",badge:loansLoaded ? String(loansSummary?.stats?.rowCount ?? "…") : "…"}]} activeTab={tab} onTabChange={handleTabChange} variant="underline" size="md" />


          </div>

          <div className="px-1">
            <BankOverviewFilters
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => handleRequestRows()}
                    tone="slate"
                    size="sm"
                    rounded="lg"
                    className="transition-all disabled:cursor-not-allowed"
                    disabled={hasActiveRowsRequested}
                  >
                    {hasActiveRowsRequested ? "상세 목록 로드됨" : "조회"}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleResetSort}
                    tone="slate"
                    kind="outline"
                    size="sm"
                    rounded="lg"
                    className="flex items-center gap-2 transition-all disabled:opacity-50"
                    disabled={
                      !hasActiveRowsRequested ||
                      (
                        sortConfigs.length === 1 &&
                        sortConfigs[0].key === "startDate" &&
                        sortConfigs[0].direction === "desc"
                      )
                    }
                  >
                    <ArrowRightCircleIcon className="h-4 w-4" />
                    기본 정렬로 복원
                  </Button>
                </div>
              }
              qText={qText}
              setQText={setQText}
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              tab={tab}
              onPreset={handlePreset}
            />
          </div>
        </div>

        <div className="min-h-[400px]">
          {hasActiveRowsRequested ? <p className="mb-3 text-xs text-slate-600" aria-live="polite">
            표시 조건: {tab === "savings" ? "예금" : "대출"} · {statusFilter === "all" ? "전체 상태" : statusFilter === "open" ? "활성·승인 대기" : getStatusLabel(statusFilter)} · {startDate || endDate ? `${startDate || "처음"} ~ ${endDate || "오늘 이후"}` : "전체 기간"}{qText ? ` · 검색: ${qText}` : ""}
          </p> : null}
          {loading ? (
            <div className="flex h-64 items-center justify-center gap-3 text-slate-400">
              <SectionLoader
                message={
                  tab === "savings"
                    ? "\uC801\uAE08 \uD604\uD669\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4..."
                    : "\uB300\uCD9C \uD604\uD669\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4..."
                }
                tone="slate"
                size="sm"
                showSkeleton={false}
                minHeightClassName="min-h-[256px]"
              />
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-700">
              현황을 불러오는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.
            </div>
          ) : !hasActiveRowsRequested ? (
            <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
              <div className="max-w-2xl space-y-4">
                <p className="text-sm text-slate-500">
                  필터를 조정해 <span className="font-semibold text-slate-700">조회</span>하거나, 상단 카드를 눌러 빠르게 상세 목록을 불러오세요.
                </p>
                <Button
                  type="button"
                  onClick={() => handleRequestRows()}
                  tone="slate"
                  size="sm"
                  rounded="lg"
                  className="transition-all"
                >
                  현재 탭 조회
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <SortableTable
                data={activeRows}
                studentsMap={studentsMap}
                sortConfigs={sortConfigs}
                onSort={handleSort}
                tableType={tab}
                currencyUnit={currencyUnit}
                qText={qText}
                statusFilter={statusFilter}
                startDate={startDate}
                endDate={endDate}
                textFilter={(name, label, text) => {
                  if (!text) return true;
                  const normalized = text.trim().toLowerCase();
                  return (
                    (name || "").toLowerCase().includes(normalized) ||
                    (label || "").toLowerCase().includes(normalized)
                  );
                }}
                dateFilter={(item) => {
                  const targetDate =
                    tab === "savings" && statusFilter === "claimable"
                      ? calculateMaturityDate(item)
                      : tab === "loans" && statusFilter === "overdue"
                        ? calculateRepaymentDate(item)
                        : item.startedAt || item.processedAt;
                  const targetMs = tsToMillis(targetDate);
                  if (targetMs == null) return true;

                  const fromMs = startOfDayFromInput(startDate)?.getTime() ?? null;
                  const toMs = endOfDayFromInput(endDate)?.getTime() ?? null;

                  if (fromMs != null && targetMs < fromMs) return false;
                  if (toMs != null && targetMs > toMs) return false;
                  return true;
                }}
                emptyMessage={
                  tab === "savings"
                    ? "표시할 예금 내역이 없습니다."
                    : "표시할 대출 내역이 없습니다."
                }
                filteredEmptyMessage="현재 필터 조건에 맞는 내역이 없습니다."
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function StatCard({
  label,
  value,
  icon,
  bgColor,
  borderColor,
  isAlert = false,
  onClick,
  selected = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`relative min-w-0 rounded-2xl border-2 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:p-5 ${
        borderColor
      } ${bgColor} ${
        onClick ? "cursor-pointer shadow-sm transition-transform hover:scale-[1.02]" : ""
      } ${selected ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        {icon}
      </div>
      <div className="break-words text-lg font-bold text-slate-900 sm:text-2xl">{value}</div>
      <span className="mt-2 block text-xs font-semibold text-blue-700">내역 보기 →</span>
      {isAlert && (
        <span className="absolute right-3 top-3 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
        </span>
      )}
    </button>
  );
}

