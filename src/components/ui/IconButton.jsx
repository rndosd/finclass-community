import React, { forwardRef } from "react";
import Spinner from "./Spinner";
import { resolveUiTone } from "./toneStyles";

const cx = (...classes) => classes.filter(Boolean).join(" ");

const SIZE_STYLES = {
  sm: {
    button: "h-8 w-8 rounded-xl",
    icon: "h-3.5 w-3.5",
  },
  md: {
    button: "h-11 w-11 rounded-xl",
    icon: "h-4 w-4",
  },
  lg: {
    button: "h-12 w-12 rounded-xl",
    icon: "h-5 w-5",
  },
};

const TONE_STYLES = {
  slate: {
    idle: "text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-500",
    active: "border-slate-200 bg-slate-100 text-slate-800",
  },
  blue: {
    idle: "text-blue-700 hover:bg-blue-50 focus-visible:ring-blue-500",
    active: "border-blue-100 bg-blue-50 text-blue-700",
  },
  emerald: {
    idle: "text-emerald-700 hover:bg-emerald-50 focus-visible:ring-emerald-200",
    active: "border-emerald-100 bg-emerald-50 text-emerald-700",
  },
  amber: {
    idle: "text-amber-700 hover:bg-amber-50 focus-visible:ring-amber-200",
    active: "border-amber-100 bg-amber-50 text-amber-700",
  },
  red: {
    idle: "text-red-700 hover:bg-red-50 focus-visible:ring-red-200",
    active: "border-red-100 bg-red-50 text-red-700",
  },
};

const IconButton = forwardRef(
  (
    {
      icon: Icon,
      label,
      title,
      tone = "slate",
      size = "md",
      active = false,
      isLoading = false,
      disabled = false,
      className = "",
      type = "button",
      children,
      ...props
    },
    ref,
  ) => {
    const sizeStyle = SIZE_STYLES[size] || SIZE_STYLES.md;
    const resolvedTone = resolveUiTone(tone, "slate");
    const toneStyle = TONE_STYLES[resolvedTone] || TONE_STYLES.slate;
    const accessibleLabel = label || title;

    return (
      <button
        ref={ref}
        type={type}
        aria-label={accessibleLabel}
        title={title || label}
        aria-pressed={active || undefined}
        aria-busy={isLoading || undefined}
        disabled={disabled || isLoading}
        className={cx(
          "inline-flex shrink-0 items-center justify-center border border-transparent transition",
          "focus:outline-none focus-visible:ring-2",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          sizeStyle.button,
          active ? toneStyle.active : toneStyle.idle,
          className,
        )}
        {...props}
      >
        {isLoading ? (
          <Spinner size="current" color="current" label={accessibleLabel} />
        ) : Icon ? (
          <Icon className={sizeStyle.icon} aria-hidden="true" weight="bold" />
        ) : (
          children
        )}
      </button>
    );
  },
);

IconButton.displayName = "IconButton";

export default IconButton;
