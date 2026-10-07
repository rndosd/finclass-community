"use strict";

// Activate only after direct-list readers have been deployed. Existing clients
// still consume the rich list projection, so missing flags retain compatibility.
function usesDirectMissionList(classData) {
    return classData?.missionListReaderVersion === 3;
}

function compactHomeMissionSummary(summary = {}) {
    const dateString = (value) => {
        if (!value) return null;
        const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    return {
        regularTotal: Number(summary.regularTotal || 0),
        regularCompleted: Number(summary.regularCompleted || 0),
        regularMissions: (summary.regularMissions || []).map((entry) => ({
            id: entry.id, title: entry.title, startAt: dateString(entry.startAt),
            endAt: dateString(entry.endAt), completionStatus: entry.completionStatus || null,
            // Status alone supports idempotent action-count contributions.
            completion: entry.completionStatus ? { status: entry.completionStatus } : null,
        })),
        alwaysMissions: (summary.alwaysMissions || []).map((entry) => ({
            id: entry.id, title: entry.title, isActive: entry.isActive !== false,
            availability: entry.availability || {},
        })),
    };
}

module.exports = { usesDirectMissionList, compactHomeMissionSummary };
