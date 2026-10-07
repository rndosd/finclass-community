import { appConfirm } from "../../../utils/appDialogs";
import { useNumberFormat as useConfiguredMoney } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  History,
  LockKeyhole,
  Plus,
  ReceiptText,
  RotateCcw,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";

import { db } from "../../../firebase";
import { Badge, Button, Card, IconButton, Modal, Spinner, ToggleSwitch } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { getMonthEndSettlementPolicy } from "../../../utils/taxPolicy";
import {
  cancelMonthEndSettlementDraft,
  fetchMonthEndSettlementDraft,
  fetchMonthEndSettlementHistory,
  fetchMonthEndSettlementDraftRows,
  finalizeMonthEndSettlementDraft,
  generateMonthEndSettlementDraft,
  updateMonthEndSettlementManualAdjustments,
} from "../services/monthEndSettlementService";

const SOURCE_LABELS = {
  missionReward: "과제 보상",
  jobBoardReward: "잡보드 보상",
  policeReward: "경찰 보상",
  incentivePayment: "인센티브",
  arcadePrize: "상금",
  depositInterest: "예금 이자",
  stockDividend: "주식 배당",
  realEstateRent: "부동산 임대료",
  payrollSalary: "급여",
  payrollBonus: "성과급",
  assetAdjustment: "자산 조정",
};

const SETTLEMENT_SOURCE_OPTIONS = [
  { key: "payrollSalary", category: "근로", label: SOURCE_LABELS.payrollSalary },
  { key: "payrollBonus", category: "근로", label: SOURCE_LABELS.payrollBonus },
  { key: "incentivePayment", category: "근로", label: SOURCE_LABELS.incentivePayment },
  { key: "missionReward", category: "활동", label: SOURCE_LABELS.missionReward },
  { key: "jobBoardReward", category: "활동", label: SOURCE_LABELS.jobBoardReward },
  { key: "policeReward", category: "활동", label: SOURCE_LABELS.policeReward },
  { key: "arcadePrize", category: "상금", label: SOURCE_LABELS.arcadePrize },
  { key: "depositInterest", category: "자산", label: SOURCE_LABELS.depositInterest },
  { key: "stockDividend", category: "자산", label: SOURCE_LABELS.stockDividend },
  { key: "realEstateRent", category: "자산", label: SOURCE_LABELS.realEstateRent },
  { key: "assetAdjustment", category: "기타", label: SOURCE_LABELS.assetAdjustment },
];

const SOURCE_CATEGORIES = ["근로", "활동", "자산", "상금", "기타"];
const DEFAULT_TAX_BRACKETS = [
  { upToAmount: 5000, rate: 5 },
  { upToAmount: 10000, rate: 10 },
  { upToAmount: null, rate: 15 },
];

const toDateObject = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toMoney = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
};

const toRate = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed));
};

const clonePolicy = (policy) => JSON.parse(JSON.stringify(policy || {}));





const formatDateCompact = (value) => {
  const date = toDateObject(value);
  if (!date) return "-";
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

const getSettlementStatusMeta = (status) => {
  if (status === "finalized") {
    return { label: "확정 완료", tone: "emerald" };
  }
  if (status === "cancelled") {
    return { label: "취소됨", tone: "red" };
  }
  if (status === "finalizing") {
    return { label: "확정 처리 중", tone: "amber" };
  }
  return { label: "미리보기", tone: "indigo" };
};

const buildManualEditsFromRows = (rows = []) =>
  Object.fromEntries(
    rows.map((row) => [
      row.studentUid,
      {
        incomeDeductionAmount: String(row.manualAdjustments?.incomeDeductionAmount || 0),
        taxCreditAmount: String(row.manualAdjustments?.taxCreditAmount || 0),
        note: row.manualAdjustments?.note || "",
      },
    ]),
  );

const normalizeEditablePolicy = (policy) => ({
  ...clonePolicy(policy),
  taxBrackets: (policy.taxBrackets || []).map((bracket) => ({
    upToAmount: bracket.upToAmount === null ? "" : String(bracket.upToAmount || ""),
    rate: String(bracket.rate || 0),
  })),
  exemptionGroups: (policy.exemptionGroups || []).map((group) => ({
    ...group,
    amount: String(group.amount || 0),
  })),
  incomeDeductions: {
    ...policy.incomeDeductions,
    basic: {
      ...policy.incomeDeductions?.basic,
      amount: String(policy.incomeDeductions?.basic?.amount || 0),
    },
    labor: {
      ...policy.incomeDeductions?.labor,
      rate: String(policy.incomeDeductions?.labor?.rate || 0),
      maxAmount: String(policy.incomeDeductions?.labor?.maxAmount || 0),
    },
    storeSpending: {
      ...policy.incomeDeductions?.storeSpending,
      rate: String(policy.incomeDeductions?.storeSpending?.rate || 0),
      maxAmount: String(policy.incomeDeductions?.storeSpending?.maxAmount || 0),
      minSpendingAmount: String(policy.incomeDeductions?.storeSpending?.minSpendingAmount || 0),
    },
    activity: {
      ...policy.incomeDeductions?.activity,
      rate: String(policy.incomeDeductions?.activity?.rate || 0),
      maxAmount: String(policy.incomeDeductions?.activity?.maxAmount || 0),
    },
  },
  taxCredits: {
    ...policy.taxCredits,
    donation: {
      ...policy.taxCredits?.donation,
      rate: String(policy.taxCredits?.donation?.rate || 0),
      maxAmount: String(policy.taxCredits?.donation?.maxAmount || 0),
    },
  },
});

const sanitizePolicyForSave = (policy) => {
  const sanitized = clonePolicy(policy);

  sanitized.taxBrackets = (sanitized.taxBrackets || []).map((bracket, index, list) => ({
    upToAmount:
      index === list.length - 1 || bracket.upToAmount === ""
        ? null
        : toMoney(bracket.upToAmount),
    rate: toRate(bracket.rate),
  }));

  sanitized.exemptionGroups = (sanitized.exemptionGroups || []).map((group) => ({
    ...group,
    enabled: group.enabled !== false,
    amount: toMoney(group.amount),
    sourceKeys: Array.isArray(group.sourceKeys) ? group.sourceKeys : [],
  }));

  sanitized.incomeDeductions = {
    ...sanitized.incomeDeductions,
    basic: {
      ...sanitized.incomeDeductions?.basic,
      enabled: sanitized.incomeDeductions?.basic?.enabled !== false,
      amount: toMoney(sanitized.incomeDeductions?.basic?.amount),
    },
    labor: {
      ...sanitized.incomeDeductions?.labor,
      enabled: sanitized.incomeDeductions?.labor?.enabled !== false,
      rate: toRate(sanitized.incomeDeductions?.labor?.rate),
      maxAmount: toMoney(sanitized.incomeDeductions?.labor?.maxAmount),
    },
    storeSpending: {
      ...sanitized.incomeDeductions?.storeSpending,
      enabled: sanitized.incomeDeductions?.storeSpending?.enabled !== false,
      rate: toRate(sanitized.incomeDeductions?.storeSpending?.rate),
      maxAmount: toMoney(sanitized.incomeDeductions?.storeSpending?.maxAmount),
      minSpendingAmount: toMoney(sanitized.incomeDeductions?.storeSpending?.minSpendingAmount),
    },
    activity: {
      ...sanitized.incomeDeductions?.activity,
      enabled: sanitized.incomeDeductions?.activity?.enabled === true,
      rate: toRate(sanitized.incomeDeductions?.activity?.rate),
      maxAmount: toMoney(sanitized.incomeDeductions?.activity?.maxAmount),
    },
    manual: {
      ...sanitized.incomeDeductions?.manual,
      enabled: sanitized.incomeDeductions?.manual?.enabled !== false,
    },
  };

  sanitized.taxCredits = {
    ...sanitized.taxCredits,
    donation: {
      ...sanitized.taxCredits?.donation,
      enabled: sanitized.taxCredits?.donation?.enabled !== false,
      rate: toRate(sanitized.taxCredits?.donation?.rate),
      maxAmount: toMoney(sanitized.taxCredits?.donation?.maxAmount),
    },
    manual: {
      ...sanitized.taxCredits?.manual,
      enabled: sanitized.taxCredits?.manual?.enabled !== false,
    },
  };

  return sanitized;
};

const isLastBracket = (brackets, index) => index === brackets.length - 1;

const getNextBracketUpperBound = (brackets = []) => {
  const finiteBounds = brackets
    .slice(0, -1)
    .map((bracket) => toMoney(bracket.upToAmount))
    .filter((amount) => amount > 0);
  const lastBound = finiteBounds.length
    ? Math.max(...finiteBounds)
    : DEFAULT_TAX_BRACKETS[0].upToAmount;

  return lastBound + 5000;
};

const validateTaxBrackets = (brackets = []) => {
  if (!Array.isArray(brackets) || brackets.length < 2) {
    return "세율 구간은 최소 2개 이상이어야 합니다.";
  }

  let previousUpperBound = 0;
  for (let index = 0; index < brackets.length; index += 1) {
    const bracket = brackets[index];

    if (isLastBracket(brackets, index)) {
      if (bracket.upToAmount !== null) {
        return "마지막 세율 구간은 초과 구간이어야 합니다.";
      }
      continue;
    }

    const upperBound = toMoney(bracket.upToAmount);
    if (upperBound <= 0) {
      return "세율 구간 상한은 0보다 커야 합니다.";
    }
    if (upperBound <= previousUpperBound) {
      return "세율 구간 상한은 작은 금액부터 큰 금액 순서로 입력해 주세요.";
    }
    previousUpperBound = upperBound;
  }

  return null;
};

const getPolicyWarnings = (policy = {}) => {
  const warnings = [];
  const brackets = Array.isArray(policy.taxBrackets) ? policy.taxBrackets : [];
  const allRatesZero =
    brackets.length > 0 && brackets.every((bracket) => toRate(bracket.rate) === 0);

  if (allRatesZero) {
    warnings.push("과세표준 세율이 모두 0%입니다. 원천징수된 세금이 전액 환급될 수 있습니다.");
  }

  return warnings;
};

const formatPolicyAmount = (value, currencyUnit) =>
  `${toMoney(value).toLocaleString()}${currencyUnit || ""}`;

const formatBracketLabel = (bracket, index, brackets, currencyUnit) =>
  isLastBracket(brackets, index)
    ? `초과 구간 · ${toRate(bracket.rate)}%`
    : `${formatPolicyAmount(bracket.upToAmount, currencyUnit)} 이하 · ${toRate(bracket.rate)}%`;

const countEnabledRows = (rows = []) =>
  rows.filter((row) => row?.enabled !== false).length;

const countEnabledMapValues = (value = {}) =>
  Object.values(value || {}).filter((row) => row?.enabled !== false).length;

const comparablePolicy = (policy) => {
  const next = clonePolicy(policy);
  delete next.activeDraftId;
  delete next.lockedPeriodEndAt;
  delete next.lastClosedAt;
  return next;
};

const StatCard = ({ label, value, tone = "slate" }) => {
  const toneClass =
    {
      emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
      red: "bg-red-50 text-red-700 ring-red-100",
      indigo: "bg-indigo-50 text-indigo-700 ring-indigo-100",
      amber: "bg-amber-50 text-amber-700 ring-amber-100",
      slate: "bg-slate-50 text-slate-700 ring-slate-100",
    }[tone] || "bg-slate-50 text-slate-700 ring-slate-100";

  return (
    <div className={`rounded-2xl px-4 py-3 ring-1 ${toneClass}`}>
      <p className="text-xs font-bold uppercase opacity-70">{label}</p>
      <p className="mt-1 break-words text-lg font-black leading-tight">{value}</p>
    </div>
  );
};

const NumberField = ({ label, value, onChange, disabled = false, suffix = "" }) => (
  <label className="space-y-1.5">
    <span className="block text-xs font-bold text-slate-500">{label}</span>
    <div className="flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-indigo-300 focus-within:ring-0">
      <input
        type="number"
        min="0"
        step="1"
        data-unstyled-input="true"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent p-0 text-sm font-semibold text-slate-800 shadow-none outline-none focus:border-0 focus:ring-2 focus:ring-blue-500/20 disabled:text-slate-400"
      />
      {suffix ? <span className="text-xs font-bold text-slate-400">{suffix}</span> : null}
    </div>
  </label>
);

const TextField = ({ label, value, onChange, disabled = false }) => (
  <label className="space-y-1.5">
    <span className="block text-xs font-bold text-slate-500">{label}</span>
    <input
      type="text"
      data-unstyled-input="true"
      value={value}
      disabled={disabled}
      maxLength={40}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-400"
    />
  </label>
);

const Toggle = ({ checked, onChange, disabled = false, label }) => (
  <ToggleSwitch
    checked={checked}
    onChange={onChange}
    disabled={disabled}
    tone="emerald"
    srLabel={`${label} 사용`}
  />
);

const SelectedSourceChips = ({ sourceKeys = [] }) => {
  if (!sourceKeys.length) {
    return (
      <span className="text-xs font-semibold text-slate-400">
        선택된 소득원 없음
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {sourceKeys.map((sourceKey) => (
        <span
          key={sourceKey}
          className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-700 ring-1 ring-indigo-100"
        >
          {SOURCE_LABELS[sourceKey] || sourceKey}
        </span>
      ))}
    </div>
  );
};

const SourceSelector = ({ sourceKeys = [], onChange, disabled = false }) => {
  const [isEditing, setIsEditing] = useState(false);
  const selectedKeys = new Set(sourceKeys);

  const orderedKeys = (keys) =>
    SETTLEMENT_SOURCE_OPTIONS
      .map((source) => source.key)
      .filter((key) => keys.includes(key));

  const setAllSources = () => {
    if (disabled) return;
    onChange(SETTLEMENT_SOURCE_OPTIONS.map((source) => source.key));
  };

  const clearSources = () => {
    if (disabled) return;
    onChange([]);
  };

  const toggleSource = (sourceKey) => {
    if (disabled) return;
    const nextKeys = selectedKeys.has(sourceKey)
      ? sourceKeys.filter((key) => key !== sourceKey)
      : [...sourceKeys, sourceKey];
    onChange(orderedKeys(nextKeys));
  };

  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-black text-slate-500">포함 소득원</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
              {selectedKeys.size}개
            </span>
          </div>
          <SelectedSourceChips sourceKeys={sourceKeys} />
        </div>
        <Button
          type="button"
          disabled={disabled}
          onClick={() => setIsEditing((previous) => !previous)}
          tone="slate"
          size="xs"
          rounded="lg"
          className="transition disabled:cursor-not-allowed"
        >
          소득원 변경
        </Button>
      </div>

      {isEditing && !disabled ? (
        <div className="mt-3 space-y-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              onClick={setAllSources}
              tone="slate"
              kind="outline"
              size="xs"
              rounded="lg"
              
            >
              전체 선택
            </Button>
            <Button
              type="button"
              onClick={clearSources}
              tone="slate"
              kind="outline"
              size="xs"
              rounded="lg"
              
            >
              전체 해제
            </Button>
          </div>
          {SOURCE_CATEGORIES.map((category) => {
            const sources = SETTLEMENT_SOURCE_OPTIONS.filter(
              (source) => source.category === category,
            );
            return (
              <div key={category} className="space-y-1.5">
                <p className="text-[11px] font-black text-slate-400">{category}</p>
                <div className="flex flex-wrap gap-1.5">
                  {sources.map((source) => {
                    const selected = selectedKeys.has(source.key);
                    return (
                      <Button
                        key={source.key}
                        type="button"
                        onClick={() => toggleSource(source.key)}
                        tone="blue"
                        kind={selected ? "solid" : "outline"}
                        size="xs"
                        rounded="full"
                        className={`rounded-full px-3 py-1.5 text-xs font-bold ring-1 transition ${
                          selected
                            ? "bg-indigo-600 text-white ring-indigo-600"
                            : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {source.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

const PolicyStep = ({ step, title, description, open, children }) => {
  if (!open) return null;

  return (
    <section>
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-black text-white">
          {step}
        </span>
        <div>
          <h4 className="text-xl font-black text-slate-900">{title}</h4>
          <p className="mt-1 text-sm font-semibold text-slate-500">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
};

const CalculationGuidePanel = () => (
  <div className="flex flex-nowrap items-center justify-between gap-1 whitespace-nowrap rounded-xl bg-indigo-50 px-3 py-3 text-[11px] font-black text-slate-600 ring-1 ring-indigo-100">
    {["비과세", "소득공제", "과세표준 세율", "세액공제"].map((label, index) => (
      <React.Fragment key={label}>
        {index > 0 ? <span className="text-slate-300">→</span> : null}
        <span className={index === 2 ? "text-indigo-700" : ""}>{label}</span>
      </React.Fragment>
    ))}
  </div>
);

const PolicySettings = ({
  policy,
  setPolicy,
  currencyUnit,
  disabled,
  isDirty,
  isSaving,
  onReset,
  onSave,
}) => {
  const updateExemptionGroup = (index, patch) => {
    setPolicy((previous) => {
      const next = clonePolicy(previous);
      next.exemptionGroups[index] = { ...next.exemptionGroups[index], ...patch };
      return next;
    });
  };

  const addExemptionGroup = () => {
    setPolicy((previous) => {
      const next = clonePolicy(previous);
      const nextIndex = (next.exemptionGroups || []).length + 1;
      next.exemptionGroups = [
        ...(next.exemptionGroups || []),
        {
          id: `customExemption_${Date.now()}`,
          label: `비과세 그룹 ${nextIndex}`,
          enabled: true,
          amount: "0",
          sourceKeys: [],
        },
      ];
      return next;
    });
  };

  const removeExemptionGroup = (index) => {
    setPolicy((previous) => {
      const next = clonePolicy(previous);
      next.exemptionGroups = (next.exemptionGroups || []).filter((_, groupIndex) => (
        groupIndex !== index
      ));
      return next;
    });
  };

  const updateDeduction = (key, patch) => {
    setPolicy((previous) => {
      const next = clonePolicy(previous);
      next.incomeDeductions[key] = { ...next.incomeDeductions[key], ...patch };
      return next;
    });
  };

  const updateCredit = (key, patch) => {
    setPolicy((previous) => {
      const next = clonePolicy(previous);
      next.taxCredits[key] = { ...next.taxCredits[key], ...patch };
      return next;
    });
  };

  const updateBracket = (index, patch) => {
    setPolicy((previous) => {
      const next = clonePolicy(previous);
      next.taxBrackets[index] = { ...next.taxBrackets[index], ...patch };
      return next;
    });
  };

  const addBracket = () => {
    setPolicy((previous) => {
      const next = clonePolicy(previous);
      const brackets = Array.isArray(next.taxBrackets) && next.taxBrackets.length > 0
        ? next.taxBrackets
        : DEFAULT_TAX_BRACKETS.map((bracket) => ({ ...bracket }));
      const finalBracket = brackets[brackets.length - 1] || { upToAmount: "", rate: "0" };
      next.taxBrackets = [
        ...brackets.slice(0, -1),
        {
          upToAmount: String(getNextBracketUpperBound(brackets)),
          rate: "0",
        },
        { ...finalBracket, upToAmount: "" },
      ];
      return next;
    });
  };

  const removeBracket = (index) => {
    setPolicy((previous) => {
      const next = clonePolicy(previous);
      const brackets = Array.isArray(next.taxBrackets) ? next.taxBrackets : [];
      if (isLastBracket(brackets, index) || brackets.length <= 2) return previous;
      next.taxBrackets = brackets.filter((_, bracketIndex) => bracketIndex !== index);
      return next;
    });
  };

  const restoreDefaultBrackets = () => {
    setPolicy((previous) => ({
      ...clonePolicy(previous),
      taxBrackets: DEFAULT_TAX_BRACKETS.map((bracket) => ({
        upToAmount: bracket.upToAmount === null ? "" : String(bracket.upToAmount),
        rate: String(bracket.rate),
      })),
    }));
  };

  const [activeStep, setActiveStep] = useState("exemptions");
  const policySteps = [
    {
      key: "exemptions",
      step: "1",
      title: "비과세 그룹",
      summary: String(countEnabledRows(policy.exemptionGroups || [])) + "개 사용",
    },
    {
      key: "deductions",
      step: "2",
      title: "소득공제",
      summary: String(countEnabledMapValues(policy.incomeDeductions || {})) + "개 사용",
    },
    {
      key: "brackets",
      step: "3",
      title: "과세표준 세율",
      summary: String((policy.taxBrackets || []).length) + "구간",
    },
    {
      key: "credits",
      step: "4",
      title: "세액공제",
      summary: String(countEnabledMapValues(policy.taxCredits || {})) + "개 사용",
    },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {disabled ? (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm font-bold text-amber-800">
          <LockKeyhole className="h-4 w-4 shrink-0" />
          미리보기가 생성되어 정책 수정이 잠겼습니다. 취소하거나 확정한 뒤 다시 수정할 수 있습니다.
        </div>
      ) : null}
      <div
        className={
          "grid min-h-[620px] lg:grid-cols-[320px_minmax(0,1fr)] " +
          (disabled ? "pointer-events-none opacity-55" : "")
        }
      >
        <aside className="border-b border-slate-200 bg-slate-50/60 p-4 lg:border-b-0 lg:border-r">
          <CalculationGuidePanel />
          <nav className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {policySteps.map((item) => {
              const selected = activeStep === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveStep(item.key)}
                  className={
                    "flex w-full items-center gap-3 border-b border-slate-100 px-4 py-4 text-left last:border-b-0 " +
                    (selected
                      ? "bg-indigo-50 text-indigo-800"
                      : "text-slate-700 hover:bg-slate-50")
                  }
                >
                  <span
                    className={
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black " +
                      (selected
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-slate-600 ring-1 ring-slate-200")
                    }
                  >
                    {item.step}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-black">{item.title}</span>
                  <span
                    className={
                      "whitespace-nowrap text-xs font-bold " +
                      (selected ? "text-indigo-600" : "text-slate-400")
                    }
                  >
                    {item.summary}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 p-5 sm:p-7">
        <PolicyStep
          step="1"
          title="비과세 그룹"
          description="선택한 소득원을 합산하고, 정산기간 한도만큼 세금 계산에서 제외합니다."
          open={activeStep === "exemptions"}
        >
          <div className="mb-3 flex justify-end">
            <Button
              size="sm"
              tone="blue"
              kind="outline"
              icon={Plus}
              disabled={disabled}
              onClick={addExemptionGroup}
            >
              비과세 그룹 추가
            </Button>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {(policy.exemptionGroups || []).map((group, index) => (
              <div key={group.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                <div className="grid gap-4">
                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-slate-800">
                        비과세 그룹 {index + 1}
                      </p>
                      <div className="flex shrink-0 items-center gap-2">
                        <Toggle
                          label={`비과세 그룹 ${index + 1}`}
                          checked={group.enabled !== false}
                          disabled={disabled}
                          onChange={(enabled) => updateExemptionGroup(index, { enabled })}
                        />
                        <IconButton
                          type="button"
                          disabled={disabled || (policy.exemptionGroups || []).length <= 1}
                          onClick={() => removeExemptionGroup(index)}
                          icon={Trash2}
                          label="비과세 그룹 삭제"
                          tone="red"
                          size="md"
                          className="rounded-xl bg-red-50 p-2 text-red-600 ring-1 ring-red-100 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 disabled:ring-slate-100"
                          aria-label={`${group.label || "비과세 그룹"} 삭제`}
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(140px,0.45fr)]">
                      <TextField
                        label="그룹 이름"
                        value={group.label || ""}
                        disabled={disabled}
                        onChange={(label) => updateExemptionGroup(index, { label })}
                      />
                      <NumberField
                        label="정산기간 한도"
                        value={group.amount}
                        suffix={currencyUnit}
                        disabled={disabled || group.enabled === false}
                        onChange={(amount) => updateExemptionGroup(index, { amount })}
                      />
                    </div>
                  </div>
                  <SourceSelector
                    sourceKeys={group.sourceKeys || []}
                    disabled={disabled || group.enabled === false}
                    onChange={(sourceKeys) => updateExemptionGroup(index, { sourceKeys })}
                  />
                </div>
              </div>
            ))}
          </div>
        </PolicyStep>

        <PolicyStep
          step="2"
          title="소득공제"
          description="세전소득에서 비과세를 뺀 뒤, 과세표준을 낮추는 공제입니다."
          open={activeStep === "deductions"}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-black text-slate-800">기본공제</p>
                <Toggle
                  label="기본공제"
                  checked={policy.incomeDeductions?.basic?.enabled !== false}
                  disabled={disabled}
                  onChange={(enabled) => updateDeduction("basic", { enabled })}
                />
              </div>
              <NumberField
                label="고정 금액"
                value={policy.incomeDeductions?.basic?.amount || "0"}
                suffix={currencyUnit}
                disabled={disabled || policy.incomeDeductions?.basic?.enabled === false}
                onChange={(amount) => updateDeduction("basic", { amount })}
              />
            </div>

            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-black text-slate-800">근로소득공제</p>
                <Toggle
                  label="근로소득공제"
                  checked={policy.incomeDeductions?.labor?.enabled !== false}
                  disabled={disabled}
                  onChange={(enabled) => updateDeduction("labor", { enabled })}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <NumberField
                  label="비율"
                  value={policy.incomeDeductions?.labor?.rate || "0"}
                  suffix="%"
                  disabled={disabled || policy.incomeDeductions?.labor?.enabled === false}
                  onChange={(rate) => updateDeduction("labor", { rate })}
                />
                <NumberField
                  label="최대 한도"
                  value={policy.incomeDeductions?.labor?.maxAmount || "0"}
                  suffix={currencyUnit}
                  disabled={disabled || policy.incomeDeductions?.labor?.enabled === false}
                  onChange={(maxAmount) => updateDeduction("labor", { maxAmount })}
                />
              </div>
              <div className="mt-3">
                <SourceSelector
                  sourceKeys={policy.incomeDeductions?.labor?.sourceKeys || []}
                  disabled={disabled || policy.incomeDeductions?.labor?.enabled === false}
                  onChange={(sourceKeys) => updateDeduction("labor", { sourceKeys })}
                />
              </div>
            </div>

            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-black text-slate-800">상점 소비공제</p>
                <Toggle
                  label="상점 소비공제"
                  checked={policy.incomeDeductions?.storeSpending?.enabled !== false}
                  disabled={disabled}
                  onChange={(enabled) => updateDeduction("storeSpending", { enabled })}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <NumberField
                  label="비율"
                  value={policy.incomeDeductions?.storeSpending?.rate || "0"}
                  suffix="%"
                  disabled={disabled || policy.incomeDeductions?.storeSpending?.enabled === false}
                  onChange={(rate) => updateDeduction("storeSpending", { rate })}
                />
                <NumberField
                  label="최대 한도"
                  value={policy.incomeDeductions?.storeSpending?.maxAmount || "0"}
                  suffix={currencyUnit}
                  disabled={disabled || policy.incomeDeductions?.storeSpending?.enabled === false}
                  onChange={(maxAmount) => updateDeduction("storeSpending", { maxAmount })}
                />
                <NumberField
                  label="최소 소비"
                  value={policy.incomeDeductions?.storeSpending?.minSpendingAmount || "0"}
                  suffix={currencyUnit}
                  disabled={disabled || policy.incomeDeductions?.storeSpending?.enabled === false}
                  onChange={(minSpendingAmount) =>
                    updateDeduction("storeSpending", { minSpendingAmount })
                  }
                />
              </div>
            </div>

            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-black text-slate-800">활동 소득공제</p>
                <Toggle
                  label="활동 소득공제"
                  checked={policy.incomeDeductions?.activity?.enabled === true}
                  disabled={disabled}
                  onChange={(enabled) => updateDeduction("activity", { enabled })}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <NumberField
                  label="비율"
                  value={policy.incomeDeductions?.activity?.rate || "0"}
                  suffix="%"
                  disabled={disabled || policy.incomeDeductions?.activity?.enabled !== true}
                  onChange={(rate) => updateDeduction("activity", { rate })}
                />
                <NumberField
                  label="최대 한도"
                  value={policy.incomeDeductions?.activity?.maxAmount || "0"}
                  suffix={currencyUnit}
                  disabled={disabled || policy.incomeDeductions?.activity?.enabled !== true}
                  onChange={(maxAmount) => updateDeduction("activity", { maxAmount })}
                />
              </div>
              <div className="mt-3">
                <SourceSelector
                  sourceKeys={policy.incomeDeductions?.activity?.sourceKeys || []}
                  disabled={disabled || policy.incomeDeductions?.activity?.enabled !== true}
                  onChange={(sourceKeys) => updateDeduction("activity", { sourceKeys })}
                />
              </div>
            </div>
          </div>
        </PolicyStep>

        <div className="contents">
          <PolicyStep
            step="3"
            title="과세표준 세율"
            description="공제를 뺀 금액에 구간별 세율을 적용합니다."
            open={activeStep === "brackets"}
          >
            <div className="mb-3 flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                tone="slate"
                kind="outline"
                icon={RotateCcw}
                disabled={disabled}
                onClick={restoreDefaultBrackets}
              >
                기본값 복원
              </Button>
              <Button
                size="sm"
                tone="blue"
                kind="outline"
                icon={Plus}
                disabled={disabled}
                onClick={addBracket}
              >
                구간 추가
              </Button>
            </div>
            {getPolicyWarnings(policy).map((warning) => (
              <div
                key={warning}
                className="mb-3 flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 ring-1 ring-amber-100"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="hidden grid-cols-[110px_minmax(180px,1fr)_140px_52px] bg-slate-50 px-4 py-3 text-xs font-black text-slate-500 sm:grid">
                <span>구간</span>
                <span>상한 금액</span>
                <span>세율</span>
                <span className="text-center">관리</span>
              </div>
              {(policy.taxBrackets || []).map((bracket, index) => {
                const brackets = policy.taxBrackets || [];
                const last = isLastBracket(brackets, index);

                return (
                  <div
                    key={"bracket_" + index}
                    className="grid gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:grid-cols-[110px_minmax(180px,1fr)_140px_52px] sm:items-center"
                  >
                    <div>
                      <span className="text-xs font-bold text-slate-400 sm:hidden">구간</span>
                      <p className="text-sm font-black text-slate-800">
                        {last ? "초과 구간" : String(index + 1) + "구간"}
                      </p>
                    </div>
                    <label>
                      <span className="text-xs font-bold text-slate-400 sm:hidden">상한 금액</span>
                      <div className="flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 focus-within:border-indigo-300">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={bracket.upToAmount}
                          disabled={disabled || last}
                          onChange={(event) =>
                            updateBracket(index, { upToAmount: event.target.value })
                          }
                          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-right text-sm font-bold outline-none disabled:text-slate-500"
                          aria-label={last ? "초과 구간 상한" : String(index + 1) + "구간 상한"}
                        />
                        <span className="ml-2 text-xs font-bold text-slate-400">
                          {last ? "무제한" : currencyUnit}
                        </span>
                      </div>
                    </label>
                    <label>
                      <span className="text-xs font-bold text-slate-400 sm:hidden">세율</span>
                      <div className="flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 focus-within:border-indigo-300">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={bracket.rate}
                          disabled={disabled}
                          onChange={(event) =>
                            updateBracket(index, { rate: event.target.value })
                          }
                          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-right text-sm font-bold outline-none"
                          aria-label={String(index + 1) + "구간 세율"}
                        />
                        <span className="ml-2 text-xs font-bold text-slate-400">%</span>
                      </div>
                    </label>
                    <div className="flex justify-end sm:justify-center">
                      {!last ? (
                        <IconButton
                          type="button"
                          disabled={disabled || brackets.length <= 2}
                          onClick={() => removeBracket(index)}
                          icon={Trash2}
                          label="세율 구간 삭제"
                          tone="red"
                          size="md"
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:text-slate-200"
                          aria-label={String(index + 1) + "구간 삭제"}
                        />
                      ) : (
                        <span className="h-9 w-9" aria-hidden="true" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </PolicyStep>

          <PolicyStep
            step="4"
            title="세액공제"
            description="계산된 세금에서 직접 차감합니다."
            open={activeStep === "credits"}
          >
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-black text-slate-800">기부금 세액공제</p>
                <Toggle
                  label="기부금 세액공제"
                  checked={policy.taxCredits?.donation?.enabled !== false}
                  disabled={disabled}
                  onChange={(enabled) => updateCredit("donation", { enabled })}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <NumberField
                  label="비율"
                  value={policy.taxCredits?.donation?.rate || "0"}
                  suffix="%"
                  disabled={disabled || policy.taxCredits?.donation?.enabled === false}
                  onChange={(rate) => updateCredit("donation", { rate })}
                />
                <NumberField
                  label="최대 한도"
                  value={policy.taxCredits?.donation?.maxAmount || "0"}
                  suffix={currencyUnit}
                  disabled={disabled || policy.taxCredits?.donation?.enabled === false}
                  onChange={(maxAmount) => updateCredit("donation", { maxAmount })}
                />
              </div>
            </div>
          </PolicyStep>
        </div>
        </main>
      </div>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center gap-2 text-sm font-bold">
          <span
            className={
              "h-2.5 w-2.5 rounded-full " +
              (isDirty ? "bg-indigo-600" : "bg-slate-300")
            }
          />
          <span className={isDirty ? "text-slate-700" : "text-slate-400"}>
            {isDirty ? "변경사항 있음" : "저장된 정책"}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            tone="slate"
            kind="outline"
            icon={RotateCcw}
            disabled={!isDirty || isSaving || disabled}
            onClick={onReset}
          >
            되돌리기
          </Button>
          <Button
            tone="blue"
            icon={Save}
            isLoading={isSaving}
            disabled={!isDirty || isSaving || disabled}
            onClick={onSave}
          >
            정책 저장
          </Button>
        </div>
      </div>
    </div>
  );
};

const PolicySaveConfirmModal = ({
  policy,
  currencyUnit,
  isSaving,
  onCancel,
  onConfirm,
}) => {
  if (!policy) return null;

  const warnings = getPolicyWarnings(policy);
  const brackets = policy.taxBrackets || [];
  const enabledExemptionCount = countEnabledRows(policy.exemptionGroups || []);
  const enabledDeductionCount = countEnabledMapValues(policy.incomeDeductions || {});
  const enabledCreditCount = countEnabledMapValues(policy.taxCredits || {});

  return (
    <Modal isOpen={true} onClose={onCancel} size="lg" closeOnOverlayClick={!isSaving}>
      <Modal.Header>
        <div className="flex items-center gap-2">
          <Save className="h-5 w-5 text-indigo-600" />
          <h2 className="text-xl font-bold text-slate-800">
            월말정산 정책 저장 전 확인
          </h2>
        </div>
      </Modal.Header>
      <Modal.Body className="space-y-5">
        {warnings.length > 0 ? (
          <div className="space-y-2">
            {warnings.map((warning) => (
              <div
                key={warning}
                className="flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 ring-1 ring-amber-100"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          <StatCard label="비과세 사용" value={`${enabledExemptionCount}개`} tone="slate" />
          <StatCard label="소득공제 사용" value={`${enabledDeductionCount}개`} tone="slate" />
          <StatCard label="세액공제 사용" value={`${enabledCreditCount}개`} tone="slate" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
            <h3 className="text-sm font-black text-slate-800">비과세 그룹</h3>
            <div className="mt-3 space-y-2">
              {(policy.exemptionGroups || []).length > 0 ? (
                (policy.exemptionGroups || []).map((group) => (
                  <div key={group.id || group.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-slate-600">{group.label || "비과세 그룹"}</span>
                    <span className={`font-black ${group.enabled === false ? "text-slate-400" : "text-emerald-700"}`}>
                      {group.enabled === false ? "미사용" : `${formatPolicyAmount(group.amount, currencyUnit)} 사용`}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm font-semibold text-slate-400">설정된 비과세 그룹이 없습니다.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
            <h3 className="text-sm font-black text-slate-800">과세표준 세율</h3>
            <div className="mt-3 space-y-2">
              {brackets.map((bracket, index) => (
                <div key={`confirm_bracket_${index}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-slate-600">구간 {index + 1}</span>
                  <span className="font-black text-indigo-700">
                    {formatBracketLabel(bracket, index, brackets, currencyUnit)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
            <h3 className="text-sm font-black text-slate-800">소득공제</h3>
            <div className="mt-3 space-y-2 text-sm">
              {Object.entries(policy.incomeDeductions || {}).map(([key, deduction]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-600">{deduction?.label || key}</span>
                  <span className={`font-black ${deduction?.enabled === false ? "text-slate-400" : "text-emerald-700"}`}>
                    {deduction?.enabled === false ? "미사용" : "사용"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
            <h3 className="text-sm font-black text-slate-800">세액공제</h3>
            <div className="mt-3 space-y-2 text-sm">
              {Object.entries(policy.taxCredits || {}).map(([key, credit]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-600">{credit?.label || key}</span>
                  <span className={`font-black ${credit?.enabled === false ? "text-slate-400" : "text-emerald-700"}`}>
                    {credit?.enabled === false ? "미사용" : "사용"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button tone="slate" kind="ghost" disabled={isSaving} onClick={onCancel}>
          취소
        </Button>
        <Button
          tone={warnings.length > 0 ? "amber" : "indigo"}
          icon={Save}
          isLoading={isSaving}
          disabled={isSaving}
          onClick={onConfirm}
        >
          {warnings.length > 0 ? "경고 확인 후 저장" : "정책 저장"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

const PolicySummaryPanel = ({ policy, currencyUnit }) => {
  if (!policy) return null;

  const warnings = getPolicyWarnings(policy);
  const brackets = policy.taxBrackets || [];
  const enabledExemptionCount = countEnabledRows(policy.exemptionGroups || []);
  const enabledDeductionCount = countEnabledMapValues(policy.incomeDeductions || {});
  const enabledCreditCount = countEnabledMapValues(policy.taxCredits || {});

  return (
    <div className="space-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-black text-slate-800">현재 적용 정책</p>
          <p className="text-xs leading-5 text-slate-500">
            미리보기 생성과 다시 계산에 사용할 월말정산 정책입니다.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[360px]">
          <StatCard label="비과세" value={`${enabledExemptionCount}개 사용`} tone="slate" />
          <StatCard label="소득공제" value={`${enabledDeductionCount}개 사용`} tone="slate" />
          <StatCard label="세액공제" value={`${enabledCreditCount}개 사용`} tone="slate" />
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="space-y-2">
          {warnings.map((warning) => (
            <div
              key={warning}
              className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 ring-1 ring-amber-100"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {brackets.map((bracket, index) => (
          <span
            key={`run_policy_bracket_${index}`}
            className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-indigo-700 ring-1 ring-indigo-100"
          >
            {formatBracketLabel(bracket, index, brackets, currencyUnit)}
          </span>
        ))}
      </div>
    </div>
  );
};

const SettlementFinalizeConfirmModal = ({
  draft,
  policy,
  totals,
  rows,
  currencyUnit,
  isFinalizing,
  onCancel,
  onConfirm,
}) => {
const formatSignedMoney = (value, unit = "") => `${Number(value) > 0 ? "+" : ""}${formatConfiguredAmount(value)}${unit}`;

  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatMoney = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  if (!draft) return null;

  const warnings = getPolicyWarnings(policy || {});
  const studentCount = rows.length || Number(draft.studentCount || 0);
  const netSettlement =
    Number(totals.additionalTax || 0) - Number(totals.refundAmount || 0);

  return (
    <Modal isOpen={true} onClose={onCancel} size="lg" closeOnOverlayClick={!isFinalizing}>
      <Modal.Header>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <h2 className="text-xl font-bold text-slate-800">
            월말정산 확정 전 확인
          </h2>
        </div>
      </Modal.Header>
      <Modal.Body className="space-y-5">
        <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 ring-1 ring-emerald-100">
          확정하면 환급액은 즉시 학생 자산에 지급되고, 추가납부액은 세금 고지서로 발행됩니다.
        </div>

        {warnings.length > 0 ? (
          <div className="space-y-2">
            {warnings.map((warning) => (
              <div
                key={warning}
                className="flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 ring-1 ring-amber-100"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <StatCard
            label="정산기간"
            value={`${formatDateCompact(draft.period?.startAt)} ~ ${formatDateCompact(draft.period?.endAt)}`}
            tone="indigo"
          />
          <StatCard label="대상 학생" value={`${studentCount.toLocaleString()}명`} tone="slate" />
          <StatCard
            label="환급 총액"
            value={formatMoney(totals.refundAmount, currencyUnit)}
            tone="emerald"
          />
          <StatCard
            label="추가납부 총액"
            value={formatMoney(totals.additionalTax, currencyUnit)}
            tone="red"
          />
          <StatCard
            label="결정세액"
            value={formatMoney(totals.finalTax, currencyUnit)}
            tone="slate"
          />
          <StatCard
            label="순 정산액"
            value={formatSignedMoney(netSettlement, currencyUnit)}
            tone={netSettlement > 0 ? "red" : netSettlement < 0 ? "emerald" : "slate"}
          />
        </div>

        <section className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
          <h3 className="text-sm font-black text-slate-800">확정 적용 세율</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {(policy?.taxBrackets || []).map((bracket, index, brackets) => (
              <span
                key={`finalize_bracket_${index}`}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-indigo-700 ring-1 ring-indigo-100"
              >
                {formatBracketLabel(bracket, index, brackets, currencyUnit)}
              </span>
            ))}
          </div>
        </section>
      </Modal.Body>
      <Modal.Footer>
        <Button tone="slate" kind="ghost" disabled={isFinalizing} onClick={onCancel}>
          취소
        </Button>
        <Button
          tone="emerald"
          icon={CheckCircle2}
          isLoading={isFinalizing}
          disabled={isFinalizing}
          onClick={onConfirm}
        >
          확인 후 확정
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

const ManualInput = ({ value, onChange, disabled = false, placeholder = "0" }) => (
  <input
    type="number"
    min="0"
    step="1"
    data-unstyled-input="true"
    value={value}
    disabled={disabled}
    placeholder={placeholder}
    onChange={(event) => onChange(event.target.value)}
    className="w-28 rounded-xl border border-blue-200 bg-blue-50/50 px-2.5 py-2 text-right text-xs font-bold text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-400"
  />
);

const SettlementRows = ({
  rows = [],
  currencyUnit,
  manualEdits = {},
  onManualEditChange,
  manualDisabled = false,
}) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatMoney = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">
        정산 대상 학생이 없습니다.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="max-h-[520px] overflow-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs font-black uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">학생</th>
              <th className="px-4 py-3 text-right">세전소득</th>
              <th className="px-4 py-3 text-right">비과세</th>
              <th className="px-4 py-3 text-right">소득공제</th>
              <th className="px-4 py-3 text-right">수동 소득공제</th>
              <th className="px-4 py-3 text-right">결정세액</th>
              <th className="px-4 py-3 text-right">기납부</th>
              <th className="px-4 py-3 text-right">수동 세액공제</th>
              <th className="px-4 py-3 text-left">메모</th>
              <th className="px-4 py-3 text-right">결과</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const refund = toMoney(row.refundAmount);
              const additional = toMoney(row.additionalTax);
              const resultTone =
                refund > 0 ? "text-emerald-700" : additional > 0 ? "text-red-700" : "text-slate-600";
              const resultLabel =
                refund > 0
                  ? `환급 ${formatMoney(refund, currencyUnit)}`
                  : additional > 0
                    ? `추가납부 ${formatMoney(additional, currencyUnit)}`
                    : "정산 없음";
              const edit = manualEdits[row.studentUid] || {
                incomeDeductionAmount: "0",
                taxCreditAmount: "0",
                note: "",
              };
              const updateEdit = (patch) => {
                if (!onManualEditChange) return;
                onManualEditChange(row.studentUid, patch);
              };

              return (
                <tr key={row.studentUid} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-bold text-slate-800">{row.studentName}</td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {formatMoney(row.grossIncome, currencyUnit)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {formatMoney(row.nonTaxableIncome, currencyUnit)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {formatMoney(row.incomeDeduction, currencyUnit)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ManualInput
                      value={edit.incomeDeductionAmount}
                      disabled={manualDisabled}
                      onChange={(incomeDeductionAmount) =>
                        updateEdit({ incomeDeductionAmount })
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {formatMoney(row.finalTax, currencyUnit)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {formatMoney(row.prepaidTax, currencyUnit)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ManualInput
                      value={edit.taxCreditAmount}
                      disabled={manualDisabled}
                      onChange={(taxCreditAmount) => updateEdit({ taxCreditAmount })}
                    />
                  </td>
                  <td className="px-4 py-3">
                  <input
                    type="text"
                    data-unstyled-input="true"
                    value={edit.note}
                      disabled={manualDisabled}
                      maxLength={300}
                      placeholder="사유"
                      onChange={(event) => updateEdit({ note: event.target.value })}
                      className="w-44 rounded-xl border border-blue-200 bg-blue-50/50 px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </td>
                  <td className={`px-4 py-3 text-right font-black ${resultTone}`}>
                    {resultLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SettlementHistoryList = ({ items = [], currencyUnit, isLoading }) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatMoney = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  if (isLoading) {
    return (
      <Card variant="surface" tone="white">
        <Card.Content noPadding>
          <div className="flex items-center justify-center gap-3 rounded-2xl bg-slate-50 px-4 py-10 text-slate-500">
            <Spinner size="md" />
            <span className="text-sm font-semibold">정산 내역을 불러오는 중입니다.</span>
          </div>
        </Card.Content>
      </Card>
    );
  }

  return (
    <Card variant="surface" tone="white">
      <Card.Header>
        <Card.Title className="flex items-center gap-2">
          <History className="h-5 w-5 text-indigo-600" />
          정산 내역
        </Card.Title>
        <Card.Description>
          최근 생성된 월말정산 미리보기와 확정 기록을 확인합니다.
        </Card.Description>
      </Card.Header>
      <Card.Content noPadding>
        {!items.length ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
            아직 월말정산 내역이 없습니다.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="divide-y divide-slate-100">
              {items.map((item) => {
                const statusMeta = getSettlementStatusMeta(item.status);
                const totals = item.totals || {};
                return (
                  <div
                    key={item.id}
                    className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-black text-slate-800">
                          {formatDateCompact(item.period?.startAt)} ~ {formatDateCompact(item.period?.endAt)}
                        </p>
                        <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        학생 {Number(item.studentCount || 0).toLocaleString()}명 · 소득로그 {Number(item.incomeLogCount || 0).toLocaleString()}건
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-400">환급</p>
                      <p className="text-sm font-black text-emerald-700">
                        {formatMoney(totals.refundAmount, currencyUnit)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-400">추가납부</p>
                      <p className="text-sm font-black text-red-700">
                        {formatMoney(totals.additionalTax, currencyUnit)}
                      </p>
                    </div>
                    <div className="text-xs font-semibold text-slate-400 md:text-right">
                      {item.finalizedAt
                        ? `확정 ${formatDateCompact(item.finalizedAt)}`
                        : item.cancelledAt
                          ? `취소 ${formatDateCompact(item.cancelledAt)}`
                          : item.updatedAt
                            ? `수정 ${formatDateCompact(item.updatedAt)}`
                            : "-"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card.Content>
    </Card>
  );
};

const MonthEndSettlementTab = ({
  classId,
  classData,
  currencyUnit = "단위",
  userData,
  initialSubTab = "run",
}) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatMoney = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const { showFeedback } = useFeedback();
  const classPolicy = useMemo(
    () => normalizeEditablePolicy(getMonthEndSettlementPolicy(classData)),
    [classData],
  );
  const [savedPolicy, setSavedPolicy] = useState(classPolicy);
  const [formPolicy, setFormPolicy] = useState(classPolicy);
  const [draft, setDraft] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [isLoadingDraftSummary, setIsLoadingDraftSummary] = useState(false);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [manualEdits, setManualEdits] = useState({});
  const [pendingPolicyToSave, setPendingPolicyToSave] = useState(null);
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState(initialSubTab);
  const [isAdvancedPolicyOpen, setIsAdvancedPolicyOpen] = useState(false);

  useEffect(() => {
    setSavedPolicy(classPolicy);
    setFormPolicy(classPolicy);
  }, [classPolicy]);

  const activeDraftId = savedPolicy?.activeDraftId || null;
  const hasDraft = draft?.status === "draft";
  const periodStartValue = draft?.period?.startAt || null;
  const periodEndValue = draft?.period?.endAt || null;
  const draftPolicy = useMemo(
    () => (draft?.policySnapshot ? normalizeEditablePolicy(draft.policySnapshot) : null),
    [draft?.policySnapshot],
  );
  const runPolicy = draftPolicy || savedPolicy;
  const totals = draft?.totals || {};
  const rows = useMemo(() => draft?.rows || [], [draft?.rows]);
  const isPolicyDirty = JSON.stringify(formPolicy) !== JSON.stringify(savedPolicy);
  const isPreviewStale =
    hasDraft &&
    draftPolicy &&
    JSON.stringify(comparablePolicy(draftPolicy)) !==
      JSON.stringify(comparablePolicy(savedPolicy));
  const savedManualEdits = useMemo(() => buildManualEditsFromRows(rows), [rows]);
  const isManualDirty =
    draft?.status === "draft" &&
    JSON.stringify(manualEdits) !== JSON.stringify(savedManualEdits);

  useEffect(() => {
    if (isPolicyDirty) {
      setIsAdvancedPolicyOpen(true);
    }
  }, [isPolicyDirty]);

  useEffect(() => {
    setManualEdits(buildManualEditsFromRows(rows));
  }, [rows]);


  useEffect(() => {
    if (!classId || !activeDraftId) {
      setIsLoadingDraftSummary(false);
      return;
    }
    if (draft?.draftId === activeDraftId) return;

    let ignore = false;
    setIsLoadingDraftSummary(true);
    fetchMonthEndSettlementDraft({
      classId,
      draftId: activeDraftId,
      includeRows: false,
    }).then((result) => {
      if (ignore) return;
      if (result.success) {
        setDraft((previous) => ({
          ...result,
          rows: previous?.draftId === activeDraftId ? previous.rows || [] : [],
          rowsLoaded:
            previous?.draftId === activeDraftId ? Boolean(previous.rowsLoaded) : false,
        }));
      } else {
        showFeedback(result.message || "미리보기를 불러오지 못했습니다.", "warning");
      }
      setIsLoadingDraftSummary(false);
    });

    return () => {
      ignore = true;
    };
  }, [activeDraftId, classId, draft?.draftId, showFeedback]);

  useEffect(() => {
    if (
      !classId ||
      activeSubTab !== "run" ||
      !activeDraftId
    ) {
      setIsLoadingDraft(false);
      return;
    }

    if (draft?.draftId !== activeDraftId || draft?.rowsLoaded) {
      return;
    }

    let ignore = false;
    setIsLoadingDraft(true);
    fetchMonthEndSettlementDraftRows({
      classId,
      draftId: activeDraftId,
    }).then((result) => {
      if (ignore) return;
      if (result.success) {
        setDraft((previous) => ({
          ...previous,
          rows: result.rows || [],
          rowsLoaded: true,
        }));
      } else {
        showFeedback(result.message || "미리보기 상세를 불러오지 못했습니다.", "warning");
      }
      setIsLoadingDraft(false);
    });

    return () => {
      ignore = true;
    };
  }, [
    activeDraftId,
    activeSubTab,
    classId,
    draft?.draftId,
    draft?.rowsLoaded,
    showFeedback,
  ]);

  useEffect(() => {
    if (!classId || activeSubTab !== "history") return;

    let ignore = false;
    setIsLoadingHistory(true);
    fetchMonthEndSettlementHistory({ classId }).then((result) => {
      if (ignore) return;
      if (result.success) {
        setHistoryItems(result.items || []);
      } else {
        showFeedback(result.message || "정산 내역을 불러오지 못했습니다.", "warning");
      }
      setIsLoadingHistory(false);
    });

    return () => {
      ignore = true;
    };
  }, [activeSubTab, classId, showFeedback]);

  const handleSavePolicy = () => {
    if (!classId || isSavingPolicy) return;
    const sanitizedPolicy = sanitizePolicyForSave(formPolicy);
    const validationMessage = validateTaxBrackets(sanitizedPolicy.taxBrackets);

    if (validationMessage) {
      showFeedback(validationMessage, "warning");
      return;
    }

    setPendingPolicyToSave(sanitizedPolicy);
  };

  const handleConfirmSavePolicy = async () => {
    if (!classId || isSavingPolicy || !pendingPolicyToSave) return;
    const sanitizedPolicy = pendingPolicyToSave;

    setIsSavingPolicy(true);
    try {
      await updateDoc(doc(db, "classes", classId), {
        "taxPolicy.monthEndSettlement": sanitizedPolicy,
        "taxPolicy.updatedAt": serverTimestamp(),
        "taxPolicy.updatedBy": userData?.uid || null,
      });
      const nextPolicy = normalizeEditablePolicy(sanitizedPolicy);
      setSavedPolicy(nextPolicy);
      setFormPolicy(nextPolicy);
      setPendingPolicyToSave(null);
      showFeedback(
        activeDraftId
          ? "월말정산 정책을 저장했습니다. 미리보기를 다시 계산해 주세요."
          : "월말정산 정책을 저장했습니다.",
        "success",
      );
    } catch (error) {
      console.error("Failed to save month-end settlement policy:", error);
      showFeedback(error?.message || "정책 저장에 실패했습니다.", "error");
    } finally {
      setIsSavingPolicy(false);
    }
  };

  const handleManualEditChange = (studentUid, patch) => {
    setManualEdits((previous) => ({
      ...previous,
      [studentUid]: {
        ...(previous[studentUid] || {
          incomeDeductionAmount: "0",
          taxCreditAmount: "0",
          note: "",
        }),
        ...patch,
      },
    }));
  };

  const handleSaveManualAdjustments = async () => {
    if (!classId || !draft?.draftId || isSavingManual || draft.status !== "draft") return;

    setIsSavingManual(true);
    const result = await updateMonthEndSettlementManualAdjustments({
      classId,
      draftId: draft.draftId,
      adjustments: Object.entries(manualEdits).map(([studentUid, edit]) => ({
        studentUid,
        incomeDeductionAmount: edit.incomeDeductionAmount,
        taxCreditAmount: edit.taxCreditAmount,
        note: edit.note,
      })),
    });
    setIsSavingManual(false);

    if (!result.success) {
      showFeedback(result.message || "수동 공제 저장에 실패했습니다.", "error");
      return;
    }

    setDraft((previous) => ({
      ...previous,
      totals: result.totals,
      rows: result.rows || previous.rows,
      rowsLoaded: true,
    }));
    setManualEdits(buildManualEditsFromRows(result.rows || rows));
    showFeedback("수동 공제를 반영했습니다.", "success");
  };

  const handleGenerate = async () => {
    if (!classId || isGenerating) return;
    if (isPolicyDirty) {
      showFeedback("정책 변경사항을 먼저 저장해 주세요.", "warning");
      return;
    }
    if (isManualDirty) {
      showFeedback("수동 공제 변경사항을 먼저 저장해 주세요.", "warning");
      return;
    }

    setIsGenerating(true);
    const result = await generateMonthEndSettlementDraft({ classId });
    setIsGenerating(false);

    if (!result.success) {
      showFeedback(result.message || "월말정산 미리보기 생성에 실패했습니다.", "error");
      return;
    }

    setDraft({ ...result, rowsLoaded: true });
    setSavedPolicy((previous) => ({
      ...previous,
      activeDraftId: result.draftId,
      lockedPeriodEndAt: result.period?.endAt || previous.lockedPeriodEndAt,
    }));
    setFormPolicy((previous) => ({
      ...previous,
      activeDraftId: result.draftId,
      lockedPeriodEndAt: result.period?.endAt || previous.lockedPeriodEndAt,
    }));
    showFeedback(
      result.recalculated ? "현재 정책으로 미리보기를 다시 계산했습니다." : "월말정산 미리보기를 생성했습니다.",
      "success",
    );
  };

  const handleFinalize = () => {
    if (!classId || !draft?.draftId || isFinalizing) return;
    if (isPolicyDirty) {
      showFeedback("정책 변경사항을 먼저 저장해 주세요.", "warning");
      return;
    }
    if (isPreviewStale) {
      showFeedback("저장된 정책이 미리보기에 아직 반영되지 않았습니다. 다시 계산해 주세요.", "warning");
      return;
    }
    if (isManualDirty) {
      showFeedback("수동 공제 변경사항을 먼저 저장해 주세요.", "warning");
      return;
    }
    setShowFinalizeConfirm(true);
  };

  const handleConfirmFinalize = async () => {
    if (!classId || !draft?.draftId || isFinalizing) return;

    setIsFinalizing(true);
    const result = await finalizeMonthEndSettlementDraft({
      classId,
      draftId: draft.draftId,
    });
    setIsFinalizing(false);

    if (!result.success) {
      showFeedback(result.message || "월말정산 확정에 실패했습니다.", "error");
      return;
    }

    setDraft((previous) => ({
      ...previous,
      status: "finalized",
      refundCount: result.refundCount,
      taxBillCount: result.taxBillCount,
    }));
    setSavedPolicy((previous) => ({
      ...previous,
      lastClosedAt: draft.period?.endAt || previous.lastClosedAt,
      activeDraftId: null,
      lockedPeriodEndAt: null,
    }));
    setFormPolicy((previous) => ({
      ...previous,
      lastClosedAt: draft.period?.endAt || previous.lastClosedAt,
      activeDraftId: null,
      lockedPeriodEndAt: null,
    }));
    setShowFinalizeConfirm(false);
    showFeedback("월말정산을 확정했습니다.", "success");
  };

  const handleCancelDraft = async () => {
    if (!classId || !draft?.draftId || draft.status !== "draft" || isCancelling) return;
    const confirmed = (await appConfirm(
      "이 월말정산 미리보기를 취소할까요? 기간 잠금이 풀리고 새 미리보기를 다시 만들 수 있습니다.",
    ));
    if (!confirmed) return;

    setIsCancelling(true);
    const result = await cancelMonthEndSettlementDraft({
      classId,
      draftId: draft.draftId,
      reason: "teacher_cancelled",
    });
    setIsCancelling(false);

    if (!result.success) {
      showFeedback(result.message || "미리보기 취소에 실패했습니다.", "error");
      return;
    }

    setDraft(null);
    setManualEdits({});
    setSavedPolicy((previous) => ({
      ...previous,
      activeDraftId: null,
      lockedPeriodEndAt: null,
    }));
    setFormPolicy((previous) => ({
      ...previous,
      activeDraftId: null,
      lockedPeriodEndAt: null,
    }));
    showFeedback("월말정산 미리보기를 취소했습니다.", "success");
  };

  const subTabs = [
    {
      key: "policy",
      label: "공제·누진세 설정",
    },
    {
      key: "run",
      label: "월말정산 실행",
    },
    {
      key: "history",
      label: "정산 기록",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto">
        <div className="inline-flex min-w-full rounded-2xl bg-white p-1 ring-1 ring-slate-200 sm:min-w-0">
          {subTabs.map((tab) => {
            const selected = activeSubTab === tab.key;
            return (
              <Button
                key={tab.key}
                type="button"
                onClick={() => setActiveSubTab(tab.key)}
                tone="blue"
                kind={selected ? "solid" : "ghost"}
                size="sm"
                rounded="xl"
                className={`flex min-w-[150px] items-center justify-center gap-2 transition  ${
                  selected
                    ? "bg-indigo-600 text-white"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                }`}
              >
                {tab.label}
              </Button>
            );
          })}
        </div>
      </div>

      {activeSubTab === "policy" ? (
        <>
          {activeDraftId && draft?.status !== "finalized" ? (
            <div className="flex items-center gap-2 rounded-2xl bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100">
              <AlertCircle className="h-4 w-4" />
              정산기간은 고정되어 있지만 정책은 확정 전까지 수정할 수 있습니다. 저장 후 미리보기/확정 탭에서 다시 계산해 주세요.
            </div>
          ) : null}
          <Card variant="surface" tone="white">
            <Card.Header>
              <Card.Title>공제·누진세 설정</Card.Title>
              <Card.Description>
                기본 운영에서는 현재 정책만 확인하면 됩니다. 비과세·공제·세율을 직접
                설계할 때만 고급 정책 설정을 여세요.
              </Card.Description>
            </Card.Header>
            <Card.Content noPadding className="space-y-4">
              <PolicySummaryPanel policy={formPolicy} currencyUnit={currencyUnit} />
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-black text-slate-800">고급 정책 설정</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    비과세 그룹, 소득공제, 소득별 세율과 세액공제를 세부 조정합니다.
                  </p>
                </div>
                <Button
                  type="button"
                  tone="blue"
                  kind="outline"
                  size="sm"
                  icon={ChevronRight}
                  onClick={() => setIsAdvancedPolicyOpen((current) => !current)}
                  disabled={isPolicyDirty}
                >
                  {isAdvancedPolicyOpen ? "고급 설정 접기" : "고급 설정 열기"}
                </Button>
              </div>
            </Card.Content>
          </Card>
          {isAdvancedPolicyOpen || isPolicyDirty ? (
            <PolicySettings
              policy={formPolicy}
              setPolicy={setFormPolicy}
              currencyUnit={currencyUnit}
              disabled={false}
              isDirty={isPolicyDirty}
              isSaving={isSavingPolicy}
              onReset={() => setFormPolicy(savedPolicy)}
              onSave={handleSavePolicy}
            />
          ) : null}
        </>
      ) : null}

      {activeSubTab === "run" ? (
      <Card variant="surface" tone="white">
        <Card.Header>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Card.Title className="flex items-center gap-2">
              <ReceiptText className="h-5 w-5 text-indigo-600" />
              월말정산 실행
            </Card.Title>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                tone="blue"
                icon={FileSearch}
                onClick={handleGenerate}
                isLoading={isGenerating}
                disabled={
                  !classId ||
                  isGenerating ||
                  isFinalizing ||
                  isPolicyDirty ||
                  isManualDirty ||
                  draft?.status === "finalized"
                }
              >
                {activeDraftId ? "결과 다시 계산" : "학생별 결과 미리보기"}
              </Button>
              {draft?.status === "draft" ? (
                <Button
                  size="sm"
                  tone="blue"
                  icon={Save}
                  isLoading={isSavingManual}
                  disabled={!isManualDirty || isSavingManual}
                  onClick={handleSaveManualAdjustments}
                >
                  수동 공제 저장
                </Button>
              ) : null}
              <Button
                size="sm"
                tone="emerald"
                icon={CheckCircle2}
                onClick={handleFinalize}
                isLoading={isFinalizing}
                disabled={
                  !draft?.draftId ||
                  draft?.status === "finalized" ||
                  isFinalizing ||
                  isSavingManual ||
                  isPolicyDirty ||
                  isPreviewStale ||
                  isManualDirty
                }
              >
                환급·추가납부 확정
              </Button>
              {draft?.status === "draft" ? (
                <Button
                  size="sm"
                  tone="red"
                  kind="outline"
                  icon={XCircle}
                  onClick={handleCancelDraft}
                  isLoading={isCancelling}
                  disabled={isCancelling || isFinalizing || isSavingManual}
                >
                  취소
                </Button>
              ) : null}
            </div>
          </div>
        </Card.Header>
        <Card.Content noPadding className="space-y-4">
          <PolicySummaryPanel policy={runPolicy} currencyUnit={currencyUnit} />

          {activeDraftId ? (
            <div className="flex flex-col gap-2 rounded-2xl bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  정산기간 고정: {formatDateCompact(draft?.period?.startAt || periodStartValue)} ~ {formatDateCompact(draft?.period?.endAt || periodEndValue)}
                </span>
              </div>
              <span className="text-xs font-bold text-indigo-600">
                연결 대상 변경은 미리보기 취소 후 다시 생성
              </span>
            </div>
          ) : (
            <div className="rounded-2xl bg-indigo-50 px-4 py-4 ring-1 ring-indigo-100">
              <p className="text-sm font-black text-indigo-900">
                정산 대상 기간
              </p>
              <p className="mt-1 text-xs leading-5 text-indigo-700">
                자동으로 국고에 집계된 기록 중 아직 월말정산에 사용하지 않은 기간을 연결합니다.
              </p>
            </div>
          )}
          {isPolicyDirty ? (
            <div className="flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-100">
              <AlertCircle className="h-4 w-4" />
              공제·누진세 설정의 변경사항을 저장해야 미리보기를 계산할 수 있습니다.
            </div>
          ) : null}
          {isLoadingDraftSummary && !draft ? (
            <div className="flex items-center justify-center gap-3 rounded-2xl bg-slate-50 px-4 py-10 text-slate-500">
              <Spinner size="md" />
              <span className="text-sm font-semibold">미리보기 요약을 불러오는 중입니다.</span>
            </div>
          ) : draft ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="세전 총소득"
                  value={formatMoney(totals.grossIncome, currencyUnit)}
                  tone="indigo"
                />
                <StatCard
                  label="결정세액"
                  value={formatMoney(totals.finalTax, currencyUnit)}
                  tone="slate"
                />
                <StatCard
                  label="이미 낸 세금"
                  value={formatMoney(totals.prepaidTax, currencyUnit)}
                  tone="amber"
                />
                <StatCard
                  label="환급 / 추가납부"
                  value={`${formatMoney(totals.refundAmount, currencyUnit)} / ${formatMoney(
                    totals.additionalTax,
                    currencyUnit,
                  )}`}
                  tone={
                    toMoney(totals.refundAmount) >= toMoney(totals.additionalTax)
                      ? "emerald"
                      : "red"
                  }
                />
              </div>
              {isPreviewStale ? (
                <div className="flex items-center gap-2 rounded-2xl bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100">
                  <AlertCircle className="h-4 w-4" />
                  저장된 정책이 아직 이 결과에 반영되지 않았습니다. 미리보기를 다시 계산해 주세요.
                </div>
              ) : null}
              {isManualDirty ? (
                <div className="flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-100">
                  <AlertCircle className="h-4 w-4" />
                  수동 공제 변경사항을 저장해야 정산을 확정할 수 있습니다.
                </div>
              ) : null}
              {isLoadingDraft ? (
                <div className="flex items-center justify-center gap-3 rounded-2xl bg-slate-50 px-4 py-10 text-slate-500">
                  <Spinner size="md" />
                  <span className="text-sm font-semibold">학생별 상세를 불러오는 중입니다.</span>
                </div>
              ) : (
                <SettlementRows
                  rows={rows}
                  currencyUnit={currencyUnit}
                  manualEdits={manualEdits}
                  onManualEditChange={handleManualEditChange}
                  manualDisabled={draft.status !== "draft" || isSavingManual}
                />
              )}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
              아직 생성된 월말정산 미리보기가 없습니다.
            </div>
          )}
        </Card.Content>
      </Card>
      ) : null}

      {activeSubTab === "history" ? (
        <SettlementHistoryList
          items={historyItems}
          currencyUnit={currencyUnit}
          isLoading={isLoadingHistory}
        />
      ) : null}

      {pendingPolicyToSave ? (
        <PolicySaveConfirmModal
          policy={pendingPolicyToSave}
          currencyUnit={currencyUnit}
          isSaving={isSavingPolicy}
          onCancel={() => {
            if (!isSavingPolicy) setPendingPolicyToSave(null);
          }}
          onConfirm={handleConfirmSavePolicy}
        />
      ) : null}

      {showFinalizeConfirm ? (
        <SettlementFinalizeConfirmModal
          draft={draft}
          policy={runPolicy}
          totals={totals}
          rows={rows}
          currencyUnit={currencyUnit}
          isFinalizing={isFinalizing}
          onCancel={() => {
            if (!isFinalizing) setShowFinalizeConfirm(false);
          }}
          onConfirm={handleConfirmFinalize}
        />
      ) : null}
    </div>
  );
};

export default MonthEndSettlementTab;
