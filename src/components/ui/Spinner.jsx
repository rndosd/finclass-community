import React from "react";

const SIZE_CLASS_MAP = {
  xs: "h-3.5 w-3.5 border-2",
  sm: "h-5 w-5 border-2",
  md: "h-8 w-8 border-[3px]",
  lg: "h-11 w-11 border-4",
  xl: "h-14 w-14 border-[5px]",
  current: "h-[1em] w-[1em] border-[0.16em]",
};

const TONE_CLASS_MAP = {
  slate: "text-slate-400",
  blue: "text-blue-500",
  indigo: "text-indigo-600",
  emerald: "text-emerald-500",
  red: "text-red-500",
  rose: "text-rose-500",
  amber: "text-amber-500",
  white: "text-white",
  current: "text-current",
};

const TONE_ALIAS_MAP = {
  lightBlue: "blue",
  sky: "blue",
  green: "emerald",
  purple: "indigo",
};

const LABEL_CLASS_MAP = {
  xs: "text-[11px]",
  sm: "text-xs",
  md: "text-sm",
  lg: "text-sm",
  xl: "text-base",
  current: "text-current",
};

const cx = (...classes) => classes.filter(Boolean).join(" ");
const DEFAULT_LOADING_LABEL = "\uBD88\uB7EC\uC624\uB294 \uC911";

export default function Spinner({
  size = "md",
  tone = "indigo",
  color = "",
  className = "",
  containerClassName = "",
  label = "",
  ariaLabel = "",
  message = "",
  title = "",
  layout,
  decorative = false,
}) {
  const visibleLabel = message || title || "";
  const accessibilityLabel =
    ariaLabel || label || visibleLabel || DEFAULT_LOADING_LABEL;
  const resolvedTone = TONE_ALIAS_MAP[tone] || tone;
  const sizeClasses = SIZE_CLASS_MAP[size] || SIZE_CLASS_MAP.md;
  const labelClasses = LABEL_CLASS_MAP[size] || LABEL_CLASS_MAP.md;
  const toneClasses = color
    ? TONE_CLASS_MAP[color] || color
    : TONE_CLASS_MAP[resolvedTone] || TONE_CLASS_MAP.indigo;
  const resolvedLayout = layout || (visibleLabel ? "stacked" : "inline");

  return (
    <span
      className={cx(
        "inline-flex",
        resolvedLayout === "stacked"
          ? "flex-col items-center justify-center gap-3 text-center"
          : "items-center justify-center gap-2",
        containerClassName,
      )}
    >
      <span
        className={cx(
          "animate-spin rounded-full border-solid border-current border-r-transparent align-[-0.125em]",
          "motion-reduce:animate-[spin_1.5s_linear_infinite]",
          sizeClasses,
          toneClasses,
          className,
        )}
        role={decorative ? undefined : "status"}
        aria-live={decorative ? undefined : "polite"}
        aria-label={decorative ? undefined : accessibilityLabel}
        aria-hidden={decorative || undefined}
      >
        <span className="sr-only">{accessibilityLabel}</span>
      </span>

      {visibleLabel ? (
        <span className={cx("font-medium text-slate-600", labelClasses)}>
          {visibleLabel}
        </span>
      ) : null}
    </span>
  );
}
