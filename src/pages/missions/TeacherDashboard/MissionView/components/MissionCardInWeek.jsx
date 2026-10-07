import React, { useMemo, useState } from "react";
import {
  CheckCircleIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import MissionDetailModal from "../../modals/MissionDetailModal";
import MissionVisibilityPill from "./MissionVisibilityPill";
import { getMissionProgressSummary } from "./missionProgressSummary";
import { Button } from "../../../../../components/ui";

const toDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateTime = (value) => {
  const dateValue = toDate(value);
  if (!dateValue) return null;

  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");
  const hour = String(dateValue.getHours()).padStart(2, "0");
  const minute = String(dateValue.getMinutes()).padStart(2, "0");

  return `${year}.${month}.${day} ${hour}:${minute}`;
};

const MissionCardInWeek = ({
  mission,
  onApproveMany,
  onCancelMany,
  onRejectMany,
  onSaveFeedbackMany,
  studentMatrix = [],
  onEditMission,
  selectionMode = false,
  isSelected = false,
  isVisibleInStudentView = false,
  onToggleStudentView,
  studentViewLoading = false,
  readOnly = false,
}) => {
  const [openDetail, setOpenDetail] = useState(false);

  const { approvedCount, pendingCount, isAllApproved, targetCount } = useMemo(() => {
    return getMissionProgressSummary(mission, studentMatrix);
  }, [mission, studentMatrix]);

  const endDate = useMemo(
    () => toDate(mission?.timeWindow?.end || mission?.endDate),
    [mission?.timeWindow?.end, mission?.endDate],
  );

  const isExpired = useMemo(() => {
    if (!endDate) return false;
    return new Date() > endDate;
  }, [endDate]);

  const hasAction = pendingCount > 0;
  const progressPercent = targetCount > 0 ? (approvedCount / targetCount) * 100 : 0;

  const dueInfo = useMemo(() => {
    if (!endDate) {
      return {
        label: "상시",
        tooltip: "마감 시간이 없습니다.",
      };
    }
    return {
      label: `${endDate.getMonth() + 1}.${endDate.getDate()} 마감`,
      tooltip: `${formatDateTime(endDate)} 마감`,
    };
  }, [endDate]);

  const handleCardClick = (event) => {
    if (readOnly) {
      event?.preventDefault?.();
      return;
    }
    if (selectionMode) {
      event?.preventDefault?.();
      return;
    }
    setOpenDetail(true);
  };

  const handleToggleView = async (event) => {
    event.stopPropagation();
    if (studentViewLoading || !onToggleStudentView) return;
    await onToggleStudentView(mission.id, !isVisibleInStudentView);
  };

  return (
    <div className={"mission-week-card " + (selectionMode && isSelected ? "is-selected" : hasAction ? "is-pending" : "")}>
      <div className="mission-week-card-main" role={!readOnly && !selectionMode ? "button" : undefined} tabIndex={!readOnly && !selectionMode ? 0 : undefined} onClick={handleCardClick} onKeyDown={(event) => {if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {event.preventDefault();handleCardClick(event);}}} aria-label={mission.title + " 상세"}>
        <h5 className="mission-week-card-title">{selectionMode && isSelected ? "✓ " : ""}{mission.title}</h5>
        <div className="mission-week-card-meta">{mission.requireSubmissionForm ? <DocumentTextIcon/> : <CheckCircleIcon/>}<span>{mission.requireSubmissionForm ? "제출물" : "완료 요청"}</span></div>
        <p className="mb-2 text-xs text-slate-500" title={dueInfo.tooltip}>{dueInfo.label}{isExpired ? " · 마감됨" : ""}</p>
        <div className="mission-week-card-progress"><span>완료 {approvedCount}/{targetCount}</span><span>{Math.round(progressPercent)}%</span></div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className={"h-full rounded-full " + (isAllApproved ? "bg-emerald-500" : "bg-blue-500")} style={{width:progressPercent + "%"}}/></div>
        {hasAction ? <div className="mission-week-card-pending">승인 대기 {pendingCount}명</div> : isAllApproved ? <p className="mt-2 text-xs text-emerald-700">전체 완료</p> : null}
      </div>
      {!selectionMode && !readOnly && <div className="mission-week-card-actions"><MissionVisibilityPill label="현황 표시" inactiveLabel="현황 숨김" active={isVisibleInStudentView} onClick={handleToggleView} disabled={studentViewLoading} activeTone="blue" title="학생별 과제 현황에 표시"/><Button tone="slate" kind="ghost" size="xs" onClick={() => onEditMission?.(mission)}>수정</Button></div>}

      {!readOnly && !selectionMode && openDetail ? (
        <MissionDetailModal
          isOpen={openDetail}
          onClose={() => setOpenDetail(false)}
          mission={mission}
          studentMatrix={studentMatrix}
          onApproveMany={onApproveMany}
          onCancelMany={onCancelMany}
          onRejectMany={onRejectMany}
          onSaveFeedbackMany={onSaveFeedbackMany}
          onEditMission={onEditMission}
        />
      ) : null}
    </div>
  );
};

export default MissionCardInWeek;
