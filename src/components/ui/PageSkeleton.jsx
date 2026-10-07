import React from "react";
import CardSkeleton from "./CardSkeleton";
import ChartSkeleton from "./ChartSkeleton";
import TableSkeleton from "./TableSkeleton";

const cx = (...classes) => classes.filter(Boolean).join(" ");

function SkeletonBlock({ className = "" }) {
  return <div className={cx("animate-pulse rounded-2xl bg-slate-200/80", className)} />;
}

export default function PageSkeleton({
  summaryCards = 3,
  showChart = true,
  showTable = true,
  className = "",
}) {
  const summaryGridClass =
    summaryCards >= 4
      ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
      : summaryCards === 3
        ? "grid-cols-1 md:grid-cols-3"
        : summaryCards === 2
          ? "grid-cols-1 md:grid-cols-2"
          : "grid-cols-1";

  return (
    <div aria-hidden="true" className={cx("w-full space-y-6", className)}>
      <div className="space-y-4 px-1">
        <SkeletonBlock className="h-10 w-72 max-w-[65%]" />
        <SkeletonBlock className="h-4 w-96 max-w-[48%]" />
      </div>

      {summaryCards > 0 ? (
        <div className={cx("grid gap-4", summaryGridClass)}>
          {Array.from({ length: summaryCards }).map((_, index) => (
            <CardSkeleton
              key={`page-skeleton-card-${index}`}
              rows={2}
              showHeader={false}
              showFooter
            />
          ))}
        </div>
      ) : null}

      {showChart ? <ChartSkeleton /> : null}
      {showTable ? <TableSkeleton /> : null}
    </div>
  );
}
