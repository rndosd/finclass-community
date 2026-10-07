import React, { useMemo, useState } from "react";
import { BoltIcon, ClockIcon } from "@heroicons/react/24/outline";

import Modal from "../../../../components/ui/Modal";
import ModernRichEditor from "../../../../components/ui/modernricheditor/ModernRichEditor";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { useUser } from "../../../../contexts/UserContext";
import {
  getMissionMinTierRequirement,
  meetsMissionTierRequirement,
} from "../../utils/missionEligibility";
import {
  getAlwaysAvailabilityDays,
  getAlwaysMaxPerDay,
  getTodayCountFromMissionState,
  isAlwaysAvailableOnDay,
  isWithinAlwaysTimeRange,
} from "../../utils/alwaysMissionState";
import { recordAlwaysAttempt } from "../../services/missionAlwaysService";
import SharedUiButton from "../../../../components/ui/Button";

const dayLabels = [
  "\uC77C",
  "\uC6D4",
  "\uD654",
  "\uC218",
  "\uBAA9",
  "\uAE08",
  "\uD1A0",
];

function stripHtml(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

export default function MissionAlwaysStudentModal({
  open,
  onClose,
  mission,
  missionState = null,
  onSubmitted,
  isSubmitting: externalSubmitting = false,
}) {
  const { classId, userData } = useUser();
  const { showFeedback } = useFeedback();
  const [content, setContent] = useState("");
  const [localSubmitting, setLocalSubmitting] = useState(false);

  const isSubmitting = externalSubmitting || localSubmitting;
  const availability = useMemo(
    () => mission?.availability || {},
    [mission?.availability],
  );
  const maxPerDay = getAlwaysMaxPerDay(mission);
  const daysOfWeek = getAlwaysAvailabilityDays(availability);

  const canTodayByDay = isAlwaysAvailableOnDay(availability);
  const todayCount = getTodayCountFromMissionState(missionState);
  const pendingCount = Number(missionState?.pendingCount || 0);
  const isFullToday = todayCount >= maxPerDay;
  const requiresSubmission = !!mission?.requireSubmissionForm;
  const isManual = !mission?.autoApprove;
  const plainContent = useMemo(() => stripHtml(content), [content]);
  const needsSubmissionContent = requiresSubmission && !plainContent;
  const minTier = useMemo(() => getMissionMinTierRequirement(mission), [mission]);
  const isTierBlocked = useMemo(
    () => !!minTier && !meetsMissionTierRequirement(mission, userData || {}),
    [minTier, mission, userData],
  );

  const isWithinTime = useMemo(
    () => isWithinAlwaysTimeRange(availability),
    [availability],
  );

  const handleDoToday = async () => {
    if (isTierBlocked) {
      showFeedback(
        `\uC2E0\uC6A9\uB4F1\uAE09 ${minTier?.name || ""} \uC774\uC0C1\uBD80\uD130 \uC218\uD589\uD560 \uC218 \uC788\uC5B4\uC694.`,
        "warning",
      );
      return;
    }

    if (!canTodayByDay) {
      showFeedback(
        "\uC624\uB298\uC740 \uC218\uD589\uD560 \uC218 \uC5C6\uB294 \uC694\uC77C\uC785\uB2C8\uB2E4.",
        "warning",
      );
      return;
    }

    if (!isWithinTime) {
      showFeedback(
        "\uD604\uC7AC \uC81C\uCD9C \uAC00\uB2A5\uD55C \uC2DC\uAC04\uC774 \uC544\uB2D9\uB2C8\uB2E4.",
        "warning",
      );
      return;
    }

    if (isFullToday) {
      showFeedback(
        "\uC624\uB298 \uC81C\uCD9C \uAC00\uB2A5\uD55C \uD69F\uC218\uB97C \uBAA8\uB450 \uC0AC\uC6A9\uD588\uC2B5\uB2C8\uB2E4.",
        "warning",
      );
      return;
    }

    if (needsSubmissionContent) {
      showFeedback(
        "\uC81C\uCD9C \uB0B4\uC6A9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.",
        "warning",
      );
      return;
    }

    try {
      setLocalSubmitting(true);
      const result = await recordAlwaysAttempt({
        classId: mission.classId || classId,
        missionId: mission.id,
        contentHtml: requiresSubmission ? content : "",
      });

      showFeedback(
        result?.message ||
          (isManual
            ? "\uC2B9\uC778 \uC694\uCCAD\uC774 \uC811\uC218\uB418\uC5C8\uC2B5\uB2C8\uB2E4."
            : "\uC0C1\uC2DC\uACFC\uC81C\uB97C \uC644\uB8CC\uD588\uC5B4\uC694."),
        "success",
      );
      setContent("");
      onSubmitted?.();
      onClose?.();
    } catch (error) {
      console.error("always mission submit failed:", error);
      showFeedback(
        error?.message ||
          "\uC0C1\uC2DC\uACFC\uC81C\uB97C \uC81C\uCD9C\uD558\uB294 \uC911 \uBB38\uC81C\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.",
        "error",
      );
    } finally {
      setLocalSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="lg"
      title={mission?.title || "\uC0C1\uC2DC\uACFC\uC81C"}
    >
      <div className="space-y-5">
        <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
          <p className="text-sm text-slate-700">
            {mission?.description ||
              "\uBC18\uBCF5\uC801\uC73C\uB85C \uC218\uD589\uD558\uB294 \uC0C1\uC2DC\uACFC\uC81C\uC785\uB2C8\uB2E4."}
          </p>
          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1">
              <BoltIcon className="h-4 w-4 text-emerald-500" />
              {isManual
                ? "\uC218\uB3D9 \uC2B9\uC778"
                : "\uC790\uB3D9 \uC2B9\uC778"}
            </span>
            {requiresSubmission && (
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1">
                {"\uC81C\uCD9C \uB0B4\uC6A9 \uD544\uC694"}
              </span>
            )}
            {pendingCount > 0 && isManual && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                {`\uC2B9\uC778 \uB300\uAE30 ${pendingCount}\uAC74`}
              </span>
            )}
            {minTier && (
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${
                  isTierBlocked
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-slate-200 bg-white"
                }`}
              >
                {`\uC2E0\uC6A9\uB4F1\uAE09 ${minTier.name} \uC774\uC0C1`}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-100 bg-white p-4">
          <h4 className="mb-3 text-xs font-semibold text-slate-500">
            {"\uC9C4\uD589 \uAC00\uB2A5 \uC694\uC77C / \uC2DC\uAC04"}
          </h4>

          <div className="mb-3 flex items-center gap-3">
            <div className="flex gap-1">
              {dayLabels.map((label, index) => {
                const isOn = daysOfWeek.includes(index);
                return (
                  <span
                    key={`${label}-${index}`}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                      isOn
                        ? "bg-emerald-500 text-white"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {label}
                  </span>
                );
              })}
            </div>

            <div className="inline-flex items-center gap-1 text-xs text-slate-500">
              <ClockIcon className="h-4 w-4" />
              {availability?.startTime && availability?.endTime
                ? `${availability.startTime} ~ ${availability.endTime}`
                : "\uC2DC\uAC04 \uC81C\uD55C \uC5C6\uC74C"}
            </div>
          </div>

          <p className="text-xs text-slate-500">
            {"\uC624\uB298 "}
            <span className="font-semibold text-slate-700">{todayCount}</span>
            {`/${maxPerDay}\uD68C \uC81C\uCD9C\uD588\uC5B4\uC694.`}
          </p>
        </div>

        {requiresSubmission && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-700">
                {"\uC81C\uCD9C \uB0B4\uC6A9"}
              </div>
              <span
                className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                  needsSubmissionContent
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {needsSubmissionContent
                  ? "\uC791\uC131 \uD544\uC694"
                  : "\uC791\uC131 \uC644\uB8CC"}
              </span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
              <ModernRichEditor
                value={content}
                onChange={setContent}
                height="240px"
                toolbar="standard"
                placeholder={
                  "\uC218\uD589 \uB0B4\uC6A9\uC744 \uC791\uC131\uD574 \uC8FC\uC138\uC694."
                }
              />
            </div>
            <p
              className={`text-xs font-medium ${
                needsSubmissionContent ? "text-amber-700" : "text-slate-500"
              }`}
            >
              {needsSubmissionContent
                ? "\uC2B9\uC778 \uC694\uCCAD \uC804\uC5D0 \uC81C\uCD9C \uB0B4\uC6A9\uC744 \uBA3C\uC800 \uC791\uC131\uD574 \uC8FC\uC138\uC694."
                : "\uC791\uC131\uD55C \uB0B4\uC6A9\uACFC \uD568\uAED8 \uC2B9\uC778 \uC694\uCCAD\uC774 \uC811\uC218\uB429\uB2C8\uB2E4."}
            </p>
          </div>
        )}

        <div
          className={`rounded-lg border p-4 ${
            !isTierBlocked && canTodayByDay && isWithinTime && !isFullToday
              ? "border-emerald-200 bg-emerald-50"
              : isTierBlocked
                ? "border-rose-200 bg-rose-50"
              : "border-slate-200 bg-slate-50"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {"\uC624\uB298 \uC0C1\uD0DC"}
              </p>
              <p className="text-xs text-slate-500">
                {isTierBlocked
                  ? `\uD604\uC7AC\uB294 \uC2E0\uC6A9\uB4F1\uAE09 ${minTier?.name || ""} \uC774\uC0C1 \uD559\uC0DD\uB9CC \uC218\uD589\uD560 \uC218 \uC788\uC5B4\uC694.`
                  : !canTodayByDay
                  ? "\uC624\uB298\uC740 \uC218\uD589\uD560 \uC218 \uC5C6\uB294 \uC694\uC77C\uC785\uB2C8\uB2E4."
                  : !isWithinTime
                    ? "\uD604\uC7AC \uC81C\uCD9C \uAC00\uB2A5\uD55C \uC2DC\uAC04\uC774 \uC544\uB2D9\uB2C8\uB2E4."
                    : isFullToday
                      ? "\uC624\uB298 \uC81C\uCD9C \uAC00\uB2A5\uD55C \uD69F\uC218\uB97C \uBAA8\uB450 \uC0AC\uC6A9\uD588\uC2B5\uB2C8\uB2E4."
                      : isManual
                        ? "\uC81C\uCD9C \uD6C4 \uC120\uC0DD\uB2D8 \uC2B9\uC778 \uB4A4 \uBCF4\uC0C1\uC774 \uC9C0\uAE09\uB429\uB2C8\uB2E4."
                        : "\uC81C\uCD9C \uC989\uC2DC \uBCF4\uC0C1\uC774 \uC9C0\uAE09\uB429\uB2C8\uB2E4."}
              </p>
            </div>

            <button
              type="button"
              onClick={handleDoToday}
              disabled={
                isSubmitting ||
                isTierBlocked ||
                !canTodayByDay ||
                !isWithinTime ||
                isFullToday ||
                needsSubmissionContent
              }
              className={`inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-medium ${
                !isTierBlocked &&
                canTodayByDay &&
                isWithinTime &&
                !isFullToday &&
                !needsSubmissionContent
                  ? "bg-emerald-500 text-white hover:bg-emerald-600"
                  : "cursor-not-allowed bg-slate-300 text-slate-600"
              }`}
            >
              {isSubmitting
                ? "\uC81C\uCD9C \uC911..."
                : isTierBlocked
                  ? "\uC2E0\uC6A9\uB4F1\uAE09 \uC81C\uD55C"
                : needsSubmissionContent
                  ? "\uB0B4\uC6A9 \uC791\uC131 \uD544\uC694"
                : isManual
                  ? "\uC2B9\uC778 \uC694\uCCAD"
                  : "\uC624\uB298 \uD558\uAE30"}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <SharedUiButton tone="slate" kind="soft" size="sm"
          type="button"
          onClick={onClose}
          
        >
          {"\uB2EB\uAE30"}
        </SharedUiButton>
      </div>
    </Modal>
  );
}
