import { normalizeTitleRevealConfig, deriveLegacyTitleRevealMode, CERTIFICATE_NO_STAGE_ID, getGradeMeta, normalizeGradeList, DEFAULT_CERTIFICATE_GRADES } from "./CredentialsPage.parts";

export function buildResolvedTitleReveal(primarySource = null, fallbackSource = null) {
  const revealConfig = normalizeTitleRevealConfig(
    primarySource?.revealConfig || fallbackSource?.revealConfig,
    primarySource?.revealMode || fallbackSource?.revealMode || "condition_only",
  );

  return {
    revealConfig,
    revealMode: deriveLegacyTitleRevealMode(revealConfig),
  };
}

export function getCertificateStageMeta(grades, value, legacyFallbackId) {
  const normalizedValue = String(value || "").trim();
  if (normalizedValue === CERTIFICATE_NO_STAGE_ID) {
    return {
      id: CERTIFICATE_NO_STAGE_ID,
      label: "",
      tone: "slate",
      order: 0,
    };
  }

  return getGradeMeta(
    grades,
    normalizedValue || legacyFallbackId,
    legacyFallbackId,
  );
}

export function normalizeCertificateStageList(stages) {
  if (Array.isArray(stages) && stages.length === 0) return [];
  const normalizedStages = normalizeGradeList(stages, DEFAULT_CERTIFICATE_GRADES);
  const legacyDefaultLabels = {
    basic: "1단계",
    intermediate: "2단계",
    advanced: "3단계",
  };
  const currentDefaultLabels = new Map(
    DEFAULT_CERTIFICATE_GRADES.map((item) => [item.id, item.label]),
  );

  return normalizedStages.map((item) => (
    legacyDefaultLabels[item.id] === item.label
      ? { ...item, label: currentDefaultLabels.get(item.id) || item.label }
      : item
  ));
}

