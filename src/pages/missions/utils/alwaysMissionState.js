const KST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const DEFAULT_ALWAYS_DAYS = [1, 2, 3, 4, 5];

export function normalizeAlwaysDays(days, fallback = DEFAULT_ALWAYS_DAYS) {
  if (!Array.isArray(days) || days.length === 0) return fallback;

  const normalized = days
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

  return normalized.length > 0 ? [...new Set(normalized)] : fallback;
}

export function getAlwaysAvailabilityDays(availability = {}) {
  return normalizeAlwaysDays(availability?.daysOfWeek || availability?.days);
}

export function getAlwaysMaxPerDay(mission = {}) {
  const value =
    mission?.availability?.maxPerDay ?? mission?.maxPerDay ?? mission?.dailyLimit ?? 1;
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 1;
}

export function isAlwaysAvailableOnDay(availability = {}, date = new Date()) {
  return getAlwaysAvailabilityDays(availability).includes(date.getDay());
}

export function isWithinAlwaysTimeRange(availability = {}, date = new Date()) {
  const startTime = availability?.startTime;
  const endTime = availability?.endTime;
  if (!startTime || !endTime) return true;

  const [startHour, startMinute] = String(startTime).split(":").map(Number);
  const [endHour, endMinute] = String(endTime).split(":").map(Number);

  if (
    !Number.isFinite(startHour) ||
    !Number.isFinite(startMinute) ||
    !Number.isFinite(endHour) ||
    !Number.isFinite(endMinute)
  ) {
    return true;
  }

  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

export function getTodayKeyInKST(date = new Date()) {
  const parts = KST_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

export function getTodayCountFromMissionState(missionState = {}, todayKey = null) {
  const resolvedTodayKey = todayKey || getTodayKeyInKST();
  if (!missionState || missionState.todayKey !== resolvedTodayKey) return 0;

  const todayCount = Number(missionState.todayCount || 0);
  return Number.isFinite(todayCount) ? todayCount : 0;
}
