import { appAlert } from "../../../utils/appDialogs";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  AlertCircle,
  CheckCircle2,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

import {
  Badge,
  Button,
  Modal,
  Textarea,
} from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { spellcheckLength } from "../utils/textLength";

const MIN_LEN = 30;
const PERCENT_PRESETS = [0, 25, 50, 100];

const clampPercent = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(0, Math.min(100, Math.round(parsed)));
};

const normalizeSubmissionType = (value) =>
  value === "appeal" ? "appeal" : "reflection";

const formatSignedPoints = (value) => {
  const amount = Number(value || 0);
  if (amount > 0) return `+${amount}점`;
  if (amount < 0) return `${amount}점`;
  return "0점";
};



const resolveBaseFine = (fine) =>
  Math.abs(Number(fine?.originalAmountSigned ?? fine?.amountSigned ?? 0));

const resolveBaseCredit = (fine) =>
  Number(fine?.originalCreditChangeApplied ?? fine?.creditChangeApplied ?? 0);

const resolveBaseMissionToken = (fine) =>
  Number(
    fine?.originalMissionTokenChangeApplied ??
      fine?.missionTokenChangeApplied ??
      0,
  );

const resolveTargetSignedValue = (baseValue, percent) => {
  const numericBase = Number(baseValue || 0);
  if (numericBase === 0) return 0;
  const magnitude = Math.round(Math.abs(numericBase) * percent / 100);
  return Math.sign(numericBase) * magnitude;
};

const formatSignedToken = (value) => {
  const amount = Number(value || 0);
  if (amount > 0) return `+${amount}개`;
  if (amount < 0) return `${amount}개`;
  return "0개";
};

const getStatusTone = (status, submissionType, reviewOutcome) => {
  const normalizedType = normalizeSubmissionType(submissionType);
  switch (status) {
    case "submitted":
      return {
        tone: "indigo",
        label: normalizedType === "appeal" ? "이의 검토중" : "반성문 검토중",
      };
    case "approved":
      return {
        tone: "emerald",
        label:
          reviewOutcome === "adjusted"
            ? "조정 승인"
            : normalizedType === "appeal"
              ? "이의 승인"
              : "승인 완료",
      };
    case "rejected":
      return {
        tone: "rose",
        label: normalizedType === "appeal" ? "이의 반려" : "반려됨",
      };
    default:
      return { tone: "slate", label: "미제출" };
  }
};

const getSubmissionLabel = (type) =>
  normalizeSubmissionType(type) === "appeal" ? "이의제기" : "반성문";

const SubmissionTypePill = ({
  active,
  label,
  onClick,
  tone = "indigo",
  disabled = false,
}) => (
  <Button
    type="button"
    onClick={onClick}
    disabled={disabled}
    kind="ghost"
    tone={tone === "rose" ? "red" : "blue"}
    size="xs"
    aria-pressed={active}
    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
      active
        ? tone === "rose"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-indigo-200 bg-indigo-50 text-indigo-700"
        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
  >
    {label}
  </Button>
);

const PercentControl = ({
  label,
  value,
  onChange,
  previewLabel,
  tone = "indigo",
  disabled = false,
}) => {
  const sliderClass =
    tone === "rose" ? "accent-rose-500" : "accent-indigo-500";

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-sm font-semibold text-slate-900">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(event) => onChange(clampPercent(event.target.value))}
        aria-label={label} disabled={disabled} className={`w-full ${sliderClass}`}
      />
      <div className="flex flex-wrap gap-2">
        {PERCENT_PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            disabled={disabled}
            onClick={() => onChange(preset)}
            kind="ghost"
            tone={tone === "rose" ? "red" : "blue"}
            size="xs"
            aria-pressed={value === preset}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              value === preset
                ? tone === "rose"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-indigo-200 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-slate-50 text-slate-500 hover:bg-white"
            }`}
          >
            {preset}%
          </Button>
        ))}
      </div>
      <p className="text-xs text-slate-500">{previewLabel}</p>
    </div>
  );
};

export const ReflectionContent = ({
  embedded = false,
  onBusyChange,
  isOpen,
  fine,
  reflectionData,
  mode,
  currencyUnit = "원",
  onClose,
  onSubmit,
  onApprove,
  onReject,
  onUpdate,
  onCancelSubmission,
}) => {
  const { formatClassCurrency } = useNumberFormat();
  const formatFineValue = (amount, unit) => `${formatClassCurrency(amount)}${unit}`;
  const { userData, isTeacher, hasPermission, missionTokenLabel } = useUser();

  const [reflectionText, setReflectionText] = useState("");
  const [submissionType, setSubmissionType] = useState("reflection");
  const [teacherComment, setTeacherComment] = useState("");
  const [finePercent, setFinePercent] = useState(100);
  const [creditPercent, setCreditPercent] = useState(100);
  const [missionTokenPercent, setMissionTokenPercent] = useState(100);
  const [showAdjustmentCard, setShowAdjustmentCard] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => { onBusyChange?.(isSubmitting || isProcessing); }, [isSubmitting, isProcessing, onBusyChange]);

  const isOwner = userData?.uid === fine?.studentUid;
  const isPoliceAdmin = isTeacher || hasPermission("permission_group_police");
  const isCancelled = fine?.status === "cancelled" || fine?.isCancelled;
  const reviewStatus = reflectionData?.status || "none";
  const canReviewPending =
    !isCancelled && isPoliceAdmin && !isOwner && mode === "review" && reviewStatus === "submitted";
  const canEditByStudent = isOwner && reviewStatus === "rejected";
  const canSubmitByStudent = isOwner && mode === "submit";

  const { withSpace } = spellcheckLength(reflectionText);
  const tooShort = withSpace < MIN_LEN;

  const baseFine = useMemo(() => resolveBaseFine(fine), [fine]);
  const baseCredit = useMemo(() => resolveBaseCredit(fine), [fine]);
  const baseMissionToken = useMemo(() => resolveBaseMissionToken(fine), [fine]);
  const previewFine = useMemo(
    () => Math.round(baseFine * finePercent / 100),
    [baseFine, finePercent],
  );
  const previewCredit = useMemo(
    () => resolveTargetSignedValue(baseCredit, creditPercent),
    [baseCredit, creditPercent],
  );
  const previewMissionToken = useMemo(
    () => resolveTargetSignedValue(baseMissionToken, missionTokenPercent),
    [baseMissionToken, missionTokenPercent],
  );
  const displayedFineAmount =
    canReviewPending && showAdjustmentCard
      ? previewFine
      : Math.abs(Number(fine?.amountSigned || 0));
  const displayedCreditAmount =
    canReviewPending && showAdjustmentCard
      ? previewCredit
      : Number(fine?.creditChangeApplied || 0);
  const displayedMissionTokenAmount =
    canReviewPending && showAdjustmentCard
      ? previewMissionToken
      : Number(fine?.missionTokenChangeApplied || 0);
  const showAdjustmentFloatingBar =
    canReviewPending && showAdjustmentCard && !isEditing;
  const shouldShowMissionToken =
    baseMissionToken !== 0 ||
    Number(fine?.missionTokenChangeApplied || 0) !== 0 ||
    Number(fine?.originalMissionTokenChangeApplied || 0) !== 0;
  const adjustmentTitle = shouldShowMissionToken
    ? `벌금 ${finePercent}% / 신용점수 ${creditPercent}% / ${missionTokenLabel} ${missionTokenPercent}%`
    : `벌금 ${finePercent}% / 신용점수 ${creditPercent}%`;
  const adjustmentSubtitle = [
    `최종 벌금 -${formatFineValue(previewFine, currencyUnit)}`,
    `최종 신용점수 ${formatSignedPoints(previewCredit)}`,
    ...(shouldShowMissionToken
      ? [`최종 ${missionTokenLabel} ${formatSignedToken(previewMissionToken)}`]
      : []),
  ].join(" · ");
  const appliedPercentLabel = [
    `벌금 ${reflectionData?.finalFinePercent ?? finePercent ?? 100}%`,
    `신용점수 ${reflectionData?.finalCreditPercent ?? creditPercent ?? 100}%`,
    ...(shouldShowMissionToken
      ? [
          `${missionTokenLabel} ${
            reflectionData?.finalMissionTokenPercent ?? missionTokenPercent ?? 100
          }%`,
        ]
      : []),
  ].join(" / ");

  useEffect(() => {
    if (!isOpen) return;

    setReflectionText(reflectionData?.reflectionText ?? "");
    setSubmissionType(
      normalizeSubmissionType(reflectionData?.submissionType ?? "reflection"),
    );
    setTeacherComment(reflectionData?.teacherComment ?? "");
    setFinePercent(clampPercent(reflectionData?.finalFinePercent ?? 100));
    setCreditPercent(clampPercent(reflectionData?.finalCreditPercent ?? 100));
    setMissionTokenPercent(
      clampPercent(reflectionData?.finalMissionTokenPercent ?? 100),
    );
    setShowAdjustmentCard(false);
    setIsSubmitting(false);
    setIsProcessing(false);
    setIsEditing(false);
  }, [isOpen, reflectionData]);

  const handleClose = useCallback(() => {
    if (isSubmitting || isProcessing) return;
    onClose?.();
  }, [isProcessing, isSubmitting, onClose]);

  const refId = reflectionData?.id ?? fine?.id;
  const statusMeta = getStatusTone(
    reviewStatus,
    reflectionData?.submissionType,
    reflectionData?.reviewOutcome,
  );
  const appliedAtText = fine?.appliedAt?.toDate
    ? dayjs(fine.appliedAt.toDate()).format("MM.DD HH:mm")
    : "-";
  const submittedAtText = reflectionData?.submittedAt?.toDate
    ? dayjs(reflectionData.submittedAt.toDate()).format("MM.DD HH:mm")
    : "-";
  const reviewedAtText = reflectionData?.reviewedAt?.toDate
    ? dayjs(reflectionData.reviewedAt.toDate()).format("MM.DD HH:mm")
    : "-";

  const modalTitle = canReviewPending
    ? "소명/반성문 검토"
    : canSubmitByStudent || canEditByStudent
      ? "소명/반성문 작성"
      : "소명/반성문 확인";

  const handleSubmitReflection = async () => {
    if (!refId || tooShort) return;
    setIsSubmitting(true);
    try {
      await onSubmit?.(reflectionText, submissionType);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateReflection = async () => {
    if (!refId || tooShort) return;
    setIsSubmitting(true);
    try {
      const result = await onUpdate?.(refId, reflectionText, submissionType);
      if (result?.success) {
        setIsEditing(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!refId) return;
    const comment = teacherComment.trim();
    if (!comment) {
      appAlert("반려 사유를 입력해 주세요.");
      return;
    }

    setIsProcessing(true);
    try {
      await onReject?.(refId, comment);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApprove = async () => {
    if (!refId) return;

    setIsProcessing(true);
    try {
      await onApprove?.({
        refId,
        comment: teacherComment.trim(),
        finePercent,
        creditPercent,
        missionTokenPercent,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCloseAdjustmentCard = () => {
    setShowAdjustmentCard(false);
    setFinePercent(100);
    setCreditPercent(100);
    setMissionTokenPercent(100);
  };

  const handleCancelSubmission = async () => {
    if (!refId) return;
    setIsProcessing(true);
    try {
      await onCancelSubmission?.(refId);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen || !fine) return null;

  return (
    <ReflectionFrame embedded={embedded} isOpen={isOpen} onClose={handleClose} title={modalTitle}>
      <div className={embedded ? "flex min-h-0 flex-1 flex-col" : "flex max-h-[calc(100dvh-160px)] flex-col"}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm" aria-label="검토 본문">
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold text-slate-900">{fine.studentName || "학생"}{fine.studentNumber ? ` · ${fine.studentNumber}번` : ""}</h3><div className="flex gap-2"><Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>{reflectionData?.submissionType && <Badge tone="slate">{getSubmissionLabel(reflectionData.submissionType)}</Badge>}</div></div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-xs text-slate-500">규칙</dt><dd className="font-medium text-slate-800">{fine.ruleText || "-"}</dd>
            <dt className="text-xs text-slate-500">사유</dt><dd className="whitespace-pre-wrap leading-5 text-slate-700">{fine.reason || fine.description || "-"}</dd>
            <dt className="text-xs text-slate-500">원래 부과</dt><dd className="tabular-nums">-{formatFineValue(baseFine,currencyUnit)} · 신용 {formatSignedPoints(baseCredit)}{shouldShowMissionToken ? ` · ${missionTokenLabel} ${formatSignedToken(baseMissionToken)}` : ""}</dd>
            <dt className="text-xs text-slate-500">부과 시각</dt><dd className="text-xs tabular-nums text-slate-600">{appliedAtText}</dd>
          </dl>
        </section>

        {(canSubmitByStudent || isEditing) ? (
          <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  제출 유형과 내용
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  같은 모달 안에서 반성문이나 이의제기를 선택해 제출할 수 있습니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <SubmissionTypePill
                  active={submissionType === "reflection"}
                  label="반성문"
                  onClick={() => setSubmissionType("reflection")}
                  disabled={isSubmitting}
                />
                <SubmissionTypePill
                  active={submissionType === "appeal"}
                  label="이의제기"
                  tone="rose"
                  onClick={() => setSubmissionType("appeal")}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label htmlFor="police-reflection-text" className="text-sm font-medium text-slate-700">
                내용 입력
              </label>
              <span
                className={`text-xs font-medium ${
                  tooShort ? "text-rose-500" : "text-emerald-600"
                }`}
              >
                {withSpace}자
              </span>
            </div>

            <Textarea
              id="police-reflection-text"
              value={reflectionText}
              onChange={(event) => setReflectionText(event.target.value)}
              rows={7}
              placeholder="상황 설명, 본인의 입장, 앞으로의 계획을 구체적으로 적어 주세요."
              className="resize-none"
              aria-describedby="police-reflection-length"
              aria-invalid={tooShort}
            />

            <p id="police-reflection-length" aria-live="polite" className={`text-xs ${tooShort ? "text-rose-600" : "text-slate-500"}`}>
              최소 {MIN_LEN}자 이상 작성해 주세요.
              {tooShort ? ` ${MIN_LEN - withSpace}자 더 작성해 주세요.` : null}
            </p>
          </section>
        ) : (
          <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  제출된 내용
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  제출 시각 {submittedAtText}
                </p>
              </div>
              <div className="flex items-center gap-2">

                {canEditByStudent && !isEditing ? (
                  <Button
                    type="button"
                    kind="outline"
                    tone="blue"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                  >
                    다시 작성
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="min-h-[80px] whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
              {reflectionData?.reflectionText || "아직 제출된 내용이 없습니다."}
            </div>
          </section>
        )}

        {(reflectionData?.teacherComment || canReviewPending) && !isEditing ? (
          <section
            className={`space-y-3 rounded-lg border p-3 ${
              reviewStatus === "rejected"
                ? "border-rose-200 bg-rose-50/60"
                : "border-indigo-200 bg-indigo-50/60"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">교사 코멘트</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {reviewedAtText !== "-" ? `검토 시각 ${reviewedAtText}` : "검토 후 저장됩니다."}
                </p>
              </div>
            </div>
            {canReviewPending ? (
              <Textarea
                value={teacherComment}
                onChange={(event) => setTeacherComment(event.target.value)}
                rows={3}
                placeholder="반려 사유나 승인 메모를 남길 수 있습니다."
                aria-label="교사 코멘트" className="resize-none bg-white !text-sm"
              />
            ) : (
              <div className="whitespace-pre-wrap rounded-lg border border-white bg-white p-3 text-sm leading-6 text-slate-700">
                {reflectionData?.teacherComment || "남겨진 코멘트가 없습니다."}
              </div>
            )}
          </section>
        ) : null}

        {reviewStatus === "approved" && !isEditing ? (
          <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-indigo-500" />
              <h3 className="text-sm font-semibold text-slate-800">
                최종 벌금 조정
              </h3>
            </div>

            {canReviewPending && showAdjustmentCard ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <PercentControl
                  label="벌금 비율"
                  value={finePercent}
                  onChange={setFinePercent}
                  previewLabel={`원래 -${formatFineValue(baseFine, currencyUnit)} -> 최종 -${formatFineValue(previewFine, currencyUnit)}`}
                  tone="rose"
                />
                <PercentControl
                  label="신용점수 비율"
                  value={creditPercent}
                  onChange={setCreditPercent}
                  previewLabel={`원래 ${formatSignedPoints(baseCredit)} -> 최종 ${formatSignedPoints(previewCredit)}`}
                />
                {shouldShowMissionToken ? (
                  <PercentControl
                    label={`${missionTokenLabel} 비율`}
                    value={missionTokenPercent}
                    onChange={setMissionTokenPercent}
                    previewLabel={`원래 ${formatSignedToken(baseMissionToken)} -> 최종 ${formatSignedToken(previewMissionToken)}`}
                    tone="rose"
                  />
                ) : null}
              </div>
            ) : null}

            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-white bg-white p-3">
                  <div className="text-xs font-medium text-slate-400">최종 벌금</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    -{formatFineValue(displayedFineAmount, currencyUnit)}
                  </div>
                </div>
                <div className="rounded-lg border border-white bg-white p-3">
                  <div className="text-xs font-medium text-slate-400">
                    최종 신용점수
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {formatSignedPoints(displayedCreditAmount)}
                  </div>
                </div>
                {shouldShowMissionToken ? (
                  <div className="rounded-lg border border-white bg-white p-3">
                    <div className="text-xs font-medium text-slate-400">
                      최종 {missionTokenLabel}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {formatSignedToken(displayedMissionTokenAmount)}
                    </div>
                  </div>
                ) : null}
                <div className="rounded-lg border border-white bg-white p-3">
                  <div className="text-xs font-medium text-slate-400">적용 비율</div>
                  <div className="mt-1 text-sm font-medium text-slate-700">
                    {appliedPercentLabel}
                  </div>
                </div>
                <div className="rounded-lg border border-white bg-white p-3">
                  <div className="text-xs font-medium text-slate-400">검토 결과</div>
                  <div className="mt-1 text-sm font-medium text-slate-700">
                    {reflectionData?.reviewOutcome === "adjusted"
                      ? "조정 후 승인"
                      : reviewStatus === "approved"
                        ? "변경 없이 승인"
                        : "조정 대기"}
                  </div>
                </div>
              </div>

              {canReviewPending && showAdjustmentCard ? (
                <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-indigo-500">
                    미리보기
                  </div>
                  <div className="mt-2 space-y-1 text-sm font-medium text-slate-800">
                    <div>
                      벌금: -{formatFineValue(baseFine, currencyUnit)} -> -
                      {formatFineValue(previewFine, currencyUnit)}
                    </div>
                    <div>
                      신용점수: {formatSignedPoints(baseCredit)} ->{" "}
                      {formatSignedPoints(previewCredit)}
                    </div>
                    {shouldShowMissionToken ? (
                      <div>
                        {missionTokenLabel}: {formatSignedToken(baseMissionToken)} ->{" "}
                        {formatSignedToken(previewMissionToken)}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

        {showAdjustmentFloatingBar ? (
          <section aria-label="비율 조정" className="max-h-[32dvh] shrink-0 overflow-y-auto border-t border-blue-200 bg-blue-50/30 p-3 md:max-h-[45dvh]">
            <h3 className="text-sm font-semibold">{adjustmentTitle}</h3><p className="my-2 text-xs text-slate-600">{adjustmentSubtitle}</p>
            <div className="grid min-w-0 gap-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <PercentControl
                  disabled={isProcessing}
                  label="벌금 비율"
                  value={finePercent}
                  onChange={setFinePercent}
                  previewLabel={`원래 -${formatFineValue(baseFine, currencyUnit)} -> 최종 -${formatFineValue(previewFine, currencyUnit)}`}
                  tone="rose"
                />
                <PercentControl
                  disabled={isProcessing}
                  label="신용점수 비율"
                  value={creditPercent}
                  onChange={setCreditPercent}
                  previewLabel={`원래 ${formatSignedPoints(baseCredit)} -> 최종 ${formatSignedPoints(previewCredit)}`}
                />
                {shouldShowMissionToken ? (
                  <PercentControl
                    disabled={isProcessing}
                    label={`${missionTokenLabel} 비율`}
                    value={missionTokenPercent}
                    onChange={setMissionTokenPercent}
                    previewLabel={`원래 ${formatSignedToken(baseMissionToken)} -> 최종 ${formatSignedToken(previewMissionToken)}`}
                    tone="rose"
                  />
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

      <div
        className="shrink-0 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-3 py-3"
      >
        {canSubmitByStudent ? (
          <Button
            onClick={handleSubmitReflection}
            disabled={isSubmitting || tooShort}
            isLoading={isSubmitting}
            tone="blue"
            kind="solid"
          >
            {getSubmissionLabel(submissionType)} 제출
          </Button>
        ) : null}

        {isEditing ? (
          <>
            <Button
              onClick={() => setIsEditing(false)}
              tone="slate"
              kind="soft"
              disabled={isSubmitting}
            >
              취소
            </Button>
            <Button
              onClick={handleUpdateReflection}
              disabled={isSubmitting || tooShort}
              isLoading={isSubmitting}
              tone="blue"
              kind="solid"
            >
              다시 제출
            </Button>
          </>
        ) : null}

        {isOwner && reviewStatus === "submitted" && !isEditing ? (
          <Button
            onClick={handleCancelSubmission}
            tone="rose"
            kind="ghost"
            disabled={isProcessing}
          >
            제출 취소
          </Button>
        ) : null}

        {canReviewPending ? (
          <>
            <Button onClick={handleReject} tone="rose" kind="soft" disabled={isProcessing} icon={XCircle}>반려</Button>
            <Button onClick={showAdjustmentCard ? handleCloseAdjustmentCard : () => setShowAdjustmentCard(true)} tone="blue" kind="soft" disabled={isProcessing} icon={SlidersHorizontal}>
              {showAdjustmentCard ? "조정 닫기" : "조정"}
            </Button>
            <Button onClick={handleApprove} tone="blue" kind="solid" disabled={isProcessing} isLoading={isProcessing} icon={CheckCircle2}>
              {showAdjustmentCard ? "조정 후 승인" : "승인"}
            </Button>
          </>
        ) : null}

        {!canReviewPending && reviewStatus === "approved" ? (
          <Button tone="emerald" kind="soft" disabled icon={CheckCircle2}>
            승인 완료
          </Button>
        ) : null}

        {!canReviewPending && reviewStatus === "rejected" ? (
          <Button tone="rose" kind="soft" disabled icon={AlertCircle}>
            반려됨
          </Button>
        ) : null}

        <Button onClick={handleClose} tone="slate" kind="ghost" disabled={isProcessing} className={embedded && canReviewPending ? "hidden" : undefined}>
          닫기
        </Button>
      </div>
      </div>
    </ReflectionFrame>
  );
};

function ReflectionFrame({ embedded, isOpen, onClose, title, children }) {
  return embedded ? (
    <section aria-label={title} style={{height:"var(--reflection-review-height, 480px)"}} className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <Button size="sm" kind="ghost" onClick={onClose} className="md:hidden">목록으로</Button>
      </div>
      {children}
    </section>
  ) : <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg" density="compact">{children}</Modal>;
}

const ReflectionModal = (props) => <ReflectionContent {...props} />;
export default React.memo(ReflectionModal);
