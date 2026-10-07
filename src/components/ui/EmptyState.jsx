import React from "react";
import { Inbox } from "lucide-react";

const cx = (...classes) => classes.filter(Boolean).join(" ");

const TONE_STYLES = {
  slate: "bg-white text-slate-500 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  red: "bg-red-50 text-red-700 ring-red-100",
};

const SIZE_STYLES = {
  sm: {
    container: "min-h-[160px] px-5 py-8",
    icon: "h-10 w-10 rounded-xl",
    iconSvg: "h-4 w-4",
    title: "mt-3 text-sm",
    description: "mt-1 text-sm",
  },
  md: {
    container: "min-h-[220px] px-6 py-10",
    icon: "h-12 w-12 rounded-2xl",
    iconSvg: "h-5 w-5",
    title: "mt-4 text-sm",
    description: "mt-1 text-sm",
  },
};

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actions,
  children,
  tone = "slate",
  size = "md",
  className = "",
}) {
  const sizeStyle = SIZE_STYLES[size] || SIZE_STYLES.md;
  const toneStyle = TONE_STYLES[tone] || TONE_STYLES.slate;

  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 text-center",
        sizeStyle.container,
        className,
      )}
    >
      <div
        className={cx(
          "flex items-center justify-center shadow-sm ring-1",
          sizeStyle.icon,
          toneStyle,
        )}
      >
        <Icon className={sizeStyle.iconSvg} strokeWidth={2.4} />
      </div>
      {title ? (
        <h3 className={cx("font-bold text-slate-900", sizeStyle.title)}>
          {title}
        </h3>
      ) : null}
      {description ? (
        <p
          className={cx(
            "max-w-sm leading-6 text-slate-500",
            sizeStyle.description,
          )}
        >
          {description}
        </p>
      ) : null}
      {children ? <div className="mt-4 w-full max-w-sm">{children}</div> : null}
      {actions ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
