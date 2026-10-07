import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Button, Spinner } from "../../../components/ui";
import {
    X,
    ChevronDown,
    Briefcase,
    MinusCircle,
    Wallet,
    Receipt,
    Calendar,
    User,
    Sparkles,
} from "lucide-react";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";

const PaySlipModal = ({ isOpen, onClose, employeeData, initialPaySlipId = null }) => {
    const { classId, classData } = useUser();
    const [allPaySlips, setAllPaySlips] = useState([]);
    const [selectedPaySlipId, setSelectedPaySlipId] = useState("");
    const [loading, setLoading] = useState(false);
    const [showBlockingSpinner, setShowBlockingSpinner] = useState(false);
    const [openJobs, setOpenJobs] = useState({});
    const employeeUid = employeeData?.uid || null;
    const lastFetchedUidRef = useRef(null);
    const hasCachedPayslipRef = useRef(false);

    useEffect(() => {
        if (!isOpen || !classId || !employeeUid) return;

        let disposed = false;
        const shouldBlock =
            lastFetchedUidRef.current !== employeeUid || !hasCachedPayslipRef.current;

        setLoading(true);
        setShowBlockingSpinner(false);

        const spinnerTimer = shouldBlock
            ? setTimeout(() => {
                if (!disposed) setShowBlockingSpinner(true);
            }, 180)
            : null;

        const fetchLatestPaySlips = async () => {
            try {
                const paySlipsRef = collection(db, "classes", classId, "students", employeeUid, "paySlips");
                const q = query(paySlipsRef, orderBy("createdAt", "desc"), limit(12));
                const querySnapshot = await getDocs(q);

                const fetched = querySnapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                }));

                setAllPaySlips(fetched);
                setSelectedPaySlipId((prev) => {
                    if (
                        initialPaySlipId &&
                        fetched.some((item) => item.id === initialPaySlipId)
                    ) {
                        return initialPaySlipId;
                    }
                    if (prev && fetched.some((item) => item.id === prev)) return prev;
                    return fetched[0]?.id || "";
                });
                lastFetchedUidRef.current = employeeUid;
                hasCachedPayslipRef.current = fetched.length > 0;
            } catch (error) {
                console.error("\uBA85\uC138\uC11C \uC870\uD68C \uC624\uB958:", error);
            } finally {
                disposed = true;
                if (spinnerTimer) clearTimeout(spinnerTimer);
                setShowBlockingSpinner(false);
                setLoading(false);
            }
        };

        fetchLatestPaySlips();

        return () => {
            disposed = true;
            if (spinnerTimer) clearTimeout(spinnerTimer);
        };
    }, [isOpen, classId, employeeUid, initialPaySlipId]);

    const displayedPayslip = useMemo(
        () => allPaySlips.find((p) => p.id === selectedPaySlipId),
        [allPaySlips, selectedPaySlipId]
    );
    const isBonusSlip = displayedPayslip?.slipType === "bonus";

    const jobList = useMemo(() => {
        if (!displayedPayslip?.jobBreakdowns) return [];
        return Object.entries(displayedPayslip.jobBreakdowns).map(([name, detail]) => ({
            jobName: name,
            ...detail
        }));
    }, [displayedPayslip]);

    const { formatClassCurrency: fmt } = useNumberFormat();
    const currency = displayedPayslip?.currencyUnit || classData?.currencyUnit || "\uBBF8\uB974";
    const classNameLabel = (classData?.className || "").trim() || "\uD559\uAE09";
    const bonusReferenceAmount = Number(displayedPayslip?.totals?.totalBaseSalary || 0);
    const bonusGrossAmount = Number(
        displayedPayslip?.totals?.totalBonusAmount ?? displayedPayslip?.totals?.netSalary ?? 0,
    );
    const bonusDeductionAmount = Number(displayedPayslip?.totals?.totalDeductions || 0);
    const bonusNetAmount = Number(displayedPayslip?.totals?.netSalary || 0);
    const pensionContributionAmount = Number(
        displayedPayslip?.totals?.pensionContribution || 0,
    );
    const salaryDeductionAmount =
        Number(displayedPayslip?.totals?.totalDeductions || 0) +
        pensionContributionAmount;
    const selectedBonusJobCount = Array.isArray(displayedPayslip?.selectedJobNames)
        ? displayedPayslip.selectedJobNames.length
        : null;
    const bonusScopeLabel =
        displayedPayslip?.bonusScope === "all_jobs" ||
        (displayedPayslip?.bonusScope === undefined &&
            (!selectedBonusJobCount || selectedBonusJobCount >= jobList.length))
            ? "명세서 전체 기준"
            : "선택 직업 기준";

    const toDate = (ts) => {
        if (!ts) return null;
        if (typeof ts?.toDate === "function") return ts.toDate();
        const parsed = new Date(ts);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const formatPayslipOptionDate = (paySlip, index, list) => {
        const current = toDate(paySlip?.generatedAt || paySlip?.createdAt);
        if (!current) return "-";
        const prev = index > 0 ? toDate(list[index - 1]?.generatedAt || list[index - 1]?.createdAt) : null;
        const showYear = index === 0 || !prev || current.getFullYear() !== prev.getFullYear();
        if (showYear) return `${current.getFullYear()}.${current.getMonth() + 1}.${current.getDate()}`;
        return `${current.getMonth() + 1}.${current.getDate()}`;
    };

    const formatPaymentPeriodDescription = (paySlip) => {
        const raw = paySlip?.paymentPeriodDescription;
        if (typeof raw !== "string" || !raw.trim()) return "-";

        const match = raw.match(/(\d{4})-(\d{2})-(\d{2})\s*~\s*(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return raw;

        const [fullRange, startYear, startMonth, startDay, endYear, endMonth, endDay] = match;
        if (startYear !== endYear) return raw;

        return raw.replace(fullRange, `${startYear}-${startMonth}-${startDay} ~ ${endMonth}-${endDay}`);
    };

    const paymentPeriodText = formatPaymentPeriodDescription(displayedPayslip);
    const paymentDateMatch = paymentPeriodText.match(
        /\d{4}-\d{2}-\d{2}\s*~\s*(?:\d{4}-)?\d{2}-\d{2}/,
    );
    const paymentPeriodPrefix = paymentDateMatch
        ? paymentPeriodText.slice(0, paymentDateMatch.index).trim()
        : paymentPeriodText;
    const paymentDateText = paymentDateMatch
        ? paymentPeriodText.slice(paymentDateMatch.index).trim()
        : "";
    const getDeductionModeLabel = (deduction) => {
        switch (deduction?.calculationMode) {
        case "flat_rate":
            return "비율";
        case "flat_amount":
            return "고정액";
        case "rate_after_exemption":
            return "제외 후 비율";
        case "progressive":
            return "누진세";
        default:
            return "";
        }
    };

    const formatDeductionRange = (fromAmount, upToAmount) => {
        if (upToAmount === null || upToAmount === undefined) {
            return `${fmt(fromAmount)} ${currency} 초과분`;
        }
        if (Number(fromAmount || 0) > 0) {
            return `${fmt(fromAmount)}~${fmt(upToAmount)} ${currency}`;
        }
        return `~${fmt(upToAmount)} ${currency}`;
    };

    const getDeductionSummary = (deduction) => {
        const detail = deduction?.calculationDetail;
        if (!detail || typeof detail !== "object") return "";

        if (deduction?.calculationMode === "flat_rate") {
            return `기준액 ${fmt(detail.taxableBase)} ${currency} x ${detail.rate}%`;
        }

        if (deduction?.calculationMode === "flat_amount") {
            return `주당 ${fmt(detail.amountPerWeek)} ${currency} x ${detail.numberOfWeeks}주`;
        }

        if (deduction?.calculationMode === "rate_after_exemption") {
            return `기준액 ${fmt(detail.taxableBase)} ${currency} 중 ${fmt(detail.appliedBase)} ${currency}에 ${detail.rate}% 적용`;
        }

        if (deduction?.calculationMode === "progressive") {
            return `기준액 ${fmt(detail.taxableBase)} ${currency}에 구간별 세율 적용`;
        }

        return "";
    };

    const getDeductionBreakdownLines = (deduction) => {
        if (deduction?.calculationMode !== "progressive") return [];

        const brackets = deduction?.calculationDetail?.brackets;
        if (!Array.isArray(brackets)) return [];

        return brackets.map((bracket) =>
            `${bracket.index}구간 ${formatDeductionRange(bracket.fromAmount, bracket.upToAmount)} x ${bracket.rate}% = ${fmt(bracket.deductionAmount)} ${currency}`
        );
    };

    const renderDeductionRow = (deduction, index, options = {}) => {
        const { appendDeductionSuffix = false } = options;
        const baseLabel = String(deduction?.name || "").trim() || "공제";
        const deductionLabel =
            appendDeductionSuffix && !baseLabel.endsWith("공제")
                ? `${baseLabel} 공제`
                : baseLabel;
        const modeLabel = getDeductionModeLabel(deduction);
        const summary = getDeductionSummary(deduction);
        const detailLines = getDeductionBreakdownLines(deduction);

        return (
            <div key={`${deduction?.ruleId || deductionLabel}-${index}`} className="flex items-start justify-between gap-4 text-sm">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-rose-400 font-medium">{deductionLabel}</span>
                        {modeLabel && (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-500">
                                {modeLabel}
                            </span>
                        )}
                    </div>
                    {summary && (
                        <p className="mt-1 text-[11px] font-medium text-slate-400">
                            {summary}
                        </p>
                    )}
                    {detailLines.length > 0 && (
                        <div className="mt-1 space-y-1">
                            {detailLines.map((line, lineIndex) => (
                                <p
                                    key={`${deductionLabel}-detail-${lineIndex}`}
                                    className="text-[11px] font-medium text-slate-400"
                                >
                                    {line}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
                <span className="shrink-0 text-rose-500 font-bold">
                    -{fmt(deduction?.amount)} {currency}
                </span>
            </div>
        );
    };

    if (!isOpen) return null;

    return (
        <>
            <Modal isOpen={isOpen} onClose={onClose} size="lg" showDefaultCloseButton={false}>
                <div className="flex flex-col max-h-[92vh] bg-slate-50 overflow-hidden rounded-t-xl font-sans">
                    <div className="flex items-center justify-between p-5 bg-white border-b border-slate-200 no-print">
                        <div className="flex items-center gap-4">
                            <div className="bg-indigo-600 p-2.5 rounded-xl text-white shadow-lg">
                                <Receipt className="h-6 w-6" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-slate-800">
                                    {`${classNameLabel} ${isBonusSlip ? "\uC131\uACFC\uAE09" : "\uAE09\uC5EC"} \uBA85\uC138\uC11C`}
                                </h2>
                                <select
                                    value={selectedPaySlipId}
                                    onChange={(e) => setSelectedPaySlipId(e.target.value)}
                                    className="mt-1 text-sm font-semibold text-indigo-600 bg-transparent border-none p-0 cursor-pointer focus:ring-2 focus:ring-blue-500/20"
                                >
                                    {allPaySlips.map((ps, idx) => (
                                        <option key={ps.id} value={ps.id}>
                                            {`${formatPayslipOptionDate(ps, idx, allPaySlips)} ${ps?.slipType === "bonus" ? "\uC131\uACFC\uAE09" : "\uAE09\uC5EC"} \uB0B4\uC5ED`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button aria-label="닫기" size="sm" variant="ghost" onClick={onClose} >
                                <X className="h-6 w-6" />
                            </Button>
                        </div>
                    </div>

                    <div className="relative flex-1 overflow-y-auto p-4 sm:p-8">
                        {loading && displayedPayslip && (
                            <div className="absolute top-3 right-3 z-20 rounded-full bg-white/90 p-2 shadow-sm ring-1 ring-slate-100">
                                <Spinner size="sm" tone="indigo" />
                            </div>
                        )}
                        {showBlockingSpinner ? (
                            <div className="py-20 text-center"><Spinner size="lg" tone="indigo" /></div>
                        ) : !displayedPayslip ? (
                            <div className="py-20 text-center text-slate-400 font-medium">{"\uC9C0\uAE09\uD55C \uAE09\uC5EC \uB0B4\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</div>
                        ) : (
                            <div id="printable-payslip" className="max-w-2xl mx-auto bg-white p-6 sm:p-10 rounded-2xl shadow-sm border border-slate-100 relative">
                                <div className="text-center mb-10 border-b-2 border-slate-900 pb-8">
                                    <h1 className="text-3xl font-black text-slate-900 mb-8 tracking-tighter">
                                        {`${classNameLabel} ${isBonusSlip ? "\uC131\uACFC\uAE09" : "\uAE09\uC5EC"} \uBA85\uC138\uC11C`}
                                    </h1>
                                    <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-slate-100 bg-slate-50 text-left sm:grid-cols-[minmax(120px,0.62fr)_minmax(0,1.38fr)]">
                                        <div className="p-4">
                                            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{"수령자 성명"}</p>
                                            <p className="flex items-center gap-2 text-base font-bold text-slate-800">
                                                <User className="h-4 w-4 shrink-0 text-slate-400" />
                                                <span className="truncate">{displayedPayslip.studentName}</span>
                                            </p>
                                        </div>
                                        <div className="border-t border-slate-200 p-4 sm:border-l sm:border-t-0 sm:px-5">
                                            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{"지급 기간"}</p>
                                            <div className="flex items-start gap-2 text-sm font-bold leading-relaxed text-slate-700 sm:text-base">
                                                <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                                                <p className="min-w-0 [word-break:keep-all]">
                                                    {paymentPeriodPrefix}
                                                    {paymentDateText ? (
                                                        <>
                                                            {" "}
                                                            <span className="inline-block whitespace-nowrap">
                                                                {paymentDateText}
                                                            </span>
                                                        </>
                                                    ) : null}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {isBonusSlip && (
                                    <div className="mb-10 space-y-4">
                                        <div className="rounded-3xl border border-indigo-100 bg-indigo-50/70 p-6">
                                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                                <div>
                                                    <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-black text-indigo-600 shadow-sm">
                                                        <Sparkles className="h-3.5 w-3.5" />
                                                        {bonusScopeLabel}
                                                    </div>
                                                    <h3 className="mt-4 text-xl font-black text-slate-900">
                                                        성과급 지급 요약
                                                    </h3>
                                                    <p className="mt-1 text-sm font-medium text-slate-500">
                                                        선택한 급여 명세서 전체를 기준으로 성과급이 계산되었습니다.
                                                    </p>
                                                </div>
                                                <div className="rounded-2xl bg-white px-4 py-3 text-right shadow-sm">
                                                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                                        반영 직업
                                                    </div>
                                                    <div className="mt-1 text-2xl font-black text-indigo-600">
                                                        {jobList.length}개
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                <div className="rounded-2xl bg-white px-4 py-3">
                                                    <div className="text-xs font-bold text-slate-400">기준 급여 총액</div>
                                                    <div className="mt-1 text-lg font-black text-slate-800">
                                                        {fmt(bonusReferenceAmount)} {currency}
                                                    </div>
                                                </div>
                                                <div className="rounded-2xl bg-white px-4 py-3">
                                                    <div className="text-xs font-bold text-slate-400">총 성과급</div>
                                                    <div className="mt-1 text-lg font-black text-indigo-600">
                                                        +{fmt(bonusGrossAmount)} {currency}
                                                    </div>
                                                </div>
                                                <div className="rounded-2xl bg-white px-4 py-3">
                                                    <div className="text-xs font-bold text-slate-400">총 공제액</div>
                                                    <div className="mt-1 text-lg font-black text-rose-500">
                                                        -{fmt(bonusDeductionAmount)} {currency}
                                                    </div>
                                                </div>
                                                <div className="rounded-2xl bg-white px-4 py-3">
                                                    <div className="text-xs font-bold text-slate-400">실지급액</div>
                                                    <div className="mt-1 text-lg font-black text-slate-900">
                                                        {fmt(bonusNetAmount)} {currency}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {jobList.length > 0 && (
                                            <details className="rounded-2xl border border-slate-100 bg-white px-5 py-4">
                                                <summary className="cursor-pointer text-sm font-bold text-slate-600">
                                                    직업별 산정 내역 보기
                                                </summary>
                                                <div className="mt-4 space-y-2">
                                                    {jobList.map((job) => (
                                                        <div key={job.jobName} className="grid gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm sm:grid-cols-[1fr,auto,auto] sm:items-center">
                                                            <div className="font-bold text-slate-800">{job.jobName}</div>
                                                            <div className="text-slate-500">
                                                                기준 급여 {fmt(job.baseSalary)} {currency}
                                                            </div>
                                                            <div className="font-bold text-indigo-600">
                                                                성과급 +{fmt(job.bonusAmount ?? job.netSalary)} {currency}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </details>
                                        )}
                                    </div>
                                )}

                                {!isBonusSlip && <div className="space-y-4 mb-10">
                                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4 px-1">
                                        {isBonusSlip ? <Sparkles className="w-3 h-3" /> : <Briefcase className="w-3 h-3" />}
                                        {isBonusSlip ? "\uC9C1\uC5C5\uBCC4 \uC131\uACFC\uAE09 \uC0B0\uC815 \uB0B4\uC5ED" : "\uC9C1\uBB34\uBCC4 \uC9C0\uAE09 \uBC0F \uACF5\uC81C \uC0C1\uC138"}
                                    </h3>

                                    {jobList.map((job) => {
                                        const isJobOpen = !!openJobs[job.jobName];
                                        const jobBonusAmount = Number(job.bonusAmount ?? job.netSalary ?? 0);
                                        const jobDisplayAmount = Number(
                                            isBonusSlip ? job.netSalary ?? job.bonusAmount ?? 0 : job.netSalary ?? 0,
                                        );
                                        return (
                                            <div key={job.jobName} className="border border-slate-100 rounded-2xl overflow-hidden transition-all duration-300">
                                                <Button
                                                    type="button"
                                                    onClick={() => setOpenJobs((prev) => ({ ...prev, [job.jobName]: !isJobOpen }))}
                                                    kind="ghost"
                                                    tone="slate"
                                                    className={`w-full flex items-center justify-between p-4 text-left transition-colors ${isJobOpen ? "bg-slate-50" : "bg-white hover:bg-slate-50"}`}
                                                >
                                                    <div className="flex items-center gap-4">
                                                        <div className={`p-2 rounded-lg ${isJobOpen ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                                                            <Briefcase className="w-5 h-5" />
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-slate-800">{job.jobName}</p>
                                                            <p className="text-xs text-slate-400 font-medium">
                                                                {isBonusSlip
                                                                    ? `\uAE30\uC900 \uC8FC\uAE09: ${fmt(job.weeklyBaseSalary)} ${currency}`
                                                                    : `\uAE30\uBCF8 \uC8FC\uAE09: ${fmt(job.weeklyBaseSalary)} ${currency}`}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-4">
                                                        <div className="text-right mr-2">
                                                            <p className="text-[10px] font-bold text-slate-400 uppercase">
                                                                {isBonusSlip ? "실수령" : "\uC218\uB839 \uD569\uACC4"}
                                                            </p>
                                                            <p className="font-bold text-indigo-600">
                                                                +{fmt(jobDisplayAmount)}
                                                            </p>
                                                        </div>
                                                        <ChevronDown className={`w-5 h-5 text-slate-300 transition-transform duration-300 ${isJobOpen ? "rotate-180 text-indigo-600" : ""}`} />
                                                    </div>
                                                </Button>

                                                {isJobOpen && (
                                                    <div className="px-5 pb-5 bg-slate-50/50 animate-in slide-in-from-top-1 duration-200">
                                                        <div className="py-4 space-y-3 border-t border-slate-200/60">
                                                            <div className="flex justify-between text-sm">
                                                                <span className="text-slate-500 font-medium">
                                                                    {isBonusSlip
                                                                        ? `\uAE30\uC900 \uAE09\uC5EC (${job.numberOfWeeks}\uC8FC\uBD84)`
                                                                        : `\uCD1D \uC9C0\uAE09\uC561 (${job.numberOfWeeks}\uC8FC\uBD84)`}
                                                                </span>
                                                                <span className="text-slate-800 font-bold">{fmt(job.baseSalary)} {currency}</span>
                                                            </div>
                                                            {isBonusSlip && (
                                                                <div className="flex justify-between text-sm">
                                                                    <span className="text-indigo-500 font-medium">{"\uC131\uACFC\uAE09"}</span>
                                                                    <span className="text-indigo-600 font-bold">+{fmt(jobBonusAmount)} {currency}</span>
                                                                </div>
                                                            )}
                                                            {job.deductions?.map((d, i) =>
                                                                renderDeductionRow(d, i, { appendDeductionSuffix: true })
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>}

                                {displayedPayslip.globalDeductions?.length > 0 && (
                                    <div className="bg-rose-50/50 rounded-2xl p-6 mb-10 border border-rose-100/50">
                                        <h3 className="text-xs font-black text-rose-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                                            <MinusCircle className="w-3 h-3" /> {"\uC804\uCCB4 \uACF5\uD1B5 \uACF5\uC81C \uB0B4\uC5ED"}
                                        </h3>
                                        <div className="space-y-3">
                                            {displayedPayslip.globalDeductions.map((d, i) =>
                                                renderDeductionRow(d, i)
                                            )}
                                        </div>
                                    </div>
                                )}

                                {!isBonusSlip && pensionContributionAmount > 0 && (
                                    <div className="mb-10 rounded-2xl border border-violet-100 bg-violet-50/60 p-6">
                                        <h3 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-violet-500">
                                            <MinusCircle className="h-3 w-3" /> 연금 납입
                                        </h3>
                                        <div className="flex items-center justify-between gap-4 text-sm">
                                            <div>
                                                <p className="font-bold text-slate-700">
                                                    {displayedPayslip?.pension?.fundName || "연금 기금"}
                                                </p>
                                                <p className="mt-1 text-xs font-medium text-slate-400">
                                                    기본급의 {Number(displayedPayslip?.pension?.contributionRate || 0)}%
                                                </p>
                                            </div>
                                            <span className="font-bold tabular-nums text-violet-600">
                                                -{fmt(pensionContributionAmount)} {currency}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {!isBonusSlip && <div className="mb-6 px-2">
                                    <div className="flex flex-col gap-2 border-t-2 border-slate-100 pt-6">
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-500 font-medium">
                                                {isBonusSlip
                                                    ? "\uC131\uACFC\uAE09 \uC0B0\uC815 \uAE30\uC900 \uAE08\uC561"
                                                    : "\uCD1D \uC9C0\uAE09\uC561 (\uAE30\uBCF8\uAE09 \uD569\uACC4)"}
                                            </span>
                                            <span className="text-slate-800 font-bold">+{fmt(displayedPayslip.totals?.totalBaseSalary)} {currency}</span>
                                        </div>
                                        {isBonusSlip ? (
                                            <>
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="text-indigo-500 font-medium">총 성과급 (세전)</span>
                                                    <span className="text-indigo-600 font-bold">+{fmt(displayedPayslip.totals?.totalBonusAmount ?? displayedPayslip.totals?.netSalary)} {currency}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="text-rose-400 font-medium">총 공제액</span>
                                                    <span className="text-rose-500 font-bold">-{fmt(displayedPayslip.totals?.totalDeductions)} {currency}</span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="text-rose-400 font-medium">총 공제액 (연금 포함)</span>
                                                <span className="text-rose-500 font-bold">-{fmt(salaryDeductionAmount)} {currency}</span>
                                            </div>
                                        )}
                                        <div className="h-px bg-slate-100 my-1"></div>
                                    </div>
                                </div>}

                                {isBonusSlip && displayedPayslip?.note && (
                                    <div className="mb-6 rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">
                                            {"\uC9C0\uAE09 \uC0AC\uC720"}
                                        </p>
                                        <p className="mt-2 text-sm font-medium text-amber-900">{displayedPayslip.note}</p>
                                    </div>
                                )}

                                <div className="bg-indigo-600 rounded-3xl p-8 text-white shadow-xl shadow-indigo-100 relative overflow-hidden">
                                    <div className="absolute -right-6 -top-6 opacity-10">
                                        <Wallet className="w-36 h-36" />
                                    </div>
                                    <div className="relative z-10 flex flex-col sm:flex-row justify-between items-end sm:items-center gap-4">
                                        <div>
                                            <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest mb-1">{"\uCD5C\uC885 \uC815\uC0B0 \uACB0\uACFC"}</p>
                                            <h2 className="text-2xl font-bold">
                                                {isBonusSlip ? "\uC2E4\uC81C \uBC1B\uB294 \uC131\uACFC\uAE09" : "\uC2E4\uC81C \uBC1B\uB294 \uAE08\uC561"}
                                            </h2>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-5xl font-black tracking-tighter">
                                                {fmt(displayedPayslip.totals?.netSalary)}
                                            </span>
                                            <span className="ml-2 text-xl font-bold opacity-80">{currency}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-10 text-center border-t border-slate-100 pt-8">
                                    <p className="text-[11px] text-slate-400 font-medium">{`\uBCF8 \uBA85\uC138\uC11C\uB294 ${classNameLabel}\uC5D0\uC11C \uACF5\uC2DD \uBC1C\uD589\uB41C \uB514\uC9C0\uD138 \uBB38\uC11C\uC785\uB2C8\uB2E4.`}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </Modal>
        </>
    );
};

export default PaySlipModal;
