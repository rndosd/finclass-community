import React from "react";

const cx = (...classes) => classes.filter(Boolean).join(" ");

function SkeletonBlock({ className = "" }) {
  return <div className={cx("animate-pulse rounded-2xl bg-slate-200/80", className)} />;
}

export default function CardSkeleton({
  rows = 3,
  showHeader = true,
  showFooter = false,
  bare = false,
  className = "",
}) {
  const rowWidths = ["w-full", "w-11/12", "w-9/12", "w-10/12", "w-8/12"];

  return (
    <div
      aria-hidden="true"
      className={cx(
        bare
          ? "h-full w-full p-6"
          : "rounded-[1.75rem] border border-slate-200 bg-white/85 p-6 shadow-sm backdrop-blur-sm",
        "space-y-4",
        className,
      )}
    >
      {showHeader ? (
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <SkeletonBlock className="h-5 w-40 max-w-[70%]" />
            <SkeletonBlock className="h-3.5 w-24 max-w-[40%]" />
          </div>
          <SkeletonBlock className="h-10 w-10 rounded-2xl" />
        </div>
      ) : null}

      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <SkeletonBlock
            key={`card-skeleton-row-${index}`}
            className={cx("h-3.5", rowWidths[index % rowWidths.length])}
          />
        ))}
      </div>

      {showFooter ? (
        <div className="flex gap-3 pt-2">
          <SkeletonBlock className="h-10 flex-1 rounded-full" />
          <SkeletonBlock className="h-10 w-28 rounded-full" />
        </div>
      ) : null}
    </div>
  );
}
