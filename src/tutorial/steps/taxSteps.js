const getActiveTaxTab = () => {
  if (typeof document === "undefined") return "taxFinance";

  return document.querySelector('[data-tour="tax-tabs"]')?.dataset?.activeTab || "taxFinance";
};

const TAX_STEP_VARIANTS = {
  taxFinance: [
    {
      target: '[data-tour="tax-tabs"]',
      title: "세금 화면",
      content: "재정, 자동 세금, 월말정산, 규칙, 직업, 급여 화면을 전환합니다.",
    },
    {
      target: '[data-tour="tax-finance-summary"]',
      title: "국고 요약",
      content: "잔액, 수입·지출 합계, 납부 흐름을 확인합니다.",
    },
    {
      target: '[data-tour="tax-finance-management"]',
      title: "관리 도구",
      content: "수동 기록, 고지서 발급, 발급 내역을 관리합니다.",
    },
  ],
  autoTaxPolicy: [
    {
      target: '[data-tour="tax-auto-summary"]',
      title: "기본 설정",
      content: "자동 반영과 원천징수 정책을 한곳에서 정리합니다.",
    },
    {
      target: '[data-tour="tax-auto-treasury"]',
      title: "즉시 반영",
      content: "소득원별 국고 반영 여부를 카드별로 조정합니다.",
    },
    {
      target: '[data-tour="tax-auto-settlement"]',
      title: "원천징수 기준",
      content: "소득원별 원천징수 여부, 세율, 비과세 금액을 조정합니다.",
    },
  ],
  taxRules: [
    {
      target: '[data-tour="tax-rule-header"]',
      title: "규칙 도구",
      content: "규칙 새로고침과 추가를 여기서 진행합니다.",
    },
    {
      target: '[data-tour="tax-rule-table"]',
      title: "규칙 표",
      content: "규칙 이름, 방식, 세율, 적용 대상을 표에서 관리합니다.",
    },
  ],
  jobDefinitions: [
    {
      target: '[data-tour="tax-job-definition-table"]',
      title: "직업 표",
      content: "직업명, 설명, 주급을 표에서 수정합니다.",
    },
    {
      target: '[data-tour="tax-job-definition-upload"]',
      title: "엑셀 등록",
      content: "직업 정의를 엑셀로 한 번에 불러옵니다.",
    },
  ],
  jobApplications: [
    {
      target: '[data-tour="tax-job-application-summary"]',
      title: "지원 요약",
      content: "게시 직업, 대기 지원, 처리 완료 현황을 먼저 봅니다.",
    },
    {
      target: '[data-tour="tax-job-application-board"]',
      title: "지원 카드",
      content: "직업별 주급과 설명을 보고 바로 지원합니다.",
    },
    {
      target: '[data-tour="tax-job-application-review"]',
      title: "처리 현황",
      content: "지원 요청 승인이나 내 지원 내역을 확인합니다.",
    },
  ],
  payroll: [
    {
      target: '[data-tour="tax-payroll-period"]',
      title: "지급 기간",
      content: "급여 지급 기간과 주차를 설정합니다.",
    },
    {
      target: '[data-tour="tax-payroll-policy"]',
      title: "국고 연동",
      content: "급여 세금 규칙과 자동 세금 설정 연결을 확인합니다.",
    },
    {
      target: '[data-tour="tax-payroll-table"]',
      title: "급여 표",
      content: "직업 배정, 지급 상태, 즉시 지급, 성과급을 관리합니다.",
    },
  ],
  monthEndSettlement: [
    {
      target: '[data-tour="tax-content"]',
      title: "월말정산",
      content: "원천징수된 소득 기록을 모아 최종 납부 또는 환급을 준비합니다.",
    },
  ],
};

export const getTaxTutorialSteps = () => {
  const activeTab = getActiveTaxTab();
  return TAX_STEP_VARIANTS[activeTab] || TAX_STEP_VARIANTS.taxFinance;
};

export const taxSteps = TAX_STEP_VARIANTS.taxFinance;
