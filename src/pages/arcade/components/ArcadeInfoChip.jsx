const TONE_CLASSES = {
  slate: "border-slate-200 bg-white/90 text-slate-600",
  emerald: "border-emerald-200 bg-emerald-50/90 text-emerald-700",
  teal: "border-teal-200 bg-teal-50/90 text-teal-700",
  cyan: "border-cyan-200 bg-cyan-50/90 text-cyan-700",
  indigo: "border-indigo-200 bg-indigo-50/90 text-indigo-700",
};

const ArcadeInfoChip = ({
  children,
  className = "",
  icon = null,
  tone = "slate",
}) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black leading-none shadow-[0_4px_12px_rgba(15,23,42,0.08)] backdrop-blur-sm ${
      TONE_CLASSES[tone] || TONE_CLASSES.slate
    } ${className}`}
  >
    {icon}
    {children}
  </span>
);

export default ArcadeInfoChip;
