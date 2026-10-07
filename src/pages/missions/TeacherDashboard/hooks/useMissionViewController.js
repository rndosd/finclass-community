import { confirmMissionAction, showMissionNotice } from "../../components/MissionActionDialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
import { useMissionMutations } from "./useMissionMutations";
import { useUser } from "../../../../contexts/UserContext";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { getRecentDateRangeInKST } from "../../../../utils/kstDate";

dayjs.extend(isBetween);

const DEFAULT_DAYS = 30;
const VIEW_STORAGE_KEY = "missionTeacherDashboard:missionViewMode";
const FILTER_STORAGE_KEY = "missionView:isFilterOpen";

const parseMissionDate = (value) => {
    if (!value) return null;
    const parsed = dayjs(value?.toDate ? value.toDate() : value);
    return parsed.isValid() ? parsed : null;
};

const resolveMissionReferenceDate = (mission) => {
    const candidates = [
        mission?.timeWindow?.end ?? mission?.endDate,
        mission?.timeWindow?.start ?? mission?.startDate,
        mission?.updatedAt,
        mission?.createdAt,
    ];

    for (const value of candidates) {
        const parsed = parseMissionDate(value);
        if (parsed) return parsed;
    }

    return null;
};

const isOngoingNoDeadlineMission = (mission, rangeEnd) => {
    const startValue = mission?.timeWindow?.start ?? mission?.startDate;
    const endValue = mission?.timeWindow?.end ?? mission?.endDate;
    if (endValue) return false;
    if (!startValue) return true;

    const startDate = parseMissionDate(startValue);
    return Boolean(startDate && !startDate.isAfter(rangeEnd, "day"));
};

export function useMissionViewController({
    missionStats = [],
    missionViewSettings,
    loading = false,
}) {
    const { classId: ctxClassId } = useUser();
    const { showFeedback } = useFeedback();

    const {
        settings,
        loading: settingsLoading,
        updating,
        toggleMissionSelection,
        toggleAllMissions,
        updateDateFilter,
        isMissionSelected,
        getSelectedMissions,
    } = missionViewSettings;

    // ✅ useMissionMutations는 한 번만
    const {
        requestDeleteMission,
        requestToggleAlwaysStudentVisible,
        deleteManySilent,
        invalidateMissions,
    } = useMissionMutations();

    // ====== 뷰 모드 ======
    const getInitialViewMode = () => {
        if (typeof window === "undefined") return "calendar";
        const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
        return saved === "list" || saved === "calendar" || saved === "always"
            ? saved
            : "calendar";
    };
    const [viewMode, setViewMode] = useState(getInitialViewMode);

    const handleChangeViewMode = useCallback((mode) => {
        setViewMode(mode);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(VIEW_STORAGE_KEY, mode);
        }
    }, []);

    // ====== 필터 토글 ======
    const getInitialFilterOpen = () => {
        if (typeof window === "undefined") return false;
        const saved = window.localStorage.getItem(FILTER_STORAGE_KEY);
        return saved === null ? false : saved === "true";
    };
    const [isFilterOpen, setIsFilterOpen] = useState(getInitialFilterOpen);

    const handleToggleFilter = useCallback(() => {
        setIsFilterOpen((prev) => {
            const next = !prev;
            if (typeof window !== "undefined") {
                window.localStorage.setItem(FILTER_STORAGE_KEY, next ? "true" : "false");
            }
            return next;
        });
    }, []);

    // ====== 필터 상태 ======
    const defaultRange = getRecentDateRangeInKST({ days: DEFAULT_DAYS });

    const dateRange =
        typeof settings?.dateFilter?.days === "number"
            ? settings.dateFilter.days
            : DEFAULT_DAYS;

    const [customRange, setCustomRange] = useState({
        start: defaultRange.startDate,
        end: defaultRange.endDate,
    });
    const [searchQuery, setSearchQuery] = useState("");

    // ====== 수정 모달 ======
    const [editOpen, setEditOpen] = useState(false);
    const [editingMission, setEditingMission] = useState(null);

    const openEdit = useCallback((mission) => {
        if (!mission?.id) return;
        setEditingMission(mission);
        setEditOpen(true);
    }, []);

    const closeEdit = useCallback(() => {
        setEditOpen(false);
        setEditingMission(null);
    }, []);

    // ====== 필터링 ======
    const filteredMissions = useMemo(() => {
        if (!missionStats || missionStats.length === 0) return [];
        let result = [...missionStats];

        if (viewMode === "always") {
            // Teachers manage the full recurring catalog, including old and future schedules.
            result = result.filter((mission) => mission.type === "always");
        } else if (customRange.start && customRange.end) {
            const start = dayjs(customRange.start).startOf("day");
            const end = dayjs(customRange.end).endOf("day");
            result = result.filter((mission) => {
                if (isOngoingNoDeadlineMission(mission, end)) return true;
                const missionDate = resolveMissionReferenceDate(mission);
                if (!missionDate) return false;
                return missionDate.isBetween(start, end, "day", "[]");
            });
        } else {
            const cutoffDate = dayjs().subtract(dateRange, "days");
            const rangeEnd = dayjs().endOf("day");
            result = result.filter((mission) => {
                if (isOngoingNoDeadlineMission(mission, rangeEnd)) return true;
                const missionDate = resolveMissionReferenceDate(mission);
                if (!missionDate) return true;
                return (
                    missionDate.isAfter(cutoffDate) &&
                    !missionDate.isAfter(rangeEnd)
                );
            });
        }

        const q = searchQuery.trim().toLowerCase();
        if (q) {
            result = result.filter((m) =>
                String(m.title || "").toLowerCase().includes(q),
            );
        }

        return result;
    }, [missionStats, dateRange, customRange, searchQuery, viewMode]);

    const regularMissions = useMemo(
        () => filteredMissions.filter((m) => m.type !== "always"),
        [filteredMissions],
    );

    const selectedMissions = useMemo(
        () => getSelectedMissions(filteredMissions),
        [filteredMissions, getSelectedMissions],
    );

    // =================================================================
    // ✅ 선택/삭제 모드 + 드래그 선택
    // =================================================================
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [isDeletingSelected, setIsDeletingSelected] = useState(false);

    // 드래그 상태
    const [isDraggingSelect, setIsDraggingSelect] = useState(false);
    const [dragSelectMode, setDragSelectMode] = useState(null); // 'select' | 'deselect'

    const orderedIds = useMemo(
        () => filteredMissions.map((m) => m.id),
        [filteredMissions],
    );

    const selectedCount = selectedIds.size;

    const isSelected = useCallback((id) => selectedIds.has(id), [selectedIds]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    const toggleSelectionMode = useCallback(() => {
        setSelectionMode((prev) => {
            const next = !prev;
            if (!next) {
                setSelectedIds(new Set());
                setIsDraggingSelect(false);
                setDragSelectMode(null);
            }
            return next;
        });
    }, []);

    const selectAll = useCallback((ids) => {
        setSelectedIds(new Set(ids || []));
    }, []);

    const selectMany = useCallback((ids) => {
        if (!Array.isArray(ids) || ids.length === 0) return;
        setSelectedIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.add(id));
            return next;
        });
    }, []);

    const deselectMany = useCallback((ids) => {
        if (!Array.isArray(ids) || ids.length === 0) return;
        setSelectedIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.delete(id));
            return next;
        });
    }, []);

    // 클릭 토글(리스트에서 row 클릭용)
    const toggleSelect = useCallback((id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    // 드래그용 적용
    const applySelectMode = useCallback((id, mode) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (mode === "select") next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    const startDragSelect = useCallback(
        (id) => {
            if (!selectionMode) return;

            setIsDraggingSelect(true);
            const mode = selectedIds.has(id) ? "deselect" : "select";
            setDragSelectMode(mode);
            applySelectMode(id, mode);
        },
        [selectionMode, selectedIds, applySelectMode],
    );

    const enterDragSelect = useCallback(
        (id) => {
            if (!selectionMode) return;
            if (!isDraggingSelect || !dragSelectMode) return;
            applySelectMode(id, dragSelectMode);
        },
        [selectionMode, isDraggingSelect, dragSelectMode, applySelectMode],
    );

    const endDragSelect = useCallback(() => {
        setIsDraggingSelect(false);
        setDragSelectMode(null);
    }, []);

    useEffect(() => {
        const handleMouseUp = () => endDragSelect();
        window.addEventListener("mouseup", handleMouseUp);
        return () => window.removeEventListener("mouseup", handleMouseUp);
    }, [endDragSelect]);

    const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 });

    const deleteSelected = useCallback(async () => {
        if (selectedIds.size === 0) return;

        const ids = Array.from(selectedIds);
        const ok = await confirmMissionAction(`선택한 ${ids.length}개의 과제를 삭제할까요?`);
        if (!ok) return;

        setIsDeletingSelected(true);
        setDeleteProgress({ done: 0, total: ids.length });

        try {
            const res = await deleteManySilent(ids, {
                onProgress: (done, total) => setDeleteProgress({ done, total }),
            });

            await invalidateMissions(ctxClassId);

            if (res.fail > 0) {
                showMissionNotice(`일부 삭제 실패: ${res.fail}개`);
            } else {
                showFeedback?.(`${res.ok}개 삭제 완료`, "success");
            }

            clearSelection();
            setSelectionMode(false);
        } finally {
            setIsDeletingSelected(false);
            setDeleteProgress({ done: 0, total: 0 });
        }
    }, [selectedIds, deleteManySilent, invalidateMissions, ctxClassId, clearSelection, showFeedback]);

    // ====== 기존 핸들러 ======
    const handleToggleWeek = useCallback(
        (ids, toSelected) => {
            if (!Array.isArray(ids) || ids.length === 0) return;
            toggleAllMissions(ids, toSelected);
        },
        [toggleAllMissions],
    );

    const handleDeleteMission = useCallback(
        async (mission) => {
            await requestDeleteMission(mission);
        },
        [requestDeleteMission],
    );

    const handleToggleActualStudentVisible = useCallback(
        async (missionId, newValue) => {
            const mission = filteredMissions.find((m) => m.id === missionId);
            if (!mission || mission.type !== "always") return;
            await requestToggleAlwaysStudentVisible(mission, newValue);
        },
        [filteredMissions, requestToggleAlwaysStudentVisible],
    );

    return {
        viewMode,
        isFilterOpen,
        customRange,
        searchQuery,

        filteredMissions,
        regularMissions,
        selectedMissions,
        dateRange,

        editOpen,
        editingMission,
        openEdit,
        closeEdit,

        settings,
        settingsLoading,
        updating,
        isMissionSelected,
        toggleMissionSelection,
        toggleAllMissions,

        handleChangeViewMode,
        handleToggleFilter,
        setCustomRange,
        setSearchQuery,
        handleToggleWeek,
        handleDeleteMission,
        handleToggleActualStudentVisible,
        updateDateFilter,

        selectionMode,
        toggleSelectionMode,
        selectedCount,
        selectedIds,
        isSelected,
        toggleSelect,
        selectAll,
        selectMany,
        deselectMany,
        clearSelection,
        orderedIds,
        deleteSelected,
        isDeletingSelected,
        deleteProgress, // ✅ UI에 진행률 표시 가능

        startDragSelect,
        enterDragSelect,
        endDragSelect,
        isDraggingSelect,
        dragSelectMode,
    };
}

export default useMissionViewController;
