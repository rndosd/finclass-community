import { isCaseLibraryTemplateVisible } from "./caseLibraryAccess";

const sharedTemplateExcludedData = [
  "학생 개인정보와 학급 운영 기록",
];

const caseLibraryAllPageMeta = {
  label: "전체",
  tone: "slate",
  description:
    "FinClass 안에서 공유된 운영사례를 한곳에서 모아보고, 필요한 글은 템플릿과 함께 참고할 수 있습니다.",
};

export const caseLibraryPageRegistry = [
  {
    id: "operation-tips",
    label: "경제교실 팁",
    tone: "teal",
    description:
      "특정 페이지에만 묶이지 않는 경제교실 운영 팁, 연수 메모, 학급 운영 노하우를 공유하는 공간입니다.",
    postEnabled: true,
    templateEnabled: false,
  },
  {
    id: "police",
    label: "경찰",
    tone: "rose",
    description:
      "경찰 페이지 운영사례와 규칙 설계 노하우를 공유합니다.",
    postEnabled: true,
    templateEnabled: true,
    templateScopeOptions: [
      {
        id: "policeRules",
        label: "경찰 규칙",
        description:
          "규칙 내용, 현금 변화, 신용점수 변화, 설명, 위험도",
        required: true,
      },
    ],
    templateExcludedData: sharedTemplateExcludedData,
    templateTargetHint:
      "현재 학급의 경찰 규칙만 템플릿으로 가져오며, 신고나 벌점 기록은 포함되지 않습니다.",
  },
  {
    id: "bank",
    label: "은행",
    tone: "blue",
    description:
      "은행 상품 구성과 핵심 운영 설정을 공유합니다.",
    postEnabled: true,
    templateEnabled: true,
    templateScopeOptions: [
      {
        id: "depositProducts",
        label: "예금 상품",
        description: "예금 상품명, 기간, 금리, 제한 조건",
      },
      {
        id: "loanProducts",
        label: "대출 상품",
        description: "대출 상품명, 기간, 금리, 제한 조건",
      },
      {
        id: "subscriptionProducts",
        label: "청약 상품",
        description: "청약 상품명, 납입 주기, 금리 설정",
      },
      {
        id: "generalPolicies",
        label: "핵심 운영 설정",
        description: "자동 승인, 대출 한도 비율, 금액 표시 방식",
      },
    ],
    templateExcludedData: sharedTemplateExcludedData,
    templateTargetHint:
      "은행 상품과 핵심 운영 설정만 가져오며, 학생별 거래 내역은 포함되지 않습니다.",
  },
  {
    id: "store",
    label: "상점",
    tone: "emerald",
    description:
      "상점 카테고리, 상품 구성, 가격과 판매 규칙을 공유합니다.",
    postEnabled: true,
    templateEnabled: true,
    templateScopeOptions: [
      {
        id: "categories",
        label: "카테고리",
        description: "상점 카테고리와 순서",
      },
      {
        id: "catalog",
        label: "상품 구성",
        description: "상품명, 설명, 카테고리, 상품 유형",
      },
      {
        id: "pricing",
        label: "가격과 재고",
        description: "가격, 재고, 세금 적용 여부",
      },
      {
        id: "salesRules",
        label: "판매 규칙",
        description: "판매 상태, 구매 제한, 랜덤박스/타임세일 규칙",
      },
    ],
    templateExcludedData: sharedTemplateExcludedData,
    templateTargetHint:
      "상점 카테고리와 상품 설정만 가져오며, 학생별 구매 기록은 포함되지 않습니다.",
  },
  {
    id: "tax",
    label: "세금",
    tone: "amber",
    description:
      "세금 규칙, 자동 세금 설정, 소득 정산 정책을 공유합니다.",
    postEnabled: true,
    templateEnabled: true,
    templateScopeOptions: [
      {
        id: "taxRules",
        label: "세금 규칙",
        description: "세금 규칙 이름, 계산 방식, 대상 설정",
        required: true,
      },
      {
        id: "autoTaxPolicy",
        label: "자동 세금 설정",
        description: "자동 공제와 국고 반영 설정",
      },
      {
        id: "incomeSettlement",
        label: "소득 정산 설정",
        description: "소득원별 정산 기준과 세율",
      },
    ],
    templateExcludedData: sharedTemplateExcludedData,
    templateTargetHint:
      "세금 규칙과 정책 설정만 가져오며, 실제 징수 내역은 포함되지 않습니다.",
  },
  {
    id: "credentials",
    label: "칭호",
    tone: "violet",
    description:
      "칭호 정의, 등급, 카테고리, 수집 단계 설정을 공유합니다.",
    postEnabled: true,
    templateEnabled: true,
    templateScopeOptions: [
      {
        id: "titleSettings",
        label: "칭호 정의와 설정",
        description: "칭호 정의, 등급, 카테고리, 수집 단계",
        required: true,
      },
    ],
    templateExcludedData: sharedTemplateExcludedData,
    templateTargetHint:
      "현재 학급의 칭호 정의와 설정만 가져오며, 학생별 보유 칭호와 요청 기록은 포함되지 않습니다.",
  },
  {
    id: "labor",
    label: "노동청",
    tone: "orange",
    description:
      "노동청 운영사례와 직업 페이지 활용법을 공유합니다.",
    postEnabled: true,
    templateEnabled: false,
  },
  {
    id: "realestate",
    label: "부동산",
    tone: "indigo",
    description:
      "부동산 페이지 운영사례와 계약 활동 팁을 공유합니다.",
    postEnabled: true,
    templateEnabled: false,
  },
  {
    id: "arcade",
    label: "놀이터",
    tone: "sky",
    description:
      "놀이터 페이지 운영사례와 보상 설계를 공유합니다.",
    postEnabled: true,
    templateEnabled: false,
  },
  {
    id: "credit",
    label: "신용",
    tone: "cyan",
    description:
      "신용 페이지 운영사례와 등급 운영법을 공유합니다.",
    postEnabled: true,
    templateEnabled: false,
  },
  {
    id: "stock",
    label: "주식",
    tone: "slate",
    description:
      "주식 페이지 운영사례와 발표 흐름을 공유합니다.",
    postEnabled: true,
    templateEnabled: false,
  },
  {
    id: "missions",
    label: "과제",
    tone: "amber",
    description:
      "과제 페이지 운영사례를 공유합니다.",
    postEnabled: true,
    templateEnabled: false,
  },
  {
    id: "marketplace",
    label: "중고시장",
    tone: "teal",
    description:
      "중고시장 페이지 운영사례를 공유합니다.",
    postEnabled: true,
    templateEnabled: false,
  },
  {
    id: "assembly",
    label: "국회",
    tone: "pink",
    description:
      "국회 페이지 운영사례를 공유합니다.",
    postEnabled: true,
    templateEnabled: false,
  },
  {
    id: "news",
    label: "뉴스",
    tone: "red",
    description:
      "뉴스 페이지 활용 사례와 운영 흐름을 공유합니다.",
    postEnabled: true,
    templateEnabled: false,
  },
  {
    id: "job-board",
    label: "구인게시판",
    tone: "lime",
    description:
      "구인게시판 페이지 운영사례를 공유합니다.",
    postEnabled: true,
    templateEnabled: false,
  },
];

export const caseLibraryPageRegistryMap = Object.fromEntries(
  caseLibraryPageRegistry.map((page) => [page.id, page]),
);

export const caseLibraryPageMeta = {
  all: caseLibraryAllPageMeta,
  ...Object.fromEntries(
    caseLibraryPageRegistry.map((page) => [
      page.id,
      {
        label: page.label,
        tone: page.tone,
        description: page.description,
      },
    ]),
  ),
};

export const caseLibraryCategories = [
  { id: "all", label: caseLibraryAllPageMeta.label },
  ...caseLibraryPageRegistry
    .filter((page) => page.postEnabled)
    .map((page) => ({ id: page.id, label: page.label })),
];

export const composerPageTypes = caseLibraryPageRegistry
  .filter((page) => page.postEnabled)
  .map((page) => page.id);

export const composerPageMeta = Object.fromEntries(
  composerPageTypes.map((pageType) => [pageType, caseLibraryPageMeta[pageType]]),
);

export const composerTemplateScopes = Object.fromEntries(
  caseLibraryPageRegistry.map((page) => [page.id, page.templateScopeOptions || []]),
);

export function getCaseLibraryPageConfig(pageType) {
  const pageConfig = caseLibraryPageRegistryMap[pageType] || null;
  if (!pageConfig) {
    return null;
  }

  return {
    ...pageConfig,
    templateEnabled: Boolean(
      pageConfig.templateEnabled && isCaseLibraryTemplateVisible(pageType),
    ),
  };
}

export function getDefaultTemplateScopeIds(pageType) {
  const scopeOptions = composerTemplateScopes[pageType] || [];
  const requiredScopeIds = scopeOptions
    .filter((scope) => scope.required)
    .map((scope) => scope.id);

  if (requiredScopeIds.length > 0) {
    return requiredScopeIds;
  }

  return scopeOptions.map((scope) => scope.id);
}

export function buildCaseLibraryTemplateMeta(pageType, selectedScopeIds = []) {
  const pageConfig = getCaseLibraryPageConfig(pageType);
  if (!pageConfig?.templateEnabled) {
    return null;
  }

  const scopeOptions = pageConfig.templateScopeOptions || [];
  const requiredScopeIds = scopeOptions
    .filter((scope) => scope.required)
    .map((scope) => scope.id);
  const scopeIdSet = new Set([...requiredScopeIds, ...selectedScopeIds]);
  const includedScopes = scopeOptions
    .filter((scope) => scopeIdSet.has(scope.id))
    .map((scope) => scope.label);

  return {
    pageType,
    scopeIds: Array.from(scopeIdSet),
    includedScopes,
    excludedScopes: pageConfig.templateExcludedData || [],
    targetHint: pageConfig.templateTargetHint || "",
  };
}
