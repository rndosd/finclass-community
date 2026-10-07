import React from "react";
import { Button } from "../../../../../components/ui";

const MODE_OPTIONS = [
  {
    key: "approve",
    label: "승인 모드",
    activeClassName: "bg-blue-600 text-white shadow-sm",
  },
  {
    key: "cancel",
    label: "승인 취소 모드",
    activeClassName: "bg-rose-600 text-white shadow-sm",
  },
];

export default function ApprovalModeToggle({ mode, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
      {MODE_OPTIONS.map((option) => (
        <Button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={mode === option.key}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
            mode === option.key
              ? option.activeClassName
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
