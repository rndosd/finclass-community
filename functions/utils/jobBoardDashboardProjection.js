"use strict";

function normalizeComparable(value) {
    if (value === null || value === undefined) return value ?? null;
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (Array.isArray(value)) return value.map(normalizeComparable);
    if (typeof value === "object") {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                result[key] = normalizeComparable(value[key]);
                return result;
            }, {});
    }
    return value;
}

function getJobBoardDashboardContribution(kind, data = null) {
    if (!data || typeof data !== "object") return null;

    switch (kind) {
    case "post":
        return {
            authorUid: data.authorUid || null,
            status: data.status || null,
            applyDeadlineAt: data.applyDeadlineAt || null,
            applicationCount: data.applicationCount ?? null,
        };
    case "application":
        return {
            classId: data.classId || null,
            applicantUid: data.applicantUid || null,
            authorUid: data.authorUid || null,
            status: data.status || null,
            paymentShares: data.paymentShares || [],
        };
    case "profile":
        return {
            requesterRatingAverage: data.requesterRatingAverage ?? null,
            requesterRatingCount: data.requesterRatingCount ?? null,
        };
    case "service":
        return {
            ownerUid: data.ownerUid || null,
            status: data.status || null,
        };
    case "request":
        return {
            classId: data.classId || null,
            requesterUid: data.requesterUid || null,
            providerUid: data.providerUid || null,
            status: data.status || null,
            proposedRewardAmount: data.proposedRewardAmount ?? null,
        };
    default:
        return data;
    }
}

function getJobBoardDashboardContributionFingerprint(kind, data = null) {
    return JSON.stringify(normalizeComparable(
        getJobBoardDashboardContribution(kind, data),
    ));
}

function hasJobBoardDashboardContributionChanged(kind, beforeData, afterData) {
    return getJobBoardDashboardContributionFingerprint(kind, beforeData) !==
        getJobBoardDashboardContributionFingerprint(kind, afterData);
}

function getComparableJobBoardDashboardSummary(summary = {}) {
    return normalizeComparable({
        classId: summary.classId || null,
        userUid: summary.userUid || null,
        recruit: summary.recruit || {},
        seeker: summary.seeker || {},
        rating: summary.rating || {},
    });
}

function areJobBoardDashboardSummariesEqual(left = {}, right = {}) {
    return JSON.stringify(getComparableJobBoardDashboardSummary(left)) ===
        JSON.stringify(getComparableJobBoardDashboardSummary(right));
}

module.exports = {
    areJobBoardDashboardSummariesEqual,
    getJobBoardDashboardContributionFingerprint,
    hasJobBoardDashboardContributionChanged,
};
