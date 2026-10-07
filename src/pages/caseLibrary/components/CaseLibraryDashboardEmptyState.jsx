import React from "react";
import { Button } from "../../../components/ui";

export default function CaseLibraryDashboardEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}) {
  return (
    <section className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
      <div className="mx-auto max-w-xl">
        <h2 className="text-xl font-black tracking-tight text-slate-900">
          {title}
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-500">{description}</p>
        {actionLabel && onAction ? (
          <div className="mt-6 flex justify-center">
            <Button tone="blue" onClick={onAction}>
              {actionLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
