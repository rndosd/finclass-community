export const DEFAULT_REPORT_CYCLE_DAYS = 7;
export const MIN_REPORT_CYCLE_DAYS = 1;
export const MAX_REPORT_CYCLE_DAYS = 30;

export function clampReportCycleDays(
  value,
  fallback = DEFAULT_REPORT_CYCLE_DAYS,
) {
  const numeric = Math.round(Number(value) || 0);
  if (!Number.isFinite(numeric) || numeric < MIN_REPORT_CYCLE_DAYS) {
    return fallback;
  }
  return Math.min(MAX_REPORT_CYCLE_DAYS, numeric);
}

function parseDaysFromLabel(label = "") {
  const matched = String(label || "").match(/(\d+)\s*일/);
  if (!matched) return null;
  const parsed = Number(matched[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeReportCycle(
  cycleDays,
  legacyValue = "",
  legacyLabel = "",
) {
  if (Number(cycleDays) >= MIN_REPORT_CYCLE_DAYS) {
    const days = clampReportCycleDays(cycleDays);
    return {
      days,
      label: `${days}일`,
      displayLabel: `${days}일마다`,
    };
  }

  const parsedDays = parseDaysFromLabel(legacyLabel);
  if (parsedDays) {
    const days = clampReportCycleDays(parsedDays);
    return {
      days,
      label: `${days}일`,
      displayLabel: `${days}일마다`,
    };
  }

  const normalizedLegacyValue = String(legacyValue || "").trim();
  const normalizedLegacyLabel = String(legacyLabel || "").trim();
  const days =
    normalizedLegacyValue === "biweekly" ||
    normalizedLegacyLabel.includes("격주") ||
    normalizedLegacyLabel.includes("2주")
      ? 14
      : DEFAULT_REPORT_CYCLE_DAYS;

  return {
    days,
    label: `${days}일`,
    displayLabel: `${days}일마다`,
  };
}

export function formatReportCycleLabel(source = {}) {
  const { displayLabel } = normalizeReportCycle(
    source?.reportCycleDays ?? source?.fundReportCycleDays,
    source?.reportCadence ?? source?.fundReportCadence,
    source?.reportCadenceLabel ?? source?.fundReportCadenceLabel,
  );
  return displayLabel;
}
