import "../../teacherMissionViews.css";
import React, { useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import {
  DocumentTextIcon,
  CheckCircleIcon,
  PencilSquareIcon,
  InboxIcon,
} from "@heroicons/react/24/outline";
import { Button } from "../../../../../components/ui";
import MissionDetailModal from "../../modals/MissionDetailModal";
import MissionVisibilityPill from "./MissionVisibilityPill";
import { getMissionProgressSummary } from "./missionProgressSummary";

const MissionListView = ({
  missions = [],
  onApproveMany,
  onCancelMany,
  onRejectMany,
  onSaveFeedbackMany,
  studentMatrix = [],
  onEditMission,
  isVisibleInStudentView,
  onToggleStudentView,
  studentViewLoading,
  selectionMode = false,
  isSelected,
  toggleSelect,
  startDragSelect,
  enterDragSelect,
  readOnly = false,
}) => {
  const [sortConfig, setSortConfig] = useState({
    key: "updatedAt",
    direction: "desc",
  });
  const [selectedMissionId, setSelectedMissionId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const suppressNextSelectionClickRef = useRef(false);

  const toDateSafe = (value) => {
    if (!value) return null;
    const date = value?.toDate ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const schedule = (mission) => {
    const start = toDateSafe(mission?.timeWindow?.start || mission?.startDate);
    const end = toDateSafe(mission?.timeWindow?.end || mission?.endDate);
    if (start && end) return dayjs(start).format("MM.DD HH:mm") + " – " + dayjs(end).format("MM.DD HH:mm");
    if (start) return dayjs(start).format("MM.DD HH:mm") + " – 마감 없음";
    if (end) return dayjs(end).format("MM.DD HH:mm") + " 마감";
    return "일정 정보 없음";
  };

  const processedMissions = useMemo(() => {
    const now = new Date();

    return missions.map((mission) => {
      const progress = getMissionProgressSummary(mission, studentMatrix);

      const end = mission?.timeWindow?.end || mission?.endDate;
      const isExpired = end
        ? now > (end.toDate ? end.toDate() : new Date(end))
        : false;

      return {
        ...mission,
        ...progress,
        isExpired,
        hasForm: !!mission?.requireSubmissionForm,
      };
    });
  }, [missions, studentMatrix]);

  const sortedMissions = useMemo(() => {
    const sorted = [...processedMissions];
    sorted.sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (sortConfig.key === "createdAt" || sortConfig.key === "updatedAt") {
        aVal =
          sortConfig.key === "updatedAt"
            ? toDateSafe(a.updatedAt || a.createdAt)
            : toDateSafe(a.createdAt || a.updatedAt);
        bVal =
          sortConfig.key === "updatedAt"
            ? toDateSafe(b.updatedAt || b.createdAt)
            : toDateSafe(b.createdAt || b.updatedAt);
      }

      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [processedMissions, sortConfig]);

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const selectedMission = processedMissions.find((m) => m.id === selectedMissionId);

  const handleRowClick = (mission) => {
    if (readOnly) return;
    if (selectionMode) {
      if (suppressNextSelectionClickRef.current) {
        suppressNextSelectionClickRef.current = false;
        return;
      }
      toggleSelect?.(mission.id);
      return;
    }
    setSelectedMissionId(mission.id);
    setDetailOpen(true);
  };

  const handleSelectionMouseDown = (missionId) => {
    if (!selectionMode) return;
    suppressNextSelectionClickRef.current = true;
    startDragSelect?.(missionId);
  };

  return (
    <>
      <div className="teacher-mission-list overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm">
        <div className="space-y-3 p-4 md:hidden">
          {sortedMissions.map((mission) => {
            const visible = isVisibleInStudentView?.(mission.id);
            const checked =
              typeof isSelected === "function" ? isSelected(mission.id) : false;
            const progress =
              mission.targetCount > 0
                ? Math.round((mission.approvedCount / mission.targetCount) * 100)
                : 0;

            return (
              <section
                key={mission.id}
                className={`rounded-2xl border p-4 ${
                  selectionMode && checked
                    ? "border-rose-300 bg-rose-50"
                    : mission.isExpired
                      ? "border-slate-200 bg-slate-50"
                      : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  {selectionMode ? (
                    <button
                      type="button"
                      onClick={() => handleRowClick(mission)}
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-sm font-black ${
                        checked
                          ? "border-rose-500 bg-rose-500 text-white"
                          : "border-slate-300 bg-white text-transparent"
                      }`}
                      aria-label={`${mission.title} ${checked ? "선택 해제" : "선택"}`}
                    >
                      ✓
                    </button>
                  ) : mission.hasForm ? (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <DocumentTextIcon className="h-5 w-5" />
                    </span>
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                      <CheckCircleIcon className="h-5 w-5" />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleRowClick(mission)}
                        className={`min-h-11 flex-1 text-left font-bold ${
                          mission.isExpired ? "text-slate-500" : "text-slate-800"
                        }`}
                      >
                        <span className="line-clamp-2">{mission.title}</span>
                      </button>
                      {mission.isExpired ? (
                        <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
                          마감
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {mission.pendingCount > 0
                        ? `승인 대기 ${mission.pendingCount}건`
                        : "승인 대기 없음"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{mission.hasForm ? "제출물" : "완료 요청"} · {schedule(mission)}</p>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-1.5 flex justify-between text-xs font-semibold">
                    <span className="text-slate-500">
                      완료 {mission.approvedCount}/{mission.targetCount}
                    </span>
                    <span className="text-slate-400">{progress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${
                        mission.isAllApproved ? "bg-emerald-500" : "bg-blue-500"
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {!selectionMode && !readOnly ? (
                  <div
                    className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MissionVisibilityPill
                      label="학생 현황 표시"
                      active={visible}
                      onClick={() => onToggleStudentView?.(mission.id, !visible)}
                      disabled={studentViewLoading}
                      activeTone="blue"
                      title="학생별 과제 현황에 표시"
                    />
                    <Button
                      type="button"
                      onClick={() => onEditMission?.(mission)}
                      kind="outline"
                      tone="slate"
                      size="sm"
                      icon={PencilSquareIcon}
                      className="justify-center"
                    >
                      수정
                    </Button>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full border-collapse">
            <thead><tr className="border-b bg-slate-50 text-xs font-semibold text-slate-500">
              <th className="px-6 py-3 text-left" aria-sort={sortConfig.key === "title" ? sortConfig.direction === "asc" ? "ascending" : "descending" : "none"}>
                <button type="button" onClick={() => handleSort("title")}>과제 / 기간 {sortConfig.key === "title" ? sortConfig.direction === "asc" ? "↑" : "↓" : ""}</button>
              </th><th className="px-4 py-3 text-left">수행 현황</th><th className="px-4 py-3 text-left">승인 대기</th><th className="px-6 py-3 text-right">관리</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">{sortedMissions.map((mission) => {
              const visible = isVisibleInStudentView?.(mission.id);
              const checked = typeof isSelected === "function" && isSelected(mission.id);
              return <tr key={mission.id} onMouseDown={() => handleSelectionMouseDown(mission.id)} onMouseEnter={() => selectionMode && enterDragSelect?.(mission.id)} onClick={() => handleRowClick(mission)} className={"cursor-pointer transition-colors hover:bg-slate-50 " + (selectionMode && checked ? "bg-rose-100/70" : "bg-white")}>
                <td className="px-6 py-5"><div className="flex items-center gap-2">
                  {selectionMode && <span className={"inline-flex h-5 w-5 items-center justify-center rounded border " + (checked ? "border-rose-500 bg-rose-500 text-white" : "border-slate-200 text-transparent")}>✓</span>}
                  <button type="button" className="mission-list-title" disabled={readOnly} onClick={(event) => { event.stopPropagation(); handleRowClick(mission); }}>{mission.title}</button>
                  {mission.isExpired && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">마감</span>}
                </div><div className="mission-list-meta">{mission.hasForm ? <DocumentTextIcon/> : <CheckCircleIcon/>}<span>{mission.hasForm ? "제출물" : "완료 요청"}</span><span>·</span><span>{schedule(mission)}</span>{mission.isAllApproved && <span className="text-emerald-700">전체 완료</span>}</div></td>
                <td className="px-4 py-5"><div className="mission-list-progress"><div className="mission-list-progress-label"><span><strong>{mission.approvedCount}</strong> / {mission.targetCount}명 완료</span><span>{mission.completionRate}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={"h-full rounded-full " + (mission.isAllApproved ? "bg-emerald-500" : "bg-blue-500")} style={{width:mission.completionRate + "%"}}/></div></div></td>
                <td className="px-4 py-5">{mission.pendingCount > 0 ? selectionMode || readOnly ? <span className="text-xs font-semibold text-amber-700">승인 대기 {mission.pendingCount}건</span> : <Button size="sm" kind="outline" tone="amber" className="mission-list-pending" onClick={(event) => {event.stopPropagation(); handleRowClick(mission);}}>승인 대기 {mission.pendingCount}</Button> : <span className="text-xs text-slate-400">대기 없음</span>}</td>
                <td className="px-6 py-5" onClick={(event) => event.stopPropagation()}>{!selectionMode && !readOnly ? <div className="mission-list-management"><MissionVisibilityPill label="현황" active={visible} onClick={() => onToggleStudentView?.(mission.id,!visible)} disabled={studentViewLoading} activeTone="blue" title="학생별 과제 현황에 표시"/><Button kind="ghost" size="icon-md" tone="slate" onClick={() => onEditMission?.(mission)} title="수정" aria-label={mission.title + " 수정"}><PencilSquareIcon className="h-4 w-4"/></Button></div> : <span className="text-xs text-slate-400">—</span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>

        {missions.length === 0 ? (
          <div className="flex flex-col items-center py-24 opacity-20 grayscale">
            <InboxIcon className="mb-2 h-12 w-12 text-slate-400" />
            <p className="text-sm font-black text-slate-500">등록된 과제가 없습니다.</p>
          </div>
        ) : null}
      </div>

      {!readOnly && !selectionMode && detailOpen && selectedMission ? (
        <MissionDetailModal
          isOpen={detailOpen}
          onClose={() => {
            setDetailOpen(false);
            setSelectedMissionId(null);
          }}
          mission={selectedMission}
          studentMatrix={studentMatrix}
          onApproveMany={onApproveMany}
          onCancelMany={onCancelMany}
          onRejectMany={onRejectMany}
          onSaveFeedbackMany={onSaveFeedbackMany}
          onEditMission={onEditMission}
        />
      ) : null}
    </>
  );
};

export default MissionListView;
