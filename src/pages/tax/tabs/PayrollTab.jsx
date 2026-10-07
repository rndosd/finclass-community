import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  Calendar,
  CheckCircle,
  Clock,
  DollarSign,
  Gift,
  Landmark,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";

import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  Badge,
  BulkActionFloatingBar,
  Button,
  Card,
  Modal,
  Spinner,
} from "../../../components/ui";
import useDragSelection from "../../../hooks/useDragSelection";
import JobAssignByXLSX from "../components/JobAssignByXLSX";
import StudentJobAssignmentModal from "../components/StudentJobAssignmentModal";
import { usePayrollManager } from "../hooks/usePayrollManager";
import { useStudentJobAssignmentManager } from "../hooks/useStudentJobAssignmentManager";
import BulkBonusPaymentModal from "../modals/BulkBonusPaymentModal";
import BulkIncentivePaymentModal from "../modals/BulkIncentivePaymentModal";
import BonusPaymentModal from "../modals/BonusPaymentModal";
import IncentivePaymentModal from "../modals/IncentivePaymentModal";
import PayrollAutomationSettingsModal from "../modals/PayrollAutomationSettingsModal";
import PayrollHistoryModal from "../modals/PayrollHistoryModal";
import {
  getBonusDeductionPolicy,
  getPayrollTreasuryMode,
} from "../../../utils/taxPolicy";
import { POLICY_ACTIONS } from "./payrollPolicyActions";
import * as payrollService from "../services/payrollService";
import TaxRuleTab from "./TaxRuleTab";

const JOB_FILTER_ALL = "__all__";
const JOB_FILTER_UNASSIGNED = "__unassigned__";

const PAYROLL_TREASURY_MODE_META = {
  NONE: {
    label: "국고 기록 안 함",
    description: "급여와 공제 금액을 국고 수입·지출 기록에 반영하지 않습니다.",
  },
  TAX_ONLY: {
    label: "공제액만 기록",
    description: "급여에서 공제한 세금만 국고 수입으로 기록합니다.",
  },
  TOTAL: {
    label: "총액과 공제 기록",
    description: "급여 총액은 국고 지출, 공제액은 국고 수입으로 함께 기록합니다.",
  },
};

const normalizeJobList = (jobs) => {
  const rawJobs = Array.isArray(jobs) ? jobs : jobs ? [jobs] : [];

  return Array.from(
    new Set(
      rawJobs
        .map((job) => String(job || "").trim())
        .filter((job) => job && job !== "없음"),
    ),
  );
};

const getStudentJobs = (student, editedStudentJobs = {}) =>
  normalizeJobList(
    editedStudentJobs[student.uid] ||
      student.jobs ||
      (student.job ? [student.job] : []),
  );

const getCachedWeeklySalary = (student, currentJobs = [], isEdited = false) => {
  if (isEdited) return null;
  const cachedSalary = Number(student?.payroll?.currentWeeklySalary);
  const cachedJobCount = Number(student?.payroll?.assignedJobCount);
  if (!Number.isFinite(cachedSalary)) return null;
  if (
    Number.isFinite(cachedJobCount) &&
    cachedJobCount !== currentJobs.length
  ) {
    return null;
  }
  return cachedSalary;
};

const formatRateLabel = (value) =>
  Number(value || 0).toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

const ReadOnlyJobList = ({ jobs }) => {
  if (!jobs.length) {
    return <span className="text-sm font-semibold text-slate-400">직업 없음</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {jobs.map((jobName) => (
        <Badge key={jobName} tone="blue">
          {jobName}
        </Badge>
      ))}
    </div>
  );
};

export default function PayrollTab({
  classId,
  currencyUnit,
  students = [],
  jobDefinitions = [],
  taxRules = [],
  payslips = [],
  isLoading: isParentLoading,
  refreshStudents,
  refreshPayslips,
  refreshTaxRules,
}) {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { classData, isTeacher } = useUser();
  const { showFeedback } = useFeedback();
  const [bonusTargetStudent, setBonusTargetStudent] = useState(null);
  const [incentiveTarget, setIncentiveTarget] = useState(null);
  const [isBulkBonusModalOpen, setIsBulkBonusModalOpen] = useState(false);
  const [isBulkIncentiveModalOpen, setIsBulkIncentiveModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isAutomationSettingsOpen, setIsAutomationSettingsOpen] = useState(false);
  const [isPolicyDetailsOpen, setIsPolicyDetailsOpen] = useState(false);
  const [isPayrollReviewOpen, setIsPayrollReviewOpen] = useState(false);
  const [showUnpaidOnly, setShowUnpaidOnly] = useState(false);
  const [isSavingAutomationSettings, setIsSavingAutomationSettings] = useState(false);
  const [automationPreview, setAutomationPreview] = useState({
    enabled: false,
    numberOfWeeks: 1,
    dayOfWeek: "friday",
    time: "15:00",
    firstPaymentDate: "",
    targetMode: "all_jobs",
    selectedJobNames: [],
  });

const formatAutomationDateTime = (value) => {
  if (!value) return "";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};
  const [currentJobFilter, setCurrentJobFilter] = useState(JOB_FILTER_ALL);
  const [jobAssignmentModalState, setJobAssignmentModalState] = useState({
    isOpen: false,
    title: "학생 직업 배정",
    description: "왼쪽에서 학생을 고르고, 오른쪽에서 그 학생의 직업을 저장합니다.",
    students: [],
    initialStudentUid: "",
  });

  const {
    paymentStartDate,
    setPaymentStartDate,
    numberOfWeeksToPay,
    setNumberOfWeeksToPay,
    calculatedEndDate,
    editedStudentJobs,
    selectedStudentsForPayroll,
    checkIfPaid,
    processingPayroll,
    isSavingJobs,
    isResettingJobs,
    handleSaveStudentJobs,
    handleResetSelectedStudentJobs,
    handlePaySelectedStudents,
    handleToggleStudentSelection,
    handleToggleStudentGroupSelection,
    handleClearSelectedStudents,
    hasPayrollPermission,
  } = usePayrollManager(classId, students, jobDefinitions, taxRules, payslips);
  const {
    isSavingAssignments,
    handleApplyStudentJobAssignments,
  } = useStudentJobAssignmentManager(classId);

  const currentTaxMode = getPayrollTreasuryMode(classData);
  const currentTaxModeMeta =
    PAYROLL_TREASURY_MODE_META[currentTaxMode] ||
    PAYROLL_TREASURY_MODE_META.TAX_ONLY;
  const bonusDeductionPolicy = getBonusDeductionPolicy(classData);
  const bonusDeductionRate = Number(bonusDeductionPolicy?.taxRate || 0);
  const isBonusDeductionEnabled =
    bonusDeductionPolicy?.enabled === true && bonusDeductionRate > 0;

  const allJobNames = new Set();
  jobDefinitions.forEach((job) => {
    const jobName = String(job?.name || "").trim();
    if (jobName) allJobNames.add(jobName);
  });
  students.forEach((student) => {
    getStudentJobs(student, editedStudentJobs).forEach((jobName) =>
      allJobNames.add(jobName),
    );
  });

  const jobFilterOptions = [
    { value: JOB_FILTER_ALL, label: "전체 직업" },
    ...Array.from(allJobNames)
      .sort((a, b) => a.localeCompare(b, "ko"))
      .map((jobName) => ({ value: jobName, label: jobName })),
    { value: JOB_FILTER_UNASSIGNED, label: "미배정" },
  ];

  const filteredStudents = students.filter((student) => {
    if (showUnpaidOnly && checkIfPaid(student.uid, paymentStartDate, numberOfWeeksToPay)) return false;
    const currentJobs = getStudentJobs(student, editedStudentJobs);

    if (currentJobFilter === JOB_FILTER_ALL) return true;
    if (currentJobFilter === JOB_FILTER_UNASSIGNED) {
      return currentJobs.length === 0;
    }

    return currentJobs.includes(currentJobFilter);
  });

  const filteredStudentUids = filteredStudents.map((student) => student.uid);
  const selectedVisibleCount = filteredStudentUids.filter((uid) =>
    selectedStudentsForPayroll.has(uid),
  ).length;
  const allVisibleSelected =
    filteredStudentUids.length > 0 &&
    selectedVisibleCount === filteredStudentUids.length;
  const currentFilterLabel =
    currentJobFilter === JOB_FILTER_ALL
      ? "전체"
      : currentJobFilter === JOB_FILTER_UNASSIGNED
        ? "미배정"
        : currentJobFilter;
  const jobColumnLabel = hasPayrollPermission ? "직업 / 배정" : "직업";
  const payrollTableColumnCount = hasPayrollPermission ? 8 : 5;
  const displayJobColumnLabel = jobColumnLabel;
  const automationTargetCandidates = students
    .map((student) => ({
      uid: student.uid,
      name: student.name,
      jobs: getStudentJobs(student, editedStudentJobs),
    }))
    .filter((student) => student.jobs.length > 0);
  const selectedAutomationJobNames = new Set(
    automationPreview.selectedJobNames || [],
  );
  const automationEligibleStudentCount =
    automationPreview.targetMode === "selected_jobs"
      ? automationTargetCandidates.filter((student) =>
          student.jobs.some((jobName) =>
            selectedAutomationJobNames.has(jobName),
          ),
        ).length
      : automationTargetCandidates.length;
  const automationTargetLabel =
    automationPreview.targetMode === "selected_jobs"
      ? `${selectedAutomationJobNames.size}개 직업 · ${automationEligibleStudentCount}명`
      : `직업 배정 ${automationEligibleStudentCount}명`;
  const automationNextRunLabel = formatAutomationDateTime(
    automationPreview.nextRunAt,
  );
  const automationLastRun = automationPreview.lastRun || null;
  const automationLastRunLabel = automationLastRun
    ? `최근 ${Number(automationLastRun.successCount || 0)}명 지급${
        Number(automationLastRun.failureCount || 0) > 0
          ? ` · ${Number(automationLastRun.failureCount)}명 실패`
          : ""
      }`
    : "";
  const automationDayLabel =
    {
      monday: "월요일",
      tuesday: "화요일",
      wednesday: "수요일",
      thursday: "목요일",
      friday: "금요일",
    }[automationPreview.dayOfWeek] || "금요일";

  useEffect(() => {
    const stored = classData?.settings?.payrollAutomation;
    if (!stored) return;
    setAutomationPreview((current) => ({
      ...current,
      ...stored,
      enabled: stored.enabled === true,
      targetMode: stored.targetMode || "all_jobs",
      selectedJobNames: Array.isArray(stored.selectedJobNames)
        ? stored.selectedJobNames
        : [],
    }));
  }, [classData]);

  const saveAutomationSettings = async (nextSettings) => {
    if (!isTeacher) {
      showFeedback("정기 급여 자동 지급은 교사만 설정할 수 있습니다.", "warning");
      return false;
    }
    setIsSavingAutomationSettings(true);
    try {
      const stored = await payrollService.updatePayrollAutomationSettings(
        classId,
        nextSettings,
      );
      if (stored) {
        setAutomationPreview((current) => ({ ...current, ...stored }));
      }
      showFeedback(
        nextSettings.enabled
          ? "정기 급여 자동 지급을 설정했습니다."
          : "정기 급여 자동 지급을 중지했습니다.",
        "success",
      );
      return true;
    } catch (error) {
      showFeedback(
        error?.message || "정기 급여 자동 지급 설정을 저장하지 못했습니다.",
        "error",
      );
      return false;
    } finally {
      setIsSavingAutomationSettings(false);
    }
  };

  const selectedStudents = students.filter((student) =>
    selectedStudentsForPayroll.has(student.uid),
  );
  const selectedStudentCount = selectedStudents.length;
  const getStudentGrossSalary = (student) => {
    const jobs = getStudentJobs(student, editedStudentJobs);
    const weekly = getCachedWeeklySalary(student, jobs, Boolean(editedStudentJobs[student.uid])) ??
      jobs.reduce((sum, name) => sum + Number(jobDefinitions.find((job) => job.name === name)?.baseSalary || 0), 0);
    return weekly * numberOfWeeksToPay;
  };
  const selectedGrossSalary = selectedStudents.reduce((sum, student) => sum + getStudentGrossSalary(student), 0);
  const selectedEditedCount = selectedStudents.filter((student) =>
    Boolean(editedStudentJobs[student.uid]),
  ).length;
  const { startDrag, enterDrag } = useDragSelection({
    isSelected: (uid) => selectedStudentsForPayroll.has(uid),
    onSelect: (uid) => {
      if (!selectedStudentsForPayroll.has(uid)) {
        handleToggleStudentSelection(uid);
      }
    },
    onDeselect: (uid) => {
      if (selectedStudentsForPayroll.has(uid)) {
        handleToggleStudentSelection(uid);
      }
    },
    isItemEnabled: () => hasPayrollPermission,
  });

  const isRowSelectionExcludedTarget = (target) => {
    if (!(target instanceof Element)) return false;

    return Boolean(
      target.closest("button,a,input,textarea,select,label,[data-no-row-select='true']"),
    );
  };

  const handleRowSelectionStart = (event, studentUid) => {
    if (!hasPayrollPermission) return;
    if (isRowSelectionExcludedTarget(event.target)) return;

    event.preventDefault();
    startDrag(studentUid, { selected: selectedStudentsForPayroll.has(studentUid) });
  };

  const handleRowSelectionDrag = (studentUid) => {
    if (!hasPayrollPermission) return;
    enterDrag(studentUid);
  };

  if (isParentLoading && students.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-20">
        <Spinner size="lg" tone="indigo" />
        <span className="mt-4 font-medium text-slate-500">
          급여 정보를 불러오는 중입니다.
        </span>
      </div>
    );
  }

  const paySelectedStudents = async () => {
    const success = await handlePaySelectedStudents();
    if (success) setIsPayrollReviewOpen(false);
    if (success && refreshPayslips) await refreshPayslips();
  };

  const saveStudentJobs = async () => {
    const result = await handleSaveStudentJobs();
    if (result?.success && refreshStudents) await refreshStudents();
  };

  const resetSelectedStudentJobs = async () => {
    const result = await handleResetSelectedStudentJobs();
    if (result?.success && refreshStudents) await refreshStudents();
  };

  const closeJobAssignmentModal = () => {
    setJobAssignmentModalState({
      isOpen: false,
      title: "학생 직업 배정",
      description: "왼쪽에서 학생을 고르고, 오른쪽에서 그 학생의 직업을 저장합니다.",
      students: [],
      initialStudentUid: "",
    });
  };

  const openJobAssignmentModal = ({
    targetStudents = [],
    title = "학생 직업 배정",
    description = "왼쪽에서 학생을 고르고, 오른쪽에서 그 학생의 직업을 저장합니다.",
    initialStudentUid = "",
  }) => {
    const normalizedStudents = (targetStudents || []).filter((student) => student?.uid);
    if (normalizedStudents.length === 0) return;

    const fallbackStudentUid = normalizedStudents[0]?.uid || "";

    setJobAssignmentModalState({
      isOpen: true,
      title,
      description,
      students: normalizedStudents,
      initialStudentUid: initialStudentUid || fallbackStudentUid,
    });
  };

  const openSelectedStudentJobAssignmentModal = () => {
    if (selectedStudents.length === 0) return;

    openJobAssignmentModal({
      targetStudents: selectedStudents,
      title: `선택 학생 ${selectedStudents.length}명 직업 변경`,
      description: "왼쪽에서 선택 학생을 하나씩 눌러가며 직업을 저장할 수 있습니다.",
      initialStudentUid: selectedStudents[0]?.uid || "",
    });
  };

  const submitJobAssignment = async ({ assignments = [] }) => {
    const result = await handleApplyStudentJobAssignments({ assignments });
    if (result?.success && refreshStudents) await refreshStudents();
    return result?.success;
  };

  const openBonusModal = (student) => {
    if (!hasPayrollPermission) return;
    if (!student) return;
    setBonusTargetStudent(student);
  };

  const closeBonusModal = () => {
    setBonusTargetStudent(null);
  };

  const openBulkBonusModal = () => {
    if (!hasPayrollPermission) return;
    if (selectedStudents.length === 0) return;
    setIsBulkBonusModalOpen(true);
  };

  const closeBulkBonusModal = () => {
    setIsBulkBonusModalOpen(false);
  };

  const openIncentiveModal = (student, jobOptions) => {
    if (!hasPayrollPermission) return;
    if (!student) return;
    setIncentiveTarget({ student, jobOptions });
  };

  const closeIncentiveModal = () => {
    setIncentiveTarget(null);
  };

  const openBulkIncentiveModal = () => {
    if (!hasPayrollPermission) return;
    if (selectedStudents.length === 0) return;
    setIsBulkIncentiveModalOpen(true);
  };

  const closeBulkIncentiveModal = () => {
    setIsBulkIncentiveModalOpen(false);
  };

  const openHistoryModal = () => {
    setIsHistoryModalOpen(true);
  };

  const closeHistoryModal = () => {
    setIsHistoryModalOpen(false);
  };

  const renderPaymentStatus = (student) => {
    if (editedStudentJobs[student.uid]) {
      return <Badge kind="soft" tone="slate">저장 전</Badge>;
    }

    const hasValidJob = getStudentJobs(student, editedStudentJobs).length > 0;

    if (!hasValidJob) {
      return <Badge kind="soft" tone="slate">미배정</Badge>;
    }

    const isPaid = checkIfPaid(student.uid, paymentStartDate, numberOfWeeksToPay);
    const isProcessing =
      processingPayroll && selectedStudentsForPayroll.has(student.uid);

    if (isProcessing) {
      return (
        <div className="flex items-center justify-center gap-1.5 text-amber-600">
          <Clock className="h-4 w-4 animate-pulse" />
          <span className="text-xs font-semibold">지급 중</span>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center gap-1.5">
        {isPaid ? (
          <>
            <CheckCircle className="h-4 w-4 text-emerald-500" />
            <span className="text-xs font-semibold text-emerald-600">지급 완료</span>
          </>
        ) : (
          <>
            <XCircle className="h-4 w-4 text-slate-300" />
            <span className="text-xs font-semibold text-slate-500">미지급</span>
          </>
        )}
      </div>
    );
  };

  const selectionSubtitle =
    selectedEditedCount > 0
      ? `직업 변경이 저장되지 않은 학생 ${selectedEditedCount}명이 있어 지급 전에 먼저 저장이 필요합니다.`
      : `공제 전 합계 ${formatDisplayMoney(selectedGrossSalary)} · 세금과 연금 공제 후 지급됩니다.`;

  return (
    <div className="animate-in fade-in duration-500 space-y-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3" data-tour="tax-payroll-policy">
        <p className="text-sm text-slate-600">
          {currentTaxModeMeta.label} · 자동 지급 {automationPreview.enabled ? `${Number(automationPreview.numberOfWeeks || 1)}주마다 ${automationDayLabel} ${automationPreview.time}` : "사용 안 함"}
        </p>
        <Button kind="outline" tone="slate" size="sm" icon={Settings2} onClick={() => setIsPolicyDetailsOpen(true)}>정책·일정</Button>
      </div>
      <Modal isOpen={Boolean(isPolicyDetailsOpen)} onClose={() => setIsPolicyDetailsOpen(false)} title="급여 정책·일정" size="lg">
      <div className="space-y-4">
        <div className="h-full" data-tour="tax-payroll-policy">
          <Card
            title="급여 세금·공제"
            icon={Landmark}
            variant="surface"
            tone="emerald"

            className="h-full"
          >
            <Card.Content noPadding>
              <div className="flex h-full flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black text-slate-800">
                      {currentTaxModeMeta.label}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      {currentTaxModeMeta.description}
                    </span>
                  </div>
                </div>
                {POLICY_ACTIONS.map((action) => (
                  <Button
                    key={action.id}
                    type="button"
                    kind="outline"
                    tone="blue"
                    size="sm"
                    className="shrink-0"
                    onClick={() =>
                      setIsPolicyDetailsOpen("rules")
                    }
                  >
                    <span className="flex items-center gap-2 text-sm font-black">
                      공제 규칙
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </Button>
                ))}
              </div>
            </Card.Content>
          </Card>
        </div>

        <div className="h-full" data-tour="tax-payroll-automation">
          <Card
            title="정기 급여 자동 지급"
            icon={Sparkles}
            variant="surface"
            tone="indigo"

            className="h-full"
          >
            <Card.Content noPadding>
              <div className="flex h-full flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={automationPreview.enabled ? "emerald" : "slate"}>
                    {automationPreview.enabled ? "사용 중" : "사용 안 함"}
                  </Badge>
                  <span className="text-sm font-black text-slate-800">
                    {automationPreview.enabled
                      ? `${Number(automationPreview.numberOfWeeks || 1)}주마다 ${automationDayLabel} ${automationPreview.time}`
                      : "일정 미설정"}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    {automationTargetLabel}
                  </span>
                  {automationPreview.enabled && automationNextRunLabel ? (
                    <span className="text-xs font-semibold text-indigo-600">
                      다음 {automationNextRunLabel}
                    </span>
                  ) : null}
                  {automationLastRunLabel ? (
                    <span className="text-xs font-semibold text-slate-500">
                      {automationLastRunLabel}
                    </span>
                  ) : null}
                </div>
                <Button
                  type="button"
                  kind="outline"
                  tone="blue"
                  size="sm"
                  className="shrink-0"
                  icon={Settings2}
                  onClick={() => setIsAutomationSettingsOpen(true)}
                  disabled={!isTeacher || isSavingAutomationSettings}
                >
                  설정
                </Button>
              </div>
            </Card.Content>
          </Card>
        </div>
      </div>
      </Modal>
      <Modal isOpen={isPolicyDetailsOpen === "rules"} onClose={() => setIsPolicyDetailsOpen(true)} title="급여 공제 규칙" size="xl">
        <TaxRuleTab classId={classId} currencyUnit={currencyUnit} classData={classData} students={students} jobDefinitions={jobDefinitions} taxRules={taxRules} refreshTaxRules={refreshTaxRules} />
      </Modal>

      <div data-tour="tax-payroll-table">
        <Card
          title="학생별 급여 지급 현황"
          icon={Users}
          variant="surface"

          tone="lightBlue"
        >
          <Card.Header>
            <div className="flex w-full flex-col gap-4">
              <div
                className="flex flex-col justify-between gap-3 xl:flex-row xl:items-center"
                data-tour="tax-payroll-period"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-sm font-black text-slate-700">
                    <Calendar className="h-4 w-4 text-indigo-600" />
                    기간
                  </span>
                  <input
                    type="date"
                    aria-label="급여 시작일"
                    value={paymentStartDate}
                    onChange={(event) => setPaymentStartDate(event.target.value)}
                    className="h-9 w-[155px] rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <div className="relative w-20">
                    <input
                      type="number"
                      aria-label="지급 주차"
                      min="1"
                      value={numberOfWeeksToPay}
                      onChange={(event) =>
                        setNumberOfWeeksToPay(
                          parseInt(event.target.value, 10) || 1,
                        )
                      }
                      className="h-9 w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 pr-7 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                      주
                    </span>
                  </div>
                  <span className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl bg-indigo-50 px-3 text-xs font-bold text-indigo-700">
                    <Clock className="h-3.5 w-3.5" />
                    {paymentStartDate} ~ {calculatedEndDate}
                  </span>
                </div>
                <div className="flex w-full flex-wrap items-center justify-end gap-2 xl:w-auto">
                  <Button
                    onClick={openHistoryModal}
                    kind="outline"
                    tone="slate"
                    size="sm"
                    icon={Clock}
                  >
                    최근 지급 내역
                  </Button>
                  {hasPayrollPermission ? (
                    <Button
                      onClick={saveStudentJobs}
                      disabled={
                        Object.keys(editedStudentJobs).length === 0 ||
                        isSavingJobs ||
                        !hasPayrollPermission
                      }
                      isLoading={isSavingJobs}
                      kind="solid"
                      tone="blue"
                      size="sm"
                      icon={Save}
                    >
                      변경 사항 저장
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="relative min-w-[220px]">
                    <Briefcase className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <select
                      aria-label="급여 직업 필터"
                      value={currentJobFilter}
                      onChange={(e) => setCurrentJobFilter(e.target.value)}
                      className="w-full rounded-xl border border-blue-200 bg-blue-50/50 py-2.5 pl-11 pr-4 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {jobFilterOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={showUnpaidOnly} onChange={(event) => setShowUnpaidOnly(event.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
                    미지급만 보기
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="blue">
                      {currentFilterLabel} {filteredStudents.length}명
                    </Badge>
                    {hasPayrollPermission ? (
                      <Badge tone="indigo">선택 {selectedStudentCount}명</Badge>
                    ) : null}
                    <Badge tone="slate">
                      추가지급 공제{" "}
                      {isBonusDeductionEnabled
                        ? `${formatRateLabel(bonusDeductionRate)}%`
                        : "없음"}
                    </Badge>
                    {!hasPayrollPermission ? (
                      <Badge tone="amber">읽기 전용</Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </Card.Header>

          <Card.Content noPadding>
            <div className="overflow-x-auto">
              <table
                className={`w-full border-collapse text-left ${
                  hasPayrollPermission ? "min-w-[980px]" : "min-w-[880px]"
                }`}
              >
                <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <tr>
                    {hasPayrollPermission ? (
                      <th className="w-12 p-4 text-center">
                        <input
                          type="checkbox"
                          aria-label="표시된 학생 전체 선택"
                          checked={allVisibleSelected}
                          onChange={() =>
                            handleToggleStudentGroupSelection(filteredStudentUids)
                          }
                          disabled={
                            filteredStudentUids.length === 0 ||
                            !hasPayrollPermission
                          }
                          className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </th>
                    ) : null}
                    <th className="w-16 p-4 text-center">번호</th>
                    <th className="w-24 p-4">이름</th>
                    <th className="p-4">{displayJobColumnLabel}</th>
                    <th className="w-32 p-4 text-right">공제 전 급여</th>
                    <th className="w-28 p-4 text-center">지급 상태</th>
                    {hasPayrollPermission ? (
                      <>
                        <th className="w-32 p-4 text-center">성과급</th>
                        <th className="w-32 p-4 text-center">인센티브</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td
                        colSpan={payrollTableColumnCount}
                        className="px-6 py-16 text-center"
                      >
                        <div className="mx-auto max-w-md rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10">
                          <div className="text-base font-black text-slate-700">
                            선택한 조건에 맞는 학생이 없습니다.
                          </div>
                          <div className="mt-2 text-sm text-slate-500">
                            직업 필터를 조정해서 다시 확인해 보세요.
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((student) => {
                      const isSelected = selectedStudentsForPayroll.has(student.uid);
                      const isEdited = Boolean(editedStudentJobs[student.uid]);
                      const currentJobs = getStudentJobs(student, editedStudentJobs);
                      const cachedWeeklySalary = getCachedWeeklySalary(
                        student,
                        currentJobs,
                        isEdited,
                      );
                      const totalWeeklySalary =
                        cachedWeeklySalary ??
                        currentJobs.reduce((acc, jobName) => {
                          const definition = jobDefinitions.find(
                            (job) => job.name === jobName,
                          );
                          return acc + Number(definition?.baseSalary || 0);
                        }, 0);

                      return (
                        <tr
                          key={student.uid}
                          onMouseDown={(event) =>
                            handleRowSelectionStart(event, student.uid)
                          }
                          onMouseEnter={() => handleRowSelectionDrag(student.uid)}
                          className={`transition-colors ${
                            hasPayrollPermission ? "cursor-pointer" : ""
                          } ${
                            isSelected
                              ? "bg-blue-50/60 hover:bg-blue-50/80"
                              : isEdited
                                ? "bg-amber-50/50"
                                : "hover:bg-slate-50/30"
                          }`}
                        >
                          {hasPayrollPermission ? (
                            <td className="p-4 text-center select-none">
                              <input
                                type="checkbox"
                                aria-label={`${student.name} 선택`}
                                checked={isSelected}
                                onChange={() => handleToggleStudentSelection(student.uid)}
                                disabled={!hasPayrollPermission}
                                className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                              />
                            </td>
                          ) : null}
                          <td className="p-4 text-center font-mono text-xs text-slate-400">
                            {student.studentNumber || "-"}
                          </td>
                          <td className="p-4 font-bold text-slate-700">
                            {student.name}
                          </td>
                          <td className="p-4">
                            <ReadOnlyJobList jobs={currentJobs} />
                          </td>
                          <td className="p-4 text-right font-mono text-sm font-black text-slate-600">
                            {totalWeeklySalary > 0
                              ? formatDisplayMoney(totalWeeklySalary * numberOfWeeksToPay)
                              : "-"}
                          </td>
                          <td className="p-4 text-center">
                            {renderPaymentStatus(student)}
                          </td>
                          {hasPayrollPermission ? (
                            <>
                              <td className="p-4 text-center">
                                <Button
                                  size="xs"
                                  kind="soft"
                                  tone="emerald"
                                  icon={Sparkles}
                                  onClick={() => openBonusModal(student)}
                                  disabled={
                                    processingPayroll ||
                                    isEdited ||
                                    !hasPayrollPermission
                                  }
                                  className="w-full whitespace-nowrap px-2 text-xs"
                                >
                                  성과급
                                </Button>
                              </td>
                              <td className="p-4 text-center">
                                <Button
                                  size="xs"
                                  kind="soft"
                                  tone="blue"
                                  icon={Gift}
                                  onClick={() =>
                                    openIncentiveModal(student, currentJobs)
                                  }
                                  disabled={
                                    processingPayroll ||
                                    isEdited ||
                                    currentJobs.length === 0 ||
                                    !hasPayrollPermission
                                  }
                                  className="w-full whitespace-nowrap px-2 text-xs"
                                >
                                  인센티브
                                </Button>
                              </td>
                            </>
                          ) : null}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card.Content>
        </Card>
      </div>

      {hasPayrollPermission && selectedStudentCount > 0 ? (
        <BulkActionFloatingBar
          count={selectedStudentCount}
          tone="indigo"
          icon={Users}
          eyebrow="급여 지급 일괄 처리"
          title={`${selectedStudentCount}명 선택됨`}
          subtitle={selectionSubtitle}
          actions={[
            {
              key: "assign-selected-jobs",
              label: "직업 변경",
              icon: Briefcase,
              tone: "blue",
              kind: "outline",
              onClick: openSelectedStudentJobAssignmentModal,
              isLoading: isSavingAssignments,
              disabled:
                !hasPayrollPermission ||
                processingPayroll ||
                isResettingJobs ||
                isSavingAssignments ||
                selectedStudentCount === 0 ||
                jobDefinitions.length === 0,
            },
            {
              key: "reset-selected-jobs",
              label: "직업 초기화",
              icon: RotateCcw,
              tone: "rose",
              kind: "outline",
              onClick: resetSelectedStudentJobs,
              isLoading: isResettingJobs,
              disabled:
                !hasPayrollPermission ||
                processingPayroll ||
                isResettingJobs ||
                isSavingAssignments ||
                selectedStudentCount === 0,
            },
            {
              key: "bulk-bonus",
              label: "성과급 일괄",
              icon: Sparkles,
              tone: "emerald",
              kind: "outline",
              onClick: openBulkBonusModal,
              disabled:
                !hasPayrollPermission ||
                processingPayroll ||
                isResettingJobs ||
                isSavingAssignments ||
                selectedStudentCount === 0 ||
                selectedEditedCount > 0,
            },
            {
              key: "bulk-incentive",
              label: "인센티브 일괄",
              icon: Gift,
              tone: "blue",
              kind: "outline",
              onClick: openBulkIncentiveModal,
              disabled:
                !hasPayrollPermission ||
                processingPayroll ||
                isResettingJobs ||
                isSavingAssignments ||
                selectedStudentCount === 0 ||
                selectedEditedCount > 0,
            },
            {
              key: "pay-selected",
              label: "지급 내용 확인",
              icon: DollarSign,
              tone: "indigo",
              onClick: () => setIsPayrollReviewOpen(true),
              isLoading: processingPayroll,
              disabled:
                !hasPayrollPermission ||
                processingPayroll ||
                isResettingJobs ||
                isSavingAssignments ||
                selectedStudentCount === 0 || selectedEditedCount > 0,
            },
          ]}
          onClear={() => handleClearSelectedStudents()}
        />
      ) : null}

      <Modal isOpen={isPayrollReviewOpen} onClose={() => setIsPayrollReviewOpen(false)} title="급여 지급 내용 확인" size="lg" footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">{selectedStudentCount}명 · 공제 전 {formatDisplayMoney(selectedGrossSalary)}</p>
          <div className="flex gap-2">
            <Button kind="outline" tone="slate" onClick={() => setIsPayrollReviewOpen(false)} disabled={processingPayroll}>취소</Button>
            <Button tone="blue" onClick={paySelectedStudents} isLoading={processingPayroll} disabled={!hasPayrollPermission || !selectedStudentCount || selectedEditedCount > 0 || processingPayroll || isResettingJobs || isSavingAssignments}>지급하기</Button>
          </div>
        </div>
      }>
        <p className="text-sm text-slate-600">{paymentStartDate} ~ {calculatedEndDate} · {numberOfWeeksToPay}주분</p>
        <p className="mt-2 text-sm text-slate-600">위 금액은 공제 전 급여입니다. 실지급액은 현재 세금 규칙과 연금 공제를 적용해 지급 시 확정되며 지급 내역에서 확인할 수 있습니다.</p>
        <ul className="mt-4 divide-y divide-slate-100">
          {selectedStudents.map((student) => <li key={student.uid} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{student.name}{checkIfPaid(student.uid, paymentStartDate, numberOfWeeksToPay) ? " · 지급 기간 겹침" : ""}</span><span className="tabular-nums">{formatDisplayMoney(getStudentGrossSalary(student))}</span></li>)}
        </ul>
      </Modal>

      {hasPayrollPermission ? (
        <JobAssignByXLSX
          students={students}
          jobDefinitions={jobDefinitions}
          onProcessingDone={async (result) => {
            if (result.success && refreshStudents) await refreshStudents();
          }}
        />
      ) : null}

      <BonusPaymentModal
        isOpen={!!bonusTargetStudent}
        onClose={closeBonusModal}
        classId={classId}
        student={bonusTargetStudent}
        onSuccess={async () => {
          if (refreshPayslips) await refreshPayslips();
        }}
      />

      <BulkBonusPaymentModal
        isOpen={isBulkBonusModalOpen}
        onClose={closeBulkBonusModal}
        classId={classId}
        students={selectedStudents}
        onSuccess={async () => {
          if (refreshStudents) await refreshStudents();
          if (refreshPayslips) await refreshPayslips();
        }}
      />

      <IncentivePaymentModal
        isOpen={!!incentiveTarget}
        onClose={closeIncentiveModal}
        classId={classId}
        student={incentiveTarget?.student || null}
        jobOptions={incentiveTarget?.jobOptions || []}
        onSuccess={async () => {
          if (refreshStudents) await refreshStudents();
        }}
      />

      <BulkIncentivePaymentModal
        isOpen={isBulkIncentiveModalOpen}
        onClose={closeBulkIncentiveModal}
        classId={classId}
        students={selectedStudents}
        initialJobName={currentJobFilter}
        onSuccess={async () => {
          if (refreshStudents) await refreshStudents();
        }}
      />

      <PayrollHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={closeHistoryModal}
        payslips={payslips}
        currencyUnit={currencyUnit}
        classId={classId}
        className={(classData?.className || "").trim() || "학급"}
      />

      <PayrollAutomationSettingsModal
        isOpen={isAutomationSettingsOpen}
        onClose={() => setIsAutomationSettingsOpen(false)}
        value={automationPreview}
        onApply={saveAutomationSettings}
        isSubmitting={isSavingAutomationSettings}
        targetCandidates={automationTargetCandidates}
        jobOptions={Array.from(allJobNames).sort((a, b) =>
          a.localeCompare(b, "ko"),
        )}
      />

      <StudentJobAssignmentModal
        isOpen={jobAssignmentModalState.isOpen}
        onClose={closeJobAssignmentModal}
        mode="student"
        title={jobAssignmentModalState.title}
        description={jobAssignmentModalState.description}
        students={jobAssignmentModalState.students}
        jobDefinitions={jobDefinitions}
        initialStudentUid={jobAssignmentModalState.initialStudentUid}
        isSubmitting={isSavingAssignments}
        onSubmit={submitJobAssignment}
      />
    </div>
  );
}
