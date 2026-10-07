const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad2 = (value) => String(value).padStart(2, "0");

const toKstDate = (date = new Date()) =>
  new Date(new Date(date).getTime() + KST_OFFSET_MS);

export const getStoreUsagePeriodIds = (now = new Date()) => {
  const nowKst = toKstDate(now);
  const dailyId = [
    nowKst.getUTCFullYear(),
    pad2(nowKst.getUTCMonth() + 1),
    pad2(nowKst.getUTCDate()),
  ].join("-");

  const weekday = nowKst.getUTCDay() || 7;
  const mondayKst = new Date(
    Date.UTC(
      nowKst.getUTCFullYear(),
      nowKst.getUTCMonth(),
      nowKst.getUTCDate(),
    ),
  );
  mondayKst.setUTCDate(mondayKst.getUTCDate() - weekday + 1);

  const weeklyId = [
    mondayKst.getUTCFullYear(),
    pad2(mondayKst.getUTCMonth() + 1),
    pad2(mondayKst.getUTCDate()),
  ].join("-");

  return { dailyId, weeklyId };
};

export const normalizeStoreUsage = (
  usageData = {},
  periodIds = getStoreUsagePeriodIds(),
) => {
  const source =
    usageData && typeof usageData === "object"
      ? usageData
      : {};

  const normalized = {
    ...source,
    daily: Math.max(0, Number(source.daily || 0)),
    weekly: Math.max(0, Number(source.weekly || 0)),
    totalPurchased: Math.max(0, Number(source.totalPurchased || 0)),
    totalResetVersion: Math.max(0, Number(source.totalResetVersion || 0)),
    lastDailyId: source.lastDailyId || "",
    lastWeeklyId: source.lastWeeklyId || "",
  };

  if (normalized.lastDailyId !== periodIds.dailyId) {
    normalized.daily = 0;
    normalized.lastDailyId = periodIds.dailyId;
  }

  if (normalized.lastWeeklyId !== periodIds.weeklyId) {
    normalized.weekly = 0;
    normalized.lastWeeklyId = periodIds.weeklyId;
  }

  return normalized;
};

export const getStorePurchaseLimitInfo = (
  item = {},
  usageData = {},
  options = {},
) => {
  const {
    stockFallback = 999,
    periodIds = getStoreUsagePeriodIds(),
  } = options;
  const usage = normalizeStoreUsage(usageData, periodIds);

  const dailyRemaining = item.dailyLimit
    ? Math.max(0, Number(item.dailyLimit) - usage.daily)
    : Infinity;
  const weeklyRemaining = item.weeklyLimit
    ? Math.max(0, Number(item.weeklyLimit) - usage.weekly)
    : Infinity;
  const totalRemaining = item.totalLimit
    ? Math.max(0, Number(item.totalLimit) - usage.totalPurchased)
    : Infinity;
  const stockRemaining =
    item.stock === -1 || item.stock === null || item.stock === undefined
      ? stockFallback
      : Math.max(0, Number(item.stock || 0));

  return {
    usage,
    dailyRemaining,
    weeklyRemaining,
    totalRemaining,
    stockRemaining,
    maxPossible: Math.min(
      dailyRemaining,
      weeklyRemaining,
      totalRemaining,
      stockRemaining,
    ),
  };
};
