const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (value) => String(value).padStart(2, "0");

export const KST_TIME_ZONE = "Asia/Seoul";

export const toDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") {
    const nanos = typeof value?.nanoseconds === "number" ? value.nanoseconds : 0;
    return new Date(value.seconds * 1000 + Math.floor(nanos / 1000000));
  }
  if (typeof value?._seconds === "number") {
    const nanos = typeof value?._nanoseconds === "number" ? value._nanoseconds : 0;
    return new Date(value._seconds * 1000 + Math.floor(nanos / 1000000));
  }
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatDateKeyInKST = (value = new Date()) => {
  const date = toDate(value);
  if (!date) return "";

  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return [
    shifted.getUTCFullYear(),
    pad2(shifted.getUTCMonth() + 1),
    pad2(shifted.getUTCDate()),
  ].join("-");
};

export const parseDateKeyAsKST = (value, options = {}) => {
  const match = String(value || "").trim().match(DATE_KEY_RE);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const startMs = Date.UTC(year, monthIndex, day) - KST_OFFSET_MS;

  return new Date(startMs + (options.endOfDay ? ONE_DAY_MS - 1 : 0));
};

export const startOfDayInKST = (value = new Date()) => {
  const date = toDate(value);
  if (!date) return null;
  return parseDateKeyAsKST(formatDateKeyInKST(date));
};

export const endOfDayInKST = (value = new Date()) => {
  const date = toDate(value);
  if (!date) return null;
  return parseDateKeyAsKST(formatDateKeyInKST(date), { endOfDay: true });
};

export const addCalendarDaysInKST = (value, days) => {
  const start = startOfDayInKST(value);
  if (!start) return null;
  return new Date(start.getTime() + ONE_DAY_MS * (Number(days) || 0));
};

export const shiftDateKeyInKST = (value = new Date(), days = 0) => {
  const shifted = addCalendarDaysInKST(value, days);
  return shifted ? formatDateKeyInKST(shifted) : "";
};

export const getRecentDateRangeInKST = ({
  days = 7,
  endDate = new Date(),
  endOffsetDays = 0,
} = {}) => {
  const safeDays = Math.max(1, Math.floor(Number(days) || 1));
  const endBase =
    typeof endDate === "string" && DATE_KEY_RE.test(endDate)
      ? parseDateKeyAsKST(endDate)
      : endDate;
  const endDateKey = shiftDateKeyInKST(endBase || new Date(), endOffsetDays);
  const startDateKey = shiftDateKeyInKST(
    parseDateKeyAsKST(endDateKey) || new Date(),
    -(safeDays - 1),
  );

  return { startDate: startDateKey, endDate: endDateKey };
};

export const formatDateInKST = (value, locale = "ko-KR", options = {}) => {
  const date = toDate(value);
  if (!date) return "";

  return new Intl.DateTimeFormat(locale, {
    timeZone: KST_TIME_ZONE,
    ...options,
  }).format(date);
};

