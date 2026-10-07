// src/components/ui/Textarea.jsx
import React from "react";

const Textarea = React.forwardRef(({ className = "", rows = 4, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={`
      w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm leading-[22px] text-slate-700 outline-none transition
      placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20
      disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400
      ${className}
    `}
    {...props}
  />
));

Textarea.displayName = "Textarea";

export default Textarea;
