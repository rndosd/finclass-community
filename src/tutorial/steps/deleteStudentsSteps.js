const getActiveDeleteStudentsTab = () => {
  if (typeof document === "undefined") return "delete";

  return (
    document.querySelector('[data-tour="delete-students-tabs"]')?.dataset?.activeTab ||
    "delete"
  );
};

const DELETE_STUDENTS_STEP_VARIANTS = {
  delete: [
    {
      target: '[data-tour="delete-students-tabs"]',
      title: "작업 전환",
      content: "삭제 작업과 정리 안내를 탭으로 나눠 봅니다.",
    },
    {
      target: '[data-tour="delete-students-content"]',
      title: "삭제 대상",
      content: "선택한 학생과 처리 결과를 확인합니다.",
    },
  ],
  maintenance: [
    {
      target: '[data-tour="delete-students-content"]',
      title: "정리 범위",
      content: "삭제 후 남는 데이터와 수동 정리 범위를 봅니다.",
    },
  ],
};

export const getDeleteStudentsTutorialSteps = () => {
  const activeTab = getActiveDeleteStudentsTab();
  return DELETE_STUDENTS_STEP_VARIANTS[activeTab] || DELETE_STUDENTS_STEP_VARIANTS.delete;
};

export const deleteStudentsSteps = DELETE_STUDENTS_STEP_VARIANTS.delete;
