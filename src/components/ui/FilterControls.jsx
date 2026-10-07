import React from "react";
import { Calendar, Search } from "lucide-react";

const cx = (...classes) => classes.filter(Boolean).join(" ");

const TONE_CLASSES = {
  indigo: "focus:border-blue-500",
  blue: "focus:border-blue-500",
  emerald: "focus:border-emerald-400",
  rose: "focus:border-rose-400",
  slate: "focus:border-slate-400",
};

export const filterInputClassName = ({ tone = "indigo", compact = false, icon = false } = {}) =>
  cx(
    "w-full rounded-xl border border-blue-200 bg-blue-50/50 text-slate-700 outline-none transition",
    "placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100 disabled:text-slate-400",
    TONE_CLASSES[tone] || TONE_CLASSES.indigo,
    compact ? "min-h-10 text-xs font-bold" : "min-h-11 text-sm font-semibold",
    icon ? "pl-9 pr-3" : "px-3",
  );

export const isFilterApplyKey = (event) =>
  event?.key === "Enter" &&
  !event?.shiftKey &&
  !event?.ctrlKey &&
  !event?.metaKey &&
  !event?.altKey &&
  !event?.nativeEvent?.isComposing;

export const runFilterApplyOnEnter = (event, onApply, { blur = false } = {}) => {
  if (!isFilterApplyKey(event)) return;
  event.preventDefault();
  if (blur) event.currentTarget?.blur?.();
  onApply?.();
};

export function FilterDateInput({
  value,
  onChange,
  onEnterApply,
  tone = "indigo",
  compact = false,
  showIcon = true,
  className = "",
  ...props
}) {
  return (
    <label className="relative block min-w-0">
      {showIcon ? (
        <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      ) : null}
      <input
        type="date"
        value={value || ""}
        onChange={onChange}
        onKeyDown={(event) => runFilterApplyOnEnter(event, onEnterApply, { blur: true })}
        className={cx(filterInputClassName({ tone, compact, icon: showIcon }), className)}
        {...props}
      />
    </label>
  );
}

export function FilterSearchInput({
  value,
  onChange,
  onEnterApply,
  placeholder,
  tone = "indigo",
  compact = false,
  className = "",
  ...props
}) {
  return (
    <label className="relative block min-w-0">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        value={value || ""}
        onChange={onChange}
        onKeyDown={(event) => runFilterApplyOnEnter(event, onEnterApply)}
        placeholder={placeholder}
        className={cx(filterInputClassName({ tone, compact, icon: true }), className)}
        {...props}
      />
    </label>
  );
}
