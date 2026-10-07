import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircleIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";

import { Button, Modal } from "../../../../components/ui";
import ModernRichEditor from "../../../../components/ui/modernricheditor/ModernRichEditor";
import { useUser } from "../../../../contexts/UserContext";
import { db } from "../../../../firebase";
import { getRewardVisual } from "../../constants/rewardVisuals";
import { getRewardDisplayText } from "../../utils/rewardUtils";

const missionSubmissionCache = new Map();

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const getSubmissionCacheKey = ({ classId, missionId, studentUid }) =>
  `${classId || ""}:${missionId || ""}:${studentUid || ""}`;

const getSubmissionSummary = (mission, studentUid) => {
  const completion =
    mission?._completion || mission?.completions?.[studentUid] || null;
  const summarySubmission = mission?._mySubmission || null;

  return {
    id:
      summarySubmission?.id ||
      completion?.submissionId ||
      mission?.submissionsIndex?.[studentUid] ||
      null,
    status: summarySubmission?.status || completion?.status || null,
    feedback: summarySubmission?.feedback || completion?.feedback || "",
    contentHtml:
      typeof summarySubmission?.contentHtml === "string"
        ? summarySubmission.contentHtml
        : null,
  };
};

const getSubmissionCacheVersion = (mission, studentUid) => {
  const submissionSummary = getSubmissionSummary(mission, studentUid);
  const completion =
    mission?._completion || mission?.completions?.[studentUid] || null;

  return [
    mission?.id || "",
    submissionSummary?.id || "",
    submissionSummary?.status || "",
    submissionSummary?.feedback || "",
    toMillis(completion?.feedbackEditedAt),
    toMillis(completion?.updatedAt),
    toMillis(mission?.updatedAt),
  ].join("|");
};

const RewardItem = ({
  reward,
  type,
  amount,
  currencyUnit,
  missionTokenLabel,
}) => {
  const effectiveReward = reward || { type, amount };
  const visual = getRewardVisual(effectiveReward.type);
  const IconComp = visual.icon;

  const colorMap = {
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
  };

  const colorClass = colorMap[visual.tone] || colorMap.slate;
  const displayLabel =
    effectiveReward.type === "currency"
      ? currencyUnit
      : effectiveReward.type === "missionToken"
        ? missionTokenLabel
        : visual.label;

  return (
    <div
      className={`cursor-default rounded-lg border px-3 py-1.5 shadow-sm transition-transform hover:scale-105 ${colorClass}`}
    >
      <div className="flex items-center gap-1.5">
        {IconComp ? <IconComp className="h-4 w-4 opacity-80" strokeWidth={2.5} /> : null}
        <span className="text-xs font-bold opacity-90">{displayLabel}</span>
        <span className="text-sm font-black">
          +{getRewardDisplayText(
            effectiveReward,
            currencyUnit,
            missionTokenLabel,
          )}
        </span>
      </div>
    </div>
  );
};

const MissionSubmitModal = ({
  mission,
  onClose,
  onSubmit,
  isSubmitting,
  mode = "new",
  viewOnly = false,
}) => {
  const { userData, classData, missionTokenLabel } = useUser();
  const myUid = userData?.uid;
  const currencyUnit = classData?.currencyUnit || "코인";

  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loadingSub, setLoadingSub] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState(null);
  const [teacherFeedback, setTeacherFeedback] = useState("");
  const [isEditMode, setIsEditMode] = useState(
    mode === "edit-submission" || !viewOnly,
  );

  const submissionSummary = useMemo(
    () => getSubmissionSummary(mission, myUid),
    [mission, myUid],
  );

  useEffect(() => {
    setIsEditMode(mode === "edit-submission" || !viewOnly);
  }, [mode, viewOnly]);

  const deadlineInfo = useMemo(() => {
    const deadline = mission?.timeWindow?.end || mission?.endDate;
    if (!deadline) return null;

    const now = new Date();
    const endDate = deadline.toDate ? deadline.toDate() : new Date(deadline);
    const diff = endDate - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (diff < 0) {
      return { text: "마감됨", color: "text-rose-600", bg: "bg-rose-50" };
    }
    if (hours < 24) {
      return {
        text: `${hours}시간 남음`,
        color: "text-amber-600",
        bg: "bg-amber-50",
      };
    }
    return {
      text: `${days}일 남음`,
      color: "text-slate-500",
      bg: "bg-slate-100",
    };
  }, [mission]);

  const isLateSubmissionBlocked = useMemo(() => {
    const deadline = mission?.timeWindow?.end || mission?.endDate;
    if (!deadline) return false;

    const endDate = deadline.toDate ? deadline.toDate() : new Date(deadline);
    return endDate < new Date() && mission?.allowLateSubmission === false;
  }, [mission]);

  const isEditable = useMemo(() => {
    const status = submissionStatus || submissionSummary?.status || null;
    return !status || ["pending", "late", "rejected"].includes(status);
  }, [submissionStatus, submissionSummary?.status]);

  useEffect(() => {
    let cancelled = false;

    const fetchMySubmission = async () => {
      const classId = mission?.classId || mission?.classID;
      const missionId = mission?.id || null;
      const cacheKey = getSubmissionCacheKey({
        classId,
        missionId,
        studentUid: myUid,
      });
      const cacheVersion = getSubmissionCacheVersion(mission, myUid);
      const canFetchRaw =
        !!submissionSummary?.id ||
        (!!submissionSummary?.status && mission?.requireSubmissionForm);

      setContent("");
      setTeacherFeedback(submissionSummary?.feedback || "");
      setSubmissionStatus(submissionSummary?.status || null);
      setError("");

      if (typeof submissionSummary?.contentHtml === "string") {
        setContent(submissionSummary.contentHtml || "");
        missionSubmissionCache.set(cacheKey, {
          contentHtml: submissionSummary.contentHtml || "",
          feedback: submissionSummary.feedback || "",
          status: submissionSummary.status || null,
          version: cacheVersion,
        });
        return;
      }

      if (!classId || !missionId || !myUid || !canFetchRaw) {
        missionSubmissionCache.set(cacheKey, {
          contentHtml: "",
          feedback: submissionSummary?.feedback || "",
          status: submissionSummary?.status || null,
          version: cacheVersion,
        });
        return;
      }

      const cached = missionSubmissionCache.get(cacheKey);
      if (cached && cached.version === cacheVersion) {
        setContent(cached.contentHtml || "");
        setTeacherFeedback(cached.feedback || "");
        setSubmissionStatus(cached.status || null);
        return;
      }

      setLoadingSub(true);
      try {
        let rawSubmission = null;

        if (submissionSummary?.id) {
          const submissionRef = doc(
            db,
            `classes/${classId}/missions/${missionId}/submissions/${submissionSummary.id}`,
          );
          const submissionSnap = await getDoc(submissionRef);
          if (submissionSnap.exists()) {
            rawSubmission = submissionSnap.data();
          }
        }

        if (!rawSubmission) {
          const submissionQuery = query(
            collection(db, `classes/${classId}/missions/${missionId}/submissions`),
            where("studentUid", "==", myUid),
            limit(1),
          );
          const submissionSnap = await getDocs(submissionQuery);
          if (!submissionSnap.empty) {
            rawSubmission = submissionSnap.docs[0].data();
          }
        }

        if (cancelled) return;

        if (rawSubmission) {
          setContent(rawSubmission.contentHtml || "");
          setTeacherFeedback(
            rawSubmission.feedback || submissionSummary?.feedback || "",
          );
          setSubmissionStatus(
            rawSubmission.status || submissionSummary?.status || null,
          );
          missionSubmissionCache.set(cacheKey, {
            contentHtml: rawSubmission.contentHtml || "",
            feedback:
              rawSubmission.feedback || submissionSummary?.feedback || "",
            status: rawSubmission.status || submissionSummary?.status || null,
            version: cacheVersion,
          });
        } else {
          missionSubmissionCache.set(cacheKey, {
            contentHtml: "",
            feedback: submissionSummary?.feedback || "",
            status: submissionSummary?.status || null,
            version: cacheVersion,
          });
        }
      } catch (err) {
        console.error("submission load failed:", err);
      } finally {
        if (!cancelled) {
          setLoadingSub(false);
        }
      }
    };

    fetchMySubmission();

    return () => {
      cancelled = true;
    };
  }, [mission, myUid, submissionSummary]);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (isLateSubmissionBlocked) {
      setError("마감 후 제출이 허용되지 않은 과제입니다.");
      return;
    }

    const stripped = content.replace(/<[^>]*>?/gm, "").trim();
    if (!stripped) {
      setError("내용을 입력해 주세요.");
      return;
    }

    try {
      await onSubmit(mission, content, {
        mode: mode === "view" ? "new" : mode,
      });
    } catch (err) {
      setError(err.message || "제출 실패");
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} size="lg">
      <div className="space-y-8 p-8 sm:p-10">
        <div className="space-y-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              {deadlineInfo ? (
                <span
                  className={`rounded-md px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${deadlineInfo.bg} ${deadlineInfo.color}`}
                >
                  {deadlineInfo.text}
                </span>
              ) : null}
              {submissionStatus ? (
                <span
                  className={`rounded-md px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                    submissionStatus === "approved"
                      ? "bg-green-100 text-green-700"
                      : submissionStatus === "rejected"
                        ? "bg-red-100 text-red-700"
                        : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {submissionStatus === "approved"
                    ? "승인완료"
                    : submissionStatus === "rejected"
                      ? "반려됨"
                      : "제출됨"}
                </span>
              ) : null}
            </div>

            <h2 className="text-3xl font-black leading-tight tracking-tight text-slate-900 sm:text-4xl">
              {mission.title}
            </h2>
          </div>

          <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-600 sm:text-lg">
            {mission.description || "상세 설명이 등록되지 않은 과제입니다."}
          </p>

          {mission.rewards && mission.rewards.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="mr-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                보상
              </span>
              {mission.rewards.map((reward, index) => (
                <RewardItem
                  key={index}
                  reward={reward}
                  type={reward.type}
                  amount={reward.amount}
                  currencyUnit={currencyUnit}
                  missionTokenLabel={missionTokenLabel}
                />
              ))}
            </div>
          ) : null}
        </div>

        <hr className="border-slate-100" />

        {teacherFeedback ? (
          <div className="group relative overflow-hidden rounded-2xl border border-amber-100 bg-amber-50/60 p-6">
            <div className="absolute left-0 top-0 h-full w-1.5 bg-amber-200 transition-colors group-hover:bg-amber-400" />
            <h4 className="mb-2 flex items-center gap-2 text-sm font-black text-amber-800">
              <SparklesIcon className="h-4 w-4" />
              선생님 피드백
            </h4>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {teacherFeedback}
            </p>
          </div>
        ) : null}

        {isLateSubmissionBlocked ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
            마감 후 제출이 허용되지 않은 과제입니다.
          </div>
        ) : null}

        {mission.requireSubmissionForm && (isEditMode || content) ? (
          <div className="animate-in slide-in-from-bottom-2 space-y-4 duration-500 fade-in">
            <div className="flex items-center justify-between px-1">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <DocumentTextIcon className="h-4 w-4 text-slate-400" />
                내 과제 기록
              </label>
              {loadingSub ? (
                <span className="animate-pulse text-[11px] font-bold text-blue-500">
                  이전 기록 불러오는 중...
                </span>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm transition-all focus-within:border-blue-200 focus-within:ring-4 focus-within:ring-blue-50">
              <ModernRichEditor
                value={content}
                onChange={isEditMode && isEditable ? setContent : undefined}
                readOnly={!isEditMode || !isEditable}
                height="320px"
                toolbar={isEditMode && isEditable ? "standard" : "none"}
                placeholder="과제 내용을 작성하거나 사진을 첨부해 보세요."
              />
            </div>

            {error ? (
              <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-bold text-red-500">
                <ExclamationTriangleIcon className="h-4 w-4" />
                {error}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-4 rounded-b-[2.5rem] border-t border-slate-100 bg-slate-50/80 px-8 py-6 backdrop-blur-md">
        {mission.requireSubmissionForm &&
        !isLateSubmissionBlocked &&
        isEditable &&
        (isEditMode ? (
          <Button size="sm"
            onClick={handleSubmit}
            isLoading={isSubmitting}
            loadingText={"\uC81C\uCD9C \uC911..."}
            icon={CheckCircleIcon}
            tone="blue"
            rounded="lg"
            
          >
            {submissionStatus
              ? "\uC218\uC815 \uB0B4\uC6A9 \uC800\uC7A5"
              : "\uC81C\uCD9C\uD558\uAE30"}
          </Button>
        ) : (
          <Button tone="slate" kind="solid" size="sm"
            onClick={() => setIsEditMode(true)}
            className="flex items-center gap-2 transition-all hover:-translate-y-0.5"
          >
            <DocumentTextIcon className="h-5 w-5 text-slate-400" />
            {submissionStatus ? "내용 수정하기" : "과제 하기"}
          </Button>
        ))}
      </div>
    </Modal>
  );
};

export default MissionSubmitModal;
