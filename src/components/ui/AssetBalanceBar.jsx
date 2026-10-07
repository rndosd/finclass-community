import React from "react";

const TONE_STYLES = {
  indigo: "bg-indigo-600 text-white",
  amber: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  blue: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  slate: "bg-slate-100 text-slate-600",
};

const AssetBalanceBar = ({ items = [], className = "", variant = "default" }) => {
  const visibleItems = items.filter((item) => item && item.visible !== false);
  const isInline = variant === "inline";
  if (visibleItems.length === 0) return null;

  return (
    <div
      className={`inline-flex max-w-full items-center ${
        isInline
          ? "gap-1"
          : "min-h-10 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"
      } ${className}`}
      aria-label="보유 자산"
    >
      {visibleItems.map((item, index) => {
        const Icon = item.icon;
        return (
          <div
            key={item.key || `${item.value}-${index}`}
            className={`flex min-w-0 items-center gap-2 ${
              isInline
                ? "h-9 px-1.5"
                : `h-10 px-3 ${index > 0 ? "border-l border-slate-100" : ""}`
            }`}
            aria-label={item.ariaLabel}
          >
            {Icon ? (
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONE_STYLES[item.tone] || TONE_STYLES.slate}`}
                aria-hidden="true"
              >
                <Icon className="h-4 w-4" />
              </span>
            ) : null}
            <span className="truncate text-[15px] font-black tabular-nums leading-none text-slate-900">
              {item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default AssetBalanceBar;
