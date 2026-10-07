/**
 * Finclass 권한 설정 구성
 * 1. isToken: true  -> Auth custom claims 로 함께 내려가는 권한
 * 2. isToken: false -> DB 전용 보조 권한
 * 3. tokenKey: 토큰 압축용 3~4글자 키
 */

const ALL_PERMISSION_CONFIG = [
  // --- 은행 기능 (Blue) ---
  {
    key: "page_bank_view",
    label: "은행(보기)",
    group: "은행",
    color: "blue",
    isToken: true,
    tokenKey: "p_bnk",
  },
  {
    key: "bank_admin",
    label: "은행 관리자",
    group: "은행",
    color: "blue",
    isToken: true,
    tokenKey: "a_bnk",
  },
  {
    key: "action_bank_transfer",
    label: "송금 기능",
    group: "은행",
    color: "blue",
    isToken: true,
    tokenKey: "x_trf",
  },
  {
    key: "asset_manager_view",
    label: "학급 전체 자산 조회",
    group: "자산",
    color: "cyan",
    isToken: true,
    tokenKey: "p_ast",
  },
  {
    key: "asset_manager_manage",
    label: "자산 관리",
    group: "자산",
    color: "cyan",
    isToken: true,
    tokenKey: "a_ast",
  },

  // --- 국세청/노동청 기능 (Orange) ---
  {
    key: "page_tax_view",
    label: "국세청(보기)",
    group: "국세청",
    color: "orange",
    isToken: true,
    tokenKey: "p_tax",
  },
  {
    key: "tax_admin",
    label: "국세청 관리자",
    group: "국세청",
    color: "orange",
    isToken: true,
    tokenKey: "a_tax",
  },
  {
    key: "page_labor_view",
    label: "노동청(보기)",
    group: "노동청",
    color: "orange",
    isToken: true,
    tokenKey: "p_lbr",
  },
  {
    key: "labor_admin",
    label: "노동청 관리자",
    group: "노동청",
    color: "orange",
    isToken: true,
    tokenKey: "a_lbr",
  },

  // --- 경찰청 기능 (Red) ---
  {
    key: "page_police_view",
    label: "경찰청(보기)",
    group: "경찰청",
    color: "red",
    isToken: true,
    tokenKey: "p_pol",
  },
  {
    key: "permission_group_police",
    label: "경찰 운영 관리자",
    group: "경찰청",
    color: "red",
    isToken: true,
    tokenKey: "a_pol",
  },
  {
    key: "police_rules_manage",
    label: "경찰 규칙 관리자",
    group: "경찰청",
    color: "red",
    isToken: true,
    tokenKey: "a_prl",
  },

  // --- 상점 기능 (Emerald) ---
  {
    key: "page_store_view",
    label: "상점(보기)",
    group: "상점",
    color: "emerald",
    isToken: true,
    tokenKey: "p_str",
  },
  {
    key: "store_admin",
    label: "상점 관리자",
    group: "상점",
    color: "emerald",
    isToken: true,
    tokenKey: "a_str",
  },

  // --- 주식 기능 (Fuchsia) ---
  {
    key: "page_stock_view",
    label: "주식(보기)",
    group: "주식",
    color: "fuchsia",
    isToken: true,
    tokenKey: "p_stk",
  },

  // --- 신용 기능 (Purple) ---
  {
    key: "page_credit_view",
    label: "신용금융(보기)",
    group: "신용",
    color: "purple",
    isToken: true,
    tokenKey: "p_crd",
  },
  {
    key: "credit_admin",
    label: "신용 관리자",
    group: "신용",
    color: "purple",
    isToken: true,
    tokenKey: "a_crd",
  },

  // --- 의회 기능 (Indigo) ---
  {
    key: "page_assembly_view",
    label: "의회(보기)",
    group: "의회",
    color: "indigo",
    isToken: true,
    tokenKey: "p_asm",
  },
  {
    key: "assembly_member",
    label: "의회 의원 권한",
    group: "의회",
    color: "indigo",
    isToken: true,
    tokenKey: "a_asm",
  },

  // --- 미션 기능 (Rose) ---
  {
    key: "page_mission_view",
    label: "과제(보기)",
    group: "과제",
    color: "rose",
    isToken: true,
    tokenKey: "p_msn",
  },
  {
    key: "mission_admin",
    label: "과제 관리자",
    group: "과제",
    color: "rose",
    isToken: true,
    tokenKey: "a_msn",
  },

  // --- 칭호 자격증 기능 (Amber) ---
  {
    key: "page_credentials_view",
    label: "칭호 자격증(보기)",
    group: "칭호 자격증",
    color: "amber",
    isToken: true,
    tokenKey: "p_crt",
  },
  {
    key: "credentials_admin",
    label: "칭호 운영자",
    group: "칭호 자격증",
    color: "amber",
    isToken: true,
    tokenKey: "a_crt",
  },
  {
    key: "credentials_designer",
    label: "칭호 제작자",
    group: "칭호 자격증",
    color: "amber",
    isToken: true,
    tokenKey: "a_cds",
  },

  // --- 구인 게시판 기능 (Sky) ---
  {
    key: "page_job_board_view",
    label: "구인 게시판(보기)",
    group: "구인 게시판",
    color: "sky",
    isToken: true,
    tokenKey: "p_job",
  },

  // --- 뉴스 기능 (Teal) ---
  {
    key: "page_news_view",
    label: "뉴스(보기)",
    group: "뉴스",
    color: "teal",
    isToken: true,
    tokenKey: "p_nws",
  },
  {
    key: "news_admin",
    label: "뉴스 관리자",
    group: "뉴스",
    color: "teal",
    isToken: true,
    tokenKey: "a_nws",
  },

  // --- 부동산 기능 (Amber) ---
  {
    key: "page_realestate_view",
    label: "부동산(보기)",
    group: "부동산",
    color: "amber",
    isToken: true,
    tokenKey: "p_rst",
  },
  {
    key: "realestate_admin",
    label: "부동산 관리자",
    group: "부동산",
    color: "amber",
    isToken: true,
    tokenKey: "a_rst",
  },

  // --- 마켓 기능 (Yellow) ---
  {
    key: "page_marketplace_view",
    label: "마켓(보기)",
    group: "마켓",
    color: "yellow",
    isToken: true,
    tokenKey: "p_mkt",
  },
  {
    key: "marketplace_admin",
    label: "마켓 관리자",
    group: "마켓",
    color: "yellow",
    isToken: true,
    tokenKey: "a_mkt",
  },

  // --- 아케이드 기능 (Violet) ---
  {
    key: "page_arcade_view",
    label: "놀이터(보기)",
    group: "놀이터",
    color: "violet",
    isToken: true,
    tokenKey: "p_arc",
  },
];

export const PERMISSION_CONFIG = ALL_PERMISSION_CONFIG;

export const TOKEN_PERMISSION_MAP = Object.freeze(
  Object.fromEntries(
    PERMISSION_CONFIG.filter((permission) => permission.isToken && permission.tokenKey)
      .map((permission) => [permission.key, permission.tokenKey]),
  ),
);

export const KNOWN_PERMISSION_KEYS = Object.freeze(
  PERMISSION_CONFIG.map((permission) => permission.key).filter(Boolean),
);

export const IMPLIED_PERMISSION_MAP = Object.freeze({
  bank_admin: ["page_bank_view"],
  action_bank_transfer: ["page_bank_view"],
  asset_manager_manage: ["asset_manager_view"],
  tax_admin: ["page_tax_view"],
  labor_admin: ["page_labor_view"],
  permission_group_police: ["page_police_view"],
  police_rules_manage: ["page_police_view"],
  store_admin: ["page_store_view"],
  credit_admin: ["page_credit_view"],
  assembly_member: ["page_assembly_view"],
  mission_admin: ["page_mission_view"],
  credentials_admin: ["page_credentials_view"],
  credentials_designer: ["page_credentials_view"],
  news_admin: ["page_news_view"],
  realestate_admin: ["page_realestate_view"],
  marketplace_admin: ["page_marketplace_view"],
});

export const applyImpliedPermissions = (permissions = {}) => {
  const normalized = { ...permissions };

  Object.entries(IMPLIED_PERMISSION_MAP).forEach(([permissionKey, impliedKeys]) => {
    if (normalized[permissionKey] !== true) return;
    impliedKeys.forEach((impliedKey) => {
      if (KNOWN_PERMISSION_KEYS.includes(impliedKey)) {
        normalized[impliedKey] = true;
      }
    });
  });

  return normalized;
};
