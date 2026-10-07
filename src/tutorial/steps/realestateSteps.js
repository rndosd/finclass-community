const getActiveRealEstateTab = () => {
  if (typeof document === "undefined") return "classroom";

  return (
    document.querySelector('[data-tour="realestate-tabs"]')?.dataset?.activeTab ||
    "classroom"
  );
};

const REAL_ESTATE_STEP_VARIANTS = {
  classroom: [
    {
      target: '[data-tour="realestate-tabs"]',
      title: "탭 이동",
      content: "교실, 경매, 내 부동산, 보유세, 관리, 정책 탭을 나눠 봅니다.",
    },
    {
      target: '[data-tour="realestate-content"]',
      title: "교실 배치",
      content: "교실 배치와 현재 소유 현황을 확인합니다.",
    },
  ],
  auction: [
    {
      target: '[data-tour="realestate-content"]',
      title: "경매 현황",
      content: "경매 진행 상황과 입찰 대상을 확인합니다.",
    },
  ],
  my: [
    {
      target: '[data-tour="realestate-content"]',
      title: "보유 자리",
      content: "보유 자리와 계약 상태를 확인합니다.",
    },
  ],
  holding: [
    {
      target: '[data-tour="realestate-content"]',
      title: "보유세",
      content: "보유세 계산 결과와 대상 목록을 확인합니다.",
    },
  ],
  manage: [
    {
      target: '[data-tour="realestate-content"]',
      title: "운영 도구",
      content: "자리 편집과 운영 도구를 확인합니다.",
    },
  ],
  policy: [
    {
      target: '[data-tour="realestate-content"]',
      title: "정책 기준",
      content: "정책 기준과 적용 규칙을 확인합니다.",
    },
  ],
};

export const getRealEstateTutorialSteps = () => {
  const activeTab = getActiveRealEstateTab();
  return REAL_ESTATE_STEP_VARIANTS[activeTab] || REAL_ESTATE_STEP_VARIANTS.classroom;
};

export const realestateSteps = REAL_ESTATE_STEP_VARIANTS.classroom;
