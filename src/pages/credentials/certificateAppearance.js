const TONE_STYLES = {
  slate: {
    shell: "border-slate-200 bg-white",
    panel: "border-slate-200 bg-slate-50/80",
    stripe: "from-slate-400 via-slate-300 to-slate-200",
    icon: "bg-slate-100 text-slate-600",
    accent: "text-slate-700",
  },
  blue: {
    shell: "border-blue-200 bg-white",
    panel: "border-blue-100 bg-blue-50/50",
    stripe: "from-blue-600 via-indigo-500 to-sky-400",
    icon: "bg-blue-100 text-blue-700",
    accent: "text-blue-700",
  },
  indigo: {
    shell: "border-indigo-200 bg-white",
    panel: "border-indigo-100 bg-indigo-50/50",
    stripe: "from-indigo-600 via-violet-500 to-blue-400",
    icon: "bg-indigo-100 text-indigo-700",
    accent: "text-indigo-700",
  },
  emerald: {
    shell: "border-emerald-200 bg-white",
    panel: "border-emerald-100 bg-emerald-50/50",
    stripe: "from-emerald-600 via-teal-500 to-green-400",
    icon: "bg-emerald-100 text-emerald-700",
    accent: "text-emerald-700",
  },
  violet: {
    shell: "border-violet-200 bg-white",
    panel: "border-violet-100 bg-violet-50/50",
    stripe: "from-violet-600 via-purple-500 to-fuchsia-400",
    icon: "bg-violet-100 text-violet-700",
    accent: "text-violet-700",
  },
  amber: {
    shell: "border-amber-200 bg-white",
    panel: "border-amber-100 bg-amber-50/50",
    stripe: "from-amber-500 via-orange-400 to-yellow-300",
    icon: "bg-amber-100 text-amber-700",
    accent: "text-amber-700",
  },
};

export function getCertificateAppearance(item = {}, { locked = false, status } = {}) {
  const tone = locked ? "slate" : item.gradeTone || item.categoryColorKey || "blue";
  const style = TONE_STYLES[tone] || TONE_STYLES.blue;

  return {
    ...style,
    tone,
    state: locked ? "locked" : item.isRevoked ? "revoked" : status?.label || "active",
  };
}

export function getCertificateStateLabel(item = {}, { locked = false, status } = {}) {
  if (locked) return "미발급";
  if (item.isRevoked) return "회수됨";
  return status?.label || "보유 중";
}

const LICENSE_TONES = {
  slate: {
    surface: "from-slate-50 via-white to-slate-100",
    rail: "from-slate-700 via-slate-600 to-slate-500",
    crest: "border-slate-300 bg-slate-100 text-slate-700",
    ink: "text-slate-800",
    watermark: "text-slate-300/40",
  },
  blue: {
    surface: "from-sky-50 via-white to-blue-100",
    rail: "from-blue-700 via-blue-600 to-cyan-500",
    crest: "border-blue-200 bg-blue-100 text-blue-700",
    ink: "text-blue-950",
    watermark: "text-blue-300/35",
  },
  indigo: {
    surface: "from-indigo-50 via-white to-violet-100",
    rail: "from-indigo-800 via-violet-600 to-fuchsia-500",
    crest: "border-indigo-200 bg-indigo-100 text-indigo-700",
    ink: "text-indigo-950",
    watermark: "text-indigo-300/35",
  },
  emerald: {
    surface: "from-emerald-50 via-white to-teal-100",
    rail: "from-emerald-800 via-teal-600 to-cyan-500",
    crest: "border-emerald-200 bg-emerald-100 text-emerald-700",
    ink: "text-emerald-950",
    watermark: "text-emerald-300/35",
  },
  violet: {
    surface: "from-violet-50 via-white to-fuchsia-100",
    rail: "from-violet-800 via-purple-600 to-pink-500",
    crest: "border-violet-200 bg-violet-100 text-violet-700",
    ink: "text-violet-950",
    watermark: "text-violet-300/35",
  },
  amber: {
    surface: "from-amber-50 via-white to-orange-100",
    rail: "from-amber-700 via-orange-500 to-yellow-400",
    crest: "border-amber-200 bg-amber-100 text-amber-800",
    ink: "text-amber-950",
    watermark: "text-amber-300/35",
  },
};

const STAGE_MATERIALS = {
  none: {
    label: "인증",
    seal: "border-slate-300 bg-slate-100 text-slate-600",
    rim: "ring-slate-200",
  },
  basic: {
    label: "기초",
    seal: "border-slate-300 bg-gradient-to-br from-white via-slate-100 to-slate-300 text-slate-700",
    rim: "ring-slate-300",
  },
  intermediate: {
    label: "중급",
    seal: "border-amber-300 bg-gradient-to-br from-yellow-50 via-amber-200 to-yellow-500 text-amber-900",
    rim: "ring-amber-300",
  },
  advanced: {
    label: "고급",
    seal: "border-violet-300 bg-gradient-to-br from-cyan-100 via-violet-200 to-rose-200 text-violet-900",
    rim: "ring-violet-300",
  },
};

export function getCertificateLicenseTone(item = {}, { locked = false } = {}) {
  const tone = locked ? "slate" : item.categoryColorKey || item.gradeTone || "blue";
  return { tone, ...(LICENSE_TONES[tone] || LICENSE_TONES.blue) };
}

export function getCertificateStageMaterial(item = {}) {
  const value = String(item.gradeId || item.gradeValue || item.gradeLabel || "")
    .trim()
    .toLowerCase();

  if (!value || value === "none" || value.includes("없음")) return STAGE_MATERIALS.none;
  if (value === "advanced" || value.includes("고급") || value.includes("3단계")) return STAGE_MATERIALS.advanced;
  if (value === "intermediate" || value.includes("중급") || value.includes("2단계")) return STAGE_MATERIALS.intermediate;
  if (value === "basic" || value.includes("기초") || value.includes("1단계")) return STAGE_MATERIALS.basic;

  return { ...STAGE_MATERIALS.basic, label: item.gradeLabel || "단계" };
}

export function resolveCertificateClassName(classData, classId) {
  return classData?.className || classData?.name || classId || "우리 학급";
}
