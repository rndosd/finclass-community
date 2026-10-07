import React from "react";
import { resolveUiTone } from "./toneStyles";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

// 🎨 보완된 컬러 맵핑
// Tailwind가 인식할 수 있도록 solidBg(진한 배경)를 명시적으로 선언했습니다.
const toneMap = {
  gray: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    ring: "ring-slate-500/10",
    solidBg: "bg-slate-600",
  },
  slate: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    ring: "ring-slate-500/10",
    solidBg: "bg-slate-600",
  },
  zinc: {
    bg: "bg-zinc-200",
    text: "text-zinc-800",
    ring: "ring-zinc-600/20",
    solidBg: "bg-zinc-600",
  },

  blue: {
    bg: "bg-blue-100",
    text: "text-blue-800",
    ring: "ring-blue-700/20",
    solidBg: "bg-blue-600",
  },
  indigo: {
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    ring: "ring-indigo-700/10",
    solidBg: "bg-indigo-600",
  },
  sky: {
    bg: "bg-sky-50",
    text: "text-sky-700",
    ring: "ring-sky-700/10",
    solidBg: "bg-sky-600",
  },

  emerald: {
    bg: "bg-emerald-100",
    text: "text-emerald-800",
    ring: "ring-emerald-600/20",
    solidBg: "bg-emerald-700",
  },
  green: {
    bg: "bg-green-50",
    text: "text-green-700",
    ring: "ring-green-600/20",
    solidBg: "bg-green-600",
  },
  lime: {
    bg: "bg-lime-100",
    text: "text-lime-800",
    ring: "ring-lime-600/20",
    solidBg: "bg-lime-600",
  },

  teal: {
    bg: "bg-teal-50",
    text: "text-teal-700",
    ring: "ring-teal-600/10",
    solidBg: "bg-teal-600",
  },
  cyan: {
    bg: "bg-cyan-100/50",
    text: "text-cyan-800",
    ring: "ring-cyan-600/20",
    solidBg: "bg-cyan-600",
  },

  red: {
    bg: "bg-red-50",
    text: "text-red-700",
    ring: "ring-red-600/10",
    solidBg: "bg-red-600",
  },
  rose: {
    bg: "bg-rose-100",
    text: "text-rose-800",
    ring: "ring-rose-600/20",
    solidBg: "bg-rose-600",
  },
  pink: {
    bg: "bg-pink-50",
    text: "text-pink-700",
    ring: "ring-pink-700/10",
    solidBg: "bg-pink-600",
  },
  fuchsia: {
    bg: "bg-fuchsia-50",
    text: "text-fuchsia-700",
    ring: "ring-fuchsia-700/10",
    solidBg: "bg-fuchsia-600",
  },

  orange: {
    bg: "bg-orange-50",
    text: "text-orange-800",
    ring: "ring-orange-600/20",
    solidBg: "bg-orange-600",
  },
  amber: {
    bg: "bg-amber-100",
    text: "text-amber-800",
    ring: "ring-amber-600/30",
    solidBg: "bg-amber-200",
  },
  yellow: {
    bg: "bg-yellow-100/60",
    text: "text-yellow-900",
    ring: "ring-yellow-600/30",
    solidBg: "bg-yellow-700", // 노란색은 600하면 너무 어두워서 500 추천
  },

  purple: {
    bg: "bg-purple-50",
    text: "text-purple-700",
    ring: "ring-purple-700/10",
    solidBg: "bg-purple-600",
  },
  violet: {
    bg: "bg-violet-50",
    text: "text-violet-700",
    ring: "ring-violet-700/10",
    solidBg: "bg-violet-600",
  },

  brown: {
    bg: "bg-orange-100/40",
    text: "text-orange-900",
    ring: "ring-orange-800/20",
    solidBg: "bg-orange-700",
  },
};

const sizeMap = {
  sm: "px-2 py-0.5 text-xs",
  md: "min-h-7 px-2.5 py-1 text-[13px] leading-4",
  lg: "px-3 py-1.5 text-sm",
};

const Badge = ({
  children,
  color,
  tone,
  size = "md",
  variant = "soft",
  className = "",
  icon: Icon,
  pill = false,
  as = "span",
  ...rest
}) => {
  const requestedTone = color || tone;
  let finalToneKey = toneMap[requestedTone]
    ? requestedTone
    : resolveUiTone(requestedTone, "slate");

  if (!toneMap[finalToneKey]) {
    finalToneKey = "slate";
  }

  const t = toneMap[finalToneKey];
  const rounded = pill ? "rounded-full" : "rounded-lg";
  const interactive = typeof rest.onClick === "function";

  const base = cx(
    "inline-flex items-center justify-center font-bold gap-1.5",
    "whitespace-nowrap transition-all duration-200",
    rounded,
    sizeMap[size] || sizeMap.md,
    interactive && "cursor-pointer hover:opacity-80 active:scale-95",
  );

  const stylesByVariant = {
    // Soft: 연한 배경
    soft: cx(t.bg, t.text, "ring-1 ring-inset", t.ring),

    // Solid: 이제 replace를 쓰지 않고 명시된 solidBg를 사용합니다.
    solid: cx(
      t.solidBg || "bg-slate-600", // 안전장치 포함
      finalToneKey === "amber" ? "text-amber-950" : "text-white",
    ),

    // Outline: 테두리만 강조
    outline: cx(
      "bg-transparent",
      t.text,
      "ring-1 ring-inset",
      t.ring.replace("/10", "/40").replace("/20", "/50"),
    ),
  };

  const Component = as || "span";
  const currentStyle = variant === "status" ? (["slate", "gray", "zinc"].includes(finalToneKey) ? stylesByVariant.soft : stylesByVariant.solid) : stylesByVariant[variant] || stylesByVariant.soft;

  return (
    <Component className={cx(base, currentStyle, className)} {...rest}>
      {Icon && (
        <Icon className="w-3.5 h-3.5 opacity-100 -ml-0.5" aria-hidden="true" />
      )}
      {children}
    </Component>
  );
};

export default Badge;
