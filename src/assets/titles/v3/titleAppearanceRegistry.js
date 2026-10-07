import { getTitleFrameAsset } from "../v2/titleAssetRegistry";
import {
  createTitleOrnamentAssetCatalog,
  resolveTitleOrnamentAssetSources,
} from "./titleOrnamentAssetCatalog";

// This registry is the public boundary for title artwork.  Callers select
// semantic IDs only; the resolver owns the asset path, z-order, and rules that
// keep an ornament visually compatible with its fixed frame and metal.
const ornamentAssetContext = require.context("./ornaments", true, /\.webp$/);
const ornamentVariantAssetContext = require.context(
  "./ornamentVariants",
  true,
  /\/(front|rear)\.webp$/,
);
const ORNAMENT_ASSET_CATALOG = createTitleOrnamentAssetCatalog({
  genericContext: ornamentAssetContext,
  variantContext: ornamentVariantAssetContext,
});
const LEGACY_PALETTE_ALIASES = {
  royal: "amber",
  violet: "amethyst",
};

const GOLD = "champagne-gold";
const SILVER = "satin-silver";
const BRONZE = "rose-bronze";

const LEGACY_TITLE_ORNAMENT_SETS = [
  {
    id: "plaque-laurel-pins",
    frameId: "plaque",
    label: "황금 월계 핀",
    description: "양쪽 모서리를 따라 올라오는 고전 월계 장식",
    asset: "plaque/laurel-pins",
    layer: "front",
    metalIds: [GOLD],
    paletteIds: ["amber", "sunset", "ivory", "vip-champagne", "legendary-ember"],
  },
  {
    id: "plaque-sapphire-brackets",
    frameId: "plaque",
    label: "사파이어 브래킷",
    description: "양끝을 정리하는 푸른 보석 브래킷",
    asset: "plaque/sapphire-brackets",
    layer: "front",
    metalIds: [SILVER],
    paletteIds: ["sapphire", "sky", "teal", "amethyst", "aurora-violet"],
  },
  {
    id: "wing-gold-ribbons",
    frameId: "wing",
    label: "황금 리본 날개",
    description: "날개 하단을 따라 흐르는 황금 리본",
    asset: "wing/gold-ribbons",
    layer: "front",
    metalIds: [GOLD],
    paletteIds: ["amber", "sunset", "vip-champagne", "legendary-ember"],
  },
  {
    id: "wing-ice-crystal-tips",
    frameId: "wing",
    label: "빙정 날개깃",
    description: "양끝에서 자라나는 차가운 수정 깃",
    asset: "wing/ice-crystal-tips",
    layer: "front",
    metalIds: [SILVER],
    paletteIds: ["sapphire", "sky", "teal", "ivory"],
  },
  {
    id: "seal-silver-constellation",
    frameId: "seal",
    label: "은빛 별자리",
    description: "훈장 뒤편에 은은하게 남는 별자리 궤적",
    asset: "seal/silver-constellation",
    layer: "rear",
    metalIds: [SILVER],
    paletteIds: ["sapphire", "sky", "amethyst", "aurora-violet", "charcoal", "slate"],
  },
  {
    id: "seal-ruby-ribbon",
    frameId: "seal",
    label: "루비 리본",
    description: "하단에 매달리는 강한 루비 리본",
    asset: "seal/ruby-ribbon",
    layer: "front",
    metalIds: [SILVER],
    paletteIds: ["ruby", "rose", "deep-red"],
  },
  {
    id: "scroll-gold-vines",
    frameId: "scroll",
    label: "황금 덩굴",
    description: "두루마리 양끝을 감싸는 황금 덩굴",
    asset: "scroll/gold-vines",
    layer: "front",
    metalIds: [GOLD],
    paletteIds: ["amber", "sunset", "ivory", "vip-champagne", "legendary-ember"],
  },
  {
    id: "scroll-aurora-ink",
    frameId: "scroll",
    label: "오로라 잉크",
    description: "가장자리에 번지는 보랏빛 마법 잉크",
    asset: "scroll/aurora-ink",
    layer: "front",
    metalIds: [SILVER],
    paletteIds: ["sapphire", "amethyst", "magenta", "aurora-violet"],
  },
  {
    id: "jewel-gold-clusters",
    frameId: "jewel",
    label: "황금 보석 군집",
    description: "양끝을 강조하는 황금 보석 장식",
    asset: "jewel/gold-clusters",
    layer: "front",
    metalIds: [GOLD],
    paletteIds: ["amber", "sunset", "vip-champagne", "legendary-ember"],
  },
  {
    id: "jewel-silver-orbits",
    frameId: "jewel",
    label: "은빛 궤도",
    description: "양쪽을 도는 얇은 은빛 보석 궤도",
    asset: "jewel/silver-orbits",
    layer: "front",
    metalIds: [SILVER],
    paletteIds: ["sapphire", "sky", "teal", "amethyst", "aurora-violet"],
  },
  {
    id: "ticket-burgundy-bow",
    frameId: "ticket",
    label: "버건디 리본",
    description: "티켓 하단에 달리는 선물 리본",
    asset: "ticket/burgundy-bow",
    layer: "front",
    metalIds: [SILVER],
    paletteIds: ["ruby", "rose", "deep-red"],
  },
  {
    id: "blossom-silver-dewdrop",
    frameId: "blossom",
    label: "은빛 이슬 장식",
    description: "하단에 맺히는 섬세한 이슬 펜던트",
    asset: "blossom/silver-dewdrop",
    layer: "front",
    metalIds: [SILVER],
    paletteIds: ["emerald", "teal", "sky", "ivory"],
  },
  {
    id: "blossom-violet-flower-sprig",
    frameId: "blossom",
    label: "보랏빛 꽃가지",
    description: "가장자리에 피어나는 보랏빛 꽃 장식",
    asset: "blossom/violet-flower-sprig",
    layer: "front",
    metalIds: [SILVER],
    paletteIds: ["amethyst", "magenta", "aurora-violet", "rose"],
  },
  {
    id: "shield-burgundy-banner-pendant",
    frameId: "shield",
    label: "버건디 문장 펜던트",
    description: "방패 하단에 매달리는 붉은 문장 장식",
    asset: "shield/burgundy-banner-pendant",
    layer: "front",
    metalIds: [BRONZE],
    paletteIds: ["ruby", "rose", "deep-red"],
  },
  {
    id: "shield-sapphire-medal-pendant",
    frameId: "shield",
    label: "사파이어 메달",
    description: "방패 아래를 완성하는 푸른 메달",
    asset: "shield/sapphire-medal-pendant",
    layer: "front",
    metalIds: [SILVER],
    paletteIds: ["sapphire", "sky", "teal"],
  },
  {
    id: "arc-gold-sunburst",
    frameId: "arc",
    label: "황금 태양 문장",
    description: "아치 상단을 밝히는 태양 문장",
    asset: "arc/gold-sunburst",
    layer: "front",
    metalIds: [GOLD],
    paletteIds: ["amber", "ivory", "vip-champagne", "legendary-ember"],
  },
  {
    id: "arc-silver-moon",
    frameId: "arc",
    label: "은빛 달 문장",
    description: "아치 상단을 장식하는 푸른 달 문장",
    asset: "arc/silver-moon",
    layer: "front",
    metalIds: [SILVER],
    paletteIds: ["sapphire", "sky", "amethyst", "aurora-violet"],
  },
  {
    id: "marquee-gold-theater-star",
    frameId: "marquee",
    label: "황금 극장 별",
    description: "간판 상단을 빛내는 황금 스타",
    asset: "marquee/gold-theater-star",
    layer: "front",
    metalIds: [GOLD],
    paletteIds: ["ruby", "rose", "amber", "sunset", "vip-champagne", "legendary-ember"],
  },
  {
    id: "marquee-silver-spotlight",
    frameId: "marquee",
    label: "은빛 스포트라이트",
    description: "차분한 간판 위를 비추는 스포트라이트",
    asset: "marquee/silver-spotlight",
    layer: "front",
    metalIds: [SILVER],
    paletteIds: ["sapphire", "sky", "slate", "charcoal", "aurora-violet"],
  },
];

const COOL_PALETTES = ["sapphire", "sky", "teal", "amethyst", "magenta", "aurora-violet", "slate", "charcoal", "ivory"];
const WARM_PALETTES = ["amber", "sunset", "ivory", "vip-champagne", "legendary-ember", "lime"];
const RICH_PALETTES = ["ruby", "rose", "deep-red", "magenta", "aurora-violet", "vip-champagne"];
const NATURE_PALETTES = ["emerald", "teal", "lime", "ivory", "sky", "amethyst"];

// The artwork was reviewed on its matching 320 x 156 frame. Size is a
// presentation aid for teachers, not a compatibility restriction.
const LARGE_ORNAMENT_SET_IDS = new Set([
  "arc-moon-rose", "arc-crystal-shoulders", "arc-constellation-violet", "arc-grand-aurora", "arc-violet-shoulder", "arc-crystal-shoulder-line",
  "blossom-pink-petal-drift",
  "jewel-gold-star-medal", "jewel-ice-crown-orbits", "jewel-violet-prism-flare", "jewel-filigree-orbit", "jewel-royal-prism", "jewel-gold-medallion", "jewel-silver-orbit", "jewel-gold-drop",
  "marquee-gold-star-bulbs", "marquee-silver-spotlight", "marquee-cyan-velvet", "marquee-bulb-socket", "marquee-theater-mask", "marquee-warm-rail", "marquee-cyan-lights",
  "plaque-gold-laurel-ribbon", "plaque-silver-shield-medal", "plaque-rivet-laurel", "plaque-sapphire-clamp", "plaque-laurel-clasp", "plaque-gold-pins", "plaque-sapphire-pins",
  "scroll-gold-vines-wax", "scroll-ruby-tassels", "scroll-aurora-ribbons", "scroll-scholar-chain", "scroll-aurora-scholar", "scroll-rose-clasp", "scroll-sapphire-ends",
  "seal-gold-tiara-halo", "seal-silver-laurel-medal", "seal-ruby-sunburst-ribbon", "seal-royal-sunburst",
  "shield-silver-royal-medal", "shield-violet-guard-flames", "shield-banner-buckle", "shield-heraldic-standard", "shield-silver-guards", "shield-strap-guard",
  "ticket-gold-star-bow", "ticket-silver-stamp-clips", "ticket-sapphire-bow", "ticket-notched-clasp", "ticket-gold-caps", "ticket-silver-clips",
  "wing-gold-star-ribbons", "wing-ice-halo-crystal", "wing-aurora-comet", "wing-feather-crystal-pins", "wing-aurora-halo", "wing-gold-tip", "wing-ice-tips",
]);

const POINT_ORNAMENT_SET_IDS = new Set([
  "arc-rose-rim", "arc-crescent-pin", "arc-silver-band", "arc-rose-loop", "arc-moonstone-star-pin", "arc-orbit-pin",
  "blossom-petal-pin", "blossom-silver-curl", "blossom-dewdrop-petal-clip",
  "jewel-violet-curl", "jewel-filigree-drop", "jewel-diamond-curl-pin",
  "marquee-gold-rail-rosette", "marquee-gold-rail", "marquee-cyan-spark", "marquee-rosette-mask", "marquee-bulb-spark-pin",
  "plaque-engraved-coin-chain", "plaque-rivet-pin", "plaque-engraved-clasp", "plaque-coin-drop", "plaque-pearl-corner-stud",
  "scroll-wax-button", "scroll-gold-bands", "scroll-wax-border", "scroll-tassel-clasp", "scroll-bookmark-tassel-pin",
  "seal-rope-stud", "seal-beaded-arc", "seal-pearl-bead-clip",
  "shield-pennant-tassel", "shield-shield-rivet",
  "ticket-bulb-trio", "ticket-perforation-rail", "ticket-ticket-punch-pin",
  "wing-silver-feather-cuff", "wing-feather-barb", "wing-star-spark", "wing-feather-line", "wing-ice-pin", "wing-crystal-feather-pin",
]);

function getOrnamentSize(id) {
  if (LARGE_ORNAMENT_SET_IDS.has(id)) return "large";
  if (POINT_ORNAMENT_SET_IDS.has(id)) return "point";
  return "medium";
}

const CURATED_ORNAMENT_COPY = {
  "arc-sunburst-crescent": { label: "태양 초승", description: "태양 문장과 초승 장식" },
  "arc-moon-rose": { label: "달빛 오로라", description: "은빛 달과 오로라 아치" },
  "arc-crystal-shoulders": { label: "수정 어깨장식", description: "수정과 별자리 테두리" },
  "blossom-lavender-dewdrop": { label: "라벤더 이슬", description: "라벤더 꽃과 이슬 펜던트" },
  "blossom-pink-petal-drift": { label: "분홍 꽃잎", description: "분홍 꽃송이와 흩날리는 꽃잎" },
  "blossom-violet-bud-vine": { label: "보랏빛 새싹 덩굴", description: "꽃 테두리와 아래 덩굴" },
  "jewel-gold-star-medal": { label: "황금 별 메달", description: "별 문장과 양옆 보석, 메달" },
  "jewel-ice-crown-orbits": { label: "얼음 왕관 궤도", description: "얼음 왕관과 은빛 궤도" },
  "jewel-violet-prism-flare": { label: "보랏빛 프리즘", description: "프리즘과 루비 장식" },
  "marquee-gold-star-bulbs": { label: "황금 별 전구", description: "극장 별과 따뜻한 전구" },
  "marquee-silver-spotlight": { label: "은빛 스포트라이트", description: "은빛 문장과 푸른 조명" },
  "marquee-gold-rail-rosette": { label: "황금 전구 장식", description: "조명 레일과 작은 극장 장식" },
  "plaque-gold-laurel-ribbon": { label: "황금 월계 리본", description: "월계 문장과 황금 리본" },
  "plaque-silver-shield-medal": { label: "은빛 방패 메달", description: "은빛 방패와 사파이어 장식" },
  "plaque-engraved-coin-chain": { label: "각인 코인 체인", description: "각인 테두리와 코인 체인" },
  "scroll-gold-vines-wax": { label: "황금 덩굴 밀랍", description: "황금 덩굴과 밀랍 인장" },
  "scroll-ruby-tassels": { label: "루비 술장식", description: "루비 고정장식과 술" },
  "scroll-aurora-ribbons": { label: "오로라 리본", description: "오로라 장식과 사파이어 리본" },
  "seal-gold-tiara-halo": { label: "황금 티아라 후광", description: "티아라와 후광, 수정 펜던트" },
  "seal-silver-laurel-medal": { label: "은빛 월계 메달", description: "별자리와 월계 메달" },
  "seal-ruby-sunburst-ribbon": { label: "루비 태양 리본", description: "루비 장식과 태양 문장" },
  "shield-lion-laurel-banner": { label: "사자 월계 배너", description: "사자 문장과 월계 테두리" },
  "shield-silver-royal-medal": { label: "은빛 왕실 메달", description: "왕실 후광과 사파이어 메달" },
  "shield-violet-guard-flames": { label: "보랏빛 수호 불꽃", description: "수호 장식과 보랏빛 불꽃" },
  "ticket-gold-star-bow": { label: "황금 별 리본", description: "별 인장과 버건디 리본" },
  "ticket-silver-stamp-clips": { label: "은빛 입장 인장", description: "입장 인장과 사파이어 클립" },
  "ticket-warm-bulb-perforation": { label: "따뜻한 전구 테두리", description: "전구와 절취선 장식" },
  "wing-gold-star-ribbons": { label: "황금 별 날개리본", description: "별 문장과 날개 리본" },
  "wing-ice-halo-crystal": { label: "얼음 후광 수정", description: "얼음 후광과 수정 장식" },
  "wing-aurora-comet": { label: "오로라 혜성", description: "오로라와 은빛 혜성 궤적" },
  "arc-constellation-violet": { label: "보랏빛 별자리", description: "별자리 아치와 보랏빛 잎 장식" },
  "blossom-petal-curl": { label: "꽃잎 곡선", description: "은빛 꽃잎 테두리와 라벤더 장식" },
  "jewel-silver-prism-chain": { label: "은빛 프리즘 체인", description: "프리즘과 보석 체인" },
  "marquee-cyan-velvet": { label: "청록 벨벳", description: "청록 조명과 벨벳 리본" },
  "plaque-rivet-laurel": { label: "리벳 월계", description: "월계 핀과 모서리 리벳" },
  "scroll-scholar-chain": { label: "학자 체인", description: "학자 문장과 장미 체인" },
  "seal-beaded-tiara": { label: "구슬 티아라", description: "티아라와 금빛 구슬 테두리" },
  "shield-banner-buckle": { label: "배너 버클", description: "의식 배너와 황금 수호장식" },
  "ticket-sapphire-bow": { label: "사파이어 리본", description: "사파이어 클립과 버건디 리본" },
  "wing-silver-feather-cuff": { label: "은빛 깃털 장식", description: "깃털 커프와 별빛 장식" },
  "arc-moonstone-clasp": { label: "문스톤 초승달", description: "은빛 달 문장과 문스톤 펜던트" },
  "blossom-dewdrop-vine": { label: "이슬꽃 덩굴", description: "라벤더 꽃과 은빛 이슬 장식" },
  "jewel-filigree-orbit": { label: "세공 보석 궤도", description: "은빛 궤도와 보석 테두리" },
  "marquee-bulb-socket": { label: "전구 소켓 벨벳", description: "따뜻한 전구와 벨벳 리본" },
  "plaque-silver-coin-medal": { label: "은화 메달", description: "은빛 방패와 코인 체인" },
  "scroll-wax-scroll-bands": { label: "밀랍 두루마리 띠", description: "밀랍 인장과 금빛 끝단 띠" },
  "seal-sapphire-knot": { label: "사파이어 매듭", description: "은빛 월계와 사파이어 메달" },
  "shield-riveted-pennant": { label: "리벳 펜넌트", description: "리벳 테두리와 버건디 펜넌트" },
  "ticket-silver-notch-stub": { label: "은빛 티켓 조각", description: "입장 인장과 붉은 티켓 조각" },
  "wing-feather-crystal-pins": { label: "깃털 크리스털", description: "얼음 깃털과 크리스털 고리" },
  "arc-grand-aurora": { label: "대형 오로라", description: "오로라 아치와 태양 문장" },
  "arc-rose-rim": { label: "장미 별자리 테두리", description: "작은 별자리 테두리 장식" },
  "arc-crescent-pin": { label: "초승달 핀", description: "작은 은빛 초승달 포인트" },
  "blossom-garden-crown": { label: "정원 꽃장식", description: "큰 꽃송이와 아래 덩굴" },
  "blossom-silver-sprig": { label: "은빛 꽃가지", description: "작은 꽃가지와 은빛 연결 장식" },
  "blossom-petal-pin": { label: "꽃잎 핀", description: "작은 라벤더 꽃잎 포인트" },
  "jewel-royal-prism": { label: "왕실 프리즘", description: "큰 보랏빛 프리즘과 보석" },
  "jewel-ice-filigree": { label: "얼음 세공", description: "작은 얼음 왕관 세공" },
  "jewel-violet-curl": { label: "보랏빛 곡선", description: "작은 보석 곡선 포인트" },
  "marquee-theater-mask": { label: "극장 가면", description: "큰 조명과 가면 메달" },
  "marquee-gold-rail": { label: "금빛 조명선", description: "작은 조명 테두리 장식" },
  "marquee-cyan-spark": { label: "청록 불꽃", description: "작은 청록 조명 포인트" },
  "plaque-laurel-ribbon-line": { label: "월계 리본선", description: "큰 월계 문장과 리본" },
  "plaque-sapphire-clamp": { label: "사파이어 고정장식", description: "작은 사파이어와 은빛 체인" },
  "plaque-rivet-pin": { label: "리벳 핀", description: "아주 작은 모서리 리벳" },
  "scroll-aurora-scholar": { label: "오로라 학자", description: "큰 오로라 문장과 리본" },
  "scroll-rose-clasp": { label: "장미 고리", description: "작은 체인과 술 장식" },
  "scroll-wax-button": { label: "밀랍 단추", description: "아주 작은 밀랍 인장" },
  "seal-royal-sunburst": { label: "왕실 햇살", description: "큰 후광과 햇살 문장" },
  "seal-laurel-knot": { label: "월계 매듭", description: "작은 월계와 매듭 장식" },
  "seal-rope-stud": { label: "매듭 스터드", description: "아주 작은 은빛 매듭" },
  "shield-heraldic-standard": { label: "문장 깃발", description: "큰 사자 문장과 수호 장식" },
  "shield-fleur-buckle": { label: "백합 버클", description: "작은 백합 리벳 버클" },
  "shield-pennant-tassel": { label: "펜넌트 술", description: "아주 작은 금빛 술" },
  "ticket-premiere-stamp": { label: "프리미어 인장", description: "큰 별 인장과 전구 테두리" },
  "ticket-notched-clasp": { label: "티켓 고정장식", description: "작은 모서리 고정장식" },
  "ticket-bulb-trio": { label: "전구 세 알", description: "아주 작은 전구 포인트" },
  "wing-aurora-halo": { label: "오로라 후광", description: "큰 오로라와 얼음 후광" },
  "wing-feather-barb": { label: "깃털 결", description: "작은 깃털 테두리 장식" },
  "wing-star-spark": { label: "별빛 점", description: "아주 작은 별빛 포인트" },
  "arc-moonline": { label: "달빛 선", description: "은빛 달 문장과 가는 별자리 선" },
  "blossom-silver-dewdrop": { label: "은빛 이슬", description: "꽃가지와 은빛 이슬 펜던트" },
  "jewel-gold-medallion": { label: "금빛 메달", description: "작은 보석과 금빛 메달" },
  "marquee-soft-spotlight": { label: "은은한 스포트라이트", description: "조용한 조명 문장과 빛점" },
  "plaque-laurel-clasp": { label: "월계 고정장식", description: "월계 핀과 은빛 연결장식" },
  "scroll-scholar-bands": { label: "학자 끝단 띠", description: "학자 문장과 금빛 끝단 띠" },
  "seal-tiara-beads": { label: "티아라 구슬", description: "작은 티아라와 금빛 구슬" },
  "shield-silver-fleur": { label: "은빛 백합 방패", description: "은빛 방패 문장과 백합 테두리" },
  "ticket-star-notches": { label: "별 인장 절취선", description: "별 인장과 작은 절취선 장식" },
  "wing-halo-cuff": { label: "후광 커프", description: "얼음 후광과 깃털 연결장식" },
};

// These are full-canvas overlay packs composed from the frame-specific
// candidate library. `rearAsset` stays behind the base frame while `asset`
// carries the visible crest, rim, and pendant details in front.
const RESTRAINED_MEDIUM_ORNAMENT_SETS = [
  { id: "arc-silver-band", frameId: "arc", label: "은빛 별자리 띠", description: "가느다란 별자리 테두리", asset: "arc/silver-band", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-rose-loop", frameId: "arc", label: "장미 고리", description: "문스톤 고리와 별 핀", asset: "arc/rose-loop", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "arc-moon-apex", frameId: "arc", label: "달빛 꼭지", description: "작은 달 문장", asset: "arc/moon-apex", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-violet-shoulder", frameId: "arc", label: "보랏빛 어깨장식", description: "양쪽 잎 장식", asset: "arc/violet-shoulder", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-crystal-shoulder-line", frameId: "arc", label: "크리스털 어깨선", description: "양쪽 크리스털 선", asset: "arc/crystal-shoulder-line", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "blossom-lavender-sprig", frameId: "blossom", label: "라벤더 꽃가지", description: "가벼운 꽃가지", asset: "blossom/lavender-sprig", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "blossom-dewdrop-loop", frameId: "blossom", label: "이슬 고리", description: "은빛 이슬 펜던트", asset: "blossom/dewdrop-loop", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "blossom-bud-clasp", frameId: "blossom", label: "꽃봉오리 고정장식", description: "아래 덩굴과 고정장식", asset: "blossom/bud-clasp", metalIds: [SILVER], paletteIds: NATURE_PALETTES },
  { id: "blossom-pink-bud", frameId: "blossom", label: "분홍 꽃봉오리", description: "작은 분홍 꽃송이", asset: "blossom/pink-bud", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "blossom-silver-curl", frameId: "blossom", label: "은빛 꽃곡선", description: "가느다란 꽃 테두리", asset: "blossom/silver-curl", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "jewel-silver-orbit", frameId: "jewel", label: "은빛 궤도", description: "양쪽 보석 궤도", asset: "jewel/silver-orbit", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "jewel-gold-drop", frameId: "jewel", label: "금빛 방울", description: "보석과 메달 펜던트", asset: "jewel/gold-drop", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "jewel-ice-hook", frameId: "jewel", label: "얼음 고리", description: "얼음 왕관과 펜던트", asset: "jewel/ice-hook", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "jewel-prism-prong", frameId: "jewel", label: "프리즘 발톱", description: "프리즘 고정장식", asset: "jewel/prism-prong", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "jewel-filigree-drop", frameId: "jewel", label: "세공 물방울", description: "세공 테두리와 보석 방울", asset: "jewel/filigree-drop", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "marquee-gold-socket", frameId: "marquee", label: "금빛 조명 소켓", description: "작은 극장 문장", asset: "marquee/gold-socket", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "marquee-silver-mask", frameId: "marquee", label: "은빛 가면", description: "조명과 가면 펜던트", asset: "marquee/silver-mask", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "marquee-warm-rail", frameId: "marquee", label: "따뜻한 조명선", description: "얇은 전구 테두리", asset: "marquee/warm-rail", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "marquee-cyan-lights", frameId: "marquee", label: "청록 조명", description: "양쪽 청록 빛줄기", asset: "marquee/cyan-lights", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "marquee-rosette-mask", frameId: "marquee", label: "로제트 가면", description: "작은 로제트와 가면", asset: "marquee/rosette-mask", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "plaque-gold-pins", frameId: "plaque", label: "금빛 월계 핀", description: "양쪽 월계 핀", asset: "plaque/gold-pins", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "plaque-silver-medal", frameId: "plaque", label: "은빛 메달", description: "방패와 메달 펜던트", asset: "plaque/silver-medal", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "plaque-engraved-clasp", frameId: "plaque", label: "각인 고정장식", description: "가느다란 각인선", asset: "plaque/engraved-clasp", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "plaque-coin-drop", frameId: "plaque", label: "코인 방울", description: "코인 체인과 리벳", asset: "plaque/coin-drop", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "plaque-sapphire-pins", frameId: "plaque", label: "사파이어 핀", description: "양쪽 사파이어 고정장식", asset: "plaque/sapphire-pins", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "scroll-gold-bands", frameId: "scroll", label: "금빛 끝단 띠", description: "끝단 띠와 고정장식", asset: "scroll/gold-bands", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "scroll-wax-border", frameId: "scroll", label: "밀랍 테두리", description: "가느다란 밀랍선", asset: "scroll/wax-border", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "scroll-scholar-clasp", frameId: "scroll", label: "학자 고정장식", description: "학자 문장과 고리", asset: "scroll/scholar-clasp", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "scroll-sapphire-ends", frameId: "scroll", label: "사파이어 끝단", description: "양쪽 리본 끝단", asset: "scroll/sapphire-ends", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "scroll-tassel-clasp", frameId: "scroll", label: "술 고정장식", description: "작은 술과 고리", asset: "scroll/tassel-clasp", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "seal-tiara-loop", frameId: "seal", label: "티아라 고리", description: "작은 티아라와 펜던트", asset: "seal/tiara-loop", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "seal-silver-knot", frameId: "seal", label: "은빛 월계 매듭", description: "월계와 작은 매듭", asset: "seal/silver-knot", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "seal-sapphire-drop", frameId: "seal", label: "사파이어 방울", description: "사파이어와 은빛 고리", asset: "seal/sapphire-drop", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "seal-beaded-arc", frameId: "seal", label: "구슬 아치", description: "가느다란 금빛 구슬선", asset: "seal/beaded-arc", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "seal-sunburst-loop", frameId: "seal", label: "햇살 고리", description: "은빛 햇살 문장", asset: "seal/sunburst-loop", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "shield-silver-guards", frameId: "shield", label: "은빛 수호장식", description: "양쪽 수호 날개", asset: "shield/silver-guards", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "shield-lion-pendant", frameId: "shield", label: "사자 펜던트", description: "작은 사자 문장", asset: "shield/lion-pendant", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "shield-fleur-plate", frameId: "shield", label: "백합 판금", description: "백합 테두리와 리벳", asset: "shield/fleur-plate", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "shield-sapphire-medal", frameId: "shield", label: "사파이어 메달", description: "방패와 사파이어 펜던트", asset: "shield/sapphire-medal", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "shield-strap-guard", frameId: "shield", label: "문장 버클", description: "수호장식과 버클", asset: "shield/strap-guard", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "ticket-gold-caps", frameId: "ticket", label: "금빛 모서리", description: "티켓 끝단 장식", asset: "ticket/gold-caps", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "ticket-silver-clips", frameId: "ticket", label: "은빛 클립", description: "사파이어 모서리 클립", asset: "ticket/silver-clips", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "ticket-stamp-clasp", frameId: "ticket", label: "입장 인장 고리", description: "인장과 작은 고리", asset: "ticket/stamp-clasp", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "ticket-perforation-rail", frameId: "ticket", label: "절취선 조명", description: "가느다란 절취선", asset: "ticket/perforation-rail", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "ticket-bow-stub", frameId: "ticket", label: "리본 티켓 조각", description: "작은 리본과 티켓 조각", asset: "ticket/bow-stub", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "wing-gold-tip", frameId: "wing", label: "금빛 날개 끝", description: "양쪽 금빛 끝단", asset: "wing/gold-tip", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "wing-ice-tips", frameId: "wing", label: "얼음 날개 끝", description: "양쪽 얼음 끝단", asset: "wing/ice-tips", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "wing-halo-hook", frameId: "wing", label: "후광 고리", description: "후광과 작은 크리스털", asset: "wing/halo-hook", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "wing-feather-line", frameId: "wing", label: "깃털 선", description: "가느다란 깃털 테두리", asset: "wing/feather-line", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "wing-ice-pin", frameId: "wing", label: "얼음 깃털 핀", description: "작은 깃털과 별빛", asset: "wing/ice-pin", metalIds: [SILVER], paletteIds: COOL_PALETTES },
];

const CURATED_TITLE_ORNAMENT_SETS = [
  { id: "arc-sunburst-crescent", frameId: "arc", label: "Sunburst Crescent", description: "Gold sun crest with a restrained crescent accent.", asset: "arc/sunburst-crescent", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "arc-moon-rose", frameId: "arc", label: "Moon Rose", description: "Silver moon crest over a rose aurora arc.", asset: "arc/moon-rose", rearAsset: "arc/moon-rose-rear", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-crystal-shoulders", frameId: "arc", label: "Crystal Shoulders", description: "Cool crystal shoulders and constellation rim detail.", asset: "arc/crystal-shoulders", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },

  { id: "blossom-lavender-dewdrop", frameId: "blossom", label: "Lavender Dewdrop", description: "Lavender halo and a silver dewdrop pendant.", asset: "blossom/lavender-dewdrop", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "blossom-pink-petal-drift", frameId: "blossom", label: "Pink Petal Drift", description: "Pink clusters with a quiet petal drift behind the frame.", asset: "blossom/pink-petal-drift", rearAsset: "blossom/pink-petal-drift-rear", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "blossom-violet-bud-vine", frameId: "blossom", label: "Violet Bud Vine", description: "Violet rim sprigs and an emerald lower vine.", asset: "blossom/violet-bud-vine", layer: "front", metalIds: [SILVER], paletteIds: NATURE_PALETTES },

  { id: "jewel-gold-star-medal", frameId: "jewel", label: "Gold Star Medal", description: "Gold star, side clusters, and a medal pendant.", asset: "jewel/gold-star-medal", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "jewel-ice-crown-orbits", frameId: "jewel", label: "Ice Crown Orbits", description: "Ice crown with silver orbital details.", asset: "jewel/ice-crown-orbits", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "jewel-violet-prism-flare", frameId: "jewel", label: "Violet Prism Flare", description: "Violet prism with ruby flare details.", asset: "jewel/violet-prism-flare", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },

  { id: "marquee-gold-star-bulbs", frameId: "marquee", label: "Gold Star Bulbs", description: "Gold theater star, warm bulbs, and velvet ribbon.", asset: "marquee/gold-star-bulbs", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "marquee-silver-spotlight", frameId: "marquee", label: "Silver Spotlight", description: "Silver spotlight with cool gem light strips.", asset: "marquee/silver-spotlight", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "marquee-gold-rail-rosette", frameId: "marquee", label: "Gold Rail Rosette", description: "Light rail, bulb rosette, and a small theater charm.", asset: "marquee/gold-rail-rosette", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },

  { id: "plaque-gold-laurel-ribbon", frameId: "plaque", label: "Gold Laurel Ribbon", description: "Laurel star, pins, and gold ribbon.", asset: "plaque/gold-laurel-ribbon", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "plaque-silver-shield-medal", frameId: "plaque", label: "Silver Shield Medal", description: "Silver shield crest with sapphire brackets.", asset: "plaque/silver-shield-medal", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "plaque-engraved-coin-chain", frameId: "plaque", label: "Engraved Coin Chain", description: "Engraved rim with clamp and coin-chain details.", asset: "plaque/engraved-coin-chain", layer: "front", metalIds: [GOLD, SILVER], paletteIds: [...WARM_PALETTES, ...COOL_PALETTES] },

  { id: "scroll-gold-vines-wax", frameId: "scroll", label: "Gold Vines & Wax", description: "Gold corner vines with a wax-seal crest.", asset: "scroll/gold-vines-wax", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "scroll-ruby-tassels", frameId: "scroll", label: "Ruby Tassels", description: "Ruby clamps and ceremonial tassels.", asset: "scroll/ruby-tassels", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "scroll-aurora-ribbons", frameId: "scroll", label: "Aurora Ribbons", description: "Aurora corners, sapphire ribbons, and a crystal crest.", asset: "scroll/aurora-ribbons", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },

  { id: "seal-gold-tiara-halo", frameId: "seal", label: "Gold Tiara Halo", description: "Gold halo behind a tiara and aurora pendant.", asset: "seal/gold-tiara-halo", rearAsset: "seal/gold-tiara-halo-rear", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "seal-silver-laurel-medal", frameId: "seal", label: "Silver Laurel Medal", description: "Silver constellation and laurel medal composition.", asset: "seal/silver-laurel-medal", rearAsset: "seal/silver-laurel-medal-rear", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "seal-ruby-sunburst-ribbon", frameId: "seal", label: "Ruby Sunburst Ribbon", description: "Ruby swashes with silver sunburst and ribbon.", asset: "seal/ruby-sunburst-ribbon", rearAsset: "seal/ruby-sunburst-ribbon-rear", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },

  { id: "shield-lion-laurel-banner", frameId: "shield", label: "Lion Laurel Banner", description: "Gold lion crest with laurel rim and banner.", asset: "shield/lion-laurel-banner", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "shield-silver-royal-medal", frameId: "shield", label: "Silver Royal Medal", description: "Royal halo behind silver shield and sapphire medal.", asset: "shield/silver-royal-medal", rearAsset: "shield/silver-royal-medal-rear", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "shield-violet-guard-flames", frameId: "shield", label: "Violet Guard Flames", description: "Violet rear flames with silver guards.", asset: "shield/violet-guard-flames", rearAsset: "shield/violet-guard-flames-rear", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },

  { id: "ticket-gold-star-bow", frameId: "ticket", label: "Gold Star Bow", description: "Gold ticket caps, star seal, and burgundy bow.", asset: "ticket/gold-star-bow", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "ticket-silver-stamp-clips", frameId: "ticket", label: "Silver Stamp Clips", description: "Silver admission stamp and sapphire clips.", asset: "ticket/silver-stamp-clips", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "ticket-warm-bulb-perforation", frameId: "ticket", label: "Warm Bulb Perforation", description: "Warm bulb row with gold perforation details.", asset: "ticket/warm-bulb-perforation", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },

  { id: "wing-gold-star-ribbons", frameId: "wing", label: "Gold Star Ribbons", description: "Gold crest and ribbons with small star sparks.", asset: "wing/gold-star-ribbons", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "wing-ice-halo-crystal", frameId: "wing", label: "Ice Halo Crystal", description: "Ice halo, crystal tips, and lower crystal hook.", asset: "wing/ice-halo-crystal", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "wing-aurora-comet", frameId: "wing", label: "Aurora Comet", description: "Aurora flare and comet trail behind the wing frame.", asset: "wing/aurora-comet", rearAsset: "wing/aurora-comet-rear", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-constellation-violet", frameId: "arc", label: "Violet Constellation", description: "Constellation arc with violet leaves.", asset: "arc/constellation-violet", rearAsset: "arc/constellation-violet-rear", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "blossom-petal-curl", frameId: "blossom", label: "Petal Curl", description: "Silver petal curl with lavender detail.", asset: "blossom/petal-curl", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "jewel-silver-prism-chain", frameId: "jewel", label: "Silver Prism Chain", description: "Prism with silver gem chain.", asset: "jewel/silver-prism-chain", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "marquee-cyan-velvet", frameId: "marquee", label: "Cyan Velvet", description: "Cyan lights with velvet ribbon.", asset: "marquee/cyan-velvet", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "plaque-rivet-laurel", frameId: "plaque", label: "Rivet Laurel", description: "Laurel pins with corner rivets.", asset: "plaque/rivet-laurel", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "scroll-scholar-chain", frameId: "scroll", label: "Scholar Chain", description: "Scholar crest with rose chain.", asset: "scroll/scholar-chain", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "seal-beaded-tiara", frameId: "seal", label: "Beaded Tiara", description: "Tiara with gold bead trim.", asset: "seal/beaded-tiara", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "shield-banner-buckle", frameId: "shield", label: "Banner Buckle", description: "Ceremonial banner and gold guards.", asset: "shield/banner-buckle", rearAsset: "shield/banner-buckle-rear", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "ticket-sapphire-bow", frameId: "ticket", label: "Sapphire Bow", description: "Sapphire clips with burgundy bow.", asset: "ticket/sapphire-bow", layer: "front", metalIds: [SILVER], paletteIds: RICH_PALETTES },
  { id: "wing-silver-feather-cuff", frameId: "wing", label: "Silver Feather Cuff", description: "Feather cuff with star detail.", asset: "wing/silver-feather-cuff", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-moonstone-clasp", frameId: "arc", label: "Moonstone Clasp", description: "Silver moon crest with moonstone pendant.", asset: "arc/moonstone-clasp", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "blossom-dewdrop-vine", frameId: "blossom", label: "Dewdrop Vine", description: "Lavender bloom and a restrained dewdrop vine.", asset: "blossom/dewdrop-vine", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "jewel-filigree-orbit", frameId: "jewel", label: "Filigree Orbit", description: "Silver orbit with filigree gem detail.", asset: "jewel/filigree-orbit", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "marquee-bulb-socket", frameId: "marquee", label: "Bulb Socket", description: "Warm bulb strips and velvet ribbon.", asset: "marquee/bulb-socket", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "plaque-silver-coin-medal", frameId: "plaque", label: "Silver Coin Medal", description: "Silver shield and coin-chain details.", asset: "plaque/silver-coin-medal", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "scroll-wax-scroll-bands", frameId: "scroll", label: "Wax Scroll Bands", description: "Wax seal with stitched border and gold bands.", asset: "scroll/wax-scroll-bands", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "seal-sapphire-knot", frameId: "seal", label: "Sapphire Knot", description: "Silver laurel with a sapphire medallion.", asset: "seal/sapphire-knot", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "shield-riveted-pennant", frameId: "shield", label: "Riveted Pennant", description: "Dark riveted trim and burgundy pennant.", asset: "shield/riveted-pennant", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "ticket-silver-notch-stub", frameId: "ticket", label: "Silver Notch Stub", description: "Silver admission stamp and red ticket stub.", asset: "ticket/silver-notch-stub", layer: "front", metalIds: [SILVER], paletteIds: RICH_PALETTES },
  { id: "wing-feather-crystal-pins", frameId: "wing", label: "Feather Crystal Pins", description: "Ice feather pins with crystal hook.", asset: "wing/feather-crystal-pins", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-grand-aurora", frameId: "arc", label: "Grand Aurora", description: "Large aurora arc and sun crest.", asset: "arc/grand-aurora", rearAsset: "arc/grand-aurora-rear", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "arc-rose-rim", frameId: "arc", label: "Rose Rim", description: "Small constellation rim ornament.", asset: "arc/rose-rim", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-crescent-pin", frameId: "arc", label: "Crescent Pin", description: "Tiny silver crescent point.", asset: "arc/crescent-pin", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "blossom-garden-crown", frameId: "blossom", label: "Garden Crown", description: "Large blossom cluster and lower vine.", asset: "blossom/garden-crown", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "blossom-silver-sprig", frameId: "blossom", label: "Silver Sprig", description: "Small flower sprig and silver clasp.", asset: "blossom/silver-sprig", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "blossom-petal-pin", frameId: "blossom", label: "Petal Pin", description: "Tiny lavender petal accent.", asset: "blossom/petal-pin", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "jewel-royal-prism", frameId: "jewel", label: "Royal Prism", description: "Large violet prism with jewel details.", asset: "jewel/royal-prism", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "jewel-ice-filigree", frameId: "jewel", label: "Ice Filigree", description: "Small ice crown filigree.", asset: "jewel/ice-filigree", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "jewel-violet-curl", frameId: "jewel", label: "Violet Curl", description: "Tiny violet jewel curl.", asset: "jewel/violet-curl", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "marquee-theater-mask", frameId: "marquee", label: "Theater Mask", description: "Large spotlights and mask medal.", asset: "marquee/theater-mask", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "marquee-gold-rail", frameId: "marquee", label: "Gold Rail", description: "Small gold light-rail ornament.", asset: "marquee/gold-rail", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "marquee-cyan-spark", frameId: "marquee", label: "Cyan Spark", description: "Tiny cyan spotlight spark.", asset: "marquee/cyan-spark", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "plaque-laurel-ribbon-line", frameId: "plaque", label: "Laurel Ribbon Line", description: "Large laurel crest and ribbon.", asset: "plaque/laurel-ribbon-line", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "plaque-sapphire-clamp", frameId: "plaque", label: "Sapphire Clamp", description: "Small sapphire brackets and silver chain.", asset: "plaque/sapphire-clamp", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "plaque-rivet-pin", frameId: "plaque", label: "Rivet Pin", description: "Tiny corner rivet.", asset: "plaque/rivet-pin", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "scroll-aurora-scholar", frameId: "scroll", label: "Aurora Scholar", description: "Large aurora crest with ribbons.", asset: "scroll/aurora-scholar", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "scroll-rose-clasp", frameId: "scroll", label: "Rose Clasp", description: "Small rose chain and tassel.", asset: "scroll/rose-clasp", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "scroll-wax-button", frameId: "scroll", label: "Wax Button", description: "Tiny wax seal point.", asset: "scroll/wax-button", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "seal-royal-sunburst", frameId: "seal", label: "Royal Sunburst", description: "Large halo and sunburst crest.", asset: "seal/royal-sunburst", rearAsset: "seal/royal-sunburst-rear", layer: "front", metalIds: [BRONZE], paletteIds: RICH_PALETTES },
  { id: "seal-laurel-knot", frameId: "seal", label: "Laurel Knot", description: "Small laurel and knot ornament.", asset: "seal/laurel-knot", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "seal-rope-stud", frameId: "seal", label: "Rope Stud", description: "Tiny silver rope knot.", asset: "seal/rope-stud", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "shield-heraldic-standard", frameId: "shield", label: "Heraldic Standard", description: "Large lion crest and guard details.", asset: "shield/heraldic-standard", rearAsset: "shield/heraldic-standard-rear", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "shield-fleur-buckle", frameId: "shield", label: "Fleur Buckle", description: "Small fleur stud and buckle.", asset: "shield/fleur-buckle", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "shield-pennant-tassel", frameId: "shield", label: "Pennant Tassel", description: "Tiny gold tassel.", asset: "shield/pennant-tassel", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "ticket-premiere-stamp", frameId: "ticket", label: "Premiere Stamp", description: "Large star seal and bulb rim.", asset: "ticket/premiere-stamp", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "ticket-notched-clasp", frameId: "ticket", label: "Notched Clasp", description: "Small corner clasp ornament.", asset: "ticket/notched-clasp", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "ticket-bulb-trio", frameId: "ticket", label: "Bulb Trio", description: "Tiny warm bulb point.", asset: "ticket/bulb-trio", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "wing-aurora-halo", frameId: "wing", label: "Aurora Halo", description: "Large aurora and ice halo.", asset: "wing/aurora-halo", rearAsset: "wing/aurora-halo-rear", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "wing-feather-barb", frameId: "wing", label: "Feather Barb", description: "Small feather rim detail.", asset: "wing/feather-barb", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "wing-star-spark", frameId: "wing", label: "Star Spark", description: "Tiny silver star point.", asset: "wing/star-spark", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-moonline", frameId: "arc", label: "Moonline", description: "Silver moon crest with a light constellation line.", asset: "arc/moonline", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "blossom-silver-dewdrop", frameId: "blossom", label: "Silver Dewdrop", description: "Flower sprig with a silver dewdrop pendant.", asset: "blossom/silver-dewdrop", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "jewel-gold-medallion", frameId: "jewel", label: "Gold Medallion", description: "Gold jewel clusters with a medal pendant.", asset: "jewel/gold-medallion", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "marquee-soft-spotlight", frameId: "marquee", label: "Soft Spotlight", description: "Quiet spotlight crest and a small light spark.", asset: "marquee/soft-spotlight", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "plaque-laurel-clasp", frameId: "plaque", label: "Laurel Clasp", description: "Laurel pins with a restrained silver clasp.", asset: "plaque/laurel-clasp", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "scroll-scholar-bands", frameId: "scroll", label: "Scholar Bands", description: "Scholar crest with quiet gold end bands.", asset: "scroll/scholar-bands", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "seal-tiara-beads", frameId: "seal", label: "Tiara Beads", description: "A small tiara with gold bead details.", asset: "seal/tiara-beads", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "shield-silver-fleur", frameId: "shield", label: "Silver Fleur", description: "Silver shield crest with fleur rim.", asset: "shield/silver-fleur", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "ticket-star-notches", frameId: "ticket", label: "Star Notches", description: "Gold star seal with small ticket notches.", asset: "ticket/star-notches", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "wing-halo-cuff", frameId: "wing", label: "Halo Cuff", description: "Ice halo with a restrained feather cuff.", asset: "wing/halo-cuff", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-moonstone-laurel", frameId: "arc", label: "문스톤 월계", description: "은빛 초승달과 부드러운 월계 장식.", asset: "arc/moonstone-laurel", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-moonstone-star-pin", frameId: "arc", label: "문스톤 별 핀", description: "은빛 별과 문스톤의 작은 포인트 장식.", asset: "arc/moonstone-star-pin", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-starlight-knot", frameId: "arc", label: "별빛 매듭", description: "문스톤과 월계가 어우러진 은빛 장식.", asset: "arc/starlight-knot", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "arc-orbit-pin", frameId: "arc", label: "궤도 핀", description: "작은 문스톤 궤도 포인트.", asset: "arc/orbit-pin", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "blossom-lavender-bud-ribbon", frameId: "blossom", label: "라벤더 꽃봉오리 리본", description: "꽃봉오리와 이슬 장식의 부드러운 리본.", asset: "blossom/lavender-bud-ribbon", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "blossom-dewdrop-petal-clip", frameId: "blossom", label: "이슬 꽃잎 클립", description: "작은 꽃잎과 진주 이슬 포인트.", asset: "blossom/dewdrop-petal-clip", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "jewel-amethyst-pendant", frameId: "jewel", label: "자수정 펜던트", description: "보랏빛 보석과 은빛 세공 장식.", asset: "jewel/amethyst-pendant", layer: "front", metalIds: [SILVER], paletteIds: RICH_PALETTES },
  { id: "jewel-diamond-curl-pin", frameId: "jewel", label: "다이아 컬 핀", description: "작은 보석 곡선 포인트.", asset: "jewel/diamond-curl-pin", layer: "front", metalIds: [SILVER], paletteIds: RICH_PALETTES },
  { id: "marquee-ticket-medal", frameId: "marquee", label: "티켓 메달", description: "별빛과 리본으로 만든 작은 입장 메달.", asset: "marquee/ticket-medal", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "marquee-bulb-spark-pin", frameId: "marquee", label: "전구 반짝 핀", description: "작은 전구와 별빛 포인트.", asset: "marquee/bulb-spark-pin", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "plaque-scholar-seal", frameId: "plaque", label: "학자 인장", description: "고전 금빛 인장과 은빛 잎 장식.", asset: "plaque/scholar-seal", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "plaque-pearl-corner-stud", frameId: "plaque", label: "진주 코너 장식", description: "작은 진주와 금빛 모서리 포인트.", asset: "plaque/pearl-corner-stud", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "scroll-quill-clasp", frameId: "scroll", label: "깃펜 클립", description: "푸른 리본과 은빛 깃펜 장식.", asset: "scroll/quill-clasp", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "scroll-bookmark-tassel-pin", frameId: "scroll", label: "책갈피 술 핀", description: "작은 사파이어 책갈피 포인트.", asset: "scroll/bookmark-tassel-pin", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "seal-pearl-rosette", frameId: "seal", label: "진주 로제트", description: "진주 중심의 연분홍 로제트 장식.", asset: "seal/pearl-rosette", layer: "front", metalIds: [SILVER], paletteIds: WARM_PALETTES },
  { id: "seal-pearl-bead-clip", frameId: "seal", label: "진주 비즈 클립", description: "작은 진주와 은빛 곡선 포인트.", asset: "seal/pearl-bead-clip", layer: "front", metalIds: [SILVER], paletteIds: WARM_PALETTES },
  { id: "shield-heraldic-wreath", frameId: "shield", label: "문장 월계", description: "푸른 방패와 은빛 월계 장식.", asset: "shield/heraldic-wreath", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "shield-shield-rivet", frameId: "shield", label: "방패 리벳", description: "작은 푸른 방패 포인트.", asset: "shield/shield-rivet", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "ticket-star-stamp", frameId: "ticket", label: "별 도장", description: "별과 리본을 더한 작은 티켓 도장.", asset: "ticket/star-stamp", layer: "front", metalIds: [GOLD], paletteIds: WARM_PALETTES },
  { id: "ticket-ticket-punch-pin", frameId: "ticket", label: "티켓 펀치 핀", description: "작은 펀치와 별 포인트.", asset: "ticket/ticket-punch-pin", layer: "front", metalIds: [SILVER], paletteIds: WARM_PALETTES },
  { id: "wing-feather-brooch", frameId: "wing", label: "깃털 브로치", description: "얼음빛 보석을 품은 은빛 깃털.", asset: "wing/feather-brooch", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  { id: "wing-crystal-feather-pin", frameId: "wing", label: "수정 깃털 핀", description: "작은 얼음빛 깃털 포인트.", asset: "wing/crystal-feather-pin", layer: "front", metalIds: [SILVER], paletteIds: COOL_PALETTES },
  ...RESTRAINED_MEDIUM_ORNAMENT_SETS,
];

const LEGACY_ORNAMENT_MIGRATIONS = {
  "plaque-laurel-pins": "plaque-gold-laurel-ribbon",
  "plaque-sapphire-brackets": "plaque-silver-shield-medal",
  "wing-gold-ribbons": "wing-gold-star-ribbons",
  "wing-ice-crystal-tips": "wing-ice-halo-crystal",
  "seal-silver-constellation": "seal-silver-laurel-medal",
  "seal-ruby-ribbon": "seal-ruby-sunburst-ribbon",
  "scroll-gold-vines": "scroll-gold-vines-wax",
  "scroll-aurora-ink": "scroll-aurora-ribbons",
  "jewel-gold-clusters": "jewel-gold-star-medal",
  "jewel-silver-orbits": "jewel-ice-crown-orbits",
  "ticket-burgundy-bow": "ticket-gold-star-bow",
  "blossom-silver-dewdrop": "blossom-lavender-dewdrop",
  "blossom-violet-flower-sprig": "blossom-violet-bud-vine",
  "shield-burgundy-banner-pendant": "shield-lion-laurel-banner",
  "shield-sapphire-medal-pendant": "shield-silver-royal-medal",
  "arc-gold-sunburst": "arc-sunburst-crescent",
  "arc-silver-moon": "arc-moon-rose",
  "marquee-gold-theater-star": "marquee-gold-star-bulbs",
  "marquee-silver-spotlight": "marquee-silver-spotlight",
};

const LEGACY_ORNAMENT_SET_IDS = new Set(LEGACY_TITLE_ORNAMENT_SETS.map((ornamentSet) => ornamentSet.id));

export const TITLE_ORNAMENT_SETS = CURATED_TITLE_ORNAMENT_SETS.map((ornamentSet) => ({
  ...ornamentSet,
  ...CURATED_ORNAMENT_COPY[ornamentSet.id],
  size: getOrnamentSize(ornamentSet.id),
}));

const ornamentSetById = TITLE_ORNAMENT_SETS.reduce((sets, ornamentSet) => {
  sets[ornamentSet.id] = ornamentSet;
  return sets;
}, {});

function getFrameId(style = {}) {
  return style.familyId || style.frameId || "plaque";
}

export function normalizeTitleOrnamentSetId(ornamentSetId = "none") {
  if (LEGACY_ORNAMENT_MIGRATIONS[ornamentSetId]) {
    return LEGACY_ORNAMENT_MIGRATIONS[ornamentSetId];
  }
  return LEGACY_ORNAMENT_SET_IDS.has(ornamentSetId) ? "none" : ornamentSetId || "none";
}

export function getTitleOrnamentSet(ornamentSetId = "none") {
  return ornamentSetById[normalizeTitleOrnamentSetId(ornamentSetId)] || null;
}

export function isTitleOrnamentCompatible(ornamentSet, style = {}) {
  if (!ornamentSet) return false;
  // Every curated ornament is baked on the matching frame's 320 x 156 canvas.
  // Its fixed artwork remains legible across the available colour and metal
  // variants, so the frame family is the only selection constraint.
  return ornamentSet.frameId === getFrameId(style);
}

export function getTitleOrnamentSetOptions(style = {}) {
  return TITLE_ORNAMENT_SETS.filter((ornamentSet) => ornamentSet.frameId === getFrameId(style)).map(
    (ornamentSet) => ({
      ...ornamentSet,
      isCompatible: isTitleOrnamentCompatible(ornamentSet, style),
    }),
  );
}

export function resolveTitleAppearance(style = {}) {
  const base = getTitleFrameAsset(style);
  if (!base || base.renderer !== "asset-generated") return null;

  const requestedOrnament = getTitleOrnamentSet(style.ornamentSetId);
  const ornamentSet = isTitleOrnamentCompatible(requestedOrnament, style)
    ? requestedOrnament
    : null;
  const ornamentAssets = resolveTitleOrnamentAssetSources(
    ORNAMENT_ASSET_CATALOG,
    {
      ornamentSet,
      paletteId: LEGACY_PALETTE_ALIASES[style.paletteId] || style.paletteId,
    },
  );
  const ornamentSrc = ornamentAssets.front;
  const rearOrnamentSrc = ornamentAssets.rear;
  const layers = ornamentSet && ornamentSrc
    ? [
        ...(rearOrnamentSrc
          ? [{ id: `${ornamentSet.id}-rear`, src: rearOrnamentSrc, layer: "rear", x: 0, y: 0, width: 320, height: 156 }]
          : []),
        {
          id: ornamentSet.id,
          src: ornamentSrc,
          // New full-canvas packs are front overlays unless a pack explicitly
          // declares itself as a rear layer.
          layer: ornamentSet.layer || "front",
          x: 0,
          y: 0,
          width: 320,
          height: 156,
        },
      ]
    : [];

  return {
    base,
    layers,
    layout: base.layout,
    constraints: {
      usesFixedArtwork: true,
      supportsCustomFrameColors: false,
      selectedOrnamentId: ornamentSet?.id || "none",
      requestedOrnamentId: style.ornamentSetId || "none",
      requestedOrnamentIsCompatible:
        !style.ornamentSetId || style.ornamentSetId === "none" || Boolean(ornamentSet),
    },
  };
}
