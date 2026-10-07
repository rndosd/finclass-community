import dayjs from "dayjs";

export const normalizeItemValidityHours = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return Math.floor(numericValue);
};

export const hasItemExpiration = (item = {}) =>
  normalizeItemValidityHours(item?.validityHours) !== null;

export const formatItemValidityDuration = (value) => {
  const hours = normalizeItemValidityHours(value);
  if (!hours) return "";

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  if (days > 0 && remainingHours > 0) {
    return `${days}일 ${remainingHours}시간`;
  }

  if (days > 0) {
    return `${days}일`;
  }

  return `${hours}시간`;
};

export const getAcquisitionExpiryMs = (acquisition = {}) => {
  const directValue = Number(acquisition?.expiresAtMs);
  if (Number.isFinite(directValue) && directValue > 0) {
    return Math.floor(directValue);
  }

  const seconds = Number(acquisition?.expiresAt?.seconds);
  if (Number.isFinite(seconds) && seconds > 0) {
    const nanoseconds = Number(acquisition?.expiresAt?.nanoseconds || 0);
    return (seconds * 1000) + Math.floor(nanoseconds / 1000000);
  }

  return null;
};

export const isExpiredAcquisition = (acquisition = {}, nowMs = Date.now()) => {
  const expiryMs = getAcquisitionExpiryMs(acquisition);
  return expiryMs !== null && expiryMs <= nowMs;
};

export const summarizeInventoryItemExpiration = (
  item = {},
  nowMs = Date.now(),
) => {
  const acquisitions = Array.isArray(item?.acquisitions) ? item.acquisitions : [];
  const totalQty = Math.max(0, Number(item?.quantity || 0));

  let activeQty = 0;
  let expiredQty = 0;
  let hasExpiringQty = false;
  let nextExpiryMs = null;

  acquisitions.forEach((acquisition) => {
    const quantity = Math.max(0, Number(acquisition?.quantity || 0));
    if (quantity <= 0) return;

    const expiryMs = getAcquisitionExpiryMs(acquisition);
    if (expiryMs === null) {
      activeQty += quantity;
      return;
    }

    hasExpiringQty = true;

    if (expiryMs <= nowMs) {
      expiredQty += quantity;
      return;
    }

    activeQty += quantity;
    if (nextExpiryMs === null || expiryMs < nextExpiryMs) {
      nextExpiryMs = expiryMs;
    }
  });

  const accountedQty = activeQty + expiredQty;
  const fallbackQty = Math.max(0, totalQty - accountedQty);
  const usableQty = activeQty + fallbackQty;

  return {
    totalQty,
    usableQty,
    expiredQty,
    hasExpiredQty: expiredQty > 0,
    hasExpiringQty,
    nextExpiryMs,
    isFullyExpired: usableQty <= 0 && expiredQty > 0,
  };
};

const toFiniteNonNegativeNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0
    ? numericValue
    : 0;
};

const resolveAcquisitionUnitValue = (acquisition = {}, item = {}) => {
  const candidates = [acquisition?.unitValue, acquisition?.price, item?.price];

  for (const candidate of candidates) {
    const numericValue = Number(candidate);
    if (Number.isFinite(numericValue) && numericValue >= 0) {
      return numericValue;
    }
  }

  return 0;
};

export const calculateActiveInventoryItemValue = (
  item = {},
  nowMs = Date.now(),
) => {
  const acquisitions = Array.isArray(item?.acquisitions) ? item.acquisitions : [];
  const totalQty = Math.max(0, Number(item?.quantity || 0));

  if (acquisitions.length === 0) {
    return toFiniteNonNegativeNumber(item?.price) * totalQty;
  }

  let accountedQty = 0;
  let activeValue = 0;

  acquisitions.forEach((acquisition) => {
    const quantity = Math.max(0, Number(acquisition?.quantity || 0));
    if (quantity <= 0) return;

    accountedQty += quantity;

    if (isExpiredAcquisition(acquisition, nowMs)) {
      return;
    }

    activeValue += resolveAcquisitionUnitValue(acquisition, item) * quantity;
  });

  const fallbackQty = Math.max(0, totalQty - accountedQty);
  if (fallbackQty > 0) {
    activeValue += toFiniteNonNegativeNumber(item?.price) * fallbackQty;
  }

  return Math.round(activeValue * 100) / 100;
};

export const calculateActiveInventoryValue = (
  items = [],
  nowMs = Date.now(),
) =>
  (Array.isArray(items) ? items : []).reduce(
    (sum, item) => sum + calculateActiveInventoryItemValue(item, nowMs),
    0,
  );

export const getActivePurchaseQuantity = (item = {}, nowMs = Date.now()) =>
  (Array.isArray(item?.acquisitions) ? item.acquisitions : [])
    .filter(
      (acquisition) =>
        acquisition?.type === "purchase" &&
        !isExpiredAcquisition(acquisition, nowMs),
    )
    .reduce(
      (sum, acquisition) => sum + Math.max(0, Number(acquisition?.quantity || 0)),
      0,
    );

export const formatExpiryDateTime = (expiryMs) =>
  expiryMs ? dayjs(expiryMs).format("YYYY.MM.DD HH:mm") : "-";

export const formatRemainingTime = (expiryMs, nowMs = Date.now()) => {
  if (!expiryMs) return "";

  const diffMs = expiryMs - nowMs;
  if (diffMs <= 0) return "만료됨";

  const totalMinutes = Math.ceil(diffMs / (60 * 1000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - (days * 60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0 && hours > 0) return `${days}일 ${hours}시간`;
  if (days > 0) return `${days}일`;
  if (hours > 0 && minutes > 0) return `${hours}시간 ${minutes}분`;
  if (hours > 0) return `${hours}시간`;
  return `${Math.max(1, minutes)}분`;
};
