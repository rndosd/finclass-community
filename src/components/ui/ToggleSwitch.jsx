// src/components/ui/ToggleSwitch.jsx
import React, { useId } from "react";

const TONE_CLASS_MAP = {
  amber: "bg-amber-500 focus-visible:ring-amber-300",
  blue: "bg-blue-600 focus-visible:ring-blue-300",
  emerald: "bg-emerald-500 focus-visible:ring-emerald-300",
  indigo: "bg-indigo-600 focus-visible:ring-indigo-300",
  pink: "bg-pink-500 focus-visible:ring-pink-300",
  rose: "bg-rose-500 focus-visible:ring-rose-300",
  slate: "bg-slate-700 focus-visible:ring-slate-300",
};

export default function ToggleSwitch({
  id: suppliedId,
  label,
  checked,
  onChange,
  disabled = false,
  className = "",
  srLabel = "Toggle",
  tone = "blue",
  activeClassName = "",
  inactiveClassName = "bg-slate-300",
}) {
  const generatedId = useId();
  const id = suppliedId || generatedId;
  const isChecked = Boolean(checked);
  const activeClasses =
    activeClassName || TONE_CLASS_MAP[tone] || TONE_CLASS_MAP.blue;

  return (
    <div className={`flex items-center ${className}`.trim()}>
      <button
        type="button"
        id={id}
        onClick={() => !disabled && onChange?.(!isChecked)}
        disabled={disabled}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        role="switch"
        aria-checked={isChecked}
        aria-labelledby={label ? `${id}-label` : undefined}
        aria-label={label ? undefined : srLabel}
      >
        <span
          aria-hidden="true"
          className={`inline-flex h-6 w-11 items-center rounded-full border-2 border-transparent transition-colors duration-200 motion-reduce:transition-none ${
            isChecked ? activeClasses : inactiveClassName
          }`}
        >
          <span
            className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none ${isChecked ? "translate-x-5" : "translate-x-0"}`}
          />
        </span>
      </button>
      {label ? (
        <label
          htmlFor={id}
          className={`ml-3 text-sm ${disabled ? "text-gray-400" : "text-gray-900"}`}
          id={id ? `${id}-label` : undefined}
        >
          {label}
        </label>
      ) : null}
    </div>
  );
}
