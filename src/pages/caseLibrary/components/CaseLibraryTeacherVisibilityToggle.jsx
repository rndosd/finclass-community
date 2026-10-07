import React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "../../../components/ui";

export default function CaseLibraryTeacherVisibilityToggle({
  teacherNamePublic = true,
  onChange,
  className = "",
}) {
  const Icon = teacherNamePublic ? Eye : EyeOff;
  const label = teacherNamePublic ? "공개" : "비공개";
  const title = teacherNamePublic ? "교사명 공개" : "교사명 비공개";

  return (
    <Button
      type="button"
      aria-label={title}
      title={title}
      onClick={() => onChange?.(!teacherNamePublic)}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${className} ${
        teacherNamePublic
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100"
          : "border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300 hover:bg-slate-200"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </Button>
  );
}
