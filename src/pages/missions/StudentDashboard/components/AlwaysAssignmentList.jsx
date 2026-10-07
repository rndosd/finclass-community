import React from "react";
import TodayMissionCounts from "./TodayMissionCounts";
import MissionCardStatus from "./MissionCardStatus";
import {
  CalendarIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

import statusAvailableAsset from "../../../../assets/missions/mission-status-available.webp";
import statusCompletedAsset from "../../../../assets/missions/mission-status-completed.webp";
import statusLockedAsset from "../../../../assets/missions/mission-status-locked.webp";
import statusPendingAsset from "../../../../assets/missions/mission-status-pending.webp";
import { useUser } from "../../../../contexts/UserContext";
import { getRewardVisual } from "../../constants/rewardVisuals";
import {
  getMissionMinTierRequirement,
  meetsMissionTierRequirement,
} from "../../utils/missionEligibility";
import {
  getAlwaysMaxPerDay,
  getAlwaysAvailabilityDays,
  getTodayCountFromMissionState,
  isAlwaysAvailableOnDay,
  isWithinAlwaysTimeRange,
} from "../../utils/alwaysMissionState";
import { getRewardDisplayText } from "../../utils/rewardUtils";

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export default function AlwaysAssignmentList({
  missions = [],
  readOnly = false,
  onClickAssignment,
  onViewHistory,
  alwaysStateMap = {},
  classId,
  currencyUnit = "\uCF54\uC778",
}) {
  const { userData, missionTokenLabel } = useUser();

  const visibleMissions = missions
    .filter((mission) => {
      const availability = mission?.availability;
      if (!availability) return true;
      if (typeof availability.studentVisible === "boolean") {
        return availability.studentVisible;
      }
      if (typeof availability.availabilityStudentVisible === "boolean") {
        return availability.availabilityStudentVisible;
      }
      return true;
    })
    .sort((left, right) => {
      const leftOrder = Number.isFinite(Number(left?.displayOrder))
        ? Number(left.displayOrder)
        : Number.MAX_SAFE_INTEGER;
      const rightOrder = Number.isFinite(Number(right?.displayOrder))
        ? Number(right.displayOrder)
        : Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return toMillis(right?.createdAt) - toMillis(left?.createdAt);
    });

  if (!visibleMissions.length) {
    return (
      <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/50 p-4 text-sm text-emerald-700">
        {
          "\uC544\uC9C1 \uC0C1\uC2DC\uACFC\uC81C\uAC00 \uC5C6\uC5B4\uC694. \uC120\uC0DD\uB2D8\uC774 \uB098\uC911\uC5D0 \uB4F1\uB85D\uD558\uBA74 \uC5EC\uAE30\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4."
        }
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {visibleMissions.map((mission) => {
        const availability = mission.availability || {};
        const state = alwaysStateMap[mission.id] || {};
        const maxPerDay = getAlwaysMaxPerDay(mission);

        const todayCount = getTodayCountFromMissionState(state);
        const pendingCount = Number(state.pendingCount || 0);
        const canByDay = isAlwaysAvailableOnDay(availability);
        const canByTime = isWithinAlwaysTimeRange(availability);
        const isFullToday = todayCount >= maxPerDay;
        const minTier = getMissionMinTierRequirement(mission);
        const isTierBlocked =
          !readOnly &&
          !!minTier &&
          !meetsMissionTierRequirement(mission, userData || {});
        const canDoNow =
          !readOnly &&
          canByDay &&
          canByTime &&
          !isFullToday &&
          !isTierBlocked;

        const timeLabel =
          availability.startTime && availability.endTime
            ? `${availability.startTime} ~ ${availability.endTime}`
            : "\uC815\uD574\uC9C4 \uC2DC\uAC04 \uC5C6\uC74C";
        const days = getAlwaysAvailabilityDays(availability).sort((a, b) => a - b);
        const dayLabel = days.length === 7
          ? "매일"
          : days.join(",") === "1,2,3,4,5"
            ? "월–금"
            : days.map((day) => ["일", "월", "화", "수", "목", "금", "토"][day]).join("·");

        let statusMessage = readOnly ? "미리보기" : mission.requireSubmissionForm ? "제출하기" : "완료하기";

        if (!readOnly && isTierBlocked) {
          statusMessage = "\uC2E0\uC6A9\uB4F1\uAE09 \uBD80\uC871";
        } else if (!readOnly && !canByDay) {
          statusMessage = "\uC624\uB298 \uBD88\uAC00";
        } else if (!readOnly && isFullToday) {
          statusMessage =
            pendingCount > 0 && !mission.autoApprove
              ? "승인 대기"
              : "\uC624\uB298 \uC644\uB8CC";
        } else if (!readOnly && !canByTime) {
          statusMessage = "\uC2DC\uAC04 \uC678";
        }

        const statusAsset =
          isTierBlocked || !canByDay || !canByTime
            ? statusLockedAsset
            : isFullToday
              ? pendingCount > 0 && !mission.autoApprove
                ? statusPendingAsset
                : statusCompletedAsset
              : pendingCount > 0 && !mission.autoApprove
                ? statusPendingAsset
                : statusAvailableAsset;

        return (
          <li
            key={mission.id}
            className={`group flex flex-col gap-3 rounded-2xl border border-l-4 border-l-transparent border-slate-100 p-4 transition-all lg:grid lg:grid-cols-[minmax(0,1fr)_100px_164px_172px] lg:items-center lg:gap-4 ${
              isTierBlocked
                ? "bg-slate-50/80 opacity-80"
                : "bg-white"
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
                <div className="flex items-center gap-2">
                  <p className="truncate text-base font-bold leading-6 tracking-tight text-slate-900">
                    {mission.title || "\uC0C1\uC2DC\uACFC\uC81C"}
                  </p>
                </div>

                {mission.description && (
                  <p className="mt-1 truncate text-sm leading-5 text-slate-600">
                    {mission.description}
                  </p>
                )}

                {minTier && (
                  <div
                    className={`mt-2 inline-flex items-center gap-1 rounded-lg border px-2 py-1 ${
                      isTierBlocked
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    <span className="text-xs font-bold">
                      {`\uC2E0\uC6A9\uB4F1\uAE09 ${minTier.name} \uC774\uC0C1`}
                    </span>
                  </div>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs">
                  <span className="inline-flex items-center gap-1">
                    <ClockIcon className="h-3.5 w-3.5" />
                    {dayLabel} · {timeLabel}
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
                      <VisualIcon className={{ credit: "text-indigo-600", currency: "text-amber-600", missionToken: "text-emerald-600" }[reward.type] || "text-slate-500"} size={15} strokeWidth={2.5} />
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

            <TodayMissionCounts mission={mission} classId={classId} todayCount={todayCount} maxPerDay={maxPerDay} readOnly={readOnly} />

            <div className="mt-3 flex items-center gap-2 self-end lg:mt-0 lg:w-[172px] lg:justify-end lg:self-auto">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (readOnly) return;
                  onViewHistory?.(mission);
                }}
                disabled={readOnly}
                className="flex h-9 w-16 shrink-0 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                {"\uB0B4\uC5ED"}
              </button>

              {canDoNow ? <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (canDoNow) onClickAssignment?.(mission);
                }}
                className="h-9 w-[100px] shrink-0 whitespace-nowrap rounded-xl border border-blue-600 bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-none transition hover:bg-blue-700 active:scale-95"
              >
                {statusMessage}
              </button> : <MissionCardStatus tone={!readOnly && isFullToday ? (pendingCount > 0 && !mission.autoApprove ? "pending" : "completed") : "neutral"}>{statusMessage}</MissionCardStatus>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
