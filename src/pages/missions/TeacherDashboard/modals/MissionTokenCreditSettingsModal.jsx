import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, Settings2 } from "lucide-react";

import {
  Alert,
  Button,
  InputField,
  Modal,
  ToggleSwitch,
} from "../../../../components/ui";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { useUser } from "../../../../contexts/UserContext";

const formatUpdatedAt = (value) => {
  if (!value) return "";
  const date =
    typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date?.getTime?.()) ? "" : date.toLocaleString("ko-KR");
};

const normalizeNumericInput = (value) => value.replace(/[^\d]/g, "");

function buildEditableTierRules(tierRules = {}) {
  if (!tierRules || typeof tierRules !== "object") return {};

  return Object.entries(tierRules).reduce((accumulator, [tierId, rule]) => {
    if (!tierId || !rule) return accumulator;

    accumulator[tierId] = {
      tokenUnit: String(rule?.tokenUnit || ""),
      creditUnit: String(rule?.creditUnit || ""),
    };
    return accumulator;
  }, {});
}

function parsePositiveInteger(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const MissionTokenCreditSettingsModal = ({
  isOpen,
  onClose,
  currentConfig,
  tiers = [],
  onSubmitSettings,
  isSubmitting,
  isLoading = false,
}) => {
  const { missionTokenLabel } = useUser();
  const { showFeedback } = useFeedback();
  const [enabled, setEnabled] = useState(false);
  const [tokenUnit, setTokenUnit] = useState("10");
  const [creditUnit, setCreditUnit] = useState("1");
  const [tierRules, setTierRules] = useState({});
  const [expandedTierIds, setExpandedTierIds] = useState(() => new Set());
  const [isDesktopTierLayout, setIsDesktopTierLayout] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 640,
  );
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    setEnabled(currentConfig?.enabled === true);
    setTokenUnit(String(currentConfig?.tokenUnit || 10));
    setCreditUnit(String(currentConfig?.creditUnit || 1));
    setTierRules(buildEditableTierRules(currentConfig?.tierRules));
    setExpandedTierIds(new Set());
    setErrorMessage("");
  }, [currentConfig, isOpen]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 640px)");
    const handleChange = (event) => setIsDesktopTierLayout(event.matches);
    setIsDesktopTierLayout(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const defaultPreview = useMemo(() => {
    const parsedTokenUnit = parsePositiveInteger(tokenUnit);
    const parsedCreditUnit = parsePositiveInteger(creditUnit);

    if (!parsedTokenUnit || !parsedCreditUnit) {
      return null;
    }

    return {
      tokenUnit: parsedTokenUnit,
      creditUnit: parsedCreditUnit,
    };
  }, [creditUnit, tokenUnit]);

  const handleToggleTierRule = (tierId, isEnabledForTier) => {
    setTierRules((current) => {
      if (!isEnabledForTier) {
        const next = { ...current };
        delete next[tierId];
        return next;
      }

      return {
        ...current,
        [tierId]: current[tierId] || {
          tokenUnit: defaultPreview ? String(defaultPreview.tokenUnit) : "",
          creditUnit: defaultPreview ? String(defaultPreview.creditUnit) : "",
        },
      };
    });
    setErrorMessage("");
  };

  const handleTierRuleChange = (tierId, field, value) => {
    setTierRules((current) => ({
      ...current,
      [tierId]: {
        ...(current[tierId] || { tokenUnit: "", creditUnit: "" }),
        [field]: normalizeNumericInput(value),
      },
    }));
    setErrorMessage("");
  };

  const handleSubmit = async () => {
    const numericTokenUnit = parsePositiveInteger(tokenUnit);
    const numericCreditUnit = parsePositiveInteger(creditUnit);

    if (!numericTokenUnit) {
      setErrorMessage(`기본 차감 ${missionTokenLabel} 수는 1 이상의 정수여야 합니다.`);
      return;
    }

    if (!numericCreditUnit) {
      setErrorMessage("기본 지급 신용점수 수는 1 이상의 정수여야 합니다.");
      return;
    }

    const nextTierRules = {};

    for (const tier of tiers) {
      const ruleInput = tierRules?.[tier.id];
      if (!ruleInput) continue;

      const ruleTokenUnit = parsePositiveInteger(ruleInput.tokenUnit);
      const ruleCreditUnit = parsePositiveInteger(ruleInput.creditUnit);

      if (!ruleTokenUnit) {
        setErrorMessage(`${tier.name} 등급의 차감 ${missionTokenLabel} 수를 확인해 주세요.`);
        return;
      }

      if (!ruleCreditUnit) {
        setErrorMessage(`${tier.name} 등급의 지급 신용점수를 확인해 주세요.`);
        return;
      }

      nextTierRules[tier.id] = {
        tokenUnit: ruleTokenUnit,
        creditUnit: ruleCreditUnit,
      };
    }

    setErrorMessage("");

    try {
      const result = await onSubmitSettings?.({
        enabled,
        tokenUnit: numericTokenUnit,
        creditUnit: numericCreditUnit,
        tierRules: nextTierRules,
      });

      if (result?.success === false) {
        throw new Error(result?.message || "설정을 저장하지 못했습니다.");
      }

      showFeedback?.(
        result?.message || `${missionTokenLabel} 전환 설정을 저장했습니다.`,
        "success",
      );
      onClose?.();
    } catch (error) {
      setErrorMessage(
        error?.message || `${missionTokenLabel} 전환 설정 저장 중 오류가 발생했습니다.`,
      );
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <Modal.Header>
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-indigo-600" />
          <h2 className="text-xl font-bold text-slate-800">
            {missionTokenLabel} 전환 설정
          </h2>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-6">
        {isLoading ? (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm font-medium text-indigo-700">
            현재 설정을 불러오는 중입니다.
          </div>
        ) : null}
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
          <p className="text-sm font-medium leading-relaxed text-indigo-700">
            학생이 과제 페이지에서 {missionTokenLabel}을 신용점수로 전환할 때 사용할 기본
            규칙과 등급별 개별 규칙을 설정합니다.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <ToggleSwitch
            id="missionTokenCreditEnabled"
            checked={enabled}
            onChange={setEnabled}
            label="학생 전환 기능 사용"
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-800">기본 규칙</h3>
            <p className="mt-1 text-xs text-slate-500">
              등급별 규칙을 따로 켜지 않은 학생에게 적용됩니다.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InputField
              id="missionTokenCreditTokenUnit"
              label={`기본 차감 ${missionTokenLabel}`}
              type="text"
              inputMode="numeric"
              value={tokenUnit}
              onChange={(event) => {
                setTokenUnit(normalizeNumericInput(event.target.value));
                setErrorMessage("");
              }}
              placeholder="예: 10"
              className="font-mono"
            />

            <InputField
              id="missionTokenCreditCreditUnit"
              label="기본 지급 신용점수"
              type="text"
              inputMode="numeric"
              value={creditUnit}
              onChange={(event) => {
                setCreditUnit(normalizeNumericInput(event.target.value));
                setErrorMessage("");
              }}
              placeholder="예: 1"
              className="font-mono"
            />
          </div>

          <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
            {defaultPreview ? (
              <p>
                기본 규칙: <strong>{defaultPreview.tokenUnit}{missionTokenLabel}</strong>을 쓰면{" "}
                <strong>신용점수 {defaultPreview.creditUnit}점</strong>을 지급합니다.
              </p>
            ) : (
              <p>기본 규칙을 보려면 두 칸 모두 1 이상의 정수로 입력해 주세요.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-800">등급별 개별 규칙</h3>
            <p className="mt-1 text-xs text-slate-500">
              개별 규칙을 켠 등급은 기본 규칙 대신 해당 등급 전용 규칙을 사용합니다.
            </p>
          </div>

          {tiers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
              신용등급이 아직 설정되지 않았습니다. 먼저 신용등급 기준을 만든 뒤
              등급별 규칙을 설정할 수 있습니다.
            </div>
          ) : (
            <div className="space-y-4">
              {tiers.map((tier) => {
                const tierRule = tierRules?.[tier.id] || null;
                const usesTierRule = Boolean(tierRule);
                const parsedTierTokenUnit = parsePositiveInteger(tierRule?.tokenUnit);
                const parsedTierCreditUnit = parsePositiveInteger(tierRule?.creditUnit);

                return (
                  <details
                    key={tier.id}
                    open={isDesktopTierLayout || expandedTierIds.has(tier.id)}
                    onToggle={(event) => {
                      if (isDesktopTierLayout) return;
                      const isOpen = event.currentTarget.open;
                      setExpandedTierIds((current) => {
                        const next = new Set(current);
                        if (isOpen) next.add(tier.id);
                        else next.delete(tier.id);
                        return next;
                      });
                    }}
                    className="group rounded-2xl border border-slate-200 bg-slate-50"
                  >
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 sm:hidden">
                      <span className="flex min-w-0 items-center gap-3">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: tier.color || "#64748b" }}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-slate-800">
                            {tier.name}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {usesTierRule ? "개별 규칙 사용 중" : "기본 규칙 적용"}
                          </span>
                        </span>
                      </span>
                      <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition group-open:rotate-180" />
                    </summary>

                    <div className="hidden border-t border-slate-200 p-3 group-open:block sm:block sm:border-t-0 sm:p-4">
                    <div className="mb-3 grid gap-3 sm:flex sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: tier.color || "#64748b" }}
                        />
                        <div className="min-w-0">
                          <p className="break-words font-semibold text-slate-800">{tier.name}</p>
                          <p className="text-xs text-slate-500">
                            최소 점수 {Number(tier.minScore || 0).toLocaleString()}점
                          </p>
                        </div>
                      </div>

                      <ToggleSwitch
                        id={`missionTokenTierRule-${tier.id}`}
                        checked={usesTierRule}
                        onChange={(nextValue) =>
                          handleToggleTierRule(tier.id, nextValue)
                        }
                        label="이 등급만 개별 규칙 사용"
                      />
                    </div>

                    {usesTierRule ? (
                      <>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <InputField
                            id={`missionTokenTierToken-${tier.id}`}
                            label={`차감 ${missionTokenLabel}`}
                            type="text"
                            inputMode="numeric"
                            value={tierRule?.tokenUnit || ""}
                            onChange={(event) =>
                              handleTierRuleChange(
                                tier.id,
                                "tokenUnit",
                                event.target.value,
                              )
                            }
                            placeholder="예: 15"
                            className="font-mono"
                          />

                          <InputField
                            id={`missionTokenTierCredit-${tier.id}`}
                            label="지급 신용점수"
                            type="text"
                            inputMode="numeric"
                            value={tierRule?.creditUnit || ""}
                            onChange={(event) =>
                              handleTierRuleChange(
                                tier.id,
                                "creditUnit",
                                event.target.value,
                              )
                            }
                            placeholder="예: 50"
                            className="font-mono"
                          />
                        </div>

                        <p className="mt-3 text-sm text-slate-600">
                          {parsedTierTokenUnit && parsedTierCreditUnit
                            ? `${tier.name}: ${parsedTierTokenUnit}${missionTokenLabel} -> 신용점수 ${parsedTierCreditUnit}점`
                            : "이 등급의 개별 규칙 두 칸을 모두 입력해 주세요."}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-slate-500">
                        현재 기본 규칙 적용:{" "}
                        {defaultPreview
                          ? `${defaultPreview.tokenUnit}${missionTokenLabel} -> 신용점수 ${defaultPreview.creditUnit}점`
                          : "기본 규칙을 먼저 입력해 주세요."}
                      </p>
                    )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>

        {currentConfig?.updatedByName || currentConfig?.updatedAt ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
            {currentConfig?.updatedByName ? (
              <p>마지막 수정자: {currentConfig.updatedByName}</p>
            ) : null}
            {currentConfig?.updatedAt ? (
              <p className="mt-1">
                마지막 수정 시각: {formatUpdatedAt(currentConfig.updatedAt)}
              </p>
            ) : null}
          </div>
        ) : null}

        {errorMessage ? <Alert type="error" message={errorMessage} /> : null}
        <Alert
          type="warning"
          message="신용점수 최대치가 설정된 학급에서는 최대치를 넘는 전환이 자동으로 막힙니다."
        />
      </Modal.Body>

      <Modal.Footer>
        <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:justify-end">
          <Button onClick={onClose} variant="ghost" disabled={isSubmitting}>
            닫기
          </Button>
          <Button
            onClick={handleSubmit}
            isLoading={isSubmitting}
            disabled={isLoading || isSubmitting}
            tone="blue"
          >
            설정 저장
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default MissionTokenCreditSettingsModal;
