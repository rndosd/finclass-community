import React, { useMemo, useState } from "react";
import { Bars3Icon, ClockIcon, InboxIcon, PencilSquareIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Button } from "../../../../../components/ui";
import MissionAlwaysTeacherModal from "../../modals/MissionAlwaysTeacherModal";
import { reorderAlwaysMissions } from "../../../services/missionService";
import { useUser } from "../../../../../contexts/UserContext";
import { getAlwaysMissionPendingCount, getAlwaysMissionPendingTotal } from "./alwaysMissionDisplay";
import MissionVisibilityPill from "./MissionVisibilityPill";

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

const AlwaysMissionView = ({
  missions = [], onRefresh, onDeleteMission, onEditMission,
  onToggleStudentVisible, isVisibleInStudentView, onToggleStudentView,
  studentViewLoading = false, classId, studentMatrix, selectionMode = false,
  isSelected, startDragSelect, enterDragSelect, readOnly = false,
}) => {
  const { classId: contextClassId } = useUser();
  const effectiveClassId = classId || contextClassId;
  const [sortConfig, setSortConfig] = useState({ key: "displayOrder", direction: "asc" });
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedMission, setSelectedMission] = useState(null);
  const [draggedMissionId, setDraggedMissionId] = useState(null);
  const [dragOverMissionId, setDragOverMissionId] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);

  const alwaysMissions = useMemo(
    () => missions.filter((mission) => mission.type === "always"),
    [missions],
  );

  const sortedMissions = useMemo(() => {
    const sorted = [...alwaysMissions];
    sorted.sort((a, b) => {
      if (sortConfig.key === "displayOrder") {
        const orderA = Number.isFinite(Number(a?.displayOrder)) ? Number(a.displayOrder) : Number.MAX_SAFE_INTEGER;
        const orderB = Number.isFinite(Number(b?.displayOrder)) ? Number(b.displayOrder) : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return toMillis(b?.createdAt) - toMillis(a?.createdAt);
      }
      const aVal = sortConfig.key === "title" ? (a.title || "").toLowerCase() : toMillis(a.createdAt);
      const bVal = sortConfig.key === "title" ? (b.title || "").toLowerCase() : toMillis(b.createdAt);
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [alwaysMissions, sortConfig]);

  const todayKey = useMemo(() => new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()), []);

  const todaySummaries = useMemo(() => {
    const summaries = {};
    sortedMissions.forEach((mission) => {
      const maxPerDay =
        (typeof mission?.availability?.maxPerDay === "number" && mission.availability.maxPerDay) ||
        (typeof mission?.maxPerDay === "number" && mission.maxPerDay) || 1;
      let todayCount = Number(mission?.stats?.todayCount || 0);
      if (!Number.isFinite(todayCount) || todayCount <= 0) {
        todayCount = Object.values(mission?.lastAttempts || {}).filter((attempt) =>
          attempt?.dayKey === todayKey &&
          ["approved", "pending"].includes(attempt?.status || "approved"),
        ).length;
      }
      summaries[mission.id] = { todayCount, maxPerDay };
    });
    return summaries;
  }, [sortedMissions, todayKey]);

  const isCustomOrder = sortConfig.key === "displayOrder" && !selectionMode && !readOnly;

  const handleSort = (key) => {
    if (key === "displayOrder") return setSortConfig({ key, direction: "asc" });
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const handleDelete = async (event, mission) => {
    event.stopPropagation();
    if (selectionMode || readOnly || !onDeleteMission) return;
    try {
      await onDeleteMission(mission);
      onRefresh?.();
    } catch (error) {
      console.error("always mission delete failed:", error);
    }
  };

  const handleToggleVisible = async (event, mission) => {
    event.stopPropagation();
    if (selectionMode || readOnly || !onToggleStudentVisible || studentViewLoading) return;
    await onToggleStudentVisible(mission.id, mission.availability?.studentVisible === false);
  };

  const handleToggleStatus = async (event, mission) => {
    event.stopPropagation();
    if (selectionMode || readOnly || !onToggleStudentView || studentViewLoading) return;
    await onToggleStudentView(mission.id, !isVisibleInStudentView?.(mission.id));
  };

  const handleRowClick = (mission) => {
    if (selectionMode || readOnly) return;
    setSelectedMission(mission);
    setDetailOpen(true);
  };

  const handleDrop = async (targetMissionId) => {
    if (!draggedMissionId || draggedMissionId === targetMissionId) {
      setDraggedMissionId(null);
      setDragOverMissionId(null);
      return;
    }
    const sourceIndex = sortedMissions.findIndex(({ id }) => id === draggedMissionId);
    const targetIndex = sortedMissions.findIndex(({ id }) => id === targetMissionId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const reordered = [...sortedMissions];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    try {
      setSavingOrder(true);
      await reorderAlwaysMissions(effectiveClassId, reordered);
      onRefresh?.();
    } catch (error) {
      console.error("always reorder failed:", error);
    } finally {
      setSavingOrder(false);
      setDraggedMissionId(null);
      setDragOverMissionId(null);
    }
  };

  const renderDays = (days = []) => {
    const targetDays = Array.isArray(days) ? days : [1, 2, 3, 4, 5];
    return <div className="mt-0.5 flex gap-0.5">{[1, 2, 3, 4, 5, 6, 0].map((day) => (
      <span key={day} className={`flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold ${
        targetDays.includes(day) ? "bg-slate-100 text-slate-600" : "bg-slate-50 text-slate-300"
      }`}>{DOW_LABELS[day]}</span>
    ))}</div>;
  };

  const publicCount = alwaysMissions.filter((mission) => mission.availability?.studentVisible !== false).length;
  const statusCount = alwaysMissions.filter((mission) => isVisibleInStudentView?.(mission.id)).length;
  const totalPendingCount = getAlwaysMissionPendingTotal(alwaysMissions);
  const sortButtonClass = (key) => `rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
    sortConfig.key === key
      ? "border-indigo-200 bg-indigo-50 text-indigo-700"
      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
  }`;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-black text-slate-800">상시과제</h3>
          {totalPendingCount > 0 ? <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-rose-500 px-2 py-1 text-xs font-black text-white">{totalPendingCount > 99 ? "99+" : totalPendingCount}</span> : null}
          <span className="h-5 w-px bg-slate-200" />
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">공개&nbsp;&nbsp;{publicCount}</span>
          <span className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-sky-700">현황&nbsp;&nbsp;{statusCount}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" onClick={() => handleSort("displayOrder")} className={sortButtonClass("displayOrder")}><span className="flex items-center gap-1.5"><Bars3Icon className="h-4 w-4" />사용자 순서</span></Button>
          <Button type="button" onClick={() => handleSort("createdAt")} className={sortButtonClass("createdAt")}>생성순</Button>
          <Button type="button" onClick={() => handleSort("title")} className={sortButtonClass("title")}>제목</Button>
        </div>
      </div>

      {sortedMissions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <InboxIcon className="h-10 w-10 text-slate-200" />
          <h4 className="mt-3 font-bold text-slate-700">등록된 상시과제가 없습니다</h4>
          <p className="mt-1 text-sm text-slate-400">상시과제를 만들면 이곳에서 운영 상태를 관리할 수 있습니다.</p>
        </div>
      ) : <>
        <div className="space-y-3 p-4 md:hidden">
          {sortedMissions.map((mission) => {
            const availability = mission.availability || {};
            const isVisible = availability.studentVisible !== false;
            const isStatusVisible = !!isVisibleInStudentView?.(mission.id);
            const pendingCount = getAlwaysMissionPendingCount(mission);
            const summary = todaySummaries[mission.id] || { todayCount: 0, maxPerDay: 1 };
            return <section key={mission.id} onMouseDown={() => selectionMode && startDragSelect?.(mission.id)} onMouseEnter={() => selectionMode && enterDragSelect?.(mission.id)} onClick={() => handleRowClick(mission)} className={`rounded-2xl border p-4 ${selectionMode && isSelected?.(mission.id) ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h4 className="line-clamp-1 font-black text-slate-800">{mission.title}</h4><p className="mt-1 line-clamp-1 text-xs text-slate-400">{mission.description || "반복 운영하는 상시과제입니다."}</p></div>
                {!selectionMode ? <div className="flex gap-1"><MissionVisibilityPill label="공개" active={isVisible} onClick={(event) => handleToggleVisible(event, mission)} disabled={readOnly || studentViewLoading} activeTone="emerald" /><MissionVisibilityPill label="현황" active={isStatusVisible} onClick={(event) => handleToggleStatus(event, mission)} disabled={readOnly || studentViewLoading} activeTone="blue" /></div> : null}
              </div>
              <div className="mt-4 grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 pt-3 text-center text-xs">
                <div className="pr-2 text-left text-slate-600"><span className="flex items-center gap-1 font-bold"><ClockIcon className="h-3.5 w-3.5" />{availability.startTime || "09:00"} - {availability.endTime || "18:00"}</span></div>
                <div><span className="block text-slate-400">오늘 수행</span><strong>{summary.todayCount}/{summary.maxPerDay}</strong></div>
                <div><span className="block text-slate-400">확인 대기</span><strong className={pendingCount > 0 ? "text-amber-600" : "text-slate-500"}>{pendingCount}</strong></div>
              </div>
            </section>;
          })}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1050px] border-collapse">
            <thead><tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-black tracking-wide text-slate-500"><th className="w-[31%] px-6 py-4 text-left">과제 정보</th><th className="w-[23%] px-4 py-4 text-left">운영 정보</th><th className="px-4 py-4 text-center">수행 현황</th><th className="px-4 py-4 text-center">확인 대기</th><th className="px-4 py-4 text-center">공개</th><th className="px-4 py-4 text-center">현황 표시</th><th className="px-6 py-4 text-right">관리</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {sortedMissions.map((mission) => {
                const availability = mission.availability || {};
                const isVisible = availability.studentVisible !== false;
                const isStatusVisible = !!isVisibleInStudentView?.(mission.id);
                const pendingCount = getAlwaysMissionPendingCount(mission);
                const summary = todaySummaries[mission.id] || { todayCount: 0, maxPerDay: 1 };
                const checked = !!isSelected?.(mission.id);
                return <tr key={mission.id} draggable={isCustomOrder} onDragStart={() => !savingOrder && setDraggedMissionId(mission.id)} onDragOver={(event) => { if (!isCustomOrder) return; event.preventDefault(); setDragOverMissionId(mission.id); }} onDragEnd={() => { setDraggedMissionId(null); setDragOverMissionId(null); }} onDrop={(event) => { event.preventDefault(); handleDrop(mission.id); }} onMouseDown={() => selectionMode && startDragSelect?.(mission.id)} onMouseEnter={() => selectionMode && enterDragSelect?.(mission.id)} onClick={() => handleRowClick(mission)} className={`group cursor-pointer transition-colors hover:bg-blue-50/30 ${selectionMode && checked ? "bg-rose-50" : "bg-white"} ${dragOverMissionId === mission.id ? "ring-2 ring-inset ring-indigo-200" : ""}`}>
                  <td className="px-6 py-4"><div className="flex items-center gap-3"><span className={`text-slate-300 ${isCustomOrder ? "cursor-grab" : "invisible"}`} title="드래그하여 순서 변경"><Bars3Icon className="h-4 w-4" /></span><div className="min-w-0"><div className="flex items-center gap-2">{selectionMode ? <span className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${checked ? "border-rose-500 bg-rose-500 text-white" : "border-slate-300 text-transparent"}`}>✓</span> : null}<h4 className="line-clamp-1 text-[13px] font-bold text-slate-800">{mission.title}</h4></div><p className="mt-0.5 line-clamp-1 text-[10px] text-slate-400">{mission.description || "반복 운영하는 상시과제입니다."}</p></div></div></td>
                  <td className="px-4 py-4"><div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600"><ClockIcon className="h-3.5 w-3.5 text-slate-400" />{availability.startTime || "09:00"} - {availability.endTime || "18:00"}</div>{renderDays(availability.daysOfWeek)}</td>
                  <td className="px-4 py-4 text-center text-xs font-black text-slate-800">{summary.todayCount}/{summary.maxPerDay}</td>
                  <td className="px-4 py-4 text-center">{pendingCount > 0 ? <span className="inline-flex min-w-10 items-center justify-center rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-600">{pendingCount}건</span> : <span className="text-xs font-medium text-slate-300">-</span>}</td>
                  {selectionMode || readOnly ? <><td className="px-4 py-4 text-center text-slate-300">-</td><td className="px-4 py-4 text-center text-slate-300">-</td></> : <><td className="px-4 py-4 text-center" onClick={(event) => event.stopPropagation()}><MissionVisibilityPill label={isVisible ? "공개" : "비공개"} active={isVisible} onClick={(event) => handleToggleVisible(event, mission)} disabled={studentViewLoading} activeTone="emerald" /></td><td className="px-4 py-4 text-center" onClick={(event) => event.stopPropagation()}><MissionVisibilityPill label="현황" active={isStatusVisible} onClick={(event) => handleToggleStatus(event, mission)} disabled={studentViewLoading} activeTone="blue" /></td></>}
                  <td className="px-6 py-4" onClick={(event) => event.stopPropagation()}>{!selectionMode && !readOnly ? <div className="flex items-center justify-end gap-1"><Button tone="slate" kind="ghost" size="icon-md" type="button" onClick={() => onEditMission?.(mission)}  title="수정"><PencilSquareIcon className="h-4 w-4" /></Button><Button tone="slate" kind="ghost" size="icon-md" type="button" onClick={(event) => handleDelete(event, mission)}  title="삭제"><TrashIcon className="h-4 w-4" /></Button></div> : <span className="block text-right text-slate-300">-</span>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </>}

      {!selectionMode && detailOpen && selectedMission ? <MissionAlwaysTeacherModal isOpen={detailOpen} onClose={() => { setDetailOpen(false); setSelectedMission(null); }} mission={selectedMission} classId={effectiveClassId} studentMatrix={studentMatrix} /> : null}
    </div>
  );
};

export default AlwaysMissionView;
