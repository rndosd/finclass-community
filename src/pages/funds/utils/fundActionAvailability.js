const DEFAULT_ORDER_CUTOFF_TIME = "15:00";
export const FUND_REBALANCE_OPEN_TIME = "07:45";

const kstFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function getKstParts(date = new Date()) {
  const parts = kstFormatter.formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";

  return {
    weekday: read("weekday"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

function normalizeTimeString(value, fallback) {
  const normalized = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) return fallback;

  const [hour, minute] = normalized.split(":").map(Number);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return fallback;
  }

  return normalized;
}

function timeStringToMinutes(value, fallback = 0) {
  const normalized = normalizeTimeString(value, null);
  if (!normalized) return fallback;

  const [hour, minute] = normalized.split(":").map(Number);
  return hour * 60 + minute;
}

function isKstWeekend(date = new Date()) {
  const { weekday } = getKstParts(date);
  return weekday === "Sat" || weekday === "Sun";
}

export function buildFundTradeWindowSummary({
  orderCutoffTime = DEFAULT_ORDER_CUTOFF_TIME,
  now = new Date(),
} = {}) {
  const normalizedOrderCutoffTime = normalizeTimeString(
    orderCutoffTime,
    DEFAULT_ORDER_CUTOFF_TIME,
  );
  const rebalanceOpenMinutes = timeStringToMinutes(
    FUND_REBALANCE_OPEN_TIME,
    timeStringToMinutes(FUND_REBALANCE_OPEN_TIME),
  );
  const startMinutes = rebalanceOpenMinutes;
  const cutoffMinutes = timeStringToMinutes(
    normalizedOrderCutoffTime,
    timeStringToMinutes(DEFAULT_ORDER_CUTOFF_TIME),
  );
  const { hour, minute } = getKstParts(now);
  const kstMinutes = Number(hour) * 60 + Number(minute);
  const isWeekend = isKstWeekend(now);
  const hasValidTradeWindow = startMinutes < cutoffMinutes;

  return {
    orderStartTime: FUND_REBALANCE_OPEN_TIME,
    orderCutoffTime: normalizedOrderCutoffTime,
    rebalanceOpenMinutes,
    startMinutes,
    cutoffMinutes,
    kstMinutes,
    isWeekend,
    hasValidTradeWindow,
    isTradeOpen:
      !isWeekend &&
      hasValidTradeWindow &&
      kstMinutes >= startMinutes &&
      kstMinutes < cutoffMinutes,
    isRebalanceOpen:
      !isWeekend &&
      hasValidTradeWindow &&
      kstMinutes >= startMinutes &&
      kstMinutes < cutoffMinutes,
  };
}

function getFundSubscribeStatusReason(fund = {}) {
  const status = String(fund?.status || "").trim();
  const joinStatus = String(fund?.joinStatus || "").trim();

  if (status === "closed") {
    return "운용이 종료된 펀드는 가입할 수 없습니다.";
  }

  if (status === "paused" || joinStatus === "paused") {
    return "운용이 일시 중지된 펀드는 가입할 수 없습니다.";
  }

  if (joinStatus && !["open", "blocked_report_overdue"].includes(joinStatus)) {
    return "현재 신규 가입을 받을 수 없습니다.";
  }

  return "";
}

export function getFundSubscribeDisabledReason(
  fund,
  {
    orderCutoffTime = DEFAULT_ORDER_CUTOFF_TIME,
    isTeacher = false,
    now = new Date(),
  } = {},
) {
  if (!fund) return "펀드 정보를 확인할 수 없습니다.";

  const statusReason = getFundSubscribeStatusReason(fund);
  if (statusReason) return statusReason;

  if (isTeacher) return "";

  const window = buildFundTradeWindowSummary({
    orderCutoffTime,
    now,
  });

  if (window.isTradeOpen) return "";
  if (!window.hasValidTradeWindow) {
    return "현재 펀드 거래 시간이 올바르게 설정되지 않았습니다.";
  }
  if (window.isWeekend) return "주말에는 가입 신청을 할 수 없습니다.";
  if (window.kstMinutes < window.startMinutes) {
    return `가입 신청은 ${FUND_REBALANCE_OPEN_TIME}부터 가능합니다.`;
  }

  return `가입 신청은 ${window.orderCutoffTime}에 마감됩니다.`;
}

export function getFundRebalanceDisabledReason(
  fund,
  {
    orderCutoffTime = DEFAULT_ORDER_CUTOFF_TIME,
    isTeacher = false,
    now = new Date(),
  } = {},
) {
  if (!fund) return "펀드 정보를 확인할 수 없습니다.";

  if (String(fund?.status || "").trim() === "closed") {
    return "운용이 종료된 펀드는 리밸런싱할 수 없습니다.";
  }

  if (isTeacher) return "";

  const window = buildFundTradeWindowSummary({
    orderCutoffTime,
    now,
  });

  if (window.isRebalanceOpen) return "";
  if (!window.hasValidTradeWindow) {
    return "현재 리밸런싱 가능 시간이 올바르게 설정되지 않았습니다.";
  }
  if (window.isWeekend) return "주말에는 리밸런싱할 수 없습니다.";
  if (window.kstMinutes < window.rebalanceOpenMinutes) {
    return `리밸런싱은 ${FUND_REBALANCE_OPEN_TIME} 이후부터 가능합니다.`;
  }

  return `리밸런싱은 ${window.orderCutoffTime}에 마감됩니다.`;
}
