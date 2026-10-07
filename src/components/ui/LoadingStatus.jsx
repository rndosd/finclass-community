import Spinner from "./Spinner";

// One visual language for page, section, and blocking loading states.
export default function LoadingStatus({ compact = false, message, tone, size }) {
  return <div className={compact
    ? "inline-flex items-center rounded-full border border-white/90 bg-white/95 px-3.5 py-2 shadow-lg shadow-slate-200/50 ring-1 ring-slate-200/70 backdrop-blur-sm"
    : "inline-flex min-w-[220px] flex-col items-center gap-3 rounded-[1.75rem] border border-white/85 bg-white/92 px-6 py-5 text-center shadow-xl shadow-slate-200/50 backdrop-blur-sm"}>
    <Spinner decorative size={size} tone={tone} message={message} label={message} layout={compact ? "inline" : "stacked"} />
  </div>;
}
