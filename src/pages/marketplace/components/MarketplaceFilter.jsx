import React, { useEffect, useId, useMemo } from "react";
import { ChevronDown } from "lucide-react";

const STUDENT_FILTERS = [
  { key: "active", label: "판매중" },
  { key: "sold", label: "판매완료" },
];

const ADMIN_FILTERS = [
  { key: "active", label: "판매중" },
  { key: "sold", label: "판매완료" },
  { key: "pending", label: "승인대기" },
  { key: "rejected", label: "반려" },
];

const MarketplaceFilter = ({
  statusFilter,
  onFilterChange,
  itemCounts = {},
  isMarketplaceAdmin,
  pendingBadgeCount = 0,
  options: customOptions,
  label = "상태",
}) => {
  const selectId = useId();
  const visibleFilters = useMemo(() => {
    if (Array.isArray(customOptions) && customOptions.length > 0) {
      return customOptions;
    }

    return isMarketplaceAdmin ? ADMIN_FILTERS : STUDENT_FILTERS;
  }, [customOptions, isMarketplaceAdmin]);

  useEffect(() => {
    if (visibleFilters.length === 0) return;

    const allowedKeys = visibleFilters.map((filter) => filter.key);
    if (!allowedKeys.includes(statusFilter)) {
      onFilterChange(allowedKeys[0]);
    }
  }, [onFilterChange, statusFilter, visibleFilters]);

  const options = useMemo(
    () =>
      visibleFilters.map((filter) => {
        const hasLocalCount = Object.prototype.hasOwnProperty.call(
          itemCounts,
          filter.key,
        );
        const localCount = hasLocalCount ? Number(itemCounts[filter.key] || 0) : null;
        const pendingCount = Number(pendingBadgeCount || 0);
        let count = localCount;

        if (filter.key === "pending") {
          if (localCount !== null || pendingCount > 0) {
            count =
              localCount === null
                ? pendingCount
                : Math.max(localCount, pendingCount);
          }
        }

        return {
          ...filter,
          labelWithCount:
            count === null ? filter.label : `${filter.label} (${count})`,
        };
      }),
    [itemCounts, pendingBadgeCount, visibleFilters],
  );

  return (
    <div className="w-full sm:w-auto">
      <label htmlFor={selectId} className="block px-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
        {label}
      </label>
      <div className="relative mt-1 min-w-[200px]">
        <select
          id={selectId}
          value={statusFilter}
          onChange={(event) => onFilterChange(event.target.value)}
          className="w-full appearance-none rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 pr-11 text-sm font-semibold text-slate-700 shadow-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-blue-500/20"
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.labelWithCount}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
    </div>
  );
};

export default MarketplaceFilter;
