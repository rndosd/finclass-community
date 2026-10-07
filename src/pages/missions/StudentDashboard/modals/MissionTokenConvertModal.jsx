import { useNumberFormat as useConfiguredMoney } from "../../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, ShieldCheck, Sparkles } from "lucide-react";

import { Alert, Button, InputField, Modal } from "../../../../components/ui";
import { useUser } from "../../../../contexts/UserContext";
import { resolveMissionTokenCreditRule } from "../../utils/missionTokenCreditConfig";


const normalizeNumericInput = (value) => value.replace(/[^\d]/g, "");

const MissionTokenConvertModal = ({
  isOpen,
  onClose,
  config,
  currentTier,
  creditScoreMax,
  missionTokenBalance,
  currentCreditScore,
  onSubmit,
  isSubmitting,
}) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatNumber = (value) => Number(value || 0).toLocaleString("ko-KR");

  const { missionTokenLabel } = useUser();
  const [amountInput, setAmountInput] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const activeRule = useMemo(
    () => resolveMissionTokenCreditRule(config, currentTier),
    [config, currentTier],
  );
  const tokenUnit = Number(activeRule?.tokenUnit || 0);
  const creditUnit = Number(activeRule?.creditUnit || 0);
  const isEnabled = config?.enabled === true;
  const remainingCreditCapacity = Number.isFinite(creditScoreMax)
    ? Math.max(Number(creditScoreMax) - Number(currentCreditScore || 0), 0)
    : null;

  const maxCyclesByBalance =
    tokenUnit > 0 ? Math.floor(Number(missionTokenBalance || 0) / tokenUnit) : 0;
  const maxCyclesByCredit =
    tokenUnit > 0 && creditUnit > 0 && Number.isFinite(remainingCreditCapacity)
      ? Math.floor(remainingCreditCapacity / creditUnit)
      : Number.POSITIVE_INFINITY;
  const maxConvertibleCycles = Math.min(maxCyclesByBalance, maxCyclesByCredit);
  const maxConvertibleTokens = Number.isFinite(maxConvertibleCycles)
    ? maxConvertibleCycles * tokenUnit
    : 0;

  useEffect(() => {
    if (!isOpen) return;
    setAmountInput("");
    setErrorMessage("");
  }, [formatConfiguredAmount, isOpen]);

  const parsedAmount = useMemo(() => {
    const numericValue = Number(amountInput);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.floor(numericValue);
  }, [amountInput]);

  const ruleDescription = useMemo(() => {
    if (!activeRule?.tier?.name) return "기본 규칙";
    if (activeRule.usesTierOverride) {
      return `${activeRule.tier.name} 등급 규칙`;
    }
    return `${activeRule.tier.name} 등급 현재 기본 규칙 적용`;
  }, [activeRule]);

  const preview = useMemo(() => {
    const baseState = {
      conversionCycles: 0,
      creditDelta: 0,
      nextMissionTokenBalance: Number(missionTokenBalance || 0),
      nextCreditScore: Number(currentCreditScore || 0),
      canConvert: false,
      message: "",
    };

    if (!tokenUnit || !creditUnit || parsedAmount <= 0) {
      return {
        ...baseState,
        message: `전환할 ${missionTokenLabel} 수를 입력해 주세요.`,
      };
    }

    if (!isEnabled) {
      return {
        ...baseState,
        message: `현재 ${missionTokenLabel} 전환을 이용할 수 없어요.`,
      };
    }

    if (parsedAmount % tokenUnit !== 0) {
      return {
        ...baseState,
        message: `${formatConfiguredAmount(tokenUnit)}${missionTokenLabel} 단위로만 전환할 수 있습니다.`,
      };
    }

    if (parsedAmount > Number(missionTokenBalance || 0)) {
      return {
        ...baseState,
        message: `보유한 ${missionTokenLabel}보다 많이 전환할 수 없습니다.`,
      };
    }

    if (parsedAmount > maxConvertibleTokens) {
      return {
        ...baseState,
        message:
          maxConvertibleCycles > 0
            ? `현재는 최대 ${formatConfiguredAmount(maxConvertibleTokens)}${missionTokenLabel}을 전환해 신용점수 ${formatNumber(
                maxConvertibleCycles * creditUnit,
              )}점까지만 받을 수 있습니다.`
            : "현재는 더 이상 전환할 수 없습니다.",
      };
    }

    const conversionCycles = parsedAmount / tokenUnit;
    const creditDelta = conversionCycles * creditUnit;

    return {
      conversionCycles,
      creditDelta,
      nextMissionTokenBalance: Number(missionTokenBalance || 0) - parsedAmount,
      nextCreditScore: Number(currentCreditScore || 0) + creditDelta,
      canConvert: creditDelta > 0,
      message: "",
    };
  }, [
    formatConfiguredAmount,
    creditUnit,
    currentCreditScore,
    isEnabled,
    maxConvertibleCycles,
    maxConvertibleTokens,
    missionTokenBalance,
    missionTokenLabel,
    parsedAmount,
    tokenUnit,
  ]);

  const handleUseMax = () => {
    if (!Number.isFinite(maxConvertibleTokens) || maxConvertibleTokens <= 0) return;
    setAmountInput(String(maxConvertibleTokens));
    setErrorMessage("");
  };

  const handleSubmit = async () => {
    if (!preview.canConvert) {
      setErrorMessage(preview.message || "전환할 수 없는 상태입니다.");
      return;
    }

    setErrorMessage("");
    const result = await onSubmit?.(parsedAmount);
    if (result?.success) {
      onClose?.();
      return;
    }

    if (result?.message) {
      setErrorMessage(result.message);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <Modal.Header>
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5 text-amber-500" />
          <h2 className="text-xl font-bold text-slate-800">
            {missionTokenLabel} 신용점수 전환
          </h2>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-700">
              <Sparkles className="h-4 w-4" />
              {missionTokenLabel}
            </div>
            <div className="mt-1 text-2xl font-black text-slate-900">
              {formatConfiguredAmount(missionTokenBalance)}
            </div>
          </div>

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-indigo-700">
              <ShieldCheck className="h-4 w-4" />
              신용점수
            </div>
            <div className="mt-1 text-2xl font-black text-slate-900">
              {formatNumber(currentCreditScore)}
              {Number.isFinite(creditScoreMax) ? (
                <span className="ml-2 text-sm font-semibold text-slate-500">
                  / {formatNumber(creditScoreMax)}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {ruleDescription}
          </p>
          <p className="mt-2 text-sm font-medium text-slate-700">
            현재 적용 규칙:{" "}
            <span className="font-black text-slate-900">
              {formatConfiguredAmount(tokenUnit)}{missionTokenLabel}
            </span>
            {" -> "}
            <span className="font-black text-slate-900">
              신용점수 {formatNumber(creditUnit)}점
            </span>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            전환은 {formatConfiguredAmount(tokenUnit)}{missionTokenLabel} 단위로만 가능합니다.
          </p>
        </div>

        {!isEnabled ? (
          <Alert
            type="warning"
            message={`현재는 교사가 ${missionTokenLabel} 전환 기능을 꺼 둔 상태입니다.`}
          />
        ) : null}

        <div className="space-y-3">
          <InputField
            id="missionTokenConvertAmount"
            label={`전환할 ${missionTokenLabel} (최대 ${formatConfiguredAmount(maxConvertibleTokens)})`}
            type="text"
            inputMode="numeric"
            value={amountInput}
            onChange={(event) => {
              setAmountInput(normalizeNumericInput(event.target.value));
              setErrorMessage("");
            }}
            placeholder="0"
            className="text-2xl font-bold"
          />

          <div className="flex justify-end">
            <Button
              size="xs"
              tone="lightBlue"
              kind="soft"
              onClick={handleUseMax}
              disabled={!Number.isFinite(maxConvertibleTokens) || maxConvertibleTokens <= 0}
            >
              최대 사용
            </Button>
          </div>
        </div>

        {parsedAmount > 0 && preview.canConvert ? (
          <div className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
            <h3 className="text-sm font-bold uppercase tracking-wide text-emerald-700">
              전환 예상 결과
            </h3>
            <div className="space-y-2 text-sm text-slate-700">
              <div className="flex items-center justify-between">
                <span>전환 횟수</span>
                <span className="font-semibold text-slate-900">
                  {formatNumber(preview.conversionCycles)}회
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>차감 {missionTokenLabel}</span>
                <span className="font-semibold text-slate-900">
                  {formatConfiguredAmount(parsedAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>획득 신용점수</span>
                <span className="font-semibold text-slate-900">
                  +{formatNumber(preview.creditDelta)}
                </span>
              </div>
              <div className="border-t border-emerald-100 pt-2" />
              <div className="flex items-center justify-between">
                <span>전환 후 {missionTokenLabel}</span>
                <span className="font-semibold text-slate-900">
                  {formatConfiguredAmount(preview.nextMissionTokenBalance)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>전환 후 신용점수</span>
                <span className="font-semibold text-slate-900">
                  {formatNumber(preview.nextCreditScore)}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {errorMessage ? <Alert type="error" message={errorMessage} /> : null}
        {!errorMessage && parsedAmount > 0 && !preview.canConvert && preview.message ? (
          <Alert type="error" message={preview.message} />
        ) : null}
      </Modal.Body>

      <Modal.Footer>
        <div className="flex w-full justify-end gap-3">
          <Button onClick={onClose} variant="ghost" disabled={isSubmitting}>
            닫기
          </Button>
          <Button
            onClick={handleSubmit}
            isLoading={isSubmitting}
            tone="blue"
            disabled={!preview.canConvert}
          >
            전환하기
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default MissionTokenConvertModal;
