import { Check } from "lucide-react";

import { getTitleCollectionStageToneColor } from "../titleCollectionStageTones";
import {
  getTitleCollectionStageAsset,
  getTitleCollectionStageAssetByVisualStage,
  getTitleCollectionConfiguredStageIndex,
  getTitleCollectionVisualStage,
  TITLE_COLLECTION_VISUAL_STAGE_COUNT,
} from "../titleCollectionStageVisuals";

// The production emblems share a fixed 512px canvas and book baseline, while
// their visible ornament silhouettes grow asymmetrically by stage. These
// offsets center the visible alpha bounds inside the large dashboard circle.
function withAlpha(hex, alpha) {
  const normalized = String(hex || "").replace("#", "");
  if (normalized.length !== 6) return `rgba(100, 116, 139, ${alpha})`;
  const value = Number.parseInt(normalized, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export function TitleCollectionStageRail({
  rate = 0,
  tone = "slate",
  color = "",
  stages = [],
}) {
  const hasConfiguredStages = Array.isArray(stages) && stages.length > 0;
  const railStages = hasConfiguredStages
    ? [...stages].sort(
        (left, right) =>
          Number(left?.minRate || 0) - Number(right?.minRate || 0) ||
          Number(left?.order || 0) - Number(right?.order || 0),
      )
    : Array.from({ length: TITLE_COLLECTION_VISUAL_STAGE_COUNT }, (_, index) => ({
        id: `visual-stage-${index + 1}`,
        label: `${index + 1}단계`,
      }));
  const currentStageIndex = hasConfiguredStages
    ? getTitleCollectionConfiguredStageIndex(rate, railStages)
    : getTitleCollectionVisualStage(rate) - 1;
  const accent = getTitleCollectionStageToneColor(tone, color);

  return (
    <div
      className="title-stage-rail-scrollbar mt-4 overflow-x-auto pb-1 pt-2"
      aria-label={currentStageIndex >= 0 ? `도감 ${currentStageIndex + 1}단계` : "도감 미등록"}
    >
      <div
        className={`flex items-start ${
          railStages.length > 4 ? "min-w-[560px]" : "w-full"
        }`}
      >
        {railStages.map((stage, index) => {
          const isComplete = index < currentStageIndex;
          const isCurrent = index === currentStageIndex;

          return (
            <div key={stage.id || index} className="relative flex min-w-0 flex-1 flex-col items-center">
              {index ? (
                <span
                  className="absolute right-1/2 top-[9px] h-0.5 w-full"
                  style={{
                    backgroundColor:
                      index <= currentStageIndex ? accent : "#e2e8f0",
                  }}
                />
              ) : null}
              <span
                className="relative z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 bg-white"
                style={{
                  borderColor: isComplete || isCurrent ? accent : "#e2e8f0",
                  boxShadow: isCurrent
                    ? `0 0 0 5px ${withAlpha(accent, 0.14)}`
                    : "none",
                }}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isComplete ? (
                  <Check className="h-2.5 w-2.5" style={{ color: accent }} strokeWidth={3} />
                ) : isCurrent ? (
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
                ) : null}
              </span>
              <span
                className="mt-2 max-w-[88px] truncate px-1 text-[10px] font-bold"
                style={{ color: isCurrent ? accent : "#94a3b8" }}
                title={stage.label}
              >
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TitleCollectionStageEmblem({
  rate = 0,
  tone = "slate",
  color = "",
  stages = [],
  compact = false,
  showStage = false,
  visualStage = null,
  className = "",
}) {
  const requestedVisualStage = Number(visualStage);
  const hasVisualStageOverride =
    Number.isFinite(requestedVisualStage) && requestedVisualStage > 0;
  const currentStage = hasVisualStageOverride
    ? Math.max(
        1,
        Math.min(
          TITLE_COLLECTION_VISUAL_STAGE_COUNT,
          Math.round(requestedVisualStage),
        ),
      )
    : getTitleCollectionVisualStage(rate, stages);
  const accent = getTitleCollectionStageToneColor(tone, color);
  const asset = hasVisualStageOverride
    ? getTitleCollectionStageAssetByVisualStage(currentStage)
    : getTitleCollectionStageAsset(rate, stages);
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div
        className={`relative flex shrink-0 items-center justify-center rounded-full border ${
          compact ? "h-16 w-16" : "h-44 w-44 sm:h-48 sm:w-48"
        }`}
        style={{
          borderColor: withAlpha(accent, 0.36),
          background: `radial-gradient(circle, ${withAlpha(accent, 0.12)} 0%, ${withAlpha(accent, 0.04)} 58%, rgba(255,255,255,0.7) 100%)`,
          boxShadow: `0 0 0 ${compact ? 5 : 10}px ${withAlpha(accent, 0.06)}, inset 0 0 0 1px ${withAlpha(accent, 0.12)}`,
        }}
      >
        <img
          src={asset}
          alt="현재 칭호 도감 단계 엠블럼"
          className={
            compact
              ? "h-[94%] w-[94%] object-contain"
              : "h-full w-full object-contain"
          }
        />
      </div>
      {showStage ? (
        <span
          className={`mt-3 inline-flex items-center justify-center rounded-xl border bg-white/90 font-black ${
            compact ? "px-2 py-0.5 text-[10px]" : "min-w-24 px-4 py-1.5 text-sm"
          }`}
          style={{ borderColor: withAlpha(accent, 0.5), color: accent }}
        >
          성장 {currentStage}/{TITLE_COLLECTION_VISUAL_STAGE_COUNT}
        </span>
      ) : null}
    </div>
  );
}
