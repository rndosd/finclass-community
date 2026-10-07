import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Plus, Trash2 } from "lucide-react";

import {
  Alert,
  Button,
  InputField,
  Modal,
  SelectField,
} from "../../../components/ui";
import { formatPercentValue, formatTrimmedNumber } from "../utils/displayFormat";
import useFundRiskPreview from "../hooks/useFundRiskPreview";
import FundRiskSummary from "../components/FundRiskSummary";

const MAX_HOLDINGS_COUNT = 12;
const INPUT_CLASSNAME =
  "min-h-[52px] rounded-xl border-2 border-slate-200 px-4 text-sm shadow-none";

const createHolding = (holding = {}) => ({
  symbol: holding.symbol || "",
  weightPct:
    holding.weightPct !== undefined && holding.weightPct !== null
      ? String(holding.weightPct)
      : "",
});

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

export default function FundRebalanceModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
  fund = null,
  availableSymbols = [],
  orderCutoffTime = "15:00",
  isTeacher = false,
  classId = null,
}) {
  const [holdings, setHoldings] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");

  const minHoldingsCount = Math.min(
    MAX_HOLDINGS_COUNT,
    Math.max(1, Number(fund?.minHoldingsCount ?? 3)),
  );
  const maxSingleWeightPct = Math.min(
    100,
    Math.max(1, (Number(fund?.maxSingleWeightBps ?? 4000) || 4000) / 100),
  );

  useEffect(() => {
    if (!isOpen || !fund) return;

    const nextHoldings = toHoldingDrafts(fund.holdingsCurrent || []);
    while (nextHoldings.length < minHoldingsCount) {
      nextHoldings.push(createHolding());
    }

    setHoldings(nextHoldings);
    setErrorMessage("");
  }, [fund, isOpen, minHoldingsCount]);

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

  const totalWeightPct = useMemo(
    () => holdings.reduce((sum, item) => sum + (Number(item.weightPct) || 0), 0),
    [holdings],
  );
  const roundedTotalWeightPct = Math.round(totalWeightPct * 10) / 10;
  const remainingWeightPct = Math.round((100 - roundedTotalWeightPct) * 10) / 10;
  const previewHoldings = useMemo(
    () => holdings.map((holding) => ({
      symbol: holding.symbol,
      weightBps: Math.round((Number(holding.weightPct) || 0) * 100),
    })),
    [holdings],
  );
  const riskPreview = useFundRiskPreview(classId, previewHoldings, { enabled: isOpen });

  if (!isOpen || !fund) return null;

  const handleHoldingChange = (index, field) => (event) => {
    const value = event?.target?.value ?? "";
    setHoldings((prev) =>
      prev.map((holding, holdingIndex) =>
        holdingIndex === index ? { ...holding, [field]: value } : holding,
      ),
    );
    setErrorMessage("");
  };

  const handleAddHolding = () => {
    setHoldings((prev) => [...prev, createHolding()]);
    setErrorMessage("");
  };

  const handleRemoveHolding = (index) => {
    setHoldings((prev) => prev.filter((_, holdingIndex) => holdingIndex !== index));
    setErrorMessage("");
  };

  const getOptionsForIndex = (index) => {
    const selectedByOthers = new Set(
      holdings
        .filter((_, holdingIndex) => holdingIndex !== index)
        .map((holding) => holding.symbol)
        .filter(Boolean),
    );

    return symbolOptions.map((option) => ({
      ...option,
      disabled:
        !!option.value &&
        selectedByOthers.has(option.value) &&
        holdings[index]?.symbol !== option.value,
    }));
  };

  const handleSubmit = async () => {
    const normalizedHoldings = holdings
      .map((item) => ({
        symbol: String(item.symbol || "").trim().toUpperCase(),
        weightPct: Number(item.weightPct) || 0,
      }))
      .filter((item) => item.symbol && item.weightPct > 0);

    const uniqueSymbols = new Set(normalizedHoldings.map((item) => item.symbol));

    if (normalizedHoldings.length < minHoldingsCount) {
      setErrorMessage(`편입 종목은 최소 ${minHoldingsCount}개 이상 등록해 주세요.`);
      return;
    }

    if (normalizedHoldings.length > MAX_HOLDINGS_COUNT) {
      setErrorMessage(`편입 종목은 최대 ${MAX_HOLDINGS_COUNT}개까지 등록할 수 있습니다.`);
      return;
    }

    if (uniqueSymbols.size !== normalizedHoldings.length) {
      setErrorMessage("같은 종목은 한 번만 선택할 수 있습니다.");
      return;
    }

    if (normalizedHoldings.some((item) => item.weightPct > maxSingleWeightPct)) {
      setErrorMessage(`단일 종목 비중은 최대 ${maxSingleWeightPct}%까지 허용됩니다.`);
      return;
    }

    if (roundedTotalWeightPct !== 100) {
      setErrorMessage("편입 비중 합계가 정확히 100%가 되도록 맞춰 주세요.");
      return;
    }

    try {
      const result = await onSubmit?.({
        fundId: fund.id,
        holdings: normalizedHoldings.map((item) => ({
          symbol: item.symbol,
          weightBps: Math.round(item.weightPct * 100),
        })),
      });

      if (result?.success === false) {
        setErrorMessage(result.message || "리밸런싱 저장에 실패했습니다.");
        return;
      }

      onClose?.();
    } catch (error) {
      setErrorMessage(error?.message || "리밸런싱 저장 중 오류가 발생했습니다.");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={`${fund.fundName} 리밸런싱`}
    >
      <div className="space-y-6">
        {isTeacher ? (
          <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-4 text-sm text-blue-900">
            교사는 관리자 권한으로 주말과 시간 제한 없이 리밸런싱할 수 있습니다. 운영 점검이나
            보정이 필요할 때 펀드도 바로 조정할 수 있습니다.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-4 text-sm text-blue-900">
              오늘 리밸런싱은 <strong>거래 마감 전({orderCutoffTime})</strong>까지만 가능합니다.
              가입·환매와 같은 마감시간을 사용합니다.
            </div>

            <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4 text-sm text-amber-900">
              마감시간 이후에는 다음 거래일에 포트폴리오를 변경할 수 있습니다.
            </div>
          </>
        )}

        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800">
            <AlertCircle className="h-4 w-4 text-indigo-600" />
            리밸런싱 조건
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-slate-700">
              최소 {minHoldingsCount}종목
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-slate-700">
              최대 {MAX_HOLDINGS_COUNT}종목
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-slate-700">
              단일 종목 최대 {maxSingleWeightPct}%
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-slate-700">
              비중 합계 100%
            </span>
          </div>
        </div>

        <section className="rounded-[1.75rem] border border-slate-200 bg-slate-50/60 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-lg font-black text-slate-800">편입 비중 조정</h4>
              <p className="text-sm text-slate-500">
                현재 펀드의 편입 비중을 수정하면 다음 거래 체결 전까지 새 구성으로 반영됩니다.
              </p>
            </div>

            <div className="rounded-2xl bg-white px-4 py-3 text-right shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                합계
              </p>
              <p
                className={`text-2xl font-black ${
                  roundedTotalWeightPct === 100
                    ? "text-emerald-600"
                    : "text-rose-500"
                }`}
              >
                {formatPercentValue(totalWeightPct, 1)}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-600" role="status">
                {remainingWeightPct === 0
                  ? "비중 합계가 맞습니다. 종목별 상한도 확인하세요."
                  : remainingWeightPct > 0
                    ? `${formatTrimmedNumber(remainingWeightPct, 1)}%p 더 배분하세요.`
                    : `${formatTrimmedNumber(-remainingWeightPct, 1)}%p 줄이세요.`}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {holdings.map((holding, index) => (
              <div
                key={`holding-${index}`}
                className="grid gap-3 rounded-2xl border border-white bg-white p-4 shadow-sm md:grid-cols-[1fr_140px_auto]"
              >
                <SelectField
                  id={`rebalance-symbol-${index}`}
                  label={`종목 ${index + 1}`}
                  value={holding.symbol}
                  onChange={handleHoldingChange(index, "symbol")}
                  options={getOptionsForIndex(index)}
                  placeholder="편입 종목 선택"
                  searchable
                  searchPlaceholder="티커 또는 회사명을 검색하세요"
                  className="min-h-[52px]"
                />
                <InputField
                  id={`rebalance-weight-${index}`}
                  label={`종목 ${index + 1} 비중 (%)`}
                  type="number"
                  min="0"
                  max={String(maxSingleWeightPct)}
                  step="0.1"
                  value={holding.weightPct}
                  onChange={handleHoldingChange(index, "weightPct")}
                  placeholder={`최대 ${maxSingleWeightPct}`}
                  hint={`한 종목은 최대 ${maxSingleWeightPct}%. 비중은 0.1% 단위로 입력하세요.`}
                  error={Number(holding.weightPct) > maxSingleWeightPct
                    ? `상한보다 ${formatTrimmedNumber(Number(holding.weightPct) - maxSingleWeightPct, 1)}%p 높습니다.`
                    : Number(holding.weightPct) < 0 ? "비중은 0 이상으로 입력하세요." : undefined}
                  className={INPUT_CLASSNAME}
                />
                <div className="flex items-end">
                  <Button
                    tone="red"
                    kind="soft"
                    size="sm"
                    onClick={() => handleRemoveHolding(index)}
                    disabled={holdings.length <= minHoldingsCount}
                    icon={Trash2}
                    className="w-full justify-center"
                  >
                    제거
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              tone="blue"
              kind="outline"
              size="sm"
              onClick={handleAddHolding}
              icon={Plus}
              disabled={holdings.length >= MAX_HOLDINGS_COUNT}
            >
              편입 종목 추가
            </Button>
          </div>
        </section>

        <FundRiskSummary
          risk={riskPreview.data}
          isLoading={riskPreview.isLoading}
          previousRisk={fund.riskSummary}
        />

        {errorMessage ? <Alert type="error" message={errorMessage} /> : null}

        <div className="flex justify-end gap-3">
          <Button tone="slate" kind="soft" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button
            tone="blue"
            kind="solid"
            onClick={handleSubmit}
            isLoading={isSubmitting}
          >
            리밸런싱 저장
          </Button>
        </div>
      </div>
    </Modal>
  );
}
