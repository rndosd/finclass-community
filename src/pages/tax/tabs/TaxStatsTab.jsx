import { useNumberFormat as useConfiguredMoney } from "../../../contexts/NumberFormatContext";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ReceiptText,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  collection,
  documentId,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { Button, Spinner, runFilterApplyOnEnter } from "../../../components/ui";
import { db } from "../../../firebase";
import {
  formatDateKeyInKST,
  getRecentDateRangeInKST,
  parseDateKeyAsKST,
} from "../../../utils/kstDate";

const MAX_RANGE_DAYS = 120;
const RANGE_PRESETS = [
  { id: "7d", label: "7일", days: 7 },
  { id: "30d", label: "30일", days: 30 },
  { id: "90d", label: "90일", days: 90 },
];

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatCount = (value) => Math.round(toNumber(value)).toLocaleString("ko-KR");



const buildDefaultRange = () => {
  return getRecentDateRangeInKST({ days: 7, endOffsetDays: -1 });
};

const getDaySpan = (startDate, endDate) => {
  const start = parseDateKeyAsKST(startDate);
  const end = parseDateKeyAsKST(endDate);
  if (!start || !end || end.getTime() < start.getTime()) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
};

const normalizeStudentName = (student = {}) =>
  String(student.studentName || student.name || "학생").trim() || "학생";

const formatKind = (kind) => {
  const labelMap = {
    general: "일반",
    income: "소득세",
    property: "재산세",
    rent: "자리세",
    payroll: "급여 공제",
  };
  return labelMap[kind] || String(kind || "기타");
};

const normalizeLedgerRows = (rows, legacyMap = {}) => {
  if (Array.isArray(rows)) {
    return rows.map((row) => ({
      key: String(row.key || row.id || row.label || "unknown"),
      name: String(row.label || row.name || row.key || "unknown"),
      amount: toNumber(row.amount),
    }));
  }

  return Object.entries(legacyMap || {}).map(([key, amount]) => ({
    key,
    name: key,
    amount: toNumber(amount),
  }));
};

const addLedgerRow = (target, row) => {
  if (!row || !row.key) return;
  const current = target.get(row.key) || {
    key: row.key,
    name: row.name || row.key,
    amount: 0,
  };
  current.amount += toNumber(row.amount);
  target.set(row.key, current);
};

const MetricCard = ({ icon: Icon, label, value, subText, tone = "slate" }) => {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    slate: "bg-slate-50 text-slate-700 ring-slate-100",
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ring-1 ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-black text-slate-900">{value}</p>
        </div>
      </div>
      {subText ? <p className="mt-2 text-xs text-slate-500">{subText}</p> : null}
    </div>
  );
};

const RankList = ({ title, icon: Icon, rows, emptyText, renderMeta, renderValue }) => (
  <section className="rounded-lg border border-slate-200 bg-white">
    <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
      <Icon className="h-4 w-4 text-slate-500" />
      <h3 className="text-sm font-black text-slate-900">{title}</h3>
    </div>
    <div className="divide-y divide-slate-100">
      {rows.length ? (
        rows.slice(0, 8).map((row, index) => (
          <div key={row.id || row.uid || row.kind || index} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">{row.name}</p>
                {renderMeta ? <p className="text-xs text-slate-500">{renderMeta(row)}</p> : null}
              </div>
            </div>
            <span className="shrink-0 text-sm font-black text-slate-900">
              {renderValue(row)}
            </span>
          </div>
        ))
      ) : (
        <p className="px-4 py-6 text-sm text-slate-500">{emptyText}</p>
      )}
    </div>
  </section>
);

const SectionHeader = ({ title, description, meta }) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <h2 className="text-base font-black text-slate-900">{title}</h2>
      {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
    </div>
    {meta ? <p className="text-xs font-bold text-slate-400">{meta}</p> : null}
  </div>
);

const DailyTrend = ({ rows, currencyUnit }) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatAmount = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const maxAmount = Math.max(
    1,
    ...rows.flatMap((row) => [
      toNumber(row.eventTotals?.billIssuedAmount),
      toNumber(row.eventTotals?.billPaidAmount),
    ]),
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <TrendingUp className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-black text-slate-900">일별 부과/납부 추이</h3>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto p-4">
          <div className="flex min-w-[640px] items-end gap-3 border-b border-slate-200 px-2 pb-3 pt-5">
            {rows.map((row) => {
              const issued = toNumber(row.eventTotals?.billIssuedAmount);
              const paid = toNumber(row.eventTotals?.billPaidAmount);
              const shortDate = String(row.id || row.date || "").slice(5);
              return (
                <div key={row.id || row.date} className="flex min-w-[54px] flex-1 flex-col items-center gap-2">
                  <div className="flex h-36 items-end gap-1.5">
                    <div
                      className="w-4 rounded-t-md bg-blue-500"
                      style={{ height: `${Math.max(issued > 0 ? 6 : 0, (issued / maxAmount) * 100)}%` }}
                      title={`부과 ${formatAmount(issued, currencyUnit)}`}
                    />
                    <div
                      className="w-4 rounded-t-md bg-emerald-500"
                      style={{ height: `${Math.max(paid > 0 ? 6 : 0, (paid / maxAmount) * 100)}%` }}
                      title={`납부 ${formatAmount(paid, currencyUnit)}`}
                    />
                  </div>
                  <div className="text-center">
                    <p className="whitespace-nowrap text-[11px] font-black text-slate-600">{shortDate}</p>
                    <p className="mt-0.5 text-[11px] font-bold text-slate-400">
                      {formatCount(toNumber(row.eventTotals?.billIssuedCount))}/{formatCount(toNumber(row.eventTotals?.billPaidCount))}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-center gap-4 text-xs font-bold text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" />부과</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />납부</span>
          </div>
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-slate-500">선택한 기간에 표시할 일별 통계가 없습니다.</p>
      )}
    </section>
  );
};

const LedgerFlowTrend = ({ rows, currencyUnit }) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatAmount = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const flowRows = rows.map((row) => {
    const eventTotals = row.eventTotals || {};
    const ledgerSummary = row.ledgerSummary || {};
    const incomeAmount = toNumber(
      ledgerSummary.incomeAmount ?? eventTotals.taxIncomeTotal,
    );
    const expenseAmount = toNumber(
      ledgerSummary.expenseAmount ?? eventTotals.taxExpenseTotal,
    );
    return {
      id: row.id || row.date,
      shortDate: String(row.id || row.date || "").slice(5),
      netAmount: toNumber(
        ledgerSummary.netAmount ?? eventTotals.netTaxFlow ?? incomeAmount - expenseAmount,
      ),
    };
  });
  const maxAbsNet = Math.max(1, ...flowRows.map((row) => Math.abs(row.netAmount)));

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <TrendingUp className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-black text-slate-900">일별 국고 순흐름</h3>
      </div>
      {flowRows.length ? (
        <div className="overflow-x-auto p-4">
          <div className="flex min-w-[640px] items-center gap-3 border-b border-slate-200 px-2 py-5">
            {flowRows.map((row) => {
              const isPositive = row.netAmount > 0;
              const isNegative = row.netAmount < 0;
              const height = row.netAmount === 0
                ? 0
                : Math.max(6, (Math.abs(row.netAmount) / maxAbsNet) * 72);
              return (
                <div key={row.id} className="flex min-w-[54px] flex-1 flex-col items-center gap-2">
                  <div className="flex h-40 w-full flex-col items-center justify-center">
                    <div className="flex h-20 items-end">
                      {isPositive ? (
                        <div
                          className="w-5 rounded-t-md bg-emerald-500"
                          style={{ height }}
                          title={`순흐름 ${formatAmount(row.netAmount, currencyUnit)}`}
                        />
                      ) : null}
                    </div>
                    <div className="h-px w-full bg-slate-200" />
                    <div className="flex h-20 items-start">
                      {isNegative ? (
                        <div
                          className="w-5 rounded-b-md bg-rose-500"
                          style={{ height }}
                          title={`순흐름 ${formatAmount(row.netAmount, currencyUnit)}`}
                        />
                      ) : null}
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="whitespace-nowrap text-[11px] font-black text-slate-600">{row.shortDate}</p>
                    <p className="mt-0.5 text-[11px] font-bold text-slate-400">
                      {formatAmount(row.netAmount, currencyUnit)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-center gap-4 text-xs font-bold text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />순유입</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />순유출</span>
          </div>
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-slate-500">선택한 기간에 표시할 장부 흐름이 없습니다.</p>
      )}
    </section>
  );
};

export default function TaxStatsTab({ classId, currencyUnit = "" }) {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatAmount = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const defaultRange = useMemo(buildDefaultRange, []);
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [appliedRange, setAppliedRange] = useState(defaultRange);
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchAnalytics = useCallback(async () => {
    if (!classId || !appliedRange.startDate || !appliedRange.endDate) return;
    const daySpan = getDaySpan(appliedRange.startDate, appliedRange.endDate);
    if (daySpan <= 0) {
      setError("기간 선택을 확인해 주세요.");
      setRows([]);
      return;
    }
    if (daySpan > MAX_RANGE_DAYS) {
      setError(`한 번에 최대 ${MAX_RANGE_DAYS}일까지 조회할 수 있습니다.`);
      setRows([]);
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      const ref = collection(db, "classes", classId, "taxAnalyticsDaily");
      const snapshot = await getDocs(
        query(
          ref,
          where(documentId(), ">=", appliedRange.startDate),
          where(documentId(), "<=", appliedRange.endDate),
          orderBy(documentId(), "asc"),
        ),
      );
      setRows(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    } catch (fetchError) {
      console.error("[TaxStatsTab] failed to load analytics", fetchError);
      setError("세금 통계를 불러오지 못했습니다.");
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [appliedRange.endDate, appliedRange.startDate, classId]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const stats = useMemo(() => {
    const totals = {
      eventCount: 0,
      issuedCount: 0,
      issuedAmount: 0,
      paidCount: 0,
      paidAmount: 0,
      unpaidCount: 0,
      unpaidAmount: 0,
      overdueCount: 0,
      overdueAmount: 0,
      ledgerActivityDays: 0,
      readyDays: 0,
      emptyDays: 0,
    };
    const students = new Map();
    const kinds = new Map();
    const incomeTypes = new Map();
    const expenseCategories = new Map();

    rows.forEach((daily) => {
      if (daily.status === "empty") totals.emptyDays += 1;
      else totals.readyDays += 1;

      const eventTotals = daily.eventTotals || {};
      const snapshot = daily.snapshot || {};
      const ledgerSummary = daily.ledgerSummary || {};
      const dailyLedger = daily.dailyLedger || {};
      const ledgerBreakdown = daily.ledgerBreakdown || {};
      const ledgerIncomeAmount = toNumber(
        ledgerSummary.incomeAmount ?? eventTotals.taxIncomeTotal,
      );
      const ledgerExpenseAmount = toNumber(
        ledgerSummary.expenseAmount ?? eventTotals.taxExpenseTotal,
      );
      totals.eventCount += toNumber(eventTotals.eventCount);
      totals.issuedCount += toNumber(eventTotals.billIssuedCount);
      totals.issuedAmount += toNumber(eventTotals.billIssuedAmount);
      totals.paidCount += toNumber(eventTotals.billPaidCount);
      totals.paidAmount += toNumber(eventTotals.billPaidAmount);
      totals.unpaidCount += toNumber(snapshot.unpaidCount);
      totals.unpaidAmount += toNumber(snapshot.unpaidAmount);
      totals.overdueCount += toNumber(snapshot.overdueCount);
      totals.overdueAmount += toNumber(snapshot.overdueAmount);
      if (ledgerIncomeAmount !== 0 || ledgerExpenseAmount !== 0) {
        totals.ledgerActivityDays += 1;
      }

      normalizeLedgerRows(
        ledgerBreakdown.incomeByTaxType || dailyLedger.incomeByTaxType,
        dailyLedger.byTaxType,
      ).forEach((row) => addLedgerRow(incomeTypes, row));
      normalizeLedgerRows(
        ledgerBreakdown.expenseByCategory || dailyLedger.expenseByCategory,
        dailyLedger.byCategory,
      ).forEach((row) => addLedgerRow(expenseCategories, row));

      Object.entries(daily.byStudent || {}).forEach(([uid, student]) => {
        const current = students.get(uid) || {
          uid,
          name: normalizeStudentName(student),
          studentNumber: student.studentNumber ?? null,
          issuedCount: 0,
          issuedAmount: 0,
          paidCount: 0,
          paidAmount: 0,
          eventCount: 0,
        };
        current.issuedCount += toNumber(student.billIssuedCount);
        current.issuedAmount += toNumber(student.billIssuedAmount);
        current.paidCount += toNumber(student.billPaidCount);
        current.paidAmount += toNumber(student.billPaidAmount);
        current.eventCount += toNumber(student.eventCount);
        students.set(uid, current);
      });

      Object.entries(daily.byKind || {}).forEach(([kind, row]) => {
        const current = kinds.get(kind) || {
          kind,
          name: formatKind(kind),
          issuedCount: 0,
          issuedAmount: 0,
          paidCount: 0,
          paidAmount: 0,
        };
        current.issuedCount += toNumber(row.issuedCount);
        current.issuedAmount += toNumber(row.issuedAmount);
        current.paidCount += toNumber(row.paidCount);
        current.paidAmount += toNumber(row.paidAmount);
        kinds.set(kind, current);
      });
    });

    const studentRows = Array.from(students.values()).map((student) => ({
      ...student,
      balanceAmount: Math.max(0, student.issuedAmount - student.paidAmount),
      balanceCount: Math.max(0, student.issuedCount - student.paidCount),
    }));
    const kindRows = Array.from(kinds.values()).map((kind) => ({
      ...kind,
      unpaidLikeAmount: Math.max(0, kind.issuedAmount - kind.paidAmount),
    }));

    return {
      totals,
      unpaidStudents: studentRows
        .filter((student) => student.balanceAmount > 0 || student.balanceCount > 0)
        .sort((a, b) => b.balanceAmount - a.balanceAmount || b.balanceCount - a.balanceCount),
      topIssuedStudents: studentRows
        .filter((student) => student.issuedAmount > 0)
        .sort((a, b) => b.issuedAmount - a.issuedAmount),
      topKinds: kindRows
        .filter((kind) => kind.issuedAmount > 0 || kind.paidAmount > 0)
        .sort((a, b) => b.issuedAmount - a.issuedAmount),
      topIncomeTypes: Array.from(incomeTypes.values())
        .filter((row) => row.amount !== 0)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.name.localeCompare(b.name)),
      topExpenseCategories: Array.from(expenseCategories.values())
        .filter((row) => row.amount !== 0)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.name.localeCompare(b.name)),
    };
  }, [rows]);

  const collectionRate = stats.totals.issuedAmount
    ? (stats.totals.paidAmount / stats.totals.issuedAmount) * 100
    : null;
  const rangeLabel = `${appliedRange.startDate} ~ ${appliedRange.endDate}`;
  const hasAnyEvent =
    stats.totals.eventCount > 0 ||
    stats.totals.unpaidCount > 0 ||
    stats.totals.issuedAmount > 0 ||
    stats.totals.paidAmount > 0 ||
    stats.totals.ledgerActivityDays > 0;

  const handleApply = () => {
    setAppliedRange({ startDate, endDate });
  };

  const handlePreset = (days) => {
    const next = getRecentDateRangeInKST({ days, endOffsetDays: -1 });
    setStartDate(next.startDate);
    setEndDate(next.endDate);
    setAppliedRange(next);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-black text-slate-900">
              <CalendarDays className="h-4 w-4 text-slate-500" />
              기간 설정
            </div>
            <p className="mt-1 text-xs text-slate-500">{rangeLabel}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-2">
              {RANGE_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => handlePreset(preset.days)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              onKeyDown={(event) => runFilterApplyOnEnter(event, handleApply, { blur: true })}
              className="h-10 rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <span className="hidden text-slate-400 sm:block">~</span>
            <input
              type="date"
              value={endDate}
              max={formatDateKeyInKST(new Date())}
              onChange={(event) => setEndDate(event.target.value)}
              onKeyDown={(event) => runFilterApplyOnEnter(event, handleApply, { blur: true })}
              className="h-10 rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <Button type="button" tone="blue" onClick={handleApply} disabled={isLoading}>
              {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
              조회
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      {isLoading && rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10">
          <div className="flex items-center justify-center gap-3 py-12">
            <Spinner size="lg" />
            <p className="font-bold text-slate-500">세금 통계를 불러오는 중입니다.</p>
          </div>
        </div>
      ) : (
        <>
          {!hasAnyEvent ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
              선택한 기간에 납부서 통계 이벤트가 없습니다. 미납 스냅샷이 있는 날은 함께 표시됩니다.
            </div>
          ) : null}

          <section className="space-y-3">
            <SectionHeader
              title="납부서 기준"
              description="발행된 납부서와 실제 납부 이벤트를 기준으로 기간 흐름을 봅니다."
              meta={`${formatCount(stats.totals.readyDays)}일 집계`}
            />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={ReceiptText}
                label="총 부과"
                value={formatAmount(stats.totals.issuedAmount, currencyUnit)}
                tone="blue"
                subText={`${formatCount(stats.totals.issuedCount)}건 부과`}
              />
              <MetricCard
                icon={CheckCircle2}
                label="총 납부"
                value={formatAmount(stats.totals.paidAmount, currencyUnit)}
                tone="emerald"
                subText={`${formatCount(stats.totals.paidCount)}건 납부`}
              />
              <MetricCard
                icon={Clock3}
                label="현재 미납"
                value={formatAmount(stats.totals.unpaidAmount, currencyUnit)}
                tone="amber"
                subText={`${formatCount(stats.totals.unpaidCount)}건 미납 스냅샷`}
              />
              <MetricCard
                icon={TrendingUp}
                label="기간 납부율"
                value={collectionRate === null ? "-" : `${collectionRate.toFixed(1)}%`}
                tone={collectionRate !== null && collectionRate >= 80 ? "emerald" : "rose"}
                subText={`${formatCount(stats.totals.emptyDays)}일은 비어 있음`}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <RankList
                title="미납 추정 학생 Top"
                icon={Users}
                rows={stats.unpaidStudents}
                emptyText="기간 내 부과액 기준 미납 추정 학생이 없습니다."
                renderMeta={(row) =>
                  `${row.studentNumber ? `${row.studentNumber}번 · ` : ""}부과 ${formatCount(row.issuedCount)}건 / 납부 ${formatCount(row.paidCount)}건`
                }
                renderValue={(row) => formatAmount(row.balanceAmount, currencyUnit)}
              />
              <RankList
                title="부과액 많은 학생 Top"
                icon={ReceiptText}
                rows={stats.topIssuedStudents}
                emptyText="기간 내 부과된 세금이 없습니다."
                renderMeta={(row) =>
                  `${row.studentNumber ? `${row.studentNumber}번 · ` : ""}${formatCount(row.issuedCount)}건 부과`
                }
                renderValue={(row) => formatAmount(row.issuedAmount, currencyUnit)}
              />
              <RankList
                title="세금 종류별 부과"
                icon={ReceiptText}
                rows={stats.topKinds}
                emptyText="세금 종류별 집계가 없습니다."
                renderMeta={(row) =>
                  `납부 ${formatAmount(row.paidAmount, currencyUnit)} · 차이 ${formatAmount(row.unpaidLikeAmount, currencyUnit)}`
                }
                renderValue={(row) => formatAmount(row.issuedAmount, currencyUnit)}
              />
            </div>

            <DailyTrend rows={rows} currencyUnit={currencyUnit} />
          </section>

          <section className="space-y-3">
            <SectionHeader
              title="국고 장부 분석"
              description="잔액 요약 대신 수입·지출이 어디서 발생했는지와 날짜별 순흐름을 봅니다."
              meta={`${formatCount(stats.totals.ledgerActivityDays)}일 움직임`}
            />
            <div className="grid gap-4 xl:grid-cols-2">
              <RankList
                title="수입 유형 Top"
                icon={ReceiptText}
                rows={stats.topIncomeTypes}
                emptyText="기간 내 수입 유형 집계가 없습니다."
                renderMeta={(row) => row.key}
                renderValue={(row) => formatAmount(row.amount, currencyUnit)}
              />
              <RankList
                title="지출 카테고리 Top"
                icon={ReceiptText}
                rows={stats.topExpenseCategories}
                emptyText="기간 내 지출 카테고리 집계가 없습니다."
                renderMeta={(row) => row.key}
                renderValue={(row) => formatAmount(row.amount, currencyUnit)}
              />
            </div>
            <LedgerFlowTrend rows={rows} currencyUnit={currencyUnit} />
          </section>

        </>
      )}
    </div>
  );
}
