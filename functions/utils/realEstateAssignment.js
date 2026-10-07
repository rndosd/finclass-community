"use strict";

const ASSIGNMENT_FIELDS = ["studentId", "studentName", "teamId", "isActive"];
const validStudentId = (value) => value == null ||
    (typeof value === "string" && value.length > 0 && value.length <= 128 &&
        !["__proto__", "constructor", "prototype"].includes(value));
const validStudentName = (value) => value == null ||
    (typeof value === "string" && value.length <= 80);

const validateConstraints = (raw) => {
    const record = (value) => value && typeof value === "object" && !Array.isArray(value);
    if (!record(raw) || !record(raw.fixedSeats) ||
        !record(raw.genderSeatPreferences) || !Array.isArray(raw.avoidGroups) ||
        raw.avoidGroups.length > 4 ||
        Object.keys(raw.fixedSeats).length > 300 ||
        Object.keys(raw.genderSeatPreferences).length > 300 ||
        Object.values(raw.fixedSeats).some((id) => !validStudentId(id)) ||
        Object.values(raw.genderSeatPreferences).some((value) => !["male", "female"].includes(value)) ||
        raw.avoidGroups.some((group) => !record(group) ||
            typeof group.id !== "string" || group.id.length > 80 ||
            !Array.isArray(group.studentIds) || group.studentIds.length > 300 ||
            group.studentIds.some((id) => !validStudentId(id))) ||
        !["ignore", "grouped"].includes(raw.genderShuffleMode)) {
        throw new Error("자리 제약 정보가 올바르지 않습니다.");
    }
    return {
        fixedSeats: raw.fixedSeats,
        avoidGroups: raw.avoidGroups,
        genderShuffleMode: raw.genderShuffleMode,
        genderSeatPreferences: raw.genderSeatPreferences,
    };
};

const mergeAssignments = (currentGroups, proposedGroups) => {
    if (!Array.isArray(currentGroups) || !Array.isArray(proposedGroups)) {
        throw new Error("자리 정보가 올바르지 않습니다.");
    }
    const currentDesks = currentGroups.flatMap((group) => group.desks || []);
    const proposedDesks = proposedGroups.flatMap((group) => group.desks || []);
    const byId = new Map(proposedDesks.map((desk) => [desk.id, desk]));
    if (byId.size !== currentDesks.length || proposedDesks.length !== currentDesks.length ||
        currentDesks.some((desk) => !byId.has(desk.id))) {
        throw new Error("책상 추가·제거는 배치 관리에서 진행해 주세요.");
    }
    const studentIds = new Set();
    const groups = currentGroups.map((group) => ({
        ...group,
        desks: group.desks.map((desk) => {
            const proposal = byId.get(desk.id);
            const next = { ...desk };
            ASSIGNMENT_FIELDS.forEach((field) => {
                if (Object.prototype.hasOwnProperty.call(proposal, field)) next[field] = proposal[field];
            });
            next.teamId = next.teamId || "none";
            if (!validStudentId(next.studentId) || !validStudentName(next.studentName) ||
                typeof next.isActive !== "boolean" ||
                typeof next.teamId !== "string" ||
                !/^(none|team[1-6])$/.test(next.teamId)) {
                throw new Error("학생 배정 또는 모둠 정보가 올바르지 않습니다.");
            }
            if (next.isActive === false && desk.isActive !== false &&
                (desk.ownerId || desk.rentContractId ||
                    Number(desk.rentDepositPaidAmount || 0) -
                    Number(desk.rentDepositReturnedAmount || 0) -
                    Number(desk.rentDepositDeductedAmount || 0) > 0)) {
                throw new Error("소유권·계약·미정산 보증금이 있는 자리는 숨길 수 없습니다.");
            }
            if (desk.studentId !== next.studentId &&
                (desk.rentContractId || desk.rentTenantId ||
                    Number(desk.rentDepositPaidAmount || 0) -
                    Number(desk.rentDepositReturnedAmount || 0) -
                    Number(desk.rentDepositDeductedAmount || 0) > 0)) {
                throw new Error("계약과 보증금을 정리한 뒤 학생 배정을 바꿀 수 있습니다.");
            }
            if (next.studentId) {
                if (studentIds.has(next.studentId)) throw new Error("한 학생이 여러 자리에 배정되었습니다.");
                studentIds.add(next.studentId);
            }
            return next;
        }),
    }));
    return groups;
};

const buildGrouping = (groups, updatedAt) => {
    const byStudent = {};
    const teamMembers = {};
    groups.flatMap((group) => group.desks || []).forEach((desk) => {
        if (desk.isActive === false || !desk.studentId || !/^team\d+$/.test(desk.teamId || "")) return;
        byStudent[desk.studentId] = desk.teamId;
        (teamMembers[desk.teamId] ||= []).push(desk.studentId);
    });
    const teams = Object.entries(teamMembers).sort((a, b) =>
        Number(a[0].slice(4)) - Number(b[0].slice(4))).map(([id, studentIds]) => ({
        id, name: `${id.slice(4)}모둠`, studentIds,
    }));
    return { enabled: teams.length > 0, byStudent, groups: teams,
        source: "real_estate_layout", updatedAt };
};

module.exports = { mergeAssignments, buildGrouping, validateConstraints };
