import { House as HomeIcon, Newspaper, Gauge, Target, CurrencyDollar as DollarSign, ChartLine as CandlestickChart, Buildings as Building2, Briefcase, BriefcaseMetal as BriefcaseBusiness, Receipt as ReceiptText, Siren, Gavel, Storefront as ShoppingCart, ArrowsLeftRight, Users, UserPlus, UserMinus, Key as KeyRound, Lock, UserGear as UserCog, Coins, ChartBar as BarChart3, GraduationCap, Medal as Award, SlidersHorizontal, GameController as Gamepad2, ShieldCheck, SquaresFour as LayoutDashboard, Clock as Clock3 } from "@phosphor-icons/react";
import { isLocalRuntime } from "../utils/runtimeAccess";
export const mainNavItems = [{
  label: "홈",
  path: "/dashboard",
  icon: HomeIcon,
  type: "main"
}, ...(isLocalRuntime() ? [] : []), {
  label: "뉴스",
  path: "/news",
  icon: Newspaper,
  type: "main",
  permission: ["page_news_view", "news_admin"]
}, {
  label: "신용등급",
  path: "/credit",
  icon: Gauge,
  type: "main",
  permission: ["page_credit_view", "credit_admin"]
}, {
  label: "과제",
  path: "/missions",
  icon: Target,
  type: "main",
  permission: ["page_mission_view", "mission_admin"]
}, {
  label: "학급 경제 관리",
  path: "/manage/assets",
  icon: BarChart3,
  type: "main",
  permission: ["asset_manager_view", "asset_manager_manage"]
}, {
  label: "칭호 자격증",
  path: "/credentials",
  icon: Award,
  type: "main",
  permission: ["page_credentials_view", "credentials_admin"]
}, {
  label: "은행",
  path: "/bank",
  icon: DollarSign,
  type: "main",
  permission: ["page_bank_view", "bank_admin", "action_bank_transfer"]
}, {
  label: "주식거래소",
  path: "/stock",
  icon: CandlestickChart,
  type: "main",
  permission: ["page_stock_view"]
}, {
  label: "부동산",
  path: "/realestate",
  icon: Building2,
  type: "main",
  permission: ["page_realestate_view", "realestate_admin"]
}, {
  label: "놀이터",
  path: "/arcade",
  icon: Gamepad2,
  type: "main",
  permission: "page_arcade_view"
}, {
  label: "국세청",
  path: "/tax",
  icon: ReceiptText,
  type: "main",
  permission: ["page_tax_view", "tax_admin"]
}, {
  label: "노동청",
  path: "/labor",
  icon: Briefcase,
  type: "main",
  permission: ["page_labor_view", "labor_admin"]
}, {
  label: "구인 게시판",
  path: "/job-board",
  icon: BriefcaseBusiness,
  type: "main",
  permission: "page_job_board_view"
}, {
  label: "경찰청",
  path: "/police",
  icon: Siren,
  type: "main",
  permission: ["page_police_view", "permission_group_police", "police_rules_manage"]
}, {
  label: "학생의회",
  path: "/assembly",
  icon: Gavel,
  type: "main",
  permission: ["page_assembly_view", "assembly_member"]
}, {
  label: "상점",
  path: "/store",
  icon: ShoppingCart,
  type: "main",
  permission: ["page_store_view", "store_admin"]
}, {
  label: "중고시장",
  path: "/marketplace",
  icon: ArrowsLeftRight,
  type: "main",
  permission: ["page_marketplace_view", "marketplace_admin"]
}];
export const adminNavItems = [{
  label: "시스템 총괄",
  icon: ShieldCheck,
  type: "accordion",
  role: "admin",
  children: [{
    label: "마스터 허브",
    path: "/admin/master",
    icon: UserCog
  }]
}, {
  label: "학급 관리",
  icon: GraduationCap,
  type: "accordion",
  children: [{
    label: "학급 설정",
    onClick: "openClassSettingsModal",
    icon: SlidersHorizontal
  }, {
    label: "학급 경제 관리",
    path: "/manage/assets",
    icon: Coins
  }, {
    label: "홈 화면 설정",
    path: "/manage/dashboard",
    icon: LayoutDashboard
  }, {
    label: "시간 설정",
    path: "/manage/time-settings",
    icon: Clock3
  }, {
    label: "권한 관리",
    path: "/manage/permissions",
    icon: Lock
  }]
}, {
  label: "계정 관리",
  icon: Users,
  type: "accordion",
  children: [{
    label: "학생 계정 등록",
    path: "/manage/students/create",
    icon: UserPlus
  }, {
    label: "학생 계정 삭제",
    path: "/manage/students/delete",
    icon: UserMinus
  }, {
    label: "비밀번호 초기화",
    onClick: "openPasswordResetModal",
    icon: KeyRound
  }]
}];
