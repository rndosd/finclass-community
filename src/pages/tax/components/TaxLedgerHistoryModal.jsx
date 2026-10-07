import { useOptionalNumberFormat } from "../../../contexts/NumberFormatContext";
import React from "react";
import Modal from "../../../components/ui/Modal";
import TaxLedgerTable from "./TaxLedgerTable";

const DEFAULT_FILTERS = {
  type: "all",
  studentUserId: "",
  source: "",
  taxType: "",
  startDate: "",
  endDate: "",
  limit: "100",
};



function getLedgerType(record) {
  return String(record?.ledgerType || record?.type || "income").toLowerCase();
}

function sumRecords(records, ledgerType) {
  return records
    .filter((record) => getLedgerType(record) === ledgerType)
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);
}

export default function TaxLedgerHistoryModal({
  isOpen,
  onClose,
  title = "Tax Ledger History",
  records = [],
  currencyUnit = "",
  filters = DEFAULT_FILTERS,
  students = [],
  fixedType = "",
  onFiltersChange,
  onApply,
  onReset,
  onLoadMore,
  hasMore = false,
  isLoading = false,
  isLoadingMore = false,
}) {
  const numberFormat = useOptionalNumberFormat();
  const formatConfiguredAmount = numberFormat?.formatClassCurrency ||
    ((value) => Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 }));
  const formatNumber = (value) => Number(value || 0).toLocaleString("ko-KR");

  const effectiveFilters = { ...DEFAULT_FILTERS, ...(filters || {}) };
  const incomeTotal = sumRecords(records, "income");
  const expenseTotal = sumRecords(records, "expense");

  const updateFilter = (key, value) => {
    if (!onFiltersChange) return;
    onFiltersChange((current) => ({ ...(current || DEFAULT_FILTERS), [key]: value }));
  };

  const handleReset = () => {
    if (onReset) {
      onReset();
      return;
    }
    onFiltersChange?.({
      ...DEFAULT_FILTERS,
      ...(fixedType ? { type: fixedType } : {}),
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" title={title}>
      <section className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryPill label="Rows" value={formatNumber(records.length)} />
          <SummaryPill label="Income" value={`+${formatConfiguredAmount(incomeTotal)}`} unit={currencyUnit} tone="income" />
          <SummaryPill label="Expense" value={`-${formatConfiguredAmount(expenseTotal)}`} unit={currencyUnit} tone="expense" />
        </div>

        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Type
              <select
                className="h-10 rounded-md border border-blue-200 bg-blue-50/50 px-3 text-sm disabled:bg-slate-100"
                value={fixedType || effectiveFilters.type}
                disabled={Boolean(fixedType)}
                onChange={(event) => updateFilter("type", event.target.value)}
              >
                <option value="all">All</option>
                <option value="INCOME">Income</option>
                <option value="EXPENSE">Expense</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Student
              <select
                className="h-10 rounded-md border border-blue-200 bg-blue-50/50 px-3 text-sm"
                value={effectiveFilters.studentUserId}
                onChange={(event) => updateFilter("studentUserId", event.target.value)}
              >
                <option value="">All students</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.displayName || student.id}
                  </option>
                ))}
              </select>
            </label>
            <FilterInput
              label="Source"
              value={effectiveFilters.source}
              onChange={(value) => updateFilter("source", value)}
            />
            <FilterInput
              label="Tax type"
              value={effectiveFilters.taxType}
              onChange={(value) => updateFilter("taxType", value)}
            />
            <FilterInput
              label="Start"
              type="date"
              value={effectiveFilters.startDate}
              onChange={(value) => updateFilter("startDate", value)}
            />
            <FilterInput
              label="End"
              type="date"
              value={effectiveFilters.endDate}
              onChange={(value) => updateFilter("endDate", value)}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <FilterInput
              className="w-28"
              label="Limit"
              max="200"
              min="1"
              type="number"
              value={effectiveFilters.limit}
              onChange={(value) => updateFilter("limit", value)}
            />
            <button
              className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50"
              type="button"
              disabled={isLoading}
              onClick={handleReset}
            >
              Reset
            </button>
            <button
              className="h-10 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
              type="button"
              disabled={isLoading}
              onClick={() => void onApply?.()}
            >
              Apply
            </button>
          </div>
        </div>

        <TaxLedgerTable
          records={records}
          currencyUnit={currencyUnit}
          emptyText="No tax ledger records match these filters."
        />
        <div className="flex justify-center">
          <button
            className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50"
            type="button"
            disabled={!hasMore || isLoading || isLoadingMore}
            onClick={() => void onLoadMore?.()}
          >
            {isLoadingMore ? "Loading..." : hasMore ? "Load more" : "No more records"}
          </button>
        </div>
      </section>
    </Modal>
  );
}

function SummaryPill({ label, value, unit = "", tone = "default" }) {
  const toneClass =
    tone === "income"
      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
      : tone === "expense"
        ? "border-rose-100 bg-rose-50 text-rose-700"
        : "border-slate-100 bg-slate-50 text-slate-700";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs font-black uppercase tracking-normal opacity-70">{label}</div>
      <div className="mt-1 text-xl font-black">
        {value}
        {unit ? <span className="ml-1 text-xs font-bold opacity-70">{unit}</span> : null}
      </div>
    </div>
  );
}

function FilterInput({ className = "", label, onChange, value, type = "text", ...props }) {
  return (
    <label className={`grid gap-1 text-sm font-medium text-slate-700 ${className}`}>
      {label}
      <input
        className="h-10 rounded-md border border-blue-200 bg-blue-50/50 px-3 text-sm"
        type={type}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </label>
  );
}
