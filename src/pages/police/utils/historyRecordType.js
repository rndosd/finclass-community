const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const resolvePoliceHistoryType = (record = {}) => {
  const explicitType = String(record?.type || "").trim().toLowerCase();
  if (explicitType === "reward") return "reward";
  if (explicitType === "fine" || explicitType === "penalty") return "fine";

  const deltas = [
    toNumber(record?.amountSigned ?? record?.amount),
    toNumber(
      record?.creditChangeApplied ??
        record?.creditChange ??
        record?.originalCreditChangeApplied,
    ),
    toNumber(
      record?.missionTokenChangeApplied ??
        record?.missionTokenChange ??
        record?.originalMissionTokenChangeApplied,
    ),
  ];

  if (deltas.some((value) => value > 0)) return "reward";
  if (deltas.some((value) => value < 0)) return "fine";
  return null;
};

export const isPoliceRewardRecord = (record = {}) =>
  resolvePoliceHistoryType(record) === "reward";

export const isPoliceFineRecord = (record = {}) =>
  resolvePoliceHistoryType(record) === "fine";

export const isPoliceIgnoredReportRecord = (record = {}) => {
  const explicitType = String(record?.type || "").trim().toLowerCase();
  const status = String(record?.status || "").trim().toLowerCase();
  const eventType = String(record?.eventType || "").trim().toLowerCase();
  const reportOutcome = String(record?.reportOutcome || "")
    .trim()
    .toLowerCase();

  return (
    explicitType === "report" ||
    status === "resolved_ignored" ||
    eventType === "report_ignored" ||
    reportOutcome === "ignored"
  );
};
