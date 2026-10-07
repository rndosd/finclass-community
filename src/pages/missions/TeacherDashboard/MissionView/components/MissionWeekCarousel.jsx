import "../../teacherMissionViews.css";
import React, { useMemo, useState, useEffect, useCallback } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  PlusCircleIcon,
  ChevronDownIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { Button } from "../../../../../components/ui";

import MissionCardInWeek from "./MissionCardInWeek";
import AlwaysMissionCard from "./AlwaysMissionCard";
import { getAlwaysMissionPendingTotal } from "./alwaysMissionDisplay";

dayjs.extend(utc);
dayjs.extend(timezone);

const ALWAYS_SECTION_STORAGE_KEY = "missionWeekCarousel:alwaysSectionOpen";

const MissionWeekCarousel = ({
  missions = [],
  onRefresh,
  dateBasis = "createdAt",
  onApproveMany,
  onCancelMany,
  onRejectMany,
  onSaveFeedbackMany,
  studentMatrix = [],
  onDeleteMission,
  isVisibleInStudentView,
  onToggleStudentView,
  studentViewLoading,
  isMissionSelected,
  onToggleWeek,
  onEditMission,
  onToggleActualStudentVisible,
  classId,
  selectionMode = false,
  isSelected,
  startDragSelect,
  enterDragSelect,
  onVisibleMissionIdsChange,
  readOnly = false,
}) => {
  const [currentWeekIndex, setCurrentWeekIndex] = useState(0);
  const [hasInitialized, setHasInitialized] = useState(false);

  const [isAlwaysOpen, setIsAlwaysOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem(ALWAYS_SECTION_STORAGE_KEY);
    return saved !== "false";
  });

  const handleToggleAlways = () => {
    setIsAlwaysOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ALWAYS_SECTION_STORAGE_KEY, String(next));
      }
      return next;
    });
  };

  const todayKey = useMemo(
    () => dayjs().tz("Asia/Seoul").format("YYYY-MM-DD"),
    [],
  );

  const { alwaysMissions, normalMissions } = useMemo(() => {
    const always = [];
    const normal = [];
    for (const m of missions) {
      const availability =
        m?.availability && typeof m.availability === "object"
          ? m.availability
          : null;
      const isAlways =
        m?.type === "always" ||
        (!m?.type && !!availability && Object.keys(availability).length > 0);
      if (isAlways) always.push(m);
      else normal.push(m);
    }
    always.sort((a, b) => {
      const orderA = Number.isFinite(Number(a?.displayOrder))
        ? Number(a.displayOrder)
        : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(Number(b?.displayOrder))
        ? Number(b.displayOrder)
        : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return 0;
    });

    return { alwaysMissions: always, normalMissions: normal };
  }, [missions]);

  const totalAlwaysPendingCount = useMemo(
    () => getAlwaysMissionPendingTotal(alwaysMissions),
    [alwaysMissions],
  );

  const alwaysTodaySummary = useMemo(() => {
    const out = {};
    for (const m of alwaysMissions) {
      const maxPerDay =
        (typeof m?.availability?.maxPerDay === "number" && m.availability.maxPerDay) ||
        (typeof m?.maxPerDay === "number" && m.maxPerDay) ||
        1;

      let todayCount = Number(m?.stats?.todayCount || 0);
      if (!Number.isFinite(todayCount) || todayCount <= 0) {
        todayCount = 0;
        const la = m?.lastAttempts || {};
        for (const uid in la) {
          if (
            la[uid]?.dayKey === todayKey &&
            ["approved", "pending"].includes(la[uid].status || "approved")
          ) {
            todayCount += 1;
          }
        }
      }
      out[m.id] = { todayCount, maxPerDay };
    }
    return out;
  }, [alwaysMissions, todayKey]);

  const getBasisDay = useCallback(
    (m) => {
      const target =
        dateBasis === "deadline" ? m?.timeWindow?.end : m?.timeWindow?.start;
      if (!target) return null;
      return target.toDate ? dayjs(target.toDate()) : dayjs(target);
    },
    [dateBasis],
  );

  const weekItems = useMemo(() => {
    if (!Array.isArray(normalMissions) || normalMissions.length === 0) return [];
    const map = new Map();

    for (const m of normalMissions) {
      let d = getBasisDay(m);
      if (!d || !d.isValid()) d = dayjs();

      const isoDayIdx = (d.day() + 6) % 7;
      const weekStart = d.startOf("day").subtract(isoDayIdx, "day");
      const weekEnd = weekStart.add(6, "day");

      const yearStart = dayjs(weekStart).startOf("year");
      const yearStartIsoIdx = (yearStart.day() + 6) % 7;
      const firstWeekStart = yearStart.subtract(yearStartIsoIdx, "day");
      const weekNumber = Math.floor(weekStart.diff(firstWeekStart, "day") / 7) + 1;
      const weekKey = `${weekStart.year()}-W${String(weekNumber).padStart(2, "0")}`;

      if (!map.has(weekKey)) {
        map.set(weekKey, {
          key: weekKey,
          weekStart,
          weekEnd,
          days: Array.from({ length: 7 }, () => []),
        });
      }
      map.get(weekKey).days[isoDayIdx].push(m);
    }

    return Array.from(map.values()).sort(
      (a, b) => b.weekStart.valueOf() - a.weekStart.valueOf(),
    );
  }, [getBasisDay, normalMissions]);

  useEffect(() => {
    if (hasInitialized || weekItems.length === 0) return;

    const today = dayjs().tz("Asia/Seoul").startOf("day");
    const todayWeekIdx = weekItems.findIndex((item) => {
      const start = item.weekStart.startOf("day");
      const end = item.weekEnd.endOf("day");
      return (
        (today.isAfter(start) || today.isSame(start)) &&
        (today.isBefore(end) || today.isSame(end))
      );
    });

    if (todayWeekIdx !== -1) setCurrentWeekIndex(todayWeekIdx);
    setHasInitialized(true);
  }, [weekItems, hasInitialized]);

  const safeCurrentIndex = Math.max(
    0,
    Math.min(currentWeekIndex, Math.max(0, weekItems.length - 1)),
  );
  const currentWeek = weekItems[safeCurrentIndex];
  const hasOlder = safeCurrentIndex < weekItems.length - 1;
  const hasNewer = safeCurrentIndex > 0;

  const goToOlderWeek = () => hasOlder && setCurrentWeekIndex((p) => p + 1);
  const goToNewerWeek = () => hasNewer && setCurrentWeekIndex((p) => p - 1);

  const goToTodayWeek = () => {
    const today = dayjs().tz("Asia/Seoul").startOf("day");
    const idx = weekItems.findIndex((item) => {
      const start = item.weekStart.startOf("day");
      const end = item.weekEnd.endOf("day");
      return (
        (today.isAfter(start) || today.isSame(start)) &&
        (today.isBefore(end) || today.isSame(end))
      );
    });
    if (idx !== -1) setCurrentWeekIndex(idx);
  };

  const columns = useMemo(() => {
    if (!currentWeek) return [];
    const ws = currentWeek.weekStart;
    return ["월", "화", "수", "목", "금", "토", "일"].map((label, index) => {
      const day = ws.add(index, "day");
      return { label, date: day.format("MM.DD"), items: currentWeek.days[index], isToday: day.format("YYYY-MM-DD") === todayKey };
    });
  }, [currentWeek, todayKey]);

  const weekMissionIds = useMemo(() => {
    const ids = [];
    columns.forEach((c) => c.items.forEach((m) => ids.push(m.id)));
    return ids;
  }, [columns]);

  useEffect(() => {
    if (typeof onVisibleMissionIdsChange !== "function") return;

    const visibleIds = isAlwaysOpen
      ? [...new Set([...alwaysMissions.map((mission) => mission.id), ...weekMissionIds])]
      : weekMissionIds;

    onVisibleMissionIdsChange(visibleIds);
  }, [alwaysMissions, isAlwaysOpen, onVisibleMissionIdsChange, weekMissionIds]);

  const weekSelectedCount = isMissionSelected
    ? weekMissionIds.filter((id) => isMissionSelected(id)).length
    : 0;
  const allSelectedInWeek =
    weekMissionIds.length > 0 && weekSelectedCount === weekMissionIds.length;

  const handleToggleWeek = () => onToggleWeek?.(weekMissionIds, !allSelectedInWeek);

  return (
    <div className="teacher-mission-calendar overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm">
      <div className="border-b border-slate-200 px-6 py-4">
        <div className="flex flex-col items-center justify-between gap-4 lg:flex-row">
          <h2 className="text-lg font-black tracking-tight text-slate-800">
            주간 과제 현황
          </h2>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1">
              <Button
                onClick={goToOlderWeek}
                disabled={!hasOlder}
                className={`rounded-xl p-2 transition-all ${
                  hasOlder
                    ? "text-slate-600 hover:bg-slate-100"
                    : "cursor-not-allowed text-slate-200"
                }`}
                title="이전 주 (과거)"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </Button>

              <div className="min-w-[200px] px-4 text-center">
                {currentWeek ? (
                  <div className="group flex cursor-default flex-col items-center">
                    <div className="text-sm font-black text-slate-700">
                      {currentWeek.weekStart.format("YYYY.MM.DD")} -{" "}
                      {currentWeek.weekEnd.format("MM.DD")}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-slate-400">
                        {safeCurrentIndex + 1} / {weekItems.length}
                      </span>
                      <Button
                        onClick={goToTodayWeek}
                        className="rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
                        title="오늘이 있는 주로 이동"
                      >
                        <ArrowPathIcon className="h-3 w-3" /> 이번 주
                      </Button>
                    </div>
                  </div>
                ) : (
                  <span className="text-sm text-slate-400">
                    등록된 주간 과제가 없습니다
                  </span>
                )}
              </div>

              <Button
                onClick={goToNewerWeek}
                disabled={!hasNewer}
                className={`rounded-xl p-2 transition-all ${
                  hasNewer
                    ? "text-slate-600 hover:bg-slate-100"
                    : "cursor-not-allowed text-slate-200"
                }`}
                title="다음 주 (미래)"
              >
                <ChevronRightIcon className="h-5 w-5" />
              </Button>
            </div>

            {!selectionMode && !readOnly && (
              <Button
                onClick={handleToggleWeek}
                disabled={weekMissionIds.length === 0}
                className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold shadow-sm transition-all ${
                  allSelectedInWeek
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-indigo-600 hover:text-indigo-600"
                }`}
              >
                <CheckCircleIcon className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {allSelectedInWeek ? "해제" : "전체선택"}
                </span>
                <span className="font-mono text-xs opacity-50">
                  ({weekSelectedCount}/{weekMissionIds.length})
                </span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {alwaysMissions.length > 0 && (
        <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-3">
          <Button
            onClick={handleToggleAlways}
            className="group flex w-full items-center justify-between rounded-lg px-1 py-1 transition-colors hover:bg-white"
          >
            <div className="flex items-center gap-2">
              <PlusCircleIcon className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-black text-slate-800">
                상시 운영 중인 과제
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {alwaysMissions.length}
              </span>
              {totalAlwaysPendingCount > 0 ? (
                <span
                  className="inline-flex min-h-6 items-center justify-center rounded-md bg-amber-50 px-2 text-xs font-semibold text-amber-900"
                  title={`승인 대기 ${totalAlwaysPendingCount}건`}
                >
                  승인 대기 {totalAlwaysPendingCount > 99 ? "99+" : totalAlwaysPendingCount}건
                </span>
              ) : null}
            </div>
            <motion.div
              animate={{ rotate: isAlwaysOpen ? 0 : -90 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDownIcon className="h-3.5 w-3.5 text-indigo-400" />
            </motion.div>
          </Button>

          <AnimatePresence>
            {isAlwaysOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1 pt-3 scroll-smooth">
                  {alwaysMissions.map((m) => (
                    <div key={m.id} className="flex-shrink-0">
                      <AlwaysMissionCard
                        mission={m}
                        classId={classId}
                        studentMatrix={studentMatrix}
                        onEditMission={onEditMission}
                        onDeleteMission={onDeleteMission}
                        onToggleStudentVisible={onToggleActualStudentVisible}
                        isVisibleInStudentView={!!isMissionSelected?.(m.id)}
                        onToggleStudentView={onToggleStudentView}
                        studentViewLoading={studentViewLoading}
                        todayCount={alwaysTodaySummary[m.id]?.todayCount ?? 0}
                        maxPerDay={alwaysTodaySummary[m.id]?.maxPerDay ?? 1}
                        selectionMode={selectionMode}
                        isSelected={isSelected?.(m.id) ?? false}
                        startDragSelect={startDragSelect}
                        enterDragSelect={enterDragSelect}
                        readOnly={readOnly}
                      />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="mission-week-scroll"><div className="mission-week-grid">
        {columns.map((c) => (
          <div
            key={c.label}
            className={"mission-week-day " + (c.isToday ? "is-today" : "")}
          >
            <div className="mission-week-day-header"><span>{c.label}</span><strong>{c.date}</strong>{c.isToday && <span className="mission-week-today">오늘</span>}</div>

            <div className="mission-week-items">
              {c.items.length === 0 ? (
                <div className="mission-week-empty">—</div>
              ) : (
                c.items.map((mission) => (
                  <div
                    key={mission.id}
                    onMouseDown={() => selectionMode && startDragSelect?.(mission.id)}
                    onMouseEnter={() => selectionMode && enterDragSelect?.(mission.id)}
                  >
                    <MissionCardInWeek
                      mission={mission}
                      onRefresh={onRefresh}
                      onApproveMany={onApproveMany}
                      onCancelMany={onCancelMany}
                      onRejectMany={onRejectMany}
                      onSaveFeedbackMany={onSaveFeedbackMany}
                      studentMatrix={studentMatrix}
                      onDeleteMission={onDeleteMission}
                      onEditMission={onEditMission}
                      isVisibleInStudentView={isVisibleInStudentView?.(mission.id)}
                      onToggleStudentView={onToggleStudentView}
                      studentViewLoading={!!studentViewLoading}
                      selectionMode={selectionMode}
                      isSelected={typeof isSelected === "function" ? isSelected(mission.id) : false}
                      readOnly={readOnly}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div></div>
    </div>
  );
};

export default MissionWeekCarousel;
