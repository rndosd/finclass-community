export const DEFAULT_MISSION_TOKEN_LABEL = "배움토큰";

export const normalizeMissionTokenLabel = (value) => {
  const normalized = String(value || "").trim();
  return normalized || DEFAULT_MISSION_TOKEN_LABEL;
};

export const resolveMissionTokenLabel = (classData = null) =>
  normalizeMissionTokenLabel(
    classData?.missionTokenLabel ?? classData?.settings?.missionTokenLabel,
  );
