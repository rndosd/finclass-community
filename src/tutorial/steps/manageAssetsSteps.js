const getActiveManageAssetsTab = () => {
  if (typeof document === "undefined") return "assets";

  return (
    document.querySelector('[data-tour="manage-assets-tabs"]')?.dataset?.activeTab ||
    "assets"
  );
};

const MANAGE_ASSETS_STEP_VARIANTS = {
  assets: [
    {
      target: '[data-tour="manage-assets-actions"]',
      title: "내보내기",
      content: "현재 보고 있는 자산 데이터를 바로 내보냅니다.",
    },
    {
      target: '[data-tour="manage-assets-tabs"]',
      title: "보기 전환",
      content: "현황과 통계 화면을 탭으로 나눠 봅니다.",
    },
    {
      target: '[data-tour="manage-assets-content"]',
      title: "자산 표",
      content: "학생별 자산, 로그, 세부 창으로 이어집니다.",
    },
  ],
  statistics: [
    {
      target: '[data-tour="manage-assets-content"]',
      title: "통계 화면",
      content: "자산 지표와 반 전체 흐름을 비교합니다.",
    },
  ],
};

export const getManageAssetsTutorialSteps = () => {
  const activeTab = getActiveManageAssetsTab();
  return MANAGE_ASSETS_STEP_VARIANTS[activeTab] || MANAGE_ASSETS_STEP_VARIANTS.assets;
};

export const manageAssetsSteps = MANAGE_ASSETS_STEP_VARIANTS.assets;
