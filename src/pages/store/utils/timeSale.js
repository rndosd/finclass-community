import { formatDateInKST, toDate } from "../../../utils/kstDate";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad2 = (value) => String(value).padStart(2, "0");

const toMillis = (value) => {
  const date = toDate(value);
  return date ? date.getTime() : null;
};

const toKstParts = (value) => {
  const date = toDate(value);
  if (!date) {
    return { date: "", time: "" };
  }

  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    date: [
      shifted.getUTCFullYear(),
      pad2(shifted.getUTCMonth() + 1),
      pad2(shifted.getUTCDate()),
    ].join("-"),
    time: [pad2(shifted.getUTCHours()), pad2(shifted.getUTCMinutes())].join(":"),
  };
};

export const STORE_SPECIAL_CATEGORY_ID = "__store_special__";

export const combineKstDateAndTime = (dateValue, timeValue) => {
  const date = String(dateValue || "").trim();
  const time = String(timeValue || "").trim();

  if (!date || !time) return null;

  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
  if (!match || !timeMatch) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);

  if (
    Number.isNaN(year) ||
    Number.isNaN(monthIndex) ||
    Number.isNaN(day) ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes)
  ) {
    return null;
  }

  const utcMs = Date.UTC(year, monthIndex, day, hours, minutes) - KST_OFFSET_MS;
  return new Date(utcMs);
};

export const splitKstDateTime = (value) => toKstParts(value);

export const getCompactTimeSaleLabel = (label) => {
  const text = String(label || "").trim();
  if (!text) return "";

  return text.replace(/\s*남음$/, "").replace(/\s*종료$/, "");
};

export const getTimeSaleState = (item = {}, now = new Date()) => {
  const basePrice = Math.max(0, Number(item?.price) || 0);
  const rawSalePrice = Number(item?.timeSale?.salePrice);
  const roundedSalePrice = Number.isFinite(rawSalePrice)
    ? Math.round(rawSalePrice)
    : null;
  const startAt = toDate(item?.timeSale?.startAt);
  const endAt = toDate(item?.timeSale?.endAt);
  const nowMs = toMillis(now);
  const startMs = toMillis(startAt);
  const endMs = toMillis(endAt);

  const hasValidSchedule =
    roundedSalePrice !== null &&
    roundedSalePrice > 0 &&
    roundedSalePrice < basePrice &&
    startMs !== null &&
    endMs !== null &&
    startMs < endMs;

  if (!hasValidSchedule) {
    return {
      timeSaleConfigured: false,
      timeSaleActive: false,
      timeSaleStatus: "none",
      timeSaleStartAt: startAt,
      timeSaleEndAt: endAt,
      timeSaleSalePrice: null,
      timeSaleDiscountPercent: 0,
      timeSaleCountdownLabel: "",
      basePrice,
      effectivePrice: basePrice,
    };
  }

  let timeSaleStatus = "upcoming";
  if (nowMs >= endMs) {
    timeSaleStatus = "expired";
  } else if (nowMs >= startMs) {
    timeSaleStatus = "active";
  }

  const timeSaleActive = timeSaleStatus === "active";
  const discountPercent = Math.max(
    0,
    Math.floor(((basePrice - roundedSalePrice) / basePrice) * 100),
  );

  let timeSaleCountdownLabel = "";
  if (timeSaleActive) {
    const remainingMs = Math.max(0, endMs - nowMs);
    const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));

    if (remainingMinutes < 60) {
      timeSaleCountdownLabel = `${remainingMinutes}분 남음`;
    } else if (remainingMinutes < 24 * 60) {
      const hours = Math.floor(remainingMinutes / 60);
      const minutes = remainingMinutes % 60;
      timeSaleCountdownLabel =
        minutes > 0 ? `${hours}시간 ${minutes}분 남음` : `${hours}시간 남음`;
    } else {
      timeSaleCountdownLabel = `${formatDateInKST(endAt, "ko-KR", {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })} 종료`;
    }
  }

  return {
    timeSaleConfigured: true,
    timeSaleActive,
    timeSaleStatus,
    timeSaleStartAt: startAt,
    timeSaleEndAt: endAt,
    timeSaleSalePrice: roundedSalePrice,
    timeSaleDiscountPercent: discountPercent,
    timeSaleCountdownLabel,
    basePrice,
    effectivePrice: timeSaleActive ? roundedSalePrice : basePrice,
  };
};

export const decorateStoreItemWithTimeSale = (item = {}, now = new Date()) => ({
  ...item,
  ...getTimeSaleState(item, now),
});
