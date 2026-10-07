// src/constants.js
// ✅ 모든 공용 상수를 중앙에서 관리합니다.

// ===== Firestore 컬렉션 이름들 =====
// 🔧 기존 컬렉션명 유지 (기존 데이터와 호환성)
const MARKET_CACHE_COLLECTION = "stockMarketCache";
const CHART_CACHE_COLLECTION = "stockChartCache";
const CHART_SUMMARY_COLLECTION = "stockChartSummary";
const QUOTE_SUMMARY_COLLECTION = "stockMarketSummary";
const PREFETCH_CONTROL_COLLECTION = "prefetchControl";
const STOCK_CATEGORIES_COLLECTION = "stockCategories";

// ===== 주식 관련 설정값들 =====
const CONFIG = {
    CACHE_DURATION_HOURS: 20,
    API_CALL_DELAY_MS: 1500,
    BATCH_SIZE: 25,
    MAX_RETRIES: 1,
    RATE_LIMIT_WAIT_MS: 120000
};

// ===== 로깅 컨텍스트 이름들 =====
const LOG_CONTEXTS = {
    QUOTE_CACHE: 'QUOTE_CACHE',
    CHART_CACHE: 'CHART_CACHE',
    PORTFOLIO: 'PORTFOLIO',
    PREFETCH: 'PREFETCH',
    REBUILD: 'REBUILD'
};

// ===== 요일 상수 =====
const KOREAN_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ===== 권한 시스템 상수 =====
const PERMISSIONS = {
    // 페이지 접근 권한
    BANK: 'page_bank_view',
    TAX: 'page_tax_view',
    LABOR: 'page_labor_view',
    POLICE: 'page_police_view',
    STORE: 'page_store_view',
    STOCK: 'page_stock_view',
    CREDIT: 'page_credit_view',
    MISSION_PAGE: 'page_mission_view',
    ASSEMBLY_PAGE: 'page_assembly_view',
    REALESTATE: 'page_realestate_view',

    // 관리자 권한
    BANK_ADMIN: 'bank_admin',
    POLICE_ADMIN: 'permission_group_police',
    POLICE_RULES_MANAGE: 'police_rules_manage',
    TAX_ADMIN: 'tax_admin',
    LABOR_ADMIN: 'labor_admin',
    STORE_ADMIN: 'store_admin',
    MISSION_ADMIN: 'mission_admin',
    REALESTATE_ADMIN: 'realestate_admin',

    // 특별 액션 권한
    BANK_TRANSFER: 'action_bank_transfer',
};

// ===== 내보내기 =====
module.exports = {
    // Firestore 컬렉션
    MARKET_CACHE_COLLECTION,
    CHART_CACHE_COLLECTION,
    CHART_SUMMARY_COLLECTION,
    QUOTE_SUMMARY_COLLECTION,
    PREFETCH_CONTROL_COLLECTION,
    STOCK_CATEGORIES_COLLECTION,

    // 설정 및 상수
    CONFIG,
    LOG_CONTEXTS,
    KOREAN_WEEKDAYS,
    PERMISSIONS,
};
