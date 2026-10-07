import { useOptionalNumberFormat } from "../../../contexts/NumberFormatContext";
import React from "react";
import {
  getExpenseBadgeColor,
  getExpenseBadgeLabel,
} from "../constants/taxExpenseConstants";
import {
  getIncomeBadgeColor,
  getIncomeBadgeLabel,
} from "../constants/taxIncomeConstants";
import { getUserFacingRecordDescription } from "../../../utils/userFacingRecordDescription";



function formatDate(value) {
  if (!value) return "-";
  const rawDate = value?.toDate?.() || value;
  const date = rawDate instanceof Date ? rawDate : new Date(rawDate);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR");
}

function getLedgerType(record) {
  return String(record?.ledgerType || record?.type || "income").toLowerCase();
}

function getBadgeClass(record) {
  return getLedgerType(record) === "expense"
    ? getExpenseBadgeColor(record)
    : getIncomeBadgeColor(record);
}

function getBadgeLabel(record, currencyUnit) {
  return getLedgerType(record) === "expense"
    ? getExpenseBadgeLabel(record)
    : getIncomeBadgeLabel(record, currencyUnit);
}

export default function TaxLedgerTable({
  records = [],
  currencyUnit = "",
  emptyText = "No tax ledger records.",
  maxRows,
}) {
  const numberFormat = useOptionalNumberFormat();
  const formatConfiguredAmount = numberFormat?.formatClassCurrency ||
    ((value) => Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 }));


  const visibleRecords = maxRows ? records.slice(0, maxRows) : records;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
          <tr>
            <th className="py-2 pr-3">Created</th>
            <th className="py-2 pr-3">Description</th>
            <th className="py-2 pr-3">Student</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3 text-right">Base</th>
            <th className="py-2 pr-3 text-right">Tax</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {visibleRecords.map((record) => {
            const ledgerType = getLedgerType(record);
            const amountPrefix = ledgerType === "expense" ? "-" : "+";
            const amountTone = ledgerType === "expense" ? "text-rose-600" : "text-emerald-600";

            return (
              <tr key={record.id} className="border-b border-slate-100">
                <td className="py-2 pr-3 text-xs text-slate-500">
                  {formatDate(record.createdAt)}
                </td>
                <td className="py-2 pr-3">
                  <div className="font-semibold text-slate-800">
                    {getUserFacingRecordDescription(
                      record,
                      record.relatedRecordId || record.id,
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {record.relatedRecordId || "-"}
                  </div>
                </td>
                <td className="py-2 pr-3">{record.studentName || record.student?.displayName || "-"}</td>
                <td className="py-2 pr-3">
                  <span className={`inline-flex rounded-lg border px-1.5 py-0.5 text-xs font-bold ${getBadgeClass(record)}`}>
                    {getBadgeLabel(record, currencyUnit)}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right">
                  {record.baseAmount === null || record.baseAmount === undefined
                    ? "-"
                    : formatConfiguredAmount(record.baseAmount)}
                </td>
                <td className="py-2 pr-3 text-right">
                  {record.taxAmount === null || record.taxAmount === undefined
                    ? "-"
                    : formatConfiguredAmount(record.taxAmount)}
                </td>
                <td className={`py-2 text-right font-bold ${amountTone}`}>
                  {amountPrefix}
                  {formatConfiguredAmount(record.amount)}
                  <span className="ml-1 text-xs font-normal text-slate-400">{currencyUnit}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {visibleRecords.length === 0 ? (
        <div className="rounded-md bg-slate-50 px-3 py-4 text-sm text-slate-500">
          {emptyText}
        </div>
      ) : null}
    </div>
  );
}
