"use strict";

const SEAT_WIDTH = 2;
const SEAT_HEIGHT = 2;
const ROW_TOLERANCE = 0.75;
const isCoordinate = (value) => typeof value === "number" && value >= 1 && value <= 200 &&
    Math.abs(value - Number(value.toFixed(3))) < 1e-8;
const isRotation = (value) => typeof value === "number" && value >= 0 && value < 360 &&
    Math.abs(value - Number(value.toFixed(1))) < 1e-8;

const projectedRadius = (angle, axis) => {
    const offset = angle - axis;
    return Math.abs(Math.cos(offset)) * SEAT_WIDTH / 2 +
        Math.abs(Math.sin(offset)) * SEAT_HEIGHT / 2;
};

const overlaps = (a, b) => {
    const angleA = a.rotation * Math.PI / 180;
    const angleB = b.rotation * Math.PI / 180;
    return [angleA, angleA + Math.PI / 2, angleB, angleB + Math.PI / 2].every((axis) => {
        const distance = Math.abs((b.x - a.x) * Math.cos(axis) +
            (b.y - a.y) * Math.sin(axis));
        return distance < projectedRadius(angleA, axis) + projectedRadius(angleB, axis) - 1e-6;
    });
};

const getDesks = (groups) => (Array.isArray(groups) ? groups : [])
    .flatMap((group) => Array.isArray(group.desks) ? group.desks : []);

const canManagePlacement = (token, classId) => {
    if (!token || (token.role !== "admin" && token.classId !== classId)) return false;
    return token.role === "admin" || token.role === "teacher" ||
        token.permissions?.a_rst === true || token.permissions?.realestate_admin === true;
};

const validatePlacement = (seats, groups) => {
    if (!Array.isArray(seats) || seats.length > 300) {
        throw new Error("자리 배치 형식이 올바르지 않습니다.");
    }
    const deskIds = getDesks(groups).map((desk) => desk.id);
    const activeIds = new Set(getDesks(groups).filter((desk) => desk.isActive !== false)
        .map((desk) => desk.id));
    const known = new Set(deskIds);
    if (known.size !== deskIds.length || seats.length !== known.size) {
        throw new Error("자리 수 또는 자리 ID가 일치하지 않습니다.");
    }
    const seen = new Set();
    const result = seats.map((seat) => {
        if (!seat || typeof seat.id !== "string" ||
            !known.has(seat.id) || seen.has(seat.id) ||
            !isCoordinate(seat.x) || !isCoordinate(seat.y) ||
            !isRotation(seat.rotation)) {
            throw new Error("자리 위치 또는 방향이 올바르지 않습니다.");
        }
        seen.add(seat.id);
        return { id: seat.id, x: seat.x, y: seat.y, rotation: seat.rotation };
    });
    for (let i = 0; i < result.length; i += 1) {
        for (let j = i + 1; j < result.length; j += 1) {
            if (!activeIds.has(result[i].id) || !activeIds.has(result[j].id)) continue;
            if (overlaps(result[i], result[j])) {
                throw new Error("책상이 서로 겹칩니다.");
            }
        }
    }
    return result;
};

const assignSeatNumbers = (groups, seats) => {
    const byId = new Map(seats.map((seat) => [seat.id, seat]));
    const active = getDesks(groups).filter((desk) => desk.isActive !== false)
        .map((desk) => ({ desk, seat: byId.get(desk.id) }));
    if (active.some(({ seat }) => !seat)) throw new Error("번호를 매길 자리 위치가 없습니다.");
    active.sort((a, b) => a.seat.y - b.seat.y ||
        a.seat.x - b.seat.x || a.desk.id.localeCompare(b.desk.id));
    const rows = [];
    active.forEach((entry) => {
        const row = rows.find((candidate) => Math.abs(candidate.anchorY - entry.seat.y) <= ROW_TOLERANCE);
        if (row) row.entries.push(entry);
        else rows.push({ anchorY: entry.seat.y, entries: [entry] });
    });
    const numbers = new Map();
    let number = 1;
    rows.forEach((row) => {
        row.entries.sort((a, b) => a.seat.x - b.seat.x || a.desk.id.localeCompare(b.desk.id));
        row.entries.forEach(({ desk }) => numbers.set(desk.id, number++));
    });
    return numbers;
};

const withSeatNumbers = (groups, seats) => {
    const numbers = assignSeatNumbers(groups, seats);
    return groups.map((group) => ({
        ...group,
        desks: group.desks.map((desk) => numbers.has(desk.id)
            ? { ...desk, number: numbers.get(desk.id) } : desk),
    }));
};

const canHideDesk = (desk) => !(
    desk.ownerId || desk.rentContractId || desk.rentTenantId || desk.studentId ||
    Number(desk.rentDepositPaidAmount || 0) -
    Number(desk.rentDepositReturnedAmount || 0) -
    Number(desk.rentDepositDeductedAmount || 0) > 0
);

const getDeskDisplayScaleUpdate = (current, deskDisplayScale, requestId) => {
    if (!Number.isInteger(deskDisplayScale) || deskDisplayScale < 80 || deskDisplayScale > 180 ||
        deskDisplayScale % 10 !== 0) {
        throw new Error("책상 표시 크기가 올바르지 않습니다.");
    }
    if (current?.lastDeskDisplayScaleRequestId === requestId) {
        if (current.deskDisplayScale !== deskDisplayScale) {
            throw new Error("같은 요청 식별값에 다른 크기가 포함되었습니다.");
        }
        return null;
    }
    return { deskDisplayScale, lastDeskDisplayScaleRequestId: requestId };
};

module.exports = {
    canManagePlacement, validatePlacement, overlaps, assignSeatNumbers, withSeatNumbers, canHideDesk,
    getDeskDisplayScaleUpdate,
    SEAT_WIDTH, SEAT_HEIGHT, ROW_TOLERANCE,
};
