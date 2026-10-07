import React, { Fragment, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import {
  CaretDown as ChevronDownIcon,
  CaretUp as ChevronUpIcon,
  Lock as LockClosedIcon,
  X as XMarkIcon,
} from "@phosphor-icons/react";
import { BookOpen } from "@phosphor-icons/react";
import { Link, useLocation } from "react-router-dom";
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
import IconButton from "../ui/IconButton";

const notificationCountClass =
  "absolute -right-2 -top-2 z-20 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1 text-[9px] font-black leading-none text-white shadow-sm";

const notificationPulseClass = "absolute -right-1 -top-1 z-20 flex h-2.5 w-2.5";
const notificationPingClass =
  "absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75";
const notificationDotClass =
  "relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-red-600 shadow-sm";

function MobileDrawerSidebar({
  isOpen,
  onClose,
  children,
  title,
  onNavItemClick,
}) {
  const { isAdmin, isTeacher, hasPermission } = useUser();
  const { sidebarSettings: menuSettings } = useClassUiConfig();
  const { checkPageAccess } = usePlanConfig();
  const { badges, badgeCounts } = useNotifications();
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const location = useLocation();
  const hiddenMenuTitle = "\uD559\uC0DD\uC5D0\uAC8C \uC228\uAE40";
  const hiddenMenuDescription =
    "\uAD50\uC0AC\uB9CC \uD655\uC778 \uAC00\uB2A5\uD55C \uBA54\uB274";
  const guidebookLabel = "\uAC00\uC774\uB4DC\uBD81";
  const caseLibraryNavItem = {
    path: "/case-library",
    label: guidebookLabel,
    icon: BookOpen,
  };
  const showCaseLibrary = isCaseLibraryEnabled();

  const getLinkClass = (path, { muted = false } = {}) => {
    const isActive =
      path &&
      ((location.pathname.startsWith(path) && path !== "/") ||
        location.pathname === path);

    return `flex items-center gap-x-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ease-in-out ${
      isActive
        ? "bg-indigo-600 text-white shadow"
        : muted
          ? "text-slate-400 hover:bg-slate-100 hover:text-slate-500"
          : "text-slate-700 hover:bg-slate-100"
    }`;
  };

  const { visibleItems: visibleMainNavItems, hiddenItems: hiddenMainNavItems } =
    splitSidebarMenuItems({
      menuSettings,
      hasPermission,
      isTeacher,
    });

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

  const handleItemClick = (item) => {
    if (onNavItemClick) onNavItemClick(item);
    onClose();
  };

  const renderMainNavItem = (item, index, { muted = false } = {}) => {
    const pageKey = PATH_TO_PAGE_KEY[item.path];
    const isLocked = pageKey ? !checkPageAccess(pageKey) : false;
    const badgeCount = getBadgeCount(item.path);
    const activeBadge = hasActiveBadge(item.path);

    return (
      <Link
        key={item.path || index}
        to={item.path}
        className={getLinkClass(item.path, { muted })}
        onClick={() => handleItemClick(item)}
      >
        <div className="relative flex h-5 w-5 shrink-0 items-center justify-center">
          <item.icon
            className={`h-5 w-5 flex-shrink-0 ${isLocked ? "text-slate-400 opacity-50" : ""}`}
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
        <div className="flex min-w-0 items-center gap-1">
          <span className={`${isLocked ? "text-slate-400 opacity-60" : ""}`}>
            {getSidebarMenuLabel(item, menuSettings)}
          </span>
          {isLocked ? (
            <LockClosedIcon className="h-4 w-4 shrink-0 text-slate-300" />
          ) : null}
        </div>
      </Link>
    );
  };

  const renderAdminNavItem = (item) => {
    const itemClass = getLinkClass(item.path || "#");
    const badgeCount = getBadgeCount(item.path);
    const activeBadge = hasActiveBadge(item.path);
    const pageKey = PATH_TO_PAGE_KEY[item.path];
    const isLocked = pageKey ? !checkPageAccess(pageKey) : false;
    const content = (
      <>
        {item.icon ? (
          <div className="relative flex h-5 w-5 shrink-0 items-center justify-center">
            <item.icon
              className={`h-5 w-5 flex-shrink-0 ${isLocked ? "text-slate-400 opacity-50" : ""}`}
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
        <div className="flex min-w-0 flex-1 items-center gap-1 text-left">
          <span className={`${isLocked ? "text-slate-400 opacity-60" : ""}`}>
            {item.label}
          </span>
          {isLocked ? (
            <LockClosedIcon className="h-4 w-4 shrink-0 text-slate-300" />
          ) : null}
        </div>
      </>
    );

    if (item.onClick) {
      return (
        <button
          key={`${item.onClick}-${item.label}`}
          type="button"
          className={`${itemClass} w-full !justify-start text-left`}
          onClick={() => handleItemClick(item)}
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
        onClick={() => handleItemClick(item)}
      >
        {content}
      </Link>
    );
  };

  const renderDefaultMenu = () => (
    <>
      <nav className="flex-1 space-y-1 px-4 py-4">
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
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-2.5">
                <div className="px-2 pb-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {hiddenMenuTitle}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {hiddenMenuDescription}
                  </p>
                </div>
                <div className="space-y-1">
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
        <div className="space-y-1 border-t border-gray-200 px-4 pt-4">
          <Button variant="ghost" kind="ghost"
            type="button"
            onClick={() => setAdminMenuOpen((value) => !value)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            <span className="flex items-center gap-x-2">
              <LockClosedIcon className="h-5 w-5" />
              {isAdmin ? "System Admin" : "Class Admin"}
            </span>
            {adminMenuOpen ? (
              <ChevronUpIcon className="h-5 w-5" />
            ) : (
              <ChevronDownIcon className="h-5 w-5" />
            )}
          </Button>

          {adminMenuOpen && (
            <div className="mt-2 space-y-2">
              {adminNavItems.map((section) => {
                if (section.role === "admin" && !isAdmin) return null;
                if (section.type !== "accordion") return null;

                return (
                  <div key={section.label} className="space-y-1">
                    <p className="px-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      {section.label}
                    </p>
                    <div className="space-y-1">
                      {section.children?.map((item) => renderAdminNavItem(item))}
                    </div>
                  </div>
                );
              })}

              {showCaseLibrary ? (
                <div className="space-y-1">
                  <p className="px-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {guidebookLabel}
                  </p>
                  <div className="space-y-1">
                    {renderAdminNavItem(caseLibraryNavItem)}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50 lg:hidden" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="transition-opacity ease-linear duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity ease-linear duration-300"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-50" />
        </Transition.Child>

        <div className="fixed inset-0 z-50 flex">
          <Transition.Child
            as={Fragment}
            enter="transition ease-in-out duration-300 transform"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="transition ease-in-out duration-300 transform"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
          >
            <Dialog.Panel className="font-sans relative flex w-72 max-w-xs flex-col overflow-hidden bg-white shadow-xl">
              <div className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
                <h2 className="min-w-0 truncate text-lg font-bold text-slate-800">
                  {title || "Menu"}
                </h2>
                <IconButton
                  icon={XMarkIcon}
                  label="메뉴 닫기"
                  size="lg"
                  onClick={onClose}
                  className="h-11 w-11 rounded-xl text-slate-700"
                />
              </div>

              <div className="sidebar-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
                {children || renderDefaultMenu()}
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}

export default React.memo(MobileDrawerSidebar);
