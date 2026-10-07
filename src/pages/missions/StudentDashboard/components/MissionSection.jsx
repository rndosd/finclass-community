import React from "react";
import MissionCardStatus from "./MissionCardStatus";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { FlagIcon } from "@phosphor-icons/react/dist/csr/Flag";

import statusAvailableAsset from "../../../../assets/missions/mission-status-available.webp";
import statusCompletedAsset from "../../../../assets/missions/mission-status-completed.webp";
import statusLockedAsset from "../../../../assets/missions/mission-status-locked.webp";
import statusPendingAsset from "../../../../assets/missions/mission-status-pending.webp";
import { useUser } from "../../../../contexts/UserContext";
import { getRewardVisual } from "../../constants/rewardVisuals";
import { getMissionMinTierRequirement } from "../../utils/missionEligibility";
import { getRewardDisplayText } from "../../utils/rewardUtils";
import { Button } from "../../../../components/ui";

const MissionSection = ({
  section,
  selfUid,
  readOnly = false,
  classData,
  onMissionClick,
  onSubmit,
}) => {
  const { missionTokenLabel } = useUser();
  const currencyUnit = classData?.currencyUnit || "\uB2E8\uC704";

  const formatCompactDate = (date) => {
    if (!date) return "-";
    const resolved = date?.toDate ? date.toDate() : new Date(date);
    return `${resolved.getMonth() + 1}/${resolved.getDate()} ${String(
      resolved.getHours(),
    ).padStart(2, "0")}:${String(resolved.getMinutes()).padStart(2, "0")}`;
  };

  const renderMissionRow = (mission) => {
    const completion = mission.completions?.[selfUid] || null;
    const currentStatus = completion?.status;

    const isSubmitted = ["pending", "late"].includes(currentStatus);
    const isApproved = ["approved", "late-approved"].includes(currentStatus);
    const isRejected = currentStatus === "rejected";
    const hasFeedback = !!completion?.feedback;
    const isUrgent = mission.displayStatus === "urgent";
    const isOverdue = mission.displayStatus === "overdue";
    const hasForm = mission.requireSubmissionForm;
    const minTier = getMissionMinTierRequirement(mission);
    const isDeadlineClosed =
      isOverdue && mission.canSubmit === false && !isSubmitted && !isApproved;
    const canSubmit =
      !readOnly &&
      (typeof mission.canSubmit === "boolean"
        ? mission.canSubmit && !isSubmitted && !isApproved
        : ["available", "urgent", "overdue"].includes(mission.displayStatus) &&
          !isSubmitted &&
          !isApproved);

    const sideStatusLabel = readOnly
      ? "미리보기"
      : isApproved
        ? "완료"
        : isSubmitted
          ? "승인 대기"
          : isRejected
            ? "반려됨"
            : isDeadlineClosed
              ? "마감"
              : mission.displayStatus === "locked"
                ? "참여 제한"
                : "시작 전";

    const statusAsset = isApproved
      ? statusCompletedAsset
      : isSubmitted
        ? statusPendingAsset
        : isRejected || isDeadlineClosed
          ? statusLockedAsset
          : canSubmit
            ? statusAvailableAsset
            : statusLockedAsset;

    return (
      <li
        key={mission.id}
        className={`group flex flex-col gap-3 rounded-2xl border border-slate-100 p-4 transition-all lg:grid lg:grid-cols-[minmax(0,1fr)_100px_164px_172px] lg:items-center lg:gap-4 ${
          isUrgent
            ? "bg-red-50/40"
            : isOverdue && !isSubmitted && !isApproved
              ? "bg-orange-50/30"
              : "bg-white"
        } ${
          hasForm && !isApproved
            ? "border-l-4 border-l-blue-500"
            : isApproved
              ? "border-l-4 border-l-emerald-500"
              : "border-l-4 border-l-transparent"
        }`}
      >
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center">
            <img
              src={statusAsset}
              alt=""
              aria-hidden="true"
              className="h-11 w-11 object-contain"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={`truncate break-all text-base font-bold leading-6 tracking-tight ${isUrgent ? "text-red-700" : isApproved ? "text-emerald-700" : "text-slate-900"}`}
            >
              {mission.title}
            </p>
            {mission.description && (
              <p className="mt-1 line-clamp-1 break-all text-sm leading-5 text-slate-600">
                {mission.description}
              </p>
            )}
            {minTier && (
              <div className="mt-2 inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">
                <span className="text-xs font-bold">{`${minTier.name} \uC774\uC0C1`}</span>
              </div>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1 text-slate-500">
                <ClockIcon className="h-3.5 w-3.5" />
                <span className="sr-only">{"\uC2DC\uC791 "}</span>
                {formatCompactDate(mission.timeWindow?.start)}
              </span>
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold ${isOverdue && !isApproved ? "text-red-500" : "text-slate-600"}`}
              >
                <FlagIcon className="h-3.5 w-3.5" />
                <span className="sr-only">{"\uB9C8\uAC10 "}</span>
                {mission.timeWindow?.end
                  ? formatCompactDate(mission.timeWindow.end)
                  : "\uAE30\uD55C \uC5C6\uC74C"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3 py-1 lg:border-l lg:border-slate-100 lg:pl-4">
          <span className="sr-only">
            {"\uBCF4\uC0C1"}
          </span>
          <div className="flex min-w-0 flex-col items-start gap-1">
            {mission.rewards?.map((reward, index) => {
              const visual = getRewardVisual(reward.type);
              const VisualIcon = visual.icon;
              return (
                <span
                  key={`${mission.id}-${reward.type}-${index}`}
                  className="inline-flex max-w-full items-center gap-1.5 break-words text-[13px] font-semibold text-slate-800"
                >
                  <VisualIcon
                    className={{ credit: "text-indigo-600", currency: "text-amber-600", missionToken: "text-emerald-600" }[reward.type] || "text-slate-500"}
                    size={15}
                    strokeWidth={2.5}
                  />
                  {getRewardDisplayText(
                    reward,
                    currencyUnit,
                    missionTokenLabel,
                  )}
                </span>
              );
            })}
          </div>
        </div>
        <div aria-hidden="true" className="hidden lg:block" />
        <div
          className="mt-3 flex items-center gap-2 self-end lg:mt-0 lg:w-[172px] lg:justify-end lg:self-auto"
          onClick={(event) => event.stopPropagation()}
        >
          {!readOnly && (
            <Button tone="slate" kind="outline" size="xs"
              onClick={(event) => {
                event.stopPropagation();
                onMissionClick(mission, { mode: "view" });
              }}
              aria-label={hasFeedback ? "상세 · 선생님 피드백 있음" : "상세"}
              title={hasFeedback ? "제출 기록과 선생님 피드백 보기" : "과제 상세 보기"}
              className="relative w-16 shrink-0"
            >
              상세
              {hasFeedback && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
            </Button>
          )}
          {canSubmit ? (
            <Button
              onClick={(event) => {
                event.stopPropagation();
                if (hasForm) {
                  onMissionClick(mission);
                  return;
                }
                onSubmit(mission, "");
              }}
              className="h-9 w-[100px] shrink-0 rounded-xl border border-blue-600 bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-none transition-colors hover:bg-blue-700 active:scale-95"
            >
              {isOverdue
                ? "\uC9C0\uAC01 \uC81C\uCD9C"
                : hasForm
                  ? "\uC81C\uCD9C\uD558\uAE30"
                  : "\uC644\uB8CC\uD558\uAE30"}
            </Button>
          ) : (
            <MissionCardStatus tone={isApproved ? "completed" : isSubmitted ? "pending" : "neutral"}>
              {sideStatusLabel}
            </MissionCardStatus>
          )}
        </div>
      </li>
    );
  };

  return (
    <ul className="space-y-3">
      {section.missions.map((mission) => renderMissionRow(mission))}
    </ul>
  );
};

export default MissionSection;
