import React, { Fragment } from "react";
import { Menu, Transition } from "@headlessui/react";
import {
  Bell,
  BellRinging as BellRing,
  Check
} from "@phosphor-icons/react";
import { Button, Spinner } from "../components/ui";
import { getNotificationConfig } from "./constants";

export function formatNotificationTime(timestamp) {
  if (!timestamp) return "";
  const date =
    typeof timestamp.toDate === "function"
      ? timestamp.toDate()
      : timestamp instanceof Date
        ? timestamp
        : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const diffInSec = Math.floor((now - date) / 1000);
  if (diffInSec < 60) return "\uBC29\uAE08 \uC804";
  if (diffInSec < 3600) return `${Math.floor(diffInSec / 60)}\uBD84 \uC804`;
  if (diffInSec < 86400) return `${Math.floor(diffInSec / 3600)}\uC2DC\uAC04 \uC804`;
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export default function NotificationDropdownSurface({
  buttonRef,
  panelStyle,
  unreadCount,
  notifications,
  hasMore,
  isLoading,
  isLoadingMore,
  onButtonMouseDown,
  onButtonClick,
  onBeforeEnter,
  onAfterEnter,
  onBeforeLeave,
  onAfterLeave,
  onMarkAllRead,
  onNotificationClick,
  onLoadMore,
}) {
  const resolvedPanelStyle = panelStyle?.top
    ? panelStyle
    : {
        right: "12px",
        top: "72px",
      };

  return (
    <Menu as="div" className="relative">
      <Menu.Button
        ref={buttonRef}
        onMouseDown={onButtonMouseDown}
        onClick={onButtonClick}
        className="relative p-2 text-slate-500 hover:text-indigo-600 rounded-xl transition-all hover:bg-indigo-50"
      >
        {unreadCount > 0 ? (
          <>
            <BellRing className="h-6 w-6 text-indigo-600 animate-swing" />
            <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          </>
        ) : (
          <Bell className="h-6 w-6" />
        )}
      </Menu.Button>

      <Transition
        as={Fragment}
        beforeEnter={onBeforeEnter}
        afterEnter={onAfterEnter}
        beforeLeave={onBeforeLeave}
        afterLeave={onAfterLeave}
        enter="transition ease-out duration-200"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items
          style={resolvedPanelStyle}
          className="fixed z-[10000] w-80 sm:w-96 max-w-[calc(100vw-1.5rem)] origin-top-right rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 focus:outline-none overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50 bg-white/80 backdrop-blur-md sticky top-0 z-10">
            <h3 className="text-base font-bold text-slate-900">{"\uC54C\uB9BC"}</h3>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                kind="ghost"
                size="xs"
                onClick={onMarkAllRead}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >
                <Check size={14} /> {"\uBAA8\uB450 \uC77D\uC74C"}
              </Button>
            )}
          </div>

          <div className="max-h-[450px] overflow-y-auto custom-scrollbar">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-16 text-center">
                <Bell className="h-12 w-12 text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400 font-medium">
                  {"\uC0C8\uB85C\uC6B4 \uC54C\uB9BC\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {notifications.map((notification) => {
                  const config = getNotificationConfig(notification.type);
                  const Icon = config.icon;
                  return (
                    <Menu.Item key={notification.id}>
                      {({ active }) => (
                        <div
                          onClick={() => onNotificationClick(notification)}
                          className={`px-5 py-4 cursor-pointer transition-all flex gap-4 ${active ? "bg-slate-50" : "bg-white"} ${!notification.isRead ? "relative before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-indigo-500" : ""}`}
                        >
                          <div
                            className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${!notification.isRead ? config.bgColor : "bg-slate-100"}`}
                          >
                            <Icon
                              className={`h-5 w-5 ${!notification.isRead ? config.color : "text-slate-400"}`}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-0.5">
                              <span className="text-[10px] font-bold text-slate-400">
                                {config.label}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {formatNotificationTime(notification.createdAt)}
                              </span>
                            </div>
                            <h4
                              className={`text-sm font-bold truncate ${notification.isRead ? "text-slate-500" : "text-slate-900"}`}
                            >
                              {notification.title}
                            </h4>
                            <p
                              className={`text-xs mt-1 line-clamp-1 leading-relaxed ${notification.isRead ? "text-slate-400" : "text-slate-600"}`}
                            >
                              {notification.message}
                            </p>
                          </div>
                        </div>
                      )}
                    </Menu.Item>
                  );
                })}
              </div>
            )}
          </div>

          {hasMore && !isLoading && (
            <div className="p-2 border-t border-slate-50 bg-slate-50/50">
              <Button
                variant="ghost"
                size="sm"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="w-full text-indigo-600 font-bold hover:bg-white"
              >
                {isLoadingMore ? <Spinner size="xs" /> : "\uC774\uC804 \uC54C\uB9BC \uB354 \uBCF4\uAE30"}
              </Button>
            </div>
          )}
        </Menu.Items>
      </Transition>
    </Menu>
  );
}
