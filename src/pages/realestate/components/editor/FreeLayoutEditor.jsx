import { appConfirm } from "../../../../utils/appDialogs";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dices, Grid, Info, Plus, Printer, RotateCcw, Save, Undo2 } from 'lucide-react';
import FreeSeatBoard from '../FreeSeatBoard';
import ClassroomDeskVisual from '../ClassroomDeskVisual';
import TeacherReverseViewModal from '../../modals/TeacherReverseViewModal';
import { createTemplatePositions } from '../../utils/layoutTemplates';
import { GRID_SIZE, MAX_DESK_DISPLAY_SCALE, TABLETOP_FOOTPRINT, getOverlappingSeatIds, normalizeAngle, resolveSeatPlacements, validateSeatPlacements } from '../../utils/freeSeatPlacement';
import SharedUiButton from "../../../../components/ui/Button";

const clamp = (value) => Math.max(1, Math.min(200, Number(value.toFixed(3))));
const snapThreshold = 5 / GRID_SIZE;
const releaseThreshold = 9 / GRID_SIZE;

const FreeLayoutEditor = ({ groups, placementData, onSave, onCreateSeat, onSetSeatActive, onBack, onOpenShuffle, saving,
  deskDisplayScale = 100, displayScaleDirty = false, displayScaleSaving = false,
  onDeskDisplayScaleChange, onSaveDeskDisplayScale, assignmentDirty = false, onSaveAssignments }) => {
  const desks = useMemo(() => groups.flatMap((group) => group.desks || []), [groups]);
  const [templateOptions, setTemplateOptions] = useState({ columns: 0, divisionCount: 0, groupCount: 0, groupSize: 4, spacing: 1 });
  const activeDesks = desks.filter((desk) => desk.isActive !== false);
  const inactiveDesks = desks.filter((desk) => desk.isActive === false);
  const [desiredCount, setDesiredCount] = useState(() => activeDesks.length);
  const [seats, setSeats] = useState(() => resolveSeatPlacements(groups, placementData));
  const [selectedIds, setSelectedIds] = useState([]);
  const [groupAngle, setGroupAngle] = useState(15);
  const [dirty, setDirty] = useState(false);
  const [savingScale, setSavingScale] = useState(null);
  const saveInFlightRef = useRef(false);
  const [message, setMessage] = useState('');
  const [alignmentAssist, setAlignmentAssist] = useState(true);
  const [guides, setGuides] = useState([]);
  const [selectionBox, setSelectionBox] = useState(null);
  const [changedLabels, setChangedLabels] = useState({});
  const [teacherViewOpen, setTeacherViewOpen] = useState(false);
  const dragRef = useRef(null);
  const marqueeRef = useRef(null);
  const rotationRef = useRef(null);
  const addRequestRef = useRef(null);
  const saveRequestRef = useRef(null);
  const historyRef = useRef([]);
  const dirtyRef = useRef(dirty);
  const seatsRef = useRef(seats);
  const remember = (snapshot) => {
    historyRef.current.push(snapshot.map((seat) => ({ ...seat })));
    if (historyRef.current.length > 50) historyRef.current.shift();
  };
  dirtyRef.current = dirty;
  seatsRef.current = seats;
  const deskById = useMemo(() => new Map(desks.map((desk) => [desk.id, desk])), [desks]);
  const visibleDeskScale = savingScale ?? Math.min(deskDisplayScale, MAX_DESK_DISPLAY_SCALE);
  const saveBusy = savingScale !== null || saving || displayScaleSaving;
  const selected = selectedIds.length === 1 ? seats.find((seat) => seat.id === selectedIds[0]) : null;
  const validationError = validateSeatPlacements(seats, desks.map((desk) => desk.id),
    activeDesks.map((desk) => desk.id));
  const overlappingSeatIds = useMemo(() => {
    const activeIds = desks.filter((desk) => desk.isActive !== false).map((desk) => desk.id);
    return new Set([
      ...getOverlappingSeatIds(seats, activeIds),
      ...getOverlappingSeatIds(seats, activeIds, visibleDeskScale / 100 * 1.15, TABLETOP_FOOTPRINT),
    ]);
  }, [desks, seats, visibleDeskScale]);

  useEffect(() => {
    const resolved = resolveSeatPlacements(groups, placementData);
    if (dirtyRef.current) {
      setSeats((current) => {
        const byId = new Map(current.map((seat) => [seat.id, seat]));
        const next = resolved.map((seat) => byId.get(seat.id) || seat);
        seatsRef.current = next;
        return next;
      });
      return;
    }
    setSeats(resolved);
    seatsRef.current = resolved;
    historyRef.current = [];
  }, [groups, placementData]);

  useEffect(() => { setDesiredCount(activeDesks.length); }, [activeDesks.length]);

  const changeSeats = (updater, record = true) => {
    if (record) remember(seatsRef.current);
    setMessage('');
    setSeats((current) => {
      const next = updater(current);
      seatsRef.current = next;
      return next;
    });
    setDirty(true);
  };

  const updateSelectedRotation = (value) => {
    if (!selected) return;
    changeSeats((current) => current.map((seat) => seat.id === selected.id
      ? { ...seat, rotation: normalizeAngle(value) } : seat));
  };

  const startRotation = (event, seat) => {
    event.stopPropagation();
    event.preventDefault();
    const rect = event.currentTarget.parentElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    rotationRef.current = {
      id: seat.id, rotation: seat.rotation, centerX, centerY,
      startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI,
    };
    remember(seatsRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveRotation = (event) => {
    const drag = rotationRef.current;
    if (!drag) return;
    const angle = Math.atan2(event.clientY - drag.centerY,
      event.clientX - drag.centerX) * 180 / Math.PI;
    const nextRotation = normalizeAngle(drag.rotation + angle - drag.startAngle);
    changeSeats((current) => current.map((seat) => seat.id === drag.id
      ? { ...seat, rotation: nextRotation } : seat), false);
  };

  const onPointerDown = (event, id, view) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const nextSelected = additive
      ? (selectedIds.includes(id) ? selectedIds : [...selectedIds, id])
      : [id];
    setSelectedIds(nextSelected);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      ids: nextSelected,
      toggleOffOnClick: additive && selectedIds.includes(id) ? id : null,
      original: seatsRef.current,
      scale: view.fitScale,
      locks: {},
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onBlankPointerDown = (event, view) => {
    if (event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    marqueeRef.current = {
      startX: (event.clientX - bounds.left) / view.fitScale,
      startY: (event.clientY - bounds.top) / view.fitScale,
      additive: event.shiftKey,
      originX: view.originX,
      originY: view.originY,
      scale: view.fitScale,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectionBox({ left: marqueeRef.current.startX, top: marqueeRef.current.startY,
      width: 0, height: 0 });
  };

  const onBlankPointerMove = (event) => {
    const drag = marqueeRef.current;
    if (!drag) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / drag.scale;
    const y = (event.clientY - bounds.top) / drag.scale;
    setSelectionBox({ left: Math.min(drag.startX, x), top: Math.min(drag.startY, y),
      width: Math.abs(x - drag.startX), height: Math.abs(y - drag.startY) });
  };

  const onBlankPointerUp = (event) => {
    const drag = marqueeRef.current;
    if (!drag) return;
    marqueeRef.current = null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / drag.scale;
    const y = (event.clientY - bounds.top) / drag.scale;
    const minX = (Math.min(drag.startX, x) + drag.originX) / GRID_SIZE - 1;
    const maxX = (Math.max(drag.startX, x) + drag.originX) / GRID_SIZE - 1;
    const minY = (Math.min(drag.startY, y) + drag.originY) / GRID_SIZE - 1;
    const maxY = (Math.max(drag.startY, y) + drag.originY) / GRID_SIZE - 1;
    const ids = seatsRef.current.filter((seat) => deskById.get(seat.id)?.isActive !== false &&
      seat.x >= minX && seat.x <= maxX && seat.y >= minY && seat.y <= maxY)
      .map((seat) => seat.id);
    setSelectedIds((current) => drag.additive ? [...new Set([...current, ...ids])] : ids);
    setSelectionBox(null);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaX = (event.clientX - drag.startX) / (GRID_SIZE * drag.scale);
    const deltaY = (event.clientY - drag.startY) / (GRID_SIZE * drag.scale);
    const moving = drag.original.filter((seat) => drag.ids.includes(seat.id));
    const stationary = drag.original.filter((seat) => !drag.ids.includes(seat.id) &&
      deskById.get(seat.id)?.isActive !== false);
    const shifts = { x: 0, y: 0 };
    const nextGuides = [];
    for (const axis of ['x', 'y']) {
      if (!alignmentAssist || event.altKey) {
        drag.locks[axis] = null;
        continue;
      }
      const delta = axis === 'x' ? deltaX : deltaY;
      let lock = drag.locks[axis];
      if (lock) {
        const source = moving.find((seat) => seat.id === lock.sourceId);
        if (!source || Math.abs(source[axis] + delta - lock.value) > releaseThreshold) lock = null;
      }
      if (!lock) {
        const matches = moving.flatMap((source) => stationary.map((target) => ({
          sourceId: source.id, value: target[axis], error: Math.abs(source[axis] + delta - target[axis]),
        }))).filter((match) => match.error <= snapThreshold)
          .sort((a, b) => a.error - b.error || a.sourceId.localeCompare(b.sourceId));
        lock = matches[0] || null;
      }
      drag.locks[axis] = lock;
      if (lock) {
        const source = moving.find((seat) => seat.id === lock.sourceId);
        shifts[axis] = lock.value - (source[axis] + delta);
      }
    }
    const next = drag.original.map((seat) => drag.ids.includes(seat.id)
      ? { ...seat, x: clamp(seat.x + deltaX + shifts.x), y: clamp(seat.y + deltaY + shifts.y) }
      : seat);
    for (const axis of ['x', 'y']) {
      const lock = drag.locks[axis];
      if (!lock) continue;
      const ids = next.filter((seat) => deskById.get(seat.id)?.isActive !== false &&
        Math.abs(seat[axis] - lock.value) < 0.001).map((seat) => seat.id);
      if (ids.length > 1) nextGuides.push({ axis, ids });
    }
    seatsRef.current = next;
    setSeats(next);
    setGuides(nextGuides);
  };

  const onPointerUp = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setGuides([]);
    if (Math.abs(event.clientX - drag.startX) >= 1 ||
        Math.abs(event.clientY - drag.startY) >= 1) {
      remember(drag.original);
      setDirty(true);
    } else if (drag.toggleOffOnClick) {
      setSelectedIds((current) => current.filter((id) => id !== drag.toggleOffOnClick));
    }
  };

  const onSeatKeyDown = (event, id) => {
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    setSelectedIds(ids);
    const amount = event.shiftKey ? 0.25 : 0.05;
    changeSeats((current) => current.map((seat) => ids.includes(seat.id)
      ? { ...seat, x: clamp(seat.x + step[0] * amount), y: clamp(seat.y + step[1] * amount) }
      : seat));
  };

  const arrangeTemplate = (template) => {
    const ordered = seats.filter((seat) => deskById.get(seat.id)?.isActive !== false)
      .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
    if (template === 'horseshoe' && ordered.length > 190) {
      setMessage('ㄷ자형은 책상이 많아 한 화면에 안전하게 배치할 수 없습니다. 다른 템플릿을 선택해 주세요.');
      return;
    }
    let positions;
    try {
      positions = createTemplatePositions(ordered.length, template, visibleDeskScale, templateOptions);
    } catch (error) {
      setMessage(error.message);
      return;
    }
    const byId = new Map(ordered.map((seat, index) => [seat.id, positions[index]]));
    const next = seats.map((seat) => byId.has(seat.id) ? ({ ...seat,
      x: byId.get(seat.id).x, y: byId.get(seat.id).y, rotation: 0 }) : seat);
    if (!applySeparatedArrangement(next)) return;
    setMessage('시작 배치를 적용했습니다. 위치를 자유롭게 조정한 뒤 저장하세요.');
  };

  const applySeparatedArrangement = (next) => {
    const activeIds = activeDesks.map((desk) => desk.id);
    if (getOverlappingSeatIds(next, activeIds).size ||
      getOverlappingSeatIds(next, activeIds, visibleDeskScale / 100 * 1.15, TABLETOP_FOOTPRINT).size) {
      setMessage('다른 책상과 겹쳐 적용하지 않았습니다. 주변 책상을 함께 선택하거나 공간을 확보해 주세요.');
      return false;
    }
    changeSeats(() => next);
    return true;
  };

  const alignSelected = (axis) => {
    if (selectedIds.length < 2) return;
    const selectedSeats = seats.filter((seat) => selectedIds.includes(seat.id))
      .sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id));
    const anchor = selectedSeats[0][axis === 'x' ? 'y' : 'x'];
    const start = selectedSeats[0][axis];
    const step = 3.3 * visibleDeskScale / 100;
    if (start + (selectedSeats.length - 1) * step > 200) {
      setMessage('정렬할 공간이 부족합니다. 책상들을 안쪽으로 옮긴 뒤 다시 정렬해 주세요.');
      return;
    }
    const byId = new Map(selectedSeats.map((seat, index) => [seat.id, {
      ...seat, [axis]: clamp(start + index * step),
      [axis === 'x' ? 'y' : 'x']: anchor,
    }]));
    applySeparatedArrangement(seats.map((seat) => byId.get(seat.id) || seat));
  };

  const spaceSelected = (axis) => {
    if (selectedIds.length < 3) return;
    const ordered = seats.filter((seat) => selectedIds.includes(seat.id))
      .sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id));
    const start = ordered[0][axis];
    const step = Math.max(3.3 * visibleDeskScale / 100,
      (ordered[ordered.length - 1][axis] - start) / (ordered.length - 1));
    if (start + (ordered.length - 1) * step > 200) {
      setMessage('간격을 확보할 공간이 부족합니다. 책상들을 안쪽으로 옮긴 뒤 다시 시도해 주세요.');
      return;
    }
    const byId = new Map(ordered.map((seat, index) => [seat.id, clamp(start + step * index)]));
    applySeparatedArrangement(seats.map((seat) => byId.has(seat.id)
      ? { ...seat, [axis]: byId.get(seat.id) } : seat));
  };

  const rotateSelectedGroup = () => {
    if (selectedIds.length < 2 || !Number.isFinite(Number(groupAngle))) return;
    const angle = Number(groupAngle) * Math.PI / 180;
    const chosen = seats.filter((seat) => selectedIds.includes(seat.id));
    const pivotX = chosen.reduce((sum, seat) => sum + seat.x, 0) / chosen.length;
    const pivotY = chosen.reduce((sum, seat) => sum + seat.y, 0) / chosen.length;
    changeSeats((current) => current.map((seat) => {
      if (!selectedIds.includes(seat.id)) return seat;
      const dx = seat.x - pivotX;
      const dy = seat.y - pivotY;
      return { ...seat,
        x: clamp(pivotX + dx * Math.cos(angle) - dy * Math.sin(angle)),
        y: clamp(pivotY + dx * Math.sin(angle) + dy * Math.cos(angle)),
        rotation: normalizeAngle(seat.rotation + Number(groupAngle)),
      };
    }));
  };

  const undo = () => {
    const previous = historyRef.current.pop();
    if (previous) {
      seatsRef.current = previous;
      setSeats(previous);
      setDirty(JSON.stringify(previous) !== JSON.stringify(resolveSeatPlacements(groups, placementData)) ||
        Object.keys(changedLabels).length > 0);
      setMessage('직전 배치 변경을 되돌렸습니다.');
      return;
    }
    const original = resolveSeatPlacements(groups, placementData);
    seatsRef.current = original;
    setSeats(original);
    setChangedLabels({});
    setDirty(false);
    setMessage('');
  };

  const save = async () => {
    if (saveInFlightRef.current || saving || displayScaleSaving) return;
    if (validationError || overlappingSeatIds.size > 0) {
      if (overlappingSeatIds.size === 0) setMessage(validationError);
      return;
    }
    saveInFlightRef.current = true;
    setSavingScale(visibleDeskScale);
    setMessage('');
    try {
      const signature = JSON.stringify({ seats, changedLabels, deskDisplayScale: visibleDeskScale });
      if (saveRequestRef.current?.signature !== signature) saveRequestRef.current = {
        id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.floor(Math.random() * 100000000)}`,
        signature,
      };
      if (assignmentDirty && (!onSaveAssignments || await onSaveAssignments() === false)) {
        throw new Error('좌석 배정을 저장하지 못했습니다. 변경 사항을 유지했으니 다시 저장해 주세요.');
      }
      if (dirty) await onSave(seats, saveRequestRef.current.id, changedLabels);
      // Persist the size captured before placement snapshots update the parent.
      // Older placement writers may replace the document and omit this field.
      if (displayScaleDirty || (dirty && onSaveDeskDisplayScale)) {
        if (!onSaveDeskDisplayScale || await onSaveDeskDisplayScale(visibleDeskScale) === false) {
          throw new Error('책상 크기를 저장하지 못했습니다. 변경한 크기를 유지했으니 다시 저장해 주세요.');
        }
      }
      saveRequestRef.current = null;
      historyRef.current = [];
      setChangedLabels({});
      setDirty(false);
      setMessage(displayScaleDirty ? '배치와 책상 크기를 저장했습니다.' : '자리 배치를 저장했습니다.');
    } catch (error) {
      setMessage(error.message || '배치를 저장하지 못했습니다.');
    } finally {
      saveInFlightRef.current = false;
      setSavingScale(null);
    }
  };

  const addSeat = async () => {
    const amount = desiredCount - activeDesks.length;
    if (!Number.isInteger(desiredCount) || desiredCount < 0) {
      setMessage('책상 수는 0부터 300까지의 정수로 입력해 주세요.');
      return;
    }
    if (amount <= 0) {
      setMessage('책상을 줄이려면 숨길 책상을 직접 선택해 주세요.');
      return;
    }
    if (desiredCount + inactiveDesks.length > 300) {
      setMessage('숨긴 책상을 포함해 책상은 최대 300개까지 설정할 수 있습니다.');
      return;
    }
    if (!addRequestRef.current) {
      addRequestRef.current = Array.from({ length: amount }, () => window.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.floor(Math.random() * 100000000)}`);
    }
    try {
      for (const requestId of addRequestRef.current) await onCreateSeat(requestId);
      addRequestRef.current = null;
      setMessage(`${amount}개 책상을 추가했습니다. 위치를 조정한 뒤 배치를 저장하세요.`);
    } catch (error) {
      setMessage(error.message || '자리를 추가하지 못했습니다.');
    }
  };

  const setSelectedActive = async (deskId, isActive) => {
    if (dirty) {
      setMessage('배치 변경을 먼저 저장한 뒤 책상 수를 조정해 주세요.');
      return;
    }
    try {
      await onSetSeatActive(deskId, isActive);
      setSelectedIds([]);
      setMessage(isActive ? '책상을 다시 표시했습니다.' : '선택한 책상을 숨겼습니다. 기록과 책상 ID는 보존됩니다.');
    } catch (error) {
      setMessage(error.message || '책상 상태를 변경하지 못했습니다.');
    }
  };

  return (
    <section className="min-h-screen bg-slate-100 pb-48 font-sans">
      <fieldset disabled={saveBusy} className="m-0 min-w-0 border-0 p-0">
      <div className="w-full space-y-2">
        <div className="classroom-workspace__editor-tools space-y-2">
        <header className="sticky top-0 z-30 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-slate-100 bg-white px-3 py-2 shadow-md">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-2 shadow-lg shadow-blue-100">
              <Grid className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-slate-800">배치 관리 · 책상 배치</h1>
          </div>
          <div className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-slate-700">
              <span>책상 배치 모드</span>
              <button type="button" role="switch" aria-label="책상 배치 모드" aria-checked="true"
                disabled={saveBusy}
                onClick={async () => { if (!dirty || (await appConfirm('저장하지 않은 배치 변경을 버리고 좌석 배정으로 이동할까요?'))) onBack(); }}
                className="relative h-6 w-11 rounded-full bg-blue-600 transition-colors">
                <span className="absolute right-1 top-1 h-4 w-4 rounded-full bg-white shadow" />
              </button>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" disabled={saveBusy} onClick={async () => {
              if (!dirty || (await appConfirm('저장하지 않은 배치 변경을 버리고 자리 섞기로 이동할까요?'))) onOpenShuffle();
            }} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-700 px-3 py-2 text-sm font-bold text-white shadow hover:bg-blue-700"><Dices size={20} /> 자리 섞기</button>
            <button type="button" onClick={() => setTeacherViewOpen(true)} aria-label="반전뷰 인쇄" title="반전뷰 인쇄"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100"><Printer size={20} /></button>
            <span title="책상 수와 배치 도구는 바로 아래에서 조절합니다." aria-label="배치 도구 안내"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400">
              <Info size={20} />
            </span>
            <div className="mx-1 h-8 w-px bg-slate-200" />
            <button type="button" onClick={save} disabled={(!dirty && !displayScaleDirty && !assignmentDirty) || saveBusy || Boolean(validationError) || overlappingSeatIds.size > 0} className="flex w-36 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 font-bold text-white shadow disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"><Save size={18} /> {saveBusy ? '저장 중' : '최종 저장'}</button>
          </div>
        </header>
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-sm">
          {(dirty || displayScaleDirty || assignmentDirty) && !saveBusy && <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">저장 필요</span>}
          <label className="flex items-center gap-2 font-semibold text-slate-700">책상 수
            <input aria-label="책상 수" type="number" min="0" max={300 - inactiveDesks.length} step="1" value={desiredCount}
              onChange={(event) => setDesiredCount(Number(event.target.value))}
              className="w-16 rounded border border-slate-300 px-2 py-1" />
          </label>
          <button type="button" onClick={addSeat} disabled={dirty || saving || desiredCount <= activeDesks.length} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 font-semibold text-slate-700 disabled:opacity-40"><Plus size={16} /> 책상 수 적용</button>
          <button type="button" onClick={undo} disabled={!dirty} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 font-semibold text-slate-700 disabled:opacity-40"><Undo2 size={16} /> 되돌리기</button>
          <details className="relative z-20 ml-auto">
          <summary className="cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">배치 도구</summary>
          <div className="absolute right-0 top-full z-30 mt-1 w-[min(900px,calc(100vw-2rem))] space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button type="button" onClick={() => setSelectedActive(selectedIds[0], false)}
                disabled={dirty || saving || selectedIds.length !== 1 || !deskById.get(selectedIds[0]) || deskById.get(selectedIds[0]).isActive === false}
                className="rounded-lg border border-rose-200 px-3 py-2 text-rose-700 disabled:opacity-40">선택한 책상 숨기기</button>
            </div>
        {inactiveDesks.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
          <span className="font-semibold">숨긴 책상 {inactiveDesks.length}개</span>
          {inactiveDesks.map((desk) => <button key={desk.id} type="button" disabled={dirty || saving}
            onClick={() => setSelectedActive(desk.id, true)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">
            {desk.label || `${desk.number ?? '-'}번`} 복구
          </button>)}
        </div>}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <span className="font-semibold text-slate-700">시작 배치</span>
          <label className="flex items-center gap-1 text-xs">분단 개수
            <select aria-label="분단 개수" value={templateOptions.divisionCount}
              onChange={(event) => setTemplateOptions((current) => ({ ...current, divisionCount: Number(event.target.value) }))}>
              <option value={0}>자동</option>
              {[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count}분단</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">모둠 개수
            <select aria-label="모둠 개수" value={templateOptions.groupCount}
              onChange={(event) => setTemplateOptions((current) => ({ ...current, groupCount: Number(event.target.value) }))}>
              <option value={0}>자동</option>
              {[2, 3, 4, 5, 6, 7, 8, 10, 12].map((count) => <option key={count} value={count}>{count}모둠</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">가로 책상 수
            <select aria-label="템플릿 가로 책상 수" value={templateOptions.columns}
              onChange={(event) => setTemplateOptions((current) => ({ ...current, columns: Number(event.target.value) }))}>
              <option value={0}>자동</option>
              {[4, 5, 6, 8, 10].map((count) => <option key={count} value={count}>{count}개</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">모둠 크기
            <select aria-label="템플릿 모둠 크기" value={templateOptions.groupSize} disabled={templateOptions.groupCount > 0}
              onChange={(event) => setTemplateOptions((current) => ({ ...current, groupSize: Number(event.target.value) }))}>
              <option value={4}>4개</option><option value={6}>6개</option>
            </select>
          </label>
          <span className="w-full text-xs text-slate-500">분단 개수는 분단형에, 모둠 개수는 모둠형에 적용됩니다. 모둠 개수를 지정하면 책상을 고르게 나눕니다.</span>
          <label className="flex items-center gap-1 text-xs">간격
            <select aria-label="템플릿 간격" value={templateOptions.spacing}
              onChange={(event) => setTemplateOptions((current) => ({ ...current, spacing: Number(event.target.value) }))}>
              <option value={1}>기본</option><option value={1.2}>넓게</option><option value={1.4}>아주 넓게</option>
            </select>
          </label>
          <button type="button" onClick={() => arrangeTemplate('rows')} className="rounded-lg border border-slate-300 px-3 py-2">줄맞춤형</button>
          <button type="button" onClick={() => arrangeTemplate('circle')} className="rounded-lg border border-slate-300 px-3 py-2">원형</button>
          <button type="button" onClick={() => arrangeTemplate('columns')} className="rounded-lg border border-slate-300 px-3 py-2">분단형</button>
          <button type="button" onClick={() => arrangeTemplate('teams')} className="rounded-lg border border-slate-300 px-3 py-2">모둠형</button>
          <button type="button" onClick={() => arrangeTemplate('horseshoe')} className="rounded-lg border border-slate-300 px-3 py-2">ㄷ자형</button>
          <span className="mx-2 h-6 border-l border-slate-200" />
          <button type="button" onClick={() => alignSelected('x')} disabled={selectedIds.length < 2} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40">가로 정렬</button>
          <button type="button" onClick={() => alignSelected('y')} disabled={selectedIds.length < 2} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40">세로 정렬</button>
          <button type="button" onClick={() => spaceSelected('x')} disabled={selectedIds.length < 3} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40">가로 간격</button>
          <button type="button" onClick={() => spaceSelected('y')} disabled={selectedIds.length < 3} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40">세로 간격</button>
          {selectedIds.length > 1 && <label className="flex items-center gap-1">선택 회전
            <input type="number" aria-label="선택 회전 각도" value={groupAngle} step="0.1" min="-360" max="360"
              onChange={(event) => setGroupAngle(event.target.value)} className="w-20 rounded border border-slate-300 px-2 py-1" />
            <button type="button" onClick={rotateSelectedGroup} className="rounded-lg border border-slate-300 px-3 py-2">적용</button>
          </label>}
          <label className="ml-auto flex items-center gap-2"><input type="checkbox" checked={alignmentAssist} onChange={(event) => setAlignmentAssist(event.target.checked)} /> 정렬 보조</label>
        </div>
          </div>
          </details>
        </div>
        <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1 text-sm">
          {selected ? <>
            <span className="font-semibold">{deskById.get(selected.id)?.number ?? '-'}번 방향</span>
            <input aria-label="책상 회전 각도" type="range" min="0" max="359.9" step="0.1" value={selected.rotation} onChange={(event) => updateSelectedRotation(event.target.value)} className="w-32" />
            <input aria-label="책상 각도 숫자 입력" type="number" min="0" max="359.9" step="0.1" value={selected.rotation} onChange={(event) => updateSelectedRotation(event.target.value)} className="w-20 rounded border border-slate-300 p-1" />
            <span>°</span>
            <SharedUiButton tone="rose" kind="outline" size="xs" type="button" onClick={() => updateSelectedRotation(0)} className="inline-flex items-center gap-1"><RotateCcw size={14} /> 초기화</SharedUiButton>
            <label className="flex items-center gap-2">자리 이름
              <input aria-label="자리 이름" value={changedLabels[selected.id] ?? deskById.get(selected.id)?.label ?? ''} maxLength={40}
                onChange={(event) => { setChangedLabels((current) => ({ ...current, [selected.id]: event.target.value })); setDirty(true); }}
                placeholder="선택 사항" className="w-24 rounded border border-slate-300 px-2 py-1" />
            </label>
          </> : <span className="text-slate-600">책상을 선택하면 자리 이름과 회전 각도를 조절할 수 있습니다.</span>}
          {dirty && !selected && <span className="ml-auto text-xs text-amber-800">저장 시 앞줄 왼쪽부터 번호를 다시 매깁니다.</span>}
          {message && <span className="ml-auto text-xs text-blue-800" role="status">{message}</span>}
          {overlappingSeatIds.size > 0 && <span className="rounded-full border border-red-300 bg-red-50 px-2 py-1 text-xs font-bold text-red-700" role="status">
            {validationError === '책상이 서로 겹칩니다.'
              ? `책상 ${overlappingSeatIds.size}개가 배치에서 겹칩니다.`
              : `표시 크기로 책상 ${overlappingSeatIds.size}개가 겹쳐 보입니다.`}
          </span>}
          <label className="ml-auto flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-slate-600">
            책상 크기
            <input aria-label="책상 표시 크기" type="range" min="80" max={MAX_DESK_DISPLAY_SCALE} step="10"
              disabled={saveBusy}
              value={visibleDeskScale} onChange={(event) => onDeskDisplayScaleChange?.(Number(event.target.value))}
              className="w-24" />
            <span className="w-9 text-right tabular-nums">{visibleDeskScale}%</span>
          </label>
        </div>
        </div>
        {validationError && validationError !== '책상이 서로 겹칩니다.' && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="status">{validationError}</p>}
        <main className="!mt-0 border-x border-transparent px-4 py-2">
        <div className="w-full">
        <FreeSeatBoard classroomScene fitViewport readableDesks frontLabel="교탁 · 교실 앞쪽" deskDisplayScale={visibleDeskScale}
          seats={seats} fitBoundsSeats={(dragRef.current?.original || seats).filter((seat) => deskById.get(seat.id)?.isActive !== false)}
          guides={guides} selectionBox={selectionBox}
          onBlankPointerDown={onBlankPointerDown}
          onBlankPointerMove={onBlankPointerMove}
          onBlankPointerUp={onBlankPointerUp}
          renderSeat={(seat, view) => {
          const desk = deskById.get(seat.id);
          if (desk?.isActive === false) return null;
          const guided = guides.some((guide) => guide.ids.includes(seat.id));
          const displayName = (changedLabels[seat.id] ?? desk?.label)?.trim() || `${desk?.number ?? '-'}번`;
          return <React.Fragment key={seat.id}>
            <button
              type="button"
              aria-label={`${desk?.number ?? '-'}번 책상 이동${overlappingSeatIds.has(seat.id) ? ', 다른 책상과 겹침' : ''}`}
              title="한 책상 이동: 드래그 · 여러 책상 선택·이동: Shift/Ctrl을 누른 채 조작"
              className="relative flex h-full w-full touch-none flex-col items-center justify-center"
              onPointerDown={(event) => onPointerDown(event, seat.id, view)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => { dragRef.current = null; setGuides([]); }}
              onKeyDown={(event) => onSeatKeyDown(event, seat.id)}
            >
              <ClassroomDeskVisual label={displayName} number={desk?.number} studentName={desk?.studentName}
                teamId={desk?.teamId} rotation={seat.rotation}
                selected={selectedIds.includes(seat.id)} guided={guided} overlapping={overlappingSeatIds.has(seat.id)} />
            </button>
            {selectedIds.length === 1 && selectedIds[0] === seat.id && <span
              role="button" tabIndex={0} aria-label="책상 회전 손잡이"
              className="absolute -right-3 -top-3 z-20 flex h-8 w-8 touch-none cursor-grab items-center justify-center rounded-full border border-blue-500 bg-white text-blue-700 shadow"
              onPointerDown={(event) => startRotation(event, seat)}
              onPointerMove={moveRotation}
              onPointerUp={() => { rotationRef.current = null; }}
              onPointerCancel={() => { rotationRef.current = null; }}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                event.preventDefault();
                updateSelectedRotation(selected.rotation + (event.key === 'ArrowRight' ? 5 : -5));
              }}
            >↻</span>}
          </React.Fragment>;
        }} />
        </div>
        </main>
      </div>
      </fieldset>
      <TeacherReverseViewModal
        isOpen={teacherViewOpen}
        onClose={() => setTeacherViewOpen(false)}
        groups={groups}
        placementData={{ version: 2, seats }}
      />
    </section>
  );
};

export default FreeLayoutEditor;
