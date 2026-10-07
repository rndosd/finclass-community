const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const WEEKDAY_KEY_BY_SHORT = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

export const DAY_META = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
  { key: "sun", label: "일" },
];

export const DAY_LABEL_MAP = DAY_META.reduce((acc, item) => {
  acc[item.key] = item.label;
  return acc;
}, {});

export const DEFAULT_TIMEZONE = "Asia/Seoul";

export const createEmptyUsageRules = () =>
  DAY_META.reduce((acc, day) => {
    acc[day.key] = [];
    return acc;
  }, {});

export const toMinutes = (timeValue) => {
  const safe = String(timeValue || "").trim();
  const match = safe.match(TIME_RE);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour * 60 + minute;
};

export const formatTime = (minutes) => {
  if (!Number.isFinite(minutes)) return "00:00";
  const normalized = Math.max(0, Math.min(1439, Math.floor(minutes)));
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const normalizeRange = (range) => {
  const start = String(range?.start || "").trim();
  const end = String(range?.end || "").trim();
  if (toMinutes(start) === null || toMinutes(end) === null) return null;
  if (start === end) return null;
  return { start, end };
};

const normalizeRanges = (ranges) => {
  const list = Array.isArray(ranges) ? ranges : [];
  return list
    .map((range) => normalizeRange(range))
    .filter(Boolean)
    .sort((a, b) => {
      const aMin = toMinutes(a.start) ?? 0;
      const bMin = toMinutes(b.start) ?? 0;
      if (aMin !== bMin) return aMin - bMin;
      return (toMinutes(a.end) ?? 0) - (toMinutes(b.end) ?? 0);
    });
};

export const normalizeUsageRules = (rawRules) => {
  const base = createEmptyUsageRules();
  if (!rawRules || typeof rawRules !== "object") return base;
  DAY_META.forEach((day) => {
    base[day.key] = normalizeRanges(rawRules[day.key]);
  });
  return base;
};

export const normalizeUsageSchedule = (raw) => {
  const safe = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: safe.enabled === true,
    studentOnly: safe.studentOnly !== false,
    timezone: String(safe.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE,
    rules: normalizeUsageRules(safe.rules),
  };
};

const isInRange = (range, currentMinutes) => {
  const start = toMinutes(range?.start);
  const end = toMinutes(range?.end);
  if (start === null || end === null) return false;
  if (end > start) return currentMinutes >= start && currentMinutes < end;
  return currentMinutes >= start || currentMinutes < end;
};

const getCurrentTimeContext = (timeZone = DEFAULT_TIMEZONE) => {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch (_error) {
    formatter = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  const parts = formatter.formatToParts(new Date());
  const weekdayShort = parts.find((part) => part.type === "weekday")?.value;
  const hourRaw = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const dayKey = WEEKDAY_KEY_BY_SHORT[weekdayShort] || "mon";
  const hour = Number.isFinite(hourRaw) ? hourRaw % 24 : 0;
  const currentMinutes = hour * 60 + (Number.isFinite(minute) ? minute : 0);

  return { dayKey, currentMinutes };
};

const buildTodayAllowedText = (ranges = []) => {
  if (!Array.isArray(ranges) || ranges.length === 0) return "설정된 허용 시간이 없습니다.";
  return ranges.map((range) => `${range.start}~${range.end}`).join(", ");
};

export const getUsageScheduleBlockInfo = (rawSchedule) => {
  const schedule = normalizeUsageSchedule(rawSchedule);
  if (!schedule.enabled) {
    return { blocked: false, schedule };
  }

  const { dayKey, currentMinutes } = getCurrentTimeContext(schedule.timezone);
  const todayRanges = schedule.rules?.[dayKey] || [];
  const isAllowedNow = todayRanges.some((range) => isInRange(range, currentMinutes));
  if (isAllowedNow) {
    return {
      blocked: false,
      schedule,
      dayKey,
      todayRanges,
    };
  }

  const dayLabel = DAY_LABEL_MAP[dayKey] || dayKey;
  return {
    blocked: true,
    schedule,
    dayKey,
    todayRanges,
    detail: `현재는 이용 가능 시간이 아닙니다. (${dayLabel}요일 허용: ${buildTodayAllowedText(todayRanges)})`,
  };
};

export const validateUsageRules = (rawRules) => {
  const rules = normalizeUsageRules(rawRules);
  const errors = [];

  DAY_META.forEach((day) => {
    const ranges = rules[day.key] || [];
    for (let index = 0; index < ranges.length; index += 1) {
      const current = ranges[index];
      const start = toMinutes(current.start);
      const end = toMinutes(current.end);
      if (start === null || end === null) {
        errors.push(`${day.label}요일 시간 형식이 올바르지 않습니다.`);
        continue;
      }
      if (start === end) {
        errors.push(`${day.label}요일 시작/종료 시간이 같습니다.`);
      }
      if (index > 0) {
        const prev = ranges[index - 1];
        const prevStart = toMinutes(prev.start);
        const prevEnd = toMinutes(prev.end);
        if (
          Number.isFinite(prevStart) &&
          Number.isFinite(prevEnd) &&
          prevEnd > prevStart &&
          end > start &&
          start < prevEnd
        ) {
          errors.push(`${day.label}요일 시간대가 서로 겹칩니다.`);
        }
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    rules,
  };
};
