import React from "react";
import LoadingStatus from "./LoadingStatus";
import PageSkeleton from "./PageSkeleton";
import { useDelayedBusy } from "../../hooks/useDelayedBusy";

const cx = (...classes) => classes.filter(Boolean).join(" ");
const DEFAULT_PAGE_MESSAGE = "\uBD88\uB7EC\uC624\uB294 \uC911\u2026";

export default function PageLoader({
  loading = true,
  message = DEFAULT_PAGE_MESSAGE,
  tone = "indigo",
  size = "lg",
  className = "",
  fullHeight = true,
  showSkeleton = true,
  skeleton = null,
  delay = 120,
  minVisible = 320,
}) {
  const isVisible = useDelayedBusy(loading, { delay, minVisible });

  if (!isVisible) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={message}
      className={cx(
        "relative overflow-hidden bg-gradient-to-b from-blue-50 via-slate-50 to-slate-100 px-4 py-8 sm:px-6 lg:px-8",
        fullHeight ? "min-h-screen" : "min-h-[60vh]",
        className,
      )}
    >
      {showSkeleton ? (
        <div className="absolute inset-0 mx-auto w-full max-w-7xl overflow-hidden px-4 py-8 opacity-90 sm:px-6 lg:px-8">
          {skeleton || <PageSkeleton />}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
        <LoadingStatus size={size} tone={tone} message={message} />
      </div>
    </div>
  );
}
