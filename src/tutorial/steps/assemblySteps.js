const getActiveAssemblyTab = () => {
  if (typeof document === "undefined") return "voting";

  return (
    document.querySelector('[data-tour="assembly-board-header"]')?.dataset?.activeTab ||
    "voting"
  );
};

const ASSEMBLY_STEP_VARIANTS = {
  voting: [
    {
      target: '[data-tour="assembly-top-grid"]',
      title: "상단 요약",
      content: "대표 안건과 최근 흐름을 먼저 봅니다.",
    },
    {
      target: '[data-tour="assembly-board-header"]',
      title: "투표 상태",
      content: "미투표 수와 현재 안건 흐름을 확인합니다.",
    },
    {
      target: '[data-tour="assembly-board-preview"]',
      title: "안건 목록",
      content: "진행 중인 안건과 투표 대상을 확인합니다.",
    },
  ],
  finished: [
    {
      target: '[data-tour="assembly-board-header"]',
      title: "종료 필터",
      content: "상태 필터와 완료 안건 흐름을 확인합니다.",
    },
    {
      target: '[data-tour="assembly-board-preview"]',
      title: "완료 목록",
      content: "완료된 안건과 필터 결과를 확인합니다.",
    },
  ],
};

export const getAssemblyTutorialSteps = () => {
  const activeTab = getActiveAssemblyTab();
  return ASSEMBLY_STEP_VARIANTS[activeTab] || ASSEMBLY_STEP_VARIANTS.voting;
};

export const assemblySteps = ASSEMBLY_STEP_VARIANTS.voting;
