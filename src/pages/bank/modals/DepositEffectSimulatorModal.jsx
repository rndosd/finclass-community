import React, { useEffect, useMemo, useState } from "react";
import { Modal, Button } from "../../../components/ui";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  formatBankMoney,
  resolveTierRateModifier,
  roundBankMoney,
} from "../../../utils/bankMoney";

const QUICK_PERIOD_DAYS = [90, 180, 365];

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeMoney = (value) => Math.max(0, Math.floor(toNumber(value, 0)));

const formatMoney = (value) => formatBankMoney(value);

const buildFinalRate = ({ baseRate, weeklyBonusRate, productDays }) => {
  const normalizedBase = toNumber(baseRate, 0);
  const normalizedBonus = toNumber(weeklyBonusRate, 0);
  const normalizedDays = Math.max(1, Math.floor(toNumber(productDays, 1)));

  const rawBonus = (normalizedBonus / 7) * normalizedDays;
  const bonusRate = roundBankMoney(rawBonus);
  const finalRate = Math.max(0, roundBankMoney(normalizedBase + bonusRate));

  return {
    bonusRate,
    finalRate,
  };
};

const simulateDeposit = ({
  mode,
  amountPerCycle,
  cycleDays,
  totalDays,
  periodRate,
}) => {
  const normalizedAmount = normalizeMoney(amountPerCycle);
  const normalizedCycleDays = Math.max(1, Math.floor(toNumber(cycleDays, 1)));
  const normalizedTotalDays = Math.max(1, Math.floor(toNumber(totalDays, 1)));
  const normalizedRate = toNumber(periodRate, 0);

  const cycles = Math.floor(normalizedTotalDays / normalizedCycleDays);
  const remainderDays = normalizedTotalDays - cycles * normalizedCycleDays;

  let totalPrincipal = 0;
  let totalInterest = 0;
  let simplePrincipalPool = 0;
  let compoundBalance = 0;

  const series = [];

  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    totalPrincipal += normalizedAmount;

    if (mode === "simple") {
      // 단리: 이자에는 다시 이자가 붙지 않도록 원금 풀 기준으로 계산
      simplePrincipalPool += normalizedAmount;
      const interest = roundBankMoney(simplePrincipalPool * (normalizedRate / 100));
      totalInterest = roundBankMoney(totalInterest + interest);
      const finalAmount = roundBankMoney(simplePrincipalPool + totalInterest);

      series.push({
        cycle,
        principal: totalPrincipal,
        interest: totalInterest,
        finalAmount,
      });
      continue;
    }

    // 복리: 원금 + 이전 이자 전체를 재예치한 것으로 계산
    compoundBalance = roundBankMoney(compoundBalance + normalizedAmount);
    const interest = roundBankMoney(compoundBalance * (normalizedRate / 100));
    totalInterest = roundBankMoney(totalInterest + interest);
    compoundBalance = roundBankMoney(compoundBalance + interest);

    series.push({
      cycle,
      principal: totalPrincipal,
      interest: totalInterest,
      finalAmount: compoundBalance,
    });
  }

  const finalAmount = roundBankMoney(
    mode === "simple"
      ? simplePrincipalPool + totalInterest
      : compoundBalance,
  );

  return {
    cycles,
    remainderDays,
    totalPrincipal,
    totalInterest,
    finalAmount,
    series,
  };
};

const buildTierOptions = ({
  tierCriteria,
  tierAdjustments,
  currentTierName,
  currentRateModifiers,
}) => {
  const criteriaRows = Array.isArray(tierCriteria) ? tierCriteria : [];
  const adjustmentMap =
    tierAdjustments && typeof tierAdjustments === "object"
      ? tierAdjustments
      : {};

  const scoreMap = new Map();
  criteriaRows.forEach((tier) => {
    const name = String(tier?.name || "").trim();
    if (!name) return;
    scoreMap.set(name, Number(tier?.minScore || 0));
  });

  const nameSet = new Set();
  criteriaRows.forEach((tier) => {
    const name = String(tier?.name || "").trim();
    if (name) nameSet.add(name);
  });
  Object.keys(adjustmentMap).forEach((name) => {
    const trimmed = String(name || "").trim();
    if (trimmed) nameSet.add(trimmed);
  });
  if (currentTierName) nameSet.add(String(currentTierName).trim());

  return Array.from(nameSet)
    .map((name) => {
      const adjustment = adjustmentMap?.[name];
      const fallbackWeeklyBonus =
        name === currentTierName
          ? Number(currentRateModifiers?.depositRateModifier || 0)
          : 0;
      const weeklyBonusRate = Number(
        adjustment?.depositRateModifier ?? fallbackWeeklyBonus,
      );

      return {
        name,
        minScore: Number(scoreMap.get(name) ?? 0),
        weeklyBonusRate,
      };
    })
    .sort((a, b) => {
      if (a.minScore !== b.minScore) return a.minScore - b.minScore;
      return a.name.localeCompare(b.name);
    });
};

export default function DepositEffectSimulatorModal({
  isOpen,
  onClose,
  currencyUnit,
  studentInfo,
  bankSettings,
  currentRateModifiers,
  tierAdjustments,
  tierCriteria,
  ...modalProps
}) {
  const activeDepositProducts = useMemo(
    () => (bankSettings?.depositProducts || []).filter((product) => product?.active),
    [bankSettings],
  );

  const currentTierName = studentInfo?.creditTier?.name || "기본";
  const tierOptions = useMemo(
    () =>
      buildTierOptions({
        tierCriteria,
        tierAdjustments,
        currentTierName,
        currentRateModifiers,
      }),
    [tierCriteria, tierAdjustments, currentTierName, currentRateModifiers],
  );

  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedTierName, setSelectedTierName] = useState(currentTierName);
  const [amountPerCycleInput, setAmountPerCycleInput] = useState("10000");
  const [totalDaysInput, setTotalDaysInput] = useState("365");

  useEffect(() => {
    if (!isOpen) return;
    if (activeDepositProducts.length === 0) {
      setSelectedProductId("");
      return;
    }
    const exists = activeDepositProducts.some(
      (product) => String(product.id) === String(selectedProductId),
    );
    if (!selectedProductId || !exists) {
      setSelectedProductId(String(activeDepositProducts[0].id));
    }
  }, [isOpen, selectedProductId, activeDepositProducts]);

  useEffect(() => {
    if (!isOpen) return;
    if (tierOptions.some((tier) => tier.name === currentTierName)) {
      setSelectedTierName(currentTierName);
      return;
    }
    if (tierOptions.length > 0) {
      setSelectedTierName(tierOptions[0].name);
    }
  }, [isOpen, currentTierName, tierOptions]);

  const selectedProduct = useMemo(
    () =>
      activeDepositProducts.find(
        (product) => String(product.id) === String(selectedProductId),
      ) || null,
    [activeDepositProducts, selectedProductId],
  );

  const selectedTier = useMemo(
    () =>
      tierOptions.find((tier) => tier.name === selectedTierName) ||
      tierOptions[0] ||
      null,
    [tierOptions, selectedTierName],
  );

  const amountPerCycle = normalizeMoney(amountPerCycleInput);
  const totalDays = Math.max(1, Math.floor(toNumber(totalDaysInput, 1)));
  const cycleDays = Math.max(1, Math.floor(toNumber(selectedProduct?.days, 1)));
  const requiredScore = Number(selectedProduct?.minCreditScore || 0);
  const selectedTierScore = Number(selectedTier?.minScore || 0);
  const isEligibleForSelectedTier =
    requiredScore <= 0 || selectedTierScore >= requiredScore;

  const productMaxLimit = Number(selectedProduct?.maxDepositProductLimit || 0);
  const effectiveAmountPerCycle =
    productMaxLimit > 0
      ? Math.min(amountPerCycle, productMaxLimit)
      : amountPerCycle;
  const isAmountLimited = effectiveAmountPerCycle !== amountPerCycle;

  const { bonusRate, finalRate } = useMemo(
    () =>
      buildFinalRate({
        baseRate: selectedProduct?.rate || 0,
        weeklyBonusRate: resolveTierRateModifier(
          selectedProduct?.useTierRateAdjustment,
          selectedTier?.weeklyBonusRate,
        ),
        productDays: cycleDays,
      }),
    [selectedProduct, selectedTier, cycleDays],
  );

  const simulation = useMemo(() => {
    if (!selectedProduct || !selectedTier) return null;
    if (!isEligibleForSelectedTier) return null;
    if (effectiveAmountPerCycle <= 0) return null;

    const simple = simulateDeposit({
      mode: "simple",
      amountPerCycle: effectiveAmountPerCycle,
      cycleDays,
      totalDays,
      periodRate: finalRate,
    });
    const compound = simulateDeposit({
      mode: "compound",
      amountPerCycle: effectiveAmountPerCycle,
      cycleDays,
      totalDays,
      periodRate: finalRate,
    });

    const maxCycles = Math.max(simple.series.length, compound.series.length);
    const growthChartData = [];
    for (let idx = 0; idx < maxCycles; idx += 1) {
      const s = simple.series[idx];
      const c = compound.series[idx];
      growthChartData.push({
        cycle: idx + 1,
        principal: s?.principal ?? c?.principal ?? 0,
        simple: s?.finalAmount ?? null,
        compound: c?.finalAmount ?? null,
      });
    }

    return {
      simple,
      compound,
      growthChartData,
      gainFromCompound: roundBankMoney(
        compound.finalAmount - simple.finalAmount,
      ),
    };
  }, [
    selectedProduct,
    selectedTier,
    isEligibleForSelectedTier,
    effectiveAmountPerCycle,
    cycleDays,
    totalDays,
    finalRate,
  ]);

  const tierComparisonData = useMemo(() => {
    if (!selectedProduct) return [];
    if (effectiveAmountPerCycle <= 0) return [];

    return tierOptions.map((tier) => {
      const eligible =
        requiredScore <= 0 || Number(tier.minScore || 0) >= requiredScore;
      if (!eligible) {
        return {
          tierName: tier.name,
          finalAmount: 0,
          finalRate: 0,
          eligible: false,
        };
      }

      const rateInfo = buildFinalRate({
        baseRate: selectedProduct.rate || 0,
        weeklyBonusRate: resolveTierRateModifier(
          selectedProduct.useTierRateAdjustment,
          tier.weeklyBonusRate,
        ),
        productDays: cycleDays,
      });
      const compound = simulateDeposit({
        mode: "compound",
        amountPerCycle: effectiveAmountPerCycle,
        cycleDays,
        totalDays,
        periodRate: rateInfo.finalRate,
      });

      return {
        tierName: tier.name,
        finalAmount: compound.finalAmount,
        finalRate: rateInfo.finalRate,
        eligible: true,
      };
    });
  }, [
    selectedProduct,
    tierOptions,
    requiredScore,
    effectiveAmountPerCycle,
    cycleDays,
    totalDays,
  ]);

  const hasProducts = activeDepositProducts.length > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="예금 효과 시뮬레이터" size="xl" {...modalProps}>
      <div className="space-y-5">
        {!hasProducts && (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-4 text-sm font-bold text-rose-700">
            활성화된 예금 상품이 없습니다. 관리자에서 예금 상품을 먼저 설정해 주세요.
          </div>
        )}

        <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
          <p className="text-sm font-black text-blue-800">
            단리: 처음 넣은 돈에만 이자가 붙어요. 복리: 돈+이자에 이자가 또 붙어요.
          </p>
          <p className="mt-1 text-xs font-semibold text-blue-600">
            계산은 현재 은행 예금 규칙(상품 기간 이율 + 등급 보정 이율)으로 합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-xs font-black uppercase tracking-wider text-slate-400">
              시뮬레이션 입력
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">예금 상품</span>
                <select
                  className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold text-slate-700 focus:border-blue-500 focus:outline-none"
                  value={selectedProductId}
                  onChange={(event) => setSelectedProductId(event.target.value)}
                  disabled={!hasProducts}
                >
                  {activeDepositProducts.map((product) => (
                    <option key={product.id} value={String(product.id)}>
                      {product.label} ({product.days}일, {product.rate}%)
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">신용등급</span>
                <select
                  className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold text-slate-700 focus:border-blue-500 focus:outline-none"
                  value={selectedTierName}
                  onChange={(event) => setSelectedTierName(event.target.value)}
                  disabled={tierOptions.length === 0}
                >
                  {tierOptions.map((tier) => (
                    <option key={tier.name} value={tier.name}>
                      {tier.name} ({tier.minScore}점+, 주간 +{tier.weeklyBonusRate}%p)
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">매번 넣는 돈</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold text-slate-700 focus:border-blue-500 focus:outline-none"
                  value={amountPerCycleInput}
                  onChange={(event) => setAmountPerCycleInput(event.target.value)}
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">총 기간(일)</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold text-slate-700 focus:border-blue-500 focus:outline-none"
                  value={totalDaysInput}
                  onChange={(event) => setTotalDaysInput(event.target.value)}
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_PERIOD_DAYS.map((days) => (
                <Button
                  key={days}
                  type="button"
                  onClick={() => setTotalDaysInput(String(days))}
                  size="xs"
                  tone="slate"
                  kind="outline"
                  rounded="lg"
                  
                >
                  {days}일
                </Button>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
              <p className="mb-1 text-[11px] text-slate-500">
                예: 10000이면 회차마다 10000씩 추가로 넣어요.
              </p>
              <p>
                적용 이율: 기본 {toNumber(selectedProduct?.rate, 0)}% + 보정{" "}
                {bonusRate.toFixed(2)}% = <strong>{finalRate.toFixed(2)}%</strong>
              </p>
              <p className="mt-1">
                상품 주기 {cycleDays}일마다 예치 반복, 통화 단위 {currencyUnit || "단위"}
              </p>
            </div>

            {isAmountLimited && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                상품 한도 때문에 회차 예치금을 {formatMoney(effectiveAmountPerCycle)}
                {currencyUnit}로 계산했습니다.
              </div>
            )}

            {!isEligibleForSelectedTier && selectedProduct && selectedTier && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                선택한 등급은 이 상품 최소 조건({requiredScore}점)에 미달되어 가입할 수 없습니다.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-xs font-black uppercase tracking-wider text-slate-400">
              결과 요약
            </p>

            {simulation ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                    <p className="text-[11px] font-black uppercase tracking-wider text-emerald-700">
                      단리 최종금액
                    </p>
                    <p className="mt-1 text-xl font-black text-emerald-800">
                      {formatMoney(simulation.simple.finalAmount)}
                      <span className="ml-1 text-xs font-bold">{currencyUnit}</span>
                    </p>
                  </div>

                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                    <p className="text-[11px] font-black uppercase tracking-wider text-indigo-700">
                      복리 최종금액
                    </p>
                    <p className="mt-1 text-xl font-black text-indigo-800">
                      {formatMoney(simulation.compound.finalAmount)}
                      <span className="ml-1 text-xs font-bold">{currencyUnit}</span>
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                  <p className="text-[11px] font-black uppercase tracking-wider text-blue-700">
                    복리 추가 효과
                  </p>
                  <p className="mt-1 text-lg font-black text-blue-800">
                    +{formatMoney(simulation.gainFromCompound)}
                    <span className="ml-1 text-xs font-bold">{currencyUnit}</span>
                  </p>
                  <p className="mt-1 text-xs font-semibold text-blue-700">
                    총 {simulation.compound.cycles}회차 진행, 잔여 {simulation.compound.remainderDays}일
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                  <p>총 원금: {formatMoney(simulation.compound.totalPrincipal)}{currencyUnit}</p>
                  <p>단리 총 이자: {formatMoney(simulation.simple.totalInterest)}{currencyUnit}</p>
                  <p>복리 총 이자: {formatMoney(simulation.compound.totalInterest)}{currencyUnit}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-500">
                상품/등급/예치금을 입력하면 단리/복리 결과가 계산됩니다.
              </div>
            )}
          </div>
        </div>

        {simulation && simulation.growthChartData.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">
              단리 vs 복리 추이
            </p>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={simulation.growthChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="cycle" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => formatMoney(value)}
                  />
                  <Tooltip
                    formatter={(value) => `${formatMoney(value)}${currencyUnit}`}
                    labelFormatter={(value) => `${value}회차`}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="principal"
                    name="원금 누적"
                    stroke="#64748b"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="simple"
                    name="단리"
                    stroke="#10b981"
                    dot={false}
                    strokeWidth={2.5}
                  />
                  <Line
                    type="monotone"
                    dataKey="compound"
                    name="복리"
                    stroke="#4f46e5"
                    dot={false}
                    strokeWidth={2.5}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {tierComparisonData.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">
              등급별 복리 최종금액 비교
            </p>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tierComparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="tierName" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => formatMoney(value)}
                  />
                  <Tooltip
                    formatter={(value, _, item) => {
                      if (!item?.payload?.eligible) return "가입 제한";
                      return `${formatMoney(value)}${currencyUnit}`;
                    }}
                    labelFormatter={(value) => `${value} 등급`}
                  />
                  <Bar dataKey="finalAmount" name="복리 최종금액">
                    {tierComparisonData.map((entry) => (
                      <Cell
                        key={entry.tierName}
                        fill={entry.eligible ? "#3b82f6" : "#cbd5e1"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              <InformationCircleIcon className="mr-1 inline h-4 w-4 text-slate-400" />
              회색은 가입에 필요한 신용점수보다 낮은 등급이에요.
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <Button size="sm" onClick={onClose} kind="soft" >
            닫기
          </Button>
        </div>
      </div>
    </Modal>
  );
}
