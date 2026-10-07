const sidebarSettingsCache = new Map();
const SIDEBAR_SETTINGS_STORAGE_PREFIX = "finclass_sidebar_settings:";

export const getSidebarSettingsStorageKey = (classId) =>
  `${SIDEBAR_SETTINGS_STORAGE_PREFIX}${classId}`;

export const normalizeSidebarSettings = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export const readCachedSidebarSettings = (classId) => {
  if (!classId) return null;

  if (sidebarSettingsCache.has(classId)) {
    return sidebarSettingsCache.get(classId);
  }

  if (typeof window === "undefined") return null;

  try {
    const rawValue = sessionStorage.getItem(
      getSidebarSettingsStorageKey(classId),
    );
    if (!rawValue) return null;

    const parsedValue = normalizeSidebarSettings(JSON.parse(rawValue));
    sidebarSettingsCache.set(classId, parsedValue);
    return parsedValue;
  } catch (_error) {
    return null;
  }
};

export const writeCachedSidebarSettings = (classId, value) => {
  if (!classId) return;

  const normalizedValue = normalizeSidebarSettings(value);
  sidebarSettingsCache.set(classId, normalizedValue);

  if (typeof window === "undefined") return;

  try {
    sessionStorage.setItem(
      getSidebarSettingsStorageKey(classId),
      JSON.stringify(normalizedValue),
    );
  } catch (_error) {
    // Ignore storage quota and serialization errors.
  }
};

export const clearSidebarSettingsCacheForTest = () => {
  sidebarSettingsCache.clear();
};
