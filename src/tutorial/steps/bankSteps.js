const getActiveBankTab = () => {
  if (typeof document === "undefined") return "main";

  return (
    document.querySelector('[data-tour="bank-tabs"]')?.dataset?.activeTab || "main"
  );
};

const BANK_STEP_VARIANTS = {
  main: [
    {
      target: '[data-tour="bank-actions"]',
      title: "상단 도구",
      content: "예금 시뮬레이터와 관리 바로가기를 엽니다.",
    },
    {
      target: '[data-tour="bank-tabs"]',
      title: "금융 화면",
      content: "메인, 예금, 대출, 청약, 관리 화면을 오갑니다.",
    },
    {
      target: '[data-tour="bank-main-summary"]',
      title: "자산 요약",
      content: "보유 현금, 신용 등급, 예금·대출 보정을 함께 봅니다.",
    },
    {
      target: '[data-tour="bank-main-transfer"]',
      title: "송금",
      content: "학생 간 송금과 현재 잔액 흐름을 확인합니다.",
    },
  ],
  deposit_apply: [
    {
      target: '[data-tour="bank-deposit-form"]',
      title: "가입 입력",
      content: "금액 입력과 상품 선택으로 예금 가입을 준비합니다.",
    },
    {
      target: '[data-tour="bank-deposit-products"]',
      title: "상품 카드",
      content: "가입 조건, 한도, 예상 수익을 비교합니다.",
    },
  ],
  loan_apply: [
    {
      target: '[data-tour="bank-loan-form"]',
      title: "신청 입력",
      content: "대출 금액과 상품을 고르고 신청을 준비합니다.",
    },
    {
      target: '[data-tour="bank-loan-products"]',
      title: "대출 카드",
      content: "상환 기간, 금리 우대, 한도를 비교합니다.",
    },
  ],
  subscription: [
    {
      target: '[data-tour="bank-subscription-products"]',
      title: "청약 상품",
      content: "청약 상품별 납입과 회차 진행을 비교합니다.",
    },
    {
      target: '[data-tour="bank-content"]',
      title: "청약 흐름",
      content: "진행 회차, 납입 내역, 추첨 결과를 함께 확인합니다.",
    },
  ],
  admin_management: [
    {
      target: '[data-tour="bank-admin-summary"]',
      title: "운영 개요",
      content: "승인 대기와 은행 운영 업무를 한눈에 봅니다.",
    },
    {
      target: '[data-tour="bank-admin-grid"]',
      title: "관리 카드",
      content: "상품, 승인, 현황, 청약, 우대 이율, 개별 한도를 관리합니다.",
    },
  ],
};

export const getBankTutorialSteps = () => {
  const activeTab = getActiveBankTab();
  return BANK_STEP_VARIANTS[activeTab] || BANK_STEP_VARIANTS.main;
};

export const bankSteps = BANK_STEP_VARIANTS.main;
