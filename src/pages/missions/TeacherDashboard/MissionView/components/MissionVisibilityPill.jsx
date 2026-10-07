import React from "react";
import { Button } from "../../../../../components/ui";

const ACTIVE_TONE_CLASSES = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  blue: "border-sky-200 bg-sky-50 text-sky-700",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
  slate: "border-slate-300 bg-slate-100 text-slate-700",
};

export default function MissionVisibilityPill({
  label,
  active = false,
  onClick,
  disabled = false,
  activeTone = "emerald",
  title,
  className = "",
  inactiveLabel,
}) {
  const activeClasses =
    ACTIVE_TONE_CLASSES[activeTone] || ACTIVE_TONE_CLASSES.emerald;

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={[
        "rounded-lg border px-2 py-1 text-xs font-semibold transition-colors",
        active
          ? activeClasses
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
        disabled ? "cursor-not-allowed opacity-60" : "",
        className,
      ].join(" ")}
    >
      {active ? label : inactiveLabel || label}
    </Button>
  );
}
