import React from "react";

const cx = (...classes) => classes.filter(Boolean).join(" ");

function SkeletonBlock({ className = "" }) {
  return <div className={cx("animate-pulse rounded-2xl bg-slate-200/80", className)} />;
}

export default function ChartSkeleton({
  bare = false,
  className = "",
  heightClassName = "h-56",
}) {
  const barHeights = [32, 54, 42, 66, 78, 58, 72, 48];

  return (
    <div
      aria-hidden="true"
      className={cx(
        bare
          ? "h-full w-full p-6"
          : "rounded-[1.75rem] border border-slate-200 bg-white/85 p-6 shadow-sm backdrop-blur-sm",
        "space-y-6",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <SkeletonBlock className="h-5 w-40 max-w-[60%]" />
          <SkeletonBlock className="h-3.5 w-24 max-w-[30%]" />
        </div>
        <div className="flex gap-2">
          <SkeletonBlock className="h-8 w-16 rounded-full" />
          <SkeletonBlock className="h-8 w-16 rounded-full" />
        </div>
      </div>

      <div
        className={cx(
          "flex items-end gap-3 rounded-[1.5rem] border border-slate-100 bg-slate-50/80 p-4",
          heightClassName,
        )}
      >
        {barHeights.map((height, index) => (
          <div
            key={`chart-skeleton-bar-${index}`}
            className="flex h-full flex-1 flex-col justify-end gap-3"
          >
            <div
              className="animate-pulse rounded-t-[1rem] bg-slate-200/80"
              style={{ height: `${height}%` }}
            />
            <div className="h-3 rounded-full bg-slate-200/70" />
          </div>
        ))}
      </div>
    </div>
  );
}
