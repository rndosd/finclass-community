export const CERTIFICATE_TEMPLATE_OPTIONS = [
  {
    value: "license",
    label: "라이선스 카드",
    description: "학생 보관함에서 여러 장을 보기 좋은 기본 카드형입니다.",
  },
  {
    value: "diploma",
    label: "공식 증서",
    description: "상장처럼 정식 발급 문서 느낌을 강조하는 템플릿입니다.",
  },
  {
    value: "achievement",
    label: "수료 배지",
    description: "활동 성취와 프로그램 수료를 강조하기 좋은 화사한 템플릿입니다.",
  },
];

const TEMPLATE_META = {
  license: {
    previewShell:
      "border-sky-200 bg-[linear-gradient(180deg,_#ffffff,_#eff6ff)]",
    previewPanel:
      "border-sky-200/80 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.18),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(239,246,255,0.9))]",
    previewIconWrap: "bg-sky-100 text-sky-700",
    previewStripe: "from-sky-500 via-blue-500 to-indigo-500",
    detailFrame: "border-[#d8e7fb] bg-[linear-gradient(180deg,_#f8fbff,_#eef5ff)]",
    detailSheet:
      "border-[#c9dcfb] bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.14),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(239,246,255,0.92))]",
    accentText: "text-sky-700/80",
  },
  diploma: {
    previewShell:
      "border-amber-200 bg-[linear-gradient(180deg,_#ffffff,_#fffbeb)]",
    previewPanel:
      "border-amber-200/80 bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.18),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(255,251,235,0.92))]",
    previewIconWrap: "bg-amber-100 text-amber-700",
    previewStripe: "from-amber-400 via-orange-400 to-rose-400",
    detailFrame: "border-[#ead7b0] bg-[linear-gradient(180deg,_#fffdf7,_#fff7e7)]",
    detailSheet:
      "border-[#d9c49c] bg-[radial-gradient(circle_at_top_right,_rgba(250,204,21,0.14),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.08),_transparent_30%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(255,251,235,0.92))]",
    accentText: "text-amber-700/80",
  },
  achievement: {
    previewShell:
      "border-violet-200 bg-[linear-gradient(180deg,_#ffffff,_#f5f3ff)]",
    previewPanel:
      "border-violet-200/80 bg-[radial-gradient(circle_at_top_right,_rgba(168,85,247,0.18),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(245,243,255,0.92))]",
    previewIconWrap: "bg-violet-100 text-violet-700",
    previewStripe: "from-fuchsia-500 via-violet-500 to-amber-400",
    detailFrame: "border-[#dfd2ff] bg-[linear-gradient(180deg,_#fcfbff,_#f6f1ff)]",
    detailSheet:
      "border-[#d5c5ff] bg-[radial-gradient(circle_at_top_right,_rgba(168,85,247,0.14),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(251,191,36,0.12),_transparent_30%),linear-gradient(180deg,_rgba(255,255,255,0.97),_rgba(245,243,255,0.92))]",
    accentText: "text-violet-700/80",
  },
};

export function getCertificateTemplateMeta(templateId = "license") {
  return TEMPLATE_META[templateId] || TEMPLATE_META.license;
}
