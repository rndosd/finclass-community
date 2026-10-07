export const GRID_SIZE = 48;
export const SEAT_SIZE = 96;
export const SEAT_STEP = 3;
export const MAX_DESK_DISPLAY_SCALE = 180;
// Matches classroom-desk__shape::after: 3% side insets, 19% top, 20% bottom.
export const TABLETOP_FOOTPRINT = { width: 0.94, height: 0.61 };

const validCoordinate = (value) => typeof value === 'number' && value >= 1 && value <= 200 &&
  Math.abs(value - Number(value.toFixed(3))) < 1e-8;

export const normalizeAngle = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number((((Math.round(number * 10) / 10 % 360) + 360) % 360).toFixed(1));
};

export const arePlacedSeatsNear = (a, b) => Boolean(a && b &&
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= 9);

export const getLegacySeatPlacements = (groups = []) => {
  const seats = [];
  let groupX = 0;
  let groupY = 0;
  let rowHeight = 0;
  groups.forEach((group) => {
    const cols = Math.max(1, Number(group?.cols) || 1);
    const rows = Math.ceil((group?.desks || []).length / cols);
    const groupWidth = cols * SEAT_STEP + 2;
    if (groupX > 0 && groupX + groupWidth > 32) {
      groupX = 0;
      groupY += rowHeight + 2;
      rowHeight = 0;
    }
    (group?.desks || []).forEach((desk, index) => {
      seats.push({
        id: desk.id,
        x: groupX + (index % cols) * SEAT_STEP,
        y: groupY + Math.floor(index / cols) * SEAT_STEP,
        rotation: 0,
      });
    });
    groupX += groupWidth;
    rowHeight = Math.max(rowHeight, rows * SEAT_STEP);
  });
  return seats;
};

export const resolveSeatPlacements = (groups = [], placementData = null) => {
  const isV2 = placementData?.version === 2;
  const saved = new Map((Array.isArray(placementData?.seats) ? placementData.seats : [])
    .filter((item) => item && typeof item.id === 'string')
    .map((item) => [item.id, item]));
  return getLegacySeatPlacements(groups).map((fallback) => {
    const item = saved.get(fallback.id);
    const resolved = item && (isV2
      ? validCoordinate(item.x) && validCoordinate(item.y)
      : Number.isInteger(item.x) && Number.isInteger(item.y) &&
        item.x >= 0 && item.x <= 100 && item.y >= 0 && item.y <= 100)
      ? item : fallback;
    return {
      id: fallback.id,
      x: resolved.x + (resolved === item && isV2 ? 0 : 1),
      y: resolved.y + (resolved === item && isV2 ? 0 : 1),
      rotation: normalizeAngle(resolved.rotation),
    };
  });
};

export const getPlacementCanvasSize = (seats = []) => ({
  width: Math.max(720, (Math.max(0, ...seats.map((seat) => seat.x)) + 4) * GRID_SIZE),
  height: Math.max(420, (Math.max(0, ...seats.map((seat) => seat.y)) + 4) * GRID_SIZE),
});

const projectedRadius = (angle, axis, footprint) => {
  const offset = angle - axis;
  return Math.abs(Math.cos(offset)) * footprint.width + Math.abs(Math.sin(offset)) * footprint.height;
};

export const seatsOverlap = (a, b, footprintScale = 1, footprint = { width: 1, height: 1 }) => {
  const aAngle = a.rotation * Math.PI / 180;
  const bAngle = b.rotation * Math.PI / 180;
  return [aAngle, aAngle + Math.PI / 2, bAngle, bAngle + Math.PI / 2]
    .every((axis) => Math.abs((b.x - a.x) * Math.cos(axis) + (b.y - a.y) * Math.sin(axis)) <
      (projectedRadius(aAngle, axis, footprint) + projectedRadius(bAngle, axis, footprint)) * footprintScale - 1e-6);
};

export const getOverlappingSeatIds = (seats = [], activeIds = seats.map((seat) => seat.id), footprintScale = 1, footprint) => {
  const active = new Set(activeIds);
  const overlapping = new Set();
  for (let i = 0; i < seats.length; i += 1) {
    if (!active.has(seats[i].id)) continue;
    for (let j = i + 1; j < seats.length; j += 1) {
      if (!active.has(seats[j].id) || !seatsOverlap(seats[i], seats[j], footprintScale, footprint)) continue;
      overlapping.add(seats[i].id);
      overlapping.add(seats[j].id);
    }
  }
  return overlapping;
};

export const validateSeatPlacements = (seats = [], deskIds = [], activeIds = deskIds) => {
  const ids = new Set(deskIds);
  if (seats.length !== ids.size) return '자리 수가 일치하지 않습니다.';
  const seen = new Set();
  for (const seat of seats) {
    if (!ids.has(seat.id) || seen.has(seat.id)) return '자리 ID가 중복되거나 누락되었습니다.';
    if (!validCoordinate(seat.x) || !validCoordinate(seat.y)) return '자리가 배치 영역 밖에 있습니다.';
    seen.add(seat.id);
  }
  if (getOverlappingSeatIds(seats, activeIds).size > 0) return '책상이 서로 겹칩니다.';
  return null;
};
