import React from "react";

const tones = {
  pending: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  neutral: "bg-slate-100 text-slate-600",
};

export default function MissionCardStatus({ children, tone = "neutral" }) {
  return (
      <span role="status" className={`inline-flex h-9 w-[100px] shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-transparent px-3 py-2 text-xs font-bold ${tones[tone] || tones.neutral}`}>
        {children}
      </span>
  );
}
