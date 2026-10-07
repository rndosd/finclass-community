import React, { memo, useRef, useState } from 'react';
import FreeSeatBoard from '../FreeSeatBoard';
import ClassroomDeskVisual from '../ClassroomDeskVisual';
import SeatAssignmentDialog from './SeatAssignmentDialog';
import { GRID_SIZE, MAX_DESK_DISPLAY_SCALE, resolveSeatPlacements } from '../../utils/freeSeatPlacement';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  CheckCircle2,
  ArrowRightLeft,
  Dices,
  Eraser,
  Grid,
  Info,
  Mars,
  MousePointer2,
  Pin,
  Plus,
  Printer,
  Save,
  Trash2,
  User,
  Venus,
  Zap,
} from 'lucide-react';
import SharedUiButton from "../../../../components/ui/Button";

const TEAMS = [
  { id: 'team1', bg: 'bg-red-100', border: 'border-red-300', name: '1모둠' },
  { id: 'team2', bg: 'bg-blue-100', border: 'border-blue-300', name: '2모둠' },
  { id: 'team3', bg: 'bg-green-100', border: 'border-green-300', name: '3모둠' },
  { id: 'team4', bg: 'bg-yellow-100', border: 'border-yellow-300', name: '4모둠' },
  { id: 'team5', bg: 'bg-purple-100', border: 'border-purple-300', name: '5모둠' },
  { id: 'team6', bg: 'bg-indigo-100', border: 'border-indigo-300', name: '6모둠' },
];

const ALL_TEAMS = [{ id: 'none', bg: 'bg-white', border: 'border-slate-300', name: '없음' }, ...TEAMS];
const AVOID_STYLE = {
  red: {
    label: '빨강',
    text: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: 'text-red-500',
    dot: 'bg-red-500',
  },
  blue: {
    label: '파랑',
    text: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: 'text-blue-500',
    dot: 'bg-blue-500',
  },
  green: {
    label: '초록',
    text: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    icon: 'text-emerald-500',
    dot: 'bg-emerald-500',
  },
  orange: {
    label: '주황',
    text: 'text-orange-800',
    bg: 'bg-orange-50',
    border: 'border-orange-400',
    icon: 'text-orange-800',
    dot: 'bg-orange-500',
  },
};
const DEFAULT_AVOID_STYLE = AVOID_STYLE.red;
const GENDER_TOOL_META = {
  none: {
    label: '성별',
    className: 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
    Icon: User,
  },
  male: {
    label: '남',
    className: 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700',
    Icon: Mars,
  },
  female: {
    label: '여',
    className: 'bg-rose-500 text-white border-rose-500 hover:bg-rose-600',
    Icon: Venus,
  },
};

const getAvoidStudentIds = (group) => {
  if (Array.isArray(group?.studentIds)) return group.studentIds;
  if (Array.isArray(group)) return group;
  return [];
};

const getAvoidStyle = (color) => AVOID_STYLE[color] || DEFAULT_AVOID_STYLE;

const DraggableStudent = ({ studentName, studentId, deskId, disabled }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `student-${deskId}`,
    data: { deskId, studentName, studentId, type: 'seated' },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1 }}
      className={`absolute inset-0 z-10 ${disabled ? 'cursor-crosshair' : 'touch-none cursor-grab active:cursor-grabbing'}`}
      aria-label={`${studentName} 학생 이동`}
    >
      <span className="sr-only">{studentName}</span>
    </div>
  );
};

const DeskItem = memo(({ seat, studentName, studentId, rotation = 0, isSelected, onClick, activeTool, constraints, genderSeatMeta, draggedStudent }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: seat.id,
    disabled: !seat.isActive || activeTool !== 'cursor',
  });
  const isSource = draggedStudent?.deskId === seat.id;
  const isDestination = isOver && draggedStudent && !isSource;

  const isPinned = Boolean(studentId) && constraints?.fixedSeats?.[seat.permanentId] === studentId;

  const avoidGroups = Array.isArray(constraints?.avoidGroups) ? constraints.avoidGroups : [];
  const avoidGroupIdx = avoidGroups.findIndex((group) => {
    if (!studentId) return false;
    return getAvoidStudentIds(group).includes(studentId);
  });
  const avoidGroup = avoidGroupIdx >= 0 ? avoidGroups[avoidGroupIdx] : null;
  const avoidStyle = avoidGroup ? getAvoidStyle(avoidGroup.color) : DEFAULT_AVOID_STYLE;
  const hasLightning = avoidGroupIdx >= 0;
  const genderBadge =
    genderSeatMeta?.gender === 'male'
      ? {
          label: '남',
          className: 'bg-blue-50 text-blue-800 border-blue-400',
        }
      : genderSeatMeta?.gender === 'female'
        ? {
            label: '여',
            className: 'bg-rose-50 text-rose-800 border-rose-400',
          }
        : null;

  if (!seat.isActive) {
    return (
      <div
        onClick={onClick}
        className="aspect-square rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:bg-slate-50 opacity-40 transition-all"
      >
        <Plus size={16} className="text-slate-300" />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className={[
        'relative aspect-square transition-all duration-200',
        activeTool === 'cursor' ? 'cursor-default' : 'cursor-crosshair',
        isDestination ? 'z-30' : '',
        isSelected ? 'z-10' : '',
      ].join(' ')}
    >
      <ClassroomDeskVisual label={seat.label || `${seat.number}번`} number={seat.number}
        studentName={studentName} teamId={seat.teamId} rotation={rotation}
        selected={isSelected || Boolean(isDestination)} movingStudent={isSource} />
      {isDestination && <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs font-bold text-indigo-700 shadow-md" role="status">
        {studentId ? '자리 교환' : '이 자리로 이동'}
      </span>}
      {isPinned && (
        <div className="absolute right-0 top-0 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-slate-700 bg-white text-slate-800 shadow-sm">
          <Pin size={13} fill="currentColor" />
        </div>
      )}

      {hasLightning && (
        <div className={`absolute bottom-0 right-0 z-20 flex h-6 w-6 flex-col items-center justify-center rounded-full border border-slate-400 bg-white shadow-sm ${avoidStyle.icon}`}>
          <Zap size={12} fill="currentColor" />
          <span className="-mt-0.5 text-[8px] font-black leading-none">{avoidGroupIdx + 1}</span>
        </div>
      )}

      {genderBadge && (
        <div
          className={`absolute bottom-0 left-0 z-20 flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-black shadow-sm ${genderBadge.className}`}
          title={genderSeatMeta.source === 'pinned' ? '압정 학생 성별' : '희망 성별'}
        >
          {genderBadge.label}
        </div>
      )}

      {studentName && <DraggableStudent studentName={studentName} studentId={studentId} deskId={seat.id} disabled={activeTool !== 'cursor'} />}
    </div>
  );
});

const ClassroomEditorUI = ({
  groups,
  placementData,
  deskDisplayScale = 100,
  displayScaleDirty = false,
  displayScaleSaving = false,
  onDeskDisplayScaleChange,
  onEnableDeskPlacement,
  activeTool,
  selectedSeat,
  selectedSeatIds,
  currentSeat,
  unassignedStudents,
  handlers,
  loading,
  saving,
  hasChanges,
  activeDragItem,
  constraints,
  avoidGroups,
  genderStats,
  activeGenderTool,
  activeAvoidGroupId,
  onSelectAvoidGroup,
  onClearAvoidGroups,
  onOpenShuffle,
  onOpenTeacherView,
  onSave,
}) => {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 10 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );
  const marqueeStart = useRef(null);
  const [selectionBox, setSelectionBox] = useState(null);
  const pointerPosition = (event, scale = 1) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale };
  };
  const onBlankPointerDown = (event, view) => {
    if (activeTool !== 'cursor' || event.button !== 0) return;
    const start = pointerPosition(event, view.fitScale);
    marqueeStart.current = { ...start, additive: event.shiftKey,
      scale: view.fitScale, originX: view.originX, originY: view.originY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onBlankPointerMove = (event) => {
    if (!marqueeStart.current) return;
    const start = marqueeStart.current;
    const end = pointerPosition(event, start.scale);
    setSelectionBox({ left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });
  };
  const onBlankPointerUp = (event) => {
    if (!marqueeStart.current) return;
    const start = marqueeStart.current;
    const end = pointerPosition(event, start.scale);
    marqueeStart.current = null;
    setSelectionBox(null);
    if (event.type === 'pointercancel') return;
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    if (right - left < 5 && bottom - top < 5) {
      if (!start.additive) handlers.selectSeatIds([], false);
      return;
    }
    const selected = freeSeats.filter((seat) => {
      const entry = deskEntries.get(seat.id);
      if (!entry || entry.desk.isActive === false) return false;
      const centerX = (seat.x + 1) * GRID_SIZE - start.originX;
      const centerY = (seat.y + 1) * GRID_SIZE - start.originY;
      return centerX >= left && centerX <= right && centerY >= top && centerY <= bottom;
    }).map((seat) => seat.id);
    handlers.selectSeatIds(selected, start.additive);
  };

  const lightningGroups = (Array.isArray(avoidGroups) ? avoidGroups : []).map((group, idx) => {
    const style = getAvoidStyle(group.color);
    return {
      ...group,
      style,
      count: getAvoidStudentIds(group).length,
      index: idx + 1,
    };
  });
  const genderTool = GENDER_TOOL_META[activeGenderTool] || GENDER_TOOL_META.none;
  const GenderToolIcon = genderTool.Icon;
  const genderSeatMetaByPermanentId = genderStats?.genderSeatMetaByPermanentId || {};
  const freeSeats = resolveSeatPlacements(groups, placementData);
  const deskEntries = new Map(groups.flatMap((group) => (group.desks || [])
    .map((desk) => [desk.id, { group, desk }])));
  const visibleDeskScale = Math.min(deskDisplayScale, MAX_DESK_DISPLAY_SCALE);

  if (loading) {
    return <div className="p-20 text-center text-slate-500 italic font-bold">교실 정보를 불러오는 중입니다...</div>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handlers.handleDragStart} onDragEnd={handlers.handleDragEnd}>
      <div className="min-h-screen bg-slate-100 pb-48 font-sans">

        <div className="classroom-workspace__editor-tools bg-white border-b sticky top-0 z-30 shadow-md">
          <header className="relative flex flex-wrap items-center gap-3 border-b border-slate-100 px-3 py-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-xl shadow-lg shadow-blue-100">
                <Grid className="text-white w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-slate-800 tracking-tight">배치 관리 · 좌석 배정</h2>
            </div>

            <div className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-slate-700">
                <span>책상 배치 모드</span>
                <button type="button" role="switch" aria-label="책상 배치 모드" aria-checked="false"
                  onClick={onEnableDeskPlacement} disabled={hasChanges || saving}
                  title={hasChanges ? '좌석 배정 변경을 먼저 저장해 주세요.' : undefined}
                  className="relative h-6 w-11 rounded-full bg-slate-300 transition-colors disabled:cursor-not-allowed disabled:opacity-50">
                  <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow" />
                </button>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={onOpenShuffle}
                className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-gradient-to-r from-blue-600 to-indigo-700 px-3 py-2 text-sm font-bold text-white shadow hover:bg-blue-700">
                <Dices size={20} /> 자리 섞기
              </button>
              <button
                type="button"
                onClick={onOpenTeacherView}
                aria-label="반전뷰 인쇄"
                title="반전뷰 인쇄"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100"
              >
                <Printer size={20} />
              </button>

              <details>
                <summary className="list-none cursor-pointer p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all border border-transparent hover:border-blue-100" aria-label="셔플 규칙 안내">
                  <Info size={20} />
                </summary>
                <div className="absolute top-full left-3 right-3 mt-2 p-4 sm:left-auto sm:w-[340px] bg-white rounded-[28px] shadow-2xl border border-slate-100 z-50">
                  <h4 className="font-black text-slate-800 mb-4 flex items-center gap-2 text-sm">
                    <CheckCircle2 size={16} className="text-blue-500" /> 셔플 규칙 안내
                  </h4>
                  <div className="space-y-3 text-[11px] leading-relaxed">
                    <div>
                      <strong className="text-slate-800 block mb-1">전체 랜덤</strong>
                      <p className="text-slate-500">압정/번개를 무시하고 전체 좌석을 무작위로 섞습니다.</p>
                    </div>
                    <div>
                      <strong className="text-slate-800 block mb-1">압정 유지</strong>
                      <p className="text-slate-500">압정 좌석은 고정하고 나머지만 무작위로 배치합니다.</p>
                    </div>
                    <div>
                      <strong className="text-slate-800 block mb-1">규칙 적용</strong>
                      <p className="text-slate-500">압정을 고정하고 같은 색 번개 그룹 내부 충돌을 피해서 배치합니다.</p>
                    </div>
                    <div className="pt-2 border-t border-slate-100 text-slate-500">
                      자리 섞기 창에서 방식을 선택해 주세요. 압정은 ‘압정 유지’와 ‘규칙 적용’에서 고정되며, 번개는 ‘규칙 적용’에서 사용됩니다.
                    </div>
                    <div className="pt-2 border-t border-slate-100 text-slate-500">
                      성별 배치 옵션은 셔플 모달에서 선택할 수 있으며, 성별끼리 배치는 가로 짝(1-2, 3-4...) 우선 + 잔여 혼합 허용으로 동작합니다.
                    </div>
                  </div>
                </div>
              </details>

              <div className="w-px h-8 bg-slate-200 mx-1" />


              <button
                type="button"
                onClick={onSave}
                disabled={(!hasChanges && !displayScaleDirty) || saving || displayScaleSaving}
                className={`flex h-10 w-36 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 font-bold transition-colors ${!hasChanges && !displayScaleDirty ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow ring-2 ring-blue-200'}`}
              >
                <Save size={18} /> {saving || displayScaleSaving ? '저장 중' : '최종 저장'}
              </button>
            </div>
          </header>

          <div className="flex items-center justify-center gap-2 overflow-x-auto bg-slate-50/50 px-3 py-1 no-scrollbar">
            {(hasChanges || displayScaleDirty) && !saving && <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">저장 필요</span>}
            <button type="button" onClick={() => handlers.setActiveTool('cursor')} className={`tool-btn ${activeTool === 'cursor' ? 'active' : ''}`}>
              <MousePointer2 size={20} />
              <span>선택</span>
            </button>
            <div className="w-px h-6 bg-slate-300 mx-1" />
            <button type="button" onClick={() => handlers.setActiveTool('pin')} className={`tool-btn pin-tool ${activeTool === 'pin' ? 'active-pin' : ''}`}>
              <Pin size={20} />
              <span>압정</span>
            </button>
            <button type="button" onClick={() => handlers.setActiveTool('lightning')} className={`tool-btn lightning-tool ${activeTool === 'lightning' ? 'active-zap' : ''}`}>
              <Zap size={20} />
              <span>번개</span>
            </button>
            <button
              type="button"
              onClick={handlers.cycleGenderTool}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-black transition-colors ${genderTool.className}`}
              title="클릭할 때마다 무관, 남, 여 순서로 바뀝니다."
            >
              <GenderToolIcon size={18} />
              <span>{genderTool.label}</span>
            </button>
            <div className="hidden min-w-[54px] flex-col leading-tight text-[11px] font-black text-slate-500 md:flex">
              <span>남 {genderStats?.maleUsedCount || 0}/{genderStats?.maleCount || 0}</span>
              <span>여 {genderStats?.femaleUsedCount || 0}/{genderStats?.femaleCount || 0}</span>
            </div>
            <div className="w-px h-6 bg-slate-300 mx-1" />

            <div className="flex gap-1 py-1">
              {ALL_TEAMS.map((team) => (
                <button key={team.id} type="button" onClick={() => handlers.setActiveTool(team.id)} className={`team-btn ${activeTool === team.id ? 'active' : ''}`}>
                  <div className={`w-4 h-4 rounded-full ${team.bg} border ${team.border} shadow-sm`} />
                  <span className="text-[10px] font-bold text-slate-600">{team.name}</span>
                </button>
              ))}
            </div>

            <div className="w-px h-6 bg-slate-300 mx-1" />
            <button type="button" onClick={() => handlers.setActiveTool('eraser')} className={`tool-btn ${activeTool === 'eraser' ? 'active' : ''}`}>
              <Eraser size={20} />
              <span>지우개</span>
            </button>
            <div className="w-px h-6 bg-slate-300 mx-1" />
          </div>

          <div className="border-t border-slate-100 bg-white px-3 py-1">
            <div className="flex min-h-9 flex-wrap items-center gap-2">
              {activeTool === 'lightning' && <>
              {lightningGroups.map((group) => {
                const isActiveGroup = activeAvoidGroupId === group.id;
                return (
                  <button
                    type="button"
                    key={group.id}
                    onClick={() => {
                      handlers.setActiveTool('lightning');
                      onSelectAvoidGroup?.(group.id);
                    }}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-black transition-all ${isActiveGroup ? `${group.style.bg} ${group.style.border} ${group.style.text} ring-2 ring-offset-1 ring-slate-200` : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}
                  >
                    <Zap size={13} className={isActiveGroup ? group.style.icon : 'text-slate-400'} />
                    <span>{group.style.label}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${isActiveGroup ? 'bg-white/80' : 'bg-white border border-slate-200 text-slate-500'}`}>
                      {group.count}명
                    </span>
                  </button>
                );
              })}

              <SharedUiButton tone="rose" kind="outline" size="xs"
                type="button"
                onClick={onClearAvoidGroups}
                className="inline-flex items-center gap-1.5 transition-colors"
              >
                <Trash2 size={13} />
                그룹 초기화
              </SharedUiButton>

              <span className="text-[11px] text-slate-400 font-semibold">
                현재 편집 그룹을 선택한 뒤 좌석을 클릭하면 토글됩니다. 학생은 1개 그룹만 소속됩니다.
              </span>
              </>}
              {activeTool === 'cursor' && <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500" role="status">
                <ArrowRightLeft size={14} className="shrink-0 text-indigo-600" />
                {activeDragItem ? `${activeDragItem.studentName} 학생을 놓을 자리를 선택하세요.` : '이름을 드래그해 자리 교환 · 빈자리로 옮기기'}
              </span>}
              <label className="ml-auto flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-slate-600">
                책상 크기
                <input aria-label="책상 표시 크기" type="range" min="80" max={MAX_DESK_DISPLAY_SCALE} step="10"
                  value={visibleDeskScale} onChange={(event) => onDeskDisplayScaleChange?.(Number(event.target.value))}
                  className="w-24" />
                <span className="w-9 text-right tabular-nums">{visibleDeskScale}%</span>
              </label>
            </div>
          </div>
        </div>

        <main className="border-x border-transparent px-4 py-2">
          <div className="w-full">
            <FreeSeatBoard classroomScene fitViewport readableDesks frontLabel="교탁 · 교실 앞쪽" seats={freeSeats}
              deskDisplayScale={visibleDeskScale}
              fitBoundsSeats={freeSeats.filter((seat) => deskEntries.get(seat.id)?.desk.isActive !== false)} selectionBox={selectionBox}
              onBlankPointerDown={onBlankPointerDown} onBlankPointerMove={onBlankPointerMove}
              onBlankPointerUp={onBlankPointerUp} renderSeat={(position) => {
              const entry = deskEntries.get(position.id);
              if (!entry || entry.desk.isActive === false) return null;
              const { group, desk } = entry;
              return <div className="h-full w-full"><DeskItem
                seat={desk}
                rotation={position.rotation}
                studentName={desk.studentName}
                studentId={desk.studentId}
                isSelected={selectedSeat?.deskId === desk.id || selectedSeatIds.includes(desk.id)}
                activeTool={activeTool}
                draggedStudent={activeDragItem}
                constraints={constraints}
                genderSeatMeta={genderSeatMetaByPermanentId?.[desk.permanentId]}
                onClick={(event) => handlers.handleSeatClick(group, desk, event)}
              /></div>;
            }} />
          </div>

          <DragOverlay dropAnimation={null}>
            {activeDragItem ? (
              <div className="pointer-events-none flex w-max min-w-[180px] max-w-xs items-center gap-3 rounded-xl border border-indigo-300 bg-white px-4 py-3 shadow-xl">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><ArrowRightLeft size={18} /></span>
                <div className="min-w-0"><p className="whitespace-nowrap text-[10px] font-semibold text-slate-500">학생 자리 이동</p><p className="truncate text-lg font-bold text-slate-900" title={activeDragItem.studentName}>{activeDragItem.studentName}</p></div>
              </div>
            ) : null}
          </DragOverlay>
        </main>

        {selectedSeat && activeTool === 'cursor' && currentSeat && (
          <SeatAssignmentDialog desk={currentSeat} students={unassignedStudents}
            onClose={() => handlers.setSelectedSeat(null)} onAssign={handlers.handleDockStudentClick}
            onClear={() => handlers.updateSelectedDesk({ studentId: null, studentName: null })}
            onToggleActive={() => handlers.updateSelectedDesk({ isActive: !currentSeat.isActive })} />
        )}
      </div>

      <style jsx>{`
        .tool-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px 10px; border-radius: 12px; border: 2px solid transparent; color: #94a3b8; transition: all 0.2s; cursor: pointer; }
        .tool-btn span { font-size: 11px; font-weight: 900; }
        .tool-btn:hover { background: white; color: #475569; transform: translateY(-1px); }
        .tool-btn.active { background: white; border-color: #3b82f6; color: #2563eb; transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgb(59 130 246 / 0.15); }
        .tool-btn.pin-tool { background: #f8fafc; border-color: #cbd5e1; color: #334155; }
        .tool-btn.pin-tool:hover, .tool-btn.active-pin { background: #e2e8f0; border-color: #334155; color: #0f172a; transform: translateY(-2px); }
        .tool-btn.lightning-tool { background: #fff1f2; border-color: #fda4af; color: #9f1239; }
        .tool-btn.lightning-tool:hover, .tool-btn.active-zap { background: #ffe4e6; border-color: #be123c; color: #881337; transform: translateY(-2px); }
        .team-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 3px 6px; border-radius: 10px; border: 2px solid transparent; opacity: 0.6; transition: all 0.2s; min-width: 46px; cursor: pointer; }
        .team-btn:hover { opacity: 1; background: white; }
        .team-btn.active { opacity: 1; background: white; border-color: #e2e8f0; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05); transform: scale(1.05); }
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}</style>
    </DndContext>
  );
};

export default ClassroomEditorUI;
