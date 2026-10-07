import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BookOpen,
  CaretDown as ChevronDown,
  CaretRight as ChevronRight,
  EyeSlash as EyeOff,
  Lock
} from "@phosphor-icons/react";
import { useUser } from "../../contexts/UserContext";
import { useClassUiConfig } from "../../contexts/ClassUiConfigContext";
import { usePlanConfig } from "../../contexts/PlanConfigContext";
import { useNotifications } from "../../contexts/NotificationContext";
import { adminNavItems } from "../../config/navConfig";
import { isCaseLibraryEnabled } from "../../pages/caseLibrary/caseLibraryAccess";
import { PATH_TO_SERVICE as PATH_TO_PAGE_KEY } from "../../pages/master/constants/planManager";
import {
  getSidebarMenuLabel,
  splitSidebarMenuItems,
} from "./sidebarMenuUtils";
import Button from "../ui/Button";

const notificationCountClass =
  "absolute -right-2 -top-2 z-20 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1 text-[9px] font-black leading-none text-white shadow-sm";

const notificationPulseClass = "absolute -right-1 -top-1 z-20 flex h-2.5 w-2.5";
const notificationPingClass =
  "absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75";
const notificationDotClass =
  "relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-red-600 shadow-sm";

function Sidebar({ collapsed = false, onNavItemClick }) {
  const { isAdmin, isTeacher, hasPermission } = useUser();
  const { sidebarSettings: menuSettings } = useClassUiConfig();
  const { checkPageAccess } = usePlanConfig();
  const { badges, badgeCounts } = useNotifications();
  const location = useLocation();

  const [dropdownOpen, setDropdownOpen] = useState({});
  const dropdownRefs = useRef({});
  const hiddenMenuTitle = "\uD559\uC0DD\uC5D0\uAC8C \uC228\uAE40";
  const hiddenMenuDescription =
    "\uAD50\uC0AC\uB9CC \uD655\uC778 \uAC00\uB2A5\uD55C \uBA54\uB274";
  const adminMenuTitle = "\uAD00\uB9AC \uBA54\uB274";
  const guidebookLabel = "\uAC00\uC774\uB4DC\uBD81";
  const caseLibraryNavItem = {
    path: "/case-library",
    label: guidebookLabel,
    icon: BookOpen,
  };
  const showCaseLibrary = isCaseLibraryEnabled();

  useEffect(() => {
    const handleClickOutside = (event) => {
      Object.keys(dropdownRefs.current).forEach((key) => {
        if (
          dropdownRefs.current[key] &&
          !dropdownRefs.current[key].contains(event.target)
        ) {
          setDropdownOpen((prev) => ({ ...prev, [key]: false }));
        }
      });
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getBadgeCount = (path) => {
    if (!path || !badgeCounts) return 0;

    switch (path) {
      case "/missions":
        return Number(badgeCounts.missions || 0);
      case "/bank":
        return Number(badgeCounts.bank || 0);
      case "/credentials":
        return Number(badgeCounts.credentials || 0);
      case "/tax":
        return Number(badgeCounts.tax || 0);
      case "/police":
        return Number(badgeCounts.police || 0);
      case "/marketplace":
        return Number(badgeCounts.marketplace || 0);
      case "/realestate":
        return Number(badgeCounts.realestate || 0);
      case "/assembly":
        return Number(badgeCounts.assembly || 0);
      case "/case-library":
        return Number(badgeCounts.caseLibrary || 0);
      default:
        return 0;
    }
  };

  const hasActiveBadge = (path) => {
    if (!path || !badges) return false;

    const count = getBadgeCount(path);
    if (count > 0) return true;

    switch (path) {
      case "/bank":
        return badges.bank;
      case "/credentials":
        return badges.credentials;
      case "/tax":
        return badges.tax;
      case "/police":
        return badges.police;
      case "/missions":
        return badges.missions;
      case "/marketplace":
        return badges.marketplace;
      case "/realestate":
        return badges.realestate;
      case "/assembly":
        return badges.assembly;
      case "/case-library":
        return badges.caseLibrary;
      default:
        return false;
    }
  };

  const getLinkClass = (path, { muted = false } = {}) => {
    const base =
      "flex items-center gap-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition h-10 group cursor-pointer";
    const active = "bg-indigo-600 text-white shadow-md";
    const inactive = muted
      ? "text-slate-400 hover:bg-slate-100 hover:text-slate-500"
      : "text-slate-700 hover:bg-indigo-50 hover:text-indigo-600";
    const isActive =
      path &&
      ((location.pathname.startsWith(path) && path !== "/") ||
        location.pathname === path);

    return `${base} ${isActive ? active : inactive}`;
  };

  const { visibleItems: visibleMainNavItems, hiddenItems: hiddenMainNavItems } =
    splitSidebarMenuItems({
      menuSettings,
      hasPermission,
      isTeacher,
    });

  const toggleDropdown = (label) => {
    setDropdownOpen((prev) => ({
      ...Object.keys(prev).reduce((acc, key) => ({ ...acc, [key]: false }), {}),
      [label]: !prev[label],
    }));
  };

  const iconClass = (isCollapsed) =>
    `${isCollapsed ? "h-6 w-6" : "h-5 w-5"} shrink-0 transition-transform group-hover:scale-110`;

  const renderMainNavItem = (item, index, { muted = false } = {}) => {
    const displayLabel = getSidebarMenuLabel(item, menuSettings);
    const activeBadge = hasActiveBadge(item.path);
    const badgeCount = getBadgeCount(item.path);
    const pageKey = PATH_TO_PAGE_KEY[item.path];
    const isLocked = pageKey ? !checkPageAccess(pageKey) : false;

    return (
      <Link
        key={item.path || index}
        to={item.path}
        className={`${getLinkClass(item.path, { muted })} ${collapsed ? "justify-center px-0" : ""} ${isLocked ? "group" : ""}`}
        title={
          collapsed
            ? typeof displayLabel === "string"
              ? displayLabel
              : item.label
            : undefined
        }
        aria-label={`${typeof displayLabel === "string" ? displayLabel : item.label}${badgeCount > 0 ? `, 알림 ${badgeCount}개` : ""}`}
        onClick={() => onNavItemClick && onNavItemClick(item)}
      >
        <div className="relative flex h-5 w-5 shrink-0 items-center justify-center">
          <item.icon
            className={`${iconClass(collapsed)} ${isLocked ? "text-slate-400 opacity-50" : ""}`}
          />
          {badgeCount > 0 ? (
            <span className={notificationCountClass}>
              {badgeCount > 99 ? "99+" : badgeCount}
            </span>
          ) : activeBadge ? (
            <span className={notificationPulseClass}>
              <span className={notificationPingClass} />
              <span className={notificationDotClass} />
            </span>
          ) : null}
        </div>

        {!collapsed && (
          <div className="flex min-w-0 flex-grow items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`truncate ${isLocked ? "font-normal text-slate-400 opacity-60" : "font-medium"}`}
              >
                {displayLabel}
              </span>
              {item.badgeLabel && !isLocked ? (
                <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-extrabold text-blue-700 ring-1 ring-blue-100">
                  {item.badgeLabel}
                </span>
              ) : null}
            </div>
            {isLocked && <Lock size={14} className="ml-1 text-slate-300" />}
          </div>
        )}
      </Link>
    );
  };

  const renderAdminNavItem = (item, { compact = false } = {}) => {
    const itemClass = `${getLinkClass(item.path || "#")} w-full ${compact ? "justify-center px-0" : "justify-start px-3"}`;
    const badgeCount = getBadgeCount(item.path);
    const activeBadge = hasActiveBadge(item.path);
    const pageKey = PATH_TO_PAGE_KEY[item.path];
    const isLocked = pageKey ? !checkPageAccess(pageKey) : false;
    const content = (
      <>
        {item.icon ? (
          <div
            className={`relative flex shrink-0 items-center justify-center ${
              compact ? "h-10 w-10" : "h-5 w-5"
            }`}
          >
            <item.icon
              className={`${iconClass(compact)} ${isLocked ? "text-slate-400 opacity-50" : ""}`}
            />
            {badgeCount > 0 ? (
              <span className={notificationCountClass}>
                {badgeCount > 99 ? "99+" : badgeCount}
              </span>
            ) : activeBadge ? (
              <span className={notificationPulseClass}>
                <span className={notificationPingClass} />
                <span className={notificationDotClass} />
              </span>
            ) : null}
          </div>
        ) : null}
        {!compact && (
          <div className="flex min-w-0 flex-1 items-center gap-1 text-left">
            <span
              className={`truncate ${isLocked ? "text-slate-400 opacity-60" : ""}`}
            >
              {item.label}
            </span>
            {isLocked ? <Lock size={14} className="shrink-0 text-slate-300" /> : null}
          </div>
        )}
      </>
    );

    if (item.onClick) {
      return (
        <button
          key={item.label}
          type="button"
          className={`${itemClass} w-full !justify-start text-left`}
          title={compact ? item.label : undefined}
          aria-label={item.label}
          onClick={() => {
            if (onNavItemClick) onNavItemClick(item);
            setDropdownOpen({});
          }}
        >
          {content}
        </button>
      );
    }

    return (
      <Link
        key={item.path}
        to={item.path}
        className={itemClass}
        title={compact ? item.label : undefined}
          aria-label={item.label}
        onClick={() => {
          if (onNavItemClick) onNavItemClick(item);
          setDropdownOpen({});
        }}
      >
        {content}
      </Link>
    );
  };

  return (
    <aside
      className={[
        "font-sans bg-white flex-shrink-0 py-4 border-r border-gray-200 flex flex-col shadow-lg relative transition-[width] duration-200 ease-in-out",
        "md:sticky md:top-0 md:h-screen",
        collapsed ? "w-16 px-2" : "w-64 px-4",
      ].join(" ")}
      style={{ zIndex: 101 }}
    >
      <nav className="sidebar-scrollbar min-h-0 flex-grow space-y-1.5 overflow-y-auto">
        {menuSettings === null ? (
          <div className="space-y-2 animate-pulse">
            {[...Array(6)].map((_, index) => (
              <div key={index} className="h-10 rounded-lg bg-gray-100" />
            ))}
          </div>
        ) : (
          <>
            {visibleMainNavItems.map((item, index) =>
              renderMainNavItem(item, index),
            )}

            {hiddenMainNavItems.length > 0 && (
              <div
                className={`mt-5 border-t border-dashed border-slate-200 ${collapsed ? "pt-3" : "pt-4"}`}
              >
                {!collapsed && (
                  <div className="px-3 pb-2">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                      <EyeOff className="h-3.5 w-3.5" />
                      <span>{hiddenMenuTitle}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {hiddenMenuDescription}
                    </p>
                  </div>
                )}
                <div className="space-y-1.5">
                  {hiddenMainNavItems.map((item, index) =>
                    renderMainNavItem(item, `${item.path || index}-hidden`, {
                      muted: true,
                    }),
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </nav>

      {(isAdmin || isTeacher) && (
        <div className="mt-auto space-y-2 border-t border-gray-100 pt-4">
          {!collapsed && (
            <h2 className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {adminMenuTitle}
            </h2>
          )}

          {adminNavItems.map((section) => {
            if (section.role === "admin" && !isAdmin) return null;
            if (section.type !== "accordion") return null;

            const isOpen = Boolean(dropdownOpen[section.label]);

            return (
              <div
                key={section.label}
                className="relative"
                ref={(element) => {
                  dropdownRefs.current[section.label] = element;
                }}
              >
                <Button variant="ghost" kind="ghost"
                  type="button"
                  title={collapsed ? section.label : undefined}
                  onClick={() => toggleDropdown(section.label)}
                  className={`${getLinkClass("#")} w-full ${collapsed ? "justify-center px-0" : "justify-between"} ${isOpen ? "bg-indigo-50 text-indigo-600 shadow-sm" : ""}`}
                >
                  <span className="flex items-center gap-x-3">
                    <section.icon className={iconClass(collapsed)} />
                    {!collapsed && <span>{section.label}</span>}
                  </span>
                  {!collapsed &&
                    (isOpen ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    ))}
                </Button>

                {isOpen && (
                  <div className="absolute bottom-0 left-full z-[120] ml-3 w-64 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-[0_24px_60px_rgba(15,23,42,0.18)] backdrop-blur">
                    {section.children?.map((item) => renderAdminNavItem(item))}
                  </div>
                )}
              </div>
            );
          })}

          {showCaseLibrary
            ? renderAdminNavItem(caseLibraryNavItem, { compact: collapsed })
            : null}
        </div>
      )}
    </aside>
  );
}

export default React.memo(Sidebar);
