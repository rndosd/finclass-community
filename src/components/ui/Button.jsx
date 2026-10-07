import React, { forwardRef } from "react";
import Spinner from "./Spinner";
import { BUTTON_TONE_STYLES, resolveUiTone } from "./toneStyles";

const SIZE_MAP = {
  xs: "min-h-8 px-2.5 py-1 text-xs gap-1",
  sm: "min-h-10 px-3.5 py-2 text-sm gap-2",
  md: "min-h-12 px-5 py-3 text-[15px] gap-2",
  lg: "px-6 py-3 text-base gap-2.5",
  xl: "px-7 py-3.5 text-lg gap-3",
  "icon-sm": "h-8 w-8 p-0",
  "icon-md": "h-11 w-11 p-0",
  "icon-lg": "h-12 w-12 p-0",
};

const ICON_SIZE_MAP = {
  xs: "h-3.5 w-3.5",
  sm: "h-4 w-4",
  md: "h-[18px] w-[18px]",
  lg: "h-5 w-5",
  xl: "h-6 w-6",
  "icon-sm": "h-4 w-4",
  "icon-md": "h-5 w-5",
  "icon-lg": "h-6 w-6",
};

const RADIUS_MAP = {
  md: "rounded-lg",
  lg: "rounded-xl",
  xl: "rounded-2xl",
  "2xl": "rounded-3xl",
  full: "rounded-full",
};

const cx = (...classes) => classes.filter(Boolean).join(" ");

const hasCustomVisualClasses = (className = "") =>
  /\b(?:bg|text|border|from|via|to|ring|shadow)-/.test(className);

const Button = forwardRef(
  (
    {
      children,
      type = "button",
      variant: variantProp,
      color,
      size = "md",
      tone,
      kind: kindProp,
      rounded = "lg",
      shadow: _shadow,
      icon: Icon,
      iconOnly = false,
      isLoading = false,
      loadingText = "",
      spinnerLabel = "",
      disabled = false,
      fullWidth = false,
      className = "",
      onClick,
      ...props
    },
    ref,
  ) => {
    const resolvedToneName = resolveUiTone(tone, null);
    const legacyColorName = resolveUiTone(color, null);
    void _shadow;
    const variant = variantProp || "primary";
    const kind = kindProp || "solid";
    const usesExplicitPalette =
      Boolean(tone) || Boolean(color) || Boolean(kindProp) || Boolean(variantProp);
    const usesCustomVisuals =
      !usesExplicitPalette && hasCustomVisualClasses(className);
    let effectiveKind = kind;
    const isDangerVariant = variant === "danger" || variant === "destructive";
    if (variant === "secondary") effectiveKind = "soft";
    if (variant === "outline") effectiveKind = "outline";
    if (variant === "ghost") effectiveKind = "ghost";
    if (isDangerVariant) effectiveKind = "solid";

    const fallbackToneKey =
      isDangerVariant ? "red" : effectiveKind === "solid" ? "blue" : "slate";
    const effectiveToneKey =
      resolvedToneName || legacyColorName || fallbackToneKey;
    const palette =
      BUTTON_TONE_STYLES[effectiveToneKey] || BUTTON_TONE_STYLES.slate;

    const baseClasses = cx(
      "inline-flex select-none items-center justify-center font-bold",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
      "transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-200",
      "motion-reduce:transition-none",
      "disabled:cursor-not-allowed disabled:opacity-50",
    );
    const sizeClasses = usesCustomVisuals ? "" : SIZE_MAP[size] || SIZE_MAP.md;
    const radiusClasses = usesCustomVisuals ? "" : RADIUS_MAP[rounded] || RADIUS_MAP.xl;
    const kindClasses = usesCustomVisuals
      ? ""
      : palette[effectiveKind] || palette.solid;
    const ringClasses = usesCustomVisuals ? "" : palette.ring;
    const widthClasses = fullWidth ? "w-full" : "";
    const iconSizeClass = ICON_SIZE_MAP[size] || ICON_SIZE_MAP.md;
    const shouldRenderChildren = !iconOnly;
    const visibleChildren =
      isLoading && loadingText && shouldRenderChildren ? loadingText : children;
    const hasVisibleChildren =
      shouldRenderChildren && visibleChildren !== null && visibleChildren !== undefined;
    const resolvedSpinnerLabel =
      spinnerLabel ||
      (typeof loadingText === "string" && loadingText) ||
      (typeof children === "string" && children
        ? `${children} \uCC98\uB9AC \uC911\u2026`
        : "\uCC98\uB9AC \uC911\u2026");

    const handleSafeClick = (event) => {
      if (isLoading || disabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      onClick?.(event);
    };

    return (
      <button
        ref={ref}
        type={type}
        className={cx(
          baseClasses,
          !usesCustomVisuals && "fc-ui-button",
          sizeClasses,
          radiusClasses,
          widthClasses,
          ringClasses,
          kindClasses,
          className,
        )}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        data-loading={isLoading ? "true" : undefined}
        onClick={handleSafeClick}
        {...props}
      >
        {isLoading ? (
          <span aria-hidden={hasVisibleChildren || undefined} className="inline-flex">
          <Spinner
            size="current"
            color="current"
            label={resolvedSpinnerLabel}
            className={cx("opacity-85", hasVisibleChildren ? "mr-2" : "")}
          />
          </span>
        ) : Icon ? (
          <Icon
            className={cx(iconSizeClass, "pointer-events-none shrink-0 opacity-100")}
            aria-hidden="true"
          />
        ) : null}

        {hasVisibleChildren ? visibleChildren : null}
      </button>
    );
  },
);

Button.displayName = "Button";

export default Button;
