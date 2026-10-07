const getActiveStockTab = () => {
  if (typeof document === "undefined") return "overview";

  return document.querySelector('[data-tour="stock-tabs"]')?.dataset?.activeTab || "overview";
};

const STOCK_STEP_VARIANTS = {
  overview: [
    {
      target: '[data-tour="stock-actions"]',
      title: "상단 관리",
      content: "주식 정보, 배당 설정, 시장 설정을 한 번에 엽니다.",
    },
    {
      target: '[data-tour="stock-overview-summary"]',
      title: "자산 요약",
      content: "FIN 잔액, 학급 화폐 잔액, 환율, 평가액을 함께 봅니다.",
    },
    {
      target: '[data-tour="stock-overview-movers"]',
      title: "시장 변화",
      content: "상승·하락 흐름과 숨김 종목 상태를 확인합니다.",
    },
    {
      target: '[data-tour="stock-overview-portfolio"]',
      title: "보유 종목",
      content: "상위 보유 종목과 평가 손익을 비교합니다.",
    },
  ],
  market: [
    {
      target: '[data-tour="stock-market-filters"]',
      title: "탐색 필터",
      content: "검색, 관심종목, 그룹 필터, 카테고리 칩으로 종목을 좁힙니다.",
    },
    {
      target: '[data-tour="stock-market-grid"]',
      title: "종목 카드",
      content: "종목 카드에서 정보 확인, 차트, 매수로 이어집니다.",
    },
  ],
};

export const getStockTutorialSteps = () => {
  const activeTab = getActiveStockTab();
  return STOCK_STEP_VARIANTS[activeTab] || STOCK_STEP_VARIANTS.overview;
};

export const stockSteps = STOCK_STEP_VARIANTS.overview;
