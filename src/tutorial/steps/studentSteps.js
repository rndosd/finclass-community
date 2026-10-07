// src/tutorial/steps/studentSteps.js

export const studentSteps = [
  {
    target: "body",
    title: "학생 등록 안내",
    content: "학생 계정을 등록하는 두 가지 방법을 차례대로 안내해 드릴게요!",
  },

  // --- [방법 1] 엑셀 일괄 등록 (이미지 1 구역 전체) ---
  {
    target: '[data-tour="student-method1-full"]', // 🟦 방법 1 전체 시원한 박스
    title: "방법 1. 엑셀로 간편하게 등록",
    content:
      "학생이 많을 때 추천하는 방식입니다. 이 구역에서 엑셀 파일을 통해 한 번에 등록하세요.",
  },
  {
    target: '[data-tour="student-sample-download"]', // 📍 샘플 다운로드 버튼
    title: "1. 양식 다운로드",
    content:
      "먼저 이 버튼을 눌러 정해진 엑셀 양식을 내려받으세요. 양식에 맞게 작성해야 오류가 없습니다.",
  },
  {
    // 🌟 엑셀 파일 선택 단계 복구
    target: '[data-tour="student-file-select"]', // 📍 엑셀 파일 선택 버튼
    title: "2. 파일 업로드",
    content:
      "작성한 파일을 이 버튼을 눌러 선택하세요. 명단이 아래 표에 자동으로 채워집니다.",
  },

  // --- [방법 2] 직접 정보 입력 (이미지 2 구역 전체) ---
  {
    // 🟦 스크린샷처럼 방법 2 카드 전체를 시원하게 강조
    target: '[data-tour="student-method2-full"]',
    title: "방법 2. 직접 정보 입력하기",
    content:
      "파일 없이 한 명씩 직접 입력하고 싶을 때 사용하세요. 이 구역 전체가 입력창입니다.",
  },
  {
    // 📍 이후 한 줄만 정밀 강조 (줌 인)
    target: '[data-tour="student-input-row"]',
    title: "데이터 직접 입력",
    content:
      "표의 첫 줄부터 정보를 입력하세요. 학번, 이름, 이메일 등을 칸마다 클릭해 작성할 수 있습니다.",
    popover: { side: "bottom", align: "start" },
  },
  {
    target: '[data-tour="student-add-row"]',
    title: "행 추가",
    content: "입력할 칸이 부족하다면 이 버튼을 눌러 줄을 늘리세요.",
  },

  // --- [마무리] 제출 구역 ---
  {
    target: '[data-tour="student-submit-full"]', // 🟦 하단 제출바 전체 강조
    title: "등록 완료하기",
    content:
      "모든 정보가 준비되었다면 이 구역의 버튼을 눌러 계정 생성을 마무리하세요!",
  },
  {
    target: '[data-tour="student-register-submit"]', // 📍 최종 버튼 강조
    title: "계정 일괄 생성 시작",
    content:
      "이 버튼을 누르면 학생들의 계정이 생성되며, 결과 피드백을 바로 확인할 수 있습니다.",
  },
];
