import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import {
  Alert,
  Button,
  InputField,
  Modal,
  SelectField,
  TextAreaField,
} from "../../../components/ui";
import { formatPercentValue, formatTrimmedNumber } from "../utils/displayFormat";
import { buildEqualWeightPercentages } from "../utils/holdingWeights";
import { formatReportCycleLabel } from "../utils/reportCycle";
import useFundRiskPreview from "../hooks/useFundRiskPreview";
import FundRiskSummary from "../components/FundRiskSummary";

const MAX_HOLDINGS_COUNT = 12;
const INPUT_CLASSNAME =
  "min-h-[52px] rounded-xl border-2 border-slate-200 px-4 text-sm shadow-none";
const TEXTAREA_CLASSNAME =
  "rounded-xl border-2 border-slate-200 px-4 py-3 text-sm shadow-none";

const DEFAULT_FEE_PRESETS = [
  { id: "free", label: "무료형", bps: 0 },
  { id: "basic", label: "기본형", bps: 100 },
  { id: "active", label: "적극운용형", bps: 200 },
];

const APPLICATION_STEPS = [
  { id: "intro", label: "펀드 소개" },
  { id: "plan", label: "운용 방법" },
  { id: "holdings", label: "종목과 비중" },
  { id: "review", label: "제출 전 확인" },
];

const createHolding = (holding = {}) => ({
  symbol: holding.symbol || "",
  weightPct:
    holding.weightPct !== undefined && holding.weightPct !== null
      ? String(holding.weightPct)
      : "",
});

function getFeeDisplayLabel(preset) {
  return `${preset.label} (연 ${formatPercentValue(Number(preset.bps || 0) / 100, 2)})`;
}

function toHoldingDrafts(holdings = []) {
  return holdings.map((holding) =>
    createHolding({
      symbol: holding?.symbol || "",
      weightPct:
        holding?.weightPct ??
        formatTrimmedNumber((Number(holding?.weightBps) || 0) / 100, 1),
    }),
  );
}

function buildInitialForm({
  initialValue,
  feePresets,
  minHoldingsCount,
}) {
  const initialHoldings = toHoldingDrafts(initialValue?.holdings || []);
  const rowCount = Math.max(
    minHoldingsCount,
    Math.min(MAX_HOLDINGS_COUNT, initialHoldings.length || 0),
  );
  const holdings = [...initialHoldings];

  while (holdings.length < rowCount) {
    holdings.push(createHolding());
  }

  const presetValues = new Set(feePresets.map((preset) => Number(preset.bps)));
  const hasStoredAnnualFee = initialValue?.managementFeeBpsAnnual != null;
  const hasLegacyWeeklyFee = initialValue?.managementFeeBpsWeekly != null;
  const storedAnnualFee = Number(initialValue?.managementFeeBpsAnnual);
  const legacyWeeklyFee = Number(initialValue?.managementFeeBpsWeekly || 0);
  const legacyAnnualFee = legacyWeeklyFee <= 0 ? 0 : legacyWeeklyFee <= 10 ? 100 : 200;
  const initialFee = hasStoredAnnualFee && presetValues.has(storedAnnualFee)
    ? storedAnnualFee
    : hasLegacyWeeklyFee && presetValues.has(legacyAnnualFee)
      ? legacyAnnualFee
      : 100;

  return {
    fundName: initialValue?.fundName || "",
    summary: initialValue?.summary || "",
    strategy: initialValue?.strategy || "",
    minInvestmentUSD: String(initialValue?.minInvestmentUSD ?? 50),
    managementFeeBpsAnnual: String(initialFee),
    holdings,
  };
}

export default function FundApplicationModal({
  isOpen,
  onClose,
  onSubmit,
  availableSymbols = [],
  isSubmitting = false,
  currencyUnit = "FIN",
  fundSettings = {},
  initialValue = null,
  classId = null,
}) {
  const [form, setForm] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [activeStep, setActiveStep] = useState(0);

  const feePresets = DEFAULT_FEE_PRESETS;
  const reportCycleLabel = formatReportCycleLabel(fundSettings);
  const minHoldingsCount = Math.min(
    MAX_HOLDINGS_COUNT,
    Math.max(1, Number(fundSettings?.fundMinHoldingsCount ?? 3)),
  );
  const maxSingleWeightPct = Math.min(
    100,
    Math.max(1, (Number(fundSettings?.fundMaxSingleWeightBps ?? 4000) || 4000) / 100),
  );

  useEffect(() => {
    if (!isOpen) return;

    setForm(
      buildInitialForm({
        initialValue,
        feePresets,
        minHoldingsCount,
      }),
    );
    setErrorMessage("");
    setFieldErrors({});
    setActiveStep(0);
  }, [isOpen, initialValue, feePresets, minHoldingsCount]);

  const symbolOptions = useMemo(
    () => [
      { value: "", label: "종목 선택" },
      ...availableSymbols.map((item) => ({
        value: item.symbol,
        label: `${item.symbol} - ${item.companyName || item.symbol}`,
      })),
    ],
    [availableSymbols],
  );

  const feeOptions = useMemo(
    () =>
      feePresets.map((preset) => ({
        value: String(preset.bps),
        label: getFeeDisplayLabel(preset),
      })),
    [feePresets],
  );
  const totalWeightPct = useMemo(() => {
    if (!form) return 0;
    return form.holdings.reduce((sum, item) => sum + (Number(item.weightPct) || 0), 0);
  }, [form]);
  const previewHoldings = useMemo(
    () => (form?.holdings || []).map((holding) => ({
      symbol: holding.symbol,
      weightBps: Math.round((Number(holding.weightPct) || 0) * 100),
    })),
    [form?.holdings],
  );
  const riskPreview = useFundRiskPreview(classId, previewHoldings, { enabled: isOpen });

  if (!isOpen || !form) return null;

  const handleChange = (field) => (event) => {
    const value = event?.target?.value ?? "";
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: "" }));
    setErrorMessage("");
  };

  const handleHoldingChange = (index, field) => (event) => {
    const value = event?.target?.value ?? "";
    setForm((prev) => ({
      ...prev,
      holdings: prev.holdings.map((holding, holdingIndex) =>
        holdingIndex === index ? { ...holding, [field]: value } : holding,
      ),
    }));
    setErrorMessage("");
  };

  const focusField = (id) => {
    const schedule = window.requestAnimationFrame || window.setTimeout;
    schedule(() => {
      const target = document.getElementById(id);
      target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      target?.focus?.();
    });
  };

  const validateIntro = () => {
    const errors = {};
    if (String(form.fundName || "").trim().length < 2) {
      errors.fundName = "펀드 이름을 2자 이상 적어 주세요.";
    }
    if (!String(form.summary || "").trim()) {
      errors.summary = "어떤 회사에 투자하는 펀드인지 한 문장으로 적어 주세요.";
    }
    setFieldErrors((prev) => ({ ...prev, ...errors }));
    if (Object.keys(errors).length > 0) {
      setErrorMessage("작성하지 않은 항목을 확인해 주세요.");
      focusField(errors.fundName ? "fundName" : "summary");
      return false;
    }
    return true;
  };

  const validatePlan = () => {
    const errors = {};
    if (String(form.strategy || "").trim().length < 10) {
      errors.strategy = "고른 이유와 앞으로의 운용 방법을 10자 이상 적어 주세요.";
    }
    if (Number(form.minInvestmentUSD) < 10) {
      errors.minInvestmentUSD = "최소 가입금액은 10 FIN 이상이어야 합니다.";
    }
    setFieldErrors((prev) => ({ ...prev, ...errors }));
    if (Object.keys(errors).length > 0) {
      setErrorMessage("작성하지 않은 항목을 확인해 주세요.");
      focusField(errors.strategy ? "strategy" : "minInvestmentUSD");
      return false;
    }
    return true;
  };

  const getNormalizedHoldings = () => form.holdings
    .map((item) => ({
      symbol: String(item.symbol || "").trim().toUpperCase(),
      weightPct: Number(item.weightPct) || 0,
    }))
    .filter((item) => item.symbol && item.weightPct > 0);

  const validateHoldings = () => {
    const normalizedHoldings = getNormalizedHoldings();
    const uniqueSymbols = new Set(normalizedHoldings.map((item) => item.symbol));
    let message = "";

    if (normalizedHoldings.length < minHoldingsCount) {
      message = `종목을 최소 ${minHoldingsCount}개 골라 주세요.`;
    } else if (normalizedHoldings.length > MAX_HOLDINGS_COUNT) {
      message = `종목은 최대 ${MAX_HOLDINGS_COUNT}개까지 고를 수 있습니다.`;
    } else if (uniqueSymbols.size !== normalizedHoldings.length) {
      message = "같은 종목은 한 번만 선택할 수 있습니다.";
    } else if (normalizedHoldings.some((item) => item.weightPct > maxSingleWeightPct)) {
      message = `한 종목에는 최대 ${maxSingleWeightPct}%까지 배분할 수 있습니다.`;
    } else if (Math.round(totalWeightPct * 10) / 10 !== 100) {
      message = "비중 합계가 100%가 되도록 맞춰 주세요.";
    }

    setErrorMessage(message);
    if (message) {
      focusField("holding-symbol-0");
      return false;
    }
    return true;
  };

  const moveToNextStep = () => {
    const isValid = activeStep === 0
      ? validateIntro()
      : activeStep === 1
        ? validatePlan()
        : activeStep === 2
          ? validateHoldings()
          : true;
    if (!isValid) return;
    setErrorMessage("");
    setActiveStep((step) => Math.min(APPLICATION_STEPS.length - 1, step + 1));
  };

  const handleAddHolding = () => {
    setForm((prev) => ({
      ...prev,
      holdings: [...prev.holdings, createHolding()],
    }));
  };

  const handleRemoveHolding = (index) => {
    setForm((prev) => ({
      ...prev,
      holdings: prev.holdings.filter((_, holdingIndex) => holdingIndex !== index),
    }));
    setErrorMessage("");
  };

  const handleEqualWeight = () => {
    const selectedIndices = form.holdings.reduce((indices, holding, index) => {
      if (holding.symbol) indices.push(index);
      return indices;
    }, []);
    if (selectedIndices.length === 0) {
      setErrorMessage("먼저 편입할 종목을 선택해 주세요.");
      return;
    }

    const weights = buildEqualWeightPercentages(
      selectedIndices.length,
      maxSingleWeightPct,
    );
    if (!weights) {
      const requiredCount = Math.ceil(100 / maxSingleWeightPct);
      setErrorMessage(
        `종목당 최대 ${maxSingleWeightPct}% 규칙에 맞추려면 최소 ${requiredCount}개 종목을 선택해야 합니다.`,
      );
      return;
    }

    const weightByIndex = new Map(
      selectedIndices.map((holdingIndex, selectedIndex) => [
        holdingIndex,
        weights[selectedIndex],
      ]),
    );
    setForm((prev) => ({
      ...prev,
      holdings: prev.holdings.map((holding, index) => ({
        ...holding,
        weightPct: weightByIndex.get(index) || "",
      })),
    }));
    setErrorMessage("");
  };

  const getOptionsForIndex = (index) => {
    const selectedByOthers = new Set(
      form.holdings
        .filter((_, holdingIndex) => holdingIndex !== index)
        .map((holding) => holding.symbol)
        .filter(Boolean),
    );

    return symbolOptions.map((option) => ({
      ...option,
      disabled:
        !!option.value &&
        selectedByOthers.has(option.value) &&
        form.holdings[index]?.symbol !== option.value,
    }));
  };

  const handleSubmit = async () => {
    if (!validateIntro()) {
      setActiveStep(0);
      return;
    }
    if (!validatePlan()) {
      setActiveStep(1);
      return;
    }
    if (!validateHoldings()) {
      setActiveStep(2);
      return;
    }

    const normalizedHoldings = getNormalizedHoldings();

    const payload = {
      fundName: form.fundName,
      summary: form.summary,
      strategy: form.strategy,
      minInvestmentUSD: Number(form.minInvestmentUSD) || 0,
      managementFeeBpsAnnual: Math.round(Number(form.managementFeeBpsAnnual) || 0),
      holdings: normalizedHoldings.map((item) => ({
        symbol: item.symbol,
        weightBps: Math.round(item.weightPct * 100),
      })),
      resubmittedFromApplicationId:
        initialValue?.status === "rejected" ? initialValue.id : null,
    };

    try {
      const result = await onSubmit?.(payload);
      if (result?.success === false) {
        setErrorMessage(result.message || "신청서 제출에 실패했습니다.");
        return;
      }
      onClose?.();
    } catch (error) {
      setErrorMessage(error?.message || "신청서를 제출하는 중 오류가 발생했습니다.");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" title="펀드 개설 신청">
      <div className="space-y-5">
        {initialValue?.status === "rejected" ? (
          <Alert
            type="warning"
            message={`승인되지 않은 신청서를 수정하고 있어요.${initialValue.reviewNote ? ` 반려 사유: ${initialValue.reviewNote}` : ""}`}
          />
        ) : null}

        <ol className="grid grid-cols-4 gap-2" aria-label="신청 단계">
          {APPLICATION_STEPS.map((step, index) => {
            const isCurrent = index === activeStep;
            const isComplete = index < activeStep;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => index < activeStep && setActiveStep(index)}
                  disabled={index > activeStep}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-bold transition sm:text-sm ${
                    isCurrent
                      ? "bg-indigo-600 text-white"
                      : isComplete
                        ? "bg-indigo-50 text-indigo-700"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    isCurrent ? "bg-white/20" : "bg-white"
                  }`}>
                    {isComplete ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <span className="hidden sm:inline">{step.label}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {activeStep === 0 ? (
          <section className="space-y-5" aria-labelledby="application-step-intro">
            <div>
              <h4 id="application-step-intro" className="text-xl font-extrabold text-slate-900">
                내 펀드를 소개해 주세요
              </h4>
              <p className="mt-1 text-sm text-slate-500">
                멋진 설명보다 어떤 생각으로 만든 펀드인지 알기 쉽게 적으면 됩니다.
              </p>
            </div>
            <InputField
              id="fundName"
              label="펀드 이름"
              required
              value={form.fundName}
              onChange={handleChange("fundName")}
              placeholder="예: 미래성장 1호"
              error={fieldErrors.fundName}
              className={INPUT_CLASSNAME}
            />
            <TextAreaField
              id="summary"
              label="어떤 회사에 투자하는 펀드인가요?"
              required
              value={form.summary}
              onChange={handleChange("summary")}
              rows={3}
              placeholder="예: 앞으로 성장할 기술 회사를 모아 투자하는 펀드예요."
              error={fieldErrors.summary}
              className={TEXTAREA_CLASSNAME}
            />
          </section>
        ) : null}

        {activeStep === 1 ? (
          <section className="space-y-5" aria-labelledby="application-step-plan">
            <div>
              <h4 id="application-step-plan" className="text-xl font-extrabold text-slate-900">
                어떻게 운용할까요?
              </h4>
              <p className="mt-1 text-sm text-slate-500">
                회사를 고른 이유와 언제 유지하거나 바꿀지 차례대로 생각해 보세요.
              </p>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="생각할 내용">
              {["왜 골랐나요?", "무엇을 확인할까요?", "언제 바꿀까요?"].map((label) => (
                <span key={label} className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">
                  {label}
                </span>
              ))}
            </div>
            <TextAreaField
              id="strategy"
              label="나의 운용 방법"
              required
              value={form.strategy}
              onChange={handleChange("strategy")}
              rows={6}
              placeholder="예: 실적이 꾸준히 좋아지는 회사를 고르고, 회사 뉴스와 주가를 매주 확인할 거예요. 성장이 멈추면 다른 회사를 찾아볼 거예요."
              error={fieldErrors.strategy}
              className={TEXTAREA_CLASSNAME}
            />
            <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
              <InputField
                id="minInvestmentUSD"
                label={`한 사람이 투자할 최소 금액 (${currencyUnit})`}
                type="number"
                min="10"
                step="1"
                value={form.minInvestmentUSD}
                onChange={handleChange("minInvestmentUSD")}
                hint="10 FIN 이상으로 정해 주세요."
                error={fieldErrors.minInvestmentUSD}
                className={INPUT_CLASSNAME}
              />
              <SelectField
                id="managementFeeBpsAnnual"
                label="1년 운용보수"
                value={form.managementFeeBpsAnnual}
                onChange={handleChange("managementFeeBpsAnnual")}
                options={feeOptions}
                className="min-h-[52px]"
              />
            </div>
          </section>
        ) : null}

        {activeStep === 2 ? (
          <section className="space-y-4" aria-labelledby="application-step-holdings">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 id="application-step-holdings" className="text-xl font-extrabold text-slate-900">
                  종목과 비중을 정해 주세요
                </h4>
                <p className="mt-1 text-sm text-slate-500">
                  100 FIN을 투자한다면 각 회사에 얼마씩 나눌지 정해 보세요.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  tone="blue"
                  kind="soft"
                  size="sm"
                  icon={Sparkles}
                  onClick={handleEqualWeight}
                >
                  똑같이 나누기
                </Button>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-right">
                  <p className="text-[11px] font-bold text-slate-400">합계</p>
                  <p className={`text-lg font-extrabold tabular-nums ${
                    Math.round(totalWeightPct * 10) / 10 === 100
                      ? "text-emerald-600"
                      : "text-rose-500"
                  }`}>
                    {formatPercentValue(totalWeightPct, 1)}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600">
              <span>최소 {minHoldingsCount}종목</span>
              <span aria-hidden="true">·</span>
              <span>한 종목 최대 {maxSingleWeightPct}%</span>
              <span aria-hidden="true">·</span>
              <span>합계 100%</span>
            </div>

            <div className="space-y-3">
              {form.holdings.map((holding, index) => (
                <div
                  key={`holding-${index}`}
                  className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[1fr_140px_auto]"
                >
                  <SelectField
                    id={`holding-symbol-${index}`}
                    label={`종목 ${index + 1}`}
                    value={holding.symbol}
                    onChange={handleHoldingChange(index, "symbol")}
                    options={getOptionsForIndex(index)}
                    placeholder="회사 선택"
                    searchable
                    searchPlaceholder="티커 또는 회사명을 검색해 보세요"
                    className="min-h-[52px]"
                  />
                  <InputField
                    id={`holding-weight-${index}`}
                    label="나눌 비중 (%)"
                    type="number"
                    min="0"
                    max={String(maxSingleWeightPct)}
                    step="0.1"
                    value={holding.weightPct}
                    onChange={handleHoldingChange(index, "weightPct")}
                    placeholder={`최대 ${maxSingleWeightPct}`}
                    className={INPUT_CLASSNAME}
                  />
                  <div className="flex items-end">
                    <Button
                      tone="red"
                      kind="soft"
                      size="sm"
                      onClick={() => handleRemoveHolding(index)}
                      disabled={form.holdings.length <= minHoldingsCount}
                      icon={Trash2}
                      className="w-full justify-center"
                    >
                      제거
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <Button
                tone="blue"
                kind="outline"
                size="sm"
                onClick={handleAddHolding}
                icon={Plus}
                disabled={form.holdings.length >= MAX_HOLDINGS_COUNT}
              >
                종목 추가
              </Button>
            </div>

            {form.holdings.some((holding) => holding.symbol) ? (
              <FundRiskSummary risk={riskPreview.data} isLoading={riskPreview.isLoading} />
            ) : null}
          </section>
        ) : null}

        {activeStep === 3 ? (
          <section className="space-y-4" aria-labelledby="application-step-review">
            <div>
              <h4 id="application-step-review" className="text-xl font-extrabold text-slate-900">
                제출 전에 확인해 주세요
              </h4>
              <p className="mt-1 text-sm text-slate-500">
                선생님은 아래 내용을 보고 펀드 개설 여부를 확인합니다.
              </p>
            </div>
            <dl className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-5">
              {[
                ["펀드 이름", form.fundName],
                ["펀드 소개", form.summary],
                ["운용 방법", form.strategy],
                ["종목 구성", getNormalizedHoldings().map((holding) => `${holding.symbol} ${formatPercentValue(holding.weightPct, 1)}`).join(" · ")],
                ["최소 가입금액", `${form.minInvestmentUSD} ${currencyUnit}`],
                ["운용보수", getFeeDisplayLabel(feePresets.find((preset) => String(preset.bps) === form.managementFeeBpsAnnual) || feePresets[1])],
                ["보고서 제출", reportCycleLabel],
              ].map(([label, value]) => (
                <div key={label} className="grid gap-1 py-3 text-sm sm:grid-cols-[130px_1fr] sm:gap-4">
                  <dt className="font-bold text-slate-500">{label}</dt>
                  <dd className="whitespace-pre-wrap font-semibold text-slate-900">{value || "-"}</dd>
                </div>
              ))}
            </dl>
            <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm leading-6 text-blue-900">
              성과는 <strong>SPY</strong>와 <strong>QQQ</strong>를 기준으로 자동 비교합니다. 제출 뒤에는 선생님의 심사를 기다려 주세요.
            </div>
          </section>
        ) : null}

        {errorMessage ? <Alert type="error" message={errorMessage} /> : null}

        <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-3 border-t border-slate-100 bg-white/95 px-1 pt-4 backdrop-blur">
          <Button tone="slate" kind="soft" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <div className="flex gap-2">
            {activeStep > 0 ? (
              <Button
                tone="slate"
                kind="outline"
                onClick={() => {
                  setErrorMessage("");
                  setActiveStep((step) => Math.max(0, step - 1));
                }}
                icon={ChevronLeft}
                disabled={isSubmitting}
              >
                이전
              </Button>
            ) : null}
            {activeStep < APPLICATION_STEPS.length - 1 ? (
              <Button tone="blue" kind="solid" onClick={moveToNextStep} icon={ChevronRight}>
                다음
              </Button>
            ) : (
              <Button tone="blue" kind="solid" onClick={handleSubmit} isLoading={isSubmitting}>
                신청서 제출
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
