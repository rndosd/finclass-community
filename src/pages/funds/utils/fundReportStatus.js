function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }

  const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

export function isFundReportOverdue(fund = {}, now = Date.now()) {
  const dueAtMillis = toMillis(fund?.nextReportDueAt);
  if (dueAtMillis === null) return false;

  const nowMillis = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMillis)) return false;

  return dueAtMillis <= nowMillis;
}

export function getFundReportOverdueLabel(fund = {}, now = Date.now()) {
  const dueAtMillis = toMillis(fund?.nextReportDueAt);
  const nowMillis = now instanceof Date ? now.getTime() : Number(now);
  if (dueAtMillis === null || !Number.isFinite(nowMillis) || dueAtMillis > nowMillis) {
    return null;
  }

  const overdueDays = Math.floor((nowMillis - dueAtMillis) / (24 * 60 * 60 * 1000));
  return overdueDays > 0 ? `${overdueDays}일 연체` : "보고서 연체";
}
