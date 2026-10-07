import React from "react";
import {
  Search,
  ChevronDown,
  ChevronUp,
  Trash2,
  CheckSquare,
} from "lucide-react";

import { BulkActionFloatingBar, Button, SectionLoader, Tabs } from "../../../../components/ui";
import MissionWeekCarousel from "./components/MissionWeekCarousel";
import MissionListView from "./components/MissionListView";
import AlwaysMissionView from "./components/AlwaysMissionView";
import MissionFilter from "./components/MissionFilter";
import MissionAddModal from "../modals/MissionAddModal";
import { useMissionViewController } from "../hooks/useMissionViewController";
import { getAlwaysMissionPendingTotal } from "./components/alwaysMissionDisplay";

const MissionView = ({
  missionStats,
  onRefresh,
  missionViewSettings,
  studentMatrix,
  onApproveMany,
  onCancelMany,
  onRejectMany,
  onSaveFeedbackMany,
  onBindEditController,
  loading = false,
  readOnly = false,
  onVisibleMissionIdsChange,
  onReadRangeChange,
}) => {
  const controller = useMissionViewController({
    missionStats,
    missionViewSettings,
    loading,
    readOnly,
  });

  const {
    viewMode,
    isFilterOpen,
    customRange,
    filteredMissions,
    regularMissions,
    dateRange,
    editOpen,
    editingMission,
    openEdit,
    closeEdit,
    settingsLoading,
    updating,
    isMissionSelected,
    toggleMissionSelection,
    handleChangeViewMode,
    handleToggleFilter,
    setCustomRange,
    handleToggleWeek,
    handleDeleteMission,
    handleToggleActualStudentVisible,
    selectionMode,
    toggleSelectionMode,
    selectedCount,
    isSelected,
    toggleSelect,
    selectAll,
    selectMany,
    deselectMany,
    clearSelection,
    deleteSelected,
    isDeletingSelected,
    startDragSelect,
    enterDragSelect,
  } = controller;

  const visibleIdsKey = filteredMissions.map((mission) => mission.id).sort().join("\u0001");
  React.useEffect(() => {
    onVisibleMissionIdsChange?.(visibleIdsKey ? visibleIdsKey.split("\u0001") : []);
  }, [visibleIdsKey, onVisibleMissionIdsChange]);
  React.useEffect(() => {
    onReadRangeChange?.(customRange.start || null);
  }, [customRange.start, onReadRangeChange]);

  const [currentCalendarVisibleIds, setCurrentCalendarVisibleIds] = React.useState([]);

  React.useEffect(() => {
    if (typeof onBindEditController !== "function") return;

    onBindEditController({
      openEdit: (mission) => openEdit(mission),
      closeEdit: () => closeEdit(),
    });
  }, [closeEdit, onBindEditController, openEdit]);

  const totalAlwaysPendingCount = React.useMemo(
    () =>
      getAlwaysMissionPendingTotal(
        (missionStats || []).filter((mission) => mission?.type === "always"),
      ),
    [missionStats],
  );

  const alwaysMissions = React.useMemo(
    () =>
      (filteredMissions || []).filter((mission) => mission?.type === "always"),
    [filteredMissions],
  );

  const allModeIds = React.useMemo(() => {
    if (viewMode === "list") return regularMissions.map((mission) => mission.id);
    if (viewMode === "always") return alwaysMissions.map((mission) => mission.id);
    return filteredMissions.map((mission) => mission.id);
  }, [alwaysMissions, filteredMissions, regularMissions, viewMode]);

  const currentScreenIds = React.useMemo(() => {
    if (viewMode === "calendar") return currentCalendarVisibleIds;
    if (viewMode === "list") return regularMissions.map((mission) => mission.id);
    return alwaysMissions.map((mission) => mission.id);
  }, [alwaysMissions, currentCalendarVisibleIds, regularMissions, viewMode]);
  const hasFilteredMissions =
    Array.isArray(filteredMissions) && filteredMissions.length > 0;
  const viewTabs = React.useMemo(
    () => [
      { id: "calendar", label: "\uCE98\uB9B0\uB354" },
      { id: "list", label: "\uBAA9\uB85D" },
      {
        id: "always",
        label: "\uC0C1\uC2DC\uACFC\uC81C",
        badge: totalAlwaysPendingCount > 0 ? totalAlwaysPendingCount : undefined,
      },
    ],
    [totalAlwaysPendingCount],
  );

  const areAllSelected = React.useCallback(
    (ids) =>
      selectionMode &&
      Array.isArray(ids) &&
      ids.length > 0 &&
      ids.every((id) => isSelected(id)),
    [isSelected, selectionMode],
  );

  const allSelectedInMode = areAllSelected(allModeIds);
  const allSelectedOnScreen = areAllSelected(currentScreenIds);

  const handleToggleAllModeSelect = React.useCallback(() => {
    if (!selectionMode) return;
    if (allSelectedInMode) {
      clearSelection();
      return;
    }
    selectAll(allModeIds);
  }, [allModeIds, allSelectedInMode, clearSelection, selectAll, selectionMode]);

  const handleToggleScreenSelect = React.useCallback(() => {
    if (!selectionMode) return;
    if (allSelectedOnScreen) {
      deselectMany(currentScreenIds);
      return;
    }
    selectMany(currentScreenIds);
  }, [
    allSelectedOnScreen,
    currentScreenIds,
    deselectMany,
    selectMany,
    selectionMode,
  ]);

  if (settingsLoading || loading) {
    return (
      <>
        <SectionLoader
          message={"과제 화면을 불러오는 중입니다..."}
          tone="indigo"
          size="sm"
          showSkeleton={false}
          minHeightClassName="min-h-[220px]"
          className="rounded-lg"
        />
      </>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <Tabs
            tabs={viewTabs}
            activeTab={viewMode}
            onTabChange={handleChangeViewMode}
            variant="underline"
            size="md"
            idPrefix="mission-view-mode"
          />

          <div className="grid grid-cols-2 items-center gap-2 sm:flex">
            <Button
              onClick={toggleSelectionMode}
              tone={selectionMode ? "rose" : "slate"}
              kind={selectionMode ? "solid" : "outline"}
              size="sm"
              rounded="lg"
              icon={Trash2}
              disabled={readOnly || isDeletingSelected || !hasFilteredMissions}
              className="justify-center"
            >
              {selectionMode ? "삭제 모드 종료" : "선택/삭제"}
            </Button>

            {viewMode !== "always" ? <Button
              onClick={handleToggleFilter}
              tone="slate"
              kind="outline"
              size="sm"
              rounded="lg"
              icon={Search}
              className={`min-h-11 justify-center transition-all duration-300  ${
                isFilterOpen
                  ? "border-slate-300 bg-slate-100 text-slate-900"
                  : ""
              }`}
            >
              <span className="ml-0.5">필터</span>
              <span className="ml-1 transition-transform duration-500">
                {isFilterOpen ? (
                  <ChevronUp className="h-4 w-4 opacity-50" />
                ) : (
                  <ChevronDown className="h-4 w-4 opacity-50" />
                )}
              </span>
            </Button> : null}
          </div>
        </div>

        {isFilterOpen && viewMode !== "always" ? (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-300">
            <MissionFilter
              customRange={customRange}
              onCustomRangeChange={(range) => setCustomRange(range)}
              totalCount={filteredMissions.length}
              visibleInStudentViewCount={
                filteredMissions.filter((mission) => isMissionSelected(mission.id)).length
              }
            />
          </div>
        ) : null}

        {!hasFilteredMissions && viewMode !== "always" ? (
          <div className="rounded-lg border bg-white p-16 text-center shadow-sm">
            <div className="mb-4 select-none text-6xl">📭</div>
            <div className="mb-2 text-xl font-bold text-gray-700">
              {customRange.start && customRange.end
                ? `${customRange.start} ~ ${customRange.end}`
                : `최근 ${dateRange}일`}
              에 해당하는 과제가 없습니다
            </div>
            <div className="text-sm text-gray-500">
              필터 조건을 조정하거나 기간을 넓혀서 다시 확인해 보세요.
            </div>
            {!isFilterOpen ? (
              <Button tone="blue" kind="ghost" size="sm"
                onClick={handleToggleFilter}
                className="mt-4 hover:underline"
              >
                필터 열기
              </Button>
            ) : null}
          </div>
        ) : viewMode === "calendar" ? (
          <MissionWeekCarousel
            missions={filteredMissions}
            onRefresh={onRefresh}
            dateBasis="createdAt"
            studentMatrix={studentMatrix}
            onApproveMany={onApproveMany}
            onCancelMany={onCancelMany}
            onRejectMany={onRejectMany}
            onSaveFeedbackMany={onSaveFeedbackMany}
            onDeleteMission={handleDeleteMission}
            isMissionSelected={isMissionSelected}
            onToggleWeek={handleToggleWeek}
            isVisibleInStudentView={isMissionSelected}
            onToggleStudentView={toggleMissionSelection}
            studentViewLoading={updating}
            onEditMission={openEdit}
            onToggleActualStudentVisible={handleToggleActualStudentVisible}
            selectionMode={selectionMode}
            isSelected={isSelected}
            startDragSelect={startDragSelect}
            enterDragSelect={enterDragSelect}
            onVisibleMissionIdsChange={setCurrentCalendarVisibleIds}
            readOnly={readOnly}
          />
        ) : viewMode === "list" ? (
          <MissionListView
            missions={regularMissions}
            onRefresh={onRefresh}
            onApproveMany={onApproveMany}
            onCancelMany={onCancelMany}
            onRejectMany={onRejectMany}
            onSaveFeedbackMany={onSaveFeedbackMany}
            studentMatrix={studentMatrix}
            onDeleteMission={handleDeleteMission}
            onEditMission={openEdit}
            isVisibleInStudentView={isMissionSelected}
            onToggleStudentView={toggleMissionSelection}
            studentViewLoading={updating}
            selectionMode={selectionMode}
            isSelected={isSelected}
            toggleSelect={toggleSelect}
            startDragSelect={startDragSelect}
            enterDragSelect={enterDragSelect}
            readOnly={readOnly}
          />
        ) : (
          <AlwaysMissionView
            missions={filteredMissions}
            onRefresh={onRefresh}
            onDeleteMission={handleDeleteMission}
            onEditMission={openEdit}
            onToggleStudentVisible={handleToggleActualStudentVisible}
            isVisibleInStudentView={isMissionSelected}
            onToggleStudentView={toggleMissionSelection}
            studentViewLoading={updating}
            studentMatrix={studentMatrix}
            selectionMode={selectionMode}
            isSelected={isSelected}
            startDragSelect={startDragSelect}
            enterDragSelect={enterDragSelect}
            readOnly={readOnly}
          />
        )}
      </div>

      <BulkActionFloatingBar
        count={selectedCount}
        forceVisible={selectionMode}
        tone="rose"
        icon={Trash2}
        eyebrow="과제 삭제 모드"
        title={
          selectedCount > 0
            ? `선택한 과제 ${selectedCount}개`
            : "삭제할 과제를 선택하세요"
        }
        actions={[
          {
            key: "toggle-all",
            label: allSelectedInMode ? "전체 해제" : "전체 선택",
            onClick: handleToggleAllModeSelect,
            icon: CheckSquare,
            tone: "slate",
            kind: "outline",
            disabled: allModeIds.length === 0 || isDeletingSelected,
          },
          {
            key: "toggle-screen-all",
            label: allSelectedOnScreen ? "화면 전체 해제" : "화면 전체 선택",
            onClick: handleToggleScreenSelect,
            icon: CheckSquare,
            tone: "slate",
            kind: "outline",
            disabled: currentScreenIds.length === 0 || isDeletingSelected,
          },
          {
            key: "clear",
            label: "선택 해제",
            onClick: clearSelection,
            tone: "slate",
            kind: "outline",
            disabled: selectedCount === 0 || isDeletingSelected,
          },
          {
            key: "delete",
            label: isDeletingSelected ? "삭제 중..." : "선택 삭제",
            onClick: deleteSelected,
            icon: Trash2,
            tone: "rose",
            disabled: selectedCount === 0 || isDeletingSelected,
          },
        ]}
        onClear={toggleSelectionMode}
        clearLabel="삭제 모드 종료"
      />

      <MissionAddModal
        isOpen={editOpen}
        onClose={closeEdit}
        onSuccess={async () => {}}
        mode="edit"
        mission={editingMission}
      />
    </>
  );
};

export default MissionView;
