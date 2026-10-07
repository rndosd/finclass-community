import { mainNavItems } from "../../config/navConfig";

export const getSidebarConfigurableItems = () =>
  mainNavItems.filter((item) => item.path);

export const normalizeSidebarMenuOrder = (savedOrder) => {
  const itemPaths = getSidebarConfigurableItems().map((item) => item.path);

  if (!Array.isArray(savedOrder) || savedOrder.length === 0) {
    return itemPaths;
  }

  const seenPaths = new Set();
  const orderedPaths = savedOrder.filter((path) => {
    if (!itemPaths.includes(path) || seenPaths.has(path)) {
      return false;
    }

    seenPaths.add(path);
    return true;
  });

  const leftoverPaths = itemPaths.filter((path) => !seenPaths.has(path));

  return [...orderedPaths, ...leftoverPaths];
};

const isMenuItemEnabledForStudents = (setting) => {
  if (setting && typeof setting === "object") {
    return setting.enabled !== false;
  }

  return setting !== false;
};

const getOrderedMainNavItems = (menuSettings) => {
  const items = getSidebarConfigurableItems();
  const normalizedOrder = normalizeSidebarMenuOrder(menuSettings?.order);

  return normalizedOrder
    .map((path) => items.find((item) => item.path === path))
    .filter(Boolean);
};

export const getSidebarMenuLabel = (item, menuSettings) => {
  if (!item.path || !menuSettings) return item.label;

  const setting = menuSettings[item.path];
  if (setting && typeof setting === "object" && setting.customLabel) {
    return setting.customLabel;
  }

  return item.label;
};

export const getSidebarMenuItemByPath = (path) => {
  if (!path) return null;
  return mainNavItems.find((item) => item.path === path) || null;
};

export const getSidebarMenuLabelByPath = (path, menuSettings) => {
  const item = getSidebarMenuItemByPath(path);
  if (!item) return null;
  return getSidebarMenuLabel(item, menuSettings);
};

export const splitSidebarMenuItems = ({
  menuSettings,
  hasPermission,
  isTeacher,
}) => {
  if (menuSettings === null) {
    return { visibleItems: [], hiddenItems: [] };
  }

  return getOrderedMainNavItems(menuSettings).reduce(
    (acc, item) => {
      const isEnabled = isMenuItemEnabledForStudents(menuSettings?.[item.path]);
      const requiredPermissions = Array.isArray(item.permission)
        ? item.permission
        : item.permission
          ? [item.permission]
          : [];
      const hasMenuPermission =
        isTeacher ||
        requiredPermissions.length === 0 ||
        requiredPermissions.some((permission) => hasPermission?.(permission));

      if (isEnabled && hasMenuPermission) {
        acc.visibleItems.push(item);
      } else if (isTeacher) {
        acc.hiddenItems.push(item);
      }

      return acc;
    },
    { visibleItems: [], hiddenItems: [] },
  );
};
