const normalizeTier = (rawTier = null) => {
  if (!rawTier) return null;

  if (typeof rawTier === "string") {
    const value = rawTier.trim();
    if (!value) return null;

    return {
      id: value,
      name: value,
      color: "#64748b",
      minScore: 0,
    };
  }

  const id = String(rawTier?.id || rawTier?.name || "").trim();
  if (!id) return null;

  const parsedMinScore = Number(rawTier?.minScore);

  return {
    id,
    name: String(rawTier?.name || id).trim(),
    color: String(rawTier?.color || "#64748b"),
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
  };
};

export const getMissionMinTierRequirement = (mission = {}) => {
  const tierMeta = normalizeTier(mission?.minCreditTier);
  if (tierMeta) return tierMeta;

  const tierId = String(mission?.minCreditTierId || "").trim();
  if (!tierId) return null;

  const parsedMinScore = Number(mission?.minCreditTierMinScore);
  return {
    id: tierId,
    name: String(mission?.minCreditTierName || tierId).trim(),
    color: String(mission?.minCreditTierColor || "#64748b"),
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
  };
};

export const getStudentTierInfo = (student = {}) =>
  normalizeTier(student?.creditTier);

export const meetsMissionTierRequirement = (mission = {}, student = {}) => {
  const minTier = getMissionMinTierRequirement(mission);
  if (!minTier) return true;

  const studentScore = Number(student?.creditScore);
  if (Number.isFinite(studentScore)) {
    return studentScore >= Number(minTier.minScore || 0);
  }

  const studentTier = getStudentTierInfo(student);
  if (!studentTier) return false;

  if (studentTier.id && studentTier.id === minTier.id) return true;

  return Number(studentTier.minScore || 0) >= Number(minTier.minScore || 0);
};

export const isMissionAssignedToStudent = (
  mission = {},
  student = {},
  studentUid = null,
) => {
  const resolvedUid = String(studentUid || student?.uid || "").trim();
  if (!resolvedUid) return false;

  const targets = Array.isArray(mission?.targetStudentUids)
    ? mission.targetStudentUids
    : [];

  if (targets.length > 0 && !targets.includes(resolvedUid)) {
    return false;
  }

  return meetsMissionTierRequirement(mission, student);
};
