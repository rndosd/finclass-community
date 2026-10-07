import { appConfirm, appPrompt } from "../../utils/appDialogs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  Coins,
  Pencil,
  Inbox,
  MessageSquareText,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";

import AppLayout from "../../components/layout/AppLayout";
import {
  Badge,
  Button,
  Card,
  Modal,
  PageHeader,
  PageLoader,
  SurfaceLoader,
  Textarea,
  Tabs,
} from "../../components/ui";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useUser } from "../../contexts/UserContext";
import {
  useJobBoardProfileQuery,
  useJobBoardDashboardSummaryQuery,
  useJobPostApplicationsQuery,
  useMyAuthoredJobBoardPostsQuery,
  useMyJobBoardApplicationsQuery,
  useMyReceivedJobBoardRatingsQuery,
} from "./hooks/useJobBoardData";
import {
  useClassJobSeekerRequestsQuery,
  useMyJobSeekerServicesQuery,
  useMyReceivedJobSeekerRequestsQuery,
  useMySentJobSeekerRequestsQuery,
} from "./hooks/useJobSeekerBoardData";
import {
  approveJobBoardSubmission,
  createJobBoardPost,
  payJobBoardReward,
  refreshJobBoardDashboardSummary,
  reviewJobBoardApplication,
  submitJobBoardRating,
  updateJobBoardPost,
  updateJobBoardProfile,
  submitJobBoardWork,
} from "./services/jobBoardService";
import {
  completeJobSeekerRequest,
  payJobSeekerRequestReward,
  reviewJobSeekerRequest,
} from "./services/jobSeekerBoardService";
import {
  formatDateTime,
  formatReward,
  getDisplayPostStatusMeta,
  getDisplayPostStatusValue,
  getSelectionTypeLabel,
  isManualPostStatus,
  JobPostModal,
  POST_STATUS_OPTIONS,
  RatingModal,
  selectClassName,
  TextPromptModal,
} from "./JobBoardPage.parts";
import {
  JobBoardModeTabs,
  REQUEST_STATUS_META,
  SERVICE_STATUS_META,
  formatPrice as formatJobSeekerPrice,
} from "./JobSeekerBoardPage.parts";


const dashboardTabItems = [
  { id: "posts", label: "구인관리", icon: BriefcaseBusiness },
  { id: "applications", label: "지원관리", icon: ClipboardList },
  { id: "services", label: "서비스관리", icon: UserRound },
  { id: "requests", label: "의뢰관리", icon: Inbox },
  { id: "reviews", label: "후기", icon: MessageSquareText },
];

const DASHBOARD_PAGE_SIZE = 10;
const DASHBOARD_TAB_IDS = dashboardTabItems.map((tab) => tab.id);
const REQUEST_DIRECTIONS = ["received", "sent"];
const REQUEST_STATUS_FILTERS = ["action", "all", "requested", "accepted", "completed", "paid", "closed"];
const ACTIVE_POST_STATUSES = ["recruiting", "pending_approval", "draft"];
const ACTIVE_APPLICATION_STATUSES = ["applied", "selected", "submitted", "approved"];
const RECEIVED_ACTION_REQUEST_STATUSES = ["requested", "accepted", "completed"];
const SENT_ACTION_REQUEST_STATUSES = ["requested", "accepted", "completed"];

const postStatusMeta = {
  active: { label: "관리중", tone: "blue" },
  pending_approval: { label: "승인 대기", tone: "blue" },
  draft: { label: "작성 중", tone: "slate" },
  recruiting: { label: "모집 중", tone: "indigo" },
  closed: { label: "모집 마감", tone: "emerald" },
  deadline_closed: { label: "기간 마감", tone: "slate" },
  rejected: { label: "반려", tone: "red" },
  cancelled: { label: "취소", tone: "red" },
};

const applicationStatusMeta = {
  active: { label: "진행중", tone: "blue" },
  applied: { label: "지원 완료", tone: "indigo" },
  selected: { label: "선발됨", tone: "blue" },
  submitted: { label: "제출 완료", tone: "indigo" },
  approved: { label: "승인 완료", tone: "emerald" },
  paid: { label: "지급 완료", tone: "emerald" },
  rejected: { label: "반려", tone: "red" },
  withdrawn: { label: "지원 취소", tone: "slate" },
};

const serviceStatusFilterOptions = [
  { value: "all", label: "전체 상태" },
  { value: "active", label: "활성" },
  { value: "pending_approval", label: "승인 대기" },
  { value: "hidden", label: "숨김" },
  { value: "suspended", label: "정지" },
];

const requestDirectionOptions = [
  { value: "received", label: "받은 의뢰" },
  { value: "sent", label: "보낸 의뢰" },
];

const requestStatusFilterOptions = [
  { value: "action", label: "처리 필요" },
  { value: "all", label: "전체 상태" },
  { value: "requested", label: "제안 대기" },
  { value: "accepted", label: "수락" },
  { value: "completed", label: "완료" },
  { value: "paid", label: "지급 완료" },
  { value: "closed", label: "거절/취소" },
];

const safeAverage = (rows = []) => {
  const publishedRows = rows.filter((row) => row.status !== "deleted");
  if (!publishedRows.length) return 0;
  const total = publishedRows.reduce((sum, row) => sum + Number(row.rating || 0), 0);
  return total / publishedRows.length;
};

const getMyShareTotal = (applications = [], userUid = "") =>
  applications.reduce((sum, application) => {
    const shares = Array.isArray(application.paymentShares) ? application.paymentShares : [];
    const ownShare = shares.find((share) => share.uid === userUid);
    return sum + Number(ownShare?.amount || 0);
  }, 0);

const getJobSeekerMeta = (status, metaMap) =>
  metaMap[status] || { label: status || "-", tone: "slate" };


const formatCountLabel = (value) => `${Number(value || 0).toLocaleString()}건`;

const sortByTime = (rows = [], sortOrder = "recent", timeKeys = ["updatedAt", "createdAt"]) =>
  [...rows].sort((left, right) => {
    const readTime = (row) => {
      const value = timeKeys.map((key) => row?.[key]).find(Boolean);
      const parsed = new Date(value || 0).getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const leftTime = readTime(left);
    const rightTime = readTime(right);
    return sortOrder === "oldest" ? leftTime - rightTime : rightTime - leftTime;
  });

const DashboardFilterBar = ({ children, count, action }) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex flex-wrap items-center gap-2">{children}</div>
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="slate">{formatCountLabel(count)}</Badge>
      {action}
    </div>
  </div>
);

const dashboardSelectClassName = selectClassName.replace(
  "w-full",
  "w-full sm:w-auto sm:min-w-[150px]",
);

const getRequestActionNeeded = (request) =>
  ["requested", "accepted", "completed"].includes(request.status);

const getPostStatusQuery = (filter) => {
  if (filter === "active") return ACTIVE_POST_STATUSES;
  if (filter === "all") return null;
  if (filter === "deadline_closed") return ["recruiting"];
  return [filter];
};

const getApplicationStatusQuery = (filter) => {
  if (filter === "active") return ACTIVE_APPLICATION_STATUSES;
  if (filter === "all") return null;
  return [filter];
};

const getServiceStatusQuery = (filter) => (filter === "all" ? null : [filter]);

const getRequestStatusQuery = (filter, direction) => {
  if (filter === "action") {
    return direction === "received"
      ? RECEIVED_ACTION_REQUEST_STATUSES
      : SENT_ACTION_REQUEST_STATUSES;
  }
  if (filter === "closed") return ["rejected", "cancelled"];
  if (filter === "all") return null;
  return [filter];
};

const LoadMoreButton = ({ visible, onClick }) =>
  visible ? (
    <div className="flex justify-center pt-2">
      <Button kind="outline" tone="slate" onClick={onClick}>
        더보기
      </Button>
    </div>
  ) : null;

const formatRatingMetric = (average, count) => {
  const ratingCount = Number(count || 0);
  const ratingAverage = Number(average || 0);
  return ratingCount > 0 ? `평점 ${ratingAverage.toFixed(1)} (${ratingCount})` : "평점 - (0)";
};

const formatScoreMetric = (score) => {
  const numericScore = Number(score);
  return Number.isFinite(numericScore) ? `신용 ${numericScore.toLocaleString()}` : "신용 -";
};

const formatCompletionMetric = (completed, total) => {
  const totalCount = Number(total || 0);
  if (!totalCount) return "완료율 -";
  const completedCount = Number(completed || 0);
  return `완료율 ${Math.round((completedCount / totalCount) * 100)}%`;
};
const EmptyState = ({ title, description, actionLabel, onAction }) => (
  <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center">
    <p className="text-base font-black text-slate-800">{title}</p>
    <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
    {actionLabel && onAction ? (
      <div className="mt-5 flex justify-center">
        <Button tone="blue" kind="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    ) : null}
  </div>
);

const DashboardRequestList = ({
  requests = [],
  direction,
  currencyUnit,
  isTeacher,
  busyKey,
  expandedIds,
  onToggle,
  onAccept,
  onReject,
  onComplete,
  onPay,
}) => {
  if (requests.length === 0) {
    return (
      <EmptyState
        title="조건에 맞는 의뢰가 없습니다."
        description="필터를 바꾸면 다른 의뢰를 확인할 수 있습니다."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="hidden border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black text-slate-400 md:grid md:grid-cols-[150px_minmax(0,1fr)_120px_minmax(220px,auto)]">
        <span>{direction === "received" ? "의뢰한 학생" : "서비스 제공자"}</span>
        <span>의뢰 내용</span>
        <span>금액</span>
        <span className="text-right">상태/처리</span>
      </div>
      {requests.map((request) => {
        const meta = getJobSeekerMeta(request.status, REQUEST_STATUS_META);
        const nameLabel = direction === "received" ? request.requesterName : request.providerName;
        const isExpanded = expandedIds.includes(request.id);

        return (
          <div key={`${direction}:${request.id}`} className="border-b border-slate-100 last:border-b-0">
            <div className="grid gap-3 px-4 py-3 md:grid-cols-[150px_minmax(0,1fr)_120px_minmax(220px,auto)] md:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-900">{nameLabel || "-"}</p>
                <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">
                  {request.serviceTitle || "서비스 이름 없음"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onToggle(request)}
                className="min-w-0 text-left"
              >
                <p className="line-clamp-2 text-sm font-semibold leading-5 text-slate-600">
                  {request.requestMessage || "의뢰 내용 없음"}
                </p>
              </button>
              <p className="text-sm font-black text-slate-700">
                {formatReward(request.proposedRewardAmount, currencyUnit)}
              </p>
              <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                <Badge tone={meta.tone}>{meta.label}</Badge>
                <Button size="sm" kind="outline" tone="slate" onClick={() => onToggle(request)}>
                  {isExpanded ? "닫기" : "상세"}
                </Button>
                {direction === "received" && request.status === "requested" ? (
                  <>
                    <Button
                      size="sm"
                      tone="blue"
                      icon={CheckCircle2}
                      onClick={() => onAccept(request)}
                      isLoading={busyKey === `request:accept:${request.id}`}
                    >
                      수락
                    </Button>
                    <Button
                      size="sm"
                      kind="outline"
                      tone="red"
                      onClick={() => onReject(request)}
                      isLoading={busyKey === `request:reject:${request.id}`}
                    >
                      거절
                    </Button>
                  </>
                ) : null}
                {direction === "received" && request.status === "accepted" ? (
                  <Button
                    size="sm"
                    kind="outline"
                    tone="blue"
                    icon={CheckCircle2}
                    onClick={() => onComplete(request)}
                    isLoading={busyKey === `request:complete:${request.id}`}
                  >
                    완료
                  </Button>
                ) : null}
                {isTeacher && ["accepted", "completed"].includes(request.status) ? (
                  <Button
                    size="sm"
                    tone="blue"
                    icon={Coins}
                    onClick={() => onPay(request)}
                    isLoading={busyKey === `request:pay:${request.id}`}
                  >
                    지급
                  </Button>
                ) : null}
              </div>
            </div>
            {isExpanded ? (
              <div className="border-t border-slate-100 bg-slate-50 px-4 py-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-white px-4 py-3">
                    <p className="text-xs font-black text-slate-400">의뢰 내용</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">
                      {request.requestMessage || "-"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white px-4 py-3">
                    <p className="text-xs font-black text-slate-400">메모</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">
                      {request.note || "-"}
                    </p>
                  </div>
                </div>
                {request.rejectionReason ? (
                  <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                    거절 사유: {request.rejectionReason}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default function JobBoardDashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showFeedback } = useFeedback();
  const { classId, classData, userData, loading, isTeacher } = useUser();
  const routeParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialTab = DASHBOARD_TAB_IDS.includes(routeParams.get("tab"))
    ? routeParams.get("tab")
    : "posts";
  const initialRequestDirection = REQUEST_DIRECTIONS.includes(routeParams.get("direction"))
    ? routeParams.get("direction")
    : "received";
  const initialRequestStatus = REQUEST_STATUS_FILTERS.includes(routeParams.get("status"))
    ? routeParams.get("status")
    : "all";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedManagedPost, setSelectedManagedPost] = useState(null);
  const [selectedApplicationId, setSelectedApplicationId] = useState("");
  const [workTarget, setWorkTarget] = useState(null);
  const [workText, setWorkText] = useState("");
  const [isCreatePostModalOpen, setIsCreatePostModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [applicationStatusFilter, setApplicationStatusFilter] = useState(routeParams.has("applicationId") ? "all" : "active");
  const [applicationSortOrder, setApplicationSortOrder] = useState("recent");
  const [postStatusFilter, setPostStatusFilter] = useState("active");
  const [postSortOrder, setPostSortOrder] = useState("recent");
  const [serviceStatusFilter, setServiceStatusFilter] = useState("active");
  const [requestDirectionFilter, setRequestDirectionFilter] = useState(initialRequestDirection);
  const [requestStatusFilter, setRequestStatusFilter] = useState(initialRequestStatus);
  const [requestSortOrder, setRequestSortOrder] = useState("recent");
  const [applicationLimit, setApplicationLimit] = useState(DASHBOARD_PAGE_SIZE);
  const [postLimit, setPostLimit] = useState(DASHBOARD_PAGE_SIZE);
  const [serviceLimit, setServiceLimit] = useState(DASHBOARD_PAGE_SIZE);
  const [requestLimit, setRequestLimit] = useState(DASHBOARD_PAGE_SIZE);
  const [expandedRequestIds, setExpandedRequestIds] = useState([]);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [paymentTarget, setPaymentTarget] = useState(null);
  const [paymentNote, setPaymentNote] = useState("");
  const [requesterRatingTarget, setRequesterRatingTarget] = useState(null);
  const [requesterRatingValue, setRequesterRatingValue] = useState(5);
  const [requesterRatingReview, setRequesterRatingReview] = useState("");
  const [profileDraft, setProfileDraft] = useState({
    bio: "",
    strengthTags: "",
    preferredRoles: "",
    workStyle: "",
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const currencyUnit = classData?.currencyUnit || "포인트";
  const isReviewsTabActive = activeTab === "reviews";
  const shouldLoadApplications = activeTab === "applications" || Boolean(selectedApplicationId);
  const shouldLoadPosts = activeTab === "posts" || Boolean(selectedManagedPost) || Boolean(editingPost);
  const shouldLoadServices = activeTab === "services";
  const shouldLoadReceivedRequests =
    activeTab === "requests" && requestDirectionFilter === "received";
  const shouldLoadSentRequests = activeTab === "requests" && requestDirectionFilter === "sent";
  const canManageClassRequests = isTeacher || userData?.role === "admin";
  const shouldLoadClassRequests =
    activeTab === "requests" && requestDirectionFilter === "received" && canManageClassRequests;
  const applicationStatusQuery = useMemo(
    () => getApplicationStatusQuery(applicationStatusFilter),
    [applicationStatusFilter],
  );
  const postStatusQuery = useMemo(() => getPostStatusQuery(postStatusFilter), [postStatusFilter]);
  const serviceStatusQuery = useMemo(
    () => getServiceStatusQuery(serviceStatusFilter),
    [serviceStatusFilter],
  );
  const requestStatusQuery = useMemo(
    () => getRequestStatusQuery(requestStatusFilter, requestDirectionFilter),
    [requestDirectionFilter, requestStatusFilter],
  );
  const summaryRefreshRef = useRef("");

  const { data: profile, isLoading: isProfileLoading } = useJobBoardProfileQuery({
    classId,
    userUid: userData?.uid,
    enabled: Boolean(classId && userData?.uid),
  });
  const { data: dashboardSummary } = useJobBoardDashboardSummaryQuery({
    classId,
    userUid: userData?.uid,
    enabled: Boolean(classId && userData?.uid),
  });
  const { data: myApplications = [], isLoading: isApplicationsLoading } =
    useMyJobBoardApplicationsQuery({
      classId,
      userUid: userData?.uid,
      enabled: Boolean(classId && userData?.uid && shouldLoadApplications),
      limitCount: applicationLimit,
      statusIn: applicationStatusQuery,
    });
  const { data: myPosts = [], isLoading: isPostsLoading } = useMyAuthoredJobBoardPostsQuery({
    classId,
    userUid: userData?.uid,
    enabled: Boolean(classId && userData?.uid && shouldLoadPosts),
    limitCount: postLimit,
    statusIn: postStatusQuery,
  });
  const { data: myReceivedRatings = [], isLoading: isRatingsLoading } =
    useMyReceivedJobBoardRatingsQuery({
      classId,
      userUid: userData?.uid,
      enabled: Boolean(classId && userData?.uid && isReviewsTabActive),
    });
  const { data: managedPostApplications = [], isLoading: isManagedApplicationsLoading } =
    useJobPostApplicationsQuery({
      classId,
      postId: selectedManagedPost?.id,
      authorUid: isTeacher ? "" : userData?.uid,
      enabled: Boolean(
        classId &&
          selectedManagedPost?.id,
      ),
    });
  const { data: myJobSeekerServices = [], isLoading: isJobSeekerServicesLoading } =
    useMyJobSeekerServicesQuery({
      classId,
      userUid: userData?.uid,
      enabled: Boolean(classId && userData?.uid && shouldLoadServices),
      limitCount: serviceLimit,
      statusIn: serviceStatusQuery,
    });
  const { data: receivedJobSeekerRequests = [], snapshotLoading: isReceivedJobSeekerRequestsLoading, snapshotError: receivedRequestError, retrySnapshot: retryReceivedRequests } =
    useMyReceivedJobSeekerRequestsQuery({
      classId,
      userUid: userData?.uid,
      enabled: Boolean(
        classId &&
          userData?.uid &&
          shouldLoadReceivedRequests &&
          !shouldLoadClassRequests,
      ),
      limitCount: requestLimit,
      statusIn: requestStatusQuery,
    });
  const { data: classJobSeekerRequests = [], snapshotLoading: isClassJobSeekerRequestsLoading, snapshotError: classRequestError, retrySnapshot: retryClassRequests } =
    useClassJobSeekerRequestsQuery({
      classId,
      enabled: Boolean(classId && shouldLoadClassRequests),
    });
  const { data: sentJobSeekerRequests = [], snapshotLoading: isSentJobSeekerRequestsLoading, snapshotError: sentRequestError, retrySnapshot: retrySentRequests } =
    useMySentJobSeekerRequestsQuery({
      classId,
      userUid: userData?.uid,
      enabled: Boolean(classId && userData?.uid && shouldLoadSentRequests),
      limitCount: requestLimit,
      statusIn: requestStatusQuery,
    });

  useEffect(() => {
    const hasActionSummary =
      dashboardSummary?.recruit &&
      Object.prototype.hasOwnProperty.call(dashboardSummary.recruit, "requesterActionCount");
    if (!classId || !userData?.uid || hasActionSummary) return;
    const refreshKey = `${classId}:${userData.uid}`;
    if (summaryRefreshRef.current === refreshKey) return;
    summaryRefreshRef.current = refreshKey;
    refreshJobBoardDashboardSummary({ classId, userUid: userData.uid }).catch((error) => {
      console.error("[JobBoardDashboardPage] refresh summary failed:", error);
    });
  }, [classId, dashboardSummary, userData?.uid]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextTab = params.get("tab");
    const nextDirection = params.get("direction");
    const nextStatus = params.get("status");

    const nextApplication = params.get("applicationId");
    if (nextTab === "applications" && nextApplication) setSelectedApplicationId(nextApplication);
    if (DASHBOARD_TAB_IDS.includes(nextTab)) {
      setActiveTab(nextTab);
    }
    if (REQUEST_DIRECTIONS.includes(nextDirection)) {
      setRequestDirectionFilter(nextDirection);
    }
    if (REQUEST_STATUS_FILTERS.includes(nextStatus)) {
      setRequestStatusFilter(nextStatus);
    }
  }, [location.search]);

  useEffect(() => {
    const requestId = new URLSearchParams(location.search).get("requestId");
    setExpandedRequestIds(requestId ? [requestId] : []);
  }, [location.search, requestDirectionFilter, requestStatusFilter]);

  useEffect(() => {
    setApplicationLimit(DASHBOARD_PAGE_SIZE);
  }, [applicationStatusFilter, applicationSortOrder]);

  useEffect(() => {
    setPostLimit(DASHBOARD_PAGE_SIZE);
  }, [postStatusFilter, postSortOrder]);

  useEffect(() => {
    setServiceLimit(DASHBOARD_PAGE_SIZE);
  }, [serviceStatusFilter]);

  useEffect(() => {
    setRequestLimit(DASHBOARD_PAGE_SIZE);
  }, [requestDirectionFilter, requestStatusFilter, requestSortOrder]);

  const isInitialPageLoading =
    loading ||
    (isProfileLoading && profile === null);
  const stats = useMemo(() => {
    const recruitSummary = dashboardSummary?.recruit || {};
    const completedCount =
      recruitSummary.paidCount ?? myApplications.filter((row) => row.status === "paid").length;
    const activeCount = recruitSummary.appliedActiveCount ?? myApplications.filter((row) =>
      ["applied", "selected", "submitted", "approved"].includes(row.status),
    ).length;
    const totalEarned = recruitSummary.earnedAmount ?? getMyShareTotal(myApplications, userData?.uid);
    const reviewCount =
      dashboardSummary?.rating?.count ??
      profile?.requesterRatingCount ??
      (isReviewsTabActive ? myReceivedRatings.length : 0);
    const averageRating = reviewCount
      ? Number(
          dashboardSummary?.rating?.average ??
            profile?.requesterRatingAverage ??
            (isReviewsTabActive ? safeAverage(myReceivedRatings) : 0),
        )
      : 0;

    return {
      completedCount,
      activeCount,
      activeApplicationCount: activeCount,
      activePostCount:
        recruitSummary.authoredActiveCount ??
        myPosts.filter((post) =>
          !["closed", "deadline_closed", "rejected", "cancelled"].includes(
            getDisplayPostStatusValue(post),
          ),
        ).length,
      totalEarned,
      averageRating,
      reviewCount,
    };
  }, [dashboardSummary, isReviewsTabActive, myApplications, myPosts, myReceivedRatings, profile, userData?.uid]);

  const jobSeekerStats = useMemo(() => {
    const seekerSummary = dashboardSummary?.seeker || {};
    const activeReceived = receivedJobSeekerRequests.filter((row) =>
      ["requested", "accepted", "completed"].includes(row.status),
    ).length;
    const activeSent = sentJobSeekerRequests.filter((row) =>
      ["requested", "accepted", "completed"].includes(row.status),
    ).length;
    const paidRequests = receivedJobSeekerRequests.filter((row) => row.status === "paid");
    const earned = paidRequests.reduce(
      (sum, row) => sum + Number(row.proposedRewardAmount || 0),
      0,
    );

    return {
      activeServices:
        seekerSummary.serviceActiveCount ??
        myJobSeekerServices.filter((service) => service.status === "active").length,
      totalServices: seekerSummary.serviceTotalCount ?? myJobSeekerServices.length,
      activeReceived: seekerSummary.receivedActiveCount ?? activeReceived,
      activeSent: seekerSummary.sentActiveCount ?? activeSent,
      paidCount: seekerSummary.receivedPaidCount ?? paidRequests.length,
      completedRequests: seekerSummary.receivedPaidCount ?? paidRequests.length,
      earned: seekerSummary.earnedAmount ?? earned,
    };
  }, [dashboardSummary, myJobSeekerServices, receivedJobSeekerRequests, sentJobSeekerRequests]);

  const actionCounts = useMemo(() => {
    const recruitSummary = dashboardSummary?.recruit || {};
    const seekerSummary = dashboardSummary?.seeker || {};
    const postedJobActions =
      recruitSummary.requesterActionCount ??
      managedPostApplications.filter((row) => ["applied", "submitted", "approved"].includes(row.status))
        .length;
    const applicationActions =
      recruitSummary.workerActionCount ??
      myApplications.filter((row) => row.status === "selected").length;
    const serviceActions =
      seekerSummary.providerActionCount ??
      receivedJobSeekerRequests.filter((row) => ["requested", "accepted"].includes(row.status)).length;
    const requestActions =
      seekerSummary.requesterActionCount ??
      sentJobSeekerRequests.filter((row) => row.status === "completed").length;

    return {
      posts: postedJobActions,
      applications: applicationActions,
      services: serviceActions,
      requests: requestActions,
      total: postedJobActions + applicationActions + serviceActions + requestActions,
    };
  }, [
    dashboardSummary,
    managedPostApplications,
    myApplications,
    receivedJobSeekerRequests,
    sentJobSeekerRequests,
  ]);

  const dashboardTabs = useMemo(
    () =>
      dashboardTabItems.map((tab) => ({
        ...tab,
        badge: actionCounts[tab.id] > 0 ? actionCounts[tab.id] : undefined,
      })),
    [actionCounts],
  );

  const compensationStats = useMemo(
    () => ({
      recruitEarned: stats.totalEarned,
      seekerEarned: jobSeekerStats.earned,
      totalEarned: Number(stats.totalEarned || 0) + Number(jobSeekerStats.earned || 0),
      recruitPaidCount: stats.completedCount,
      seekerPaidCount: jobSeekerStats.paidCount,
    }),
    [jobSeekerStats.earned, jobSeekerStats.paidCount, stats.completedCount, stats.totalEarned],
  );

  const profileSummaryMetrics = useMemo(() => {
    const recruitSummary = dashboardSummary?.recruit || {};
    const seekerSummary = dashboardSummary?.seeker || {};
    const serviceCompletedCount = myJobSeekerServices.reduce(
      (sum, service) => sum + Number(service.completedCount || 0),
      0,
    );
    const serviceRequestCount = myJobSeekerServices.reduce(
      (sum, service) => sum + Number(service.requestCount || 0),
      0,
    );
    const creditScore =
      profile?.creditScore ?? profile?.trustScore ?? profile?.reliabilityScore ?? null;

    return {
      ratingText: formatRatingMetric(stats.averageRating, stats.reviewCount),
      scoreText: formatScoreMetric(creditScore),
      completionText: formatCompletionMetric(
        Number(recruitSummary.paidCount ?? stats.completedCount) +
          Number(seekerSummary.receivedPaidCount ?? serviceCompletedCount),
        Number(recruitSummary.applicantTotalCount ?? stats.completedCount + stats.activeCount) +
          Number(seekerSummary.receivedRequestTotalCount ?? serviceRequestCount),
      ),
    };
  }, [dashboardSummary, myJobSeekerServices, profile, stats]);

  const reviewBuckets = useMemo(
    () => ({
      worker: myReceivedRatings.filter((row) => row.ratingScope === "worker"),
      requester: myReceivedRatings.filter((row) => row.ratingScope === "requester"),
    }),
    [myReceivedRatings],
  );

  const activeTabLoading =
    activeTab === "applications"
      ? isApplicationsLoading
      : activeTab === "posts"
        ? isPostsLoading
        : activeTab === "services"
          ? isJobSeekerServicesLoading
        : activeTab === "requests"
          ? requestDirectionFilter === "received"
            ? shouldLoadClassRequests
              ? isClassJobSeekerRequestsLoading
              : isReceivedJobSeekerRequestsLoading
            : isSentJobSeekerRequestsLoading
          : activeTab === "reviews"
            ? isRatingsLoading
            : false;
  const filteredApplications = useMemo(() => {
    const rows = myApplications.filter((application) => {
      if (applicationStatusFilter === "active") {
        return ACTIVE_APPLICATION_STATUSES.includes(application.status);
      }
      return applicationStatusFilter === "all" ? true : application.status === applicationStatusFilter;
    });
    return [...rows].sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.appliedAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || right.appliedAt || 0).getTime();
      if (applicationSortOrder === "oldest") return leftTime - rightTime;
      if (applicationSortOrder === "reward") {
        return Number(right.rewardAmount || 0) - Number(left.rewardAmount || 0);
      }
      return rightTime - leftTime;
    });
  }, [applicationSortOrder, applicationStatusFilter, myApplications]);

  const selectedApplication = useMemo(
    () => myApplications.find((application) => application.id === selectedApplicationId) || null,
    [myApplications, selectedApplicationId],
  );

  const filteredPosts = useMemo(() => {
    const rows = myPosts.filter((post) => {
      const displayStatus = getDisplayPostStatusValue(post);
      if (postStatusFilter === "active") {
        return ACTIVE_POST_STATUSES.includes(post.status) && displayStatus !== "deadline_closed";
      }
      if (postStatusFilter === "all") return displayStatus !== "cancelled";
      if (postStatusFilter === "closed") return ["closed", "deadline_closed"].includes(displayStatus);
      return displayStatus === postStatusFilter;
    });
    return [...rows].sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
      if (postSortOrder === "oldest") return leftTime - rightTime;
      if (postSortOrder === "applications") {
        return Number(right.applicationCount || 0) - Number(left.applicationCount || 0);
      }
      return rightTime - leftTime;
    });
  }, [myPosts, postSortOrder, postStatusFilter]);

  const filteredServices = useMemo(() => {
    const rows = myJobSeekerServices.filter((service) =>
      serviceStatusFilter === "all"
        ? service.status !== "deleted"
        : service.status === serviceStatusFilter,
    );
    return sortByTime(rows, "recent", ["updatedAt", "createdAt"]);
  }, [myJobSeekerServices, serviceStatusFilter]);

  const requestBaseRows =
    requestDirectionFilter === "received"
      ? shouldLoadClassRequests
        ? classJobSeekerRequests
        : receivedJobSeekerRequests
      : sentJobSeekerRequests;
  const requestReadError = requestDirectionFilter === "sent" ? sentRequestError : shouldLoadClassRequests ? classRequestError : receivedRequestError;
  const retryRequestRead = requestDirectionFilter === "sent" ? retrySentRequests : shouldLoadClassRequests ? retryClassRequests : retryReceivedRequests;
  const requestReadLoading = requestDirectionFilter === "sent" ? isSentJobSeekerRequestsLoading : shouldLoadClassRequests ? isClassJobSeekerRequestsLoading : isReceivedJobSeekerRequestsLoading;

  const filteredRequests = useMemo(() => {
    const rows = requestBaseRows.filter((request) => {
      if (requestStatusFilter === "all") return true;
      if (requestStatusFilter === "action") {
        return getRequestActionNeeded(request, requestDirectionFilter);
      }
      if (requestStatusFilter === "closed") {
        return ["rejected", "cancelled"].includes(request.status);
      }
      return request.status === requestStatusFilter;
    });
    if (requestSortOrder === "reward") {
      return [...rows].sort(
        (left, right) =>
          Number(right.proposedRewardAmount || 0) - Number(left.proposedRewardAmount || 0),
      );
    }
    return sortByTime(rows, requestSortOrder, ["updatedAt", "createdAt"]);
  }, [requestBaseRows, requestDirectionFilter, requestSortOrder, requestStatusFilter]);

  const openProfileModal = () => {
    setProfileDraft({
      bio: profile?.bio || "",
      strengthTags: Array.isArray(profile?.strengthTags) ? profile.strengthTags.join(", ") : "",
      preferredRoles: Array.isArray(profile?.preferredRoles)
        ? profile.preferredRoles.join(", ")
        : "",
      workStyle: profile?.workStyle || "",
    });
    setIsProfileModalOpen(true);
  };

  const parseCommaList = (value) =>
    String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  const handleSaveProfile = async () => {
    if (!classId) return;
    setIsSavingProfile(true);
    try {
      await updateJobBoardProfile({
        classId,
        profile: {
          bio: profileDraft.bio,
          strengthTags: parseCommaList(profileDraft.strengthTags),
          preferredRoles: parseCommaList(profileDraft.preferredRoles),
          workStyle: profileDraft.workStyle,
        },
      });
      setIsProfileModalOpen(false);
      showFeedback("프로필을 저장했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "프로필을 저장하지 못했습니다.", "error");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSavePost = async (postPayload) => {
    if (!classId || !editingPost) return;
    setBusyKey(`post:update:${editingPost.id}`);
    try {
      await updateJobBoardPost({
        classId,
        postId: editingPost.id,
        updates: postPayload,
      });
      setEditingPost(null);
      showFeedback("공고를 수정했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "공고를 수정하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleCreatePost = async (postPayload) => {
    if (!classId) return;
    setBusyKey("post:create");
    try {
      await createJobBoardPost({
        classId,
        post: postPayload,
      });
      setIsCreatePostModalOpen(false);
      showFeedback("공고를 등록했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "공고를 등록하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleSavePostStatus = async (post, nextStatus) => {
    if (!classId || !post || !nextStatus || nextStatus === post.status) return;
    setBusyKey(`post:status:${post.id}`);
    try {
      await updateJobBoardPost({
        classId,
        postId: post.id,
        updates: { status: nextStatus },
      });
      showFeedback("공고 상태를 변경했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "공고 상태를 변경하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleDeletePost = async (post) => {
    if (!classId || !post) return;
    if (!(await appConfirm("이 구인 공고를 삭제할까요? 삭제하면 목록에서 숨겨집니다.", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;
    setBusyKey(`post:delete:${post.id}`);
    try {
      await updateJobBoardPost({
        classId,
        postId: post.id,
        updates: { status: "cancelled" },
      });
      if (selectedManagedPost?.id === post.id) {
        setSelectedManagedPost(null);
      }
      showFeedback("구인 공고를 삭제했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "구인 공고를 삭제하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleSelectApplication = async (application) => {
    if (!classId || !selectedManagedPost) return;
    setBusyKey(`select:${application.id}`);
    try {
      await reviewJobBoardApplication({
        classId,
        postId: selectedManagedPost.id,
        applicationId: application.id,
        action: "select",
      });
      showFeedback("지원자를 선발했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "지원자를 선발하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleRejectApplication = async () => {
    if (!classId || !selectedManagedPost || !rejectTarget) return;
    setBusyKey(`reject:${rejectTarget.id}`);
    try {
      await reviewJobBoardApplication({
        classId,
        postId: selectedManagedPost.id,
        applicationId: rejectTarget.id,
        action: "reject",
        rejectionReason,
      });
      setRejectTarget(null);
      setRejectionReason("");
      showFeedback("지원 상태를 반려로 변경했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "지원 상태를 변경하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handlePayReward = async () => {
    if (!classId || !selectedManagedPost || !paymentTarget) return;
    setBusyKey(`pay:${paymentTarget.id}`);
    try {
      await payJobBoardReward({
        classId,
        postId: selectedManagedPost.id,
        applicationId: paymentTarget.id,
        note: paymentNote,
      });
      setPaymentTarget(null);
      setPaymentNote("");
      showFeedback("보상을 지급 완료했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "보상 지급에 실패했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleApproveSubmission = async (application) => {
    if (!classId || !selectedManagedPost || !application) return;
    setBusyKey(`approve:${application.id}`);
    try {
      await approveJobBoardSubmission({
        classId,
        postId: selectedManagedPost.id,
        applicationId: application.id,
      });
      showFeedback("제출된 작업을 승인했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "제출된 작업을 승인하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleSubmitRequesterRating = async () => {
    if (!classId || !requesterRatingTarget) return;
    setBusyKey(`requester-rate:${requesterRatingTarget.postId}`);
    try {
      await submitJobBoardRating({
        classId,
        postId: requesterRatingTarget.postId,
        rating: requesterRatingValue,
        review: requesterRatingReview,
      });
      setRequesterRatingTarget(null);
      setRequesterRatingValue(5);
      setRequesterRatingReview("");
      showFeedback("평점을 등록했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "평점을 등록하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleReviewJobSeekerRequest = async (target, action) => {
    if (!classId || !target) return;
    const rejectionReason =
      action === "reject"
        ? (await appPrompt("거절 사유를 간단히 입력해 주세요. 비워 두어도 됩니다.", "", {"title":"의뢰 거절","inputLabel":"거절 사유","confirmLabel":"거절하기","tone":"rose"})) ?? null
        : "";
    if (action === "reject" && rejectionReason === null) return;
    setBusyKey(`request:${action}:${target.id}`);
    try {
      await reviewJobSeekerRequest({
        classId,
        serviceId: target.serviceId,
        requestId: target.id,
        action,
        rejectionReason,
      });
      showFeedback(
        action === "accept" ? "의뢰를 수락했습니다." : "의뢰를 거절했습니다.",
        "success",
      );
    } catch (error) {
      showFeedback(error.message || "의뢰 상태를 변경하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handlePayJobSeekerRequest = async (target) => {
    if (!classId || !target) return;
    setBusyKey(`request:pay:${target.id}`);
    try {
      await payJobSeekerRequestReward({
        classId,
        serviceId: target.serviceId,
        requestId: target.id,
        note: "",
      });
      showFeedback("의뢰 보상을 보상 지급했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "의뢰 보상을 지급하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleCompleteJobSeekerRequest = async (target) => {
    if (!classId || !target) return;
    setBusyKey(`request:complete:${target.id}`);
    try {
      await completeJobSeekerRequest({
        classId,
        serviceId: target.serviceId,
        requestId: target.id,
      });
      showFeedback("의뢰를 완료 처리했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "의뢰를 완료 처리하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const toggleExpandedRequest = (request) => {
    setExpandedRequestIds((current) =>
      current.includes(request.id)
        ? current.filter((id) => id !== request.id)
        : [...current, request.id],
    );
  };

  if (isInitialPageLoading) {
    return (
      <AppLayout showSidebar showDefaultHeader={false}>
        <PageLoader
          fullHeight={false}
          className="min-h-screen"
          message="내 현황을 불러오는 중입니다..."
        />
      </AppLayout>
    );
  }

  if (!classId) {
    return (
      <AppLayout showSidebar showDefaultHeader={false}>
        <div className="min-h-screen p-6">
          <Card>
            <Card.Content noPadding>
              <p className="text-lg font-black text-slate-900">
                학급 정보가 없어 내 현황을 불러올 수 없습니다.
              </p>
            </Card.Content>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showSidebar showDefaultHeader={false}>
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">

        <PageHeader
          title="내 현황"
          subtitle="올린 구인, 지원한 구인, 내 서비스, 의뢰한 서비스를 한곳에서 관리합니다."
          icon={UserRound}
          rightSlot={
            <JobBoardModeTabs
              active=""
              onNavigate={(mode) => navigate(mode === "recruit" ? "/job-board" : "/job-board/seeker")}
            />
          }
        />

        <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg font-black text-white shadow-sm">
                  {(userData?.name || "?").slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black text-blue-600">내 프로필</p>
                  <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">
                    {userData?.name || "사용자"}
                  </h2>
                  <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-slate-500">
                    {profile?.bio || "아직 소개가 없습니다."}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                
                <Badge tone="slate">{profileSummaryMetrics.scoreText}</Badge>
                
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3 xl:min-w-[400px] xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
              <div>
                <div className="flex items-center gap-2 text-slate-400">
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <p className="text-xs font-black">평점</p>
                </div>
                <p className="mt-2 text-lg font-black text-slate-950">{profileSummaryMetrics.ratingText}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-slate-400">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <p className="text-xs font-black">완료율</p>
                </div>
                <p className="mt-2 text-lg font-black text-slate-950">{profileSummaryMetrics.completionText}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-slate-400">
                  <Coins className="h-4 w-4 text-amber-500" />
                  <p className="text-xs font-black">받은 금액</p>
                </div>
                <p className="mt-2 text-lg font-black text-slate-950">
                  {formatReward(compensationStats.totalEarned, currencyUnit)}
                </p>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <Button kind="outline" tone="slate" icon={Pencil} onClick={openProfileModal}>
                  프로필 수정
                </Button>
              </div>
            </div>
          </div>
        </section>
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-black text-slate-950">관리 현황</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                승인이나 지급처럼 처리할 일이 있으면 탭에 빨간 숫자로 표시됩니다.
              </p>
            </div>
            {actionCounts.total > 0 ? (
              <Badge tone="red">처리 필요 {formatCountLabel(actionCounts.total)}</Badge>
            ) : (
              <Badge tone="emerald">처리할 항목 없음</Badge>
            )}
          </div>
          <Tabs
            tabs={dashboardTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            variant="underline"
            size="md"
            className="mt-4 p-1"
          />
        </section>

        {["posts", "applications", "reviews"].includes(activeTab) ? (
        <section className="space-y-4">
          <div className="space-y-5">
            <SurfaceLoader
              loading={activeTabLoading}
              hasData={
                activeTab === "posts"
                  ? myPosts.length > 0
                : activeTab === "applications"
                    ? myApplications.length > 0
                    : myReceivedRatings.length > 0
              }
            >
              {activeTab === "applications" ? (
                <Card variant="surface"  title="지원한 구인" icon={ClipboardList}>
                  <Card.Content noPadding className="gap-4">
                    <DashboardFilterBar count={filteredApplications.length}>
                        <select
                          className={dashboardSelectClassName}
                          value={applicationStatusFilter}
                          onChange={(event) => setApplicationStatusFilter(event.target.value)}
                        >
                          <option value="all">전체 상태</option>
                          {Object.entries(applicationStatusMeta).map(([value, meta]) => (
                            <option key={value} value={value}>
                              {meta.label}
                            </option>
                          ))}
                        </select>
                        <select
                          className={dashboardSelectClassName}
                          value={applicationSortOrder}
                          onChange={(event) => setApplicationSortOrder(event.target.value)}
                        >
                          <option value="recent">최근 업데이트순</option>
                          <option value="oldest">오래된순</option>
                          <option value="reward">보상 높은순</option>
                        </select>
                    </DashboardFilterBar>

                    {myApplications.length === 0 ? (
                      <EmptyState
                        title="아직 지원한 구인이 없습니다."
                        description="구인 게시판에서 공고를 둘러보고 지원하면 이곳에서 상태를 확인할 수 있습니다."
                        actionLabel="구인 보러가기"
                        onAction={() => navigate("/job-board")}
                      />
                    ) : filteredApplications.length === 0 ? (
                      <EmptyState
                        title="조건에 맞는 지원 내역이 없습니다."
                        description="상태 필터나 정렬 기준을 바꾸면 다른 지원 내역을 볼 수 있습니다."
                      />
                    ) : (
                      <div className="space-y-3">
                        {filteredApplications.map((application) => {
                          const meta = applicationStatusMeta[application.status] || {
                            label: application.status || "-",
                            tone: "slate",
                          };

                          return (
                            <button
                              key={application.id}
                              type="button"
                              onClick={() => setSelectedApplicationId(application.id)}
                              className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left transition hover:border-blue-200 hover:bg-blue-50"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="truncate text-base font-black text-slate-900">
                                {application.postTitle || "제목 없는 공고"}
                                    </p>
                                    <Badge tone={meta.tone}>{meta.label}</Badge>
                                    <Badge tone="slate">{getSelectionTypeLabel(application.selectionType)}</Badge>
                                  </div>
                                  <p className="mt-2 text-sm text-slate-500">
                                    {application.applicantType === "team"
                                      ? `팀 지원: ${application.teamName || application.applicantName || "-"}`
                                      : "개인 지원"}
                                  </p>
                                </div>
                                <Badge tone="emerald">
                                  보상 {formatReward(application.rewardAmount, currencyUnit)}
                                </Badge>
                              </div>
                              <p className="mt-3 text-xs font-medium text-slate-400">
                                최근 업데이트 {formatDateTime(application.updatedAt || application.appliedAt)}
                              </p>
                            </button>
                          );
                        })}
                        <LoadMoreButton
                          visible={myApplications.length >= applicationLimit}
                          onClick={() => setApplicationLimit((current) => current + DASHBOARD_PAGE_SIZE)}
                        />
                      </div>
                    )}
                  </Card.Content>
                </Card>
              ) : null}

              {activeTab === "posts" ? (
                <Card variant="surface"  title="올린 구인" icon={BriefcaseBusiness}>
                  <Card.Content noPadding className="gap-4">
                    <DashboardFilterBar
                      count={filteredPosts.length}
                      action={
                        <Button
                          tone="blue"
                          icon={BriefcaseBusiness}
                          onClick={() => setIsCreatePostModalOpen(true)}
                          isLoading={busyKey === "post:create"}
                        >
                          구인 등록
                        </Button>
                      }
                    >
                        <select
                          className={dashboardSelectClassName}
                          value={postStatusFilter}
                          onChange={(event) => setPostStatusFilter(event.target.value)}
                        >
                          <option value="all">전체 상태</option>
                          {Object.entries(postStatusMeta).map(([value, meta]) => (
                            <option key={value} value={value}>
                              {meta.label}
                            </option>
                          ))}
                        </select>
                        <select
                          className={dashboardSelectClassName}
                          value={postSortOrder}
                          onChange={(event) => setPostSortOrder(event.target.value)}
                        >
                          <option value="recent">최근 업데이트순</option>
                          <option value="oldest">오래된순</option>
                          <option value="applications">지원자 많은순</option>
                        </select>
                    </DashboardFilterBar>

                    {myPosts.length === 0 ? (
                      <EmptyState
                        title="아직 올린 구인이 없습니다."
                        description="공고를 작성하면 이곳에서 내 공고 상태와 지원자 수를 관리할 수 있습니다."
                        actionLabel="구인 등록"
                        onAction={() => setIsCreatePostModalOpen(true)}
                      />
                    ) : filteredPosts.length === 0 ? (
                      <EmptyState
                        title="조건에 맞는 구인이 없습니다."
                        description="상태 필터나 정렬 기준을 바꾸면 다른 공고를 볼 수 있습니다."
                      />
                    ) : (
                      <>
                      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        {filteredPosts.map((post) => {
                          const meta = getDisplayPostStatusMeta(post);
                          const canEditStatus = isManualPostStatus(post.status);
                          return (
                            <div key={post.id} className="border-b border-slate-100 px-5 py-4 last:border-b-0">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="truncate text-base font-black text-slate-900">
                                      {post.title || "제목 없는 공고"}
                                    </p>
                                    <Badge tone={meta.tone}>{meta.label}</Badge>
                                  </div>
                                  <p className="mt-2 text-sm text-slate-500">
                                    지원 {Number(post.applicationCount || 0).toLocaleString()}명 · 선발 {Number(post.selectedCount || 0).toLocaleString()}명
                                  </p>
                                </div>
                                <Badge tone="emerald">{formatReward(post.rewardAmount || 0, currencyUnit)}</Badge>
                              </div>

                              <div className="mt-4 flex flex-wrap gap-2">
                                <Button kind="outline" tone="blue" onClick={() => setSelectedManagedPost(post)}>
                                  지원자 관리
                                </Button>
                                <Button kind="outline" tone="slate" icon={Pencil} onClick={() => setEditingPost(post)}>
                                  수정
                                </Button>
                                {canEditStatus ? (
                                  <>
                                    <select
                                      className={dashboardSelectClassName}
                                      value={post.status}
                                      onChange={(event) => handleSavePostStatus(post, event.target.value)}
                                      disabled={busyKey === `post:status:${post.id}`}
                                    >
                                      {POST_STATUS_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </>
                                ) : null}
                                <Button
                                  kind="ghost"
                                  tone="red"
                                  icon={Trash2}
                                  onClick={() => handleDeletePost(post)}
                                  isLoading={busyKey === `post:delete:${post.id}`}
                                >
                                  삭제
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <LoadMoreButton
                        visible={myPosts.length >= postLimit}
                        onClick={() => setPostLimit((current) => current + DASHBOARD_PAGE_SIZE)}
                      />
                      </>
                    )}
                  </Card.Content>
                </Card>
              ) : null}

              {activeTab === "reviews" ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <Card variant="surface"  title="작업자로 받은 후기" icon={Star}>
                    <Card.Content noPadding className="gap-4">
                      {reviewBuckets.worker.length === 0 ? (
                        <EmptyState
                          title="작업자 후기가 없습니다."
                          description="일을 마치고 보상을 받으면 여기에 후기가 쌓여요."
                        />
                      ) : (
                        reviewBuckets.worker.map((rating) => (
                          <div key={rating.id} className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
                            <div className="flex items-center gap-1 text-yellow-500">
                              {Array.from({ length: Number(rating.rating || 0) }).map((_, index) => (
                                <Star key={index} className="h-4 w-4 fill-current" />
                              ))}
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{rating.review || "후기 내용이 없습니다."}</p>
                            <p className="mt-2 text-xs font-bold text-slate-400">{formatDateTime(rating.createdAt)}</p>
                          </div>
                        ))
                      )}
                    </Card.Content>
                  </Card>

                  <Card variant="surface"  title="의뢰인으로 받은 후기" icon={MessageSquareText}>
                    <Card.Content noPadding className="gap-4">
                      {reviewBuckets.requester.length === 0 ? (
                        <EmptyState
                          title="의뢰인 후기가 없습니다."
                          description="내가 공고를 올리고 일을 맡긴 뒤 지급까지 끝나면 이 역할의 후기도 쌓일 수 있습니다."
                        />
                      ) : (
                        reviewBuckets.requester.map((rating) => (
                          <div key={rating.id} className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
                            <div className="flex items-center gap-1 text-yellow-500">
                              {Array.from({ length: Number(rating.rating || 0) }).map((_, index) => (
                                <Star key={index} className="h-4 w-4 fill-current" />
                              ))}
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{rating.review || "후기 내용이 없습니다."}</p>
                            <p className="mt-2 text-xs font-bold text-slate-400">{formatDateTime(rating.createdAt)}</p>
                          </div>
                        ))
                      )}
                    </Card.Content>
                  </Card>
                </div>
              ) : null}
            </SurfaceLoader>
          </div>
        </section>
        ) : null}

        {["services", "requests"].includes(activeTab) ? (
        <section className="space-y-4">
          <div className="space-y-5">
            <SurfaceLoader
              loading={activeTabLoading}
              hasData={
                activeTab === "services"
                  ? myJobSeekerServices.length > 0
                  : requestBaseRows.length > 0
              }
            >
              <div className="grid gap-4">
                {activeTab === "services" ? (
                <Card variant="surface"  title="내 서비스" icon={BriefcaseBusiness}>
                  <Card.Content noPadding className="gap-4">
                    <DashboardFilterBar count={filteredServices.length}>
                      <select
                        className={dashboardSelectClassName}
                        value={serviceStatusFilter}
                        onChange={(event) => setServiceStatusFilter(event.target.value)}
                      >
                        {serviceStatusFilterOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </DashboardFilterBar>
                    {myJobSeekerServices.length === 0 ? (
                      <EmptyState
                        title="아직 등록한 서비스가 없습니다."
                        description="내가 할 수 있는 일을 서비스로 올리면 다른 학생이 의뢰를 보낼 수 있습니다."
                        actionLabel="서비스 등록"
                        onAction={() => navigate("/job-board/seeker")}
                      />
                    ) : filteredServices.length === 0 ? (
                      <EmptyState
                        title="조건에 맞는 서비스가 없습니다."
                        description="상태 필터를 바꾸면 다른 서비스를 볼 수 있습니다."
                      />
                    ) : (
                      <div className="space-y-3">
                      {filteredServices.map((service) => {
                        const meta = getJobSeekerMeta(service.status, SERVICE_STATUS_META);
                        return (
                          <div key={service.id} className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-base font-black text-slate-900">
                                    {service.title || "제목 없는 서비스"}
                                  </p>
                                  <Badge tone={meta.tone}>{meta.label}</Badge>
                                </div>
                                <p className="mt-2 text-sm text-slate-500">
                                  의뢰 {Number(service.requestCount || 0).toLocaleString()}건 · 완료 {Number(service.completedCount || 0).toLocaleString()}건
                                </p>
                              </div>
                              <Badge tone="emerald">{formatJobSeekerPrice(service, currencyUnit)}</Badge>
                            </div>
                          </div>
                        );
                      })}
                      <LoadMoreButton
                        visible={myJobSeekerServices.length >= serviceLimit}
                        onClick={() => setServiceLimit((current) => current + DASHBOARD_PAGE_SIZE)}
                      />
                      </div>
                    )}
                  </Card.Content>
                </Card>
                ) : null}

                {activeTab === "requests" ? (
                <Card variant="surface"  title="의뢰 관리" icon={Inbox}>
                  <Card.Content noPadding className="gap-4">
                    <DashboardFilterBar count={filteredRequests.length}>
                      <select
                        className={dashboardSelectClassName}
                        value={requestDirectionFilter}
                        aria-label="의뢰 방향"
                        onChange={(event) => {
                          navigate('/job-board/me?tab=requests&direction=' + event.target.value + '&status=' + requestStatusFilter, {replace: true});
                        }}
                      >
                        {requestDirectionOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className={dashboardSelectClassName}
                        value={requestStatusFilter}
                        aria-label="의뢰 상태"
                        onChange={(event) => navigate('/job-board/me?tab=requests&direction=' + requestDirectionFilter + '&status=' + event.target.value, {replace: true})}
                      >
                        {requestStatusFilterOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className={dashboardSelectClassName}
                        value={requestSortOrder}
                        onChange={(event) => setRequestSortOrder(event.target.value)}
                      >
                        <option value="recent">최근 업데이트순</option>
                        <option value="oldest">오래된순</option>
                        <option value="reward">금액 높은순</option>
                      </select>
                    </DashboardFilterBar>
                    {requestReadError ? <div role="alert" className="p-6 text-sm text-slate-600"><p className="font-semibold text-rose-700">의뢰를 불러오지 못했습니다.</p><Button className="mt-3" kind="outline" tone="slate" onClick={retryRequestRead}>다시 시도</Button></div>
                      : requestReadLoading ? <p role="status" className="p-6 text-sm text-slate-500">의뢰를 불러오는 중입니다...</p>
                      : requestBaseRows.length === 0 ? (
                      <EmptyState
                        title={requestStatusFilter === "all" ? `아직 ${requestDirectionFilter === "received" ? "받은" : "보낸"} 의뢰가 없습니다.` : "선택한 상태의 의뢰가 없습니다."}
                        description={requestStatusFilter === "all" ? "내 서비스를 등록하거나 친구에게 의뢰를 보내 보세요." : "전체 상태로 바꾸면 다른 의뢰를 확인할 수 있습니다."}
                        actionLabel={requestStatusFilter !== "all" ? "전체 의뢰 보기" : undefined}
                        onAction={() => navigate('/job-board/me?tab=requests&direction=' + requestDirectionFilter + '&status=all', {replace:true})}
                      />
                    ) : (
                      <>
                      <DashboardRequestList
                        requests={filteredRequests}
                        direction={requestDirectionFilter}
                        currencyUnit={currencyUnit}
                        isTeacher={isTeacher}
                        busyKey={busyKey}
                        expandedIds={expandedRequestIds}
                        onToggle={toggleExpandedRequest}
                        onAccept={(target) => handleReviewJobSeekerRequest(target, "accept")}
                        onReject={(target) => handleReviewJobSeekerRequest(target, "reject")}
                        onComplete={handleCompleteJobSeekerRequest}
                        onPay={handlePayJobSeekerRequest}
                      />
                      <LoadMoreButton
                        visible={requestBaseRows.length >= requestLimit}
                        onClick={() => setRequestLimit((current) => current + DASHBOARD_PAGE_SIZE)}
                      />
                      </>
                    )}
                  </Card.Content>
                </Card>
                ) : null}
              </div>
            </SurfaceLoader>
          </div>
        </section>
        ) : null}
      </div>

      <Modal
        isOpen={Boolean(selectedManagedPost)}
        onClose={() => {
          if (busyKey) return;
          setSelectedManagedPost(null);
        }}
        title={selectedManagedPost ? `${selectedManagedPost.title || "공고"} 지원자 관리` : "지원자 관리"}
        size="xl"
      >
        {selectedManagedPost ? (
          <div className="space-y-5">
            <SurfaceLoader loading={isManagedApplicationsLoading} hasData={managedPostApplications.length > 0}>
              {managedPostApplications.length === 0 ? (
                <EmptyState
                  title="아직 지원자가 없습니다."
                  description="학생이 이 공고에 지원하면 여기에서 선발, 반려, 지급을 처리할 수 있습니다."
                />
              ) : (
                <div className="space-y-3">
                  {managedPostApplications.map((application) => {
                    const meta = applicationStatusMeta[application.status] || {
                      label: application.status || "-",
                      tone: "slate",
                    };
                    return (
                      <div key={application.id} className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-base font-black text-slate-900">
                                {application.applicantName || "이름 없음"}
                              </p>
                              <Badge tone={meta.tone}>{meta.label}</Badge>
                              <Badge tone="slate">{getSelectionTypeLabel(application.selectionType)}</Badge>
                            </div>
                            <p className="mt-2 text-sm text-slate-500">
                              {application.applicantType === "team"
                                ? `팀 지원: ${application.teamName || application.memberNames?.join(", ") || "-"}`
                                : "개인 지원"}
                            </p>
                          </div>
                          <Badge tone="emerald">{formatReward(application.rewardAmount || selectedManagedPost.rewardAmount || 0, currencyUnit)}</Badge>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <div className="rounded-2xl bg-slate-50 px-4 py-3">
                            <p className="text-xs font-black text-slate-400">지원 동기</p>
                            <p className="mt-1 text-sm text-slate-600">{application.motivation || "-"}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-4 py-3">
                            <p className="text-xs font-black text-slate-400">경험</p>
                            <p className="mt-1 text-sm text-slate-600">{application.experience || "-"}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-4 py-3">
                            <p className="text-xs font-black text-slate-400">계획</p>
                            <p className="mt-1 text-sm text-slate-600">{application.plan || "-"}</p>
                          </div>
                        </div>

                        {application.submissionText ? (
                          <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                            제출 내용: {application.submissionText}
                          </div>
                        ) : null}

                        <div className="mt-4 flex flex-wrap gap-2">
                          {application.status === "applied" ? (
                            <Button
                              kind="outline"
                              tone="blue"
                              onClick={() => handleSelectApplication(application)}
                              isLoading={busyKey === `select:${application.id}`}
                            >
                              선발
                            </Button>
                          ) : null}
                          {application.status === "submitted" ? (
                            <Button
                              kind="outline"
                              tone="emerald"
                              onClick={() => handleApproveSubmission(application)}
                              isLoading={busyKey === `approve:${application.id}`}
                            >
                              제출 승인
                            </Button>
                          ) : null}
                          {application.status === "approved" ? (
                            <Button
                              kind="outline"
                              tone="emerald"
                              onClick={() => setPaymentTarget(application)}
                              isLoading={busyKey === `pay:${application.id}`}
                            >
                              보상 지급
                            </Button>
                          ) : null}
                          {["applied", "selected", "submitted"].includes(application.status) ? (
                            <Button kind="ghost" tone="red" onClick={() => setRejectTarget(application)}>
                              반려
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SurfaceLoader>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={Boolean(selectedApplication)}
        onClose={() => setSelectedApplicationId("")}
        title={selectedApplication ? `${selectedApplication.postTitle || "공고"} 지원 상세` : "지원 상세"}
        size="lg"
      >
        {selectedApplication ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Badge tone={(applicationStatusMeta[selectedApplication.status] || { tone: "slate" }).tone}>
                {(applicationStatusMeta[selectedApplication.status] || {
                  label: selectedApplication.status || "-",
                }).label}
              </Badge>
              <Badge tone="slate">{getSelectionTypeLabel(selectedApplication.selectionType)}</Badge>
              <Badge tone="emerald">{formatReward(selectedApplication.rewardAmount || 0, currencyUnit)}</Badge>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
              <p className="text-lg font-black text-slate-900">
                {selectedApplication.postTitle || "제목 없는 공고"}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                최근 업데이트 {formatDateTime(selectedApplication.updatedAt || selectedApplication.appliedAt)}
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-black text-slate-400">지원 형태</p>
                <p className="mt-1 text-sm text-slate-700">
                  {selectedApplication.applicantType === "team"
                    ? `팀 지원: ${selectedApplication.teamName || selectedApplication.applicantName || "-"}`
                    : "개인 지원"}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-black text-slate-400">지원자</p>
                <p className="mt-1 text-sm text-slate-700">
                  {selectedApplication.applicantName || userData?.name || "-"}
                </p>
              </div>
            </div>

            {!isTeacher && selectedApplication.applicantUid === userData?.uid && selectedApplication.status === "selected" ? (
              <Button tone="blue" onClick={() => {setWorkTarget(selectedApplication); setWorkText("");}}>결과 제출</Button>
            ) : null}

            {selectedApplication.memberNames?.length > 1 ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-black text-slate-400">팀원</p>
                <p className="mt-1 text-sm text-slate-700">
                  {selectedApplication.memberNames.join(", ")}
                </p>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-black text-slate-400">지원 동기</p>
                <p className="mt-1 text-sm text-slate-600">{selectedApplication.motivation || "-"}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-black text-slate-400">경험</p>
                <p className="mt-1 text-sm text-slate-600">{selectedApplication.experience || "-"}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-black text-slate-400">계획</p>
                <p className="mt-1 text-sm text-slate-600">{selectedApplication.plan || "-"}</p>
              </div>
            </div>

            {selectedApplication.roleSummary ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                역할 요약: {selectedApplication.roleSummary}
              </div>
            ) : null}
            {selectedApplication.submissionText ? (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                제출 내용: {selectedApplication.submissionText}
              </div>
            ) : null}
            {selectedApplication.rejectionReason ? (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                반려 사유: {selectedApplication.rejectionReason}
              </div>
            ) : null}
            {selectedApplication.paymentShares?.length ? (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                <p className="text-xs font-black text-emerald-700">지급 내역</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedApplication.paymentShares.map((share) => (
                    <Badge key={`${selectedApplication.id}:${share.uid}`} tone="emerald">
                      {share.name} {formatReward(share.amount, currencyUnit)}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <TextPromptModal
        isOpen={Boolean(workTarget)} title="작업 결과 제출" description={workTarget ? `${workTarget.postTitle}에서 완료한 내용을 적어 주세요.` : ""}
        value={workText} onChange={setWorkText} submitLabel="결과 제출" isSubmitting={busyKey === "work:submit"}
        onClose={() => {if (busyKey !== "work:submit") setWorkTarget(null);}}
        onSubmit={async () => {
          if (!workTarget || busyKey) return;
          if (!workText.trim()) return showFeedback("완료한 내용을 입력해 주세요.", "error");
          setBusyKey("work:submit");
          try {
            await submitJobBoardWork({classId, postId: workTarget.postId, submissionText: workText.trim()});
            showFeedback("작업 결과를 제출했습니다.", "success"); setWorkTarget(null); setWorkText("");
          } catch (error) {showFeedback(error.message || "결과를 제출하지 못했습니다.", "error");}
          finally {setBusyKey("");}
        }}
      />

      <JobPostModal
        isOpen={isCreatePostModalOpen}
        onClose={() => {
          if (busyKey === "post:create") return;
          setIsCreatePostModalOpen(false);
        }}
        initialPost={null}
        onSubmit={handleCreatePost}
        isSubmitting={busyKey === "post:create"}
        currencyUnit={currencyUnit}
        submitLabel="구인 등록"
      />

      <JobPostModal
        isOpen={Boolean(editingPost)}
        onClose={() => {
          if (editingPost && busyKey === `post:update:${editingPost.id}`) return;
          setEditingPost(null);
        }}
        initialPost={editingPost}
        onSubmit={handleSavePost}
        isSubmitting={Boolean(editingPost) && busyKey === `post:update:${editingPost?.id}`}
        currencyUnit={currencyUnit}
        submitLabel="구인 수정"
      />

      <RatingModal
        isOpen={Boolean(requesterRatingTarget)}
        onClose={() => {
          if (
            requesterRatingTarget &&
            busyKey === `requester-rate:${requesterRatingTarget.postId}`
          ) {
            return;
          }
          setRequesterRatingTarget(null);
          setRequesterRatingValue(5);
          setRequesterRatingReview("");
        }}
        target={requesterRatingTarget}
        value={requesterRatingValue}
        review={requesterRatingReview}
        onChangeValue={setRequesterRatingValue}
        onChangeReview={setRequesterRatingReview}
        onSubmit={handleSubmitRequesterRating}
        isSubmitting={
          Boolean(requesterRatingTarget) &&
          busyKey === `requester-rate:${requesterRatingTarget?.postId}`
        }
      />

      <Modal
        isOpen={isProfileModalOpen}
        onClose={() => {
          if (isSavingProfile) return;
          setIsProfileModalOpen(false);
        }}
        title="프로필 수정"
        size="lg"
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">소개 문구</label>
            <Textarea
              rows={4}
              className="rounded-2xl border-slate-200 px-4 py-3"
              value={profileDraft.bio}
              onChange={(event) =>
                setProfileDraft((current) => ({ ...current, bio: event.target.value }))
              }
              placeholder="잘하는 일, 맡고 싶은 역할, 함께 일하는 방식을 적어주세요."
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">강점 태그</label>
            <input
              className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
              value={profileDraft.strengthTags}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  strengthTags: event.target.value,
                }))
              }
              placeholder="예: 글쓰기, PPT, 발표"
            />
            <p className="text-xs text-slate-500">쉼표로 여러 개를 입력할 수 있습니다.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">선호 역할</label>
            <input
              className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
              value={profileDraft.preferredRoles}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  preferredRoles: event.target.value,
                }))
              }
              placeholder="예: 자료조사, 디자인, 발표"
            />
            <p className="text-xs text-slate-500">쉼표로 여러 개를 입력할 수 있습니다.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">작업 방식</label>
            <Textarea
              rows={3}
              className="rounded-2xl border-slate-200 px-4 py-3"
              value={profileDraft.workStyle}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  workStyle: event.target.value,
                }))
              }
              placeholder="예: 일정 공유를 자주 하고, 마감 전 검토 시간을 확보합니다."
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              kind="outline"
              tone="slate"
              onClick={() => setIsProfileModalOpen(false)}
              disabled={isSavingProfile}
            >
              닫기
            </Button>
            <Button tone="blue" icon={Pencil} onClick={handleSaveProfile} isLoading={isSavingProfile}>
              저장
            </Button>
          </div>
        </div>
      </Modal>

      <TextPromptModal
        isOpen={Boolean(rejectTarget)}
        onClose={() => {
          if (rejectTarget && busyKey === `reject:${rejectTarget.id}`) return;
          setRejectTarget(null);
          setRejectionReason("");
        }}
        title="반려 사유 입력"
        description="지원자에게 전달할 반려 사유를 입력하세요. 입력한 내용은 지원 상세에 표시됩니다."
        value={rejectionReason}
        onChange={setRejectionReason}
        onSubmit={handleRejectApplication}
        submitLabel="반려 처리"
        isSubmitting={Boolean(rejectTarget) && busyKey === `reject:${rejectTarget?.id}`}
      />

      <TextPromptModal
        isOpen={Boolean(paymentTarget)}
        onClose={() => {
          if (paymentTarget && busyKey === `pay:${paymentTarget.id}`) return;
          setPaymentTarget(null);
          setPaymentNote("");
        }}
        title="보상 지급"
        description="선발된 학생에게 보상을 지급합니다. 필요한 경우 지급 메모를 남길 수 있습니다."
        value={paymentNote}
        onChange={setPaymentNote}
        onSubmit={handlePayReward}
        submitLabel="보상 지급"
        isSubmitting={Boolean(paymentTarget) && busyKey === `pay:${paymentTarget?.id}`}
      />
    </AppLayout>
  );
}
