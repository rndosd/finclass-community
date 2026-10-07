import React from "react";
import { ChevronDown } from "lucide-react";
import { FilterDateInput, FilterSearchInput, filterInputClassName } from "./FilterControls";

const cx = (...classes) => classes.filter(Boolean).join(" ");

function FilterBar({ children, className = "", density = "default" }) {
  return (
    <div
      className={cx(
        "border-b border-slate-100 bg-slate-50/60 px-5 py-4",
        density === "compact" && "px-4 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

function FilterGrid({ children, className = "" }) {
  return <div className={cx("grid gap-3", className)}>{children}</div>;
}

function FilterActions({ children, className = "" }) {
  return <div className={cx("flex min-w-0 gap-2", className)}>{children}</div>;
}

function FilterSelect({
  value,
  onChange,
  options = [],
  children,
  tone = "blue",
  compact = false,
  className = "",
  "aria-label": ariaLabel,
  ...props
}) {
  return (
    <label className="relative block min-w-0">
      <select
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        className={cx(
          filterInputClassName({ tone, compact }),
          "appearance-none pr-8",
          className,
        )}
        {...props}
      >
        {children ||
          options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </label>
  );
}

FilterBar.Grid = FilterGrid;
FilterBar.Actions = FilterActions;
FilterBar.Search = FilterSearchInput;
FilterBar.Date = FilterDateInput;
FilterBar.Select = FilterSelect;

export default FilterBar;
