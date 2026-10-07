import { useNumberFormat as useConfiguredMoney } from "../../../contexts/NumberFormatContext";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { Calendar, Sparkles } from "lucide-react";

import { db } from "../../../firebase";
import { Badge, Button, Modal, Spinner } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { getBonusDeductionPolicy } from "../../../utils/taxPolicy";
import { payIndividualBonus } from "../services/payrollService";

const parseNumericInput = (value) => {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return 0;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = toDate(value);
  if (!date) return "-";

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
};

const formatPeriodText = (payslip) => {
  if (!payslip) return "-";

  const start = formatDate(payslip.paymentStartDate);
  const end = formatDate(payslip.paymentEndDate);
  if (start !== "-" && end !== "-") return `${start} ~ ${end}`;

  return payslip.paymentPeriodDescription || "급여 명세서";
};



const formatRateLabel = (value) =>
  Number(value || 0).toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

const normalizePayslipType = (value) =>
  String(value || "salary").trim().toLowerCase() === "bonus" ? "bonus" : "salary";

const getStudentPayslipsRef = (classId, studentUid) =>
  collection(db, "classes", classId, "students", studentUid, "paySlips");

const mapSnapshotDocsToPayslips = (snapshot) =>
  snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((payslip) => normalizePayslipType(payslip?.slipType) === "salary");

const fetchRecentSalaryPayslips = async (classId, studentUid) => {
  const paySlipsRef = getStudentPayslipsRef(classId, studentUid);

  try {
    const salaryQuery = query(
      paySlipsRef,
      where("slipType", "==", "salary"),
      orderBy("createdAt", "desc"),
      limit(2),
    );
    const snapshot = await getDocs(salaryQuery);
    return mapSnapshotDocsToPayslips(snapshot);
  } catch (error) {
    console.warn("[BulkBonusPaymentModal] salary query failed; falling back:", error);
    const fallbackQuery = query(paySlipsRef, orderBy("createdAt", "desc"), limit(8));
    const snapshot = await getDocs(fallbackQuery);
    return mapSnapshotDocsToPayslips(snapshot).slice(0, 2);
  }
};

const getJobRows = (payslip) => {
  if (!payslip?.jobBreakdowns) return [];

  return Object.entries(payslip.jobBreakdowns).map(([jobName, detail]) => ({
    jobName,
    baseSalary: Number(detail?.baseSalary || 0),
    weeklyBaseSalary: Number(detail?.weeklyBaseSalary || 0),
  }));
};

const createEmptyRowConfig = () => ({
  bonusMode: "fixed",
  bonusValue: "",
  note: "",
});

export default function BulkBonusPaymentModal({
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

  const [loadingPayslips, setLoadingPayslips] = useState(false);
  const [payslipChoices, setPayslipChoices] = useState({});
  const [selectedPayslipIds, setSelectedPayslipIds] = useState({});
  const [rowConfigs, setRowConfigs] = useState({});
  const [bulkPayslipIndex, setBulkPayslipIndex] = useState(0);
  const [bulkBonusMode, setBulkBonusMode] = useState("fixed");
  const [bulkBonusValue, setBulkBonusValue] = useState("");
  const [bulkNote, setBulkNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !classId || students.length === 0) return;

    let cancelled = false;

    const fetchAll = async () => {
      setLoadingPayslips(true);
      setPayslipChoices({});
      setSelectedPayslipIds({});
      setRowConfigs({});
      setBulkPayslipIndex(0);
      setBulkBonusMode("fixed");
      setBulkBonusValue("");
      setBulkNote("");
      setIsSubmitting(false);

      try {
        const entries = await Promise.all(
          students.map(async (student) => {
            const payslips = await fetchRecentSalaryPayslips(classId, student.uid);
            return [student.uid, payslips];
          }),
        );

        if (cancelled) return;

        const nextChoices = {};
        const nextSelectedIds = {};
        const nextRowConfigs = {};
        entries.forEach(([studentUid, payslips]) => {
          nextChoices[studentUid] = payslips;
          nextSelectedIds[studentUid] = payslips[0]?.id || "";
          nextRowConfigs[studentUid] = createEmptyRowConfig();
        });
        setPayslipChoices(nextChoices);
        setSelectedPayslipIds(nextSelectedIds);
        setRowConfigs(nextRowConfigs);
      } catch (error) {
        console.error("[BulkBonusPaymentModal] failed to fetch payslips:", error);
        if (!cancelled) {
          showFeedback("최근 급여 명세서를 불러오지 못했습니다.", "error");
        }
      } finally {
        if (!cancelled) setLoadingPayslips(false);
      }
    };

    fetchAll();

    return () => {
      cancelled = true;
    };
  }, [classId, isOpen, showFeedback, students]);

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

  const getSelectedPayslip = useCallback((studentUid) => {
    const choices = payslipChoices[studentUid] || [];
    const selectedId = selectedPayslipIds[studentUid] || "";
    return choices.find((payslip) => payslip.id === selectedId) || choices[0] || null;
  }, [payslipChoices, selectedPayslipIds]);

  const bulkPayslipOptions = useMemo(
    () =>
      [0, 1].map((optionIndex) => {
        const labelPrefix = optionIndex === 0 ? "최신 급여 명세서" : "이전 급여 명세서";
        const periodTexts = students
          .map((student) => payslipChoices[student.uid]?.[optionIndex])
          .filter(Boolean)
          .map(formatPeriodText);
        const uniquePeriodTexts = [...new Set(periodTexts)];

        if (uniquePeriodTexts.length === 0) {
          return {
            value: optionIndex,
            label: `${labelPrefix} 없음`,
            hasPayslip: false,
          };
        }

        if (uniquePeriodTexts.length === 1) {
          return {
            value: optionIndex,
            label: `${labelPrefix} (${uniquePeriodTexts[0]})`,
            hasPayslip: true,
          };
        }

        return {
          value: optionIndex,
          label: `${labelPrefix} (${uniquePeriodTexts[0]} 외 ${uniquePeriodTexts.length - 1}개 기간)`,
          hasPayslip: true,
        };
      }),
    [payslipChoices, students],
  );

  const applyBulkPayslip = () => {
    setSelectedPayslipIds((prev) => {
      const next = { ...prev };
      students.forEach((student) => {
        const choices = payslipChoices[student.uid] || [];
        if (choices[bulkPayslipIndex]?.id) {
          next[student.uid] = choices[bulkPayslipIndex].id;
        }
      });
      return next;
    });
  };

  const applyBulkBonus = () => {
    if (!(parseNumericInput(bulkBonusValue) > 0)) {
      showFeedback("일괄 입력할 성과급 값을 0보다 크게 입력해 주세요.", "warning");
      return;
    }

    setRowConfigs((prev) => {
      const next = { ...prev };
      students.forEach((student) => {
        next[student.uid] = {
          ...createEmptyRowConfig(),
          ...(prev[student.uid] || {}),
          bonusMode: bulkBonusMode,
          bonusValue: bulkBonusValue,
        };
      });
      return next;
    });
  };

  const applyBulkNote = () => {
    setRowConfigs((prev) => {
      const next = { ...prev };
      students.forEach((student) => {
        next[student.uid] = {
          ...createEmptyRowConfig(),
          ...(prev[student.uid] || {}),
          note: bulkNote,
        };
      });
      return next;
    });
  };

  const previewRows = useMemo(
    () =>
      students.map((student) => {
        const payslip = getSelectedPayslip(student.uid);
        const jobRows = getJobRows(payslip);
        const appliedJobs = jobRows;
        const rowConfig = {
          ...createEmptyRowConfig(),
          ...(rowConfigs[student.uid] || {}),
        };
        const numericBonusValue = parseNumericInput(rowConfig.bonusValue);
        const referenceAmount = appliedJobs.reduce(
          (sum, job) => sum + job.baseSalary,
          0,
        );
        const grossAmount =
          rowConfig.bonusMode === "percent"
            ? appliedJobs.reduce(
                (sum, job) =>
                  sum + Math.round(job.baseSalary * (numericBonusValue / 100)),
                0,
              )
            : Math.round(numericBonusValue);
        const deductionAmount =
          isBonusDeductionEnabled && grossAmount > 0
            ? Math.min(
                grossAmount,
                Math.round(grossAmount * (bonusDeductionRate / 100)),
              )
            : 0;
        const netAmount = Math.max(0, grossAmount - deductionAmount);
        let status = "지급 가능";
        if (!payslip?.id) status = "명세서 없음";
        else if (jobRows.length === 0) status = "급여 내역 없음";
        else if (!(numericBonusValue > 0) || !(grossAmount > 0)) {
          status = "값 입력 필요";
        }

        return {
          student,
          payslip,
          choices: payslipChoices[student.uid] || [],
          rowConfig,
          numericBonusValue,
          jobRows,
          appliedJobs,
          referenceAmount,
          grossAmount,
          deductionAmount,
          netAmount,
          canPay: status === "지급 가능",
          status,
        };
      }),
    [
      bonusDeductionRate,
      getSelectedPayslip,
      isBonusDeductionEnabled,
      payslipChoices,
      rowConfigs,
      students,
    ],
  );

  const payableRows = previewRows.filter((row) => row.canPay);
  const canSubmit = !loadingPayslips && !isSubmitting && payableRows.length > 0;

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
          const result = await payIndividualBonus(classId, row.student.uid, {
            basePayslipId: row.payslip.id,
            bonusEntryMode: "shared",
            selectedJobNames: row.appliedJobs.map((job) => job.jobName),
            bonusMode: row.rowConfig.bonusMode,
            bonusValue: row.numericBonusValue,
            jobBonusConfigs: [],
            note: row.rowConfig.note.trim(),
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
        showFeedback(
          `${successCount}명 지급, ${failRows.length}명 실패 (${preview}${
            remainCount > 0 ? ` 외 ${remainCount}명` : ""
          })`,
          "warning",
        );
        return;
      }

      showFeedback(`${successCount}명 성과급 지급 완료`, "success");
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
            <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">성과급 일괄 지급</h2>
              <p className="text-sm text-slate-500">
                {students.length}명의 학생에게 공통 설정을 적용한 뒤 학생별로 수정할 수 있습니다.
              </p>
            </div>
          </div>
          <Button kind="ghost" tone="slate" size="sm" onClick={handleClose}>
            닫기
          </Button>
        </div>

        {loadingPayslips ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50">
            <Spinner size="lg" tone="indigo" />
            <div className="text-sm font-bold text-slate-500">
              선택 학생의 최근 급여 명세서를 불러오는 중입니다.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr,1fr]">
                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                    명세서 일괄 설정
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Calendar className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <select
                        value={bulkPayslipIndex}
                        onChange={(event) => setBulkPayslipIndex(Number(event.target.value))}
                        className="w-full rounded-xl border border-blue-200 bg-blue-50/50 py-3 pl-11 pr-4 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        {bulkPayslipOptions.map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            disabled={!option.hasPayslip}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      kind="outline"
                      tone="blue"
                      className="whitespace-nowrap"
                      onClick={applyBulkPayslip}
                    >
                      일괄 적용
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                    성과급 일괄 입력
                  </label>
                  <div className="grid gap-2 lg:grid-cols-[8rem,minmax(0,1fr),auto]">
                    <select
                      value={bulkBonusMode}
                      onChange={(event) => setBulkBonusMode(event.target.value)}
                      className="h-[46px] rounded-xl border border-blue-200 bg-blue-50/50 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      <option value="fixed">고정액</option>
                      <option value="percent">비율</option>
                    </select>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step={bulkBonusMode === "percent" ? "0.1" : "1"}
                        value={bulkBonusValue}
                        onChange={(event) => setBulkBonusValue(event.target.value)}
                        placeholder={bulkBonusMode === "percent" ? "예: 10" : "예: 5000"}
                        className="h-[46px] w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 pr-14 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                        {bulkBonusMode === "percent" ? "%" : currencyUnit}
                      </span>
                    </div>
                    <Button size="sm"
                      kind="outline"
                      tone="blue"
                      className="h-[46px] whitespace-nowrap"
                      onClick={applyBulkBonus}
                    >
                      일괄 입력
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                    사유 일괄 입력
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={200}
                      value={bulkNote}
                      onChange={(event) => setBulkNote(event.target.value)}
                      placeholder="공통 사유를 입력한 뒤 일괄 적용"
                      className="h-[46px] min-w-0 flex-1 rounded-xl border border-blue-200 bg-blue-50/50 px-4 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <Button size="sm"
                      kind="outline"
                      tone="blue"
                      className="h-[46px] whitespace-nowrap"
                      onClick={applyBulkNote}
                    >
                      일괄 입력
                    </Button>
                  </div>
                  <p className="text-[11px] font-medium text-slate-400">
                    표에서 학생별 사유를 다시 수정할 수 있습니다.
                  </p>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div className="text-sm font-black text-slate-800">
                  학생별 지급 설정
                </div>
                <Badge tone={isBonusDeductionEnabled ? "indigo" : "slate"}>
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
                      <th className="p-3">기준 명세서</th>
                      <th className="p-3 text-right">기준 급여</th>
                      <th className="p-3 text-center">직업</th>
                      <th className="p-3">방식</th>
                      <th className="p-3">성과급 값</th>
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
                          {row.choices.length > 0 ? (
                            <div className="relative">
                              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <select
                                value={selectedPayslipIds[row.student.uid] || ""}
                                onChange={(event) =>
                                  setSelectedPayslipIds((prev) => ({
                                    ...prev,
                                    [row.student.uid]: event.target.value,
                                  }))
                                }
                                className="w-full min-w-[190px] rounded-xl border border-blue-200 bg-blue-50/50 py-2 pl-9 pr-3 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                              >
                                {row.choices.map((payslip, index) => (
                                  <option key={payslip.id} value={payslip.id}>
                                    {index === 0 ? "최신" : "이전"} {formatPeriodText(payslip)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-600">
                          {row.referenceAmount > 0
                            ? formatCurrency(row.referenceAmount, currencyUnit)
                            : "-"}
                        </td>
                        <td className="p-3 text-center">
                          <Badge tone={row.jobRows.length > 0 ? "indigo" : "slate"}>
                            {row.jobRows.length}개
                          </Badge>
                        </td>
                        <td className="p-3">
                          <select
                            value={row.rowConfig.bonusMode}
                            onChange={(event) =>
                              updateRowConfig(row.student.uid, {
                                bonusMode: event.target.value,
                              })
                            }
                            className="w-24 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                          >
                            <option value="fixed">고정액</option>
                            <option value="percent">비율</option>
                          </select>
                        </td>
                        <td className="p-3">
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              step={row.rowConfig.bonusMode === "percent" ? "0.1" : "1"}
                              value={row.rowConfig.bonusValue}
                              onChange={(event) =>
                                updateRowConfig(row.student.uid, {
                                  bonusValue: event.target.value,
                                })
                              }
                              className="w-32 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 pr-10 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                              {row.rowConfig.bonusMode === "percent" ? "%" : currencyUnit}
                            </span>
                          </div>
                        </td>
                        <td className="p-3">
                          <input
                            type="text"
                            maxLength={200}
                            value={row.rowConfig.note}
                            onChange={(event) =>
                              updateRowConfig(row.student.uid, {
                                note: event.target.value,
                              })
                            }
                            placeholder="개별 사유"
                            className="w-full min-w-[220px] rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
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
              성과급은 각 학생의 선택 명세서 전체 기준 급여로 계산됩니다. 비율 입력 시 세전 기준 급여에 비율을 적용하고,
              고정액 입력 시 입력한 금액을 해당 학생의 성과급 총액으로 지급합니다.
            </div>
          </div>
        )}

        <div className="sticky bottom-0 z-10 -mx-5 flex justify-end gap-3 border-t border-slate-200 bg-white/95 px-5 pb-1 pt-4 backdrop-blur sm:-mx-6 sm:px-6">
          <Button kind="outline" tone="slate" onClick={handleClose}>
            취소
          </Button>
          <Button
            tone="blue"
            icon={Sparkles}
            isLoading={isSubmitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {payableRows.length}명 성과급 지급
          </Button>
        </div>
      </div>
    </Modal>
  );
}
