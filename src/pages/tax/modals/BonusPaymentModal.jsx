import { useNumberFormat as useConfiguredMoney } from "../../../contexts/NumberFormatContext";
import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { Calendar, Percent, Sparkles, Wallet } from "lucide-react";

import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  Badge,
  Button,
  CardSkeleton,
  Modal,
  SurfaceLoader,
} from "../../../components/ui";
import { getBonusDeductionPolicy } from "../../../utils/taxPolicy";
import {
  isValidStudentPayrollSummaryData,
  normalizeStudentPayrollSummaryData,
} from "../../../utils/overviewSummarySchema";
import { payIndividualBonus } from "../services/payrollService";

const BONUS_BASE_PAYSLIP_LIMIT = 30;

const normalizePayslipType = (value) =>
  String(value || "salary").trim().toLowerCase() === "bonus" ? "bonus" : "salary";

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
  if (start !== "-" && end !== "-") {
    return `${start} ~ ${end}`;
  }

  return payslip.paymentPeriodDescription || "-";
};

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

const getStudentPayslipsRef = (classId, studentUid) =>
  collection(db, "classes", classId, "students", studentUid, "paySlips");

const getStudentPayrollSummaryRef = (classId, studentUid) =>
  doc(db, "classes", classId, "students", studentUid, "dashboardSummary", "payroll");

const getStudentPayslipDocRef = (classId, studentUid, payslipId) =>
  doc(db, "classes", classId, "students", studentUid, "paySlips", payslipId);

const mapSnapshotDocsToPayslips = (snapshot) =>
  snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

const fetchLegacySalaryPayslips = async (classId, studentUid) => {
  const paySlipsRef = getStudentPayslipsRef(classId, studentUid);
  let snapshot;

  try {
    const salaryOnlyQuery = query(
      paySlipsRef,
      where("slipType", "==", "salary"),
      orderBy("createdAt", "desc"),
      limit(BONUS_BASE_PAYSLIP_LIMIT),
    );
    snapshot = await getDocs(salaryOnlyQuery);
  } catch (salaryOnlyQueryError) {
    console.warn(
      "[BonusPaymentModal] salary-only payslip query failed; falling back to legacy query:",
      salaryOnlyQueryError,
    );
    const fallbackQuery = query(
      paySlipsRef,
      orderBy("createdAt", "desc"),
      limit(BONUS_BASE_PAYSLIP_LIMIT),
    );
    snapshot = await getDocs(fallbackQuery);
  }

  return mapSnapshotDocsToPayslips(snapshot).filter(
    (payslip) => normalizePayslipType(payslip?.slipType) === "salary",
  );
};

export default function BonusPaymentModal({
  isOpen,
  onClose,
  classId,
  student,
  onSuccess,
}) {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatCurrency = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { classData } = useUser();
  const { showFeedback } = useFeedback();
  const currencyUnit = classData?.currencyUnit || "미르";
  const bonusDeductionPolicy = getBonusDeductionPolicy(classData);
  const bonusDeductionRate = Number(bonusDeductionPolicy?.taxRate || 0);
  const isBonusDeductionEnabled =
    bonusDeductionPolicy?.enabled === true && bonusDeductionRate > 0;

  const [loadingPayslips, setLoadingPayslips] = useState(false);
  const [loadingSelectedPayslip, setLoadingSelectedPayslip] = useState(false);
  const [basePayslips, setBasePayslips] = useState([]);
  const [selectedPayslipId, setSelectedPayslipId] = useState("");
  const [selectedPayslipDetail, setSelectedPayslipDetail] = useState(null);
  const [isSummaryBackedList, setIsSummaryBackedList] = useState(false);
  const [bonusMode, setBonusMode] = useState("fixed");
  const [bonusValue, setBonusValue] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !classId || !student?.uid) return;

    let cancelled = false;

    const fetchSalaryPayslips = async () => {
      setLoadingPayslips(true);
      setLoadingSelectedPayslip(false);

      try {
        const summarySnap = await getDoc(
          getStudentPayrollSummaryRef(classId, student.uid),
        );
        const summaryData = summarySnap.exists() ? summarySnap.data() || {} : null;

        let salaryPayslips = [];
        let nextSelectedPayslipId = "";
        let nextIsSummaryBackedList = false;

        if (isValidStudentPayrollSummaryData(summaryData)) {
          const normalizedSummary = normalizeStudentPayrollSummaryData(summaryData);
          salaryPayslips = normalizedSummary.recentSalaryPayslips;
          nextSelectedPayslipId =
            normalizedSummary.latestSalaryPayslipId || salaryPayslips[0]?.id || "";
          nextIsSummaryBackedList = true;
        } else {
          salaryPayslips = await fetchLegacySalaryPayslips(classId, student.uid);
          nextSelectedPayslipId = salaryPayslips[0]?.id || "";
        }

        if (cancelled) return;

        setBasePayslips(salaryPayslips);
        setSelectedPayslipId(nextSelectedPayslipId);
        setSelectedPayslipDetail(null);
        setIsSummaryBackedList(nextIsSummaryBackedList);
        setBonusMode("fixed");
        setBonusValue("");
        setNote("");
      } catch (error) {
        console.error("[BonusPaymentModal] failed to fetch payslips:", error);
        if (cancelled) return;

        try {
          const fallbackPayslips = await fetchLegacySalaryPayslips(
            classId,
            student.uid,
          );
          if (cancelled) return;

          setBasePayslips(fallbackPayslips);
          setSelectedPayslipId(fallbackPayslips[0]?.id || "");
          setSelectedPayslipDetail(null);
          setIsSummaryBackedList(false);
        } catch (fallbackError) {
          console.error(
            "[BonusPaymentModal] fallback payslip fetch failed:",
            fallbackError,
          );
          if (!cancelled) {
            showFeedback("기준 급여 명세서를 불러오지 못했습니다.", "error");
            setBasePayslips([]);
            setSelectedPayslipId("");
            setSelectedPayslipDetail(null);
            setIsSummaryBackedList(false);
          }
        }
      } finally {
        if (!cancelled) setLoadingPayslips(false);
      }
    };

    fetchSalaryPayslips();

    return () => {
      cancelled = true;
    };
  }, [classId, isOpen, showFeedback, student?.uid]);

  const selectedPayslipFromList = useMemo(
    () => basePayslips.find((payslip) => payslip.id === selectedPayslipId) || null,
    [basePayslips, selectedPayslipId],
  );

  useEffect(() => {
    if (!isOpen || !classId || !student?.uid || !selectedPayslipId) {
      setSelectedPayslipDetail(null);
      return;
    }

    const needsDetailFetch =
      isSummaryBackedList || !selectedPayslipFromList?.jobBreakdowns;

    if (!needsDetailFetch) {
      setSelectedPayslipDetail(null);
      return;
    }

    let cancelled = false;

    const fetchSelectedPayslip = async () => {
      setLoadingSelectedPayslip(true);

      try {
        const payslipSnap = await getDoc(
          getStudentPayslipDocRef(classId, student.uid, selectedPayslipId),
        );

        if (cancelled) return;

        if (payslipSnap.exists()) {
          setSelectedPayslipDetail({
            id: payslipSnap.id,
            ...payslipSnap.data(),
          });
        } else {
          setSelectedPayslipDetail(null);
        }
      } catch (error) {
        console.error("[BonusPaymentModal] failed to fetch selected payslip:", error);
        if (!cancelled) {
          setSelectedPayslipDetail(null);
          showFeedback("선택한 급여 명세서를 불러오지 못했습니다.", "error");
        }
      } finally {
        if (!cancelled) setLoadingSelectedPayslip(false);
      }
    };

    fetchSelectedPayslip();

    return () => {
      cancelled = true;
    };
  }, [
    classId,
    isOpen,
    isSummaryBackedList,
    selectedPayslipFromList?.jobBreakdowns,
    selectedPayslipId,
    showFeedback,
    student?.uid,
  ]);

  const selectedPayslip = selectedPayslipDetail || selectedPayslipFromList;

  const jobRows = useMemo(() => {
    const breakdowns = selectedPayslip?.jobBreakdowns;
    if (!breakdowns || typeof breakdowns !== "object") return [];

    return Object.entries(breakdowns).map(([jobName, detail]) => ({
      jobName,
      baseSalary: Number(detail?.baseSalary || 0),
      weeklyBaseSalary: Number(detail?.weeklyBaseSalary || 0),
      numberOfWeeks: Number(detail?.numberOfWeeks || 0),
    }));
  }, [selectedPayslip]);

  const referenceAmount = useMemo(
    () => jobRows.reduce((sum, row) => sum + Number(row.baseSalary || 0), 0),
    [jobRows],
  );

  const numericBonusValue = parseNumericInput(bonusValue);
  const trimmedNote = note.trim();

  const previewBonusAmount = useMemo(() => {
    if (!(numericBonusValue > 0)) return 0;

    if (bonusMode === "percent") {
      return jobRows.reduce(
        (sum, row) => sum + Math.round(Number(row.baseSalary || 0) * (numericBonusValue / 100)),
        0,
      );
    }

    return Math.round(numericBonusValue);
  }, [bonusMode, jobRows, numericBonusValue]);

  const previewDeductionAmount =
    isBonusDeductionEnabled && previewBonusAmount > 0
      ? Math.round(previewBonusAmount * (bonusDeductionRate / 100))
      : 0;
  const previewNetBonusAmount = Math.max(0, previewBonusAmount - previewDeductionAmount);

  const hasPayslips = basePayslips.length > 0;
  const canSubmit =
    !!selectedPayslip?.id &&
    jobRows.length > 0 &&
    numericBonusValue > 0 &&
    previewBonusAmount > 0 &&
    !loadingSelectedPayslip &&
    !isSubmitting;

  const handleClose = () => {
    if (isSubmitting) return;
    onClose?.();
  };

  const handleSubmit = async () => {
    if (!selectedPayslip?.id) {
      showFeedback("기준 급여 명세서를 먼저 선택해 주세요.", "warning");
      return;
    }

    if (jobRows.length === 0) {
      showFeedback("성과급 기준이 될 직업별 급여 내역이 없습니다.", "warning");
      return;
    }

    if (!(numericBonusValue > 0) || !(previewBonusAmount > 0)) {
      showFeedback("성과급 값을 0보다 크게 입력해 주세요.", "warning");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await payIndividualBonus(classId, student.uid, {
        basePayslipId: selectedPayslip.id,
        bonusEntryMode: "shared",
        selectedJobNames: jobRows.map((row) => row.jobName),
        bonusMode,
        bonusValue: numericBonusValue,
        jobBonusConfigs: [],
        note: trimmedNote,
      });

      if (!result?.success) {
        showFeedback("성과급 지급에 실패했습니다.", "error");
        return;
      }

      const paidAmount =
        result?.data?.totals?.netSalary ??
        result?.data?.totals?.totalBonusAmount ??
        previewNetBonusAmount;
      const deductedAmount =
        result?.data?.totals?.totalDeductions ?? previewDeductionAmount;

      showFeedback(
        deductedAmount > 0
          ? `${student.name} 성과급 지급 완료: 실지급 ${formatCurrency(
              paidAmount,
              currencyUnit,
            )} (공제 ${formatCurrency(deductedAmount, currencyUnit)})`
          : `${student.name} 성과급 지급 완료: ${formatCurrency(
              paidAmount,
              currencyUnit,
            )}`,
        "success",
      );
      onSuccess?.(result.data);
      handleClose();
    } catch (error) {
      showFeedback(
        error?.message || "성과급 지급 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="lg" showDefaultCloseButton={false}>
      <div className="space-y-5 px-5 pb-6 pt-5 sm:px-6 sm:pb-7 sm:pt-6">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">
                성과급 지급
              </h2>
              <p className="text-sm font-medium text-slate-500">
                {student?.name || "학생"}에게 기준 명세서 전체 기준으로 지급합니다.
              </p>
            </div>
          </div>
          <Button kind="ghost" tone="slate" size="sm" onClick={handleClose}>
            닫기
          </Button>
        </div>

        <SurfaceLoader
          loading={loadingPayslips}
          variant={hasPayslips ? "refreshing" : "surface-loading"}
          preserveContent={hasPayslips}
          skeleton={<CardSkeleton bare className="h-full min-h-full" rows={6} />}
          minHeightClassName="min-h-[320px]"
        >
          {hasPayslips ? (
            <>
              <div className="grid gap-5 lg:grid-cols-[1.05fr,0.95fr]">
                <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                      기준 급여 명세서
                    </label>
                    <div className="relative">
                      <Calendar className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <select
                        value={selectedPayslipId}
                        onChange={(event) => setSelectedPayslipId(event.target.value)}
                        className="w-full rounded-xl border border-blue-200 bg-blue-50/50 py-3 pl-11 pr-4 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        {basePayslips.map((payslip) => (
                          <option key={payslip.id} value={payslip.id}>
                            {formatPeriodText(payslip)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {loadingSelectedPayslip ? (
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500">
                        선택한 명세서 상세 내역을 불러오는 중입니다.
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-indigo-100 bg-white px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-slate-800">
                          명세서 전체 기준
                        </div>
                        <div className="mt-1 text-xs font-medium text-slate-500">
                          직업을 따로 고르지 않고 선택한 급여 명세서 전체를 기준으로 계산합니다.
                        </div>
                      </div>
                      <Badge tone="indigo">{jobRows.length}개 직업 반영</Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm"
                      kind={bonusMode === "fixed" ? "solid" : "soft"}
                      tone={bonusMode === "fixed" ? "indigo" : "slate"}
                      icon={Wallet}
                      className="h-[46px] whitespace-nowrap"
                      onClick={() => setBonusMode("fixed")}
                    >
                      고정액
                    </Button>
                    <Button size="sm"
                      kind={bonusMode === "percent" ? "solid" : "soft"}
                      tone={bonusMode === "percent" ? "indigo" : "slate"}
                      icon={Percent}
                      className="h-[46px] whitespace-nowrap"
                      onClick={() => setBonusMode("percent")}
                    >
                      비율
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                      성과급 값
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step={bonusMode === "percent" ? "0.1" : "1"}
                        value={bonusValue}
                        onChange={(event) => setBonusValue(event.target.value)}
                        className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 pr-14 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder={bonusMode === "percent" ? "예: 10" : "예: 5000"}
                      />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                        {bonusMode === "percent" ? "%" : currencyUnit}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                      지급 사유
                    </label>
                    <textarea
                      rows={3}
                      maxLength={200}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="성과급 지급 사유"
                      className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <div className="text-right text-[11px] text-slate-400">
                      {trimmedNote.length}/200
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4">
                  <div className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-5 text-slate-900 shadow-[0_12px_30px_-18px_rgba(79,70,229,0.45)]">
                    <div className="flex items-center gap-2 text-indigo-700">
                      <Sparkles className="h-4 w-4" />
                      <span className="text-xs font-black uppercase tracking-[0.2em]">
                        지급 미리보기
                      </span>
                    </div>

                    <div className="mt-3">
                      <Badge tone={isBonusDeductionEnabled ? "indigo" : "slate"}>
                        {isBonusDeductionEnabled
                          ? `성과급 공제 ${formatRateLabel(bonusDeductionRate)}% 적용`
                          : "성과급 공제 없음"}
                      </Badge>
                    </div>

                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">기준 급여 총액</span>
                        <span className="font-bold">
                          {formatCurrency(referenceAmount, currencyUnit)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">반영 직업</span>
                        <span className="font-bold">{jobRows.length}개</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">계산 방식</span>
                        <span className="font-bold">
                          {bonusMode === "percent"
                            ? `기준 급여의 ${formatRateLabel(numericBonusValue)}%`
                            : "고정액 지급"}
                        </span>
                      </div>

                      {jobRows.length > 0 && (
                        <div className="space-y-2 border-t border-slate-200 pt-3 text-xs">
                          <div className="font-bold text-slate-500">반영 직업</div>
                          <div className="flex flex-wrap gap-2">
                            {jobRows.map((job) => (
                              <Badge key={job.jobName} tone="indigo">
                                {job.jobName}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="border-t border-slate-200 pt-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">총 성과급</span>
                          <span className="font-bold text-indigo-600">
                            +{formatCurrency(previewBonusAmount, currencyUnit)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-sm">
                          <span className="text-rose-500">예상 공제</span>
                          <span className="font-bold text-rose-500">
                            -{formatCurrency(previewDeductionAmount, currencyUnit)}
                          </span>
                        </div>

                        <div className="mt-3 text-xs font-bold uppercase tracking-[0.2em] text-indigo-500">
                          예상 실지급액
                        </div>
                        <div className="mt-2 text-3xl font-black">
                          {formatDisplayMoney(Number(previewNetBonusAmount || 0))}
                          <span className="ml-2 text-sm font-bold text-slate-500">
                            {currencyUnit}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    성과급 문서는 선택한 급여 명세서의 전체 직업을 기준으로 생성됩니다.
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    기준 명세서 기간: {formatPeriodText(selectedPayslip)}
                  </div>
                </div>
              </div>

              <div className="sticky bottom-0 z-10 -mx-5 mt-1 flex justify-end gap-3 border-t border-slate-200 bg-white/95 px-5 pb-1 pt-4 backdrop-blur sm:-mx-6 sm:px-6">
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
                  성과급 지급
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 p-6 text-center text-sm font-semibold text-amber-800">
              성과급 기준이 될 급여 명세서가 없습니다. 먼저 급여를 지급해 주세요.
            </div>
          )}
        </SurfaceLoader>
      </div>
    </Modal>
  );
}
