const getActiveManageDashboardTab = () => {
  if (typeof document === "undefined") return "cards";

  return (
    document.querySelector('[data-tour="manage-dashboard-tabs"]')?.dataset?.activeTab ||
    "cards"
  );
};

const MANAGE_DASHBOARD_STEP_VARIANTS = {
  cards: [
    {
      target: '[data-tour="manage-dashboard-tabs"]',
      title: "설정 묶음",
      content: "카드 설정과 메뉴 설정을 탭으로 나눠 봅니다.",
    },
    {
      target: '[data-tour="manage-dashboard-content"]',
      title: "카드 설정",
      content: "노출 카드와 미리보기를 함께 확인합니다.",
    },
  ],
  menu: [
    {
      target: '[data-tour="manage-dashboard-content"]',
      title: "메뉴 설정",
      content: "메뉴 노출 여부와 구조를 확인합니다.",
    },
  ],
};

export const getManageDashboardTutorialSteps = () => {
  const activeTab = getActiveManageDashboardTab();
  return MANAGE_DASHBOARD_STEP_VARIANTS[activeTab] || MANAGE_DASHBOARD_STEP_VARIANTS.cards;
};

export const manageDashboardSteps = MANAGE_DASHBOARD_STEP_VARIANTS.cards;
