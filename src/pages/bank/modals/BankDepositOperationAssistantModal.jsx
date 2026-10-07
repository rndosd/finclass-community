import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Calculator,
  Coins,
  Landmark,
  RefreshCw,
  Sparkles,
  Users,
  WalletCards,
} from "lucide-react";
import { Button, Modal, ToggleSwitch } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { formatBankMoney } from "../../../utils/bankMoney";
import { createBankProduct } from "../services/bankProductService";
import {
  getBankDepositDecisionContext,
  previewBankDepositProductDecision,
} from "../services/bankDecisionSupportService";

const toWholeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
};

const toRate = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
};

const formatRatio = (ratio) => {
  if (ratio == null || !Number.isFinite(Number(ratio))) return "-";
  return `${Math.round(Number(ratio) * 1000) / 10}%`;
};

const formatRange = (range, unit = "") => {
  if (!range) return "-";
  const min = Number(range.min || 0);
  const max = Number(range.max || 0);
  if (min === max) return `${formatBankMoney(min)}${unit}`;
  return `${formatBankMoney(min)}~${formatBankMoney(max)}${unit}`;
};

const formatBasisTimestamp = (value) => {
  if (!value) return "-";
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const buildDefaultDraft = (context = {}) => {
  const economy = context.economy || {};
  const baselineSalary = toWholeNumber(
    economy.baselineWeeklySalary || economy.medianWeeklySalary,
    100,
  );

  return {
    label: "새 예금 상품",
    baseRate: 1,
    days: 7,
    maxDepositPerStudent: baselineSalary,
    minCreditScore: 0,
    useTierRateAdjustment: true,
    expectedParticipantCount: Math.max(
      1,
      Math.ceil(toWholeNumber(economy.activeStudentCount) / 2),
    ),
    expectedDepositPerStudent: baselineSalary,
    exampleDepositAmount: baselineSalary,
  };
};

function SnapshotMetric({ icon: Icon, label, value, unit = "" }) {
  return (
    <div className="min-w-0 border-l border-slate-200 pl-3 first:border-l-0 first:pl-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        {label}
      </div>
      <p className="mt-1 truncate text-base font-black text-slate-800">
        {value}
        {unit && <span className="ml-1 text-xs font-bold text-slate-400">{unit}</span>}
      </p>
    </div>
  );
}

function ResultMetric({ label, value, detail, tone = "slate" }) {
  const tones = {
    blue: "border-blue-100 bg-blue-50 text-blue-900",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-900",
    slate: "border-slate-200 bg-slate-50 text-slate-900",
  };

  return (
    <div className={`border p-3 ${tones[tone] || tones.slate}`}>
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
      {detail && <p className="mt-1 text-xs font-semibold text-slate-600">{detail}</p>}
    </div>
  );
}

export default function BankDepositOperationAssistantModal({
  isOpen,
  onClose,
  classId,
  currencyUnit = "원",
}) {
  const { showFeedback } = useFeedback();
  const [context, setContext] = useState(null);
  const [draft, setDraft] = useState(() => buildDefaultDraft());
  const [simulation, setSimulation] = useState(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [calculationBasis, setCalculationBasis] = useState(null);
  const calculationRequestRef = useRef(0);
  const candidateSignatureRef = useRef("");

  const resolvedCurrencyUnit = context?.currency?.unit || currencyUnit || "원";
  const hasReadyContext = context?.dataQuality?.status === "ready";

  const candidate = useMemo(
    () => ({
      baseRate: toRate(draft.baseRate),
      days: Math.max(1, toWholeNumber(draft.days, 7)),
      maxDepositPerStudent: toWholeNumber(draft.maxDepositPerStudent),
      minCreditScore: toWholeNumber(draft.minCreditScore),
      useTierRateAdjustment: draft.useTierRateAdjustment !== false,
      expectedParticipantCount: toWholeNumber(draft.expectedParticipantCount),
      expectedDepositPerStudent: toWholeNumber(draft.expectedDepositPerStudent),
      exampleDepositAmount: toWholeNumber(draft.exampleDepositAmount),
    }),
    [draft],
  );
  const candidateSignature = JSON.stringify(candidate);
  candidateSignatureRef.current = candidateSignature;

  const invalidateCalculation = () => {
    calculationRequestRef.current += 1;
    setIsCalculating(false);
    setSimulation(null);
    setCalculationBasis(null);
  };

  const loadContext = async (forceRefresh = false, resetDraft = false) => {
    if (!classId) return;
    invalidateCalculation();
    setIsLoadingContext(true);
    try {
      const response = await getBankDepositDecisionContext({
        classId,
        forceRefresh,
      });
      const nextContext = response.context || null;
      setContext(nextContext);
      if (resetDraft) {
        setDraft(buildDefaultDraft(nextContext || {}));
      }
    } catch (error) {
      showFeedback(
        error?.message || "학급 운영 정보를 불러오지 못했습니다.",
        "error",
      );
    } finally {
      setIsLoadingContext(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !classId) return;
    loadContext(false, true);
    // The modal is a fresh decision session whenever it is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, classId]);

  const updateDraft = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    invalidateCalculation();
  };

  const handleCalculate = async () => {
    if (!hasReadyContext) {
      showFeedback("학생 등록 후 학급 운영 정보를 다시 불러와 주세요.", "warning");
      return;
    }

    setIsCalculating(true);
    const requestId = calculationRequestRef.current + 1;
    calculationRequestRef.current = requestId;
    const requestedCandidateSignature = candidateSignature;
    try {
      const response = await previewBankDepositProductDecision({
        classId,
        candidate,
      });
      if (
        calculationRequestRef.current !== requestId ||
        requestedCandidateSignature !== candidateSignatureRef.current
      ) {
        return;
      }
      setSimulation(response.simulation || null);
      setCalculationBasis({
        candidateSignature: requestedCandidateSignature,
        generatedAtMs: response.context?.generatedAtMs || context?.generatedAtMs,
        cacheHit: response.cache?.hit === true,
      });
    } catch (error) {
      showFeedback(error?.message || "예상 결과를 계산하지 못했습니다.", "error");
    } finally {
      if (calculationRequestRef.current === requestId) {
        setIsCalculating(false);
      }
    }
  };

  const handleCreate = async () => {
    const label = String(draft.label || "").trim();
    if (!label) {
      showFeedback("상품 이름을 입력해 주세요.", "warning");
      return;
    }
    if (
      !simulation ||
      calculationBasis?.candidateSignature !== candidateSignature ||
      isCalculating ||
      isLoadingContext
    ) {
      showFeedback("출시 전 예상 결과를 먼저 계산해 주세요.", "warning");
      return;
    }

    setIsCreating(true);
    try {
      await createBankProduct(classId, "deposit", {
        id: `dp_${Date.now()}`,
        label,
        days: candidate.days,
        rate: candidate.baseRate,
        maxDepositProductLimit:
          candidate.maxDepositPerStudent > 0
            ? candidate.maxDepositPerStudent
            : null,
        minCreditScore:
          candidate.minCreditScore > 0 ? candidate.minCreditScore : null,
        useTierRateAdjustment: candidate.useTierRateAdjustment,
        earlyTerminationBlocked: false,
        active: true,
      });
      showFeedback("새 예금 상품을 출시했습니다.", "success");
      onClose();
    } catch (error) {
      showFeedback(error?.message || "상품 출시에 실패했습니다.", "error");
    } finally {
      setIsCreating(false);
    }
  };

  const expected = simulation?.expectedScenario;
  const example = simulation?.studentExample;
  const maximum = simulation?.maximumExposure;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title="은행 운영도우미"
    >
      <div className="space-y-5">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-blue-700">
              <Sparkles className="h-4 w-4" />
              현재 학급 기준 예금 상품 설계
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              조건을 입력하면 학생 화폐량, 주급, 신용등급을 반영해 예상 규모를 계산합니다.
            </p>
          </div>
          <Button
            size="sm"
            kind="outline"
            tone="slate"
            icon={RefreshCw}
            isLoading={isLoadingContext}
            loadingText="새로고침 중"
            onClick={() => loadContext(true)}
            className="shrink-0"
          >
            기준 새로고침
          </Button>
        </div>

        {isLoadingContext && !context ? (
          <div className="flex min-h-64 items-center justify-center text-sm font-semibold text-slate-500">
            학급 운영 정보를 불러오는 중입니다.
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 border border-slate-200 bg-white p-4 sm:grid-cols-4">
              <SnapshotMetric
                icon={Users}
                label="활성 학생"
                value={`${context?.economy?.activeStudentCount || 0}명`}
              />
              <SnapshotMetric
                icon={Coins}
                label="주급 중앙값"
                value={formatBankMoney(context?.economy?.medianWeeklySalary || 0)}
                unit={resolvedCurrencyUnit}
              />
              <SnapshotMetric
                icon={WalletCards}
                label="학생 보유 화폐"
                value={formatBankMoney(context?.economy?.totalStudentCash || 0)}
                unit={resolvedCurrencyUnit}
              />
              <SnapshotMetric
                icon={Landmark}
                label="현재 예금 원금"
                value={formatBankMoney(context?.bank?.currentDepositPrincipal || 0)}
                unit={resolvedCurrencyUnit}
              />
            </section>

            {!hasReadyContext && (
              <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                아직 계산할 학생 화폐 정보가 없습니다. 학생 등록과 초기 화폐 설정을 마친 뒤 다시 열어 주세요.
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <section className="border border-slate-200 bg-slate-50 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-slate-500" />
                  <h4 className="text-sm font-black text-slate-800">상품 조건</h4>
                </div>

                <div className="space-y-4">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold text-slate-600">상품 이름</span>
                    <input
                      value={draft.label}
                      onChange={(event) => updateDraft("label", event.target.value)}
                      className="w-full border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      placeholder="예: 한 주 예금"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-bold text-slate-600">기본 이율</span>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={draft.baseRate}
                          onChange={(event) => updateDraft("baseRate", event.target.value)}
                          className="w-full border border-blue-200 bg-blue-50/50 px-3 py-2.5 pr-8 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                      </div>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-bold text-slate-600">운영 기간</span>
                      <div className="relative">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={draft.days}
                          onChange={(event) => updateDraft("days", event.target.value)}
                          className="w-full border border-blue-200 bg-blue-50/50 px-3 py-2.5 pr-9 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">일</span>
                      </div>
                    </label>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold text-slate-600">1인 최대 예금액</span>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={draft.maxDepositPerStudent}
                        onChange={(event) => updateDraft("maxDepositPerStudent", event.target.value)}
                        className="w-full border border-blue-200 bg-blue-50/50 px-3 py-2.5 pr-12 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">{resolvedCurrencyUnit}</span>
                    </div>
                    <p className="text-[11px] font-medium text-slate-500">0을 입력하면 한도를 두지 않습니다.</p>
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold text-slate-600">최소 신용점수</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={draft.minCreditScore}
                      onChange={(event) => updateDraft("minCreditScore", event.target.value)}
                      className="w-full border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>

                  <div className="flex items-center justify-between gap-4 border border-slate-200 bg-white px-3 py-3">
                    <div>
                      <p className="text-xs font-bold text-slate-700">신용등급별 이율 조정</p>
                      <p className="mt-1 text-[11px] font-medium text-slate-500">기존 등급 이율 설정을 함께 적용합니다.</p>
                    </div>
                    <ToggleSwitch
                      checked={draft.useTierRateAdjustment}
                      onChange={(value) => updateDraft("useTierRateAdjustment", value)}
                      tone="blue"
                      srLabel="신용등급별 이율 조정"
                    />
                  </div>

                  <div className="border-t border-slate-200 pt-4">
                    <p className="text-xs font-black text-slate-700">예상 참여 시나리오</p>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="block space-y-1.5">
                        <span className="text-[11px] font-bold text-slate-600">참여 인원</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={draft.expectedParticipantCount}
                          onChange={(event) => updateDraft("expectedParticipantCount", event.target.value)}
                          className="w-full border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="text-[11px] font-bold text-slate-600">1인 예금액</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={draft.expectedDepositPerStudent}
                          onChange={(event) => updateDraft("expectedDepositPerStudent", event.target.value)}
                          className="w-full border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                      </label>
                    </div>
                  </div>

                  <Button
                    fullWidth
                    tone="blue"
                    icon={Calculator}
                    isLoading={isCalculating}
                    loadingText="계산 중"
                    onClick={handleCalculate}
                    disabled={!hasReadyContext}
                  >
                    예상 결과 계산
                  </Button>
                </div>
              </section>

              <section className="border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-black text-slate-800">예상 결과</h4>
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      기준 시각: {formatBasisTimestamp(calculationBasis?.generatedAtMs)}
                      {calculationBasis?.cacheHit ? " · 저장된 집계 사용" : " · 새 집계 사용"}
                    </p>
                  </div>
                  {simulation?.withholding?.applied && (
                    <span className="border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">
                      이자 소득세 반영
                    </span>
                  )}
                </div>

                {!simulation ? (
                  <div className="mt-4 flex min-h-[420px] flex-col items-center justify-center border border-dashed border-slate-200 bg-slate-50 px-6 text-center">
                    <Calculator className="h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-bold text-slate-600">상품 조건을 입력하고 예상 결과를 계산해 보세요.</p>
                    <p className="mt-1 text-xs font-medium text-slate-500">학생 개인 정보는 표시하지 않고 학급 집계만 사용합니다.</p>
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ResultMetric
                        label="가입 가능 학생"
                        value={`${simulation.eligibility.eligibleStudentCount}명`}
                        detail={`현금 보유 ${simulation.eligibility.eligibleWithCashCount}명`}
                        tone="blue"
                      />
                      <ResultMetric
                        label="적용 이율 범위"
                        value={formatRange(simulation.studentExample.finalRateRange, "%")}
                        detail={draft.useTierRateAdjustment ? "등급별 조정 포함" : "기본 이율만 적용"}
                        tone="slate"
                      />
                    </div>

                    <div className="border border-emerald-100 bg-emerald-50 p-4">
                      <p className="text-xs font-black text-emerald-800">예상 참여 시나리오</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <ResultMetric
                          label="예상 예금 원금"
                          value={`${formatBankMoney(expected.totalPrincipal)}${resolvedCurrencyUnit}`}
                          detail={`${expected.appliedParticipantCount}명 참여 / 1인 ${formatBankMoney(expected.depositPerStudent)}${resolvedCurrencyUnit}`}
                          tone="emerald"
                        />
                        <ResultMetric
                          label="만기 순이자"
                          value={formatRange(expected.netInterestRange, resolvedCurrencyUnit)}
                          detail={`원금 대비 ${formatRatio(expected.principalToStudentCashRatio)}`}
                          tone="emerald"
                        />
                      </div>
                      <p className="mt-3 text-xs font-semibold text-emerald-800">
                        이자 총액(세전): {formatRange(expected.grossInterestRange, resolvedCurrencyUnit)}
                        {simulation.withholding.applied && ` / 세금: ${formatRange(expected.taxAmountRange, resolvedCurrencyUnit)}`}
                      </p>
                    </div>

                    <div className="border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-black text-slate-700">모든 가입 가능 학생이 한도까지 예금할 때</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <ResultMetric
                          label="참여 가능 인원"
                          value={`${maximum.participantCount}명`}
                          detail="보유 현금 기준"
                        />
                        <ResultMetric
                          label="예금 원금"
                          value={`${formatBankMoney(maximum.totalPrincipal)}${resolvedCurrencyUnit}`}
                          detail={`학생 화폐의 ${formatRatio(maximum.cashLockRatio)}`}
                        />
                        <ResultMetric
                          label="만기 순이자"
                          value={`${formatBankMoney(maximum.netInterest)}${resolvedCurrencyUnit}`}
                          detail={`주급 총액의 ${formatRatio(maximum.grossInterestToWeeklyPayrollRatio)}`}
                        />
                      </div>
                      <p className="mt-3 text-xs font-semibold text-slate-600">
                        기존 예금 포함 원금: {formatBankMoney(maximum.combinedDepositPrincipal)}{resolvedCurrencyUnit}
                      </p>
                    </div>

                    <div className="border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
                      예시: {formatBankMoney(example.principal)}{resolvedCurrencyUnit}을 예금하면 만기 순이자는 {formatRange(example.netInterestRange, resolvedCurrencyUnit)}입니다.
                    </div>

                    {simulation.notices?.map((notice) => (
                      <div key={notice.code} className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                        {notice.message}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <Button kind="outline" tone="slate" onClick={onClose}>닫기</Button>
          <Button
            tone="blue"
            icon={Landmark}
            isLoading={isCreating}
            loadingText="출시 중"
            onClick={handleCreate}
            disabled={
              !simulation ||
              calculationBasis?.candidateSignature !== candidateSignature ||
              isCalculating ||
              isLoadingContext
            }
          >
            이 조건으로 상품 출시
          </Button>
        </div>
      </div>
    </Modal>
  );
}
