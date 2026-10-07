import React from "react";

const CATEGORY_LABELS = {
  stable: "가격 움직임 작음",
  neutral: "가격 움직임 보통",
  aggressive: "가격 움직임 큼",
};

const REASON_LABELS = {
  missing_price_history: "일부 종목의 가격 기록이 아직 없어요.",
  insufficient_common_dates: "같은 날짜에 확인한 가격 기록이 부족해요.",
  short_price_history: "가격 기록이 아직 짧아 움직임의 크기를 정하지 않았어요.",
  security_identity_conflict: "종목 이름과 가격 자료가 서로 맞지 않아 계산을 기다리고 있어요.",
  thresholds_not_configured: "움직임을 나누는 기준을 확인하고 있어요.",
  invalid_total_weight: "담은 종목과 현금의 비율을 모두 더하면 100%가 되어야 해요.",
  cash_only_portfolio: "먼저 종목을 담아 주세요.",
  dataset_not_ready: "가격 자료를 준비하고 있어요.",
  unsupported_model_version: "계산 방법을 새로 확인하고 있어요.",
  dataset_model_mismatch: "가격 자료와 계산 방법을 확인하고 있어요.",
  risk_calculation_failed: "자료를 잠시 불러오지 못했어요. 펀드 절차는 계속 진행할 수 있어요.",
};

export function getFundRiskLabel(risk = null) {
  if (risk?.status === "limited_history") return "가격 기록 짧음";
  return CATEGORY_LABELS[risk?.category] || "아직 알 수 없음";
}

function getStructureLabel(label) {
  if (label === "인버스") return "반대로 움직이는 상품";
  if (label === "레버리지") return "움직임을 키우는 상품";
  if (label === "일일 -1배") return "하루 기준 반대 방향";
  if (/^일일 -?\d+(?:\.\d+)?배$/.test(label || "")) return label.replace("일일 ", "하루 기준 ");
  return label;
}

export function isFundRiskFeatureVisible(...risks) {
  return risks.some((risk) => Boolean(String(risk?.datasetVersion || "").trim()));
}

function formatMetric(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "자료 없음";
  return `${Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
}

export default function FundRiskSummary({
  risk = null,
  isLoading = false,
  previousRisk = null,
  title = "이 구성의 가격 움직임",
}) {
  if (!isFundRiskFeatureVisible(risk, previousRisk)) return null;
  const label = isLoading ? "계산 중…" : getFundRiskLabel(risk);
  const previousLabel = previousRisk ? getFundRiskLabel(previousRisk) : null;
  const volatility = Number(risk?.annualizedVolatilityPct);
  const hasVolatility = !isLoading && risk?.annualizedVolatilityPct !== null
    && risk?.annualizedVolatilityPct !== undefined && Number.isFinite(volatility);
  const isShortHistory = risk?.historyQuality === "short";
  const isObservedOnly = risk?.historyQuality === "insufficient";
  const observedWeeks = Number(risk?.observations);
  const concentration = !isLoading ? risk?.concentration : null;
  const structureTags = Array.isArray(risk?.structureTags) ? risk.structureTags : [];
  const hasDailyObjective = structureTags.some((tag) => tag.label?.startsWith("일일"));

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-live="polite">
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-600">{title}</p>
            {previousLabel ? <p className="mt-1 text-xs text-slate-500">바꾸기 전: {previousLabel}</p> : null}
            <strong className="mt-1 block text-lg font-bold text-slate-900">{label}</strong>
            {!isLoading && isShortHistory ? <p className="mt-1 text-xs text-slate-600">가격 기록이 짧아요</p> : null}
          </div>
          {hasVolatility ? (
            <div className="shrink-0 sm:text-right">
              <p className="text-xs text-slate-600">움직임 크기 · 1년 기준</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{volatility.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%</p>
            </div>
          ) : null}
        </div>
      {isLoading ? <p className="mt-1 text-xs leading-5 text-slate-600">지금 담은 비율로 계산하고 있어요.</p> : isObservedOnly ? (
        <p className="mt-3 text-sm leading-5 text-slate-600">
          {Number.isFinite(observedWeeks) ? `일주일마다 확인한 가격 변화 ${observedWeeks}개를 살펴봤어요. ` : ""}기록이 짧아 움직임 크기는 참고만 해 주세요.
        </p>
      ) : !isLoading && !risk?.category ? (
        <p className="mt-3 text-sm leading-5 text-slate-600">
          {REASON_LABELS[risk?.reason] || "움직임 크기를 계산할 자료가 아직 부족해요."}
        </p>
      ) : !risk?.riskDetailsVersion && !concentration ? (
        <p className="mt-3 text-xs leading-5 text-slate-600">
          지금 담은 비율로 {isShortHistory ? `일주일마다 확인한 가격 변화 ${observedWeeks}개` : "최근 2년의 가격 변화"}를 살펴봤어요.
        </p>
      ) : null}
      {concentration?.largestPosition ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 border-t border-slate-100 pt-3">
          <div className="min-w-0">
            <dt className="text-xs text-slate-600">가장 많이 담은 종목</dt>
            <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm font-bold text-slate-900">
              <span className="break-all">{concentration.largestPosition.symbol}</span>
              <span className="tabular-nums">{formatMetric(concentration.largestPosition.weightBps / 100)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">현금 비율</dt>
            <dd className="mt-1 text-sm font-bold tabular-nums text-slate-900">{formatMetric(concentration.cashWeightBps / 100)}</dd>
          </div>
        </dl>
      ) : null}
      {!isLoading && structureTags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {structureTags.slice(0, 4).map((tag) => (
            <span key={tag.label} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
              {getStructureLabel(tag.label)} {Math.round(Number(tag.weightBps || 0) / 100)}%
            </span>
          ))}
        </div>
      ) : null}
      {!isLoading && hasDailyObjective ? (
        <p className="mt-2 text-xs leading-5 text-slate-600">하루 움직임을 기준으로 만든 상품이에요. 여러 날 보유한 결과는 하루 목표를 그대로 더한 값과 다를 수 있어요.</p>
      ) : null}
      {!isLoading ? <p className="mt-3 text-xs leading-5 text-slate-600">움직임이 작다고 꼭 안전하거나 돈을 버는 것은 아니에요.</p> : null}
      </div>
      {!isLoading && (risk?.riskDetailsVersion || concentration) ? (
        <details className="border-t border-slate-200 bg-slate-50" aria-label="가격 움직임 자세히">
          <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-bold text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">내려갈 때의 움직임과 담은 비율 보기</summary>
          <div className="px-4 pb-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-600">내려갈 때의 흔들림 · 1년 기준</dt><dd className="mt-1 font-bold tabular-nums text-slate-900">{formatMetric(risk?.annualizedDownsideDeviationPct)}</dd></div>
            <div><dt className="text-xs text-slate-600">예전 가격으로 본 가장 큰 하락</dt><dd className="mt-1 font-bold tabular-nums text-slate-900">{formatMetric(risk?.historicalMaxDrawdownPct)}</dd></div>
            <div><dt className="text-xs text-slate-600">많이 담은 3종목의 비율</dt><dd className="mt-1 font-bold tabular-nums text-slate-900">{formatMetric(concentration ? concentration.top3WeightBps / 100 : null)}</dd></div>
            <div><dt className="text-xs text-slate-600">담은 종목 수</dt><dd className="mt-1 font-bold text-slate-900">{concentration ? `${concentration.securityCount}개` : "자료 없음"}</dd></div>
          </dl>
          {risk?.category ? <p className="mt-4 text-xs leading-5 text-slate-600">지금 담은 비율로 {isShortHistory ? `일주일마다 확인한 가격 변화 ${observedWeeks}개` : "최근 2년의 가격 변화"}를 살펴봤어요.</p> : null}
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-600">
          <p>
            가격이 내릴 때 얼마나 크게 흔들렸는지 살펴봤어요. 흔들림 크기는 비교하기 쉽게 1년 기준으로 바꾼 값이며, 잃을 돈을 예측한 숫자는 아니에요.
          </p>
          <p>
            가장 큰 하락은 매주 지금 비율로 맞추며 예전에 투자했다고 가정한 값이에요. 우리 펀드가 실제로 잃은 돈이 아니에요. 일주일 사이의 하락과 거래 비용은 빠져 있어요.
          </p>
          {risk?.sampleStart && risk?.sampleEnd ? <p>가격 기록: {risk.sampleStart} ~ {risk.sampleEnd}</p> : null}
          <p>ETF 안에 어떤 회사들이 들어 있는지, 다른 ETF와 같은 회사를 담고 있는지는 아직 계산하지 않았어요.</p>
          {structureTags.length > 4 ? <p className="mt-1 text-xs text-slate-600">그 외: {structureTags.slice(4).map((tag) => `${getStructureLabel(tag.label)} ${formatMetric(tag.weightBps / 100)}`).join(" · ")}</p> : null}
          {risk?.structureEvidence ? <p className="mt-1 text-xs leading-5 text-slate-600">상품을 만든 회사의 설명을 다시 확인한 비율은 {formatMetric(risk.structureEvidence.verifiedWeightBps / 100)}예요. 나머지는 확인이 더 필요해요. 주의 표시가 없다고 위험이 없는 것은 아니에요.</p> : null}
          </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
