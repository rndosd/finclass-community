import React from "react";
import { Badge } from "../../../components/ui";

export default function CaseLibraryScopePanel({ title, items, tone }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{title}</Badge>
      </div>
      <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
        {items.map((item) => (
          <li key={item} className="rounded-2xl bg-slate-50 px-4 py-3">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
