import { appConfirm } from "../../../utils/appDialogs";
import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BriefcaseBusiness,
  Clock3,
  Download,
  Eye,
  FileText,
  Lock,
  PencilLine,
  Plus,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  useUser,
} from "../../../contexts/UserContext";
import {
  useFeedback,
} from "../../../contexts/FeedbackContext";
import {
  Badge,
  Button,
  Card,
  Spinner,
} from "../../../components/ui";
import {
  fetchJobApplicationsByRound,
  useJobApplicationRoundTotalsQuery,
  useJobApplicationsQuery,
  useLegacyJobApplicationsQuery,
} from "../../../hooks/tax/useJobApplications";
import {
  useJobRecruitmentRoundsQuery,
} from "../../../hooks/tax/useJobRecruitmentRounds";
import {
  approveJobApplication,
  rejectJobApplication,
  submitJobApplication,
} from "../services/jobApplicationService";
import {
  closeJobRecruitmentRound,
  createJobRecruitmentRound,
  deleteJobRecruitmentRound,
  updateJobRecruitmentRound,
} from "../services/jobRecruitmentRoundService";

import {
  STATUS_META,
  ROUND_STATUS_META,
  toDisplayDate,
  normalizeJobs,
  buildSuggestedRoundTitle,
  exportApplicationsToExcel,
  RoundCreationModal,
  ApplicationModal,
  ApplicationDetailModal,
  RejectionReasonModal,
  ApplicationReviewModal,
  MyApplicationCard,
  RecruitmentFlyerCard,
} from "./JobApplicationTab.parts";

const ROUND_CARD_LIMIT = 6;

const normalizeOptionalHeadcount = (value) => {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return Math.floor(parsed);
};

const normalizeRoundCount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

export default function JobApplicationTab({
  classId,
  students = [],
  jobDefinitions = [],
  currencyUnit,
}) {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { userData, isTeacher, hasPermission } = useUser();
  const { showFeedback } = useFeedback();
  const displayCurrencyUnit = currencyUnit || "원";
  const canManageApplications = isTeacher || hasPermission("labor_admin");

  const { data: rounds = [], isLoading: isRoundsLoading } = useJobRecruitmentRoundsQuery({
    classId,
  });

  const currentStudent = useMemo(
    () => students.find((student) => student.uid === userData?.uid) || userData || {},
    [students, userData],
  );
  const currentJobs = useMemo(() => normalizeJobs(currentStudent), [currentStudent]);
  const studentsByUid = useMemo(
    () => new Map(students.map((student) => [student.uid, student])),
    [students],
  );
  const jobDefinitionsWithStaffing = useMemo(() => {
    const currentCountByJobName = new Map();

    students.forEach((student) => {
      normalizeJobs(student).forEach((jobName) => {
        currentCountByJobName.set(jobName, (currentCountByJobName.get(jobName) || 0) + 1);
      });
    });

    return jobDefinitions.map((job) => {
      const jobName = String(job?.name || "").trim();
      const currentHeadcount = currentCountByJobName.get(jobName) || 0;
      const targetHeadcount = normalizeOptionalHeadcount(job?.targetHeadcount);
      const neededHeadcount =
        targetHeadcount === null ? 0 : Math.max(0, targetHeadcount - currentHeadcount);

      return {
        ...job,
        currentHeadcount,
        targetHeadcount,
        neededHeadcount,
        needsRecruitment: neededHeadcount > 0,
      };
    });
  }, [jobDefinitions, students]);
  const suggestedRecruitmentJobIds = useMemo(
    () =>
      jobDefinitionsWithStaffing
        .filter((job) => job.needsRecruitment)
        .map((job) => job.id)
        .filter(Boolean),
    [jobDefinitionsWithStaffing],
  );

  const activeRound = useMemo(
    () => rounds.find((round) => round.status === "open") || null,
    [rounds],
  );

  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [isRoundListExpanded, setIsRoundListExpanded] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showUnderCapacityOnly, setShowUnderCapacityOnly] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [applicationExperience, setApplicationExperience] = useState("");
  const [applicationReason, setApplicationReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingApplicationId, setProcessingApplicationId] = useState("");
  const [detailApplication, setDetailApplication] = useState(null);
  const [isRoundModalOpen, setIsRoundModalOpen] = useState(false);
  const [roundModalMode, setRoundModalMode] = useState("create");
  const [roundTitle, setRoundTitle] = useState("");
  const [selectedJobIds, setSelectedJobIds] = useState([]);
  const [allowMultipleApplications, setAllowMultipleApplications] = useState(false);
  const [allowCurrentJobApplications, setAllowCurrentJobApplications] = useState(false);
  const [replaceExistingJobsOnApproval, setReplaceExistingJobsOnApproval] = useState(true);
  const [maxApplicationsPerStudent, setMaxApplicationsPerStudent] = useState("2");
  const [maxApprovedJobsPerStudent, setMaxApprovedJobsPerStudent] = useState("1");
  const [isCreatingRound, setIsCreatingRound] = useState(false);
  const [isUpdatingRound, setIsUpdatingRound] = useState(false);
  const [isClosingRound, setIsClosingRound] = useState(false);
  const [isDeletingRound, setIsDeletingRound] = useState(false);
  const [selectedApplicationIds, setSelectedApplicationIds] = useState([]);
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const [isBulkRejectMode, setIsBulkRejectMode] = useState(false);
  const [rejectTargetApplication, setRejectTargetApplication] = useState(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState("");
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isSelectedRoundMetaOpen, setIsSelectedRoundMetaOpen] = useState(false);
  const [isExportingRoundApplications, setIsExportingRoundApplications] = useState(false);

  useEffect(() => {
    const nextRoundId = activeRound?.id || rounds[0]?.id || "";
    if (!nextRoundId) {
      if (selectedRoundId) setSelectedRoundId("");
      return;
    }

    const hasSelectedRound = rounds.some((round) => round.id === selectedRoundId);
    if (!selectedRoundId || !hasSelectedRound) {
      setSelectedRoundId(nextRoundId);
    }
  }, [activeRound, rounds, selectedRoundId]);

  const selectedRound = useMemo(
    () => rounds.find((round) => round.id === selectedRoundId) || activeRound || rounds[0] || null,
    [activeRound, rounds, selectedRoundId],
  );

  useEffect(() => {
    setIsSelectedRoundMetaOpen(false);
  }, [selectedRound?.id]);

  const teacherQueryRoundId =
    canManageApplications && isReviewModalOpen ? selectedRound?.id || "" : "";
  const { data: applications = [], isLoading: isApplicationsLoading } = useJobApplicationsQuery({
    classId,
    userUid: userData?.uid,
    canManageAll: canManageApplications,
    roundId: teacherQueryRoundId,
    enabled: !canManageApplications || Boolean(teacherQueryRoundId),
  });
  const { data: roundTotalsById = {} } = useJobApplicationRoundTotalsQuery({
    classId,
    rounds,
  });
  const { data: teacherLegacyApplications = [] } = useLegacyJobApplicationsQuery({
    classId,
    enabled: canManageApplications && isReviewModalOpen,
  });
  const visibleRounds = useMemo(
    () => (isRoundListExpanded ? rounds : rounds.slice(0, ROUND_CARD_LIMIT)),
    [isRoundListExpanded, rounds],
  );
  const featuredStudentRound = useMemo(
    () => activeRound || rounds[0] || null,
    [activeRound, rounds],
  );
  const jobDefinitionsWithStaffingById = useMemo(
    () =>
      new Map(
        jobDefinitionsWithStaffing
          .filter((job) => String(job?.id || "").trim())
          .map((job) => [String(job.id).trim(), job]),
      ),
    [jobDefinitionsWithStaffing],
  );
  const jobDefinitionsWithStaffingByName = useMemo(
    () =>
      new Map(
        jobDefinitionsWithStaffing
          .filter((job) => String(job?.name || "").trim())
          .map((job) => [String(job.name).trim(), job]),
      ),
    [jobDefinitionsWithStaffing],
  );
  const featuredStudentRoundJobs = useMemo(() => {
    if (!featuredStudentRound) return [];

    return (featuredStudentRound.jobs || []).map((roundJob) => {
      const roundJobId = String(roundJob?.id || "").trim();
      const roundJobName = String(roundJob?.name || "").trim();
      const staffingJob =
        (roundJobId ? jobDefinitionsWithStaffingById.get(roundJobId) : null) ||
        (roundJobName ? jobDefinitionsWithStaffingByName.get(roundJobName) : null);
      const currentHeadcount = Math.max(0, Number(staffingJob?.currentHeadcount || 0));
      const targetHeadcount =
        staffingJob?.targetHeadcount ?? normalizeOptionalHeadcount(roundJob?.targetHeadcount);
      const normalizedTargetHeadcount =
        targetHeadcount === null ? null : Math.max(0, Number(targetHeadcount || 0));
      const neededHeadcount =
        normalizedTargetHeadcount === null
          ? 0
          : Math.max(0, normalizedTargetHeadcount - currentHeadcount);

      return {
        ...roundJob,
        currentHeadcount,
        targetHeadcount: normalizedTargetHeadcount,
        neededHeadcount,
        needsRecruitment: normalizedTargetHeadcount !== null && neededHeadcount > 0,
      };
    });
  }, [
    featuredStudentRound,
    jobDefinitionsWithStaffingById,
    jobDefinitionsWithStaffingByName,
  ]);

  const selectedRoundApplications = useMemo(
    () =>
      canManageApplications
        ? applications
        : selectedRound
        ? applications.filter((application) => application.roundId === selectedRound.id)
        : [],
    [applications, canManageApplications, selectedRound],
  );
  const selectedRoundStatusCounts = useMemo(
    () =>
      selectedRoundApplications.reduce(
        (counts, application) => {
          if (application.status === "submitted") counts.submittedCount += 1;
          if (application.status === "approved") counts.approvedCount += 1;
          if (application.status === "rejected") counts.rejectedCount += 1;
          return counts;
        },
        {
          submittedCount: 0,
          approvedCount: 0,
          rejectedCount: 0,
        },
      ),
    [selectedRoundApplications],
  );
  const submittedCount = selectedRoundStatusCounts.submittedCount;
  const approvedCount = selectedRoundStatusCounts.approvedCount;
  const rejectedCount = selectedRoundStatusCounts.rejectedCount;
  const selectedRoundSummary = useMemo(() => {
    if (!selectedRound) {
      return "선택한 모집 회차가 없습니다. 새 모집을 시작해 보세요.";
    }

    return [
      `직업 ${selectedRound.jobs?.length || 0}개`,
      `지원 ${selectedRoundApplications.length}건`,
      `최대 지원 ${Math.max(1, Number(selectedRound.maxApplicationsPerStudent || 1))}개`,
      `최대 승인 ${Math.max(1, Number(selectedRound.maxApprovedJobsPerStudent || 1))}개`,
      selectedRound.allowCurrentJobApplications ? "재지원 가능" : "재지원 제한",
      selectedRound.replaceExistingJobsOnApproval
        ? "승인 시 기존 직업 교체"
        : "승인 시 기존 직업 유지",
    ].join(" · ");
  }, [selectedRound, selectedRoundApplications.length]);
  const roundStatsById = useMemo(() => {
    return new Map(
      rounds.map((round) => {
        const storedApplicationCount = normalizeRoundCount(round.applicationCount);
        const storedSubmittedCount = normalizeRoundCount(round.submittedCount);
        const storedApprovedCount = normalizeRoundCount(round.approvedCount);
        const storedRejectedCount = normalizeRoundCount(round.rejectedCount);
        const isLiveRound = canManageApplications && round.id === teacherQueryRoundId;

        return [
          round.id,
          {
            applicationCount: isLiveRound
              ? selectedRoundApplications.length
              : storedApplicationCount ?? Number(roundTotalsById[round.id] || 0),
            submittedCount: isLiveRound ? submittedCount : storedSubmittedCount ?? 0,
            approvedCount: isLiveRound ? approvedCount : storedApprovedCount ?? 0,
            rejectedCount: isLiveRound ? rejectedCount : storedRejectedCount ?? 0,
          },
        ];
      }),
    );
  }, [
    approvedCount,
    canManageApplications,
    rejectedCount,
    roundTotalsById,
    rounds,
    selectedRoundApplications.length,
    submittedCount,
    teacherQueryRoundId,
  ]);
  const selectedRoundStats = selectedRound
    ? roundStatsById.get(selectedRound.id) || {
        applicationCount: 0,
        submittedCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
      }
    : {
        applicationCount: 0,
        submittedCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
      };

  const filteredSelectedRoundApplications = useMemo(
    () =>
      statusFilter === "all"
        ? selectedRoundApplications
        : selectedRoundApplications.filter((application) => application.status === statusFilter),
    [selectedRoundApplications, statusFilter],
  );
  const selectableApplications = useMemo(
    () =>
      filteredSelectedRoundApplications.filter(
        (application) => application.status === "submitted",
      ),
    [filteredSelectedRoundApplications],
  );
  const selectedPendingApplications = useMemo(
    () =>
      selectableApplications.filter((application) =>
        selectedApplicationIds.includes(application.id),
      ),
    [selectableApplications, selectedApplicationIds],
  );
  const allVisiblePendingSelected =
    selectableApplications.length > 0 &&
    selectedPendingApplications.length === selectableApplications.length;

  const currentRoundApplications = useMemo(
    () =>
      featuredStudentRound
        ? applications.filter((application) => application.roundId === featuredStudentRound.id)
        : [],
    [applications, featuredStudentRound],
  );

  const currentRoundOwnApplications = useMemo(
    () =>
      featuredStudentRound
        ? applications.filter((application) => application.roundId === featuredStudentRound.id)
        : [],
    [applications, featuredStudentRound],
  );
  const currentRoundActiveApplications = useMemo(
    () =>
      currentRoundOwnApplications.filter((application) =>
        ["submitted", "approved"].includes(String(application.status || "")),
      ),
    [currentRoundOwnApplications],
  );

  const ownApplicationsByJobId = useMemo(
    () =>
      new Map(
        currentRoundOwnApplications.map((application) => [
          application.jobDefinitionId,
          application,
        ]),
      ),
    [currentRoundOwnApplications],
  );

  const pendingCountByJobId = useMemo(() => {
    const countMap = new Map();
    currentRoundApplications
      .filter((application) => application.status === "submitted")
      .forEach((application) => {
        const currentCount = countMap.get(application.jobDefinitionId) || 0;
        countMap.set(application.jobDefinitionId, currentCount + 1);
      });
    return countMap;
  }, [currentRoundApplications]);
  const featuredStudentRoundJobsWithPending = useMemo(
    () =>
      featuredStudentRoundJobs.map((job) => ({
        ...job,
        pendingCount: pendingCountByJobId.get(job.id) || 0,
      })),
    [featuredStudentRoundJobs, pendingCountByJobId],
  );
  const underCapacityJobs = useMemo(
    () => featuredStudentRoundJobsWithPending.filter((job) => job.needsRecruitment),
    [featuredStudentRoundJobsWithPending],
  );
  const totalNeededHeadcountInRound = useMemo(
    () =>
      underCapacityJobs.reduce(
        (sum, job) => sum + Math.max(0, Number(job?.neededHeadcount || 0)),
        0,
      ),
    [underCapacityJobs],
  );
  const visibleFeaturedStudentJobs = useMemo(
    () =>
      showUnderCapacityOnly
        ? underCapacityJobs
        : featuredStudentRoundJobsWithPending,
    [featuredStudentRoundJobsWithPending, showUnderCapacityOnly, underCapacityJobs],
  );
  const hasRejectedCurrentRoundApplication = useMemo(
    () =>
      currentRoundOwnApplications.some(
        (application) => application.status === "rejected",
      ),
    [currentRoundOwnApplications],
  );

  const previousApplications = useMemo(
    () =>
      featuredStudentRound
        ? applications.filter((application) => application.roundId !== featuredStudentRound.id)
        : applications,
    [applications, featuredStudentRound],
  );
  const legacyApplications = useMemo(
    () =>
      canManageApplications
        ? teacherLegacyApplications
        : applications.filter((application) => !application.roundId),
    [applications, canManageApplications, teacherLegacyApplications],
  );
  const summaryRound = canManageApplications ? selectedRound : featuredStudentRound;
  const selectedRoundHasApplications = Number(selectedRoundStats.applicationCount || 0) > 0;
  const canOpenReviewModal = Boolean(selectedRound) || legacyApplications.length > 0;
  const canStartNewRound = jobDefinitions.length > 0 && !activeRound;
  const isViewingClosedRound = selectedRound?.status === "closed";
  const showClosedRoundStartPanel = canManageApplications && isViewingClosedRound && canStartNewRound;
  const featuredStudentRoundGuide = useMemo(() => {
    if (!featuredStudentRound) return "";

    const maxApplications = Math.max(
      1,
      Number(featuredStudentRound.maxApplicationsPerStudent || 1),
    );
    const maxApproved = Math.max(
      1,
      Number(featuredStudentRound.maxApprovedJobsPerStudent || 1),
    );
    const applicationRule = featuredStudentRound.allowMultipleApplications
      ? `여러 직업에 지원할 수 있고 학생당 최대 지원 ${maxApplications}개, 최종 승인 ${maxApproved}개까지 가능합니다.`
      : "이번 모집은 한 번에 1개 직업만 지원할 수 있습니다.";
    const currentJobRule = featuredStudentRound.allowCurrentJobApplications
      ? "현재 맡은 직업에도 다시 지원할 수 있습니다."
      : "현재 맡은 직업에는 다시 지원할 수 없습니다.";
    const assignmentRule = featuredStudentRound.replaceExistingJobsOnApproval
      ? "승인되면 기존 직업이 새 직업으로 교체됩니다."
      : "승인되면 기존 직업에 새 직업이 추가됩니다.";

    return `${applicationRule} ${assignmentRule} ${currentJobRule}`;
  }, [featuredStudentRound]);

  useEffect(() => {
    setSelectedApplicationIds((prev) =>
      prev.filter((id) => selectableApplications.some((application) => application.id === id)),
    );
  }, [selectableApplications]);

  const openApplicationModal = (job) => {
    setSelectedJob(job);
    setApplicationExperience("");
    setApplicationReason("");
  };

  const closeApplicationModal = () => {
    setSelectedJob(null);
    setApplicationExperience("");
    setApplicationReason("");
  };

  const openRoundModal = () => {
    setRoundModalMode("create");
    setRoundTitle(buildSuggestedRoundTitle(rounds));
    setSelectedJobIds(
      suggestedRecruitmentJobIds.length > 0
        ? suggestedRecruitmentJobIds
        : jobDefinitionsWithStaffing.map((job) => job.id),
    );
    setAllowMultipleApplications(false);
    setAllowCurrentJobApplications(false);
    setReplaceExistingJobsOnApproval(true);
    setMaxApplicationsPerStudent("2");
    setMaxApprovedJobsPerStudent("1");
    setIsRoundModalOpen(true);
  };

  const openEditRoundModal = () => {
    if (!selectedRound || selectedRound.status !== "open") return;

    setRoundModalMode("edit");
    setRoundTitle(selectedRound.title || "");
    setSelectedJobIds(
      Array.isArray(selectedRound.jobDefinitionIds) && selectedRound.jobDefinitionIds.length > 0
        ? selectedRound.jobDefinitionIds
        : (selectedRound.jobs || []).map((job) => job.id).filter(Boolean),
    );
    setAllowMultipleApplications(Boolean(selectedRound.allowMultipleApplications));
    setAllowCurrentJobApplications(Boolean(selectedRound.allowCurrentJobApplications));
    setReplaceExistingJobsOnApproval(
      selectedRound.replaceExistingJobsOnApproval !== false,
    );
    setMaxApplicationsPerStudent(
      String(Math.max(1, Number(selectedRound.maxApplicationsPerStudent || 1))),
    );
    setMaxApprovedJobsPerStudent(
      String(Math.max(1, Number(selectedRound.maxApprovedJobsPerStudent || 1))),
    );
    setIsRoundModalOpen(true);
  };

  const closeRoundModal = () => {
    setIsRoundModalOpen(false);
    setRoundModalMode("create");
    setRoundTitle("");
    setSelectedJobIds([]);
    setAllowMultipleApplications(false);
    setAllowCurrentJobApplications(false);
    setReplaceExistingJobsOnApproval(true);
    setMaxApplicationsPerStudent("2");
    setMaxApprovedJobsPerStudent("1");
  };

  const handleAllowMultipleApplicationsChange = (checked) => {
    if (
      roundModalMode === "edit" &&
      selectedRound?.allowMultipleApplications &&
      !checked
    ) {
      showFeedback(
        "지원서가 들어온 뒤에는 다중 지원 허용을 더 엄격하게 바꿀 수 없습니다.",
        "info",
      );
      return;
    }

    setAllowMultipleApplications(checked);

    if (!checked) {
      setMaxApplicationsPerStudent("1");
      setMaxApprovedJobsPerStudent("1");
      return;
    }

    setMaxApplicationsPerStudent((prev) =>
      String(Math.max(2, Number(prev || 1))),
    );
  };

  const handleAllowCurrentJobApplicationsChange = (checked) => {
    if (
      roundModalMode === "edit" &&
      selectedRound?.allowCurrentJobApplications &&
      !checked
    ) {
      showFeedback(
        "지원서가 들어온 뒤에는 현재 직업 재지원 허용을 제한 쪽으로 바꿀 수 없습니다.",
        "info",
      );
      return;
    }

    setAllowCurrentJobApplications(checked);
  };

  const handleReplaceExistingJobsOnApprovalChange = (checked) => {
    if (
      roundModalMode === "edit" &&
      selectedRound &&
      (selectedRound.replaceExistingJobsOnApproval !== false) !== checked
    ) {
      showFeedback(
        "지원서가 들어온 뒤에는 승인 시 기존 직업 처리 방식을 바꿀 수 없습니다.",
        "info",
      );
      return;
    }

    setReplaceExistingJobsOnApproval(checked);

    if (checked) {
      setMaxApprovedJobsPerStudent("1");
      return;
    }

    setMaxApprovedJobsPerStudent((prev) => {
      const nextValue = Math.max(1, Number(prev || 1));
      const nextMaxApplications = Math.max(1, Number(maxApplicationsPerStudent || 1));
      return String(Math.min(nextValue, nextMaxApplications));
    });
  };

  const handleMaxApplicationsPerStudentChange = (value) => {
    let nextValue = Math.max(1, Number(value || 1));

    if (!allowMultipleApplications) {
      nextValue = 1;
    }

    if (roundModalMode === "edit") {
      const baselineValue = Math.max(
        1,
        Number(selectedRound?.maxApplicationsPerStudent || 1),
      );
      nextValue = Math.max(nextValue, baselineValue);
    }

    setMaxApplicationsPerStudent(String(nextValue));

    if (!replaceExistingJobsOnApproval) {
      setMaxApprovedJobsPerStudent((prev) =>
        String(
          Math.min(
            Math.max(1, Number(prev || 1)),
            nextValue,
          ),
        ),
      );
    }
  };

  const handleMaxApprovedJobsPerStudentChange = (value) => {
    let nextValue = Math.max(1, Number(value || 1));

    if (!allowMultipleApplications || replaceExistingJobsOnApproval) {
      nextValue = 1;
    }

    if (roundModalMode === "edit") {
      const baselineValue = Math.max(
        1,
        Number(selectedRound?.maxApprovedJobsPerStudent || 1),
      );
      nextValue = Math.max(nextValue, baselineValue);
    }

    const currentMaxApplications = allowMultipleApplications
      ? Math.max(1, Number(maxApplicationsPerStudent || 1))
      : 1;

    setMaxApprovedJobsPerStudent(
      String(Math.min(nextValue, currentMaxApplications)),
    );
  };

  const openRejectModal = (application) => {
    setIsBulkRejectMode(false);
    setRejectTargetApplication(application);
    setRejectionReasonInput(application?.rejectionReason || "");
  };

  const openBulkRejectModal = () => {
    if (selectedPendingApplications.length === 0) return;
    setIsBulkRejectMode(true);
    setRejectTargetApplication(null);
    setRejectionReasonInput("");
  };

  const closeRejectModal = () => {
    setIsBulkRejectMode(false);
    setRejectTargetApplication(null);
    setRejectionReasonInput("");
  };

  const handleToggleApplicationSelection = (applicationId) => {
    setSelectedApplicationIds((prev) =>
      prev.includes(applicationId)
        ? prev.filter((id) => id !== applicationId)
        : [...prev, applicationId],
    );
  };

  const handleSetApplicationSelection = (applicationId, shouldSelect) => {
    if (!applicationId) return;

    setSelectedApplicationIds((prev) => {
      const alreadySelected = prev.includes(applicationId);
      if (shouldSelect) {
        return alreadySelected ? prev : [...prev, applicationId];
      }
      return alreadySelected ? prev.filter((id) => id !== applicationId) : prev;
    });
  };

  const handleToggleSelectAllApplications = () => {
    setSelectedApplicationIds((prev) =>
      allVisiblePendingSelected
        ? prev.filter((id) => !selectableApplications.some((app) => app.id === id))
        : [
            ...new Set([
              ...prev,
              ...selectableApplications.map((application) => application.id),
            ]),
          ],
    );
  };

  const handleClearSelectedApplications = () => {
    setSelectedApplicationIds([]);
  };

  const closeReviewModal = () => {
    setIsReviewModalOpen(false);
    setStatusFilter("all");
    handleClearSelectedApplications();
  };

  const handleExportSelectedRoundApplications = async () => {
    if (!selectedRound) return;

    setIsExportingRoundApplications(true);
    try {
      const exportTargetApplications =
        selectedRoundApplications.length > 0
          ? selectedRoundApplications
          : await fetchJobApplicationsByRound({
              classId,
              roundId: selectedRound.id,
            });

      if (exportTargetApplications.length === 0) {
        showFeedback("내보낼 지원서가 없습니다.", "warning");
        return;
      }

      exportApplicationsToExcel({
        round: selectedRound,
        applications: exportTargetApplications,
        studentsByUid,
        currencyUnit: displayCurrencyUnit,
      });
    } catch (error) {
      showFeedback(
        error?.message || "지원서를 내보내는 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsExportingRoundApplications(false);
    }
  };

  const handleSubmitApplication = async () => {
    if (!selectedJob || !activeRound) return;

    setIsSubmitting(true);
    try {
      await submitJobApplication({
        classId,
        student: currentStudent,
        round: activeRound,
        jobDefinition: selectedJob,
        experience: applicationExperience,
        reason: applicationReason,
      });
      showFeedback("직업 지원서를 제출했습니다.", "success");
      closeApplicationModal();
    } catch (error) {
      showFeedback(
        error?.message || "직업 지원서를 제출하는 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async (application) => {
    setProcessingApplicationId(application.id);
    try {
      await approveJobApplication({
        classId,
        applicationId: application.id,
        reviewer: {
          uid: userData?.uid,
          name: userData?.name,
        },
      });
      showFeedback(
        `${application.studentName} 학생을 '${application.jobName}' 직업으로 승인했습니다.`,
        "success",
      );
      setDetailApplication(null);
    } catch (error) {
      showFeedback(
        error?.message || "지원서를 승인하는 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setProcessingApplicationId("");
    }
  };

  const handleReject = async (application, rejectionReason = "") => {
    setProcessingApplicationId(application.id);
    try {
      await rejectJobApplication({
        classId,
        applicationId: application.id,
        reviewer: {
          uid: userData?.uid,
          name: userData?.name,
        },
        rejectionReason,
      });
      showFeedback(
        `${application.studentName} 학생의 지원서를 반려했습니다.`,
        "info",
      );
      setDetailApplication(null);
      closeRejectModal();
    } catch (error) {
      showFeedback(
        error?.message || "지원서를 반려하는 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setProcessingApplicationId("");
    }
  };

  const handleConfirmReject = async () => {
    if (isBulkRejectMode) {
      if (selectedPendingApplications.length === 0) return;
      setProcessingApplicationId("__bulk_reject__");
      try {
        const results = await Promise.allSettled(
          selectedPendingApplications.map((application) =>
            rejectJobApplication({
              classId,
              applicationId: application.id,
              reviewer: {
                uid: userData?.uid,
                name: userData?.name,
              },
              rejectionReason: rejectionReasonInput,
            }),
          ),
        );
        const successCount = results.filter((result) => result.status === "fulfilled").length;
        const failureCount = results.length - successCount;

        if (successCount > 0) {
          showFeedback(
            failureCount > 0
              ? `${successCount}건 반려, ${failureCount}건 실패했습니다.`
              : `${successCount}건을 반려했습니다.`,
            failureCount > 0 ? "info" : "success",
          );
        }
        if (failureCount > 0 && successCount === 0) {
          showFeedback("선택한 지원서를 반려하는 중 오류가 발생했습니다.", "error");
        }

        handleClearSelectedApplications();
        closeRejectModal();
      } finally {
        setProcessingApplicationId("");
      }
      return;
    }

    if (!rejectTargetApplication) return;
    await handleReject(rejectTargetApplication, rejectionReasonInput);
  };

  const handleCreateRound = async () => {
    setIsCreatingRound(true);
    try {
      const selectedJobs = jobDefinitionsWithStaffing.filter((job) =>
        selectedJobIds.includes(job.id),
      );
      await createJobRecruitmentRound({
        classId,
        title: roundTitle,
        teacher: {
          uid: userData?.uid,
          name: userData?.name,
        },
        selectedJobs,
        allowMultipleApplications,
        allowCurrentJobApplications,
        replaceExistingJobsOnApproval,
        maxApplicationsPerStudent,
        maxApprovedJobsPerStudent,
      });
      showFeedback("새 직업 모집 회차를 시작했습니다.", "success");
      closeRoundModal();
    } catch (error) {
      showFeedback(
        error?.message || "직업 모집 회차를 시작하는 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsCreatingRound(false);
    }
  };

  const handleUpdateRound = async () => {
    if (!selectedRound || selectedRound.status !== "open") return;

    setIsUpdatingRound(true);
    try {
      const selectedJobs = selectedJobIds
        .map((jobId) => {
          const normalizedJobId = String(jobId || "").trim();
          return (
            jobDefinitionsWithStaffing.find(
              (job) => String(job?.id || "").trim() === normalizedJobId,
            ) ||
            (selectedRound.jobs || []).find(
              (job) => String(job?.id || "").trim() === normalizedJobId,
            ) ||
            null
          );
        })
        .filter(Boolean);

      await updateJobRecruitmentRound({
        classId,
        roundId: selectedRound.id,
        teacher: {
          uid: userData?.uid,
          name: userData?.name,
        },
        title: roundTitle,
        selectedJobs,
        allowMultipleApplications,
        allowCurrentJobApplications,
        replaceExistingJobsOnApproval,
        maxApplicationsPerStudent,
        maxApprovedJobsPerStudent,
      });
      showFeedback("모집 규칙을 수정했습니다.", "success");
      closeRoundModal();
    } catch (error) {
      showFeedback(
        error?.message || "모집 규칙을 수정하는 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsUpdatingRound(false);
    }
  };

  const handleCloseRound = async () => {
    if (!activeRound) return;

    setIsClosingRound(true);
    try {
      await closeJobRecruitmentRound({
        classId,
        roundId: activeRound.id,
        teacher: {
          uid: userData?.uid,
          name: userData?.name,
        },
      });
      showFeedback(`'${activeRound.title}' 모집을 마감했습니다.`, "success");
    } catch (error) {
      showFeedback(
        error?.message || "직업 모집을 마감하는 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsClosingRound(false);
    }
  };

  const handleDeleteRound = async () => {
    if (!selectedRound) return;

    const confirmed = (await appConfirm(`'${selectedRound.title}' 회차와 연결된 지원서를 모두 삭제할까요?\n\n기존 승인 기록은 가능한 경우 학생 직업도 함께 되돌립니다.`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}));
    if (!confirmed) return;

    setIsDeletingRound(true);
    try {
      const result = await deleteJobRecruitmentRound({
        classId,
        roundId: selectedRound.id,
        teacher: {
          uid: userData?.uid,
          name: userData?.name,
        },
      });

      showFeedback(
        `'${selectedRound.title}' 회차를 삭제했습니다. 지원서 ${result?.deletedApplicationCount || 0}건을 함께 정리했습니다.`,
        "success",
      );
      handleClearSelectedApplications();
    } catch (error) {
      showFeedback(
        error?.message || "직업 모집 회차를 삭제하는 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsDeletingRound(false);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedPendingApplications.length === 0) return;

    setIsBulkApproving(true);
    try {
      const results = await Promise.allSettled(
        selectedPendingApplications.map((application) =>
          approveJobApplication({
            classId,
            applicationId: application.id,
            reviewer: {
              uid: userData?.uid,
              name: userData?.name,
            },
          }),
        ),
      );
      const successCount = results.filter((result) => result.status === "fulfilled").length;
      const failureCount = results.length - successCount;

      if (successCount > 0) {
        showFeedback(
          failureCount > 0
            ? `${successCount}건 승인, ${failureCount}건 실패했습니다.`
            : `${successCount}건을 승인했습니다.`,
          failureCount > 0 ? "info" : "success",
        );
      }
      if (failureCount > 0 && successCount === 0) {
        showFeedback("선택한 지원서를 승인하는 중 오류가 발생했습니다.", "error");
      }
      handleClearSelectedApplications();
    } finally {
      setIsBulkApproving(false);
    }
  };

  if (isApplicationsLoading || isRoundsLoading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/70 py-20">
        <Spinner size="lg" tone="indigo" />
        <p className="mt-4 text-sm font-semibold text-slate-500">
          직업 모집 현황을 불러오는 중입니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!canManageApplications ? (
        <div data-tour="tax-job-application-summary" className="grid gap-4 lg:grid-cols-3">
          <Card
            title={summaryRound?.status === "open" ? "현재 모집 회차" : "직업 모집 상태"}
            icon={BriefcaseBusiness}
            variant="surface"
            tone="white"

          >
            <Card.Content noPadding>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-2xl font-black text-slate-900">
                  {summaryRound?.title || "모집 대기"}
                </p>
                {summaryRound ? (
                  <Badge tone="indigo">
                    {(ROUND_STATUS_META[summaryRound.status] || ROUND_STATUS_META.closed).label}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {summaryRound
                  ? `${summaryRound.jobs?.length || 0}개의 직업이 연결되어 있습니다.`
                  : "아직 열린 모집 회차가 없습니다."}
              </p>
            </Card.Content>
          </Card>
          <Card
            title="내 현재 직업"
            icon={Clock3}
            variant="surface"
            tone="white"

          >
            <Card.Content noPadding>
              <p className="text-2xl font-black text-slate-900">
                {currentJobs.length > 0 ? currentJobs.join(", ") : "배정 없음"}
              </p>
            </Card.Content>
          </Card>
          <Card
            title="내 지원 내역"
            icon={FileText}
            variant="surface"
            tone="white"

          >
            <Card.Content noPadding>
              <p className="text-2xl font-black text-slate-900">{`${applications.length}건`}</p>
            </Card.Content>
          </Card>
        </div>
      ) : null}

      {canManageApplications ? (
        <div data-tour="tax-job-application-board">
          <Card title="직업 모집 관리" icon={BriefcaseBusiness} variant="surface" >
            <Card.Content noPadding className="space-y-4">
              {showClosedRoundStartPanel ? (
                <div className="flex flex-col gap-3 rounded-[1.8rem] border border-slate-200 bg-gradient-to-r from-slate-50 to-indigo-50/70 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-black text-slate-900">
                      현재 보고 있는 회차는 마감되었습니다.
                    </p>
                    <p className="text-sm text-slate-600">
                      {selectedRound?.closedAt
                        ? `${toDisplayDate(selectedRound.closedAt)} 기준으로 모집이 마감되었고, 다음 모집은 새 회차로 시작하면 됩니다.`
                        : "이 회차는 더 이상 지원을 받지 않으며, 다음 모집은 새 회차로 시작하면 됩니다."}
                    </p>
                  </div>
                  <Button
                    tone="blue"
                    icon={Plus}
                    onClick={openRoundModal}
                    disabled={!canStartNewRound}
                  >
                    새 모집 시작
                  </Button>
                </div>
              ) : null}

              {rounds.length > 0 ? (
                <div className="rounded-[1.8rem] border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-black text-slate-900">회차 목록</p>
                    {rounds.length > ROUND_CARD_LIMIT ? (
                      <Button
                        size="sm"
                        kind="outline"
                        tone="slate"
                        onClick={() => setIsRoundListExpanded((prev) => !prev)}
                      >
                        {isRoundListExpanded ? "접기" : `더보기 ${rounds.length - ROUND_CARD_LIMIT}개`}
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {visibleRounds.map((round) => {
                      const stats = roundStatsById.get(round.id) || {
                        applicationCount: 0,
                        submittedCount: 0,
                        approvedCount: 0,
                        rejectedCount: 0,
                      };
                      const isSelected = selectedRoundId === round.id;

                      return (
                        <Button
                          key={round.id}
                          type="button"
                          onClick={() => setSelectedRoundId(round.id)}
                          tone="blue"
                          kind={isSelected ? "soft" : "outline"}
                          rounded="xl"
                          className={`rounded-[1.6rem] border px-4 py-4 text-left transition ${
                            isSelected
                              ? "border-indigo-200 bg-indigo-50/80 text-slate-900 shadow-sm"
                              : "border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-white"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="line-clamp-1 text-sm font-black">
                              {round.title || "제목 없는 회차"}
                            </p>
                            <Badge
                              tone={
                                (ROUND_STATUS_META[round.status] || ROUND_STATUS_META.closed).tone
                              }
                            >
                              {(ROUND_STATUS_META[round.status] || ROUND_STATUS_META.closed).label}
                            </Badge>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            {round.status === "closed" && round.closedAt
                              ? `마감 ${toDisplayDate(round.closedAt)}`
                              : `시작 ${toDisplayDate(round.startedAt || round.createdAt)}`}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {stats.submittedCount > 0 ? (
                              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                                isSelected
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-amber-50 text-amber-700"
                              }`}>
                                검토 대기 {stats.submittedCount}건
                              </span>
                            ) : null}
                          </div>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50/80 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2" title={selectedRoundSummary}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-black text-slate-900">
                      {selectedRound?.title || "선택된 모집 회차 없음"}
                    </p>
                    {selectedRound ? (
                      <Badge
                        tone={
                          (ROUND_STATUS_META[selectedRound.status] || ROUND_STATUS_META.closed).tone
                        }
                      >
                        {
                          (ROUND_STATUS_META[selectedRound.status] || ROUND_STATUS_META.closed).label
                        }
                      </Badge>
                    ) : null}
                  </div>
                  {selectedRound && selectedRoundStats.submittedCount > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      <Badge tone="amber">검토 대기 {selectedRoundStats.submittedCount}건</Badge>
                    </div>
                  ) : null}
                  {selectedRound && isSelectedRoundMetaOpen ? (
                    <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                      <Badge tone="slate">
                        최대 지원 {Math.max(1, Number(selectedRound.maxApplicationsPerStudent || 1))}개
                      </Badge>
                      <Badge tone="slate">
                        최대 승인 {Math.max(1, Number(selectedRound.maxApprovedJobsPerStudent || 1))}개
                      </Badge>
                      <Badge tone="slate">
                        {selectedRound.allowCurrentJobApplications ? "재지원 가능" : "재지원 제한"}
                      </Badge>
                      <Badge tone="slate">
                        {selectedRound.replaceExistingJobsOnApproval
                          ? "승인 시 기존 직업 교체"
                          : "승인 시 기존 직업 추가"}
                      </Badge>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 lg:max-w-[34rem]">
                  <Button
                    size="sm"
                    kind="outline"
                    tone="slate"
                    onClick={() => setIsSelectedRoundMetaOpen((prev) => !prev)}
                    disabled={!selectedRound}
                  >
                    {isSelectedRoundMetaOpen ? "규칙 접기" : "규칙"}
                  </Button>
                  <Button
                    size="sm"
                    kind="outline"
                    tone="slate"
                    icon={Eye}
                    onClick={() => setIsReviewModalOpen(true)}
                    disabled={!canOpenReviewModal}
                  >
                    지원자
                  </Button>
                  {!showClosedRoundStartPanel ? (
                    <Button
                      size="sm"
                      tone="blue"
                      icon={Plus}
                      onClick={openRoundModal}
                      disabled={!canStartNewRound}
                    >
                      새 모집 시작
                    </Button>
                  ) : null}
                  <div className="hidden h-6 w-px rounded-full bg-slate-200 lg:block" aria-hidden="true" />
                  <Button
                    size="sm"
                    kind="outline"
                    tone="slate"
                    icon={XCircle}
                    onClick={handleCloseRound}
                    isLoading={isClosingRound}
                    disabled={!activeRound}
                  >
                    마감
                  </Button>
                  <Button
                    size="icon-md"
                    kind="ghost"
                    tone="slate"
                    icon={PencilLine}
                    onClick={openEditRoundModal}
                    disabled={!selectedRound || selectedRound.status !== "open"}
                    aria-label="모집 수정"
                    title="모집 수정"
                  >
                  </Button>
                  <Button
                    size="icon-md"
                    kind="ghost"
                    tone="slate"
                    icon={Download}
                    onClick={handleExportSelectedRoundApplications}
                    isLoading={isExportingRoundApplications}
                    disabled={!selectedRound || !selectedRoundHasApplications}
                    aria-label="엑셀 내보내기"
                    title="엑셀 내보내기"
                  >
                  </Button>
                  <Button
                    size="icon-md"
                    kind="outline"
                    tone="red"
                    icon={Trash2}
                    onClick={handleDeleteRound}
                    isLoading={isDeletingRound}
                    disabled={!selectedRound}
                    aria-label="회차 삭제"
                    title="회차 삭제"
                  >
                  </Button>
                </div>
              </div>
            </Card.Content>
          </Card>
        </div>
      ) : (
        <div data-tour="tax-job-application-board">
          <Card title="직업 지원하기" icon={BriefcaseBusiness} variant="surface" >
            <Card.Description className="mb-4">
              현재 열려 있는 모집 회차에서는 바로 지원할 수 있고, 마감된 회차는 읽기 전용으로 볼 수 있습니다.
            </Card.Description>
            <Card.Content noPadding>
              {!featuredStudentRound ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 py-16 text-center">
                  <Lock className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-4 text-base font-black text-slate-700">
                    아직 열린 직업 모집이나 최근 모집 기록이 없습니다.
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    선생님이 새 모집 회차를 열면 여기에서 바로 지원할 수 있습니다.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(59,130,246,0.08)_0%,rgba(255,255,255,0.98)_26%,rgba(248,250,252,0.95)_100%)] p-4 shadow-sm">
                    <div className="rounded-[1.6rem] border border-slate-200/90 bg-white/90 p-5 md:p-6">
                      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 md:flex-row md:items-end md:justify-between">
                        <div className="max-w-2xl">
                          <p className="text-[11px] font-black tracking-[0.18em] text-indigo-600">
                            열린 모집 게시판
                          </p>
                          <h3 className="mt-2 text-2xl font-black text-slate-900 md:text-[1.8rem]">
                            {featuredStudentRound.title}
                          </h3>
                          <p className="mt-3 text-sm leading-6 text-slate-600">
                            원하는 공고를 눌러 지원서를 제출하세요. {featuredStudentRoundGuide}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            tone={featuredStudentRound.status === "open" ? "indigo" : "slate"}
                          >
                            {featuredStudentRound.status === "open" ? "모집 중" : "마감"}
                          </Badge>
                          <Badge tone={underCapacityJobs.length > 0 ? "amber" : "emerald"}>
                            {underCapacityJobs.length > 0
                              ? `정원 미도달 ${underCapacityJobs.length}개`
                              : "정원 미도달 없음"}
                          </Badge>
                          {totalNeededHeadcountInRound > 0 ? (
                            <Badge tone="indigo">
                              추가 모집 {totalNeededHeadcountInRound}명
                            </Badge>
                          ) : null}
                          {featuredStudentRound.status === "closed" ? (
                            <Badge tone="slate">보기만 가능</Badge>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          {showUnderCapacityOnly ? (
                            <Badge tone="amber">정원 미도달 직업만 보는 중</Badge>
                          ) : null}
                          {hasRejectedCurrentRoundApplication ? (
                            <span className="text-xs font-semibold text-amber-700">
                              반려된 지원이 있다면 `정원 미도달만 보기`로 다시 지원할 직업을 빠르게 찾을 수 있어요.
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">
                              목표 인원이 설정된 직업은 현재 인원과 부족 인원을 함께 보여줍니다.
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            kind="outline"
                            tone={showUnderCapacityOnly ? "amber" : "slate"}
                            onClick={() =>
                              setShowUnderCapacityOnly((prev) => !prev)
                            }
                            disabled={
                              underCapacityJobs.length === 0 && !showUnderCapacityOnly
                            }
                          >
                            {showUnderCapacityOnly
                              ? "전체 직업 보기"
                              : "정원 미도달만 보기"}
                          </Button>
                        </div>
                      </div>

                      {visibleFeaturedStudentJobs.length === 0 ? (
                        <div className="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 py-12 text-center text-sm font-medium text-slate-500">
                          {showUnderCapacityOnly
                            ? "현재 정원이 미도달한 직업이 없어요. 전체 직업 보기로 돌아가서 모든 공고를 확인해 보세요."
                            : "현재 진행 중인 공고 직업이 없어요."}
                        </div>
                      ) : (
                      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {visibleFeaturedStudentJobs.map((job) => {
                          const ownApplication = ownApplicationsByJobId.get(job.id);
                          const pendingCount = Number(job?.pendingCount || 0);
                          const alreadyAssigned = currentJobs.includes(job.name);
                          const hasLockedOwnApplication =
                            ownApplication &&
                            ["submitted", "approved"].includes(String(ownApplication.status || ""));
                          const currentRoundMaxApplications = Math.max(
                            1,
                            Number(featuredStudentRound.maxApplicationsPerStudent || 1),
                          );
                          const isBlockedByRoundLimit =
                            currentRoundActiveApplications.length >=
                              currentRoundMaxApplications &&
                            !hasLockedOwnApplication;
                          const isClosedRound = featuredStudentRound.status !== "open";

                          return (
                            <RecruitmentFlyerCard
                              key={job.id}
                              job={job}
                              currencyUnit={displayCurrencyUnit}
                              pendingCount={pendingCount}
                              ownApplication={ownApplication}
                              alreadyAssigned={alreadyAssigned}
                              allowCurrentJobApplications={
                                !!featuredStudentRound.allowCurrentJobApplications
                              }
                              maxApplicationsPerStudent={currentRoundMaxApplications}
                              isClosedRound={isClosedRound}
                              isBlockedByRoundLimit={isBlockedByRoundLimit}
                              onApply={() => openApplicationModal(job)}
                            />
                          );
                        })}
                      </div>
                      )}
                    </div>
                  </div>
                  <div className="hidden">
                    <Badge tone={featuredStudentRound.status === "open" ? "indigo" : "slate"}>
                      {featuredStudentRound.title}
                    </Badge>
                    <Badge tone="slate">
                      다중 지원 {featuredStudentRound.allowMultipleApplications ? "허용" : "제한"}
                    </Badge>
                    <Badge tone="slate">
                      학생당 최대 지원 {Math.max(1, Number(featuredStudentRound.maxApplicationsPerStudent || 1))}개
                    </Badge>
                    <Badge tone="slate">
                      학생당 최대 승인 {Math.max(1, Number(featuredStudentRound.maxApprovedJobsPerStudent || 1))}개
                    </Badge>
                    <Badge tone="slate">
                      승인 시 기존 직업 {featuredStudentRound.replaceExistingJobsOnApproval ? "교체" : "추가"}
                    </Badge>
                    {featuredStudentRound.status === "closed" ? (
                      <Badge tone="slate">마감된 모집 회차</Badge>
                    ) : null}
                  </div>

                  <div className="hidden">
                    {(featuredStudentRound.jobs || []).map((job) => {
                      const ownApplication = ownApplicationsByJobId.get(job.id);
                      const alreadyAssigned = currentJobs.includes(job.name);
                      const statusMeta =
                        ownApplication && STATUS_META[ownApplication.status]
                          ? STATUS_META[ownApplication.status]
                          : null;
                      const hasLockedOwnApplication =
                        ownApplication &&
                        ["submitted", "approved"].includes(String(ownApplication.status || ""));
                      const isBlockedByRoundLimit =
                        currentRoundActiveApplications.length >=
                          Math.max(
                            1,
                            Number(featuredStudentRound.maxApplicationsPerStudent || 1),
                          ) &&
                        !hasLockedOwnApplication;
                      const isClosedRound = featuredStudentRound.status !== "open";

                      return (
                        <div
                          key={job.id}
                          className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-lg font-black text-slate-900">{job.name}</p>
                              <p className="mt-2 text-sm font-semibold text-indigo-700">
                                주급 {formatDisplayMoney(Number(job.baseSalary || 0))}
                                {displayCurrencyUnit}
                              </p>
                            </div>
                          </div>

                          <p className="mt-3 min-h-[72px] whitespace-pre-line text-sm leading-6 text-slate-600">
                            {job.description || "등록된 직업 설명이 없습니다."}
                          </p>

                          {statusMeta ? (
                            <div className="mt-4">
                              <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                            </div>
                          ) : null}

                          <div className="mt-4">
                            <Button
                              className="w-full"
                              tone="blue"
                              icon={Send}
                              disabled={
                                isClosedRound ||
                                alreadyAssigned ||
                                ownApplication?.status === "submitted" ||
                                isBlockedByRoundLimit
                              }
                              onClick={() => openApplicationModal(job)}
                            >
                              {isClosedRound
                                ? "모집 마감"
                                : alreadyAssigned
                                ? "이미 배정된 직업"
                                : ownApplication?.status === "submitted"
                                  ? "지원 완료"
                                  : ownApplication?.status === "approved"
                                    ? "승인 완료"
                                    : isBlockedByRoundLimit
                                      ? "이번 회차 1개 지원"
                                      : ownApplication?.status === "rejected"
                                        ? "다시 지원하기"
                                        : "지원하기"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card.Content>
          </Card>
        </div>
      )}

      {canManageApplications ? (
        <div data-tour="tax-job-application-review" className="hidden">
          <Card title="지원 요청 관리" icon={FileText} variant="surface" >
            <Card.Content noPadding className="space-y-4">
              {!selectedRound ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 py-12 text-center text-sm font-medium text-slate-500">
                  아직 생성된 모집 회차가 없습니다.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      ["all", `전체 ${selectedRoundApplications.length}`],
                      ["submitted", `검토 대기 ${submittedCount}`],
                      ["approved", `승인 ${approvedCount}`],
                      ["rejected", `반려 ${rejectedCount}`],
                    ].map(([value, label]) => (
                      <Button
                        key={value}
                        type="button"
                        onClick={() => setStatusFilter(value)}
                        tone="slate"
                        kind={statusFilter === value ? "solid" : "soft"}
                        size="xs"
                        rounded="full"
                        className={`rounded-full px-3 py-1.5 text-xs font-black transition ${
                          statusFilter === value
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                        }`}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>

                  {filteredSelectedRoundApplications.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 py-12 text-center text-sm font-medium text-slate-500">
                      이 회차에는 해당 조건의 지원서가 없습니다.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                      <div className="overflow-x-auto">
                        <table className="min-w-[1080px] w-full text-sm">
                          <thead className="bg-slate-50 text-slate-500">
                            <tr>
                              <th className="w-12 px-4 py-3 text-center font-black">
                                <input
                                  type="checkbox"
                                  checked={allVisiblePendingSelected}
                                  onChange={handleToggleSelectAllApplications}
                                  disabled={selectableApplications.length === 0}
                                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
                                />
                              </th>
                              <th className="px-4 py-3 text-left font-black">상태</th>
                              <th className="px-4 py-3 text-left font-black">제출일</th>
                              <th className="px-4 py-3 text-left font-black">학생</th>
                              <th className="px-4 py-3 text-left font-black">희망 직업</th>
                              <th className="px-4 py-3 text-left font-black">현재 직업</th>
                              <th className="px-4 py-3 text-left font-black">이력 / 강점</th>
                              <th className="px-4 py-3 text-left font-black">지원 이유</th>
                              <th className="px-4 py-3 text-right font-black">상세</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredSelectedRoundApplications.map((application) => {
                              const statusMeta =
                                STATUS_META[application.status] || STATUS_META.submitted;
                              const currentJobsText =
                                normalizeJobs(studentsByUid.get(application.studentUid)).join(", ") ||
                                "배정 없음";
                              return (
                                <tr key={application.id} className="hover:bg-slate-50/60">
                                  <td className="px-4 py-4 text-center">
                                    {application.status === "submitted" ? (
                                      <input
                                        type="checkbox"
                                        checked={selectedApplicationIds.includes(application.id)}
                                        onChange={() =>
                                          handleToggleApplicationSelection(application.id)
                                        }
                                        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                                      />
                                    ) : (
                                      <span className="text-slate-300">-</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-4">
                                    <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                                  </td>
                                  <td className="px-4 py-4 text-sm font-medium text-slate-500">
                                    {toDisplayDate(application.submittedAt)}
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="font-black text-slate-900">
                                      {application.studentName}
                                    </div>
                                    <div className="text-xs text-slate-400">
                                      {application.studentNumber ? `${application.studentNumber}번` : "번호 없음"}
                                    </div>
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="font-black text-slate-900">{application.jobName}</div>
                                    <div className="text-xs text-indigo-600">
                                      주급 {formatDisplayMoney(Number(application.baseSalary || 0))}
                                      {displayCurrencyUnit}
                                    </div>
                                  </td>
                                  <td className="px-4 py-4 text-sm font-medium text-slate-600">
                                    <div className="max-w-[180px] truncate">{currentJobsText}</div>
                                  </td>
                                  <td className="px-4 py-4">
                                    <Button
                                      type="button"
                                      onClick={() => setDetailApplication(application)}
                                      tone="blue"
                                      kind="ghost"
                                      rounded="lg"
                                      className="group w-full text-left"
                                    >
                                      <span className="block max-w-[220px] line-clamp-1 text-slate-500 transition group-hover:text-indigo-600">
                                        {application.experience || "-"}
                                      </span>
                                    </Button>
                                  </td>
                                  <td className="px-4 py-4">
                                    <Button
                                      type="button"
                                      onClick={() => setDetailApplication(application)}
                                      tone="blue"
                                      kind="ghost"
                                      rounded="lg"
                                      className="group w-full text-left"
                                    >
                                      <span className="block max-w-[220px] line-clamp-1 text-slate-500 transition group-hover:text-indigo-600">
                                        {application.reason || "-"}
                                      </span>
                                    </Button>
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="flex justify-end gap-2">
                                      <Button
                                        size="sm"
                                        kind="outline"
                                        tone="slate"
                                        icon={Eye}
                                        onClick={() => setDetailApplication(application)}
                                      >
                                        보기
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </Card.Content>
          </Card>

          {legacyApplications.length > 0 ? (
            <Card
              title="이전 방식 지원서"
              icon={Clock3}
              variant="surface"
              tone="white"

              className="mt-4"
            >
              <Card.Description className="mb-4">
                회차 도입 전 지원서입니다. `legacy`처럼 보관되며 읽기 전용으로 확인할 수 있습니다.
              </Card.Description>
              <Card.Content noPadding className="space-y-3">
                {legacyApplications.map((application) => {
                  const statusMeta = STATUS_META[application.status] || STATUS_META.submitted;
                  return (
                    <Button
                      key={application.id}
                      type="button"
                      onClick={() => setDetailApplication(application)}
                      tone="slate"
                      kind="outline"
                      rounded="xl"
                      className="flex w-full items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-white"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-slate-900">{application.studentName}</p>
                          <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                          <Badge tone="slate">이전 데이터</Badge>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                          {application.jobName || "직업 정보 없음"} · 제출일 {toDisplayDate(application.submittedAt)}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-slate-400">상세 보기</span>
                    </Button>
                  );
                })}
              </Card.Content>
            </Card>
          ) : null}
        </div>
      ) : (
        <div data-tour="tax-job-application-review">
          <Card title="내 지원 현황" icon={FileText} variant="surface" >
            <Card.Content noPadding className="space-y-3">
                              {applications.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 py-12 text-center text-sm font-medium text-slate-500">
                  아직 제출한 직업 지원서가 없습니다.
                </div>
              ) : (
                <>
                  {currentRoundOwnApplications.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-sm font-black text-slate-900">
                        {featuredStudentRound?.status === "open" ? "현재 모집 회차" : "최근 모집 회차"}
                      </p>
                      {currentRoundOwnApplications.map((application) => (
                        <MyApplicationCard
                          key={application.id}
                          application={application}
                          currencyUnit={displayCurrencyUnit}
                        />
                      ))}
                    </div>
                  ) : null}

                  {previousApplications.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-sm font-black text-slate-900">이전 지원 이력</p>
                      {previousApplications.map((application) => (
                        <MyApplicationCard
                          key={application.id}
                          application={application}
                          currencyUnit={displayCurrencyUnit}
                        />
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </Card.Content>
          </Card>
        </div>
      )}

      <ApplicationReviewModal
        isOpen={isReviewModalOpen}
        onClose={closeReviewModal}
        round={selectedRound}
        applications={selectedRoundApplications}
        filteredApplications={filteredSelectedRoundApplications}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        selectedApplicationIds={selectedApplicationIds}
        onToggleApplicationSelection={handleToggleApplicationSelection}
        onSetApplicationSelection={handleSetApplicationSelection}
        onOpenDetail={setDetailApplication}
        studentsByUid={studentsByUid}
        jobDefinitions={jobDefinitionsWithStaffing}
        currencyUnit={displayCurrencyUnit}
        onExport={handleExportSelectedRoundApplications}
        legacyApplications={legacyApplications}
        selectedCount={selectedPendingApplications.length}
        onBulkApprove={handleBulkApprove}
        onBulkReject={openBulkRejectModal}
        onClearSelection={handleClearSelectedApplications}
        isBulkApproving={isBulkApproving}
        isBulkRejecting={processingApplicationId === "__bulk_reject__"}
        isLoading={isApplicationsLoading}
      />

      <RoundCreationModal
        isOpen={isRoundModalOpen}
        onClose={closeRoundModal}
        mode={roundModalMode}
        title={roundTitle}
        onTitleChange={setRoundTitle}
        selectedJobIds={selectedJobIds}
        onSelectedJobIdsChange={setSelectedJobIds}
        allowMultipleApplications={allowMultipleApplications}
        onAllowMultipleApplicationsChange={handleAllowMultipleApplicationsChange}
        allowCurrentJobApplications={allowCurrentJobApplications}
        onAllowCurrentJobApplicationsChange={handleAllowCurrentJobApplicationsChange}
        replaceExistingJobsOnApproval={replaceExistingJobsOnApproval}
        onReplaceExistingJobsOnApprovalChange={handleReplaceExistingJobsOnApprovalChange}
        maxApplicationsPerStudent={maxApplicationsPerStudent}
        onMaxApplicationsPerStudentChange={handleMaxApplicationsPerStudentChange}
        maxApprovedJobsPerStudent={maxApprovedJobsPerStudent}
        onMaxApprovedJobsPerStudentChange={handleMaxApprovedJobsPerStudentChange}
        jobDefinitions={jobDefinitionsWithStaffing}
        suggestedJobIds={suggestedRecruitmentJobIds}
        onSubmit={roundModalMode === "edit" ? handleUpdateRound : handleCreateRound}
        isSubmitting={roundModalMode === "edit" ? isUpdatingRound : isCreatingRound}
        hasApplications={roundModalMode === "edit" && selectedRoundHasApplications}
        policyBaseline={roundModalMode === "edit" ? selectedRound : null}
        lockedJobIds={
          roundModalMode === "edit"
            ? selectedRound?.jobDefinitionIds ||
              (selectedRound?.jobs || []).map((job) => job.id).filter(Boolean)
            : []
        }
      />

      <ApplicationModal
        isOpen={Boolean(selectedJob)}
        onClose={closeApplicationModal}
        round={activeRound}
        currentStudent={currentStudent}
        job={selectedJob}
        currencyUnit={displayCurrencyUnit}
        experience={applicationExperience}
        onExperienceChange={setApplicationExperience}
        reason={applicationReason}
        onReasonChange={setApplicationReason}
        onSubmit={handleSubmitApplication}
        isSubmitting={isSubmitting}
      />

      <ApplicationDetailModal
        application={detailApplication}
        jobDefinitions={jobDefinitionsWithStaffing}
        round={rounds.find((round) => round.id === detailApplication?.roundId) || selectedRound}
        canManageApplications={canManageApplications}
        isProcessing={processingApplicationId === detailApplication?.id}
        onClose={() => setDetailApplication(null)}
        onApprove={handleApprove}
        onReject={openRejectModal}
      />

      <RejectionReasonModal
        isOpen={Boolean(rejectTargetApplication) || isBulkRejectMode}
        application={rejectTargetApplication}
        count={selectedPendingApplications.length}
        isBulk={isBulkRejectMode}
        reason={rejectionReasonInput}
        onReasonChange={setRejectionReasonInput}
        onClose={closeRejectModal}
        onSubmit={handleConfirmReject}
        isSubmitting={
          processingApplicationId === rejectTargetApplication?.id ||
          processingApplicationId === "__bulk_reject__"
        }
      />
    </div>
  );
}
