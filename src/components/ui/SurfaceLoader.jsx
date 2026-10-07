import React from "react";
import { useDelayedBusy } from "../../hooks/useDelayedBusy";
import CardSkeleton from "./CardSkeleton";
import LoadingStatus from "./LoadingStatus";

const cx = (...classes) => classes.filter(Boolean).join(" ");

const VARIANT_META = {
  "surface-loading": {
    message: "\uBD88\uB7EC\uC624\uB294 \uC911\u2026",
    size: "md",
  },
  refreshing: {
    message: "\uBD88\uB7EC\uC624\uB294 \uC911\u2026",
    size: "xs",
  },
  "app-blocking": {
    message: "\uCC98\uB9AC \uC911\u2026",
    size: "lg",
  },
};

function StatusBubble({ variant, message, tone, size }) {
  return <LoadingStatus compact={variant !== "app-blocking"} message={message} tone={tone} size={size} />;
}

export default function SurfaceLoader({
  loading = true,
  variant = "surface-loading",
  message,
  tone = "indigo",
  size,
  className = "",
  contentClassName = "",
  overlayClassName = "",
  minHeightClassName = "min-h-[220px]",
  skeleton,
  children = null,
  preserveContent,
  delay,
  minVisible = 320,
}) {
  const meta = VARIANT_META[variant] || VARIANT_META["surface-loading"];
  const resolvedMessage = message || meta.message;
  const resolvedSize = size || meta.size;
  const resolvedDelay =
    delay ?? (variant === "refreshing" ? 180 : variant === "app-blocking" ? 120 : 100);
  const isVisible = useDelayedBusy(loading, {
    delay: resolvedDelay,
    minVisible,
  });
  const hasChildren = children !== null && children !== undefined;
  const shouldKeepContent = preserveContent ?? variant === "refreshing";
  const placeholder =
    skeleton || <CardSkeleton bare className="h-full min-h-full" />;

  if (!hasChildren) {
    if (!isVisible) {
      return null;
    }

    if (variant === "app-blocking") {
      return (
        <div
          role="status"
          aria-live="polite"
          aria-label={resolvedMessage}
          className={cx(
            "fixed inset-0 z-[1000] flex items-center justify-center p-4",
            className,
          )}
        >
          <div
            className={cx(
              "absolute inset-0 bg-white/72 backdrop-blur-sm",
              overlayClassName,
            )}
          />
          <div className="relative z-10">
            <StatusBubble
              variant={variant}
              message={resolvedMessage}
              tone={tone}
              size={resolvedSize}
            />
          </div>
        </div>
      );
    }

    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={resolvedMessage}
        className={cx(
          "relative overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white/85 shadow-sm backdrop-blur-sm",
          minHeightClassName,
          className,
        )}
      >
        <div className="absolute inset-0">{placeholder}</div>
        <div
          className={cx(
            "absolute inset-0 flex items-center justify-center bg-white/58 backdrop-blur-[2px]",
            overlayClassName,
          )}
        >
          <StatusBubble
            variant={variant}
            message={resolvedMessage}
            tone={tone}
            size={resolvedSize}
          />
        </div>
      </div>
    );
  }

  if (!isVisible) {
    return (
      <div className={cx("relative", className)}>
        <div className={contentClassName}>{children}</div>
      </div>
    );
  }

  if (variant === "app-blocking") {
    return (
      <div
        className={cx("relative", className)}
        aria-busy="true"
        aria-live="polite"
      >
        <div className={cx("transition-opacity duration-200 opacity-50", contentClassName)}>
          {children}
        </div>
        <div
          className={cx(
            "absolute inset-0 flex items-center justify-center bg-white/68 backdrop-blur-sm",
            overlayClassName,
          )}
          role="status"
          aria-label={resolvedMessage}
        >
          <StatusBubble
            variant={variant}
            message={resolvedMessage}
            tone={tone}
            size={resolvedSize}
          />
        </div>
      </div>
    );
  }

  if (shouldKeepContent) {
    return (
      <div
        className={cx("relative", className)}
        aria-busy="true"
        aria-live="polite"
      >
        <div
          className={cx(
            "transition-opacity duration-200",
            isVisible ? "opacity-60" : "opacity-100",
            contentClassName,
          )}
        >
          {children}
        </div>
        <div
          className={cx(
            "pointer-events-none absolute inset-x-0 top-0 flex justify-end p-3",
            overlayClassName,
          )}
        >
          <StatusBubble
            variant={variant}
            message={resolvedMessage}
            tone={tone}
            size={resolvedSize}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white/85 shadow-sm backdrop-blur-sm",
        minHeightClassName,
        className,
      )}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="absolute inset-0">{placeholder}</div>
      <div
        className={cx(
          "absolute inset-0 flex items-center justify-center bg-white/58 backdrop-blur-[2px]",
          overlayClassName,
        )}
        role="status"
        aria-label={resolvedMessage}
      >
        <StatusBubble
          variant={variant}
          message={resolvedMessage}
          tone={tone}
          size={resolvedSize}
        />
      </div>
    </div>
  );
}
