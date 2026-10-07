import React from "react";

const cx = (...classes) => classes.filter(Boolean).join(" ");

function SkeletonBlock({ className = "" }) {
  return <div className={cx("animate-pulse rounded-2xl bg-slate-200/80", className)} />;
}

export default function TableSkeleton({
  columns = 5,
  rows = 6,
  bare = false,
  className = "",
}) {
  const templateColumns = `repeat(${Math.max(columns, 1)}, minmax(0, 1fr))`;

  return (
    <div
      aria-hidden="true"
      className={cx(
        bare
          ? "h-full w-full p-6"
          : "rounded-[1.75rem] border border-slate-200 bg-white/85 p-6 shadow-sm backdrop-blur-sm",
        "space-y-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <SkeletonBlock className="h-5 w-44 max-w-[68%]" />
          <SkeletonBlock className="h-3.5 w-24 max-w-[32%]" />
        </div>
        <SkeletonBlock className="h-9 w-28 rounded-full" />
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border border-slate-100 bg-slate-50/80">
        <div
          className="grid gap-3 border-b border-slate-100 px-4 py-4"
          style={{ gridTemplateColumns: templateColumns }}
        >
          {Array.from({ length: columns }).map((_, index) => (
            <SkeletonBlock
              key={`table-skeleton-head-${index}`}
              className="h-3.5 w-3/4"
            />
          ))}
        </div>

        <div className="divide-y divide-slate-100">
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <div
              key={`table-skeleton-row-${rowIndex}`}
              className="grid gap-3 px-4 py-4"
              style={{ gridTemplateColumns: templateColumns }}
            >
              {Array.from({ length: columns }).map((__, columnIndex) => (
                <SkeletonBlock
                  key={`table-skeleton-cell-${rowIndex}-${columnIndex}`}
                  className={
                    columnIndex === 0
                      ? "h-4 w-5/6"
                      : columnIndex === columns - 1
                        ? "h-4 w-2/3"
                        : "h-4 w-4/5"
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
