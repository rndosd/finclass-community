import React from "react";
import CardSkeleton from "./CardSkeleton";
import SurfaceLoader from "./SurfaceLoader";

export default function SectionLoader({
  loading = true,
  message = "\uBD88\uB7EC\uC624\uB294 \uC911\u2026",
  tone = "indigo",
  size = "md",
  className = "",
  minHeightClassName = "min-h-[260px]",
  skeleton,
  showSkeleton = true,
  delay = 120,
  minVisible = 320,
}) {
  const resolvedSkeleton = showSkeleton ? (
    skeleton || <CardSkeleton bare className="h-full min-h-full" />
  ) : (
    <div className="h-full w-full" />
  );

  return (
    <SurfaceLoader
      loading={loading}
      variant="surface-loading"
      message={message}
      tone={tone}
      size={size}
      className={className}
      minHeightClassName={minHeightClassName}
      skeleton={resolvedSkeleton}
      delay={delay}
      minVisible={minVisible}
    />
  );
}
