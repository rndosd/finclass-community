import React from "react";
import { User } from "lucide-react";
import { Badge } from "../../../components/ui";

const TONE_STYLES = {
  seller: {
    wrapper: "border-sky-200 bg-sky-50/80",
    label: "text-sky-700",
    name: "text-sky-950",
  },
  buyer: {
    wrapper: "border-emerald-200 bg-emerald-50/80",
    label: "text-emerald-700",
    name: "text-emerald-950",
  },
  neutral: {
    wrapper: "border-slate-200 bg-white",
    label: "text-slate-500",
    name: "text-slate-900",
  },
};

export default function TradePartySummary({
  title,
  name,
  tone = "neutral",
  isCurrentUser = false,
}) {
  const styles = TONE_STYLES[tone] || TONE_STYLES.neutral;

  return (
    <div className={`rounded-2xl border px-3 py-3 ${styles.wrapper}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-[11px] font-black uppercase tracking-[0.18em] ${styles.label}`}>
          {title}
        </p>
        {isCurrentUser ? (
          <Badge tone="slate" variant="soft" size="sm" className="font-bold">
            나
          </Badge>
        ) : null}
      </div>

      <div className={`mt-2 flex items-center gap-2 text-sm font-black ${styles.name}`}>
        <User className="h-3.5 w-3.5" />
        <span className="truncate">{name}</span>
      </div>
    </div>
  );
}
