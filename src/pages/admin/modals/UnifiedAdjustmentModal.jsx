import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  CurrencyDollarIcon,
  MinusIcon,
  PlusIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";

import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { Button, InputField, Modal } from "../../../components/ui";
import { adjustStudentAssetsService } from "../services/assetAdminService";
import { createFinancialRequestTracker } from "../../../utils/financialRequests";

const sanitizeNumber = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[^\d.-]/g, "");
};

const parseNumber = (value) => parseFloat(sanitizeNumber(value));

const buildAdjustTypeMeta = (missionTokenLabel) => ({
  usdBalance: {
    label: "외화(FIN)",
    actionLabel: "외화 조정",
    amountLabel: "조정 금액 (FIN)",
    tone: "blue",
    activeClass: "text-blue-600",
    iconClass: "bg-blue-100 text-blue-600",
    icon: CurrencyDollarIcon,
    step: 1,
  },
  asset: {
    label: "자산",
    actionLabel: "자산 조정",
    amountLabel: "조정 금액",
    tone: "emerald",
    activeClass: "text-emerald-600",
    iconClass: "bg-emerald-100 text-emerald-600",
    icon: CurrencyDollarIcon,
    step: 100,
  },
  credit: {
    label: "신용",
    actionLabel: "신용점수 조정",
    amountLabel: "조정 점수",
    tone: "blue",
    activeClass: "text-blue-600",
    iconClass: "bg-blue-100 text-blue-600",
    icon: ShieldCheckIcon,
    step: 1,
  },
  missionToken: {
    label: missionTokenLabel,
    actionLabel: `${missionTokenLabel} 조정`,
    amountLabel: "조정 수량",
    tone: "indigo",
    activeClass: "text-indigo-600",
    iconClass: "bg-indigo-100 text-indigo-600",
    icon: SparklesIcon,
    step: 1,
  },
});

const getCurrentValueByType = (student, adjustType) => {
  if (adjustType === "usdBalance") return Number(student?.assets?.usdBalance || 0);
  if (adjustType === "credit") return Number(student?.creditScore || 0);
  if (adjustType === "missionToken") {
    return Number(student?.assets?.missionToken ?? student?.assets?.token ?? 0);
  }
  return Number(student?.assets?.cash || 0);
};

const UnifiedAdjustmentModal = ({
  targets = [],
  onClose,
  initialMode = "increment",
  initialType = "asset",
  allowedTypes = ["asset", "credit", "missionToken", "usdBalance"],
}) => {
  const { classId, missionTokenLabel } = useUser();
  const { showFeedback } = useFeedback();
  const adjustTypeMetaMap = useMemo(
    () => buildAdjustTypeMeta(missionTokenLabel),
    [missionTokenLabel],
  );
  const enabledTypes = useMemo(() => {
    const nextTypes = Array.isArray(allowedTypes)
      ? allowedTypes.filter((type) => adjustTypeMetaMap[type])
      : [];

    return nextTypes.length > 0 ? nextTypes : Object.keys(adjustTypeMetaMap);
  }, [adjustTypeMetaMap, allowedTypes]);
  const defaultAdjustType = enabledTypes.includes(initialType)
    ? initialType
    : enabledTypes[0];

  const [adjustType, setAdjustType] = useState(defaultAdjustType);
  const [operationType, setOperationType] = useState(initialMode);
  const [amountInput, setAmountInput] = useState("");
  const [reason, setReason] = useState("");
  const [commonTableAmount, setCommonTableAmount] = useState("");
  const [commonTableReason, setCommonTableReason] = useState("");
  const [individualAmounts, setIndividualAmounts] = useState({});
  const [individualReasons, setIndividualReasons] = useState({});
  const [incomeSettlementEnabled, setIncomeSettlementEnabled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const foreignRequests = useRef(createFinancialRequestTracker());

  const isMultiple = targets.length > 1;
  const usesTableEditor =
    operationType === "absolute" || (operationType === "increment" && isMultiple);
  const typeMeta = adjustTypeMetaMap[adjustType] || adjustTypeMetaMap.asset;
  const parsedAmount = useMemo(() => parseNumber(amountInput), [amountInput]);
  const parsedCommonTableAmount = useMemo(
    () => parseNumber(commonTableAmount),
    [commonTableAmount],
  );

  useEffect(() => {
    if (enabledTypes.includes(adjustType)) return;
    setAdjustType(defaultAdjustType);
  }, [adjustType, defaultAdjustType, enabledTypes]);

  useEffect(() => {
    if (operationType === "absolute") {
      const nextAmounts = {};
      targets.forEach((student) => {
        nextAmounts[student.uid] = getCurrentValueByType(student, adjustType);
      });
      setIndividualAmounts(nextAmounts);
      return;
    }

    if (operationType === "increment" && isMultiple) {
      const nextAmounts = {};
      targets.forEach((student) => {
        nextAmounts[student.uid] = "";
      });
      setIndividualAmounts(nextAmounts);
    }
  }, [adjustType, isMultiple, operationType, targets]);

  const handleIndividualChange = (uid, field, value) => {
    if (field === "amount") {
      setIndividualAmounts((prev) => ({
        ...prev,
        [uid]: sanitizeNumber(value),
      }));
      return;
    }

    setIndividualReasons((prev) => ({
      ...prev,
      [uid]: value,
    }));
  };

  const handleApplyCommonTableAmount = () => {
    if (!Number.isFinite(parsedCommonTableAmount)) {
      showFeedback(
        operationType === "increment"
          ? "공통 증감값을 확인해주세요."
          : "공통 설정값을 확인해주세요.",
        "warning",
      );
      return;
    }

    const nextAmounts = {};
    targets.forEach((student) => {
      nextAmounts[student.uid] = parsedCommonTableAmount;
    });
    setIndividualAmounts(nextAmounts);
  };

  const handleApplyCommonTableReason = () => {
    if (!commonTableReason.trim()) {
      showFeedback("공통 사유를 입력해주세요.", "warning");
      return;
    }

    const nextReasons = {};
    targets.forEach((student) => {
      nextReasons[student.uid] = commonTableReason;
    });
    setIndividualReasons(nextReasons);
  };

  const handlePaste = (event, startIndex) => {
    event.preventDefault();

    const pastedData = event.clipboardData.getData("text");
    const rows = pastedData.split("\n").filter((row) => row.trim());
    const nextAmounts = { ...individualAmounts };
    const nextReasons = { ...individualReasons };

    rows.forEach((row, rowIndex) => {
      const targetIndex = startIndex + rowIndex;
      const target = targets[targetIndex];
      if (!target) return;

      const cells = row.split("\t");
      const amountValue = parseNumber(cells[0]?.trim());
      const reasonValue = cells[1]?.trim() || "";

      if (Number.isFinite(amountValue)) {
        nextAmounts[target.uid] = amountValue;
      }

      if (reasonValue) {
        nextReasons[target.uid] = reasonValue;
      }
    });

    setIndividualAmounts(nextAmounts);
    setIndividualReasons(nextReasons);
  };

  const canSubmit = useMemo(() => {
    if (!usesTableEditor) {
      return Number.isFinite(parsedAmount) && parsedAmount !== 0 &&
        (adjustType !== "usdBalance" || targets.every((student) =>
          getCurrentValueByType(student, adjustType) + parsedAmount >= 0));
    }

    const hasAllFiniteValues = targets.every((student) => {
      const value = parseNumber(individualAmounts[student.uid]);
      return Number.isFinite(value) && (adjustType !== "usdBalance" ||
        (operationType === "absolute" ? value >= 0 : getCurrentValueByType(student, adjustType) + value >= 0));
    });

    if (!hasAllFiniteValues) return false;
    if (operationType !== "increment") return true;

    return targets.some((student) => {
      const value = Number(parseNumber(individualAmounts[student.uid]));
      return value !== 0;
    });
  }, [adjustType, individualAmounts, operationType, parsedAmount, targets, usesTableEditor]);

  const hasPositiveIncrementInTable = useMemo(() => {
    if (operationType !== "increment" || !usesTableEditor) return false;

    return targets.some((student) => {
      const value = Number(parseNumber(individualAmounts[student.uid]));
      return value > 0;
    });
  }, [individualAmounts, operationType, targets, usesTableEditor]);

  const showIncomeSettlementControls = adjustType === "asset";
  const canMarkAsTaxable =
    adjustType === "asset" &&
    (operationType === "absolute" ||
      (usesTableEditor ? hasPositiveIncrementInTable : parsedAmount > 0));

  const handleSubmit = async () => {
    if (!canSubmit) {
      showFeedback(
        usesTableEditor && operationType === "increment"
          ? "학생별 증감값을 입력해주세요. (전체 0은 불가)"
          : "입력값을 확인해주세요. (0 제외)",
        "warning",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        classId,
        adjustType,
        mode: operationType,
      };

      if (showIncomeSettlementControls) {
        payload.incomeSettlement = {
          taxable: incomeSettlementEnabled && canMarkAsTaxable,
        };
      }

      if (operationType === "increment" && usesTableEditor) {
        payload.increments = targets.map((student) => ({
          uid: student.uid,
          amount: Number(parseNumber(individualAmounts[student.uid])),
          reason: (individualReasons[student.uid] || "").trim(),
        }));
      } else if (operationType === "increment") {
        payload.studentUids = targets.map((student) => student.uid);
        payload.amount = Math.abs(parsedAmount);
        payload.type = parsedAmount > 0 ? "add" : "subtract";
        payload.reason = reason.trim();
      } else {
        payload.adjustments = targets.map((student) => ({
          uid: student.uid,
          amount: Number(parseNumber(individualAmounts[student.uid])),
          reason: (individualReasons[student.uid] || "").trim(),
        }));
      }

      if (adjustType === "usdBalance") {
        await foreignRequests.current.run("usdBalance", (requestId) =>
          adjustStudentAssetsService({ ...payload, requestId }));
      } else {
        await adjustStudentAssetsService(payload);
      }
      showFeedback(
        `${targets.length}명 대상 ${typeMeta.actionLabel}을 완료했습니다.`,
        "success",
      );
      onClose();
    } catch (error) {
      showFeedback(
        error?.message || "처리 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const Icon = typeMeta.icon;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      size={usesTableEditor ? "lg" : "md"}
    >
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl shadow-sm ${typeMeta.iconClass}`}
          >
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">
              {typeMeta.actionLabel}
            </h2>
            <p className="text-sm font-medium text-slate-500">
              {targets.length === 1
                ? targets[0].name
                : `${targets.length}명의 학생 선택`}
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body className="max-h-[70vh] overflow-y-auto">
        <div className="space-y-4">
          {adjustType === "usdBalance" ? (
            <p className="text-sm text-slate-600">실제 FIN 잔액을 조정합니다. 자산표의 학급 화폐 환산액과는 다릅니다.</p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {enabledTypes.length > 1 ? (
              <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
                {enabledTypes.map((key) => {
                  const meta = adjustTypeMetaMap[key];

                  return (
                    <Button
                      key={key}
                      type="button"
                      onClick={() => setAdjustType(key)}
                      className={`flex-1 whitespace-nowrap rounded-md py-1.5 text-xs font-bold transition-all ${
                        adjustType === key
                          ? `bg-white shadow ${meta.activeClass}`
                          : "text-slate-500"
                      }`}
                    >
                      {meta.label}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center rounded-lg bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600">
                {typeMeta.label}
              </div>
            )}

            <div className="flex rounded-lg bg-slate-100 p-1">
              <Button
                type="button"
                onClick={() => setOperationType("increment")}
                className={`flex-1 rounded-md py-1.5 text-xs font-bold transition-all ${
                  operationType === "increment"
                    ? "bg-white shadow text-slate-800"
                    : "text-slate-500"
                }`}
              >
                증감 (+/-)
              </Button>
              <Button
                type="button"
                onClick={() => setOperationType("absolute")}
                className={`flex-1 rounded-md py-1.5 text-xs font-bold transition-all ${
                  operationType === "absolute"
                    ? "bg-white shadow text-slate-800"
                    : "text-slate-500"
                }`}
              >
                설정 (=)
              </Button>
            </div>
          </div>

          {showIncomeSettlementControls && (
            <label className="flex items-center gap-3 rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
                checked={incomeSettlementEnabled && canMarkAsTaxable}
                disabled={!canMarkAsTaxable}
                onChange={(event) =>
                  setIncomeSettlementEnabled(event.target.checked)
                }
              />
              <span>소득세 일괄 발급에 포함</span>
            </label>
          )}

          {!usesTableEditor ? (
            <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 p-4">
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex-1 space-y-1.5">
                  <label className="block pl-1 text-[11px] font-bold uppercase text-slate-400">
                    {typeMeta.amountLabel}
                  </label>
                  <div className="flex items-center gap-1">
                    <Button tone="slate" kind="outline" size="icon-md"
                      type="button"
                      onClick={() =>
                        setAmountInput(String((parsedAmount || 0) - typeMeta.step))
                      }
                      className="flex w-8 items-center justify-center transition-colors"
                    >
                      <MinusIcon className="h-4 w-4" />
                    </Button>
                    <input
                      type="text"
                      value={amountInput}
                      onChange={(event) =>
                        setAmountInput(sanitizeNumber(event.target.value))
                      }
                      className="h-10 w-full rounded-xl border border-blue-200 bg-blue-50/50 text-center text-lg font-bold text-slate-800 outline-none transition-all focus:border-blue-500"
                      placeholder="0"
                    />
                    <Button tone="slate" kind="outline" size="icon-md"
                      type="button"
                      onClick={() =>
                        setAmountInput(String((parsedAmount || 0) + typeMeta.step))
                      }
                      className="flex w-8 items-center justify-center transition-colors"
                    >
                      <PlusIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex-[1.5] space-y-1.5">
                  <label className="block pl-1 text-[11px] font-bold uppercase text-slate-400">
                    변경 사유 (선택)
                  </label>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="사유는 선택입니다. 숫자만 입력해도 적용됩니다."
                    className="h-10 min-h-[40px] w-full resize-none overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-0 text-sm leading-[38px] outline-none transition-all"
                    style={{ lineHeight: "38px", whiteSpace: "nowrap" }}
                    onFocus={(event) => {
                      event.target.style.height = "80px";
                      event.target.style.lineHeight = "normal";
                      event.target.style.paddingTop = "8px";
                      event.target.style.whiteSpace = "normal";
                    }}
                    onBlur={(event) => {
                      if (!event.target.value) {
                        event.target.style.height = "40px";
                        event.target.style.lineHeight = "38px";
                        event.target.style.paddingTop = "0px";
                        event.target.style.whiteSpace = "nowrap";
                      }
                    }}
                  />
                  <p className="pl-1 text-[11px] text-slate-400">
                    사유는 선택입니다. 조정값만 입력해도 바로 적용됩니다.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1.5">
                  <label className="block pl-1 text-[11px] font-bold uppercase text-slate-400">
                    {operationType === "increment"
                      ? "공통 증감값"
                      : "공통 설정값"}
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <InputField
                        value={commonTableAmount}
                        onChange={(event) =>
                          setCommonTableAmount(sanitizeNumber(event.target.value))
                        }
                        placeholder={
                          operationType === "increment"
                            ? "모든 학생에게 동일한 증감값 적용"
                            : "모든 학생에게 동일하게 적용"
                        }
                        className="h-9 text-sm"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      tone="slate"
                      onClick={handleApplyCommonTableAmount}
                      className="shrink-0"
                    >
                      일괄 입력
                    </Button>
                  </div>
                </div>

                <div className="flex-1 space-y-1.5">
                  <label className="block pl-1 text-[11px] font-bold uppercase text-slate-400">
                    공통 사유 (선택)
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <InputField
                        value={commonTableReason}
                        onChange={(event) => setCommonTableReason(event.target.value)}
                        placeholder="공통 사유를 입력한 뒤 일괄 적용"
                        className="h-9 text-sm"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      tone="slate"
                      onClick={handleApplyCommonTableReason}
                      className="shrink-0"
                    >
                      일괄 입력
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <span className="rounded bg-blue-50 px-2 py-1 font-semibold text-blue-600">
                  {operationType === "increment"
                    ? "표에서 증감값/사유를 그대로 붙여넣을 수 있습니다."
                    : "표에서 금액/사유를 그대로 붙여넣을 수 있습니다."}
                </span>
                <span>
                  공통 사유를 먼저 채운 뒤 일부 학생만 개별 사유로 수정할 수
                  있습니다.
                </span>
              </div>

              <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 border-b bg-slate-50">
                    <tr>
                      <th className="w-20 px-3 py-2 text-left text-slate-500">
                        이름
                      </th>
                      <th className="w-28 px-3 py-2 text-center text-slate-500">
                        {operationType === "increment" ? "증감값" : "설정값"}
                      </th>
                      <th className="px-3 py-2 text-left text-slate-500">
                        사유
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {targets.map((student, index) => (
                      <tr key={student.uid}>
                        <td className="bg-slate-50/30 px-3 py-2 font-medium text-slate-600">
                          {student.name}
                        </td>
                        <td className="px-3 py-1">
                          <InputField
                            value={individualAmounts[student.uid] ?? ""}
                            onChange={(event) =>
                              handleIndividualChange(
                                student.uid,
                                "amount",
                                event.target.value,
                              )
                            }
                            onPaste={(event) => handlePaste(event, index)}
                            className="h-8 text-center text-xs font-bold"
                          />
                        </td>
                        <td className="px-3 py-1">
                          <InputField
                            value={individualReasons[student.uid] ?? ""}
                            onChange={(event) =>
                              handleIndividualChange(
                                student.uid,
                                "reason",
                                event.target.value,
                              )
                            }
                            placeholder="개별 사유"
                            className="h-8 text-xs"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <div className="flex w-full gap-2">
          <Button size="xs"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1"
          >
            취소
          </Button>
          <Button size="xs"
            tone={typeMeta.tone}
            onClick={handleSubmit}
            disabled={!canSubmit}
            isLoading={isSubmitting}
            icon={CheckIcon}
            className="flex-[3]"
          >
            적용하기
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default UnifiedAdjustmentModal;
