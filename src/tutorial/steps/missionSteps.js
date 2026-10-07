const getActiveMissionRole = () => {
  if (typeof document === "undefined") return "teacher";

  return (
    document.querySelector('[data-tour="mission-role-toggle"]')?.dataset?.activeRole ||
    "teacher"
  );
};

const MISSION_STEP_VARIANTS = {
  student: [
    {
      target: '[data-tour="mission-content"]',
      title: "과제 목록",
      content: "내 과제 목록과 제출 상태를 확인합니다.",
    },
    {
      target: '[data-tour="mission-panel"]',
      title: "진행 흐름",
      content: "완료, 제출, 보상 흐름을 이어서 확인합니다.",
    },
  ],
  teacher: [
    {
      target: '[data-tour="mission-role-toggle"]',
      title: "보기 전환",
      content: "학생 보기와 교사 보기를 전환합니다.",
    },
    {
      target: '[data-tour="mission-content"]',
      title: "과제 관리",
      content: "과제 생성, 제출, 승인 현황을 확인합니다.",
    },
    {
      target: '[data-tour="mission-panel"]',
      title: "진행 패널",
      content: "학생별 진행 상태와 반복 과제를 함께 봅니다.",
    },
  ],
};

export const getMissionTutorialSteps = () => {
  const activeRole = getActiveMissionRole();
  return MISSION_STEP_VARIANTS[activeRole] || MISSION_STEP_VARIANTS.teacher;
};

export const missionSteps = MISSION_STEP_VARIANTS.teacher;
