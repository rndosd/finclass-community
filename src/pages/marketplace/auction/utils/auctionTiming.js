const MINUTE_MS = 60 * 1000;

export const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

export function getAuctionTimerStartMs(item) {
  const timerStartedAtMs = toMillis(item?.timerStartedAt);
  if (timerStartedAtMs > 0) return timerStartedAtMs;

  const approvedAtMs = toMillis(item?.approvedAt);
  return approvedAtMs > 0 ? approvedAtMs : 0;
}

export function getAuctionEndAtMs(item) {
  const explicitEndAtMs = toMillis(item?.endAt);
  if (explicitEndAtMs > 0) return explicitEndAtMs;

  const durationMinutes = Number(item?.durationMinutes || 0);
  const timerStartMs = getAuctionTimerStartMs(item);

  if (timerStartMs > 0 && Number.isFinite(durationMinutes) && durationMinutes > 0) {
    return timerStartMs + Math.floor(durationMinutes * MINUTE_MS);
  }

  return 0;
}
