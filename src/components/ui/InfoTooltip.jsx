import { HelpCircle } from "lucide-react";

import Tooltip from "./Tooltip";

export default function InfoTooltip({
  content,
  label = "도움말",
  position = "top",
  className = "",
}) {
  return (
    <Tooltip content={content} position={position}>
      <span>
        <button
          type="button"
          aria-label={label}
          onClick={(event) => event.preventDefault()}
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-700 ${className}`.trim()}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </span>
    </Tooltip>
  );
}
