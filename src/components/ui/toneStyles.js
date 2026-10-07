export const UI_TONE_ALIASES = {
  gray: "slate",
  zinc: "slate",
  lightBlue: "blue",
  sky: "blue",
  cyan: "blue",
  purple: "indigo",
  violet: "indigo",
  green: "emerald",
  lime: "emerald",
  yellow: "amber",
  orange: "amber",
  pink: "rose",
  fuchsia: "rose",
  brown: "amber",
};

export const resolveUiTone = (tone, fallback = "slate") => {
  if (!tone) return fallback;
  return UI_TONE_ALIASES[tone] || tone;
};

export const BUTTON_TONE_STYLES = {
  slate: {
    ring: "focus:ring-slate-500",
    solid:
      "bg-slate-800 text-white shadow-sm hover:bg-slate-900 hover:shadow-md",
    soft: "bg-slate-100 text-slate-800 hover:bg-slate-200",
    ghost: "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
    outline:
      "border border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50",
  },
  blue: {
    ring: "focus:ring-blue-500",
    solid:
      "bg-blue-600 text-white shadow-[0_1px_0_#1d4ed8] hover:bg-blue-700",
    soft: "bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800",
    ghost: "text-blue-700 hover:bg-blue-50",
    outline: "border border-blue-200 text-blue-700 hover:bg-blue-50",
  },
  indigo: {
    ring: "focus:ring-indigo-500",
    solid:
      "bg-indigo-600 text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700",
    soft: "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700",
    ghost: "text-indigo-600 hover:bg-indigo-50",
    outline: "border border-indigo-200 text-indigo-600 hover:bg-indigo-50",
  },
  amber: {
    ring: "focus:ring-amber-500",
    solid:
      "bg-amber-700 text-white shadow-sm hover:bg-amber-800",
    soft: "bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800",
    ghost: "text-amber-700 hover:bg-amber-50",
    outline: "border border-amber-200 text-amber-700 hover:bg-amber-50",
  },
  red: {
    ring: "focus:ring-red-500",
    solid: "bg-red-600 text-white shadow-sm hover:bg-red-700",
    soft: "bg-red-50 text-red-600 hover:bg-red-100",
    ghost: "text-red-500 hover:bg-red-50",
    outline: "border border-red-200 text-red-500 hover:bg-red-50",
  },
  rose: {
    ring: "focus:ring-rose-500",
    solid: "bg-rose-600 text-white shadow-sm hover:bg-rose-700",
    soft: "bg-rose-50 text-rose-600 hover:bg-rose-100",
    ghost: "text-rose-700 hover:bg-rose-50",
    outline: "border border-rose-200 text-rose-700 hover:bg-rose-50",
  },
  emerald: {
    ring: "focus:ring-emerald-500",
    solid:
      "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800",
    soft:
      "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700",
    ghost: "text-emerald-600 hover:bg-emerald-50",
    outline: "border border-emerald-200 text-emerald-600 hover:bg-emerald-50",
  },
};

export const BADGE_TONE_STYLES = {
  slate: {
    bg: "bg-slate-100",
    text: "text-slate-600",
    ring: "ring-slate-500/10",
    solidBg: "bg-slate-600",
  },
  blue: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    ring: "ring-blue-700/10",
    solidBg: "bg-blue-600",
  },
  indigo: {
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    ring: "ring-indigo-700/10",
    solidBg: "bg-indigo-600",
  },
  amber: {
    bg: "bg-amber-100/50",
    text: "text-amber-800",
    ring: "ring-amber-600/30",
    solidBg: "bg-amber-600",
  },
  rose: {
    bg: "bg-rose-50",
    text: "text-rose-700",
    ring: "ring-rose-600/10",
    solidBg: "bg-rose-600",
  },
  red: {
    bg: "bg-red-50",
    text: "text-red-700",
    ring: "ring-red-600/10",
    solidBg: "bg-red-600",
  },
  emerald: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    ring: "ring-emerald-600/20",
    solidBg: "bg-emerald-600",
  },
};

export const CATEGORY_COLOR_OPTIONS = [
  {
    key: "indigo",
    label: "인디고",
    ring: "ring-indigo-200",
    bg: "bg-indigo-50",
    text: "text-indigo-500",
    chip: "bg-indigo-500",
  },
  {
    key: "blue",
    label: "파랑",
    ring: "ring-blue-200",
    bg: "bg-blue-50",
    text: "text-blue-500",
    chip: "bg-blue-500",
  },
  {
    key: "emerald",
    label: "초록",
    ring: "ring-emerald-200",
    bg: "bg-emerald-50",
    text: "text-emerald-500",
    chip: "bg-emerald-500",
  },
  {
    key: "amber",
    label: "노랑",
    ring: "ring-amber-200",
    bg: "bg-amber-50",
    text: "text-amber-600",
    chip: "bg-amber-500",
  },
  {
    key: "rose",
    label: "분홍",
    ring: "ring-rose-200",
    bg: "bg-rose-50",
    text: "text-rose-500",
    chip: "bg-rose-500",
  },
  {
    key: "slate",
    label: "회색",
    ring: "ring-slate-200",
    bg: "bg-slate-50",
    text: "text-slate-500",
    chip: "bg-slate-500",
  },
];

const legacyCategoryColors = {
  cyan: {
    key: "cyan",
    label: "하늘",
    ring: "ring-cyan-200",
    bg: "bg-cyan-50",
    text: "text-cyan-500",
    chip: "bg-cyan-500",
  },
  violet: {
    key: "violet",
    label: "보라",
    ring: "ring-violet-200",
    bg: "bg-violet-50",
    text: "text-violet-500",
    chip: "bg-violet-500",
  },
  purple: {
    key: "purple",
    label: "보라",
    ring: "ring-purple-200",
    bg: "bg-purple-50",
    text: "text-purple-500",
    chip: "bg-purple-500",
  },
  green: {
    key: "green",
    label: "초록",
    ring: "ring-green-200",
    bg: "bg-green-50",
    text: "text-green-500",
    chip: "bg-green-500",
  },
  orange: {
    key: "orange",
    label: "주황",
    ring: "ring-orange-200",
    bg: "bg-orange-50",
    text: "text-orange-500",
    chip: "bg-orange-500",
  },
  red: {
    key: "red",
    label: "빨강",
    ring: "ring-red-200",
    bg: "bg-red-50",
    text: "text-red-500",
    chip: "bg-red-500",
  },
  yellow: {
    key: "yellow",
    label: "노랑",
    ring: "ring-yellow-200",
    bg: "bg-yellow-50",
    text: "text-yellow-600",
    chip: "bg-yellow-500",
  },
};

export const CATEGORY_COLOR_CLASS_MAP = {
  ...Object.fromEntries(CATEGORY_COLOR_OPTIONS.map((item) => [item.key, item])),
  ...legacyCategoryColors,
};

export const getCategoryColorClasses = (key) =>
  CATEGORY_COLOR_CLASS_MAP[key] || CATEGORY_COLOR_CLASS_MAP.indigo;

export const CATEGORY_CHIP_TONE_STYLES = {
  blue: {
    icon: "text-blue-600",
    selected:
      "border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 text-blue-700 shadow-blue-100",
  },
  cyan: {
    icon: "text-cyan-600",
    selected:
      "border-cyan-200 bg-gradient-to-br from-cyan-50 to-sky-50 text-cyan-700 shadow-cyan-100",
  },
  emerald: {
    icon: "text-emerald-600",
    selected:
      "border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 text-emerald-700 shadow-emerald-100",
  },
  green: {
    icon: "text-green-600",
    selected:
      "border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 text-green-700 shadow-green-100",
  },
  indigo: {
    icon: "text-indigo-600",
    selected:
      "border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 text-indigo-700 shadow-indigo-100",
  },
  amber: {
    icon: "text-amber-600",
    selected:
      "border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 text-amber-700 shadow-amber-100",
  },
  orange: {
    icon: "text-orange-600",
    selected:
      "border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 text-orange-700 shadow-orange-100",
  },
  purple: {
    icon: "text-purple-600",
    selected:
      "border-purple-200 bg-gradient-to-br from-purple-50 to-fuchsia-50 text-purple-700 shadow-purple-100",
  },
  red: {
    icon: "text-red-600",
    selected:
      "border-red-200 bg-gradient-to-br from-red-50 to-rose-50 text-red-700 shadow-red-100",
  },
  rose: {
    icon: "text-rose-600",
    selected:
      "border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 text-rose-700 shadow-rose-100",
  },
  slate: {
    icon: "text-slate-600",
    selected:
      "border-slate-300 bg-gradient-to-br from-slate-100 to-slate-50 text-slate-700 shadow-slate-100",
  },
  violet: {
    icon: "text-violet-600",
    selected:
      "border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50 text-violet-700 shadow-violet-100",
  },
};

export const DEFAULT_CATEGORY_CHIP_TONE = CATEGORY_CHIP_TONE_STYLES.slate;
