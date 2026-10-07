import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { alwaysListAttempts } from '../../../services/missionAlwaysService';
import { isMissionAssignedToStudent } from '../../../utils/missionEligibility';

export { isMissionAssignedToStudent };

dayjs.extend(utc);

dayjs.extend(timezone);

export const KST = "Asia/Seoul";

export const DEFAULT_ALWAYS_DAYS = [1, 2, 3, 4, 5];

export const APPROVED_MISSION_STATUSES = new Set(["approved", "late-approved"]);

export const MAX_ATTEMPT_PAGES = 20;
export const LONG_RANGE_MONTH_THRESHOLD_DAYS = 45;

export const GENERAL_SCOPE_ID = "general";

export const ALWAYS_ALL_SCOPE_ID = "always-all";

export const makeAlwaysScopeId = missionId => `always:${missionId}`;

export const getMissionIdFromScope = scopeId => typeof scopeId === "string" && scopeId.startsWith("always:") ? scopeId.slice("always:".length) : null;

export const RANGE_OPTIONS = [{
  key: "today",
  label: "오늘"
}, {
  key: "7d",
  label: "7일"
}, {
  key: "30d",
  label: "30일"
}, {
  key: "custom",
  label: "직접 선택"
}];

export const SORT_OPTIONS = [{
  key: "consistency",
  label: "꾸준함 순"
}, {
  key: "activity",
  label: "많이 한 순"
}, {
  key: "name",
  label: "이름 순"
}];

export const HIGHLIGHT_TONE = {
  indigo: {
    card: "border-indigo-200 bg-indigo-50/70",
    icon: "bg-white text-indigo-700",
    eyebrow: "text-indigo-700",
    title: "text-indigo-950",
    detail: "text-indigo-800"
  },
  emerald: {
    card: "border-emerald-200 bg-emerald-50/70",
    icon: "bg-white text-emerald-700",
    eyebrow: "text-emerald-700",
    title: "text-emerald-950",
    detail: "text-emerald-800"
  },
  amber: {
    card: "border-amber-200 bg-amber-50/80",
    icon: "bg-white text-amber-700",
    eyebrow: "text-amber-700",
    title: "text-amber-950",
    detail: "text-amber-800"
  },
  slate: {
    card: "border-slate-200 bg-slate-50",
    icon: "bg-white text-slate-700",
    eyebrow: "text-slate-600",
    title: "text-slate-900",
    detail: "text-slate-600"
  }
};

export const SCOPE_TONE = {
  slate: {
    active: "border-sky-500 bg-sky-500 text-white shadow-sm shadow-sky-100",
    inactive: "border-sky-100 bg-sky-50/60 text-sky-900 hover:border-sky-200 hover:bg-sky-50",
    badge: "bg-white text-sky-700 ring-1 ring-sky-100",
    badgeActive: "bg-white/15 text-white",
    bar: "bg-sky-500",
    barActive: "bg-white",
    meta: "text-sky-700/80",
    metaActive: "text-sky-100"
  },
  indigo: {
    active: "border-indigo-600 bg-indigo-600 text-white shadow-sm",
    inactive: "border-indigo-100 bg-indigo-50/60 text-indigo-950 hover:border-indigo-200 hover:bg-indigo-50",
    badge: "bg-white text-indigo-700 ring-1 ring-indigo-100",
    badgeActive: "bg-white/15 text-white",
    bar: "bg-indigo-500",
    barActive: "bg-white",
    meta: "text-indigo-700/80",
    metaActive: "text-indigo-100"
  },
  sky: {
    active: "border-sky-600 bg-sky-600 text-white shadow-sm",
    inactive: "border-sky-100 bg-sky-50/70 text-sky-950 hover:border-sky-200 hover:bg-sky-50",
    badge: "bg-white text-sky-700 ring-1 ring-sky-100",
    badgeActive: "bg-white/15 text-white",
    bar: "bg-sky-500",
    barActive: "bg-white",
    meta: "text-sky-700/80",
    metaActive: "text-sky-100"
  }
};

export const toStudentSortValue = student => Number.isFinite(Number(student?.studentNumber)) ? Number(student.studentNumber) : Number.MAX_SAFE_INTEGER;

export const compareStudents = (left, right) => toStudentSortValue(left) - toStudentSortValue(right) || String(left?.name || "").localeCompare(String(right?.name || ""), "ko") || String(left?.uid || "").localeCompare(String(right?.uid || ""));

export const toDateSafe = value => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const toMillis = value => toDateSafe(value)?.getTime?.() ?? 0;

export const clampPercent = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

export const upsertLatestAt = (current, candidate) => {
  const currentTime = toMillis(current);
  const candidateTime = toMillis(candidate);
  return candidateTime > currentTime ? candidate : current;
};

export const pickLatestDate = (...values) => values.reduce((latest, value) => upsertLatestAt(latest, value), null);

export const formatDayKey = value => dayjs(value).tz(KST).format("YYYY-MM-DD");

export const formatDateTime = value => {
  const target = toDateSafe(value);
  if (!target) return "-";
  return dayjs(target).tz(KST).format("MM.DD HH:mm");
};

export const formatRecentActivity = value => {
  const safeValue = toDateSafe(value);
  if (!safeValue) return "기록 없음";
  const target = dayjs(safeValue).tz(KST);
  if (!target.isValid()) return "기록 없음";
  const diffDays = dayjs().tz(KST).startOf("day").diff(target.startOf("day"), "day");
  if (diffDays <= 0) return `오늘 ${target.format("HH:mm")}`;
  if (diffDays === 1) return `어제 ${target.format("HH:mm")}`;
  if (diffDays < 7) return `${diffDays}일 전`;
  return target.format("MM.DD HH:mm");
};

export const isDateInRange = (value, start, end) => {
  const target = toDateSafe(value);
  if (!target) return false;
  const time = target.getTime();
  const startTime = start ? dayjs(start).valueOf() : null;
  const endTime = end ? dayjs(end).valueOf() : null;
  if (startTime !== null && time < startTime) return false;
  if (endTime !== null && time > endTime) return false;
  return true;
};

export const getRangeBounds = (rangeMode, customRange) => {
  const now = dayjs().tz(KST);
  if (rangeMode === "today") {
    return {
      start: now.startOf("day"),
      end: now.endOf("day")
    };
  }
  if (rangeMode === "30d") {
    return {
      start: now.subtract(29, "day").startOf("day"),
      end: now.endOf("day")
    };
  }
  if (rangeMode === "custom") {
    return {
      start: customRange?.start ? dayjs.tz(`${customRange.start}T00:00:00`, KST) : null,
      end: customRange?.end ? dayjs.tz(`${customRange.end}T23:59:59`, KST) : null
    };
  }
  return {
    start: now.subtract(6, "day").startOf("day"),
    end: now.endOf("day")
  };
};

export const getGeneralMissionStatus = (mission, studentUid) => {
  const completion = mission?.completions?.[studentUid];
  if (!completion?.status) {
    return "not_submitted";
  }
  if (completion.status === "approved" && completion.late === true) {
    return "late-approved";
  }
  return completion.status;
};

export const getGeneralMissionLatestAt = (mission, studentUid) => {
  const completion = mission?.completions?.[studentUid];
  return pickLatestDate(completion?.approvedAtMs, completion?.approvedAt, completion?.updatedAtMs, completion?.updatedAt, completion?.completedAtMs, completion?.completedAt, completion?.submittedAtMs, completion?.submittedAt, completion?.createdAtMs, completion?.createdAt, mission?.lastAttempts?.[studentUid]?.approvedAtMs, mission?.lastAttempts?.[studentUid]?.approvedAt);
};

export const createAlwaysStats = () => ({
  availableDayCount: 0,
  completedDayCount: 0,
  extraApprovedCount: 0,
  totalApprovedCount: 0,
  totalAttemptCount: 0,
  pendingCount: 0,
  latestAt: null
});

export const mergeAlwaysStats = (base, incoming) => ({
  availableDayCount: Number(base?.availableDayCount || 0) + Number(incoming?.availableDayCount || 0),
  completedDayCount: Number(base?.completedDayCount || 0) + Number(incoming?.completedDayCount || 0),
  extraApprovedCount: Number(base?.extraApprovedCount || 0) + Number(incoming?.extraApprovedCount || 0),
  totalApprovedCount: Number(base?.totalApprovedCount || 0) + Number(incoming?.totalApprovedCount || 0),
  totalAttemptCount: Number(base?.totalAttemptCount || 0) + Number(incoming?.totalAttemptCount || 0),
  pendingCount: Number(base?.pendingCount || 0) + Number(incoming?.pendingCount || 0),
  latestAt: upsertLatestAt(base?.latestAt, incoming?.latestAt)
});

export const applyDayAggregate = (base, {
  attemptCount = 0,
  approvedCount = 0,
  pendingCount = 0,
  latestAt = null
}) => {
  const approved = Number(approvedCount || 0);
  const attempts = Number(attemptCount || 0);
  return {
    ...base,
    completedDayCount: base.completedDayCount + (approved > 0 ? 1 : 0),
    extraApprovedCount: base.extraApprovedCount + Math.max(approved - 1, 0),
    totalApprovedCount: base.totalApprovedCount + approved,
    totalAttemptCount: base.totalAttemptCount + attempts,
    pendingCount: base.pendingCount + Number(pendingCount || 0),
    latestAt: upsertLatestAt(base.latestAt, latestAt)
  };
};

export const applyMonthAggregate = (base, {
  attemptCount = 0,
  approvedCount = 0,
  pendingCount = 0,
  activeDayCount = 0,
  latestAt = null
}) => ({
  ...base,
  completedDayCount: base.completedDayCount + Number(activeDayCount || 0),
  totalApprovedCount: base.totalApprovedCount + Number(approvedCount || 0),
  totalAttemptCount: base.totalAttemptCount + Number(attemptCount || 0),
  pendingCount: base.pendingCount + Number(pendingCount || 0),
  latestAt: upsertLatestAt(base.latestAt, latestAt)
});

export const getRangeDaySpan = (dateFrom, dateTo) => {
  if (!dateFrom || !dateTo) return 0;
  const start = dayjs.tz(`${dateFrom}T00:00:00`, KST);
  const end = dayjs.tz(`${dateTo}T00:00:00`, KST);
  if (!start.isValid() || !end.isValid() || end.isBefore(start, "day")) {
    return 0;
  }
  return end.diff(start, "day") + 1;
};

export const shouldUseMonthlyAlwaysStats = (mission, dateFrom, dateTo) => Boolean(
  mission?.autoApprove &&
  getRangeDaySpan(dateFrom, dateTo) > LONG_RANGE_MONTH_THRESHOLD_DAYS,
);

export const hasAlwaysSummaryActivityHint = (mission, students = []) => {
  const totalCount = Number(
    mission?.stats?.totalCount ?? mission?.["stats.totalCount"] ?? 0,
  );
  const approvedCount = Number(
    mission?.stats?.approvedCount ?? mission?.["stats.approvedCount"] ?? 0,
  );
  const pendingCount = Number(
    mission?.stats?.pendingCount ?? mission?.["stats.pendingCount"] ?? 0,
  );

  if (totalCount > 0 || approvedCount > 0 || pendingCount > 0) {
    return true;
  }

  return students.some(student => {
    const studentUid = String(student?.uid || "");
    return !!studentUid && !!mission?.lastAttempts?.[studentUid];
  });
};

export const resolveAttemptDayKey = attempt => {
  if (typeof attempt?.dayKey === "string" && attempt.dayKey.trim()) {
    return attempt.dayKey.trim();
  }
  const attemptDate = toDateSafe(attempt?.createdAtMs) || toDateSafe(attempt?.createdAt) || toDateSafe(attempt?.approvedAtMs) || toDateSafe(attempt?.approvedAt);
  return attemptDate ? formatDayKey(attemptDate) : null;
};

export const getAlwaysAvailableDays = (mission, dateFrom, dateTo) => {
  if (!dateFrom || !dateTo) return 0;
  const start = dayjs.tz(`${dateFrom}T00:00:00`, KST);
  const end = dayjs.tz(`${dateTo}T00:00:00`, KST);
  if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
    return 0;
  }
  const daysOfWeek = Array.isArray(mission?.availability?.daysOfWeek) && mission.availability.daysOfWeek.length > 0 ? mission.availability.daysOfWeek.map(value => Number(value)).filter(value => Number.isInteger(value) && value >= 0 && value <= 6) : DEFAULT_ALWAYS_DAYS;
  const allowedDays = new Set(daysOfWeek);
  let count = 0;
  let cursor = start.startOf("day");
  while (cursor.isBefore(end, "day") || cursor.isSame(end, "day")) {
    if (allowedDays.has(cursor.day())) {
      count += 1;
    }
    cursor = cursor.add(1, "day");
  }
  return count;
};

export const getConsistencyTheme = (percent, activityCount) => {
  if (activityCount <= 0) {
    return {
      label: "아직 시작 전",
      badgeClass: "bg-slate-100 text-slate-600",
      barClass: "bg-slate-400",
      valueClass: "text-slate-700"
    };
  }
  if (percent >= 85) {
    return {
      label: "아주 꾸준해요",
      badgeClass: "bg-emerald-100 text-emerald-700",
      barClass: "bg-emerald-500",
      valueClass: "text-emerald-700"
    };
  }
  if (percent >= 65) {
    return {
      label: "꾸준한 편이에요",
      badgeClass: "bg-indigo-100 text-indigo-700",
      barClass: "bg-indigo-500",
      valueClass: "text-indigo-700"
    };
  }
  if (percent >= 40) {
    return {
      label: "조금씩 이어가요",
      badgeClass: "bg-amber-100 text-amber-700",
      barClass: "bg-amber-500",
      valueClass: "text-amber-700"
    };
  }
  return {
    label: "리듬을 만들면 좋아요",
    badgeClass: "bg-orange-100 text-orange-700",
    barClass: "bg-orange-500",
    valueClass: "text-orange-700"
  };
};

const ACTIVE_ALWAYS_ATTEMPT_STATUSES = new Set(["approved", "pending"]);

const createRewardTotal = () => ({
  currency: 0,
  credit: 0,
  missionToken: 0,
});

const normalizeRewardTotal = rewardTotal => ({
  currency: Number(rewardTotal?.currency || 0),
  credit: Number(rewardTotal?.credit || 0),
  missionToken: Number(rewardTotal?.missionToken || 0),
});

const rewardTotalsEqual = (left, right) =>
  Number(left?.currency || 0) === Number(right?.currency || 0) &&
  Number(left?.credit || 0) === Number(right?.credit || 0) &&
  Number(left?.missionToken || 0) === Number(right?.missionToken || 0);

const getMonthKeyFromDayKey = dayKey =>
  typeof dayKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dayKey.trim())
    ? dayKey.trim().slice(0, 7)
    : null;

const buildDayBucketKey = (studentUid, dayKey) =>
  `${String(studentUid || "").trim()}::${String(dayKey || "").trim()}`;

const buildMonthBucketKey = (studentUid, monthKey) =>
  `${String(studentUid || "").trim()}::${String(monthKey || "").trim()}`;

const buildDayBucketsFromSummary = (items = []) => {
  const buckets = new Map();

  items.forEach(item => {
    const studentUid = String(item?.studentUid || "").trim();
    const dayKey = String(item?.dayKey || "").trim();
    if (!studentUid || !dayKey) return;

    buckets.set(buildDayBucketKey(studentUid, dayKey), {
      studentUid,
      dayKey,
      attemptCount: Number(item?.attemptCount || 0),
      approvedCount: Number(item?.approvedCount || 0),
      pendingCount: Number(item?.pendingCount || 0),
      rewardTotal: normalizeRewardTotal(item?.rewardTotal),
      latestAt: item?.lastAttemptAtMs ? new Date(item.lastAttemptAtMs) : item?.lastAttemptAt || null,
    });
  });

  return buckets;
};

const buildMonthBucketsFromSummary = (items = []) => {
  const buckets = new Map();

  items.forEach(item => {
    const studentUid = String(item?.studentUid || "").trim();
    const monthKey = String(item?.monthKey || "").trim();
    if (!studentUid || !monthKey) return;

    buckets.set(buildMonthBucketKey(studentUid, monthKey), {
      studentUid,
      monthKey,
      attemptCount: Number(item?.attemptCount || 0),
      approvedCount: Number(item?.approvedCount || 0),
      pendingCount: Number(item?.pendingCount || 0),
      activeDayCount: Number(item?.activeDayCount || 0),
      rewardTotal: normalizeRewardTotal(item?.rewardTotal),
      latestAt: item?.lastAttemptAtMs ? new Date(item.lastAttemptAtMs) : item?.lastAttemptAt || null,
    });
  });

  return buckets;
};

const buildRawAlwaysAttemptBuckets = (attempts = [], includeMonthBuckets = false) => {
  const dayBuckets = new Map();
  const monthBuckets = new Map();

  attempts.forEach(item => {
    const status = String(item?.status || "").trim();
    if (!ACTIVE_ALWAYS_ATTEMPT_STATUSES.has(status)) return;

    const studentUid = String(item?.studentUid || "").trim();
    const dayKey = resolveAttemptDayKey(item);
    if (!studentUid || !dayKey) return;

    const rewardTotal =
      status === "approved"
        ? normalizeRewardTotal(item?.rewardSnapshot)
        : createRewardTotal();
    const latestAt = pickLatestDate(
      item?.approvedAtMs,
      item?.approvedAt,
      item?.createdAtMs,
      item?.createdAt,
      item?.updatedAtMs,
      item?.updatedAt,
    );

    const dayBucketKey = buildDayBucketKey(studentUid, dayKey);
    const previousDayBucket = dayBuckets.get(dayBucketKey) || {
      studentUid,
      dayKey,
      attemptCount: 0,
      approvedCount: 0,
      pendingCount: 0,
      rewardTotal: createRewardTotal(),
      latestAt: null,
    };

    previousDayBucket.attemptCount += 1;
    if (status === "approved") previousDayBucket.approvedCount += 1;
    if (status === "pending") previousDayBucket.pendingCount += 1;
    previousDayBucket.rewardTotal.currency += rewardTotal.currency;
    previousDayBucket.rewardTotal.credit += rewardTotal.credit;
    previousDayBucket.rewardTotal.missionToken += rewardTotal.missionToken;
    previousDayBucket.latestAt = upsertLatestAt(previousDayBucket.latestAt, latestAt);
    dayBuckets.set(dayBucketKey, previousDayBucket);

    if (!includeMonthBuckets) return;

    const monthKey = getMonthKeyFromDayKey(dayKey);
    if (!monthKey) return;

    const monthBucketKey = buildMonthBucketKey(studentUid, monthKey);
    const previousMonthBucket = monthBuckets.get(monthBucketKey) || {
      studentUid,
      monthKey,
      attemptCount: 0,
      approvedCount: 0,
      pendingCount: 0,
      activeDayKeys: new Set(),
      rewardTotal: createRewardTotal(),
      latestAt: null,
    };

    previousMonthBucket.attemptCount += 1;
    if (status === "approved") previousMonthBucket.approvedCount += 1;
    if (status === "pending") previousMonthBucket.pendingCount += 1;
    previousMonthBucket.activeDayKeys.add(dayKey);
    previousMonthBucket.rewardTotal.currency += rewardTotal.currency;
    previousMonthBucket.rewardTotal.credit += rewardTotal.credit;
    previousMonthBucket.rewardTotal.missionToken += rewardTotal.missionToken;
    previousMonthBucket.latestAt = upsertLatestAt(previousMonthBucket.latestAt, latestAt);
    monthBuckets.set(monthBucketKey, previousMonthBucket);
  });

  return {
    dayBuckets,
    monthBuckets: new Map(
      [...monthBuckets.entries()].map(([bucketKey, bucket]) => [
        bucketKey,
        {
          studentUid: bucket.studentUid,
          monthKey: bucket.monthKey,
          attemptCount: bucket.attemptCount,
          approvedCount: bucket.approvedCount,
          pendingCount: bucket.pendingCount,
          activeDayCount: bucket.activeDayKeys.size,
          rewardTotal: bucket.rewardTotal,
          latestAt: bucket.latestAt,
        },
      ]),
    ),
  };
};

const areDayBucketsEqual = (left, right) =>
  Number(left?.attemptCount || 0) === Number(right?.attemptCount || 0) &&
  Number(left?.approvedCount || 0) === Number(right?.approvedCount || 0) &&
  Number(left?.pendingCount || 0) === Number(right?.pendingCount || 0) &&
  rewardTotalsEqual(left?.rewardTotal, right?.rewardTotal);

const areMonthBucketsEqual = (left, right) =>
  Number(left?.attemptCount || 0) === Number(right?.attemptCount || 0) &&
  Number(left?.approvedCount || 0) === Number(right?.approvedCount || 0) &&
  Number(left?.pendingCount || 0) === Number(right?.pendingCount || 0) &&
  Number(left?.activeDayCount || 0) === Number(right?.activeDayCount || 0) &&
  rewardTotalsEqual(left?.rewardTotal, right?.rewardTotal);

const isTrustedRawDayBucket = (dayKey, rawMeta) => {
  if (rawMeta.complete) return true;
  if (!dayKey || !rawMeta.oldestFetchedDayKey) return false;
  return dayKey > rawMeta.oldestFetchedDayKey;
};

const isTrustedRawMonthBucket = (monthKey, rawMeta) => {
  if (rawMeta.complete) return true;
  if (!monthKey || !rawMeta.oldestFetchedMonthKey) return false;
  return monthKey > rawMeta.oldestFetchedMonthKey;
};

const mergeSummaryBucketsWithRawBuckets = ({
  summaryBuckets,
  rawBuckets,
  rawMeta,
  isBucketEqual,
  isTrustedBucket,
}) => {
  const mergedBuckets = new Map(summaryBuckets);

  rawBuckets.forEach((rawBucket, bucketKey) => {
    if (!isTrustedBucket(rawBucket, rawMeta)) return;

    const summaryBucket = mergedBuckets.get(bucketKey);
    if (!summaryBucket || !isBucketEqual(summaryBucket, rawBucket)) {
      mergedBuckets.set(bucketKey, rawBucket);
    }
  });

  return mergedBuckets;
};

async function fetchRawAlwaysAttemptBuckets({
  classId,
  missionId,
  dateFrom,
  dateTo,
  includeMonthBuckets = false,
}) {
  let nextCursor = null;
  let complete = true;
  let oldestFetchedDayKey = null;
  let oldestFetchedMonthKey = null;
  const attemptList = [];

  for (let page = 0; page < MAX_ATTEMPT_PAGES; page += 1) {
    const response = await alwaysListAttempts({
      classId,
      missionId,
      allStudents: true,
      dateFrom,
      dateTo,
      limit: 500,
      cursor: nextCursor,
      view: "attempts",
    });

    const attempts = response?.attempts || [];
    if (attempts.length > 0) {
      attemptList.push(...attempts);
      const oldestAttempt = attempts[attempts.length - 1];
      oldestFetchedDayKey = resolveAttemptDayKey(oldestAttempt);
      oldestFetchedMonthKey = getMonthKeyFromDayKey(oldestFetchedDayKey);
    }

    if (!response?.hasMore || !response?.nextCursor) {
      complete = true;
      break;
    }

    if (page === MAX_ATTEMPT_PAGES - 1) {
      complete = false;
      break;
    }

    complete = false;
    nextCursor = response.nextCursor;
  }

  const bucketMaps = buildRawAlwaysAttemptBuckets(attemptList, includeMonthBuckets);

  return {
    ...bucketMaps,
    complete,
    oldestFetchedDayKey,
    oldestFetchedMonthKey,
  };
}

export async function fetchAlwaysMissionStats({
  classId,
  mission,
  students,
  dateFrom,
  dateTo
}) {
  const targetStudents = students.filter(student => isMissionAssignedToStudent(mission, student, student.uid));
  const availableDayCount = getAlwaysAvailableDays(mission, dateFrom, dateTo);
  const result = new Map(targetStudents.map(student => [student.uid, {
    ...createAlwaysStats(),
    availableDayCount
  }]));
  if (targetStudents.length === 0) {
    return result;
  }

  const canUseMonthlySummary = shouldUseMonthlyAlwaysStats(mission, dateFrom, dateTo);
  const shouldVerifyWithRawAttempts = hasAlwaysSummaryActivityHint(mission, targetStudents);

  if (canUseMonthlySummary) {
    const monthResponse = await alwaysListAttempts({
      classId,
      missionId: mission.id,
      allStudents: true,
      studentUids: targetStudents.map(student => student.uid),
      dateFrom,
      dateTo,
      limit: Math.max(targetStudents.length, 50),
      view: "months"
    });

    const summaryMonthBuckets = buildMonthBucketsFromSummary(monthResponse?.attempts || []);
    let finalMonthBuckets = summaryMonthBuckets;

    if (shouldVerifyWithRawAttempts || summaryMonthBuckets.size === 0) {
      const rawAttemptBuckets = await fetchRawAlwaysAttemptBuckets({
        classId,
        missionId: mission.id,
        dateFrom,
        dateTo,
        includeMonthBuckets: true,
      });

      finalMonthBuckets = mergeSummaryBucketsWithRawBuckets({
        summaryBuckets: summaryMonthBuckets,
        rawBuckets: rawAttemptBuckets.monthBuckets,
        rawMeta: rawAttemptBuckets,
        isBucketEqual: areMonthBucketsEqual,
        isTrustedBucket: bucket => isTrustedRawMonthBucket(bucket?.monthKey, rawAttemptBuckets),
      });
    }

    finalMonthBuckets.forEach(item => {
      const studentUid = String(item?.studentUid || "");
      if (!result.has(studentUid)) return;

      const prev = result.get(studentUid);
      result.set(studentUid, applyMonthAggregate(prev, {
        attemptCount: item?.attemptCount || 0,
        approvedCount: item?.approvedCount || 0,
        pendingCount: item?.pendingCount || 0,
        activeDayCount: item?.activeDayCount || 0,
        latestAt: item?.latestAt || null,
      }));
    });

    return result;
  }

  const dayResponse = await alwaysListAttempts({
    classId,
    missionId: mission.id,
    allStudents: true,
    studentUids: targetStudents.map(student => student.uid),
    dateFrom,
    dateTo,
    limit: Math.max(targetStudents.length, 50),
    view: "days"
  });

  const summaryDayBuckets = buildDayBucketsFromSummary(dayResponse?.attempts || []);
  let finalDayBuckets = summaryDayBuckets;

  if (shouldVerifyWithRawAttempts || summaryDayBuckets.size === 0) {
    const rawAttemptBuckets = await fetchRawAlwaysAttemptBuckets({
      classId,
      missionId: mission.id,
      dateFrom,
      dateTo,
      includeMonthBuckets: false,
    });

    finalDayBuckets = mergeSummaryBucketsWithRawBuckets({
      summaryBuckets: summaryDayBuckets,
      rawBuckets: rawAttemptBuckets.dayBuckets,
      rawMeta: rawAttemptBuckets,
      isBucketEqual: areDayBucketsEqual,
      isTrustedBucket: bucket => isTrustedRawDayBucket(bucket?.dayKey, rawAttemptBuckets),
    });
  }

  finalDayBuckets.forEach(bucket => {
    if (!result.has(bucket.studentUid)) return;
    result.set(bucket.studentUid, applyDayAggregate(result.get(bucket.studentUid), bucket));
  });

  return result;
}
