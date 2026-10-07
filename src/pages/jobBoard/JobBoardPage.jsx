import { appConfirm } from "../../utils/appDialogs";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  BriefcaseBusiness,
  ClipboardCheck,
  MessageSquareWarning,
  Plus,
  Search,
  Settings2,
} from "lucide-react";
import {
  doc,
  updateDoc,
} from "firebase/firestore";
import {
  db,
} from "../../firebase";
import AppLayout from "../../components/layout/AppLayout";
import {
  Button,
  Card,
  PageHeader,
  PageLoader,
} from "../../components/ui";
import {
  useFeedback,
} from "../../contexts/FeedbackContext";
import {
  useUser,
} from "../../contexts/UserContext";
import {
  useMyAuthoredJobBoardRatingsQuery,
  useJobBoardProfilesQuery,
  useJobBoardPostsQuery,
  useJobPostApplicationsQuery,
  useJobBoardRatingsQuery,
  useMyJobBoardApplicationsQuery,
} from "./hooks/useJobBoardData";
import {
  createJobBoardPost,
  moderateJobBoardPost,
  moderateJobBoardRating,
  payJobBoardReward,
  reviewJobBoardApplication,
  submitJobBoardApplication,
  submitJobBoardWorkerRating,
  updateJobBoardPost,
  withdrawJobBoardApplication,
} from "./services/jobBoardService";
import JobApplicationsModal from "./JobApplicationsModal";
import JobPostApprovalModal from "./JobPostApprovalModal";
import JobPostDetailModal from "./JobPostDetailModal";
import JobRecruitDiscoveryList from "./JobRecruitDiscoveryList";
import JobBoardInbox from "./JobBoardInbox";

import {
  DEFAULT_JOB_BOARD_SETTINGS,
  inputClassName,
  normalizePostStatusValue,
  usesApplicationForm,
  isApplicationPayable,
  isPostRecruiting,
  canReapplyFromStatus,
  isPrivatePostStatus,
  isManualPostStatus,
  getApplicationRatingTargets,
  matchesStatusFilter,
  buildPostSearchBlob,
  SelectBox,
  TextPromptModal,
  JobBoardSettingsModal,
  RatingModal,
  RatingModerationModal,
  RatingManagementCard,
  JobPostModal,
  ApplyModal,
} from "./JobBoardPage.parts";
import {
  JobBoardModeTabs,
} from "./JobSeekerBoardPage.parts";

export default function JobBoardPage() {
  const navigate = useNavigate();
  const { classId, classData, userData, loading, isTeacher, studentList: students = [] } = useUser();
  const { showFeedback } = useFeedback();
  const currencyUnit = classData?.currencyUnit || "코인";
  const jobBoardSettings = useMemo(
    () => ({
      ...DEFAULT_JOB_BOARD_SETTINGS,
      ...(classData?.settings?.jobBoard || {}),
    }),
    [classData?.settings?.jobBoard],
  );

  const [selectedPostId, setSelectedPostId] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [busyKey, setBusyKey] = useState("");
  const [editingPost, setEditingPost] = useState(null);
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [applicationPost, setApplicationPost] = useState(null);
  const [editingApplication, setEditingApplication] = useState(null);
  const [applicationsModalOpen, setApplicationsModalOpen] = useState(false);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [paymentTarget, setPaymentTarget] = useState(null);
  const [paymentNote, setPaymentNote] = useState("");
  const [bulkPaymentIds, setBulkPaymentIds] = useState([]);
  const [isBulkPaymentDragging, setIsBulkPaymentDragging] = useState(false);
  const [expandedApplicationIds, setExpandedApplicationIds] = useState([]);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [ratingTarget, setRatingTarget] = useState(null);
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingReview, setRatingReview] = useState("");
  const [ratingStatusFilter, setRatingStatusFilter] = useState("all");
  const [ratingSearchTerm, setRatingSearchTerm] = useState("");
  const [editingRating, setEditingRating] = useState(null);
  const [editingRatingValue, setEditingRatingValue] = useState(5);
  const [editingRatingReview, setEditingRatingReview] = useState("");
  const [ratingModerationNote, setRatingModerationNote] = useState("");

  const { data: posts = [], snapshotLoading: isPostsLoading, snapshotError: postsError, retrySnapshot: retryPosts } = useJobBoardPostsQuery({ classId });
  const { data: ratings = [] } = useJobBoardRatingsQuery({
    classId,
    enabled: Boolean(classId && isTeacher),
  });
  const { data: myApplications = [], snapshotLoading: applicationsLoading, snapshotError: applicationsError, retrySnapshot: retryApplications } = useMyJobBoardApplicationsQuery({
    classId,
    userUid: userData?.uid,
    enabled: Boolean(classId && userData?.uid && !isTeacher),
  });

  useEffect(() => {
    const timerId = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!isBulkPaymentDragging) return undefined;
    const stopDragging = () => setIsBulkPaymentDragging(false);
    window.addEventListener("mouseup", stopDragging);
    return () => window.removeEventListener("mouseup", stopDragging);
  }, [isBulkPaymentDragging]);

  useEffect(() => {
    if (applicationsModalOpen) return;
    setBulkPaymentIds([]);
    setExpandedApplicationIds([]);
    setReviewFilter("all");
  }, [applicationsModalOpen]);

  const visiblePosts = useMemo(() => {
    const lowerSearch = searchTerm.trim().toLowerCase();
    return posts.filter((post) => {
      const isOwnPost = post.authorUid === userData?.uid;
      if (normalizePostStatusValue(post.status) === "rejected") return false;
      if (!isTeacher && isPrivatePostStatus(post.status) && !isOwnPost) return false;
      if (!matchesStatusFilter(post, statusFilter)) return false;
      if (lowerSearch && !buildPostSearchBlob(post).includes(lowerSearch)) return false;
      return true;
    });
  }, [isTeacher, posts, searchTerm, statusFilter, userData?.uid]);

  useEffect(() => {
    const selectedPostIsVisible = visiblePosts.some((post) => post.id === selectedPostId);
    if (selectedPostIsVisible) return;

    setSelectedPostId(visiblePosts[0]?.id || "");
    setDetailOpen(false);
    if (applicationsModalOpen) {
      setApplicationsModalOpen(false);
    }
  }, [applicationsModalOpen, selectedPostId, visiblePosts]);

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) || null,
    [posts, selectedPostId],
  );

  const myApplicationsByPostId = useMemo(() => {
    const nextMap = new Map();
    myApplications.forEach((application) => nextMap.set(application.postId, application));
    return nextMap;
  }, [myApplications]);

  const ownApplication = selectedPost ? myApplicationsByPostId.get(selectedPost.id) || null : null;
  const isOwnApplicant = ownApplication?.applicantUid === userData?.uid;
  const isOwnPostAuthor = Boolean(selectedPost && selectedPost.authorUid === userData?.uid);
  const canManageSelectedPost = Boolean(selectedPost && (isTeacher || isOwnPostAuthor));
  const canManageSelectedWorkerRatings = Boolean(
    jobBoardSettings.enableRatings && selectedPost && isOwnPostAuthor,
  );
  const activeManagedPostId =
    canManageSelectedPost && applicationsModalOpen ? selectedPostId : "";
  const canCreatePosts = Boolean(isTeacher || jobBoardSettings.allowStudentPosts);

  const { data: profiles = [] } = useJobBoardProfilesQuery({
    classId,
    enabled: Boolean(classId && canManageSelectedWorkerRatings),
  });
  const { data: authoredRatings = [] } = useMyAuthoredJobBoardRatingsQuery({
    classId,
    userUid: userData?.uid,
    enabled: Boolean(
      classId &&
        userData?.uid &&
        jobBoardSettings.enableRatings &&
        canManageSelectedWorkerRatings,
    ),
  });
  const { data: selectedPostApplications = [], isLoading: isApplicationsLoading } =
    useJobPostApplicationsQuery({
      classId,
      postId: activeManagedPostId,
      authorUid: isTeacher ? "" : userData?.uid,
      enabled: Boolean(
        classId &&
          activeManagedPostId,
      ),
    });

  const profilesByUid = useMemo(() => {
    const nextMap = new Map();
    profiles.forEach((profile) => nextMap.set(profile.userUid || profile.id, profile));
    return nextMap;
  }, [profiles]);
  const workerRatingsByKey = useMemo(() => {
    const nextMap = new Map();
    authoredRatings
      .filter((rating) => rating.ratingScope === "worker")
      .forEach((rating) => {
        nextMap.set(`${rating.applicationId}__${rating.targetUid}`, rating);
      });
    return nextMap;
  }, [authoredRatings]);
  const visibleRatings = useMemo(() => {
    const lowerSearch = ratingSearchTerm.trim().toLowerCase();
    return ratings.filter((rating) => {
      if (ratingStatusFilter !== "all" && rating.status !== ratingStatusFilter) return false;
      if (!lowerSearch) return true;
      return [rating.targetName, rating.raterName, rating.postTitle, rating.review]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(lowerSearch);
    });
  }, [ratingSearchTerm, ratingStatusFilter, ratings]);
  const pendingApprovalPosts = useMemo(
    () =>
      posts.filter(
        (post) =>
          post.authorRole === "student" &&
          normalizePostStatusValue(post.status) === "pending_approval",
      ),
    [posts],
  );

  const filteredApplications = useMemo(() => {
    if (reviewFilter === "all") return selectedPostApplications;
    const filterStatusGroups = {
      review: ["applied"],
      selected: ["selected", "submitted", "approved"],
      rejected: ["rejected", "withdrawn"],
      paid: ["paid"],
    };
    const targetStatuses = filterStatusGroups[reviewFilter] || [reviewFilter];
    return selectedPostApplications.filter((application) =>
      targetStatuses.includes(application.status),
    );
  }, [reviewFilter, selectedPostApplications]);
  const payableApplications = useMemo(
    () => filteredApplications.filter(isApplicationPayable),
    [filteredApplications],
  );
  const detailApplications = useMemo(
    () => filteredApplications.filter((application) => usesApplicationForm(application.selectionType)),
    [filteredApplications],
  );
  const bulkPaymentTargets = useMemo(
    () => payableApplications.filter((application) => bulkPaymentIds.includes(application.id)),
    [bulkPaymentIds, payableApplications],
  );
  const allDetailsExpanded =
    detailApplications.length > 0 &&
    detailApplications.every((application) => expandedApplicationIds.includes(application.id));

  useEffect(() => {
    setBulkPaymentIds((currentIds) => {
      const availableIds = new Set(payableApplications.map((application) => application.id));
      return currentIds.filter((id) => availableIds.has(id));
    });
  }, [payableApplications]);

  useEffect(() => {
    setExpandedApplicationIds((currentIds) => {
      const availableIds = new Set(detailApplications.map((application) => application.id));
      return currentIds.filter((id) => availableIds.has(id));
    });
  }, [detailApplications]);

  const selectedPostRateTargets = useMemo(() => {
    if (!selectedPost || !isOwnPostAuthor) return [];

    return selectedPostApplications
      .filter((application) => application.status === "paid")
      .flatMap((application) =>
        getApplicationRatingTargets(application).map((target) => ({
          postId: selectedPost.id,
          postTitle: selectedPost.title,
          applicationId: application.id,
          applicationStatus: application.status,
          applicantName: application.applicantName,
          applicantType: application.applicantType,
          teamName: application.teamName,
          targetUid: target.uid,
          targetName: target.name,
          existingRating:
            workerRatingsByKey.get(`${application.id}__${target.uid}`) || null,
          profile: profilesByUid.get(target.uid) || null,
        })),
      );
  }, [
    isOwnPostAuthor,
    profilesByUid,
    selectedPost,
    selectedPostApplications,
    workerRatingsByKey,
  ]);

  const canApplyToPost = (post, application) => Boolean(
    post &&
      !isTeacher &&
      isPostRecruiting(post) &&
      post.authorUid !== userData?.uid &&
      Number(post.availableSlots || 0) > 0 &&
      (!application || canReapplyFromStatus(application.status)),
  );
  const canApplySelectedPost = canApplyToPost(selectedPost, ownApplication);
  const openApplicationForm = (post, application = null) => {
    setEditingApplication(application);
    setApplicationPost(post);
  };
  const closeApplicationForm = () => {
    setApplicationPost(null);
    setEditingApplication(null);
  };
  const handleSavePost = async (postPayload) => {
    if (!classId) return;
    setBusyKey(editingPost ? "post:update" : "post:create");
    try {
      if (editingPost) {
        await updateJobBoardPost({
          classId,
          postId: editingPost.id,
          updates: postPayload,
        });
        showFeedback(
          isTeacher || !jobBoardSettings.requireStudentPostApproval
            ? "공고를 수정했습니다."
            : "공고를 수정했습니다. 선생님 승인 후 게시됩니다.",
          "success",
        );
      } else {
        await createJobBoardPost({ classId, post: postPayload });
        showFeedback(
          isTeacher || !jobBoardSettings.requireStudentPostApproval
            ? "공고를 등록했습니다."
            : "공고를 등록했습니다. 선생님 승인 후 게시됩니다.",
          "success",
        );
      }
      setPostModalOpen(false);
      setEditingPost(null);
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleSaveJobBoardSettings = async (nextSettings) => {
    if (!classId || !isTeacher) return;
    setBusyKey("job-board:settings");
    try {
      await updateDoc(doc(db, "classes", classId), {
        "settings.jobBoard": {
          ...DEFAULT_JOB_BOARD_SETTINGS,
          ...nextSettings,
        },
      });
      setSettingsModalOpen(false);
      showFeedback("구인 게시판 설정을 저장했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "설정을 저장하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleApply = async (applicationPayload) => {
    if (!classId || !applicationPost) return;
    const isEditingApplication = Boolean(editingApplication);
    setBusyKey(`apply:${applicationPost.id}`);
    try {
      await submitJobBoardApplication({
        classId,
        postId: applicationPost.id,
        application: applicationPayload,
      });
      showFeedback(
        isEditingApplication
          ? "지원서를 수정했습니다."
          : usesApplicationForm(applicationPost.selectionType)
            ? "지원서를 제출했습니다."
            : "참여했습니다.",
        "success",
      );
      closeApplicationForm();
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleSubmitWorkerRating = async () => {
    if (!classId || !ratingTarget) return;
    setBusyKey(`rate:${ratingTarget.applicationId}:${ratingTarget.targetUid}`);
    try {
      await submitJobBoardWorkerRating({
        classId,
        postId: ratingTarget.postId,
        applicationId: ratingTarget.applicationId,
        targetUid: ratingTarget.targetUid,
        rating: ratingValue,
        review: ratingReview,
      });
      showFeedback("평가를 저장했습니다.", "success");
      setRatingTarget(null);
      setRatingValue(5);
      setRatingReview("");
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  const openRatingModeration = (target) => {
    setEditingRating(target);
    setEditingRatingValue(Number(target?.rating || 5));
    setEditingRatingReview(target?.review || "");
    setRatingModerationNote(target?.moderationNote || "");
  };

  const handleModerateRating = async ({ target, action, rating, review, moderationNote }) => {
    if (!classId || !target) return;
    setBusyKey(`rating:${action}:${target.id}`);
    try {
      await moderateJobBoardRating({
        classId,
        ratingId: target.id,
        action,
        rating,
        review,
        moderationNote,
      });
      if (action === "update") {
        showFeedback("평점을 수정했습니다.", "success");
      } else if (action === "hide") {
        showFeedback("평점을 숨김 처리했습니다.", "success");
      } else if (action === "publish") {
        showFeedback("평점을 다시 공개했습니다.", "success");
      } else {
        showFeedback("평점을 삭제했습니다.", "success");
      }
      if (action === "update") {
        setEditingRating(null);
        setRatingModerationNote("");
      }
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleWithdraw = async (post) => {
    if (!classId || !post) return;
    if (!(await appConfirm("지원 내역을 취소할까요?"))) return;
    setBusyKey(`withdraw:${post.id}`);
    try {
      await withdrawJobBoardApplication({ classId, postId: post.id });
      showFeedback("지원 내역을 취소했습니다.", "success");
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleSaveStatus = async (post, nextStatus) => {
    const canManagePost = Boolean(isTeacher || post?.authorUid === userData?.uid);
    if (!classId || !post || !canManagePost || !isManualPostStatus(post.status)) return;
    setBusyKey("post:status");
    try {
      await updateJobBoardPost({
        classId,
        postId: post.id,
        updates: { status: nextStatus },
      });
      setEditingPost((currentPost) =>
        currentPost?.id === post.id ? { ...currentPost, status: nextStatus } : currentPost,
      );
      showFeedback("공고 상태를 변경했습니다.", "success");
    } catch (error) {
      showFeedback(error.message, "error");
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
      if (selectedPostId === post.id) {
        setApplicationsModalOpen(false);
        setSelectedPostId("");
      }
      showFeedback("구인 공고를 삭제했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "구인 공고를 삭제하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleModerateApprovalPosts = async (targetPosts, action) => {
    if (!classId || !isTeacher || !Array.isArray(targetPosts) || targetPosts.length === 0) return;
    setBusyKey(`post:approval:${action}`);
    try {
      for (const targetPost of targetPosts) {
        await moderateJobBoardPost({
          classId,
          postId: targetPost.id,
          action,
        });
      }
      showFeedback(
        action === "approve"
          ? "\uC120\uD0DD\uD55C \uACF5\uACE0\uB97C \uC2B9\uC778\uD588\uC2B5\uB2C8\uB2E4."
          : "\uC120\uD0DD\uD55C \uACF5\uACE0\uB97C \uBC18\uB824\uD588\uC2B5\uB2C8\uB2E4.",
        "success",
      );
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleSelectApplication = async (application) => {
    if (!classId || !selectedPost) return;
    setBusyKey(`select:${application.id}`);
    try {
      await reviewJobBoardApplication({
        classId,
        postId: selectedPost.id,
        applicationId: application.id,
        action: "select",
      });
      showFeedback("지원자를 선발했습니다.", "success");
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleRejectApplication = async () => {
    if (!classId || !selectedPost || !rejectTarget) return;
    setBusyKey(`reject:${rejectTarget.id}`);
    try {
      await reviewJobBoardApplication({
        classId,
        postId: selectedPost.id,
        applicationId: rejectTarget.id,
        action: "reject",
        rejectionReason,
      });
      showFeedback("지원자를 반려하고 사유를 저장했습니다.", "success");
      setRejectTarget(null);
      setRejectionReason("");
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  const handlePayReward = async () => {
    if (!classId || !selectedPost || !paymentTarget) return;
    setBusyKey(`pay:${paymentTarget.id}`);
    try {
      await payJobBoardReward({
        classId,
        postId: selectedPost.id,
        applicationId: paymentTarget.id,
        note: paymentNote,
      });
      showFeedback("보상 지급을 완료했습니다.", "success");
      setPaymentTarget(null);
      setPaymentNote("");
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  const toggleBulkPaymentTarget = (application, shouldSelect) => {
    if (!isApplicationPayable(application)) return;
    setBulkPaymentIds((currentIds) => {
      const nextSet = new Set(currentIds);
      const nextSelected = typeof shouldSelect === "boolean" ? shouldSelect : !nextSet.has(application.id);
      if (nextSelected) {
        nextSet.add(application.id);
      } else {
        nextSet.delete(application.id);
      }
      return Array.from(nextSet);
    });
  };

  const startBulkPaymentDrag = (application) => {
    if (!isApplicationPayable(application)) return;
    setIsBulkPaymentDragging(true);
    toggleBulkPaymentTarget(application);
  };

  const addBulkPaymentDragTarget = (application) => {
    if (!isBulkPaymentDragging || !isApplicationPayable(application)) return;
    toggleBulkPaymentTarget(application, true);
  };

  const toggleApplicationDetail = (application) => {
    if (!usesApplicationForm(application?.selectionType)) return;
    setExpandedApplicationIds((currentIds) => {
      const nextSet = new Set(currentIds);
      if (nextSet.has(application.id)) {
        nextSet.delete(application.id);
      } else {
        nextSet.add(application.id);
      }
      return Array.from(nextSet);
    });
  };

  const toggleAllApplicationDetails = () => {
    setExpandedApplicationIds(
      allDetailsExpanded ? [] : detailApplications.map((application) => application.id),
    );
  };

  const handleBulkPayRewards = async () => {
    if (!classId || !selectedPost || bulkPaymentTargets.length === 0) return;
    const count = bulkPaymentTargets.length;
    if (!(await appConfirm(`${count}명의 보상 지급 대상에게 보상을 일괄 지급할까요?`))) return;
    setBusyKey("pay:bulk");
    try {
      await Promise.all(
        bulkPaymentTargets.map((application) =>
          payJobBoardReward({
            classId,
            postId: selectedPost.id,
            applicationId: application.id,
            note: "",
          }),
        ),
      );
      showFeedback(`${count}명의 보상 지급을 완료했습니다.`, "success");
      setBulkPaymentIds([]);
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  if ((loading || isPostsLoading) && posts.length === 0 && Date.now() < 0) {
    return <PageLoader message="구인 게시판을 불러오는 중입니다..." />;
  }

  if ((loading || isPostsLoading) && posts.length === 0) {
    return (
      <AppLayout showSidebar showDefaultHeader={false}>
        <PageLoader
          fullHeight={false}
          className="min-h-screen"
          message="구인 게시판을 불러오는 중입니다..."
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
                학급 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
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
          title="구인 게시판"
          subtitle="할 수 있는 일을 찾아 도전하고, 내 지원을 확인해요."
          icon={BriefcaseBusiness}
          rightSlot={
            <JobBoardModeTabs
              active="recruit"
              onNavigate={(mode) => navigate(mode === "seeker" ? "/job-board/seeker" : "/job-board")}
            />
          }
        />

        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <a href="#job-board-inbox" className="rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 underline underline-offset-4 lg:hidden">내 지원 바로 보기</a>
            {isTeacher ? (
              <Button
                kind="outline"
                tone={pendingApprovalPosts.length > 0 ? "blue" : "slate"}
                icon={ClipboardCheck}
                onClick={() => setApprovalModalOpen(true)}
              >
                승인 관리
                {pendingApprovalPosts.length > 0 ? ` ${pendingApprovalPosts.length}` : ""}
              </Button>
            ) : null}
            {isTeacher ? (
              <Button
                kind="outline"
                tone="slate"
                icon={Settings2}
                onClick={() => setSettingsModalOpen(true)}
              >
                게시판 설정
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {canCreatePosts ? (
              <Button
                tone="blue"
                icon={Plus}
                onClick={() => {
                  setEditingPost(null);
                  setPostModalOpen(true);
                }}
              >
                공고 쓰기
              </Button>
            ) : null}
            <Button kind="outline" tone="slate" onClick={() => navigate("/job-board/me?tab=posts")}>내 공고 관리</Button>
          </div>
        </div>

        <div className="space-y-6">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
          <JobRecruitDiscoveryList
            clockNow={clockNow} currencyUnit={currencyUnit} loading={isPostsLoading}
            error={postsError} onRetry={retryPosts} isTeacher={isTeacher}
            myApplicationsByPostId={myApplicationsByPostId} searchTerm={searchTerm}
            onOpen={post => {setSelectedPostId(post.id); setDetailOpen(true);}}
            onEdit={post => {setEditingPost(post); setPostModalOpen(true);}}
            onDeletePost={handleDeletePost} setSearchTerm={setSearchTerm}
            setStatusFilter={setStatusFilter} statusFilter={statusFilter}
            userUid={userData?.uid} visiblePosts={visiblePosts}
          />
          <JobBoardInbox rows={myApplications} currencyUnit={currencyUnit}
            loading={applicationsLoading} error={applicationsError} onRetry={retryApplications}
            onOpen={application => navigate('/job-board/me?tab=applications&applicationId=' + encodeURIComponent(application.id))}
            onManage={() => navigate('/job-board/me?tab=applications')}
            onOwn={() => navigate('/job-board/me?tab=posts')}
          />
        </div>
        <JobPostDetailModal
          post={detailOpen ? selectedPost : null} onClose={() => setDetailOpen(false)}
          busyKey={busyKey} canApply={canApplySelectedPost} clockNow={clockNow}
          currencyUnit={currencyUnit} isOwnApplicant={isOwnApplicant}
          isOwnPostAuthor={isOwnPostAuthor} isTeacher={isTeacher} ownApplication={ownApplication}
          onApply={openApplicationForm} onEditApplication={openApplicationForm} onWithdraw={handleWithdraw}
        />

          {isTeacher && (jobBoardSettings.enableRatings || ratings.length > 0) ? (
            <Card title="후기 관리" icon={MessageSquareWarning} variant="surface" >
              <Card.Content noPadding className="gap-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_220px]">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">후기 검색</label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        className={`${inputClassName} pl-11`}
                        value={ratingSearchTerm}
                        onChange={(event) => setRatingSearchTerm(event.target.value)}
                        placeholder="후기 내용, 공고, 작성자 이름으로 검색"
                      />
                    </div>
                  </div>
                  <SelectBox
                    label="후기 상태"
                    value={ratingStatusFilter}
                    onChange={(event) => setRatingStatusFilter(event.target.value)}
                    options={[
                      { value: "all", label: "전체 후기" },
                      { value: "published", label: "게시됨" },
                      { value: "hidden", label: "숨김" },
                      { value: "deleted", label: "삭제" },
                    ]}
                  />
                </div>

                {visibleRatings.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center text-sm font-semibold text-slate-500">
                    표시할 평점이 없습니다.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {visibleRatings.map((rating) => (
                      <RatingManagementCard
                        key={rating.id}
                        rating={rating}
                        busyKey={busyKey}
                        onEdit={openRatingModeration}
                        onHide={async (target) => {
                          if (!(await appConfirm("이 평점을 숨김 처리할까요?"))) return;
                          handleModerateRating({ target, action: "hide" });
                        }}
                        onPublish={(target) => {
                          handleModerateRating({ target, action: "publish" });
                        }}
                        onDelete={async (target) => {
                          if (!(await appConfirm("이 평점을 삭제할까요?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;
                          handleModerateRating({ target, action: "delete" });
                        }}
                      />
                    ))}
                  </div>
                )}
              </Card.Content>
            </Card>
          ) : null}

          <JobApplicationsModal
            isOpen={applicationsModalOpen}
            onClose={() => setApplicationsModalOpen(false)}
            selectedPost={selectedPost}
            isTeacher={isTeacher}
            canManageSelectedWorkerRatings={canManageSelectedWorkerRatings}
            isApplicationsLoading={isApplicationsLoading}
            filteredApplications={filteredApplications}
            payableApplications={payableApplications}
            detailApplications={detailApplications}
            bulkPaymentTargets={bulkPaymentTargets}
            bulkPaymentIds={bulkPaymentIds}
            expandedApplicationIds={expandedApplicationIds}
            allDetailsExpanded={allDetailsExpanded}
            busyKey={busyKey}
            reviewFilter={reviewFilter}
            setReviewFilter={setReviewFilter}
            setBulkPaymentIds={setBulkPaymentIds}
            onBulkPayRewards={handleBulkPayRewards}
            onToggleAllDetails={toggleAllApplicationDetails}
            onBulkDragStart={startBulkPaymentDrag}
            onBulkDragEnter={addBulkPaymentDragTarget}
            onToggleDetail={toggleApplicationDetail}
            onSelectApplication={handleSelectApplication}
            onRejectApplication={(target) => {
              setRejectTarget(target);
              setRejectionReason(target.rejectionReason || "");
            }}
            selectedPostRateTargets={selectedPostRateTargets}
            onRateWorker={(target) => {
              setRatingTarget(target);
              setRatingValue(5);
              setRatingReview("");
            }}
          />

        </div>

        <JobPostApprovalModal
          isOpen={approvalModalOpen}
          onClose={() => {
            if (busyKey?.startsWith("post:approval:")) return;
            setApprovalModalOpen(false);
          }}
          posts={pendingApprovalPosts}
          currencyUnit={currencyUnit}
          busyKey={busyKey}
          onModerate={handleModerateApprovalPosts}
          onOpenPost={(targetPost) => {
            setSelectedPostId(targetPost.id);
            setApprovalModalOpen(false);
          }}
        />

        <JobBoardSettingsModal
          isOpen={settingsModalOpen}
          onClose={() => {
            if (busyKey === "job-board:settings") return;
            setSettingsModalOpen(false);
          }}
          settings={jobBoardSettings}
          onSubmit={handleSaveJobBoardSettings}
          isSubmitting={busyKey === "job-board:settings"}
        />

        <JobPostModal
          isOpen={postModalOpen}
          onClose={() => {
            if (busyKey === "post:create" || busyKey === "post:update") return;
            setPostModalOpen(false);
            setEditingPost(null);
          }}
          initialPost={editingPost}
          onOpenApplications={
            editingPost && (isTeacher || editingPost.authorUid === userData?.uid)
              ? () => {
                  setSelectedPostId(editingPost.id);
                  setPostModalOpen(false);
                  setEditingPost(null);
                  setApplicationsModalOpen(true);
                }
              : undefined
          }
          onSubmit={handleSavePost}
          onToggleStatus={(nextStatus) => handleSaveStatus(editingPost, nextStatus)}
          canUseStatusControl={Boolean(
            editingPost &&
              (isTeacher || editingPost.authorUid === userData?.uid) &&
              isManualPostStatus(editingPost.status),
          )}
          isStatusUpdating={busyKey === "post:status"}
          isSubmitting={busyKey === "post:create" || busyKey === "post:update"}
          currencyUnit={currencyUnit}
          postStatus={normalizePostStatusValue(editingPost?.status)}
          submitLabel={
            isTeacher
              ? editingPost
                ? "공고 저장"
                : "공고 등록"
              : editingPost
                ? "의뢰 수정"
                : "의뢰 등록"
          }
        />

        <ApplyModal
          isOpen={Boolean(applicationPost)}
          onClose={() => {
            if (applicationPost && busyKey === `apply:${applicationPost.id}`) return;
            closeApplicationForm();
          }}
          post={applicationPost}
          students={students}
          currentUser={userData}
          initialApplication={editingApplication}
          onSubmit={handleApply}
          isSubmitting={Boolean(applicationPost) && busyKey === `apply:${applicationPost?.id}`}
        />

        <RatingModerationModal
          isOpen={Boolean(editingRating)}
          onClose={() => {
            if (editingRating && busyKey === `rating:update:${editingRating.id}`) return;
            setEditingRating(null);
            setEditingRatingValue(5);
            setEditingRatingReview("");
            setRatingModerationNote("");
          }}
          ratingTarget={editingRating}
          ratingValue={editingRatingValue}
          reviewText={editingRatingReview}
          moderationNote={ratingModerationNote}
          onChangeValue={setEditingRatingValue}
          onChangeReview={setEditingRatingReview}
          onChangeModerationNote={setRatingModerationNote}
          onSubmit={() =>
            handleModerateRating({
              target: editingRating,
              action: "update",
              rating: editingRatingValue,
              review: editingRatingReview,
              moderationNote: ratingModerationNote,
            })
          }
          isSubmitting={Boolean(editingRating) && busyKey === `rating:update:${editingRating?.id}`}
        />

        <RatingModal
          isOpen={Boolean(ratingTarget)}
          onClose={() => {
            if (
              ratingTarget &&
              busyKey === `rate:${ratingTarget.applicationId}:${ratingTarget.targetUid}`
            ) {
              return;
            }
            setRatingTarget(null);
            setRatingValue(5);
            setRatingReview("");
          }}
          target={ratingTarget}
          value={ratingValue}
          review={ratingReview}
          onChangeValue={setRatingValue}
          onChangeReview={setRatingReview}
          onSubmit={handleSubmitWorkerRating}
          isSubmitting={
            Boolean(ratingTarget) &&
            busyKey === `rate:${ratingTarget?.applicationId}:${ratingTarget?.targetUid}`
          }
        />

        <TextPromptModal
          isOpen={Boolean(rejectTarget)}
          onClose={() => {
            if (rejectTarget && busyKey === `reject:${rejectTarget.id}`) return;
            setRejectTarget(null);
            setRejectionReason("");
          }}
          title="지원 반려"
          description="지원자를 반려하는 이유를 입력해 주세요."
          value={rejectionReason}
          onChange={setRejectionReason}
          onSubmit={handleRejectApplication}
          submitLabel="반려"
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
          description="완료 여부를 확인하고 보상을 지급합니다."
          value={paymentNote}
          onChange={setPaymentNote}
          onSubmit={handlePayReward}
          submitLabel="지급"
          isSubmitting={Boolean(paymentTarget) && busyKey === `pay:${paymentTarget?.id}`}
        />
      </div>
    </AppLayout>
  );
}
