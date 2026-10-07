import React from "react";
import { Button } from "../../../components/ui";

export default function CaseLibraryTabStrip({
  activeId,
  items,
  onChange,
}) {
  return (
    <section className="min-w-0 w-full overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
      <div className="inline-flex min-w-full w-max">
        {items.map((item) => {
          const isActive = item.id === activeId;
          const Icon = item.icon;

          return (
            <Button
              key={item.id}
              type="button"
              kind="ghost"
              tone="slate"
              aria-pressed={isActive}
              onClick={() => onChange(item.id)}
              className={`inline-flex min-w-fit flex-none items-center gap-2 whitespace-nowrap border-r px-5 py-3 text-sm font-semibold transition last:border-r-0 ${
                isActive
                  ? "bg-white text-slate-900"
                  : "bg-slate-50 text-slate-500 hover:bg-white hover:text-slate-700"
              }`}
            >
              {Icon ? <Icon className="h-4 w-4" /> : null}
              <span>{item.label}</span>
              {typeof item.count === "number" ? (
                <span className={`${isActive ? "text-blue-600" : "text-slate-400"}`}>
                  {item.count}
                </span>
              ) : null}
              {item.hasUnread ? (
                <span
                  className="h-2.5 w-2.5 rounded-full bg-rose-500"
                  aria-label="새 글 있음"
                />
              ) : null}
            </Button>
          );
        })}
      </div>
    </section>
  );
}
