import { confirmMissionAction } from "../../../components/MissionActionDialog";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../../../../../components/ui/Modal";
import { Button } from "../../../../../components/ui";
import {
  ArrowDownTrayIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  PaperClipIcon,
  UserIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/ko";
import {
  MISSION_STATUS_LABELS,
  MISSION_STATUS_STYLES,
} from "../../../constants/missionStatusConstants";
import { useFeedback } from "../../../../../contexts/FeedbackContext";
import RewardOverrideFields from "./RewardOverrideFields";
import { hasRewardRange } from "../../../utils/rewardUtils";
import { sanitizeRichHtml } from "../../../../../utils/sanitizeRichHtml";

dayjs.extend(relativeTime);
dayjs.locale("ko");

const SubmissionReviewModal = ({
  submission,
  mission,
  classId,
  loading = false,
  onClose,
  onApprove,
  onRevoke,
  onReject,
  onSaveFeedback,
  rewardOverride = null,
  onRewardOverrideChange,
  currencyUnit = "코인",
}) => {
  const { showFeedback } = useFeedback();
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedRecently, setSavedRecently] = useState(false);
  const [error, setError] = useState("");

  const isApproved =
    submission?.status === "approved" || submission?.status === "late-approved";
  const isRejected = submission?.status === "rejected";
  const showRewardOverrideFields =
    !isApproved && hasRewardRange(mission) && typeof onRewardOverrideChange === "function";

  const submissionHtml = useMemo(
    () =>
      sanitizeRichHtml(
        submission?.contentHtml ||
          submission?.content?.html ||
          "<p class='text-slate-400'>내용이 없습니다.</p>",
      ),
    [submission?.contentHtml, submission?.content?.html],
  );

  const submittedAtText = useMemo(() => {
    if (!submission?.submittedAt) return "-";

    const submittedAt = submission.submittedAt.toDate
      ? submission.submittedAt.toDate()
      : new Date(submission.submittedAt);

    return `${dayjs(submittedAt).format("YYYY.MM.DD HH:mm")} (${dayjs(
      submittedAt,
    ).fromNow()})`;
  }, [submission?.submittedAt]);

  const dueInfo = useMemo(() => {
    const due = submission?.dueAtSnapshot;
    if (!due) return null;

    const dueAt = due.toDate ? due.toDate() : new Date(due);
    const diffMs = dueAt.getTime() - Date.now();
    const withinDueTime = diffMs >= 0;

    return {
      text: `${dayjs(dueAt).format("YYYY.MM.DD HH:mm")} ${
        withinDueTime ? `(${dayjs(dueAt).fromNow()})` : "(마감 지남)"
      }`,
      late: !withinDueTime,
    };
  }, [submission?.dueAtSnapshot]);

  useEffect(() => {
    if (!submission) return;
    setFeedback(submission.feedback ?? "");
    setError("");
    setSavedRecently(false);
  }, [submission]);

  const handleApprove = useCallback(async () => {
    if (!submission?.id) {
      setError("제출 ID를 찾을 수 없습니다.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      await onApprove?.(
        submission.id,
        (feedback ?? "").trim(),
        showRewardOverrideFields ? rewardOverride : null,
      );
      onClose?.();
    } catch (nextError) {
      setError(nextError?.message || "승인 처리에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }, [
    feedback,
    onApprove,
    onClose,
    rewardOverride,
    showRewardOverrideFields,
    submission?.id,
  ]);

  const handleRevoke = useCallback(async () => {
    if (!(await confirmMissionAction(`"${submission?.studentName || "학생"}" 제출의 승인을 취소할까요?`))) return;

    try {
      setSaving(true);
      setError("");
      await onRevoke?.(submission.studentUid, "교사 승인 취소");
      onClose?.();
    } catch (nextError) {
      setError(nextError?.message || "승인 취소에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }, [onClose, onRevoke, submission?.studentUid, submission?.studentName]);

  const handleReject = useCallback(async () => {
    if (!submission?.id) {
      setError("제출 ID를 찾을 수 없습니다.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      await onReject?.(submission.id, (feedback ?? "").trim());
      onClose?.();
    } catch (nextError) {
      setError(nextError?.message || "반려 처리에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }, [feedback, onClose, onReject, submission?.id]);

  const handleSaveFeedback = useCallback(async () => {
    if (!feedback.trim()) return;

    try {
      setSaving(true);
      setError("");
      await onSaveFeedback?.(submission.id, feedback.trim());
      setSavedRecently(true);
      showFeedback?.("피드백을 저장했습니다.", "success");
      setTimeout(() => setSavedRecently(false), 2000);
    } catch (nextError) {
      const message = nextError?.message || "피드백 저장 중 오류가 발생했습니다.";
      showFeedback?.(message, "error");
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [feedback, onSaveFeedback, showFeedback, submission?.id]);

  if (!submission) return null;

  const attachments = submission?.content?.attachments || [];
  const actionLocked = saving || loading;

  return (
    <Modal isOpen={!!submission} onClose={onClose} size="lg" lockScroll>
      <Modal.Header>
        <div className="flex w-full items-center justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-slate-900">
              제출물 검토 · {submission.studentNumber ? `${submission.studentNumber}번 ` : ""}
              {submission.studentName || "학생"}
            </h3>
            {classId ? (
              <div className="mt-1 text-xs text-slate-400">{classId}</div>
            ) : null}
          </div>

          <Button tone="slate" kind="ghost" size="icon-md"
            type="button"
            
            onClick={onClose}
            disabled={actionLocked}
            aria-label="닫기"
          >
            <XMarkIcon className="h-6 w-6 text-slate-500" />
          </Button>
        </div>
      </Modal.Header>

      <Modal.Body className="px-0">
        <div className="flex flex-wrap items-center gap-3 px-6 pb-4 text-sm text-slate-600">
          <span className="inline-flex items-center gap-1">
            <UserIcon className="h-4 w-4" />
            {submission.studentName || "학생"}
          </span>
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="h-4 w-4" />
            제출: {submittedAtText}
          </span>
          {dueInfo ? (
            <span
              className={`inline-flex items-center gap-1 ${
                dueInfo.late ? "text-red-600" : "text-slate-600"
              }`}
            >
              마감: {dueInfo.text}
            </span>
          ) : null}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              MISSION_STATUS_STYLES[submission.status] ||
              MISSION_STATUS_STYLES.pending
            }`}
          >
            {MISSION_STATUS_LABELS[submission.status] || submission.status}
          </span>
          {isRejected ? (
            <span className="text-xs text-red-500">
              이미 반려 이력이 있는 제출입니다.
            </span>
          ) : null}
        </div>

        <div className="px-6">
          <h4 className="mb-2 text-sm font-semibold text-slate-700">제출 내용</h4>
          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              제출 내용을 불러오는 중입니다.
            </div>
          ) : (
            <div
              className="prose prose-slate max-w-none rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-800"
              dangerouslySetInnerHTML={{
                __html: submissionHtml,
              }}
            />
          )}
        </div>

        {!loading && attachments.length > 0 ? (
          <div className="mt-5 px-6">
            <div className="mb-2 flex items-center gap-2">
              <PaperClipIcon className="h-5 w-5 text-slate-600" />
              <h4 className="text-sm font-semibold text-slate-700">첨부 파일</h4>
              <span className="text-xs text-slate-500">({attachments.length})</span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {attachments.map((url, index) => (
                <a
                  key={url || index}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="group block overflow-hidden rounded-lg border border-slate-200 transition-colors hover:border-blue-300"
                  title="새 탭에서 열기"
                >
                  <div className="aspect-video overflow-hidden bg-slate-100">
                    <img
                      src={url}
                      alt={`attachment-${index + 1}`}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  </div>
                  <div className="truncate bg-white px-3 py-2 text-xs text-slate-600">
                    첨부 파일 {index + 1}
                  </div>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {showRewardOverrideFields ? (
          <div className="mt-6 px-6">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">최종 보상</h4>
            <RewardOverrideFields
              mission={mission}
              currencyUnit={currencyUnit}
              value={rewardOverride}
              onChange={onRewardOverrideChange}
              disabled={actionLocked}
            />
          </div>
        ) : null}

        <div className="mt-6 px-6">
          {submission.feedback ? (
            <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
              <p className="mb-1 text-xs font-semibold text-blue-900">
                최근 저장된 피드백
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-blue-800">
                {submission.feedback}
              </p>
              {submission.feedbackEditedAt ? (
                <p className="mt-1 text-[10px] text-blue-400">
                  수정됨 ·{" "}
                  {dayjs(
                    submission.feedbackEditedAt.toDate
                      ? submission.feedbackEditedAt.toDate()
                      : submission.feedbackEditedAt,
                  ).format("YYYY.MM.DD HH:mm")}
                </p>
              ) : null}
            </div>
          ) : null}

          <h4 className="mb-2 text-sm font-semibold text-slate-700">교사 피드백</h4>
          <textarea
            className="min-h-[96px] w-full rounded-xl border border-blue-200 px-3 py-2 text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
            placeholder="학생에게 전달할 피드백을 작성하세요"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            disabled={actionLocked}
          />
          {error ? (
            <div className="mt-2 text-sm text-red-600">{error}</div>
          ) : null}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <div className="flex w-full items-center justify-between">
          <div className="text-xs text-slate-500">
            {isApproved
              ? "이미 승인된 제출입니다. 필요하면 승인을 취소할 수 있습니다."
              : isRejected
                ? "반려된 제출입니다. 내용을 검토한 뒤 다시 승인하거나 반려할 수 있습니다."
                : "검토 후 승인 또는 반려를 선택하세요."}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleSaveFeedback}
              disabled={actionLocked || savedRecently || !feedback.trim()}
              className={`inline-flex items-center gap-2 ${
                savedRecently
                  ? "bg-green-600 text-white hover:bg-green-600"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              {savedRecently ? (
                <>
                  <CheckCircleIcon className="h-4 w-4" />
                  저장됨
                </>
              ) : saving ? (
                <>
                  <ArrowDownTrayIcon className="h-4 w-4 animate-pulse" />
                  저장 중...
                </>
              ) : (
                <>
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  피드백 저장
                </>
              )}
            </Button>

            {isApproved ? (
              <Button
                variant="danger"
                onClick={handleRevoke}
                disabled={actionLocked}
                className="inline-flex items-center gap-2"
              >
                <ArrowUturnLeftIcon className="h-4 w-4" />
                승인 취소
              </Button>
            ) : (
              <>
                {onReject ? (
                  <Button
                    variant="danger"
                    onClick={handleReject}
                    disabled={actionLocked}
                    className="inline-flex items-center gap-2"
                  >
                    <XCircleIcon className="h-4 w-4" />
                    반려
                  </Button>
                ) : null}
                <Button
                  onClick={handleApprove}
                  disabled={actionLocked}
                  tone="blue"
                  className="inline-flex items-center gap-2"
                >
                  <CheckCircleIcon className="h-4 w-4" />
                  승인
                </Button>
              </>
            )}

            <Button variant="secondary" onClick={onClose} disabled={actionLocked}>
              닫기
            </Button>
          </div>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default SubmissionReviewModal;
