import { useNumberFormat as useConfiguredMoney } from "../../../contexts/NumberFormatContext";
import React from "react";

const toDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = toDate(value);
  if (!date) return "-";
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};



const getDeductionAmount = (deduction) =>
  Number(
    deduction?.amount ??
      deduction?.calculatedAmount ??
      deduction?.deductionAmount ??
      0,
  );

const getJobDeductions = (job) =>
  (Array.isArray(job?.deductions) ? job.deductions : []).reduce(
    (sum, deduction) => sum + getDeductionAmount(deduction),
    0,
  );

const getDeductionBasis = (deduction, currencyUnit, formatMoney) => {
  const mode = String(deduction?.calculationMode || "");
  const detail = deduction?.calculationDetail || {};
  const rate = Number(detail?.rate ?? deduction?.rate);
  const taxableBase = Number(detail?.taxableBase);
  const appliedBase = Number(detail?.appliedBase);
  const amountPerWeek = Number(detail?.amountPerWeek);
  const numberOfWeeks = Number(detail?.numberOfWeeks);
  const brackets = Array.isArray(detail?.brackets) ? detail.brackets : [];

  if (mode === "flat_rate") {
    if (Number.isFinite(rate) && Number.isFinite(taxableBase)) {
      return `비율 공제 · ${formatMoney(taxableBase, currencyUnit)} × ${rate}%`;
    }
    if (Number.isFinite(rate)) return `비율 공제 · ${rate}%`;
    return "비율 공제";
  }

  if (mode === "flat_amount") {
    if (Number.isFinite(amountPerWeek) && Number.isFinite(numberOfWeeks)) {
      const scopeSuffix =
        Number(deduction?.scopeCount || 0) > 1
          ? ` × ${deduction.scopeCount}개 직업`
          : "";
      return `고정 공제 · ${formatMoney(amountPerWeek, currencyUnit)} × ${numberOfWeeks}주${scopeSuffix}`;
    }
    return "고정 공제";
  }

  if (mode === "rate_after_exemption") {
    if (Number.isFinite(appliedBase) && Number.isFinite(rate)) {
      return `면제 후 비율 공제 · ${formatMoney(appliedBase, currencyUnit)} × ${rate}%`;
    }
    if (Number.isFinite(rate)) return `면제 후 비율 공제 · ${rate}%`;
    return "면제 후 비율 공제";
  }

  if (mode === "progressive") {
    return brackets.length > 0
      ? `누진 공제 · 직업별 ${brackets.length}개 구간`
      : "누진 공제";
  }

  return "학급 공제 규칙";
};
const addFiniteValue = (current, value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return current;
  return Number(current || 0) + numericValue;
};

const buildDeductionGroups = (jobs, globalDeductions) => {
  const groups = new Map();

  const appendDeduction = (deduction, scope, scopeType) => {
    const mode = String(deduction?.calculationMode || "legacy");
    const identity =
      deduction?.ruleId || deduction?.name || deduction?.label || "deduction";
    const key = `${scopeType}:${identity}:${mode}`;
    const detail = deduction?.calculationDetail || {};
    const current = groups.get(key) || {
      ...deduction,
      key,
      amount: 0,
      scopeType,
      scopeNames: [],
      calculationDetail: {
        rate: detail?.rate,
        amountPerWeek: detail?.amountPerWeek,
        numberOfWeeks: detail?.numberOfWeeks,
        brackets: Array.isArray(detail?.brackets) ? detail.brackets : [],
      },
    };

    current.amount += getDeductionAmount(deduction);
    if (scope && !current.scopeNames.includes(scope)) {
      current.scopeNames.push(scope);
    }
    current.calculationDetail.taxableBase = addFiniteValue(
      current.calculationDetail.taxableBase,
      detail?.taxableBase,
    );
    current.calculationDetail.appliedBase = addFiniteValue(
      current.calculationDetail.appliedBase,
      detail?.appliedBase,
    );
    groups.set(key, current);
  };

  jobs.forEach((job) => {
    (Array.isArray(job?.deductions) ? job.deductions : []).forEach(
      (deduction) => appendDeduction(deduction, job.jobName, "job"),
    );
  });
  globalDeductions.forEach((deduction) =>
    appendDeduction(deduction, "전체 공통", "global"),
  );

  return Array.from(groups.values()).map((group) => {
    const scopeCount = group.scopeNames.length;
    return {
      ...group,
      scopeCount,
      scope:
        group.scopeType === "global"
          ? "전체 공통"
          : scopeCount === 1
            ? group.scopeNames[0]
            : `${scopeCount}개 직업`,
    };
  });
};
const getPeriodLabel = (payslip) => {
  const description = String(payslip?.paymentPeriodDescription || "").trim();
  if (description) return description;

  const start = formatDate(payslip?.paymentStartDate);
  const end = formatDate(payslip?.paymentEndDate);
  if (start !== "-" && end !== "-") return `${start} ~ ${end}`;
  return start;
};

export default function PrintablePayslipDocument({
  payslip,
  className = "학급",
  currencyUnit = "",
}) {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatMoney = (value, unit = "") => `${formatConfiguredAmount(value)}${unit ? " " + unit : ""}`;

  const isBonus = payslip?.slipType === "bonus";
  const totals = payslip?.totals || payslip || {};
  const currency = payslip?.currencyUnit || currencyUnit;
  const jobs = Object.entries(payslip?.jobBreakdowns || {}).map(
    ([jobName, detail]) => ({
      jobName,
      ...(detail || {}),
    }),
  );
  const globalDeductions = Array.isArray(payslip?.globalDeductions)
    ? payslip.globalDeductions
    : [];
  const pensionContribution = Number(totals.pensionContribution || 0);
  const deductionRows = [
    ...buildDeductionGroups(jobs, globalDeductions),
    ...(pensionContribution > 0
      ? [{
          key: "pension-contribution",
          scope: "전체 공통",
          name: "연금 납입",
          amount: pensionContribution,
          basisLabel: `기본급의 ${Number(payslip?.pension?.contributionRate || 0)}%`,
        }]
      : []),
  ];
  const printableRowCount = jobs.length + deductionRows.length;
  const densityClass =
    printableRowCount > 14
      ? "payroll-print-page--compact"
      : printableRowCount > 8
        ? "payroll-print-page--dense"
        : "";
  const grossAmount = Number(
    isBonus
      ? totals.totalBonusAmount ?? totals.netSalary
      : totals.totalBaseSalary,
  );
  const totalDeductions =
    Number(totals.totalDeductions || 0) + pensionContribution;
  const netSalary = Number(totals.netSalary || 0);

  return (
    <article className={`payroll-print-page ${densityClass} bg-white text-slate-900`}>
      <header className="border-b-2 border-slate-900 pb-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="mt-2 text-3xl font-black tracking-normal text-slate-950">
              {className} {isBonus ? "성과급" : "급여"} 명세서
            </h1>
          </div>
          <p className="text-right text-[11px] font-medium text-slate-500">
            발급일 {formatDate(new Date())}
          </p>
        </div>
      </header>

      <section className="mt-5 grid grid-cols-[0.62fr_1.38fr] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        <div className="p-4">
          <p className="text-[10px] font-bold text-slate-400">수령자 성명</p>
          <p className="mt-1 truncate text-base font-black text-slate-900">
            {payslip?.studentName || "이름 없음"}
          </p>
        </div>
        <div className="border-l border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400">해당 지급 기간</p>
          <p className="mt-1 text-sm font-black leading-6 text-slate-800 [word-break:keep-all]">
            {getPeriodLabel(payslip)}
          </p>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="mt-1 text-lg font-black text-slate-900">지급 요약</h2>
          </div>
          <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
            {isBonus ? "성과급" : "급여"}
          </span>
        </div>
        <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-slate-200">
          <div className="p-4">
            <p className="text-[10px] font-bold text-slate-400">
              {isBonus ? "총 성과급" : "총 지급액"}
            </p>
            <p className="mt-1 text-lg font-black text-slate-900">
              {formatMoney(grossAmount, currency)}
            </p>
          </div>
          <div className="border-l border-slate-200 p-4">
            <p className="text-[10px] font-bold text-slate-400">총 공제액</p>
            <p className="mt-1 text-lg font-black text-rose-600">
              -{formatMoney(totalDeductions, currency)}
            </p>
          </div>
          <div className="border-l border-slate-200 bg-blue-600 p-4 text-white">
            <p className="text-[10px] font-bold text-blue-100">최종 실지급액</p>
            <p className="mt-1 text-lg font-black">
              {formatMoney(netSalary, currency)}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-7">
        <div className="mb-3">
          <h2 className="mt-1 text-lg font-black text-slate-900">
            {isBonus ? "직업별 성과급 산정" : "직무별 지급 및 공제"}
          </h2>
        </div>

        {jobs.length > 0 ? (
          <table className="w-full table-fixed border-collapse overflow-hidden rounded-lg border border-slate-200 text-left text-xs">
            <thead className="bg-slate-100 text-[10px] font-bold text-slate-500">
              <tr>
                <th className="w-[34%] border-b border-slate-200 px-3 py-2.5">
                  직업
                </th>
                <th className="border-b border-slate-200 px-3 py-2.5 text-right">
                  {isBonus ? "기준 급여" : "기본 급여"}
                </th>
                <th className="border-b border-slate-200 px-3 py-2.5 text-right">
                  {isBonus ? "성과급" : "공제"}
                </th>
                <th className="border-b border-slate-200 px-3 py-2.5 text-right">
                  실지급
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const bonusAmount = Number(job?.bonusAmount ?? 0);
                const deductions = getJobDeductions(job);
                const jobNet = Number(
                  job?.netSalary ??
                    (isBonus
                      ? bonusAmount - deductions
                      : Number(job?.baseSalary || 0) - deductions),
                );

                return (
                  <tr key={job.jobName} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-3 py-3 font-bold text-slate-800">
                      {job.jobName}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600">
                      {formatMoney(job?.baseSalary, currency)}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600">
                      {isBonus
                        ? `+${formatMoney(bonusAmount, currency)}`
                        : `-${formatMoney(deductions, currency)}`}
                    </td>
                    <td className="px-3 py-3 text-right font-black text-blue-700">
                      {formatMoney(jobNet, currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-medium text-slate-400">
            직업별 상세 내역이 없습니다.
          </div>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-3">
          <h2 className="mt-1 text-lg font-black text-slate-900">
            공제 상세 내역
          </h2>
        </div>
        {deductionRows.length > 0 ? (
          <table className="w-full table-fixed border-collapse overflow-hidden rounded-lg border border-slate-200 text-left text-xs">
            <thead className="bg-rose-50 text-[10px] font-bold text-rose-700">
              <tr>
                <th className="w-[22%] border-b border-rose-100 px-3 py-2.5">
                  적용 범위
                </th>
                <th className="w-[28%] border-b border-rose-100 px-3 py-2.5">
                  공제 항목
                </th>
                <th className="border-b border-rose-100 px-3 py-2.5">
                  계산 기준
                </th>
                <th className="w-[20%] border-b border-rose-100 px-3 py-2.5 text-right">
                  공제액
                </th>
              </tr>
            </thead>
            <tbody>
              {deductionRows.map((deduction) => (
                <tr
                  key={deduction.key}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <td className="px-3 py-2.5 font-bold text-slate-700">
                    {deduction.scope}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">
                    {deduction?.name || deduction?.label || "공제"}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">
                    {deduction.basisLabel || getDeductionBasis(deduction, currency, formatMoney)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-black text-rose-600">
                    -{formatMoney(getDeductionAmount(deduction), currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs font-medium text-slate-400">
            적용된 공제 상세 내역이 없습니다.
          </div>
        )}
      </section>
      {payslip?.note ? (
        <section className="mt-5 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
          <p className="text-[10px] font-bold text-amber-600">지급 사유</p>
          <p className="mt-1 text-xs font-medium text-amber-900">{payslip.note}</p>
        </section>
      ) : null}

      <footer className="mt-auto flex items-end justify-between border-t border-slate-200 pt-4 text-[10px] text-slate-400">
        <p>본 명세서는 Finclass 지급 기록을 기준으로 발급되었습니다.</p>
        <p className="font-bold text-slate-600">{className}</p>
      </footer>
    </article>
  );
}

