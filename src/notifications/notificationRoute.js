import { sanitizeInternalRoutePath } from "../utils/internalRoute";

const getNotificationRouteValue = (notification, key) => {
  const directValue = notification?.[key];
  if (directValue !== undefined && directValue !== null && directValue !== "") {
    return directValue;
  }

  const metadataValue = notification?.metadata?.[key];
  if (
    metadataValue !== undefined &&
    metadataValue !== null &&
    metadataValue !== ""
  ) {
    return metadataValue;
  }

  return "";
};

export const buildNotificationTargetPath = (notification, fallbackPath) => {
  const safeFallbackPath = sanitizeInternalRoutePath(fallbackPath);
  const basePath = sanitizeInternalRoutePath(
    notification?.path,
    safeFallbackPath,
  );
  if (!basePath) return "";

  const hashIndex = basePath.indexOf("#");
  const pathAndQuery = hashIndex >= 0 ? basePath.slice(0, hashIndex) : basePath;
  const hash = hashIndex >= 0 ? basePath.slice(hashIndex) : "";
  const [pathname, existingQuery = ""] = pathAndQuery.split("?");
  const params = new URLSearchParams(existingQuery);

  const categoryId = getNotificationRouteValue(notification, "categoryId");
  const newsId = getNotificationRouteValue(notification, "newsId");
  const itemId = getNotificationRouteValue(notification, "itemId");
  const sourceClassId = getNotificationRouteValue(notification, "sourceClassId");

  if (categoryId) {
    params.set("category", String(categoryId));
  }
  if (newsId) {
    params.set("news", String(newsId));
  }
  if (itemId) {
    params.set("item", String(itemId));
  }
  if (sourceClassId) {
    params.set("sourceClassId", String(sourceClassId));
  }

  const queryString = params.toString();
  return `${queryString ? `${pathname}?${queryString}` : pathname}${hash}`;
};
