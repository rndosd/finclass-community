import React from "react";
import { X } from "lucide-react";
import Button from "./Button";

const BulkActionFloatingBar = ({
  count = 0, title, subtitle, eyebrow = "선택 항목", tone = "indigo",
  icon: Icon, actions = [], onClear, clearLabel = "선택 해제", className = "",
  dismissOnBackdropClick = false, children = null, showCountBadge = true,
  showEyebrow = true, compact = false, zIndex = 90, placement = "fixed",
  forceVisible = false,
}) => {
  // Retain the existing prop without introducing a page-blocking backdrop.
  void dismissOnBackdropClick;
  if (!count && !forceVisible) return null;
  const isFixed = placement === "fixed";
  const titleHasCount = typeof title === "string" &&
    new RegExp(`(^|\\D)${count}(\\D|$)`).test(title);
  const shellClass = isFixed
    ? `pointer-events-none fixed bottom-5 left-1/2 w-full max-w-5xl -translate-x-1/2 px-4 ${className}`
    : `sticky bottom-0 z-[1] mt-4 pb-1 pt-3 ${className}`;
  return (
    <div className={shellClass.trim()} style={isFixed ? { zIndex } : undefined}>
      <div role="region" aria-label={title || "선택 항목 작업"}
        className={`pointer-events-auto rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/10 ${compact ? "p-3" : "p-3 sm:px-4"}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto">
            {Icon ? <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" strokeWidth={2} /> : null}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-5">
                {showEyebrow && eyebrow && eyebrow !== "선택 항목" ? <span className="text-slate-500">{eyebrow}</span> : null}
                <h3 className="break-words font-bold text-slate-900">{title || `${count}개 선택`}</h3>
                {showCountBadge && title && !titleHasCount ? <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-700" aria-label={`${count}개 선택`}>{count}</span> : null}
              </div>
              {subtitle ? <p className="mt-1 text-xs leading-[18px] text-slate-500">{subtitle}</p> : null}
            </div>
          </div>
          {children ? <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">{children}</div> : null}
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {actions.map(action => <Button
              key={action.key || action.label} onClick={action.onClick} icon={action.icon}
              tone={action.tone || tone} kind={action.kind || "outline"}
              size={action.size || "sm"} rounded={action.rounded || "lg"}
              disabled={action.disabled} isLoading={action.isLoading}
              className={action.className || ""}>{action.label}</Button>)}
            {onClear ? <Button variant="ghost" size="sm" tone="slate" icon={X}
              onClick={onClear} title={clearLabel} aria-label={clearLabel}>
              <span className="hidden sm:inline">{clearLabel}</span>
            </Button> : null}
          </div>
        </div>
      </div>
    </div>
  );
};
export default BulkActionFloatingBar;
