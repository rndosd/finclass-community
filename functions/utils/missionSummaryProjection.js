"use strict";

function normalizeTierForEligibility(tier = null) {
    if (!tier || typeof tier !== "object") return null;
    return {
        id: String(tier.id || tier.name || "").trim(),
        minScore: Number.isFinite(Number(tier.minScore)) ?
            Number(tier.minScore) :
            null,
    };
}

function getMissionStudentEligibilityFingerprint(studentData = {}) {
    const score = Number(studentData?.creditScore);
    const hasScore = Number.isFinite(score);
    return JSON.stringify({
        role: String(studentData?.role || "student").toLowerCase(),
        creditScore: hasScore ? score : null,
        creditTier: hasScore ? null : normalizeTierForEligibility(
            studentData?.creditTier,
        ),
    });
}

function hasMissionStudentEligibilityChanged(beforeData = {}, afterData = {}) {
    return getMissionStudentEligibilityFingerprint(beforeData) !==
        getMissionStudentEligibilityFingerprint(afterData);
}

module.exports = {
    getMissionStudentEligibilityFingerprint,
    hasMissionStudentEligibilityChanged,
};
