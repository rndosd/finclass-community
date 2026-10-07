import {
  Award,
  BookOpen,
  Coins,
  Crown,
  Medal,
  Mic,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
} from "lucide-react";

export const DEFAULT_TITLE_STYLE = {
  version: 3,
  familyId: "plaque",
  paletteId: "sky",
  trimPaletteId: "silver",
  ornamentSetId: "none",
  icon: "none",
  fontStyleId: "basic",
  textScale: 100,
  textOffsetY: 0,
  textColorMode: "auto",
  customTextColor: "",
  customFrameColor: "",
  customBannerColor: "",
  customTrimColor: "",
  topDecoId: "none",
  sideDecoId: "none",
  bottomDecoId: "none",
  patternId: "none",
  effectId: "none",
};

export const TITLE_STYLE_FAMILY_OPTIONS = [
  {
    value: "plaque",
    label: "리본 명패",
    description: "가장 기본이 되는 리본형 명패입니다.",
  },
  {
    value: "wing",
    label: "왕관 날개",
    description: "상위 칭호나 리더형 칭호에 어울리는 날개형 프레임입니다.",
  },
  {
    value: "seal",
    label: "훈장 배지",
    description: "등급감과 상징성을 강조하기 좋은 훈장형 명패입니다.",
  },
  {
    value: "scroll",
    label: "두루마리",
    description: "문서, 기록, 연구형 칭호에 잘 어울리는 서사적인 프레임입니다.",
  },
  {
    value: "jewel",
    label: "보석 프레임",
    description: "빛나고 고급스러운 분위기를 주는 보석형 프레임입니다.",
  },
  {
    value: "ticket",
    label: "티켓 배지",
    description: "이벤트나 한정 과제 계열 칭호에 잘 맞는 특별한 프레임입니다.",
  },
  {
    value: "blossom",
    label: "꽃결 명패",
    description: "부드럽고 화사한 분위기의 칭호에 어울리는 장식형 명패입니다.",
  },
  {
    value: "shield",
    label: "방패 명패",
    description: "단단하고 중심이 잡힌 인상을 주는 방패형 프레임입니다.",
  },
  {
    value: "arc",
    label: "아치 명패",
    description: "상단이 부드럽게 열린 아치형 실루엣으로 전시 느낌을 살립니다.",
  },
  {
    value: "marquee",
    label: "마키 명패",
    description: "무대 간판처럼 양쪽 포인트가 살아 있는 화려한 프레임입니다.",
  },
];

export const TITLE_STYLE_PALETTE_OPTIONS = [
  { value: "sapphire", label: "사파이어", tone: "blue", group: "base" },
  { value: "sky", label: "하늘빛", tone: "blue", group: "base" },
  { value: "emerald", label: "에메랄드", tone: "emerald", group: "base" },
  { value: "teal", label: "틸", tone: "emerald", group: "base" },
  { value: "ruby", label: "루비", tone: "red", group: "base" },
  { value: "rose", label: "로즈 코랄", tone: "red", group: "base" },
  { value: "amethyst", label: "아메시스트", tone: "violet", group: "base" },
  { value: "magenta", label: "마젠타", tone: "violet", group: "base" },
  { value: "amber", label: "앰버", tone: "amber", group: "base" },
  { value: "sunset", label: "선셋 오렌지", tone: "amber", group: "base" },
  { value: "ivory", label: "레디언트 아이보리", tone: "amber", group: "base" },
  { value: "slate", label: "아이언 슬레이트", tone: "slate", group: "base" },
  { value: "lime", label: "라임 그린", tone: "emerald", group: "base" },
  { value: "deep-red", label: "딥 레드", tone: "red", group: "base" },
  { value: "charcoal", label: "차콜", tone: "slate", group: "base" },
  { value: "vip-champagne", label: "VIP 샴페인", tone: "amber", group: "base" },
  { value: "legendary-ember", label: "전설 엠버", tone: "amber", group: "base" },
  { value: "aurora-violet", label: "오로라 바이올렛", tone: "violet", group: "base" },
];

export const TITLE_STYLE_BORDER_OPTIONS = [
  {
    value: "silver",
    label: "새틴 실버",
    description: "밝은 하이라이트를 절제한 기본 은빛 테두리",
    tone: "slate",
  },
  {
    value: "gold",
    label: "샴페인 골드",
    description: "앤틱하지 않고 깨끗한 따뜻한 금빛 테두리",
    tone: "amber",
  },
  {
    value: "bronze",
    label: "로즈 브론즈",
    description: "깨끗한 따뜻한 구리빛 금속 테두리",
    tone: "rose",
  },
];

export const TITLE_STYLE_FONT_OPTIONS = [
  {
    value: "basic",
    label: "명패 기본",
    description: "직접 색상 지정 가능 · 읽기 쉬운 글자와 얇은 테두리로 프레임에 자연스럽게 맞춥니다.",
    supportsCustomTextColor: true,
  },
  {
    value: "outline",
    label: "윤곽 강조",
    description: "직접 색상 지정 가능 · 굵은 외곽선과 또렷한 그림자로 배경 위에서 선명하게 보입니다.",
    supportsCustomTextColor: true,
    stylePreset: "outline",
  },
  {
    value: "premium",
    label: "금속 각인",
    description: "자동 색상 프리셋 · 금속과 배경에 맞춰 반사 효과를 자동 적용합니다.",
    supportsCustomTextColor: false,
    stylePreset: "metal",
  },
  {
    value: "crystal-glow",
    label: "수정 광택",
    description: "자동 색상 프리셋 · 보석처럼 맑은 빛과 은은한 광택을 적용합니다.",
    supportsCustomTextColor: false,
    stylePreset: "crystal",
  },
  {
    value: "royal-emboss",
    label: "왕실 엠보싱",
    description: "자동 색상 프리셋 · 격식 있는 명조체와 입체 음영으로 품위를 더합니다.",
    supportsCustomTextColor: false,
    stylePreset: "emboss",
  },
  {
    value: "ink-stamp",
    label: "잉크 인장",
    description: "자동 색상 프리셋 · 매트한 대비와 묵직한 인장 느낌을 적용합니다.",
    supportsCustomTextColor: false,
    stylePreset: "stamp",
  },
];

export function getTitleStyleFontOption(fontStyleId = "basic") {
  return (
    TITLE_STYLE_FONT_OPTIONS.find((item) => item.value === fontStyleId) ||
    TITLE_STYLE_FONT_OPTIONS[0]
  );
}

export const TITLE_STYLE_TEXT_COLOR_MODE_OPTIONS = [
  {
    value: "auto",
    label: "자동 추천",
    description: "배경 밝기에 맞춰 가장 잘 읽히는 색을 자동 적용",
  },
  {
    value: "custom",
    label: "직접 설정",
    description: "원하는 글자색을 직접 지정",
  },
];

const CREDIT_TIER_PALETTE_PREFIX = "credit-tier:";

export const TITLE_STYLE_TRIM_OPTIONS = [
  { value: "match", label: "기본 테두리", tone: "slate" },
  { value: "gold", label: "황금 금속", tone: "amber" },
  { value: "silver", label: "은빛 금속", tone: "slate" },
  { value: "pearl", label: "진주빛", tone: "sky" },
  { value: "midnight", label: "딥 네이비", tone: "indigo" },
  { value: "rose-gold", label: "로즈 골드", tone: "rose" },
  { value: "mint-silver", label: "민트 실버", tone: "emerald" },
];

export const TITLE_STYLE_ICON_OPTIONS = [
  { value: "none", label: "없음", icon: null },
  { value: "award", label: "상장", icon: Award },
  { value: "crown", label: "왕관", icon: Crown },
  { value: "medal", label: "메달", icon: Medal },
  { value: "sparkles", label: "반짝", icon: Sparkles },
  { value: "shield", label: "방패", icon: ShieldCheck },
  { value: "star", label: "별", icon: Star },
  { value: "book", label: "책", icon: BookOpen },
  { value: "coins", label: "동전", icon: Coins },
  { value: "trend", label: "그래프", icon: TrendingUp },
  { value: "mic", label: "마이크", icon: Mic },
];

export const TITLE_STYLE_TOP_DECO_OPTIONS = [
  { value: "none", label: "없음", description: "상단 장식 없이 깔끔하게 보여줍니다." },
  { value: "crown-top", label: "왕관", description: "대표 칭호나 특별 칭호에 어울리는 상단 왕관 장식입니다." },
  { value: "laurel-top", label: "월계수", description: "성실함과 성장을 표현하기 좋은 월계수 장식입니다." },
  { value: "crystal-top", label: "보석 장식", description: "반짝임을 더해 주는 작은 보석 장식입니다." },
  { value: "star-top", label: "별 무리", description: "명패 윗부분에 별빛이 떠 있는 느낌을 줍니다." },
  { value: "bow-top", label: "리본 매듭", description: "부드럽고 사랑스러운 분위기를 더하는 매듭 장식입니다." },
  { value: "crest-top", label: "문장 패널", description: "가운데에 금속 문장을 올려 기사 배지 같은 느낌을 줍니다." },
  { value: "halo-top", label: "보주 헤일로", description: "작은 보주와 원형 고리가 떠 있는 고급 장식입니다." },
  {
    value: "tiara-top",
    label: "\uD2F0\uC544\uB77C",
    description: "\uC911\uC559 \uBCF4\uC11D\uACFC \uC120\uC744 \uAC15\uC870\uD55C \uC6B0\uC544\uD55C \uC0C1\uB2E8 \uC7A5\uC2DD\uC785\uB2C8\uB2E4.",
  },
  {
    value: "sunburst-top",
    label: "\uC120\uBC84\uC2A4\uD2B8",
    description: "\uBA85\uD328 \uC704\uCABD\uC73C\uB85C \uD37C\uC9C0\uB294 \uAD11\uC120\uC774 \uB354 \uD654\uB824\uD55C \uC874\uC7AC\uAC10\uC744 \uB9CC\uB4ED\uB2C8\uB2E4.",
  },
  {
    value: "feather-top",
    label: "\uAE43\uC7A5\uC2DD",
    description: "\uBD80\uB4DC\uB7FD\uACE0 \uC138\uB828\uB41C \uD750\uB984\uC744 \uC8FC\uB294 \uAE43\uD138 \uBB34\uB4DC\uC758 \uC0C1\uB2E8 \uC7A5\uC2DD\uC785\uB2C8\uB2E4.",
  },
];

export const TITLE_STYLE_SIDE_DECO_OPTIONS = [
  { value: "none", label: "없음", description: "옆 장식 없이 프레임만 또렷하게 보여줍니다." },
  { value: "gems-side", label: "보석", description: "끝부분에 보석 장식이 들어가 반짝이는 느낌을 줍니다." },
  { value: "leaf-side", label: "잎사귀", description: "따뜻하고 성장형 분위기를 만드는 잎사귀 장식입니다." },
  { value: "star-side", label: "별 장식", description: "양쪽에 작은 별이 달린 게임형 장식입니다." },
  { value: "wing-side", label: "날개", description: "특별한 칭호에 어울리는 날개 장식입니다." },
  { value: "flag-side", label: "깃발", description: "도전, 이벤트, 과제형 칭호에 잘 어울리는 깃발 장식입니다." },
  { value: "guard-side", label: "금속 가드", description: "프레임 끝을 감싸는 브래킷형 금속 장식입니다." },
  { value: "orb-side", label: "오브 링", description: "양끝에 둥근 보주와 링이 연결된 장식입니다." },
  {
    value: "chain-side",
    label: "\uCCB4\uC778",
    description: "\uC591\uCABD\uC5D0 \uAE08\uC18D \uCCB4\uC778\uC774 \uAC78\uB9B0 \uB4EF\uD55C \uBB35\uC9C1\uD55C \uC7A5\uC2DD\uC785\uB2C8\uB2E4.",
  },
  {
    value: "flame-side",
    label: "\uBD88\uAF43",
    description: "\uB0A0\uCE74\uB86D\uACE0 \uC0B4\uC9DD \uB5A0\uC624\uB974\uB294 \uBD88\uAF43 \uB77C\uC778\uC73C\uB85C \uAC15\uD55C \uC778\uC0C1\uC744 \uC90D\uB2C8\uB2E4.",
  },
  {
    value: "rune-side",
    label: "\uB8EC\uD328\uB110",
    description: "\uC791\uC740 \uBB38\uC591 \uD328\uB110\uC774 \uC606\uC5D0 \uBD99\uB294 \uC2E0\uBE44\uB85C\uC6B4 \uC2A4\uD0C0\uC77C\uC785\uB2C8\uB2E4.",
  },
];

export const TITLE_STYLE_BOTTOM_DECO_OPTIONS = [
  { value: "none", label: "없음", description: "아래 장식 없이 깔끔한 실루엣을 유지합니다." },
  { value: "ribbon-tail", label: "리본 꼬리", description: "명패 아래쪽에 리본 꼬리가 달린 형태입니다." },
  { value: "medal-drop", label: "메달 장식", description: "중앙 아래에 메달이 매달리는 구성을 만듭니다." },
  { value: "cloud-bottom", label: "구름", description: "포근하고 귀여운 분위기를 주는 구름 장식입니다." },
  { value: "comet-bottom", label: "별꼬리", description: "속도감과 반짝임을 강조하는 꼬리 장식입니다." },
  { value: "knot-bottom", label: "리본 매듭", description: "아래쪽에 작은 매듭을 더해 균형을 맞춥니다." },
  {
    value: "gem-drop",
    label: "\uBCF4\uC11D\uB4DC\uB86D",
    description: "\uC544\uB798\uB85C \uB9E4\uB2EC\uB9B0 \uBCF4\uC11D \uC7A5\uC2DD\uC774 \uBA85\uD328\uC5D0 \uBB34\uAC8C\uAC10\uC744 \uB354\uD569\uB2C8\uB2E4.",
  },
  {
    value: "feather-bottom",
    label: "\uAE43\uB9AC\uBCF8",
    description: "\uB9AC\uBCF8\uACFC \uAE43\uD138\uC744 \uC12D\uC5B4 \uBD80\uB4DC\uB7FD\uACE0 \uAE38\uAC8C \uD758\uB7EC\uB0B4\uB9AC\uB294 \uD558\uB2E8 \uC7A5\uC2DD\uC785\uB2C8\uB2E4.",
  },
  {
    value: "scroll-tail",
    label: "\uB450\uB8E8\uB9C8\uB9AC",
    description: "\uB9D0\uB824 \uC788\uB294 \uB450\uB8E8\uB9C8\uB9AC \uC2A4\uD06C\uB864\uC774 \uAE30\uB85D\uBB3C \uAC19\uC740 \uB290\uB08C\uC744 \uC8FC\uB294 \uD615\uD0DC\uC785\uB2C8\uB2E4.",
  },
];

export const TITLE_STYLE_PATTERN_OPTIONS = [
  { value: "none", label: "없음", description: "안쪽 배경 무늬 없이 텍스트를 또렷하게 보여줍니다." },
  { value: "stripe", label: "사선 줄무늬", description: "배너에 날렵한 리본 질감을 더합니다." },
  { value: "diamond", label: "마름모", description: "게임 업적 배지 같은 촘촘한 무늬를 더합니다." },
  { value: "dot", label: "반짝 점", description: "작은 점 장식으로 발랄한 느낌을 줍니다." },
  { value: "sparkle", label: "별빛", description: "안쪽에 별빛 패턴을 더해 특별함을 살립니다." },
  {
    value: "chevron",
    label: "\uC170\uBE0C\uB860",
    description: "\uBC18\uBCF5\uB418\uB294 V\uC790 \uB77C\uC778\uC73C\uB85C \uB9AC\uB4EC\uAC10 \uC788\uB294 \uBB34\uB4DC\uB97C \uB9CC\uB4ED\uB2C8\uB2E4.",
  },
  {
    value: "lattice",
    label: "\uACA9\uC790",
    description: "\uC131\uAE00\uACE0 \uC815\uB9AC\uB41C \uACA9\uC790 \uD328\uD134\uC73C\uB85C \uD14C\uB9C8\uB97C \uC548\uC815\uAC10 \uC788\uAC8C \uC7A1\uC544\uC90D\uB2C8\uB2E4.",
  },
  {
    value: "wave",
    label: "\uBB3C\uACB0",
    description: "\uBD80\uB4DC\uB7FD\uAC8C \uD750\uB974\uB294 \uBB3C\uACB0 \uB77C\uC778\uC73C\uB85C \uD654\uB824\uD558\uC9C0\uB9CC \uACFC\uD558\uC9C0 \uC54A\uAC8C \uB9C8\uBB34\uB9AC\uD569\uB2C8\uB2E4.",
  },
];

export const TITLE_STYLE_EFFECT_OPTIONS = [
  { value: "none", label: "없음", description: "빛나는 효과 없이 단정하게 보여줍니다." },
  { value: "soft-glow", label: "은은한 빛", description: "명패 주변에 부드러운 광택을 더합니다." },
  { value: "aura", label: "오라", description: "명패 바깥쪽에 고급스러운 빛의 고리를 더합니다." },
  { value: "spark-burst", label: "반짝 폭발", description: "포인트 별빛이 튀는 축하 효과입니다." },
  { value: "celebration", label: "축하 파티클", description: "작은 반짝 점과 축하 파티클이 떠다닙니다." },
  {
    value: "prism",
    label: "\uD504\uB9AC\uC998",
    description: "\uC0C9\uC774 \uACB9\uCCD0 \uBE44\uCE58\uB294 \uC5F7\uAC01 \uD558\uC77C\uB77C\uC774\uD2B8\uAC00 \uB9E4\uB07C\uD558\uAC8C \uD750\uB985\uB2C8\uB2E4.",
  },
  {
    value: "royal-ray",
    label: "\uAD11\uC120",
    description: "\uC911\uC559\uC5D0\uC11C \uBC14\uAE65\uC73C\uB85C \uB384\uC5B4 \uB098\uAC00\uB294 \uAD11\uC120\uC73C\uB85C \uB300\uD45C\uAC10\uC744 \uB192\uC5EC\uC90D\uB2C8\uB2E4.",
  },
  {
    value: "snowfall",
    label: "\uB208\uAF43",
    description: "\uC791\uC740 \uBE5B \uC785\uC790\uAC00 \uD769\uBFD4\uB824 \uB5A0 \uC788\uB294 \uB4EF\uD55C \uCC28\uBD84\uD55C \uD6A8\uACFC\uC785\uB2C8\uB2E4.",
  },
];

export const TITLE_STYLE_PRESETS = [
  {
    id: "starter-ribbon",
    label: "시작 리본",
    description: "가볍고 친근한 기본형 명패입니다.",
    familyId: "plaque",
    paletteId: "sky",
    trimPaletteId: "silver",
    iconId: "medal",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  },
  {
    id: "growth-ribbon",
    label: "성장 리본",
    description: "성실함과 꾸준함을 표현하기 좋은 명패입니다.",
    familyId: "plaque",
    paletteId: "emerald",
    trimPaletteId: "silver",
    iconId: "sparkles",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  },
  {
    id: "royal-crown",
    label: "왕관 날개",
    description: "특별 칭호에 잘 어울리는 화려한 프레임입니다.",
    familyId: "wing",
    paletteId: "royal",
    trimPaletteId: "silver",
    iconId: "crown",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  },
  {
    id: "rose-speaker",
    label: "발표 스타",
    description: "발표, 리더십, 도전 칭호에 어울리는 명패입니다.",
    familyId: "wing",
    paletteId: "rose",
    trimPaletteId: "silver",
    iconId: "mic",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  },
  {
    id: "seal-badge",
    label: "훈장 배지",
    description: "업적을 강조하는 훈장형 명패입니다.",
    familyId: "seal",
    paletteId: "sky",
    trimPaletteId: "silver",
    iconId: "award",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  },
  {
    id: "seal-legend",
    label: "전설 훈장",
    description: "레전드 칭호에 어울리는 진한 훈장형 명패입니다.",
    familyId: "seal",
    paletteId: "violet",
    trimPaletteId: "silver",
    iconId: "shield",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  },
  {
    id: "story-scroll",
    label: "이야기 두루마리",
    description: "독서나 기록형 칭호에 잘 어울리는 프레임입니다.",
    familyId: "scroll",
    paletteId: "sunset",
    trimPaletteId: "silver",
    iconId: "book",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  },
  {
    id: "jewel-investor",
    label: "보석 투자자",
    description: "빛나는 목표형 칭호에 어울리는 고급 프레임입니다.",
    familyId: "jewel",
    paletteId: "royal",
    trimPaletteId: "silver",
    iconId: "trend",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  },
  {
    id: "sky-ticket",
    label: "찬란한 초대장",
    description: "이벤트, 보상, 도전형 칭호에 어울리는 티켓 명패입니다.",
    familyId: "ticket",
    paletteId: "sky",
    trimPaletteId: "silver",
    iconId: "star",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  },
  {
    id: "blossom-reader",
    label: "꽃별 독서가",
    description: "부드럽고 귀여운 분위기의 독서형 명패입니다.",
    familyId: "blossom",
    paletteId: "rose",
    trimPaletteId: "silver",
    iconId: "book",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  },
  {
    id: "guardian-crest",
    label: "수호 문장",
    description: "단단한 기사 배지 느낌의 금속형 명패입니다.",
    familyId: "seal",
    paletteId: "royal",
    trimPaletteId: "silver",
    iconId: "shield",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  },
  {
    id: "orbit-ribbon",
    label: "오브 리본",
    description: "작은 보주 장식이 떠 있는 신비로운 리본형 명패입니다.",
    familyId: "plaque",
    paletteId: "violet",
    trimPaletteId: "silver",
    iconId: "star",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  },
];

function normalizeHexColor(value = "") {
  if (typeof value !== "string") return "";

  const trimmed = value.trim().replace("#", "");
  if (!trimmed) return "";
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(trimmed)) return "";

  const normalized =
    trimmed.length === 3
      ? trimmed
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : trimmed;

  return `#${normalized.toLowerCase()}`;
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;

  const value = normalized.slice(1);
  const int = Number.parseInt(value, 16);
  if (Number.isNaN(int)) return null;

  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex({ r, g, b }) {
  const toHex = (channel) => clampChannel(channel).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixHex(baseHex, targetHex, amount = 0.5) {
  const base = hexToRgb(baseHex);
  const target = hexToRgb(targetHex);
  if (!base) return normalizeHexColor(targetHex) || "";
  if (!target) return normalizeHexColor(baseHex) || "";

  const ratio = Math.max(0, Math.min(1, amount));
  return rgbToHex({
    r: base.r + (target.r - base.r) * ratio,
    g: base.g + (target.g - base.g) * ratio,
    b: base.b + (target.b - base.b) * ratio,
  });
}

function lightenHex(hex, amount = 0.5) {
  return mixHex(hex, "#ffffff", amount);
}

function darkenHex(hex, amount = 0.5) {
  return mixHex(hex, "#000000", amount);
}

function toShadowColor(hex, alpha = 0.24) {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(15,23,42,${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function getReadableTextColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#0f172a";
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance >= 0.62 ? "#0f172a" : "#ffffff";
}

function applyPaletteOverrides(palette, overrides = {}) {
  const frameColor = normalizeHexColor(overrides.customFrameColor);
  const bannerColor = normalizeHexColor(overrides.customBannerColor);
  const accentColor = bannerColor || frameColor;
  let next = { ...palette };

  if (frameColor) {
    next = {
      ...next,
      outerStart: lightenHex(frameColor, 0.84),
      outerMid: lightenHex(frameColor, 0.3),
      outerEnd: darkenHex(frameColor, 0.08),
      stroke: darkenHex(frameColor, 0.16),
      deepStroke: darkenHex(frameColor, 0.36),
      gemLight: lightenHex(frameColor, 0.62),
      gemDark: darkenHex(frameColor, 0.04),
      shadow: toShadowColor(darkenHex(frameColor, 0.42), 0.24),
    };
  }

  if (bannerColor) {
    next = {
      ...next,
      bannerStart: darkenHex(bannerColor, 0.24),
      bannerMid: bannerColor,
      bannerEnd: darkenHex(bannerColor, 0.24),
      bannerHighlight: lightenHex(bannerColor, 0.7),
      bannerText: getReadableTextColor(bannerColor),
      badgeStroke: lightenHex(bannerColor, 0.56),
      badgeText: darkenHex(bannerColor, 0.26),
      sparkle: lightenHex(bannerColor, 0.88),
    };
  }

  if (accentColor) {
    next = {
      ...next,
      trimLight: lightenHex(accentColor, 0.84),
      trimMid: lightenHex(accentColor, 0.34),
      trimDark: darkenHex(accentColor, 0.14),
    };
  }

  return next;
}

function applyTrimOverrides(trim, trimColor = "") {
  const normalized = normalizeHexColor(trimColor);
  if (!normalized) return trim;

  return {
    ...trim,
    light: lightenHex(normalized, 0.84),
    mid: lightenHex(normalized, 0.32),
    dark: darkenHex(normalized, 0.12),
    edge: darkenHex(normalized, 0.32),
    badgeFill: lightenHex(normalized, 0.93),
    badgeStroke: lightenHex(normalized, 0.62),
    badgeText: darkenHex(normalized, 0.24),
    capLight: lightenHex(normalized, 0.68),
    capDark: darkenHex(normalized, 0.02),
    shadow: toShadowColor(darkenHex(normalized, 0.36), 0.22),
  };
}

const TITLE_STYLE_PALETTE_MAP = {
  slate: {
    tone: "slate",
    outerStart: "#edf1f7",
    outerMid: "#a7b3c5",
    outerEnd: "#56657d",
    trimLight: "#fbfdff",
    trimMid: "#c3ccd9",
    trimDark: "#64748b",
    stroke: "#4b5a70",
    deepStroke: "#26344a",
    bannerStart: "#1d2940",
    bannerMid: "#34425c",
    bannerEnd: "#1d2940",
    bannerHighlight: "#aebbd0",
    bannerText: "#edf3fb",
    badgeFill: "#f8fafc",
    badgeStroke: "#cbd5e1",
    badgeText: "#475569",
    gemLight: "#dbe5f2",
    gemDark: "#52627b",
    sparkle: "#ffffff",
    shadow: "rgba(30,41,64,0.3)",
  },
  sky: {
    tone: "blue",
    outerStart: "#eef5ff",
    outerMid: "#b9dcff",
    outerEnd: "#5ea8ff",
    trimLight: "#f8fbff",
    trimMid: "#90c2ff",
    trimDark: "#2a68d6",
    stroke: "#2a68d6",
    deepStroke: "#15439b",
    bannerStart: "#1d4ed8",
    bannerMid: "#45b0ff",
    bannerEnd: "#1d4ed8",
    bannerHighlight: "#dff1ff",
    bannerText: "#103a86",
    badgeFill: "#ffffff",
    badgeStroke: "#c7dbff",
    badgeText: "#2558bf",
    gemLight: "#dff6ff",
    gemDark: "#54c4ff",
    sparkle: "#ffffff",
    shadow: "rgba(29,78,216,0.28)",
  },
  emerald: {
    tone: "emerald",
    outerStart: "#ecfff6",
    outerMid: "#9df0c6",
    outerEnd: "#1dbb7f",
    trimLight: "#f3fff9",
    trimMid: "#94e9c4",
    trimDark: "#0b8b60",
    stroke: "#0f8d63",
    deepStroke: "#056647",
    bannerStart: "#0c8a61",
    bannerMid: "#2fd9a0",
    bannerEnd: "#0c8a61",
    bannerHighlight: "#d9ffef",
    bannerText: "#0a5f43",
    badgeFill: "#ffffff",
    badgeStroke: "#b8f2d5",
    badgeText: "#0d7d58",
    gemLight: "#d7fff1",
    gemDark: "#2fd9a0",
    sparkle: "#ffffff",
    shadow: "rgba(13,125,88,0.28)",
  },
  royal: {
    tone: "amber",
    outerStart: "#fff7db",
    outerMid: "#ffd56c",
    outerEnd: "#d78812",
    trimLight: "#fffdf2",
    trimMid: "#ffe7a6",
    trimDark: "#b06f08",
    stroke: "#b06f08",
    deepStroke: "#6f3f05",
    bannerStart: "#8a3f08",
    bannerMid: "#d98b12",
    bannerEnd: "#8a3f08",
    bannerHighlight: "#ffe8a0",
    bannerText: "#6e3900",
    badgeFill: "#fff9ed",
    badgeStroke: "#ffd98b",
    badgeText: "#9e5b00",
    gemLight: "#fff0b5",
    gemDark: "#f8b400",
    sparkle: "#fff7de",
    shadow: "rgba(140,86,7,0.32)",
  },
  rose: {
    tone: "red",
    outerStart: "#fff0f4",
    outerMid: "#ffb8c6",
    outerEnd: "#f75b84",
    trimLight: "#fff7f9",
    trimMid: "#ffc7d2",
    trimDark: "#d82c59",
    stroke: "#d82c59",
    deepStroke: "#9f143f",
    bannerStart: "#d12351",
    bannerMid: "#ff6f91",
    bannerEnd: "#d12351",
    bannerHighlight: "#ffd8e1",
    bannerText: "#94173e",
    badgeFill: "#ffffff",
    badgeStroke: "#ffd1db",
    badgeText: "#c8214b",
    gemLight: "#ffe0e8",
    gemDark: "#ff7c9b",
    sparkle: "#fff8f9",
    shadow: "rgba(200,33,75,0.28)",
  },
  violet: {
    tone: "violet",
    outerStart: "#f5efff",
    outerMid: "#ccb0ff",
    outerEnd: "#7b48f7",
    trimLight: "#fbf8ff",
    trimMid: "#dbc9ff",
    trimDark: "#6f2deb",
    stroke: "#6f2deb",
    deepStroke: "#4d1aa9",
    bannerStart: "#6f2deb",
    bannerMid: "#9b6aff",
    bannerEnd: "#6f2deb",
    bannerHighlight: "#eadfff",
    bannerText: "#4a1fb1",
    badgeFill: "#ffffff",
    badgeStroke: "#e2d5ff",
    badgeText: "#6d2de6",
    gemLight: "#f0e8ff",
    gemDark: "#a77bff",
    sparkle: "#ffffff",
    shadow: "rgba(111,45,235,0.3)",
  },
  sunset: {
    tone: "amber",
    outerStart: "#fff0e4",
    outerMid: "#ffc08d",
    outerEnd: "#f17832",
    trimLight: "#fff7f1",
    trimMid: "#ffd4b2",
    trimDark: "#cc5c17",
    stroke: "#cc5c17",
    deepStroke: "#9c3d05",
    bannerStart: "#f06012",
    bannerMid: "#ff9652",
    bannerEnd: "#f06012",
    bannerHighlight: "#ffd1a7",
    bannerText: "#8f3602",
    badgeFill: "#ffffff",
    badgeStroke: "#ffd7bb",
    badgeText: "#c8510b",
    gemLight: "#ffe2c6",
    gemDark: "#ff9e5b",
    sparkle: "#fffaf2",
    shadow: "rgba(204,92,23,0.28)",
  },
  ivory: {
    tone: "amber",
    outerStart: "#fffdf7",
    outerMid: "#f4e9c8",
    outerEnd: "#d9c389",
    trimLight: "#ffffff",
    trimMid: "#e6edf5",
    trimDark: "#94a3b8",
    stroke: "#9aa9ba",
    deepStroke: "#64748b",
    bannerStart: "#e9dcc0",
    bannerMid: "#fffdf4",
    bannerEnd: "#e9dcc0",
    bannerHighlight: "#ffffff",
    bannerText: "#4b5563",
    badgeFill: "#ffffff",
    badgeStroke: "#e5d7b6",
    badgeText: "#6b5a37",
    gemLight: "#fff9e8",
    gemDark: "#d8b86a",
    sparkle: "#ffffff",
    shadow: "rgba(148,163,184,0.24)",
  },};

const TITLE_STYLE_TRIM_MAP = {
  gold: {
    light: "#fff8d9",
    mid: "#f7ca53",
    dark: "#9e6614",
    edge: "#7b4a05",
    badgeFill: "#fff9e9",
    badgeStroke: "#f2d27a",
    badgeText: "#8c5a06",
    capLight: "#ffe49a",
    capDark: "#cf9210",
    shadow: "rgba(158,102,20,0.26)",
  },
  silver: {
    light: "#fafcff",
    mid: "#cfd7e5",
    dark: "#7b8597",
    edge: "#5a6270",
    badgeFill: "#ffffff",
    badgeStroke: "#d7dde8",
    badgeText: "#5d6778",
    capLight: "#f3f6fb",
    capDark: "#aeb8ca",
    shadow: "rgba(90,98,112,0.22)",
  },
  bronze: {
    light: "#fff0e9",
    mid: "#d99a83",
    dark: "#9d5c4e",
    edge: "#6f3f38",
    badgeFill: "#fff8f5",
    badgeStroke: "#efc3b5",
    badgeText: "#864d40",
    capLight: "#ffd7c9",
    capDark: "#bd745f",
    shadow: "rgba(111,63,56,0.24)",
  },
  pearl: {
    light: "#fffdfb",
    mid: "#eadbcf",
    dark: "#b49687",
    edge: "#8d6d5e",
    badgeFill: "#fffdfb",
    badgeStroke: "#e8ddd6",
    badgeText: "#8a6f63",
    capLight: "#fff5ee",
    capDark: "#d8b4a0",
    shadow: "rgba(141,109,94,0.22)",
  },
  midnight: {
    light: "#dce4ff",
    mid: "#5c6eb1",
    dark: "#1b255d",
    edge: "#121942",
    badgeFill: "#eef2ff",
    badgeStroke: "#aebdfb",
    badgeText: "#28378c",
    capLight: "#8fa1e5",
    capDark: "#24306f",
    shadow: "rgba(18,25,66,0.28)",
  },
  "rose-gold": {
    light: "#fff2ea",
    mid: "#efb491",
    dark: "#be6b4e",
    edge: "#934733",
    badgeFill: "#fff8f3",
    badgeStroke: "#f1c8b4",
    badgeText: "#a3543f",
    capLight: "#ffd9c6",
    capDark: "#d98a69",
    shadow: "rgba(163,84,63,0.24)",
  },
  "mint-silver": {
    light: "#f3fffb",
    mid: "#bfe8db",
    dark: "#5d9688",
    edge: "#44766b",
    badgeFill: "#ffffff",
    badgeStroke: "#cde9e1",
    badgeText: "#41766b",
    capLight: "#e1fff6",
    capDark: "#86c7b5",
    shadow: "rgba(65,118,107,0.22)",
  },
};

function createCreditTierPaletteSpec(baseColor) {
  return {
    tone: "slate",
    outerStart: lightenHex(baseColor, 0.88),
    outerMid: lightenHex(baseColor, 0.48),
    outerEnd: darkenHex(baseColor, 0.04),
    trimLight: lightenHex(baseColor, 0.92),
    trimMid: lightenHex(baseColor, 0.38),
    trimDark: darkenHex(baseColor, 0.16),
    stroke: darkenHex(baseColor, 0.2),
    deepStroke: darkenHex(baseColor, 0.42),
    bannerStart: darkenHex(baseColor, 0.28),
    bannerMid: baseColor,
    bannerEnd: darkenHex(baseColor, 0.28),
    bannerHighlight: lightenHex(baseColor, 0.78),
    bannerText: getReadableTextColor(baseColor),
    badgeFill: lightenHex(baseColor, 0.94),
    badgeStroke: lightenHex(baseColor, 0.62),
    badgeText: darkenHex(baseColor, 0.22),
    gemLight: lightenHex(baseColor, 0.74),
    gemDark: darkenHex(baseColor, 0.05),
    sparkle: lightenHex(baseColor, 0.9),
    shadow: toShadowColor(darkenHex(baseColor, 0.42), 0.28),
  };
}

Object.assign(TITLE_STYLE_PALETTE_MAP, {
  sapphire: createCreditTierPaletteSpec("#2563eb"),
  teal: createCreditTierPaletteSpec("#14b8a6"),
  ruby: createCreditTierPaletteSpec("#c81e4a"),
  amethyst: createCreditTierPaletteSpec("#7c3aed"),
  magenta: createCreditTierPaletteSpec("#d946ef"),
  amber: createCreditTierPaletteSpec("#d97706"),
  lime: createCreditTierPaletteSpec("#84cc16"),
  "deep-red": createCreditTierPaletteSpec("#b91c1c"),
  charcoal: createCreditTierPaletteSpec("#1f2937"),
  "vip-champagne": createCreditTierPaletteSpec("#f6c453"),
  "legendary-ember": createCreditTierPaletteSpec("#f97316"),
  "aurora-violet": createCreditTierPaletteSpec("#8b5cf6"),
});

export function createCreditTierPaletteId(label = "", color = "") {
  const normalizedColor = normalizeHexColor(color);
  if (!normalizedColor) return "";

  const normalizedLabel = String(label || "").trim() || "신용등급";
  return `${CREDIT_TIER_PALETTE_PREFIX}${encodeURIComponent(normalizedLabel)}:${normalizedColor.slice(1)}`;
}

export function parseCreditTierPaletteId(paletteId = "") {
  if (typeof paletteId !== "string" || !paletteId.startsWith(CREDIT_TIER_PALETTE_PREFIX)) {
    return null;
  }

  const rawValue = paletteId.slice(CREDIT_TIER_PALETTE_PREFIX.length);
  const dividerIndex = rawValue.lastIndexOf(":");
  if (dividerIndex < 0) return null;

  const encodedLabel = rawValue.slice(0, dividerIndex);
  const normalizedColor = normalizeHexColor(`#${rawValue.slice(dividerIndex + 1)}`);
  if (!normalizedColor) return null;

  let label = "신용등급";
  if (encodedLabel) {
    try {
      label = decodeURIComponent(encodedLabel) || label;
    } catch {
      label = encodedLabel;
    }
  }

  return {
    value: paletteId,
    label: String(label || "신용등급").trim() || "신용등급",
    color: normalizedColor,
    tone: "slate",
  };
}

function createMatchTrimSpec(palette) {
  return {
    light: palette.trimLight,
    mid: palette.trimMid,
    dark: palette.trimDark,
    edge: palette.deepStroke,
    badgeFill: palette.badgeFill,
    badgeStroke: palette.badgeStroke,
    badgeText: palette.badgeText,
    capLight: palette.trimLight,
    capDark: palette.trimDark,
    shadow: palette.shadow,
  };
}

function normalizeTitleTextScale(value) {
  const legacyScaleMap = {
    small: 84,
    normal: 100,
    large: 116,
  };
  const numericValue = Number(legacyScaleMap[value] ?? value);
  return Number.isFinite(numericValue)
    ? Math.max(60, Math.min(150, Math.round(numericValue)))
    : DEFAULT_TITLE_STYLE.textScale;
}

function normalizeTitleTextOffsetY(value, legacyPosition) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return Math.max(-25, Math.min(25, Math.round(numericValue)));
  }

  if (legacyPosition === "top") return -7;
  if (legacyPosition === "bottom") return 7;
  return DEFAULT_TITLE_STYLE.textOffsetY;
}

export function normalizeTitleStyle(style = {}) {
  const normalizedIcon = style.icon ?? style.iconId ?? DEFAULT_TITLE_STYLE.icon;
  const hasStyleValues = Object.keys(style).length > 0;
  const isAssetStyle = Number(style.version) >= 3 || typeof style.ornamentSetId === "string";
  const fontStyleId = TITLE_STYLE_FONT_OPTIONS.some((item) => item.value === style.fontStyleId)
    ? style.fontStyleId
    : DEFAULT_TITLE_STYLE.fontStyleId;
  const supportsCustomTextColor = getTitleStyleFontOption(fontStyleId).supportsCustomTextColor !== false;

  return {
    ...DEFAULT_TITLE_STYLE,
    ...style,
    // Old saved styles retain their SVG decoration fields until a teacher
    // opens and saves them in the new designer. New styles always resolve to
    // the fixed asset pipeline and one frame-specific ornament set.
    version: isAssetStyle ? 3 : hasStyleValues ? 2 : DEFAULT_TITLE_STYLE.version,
    ornamentSetId: isAssetStyle && style.ornamentSetId ? String(style.ornamentSetId) : "none",
    icon: normalizedIcon || DEFAULT_TITLE_STYLE.icon,
    trimPaletteId: style.trimPaletteId || DEFAULT_TITLE_STYLE.trimPaletteId,
    fontStyleId,
    textScale: normalizeTitleTextScale(style.textScale),
    textOffsetY: normalizeTitleTextOffsetY(style.textOffsetY, style.textPosition),
    textColorMode:
      supportsCustomTextColor && style.textColorMode === "custom"
        ? "custom"
        : DEFAULT_TITLE_STYLE.textColorMode,
    customTextColor: supportsCustomTextColor ? normalizeHexColor(style.customTextColor || "") : "",
    customFrameColor: normalizeHexColor(style.customFrameColor || ""),
    customBannerColor: normalizeHexColor(style.customBannerColor || ""),
    customTrimColor: normalizeHexColor(style.customTrimColor || ""),
  };
}

export function getMatchedTitleStylePreset(style = {}) {
  const normalized = normalizeTitleStyle(style);

  return (
    TITLE_STYLE_PRESETS.find((item) => {
      const preset = normalizeTitleStyle({
        version: 3,
        familyId: item.familyId,
        paletteId: item.paletteId,
        trimPaletteId: item.trimPaletteId,
        ornamentSetId: item.ornamentSetId || "none",
        icon: item.iconId,
        fontStyleId: item.fontStyleId,
        textColorMode: item.textColorMode,
        customTextColor: item.customTextColor,
        topDecoId: item.topDecoId,
        sideDecoId: item.sideDecoId,
        bottomDecoId: item.bottomDecoId,
        patternId: item.patternId,
        effectId: item.effectId,
      });

      return (
        preset.familyId === normalized.familyId &&
        preset.paletteId === normalized.paletteId &&
        preset.trimPaletteId === normalized.trimPaletteId &&
        preset.icon === normalized.icon &&
        preset.fontStyleId === normalized.fontStyleId &&
        preset.textScale === normalized.textScale &&
        preset.textOffsetY === normalized.textOffsetY &&
        preset.textColorMode === normalized.textColorMode &&
        preset.customTextColor === normalized.customTextColor &&
        preset.customFrameColor === normalized.customFrameColor &&
        preset.customBannerColor === normalized.customBannerColor &&
        preset.customTrimColor === normalized.customTrimColor &&
        preset.ornamentSetId === normalized.ornamentSetId &&
        preset.topDecoId === normalized.topDecoId &&
        preset.sideDecoId === normalized.sideDecoId &&
        preset.bottomDecoId === normalized.bottomDecoId &&
        preset.patternId === normalized.patternId &&
        preset.effectId === normalized.effectId
      );
    }) || null
  );
}

export function getTitleStylePaletteLabel(paletteId = "sky", fallback = "하늘빛") {
  const creditTierPalette = parseCreditTierPaletteId(paletteId);
  if (creditTierPalette) {
    return creditTierPalette.label;
  }

  return TITLE_STYLE_PALETTE_OPTIONS.find((item) => item.value === paletteId)?.label || fallback;
}

export function getTitleStylePaletteSpec(paletteId = "sky", overrides = {}) {
  const creditTierPalette = parseCreditTierPaletteId(paletteId);
  const base = creditTierPalette
    ? createCreditTierPaletteSpec(creditTierPalette.color)
    : TITLE_STYLE_PALETTE_MAP[paletteId] || TITLE_STYLE_PALETTE_MAP.sky;
  return applyPaletteOverrides(base, overrides);
}

export function getTitleStyleTrimSpec(
  trimPaletteId = "match",
  paletteId = "sky",
  overrides = {},
) {
  const palette = getTitleStylePaletteSpec(paletteId, overrides);

  if (trimPaletteId === "match") {
    return applyTrimOverrides(createMatchTrimSpec(palette), overrides.customTrimColor);
  }

  return applyTrimOverrides(
    TITLE_STYLE_TRIM_MAP[trimPaletteId] || createMatchTrimSpec(palette),
    overrides.customTrimColor,
  );
}

export function getTitleStylePaletteClasses(paletteId = "sky", overrides = {}) {
  return getTitleStylePaletteSpec(paletteId, overrides);
}

export function getTitleStyleIcon(iconId = "none") {
  if (!iconId || iconId === "none") {
    return null;
  }

  return TITLE_STYLE_ICON_OPTIONS.find((item) => item.value === iconId)?.icon || Award;
}

export function getTitleStylePreset(presetId) {
  return TITLE_STYLE_PRESETS.find((item) => item.id === presetId) || null;
}

