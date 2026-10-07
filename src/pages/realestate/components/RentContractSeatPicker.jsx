import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import FreeSeatBoard from './FreeSeatBoard';
import ClassroomDeskVisual from './ClassroomDeskVisual';
import './rentContractSeatPicker.css';
import { MAX_DESK_DISPLAY_SCALE, resolveSeatPlacements } from '../utils/freeSeatPlacement';

const RentContractSeatPicker = ({ groups = [], placementData, selectableIds, selectedIds, onToggle,
  getDeskStatus, getDeskName, neutralSelection = false, selectionLabel = '임대 계약 대상 선택' }) => {
  const desks = useMemo(() => new Map(groups.flatMap((group) => group.desks || [])
    .map((desk) => [desk.id, desk])), [groups]);
  const seats = useMemo(() => resolveSeatPlacements(groups, placementData)
    .filter((seat) => desks.get(seat.id)?.isActive !== false), [groups, placementData, desks]);
  const savedScale = Number(placementData?.deskDisplayScale);
  const deskDisplayScale = Number.isInteger(savedScale) && savedScale >= 80 &&
    savedScale <= MAX_DESK_DISPLAY_SCALE && savedScale % 10 === 0 ? savedScale : 100;

  if (!seats.length) return <p className="py-6 text-center text-sm text-slate-500">표시할 책상이 없습니다.</p>;
  return (
    <div className={`h-[340px] overflow-auto rounded-xl ${getDeskStatus ? 'rent-contract-seat-picker--status' : ''} ${neutralSelection ? 'rent-contract-seat-picker--neutral' : ''}`} aria-label={selectionLabel}>
      <FreeSeatBoard seats={seats} fitViewport classroomScene frontLabel="교탁 · 교실 앞쪽"
        deskDisplayScale={deskDisplayScale} renderSeat={(seat) => {
          const desk = desks.get(seat.id);
          const selectable = selectableIds.has(seat.id);
          const selected = selectedIds.has(seat.id);
          const label = desk.label || `${desk.number ?? '-'}번 자리`;
          return <button type="button" disabled={!selectable} aria-pressed={selected}
            aria-label={`${label} ${desk.studentName || '미배정'}`}
            title={`${label} / ${desk.studentName || '미배정'}${selectable ? '' : ' / 선택 대상 제외'}`}
            onClick={() => onToggle(seat.id)}
            className={`relative h-full w-full rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 ${selectable ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}>
            <ClassroomDeskVisual number={desk.number} label={desk.label} studentName={getDeskName?.(desk) || desk.studentName}
              teamId={neutralSelection ? undefined : desk.teamId} rotation={seat.rotation} view={getDeskStatus ? 'property' : 'student'}
              ownerName={getDeskName?.(desk)} ownerType="state"
              priceText={getDeskStatus?.(desk)?.priceText || ''} status={getDeskStatus?.(desk)} selected={selected} />
            {selected && <span className="pointer-events-none absolute z-20 rounded-full bg-blue-700 p-1 text-white shadow"
              style={{ right: '6%', top: '16%' }} aria-hidden="true"><Check size={16} strokeWidth={3} /></span>}
          </button>;
        }} />
    </div>
  );
};

export default RentContractSeatPicker;
