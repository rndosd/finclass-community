import React from "react";
import { useLocation } from "react-router-dom";
import { useClassUiConfig } from "../../contexts/ClassUiConfigContext";
import { getSidebarMenuLabelByPath } from "../layout/sidebarMenuUtils";
import Badge from "./Badge";

export default function PageHeader({
  title,
  subtitle,
  icon,
  iconProps = {},
  badge = null,
  titleAccessory = null,
  actions,
  rightSlot = null,
  className = "",
  useCustomTitle = true,
}) {
  const location = useLocation();
  const { sidebarSettings } = useClassUiConfig();

  const currentPath = location.pathname;
  const linkedMenuTitle = useCustomTitle
    ? getSidebarMenuLabelByPath(currentPath, sidebarSettings)
    : null;
  const displayTitle = linkedMenuTitle || title;

  const renderIcon = () => {
    if (!icon) return null;

    const iconWrapperClass =
      "w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-xl mr-3 flex-shrink-0 border border-blue-800";

    const isComponent = typeof icon === "function" ||
      icon?.$$typeof === Symbol.for("react.forward_ref") ||
      icon?.$$typeof === Symbol.for("react.memo");
    if (isComponent) {
      const IconComp = icon;
      return (
        <div className={iconWrapperClass}>
          <IconComp size={24} strokeWidth={2} {...iconProps} />
        </div>
      );
    }

    if (React.isValidElement(icon)) {
      return (
        <div className={iconWrapperClass}>
          {React.cloneElement(icon, { size: 24, strokeWidth: 2, ...iconProps })}
        </div>
      );
    }
    return null;
  };

  const rightContent = rightSlot ?? actions;
  const isSubtitlePrimitive =
    typeof subtitle === "string" || typeof subtitle === "number";

  const renderBadge = () => {
    if (!badge) return null;
    if (React.isValidElement(badge)) return badge;

    const badgeConfig =
      typeof badge === "string" || typeof badge === "number"
        ? { label: badge }
        : badge;
    const {
      label,
      tone = "blue",
      variant = "soft",
      size = "sm",
      className: badgeClassName = "",
      ...badgeProps
    } = badgeConfig || {};

    if (label === undefined || label === null || label === "") {
      return null;
    }

    return (
      <Badge
        tone={tone}
        variant={variant}
        size={size}
        className={`self-start sm:self-auto ${badgeClassName}`}
        {...badgeProps}
      >
        {label}
      </Badge>
    );
  };

  return (
    <header
      className={`
        flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center justify-between gap-4
        bg-transparent
        px-0 py-0 mb-6
        ${className}
      `}
    >
      <div className="flex items-center min-w-0 w-full sm:w-auto">
        {renderIcon()}

        <div className="flex flex-col min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="min-w-0 break-words text-[28px] font-extrabold tracking-tight leading-9 text-slate-900 sm:text-[32px] sm:leading-10">
              {displayTitle}
            </h1>
            {titleAccessory ? (
              <div className="min-w-0 max-w-full w-full sm:w-auto">
                {titleAccessory}
              </div>
            ) : null}
            {renderBadge()}
          </div>
          {subtitle && (
            isSubtitlePrimitive ? (
              <p className="text-sm font-normal leading-[22px] text-slate-600 mt-1">
                {subtitle}
              </p>
            ) : (
              <div className="mt-1 text-sm font-normal leading-[22px] text-slate-600">
                {subtitle}
              </div>
            )
          )}
        </div>
      </div>

      {rightContent && (
        <div className="flex flex-wrap items-center justify-start sm:justify-end gap-2 shrink-0 w-full sm:w-auto">
          {rightContent}
        </div>
      )}
    </header>
  );
}
