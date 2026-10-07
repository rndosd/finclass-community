export const TITLE_COLLECTION_STAGE_TONE_OPTIONS = [
  { value: "slate", label: "슬레이트", previewColor: "#64748b" },
  { value: "blue", label: "파랑", previewColor: "#3b82f6" },
  { value: "indigo", label: "남색", previewColor: "#6366f1" },
  { value: "emerald", label: "초록", previewColor: "#10b981" },
  { value: "violet", label: "보라", previewColor: "#8b5cf6" },
  { value: "amber", label: "호박", previewColor: "#f59e0b" },
  { value: "red", label: "빨강", previewColor: "#ef4444" },
  { value: "cyan", label: "시안", previewColor: "#06b6d4" },
  { value: "green", label: "그린", previewColor: "#22c55e" },
  { value: "orange", label: "오렌지", previewColor: "#f97316" },
  { value: "rose", label: "로즈", previewColor: "#f43f5e" },
  { value: "purple", label: "퍼플", previewColor: "#a855f7" },
  { value: "sky", label: "스카이", previewColor: "#0ea5e9" },
  { value: "teal", label: "틸", previewColor: "#14b8a6" },
  { value: "lime", label: "라임", previewColor: "#84cc16" },
  { value: "yellow", label: "옐로", previewColor: "#eab308" },
  { value: "pink", label: "핑크", previewColor: "#ec4899" },
  { value: "fuchsia", label: "푸시아", previewColor: "#d946ef" },
];

const TITLE_COLLECTION_STAGE_TONE_STYLES = {
  slate: {
    label: "text-slate-500",
    value: "text-slate-900",
    panel: "border-slate-200 bg-[linear-gradient(180deg,_rgba(248,250,252,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-slate-200",
    compactTrack: "bg-slate-200",
    fill: "from-slate-400 via-slate-500 to-slate-600",
    compactFill: "from-slate-400 to-slate-600",
  },
  blue: {
    label: "text-sky-500",
    value: "text-sky-900",
    panel: "border-sky-200 bg-[linear-gradient(180deg,_rgba(240,249,255,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-sky-100",
    compactTrack: "bg-sky-100",
    fill: "from-sky-400 via-sky-500 to-blue-500",
    compactFill: "from-sky-400 to-blue-500",
  },
  indigo: {
    label: "text-indigo-500",
    value: "text-indigo-950",
    panel: "border-indigo-200 bg-[linear-gradient(180deg,_rgba(238,242,255,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-indigo-100",
    compactTrack: "bg-indigo-100",
    fill: "from-indigo-400 via-indigo-500 to-violet-500",
    compactFill: "from-indigo-400 to-violet-500",
  },
  emerald: {
    label: "text-emerald-500",
    value: "text-emerald-950",
    panel: "border-emerald-200 bg-[linear-gradient(180deg,_rgba(236,253,245,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-emerald-100",
    compactTrack: "bg-emerald-100",
    fill: "from-emerald-400 via-emerald-500 to-teal-500",
    compactFill: "from-emerald-400 to-teal-500",
  },
  violet: {
    label: "text-violet-500",
    value: "text-violet-950",
    panel: "border-violet-200 bg-[linear-gradient(180deg,_rgba(245,243,255,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-violet-100",
    compactTrack: "bg-violet-100",
    fill: "from-violet-400 via-violet-500 to-fuchsia-500",
    compactFill: "from-violet-400 to-fuchsia-500",
  },
  amber: {
    label: "text-amber-500",
    value: "text-amber-950",
    panel: "border-amber-200 bg-[linear-gradient(180deg,_rgba(255,251,235,0.98),_rgba(255,255,255,0.94))]",
    track: "bg-amber-100",
    compactTrack: "bg-amber-100",
    fill: "from-amber-300 via-amber-400 to-orange-500",
    compactFill: "from-amber-300 to-orange-500",
  },
  red: {
    label: "text-red-600",
    value: "text-red-950",
    panel: "border-rose-200 bg-[linear-gradient(180deg,_rgba(255,241,242,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-rose-100",
    compactTrack: "bg-red-100",
    fill: "from-rose-400 via-rose-500 to-orange-400",
    compactFill: "from-red-400 to-rose-500",
  },
  cyan: {
    label: "text-cyan-600",
    value: "text-cyan-950",
    panel: "border-cyan-200 bg-[linear-gradient(180deg,_rgba(236,254,255,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-cyan-100",
    compactTrack: "bg-cyan-100",
    fill: "from-cyan-300 via-cyan-400 to-sky-500",
    compactFill: "from-cyan-400 to-sky-500",
  },
  green: {
    label: "text-green-600",
    value: "text-green-950",
    panel: "border-green-200 bg-[linear-gradient(180deg,_rgba(240,253,244,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-green-100",
    compactTrack: "bg-green-100",
    fill: "from-green-400 via-green-500 to-emerald-500",
    compactFill: "from-green-400 to-emerald-500",
  },
  orange: {
    label: "text-orange-600",
    value: "text-orange-950",
    panel: "border-orange-200 bg-[linear-gradient(180deg,_rgba(255,247,237,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-orange-100",
    compactTrack: "bg-orange-100",
    fill: "from-orange-300 via-orange-400 to-amber-500",
    compactFill: "from-orange-400 to-amber-500",
  },
  rose: {
    label: "text-rose-600",
    value: "text-rose-950",
    panel: "border-rose-200 bg-[linear-gradient(180deg,_rgba(255,241,242,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-rose-100",
    compactTrack: "bg-rose-100",
    fill: "from-rose-300 via-rose-400 to-pink-500",
    compactFill: "from-rose-400 to-pink-500",
  },
  purple: {
    label: "text-purple-600",
    value: "text-purple-950",
    panel: "border-purple-200 bg-[linear-gradient(180deg,_rgba(250,245,255,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-purple-100",
    compactTrack: "bg-purple-100",
    fill: "from-purple-400 via-purple-500 to-violet-500",
    compactFill: "from-purple-400 to-violet-500",
  },
  sky: {
    label: "text-sky-600",
    value: "text-sky-950",
    panel: "border-sky-200 bg-[linear-gradient(180deg,_rgba(240,249,255,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-sky-100",
    compactTrack: "bg-sky-100",
    fill: "from-sky-300 via-sky-400 to-cyan-500",
    compactFill: "from-sky-400 to-cyan-500",
  },
  teal: {
    label: "text-teal-600",
    value: "text-teal-950",
    panel: "border-teal-200 bg-[linear-gradient(180deg,_rgba(240,253,250,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-teal-100",
    compactTrack: "bg-teal-100",
    fill: "from-teal-300 via-teal-400 to-emerald-500",
    compactFill: "from-teal-400 to-emerald-500",
  },
  lime: {
    label: "text-lime-700",
    value: "text-lime-950",
    panel: "border-lime-200 bg-[linear-gradient(180deg,_rgba(247,254,231,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-lime-100",
    compactTrack: "bg-lime-100",
    fill: "from-lime-300 via-lime-400 to-green-500",
    compactFill: "from-lime-400 to-green-500",
  },
  yellow: {
    label: "text-yellow-700",
    value: "text-yellow-950",
    panel: "border-yellow-200 bg-[linear-gradient(180deg,_rgba(254,252,232,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-yellow-100",
    compactTrack: "bg-yellow-100",
    fill: "from-yellow-300 via-yellow-400 to-amber-500",
    compactFill: "from-yellow-400 to-amber-500",
  },
  pink: {
    label: "text-pink-600",
    value: "text-pink-950",
    panel: "border-pink-200 bg-[linear-gradient(180deg,_rgba(253,242,248,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-pink-100",
    compactTrack: "bg-pink-100",
    fill: "from-pink-300 via-pink-400 to-rose-500",
    compactFill: "from-pink-400 to-rose-500",
  },
  fuchsia: {
    label: "text-fuchsia-600",
    value: "text-fuchsia-950",
    panel: "border-fuchsia-200 bg-[linear-gradient(180deg,_rgba(253,244,255,0.96),_rgba(255,255,255,0.94))]",
    track: "bg-fuchsia-100",
    compactTrack: "bg-fuchsia-100",
    fill: "from-fuchsia-300 via-fuchsia-400 to-purple-500",
    compactFill: "from-fuchsia-400 to-purple-500",
  },
};

const TITLE_COLLECTION_STAGE_TONE_COLORS = Object.fromEntries(
  TITLE_COLLECTION_STAGE_TONE_OPTIONS.map(({ value, previewColor }) => [
    value,
    previewColor,
  ]),
);

export function normalizeTitleCollectionStageAccentColor(value) {
  const rawValue = String(value || "").trim();
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(rawValue)) return "";

  if (rawValue.length === 4) {
    return `#${rawValue[1]}${rawValue[1]}${rawValue[2]}${rawValue[2]}${rawValue[3]}${rawValue[3]}`.toLowerCase();
  }

  return rawValue.toLowerCase();
}

export function normalizeTitleCollectionStageTone(value) {
  return Object.prototype.hasOwnProperty.call(
    TITLE_COLLECTION_STAGE_TONE_STYLES,
    value,
  )
    ? value
    : "slate";
}

export function getTitleCollectionStageToneStyle(value) {
  return TITLE_COLLECTION_STAGE_TONE_STYLES[normalizeTitleCollectionStageTone(value)];
}

export function getTitleCollectionStageToneColor(value, accentColor = "") {
  const normalizedAccentColor = normalizeTitleCollectionStageAccentColor(accentColor);
  if (normalizedAccentColor) return normalizedAccentColor;

  return TITLE_COLLECTION_STAGE_TONE_COLORS[
    normalizeTitleCollectionStageTone(value)
  ];
}
