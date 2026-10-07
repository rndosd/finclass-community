import React, { useMemo } from "react";
import {
  getRewardLabel,
  getRewardToneClasses,
  getRewardVisual,
} from "../../../constants/rewardVisuals";
import { useUser } from "../../../../../contexts/UserContext";
import {
  getRewardConstraints,
  sanitizeRewardOverride,
} from "../../../utils/rewardUtils";

const TYPE_UNIT = {
  credit: "\uC810",
  missionToken: "\uD1A0\uD070",
};

const TONE_SLIDER_CLASS = {
  indigo: "accent-indigo-600",
  amber: "accent-amber-500",
  emerald: "accent-emerald-500",
  rose: "accent-rose-500",
  slate: "accent-slate-600",
};

const RewardOverrideFields = ({
  mission,
  currencyUnit = "\uCF54\uC778",
  value = {},
  onChange,
  disabled = false,
  compact = false,
  columns = 2,
  className = "",
}) => {
  const { missionTokenLabel } = useUser();
  const rangeRewards = useMemo(
    () =>
      Object.values(getRewardConstraints(mission)).filter(
        (reward) => reward.isRange && reward.maxAmount > 0,
      ),
    [mission],
  );

  const normalizedValue = useMemo(
    () => sanitizeRewardOverride(mission, value),
    [mission, value],
  );

  const gridColumns = Math.min(rangeRewards.length || 1, Math.max(1, Math.min(3, columns)));

  const updateSingleReward = (reward, amount) => {
    onChange?.(
      sanitizeRewardOverride(mission, {
        ...normalizedValue,
        [reward.type]: amount,
      }),
    );
  };

  if (rangeRewards.length === 0) return null;

  return (
    <div className={["space-y-2", className].filter(Boolean).join(" ")}>
      <div
        className={["grid mission-reward-override-grid", compact ? "gap-2" : "gap-3"].join(" ")}
        style={{
          gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
        }}
      >
        {rangeRewards.map((reward) => {
          const visual = getRewardVisual(reward.type);
          const VisualIcon = visual.icon;
          const rewardLabel = getRewardLabel(
            reward.type,
            currencyUnit,
            missionTokenLabel,
          );
          const unit =
            reward.type === "currency"
              ? currencyUnit
              : reward.type === "missionToken"
                ? missionTokenLabel
                : TYPE_UNIT[reward.type] || "";
          const currentValue =
            normalizedValue[reward.type] ?? reward.maxAmount;

          if (columns === 3) return (
            <div key={reward.type} className={`mission-reward-compact rounded-lg border bg-white ${getRewardToneClasses(visual.tone)}`}>
              <div className="mission-reward-compact-heading">
                <span className="mission-reward-compact-label" title={rewardLabel}><VisualIcon size={14} /><span>{rewardLabel}</span></span>
                <input type="number" aria-label={`${rewardLabel} 보상 입력`} style={{ width: `${Math.max(4, String(currentValue).length + 2)}ch` }} min={reward.minAmount} max={reward.maxAmount} step="1" disabled={disabled} value={currentValue} onChange={(event) => updateSingleReward(reward, Number(event.target.value))} />
              </div>
              <input type="range" aria-label={`${rewardLabel} 보상`} min={reward.minAmount} max={reward.maxAmount} step="1" disabled={disabled} value={currentValue}
                style={{ "--reward-progress": `${reward.maxAmount > reward.minAmount ? ((currentValue - reward.minAmount) / (reward.maxAmount - reward.minAmount)) * 100 : 100}%` }}
                onChange={(event) => updateSingleReward(reward, Number(event.target.value))} className="mission-reward-slider w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed disabled:opacity-50" />
            </div>
          );

          return (
            <label
              key={reward.type}
              className={`rounded-lg border bg-white ${
                compact ? "px-2.5 py-2" : "px-3 py-2.5"
              } ${getRewardToneClasses(visual.tone)}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <VisualIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-[10px] font-bold">
                    {rewardLabel}
                  </span>
                </div>
                <span className="shrink-0 text-[10px] font-semibold text-slate-500">
                  {reward.minAmount}~{reward.maxAmount}
                  {unit}
                </span>
              </div>

              <input
                type="range"
                aria-label={`${rewardLabel} 보상`}
                min={reward.minAmount}
                max={reward.maxAmount}
                step="1"
                disabled={disabled}
                value={currentValue}
                style={{ "--reward-progress": `${reward.maxAmount > reward.minAmount ? ((currentValue - reward.minAmount) / (reward.maxAmount - reward.minAmount)) * 100 : 100}%` }}
                onChange={(event) =>
                  updateSingleReward(reward, Number(event.target.value))
                }
                className={[
                  "mission-reward-slider mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/80 disabled:cursor-not-allowed disabled:opacity-50",
                  TONE_SLIDER_CLASS[visual.tone] || TONE_SLIDER_CLASS.slate,
                ].join(" ")}
              />

              <div className="relative mt-2">
                <input
                  type="number"
                  aria-label={`${rewardLabel} 보상 입력`}
                  min={reward.minAmount}
                  max={reward.maxAmount}
                  step="1"
                  disabled={disabled}
                  value={currentValue}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    updateSingleReward(
                      reward,
                      Number.isFinite(next) ? next : reward.maxAmount,
                    );
                  }}
                  className={`w-full rounded-xl border border-blue-200 bg-blue-50/50 font-semibold text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400 ${
                    compact
                      ? "px-2.5 py-1.5 pr-11 text-sm"
                      : "px-3 py-2 pr-12 text-sm"
                  }`}
                />
                {unit ? (
                  <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-[10px] font-semibold text-slate-400">
                    {unit}
                  </span>
                ) : null}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default RewardOverrideFields;
