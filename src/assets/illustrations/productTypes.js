import candy from "./product-types/candy-v1.webp";
import coupon from "./product-types/coupon-v1.webp";
import drink from "./product-types/drink-v1.webp";
import game from "./product-types/game-v1.webp";
import gift from "./product-types/gift-v1.webp";
import randomBoxPremium from "./product-types/random-box-premium-v1.webp";
import randomBox from "./product-types/random-box-v1.webp";
import reward from "./product-types/reward-v1.webp";
import role from "./product-types/role-v1.webp";
import snack from "./product-types/snack-v1.webp";
import stationery from "./product-types/stationery-v1.webp";
import vipBenefitLearning from "../vip/vip-benefit-learning-v1.webp";
import vipBenefitPriority from "../vip/vip-benefit-priority-v1.webp";
import vipBenefitReward from "../vip/vip-benefit-reward-v1.webp";
import vipLoungeCrest from "../vip/vip-lounge-crest-v1.webp";
import marketplaceCollectibles from "./marketplace-types/marketplace-collectibles-v1.webp";
import marketplaceHandmade from "./marketplace-types/marketplace-handmade-v1.webp";
import marketplaceService from "./marketplace-types/marketplace-service-v1.webp";
import marketplaceSnackBundle from "./marketplace-types/marketplace-snack-bundle-v1.webp";
import marketplaceSquishyPlush from "./marketplace-types/marketplace-squishy-plush-v1.webp";
import marketplaceUsedStationery from "./marketplace-types/marketplace-used-stationery-v1.webp";

export const PRODUCT_TYPE_ASSETS = {
  candy,
  snack,
  drink,
  stationery,
  coupon,
  role,
  game,
  gift,
  reward,
  randomBox,
  randomBoxPremium,
  vipBenefitLearning,
  vipBenefitPriority,
  vipBenefitReward,
  vipLoungeCrest,
  marketplaceCollectibles,
  marketplaceHandmade,
  marketplaceService,
  marketplaceSnackBundle,
  marketplaceSquishyPlush,
  marketplaceUsedStationery,
};

export const PRODUCT_TYPE_ASSET_OPTIONS = [
  { value: "auto", label: "기본 보상", assetKey: "reward" },
  { value: "none", label: "없음", assetKey: null },
  { value: "vipLoungeCrest", label: "VIP 특전 · 문장", assetKey: "vipLoungeCrest" },
  { value: "vipBenefitPriority", label: "VIP 특전 · 우선권", assetKey: "vipBenefitPriority" },
  { value: "vipBenefitReward", label: "VIP 특전 · 선물", assetKey: "vipBenefitReward" },
  { value: "vipBenefitLearning", label: "VIP 특전 · 학습", assetKey: "vipBenefitLearning" },
  { value: "candy", label: "캔디·젤리", assetKey: "candy" },
  { value: "snack", label: "과자·스낵", assetKey: "snack" },
  { value: "drink", label: "음료", assetKey: "drink" },
  { value: "stationery", label: "문구", assetKey: "stationery" },
  { value: "coupon", label: "쿠폰·혜택", assetKey: "coupon" },
  { value: "role", label: "역할·교실 권한", assetKey: "role" },
  { value: "game", label: "게임·이벤트", assetKey: "game" },
  { value: "gift", label: "선물", assetKey: "gift" },
];

export const MARKETPLACE_TYPE_ASSET_OPTIONS = [
  { value: "auto", label: "상품명으로 자동 선택", assetKey: "reward" },
  { value: "marketplaceSnackBundle", label: "간식·쿠키·음료", assetKey: "marketplaceSnackBundle" },
  { value: "marketplaceSquishyPlush", label: "스퀴시·인형·완구", assetKey: "marketplaceSquishyPlush" },
  { value: "marketplaceCollectibles", label: "키링·포카·스티커", assetKey: "marketplaceCollectibles" },
  { value: "marketplaceUsedStationery", label: "중고 문구·학용품", assetKey: "marketplaceUsedStationery" },
  { value: "marketplaceHandmade", label: "그림·레진·수공예", assetKey: "marketplaceHandmade" },
  { value: "marketplaceService", label: "서비스·이용권", assetKey: "marketplaceService" },
  { value: "stationery", label: "책·문제집", assetKey: "stationery" },
  { value: "gift", label: "기타 물품", assetKey: "gift" },
];

const MARKETPLACE_ASSET_KEYWORD_GROUPS = [
  ["marketplaceSnackBundle", ["쿠키", "과자", "간식", "사탕", "젤리", "초콜릿", "라면땅", "아이스티", "음료", "캔디", "빵"]],
  ["marketplaceSquishyPlush", ["스퀴시", "말랑", "인형", "장난감", "피규어", "캡슐", "뽑기"]],
  ["marketplaceCollectibles", ["키링", "포카", "포토카드", "스티커", "굿즈", "카드", "딱지"]],
  ["marketplaceUsedStationery", ["지우개", "연필", "샤프", "볼펜", "필통", "노트", "공책", "학용품", "문구", "색연필", "자"]],
  ["marketplaceHandmade", ["그림", "레진", "뜨개", "수공예", "종이접기", "만들기", "양말목", "제작"]],
  ["marketplaceService", ["청소권", "그려드림", "대여", "신청", "골라주기", "알려주기", "진단", "쿠폰", "이용권", "권한"]],
  ["stationery", ["책", "도서", "문제집", "교과서", "만화"]],
];

const inferMarketplaceAssetKey = (item = {}) => {
  const searchableText = `${item.title || ""} ${item.description || ""} ${item.categoryName || ""}`.toLowerCase();
  return MARKETPLACE_ASSET_KEYWORD_GROUPS.find(([, keywords]) =>
    keywords.some((keyword) => searchableText.includes(keyword)),
  )?.[0] || "gift";
};

const LEGACY_PRODUCT_TYPE_ASSET_KEY_MAP = {
  Sparkles: "reward",
  Ticket: "coupon",
  Gift: "gift",
  Coffee: "drink",
  Cookie: "snack",
  BookOpen: "stationery",
  Gamepad2: "game",
  Trophy: "reward",
  Palette: "reward",
  Crown: "role",
  Package: "gift",
  PackageOpen: "randomBox",
  Star: "reward",
};

const isRandomBoxProduct = (item = {}) =>
  item?.itemType === "randomBox" ||
  item?.itemType === "random_box" ||
  item?.functionTag === "random_box";

export const getProductTypeAssetKey = (item = {}) => {
  if (isRandomBoxProduct(item)) {
    return item?.randomBoxConfig?.boxType === "premium"
      ? "randomBoxPremium"
      : "randomBox";
  }

  const selectedAssetKey = String(item.itemIcon || "").trim();
  if (PRODUCT_TYPE_ASSETS[selectedAssetKey]) return selectedAssetKey;
  if (LEGACY_PRODUCT_TYPE_ASSET_KEY_MAP[selectedAssetKey]) {
    return LEGACY_PRODUCT_TYPE_ASSET_KEY_MAP[selectedAssetKey];
  }
  if (item.itemType === "ticket") return "game";
  if (item.assetContext === "marketplace") return inferMarketplaceAssetKey(item);
  return "reward";
};

export const getProductTypeAsset = (item = {}) =>
  PRODUCT_TYPE_ASSETS[getProductTypeAssetKey(item)] || PRODUCT_TYPE_ASSETS.reward;
