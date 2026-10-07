export const SHORTCUT_DOCK_WIDTH = 720;
export const SHORTCUT_DOCK_VIEWPORT_GAP = 16;
export const SHORTCUT_DOCK_DEFAULT_TOP = 8;
export const SHORTCUT_DOCK_DESKTOP_BREAKPOINT = 1024;

const toFiniteNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getViewportSize = (viewportWidth, viewportHeight) => ({
  width: toFiniteNumber(
    viewportWidth,
    typeof window === "undefined" ? 0 : window.innerWidth,
  ),
  height: toFiniteNumber(
    viewportHeight,
    typeof window === "undefined" ? 0 : window.innerHeight,
  ),
});

const getMinimumX = (viewportWidth, desktopSidebarWidth) =>
  SHORTCUT_DOCK_VIEWPORT_GAP +
  (viewportWidth >= SHORTCUT_DOCK_DESKTOP_BREAKPOINT
    ? Math.max(0, toFiniteNumber(desktopSidebarWidth, 0))
    : 0);

export function getDefaultShortcutDockPosition({
  desktopSidebarWidth = 0,
  viewportWidth,
} = {}) {
  const viewport = getViewportSize(viewportWidth);
  const minimumX = getMinimumX(viewport.width, desktopSidebarWidth);

  return {
    x: Math.max(
      minimumX,
      (viewport.width - SHORTCUT_DOCK_WIDTH) / 2,
    ),
    y: SHORTCUT_DOCK_DEFAULT_TOP,
  };
}

export function clampShortcutDockPosition(
  position,
  width = SHORTCUT_DOCK_WIDTH,
  height = 48,
  {
    desktopSidebarWidth = 0,
    viewportWidth,
    viewportHeight,
  } = {},
) {
  const viewport = getViewportSize(viewportWidth, viewportHeight);
  if (viewport.width <= 0 || viewport.height <= 0) return position;

  const minimumX = getMinimumX(viewport.width, desktopSidebarWidth);
  const maximumX = Math.max(
    minimumX,
    viewport.width - width - SHORTCUT_DOCK_VIEWPORT_GAP,
  );
  const maximumY = Math.max(
    SHORTCUT_DOCK_DEFAULT_TOP,
    viewport.height - height - SHORTCUT_DOCK_VIEWPORT_GAP,
  );

  return {
    x: Math.min(
      maximumX,
      Math.max(
        minimumX,
        toFiniteNumber(position?.x, minimumX),
      ),
    ),
    y: Math.min(
      maximumY,
      Math.max(
        SHORTCUT_DOCK_DEFAULT_TOP,
        toFiniteNumber(position?.y, SHORTCUT_DOCK_DEFAULT_TOP),
      ),
    ),
  };
}

