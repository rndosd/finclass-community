import React, { useMemo, useState } from "react";
import {
  ClockIcon,
  TrashIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import MissionAlwaysTeacherModal from "../../modals/MissionAlwaysTeacherModal";
import { getAlwaysMissionPendingCount } from "./alwaysMissionDisplay";
import MissionVisibilityPill from "./MissionVisibilityPill";
import { Button } from "../../../../../components/ui";
import "../../teacherMissionViews.css";

const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

const AlwaysMissionCard = ({
  mission,
  onEditMission,
  onDeleteMission,
  onToggleStudentVisible,
  isVisibleInStudentView = false,
  onToggleStudentView,
  studentViewLoading = false,
  classId,
  studentMatrix,
  todayCount = 0,
  maxPerDay = 1,
  readOnly = false,
}) => {
  const [openModal, setOpenModal] = useState(false);

  const pendingApprovalCount = useMemo(
    () => getAlwaysMissionPendingCount(mission),
    [mission],
  );

  const isStudentVisible =
    mission?.availability?.studentVisible !== false &&
    mission?.availability?.availabilityStudentVisible !== false;

  const handleTogglePublic = (event) => {
    event.stopPropagation();
    if (readOnly) return;
    onToggleStudentVisible?.(mission.id, !isStudentVisible);
  };

  const handleToggleStatus = (event) => {
    event.stopPropagation();
    if (readOnly) return;
    onToggleStudentView?.(mission.id, !isVisibleInStudentView);
  };

  const handleEdit = (event) => {
    event.stopPropagation();
    if (readOnly) return;
    onEditMission?.(mission);
  };

  const handleDelete = async (event) => {
    event.stopPropagation();
    if (readOnly) return;
    await onDeleteMission?.(mission);
  };

  const { startTime, endTime, daysOfWeek } = mission?.availability || {};
  const timeLabel = `${startTime || "09:00"} - ${endTime || "18:00"}`;

  const daysContent = useMemo(() => {
    const targetDays = Array.isArray(daysOfWeek) ? daysOfWeek : [1, 2, 3, 4, 5];

    return (
      <div className="mt-2 flex flex-wrap gap-1" aria-label={`운영 요일: ${targetDays.map((day) => DOW_LABELS[day]).join(", ")}`}>
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const isActive = targetDays.includes(day);

          return (
            <span
              key={day}
              title={`${DOW_LABELS[day]}요일 ${isActive ? "운영" : "미운영"}`}
              className={`flex h-6 w-6 items-center justify-center rounded-md border text-xs font-semibold ${
                isActive
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-500 line-through"
              }`}
            >
              {DOW_LABELS[day]}
            </span>
          );
        })}
      </div>
    );
  }, [daysOfWeek]);

  const cardEnabled = isStudentVisible || isVisibleInStudentView;

  return (
    <>
      <div className="w-[380px] max-w-[calc(100vw-3rem)] flex-shrink-0">
        <div
          className={`mission-week-card ${pendingApprovalCount > 0 ? "is-pending" : ""}`}
        >
          <div className={`mission-week-card-main p-4 ${readOnly ? "cursor-default" : ""}`}
            role={!readOnly ? "button" : undefined}
            tabIndex={!readOnly ? 0 : undefined}
            aria-label={`${mission?.title || "상시 과제"} 상세`}
            onClick={() => { if (!readOnly) setOpenModal(true); }}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ") && !readOnly) {
                event.preventDefault();
                setOpenModal(true);
              }
            }}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 text-left">
                <h4
                  className={`line-clamp-1 text-[14px] font-black leading-tight ${
                    cardEnabled ? "text-slate-800" : "text-slate-500"
                  }`}
                >
                  {mission?.title || "상시 과제"}
                </h4>
                <p className="mt-2 line-clamp-2 text-xs text-slate-600">
                  {mission?.description || "반복 운영하는 상시과제입니다."}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <MissionVisibilityPill
                  label="공개"
                  inactiveLabel="비공개"
                  active={isStudentVisible}
                  onClick={handleTogglePublic}
                  disabled={readOnly || studentViewLoading}
                  activeTone="blue"
                  title="학생 화면에 공개"
                />
                <MissionVisibilityPill
                  label="현황 표시"
                  inactiveLabel="현황 숨김"
                  active={isVisibleInStudentView}
                  onClick={handleToggleStatus}
                  disabled={readOnly || studentViewLoading}
                  activeTone="blue"
                  title="학생별 과제 현황에 표시"
                />
            </div>
            <div className="mt-4 border-t border-slate-100 pt-3 text-left">
              <div>
                <div className="flex items-center gap-1 text-xs font-semibold text-slate-600">
                  <ClockIcon className="h-3.5 w-3.5 text-slate-400" />
                  {timeLabel}
                </div>
                {daysContent}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
                <span>오늘 수행</span>
                <span className="font-semibold text-slate-800">
                  {todayCount}/{maxPerDay}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                <span>승인 대기</span>
                <span
                  className={`mt-1 inline-flex min-w-8 items-center justify-center rounded-lg px-2 py-0.5 text-sm font-black ${
                    pendingApprovalCount > 0
                      ? "bg-amber-50 text-amber-900"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {pendingApprovalCount}
                </span>
              </div>
            </div>
          </div>

          {!readOnly && <div className="mission-week-card-actions justify-end">
            <Button
              tone="slate" kind="ghost" size="xs"
              type="button"
              onClick={handleEdit}
              className="inline-flex items-center gap-1"
            >
              <PencilSquareIcon className="h-3.5 w-3.5" />
              수정
            </Button>
            <Button tone="rose" kind="ghost" size="xs"
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center gap-1"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              삭제
            </Button>
          </div>}
        </div>
      </div>

      {openModal ? (
        <MissionAlwaysTeacherModal
          isOpen={openModal}
          onClose={() => setOpenModal(false)}
          mission={mission}
          classId={classId}
          studentMatrix={studentMatrix}
        />
      ) : null}
    </>
  );
};

export default AlwaysMissionCard;
