import { useNumberFormat as useConfiguredMoney } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import { Gift, Hash } from "lucide-react";

import { Badge, Button, Modal } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { getBonusDeductionPolicy } from "../../../utils/taxPolicy";
import { payIndividualIncentive } from "../services/payrollService";

const parseNumericInput = (value) => {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return 0;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};



const formatRateLabel = (value) =>
  Number(value || 0).toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

const createEmptyRowConfig = () => ({
  reason: "",
  incentiveMode: "fixed",
  amount: "",
  quantity: "1",
  unitAmount: "",
});

export default function BulkIncentivePaymentModal({
  isOpen,
  onClose,
  classId,
  students = [],
  onSuccess,
}) {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatCurrency = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const { classData } = useUser();
  const { showFeedback } = useFeedback();
  const currencyUnit = classData?.currencyUnit || "미르";
  const bonusDeductionPolicy = getBonusDeductionPolicy(classData);
  const bonusDeductionRate = Number(bonusDeductionPolicy?.taxRate || 0);
  const isBonusDeductionEnabled =
    bonusDeductionPolicy?.enabled === true && bonusDeductionRate > 0;

  const [rowConfigs, setRowConfigs] = useState({});
  const [bulkReason, setBulkReason] = useState("");
  const [bulkIncentiveMode, setBulkIncentiveMode] = useState("fixed");
  const [bulkAmount, setBulkAmount] = useState("");
  const [bulkQuantity, setBulkQuantity] = useState("1");
  const [bulkUnitAmount, setBulkUnitAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const nextRowConfigs = {};
    students.forEach((student) => {
      nextRowConfigs[student.uid] = createEmptyRowConfig();
    });
    setRowConfigs(nextRowConfigs);
    setBulkReason("");
    setBulkIncentiveMode("fixed");
    setBulkAmount("");
    setBulkQuantity("1");
    setBulkUnitAmount("");
    setIsSubmitting(false);
  }, [isOpen, students]);

  const updateRowConfig = (studentUid, patch) => {
    setRowConfigs((prev) => ({
      ...prev,
      [studentUid]: {
        ...createEmptyRowConfig(),
        ...(prev[studentUid] || {}),
        ...patch,
      },
    }));
  };

  const applyBulkReason = () => {
    if (!bulkReason.trim()) {
      showFeedback("일괄 입력할 지급 사유를 입력해 주세요.", "warning");
      return;
    }

    setRowConfigs((prev) => {
      const next = { ...prev };
      students.forEach((student) => {
        next[student.uid] = {
          ...createEmptyRowConfig(),
          ...(prev[student.uid] || {}),
          reason: bulkReason,
        };
      });
      return next;
    });
  };

  const applyBulkIncentive = () => {
    const parsedAmount = Math.round(parseNumericInput(bulkAmount));
    const parsedQuantity = parseNumericInput(bulkQuantity);
    const parsedUnitAmount = Math.round(parseNumericInput(bulkUnitAmount));
    const grossAmount =
      bulkIncentiveMode === "quantity"
        ? Math.round(parsedQuantity * parsedUnitAmount)
        : parsedAmount;

    if (!(grossAmount > 0)) {
      showFeedback("일괄 입력할 지급 금액을 0보다 크게 입력해 주세요.", "warning");
      return;
    }

    setRowConfigs((prev) => {
      const next = { ...prev };
      students.forEach((student) => {
        next[student.uid] = {
          ...createEmptyRowConfig(),
          ...(prev[student.uid] || {}),
          incentiveMode: bulkIncentiveMode,
          amount: bulkAmount,
          quantity: bulkQuantity,
          unitAmount: bulkUnitAmount,
        };
      });
      return next;
    });
  };

  const previewRows = useMemo(
    () =>
      students.map((student) => {
        const rowConfig = {
          ...createEmptyRowConfig(),
          ...(rowConfigs[student.uid] || {}),
        };
        const parsedAmount = Math.round(parseNumericInput(rowConfig.amount));
        const parsedQuantity = parseNumericInput(rowConfig.quantity);
        const parsedUnitAmount = Math.round(parseNumericInput(rowConfig.unitAmount));
        const trimmedReason = rowConfig.reason.trim();
        const grossAmount =
          rowConfig.incentiveMode === "quantity"
            ? Math.round(parsedQuantity * parsedUnitAmount)
            : parsedAmount;
        const deductionAmount =
          isBonusDeductionEnabled && grossAmount > 0
            ? Math.min(
                grossAmount,
                Math.round(grossAmount * (bonusDeductionRate / 100)),
              )
            : 0;
        const netAmount = Math.max(0, grossAmount - deductionAmount);
        let status = "지급 가능";
        if (!trimmedReason) status = "사유 필요";
        else if (!(grossAmount > 0)) status = "금액 필요";

        return {
          student,
          rowConfig,
          parsedAmount,
          parsedQuantity,
          parsedUnitAmount,
          grossAmount,
          deductionAmount,
          netAmount,
          canPay: status === "지급 가능",
          status,
        };
      }),
    [bonusDeductionRate, isBonusDeductionEnabled, rowConfigs, students],
  );

  const payableRows = previewRows.filter((row) => row.canPay);
  const canSubmit = students.length > 0 && payableRows.length > 0 && !isSubmitting;

  const handleClose = () => {
    if (isSubmitting) return;
    onClose?.();
  };

  const handleSubmit = async () => {
    if (payableRows.length === 0) {
      showFeedback("지급 가능한 학생이 없습니다.", "warning");
      return;
    }

    setIsSubmitting(true);

    try {
      const results = [];
      for (const row of payableRows) {
        try {
          const result = await payIndividualIncentive(classId, row.student.uid, {
            jobName: "",
            reason: row.rowConfig.reason.trim(),
            incentiveMode: row.rowConfig.incentiveMode,
            amount: row.parsedAmount,
            quantity: row.parsedQuantity,
            unitAmount: row.parsedUnitAmount,
            note: "",
          });
          results.push({ success: true, student: row.student, data: result.data });
        } catch (error) {
          results.push({ success: false, student: row.student, error });
        }
      }

      const successCount = results.filter((result) => result.success).length;
      const failRows = results.filter((result) => !result.success);

      if (successCount > 0) {
        onSuccess?.(results);
      }

      if (failRows.length > 0) {
        const preview = failRows
          .slice(0, 3)
          .map((result) => result.student?.name || "학생")
          .join(", ");
        const remainCount = Math.max(0, failRows.length - 3);
        const firstErrorMessage = failRows.find((result) => result.error?.message)
          ?.error?.message;
        showFeedback(
          `${successCount}명 지급, ${failRows.length}명 실패 (${preview}${
            remainCount > 0 ? ` 외 ${remainCount}명` : ""
          })${firstErrorMessage ? `: ${firstErrorMessage}` : ""}`,
          "warning",
        );
        return;
      }

      showFeedback(`${successCount}명 인센티브 지급 완료`, "success");
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="full" showDefaultCloseButton={false}>
      <div className="space-y-5 px-5 pb-6 pt-5 sm:px-6 sm:pb-7 sm:pt-6">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700">
              <Gift className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">
                인센티브 일괄 지급
              </h2>
              <p className="text-sm text-slate-500">
                {students.length}명의 학생에게 일괄 입력 후 학생별로 수정할 수 있습니다.
              </p>
            </div>
          </div>
          <Button kind="ghost" tone="slate" size="sm" onClick={handleClose}>
            닫기
          </Button>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-4 xl:grid-cols-[1.6fr,1fr]">
              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                  금액 일괄 입력
                </label>
                {bulkIncentiveMode === "fixed" ? (
                  <div className="grid gap-2 lg:grid-cols-[9rem,minmax(0,1fr),auto]">
                    <select
                      value={bulkIncentiveMode}
                      onChange={(event) => setBulkIncentiveMode(event.target.value)}
                      className="h-[46px] rounded-xl border border-blue-200 bg-blue-50/50 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="fixed">고정액</option>
                      <option value="quantity">건수 x 단가</option>
                    </select>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={bulkAmount}
                        onChange={(event) => setBulkAmount(event.target.value)}
                        placeholder="예: 3000"
                        className="h-[46px] w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 pr-14 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                        {currencyUnit}
                      </span>
                    </div>
                    <Button size="sm"
                      kind="outline"
                      tone="emerald"
                      className="h-[46px] whitespace-nowrap"
                      onClick={applyBulkIncentive}
                    >
                      일괄 입력
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-2 lg:grid-cols-[9rem,minmax(0,1fr),minmax(0,1fr),auto]">
                    <select
                      value={bulkIncentiveMode}
                      onChange={(event) => setBulkIncentiveMode(event.target.value)}
                      className="h-[46px] rounded-xl border border-blue-200 bg-blue-50/50 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="fixed">고정액</option>
                      <option value="quantity">건수 x 단가</option>
                    </select>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={bulkQuantity}
                        onChange={(event) => setBulkQuantity(event.target.value)}
                        placeholder="건수"
                        className="h-[46px] w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 pr-12 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <Hash className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={bulkUnitAmount}
                        onChange={(event) => setBulkUnitAmount(event.target.value)}
                        placeholder="건당 금액"
                        className="h-[46px] w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 pr-14 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                        {currencyUnit}
                      </span>
                    </div>
                    <Button size="sm"
                      kind="outline"
                      tone="emerald"
                      className="h-[46px] whitespace-nowrap"
                      onClick={applyBulkIncentive}
                    >
                      일괄 입력
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                  사유 일괄 입력
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={60}
                    value={bulkReason}
                    onChange={(event) => setBulkReason(event.target.value)}
                    placeholder="공통 사유를 입력한 뒤 일괄 적용"
                    className="h-[46px] min-w-0 flex-1 rounded-xl border border-blue-200 bg-blue-50/50 px-4 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <Button size="sm"
                    kind="outline"
                    tone="emerald"
                    className="h-[46px] whitespace-nowrap"
                    onClick={applyBulkReason}
                  >
                    일괄 입력
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-black text-slate-800">학생별 지급 설정</div>
              <Badge tone={isBonusDeductionEnabled ? "emerald" : "slate"}>
                {isBonusDeductionEnabled
                  ? `공제 ${formatRateLabel(bonusDeductionRate)}%`
                  : "공제 없음"}
              </Badge>
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="p-3">학생</th>
                    <th className="p-3">방식</th>
                    <th className="p-3">금액</th>
                    <th className="p-3">사유</th>
                    <th className="p-3 text-right">실지급</th>
                    <th className="p-3 text-center">상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previewRows.map((row) => (
                    <tr key={row.student.uid}>
                      <td className="p-3 font-bold text-slate-800">
                        {row.student.name || "학생"}
                      </td>
                      <td className="p-3">
                        <select
                          value={row.rowConfig.incentiveMode}
                          onChange={(event) =>
                            updateRowConfig(row.student.uid, {
                              incentiveMode: event.target.value,
                            })
                          }
                          className="w-28 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          <option value="fixed">고정액</option>
                          <option value="quantity">건수 x 단가</option>
                        </select>
                      </td>
                      <td className="p-3">
                        {row.rowConfig.incentiveMode === "fixed" ? (
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={row.rowConfig.amount}
                              onChange={(event) =>
                                updateRowConfig(row.student.uid, {
                                  amount: event.target.value,
                                })
                              }
                              className="w-32 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 pr-10 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                              {currencyUnit}
                            </span>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={row.rowConfig.quantity}
                              onChange={(event) =>
                                updateRowConfig(row.student.uid, {
                                  quantity: event.target.value,
                                })
                              }
                              placeholder="건수"
                              className="w-20 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                            <div className="relative">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={row.rowConfig.unitAmount}
                                onChange={(event) =>
                                  updateRowConfig(row.student.uid, {
                                    unitAmount: event.target.value,
                                  })
                                }
                                placeholder="단가"
                                className="w-28 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 pr-10 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                              />
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                                {currencyUnit}
                              </span>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          maxLength={60}
                          value={row.rowConfig.reason}
                          onChange={(event) =>
                            updateRowConfig(row.student.uid, {
                              reason: event.target.value,
                            })
                          }
                          placeholder="개별 사유"
                          className="w-full min-w-[180px] rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </td>
                      <td className="p-3 text-right font-mono font-black text-slate-800">
                        {row.canPay ? formatCurrency(row.netAmount, currencyUnit) : "-"}
                      </td>
                      <td className="p-3 text-center">
                        <Badge tone={row.canPay ? "emerald" : "slate"}>
                          {row.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            인센티브는 특정 직업이 아니라 선택한 학생에게 직접 지급됩니다.
          </div>
        </div>

        <div className="sticky bottom-0 z-10 -mx-5 flex justify-end gap-3 border-t border-slate-200 bg-white/95 px-5 pb-1 pt-4 backdrop-blur sm:-mx-6 sm:px-6">
          <Button kind="outline" tone="slate" onClick={handleClose}>
            취소
          </Button>
          <Button
            tone="emerald"
            icon={Gift}
            isLoading={isSubmitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {payableRows.length}명 인센티브 지급
          </Button>
        </div>
      </div>
    </Modal>
  );
}
