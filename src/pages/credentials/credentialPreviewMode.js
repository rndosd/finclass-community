export const CREDENTIALS_PREVIEW_MODE_IDS = new Set(["teacher", "student"]);

export function getCredentialsPreviewModeStorageKey(classId, uid, fallbackMode) {
  // Keep a student's saved view from hiding newly delegated management access.
  return `finclass:credentials:preview-mode:${classId || "default"}:${uid || "default"}:${fallbackMode}`;
}

export function readStoredCredentialsPreviewMode(classId, uid, fallbackMode) {
  if (typeof window === "undefined") return fallbackMode;
  try {
    const storedMode = window.localStorage.getItem(
      getCredentialsPreviewModeStorageKey(classId, uid, fallbackMode),
    );
    return CREDENTIALS_PREVIEW_MODE_IDS.has(storedMode) ? storedMode : fallbackMode;
  } catch {
    return fallbackMode;
  }
}
