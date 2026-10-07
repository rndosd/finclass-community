import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as XLSX from "xlsx";
import {
  Download,
  FileText,
  Plus,
  Send,
  UserCheck,
  XCircle,
} from "lucide-react";
import {
  Badge,
  BulkActionFloatingBar,
  Button,
  Checkbox,
  Modal,
  Spinner,
  Textarea,
} from "../../../components/ui";

const STATUS_META = {
  submitted: { label: "검토 대기", tone: "amber" },
  approved: { label: "승인 완료", tone: "emerald" },
  rejected: { label: "반려됨", tone: "rose" },
};

const ROUND_STATUS_META = {
  open: { label: "모집 중", tone: "indigo" },
  closed: { label: "마감", tone: "slate" },
};

const toDisplayDate = (value) => {
  if (!value) return "-";
  if (typeof value.toDate === "function") {
    return value.toDate().toLocaleDateString("ko-KR");
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString("ko-KR");
};

const toDisplayDateTime = (value) => {
  if (!value) return "-";
  if (typeof value.toDate === "function") {
    return value.toDate().toLocaleString("ko-KR");
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString("ko-KR");
};

const formatHeadcountSummary = ({
  currentHeadcount = 0,
  targetHeadcount = null,
  neededHeadcount = 0,
  pendingCount = 0,
}) => {
  const summaryItems = [];

  if (targetHeadcount === null || targetHeadcount === undefined) {
    summaryItems.push({
      text: `현재 ${currentHeadcount}명`,
      className: "text-slate-800",
    });
    summaryItems.push({
      text: "목표 미설정",
      className: "text-slate-500",
    });
  } else {
    summaryItems.push({
      text: `${currentHeadcount} / ${targetHeadcount}명`,
      className: "text-slate-800",
    });
    summaryItems.push({
      text: neededHeadcount > 0 ? `추가 모집 ${neededHeadcount}명` : "정원 충족",
      className: neededHeadcount > 0 ? "text-amber-700" : "text-emerald-700",
    });
  }

  if (pendingCount > 0) {
    summaryItems.push({
      text: `지원 ${pendingCount}건`,
      className: "text-slate-500",
    });
  }

  return summaryItems;
};

const normalizeJobs = (student = {}) => {
  if (Array.isArray(student.jobs)) {
    return student.jobs
      .map((job) => String(job || "").trim())
      .filter((job) => job && job !== "없음");
  }

  const fallbackJob = String(student.job || "").trim();
  return fallbackJob && fallbackJob !== "없음" ? [fallbackJob] : [];
};

const toSortableTime = (value) => {
  if (!value) return 0;
  if (typeof value?.toDate === "function") {
    return value.toDate().getTime();
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const groupApplicationsByJob = (applications = [], round = null) => {
  const roundJobOrder = new Map(
    (round?.jobs || []).map((job, index) => [
      String(job?.id || job?.name || index).trim(),
      index,
    ]),
  );
  const statusOrder = {
    submitted: 0,
    approved: 1,
    rejected: 2,
  };
  const grouped = new Map();

  applications.forEach((application) => {
    const jobKey = String(
      application.jobDefinitionId || application.jobName || application.id,
    ).trim();

    if (!grouped.has(jobKey)) {
      grouped.set(jobKey, {
        key: jobKey,
        jobDefinitionId: application.jobDefinitionId || "",
        jobName: application.jobName || "직업 정보 없음",
        baseSalary: Number(application.baseSalary || 0),
        order:
          roundJobOrder.get(
            String(application.jobDefinitionId || application.jobName || "").trim(),
          ) ?? Number.MAX_SAFE_INTEGER,
        submittedCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        applications: [],
      });
    }

    const group = grouped.get(jobKey);
    group.applications.push(application);

    if (application.status === "submitted") group.submittedCount += 1;
    if (application.status === "approved") group.approvedCount += 1;
    if (application.status === "rejected") group.rejectedCount += 1;
  });

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      applications: [...group.applications].sort((left, right) => {
        const statusDiff =
          (statusOrder[left.status] ?? 99) - (statusOrder[right.status] ?? 99);

        if (statusDiff !== 0) return statusDiff;
        return toSortableTime(right.submittedAt) - toSortableTime(left.submittedAt);
      }),
    }))
    .sort((left, right) => {
      const pendingDiff = Number(right.submittedCount > 0) - Number(left.submittedCount > 0);
      if (pendingDiff !== 0) return pendingDiff;

      const submittedDiff = right.submittedCount - left.submittedCount;
      if (submittedDiff !== 0) return submittedDiff;

      return (
        left.order - right.order ||
        left.jobName.localeCompare(right.jobName, "ko-KR")
      );
    });
};

const buildSuggestedRoundTitle = (rounds = []) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const sameMonthRounds = rounds.filter((round) => {
    const rawDate = round.createdAt?.toDate?.() || new Date(round.createdAt || 0);
    return rawDate.getFullYear() === year && rawDate.getMonth() + 1 === month;
  });

  return `${year}년 ${month}월 ${sameMonthRounds.length + 1}차 직업 모집`;
};

const sanitizeFileName = (value) =>
  String(value || "직업모집").replace(/[\\/:*?"<>|]/g, "").trim() || "직업모집";

const exportApplicationsToExcel = ({
  round,
  applications,
  studentsByUid,
  currencyUnit,
}) => {
  if (!round || applications.length === 0) return;

  const rows = applications.map((application, index) => {
    const currentJobs = normalizeJobs(studentsByUid.get(application.studentUid));
    const statusMeta = STATUS_META[application.status] || STATUS_META.submitted;

    return {
      번호: index + 1,
      상태: statusMeta.label,
      제출일: toDisplayDateTime(application.submittedAt),
      학생번호: application.studentNumber || "",
      학생이름: application.studentName || "",
      희망직업: application.jobName || "",
      현재직업: currentJobs.join(", ") || "배정 없음",
      주급: `${Number(application.baseSalary || 0).toLocaleString()}${currencyUnit || ""}`,
      이력_강점: application.experience || "",
      지원이유: application.reason || "",
      반려사유: application.rejectionReason || "",
      모집회차: application.roundTitle || round.title || "",
    };
  });

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 8 },
    { wch: 12 },
    { wch: 18 },
    { wch: 10 },
    { wch: 12 },
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 30 },
    { wch: 36 },
    { wch: 24 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, "지원서");
  XLSX.writeFile(
    workbook,
    `${sanitizeFileName(round.title)}_지원서_${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
};

const RoundCreationModal = ({
  isOpen,
  onClose,
  mode = "create",
  title,
  onTitleChange,
  selectedJobIds,
  onSelectedJobIdsChange,
  allowMultipleApplications,
  onAllowMultipleApplicationsChange,
  allowCurrentJobApplications,
  onAllowCurrentJobApplicationsChange,
  replaceExistingJobsOnApproval,
  onReplaceExistingJobsOnApprovalChange,
  maxApplicationsPerStudent,
  onMaxApplicationsPerStudentChange,
  maxApprovedJobsPerStudent,
  onMaxApprovedJobsPerStudentChange,
  jobDefinitions,
  suggestedJobIds = [],
  onSubmit,
  isSubmitting,
  hasApplications = false,
  policyBaseline = null,
  lockedJobIds = [],
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const isEditMode = mode === "edit";
  const [mobileStep, setMobileStep] = useState("rules");
  const allSelected = jobDefinitions.length > 0 && selectedJobIds.length === jobDefinitions.length;
  const lockedJobIdSet = useMemo(
    () => new Set(lockedJobIds.map((id) => String(id || "").trim()).filter(Boolean)),
    [lockedJobIds],
  );
  const jobsNeedingRecruitment = useMemo(
    () => jobDefinitions.filter((job) => Number(job?.neededHeadcount || 0) > 0),
    [jobDefinitions],
  );
  const totalNeededHeadcount = useMemo(
    () =>
      jobsNeedingRecruitment.reduce(
        (sum, job) => sum + Math.max(0, Number(job?.neededHeadcount || 0)),
        0,
      ),
    [jobsNeedingRecruitment],
  );
  const sortedJobDefinitions = useMemo(
    () =>
      [...jobDefinitions].sort(
        (left, right) =>
          Number(right?.neededHeadcount || 0) - Number(left?.neededHeadcount || 0) ||
          String(left?.name || "").localeCompare(String(right?.name || ""), "ko-KR"),
      ),
    [jobDefinitions],
  );

  useEffect(() => {
    if (isOpen) setMobileStep("rules");
  }, [isOpen]);

  const handleToggleJob = (jobId) => {
    if (lockedJobIdSet.has(String(jobId || "").trim()) && selectedJobIds.includes(jobId)) {
      return;
    }

    if (selectedJobIds.includes(jobId)) {
      onSelectedJobIdsChange(selectedJobIds.filter((id) => id !== jobId));
      return;
    }
    onSelectedJobIdsChange([...selectedJobIds, jobId]);
  };

  const handleSelectJobIds = (jobIds) => {
    const nextJobIds = new Set(
      jobIds.map((id) => String(id || "").trim()).filter(Boolean),
    );
    lockedJobIdSet.forEach((jobId) => nextJobIds.add(jobId));
    onSelectedJobIdsChange(Array.from(nextJobIds));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? "모집 규칙 수정" : "직업 모집 시작"}
      size="lg"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 md:hidden">
          <button
            type="button"
            onClick={() => setMobileStep("rules")}
            className={`min-h-11 rounded-xl px-3 text-sm font-black transition ${
              mobileStep === "rules"
                ? "bg-white text-indigo-700 shadow-sm"
                : "text-slate-500"
            }`}
          >
            1. 모집 규칙
          </button>
          <button
            type="button"
            onClick={() => setMobileStep("jobs")}
            className={`min-h-11 rounded-xl px-3 text-sm font-black transition ${
              mobileStep === "jobs"
                ? "bg-white text-indigo-700 shadow-sm"
                : "text-slate-500"
            }`}
          >
            2. 직업 선택
          </button>
        </div>

        <div className={`space-y-5 ${mobileStep === "rules" ? "block" : "hidden"} md:block`}>
        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">모집 회차 제목</label>
          <input
            type="text"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="예: 3월 1차 직업 모집"
            className="w-full rounded-xl border border-blue-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
          />
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-3">
          <Checkbox
            checked={allowMultipleApplications}
            onChange={(event) => onAllowMultipleApplicationsChange(event.target.checked)}
            disabled={isEditMode && Boolean(policyBaseline?.allowMultipleApplications)}
            label="학생당 여러 직업 지원 허용"
          />
          <Checkbox
            checked={allowCurrentJobApplications}
            onChange={(event) =>
              onAllowCurrentJobApplicationsChange(event.target.checked)
            }
            disabled={isEditMode && Boolean(policyBaseline?.allowCurrentJobApplications)}
            label="현재 직업 재지원 허용"
          />
          <Checkbox
            checked={replaceExistingJobsOnApproval}
            onChange={(event) =>
              onReplaceExistingJobsOnApprovalChange(event.target.checked)
            }
            label="승인 시 기존 직업 교체 (해제하면 추가)"
            disabled={isEditMode}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-black text-slate-900">학생당 최대 지원 수</p>
                <p className="text-xs leading-5 text-slate-500">
                  여러 직업 지원을 허용할 때, 한 회차에서 학생이 제출할 수 있는 지원서 수를 제한합니다.
                </p>
              </div>
              <div className="w-full md:w-[160px]">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={maxApplicationsPerStudent}
                  onChange={(event) =>
                    onMaxApplicationsPerStudentChange(event.target.value)
                  }
                  disabled={!allowMultipleApplications}
                  className="w-full rounded-xl border border-blue-200 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-500">
              {!allowMultipleApplications
                ? "여러 직업 지원을 허용하지 않으면 최대 지원 수는 1개로 고정됩니다."
                : `현재 학생당 최대 ${Math.max(1, Number(maxApplicationsPerStudent || 1))}개까지 지원할 수 있습니다.`}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-black text-slate-900">학생당 최대 승인 수</p>
                <p className="text-xs leading-5 text-slate-500">
                  여러 직업 지원을 허용하더라도, 최종적으로 몇 개까지 승인할지 제한합니다.
                </p>
              </div>
              <div className="w-full md:w-[160px]">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={maxApprovedJobsPerStudent}
                  onChange={(event) =>
                    onMaxApprovedJobsPerStudentChange(event.target.value)
                  }
                  disabled={!allowMultipleApplications || replaceExistingJobsOnApproval}
                  className="w-full rounded-xl border border-blue-200 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-500">
              {!allowMultipleApplications
                ? "여러 직업 지원을 허용하지 않으면 최대 승인 수는 1개로 고정됩니다."
                : replaceExistingJobsOnApproval
                  ? "기존 직업 교체 모드에서는 최대 승인 수가 1개로 고정됩니다."
                  : `현재 학생당 최대 ${Math.min(
                      Math.max(1, Number(maxApplicationsPerStudent || 1)),
                      Math.max(1, Number(maxApprovedJobsPerStudent || 1)),
                    )}개까지 승인할 수 있습니다.`}
            </p>
          </div>
        </div>

        {isEditMode ? (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-4 text-sm leading-6 text-slate-600">
            진행 중인 모집은 지원서 생성과 동시에 적용되는 정책의 일관성을 위해 기존 직업을
            제거하거나 지원 조건을 더 엄격하게 바꿀 수 없습니다. 제목 수정, 직업 추가, 지원
            범위 확대만 가능합니다.
            <br />
            진행 중 회차에서는 제목과 모집 규칙만 수정할 수 있습니다. 이미 지원된 직업 목록은 그대로 유지되고,
            검토 대기 중인 지원서에도 바뀐 규칙이 함께 반영됩니다.
            {hasApplications
              ? " 지원서가 생긴 뒤에는 더 넓혀 주는 방향만 수정할 수 있고, 승인 시 기존 직업 교체/추가 방식은 잠깁니다."
              : ""}
          </div>
        ) : null}
        </div>

        <div className={`space-y-3 ${mobileStep === "jobs" ? "block" : "hidden"} md:block`}>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="amber">부족 직업 {jobsNeedingRecruitment.length}개</Badge>
                <Badge tone="indigo">추가 채용 필요 {totalNeededHeadcount}명</Badge>
                <Badge tone="slate">
                  {allSelected ? "전체 직업 선택됨" : `${selectedJobIds.length}개 선택`}
                </Badge>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-600">
                목표 인원이 설정된 직업은 부족 인원 순으로 먼저 보여줍니다. `부족 직업만
                선택`을 누르면 지금 더 뽑아야 하는 직업만 바로 라운드에 담을 수 있습니다.
              </p>
            </div>
            <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black text-slate-900">모집할 직업 선택</p>
                <p className="text-xs text-slate-500">
                  직업 정의에 등록된 직업 중 이번 회차에 열 직업만 선택합니다.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                <Button
                  size="sm"
                  kind="outline"
                  tone="slate"
                  onClick={() => handleSelectJobIds(jobDefinitions.map((job) => job.id))}
                >
                  전체 선택
                </Button>
                <Button
                  size="sm"
                  kind="outline"
                  tone="amber"
                  onClick={() => handleSelectJobIds(suggestedJobIds)}
                  disabled={suggestedJobIds.length === 0}
                >
                  부족 직업만 선택
                </Button>
                <Button
                  size="sm"
                  kind="outline"
                  tone="slate"
                  onClick={() => handleSelectJobIds([])}
                  disabled={lockedJobIdSet.size > 0 && selectedJobIds.length === lockedJobIdSet.size}
                >
                  전체 해제
                </Button>
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 md:max-h-[280px] md:overflow-y-auto">
              {jobDefinitions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  먼저 직업 정의를 등록해 주세요.
                </div>
              ) : (
                sortedJobDefinitions.map((job) => {
                  const isChecked = selectedJobIds.includes(job.id);
                  const isLocked = lockedJobIdSet.has(String(job.id || "").trim());
                  const currentHeadcount = Math.max(0, Number(job?.currentHeadcount || 0));
                  const targetHeadcount =
                    job?.targetHeadcount === null || job?.targetHeadcount === undefined
                      ? null
                      : Math.max(0, Number(job.targetHeadcount || 0));
                  const neededHeadcount = Math.max(0, Number(job?.neededHeadcount || 0));
                  return (
                    <label
                      key={job.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-3 py-3 transition ${
                        isChecked
                          ? "border-indigo-200 bg-indigo-50/70"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      } ${isLocked ? "cursor-not-allowed opacity-80" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleJob(job.id)}
                        disabled={isLocked}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-slate-900">{job.name}</p>
                          <Badge tone="indigo">
                            주급 {formatDisplayMoney(Number(job.baseSalary || 0))}
                          </Badge>
                          <Badge tone="blue">현재 {currentHeadcount}명</Badge>
                          {isLocked ? <Badge tone="slate">기존 모집</Badge> : null}
                          {targetHeadcount === null ? (
                            <Badge tone="slate">목표 미설정</Badge>
                          ) : neededHeadcount > 0 ? (
                            <Badge tone="amber">부족 {neededHeadcount}명</Badge>
                          ) : (
                            <Badge tone="emerald">목표 {targetHeadcount}명</Badge>
                          )}
                        </div>
                        <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-500">
                          {job.description || "등록된 직업 설명이 없습니다."}
                        </p>
                        <p className="mt-2 text-xs font-semibold text-slate-500">
                          {targetHeadcount === null
                            ? "목표 인원을 아직 설정하지 않은 직업입니다."
                            : neededHeadcount > 0
                              ? `현재 ${currentHeadcount}명이라 ${neededHeadcount}명 더 모집하는 쪽이 좋습니다.`
                              : `현재 ${currentHeadcount}명으로 목표 인원을 채운 상태입니다.`}
                        </p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            <div className="grid gap-1 text-xs font-semibold text-slate-500 sm:flex sm:items-center sm:justify-between">
              <span>{allSelected ? "전체 직업 선택됨" : `${selectedJobIds.length}개 선택`}</span>
              <span>모집 회차를 열면 학생이 바로 지원할 수 있습니다.</span>
            </div>
        </div>

        <div className="sticky bottom-0 z-20 -mx-4 grid grid-cols-2 gap-2 border-t bg-white/95 px-4 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:static md:mx-0 md:flex md:justify-end md:border-0 md:bg-transparent md:px-0 md:pb-0 md:pt-0">
          <Button kind="outline" tone="slate" onClick={onClose}>
            닫기
          </Button>
          {mobileStep === "rules" ? (
            <Button
              tone="blue"
              onClick={() => setMobileStep("jobs")}
              className="md:hidden"
            >
              다음: 직업 선택
            </Button>
          ) : null}
          <Button
            tone="blue"
            icon={isEditMode ? FileText : Plus}
            onClick={onSubmit}
            isLoading={isSubmitting}
            className={mobileStep === "rules" ? "hidden md:inline-flex" : ""}
          >
            {isEditMode ? "규칙 저장" : "모집 시작"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const ApplicationModal = ({
  isOpen,
  onClose,
  round,
  currentStudent,
  job,
  currencyUnit,
  experience,
  onExperienceChange,
  reason,
  onReasonChange,
  onSubmit,
  isSubmitting,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  if (!job || !round) return null;

  const hasTargetHeadcount =
    job?.targetHeadcount !== null && job?.targetHeadcount !== undefined;
  const currentHeadcount = Math.max(0, Number(job?.currentHeadcount || 0));
  const targetHeadcount = hasTargetHeadcount
    ? Math.max(0, Number(job?.targetHeadcount || 0))
    : null;
  const neededHeadcount = hasTargetHeadcount
    ? Math.max(0, Number(job?.neededHeadcount || 0))
    : 0;
  const pendingCount = Math.max(0, Number(job?.pendingCount || 0));
  const headcountSummary = formatHeadcountSummary({
    currentHeadcount,
    targetHeadcount,
    neededHeadcount,
    pendingCount,
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${round.title} 지원서`} size="lg">
      <div className="space-y-5">
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="indigo">{round.title}</Badge>
            <Badge tone="slate">
              주급 {formatDisplayMoney(Number(job.baseSalary || 0))}
              {currencyUnit}
            </Badge>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl bg-white/90 px-3 py-3 ring-1 ring-indigo-100">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                이름
              </p>
              <p className="mt-1 text-sm font-black text-slate-900">
                {currentStudent?.name || "학생"}
              </p>
            </div>
            <div className="rounded-2xl bg-white/90 px-3 py-3 ring-1 ring-indigo-100">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                번호
              </p>
              <p className="mt-1 text-sm font-black text-slate-900">
                {currentStudent?.studentNumber ? `${currentStudent.studentNumber}번` : "-"}
              </p>
            </div>
            <div className="rounded-2xl bg-white/90 px-3 py-3 ring-1 ring-indigo-100 md:col-span-2">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                희망 직업
              </p>
              <p className="mt-1 text-sm font-black text-slate-900">{job.name}</p>
            </div>
            <div className="rounded-2xl bg-white/90 px-3 py-3 ring-1 ring-indigo-100 md:col-span-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold">
                {headcountSummary.map((item) => (
                  <span key={item.text} className={item.className}>
                    {item.text}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {targetHeadcount === null
                  ? "이 직업은 아직 목표 인원이 설정되지 않았어요."
                  : neededHeadcount > 0
                    ? `현재 ${currentHeadcount}명이 배치되어 있고, 지금은 ${neededHeadcount}명을 더 모집 중이에요.`
                    : `현재 ${currentHeadcount}명이 배치되어 있어 목표 인원을 채운 상태예요.`}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">이력 / 강점</label>
          <Textarea
            rows={4}
            value={experience}
            onChange={(event) => onExperienceChange(event.target.value)}
            placeholder="관련 경험이나 내가 잘하는 점을 적어 주세요."
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">지원 이유</label>
          <Textarea
            rows={5}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="왜 이 직업을 맡고 싶은지 적어 주세요."
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button kind="outline" tone="slate" onClick={onClose}>
            닫기
          </Button>
          <Button tone="blue" icon={Send} onClick={onSubmit} isLoading={isSubmitting}>
            지원서 제출
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const JobStaffingSummary = ({ jobDefinitionId, jobName, jobDefinitions = [], round }) => {
  const matchesJob = (job) => jobDefinitionId && job.id === jobDefinitionId;
  const matchesName = (job) => job.name === jobName;
  const currentJob = jobDefinitions.find(matchesJob) || jobDefinitions.find(matchesName);
  const roundJob = round?.jobs?.find(matchesJob) || round?.jobs?.find(matchesName);
  const rawTarget = currentJob ? currentJob.targetHeadcount : roundJob?.targetHeadcount;
  const target = rawTarget === null || rawTarget === undefined || rawTarget === ""
    ? null : Number(rawTarget);
  const current = currentJob?.currentHeadcount;
  const hasTarget = target !== null && Number.isFinite(target) && target >= 0;
  const hasCurrent = Number.isFinite(current) && current >= 0;

  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums" aria-label="직업 인원 현황">
      <span className="font-semibold text-slate-800">목표 인원 {hasTarget ? `${target}명` : "미설정"}</span>
      <span className="text-slate-600">현재 배정 {hasCurrent ? `${current}명` : "확인 불가"}</span>
      {hasTarget && hasCurrent ? (
        <span className={current < target ? "text-amber-700" : "text-slate-600"}>
          {current < target ? `목표까지 ${target - current}명 남음` : current > target ? `목표보다 ${current - target}명 많음` : "목표 인원 충족"}
        </span>
      ) : null}
    </div>
  );
};

const ApplicationDetailModal = ({
  application,
  jobDefinitions = [],
  round,
  canManageApplications,
  isProcessing,
  onClose,
  onApprove,
  onReject,
}) => {
  if (!application) return null;

  const statusMeta = STATUS_META[application.status] || STATUS_META.submitted;

  return (
    <Modal isOpen={Boolean(application)} onClose={onClose} title="지원서 상세 보기" size="lg">
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
            {application.jobName ? <Badge tone="slate">{application.jobName}</Badge> : null}
            <Badge tone="indigo">{application.roundTitle || "직업 모집"}</Badge>
          </div>
          <h2 className="mt-3 break-words text-xl font-bold text-slate-900">
            {application.studentNumber ? `${application.studentNumber}번 · ` : ""}{application.studentName || "학생 정보 없음"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">제출일 {toDisplayDateTime(application.submittedAt)}</p>
          <JobStaffingSummary jobDefinitionId={application.jobDefinitionId} jobName={application.jobName} jobDefinitions={jobDefinitions} round={round} />
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-bold text-slate-900">이력 / 강점</h3>
          <div className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white px-5 py-4 text-base leading-7 text-slate-800">
            {application.experience || "작성된 내용이 없습니다."}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-bold text-slate-900">지원 이유</h3>
          <div className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white px-5 py-4 text-base leading-7 text-slate-800">
            {application.reason || "작성된 내용이 없습니다."}
          </div>
        </div>

        {application.status === "rejected" && application.rejectionReason ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            반려 사유: {application.rejectionReason}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          {canManageApplications && application.status === "submitted" ? (
            <>
              <Button
                size="sm"
                kind="outline"
                tone="slate"
                onClick={() => onReject(application)}
                disabled={isProcessing}
              >
                반려
              </Button>
              <Button
                size="sm"
                tone="emerald"
                icon={UserCheck}
                onClick={() => onApprove(application)}
                isLoading={isProcessing}
                disabled={isProcessing}
              >
                승인
              </Button>
            </>
          ) : null}
          <Button kind="outline" tone="slate" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const RejectionReasonModal = ({
  isOpen,
  application,
  count = 0,
  isBulk = false,
  reason,
  onReasonChange,
  onClose,
  onSubmit,
  isSubmitting,
}) => {
  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isBulk ? "지원서 일괄 반려" : "지원서 반려"} size="md">
      <div className="space-y-4">
        <div className="rounded-2xl border border-rose-100 bg-rose-50/80 p-4">
          <p className="text-sm font-black text-slate-900">
            {isBulk
              ? `${count}건 선택됨`
              : `${application?.studentName || "학생"} · ${application?.jobName || "지원서"}`}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            반려 사유는 선택 입력입니다. 비워 둬도 {isBulk ? "일괄 반려" : "반려"}할 수 있습니다.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">반려 사유</label>
          <Textarea
            rows={5}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="필요하면 학생에게 보여줄 반려 사유를 적어 주세요. (선택)"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button kind="outline" tone="slate" onClick={onClose}>
            취소
          </Button>
          <Button tone="rose" icon={XCircle} onClick={onSubmit} isLoading={isSubmitting}>
            반려하기
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const ApplicationReviewModal = ({
  isOpen,
  onClose,
  round,
  applications,
  filteredApplications,
  statusFilter,
  onStatusFilterChange,
  selectedApplicationIds,
  onToggleApplicationSelection,
  onSetApplicationSelection,
  onOpenDetail,
  studentsByUid,
  currencyUnit,
  jobDefinitions = [],
  onExport,
  legacyApplications,
  selectedCount,
  onBulkApprove,
  onBulkReject,
  onClearSelection,
  isBulkApproving,
  isBulkRejecting,
  isLoading = false,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const groupedApplications = useMemo(
    () => groupApplicationsByJob(filteredApplications, round),
    [filteredApplications, round],
  );
  const submittedCount = useMemo(
    () => applications.filter((application) => application.status === "submitted").length,
    [applications],
  );
  const approvedCount = useMemo(
    () => applications.filter((application) => application.status === "approved").length,
    [applications],
  );
  const rejectedCount = useMemo(
    () => applications.filter((application) => application.status === "rejected").length,
    [applications],
  );
  const [focusedJobKey, setFocusedJobKey] = useState("all");
  const [showPendingJobsOnly, setShowPendingJobsOnly] = useState(false);
  const orderedGroupedApplications = useMemo(
    () =>
      showPendingJobsOnly
        ? groupedApplications.filter((group) => group.submittedCount > 0)
        : groupedApplications,
    [groupedApplications, showPendingJobsOnly],
  );
  const pendingGroupKeys = useMemo(
    () =>
      groupedApplications
        .filter((group) => group.submittedCount > 0)
        .map((group) => group.key),
    [groupedApplications],
  );
  const defaultExpandedGroupKeys = useMemo(() => {
    if (orderedGroupedApplications.length === 0) return [];
    return orderedGroupedApplications
      .filter((group) => group.submittedCount > 0)
      .map((group) => group.key);
  }, [orderedGroupedApplications]);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState([]);
  const [isRoundMetaOpen, setIsRoundMetaOpen] = useState(false);
  const [isLegacyExpanded, setIsLegacyExpanded] = useState(false);
  const dragSelectionRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    setShowPendingJobsOnly(false);
    setIsRoundMetaOpen(false);
    setIsLegacyExpanded(false);
    setExpandedGroupKeys([]);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const nextKeys = orderedGroupedApplications.map((group) => group.key);
    setExpandedGroupKeys((prev) => {
      const visibleKeys = prev.filter((key) => nextKeys.includes(key));
      if (visibleKeys.length > 0) return visibleKeys;
      return defaultExpandedGroupKeys;
    });
  }, [defaultExpandedGroupKeys, isOpen, orderedGroupedApplications]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const clearDragSelection = () => {
      dragSelectionRef.current = null;
    };

    window.addEventListener("pointerup", clearDragSelection);
    return () => {
      window.removeEventListener("pointerup", clearDragSelection);
      clearDragSelection();
    };
  }, [isOpen]);

  const toggleGroup = (groupKey) => {
    setExpandedGroupKeys((prev) =>
      prev.includes(groupKey)
        ? prev.filter((key) => key !== groupKey)
        : [...prev, groupKey],
    );
  };

  const startSelectionGesture = (applicationId) => {
    const shouldSelect = !selectedApplicationIds.includes(applicationId);
    dragSelectionRef.current = {
      shouldSelect,
      visited: new Set([applicationId]),
    };
    onSetApplicationSelection(applicationId, shouldSelect);
  };

  const continueSelectionGesture = (applicationId) => {
    const dragSelection = dragSelectionRef.current;
    if (!dragSelection || dragSelection.visited.has(applicationId)) return;

    dragSelection.visited.add(applicationId);
    onSetApplicationSelection(applicationId, dragSelection.shouldSelect);
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="지원자 보기"
      size="full"
    >
      <div className="space-y-5">
        {!round ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 py-14 text-center text-sm font-medium text-slate-500">
            아직 확인할 모집 회차가 없습니다.
          </div>
        ) : (
          <>
            <div className="rounded-[2rem] border border-slate-200 bg-slate-50/80 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xl font-bold text-slate-900">{round.title}</p>
                    <Badge
                      tone={
                        (ROUND_STATUS_META[round.status] || ROUND_STATUS_META.closed).tone
                      }
                    >
                      {(ROUND_STATUS_META[round.status] || ROUND_STATUS_META.closed).label}
                    </Badge>
                  </div>
                  <p className="text-sm leading-6 text-slate-500">
                    모집 직업 {round.jobs?.length || 0}개 · 지원서 {applications.length}건을
                    한 화면에서 확인할 수 있습니다.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    kind="outline"
                    tone="slate"
                    onClick={() => setIsRoundMetaOpen((prev) => !prev)}
                  >
                    {isRoundMetaOpen ? "모집 규칙 접기" : "모집 규칙 보기"}
                  </Button>
                  <Button
                    kind="outline"
                    tone="slate"
                    icon={Download}
                    onClick={onExport}
                    disabled={applications.length === 0 || isLoading}
                  >
                    엑셀 다운로드
                  </Button>
                </div>
              </div>

              {isRoundMetaOpen ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                  <Badge tone="slate">
                    다중 지원 {round.allowMultipleApplications ? "허용" : "제한"}
                  </Badge>
                  <Badge tone="slate">
                    학생당 최대 지원 {Math.max(1, Number(round.maxApplicationsPerStudent || 1))}
                    개
                  </Badge>
                  <Badge tone="slate">
                    학생당 최대 승인 {Math.max(1, Number(round.maxApprovedJobsPerStudent || 1))}
                    개
                  </Badge>
                  <Badge tone="slate">
                    현재 직업 재지원 {round.allowCurrentJobApplications ? "허용" : "제한"}
                  </Badge>
                  <Badge tone="slate">
                    승인 시 기존 직업 {round.replaceExistingJobsOnApproval ? "교체" : "추가"}
                  </Badge>
                </div>
              ) : null}
            </div>

            <div className="hidden grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["all", "전체", applications.length, "모든 지원서"],
                ["submitted", "검토 대기", submittedCount, "지금 확인 필요"],
                ["approved", "승인", approvedCount, "승인 완료"],
                ["rejected", "반려", rejectedCount, "반려 완료"],
              ].map(([value, title, count, description]) => (
                <Button
                  key={value}
                  type="button"
                  onClick={() => onStatusFilterChange(value)}
                  tone="slate"
                  kind={statusFilter === value ? "soft" : "outline"}
                  rounded="xl"
                  className={`rounded-[1.6rem] border px-4 py-4 text-left transition ${
                    statusFilter === value
                      ? value === "submitted"
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : value === "approved"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : value === "rejected"
                            ? "border-rose-200 bg-rose-50 text-rose-900"
                            : "border-slate-300 bg-slate-100 text-slate-900"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <p className="text-[11px] font-black tracking-[0.18em] opacity-70">
                    {title}
                  </p>
                  <p className="mt-2 text-2xl font-black">{count}</p>
                  <p className="mt-1 text-xs opacity-70">{description}</p>
                </Button>
              ))}
            </div>

            {false && groupedApplications.length > 1 ? (
              <div className="flex flex-col gap-3 rounded-[1.6rem] border border-slate-200 bg-white px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label
                    htmlFor="job-review-priority"
                    className="text-sm font-black text-slate-700"
                  >
                    직업 먼저 보기
                  </label>
                  <select
                    id="job-review-priority"
                    value={focusedJobKey}
                    onChange={(event) => setFocusedJobKey(event.target.value)}
                    className="min-w-[220px] rounded-xl border border-blue-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-blue-50/50"
                  >
                    <option value="all">전체 직업 순서대로 보기</option>
                    {groupedApplications.map((group) => (
                      <option key={group.key} value={group.key}>
                        {group.jobName}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-slate-500">
                  선택한 직업은 맨 위에서 먼저 펼쳐 보여줍니다.
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 rounded-[1.6rem] border border-slate-200 bg-white px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                {[
                  ["all", "전체"],
                  ["submitted", "검토 대기"],
                  ["approved", "승인"],
                  ["rejected", "반려"],
                ].map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    onClick={() => onStatusFilterChange(value)}
                    tone="slate"
                    kind={statusFilter === value ? "soft" : "outline"}
                    size="xs"
                    rounded="full"
                    className={`rounded-full px-3 py-1.5 text-xs font-black transition ${
                      statusFilter === value
                        ? value === "submitted"
                          ? "bg-amber-100 text-amber-900"
                          : value === "approved"
                            ? "bg-emerald-100 text-emerald-900"
                            : value === "rejected"
                              ? "bg-rose-100 text-rose-900"
                              : "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {pendingGroupKeys.length > 0 ? (
                  <Button
                    size="sm"
                    kind="outline"
                    tone={showPendingJobsOnly ? "amber" : "slate"}
                    onClick={() => setShowPendingJobsOnly((prev) => !prev)}
                  >
                    {showPendingJobsOnly ? "전체 직업 보기" : "검토 필요만 보기"}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  kind="outline"
                  tone="slate"
                  onClick={() =>
                    setExpandedGroupKeys((prev) =>
                      prev.length > 0
                        ? []
                        : defaultExpandedGroupKeys.length > 0
                          ? defaultExpandedGroupKeys
                          : orderedGroupedApplications.map((group) => group.key),
                    )
                  }
                >
                  {expandedGroupKeys.length > 0 ? "모두 접기" : "검토 필요 펼치기"}
                </Button>
                <p className="text-xs text-slate-500">
                  검토 대기 지원자가 있는 직업이 위로 올라오고 먼저 펼쳐집니다.
                </p>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Spinner size="md" tone="indigo" />
              </div>
            ) : filteredApplications.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 py-14 text-center text-sm font-medium text-slate-500">
                해당 조건의 지원서가 없습니다.
              </div>
            ) : (
              <div className="space-y-4">
                {orderedGroupedApplications.map((group) => {
                  const isExpanded = expandedGroupKeys.includes(group.key);

                  return (
                    <div
                      key={group.key}
                      className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm"
                    >
                      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 p-5 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-black text-slate-900">{group.jobName}</p>
                            <Badge tone="indigo">
                              주급 {formatDisplayMoney(Number(group.baseSalary || 0))}
                              {currencyUnit}
                            </Badge>
                            <Badge tone="slate">지원 {group.applications.length}명</Badge>
                            {group.submittedCount > 0 ? (
                              <Badge tone="amber">검토 대기 {group.submittedCount}명</Badge>
                            ) : (
                              <Badge tone="slate">검토 완료</Badge>
                            )}
                          </div>
                          <JobStaffingSummary jobDefinitionId={group.jobDefinitionId} jobName={group.jobName} jobDefinitions={jobDefinitions} round={round} />
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            kind="outline"
                            tone="slate"
                            onClick={() => toggleGroup(group.key)}
                          >
                            {isExpanded ? "접기" : "열기"}
                          </Button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="grid gap-4 p-4 min-[900px]:grid-cols-2">
                          {group.applications.map((application) => {
                            const statusMeta =
                              STATUS_META[application.status] || STATUS_META.submitted;
                            const currentJobsText =
                              normalizeJobs(studentsByUid.get(application.studentUid)).join(
                                ", ",
                              ) || "배정 없음";
                            const isSelected = selectedApplicationIds.includes(application.id);

                            return (
                              <div
                                key={application.id}
                                className={`rounded-3xl border px-4 py-4 transition ${
                                  application.status === "submitted" && isSelected
                                    ? "border-indigo-200 bg-indigo-50/40"
                                    : "border-slate-200 bg-white"
                                } self-start`}
                              >
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                  <div
                                    role={application.status === "submitted" ? "button" : undefined}
                                    tabIndex={application.status === "submitted" ? 0 : undefined}
                                    onPointerDown={
                                      application.status === "submitted"
                                        ? (event) => {
                                            if (event.pointerType === "mouse" && event.button !== 0) {
                                              return;
                                            }
                                            event.preventDefault();
                                            startSelectionGesture(application.id);
                                          }
                                        : undefined
                                    }
                                    onPointerEnter={
                                      application.status === "submitted"
                                        ? () => continueSelectionGesture(application.id)
                                        : undefined
                                    }
                                    onKeyDown={
                                      application.status === "submitted"
                                        ? (event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                              event.preventDefault();
                                              onToggleApplicationSelection(application.id);
                                            }
                                          }
                                        : undefined
                                    }
                                    className={`min-w-0 flex-1 select-none rounded-2xl px-2 py-2 transition ${
                                      application.status === "submitted"
                                        ? isSelected
                                          ? "cursor-pointer bg-indigo-50 ring-1 ring-indigo-200"
                                          : "cursor-pointer hover:bg-slate-50"
                                        : ""
                                    }`}
                                  >
                                    <div className="flex items-start gap-3">
                                      <div className="pt-1">
                                        {application.status === "submitted" ? (
                                          <input
                                            type="checkbox"
                                            aria-label={`${application.studentName || "학생"} 지원서 선택`}
                                            checked={isSelected}
                                            onChange={() =>
                                              onToggleApplicationSelection(application.id)
                                            }
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={(event) => event.stopPropagation()}
                                            className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                                          />
                                        ) : (
                                          <span className="mt-0.5 block h-4 w-4 rounded-full bg-slate-100" />
                                        )}
                                      </div>

                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-base font-black text-slate-900">
                                            {application.studentName}
                                          </p>
                                          {application.studentNumber ? (
                                            <span className="text-xs font-semibold text-slate-400">
                                              {application.studentNumber}번
                                            </span>
                                          ) : null}
                                          <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600">
                                          <span>현재 직업 {currentJobsText}</span>
                                          <span>제출일 {toDisplayDate(application.submittedAt)}</span>
                                          {application.experience ? (
                                            <span>이력 작성됨</span>
                                          ) : null}
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex shrink-0 items-center justify-end">
                                    <Button
                                      kind="outline"
                                      tone="slate"
                                      onClick={() => onOpenDetail(application)}
                                    >
                                      지원서 읽기
                                    </Button>
                                  </div>
                                </div>

                                <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                                  {[["지원 이유", application.reason], ["이력 / 강점", application.experience]].map(([label, text]) => (
                                    <section key={label}>
                                      <h4 className="text-xs font-semibold text-slate-500">{label}</h4>
                                      <p className="mt-1 whitespace-pre-wrap break-words line-clamp-3 text-sm leading-6 text-slate-800">
                                        {text || "작성된 내용이 없습니다."}
                                      </p>
                                    </section>
                                  ))}
                                </div>

                                {application.status === "rejected" &&
                                application.rejectionReason ? (
                                  <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                                    반려 사유: {application.rejectionReason}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {legacyApplications.length > 0 ? (
          <div className="rounded-[2rem] border border-slate-200 bg-slate-50/70 p-5">
            <Button
              type="button"
              onClick={() => setIsLegacyExpanded((prev) => !prev)}
              tone="slate"
              kind="ghost"
              rounded="xl"
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <div>
                <p className="text-base font-black text-slate-900">이전 방식 지원서</p>
                <p className="mt-1 text-sm text-slate-500">
                  회차 도입 전 지원서 {legacyApplications.length}건을 참고용으로 모아두었습니다.
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-500">
                {isLegacyExpanded ? "접기" : "펼치기"}
              </span>
            </Button>

            {isLegacyExpanded ? (
              <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                {legacyApplications.map((application) => {
                  const statusMeta =
                    STATUS_META[application.status] || STATUS_META.submitted;

                  return (
                    <Button
                      key={application.id}
                      type="button"
                      onClick={() => onOpenDetail(application)}
                      tone="slate"
                      kind="outline"
                      rounded="xl"
                      className="flex w-full items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-slate-900">
                            {application.studentName}
                          </p>
                          <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                          <Badge tone="slate">이전 데이터</Badge>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                          {application.jobName || "직업 정보 없음"} · 제출일{" "}
                          {toDisplayDate(application.submittedAt)}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-slate-400">상세 보기</span>
                    </Button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedCount > 0 ? (
          <BulkActionFloatingBar
            placement="inline"
            count={selectedCount}
            tone="indigo"
            icon={FileText}
            title={`${selectedCount}건 선택됨`}
            subtitle="선택한 검토 대기 지원서를 한 번에 승인하거나 반려할 수 있습니다."
            actions={[
              {
                key: "bulk-approve",
                label: "일괄 승인",
                icon: UserCheck,
                tone: "emerald",
                onClick: onBulkApprove,
                isLoading: isBulkApproving,
              },
              {
                key: "bulk-reject",
                label: "일괄 반려",
                icon: XCircle,
                tone: "rose",
                onClick: onBulkReject,
                isLoading: isBulkRejecting,
              },
            ]}
            onClear={onClearSelection}
            clearLabel="선택 해제"
          />
        ) : null}
      </div>
    </Modal>
  );
};

const MyApplicationCard = ({ application, currencyUnit }) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const statusMeta = STATUS_META[application.status] || STATUS_META.submitted;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-black text-slate-900">{application.jobName}</p>
            <Badge tone="slate">{application.roundTitle || "기존 지원"}</Badge>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-500">
            주급 {formatDisplayMoney(Number(application.baseSalary || 0))}
            {currencyUnit}
          </p>
        </div>
        <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
      </div>
      <p className="mt-3 text-xs font-medium text-slate-400">
        제출일 {toDisplayDate(application.submittedAt)}
      </p>
      {application.experience ? (
        <p className="mt-2 text-sm leading-6 text-slate-600">
          이력/강점: {application.experience}
        </p>
      ) : null}
      {application.reason ? (
        <p className="mt-2 text-sm leading-6 text-slate-600">
          지원 이유: {application.reason}
        </p>
      ) : null}
      {application.status === "rejected" && application.rejectionReason ? (
        <p className="mt-2 text-sm font-medium text-rose-600">
          반려 사유: {application.rejectionReason}
        </p>
      ) : null}
    </div>
  );
};

const RecruitmentFlyerCard = ({
  job,
  currencyUnit,
  pendingCount,
  ownApplication,
  alreadyAssigned,
  allowCurrentJobApplications,
  maxApplicationsPerStudent,
  isClosedRound,
  isBlockedByRoundLimit,
  onApply,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const statusMeta =
    ownApplication && STATUS_META[ownApplication.status]
      ? STATUS_META[ownApplication.status]
      : null;
  const hasTargetHeadcount =
    job?.targetHeadcount !== null && job?.targetHeadcount !== undefined;
  const currentHeadcount = Math.max(0, Number(job?.currentHeadcount || 0));
  const targetHeadcount = hasTargetHeadcount
    ? Math.max(0, Number(job?.targetHeadcount || 0))
    : null;
  const neededHeadcount = hasTargetHeadcount
    ? Math.max(0, Number(job?.neededHeadcount || 0))
    : 0;
  const headcountSummary = formatHeadcountSummary({
    currentHeadcount,
    targetHeadcount,
    neededHeadcount,
    pendingCount,
  });

  const buttonLabel = isClosedRound
    ? "모집 마감"
    : ownApplication?.status === "submitted"
        ? "지원 완료"
      : ownApplication?.status === "approved"
        ? "승인 완료"
        : isBlockedByRoundLimit
          ? `이번 모집 ${Math.max(1, Number(maxApplicationsPerStudent || 1))}개까지`
          : alreadyAssigned && !allowCurrentJobApplications
            ? "이미 맡은 직업"
            : ownApplication?.status === "rejected" || alreadyAssigned
              ? "다시 지원하기"
              : "지원하기";

  return (
    <article className="group rounded-[1.6rem] border border-slate-200 bg-white px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-lg font-black text-slate-900">{job.name}</p>
            <Badge tone="slate">
              주급 {formatDisplayMoney(Number(job.baseSalary || 0))}
              {currencyUnit}
            </Badge>
            {alreadyAssigned ? <Badge tone="slate">현재 직업</Badge> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold">
            {headcountSummary
              .filter((item) => !item.text.startsWith("지원 "))
              .map((item) => (
                <span key={item.text} className={item.className}>
                  {item.text}
                </span>
              ))}
          </div>
          <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-6 text-slate-600">
            {job.description || "아직 직업 설명이 등록되지 않았습니다."}
          </p>
        </div>
        {pendingCount > 0 ? (
          <span className="shrink-0 text-xs font-semibold text-slate-500">
            지원 {pendingCount}건
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-xs font-medium leading-5 text-slate-500">
        {targetHeadcount === null
          ? "목표 인원이 아직 설정되지 않은 직업입니다."
          : neededHeadcount > 0
            ? `현재 ${currentHeadcount}명이 배치되어 있고 ${neededHeadcount}명을 더 모집 중입니다.`
            : `현재 ${currentHeadcount}명으로 목표 인원 ${targetHeadcount}명을 채웠습니다.`}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {statusMeta ? <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge> : null}
        {isClosedRound ? <Badge tone="slate">마감</Badge> : null}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <Button
          size="sm"
          className="w-full"
          tone="blue"
          icon={Send}
          disabled={
            isClosedRound ||
            ownApplication?.status === "submitted" ||
            ownApplication?.status === "approved" ||
            (alreadyAssigned && !allowCurrentJobApplications) ||
            isBlockedByRoundLimit
          }
          onClick={onApply}
        >
          {buttonLabel}
        </Button>
      </div>
    </article>
  );
};

export {
  STATUS_META,
  ROUND_STATUS_META,
  toDisplayDate,
  normalizeJobs,
  buildSuggestedRoundTitle,
  exportApplicationsToExcel,
  RoundCreationModal,
  ApplicationModal,
  ApplicationDetailModal,
  JobStaffingSummary,
  RejectionReasonModal,
  ApplicationReviewModal,
  MyApplicationCard,
  RecruitmentFlyerCard,
};
