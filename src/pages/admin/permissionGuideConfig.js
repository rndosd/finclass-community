import { PERMISSION_CONFIG } from "./PermissionConfig";
import { sortPermissionsByDisplayName } from "./permissionLayoutUtils";

export const PERMISSION_GUIDE_INTRO = [
  "(보기) 권한은 해당 메뉴와 페이지에 들어갈 수 있는 기본 접근 권한입니다.",
  "교사와 관리자는 대부분의 기능을 자동으로 사용할 수 있습니다.",
  "아래 설명은 현재 코드 기준으로 각 권한이 실제로 어디까지 열리는지 정리한 안내입니다.",
];

export const PERMISSION_GUIDE_SCOPE_META = {
  page: {
    label: "기본 접근",
    tone: "slate",
  },
  manage: {
    label: "전체 관리",
    tone: "indigo",
  },
  partial: {
    label: "부분 운영",
    tone: "blue",
  },
  limited: {
    label: "제한적 운영",
    tone: "amber",
  },
};

const GUIDE_BY_KEY = {
  page_bank_view: {
    scope: "page",
    summary: "은행 페이지에 들어가 계좌 조회, 입출금, 기본 금융 기능을 사용할 수 있습니다.",
    teacherGap: "거래 승인이나 상품 운영은 별도 관리자 권한이 필요합니다.",
  },
  bank_admin: {
    scope: "manage",
    summary: "은행 운영, 거래 관리, 상품 관리까지 폭넓게 다룰 수 있습니다.",
    teacherGap: "교사와 거의 같은 수준으로 은행 기능을 운영합니다.",
  },
  action_bank_transfer: {
    scope: "partial",
    summary: "은행 페이지 안에서 송금 기능만 추가로 사용할 수 있습니다.",
    teacherGap: "페이지 접근 권한이 없으면 이 권한만으로는 화면에 들어갈 수 없습니다.",
  },
  asset_manager_view: {
    scope: "partial",
    summary: "학급 전체 학생의 자산 현황과 경제 통계를 조회할 수 있습니다.",
    teacherGap: "수정 기능은 포함되지 않습니다.",
  },
  asset_manager_manage: {
    scope: "partial",
    summary: "학생 자산 금액을 직접 조정할 수 있습니다.",
    teacherGap: "일부 운영 화면은 교사 전용으로 남아 있을 수 있습니다.",
  },
  page_tax_view: {
    scope: "page",
    summary: "국세청 페이지에 들어가 국고 현황, 세금 규칙, 공제 관련 화면을 볼 수 있습니다.",
    teacherGap: "세율 수정이나 정산 실행은 관리자 권한이 필요합니다.",
  },
  tax_admin: {
    scope: "manage",
    summary: "세금 규칙, 자동 공제 정책, 기간 소득 정산, 국고 운영 기능을 관리합니다.",
    teacherGap: "직업 정의나 급여 지급은 노동청 관리자 권한으로 분리되었습니다.",
  },
  page_labor_view: {
    scope: "page",
    summary: "노동청 페이지에 들어가 직업 정의, 지원 현황, 급여 지급 화면을 볼 수 있습니다.",
    teacherGap: "실제 수정이나 지급 실행은 관리자 권한이 필요합니다.",
  },
  labor_admin: {
    scope: "manage",
    summary: "직업 정의 수정, 지원 검토, 급여 지급과 직업 배정 변경을 관리합니다.",
    teacherGap: "세율 정책이나 소득 정산은 국세청 관리자 권한으로 분리되었습니다.",
  },
  page_police_view: {
    scope: "page",
    summary: "경찰청 페이지의 공개 범위 기능을 볼 수 있습니다.",
    teacherGap: "벌점 부과나 신고 처리는 관리자 권한이 필요합니다.",
  },
  permission_group_police: {
    scope: "partial",
    summary: "신고 처리, 벌금·상금 부과, 반성문 검토 등 경찰 운영 기능을 사용할 수 있습니다.",
    teacherGap: "학급 규칙 추가·수정·삭제와 공개 설정은 경찰 규칙 관리자 권한으로 분리되었습니다.",
  },
  police_rules_manage: {
    scope: "partial",
    summary: "경찰 규칙 추가·수정·삭제·순서 변경과 위험도·공개 설정을 관리합니다.",
    teacherGap: "신고 처리나 벌금·상금 부과는 경찰 운영 관리자 권한이 별도로 필요합니다.",
  },
  page_store_view: {
    scope: "page",
    summary: "상점 페이지 접근과 기본 구매 기능을 사용할 수 있습니다.",
    teacherGap: "상품 편집은 관리자 권한이 필요합니다.",
  },
  store_admin: {
    scope: "manage",
    summary: "상품과 카테고리, POS, 상점 운영 기능을 관리합니다.",
    teacherGap: "교사와 거의 같은 수준으로 상점을 운영합니다.",
  },
  page_stock_view: {
    scope: "page",
    summary: "주식 페이지에 들어가 기본 투자 기능을 사용할 수 있습니다.",
    teacherGap: "현재는 별도 운영 권한이 적어 학생용 접근 성격이 강합니다.",
  },
  page_credit_view: {
    scope: "page",
    summary: "신용 페이지에서 신용 점수와 기록을 확인할 수 있습니다.",
    teacherGap: "점수 조정은 관리자 권한이 필요합니다.",
  },
  credit_admin: {
    scope: "manage",
    summary: "학생 신용 점수와 기준을 직접 관리합니다.",
    teacherGap: "교사와 유사한 운영 범위를 가집니다.",
  },
  page_assembly_view: {
    scope: "page",
    summary: "의회 페이지에서 법안과 투표 현황을 볼 수 있습니다.",
    teacherGap: "법안 작성과 운영은 별도 권한이 필요합니다.",
  },
  assembly_member: {
    scope: "partial",
    summary: "의회에서 법안을 제안할 수 있습니다.",
    teacherGap: "운영 권한 전체를 뜻하지는 않습니다.",
  },
  page_mission_view: {
    scope: "page",
    summary: "과제 페이지 접근과 기본 수행 기능을 사용할 수 있습니다.",
    teacherGap: "승인과 운영은 관리자 권한이 필요합니다.",
  },
  mission_admin: {
    scope: "partial",
    summary: "과제 승인과 관리 화면을 사용할 수 있습니다.",
    teacherGap: "일부 교사 전용 운영 화면은 별도로 남아 있을 수 있습니다.",
  },
  page_credentials_view: {
    scope: "page",
    summary: "칭호 자격증 페이지에서 공개된 칭호와 자격 정보를 볼 수 있습니다.",
    teacherGap: "발급과 수정은 운영 권한이 필요합니다.",
  },
  credentials_admin: {
    scope: "partial",
    summary:
      "학생별 칭호·자격증 현황을 확인하고 지급·회수와 요청 승인·반려를 처리할 수 있습니다.",
    teacherGap:
      "칭호·자격증 제작은 칭호 제작자 권한이 필요하며, 삭제와 등급·카테고리 전체 설정은 교사만 가능합니다.",
  },
  credentials_designer: {
    scope: "partial",
    summary:
      "기존 관리 화면에서 칭호·자격증을 만들고 수정하며, 외형과 표시 순서를 변경하고 정해진 등급·카테고리를 선택할 수 있습니다.",
    teacherGap:
      "학생별 현황, 지급·회수와 요청 승인은 칭호 운영자 권한이 필요하며, 삭제와 등급·카테고리 전체 설정은 교사만 가능합니다.",
  },
  page_job_board_view: {
    scope: "page",
    summary: "구인 게시판에 들어가 공고와 게시글을 볼 수 있습니다.",
    teacherGap: "운영 기능이 별도로 열리는 구조는 아닙니다.",
  },
  page_news_view: {
    scope: "page",
    summary: "뉴스 페이지 접근과 기사 열람 기능을 사용할 수 있습니다.",
    teacherGap: "기사 작성과 편집은 관리자 권한이 필요합니다.",
  },
  news_admin: {
    scope: "manage",
    summary: "기사 작성, 카테고리 관리, 뉴스 운영 기능을 관리합니다.",
    teacherGap: "교사와 거의 같은 수준으로 운영합니다.",
  },
  page_realestate_view: {
    scope: "page",
    summary: "부동산 페이지에서 기본 열람과 거래 기능을 사용할 수 있습니다.",
    teacherGap: "운영 정책 수정은 관리자 권한이 필요합니다.",
  },
  realestate_admin: {
    scope: "limited",
    summary: "부동산 운영 관련 일부 관리 기능을 사용할 수 있습니다.",
    teacherGap: "현재 화면 구조상 교사 전용 기능이 일부 남아 있을 수 있습니다.",
  },
  page_marketplace_view: {
    scope: "page",
    summary: "마켓 페이지에서 물건 등록과 거래를 할 수 있습니다.",
    teacherGap: "전체 거래 관리나 승인 기능은 관리자 권한이 필요합니다.",
  },
  marketplace_admin: {
    scope: "partial",
    summary: "마켓 승인과 거래 관리 기능을 사용할 수 있습니다.",
    teacherGap: "교사 전용 정산 기능은 별도로 남아 있을 수 있습니다.",
  },
  page_arcade_view: {
    scope: "page",
    summary: "놀이터 페이지에 들어가 게임 기능을 사용할 수 있습니다.",
    teacherGap: "현재는 별도 운영 권한이 거의 없습니다.",
  },
};

export const PERMISSION_GUIDE_ITEMS = sortPermissionsByDisplayName(PERMISSION_CONFIG).map((permission) => ({
  ...permission,
  ...(GUIDE_BY_KEY[permission.key] || {
    scope: "page",
    summary: "해당 페이지 또는 기능에 접근할 수 있습니다.",
    teacherGap: "세부 동작은 현재 화면 구성에 따라 달라질 수 있습니다.",
  }),
}));
