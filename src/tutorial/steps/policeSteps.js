const getActivePoliceTab = () => {
  if (typeof document === "undefined") return "rulesAndStudents";

  return (
    document.querySelector('[data-tour="police-tabs"]')?.dataset?.activeTab ||
    "rulesAndStudents"
  );
};

const POLICE_STEP_VARIANTS = {
  rulesAndStudents: [
    {
      target: '[data-tour="police-actions"]',
      title: "처리 도구",
      content: "신고 등록, 기록 부여, 표시 설정을 빠르게 엽니다.",
    },
    {
      target: '[data-tour="police-tabs"]',
      title: "경찰 흐름",
      content: "규칙, 신고, 기록, 통계를 탭으로 전환합니다.",
    },
    {
      target: '[data-tour="police-content"]',
      title: "규칙과 학생",
      content: "현재 규칙과 학생별 적용 흐름을 함께 봅니다.",
    },
  ],
  reports: [
    {
      target: '[data-tour="police-content"]',
      title: "신고 목록",
      content: "접수 건과 처리 대기 상태를 한 번에 봅니다.",
    },
  ],
  fineHistory: [
    {
      target: '[data-tour="police-content"]',
      title: "기록 이력",
      content: "학생별 기록과 기간 필터 결과를 확인합니다.",
    },
  ],
  stats: [
    {
      target: '[data-tour="police-content"]',
      title: "통계 비교",
      content: "학생별, 규칙별, 기간별 흐름을 함께 확인합니다.",
    },
  ],
};

export const getPoliceTutorialSteps = () => {
  const activeTab = getActivePoliceTab();
  return POLICE_STEP_VARIANTS[activeTab] || POLICE_STEP_VARIANTS.rulesAndStudents;
};

export const policeSteps = POLICE_STEP_VARIANTS.rulesAndStudents;
