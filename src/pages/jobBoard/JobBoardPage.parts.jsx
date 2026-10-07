import { appAlert } from "../../utils/appDialogs";
import { useNumberFormat as useConfiguredMoney } from "../../contexts/NumberFormatContext";
import {
  useEffect,
  useState,
} from "react";
import {
  EyeOff,
  FileText,
  Pencil,
  Plus,
  Send,
  Settings2,
  Star,
  Trash2,
  UserCheck2,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  Modal,
  Textarea,
  ToggleSwitch,
} from "../../components/ui";

const POST_STATUS_META = {
  pending_approval: { label: "승인 대기", tone: "amber" },
  draft: { label: "작성 중", tone: "slate" },
  recruiting: { label: "모집 중", tone: "indigo" },
  closed: { label: "모집 마감", tone: "emerald" },
  rejected: { label: "반려", tone: "rose" },
  cancelled: { label: "취소", tone: "rose" },
};
POST_STATUS_META.deadline_closed = { label: "기간 마감", tone: "slate" };
const MANUAL_POST_STATUS_VALUES = ["recruiting", "closed"];
const POST_MODERATION_STATUS_VALUES = ["pending_approval", "rejected"];

const APPLICATION_STATUS_META = {
  applied: { label: "지원 완료", tone: "indigo" },
  selected: { label: "선발", tone: "sky" },
  submitted: { label: "제출 완료", tone: "violet" },
  approved: { label: "승인 완료", tone: "emerald" },
  paid: { label: "지급 완료", tone: "green" },
  rejected: { label: "반려", tone: "rose" },
  withdrawn: { label: "지원 취소", tone: "slate" },
};

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "전체 상태" },
  { value: "pending_approval", label: "승인 대기" },
  { value: "draft", label: "작성 중" },
  { value: "recruiting", label: "모집 중" },
  { value: "closed", label: "모집 마감" },
  { value: "rejected", label: "반려" },
  { value: "cancelled", label: "취소" },
];

const DEFAULT_JOB_BOARD_SETTINGS = {
  allowStudentPosts: false,
  requireStudentPostApproval: true,
  enableRatings: false,
};

const RATING_STATUS_META = {
  published: { label: "노출 중", tone: "emerald" },
  hidden: { label: "숨김", tone: "amber" },
  deleted: { label: "삭제", tone: "rose" },
};

const TARGET_FILTER_OPTIONS = [
  { value: "all", label: "전체 모집" },
  { value: "single", label: "1명 모집" },
  { value: "multiple", label: "여러 명 모집" },
];

const SELECTION_FILTER_OPTIONS = [
  { value: "all", label: "전체 모집 방식" },
  { value: "first_come", label: "선착순" },
  { value: "application", label: "선발 · 지원서 있음" },
  { value: "simple", label: "선발 · 지원서 없음" },
];

const REVIEW_FILTER_OPTIONS = [
  { value: "all", label: "전체 지원" },
  { value: "review", label: "검토 필요" },
  { value: "selected", label: "선발됨" },
  { value: "rejected", label: "반려/취소" },
  { value: "paid", label: "지급 완료" },
];

const POST_STATUS_OPTIONS = MANUAL_POST_STATUS_VALUES.map((value) => ({
  value,
  label: POST_STATUS_META[value]?.label || value,
}));

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50";
const selectClassName = inputClassName;

const normalizePostStatusValue = (status) => {
  const normalized = String(status || "").trim();
  return ["reviewing", "selected", "in_progress", "submitted", "approved", "paid"].includes(
    normalized,
  )
    ? "closed"
    : normalized;
};

const normalizeSelectionTypeValue = (selectionType) => {
  const normalized = String(selectionType || "").trim();
  return normalized || "application";
};

const isFirstComeSelection = (selectionType) =>
  normalizeSelectionTypeValue(selectionType) === "first_come";

const usesApplicationForm = (selectionType) =>
  normalizeSelectionTypeValue(selectionType) === "application";

const getSelectionTypeLabel = (selectionType) => {
  const normalized = normalizeSelectionTypeValue(selectionType);
  if (normalized === "first_come") return "선착순";
  return normalized === "application" ? "선발 · 지원서 있음" : "선발 · 지원서 없음";
};

const getApplyActionLabel = (selectionType) => {
  if (isFirstComeSelection(selectionType)) return "선착순 참여";
  return usesApplicationForm(selectionType) ? "지원서 제출" : "지원하기";
};

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const formatDateTime = (value) => {
  const time = toMillis(value);
  if (!time) return "-";
  return new Date(time).toLocaleString("ko-KR");
};

const formatDeadlineCountdown = (value, now = Date.now()) => {
  const time = toMillis(value);
  if (!time) return "상시";
  const diff = time - now;
  if (diff <= 0) return "마감됨";

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (number) => String(number).padStart(2, "0");
  const timer = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days ? `${days}일 ${timer}` : timer;
};

const formatPostRemainingTime = (post, now = Date.now()) => {
  if (!post) return "-";
  const status = normalizePostStatusValue(post.status);
  if (status !== "recruiting") return POST_STATUS_META[status]?.label || "모집 마감";
  if (Number(post.availableSlots || 0) <= 0) return "모집 완료";
  return formatDeadlineCountdown(post.applyDeadlineAt, now);
};

const formatDateInput = (value) => {
  const time = toMillis(value);
  if (!time) return "";
  const date = new Date(time);
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
};

const toIsoFromLocalInput = (value) => {
  const parsed = new Date(String(value || "").trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const formatReward = (amount, unit) =>
  `${Number(amount || 0).toLocaleString()}${unit}`;

const normalizeRewardModeValue = (rewardMode) => {
  const normalized = String(rewardMode || "per_person").trim();
  return normalized === "team_equal" ? "split_equal" : normalized || "per_person";
};

const getRewardModeForSlots = (slots) =>
  (Number.parseInt(slots, 10) || 1) > 1 ? "split_equal" : "per_person";

const getRewardModeLabel = (rewardMode) =>
  normalizeRewardModeValue(rewardMode) === "split_equal" ? "총액 균등분배" : "1인당 지급";

const getStatusMeta = (status, metaMap, fallbackTone = "slate") =>
  metaMap[status] || { label: status || "-", tone: fallbackTone };

const isApplicationPayable = (application) =>
  ["selected", "submitted", "approved"].includes(application?.status);

const getPostStatusMeta = (status) =>
  getStatusMeta(normalizePostStatusValue(status), POST_STATUS_META);

const isDeadlineClosed = (value) => {
  const time = toMillis(value);
  return Boolean(time) && time <= Date.now();
};

const getDisplayPostStatusValue = (post, now = Date.now()) => {
  const status = normalizePostStatusValue(post?.status);
  if (status === "recruiting") {
    const deadlineTime = toMillis(post?.applyDeadlineAt);
    if (deadlineTime && deadlineTime <= now) return "deadline_closed";
  }
  return status;
};

const getDisplayPostStatusMeta = (post, now = Date.now()) =>
  getStatusMeta(getDisplayPostStatusValue(post, now), POST_STATUS_META);

const isPostRecruiting = (post) =>
  normalizePostStatusValue(post?.status) === "recruiting" && !isDeadlineClosed(post?.applyDeadlineAt);

const canReapplyFromStatus = (status) =>
  ["rejected", "withdrawn"].includes(String(status || ""));

const isPrivatePostStatus = (status) =>
  ["draft", "pending_approval", "rejected", "cancelled"].includes(
    normalizePostStatusValue(status),
  );

const isManualPostStatus = (status) =>
  MANUAL_POST_STATUS_VALUES.includes(normalizePostStatusValue(status));

const isPostModerationStatus = (status) =>
  POST_MODERATION_STATUS_VALUES.includes(normalizePostStatusValue(status));

const getAuthorRoleLabel = (post) =>
  post?.authorRole === "student" ? "학생 의뢰" : "교사 의뢰";

const getAuthorTone = (post) => (post?.authorRole === "student" ? "emerald" : "indigo");

const formatRatingSummary = (profile) => {
  const average = Number(profile?.requesterRatingAverage || 0);
  const count = Number(profile?.requesterRatingCount || 0);
  if (!count) return "평가 없음";
  return `${average.toFixed(1)}점 · ${count}개`;
};

const formatRatingValue = (value) => `${Number(value || 0).toFixed(0)}점`;

const getApplicationRatingTargets = (application) => {
  const memberUids =
    Array.isArray(application?.memberUids) && application.memberUids.length
      ? application.memberUids
      : [application?.applicantUid].filter(Boolean);
  const memberNames =
    Array.isArray(application?.memberNames) && application.memberNames.length
      ? application.memberNames
      : [application?.applicantName].filter(Boolean);

  return memberUids.map((uid, index) => ({
    uid,
    name: memberNames[index] || application?.applicantName || "학생",
  }));
};

const matchesStatusFilter = (post, statusFilter) => {
  const status = getDisplayPostStatusValue(post);
  if (statusFilter === "all") return !["closed", "cancelled", "rejected"].includes(status);
  if (statusFilter === "closed") return status === "deadline_closed";
  return status === statusFilter;
};

const buildPostSearchBlob = (post) =>
  [
    post?.title,
    post?.description,
    post?.authorName,
    post?.teacherName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const SelectBox = ({ label, value, onChange, options }) => (
  <div className="space-y-2">
    {label ? <label className="text-sm font-bold text-slate-700">{label}</label> : null}
    <select className={selectClassName} value={value} onChange={onChange}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);

const InfoTile = ({ label, value, subValue }) => (
  <div className="rounded-2xl bg-slate-50 px-4 py-3">
    <p className="text-xs font-black text-slate-400">{label}</p>
    <p className="mt-1 text-sm font-semibold text-slate-700">{value || "-"}</p>
    {subValue ? <p className="mt-1 text-[11px] font-semibold text-slate-400">{subValue}</p> : null}
  </div>
);

const TextPromptModal = ({
  isOpen,
  onClose,
  title,
  description,
  value,
  onChange,
  onSubmit,
  submitLabel,
  isSubmitting,
}) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
    <div className="space-y-4">
      {description ? (
        <p className="text-sm leading-6 text-slate-500">{description}</p>
      ) : null}
      <Textarea
        rows={5}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-2xl border-slate-200 px-4 py-3"
      />
      <div className="flex justify-end gap-2">
        <Button kind="outline" tone="slate" onClick={onClose}>
          닫기
        </Button>
        <Button tone="blue" onClick={onSubmit} isLoading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </div>
  </Modal>
);

const JobBoardSettingsModal = ({
  isOpen,
  onClose,
  settings,
  onSubmit,
  isSubmitting,
}) => {
  const [form, setForm] = useState(DEFAULT_JOB_BOARD_SETTINGS);

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      ...DEFAULT_JOB_BOARD_SETTINGS,
      ...(settings || {}),
    });
  }, [isOpen, settings]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="의뢰 게시판 설정" size="md">
      <div className="space-y-5">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          교사가 학생 공고 허용 여부와 평점 기능을 직접 켜고 끌 수 있습니다.
        </div>

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <div>
              <p className="text-sm font-black text-slate-900">학생 공고 허용</p>
              <p className="mt-1 text-sm text-slate-500">
                학생도 의뢰 공고를 작성할 수 있습니다.
              </p>
            </div>
            <ToggleSwitch
              checked={form.allowStudentPosts}
              onChange={(checked) =>
                setForm((current) => ({ ...current, allowStudentPosts: checked }))
              }
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <div>
              <p className="text-sm font-black text-slate-900">학생 공고 승인 필요</p>
              <p className="mt-1 text-sm text-slate-500">
                학생이 올린 공고를 공개하기 전에 교사 승인을 거치게 합니다.
              </p>
            </div>
            <ToggleSwitch
              checked={form.requireStudentPostApproval}
              disabled={!form.allowStudentPosts}
              onChange={(checked) =>
                setForm((current) => ({
                  ...current,
                  requireStudentPostApproval: checked,
                }))
              }
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <div>
              <p className="text-sm font-black text-slate-900">작업자 후기 기능</p>
              <p className="mt-1 text-sm text-slate-500">
                일이 끝나면 일을 맡긴 사람이 별점과 한줄 후기를 남길 수 있어요.
              </p>
            </div>
            <ToggleSwitch
              checked={form.enableRatings}
              onChange={(checked) =>
                setForm((current) => ({ ...current, enableRatings: checked }))
              }
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button kind="outline" tone="slate" onClick={onClose}>
            닫기
          </Button>
          <Button
            tone="blue"
            icon={Settings2}
            onClick={() => onSubmit(form)}
            isLoading={isSubmitting}
          >
            설정 저장
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const RatingModal = ({
  isOpen,
  onClose,
  target,
  value,
  review,
  onChangeValue,
  onChangeReview,
  onSubmit,
  isSubmitting,
}) => (
  <Modal isOpen={isOpen} onClose={onClose} title="후기 남기기" size="md">
    <div className="space-y-5">
      <div className="rounded-3xl border border-amber-100 bg-amber-50/80 p-4">
        <p className="text-sm font-black text-slate-900">{target?.postTitle || "의뢰 공고"}</p>
        <p className="mt-1 text-sm text-slate-600">
          작업자 {target?.targetName || "학생"}을 1점부터 5점까지 평가해 주세요.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-bold text-slate-700">별점</label>
        <div className="grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((score) => (
            <Button
              key={score}
              type="button"
              onClick={() => onChangeValue(score)}
              className={`rounded-2xl border px-3 py-3 text-sm font-black transition ${
                value === score
                  ? "border-amber-300 bg-amber-100 text-amber-700"
                  : "border-slate-200 bg-white text-slate-500 hover:border-amber-200"
              }`}
            >
              <div className="flex items-center justify-center gap-1">
                <Star className="h-4 w-4" />
                {score}
              </div>
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-bold text-slate-700">한줄 후기</label>
        <Textarea
          rows={4}
          value={review}
          onChange={(event) => onChangeReview(event.target.value)}
          className="rounded-2xl border-slate-200 px-4 py-3"
          placeholder="예: 설명이 명확했고 작업 확인이 빨랐어요."
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button kind="outline" tone="slate" onClick={onClose}>
          닫기
        </Button>
        <Button
          tone="blue"
          icon={Star}
          onClick={onSubmit}
          isLoading={isSubmitting}
        >
          평가 등록
        </Button>
      </div>
    </div>
  </Modal>
);

const RatingModerationModal = ({
  isOpen,
  onClose,
  ratingTarget,
  ratingValue,
  reviewText,
  moderationNote,
  onChangeValue,
  onChangeReview,
  onChangeModerationNote,
  onSubmit,
  isSubmitting,
}) => (
  <Modal isOpen={isOpen} onClose={onClose} title="평점 수정" size="md">
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-black text-slate-900">{ratingTarget?.postTitle || "의뢰 공고"}</p>
        <p className="mt-1 text-sm text-slate-500">
          {ratingTarget?.targetName || "학생"}에게 남겨진 평점과 후기를 교사가 수정합니다.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-bold text-slate-700">별점</label>
        <div className="grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((score) => (
            <Button
              key={score}
              type="button"
              onClick={() => onChangeValue(score)}
              className={`rounded-2xl border px-3 py-3 text-sm font-black transition ${
                ratingValue === score
                  ? "border-indigo-300 bg-indigo-100 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-500 hover:border-indigo-200"
              }`}
            >
              {score}점
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-bold text-slate-700">후기 내용</label>
        <Textarea
          rows={4}
          value={reviewText}
          onChange={(event) => onChangeReview(event.target.value)}
          className="rounded-2xl border-slate-200 px-4 py-3"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-bold text-slate-700">관리 메모</label>
        <Textarea
          rows={3}
          value={moderationNote}
          onChange={(event) => onChangeModerationNote(event.target.value)}
          className="rounded-2xl border-slate-200 px-4 py-3"
          placeholder="예: 감정적인 표현을 교실 규칙에 맞게 수정"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button kind="outline" tone="slate" onClick={onClose}>
          닫기
        </Button>
        <Button tone="blue" icon={Pencil} onClick={onSubmit} isLoading={isSubmitting}>
          수정 저장
        </Button>
      </div>
    </div>
  </Modal>
);

const RatingManagementCard = ({
  rating,
  busyKey,
  onEdit,
  onHide,
  onPublish,
  onDelete,
}) => {
  const statusMeta = getStatusMeta(rating.status, RATING_STATUS_META);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-black text-slate-900">{rating.targetName || "평점 대상"}</p>
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
            <Badge tone="amber">{formatRatingValue(rating.rating)}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            공고 {rating.postTitle || "-"} · 작성자 {rating.raterName || "-"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            kind="outline"
            tone="slate"
            icon={Pencil}
            onClick={() => onEdit(rating)}
            isLoading={busyKey === `rating:update:${rating.id}`}
          >
            수정
          </Button>
          {rating.status === "published" ? (
            <Button
              size="sm"
              kind="outline"
              tone="slate"
              icon={EyeOff}
              onClick={() => onHide(rating)}
              isLoading={busyKey === `rating:hide:${rating.id}`}
            >
              숨김
            </Button>
          ) : (
            <Button
              size="sm"
              kind="outline"
              tone="emerald"
              onClick={() => onPublish(rating)}
              isLoading={busyKey === `rating:publish:${rating.id}`}
            >
              복구
            </Button>
          )}
          <Button
            size="sm"
            kind="outline"
            tone="red"
            icon={Trash2}
            onClick={() => onDelete(rating)}
            isLoading={busyKey === `rating:delete:${rating.id}`}
          >
            삭제
          </Button>
        </div>
      </div>

      {rating.review ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {rating.review}
        </div>
      ) : null}

      {rating.moderationNote ? (
        <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          관리 메모: {rating.moderationNote}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone="slate">대상 역할 {rating.targetRole === "student" ? "학생" : "교사"}</Badge>
        <Badge tone="slate">
          수정 시각 {formatDateTime(rating.moderatedAt || rating.updatedAt || rating.createdAt)}
        </Badge>
      </div>
    </div>
  );
};

const WorkerRatingActionCard = ({ target, onRate, busyKey }) => {
  const existingRating = target.existingRating;
  const statusMeta = existingRating
    ? getStatusMeta(existingRating.status, RATING_STATUS_META)
    : null;
  const applicationStatusMeta = getStatusMeta(
    target.applicationStatus,
    APPLICATION_STATUS_META,
  );

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-black text-slate-900">{target.targetName}</p>
            {target.applicantType === "team" ? (
              <Badge tone="sky">{target.teamName || target.applicantName}</Badge>
            ) : null}
            <Badge tone="slate">{applicationStatusMeta.label}</Badge>
            {target.profile ? (
              <Badge tone="amber">누적 {formatRatingSummary(target.profile)}</Badge>
            ) : null}
            {statusMeta ? <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            대표 지원자 {target.applicantName || "-"}
          </p>
        </div>

        {existingRating ? (
          <Badge tone="amber">{formatRatingValue(existingRating.rating)}</Badge>
        ) : (
          <Button
            size="sm"
            tone="amber"
            icon={Star}
            onClick={() => onRate(target)}
            isLoading={busyKey === `rate:${target.applicationId}:${target.targetUid}`}
          >
            후기 남기기
          </Button>
        )}
      </div>

      {existingRating?.review ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {existingRating.review}
        </div>
      ) : null}

      {existingRating?.moderationNote ? (
        <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          관리 메모: {existingRating.moderationNote}
        </div>
      ) : null}
    </div>
  );
};

const JobPostModal = ({
  isOpen,
  onClose,
  initialPost,
  onOpenApplications,
  onSubmit,
  onToggleStatus,
  canUseStatusControl = false,
  isStatusUpdating = false,
  isSubmitting,
  currencyUnit,
  postStatus,
  submitLabel = "",
}) => {
  const [form, setForm] = useState({
    title: "",
    description: "",
    targetType: "individual",
    selectionType: "application",
    slots: "1",
    rewardAmount: "0",
    applyDeadlineAt: "",
  });

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      title: initialPost?.title || "",
      description: initialPost?.description || "",
      targetType: "individual",
      selectionType: normalizeSelectionTypeValue(initialPost?.selectionType),
      slots: String(initialPost?.slots || 1),
      rewardAmount: String(initialPost?.rewardAmount || 0),
      applyDeadlineAt: formatDateInput(initialPost?.applyDeadlineAt),
    });
  }, [initialPost, isOpen]);

  const setField = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = () => {
    if (!form.title.trim()) return appAlert("공고 제목을 입력해 주세요.");
    if (!form.description.trim()) return appAlert("공고 설명을 입력해 주세요.");
    const normalizedSlots = Math.max(1, Number.parseInt(form.slots, 10) || 1);
    const rewardMode = getRewardModeForSlots(normalizedSlots);
    onSubmit({
      title: form.title.trim(),
      description: form.description.trim(),
      targetType: "individual",
      selectionType: normalizeSelectionTypeValue(form.selectionType),
      slots: normalizedSlots,
      rewardAmount: Number(form.rewardAmount || 0),
      rewardMode,
      applyDeadlineAt: form.applyDeadlineAt ? toIsoFromLocalInput(form.applyDeadlineAt) : null,
    });
  };

  const previewSlots = Math.max(1, Number.parseInt(form.slots, 10) || 1);
  const automaticRewardMode = getRewardModeForSlots(previewSlots);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialPost ? "공고 수정" : "새 의뢰 공고"}
      size="lg"
    >
      <div className="space-y-5">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">공고 제목</label>
            <input
              className={inputClassName}
              value={form.title}
              onChange={(event) => setField("title", event.target.value)}
              placeholder="예: 국세청 안내 포스터 제작"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">의뢰 내용</label>
            <Textarea
              rows={5}
              className="rounded-2xl border-slate-200 px-4 py-3"
              value={form.description}
              onChange={(event) => setField("description", event.target.value)}
              placeholder="학생들이 어떤 결과물을 만들어야 하는지 자세히 적어 주세요."
            />
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-sm font-black text-slate-900">모집 조건</p>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">모집 인원</label>
                <input
                  type="number"
                  min="1"
                  className={inputClassName}
                  value={form.slots}
                  onChange={(event) => setField("slots", event.target.value)}
                />
              </div>

              <SelectBox
                label="모집 방식"
                value={form.selectionType}
                onChange={(event) => setField("selectionType", event.target.value)}
                options={[
                  { value: "first_come", label: "선착순" },
                  { value: "application", label: "선발 · 지원서 있음" },
                  { value: "simple", label: "선발 · 지원서 없음" },
                ]}
              />

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">지원 마감 (선택)</label>
                <input
                  type="datetime-local"
                  className={inputClassName}
                  value={form.applyDeadlineAt}
                  onChange={(event) => setField("applyDeadlineAt", event.target.value)}
                />
                <p className="text-xs font-semibold leading-5 text-slate-400">
                  비워두면 상시 모집으로 표시됩니다.
                </p>
              </div>
            </div>
            <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-600">
              {isFirstComeSelection(form.selectionType)
                ? "먼저 지원한 학생부터 모집 인원만큼 자동 선발됩니다."
                : usesApplicationForm(form.selectionType)
                  ? "지원서를 받은 뒤 의뢰자가 직접 선발합니다."
                  : "지원 의사만 받은 뒤 의뢰자가 직접 선발합니다."}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-black text-slate-900">보상</p>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">
                  {automaticRewardMode === "split_equal" ? "총 보상 금액" : "1인 보상 금액"}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    className={`${inputClassName} pr-20`}
                    value={form.rewardAmount}
                    onChange={(event) => setField("rewardAmount", event.target.value)}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-slate-400">
                    {currencyUnit}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">지급 방식</label>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700">
                  {getRewardModeLabel(automaticRewardMode)}
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
              {automaticRewardMode === "split_equal"
                ? `${previewSlots}명을 모집하므로 입력한 총액을 선발 인원에게 균등하게 나눠 지급합니다.`
                : "1명을 모집하므로 선발된 학생에게 입력한 금액을 그대로 지급합니다."}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {initialPost && onOpenApplications ? (
            <div className="flex flex-wrap gap-2">
              <Button kind="outline" tone="blue" onClick={onOpenApplications}>
                지원자 관리
              </Button>
              {canUseStatusControl ? (
                <Button
                  kind="outline"
                  tone="slate"
                  onClick={() => onToggleStatus(postStatus === "recruiting" ? "closed" : "recruiting")}
                  isLoading={isStatusUpdating}
                >
                  {postStatus === "recruiting" ? "모집 마감" : "모집 재개"}
                </Button>
              ) : null}
            </div>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button kind="outline" tone="slate" onClick={onClose}>
              닫기
            </Button>
            <Button tone="blue" icon={Plus} onClick={handleSubmit} isLoading={isSubmitting}>
              {submitLabel || (initialPost ? "공고 저장" : "공고 만들기")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

const ApplyModal = ({
  isOpen,
  onClose,
  post,
  students,
  currentUser,
  initialApplication = null,
  onSubmit,
  isSubmitting,
}) => {
  const [teamName, setTeamName] = useState("");
  const [memberUids, setMemberUids] = useState([]);
  const [roleSummary, setRoleSummary] = useState("");
  const [motivation, setMotivation] = useState("");
  const [experience, setExperience] = useState("");
  const [plan, setPlan] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setTeamName(initialApplication?.teamName || "");
    setMemberUids(
      (initialApplication?.memberUids || []).filter((uid) => uid !== currentUser?.uid),
    );
    setRoleSummary(initialApplication?.roleSummary || "");
    setMotivation(initialApplication?.motivation || "");
    setExperience(initialApplication?.experience || "");
    setPlan(initialApplication?.plan || "");
  }, [currentUser?.uid, initialApplication, isOpen, post?.id]);

  if (!post) return null;

  const isTeamPost = false;
  const isFirstComePost = isFirstComeSelection(post.selectionType);
  const needsLongForm = usesApplicationForm(post.selectionType);
  const isEditingApplication = Boolean(initialApplication);
  const submitLabel = isEditingApplication
    ? needsLongForm
      ? "지원서 수정"
      : "지원 수정"
    : getApplyActionLabel(post.selectionType);
  const teamCandidates = (students || []).filter((student) => student.uid !== currentUser?.uid);

  const toggleMember = (uid) =>
    setMemberUids((current) =>
      current.includes(uid)
        ? current.filter((entry) => entry !== uid)
        : [...current, uid],
    );

  const handleSubmit = () => {
    if (isTeamPost && !teamName.trim()) return appAlert("팀 이름을 입력해 주세요.");
    if (isTeamPost && memberUids.length < 1) {
      return appAlert("함께 참여할 팀원을 한 명 이상 선택해 주세요.");
    }
    onSubmit({
      teamName: teamName.trim(),
      memberUids,
      roleSummary: roleSummary.trim(),
      motivation: motivation.trim(),
      experience: experience.trim(),
      plan: plan.trim(),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={submitLabel}
      size="lg"
    >
      <div className="space-y-5">
        <div className="rounded-3xl border border-indigo-100 bg-indigo-50/80 p-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone="indigo">{post.title}</Badge>
            <Badge tone="sky">{getSelectionTypeLabel(post.selectionType)}</Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">{post.description}</p>
        </div>

        {isTeamPost ? (
          <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">팀 이름</label>
              <input
                className={inputClassName}
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="예: 경제알리미 팀"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">팀원 선택</label>
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                  대표 지원자는 {currentUser?.name || "현재 사용자"}로 자동 포함됩니다.
                </div>
                {teamCandidates.map((student) => (
                  <Checkbox
                    key={student.uid}
                    checked={memberUids.includes(student.uid)}
                    onChange={() => toggleMember(student.uid)}
                    label={`${student.studentNumber || "-"}번 ${student.name || "학생"}`}
                    className="rounded-xl bg-white px-3 py-2"
                  />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">역할 분담</label>
              <Textarea
                rows={3}
                className="rounded-2xl border-slate-200 px-4 py-3"
                value={roleSummary}
                onChange={(event) => setRoleSummary(event.target.value)}
                placeholder="누가 어떤 역할을 맡는지 적어 주세요."
              />
            </div>
          </div>
        ) : null}

        {needsLongForm ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">지원 동기</label>
              <Textarea
                rows={4}
                className="rounded-2xl border-slate-200 px-4 py-3"
                value={motivation}
                onChange={(event) => setMotivation(event.target.value)}
                placeholder="예: 이 일을 해보고 싶은 이유나 내가 잘할 수 있다고 생각하는 이유를 적어 주세요."
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">관련 경험</label>
              <Textarea
                rows={4}
                className="rounded-2xl border-slate-200 px-4 py-3"
                value={experience}
                onChange={(event) => setExperience(event.target.value)}
                placeholder="예: 비슷한 활동을 해본 경험, 잘하는 점, 맡아본 역할이 있다면 적어 주세요."
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">진행 계획</label>
              <Textarea
                rows={4}
                className="rounded-2xl border-slate-200 px-4 py-3"
                value={plan}
                onChange={(event) => setPlan(event.target.value)}
                placeholder="예: 어떤 순서로 할지, 언제까지 끝낼 수 있을지, 결과물을 어떻게 만들지 적어 주세요."
              />
            </div>
          </div>
        ) : isFirstComePost ? (
          <div className="rounded-3xl border border-emerald-100 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800">
            참여하면 모집 인원 안에서 바로 선발됩니다.
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">한마디 (선택)</label>
            <Textarea
              rows={3}
              className="rounded-2xl border-slate-200 px-4 py-3"
              value={motivation}
              onChange={(event) => setMotivation(event.target.value)}
              placeholder="예: 참여하고 싶어요. 맡겨주시면 성실하게 해볼게요."
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button kind="outline" tone="slate" onClick={onClose}>
            닫기
          </Button>
          <Button tone="blue" icon={Send} onClick={handleSubmit} isLoading={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const ApplicationCard = ({
  application,
  busyKey,
  isBulkSelectable = false,
  isBulkSelected = false,
  isDetailOpen = false,
  onBulkDragStart,
  onBulkDragEnter,
  onToggleDetail,
  onSelect,
  onReject,
}) => {
  const statusMeta = getStatusMeta(application.status, APPLICATION_STATUS_META);
  const title =
    application.applicantType === "team"
      ? application.teamName || application.applicantName
      : application.applicantName;
  const hasApplicationDetail = usesApplicationForm(application.selectionType);
  const appliedAtLabel = formatDateTime(application.appliedAt || application.createdAt);
  const rowToneClass =
    application.status === "paid"
      ? "border-l-emerald-300 bg-emerald-50/70"
      : isApplicationPayable(application)
        ? "border-l-sky-300 bg-sky-50/70"
        : application.status === "applied"
          ? "border-l-indigo-200 bg-white"
          : application.status === "rejected"
            ? "border-l-rose-300 bg-rose-50/70"
            : application.status === "withdrawn"
              ? "border-l-slate-300 bg-slate-50"
              : "border-l-transparent bg-white";

  return (
    <div
      className={`overflow-hidden border-l-4 transition ${
        isBulkSelected ? "ring-2 ring-inset ring-indigo-300" : ""
      } ${rowToneClass}`}
      onMouseEnter={() => {
        if (isBulkSelectable) onBulkDragEnter?.(application);
      }}
    >
      <div
        className={`grid gap-3 px-4 py-3 md:grid-cols-[40px_minmax(0,1fr)_120px_minmax(260px,auto)] md:items-center ${
          isBulkSelectable ? "cursor-pointer" : ""
        }`}
        onMouseDown={(event) => {
          if (!isBulkSelectable || event.button !== 0) return;
          event.preventDefault();
          onBulkDragStart?.(application);
        }}
      >
        <div className="flex items-center">
          {isBulkSelectable ? (
            <Button
              type="button"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs font-black transition ${
                isBulkSelected
                  ? "border-indigo-500 bg-indigo-600 text-white"
                  : "border-slate-300 bg-white text-transparent hover:border-indigo-300"
              }`}
              aria-label={`${title} 지급 대상 선택`}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onBulkDragStart?.(application);
              }}
              onClick={(event) => event.stopPropagation()}
            >
              ✓
            </Button>
          ) : (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-black text-slate-900">{title}</p>
        </div>
        <p className="text-sm font-bold text-slate-600">{statusMeta.label}</p>
        <div
          className="flex flex-wrap items-center justify-end gap-2"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {hasApplicationDetail ? (
            <Button
              size="sm"
              kind="outline"
              tone="slate"
              icon={FileText}
              onClick={() => onToggleDetail?.(application)}
            >
              {isDetailOpen ? "접기" : "상세"}
            </Button>
          ) : null}
          {application.status === "applied" ? (
            <>
              <Button
                size="sm"
                tone="emerald"
                icon={UserCheck2}
                onClick={() => onSelect(application)}
                isLoading={busyKey === `select:${application.id}`}
              >
                선발
              </Button>
              <Button
                size="sm"
                kind="outline"
                tone="red"
                icon={XCircle}
                onClick={() => onReject(application)}
                isLoading={busyKey === `reject:${application.id}`}
              >
                반려
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {hasApplicationDetail && isDetailOpen ? (
        <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-slate-400">지원자 이력서</p>
                <p className="mt-1 text-lg font-black text-slate-900">{title}</p>
              </div>
              <p className="text-sm font-semibold text-slate-500">
                지원 시각 {appliedAtLabel}
              </p>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-black text-slate-400">지원 동기</p>
                <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">
                  {application.motivation || "-"}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-black text-slate-400">관련 경험</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">
                    {application.experience || "-"}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-black text-slate-400">진행 계획</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">
                    {application.plan || "-"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const MyApplicationCard = ({ application, userUid, currencyUnit, onOpenPost }) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatReward = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const statusMeta = getStatusMeta(application.status, APPLICATION_STATUS_META);
  const roleLabel =
    application.applicantType === "team"
      ? application.applicantUid === userUid
        ? `팀장 지원 · ${application.teamName || application.applicantName}`
        : `팀원 참여 · ${application.teamName || application.applicantName}`
      : "개인 지원";

  return (
    <Button
      type="button"
      onClick={() => onOpenPost(application.postId)}
      className="w-full rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black text-slate-900">{application.postTitle}</p>
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">{roleLabel}</p>
        </div>
        <span className="text-xs font-semibold text-slate-400">
          {formatDateTime(application.updatedAt)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone="slate">{getSelectionTypeLabel(application.selectionType)}</Badge>
        <Badge tone="emerald">
          보상 {formatReward(application.rewardAmount, currencyUnit)}
        </Badge>
      </div>
    </Button>
  );
};

export {
  APPLICATION_STATUS_META,
  STATUS_FILTER_OPTIONS,
  DEFAULT_JOB_BOARD_SETTINGS,
  TARGET_FILTER_OPTIONS,
  SELECTION_FILTER_OPTIONS,
  REVIEW_FILTER_OPTIONS,
  POST_STATUS_OPTIONS,
  inputClassName,
  selectClassName,
  normalizePostStatusValue,
  normalizeSelectionTypeValue,
  usesApplicationForm,
  getSelectionTypeLabel,
  getApplyActionLabel,
  formatDateTime,
  formatDeadlineCountdown,
  formatPostRemainingTime,
  formatReward,
  getRewardModeLabel,
  getStatusMeta,
  getPostStatusMeta,
  getDisplayPostStatusMeta,
  getDisplayPostStatusValue,
  isApplicationPayable,
  isPostRecruiting,
  canReapplyFromStatus,
  isPrivatePostStatus,
  isManualPostStatus,
  isPostModerationStatus,
  getAuthorRoleLabel,
  getAuthorTone,
  getApplicationRatingTargets,
  matchesStatusFilter,
  buildPostSearchBlob,
  SelectBox,
  InfoTile,
  TextPromptModal,
  JobBoardSettingsModal,
  RatingModal,
  RatingModerationModal,
  RatingManagementCard,
  WorkerRatingActionCard,
  JobPostModal,
  ApplyModal,
  ApplicationCard,
  MyApplicationCard,
};
