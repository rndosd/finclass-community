import { httpsCallable } from "firebase/functions";

import { functions } from "../../../firebase";

const createJobBoardPostFn = httpsCallable(functions, "createJobBoardPost");
const updateJobBoardProfileFn = httpsCallable(functions, "updateJobBoardProfile");
const updateJobBoardPostFn = httpsCallable(functions, "updateJobBoardPost");
const moderateJobBoardPostFn = httpsCallable(functions, "moderateJobBoardPost");
const submitJobBoardApplicationFn = httpsCallable(
  functions,
  "submitJobBoardApplication",
);
const withdrawJobBoardApplicationFn = httpsCallable(
  functions,
  "withdrawJobBoardApplication",
);
const reviewJobBoardApplicationFn = httpsCallable(
  functions,
  "reviewJobBoardApplication",
);
const submitJobBoardWorkFn = httpsCallable(functions, "submitJobBoardWork");
const approveJobBoardSubmissionFn = httpsCallable(
  functions,
  "approveJobBoardSubmission",
);
const payJobBoardRewardFn = httpsCallable(functions, "payJobBoardReward");
const submitJobBoardRatingFn = httpsCallable(functions, "submitJobBoardRating");
const submitJobBoardWorkerRatingFn = httpsCallable(
  functions,
  "submitJobBoardWorkerRating",
);
const moderateJobBoardRatingFn = httpsCallable(
  functions,
  "moderateJobBoardRating",
);
const refreshJobBoardDashboardSummaryFn = httpsCallable(
  functions,
  "refreshJobBoardDashboardSummary",
);
const backfillJobBoardDashboardSummariesFn = httpsCallable(
  functions,
  "backfillJobBoardDashboardSummaries",
);

const JOB_BOARD_ERROR_MESSAGES = [
  {
    includes: "already have an active application",
    message: "이미 이 공고에 지원했습니다.",
  },
  {
    includes: "not accepting applications",
    message: "현재 지원할 수 없는 공고입니다.",
  },
  {
    includes: "Application deadline has passed",
    message: "지원 마감 시간이 지났습니다.",
  },
  {
    includes: "already full",
    message: "모집 인원이 이미 찼습니다.",
  },
  {
    includes: "Authors cannot apply",
    message: "자신이 작성한 공고에는 지원할 수 없습니다.",
  },
  {
    includes: "already has an active application",
    message: "이미 이 공고에 참여 중입니다.",
  },
  {
    includes: "Only applied applications can be selected",
    message: "지원 완료 상태의 지원자만 선발할 수 있습니다.",
  },
  {
    includes: "Only applied or selected applications can be rejected",
    message: "지원 완료 또는 선발 상태만 반려할 수 있습니다.",
  },
  {
    includes: "Only selected applications can submit work",
    message: "선발된 지원자만 작업을 제출할 수 있습니다.",
  },
  {
    includes: "already paid",
    message: "이미 지급 완료된 지원입니다.",
  },
];

const translateJobBoardErrorMessage = (message, fallbackMessage) => {
  const rawMessage = String(message || "").trim();
  const matched = JOB_BOARD_ERROR_MESSAGES.find((entry) =>
    rawMessage.includes(entry.includes),
  );
  if (matched) return matched.message;
  return rawMessage || fallbackMessage || "요청을 처리하지 못했습니다.";
};

const unwrapCallableResult = async (callable, payload, fallbackMessage) => {
  try {
    const result = await callable(payload);
    return result.data;
  } catch (error) {
    const rawMessage =
      error?.message ||
      error?.details?.message ||
      fallbackMessage ||
      "요청을 처리하지 못했습니다.";
    const message = translateJobBoardErrorMessage(rawMessage, fallbackMessage);
    throw new Error(message);
  }
};

export const createJobBoardPost = async ({ classId, post }) =>
  unwrapCallableResult(
    createJobBoardPostFn,
    { classId, post },
    "공고를 등록하지 못했습니다.",
  );

export const updateJobBoardProfile = async ({ classId, profile }) =>
  unwrapCallableResult(
    updateJobBoardProfileFn,
    { classId, profile },
    "프로필을 수정하지 못했습니다.",
  );

export const backfillJobBoardDashboardSummaries = async ({ classId }) =>
  unwrapCallableResult(
    backfillJobBoardDashboardSummariesFn,
    { classId },
    "현황 요약 백필을 실행하지 못했습니다.",
  );

export const refreshJobBoardDashboardSummary = async ({ classId, userUid }) =>
  unwrapCallableResult(
    refreshJobBoardDashboardSummaryFn,
    { classId, userUid },
    "내 현황 요약을 새로 계산하지 못했습니다.",
  );

export const updateJobBoardPost = async ({ classId, postId, updates }) =>
  unwrapCallableResult(
    updateJobBoardPostFn,
    { classId, postId, updates },
    "공고를 수정하지 못했습니다.",
  );

export const moderateJobBoardPost = async ({ classId, postId, action }) =>
  unwrapCallableResult(
    moderateJobBoardPostFn,
    { classId, postId, action },
    "공고 승인 상태를 처리하지 못했습니다.",
  );

export const submitJobBoardApplication = async ({
  classId,
  postId,
  application,
}) =>
  unwrapCallableResult(
    submitJobBoardApplicationFn,
    { classId, postId, application },
    "지원서를 제출하지 못했습니다.",
  );

export const withdrawJobBoardApplication = async ({ classId, postId }) =>
  unwrapCallableResult(
    withdrawJobBoardApplicationFn,
    { classId, postId },
    "지원을 취소하지 못했습니다.",
  );

export const reviewJobBoardApplication = async ({
  classId,
  postId,
  applicationId,
  action,
  rejectionReason,
}) =>
  unwrapCallableResult(
    reviewJobBoardApplicationFn,
    {
      classId,
      postId,
      applicationId,
      action,
      rejectionReason,
    },
    "지원 상태를 처리하지 못했습니다.",
  );

export const submitJobBoardWork = async ({
  classId,
  postId,
  submissionText,
}) =>
  unwrapCallableResult(
    submitJobBoardWorkFn,
    { classId, postId, submissionText },
    "작업을 제출하지 못했습니다.",
  );

export const approveJobBoardSubmission = async ({
  classId,
  postId,
  applicationId,
}) =>
  unwrapCallableResult(
    approveJobBoardSubmissionFn,
    { classId, postId, applicationId },
    "제출물을 승인하지 못했습니다.",
  );

export const payJobBoardReward = async ({
  classId,
  postId,
  applicationId,
  note,
}) =>
  unwrapCallableResult(
    payJobBoardRewardFn,
    { classId, postId, applicationId, note },
    "보상을 지급하지 못했습니다.",
  );

export const submitJobBoardRating = async ({
  classId,
  postId,
  rating,
  review,
}) =>
  unwrapCallableResult(
    submitJobBoardRatingFn,
    { classId, postId, rating, review },
    "평가를 제출하지 못했습니다.",
  );

export const submitJobBoardWorkerRating = async ({
  classId,
  postId,
  applicationId,
  targetUid,
  rating,
  review,
}) =>
  unwrapCallableResult(
    submitJobBoardWorkerRatingFn,
    { classId, postId, applicationId, targetUid, rating, review },
    "작업자 평가를 제출하지 못했습니다.",
  );

export const moderateJobBoardRating = async ({
  classId,
  ratingId,
  action,
  rating,
  review,
  moderationNote,
}) =>
  unwrapCallableResult(
    moderateJobBoardRatingFn,
    {
      classId,
      ratingId,
      action,
      rating,
      review,
      moderationNote,
    },
    "평점 상태를 처리하지 못했습니다.",
  );
