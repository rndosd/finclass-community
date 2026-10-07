"use strict";

const admin = require("../firebaseAdminCompat");

const PLAN_KEYS = ["FREE", "PLUS", "PRO", "AI_PRO"];

const PAGE_ORDER = [
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

const LEGACY_FEATURE_TO_PAGE_POLICY_KEY = {
    accessible: "accessible",
    enableLog: "activityLog",
    enableCredit: "creditLog",
};

const LEGACY_SERVICE_PAGE_LINKS = {
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

const SERVICE_OPTIONS_MAP = {
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
        credit: createPagePolicy(true, false, false),
        donation: createPagePolicy(true, false, false),
        tax: createPagePolicy(true, false, false),
        labor: createPagePolicy(true, false, false),
        news: createPagePolicy(true, false, false),
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
        credit: createPagePolicy(true, false, false),
        donation: createPagePolicy(true, true, false),
        tax: createPagePolicy(true, true, false),
        labor: createPagePolicy(true, true, false),
        news: createPagePolicy(true, false, false),
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
        credit: createPagePolicy(true, false, false),
        donation: createPagePolicy(true, true, false),
        tax: createPagePolicy(true, true, false),
        labor: createPagePolicy(true, true, false),
        news: createPagePolicy(true, true, false),
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
        credit: createPagePolicy(true, false, false),
        donation: createPagePolicy(true, true, false),
        tax: createPagePolicy(true, true, false),
        labor: createPagePolicy(true, true, false),
        news: createPagePolicy(true, true, false),
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
        const linkedPages = pageKeys
            .map((pageKey) => pages[pageKey])
            .filter(Boolean);

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

const INITIAL_PLAN_FEATURES = buildInitialPlanFeatures();

const normalizePlanConfig = (rawConfig) => {
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

let cachedConfig = null;
let lastFetchedAt = 0;
const CACHE_TTL = 60 * 1000;

const getGlobalConfig = async () => {
    const now = Date.now();

    if (cachedConfig && now - lastFetchedAt < CACHE_TTL) {
        return cachedConfig;
    }

    try {
        const snap = await admin.firestore().doc("system/planConfig").get();
        cachedConfig = normalizePlanConfig(
            snap.exists ? snap.data() : INITIAL_PLAN_FEATURES,
        );
        lastFetchedAt = now;
        return cachedConfig;
    } catch (error) {
        console.error("[PlanManager] failed to load global plan config:", error);
        return cachedConfig || INITIAL_PLAN_FEATURES;
    }
};

const canUsePagePolicy = (config, planType = "FREE", pageKey, policyKey) => {
    const normalizedConfig = normalizePlanConfig(config || INITIAL_PLAN_FEATURES);
    const type = (planType || "FREE").toUpperCase();
    const plan = normalizedConfig[type] || normalizedConfig.FREE;
    const page = plan.pages?.[pageKey];

    if (!page) return true;
    return page[policyKey] === true;
};

const canUseFeature = (config, planType = "FREE", serviceName, featureName) => {
    const normalizedConfig = normalizePlanConfig(config || INITIAL_PLAN_FEATURES);
    const type = (planType || "FREE").toUpperCase();
    const plan = normalizedConfig[type] || normalizedConfig.FREE;
    const service = plan.services?.[serviceName];

    if (!service) return false;
    if (featureName === "enableTax") {
        return service.enableTax === true || service.accessible === true;
    }
    if (!SERVICE_OPTIONS_MAP[serviceName]?.includes(featureName)) return false;

    return service[featureName] === true;
};

const getPlanLimit = (config, planType = "FREE", limitName) => {
    const normalizedConfig = normalizePlanConfig(config || INITIAL_PLAN_FEATURES);
    const type = (planType || "FREE").toUpperCase();
    const plan = normalizedConfig[type] || normalizedConfig.FREE;

    return plan.limits?.[limitName] || INITIAL_PLAN_FEATURES.FREE.limits[limitName];
};

module.exports = {
    getGlobalConfig,
    canUsePagePolicy,
    canUseFeature,
    getPlanLimit,
    INITIAL_PLAN_FEATURES,
    PLAN_KEYS,
};
