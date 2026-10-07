import React, { useCallback, useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { Button, Card, Modal, Spinner } from "../../../components/ui";
import StudentSelector from "../../../components/ui/StudentSelector";
import CreditTierSelector from "../../../components/ui/CreditTierSelector";

const CALCULATION_MODE_OPTIONS = [
  {
    value: "flat_rate",
    label: "비율",
    description: "급여의 일정 비율을 공제합니다.",
  },
  {
    value: "flat_amount",
    label: "고정액",
    description: "주당 같은 금액을 공제합니다.",
  },
  {
    label: "면세 후 비율",
    description: "주당 비과세 한도를 넘는 금액에만 비율을 적용합니다.",
  },
  {
    value: "progressive",
    label: "누진세",
    description: "주당 구간별로 다른 세율을 적용합니다.",
  },
];

const createEmptyBracket = (overrides = {}) => ({
  upToAmount: "",
  rate: "",
  ...overrides,
});

const createDefaultProgressiveBrackets = () => [
  createEmptyBracket({ upToAmount: "1000", rate: "3" }),
  createEmptyBracket({ upToAmount: "", rate: "6" }),
];

const TARGET_MODE_OPTIONS = [
  {
    value: "all",
    title: "전체",
    description: "학급 전체 학생에게 적용합니다.",
  },
  {
    value: "individual",
    title: "학생 선택",
    description: "선택한 학생만 적용하고, 비워 두면 전체로 처리합니다.",
  },
  {
    value: "credit_tier",
    title: "신용등급",
    description: "선택한 신용등급 학생에게만 적용합니다.",
  },
];

const getPath = (type, classId, docId = null) => {
  if (!classId) {
    console.error("TaxRuleForm getPath: classId is undefined");
    return null;
  }

  switch (type) {
    case "taxRules":
      return `classes/${classId}/taxRules`;
    case "taxRule":
      return `classes/${classId}/taxRules/${docId}`;
    default:
      console.error(`Unknown path type in TaxRuleForm: ${type}`);
      return null;
  }
};

const toInputNumber = (value) =>
  value === null || value === undefined || value === "" ? "" : String(value);

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatAmount = (value, currencyUnit) =>
  `${Number(value || 0).toLocaleString("ko-KR")}${currencyUnit || ""}`;

const formatPercent = (value) => `${Number(value || 0)}%`;

const getCalculationModeFromRule = (rule = {}) => {
  const nextMode = String(rule?.calculationMode || "").trim().toLowerCase();

  if (
    nextMode === "flat_rate" ||
    nextMode === "flat_amount" ||
    nextMode === "rate_after_exemption" ||
    nextMode === "progressive"
  ) {
    return nextMode;
  }

  return rule?.type === "percent" ? "flat_rate" : "flat_amount";
};

const getCalculationConfigFromRule = (rule = {}) => {
  const calculationMode = getCalculationModeFromRule(rule);
  const config =
    rule?.calculationConfig && typeof rule.calculationConfig === "object"
      ? rule.calculationConfig
      : {};

  if (calculationMode === "flat_rate") {
    return {
      rate:
        toSafeNumber(config.rate) ??
        toSafeNumber(rule?.value) ??
        0,
    };
  }

  if (calculationMode === "flat_amount") {
    return {
      amount:
        toSafeNumber(config.amount) ??
        toSafeNumber(rule?.value) ??
        0,
    };
  }

  if (calculationMode === "rate_after_exemption") {
    return {
      rate: toSafeNumber(config.rate) ?? 0,
      exemptionAmount: toSafeNumber(config.exemptionAmount) ?? 0,
    };
  }

  const brackets = Array.isArray(config.brackets)
    ? config.brackets
        .map((bracket) => ({
          upToAmount:
            bracket?.upToAmount === null || bracket?.upToAmount === undefined
              ? ""
              : toInputNumber(bracket.upToAmount),
          rate: toInputNumber(bracket?.rate ?? ""),
        }))
        .filter(
          (bracket) =>
            bracket.rate !== "" || bracket.upToAmount !== "",
        )
    : [];

  return {
    brackets: brackets.length > 0 ? brackets : createDefaultProgressiveBrackets(),
  };
};

const buildDisplaySummary = (calculationMode, calculationConfig, currencyUnit) => {
  if (calculationMode === "flat_rate") {
    return `비율 ${formatPercent(calculationConfig.rate)}`;
  }

  if (calculationMode === "flat_amount") {
    return `고정액 ${formatAmount(calculationConfig.amount, currencyUnit)}`;
  }

  if (calculationMode === "rate_after_exemption") {
    return `면세 ${formatAmount(calculationConfig.exemptionAmount, currencyUnit)} 후 ${formatPercent(calculationConfig.rate)}`;
  }

  const bracketCount = Array.isArray(calculationConfig.brackets)
    ? calculationConfig.brackets.length
    : 0;
  return `누진 ${Math.max(1, bracketCount)}단계`;
};

const getInitialFormState = (initialData) => {
  const calculationMode = getCalculationModeFromRule(initialData);
  const calculationConfig = getCalculationConfigFromRule(initialData);
  const targetType = initialData?.targetType || "all";

  return {
    name: initialData?.name || "",
    description: initialData?.description || "",
    calculationMode,
    rate:
      calculationMode === "flat_rate" || calculationMode === "rate_after_exemption"
        ? toInputNumber(calculationConfig.rate)
        : "",
    amount:
      calculationMode === "flat_amount"
        ? toInputNumber(calculationConfig.amount)
        : "",
    exemptionAmount:
      calculationMode === "rate_after_exemption"
        ? toInputNumber(calculationConfig.exemptionAmount)
        : "",
    progressiveBrackets:
      calculationMode === "progressive"
        ? calculationConfig.brackets
        : createDefaultProgressiveBrackets(),
    targetMode: ["individual", "credit_tier"].includes(targetType) ? targetType : "all",
    selectedStudentUids:
      targetType === "individual" && Array.isArray(initialData?.targetValue)
        ? initialData.targetValue
        : [],
    selectedCreditTierIds:
      targetType === "credit_tier" && Array.isArray(initialData?.targetValue)
        ? initialData.targetValue
        : [],
    isActive: initialData?.isActive ?? true,
  };
};

const TaxRuleFormModal = ({
  isOpen,
  onClose,
  isEditingMode = false,
  initialData = null,
  onSubmitSuccess,
  classId: _classIdProp,
  "data-tour": dataTour,
}) => {
  const { userData, classId, classData, loading: userContextLoading } = useUser();
  const currencyUnit = classData?.currencyUnit || "원";

  const createBlankFormState = useCallback(
    () => getInitialFormState(null),
    [],
  );

  const [formData, setFormData] = useState(createBlankFormState());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (isEditingMode && initialData) {
      setFormData(getInitialFormState(initialData));
      return;
    }

    setFormData(createBlankFormState());
  }, [createBlankFormState, initialData, isEditingMode]);

  if (userContextLoading) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="세금 규칙">
        <div className="flex items-center justify-center py-8">
          <Spinner className="mr-2" />
          <span>학급 정보를 불러오는 중입니다...</span>
        </div>
      </Modal>
    );
  }

  if (!classId || !userData) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="세금 규칙">
        <Card noPadding>
          <Card.Content className="py-8 text-center">
            <p className="text-red-600">
              세금 규칙 폼에 필요한 학급 또는 사용자 정보를 찾을 수 없습니다.
            </p>
          </Card.Content>
        </Card>
      </Modal>
    );
  }

  const handleTextChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFormError("");
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleTargetModeChange = (event) => {
    const targetMode = event.target.value;
    setFormError("");
    setFormData((prev) => ({
      ...prev,
      targetMode,
    }));
  };

  const handleCalculationModeChange = (event) => {
    const calculationMode = event.target.value;
    setFormError("");
    setFormData((prev) => ({
      ...prev,
      calculationMode,
      progressiveBrackets:
        calculationMode === "progressive" && prev.progressiveBrackets.length === 0
          ? createDefaultProgressiveBrackets()
          : prev.progressiveBrackets,
    }));
  };

  const handleStudentSelectionChange = (uids) => {
    setFormData((prev) => ({ ...prev, selectedStudentUids: uids }));
  };

  const handleCreditTierSelectionChange = (tierIds) => {
    setFormData((prev) => ({ ...prev, selectedCreditTierIds: tierIds }));
  };

  const handleBracketChange = (index, field, value) => {
    setFormError("");
    setFormData((prev) => ({
      ...prev,
      progressiveBrackets: prev.progressiveBrackets.map((bracket, bracketIndex) =>
        bracketIndex === index ? { ...bracket, [field]: value } : bracket,
      ),
    }));
  };

  const handleAddBracket = () => {
    setFormData((prev) => ({
      ...prev,
      progressiveBrackets: [
        ...prev.progressiveBrackets,
        createEmptyBracket(),
      ],
    }));
  };

  const handleRemoveBracket = (index) => {
    setFormData((prev) => {
      const nextBrackets = prev.progressiveBrackets.filter(
        (_, bracketIndex) => bracketIndex !== index,
      );

      return {
        ...prev,
        progressiveBrackets:
          nextBrackets.length > 0 ? nextBrackets : createDefaultProgressiveBrackets(),
      };
    });
  };

  const validateCalculation = () => {
    if (formData.calculationMode === "flat_rate") {
      const rate = toSafeNumber(formData.rate);
      if (rate === null || rate < 0) return "세율은 0 이상의 숫자로 입력해 주세요.";
      return null;
    }

    if (formData.calculationMode === "flat_amount") {
      const amount = toSafeNumber(formData.amount);
      if (amount === null || amount < 0) return "고정액은 0 이상의 숫자로 입력해 주세요.";
      return null;
    }

    if (formData.calculationMode === "rate_after_exemption") {
      const rate = toSafeNumber(formData.rate);
      const exemptionAmount = toSafeNumber(formData.exemptionAmount);

      if (rate === null || rate < 0) return "세율은 0 이상의 숫자로 입력해 주세요.";
      if (exemptionAmount === null || exemptionAmount < 0) {
        return "비과세 한도는 0 이상의 숫자로 입력해 주세요.";
      }
      return null;
    }

    const brackets = formData.progressiveBrackets || [];
    if (brackets.length === 0) return "누진세 구간을 하나 이상 입력해 주세요.";

    let previousUpper = 0;
    for (let index = 0; index < brackets.length; index += 1) {
      const bracket = brackets[index];
      const rate = toSafeNumber(bracket.rate);

      if (rate === null || rate < 0) {
        return `${index + 1}구간 세율을 0 이상의 숫자로 입력해 주세요.`;
      }

      const rawUpper = bracket.upToAmount;
      const isLast = index === brackets.length - 1;

      if (rawUpper === "") {
        if (!isLast) {
          return `${index + 1}구간 상한은 마지막 구간이 아니면 비워둘 수 없습니다.`;
        }
        continue;
      }

      const upper = toSafeNumber(rawUpper);
      if (upper === null || upper <= 0) {
        return `${index + 1}구간 상한은 0보다 큰 숫자로 입력해 주세요.`;
      }

      if (upper <= previousUpper) {
        return "누진세 구간 상한은 앞 구간보다 크게 입력해 주세요.";
      }

      previousUpper = upper;
    }

    return null;
  };

  const buildCalculationPayload = () => {
    if (formData.calculationMode === "flat_rate") {
      const rate = Number(formData.rate || 0);
      return {
        calculationMode: "flat_rate",
        calculationConfig: { rate },
        displaySummary: buildDisplaySummary("flat_rate", { rate }, currencyUnit),
        legacyType: "percent",
        legacyValue: rate,
      };
    }

    if (formData.calculationMode === "flat_amount") {
      const amount = Number(formData.amount || 0);
      return {
        calculationMode: "flat_amount",
        calculationConfig: { amount },
        displaySummary: buildDisplaySummary("flat_amount", { amount }, currencyUnit),
        legacyType: "fixed",
        legacyValue: amount,
      };
    }

    if (formData.calculationMode === "rate_after_exemption") {
      const rate = Number(formData.rate || 0);
      const exemptionAmount = Number(formData.exemptionAmount || 0);
      return {
        calculationMode: "rate_after_exemption",
        calculationConfig: { rate, exemptionAmount },
        displaySummary: buildDisplaySummary(
          "rate_after_exemption",
          { rate, exemptionAmount },
          currencyUnit,
        ),
        legacyType: "fixed",
        legacyValue: 0,
      };
    }

    const brackets = formData.progressiveBrackets.map((bracket) => ({
      upToAmount:
        bracket.upToAmount === "" ? null : Number(bracket.upToAmount || 0),
      rate: Number(bracket.rate || 0),
    }));

    return {
      calculationMode: "progressive",
      calculationConfig: { brackets },
      displaySummary: buildDisplaySummary("progressive", { brackets }, currencyUnit),
      legacyType: "fixed",
      legacyValue: 0,
    };
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");

    if (!formData.name.trim()) {
      setFormError("세금 규칙 이름을 입력해 주세요.");
      return;
    }

    const calculationError = validateCalculation();
    if (calculationError) {
      setFormError(calculationError);
      return;
    }

    let targetType = "all";
    let targetValue = null;

    if (formData.targetMode === "individual") {
      if ((formData.selectedStudentUids?.length ?? 0) > 0) {
        targetType = "individual";
        targetValue = formData.selectedStudentUids;
      }
    } else if (formData.targetMode === "credit_tier") {
      if ((formData.selectedCreditTierIds?.length ?? 0) === 0) {
        setFormError("적용할 신용등급을 1개 이상 선택해 주세요.");
        return;
      }
      targetType = "credit_tier";
      targetValue = formData.selectedCreditTierIds;
    }

    const calculationPayload = buildCalculationPayload();

    const payload = {
      name: formData.name.trim(),
      description: (formData.description || "").trim(),
      schemaVersion: 2,
      calculationMode: calculationPayload.calculationMode,
      calculationConfig: calculationPayload.calculationConfig,
      displaySummary: calculationPayload.displaySummary,
      type: calculationPayload.legacyType,
      value: calculationPayload.legacyValue,
      autoDeduct: true,
      targetType,
      targetValue,
      isActive: !!formData.isActive,
      lastModifiedAt: serverTimestamp(),
    };

    setIsSubmitting(true);

    try {
      if (isEditingMode && initialData?.id) {
        const refPath = getPath("taxRule", classId, initialData.id);
        await updateDoc(doc(db, refPath), payload);
        onSubmitSuccess?.("세금 규칙이 성공적으로 수정되었습니다.");
      } else {
        const colPath = getPath("taxRules", classId);
        await addDoc(collection(db, colPath), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        onSubmitSuccess?.("새 세금 규칙이 성공적으로 추가되었습니다.");
      }

      onClose?.();
    } catch (error) {
      console.error(error);
      setFormError(`저장 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderCalculationFields = () => {
    if (formData.calculationMode === "flat_rate") {
      return (
        <div>
          <label htmlFor="tax-rule-rate" className="mb-2 block text-sm font-medium text-slate-700">
            세율 (%)*
          </label>
          <input
            id="tax-rule-rate"
            name="rate"
            type="number"
            min="0"
            step="any"
            value={formData.rate}
            onChange={handleTextChange}
            disabled={isSubmitting}
            className="w-full rounded-xl border border-blue-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            급여 총액에 입력한 비율을 그대로 적용합니다.
          </p>
        </div>
      );
    }

    if (formData.calculationMode === "flat_amount") {
      return (
        <div>
          <label htmlFor="tax-rule-amount" className="mb-2 block text-sm font-medium text-slate-700">
            고정액* (1주 기준 {currencyUnit})
          </label>
          <input
            id="tax-rule-amount"
            name="amount"
            type="number"
            min="0"
            step="any"
            value={formData.amount}
            onChange={handleTextChange}
            disabled={isSubmitting}
            className="w-full rounded-xl border border-blue-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            지급 주차 수만큼 자동으로 곱해집니다.
          </p>
        </div>
      );
    }

    if (formData.calculationMode === "rate_after_exemption") {
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tax-rule-exemption" className="mb-2 block text-sm font-medium text-slate-700">
              비과세 한도* (1주 기준 {currencyUnit})
            </label>
            <input
              id="tax-rule-exemption"
              name="exemptionAmount"
              type="number"
              min="0"
              step="any"
              value={formData.exemptionAmount}
              onChange={handleTextChange}
              disabled={isSubmitting}
              className="w-full rounded-xl border border-blue-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="tax-rule-rate-after-exemption" className="mb-2 block text-sm font-medium text-slate-700">
              초과분 세율 (%)*
            </label>
            <input
              id="tax-rule-rate-after-exemption"
              name="rate"
              type="number"
              min="0"
              step="any"
              value={formData.rate}
              onChange={handleTextChange}
              disabled={isSubmitting}
              className="w-full rounded-xl border border-blue-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs text-slate-500">
              예: 주당 1,000{currencyUnit}까지는 면세, 그 초과분에만 3%를 적용합니다.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">누진세 구간*</p>
            <p className="mt-1 text-xs text-slate-500">
              각 구간 상한은 1주 기준입니다. 마지막 구간은 상한을 비워두면 초과 구간으로 처리됩니다.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleAddBracket}
            disabled={isSubmitting}
          >
            구간 추가
          </Button>
        </div>

        <div className="space-y-2">
          {formData.progressiveBrackets.map((bracket, index) => (
            <div
              key={`progressive-bracket-${index + 1}`}
              className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  {index === formData.progressiveBrackets.length - 1
                    ? "상한 (비우면 초과 구간)"
                    : "상한 금액"}
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={bracket.upToAmount}
                  onChange={(event) =>
                    handleBracketChange(index, "upToAmount", event.target.value)
                  }
                  disabled={isSubmitting}
                  className="w-full rounded-xl border border-blue-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={`예: ${(index + 1) * 1000}`}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  세율 (%)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={bracket.rate}
                  onChange={(event) =>
                    handleBracketChange(index, "rate", event.target.value)
                  }
                  disabled={isSubmitting}
                  className="w-full rounded-xl border border-blue-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  tone="rose"
                  onClick={() => handleRemoveBracket(index)}
                  disabled={isSubmitting || formData.progressiveBrackets.length === 1}
                >
                  삭제
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditingMode ? "세금 규칙 수정" : "새 세금 규칙 추가"}
      size="lg"
      data-tour={dataTour}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="tax-rule-name" className="mb-2 block text-sm font-medium text-slate-700">
            규칙 이름*
          </label>
          <input
            id="tax-rule-name"
            name="name"
            type="text"
            value={formData.name}
            onChange={handleTextChange}
            disabled={isSubmitting}
            required
            className="w-full rounded-xl border border-blue-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="예: 근로소득세"
          />
        </div>

        <div>
          <label htmlFor="tax-rule-desc" className="mb-2 block text-sm font-medium text-slate-700">
            설명
          </label>
          <textarea
            id="tax-rule-desc"
            name="description"
            rows={3}
            value={formData.description}
            onChange={handleTextChange}
            disabled={isSubmitting}
            className="w-full rounded-xl border border-blue-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="이 규칙이 언제 적용되는지 간단히 적어 주세요."
          />
        </div>

        <div>
          <label className="mb-3 block text-sm font-medium text-slate-700">계산식*</label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CALCULATION_MODE_OPTIONS.filter((option) => option.value).map((option) => (
              <label
                key={option.value}
                className={`cursor-pointer rounded-xl border p-3 transition ${
                  formData.calculationMode === option.value
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="calculationMode"
                  value={option.value}
                  checked={formData.calculationMode === option.value}
                  onChange={handleCalculationModeChange}
                  disabled={isSubmitting}
                  className="sr-only"
                />
                <div className="text-sm font-semibold text-slate-900">{option.label}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{option.description}</div>
              </label>
            ))}
          </div>
        </div>

        <div>{renderCalculationFields()}</div>

        <div>
          <label className="mb-3 block text-sm font-medium text-slate-700">적용 대상</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {TARGET_MODE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`cursor-pointer rounded-xl border p-3 transition ${
                  formData.targetMode === option.value
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                } ${isSubmitting ? "cursor-not-allowed opacity-70" : ""}`}
              >
                <input
                  type="radio"
                  name="targetMode"
                  value={option.value}
                  checked={formData.targetMode === option.value}
                  onChange={handleTargetModeChange}
                  disabled={isSubmitting}
                  className="sr-only"
                />
                <div className="text-sm font-semibold text-slate-900">{option.title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  {option.description}
                </div>
              </label>
            ))}
          </div>

          {formData.targetMode !== "all" && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              {formData.targetMode === "individual" ? (
                <div className="space-y-2">
                  <StudentSelector
                    label="학생 선택"
                    selectedUids={formData.selectedStudentUids}
                    onChange={handleStudentSelectionChange}
                    multiple
                  />
                  <p className="text-xs text-slate-500">
                    학생을 선택하지 않으면 전체 학생에게 적용됩니다.
                  </p>
                </div>
              ) : null}

              {formData.targetMode === "credit_tier" ? (
                <div className="space-y-2">
                  <CreditTierSelector
                    label="신용등급 선택"
                    selectedTierIds={formData.selectedCreditTierIds}
                    onChange={handleCreditTierSelectionChange}
                  />
                  <p className="text-xs text-slate-500">
                    하나 이상 선택하면 해당 등급 학생에게만 적용됩니다.
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          기존 비율/고정액 규칙과 충돌하지 않도록 새 계산식은 하위호환 필드를 함께 저장합니다.
        </div>

        <div className="flex items-center gap-3">
          <input
            id="tax-rule-active"
            name="isActive"
            type="checkbox"
            checked={formData.isActive}
            onChange={handleTextChange}
            disabled={isSubmitting}
          />
          <label htmlFor="tax-rule-active" className="text-sm font-medium text-slate-700">
            규칙 활성화
          </label>
        </div>

        {formError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {formError}
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            취소
          </Button>
          <Button tone="blue" kind="solid" size="md" type="submit" disabled={isSubmitting} >
            {isSubmitting ? (
              <>
                <Spinner size="sm" className="mr-2" />
                {isEditingMode ? "수정 중..." : "추가 중..."}
              </>
            ) : isEditingMode ? (
              "규칙 수정"
            ) : (
              "규칙 추가"
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default TaxRuleFormModal;
