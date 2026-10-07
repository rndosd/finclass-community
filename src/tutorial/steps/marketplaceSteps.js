const getActiveMarketplaceTab = () => {
  if (typeof document === "undefined") return "market";

  return (
    document.querySelector('[data-tour="marketplace-tabs"]')?.dataset?.activeTab || "market"
  );
};

const MARKETPLACE_STEP_VARIANTS = {
  market: [
    {
      target: '[data-tour="marketplace-actions"]',
      title: "거래 도구",
      content: "물품 등록, 경매 출품, 거래 내역을 엽니다.",
    },
    {
      target: '[data-tour="marketplace-tabs"]',
      title: "거래 전환",
      content: "장터와 경매 화면을 탭으로 나눠 봅니다.",
    },
    {
      target: '[data-tour="marketplace-content"]',
      title: "장터 목록",
      content: "카테고리, 상태 필터, 물품 목록을 함께 봅니다.",
    },
  ],
  auction: [
    {
      target: '[data-tour="marketplace-content"]',
      title: "경매 목록",
      content: "수수료 설정과 진행 중인 경매를 함께 봅니다.",
    },
  ],
};

export const getMarketplaceTutorialSteps = () => {
  const activeTab = getActiveMarketplaceTab();
  return MARKETPLACE_STEP_VARIANTS[activeTab] || MARKETPLACE_STEP_VARIANTS.market;
};

export const marketplaceSteps = MARKETPLACE_STEP_VARIANTS.market;
