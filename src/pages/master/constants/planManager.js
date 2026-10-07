export const PLAN_KEYS = ["FREE", "PLUS", "PRO", "AI_PRO"];

export const PAGE_ORDER = [
  "bank",
  "stock",
  "mission",
  "credentials",
  "caseLibrary",
  "realestate",
  "assetManager",
  "arcade",
  "police",
  "store",
  "tax",
  "labor",
  "news",
  "credit",
  "donation",
  "assembly",
  "jobBoard",
  "marketplace",
];

export const PAGE_LABELS = {
  bank: "은행",
  stock: "주식",
  mission: "미션",
  credentials: "칭호",
  caseLibrary: "가이드북",
  realestate: "부동산",
  assetManager: "경제 관리",
  arcade: "아케이드",
  police: "경찰",
  store: "상점",
  tax: "국세청",
  labor: "노동",
  news: "뉴스",
  credit: "신용",
  donation: "기부",
  assembly: "의회",
  jobBoard: "직업 게시판",
  marketplace: "마켓플레이스",
};

export const LEGACY_FEATURE_TO_PAGE_POLICY_KEY = {
  accessible: "accessible",
  enableLog: "activityLog",
  enableCredit: "creditLog",
};

export const LEGACY_SERVICE_PAGE_LINKS = {
  admin: ["assetManager"],
  assetManager: ["assetManager"],
  bank: ["bank"],
  stock: ["stock"],
  tax: ["tax"],
  payroll: ["labor"],
  labor: ["labor"],
  police: ["police"],
  mission: ["mission"],
  credentials: ["credentials"],
  caseLibrary: ["caseLibrary"],
  realestate: ["realestate"],
  store: ["store"],
  credit: ["credit"],
  donation: ["donation"],
  arcade: ["arcade"],
  news: ["news"],
  assembly: ["assembly"],
  jobBoard: ["jobBoard"],
  marketplace: ["marketplace"],
};

export const SERVICE_OPTIONS_MAP = {
  admin: ["accessible", "enableLog", "enableCredit"],
  assetManager: ["accessible", "enableLog", "enableCredit"],
  bank: ["accessible", "enableLog"],
  stock: ["accessible", "enableLog"],
  tax: ["accessible", "enableLog"],
  payroll: ["accessible", "enableLog"],
  labor: ["accessible", "enableLog"],
  police: ["accessible", "enableLog", "enableCredit"],
  mission: ["accessible", "enableLog", "enableCredit"],
  credentials: ["accessible", "enableLog"],
  caseLibrary: ["accessible"],
  realestate: ["accessible", "enableLog"],
  store: ["accessible", "enableLog"],
  credit: ["accessible"],
  donation: ["accessible", "enableLog"],
  arcade: ["accessible", "enableLog"],
  news: ["accessible", "enableLog"],
  assembly: ["accessible", "enableLog"],
  jobBoard: ["accessible", "enableLog"],
  marketplace: ["accessible", "enableLog"],
};

export const FEATURE_LABELS = {
  accessible: "페이지 접근",
  enableLog: "활동로그 기록",
  enableCredit: "신용로그 기록",
};

export const PAGE_FEATURE_LABELS = {
  accessible: "페이지 접근",
  activityLog: "활동로그 기록",
  creditLog: "신용로그 기록",
};

export const SERVICE_LABELS = {
  admin: "경제 관리",
  assetManager: "경제 관리",
  bank: "은행",
  stock: "주식",
  tax: "국세청",
  payroll: "노동",
  labor: "노동",
  police: "경찰",
  mission: "미션",
  credentials: "칭호",
  caseLibrary: "가이드북",
  realestate: "부동산",
  store: "상점",
  donation: "기부",
  arcade: "아케이드",
  news: "뉴스",
  assembly: "의회",
  jobBoard: "직업 게시판",
  marketplace: "마켓플레이스",
};

export const PATH_TO_SERVICE = {
  "/bank": "bank",
  "/stock": "stock",
  "/missions": "mission",
  "/credentials": "credentials",
  "/case-library": "caseLibrary",
  "/realestate": "realestate",
  "/manage/assets": "assetManager",
  "/arcade": "arcade",
  "/police": "police",
  "/store": "store",
  "/credit": "credit",
  "/tax": "tax",
  "/labor": "labor",
  "/news": "news",
  "/assembly": "assembly",
  "/job-board": "jobBoard",
  "/marketplace": "marketplace",
};

export const getPlanBadgeTone = (planType) =>
  (
    {
      FREE: "slate",
      PLUS: "blue",
      PRO: "indigo",
      AI_PRO: "violet",
      ADMIN_PASS: "rose",
    }[String(planType || "").toUpperCase()] || "slate"
  );

const createPagePolicy = (accessible, activityLog = false, creditLog = false) => ({
  accessible,
  activityLog,
  creditLog,
});

const DEFAULT_PAGE_CONFIG_BY_PLAN = {
  FREE: {
    bank: createPagePolicy(true, false, false),
    stock: createPagePolicy(false, false, false),
    mission: createPagePolicy(false, false, false),
    credentials: createPagePolicy(false, false, false),
    caseLibrary: createPagePolicy(true, false, false),
    realestate: createPagePolicy(false, false, false),
    assetManager: createPagePolicy(false, false, false),
    arcade: createPagePolicy(false, false, false),
    police: createPagePolicy(false, false, false),
    store: createPagePolicy(true, false, false),
    tax: createPagePolicy(true, false, false),
    labor: createPagePolicy(true, false, false),
    news: createPagePolicy(true, false, false),
    credit: createPagePolicy(true, false, false),
    donation: createPagePolicy(true, false, false),
    assembly: createPagePolicy(true, false, false),
    jobBoard: createPagePolicy(true, false, false),
    marketplace: createPagePolicy(true, false, false),
  },
  PLUS: {
    bank: createPagePolicy(true, true, false),
    stock: createPagePolicy(true, true, false),
    mission: createPagePolicy(false, false, false),
    credentials: createPagePolicy(false, false, false),
    caseLibrary: createPagePolicy(true, false, false),
    realestate: createPagePolicy(true, true, false),
    assetManager: createPagePolicy(true, true, true),
    arcade: createPagePolicy(true, true, false),
    police: createPagePolicy(true, true, true),
    store: createPagePolicy(true, true, false),
    tax: createPagePolicy(true, true, false),
    labor: createPagePolicy(true, true, false),
    news: createPagePolicy(true, false, false),
    credit: createPagePolicy(true, false, false),
    donation: createPagePolicy(true, true, false),
    assembly: createPagePolicy(true, false, false),
    jobBoard: createPagePolicy(true, false, false),
    marketplace: createPagePolicy(true, true, false),
  },
  PRO: {
    bank: createPagePolicy(true, true, false),
    stock: createPagePolicy(true, true, false),
    mission: createPagePolicy(true, true, true),
    credentials: createPagePolicy(true, true, false),
    caseLibrary: createPagePolicy(true, false, false),
    realestate: createPagePolicy(true, true, false),
    assetManager: createPagePolicy(true, true, true),
    arcade: createPagePolicy(true, true, false),
    police: createPagePolicy(true, true, true),
    store: createPagePolicy(true, true, false),
    tax: createPagePolicy(true, true, false),
    labor: createPagePolicy(true, true, false),
    news: createPagePolicy(true, true, false),
    credit: createPagePolicy(true, false, false),
    donation: createPagePolicy(true, true, false),
    assembly: createPagePolicy(true, true, false),
    jobBoard: createPagePolicy(true, true, false),
    marketplace: createPagePolicy(true, true, false),
  },
  AI_PRO: {
    bank: createPagePolicy(true, true, false),
    stock: createPagePolicy(true, true, false),
    mission: createPagePolicy(true, true, true),
    credentials: createPagePolicy(true, true, false),
    caseLibrary: createPagePolicy(true, false, false),
    realestate: createPagePolicy(true, true, false),
    assetManager: createPagePolicy(true, true, true),
    arcade: createPagePolicy(true, true, false),
    police: createPagePolicy(true, true, true),
    store: createPagePolicy(true, true, false),
    tax: createPagePolicy(true, true, false),
    labor: createPagePolicy(true, true, false),
    news: createPagePolicy(true, true, false),
    credit: createPagePolicy(true, false, false),
    donation: createPagePolicy(true, true, false),
    assembly: createPagePolicy(true, true, false),
    jobBoard: createPagePolicy(true, true, false),
    marketplace: createPagePolicy(true, true, false),
  },
};

const DEFAULT_LIMITS_BY_PLAN = {
  FREE: { maxStudents: 30, maxMissions: 10 },
  PLUS: { maxStudents: 80, maxMissions: 200 },
  PRO: { maxStudents: 200, maxMissions: 1000 },
  AI_PRO: { maxStudents: 200, maxMissions: 1000 },
};

const buildLegacyServicesFromPages = (pages = {}) => {
  const services = {};

  Object.entries(LEGACY_SERVICE_PAGE_LINKS).forEach(([serviceKey, pageKeys]) => {
    const linkedPages = pageKeys.map((pageKey) => pages[pageKey]).filter(Boolean);

    if (linkedPages.length === 0) return;

    services[serviceKey] = {
      accessible: linkedPages.some((page) => page.accessible === true),
      enableLog: linkedPages.some((page) => page.activityLog === true),
      enableTax: linkedPages.some((page) => page.accessible === true),
      enableCredit: linkedPages.some((page) => page.creditLog === true),
    };
  });

  return services;
};

const buildPageOverridesFromLegacyServices = (services = {}) => {
  const overrides = {};

  Object.entries(services || {}).forEach(([serviceKey, featureMap]) => {
    const pageKeys = LEGACY_SERVICE_PAGE_LINKS[serviceKey] || [];
    if (pageKeys.length === 0) return;

    pageKeys.forEach((pageKey) => {
      if (!overrides[pageKey]) overrides[pageKey] = {};

      Object.entries(LEGACY_FEATURE_TO_PAGE_POLICY_KEY).forEach(
        ([legacyFeatureKey, pageFeatureKey]) => {
          if (typeof featureMap?.[legacyFeatureKey] === "boolean") {
            overrides[pageKey][pageFeatureKey] = featureMap[legacyFeatureKey];
          }
        },
      );
    });
  });

  return overrides;
};

const normalizePagePolicy = (pagePolicy = {}) => {
  const accessible = pagePolicy.accessible !== false;
  const activityLog = accessible ? pagePolicy.activityLog === true : false;
  const creditLog = accessible ? pagePolicy.creditLog === true : false;

  return {
    accessible,
    activityLog,
    creditLog,
  };
};

const buildInitialPlanFeatures = () =>
  PLAN_KEYS.reduce((acc, planKey) => {
    const pages = PAGE_ORDER.reduce((pageAcc, pageKey) => {
      pageAcc[pageKey] = normalizePagePolicy(
        DEFAULT_PAGE_CONFIG_BY_PLAN[planKey]?.[pageKey] || {},
      );
      return pageAcc;
    }, {});

    acc[planKey] = {
      pages,
      services: buildLegacyServicesFromPages(pages),
      limits: { ...(DEFAULT_LIMITS_BY_PLAN[planKey] || {}) },
      reports: planKey === "PRO" || planKey === "AI_PRO",
      aiReports: planKey === "AI_PRO",
    };

    return acc;
  }, {});

export const INITIAL_PLAN_FEATURES = buildInitialPlanFeatures();

export const mergePlanConfig = (rawConfig) => {
  const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};

  return PLAN_KEYS.reduce((acc, planKey) => {
    const planDefaults = INITIAL_PLAN_FEATURES[planKey] || {};
    const planOverrides = source[planKey] || {};
    const legacyPageOverrides = buildPageOverridesFromLegacyServices(
      planOverrides.services,
    );

    const pages = PAGE_ORDER.reduce((pageAcc, pageKey) => {
      pageAcc[pageKey] = normalizePagePolicy({
        ...(planDefaults.pages?.[pageKey] || {}),
        ...(legacyPageOverrides[pageKey] || {}),
        ...(planOverrides.pages?.[pageKey] || {}),
      });
      return pageAcc;
    }, {});

    acc[planKey] = {
      ...planDefaults,
      ...planOverrides,
      pages,
      services: buildLegacyServicesFromPages(pages),
      limits: {
        ...(planDefaults.limits || {}),
        ...(planOverrides.limits || {}),
      },
      reports:
        typeof planOverrides.reports === "boolean"
          ? planOverrides.reports
          : planDefaults.reports === true,
      aiReports:
        typeof planOverrides.aiReports === "boolean"
          ? planOverrides.aiReports
          : planDefaults.aiReports === true,
    };

    return acc;
  }, {});
};

export const canUseFeature = (
  currentConfig,
  planType = "FREE",
  serviceName,
  featureName,
) => {
  const config = mergePlanConfig(currentConfig || INITIAL_PLAN_FEATURES);
  const plan = config[(planType || "FREE").toUpperCase()] || config.FREE;
  const service = plan.services?.[serviceName];

  if (!service) return false;
  if (featureName === "enableTax") {
    return service.enableTax === true || service.accessible === true;
  }
  if (!SERVICE_OPTIONS_MAP[serviceName]?.includes(featureName)) return false;

  return service[featureName] === true;
};

export const getPlanLimit = (currentConfig, planType = "FREE", limitName) => {
  const config = mergePlanConfig(currentConfig || INITIAL_PLAN_FEATURES);
  const plan = config[(planType || "FREE").toUpperCase()] || config.FREE;
  return plan.limits?.[limitName] ?? INITIAL_PLAN_FEATURES.FREE.limits[limitName];
};
