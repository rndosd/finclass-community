import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  FileText,
  WalletCards,
} from "lucide-react";

const formatAsOf = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(date);
};

export default function CashChangeAnswerCard({
  answer,
  recordsTruncated = false,
  recordsUnavailable = false,
}) {
  const { formatClassCurrency } = useNumberFormat();
  const formatMoney = (value, unit = "원") => Number.isFinite(Number(value)) ? `${Number(value) > 0 ? "+" : ""}${formatClassCurrency(value)}${unit}` : null;
  const calculations = Array.isArray(answer?.calculations)
    ? answer.calculations
    : [];
  const interpretations = Array.isArray(answer?.interpretations)
    ? answer.interpretations
    : [];
  const facts = Array.isArray(answer?.facts) ? answer.facts : [];
  const evidence = Array.isArray(answer?.evidence) ? answer.evidence : [];
  const unknowns = Array.isArray(answer?.unknowns) ? answer.unknowns : [];
  const warnings = Array.isArray(answer?.warnings) ? answer.warnings : [];
  const recordedChange =
    calculations.find(({ id }) => id === "recorded-net-change") ||
    calculations[0] ||
    null;
  const recordedChangeText = recordedChange && !recordsUnavailable
    ? formatMoney(recordedChange.result, recordedChange.unit)
    : null;
  const supportingRecordCount = evidence.filter(
    ({ sourceType }) => sourceType === "supporting_record",
  ).length;
  const currentCashFact =
    facts.find(({ id }) => id === "current-cash") || facts[0] || null;
  const limitation = unknowns[0] || null;
  const scopeWarnings = warnings.filter(
    (warning) =>
      warning.includes("조회 안전 한도") ||
      warning.includes("근거 예산") ||
      warning.includes("기준 캐시"),
  );
  const formattedAsOf = formatAsOf(answer?.asOf);

  return (
    <article className="w-full max-w-[96%] overflow-hidden rounded-3xl rounded-bl-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/70">
      <div className="border-b border-slate-100 px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-700">
            <Coins className="h-3.5 w-3.5" />
            학생 현금 변화
          </span>
          {supportingRecordCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              활동 근거 {supportingRecordCount}건
            </span>
          ) : null}
        </div>

        {recordsUnavailable ? (
          <div className="mt-4">
            <p className="text-xs font-bold text-slate-500">기록에서 확인된 변화</p>
            <p className="mt-1 text-2xl font-black tracking-tight text-slate-500">
              확인 불가
            </p>
          </div>
        ) : recordedChangeText ? (
          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-slate-500">기록에서 확인된 변화</p>
              <p
                className={[
                  "mt-1 text-3xl font-black tracking-tight",
                  Number(recordedChange?.result) < 0
                    ? "text-rose-600"
                    : "text-emerald-600",
                ].join(" ")}
              >
                {recordedChangeText}
              </p>
            </div>
            {formattedAsOf ? (
              <p className="shrink-0 text-[11px] font-semibold text-slate-400">
                답변 {formattedAsOf} 기준
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="mt-4 text-sm font-semibold leading-6 text-slate-800">
          {answer?.conclusion}
        </p>
      </div>

      <div className="space-y-3 px-5 py-4">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-black text-slate-500">
            <FileText className="h-3.5 w-3.5" />
            확인된 원인
          </p>
          {recordsUnavailable ? (
            <div className="rounded-2xl bg-slate-50 px-3.5 py-3 text-sm leading-6 text-slate-600">
              활동 기록을 불러오지 못해 변화 원인을 확인할 수 없습니다.
            </div>
          ) : interpretations.length > 0 ? (
            <div className="space-y-2">
              {interpretations.map((interpretation) => (
                <div
                  key={interpretation.id || interpretation.statement}
                  className="rounded-2xl bg-slate-50 px-3.5 py-3 text-sm leading-6 text-slate-700"
                >
                  {interpretation.statement}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-50 px-3.5 py-3 text-sm leading-6 text-slate-600">
              기간 선택에 설명 가능한 현금 활동 기록이 없습니다.
            </div>
          )}
        </div>

        {currentCashFact?.statement ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3">
            <span className="inline-flex shrink-0 items-center gap-2 text-xs font-black text-indigo-700">
              <WalletCards className="h-4 w-4" />
              현재 잔액
            </span>
            <span className="text-right text-sm font-black text-indigo-950">
              {currentCashFact.statement}
            </span>
          </div>
        ) : null}

        {limitation || scopeWarnings.length > 0 || recordsTruncated || recordsUnavailable ? (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-black">분석 범위 안내</p>
              {limitation ? <p className="mt-0.5">{limitation}</p> : null}
              {scopeWarnings.map((warning) => (
                <p key={warning} className="mt-0.5">{warning}</p>
              ))}
              {recordsTruncated && scopeWarnings.length === 0 ? (
                <p className="mt-0.5">조회 안전 한도 안의 기록만 계산했습니다.</p>
              ) : null}
              {recordsUnavailable ? (
                <p className="mt-0.5">활동 기록을 불러오지 못해 현재 잔액만 확인했습니다.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
