import { Coins, Sparkles, Star } from "lucide-react";
import { DEFAULT_MISSION_TOKEN_LABEL } from "../../../utils/missionTokenLabel";

export const REWARD_VISUALS = {
  credit: {
    icon: Star,
    tone: "indigo",
    label: "신용점수",
  },
  currency: {
    icon: Coins,
    tone: "amber",
    label: "코인",
  },
  missionToken: {
    icon: Sparkles,
    tone: "emerald",
    label: DEFAULT_MISSION_TOKEN_LABEL,
  },
};

export function getRewardVisual(type) {
  return (
    REWARD_VISUALS[type] || {
      icon: Sparkles,
      tone: "slate",
      label: "보상",
    }
  );
}

export function getRewardLabel(
  type,
  currencyUnit = "코인",
  missionTokenLabel = getRewardVisual(type).label,
) {
  if (type === "currency") {
    return currencyUnit;
  }

  if (type === "missionToken") {
    return missionTokenLabel;
  }

  return getRewardVisual(type).label;
}

export function getRewardToneClasses(tone) {
  const mapping = {
    indigo: "bg-indigo-50 border-indigo-100 text-indigo-700",
    amber: "bg-amber-50 border-amber-100 text-amber-700",
    emerald: "bg-emerald-50 border-emerald-100 text-emerald-700",
    rose: "bg-rose-50 border-rose-100 text-rose-700",
    slate: "bg-slate-50 border-slate-100 text-slate-700",
  };

  return mapping[tone] || mapping.slate;
}
