"use strict";

const admin = require("../firebaseAdminCompat");
const { FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("../utils/maintenanceHttps");
const { onSchedule } = require("../utils/maintenanceScheduler");

const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const { getMarketConfig } = require("../utils/marketConfig");
const { stageActivityLog } = require("../utils/logUtils");
const { getPrefetchContext, fetchTrackedSymbolsMeta } = require("../utils/prefetchUtils");
const { findUnregisteredHoldingSymbols } = require("../utils/fundStockCatalog");
const { resolveFundManagementFeeSelection } = require("../utils/fundManagementFee");
const { buildFundPerformance30d } = require("../utils/fundPerformance30d");
const { buildFundPerformanceSummary } = require("../utils/fundPerformance");
const { calculateActiveFundRiskSafe } = require("../utils/fundRiskRepository");
const { buildHoldingsHash } = require("../utils/portfolioRisk");

const { createMaintenanceDb } = require("../utils/maintenanceDb");
const db = createMaintenanceDb(admin.firestore());

const BASE_NAV = 100;
const DEFAULT_MAX_HOLDINGS = 12;
const DEFAULT_BENCHMARK_SYMBOL = "SPY";
const DEFAULT_BENCHMARKS = ["SPY", "QQQ"];
const DEFAULT_FUND_REPORT_CADENCE = "weekly";
const DEFAULT_FUND_REPORT_CYCLE_DAYS = 7;
const MIN_FUND_REPORT_CYCLE_DAYS = 1;
const MAX_FUND_REPORT_CYCLE_DAYS = 30;
const FUND_REBALANCE_OPEN_TIME = "07:45";
const DEFAULT_FUND_ORDER_CUTOFF_TIME = "15:00";
const FUND_ORDER_CUTOFF_MIN_TIME = "08:01";
const FUND_ORDER_CUTOFF_MAX_TIME = "18:00";
const FUND_POSITION_EPSILON = 0.0001;
const DEFAULT_FUND_POLICY = {
  fundFeeMode: "preset",
  fundFeePresets: [
    { id: "free", label: "무료형", bps: 0 },
    { id: "basic", label: "기본형", bps: 5 },
    { id: "growth", label: "성장형", bps: 10 },
    { id: "active", label: "적극형", bps: 20 },
  ],
  fundFixedManagementFeeBpsWeekly: 10,
  fundFixedManagementFeeLabel: "교사 고정",
  fundReportCadence: DEFAULT_FUND_REPORT_CADENCE,
  fundReportCycleDays: DEFAULT_FUND_REPORT_CYCLE_DAYS,
  fundReportCadenceLabel: "매주",
  fundMinHoldingsCount: 3,
  fundMaxSingleWeightBps: 4000,
  fundDailyCutoffTime: DEFAULT_FUND_ORDER_CUTOFF_TIME,
  fundOrderStartTime: FUND_REBALANCE_OPEN_TIME,
  fundOrderCutoffTime: DEFAULT_FUND_ORDER_CUTOFF_TIME,
};

const asNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clampInt = (value, fallback = 0) => Math.round(asNum(value, fallback));
const round2 = (value) => Math.round(asNum(value) * 100) / 100;
const round4 = (value) => Math.round(asNum(value) * 10000) / 10000;

const cleanText = (value, maxLength = 2000) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const cleanLongText = (value, maxLength = 4000) =>
  String(value || "").trim().slice(0, maxLength);

const kstDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function getKstParts(date = new Date()) {
  const parts = kstDateFormatter.formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    weekday: read("weekday"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

function getKstDateKey(date = new Date()) {
  const { year, month, day } = getKstParts(date);
  return `${year}-${month}-${day}`;
}

function getKstMinutes(date = new Date()) {
  const { hour, minute } = getKstParts(date);
  return Number(hour) * 60 + Number(minute);
}

function isKstWeekend(date = new Date()) {
  const { weekday } = getKstParts(date);
  return weekday === "Sat" || weekday === "Sun";
}

function normalizeFundReportCadence(value, legacyLabel = "") {
  if (value === "biweekly") {
    return {
      fundReportCadence: "biweekly",
      fundReportCadenceLabel: "격주",
    };
  }

  if (value === "weekly") {
    return {
      fundReportCadence: "weekly",
      fundReportCadenceLabel: "매주",
    };
  }

  const normalizedLegacyLabel = cleanText(legacyLabel, 60);
  if (
    normalizedLegacyLabel.includes("격주") ||
    normalizedLegacyLabel.includes("2주")
  ) {
    return {
      fundReportCadence: "biweekly",
      fundReportCadenceLabel: "격주",
    };
  }

  return {
    fundReportCadence: DEFAULT_FUND_REPORT_CADENCE,
    fundReportCadenceLabel: DEFAULT_FUND_POLICY.fundReportCadenceLabel,
  };
}

function getReportCadenceDays(reportCadence = DEFAULT_FUND_REPORT_CADENCE) {
  return reportCadence === "biweekly" ? 14 : 7;
}

function clampFundReportCycleDays(
  value,
  fallback = DEFAULT_FUND_REPORT_CYCLE_DAYS,
) {
  return Math.min(
    MAX_FUND_REPORT_CYCLE_DAYS,
    Math.max(MIN_FUND_REPORT_CYCLE_DAYS, clampInt(value, fallback)),
  );
}

function normalizeFundReportCycle(cycleDays, legacyCadence, legacyLabel = "") {
  if (Number(cycleDays) >= MIN_FUND_REPORT_CYCLE_DAYS) {
    const days = clampFundReportCycleDays(cycleDays);
    return {
      fundReportCadence: "days",
      fundReportCycleDays: days,
      fundReportCadenceLabel: `${days}일`,
    };
  }

  const matchedDays = String(legacyLabel || "").match(/(\d+)\s*일/);
  if (matchedDays) {
    const days = clampFundReportCycleDays(Number(matchedDays[1]));
    return {
      fundReportCadence: "days",
      fundReportCycleDays: days,
      fundReportCadenceLabel: `${days}일`,
    };
  }

  const legacy = normalizeFundReportCadence(legacyCadence, legacyLabel);
  const days = getReportCadenceDays(legacy.fundReportCadence);
  return {
    fundReportCadence: legacy.fundReportCadence,
    fundReportCycleDays: days,
    fundReportCadenceLabel: `${days}일`,
  };
}

function getJoinStatusForReportState(fund = {}) {
  const status = cleanText(fund.status, 20);
  const joinStatus = cleanText(fund.joinStatus, 40);

  if (status === "closed") return joinStatus || "closed";
  if (status === "paused" || joinStatus === "paused") return "paused";
  return "open";
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeTimeString(value, fallback) {
  const normalized = cleanText(value, 5);
  if (!/^\d{2}:\d{2}$/.test(normalized)) return fallback;

  const [hour, minute] = normalized.split(":").map((part) => Number(part));
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return fallback;
  }

  return normalized;
}

function normalizeConfiguredTime(value, fallback, min, max) {
  const normalized = normalizeTimeString(value, null);
  if (!normalized) return fallback;

  const minutes = timeStringToMinutes(normalized, -1);
  const minMinutes = timeStringToMinutes(min, -1);
  const maxMinutes = timeStringToMinutes(max, -1);
  if (minutes < minMinutes || minutes > maxMinutes) {
    return fallback;
  }

  return normalized;
}

function timeStringToMinutes(value, fallback = 0) {
  const normalized = normalizeTimeString(value, null);
  if (!normalized) return fallback;
  const [hour, minute] = normalized.split(":").map((part) => Number(part));
  return hour * 60 + minute;
}

function normalizeFundOrderTimes(cutoffValue, dailyCutoffValue) {
  const fundOrderCutoffTime = normalizeConfiguredTime(
    dailyCutoffValue ?? cutoffValue,
    DEFAULT_FUND_ORDER_CUTOFF_TIME,
    FUND_ORDER_CUTOFF_MIN_TIME,
    FUND_ORDER_CUTOFF_MAX_TIME,
  );

  return {
    fundDailyCutoffTime: fundOrderCutoffTime,
    fundOrderStartTime: FUND_REBALANCE_OPEN_TIME,
    fundOrderCutoffTime,
  };
}

function getFundNav(fund = {}) {
  const nav = round4(asNum(fund.currentNav, asNum(fund.baseNav, BASE_NAV)));
  return nav > 0 ? nav : BASE_NAV;
}

function getFundOrderExecutionNav(order = {}, currentNav = BASE_NAV) {
  const requestedNav = round4(asNum(order.requestedNav, 0));
  if (requestedNav > 0) return requestedNav;

  const fallbackNav = round4(asNum(currentNav, BASE_NAV));
  return fallbackNav > 0 ? fallbackNav : BASE_NAV;
}

function computeFundAumUSD(currentNav, unitsOutstanding) {
  return round4(asNum(currentNav, BASE_NAV) * asNum(unitsOutstanding, 0));
}

function buildFundNavHistoryPayload({
  fundData = {},
  dateKey = "",
  nav = BASE_NAV,
  previousNav = BASE_NAV,
  dailyReturn = 0,
  priceSourceDoc = "",
  snapshotType = "daily",
}) {
  const normalizedNav = round4(asNum(nav, BASE_NAV));
  const normalizedPreviousNav = round4(asNum(previousNav, normalizedNav));
  const unitsOutstanding = round4(asNum(fundData.unitsOutstanding, 0));

  return {
    dateKey,
    nav: normalizedNav,
    currentNav: normalizedNav,
    previousNav: normalizedPreviousNav,
    returnRate: round4(asNum(dailyReturn, 0)),
    baseNav: round4(asNum(fundData.baseNav, BASE_NAV)),
    aumUSD: computeFundAumUSD(normalizedNav, unitsOutstanding),
    unitsOutstanding,
    investorCount: Math.max(0, clampInt(fundData.investorCount, 0)),
    fundName: cleanText(fundData.fundName, 60),
    benchmarkSymbol:
      cleanText(fundData.benchmarkSymbol, 12) || DEFAULT_BENCHMARK_SYMBOL,
    holdingsCurrent: Array.isArray(fundData.holdingsCurrent)
      ? fundData.holdingsCurrent
      : [],
    cashWeightBps: Math.max(0, clampInt(fundData.cashWeightBps, 0)),
    lastRebalancedAt: fundData.lastRebalancedAt || null,
    riskModelVersion: cleanText(fundData.riskSummary?.modelVersion, 80) || null,
    riskDatasetVersion: cleanText(fundData.riskSummary?.datasetVersion, 120) || null,
    riskHoldingsHash: cleanText(fundData.riskSummary?.holdingsHash, 80) || null,
    riskCategory: cleanText(fundData.riskSummary?.category, 30) || null,
    riskAnnualizedVolatilityPct: Number.isFinite(
      Number(fundData.riskSummary?.annualizedVolatilityPct),
    )
      ? round4(Number(fundData.riskSummary.annualizedVolatilityPct))
      : null,
    priceSourceDoc: cleanText(priceSourceDoc, 40),
    snapshotType: cleanText(snapshotType, 20) || "daily",
    recordedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function getFundPositionId(fundId, studentUid) {
  return `${fundId}__${studentUid}`;
}

function computeWeightedDailyReturn(holdingsCurrent = [], priceMap = {}, cashWeightBps = 0) {
  const holdings = Array.isArray(holdingsCurrent) ? holdingsCurrent : [];
  let weightedReturn = 0;
  let totalWeightBps = Math.max(0, clampInt(cashWeightBps, 0));

  holdings.forEach((holding) => {
    const symbol = cleanText(holding?.symbol, 12).toUpperCase();
    const weightBps = Math.max(0, clampInt(holding?.weightBps, 0));
    const quote = symbol ? priceMap?.[symbol] || {} : {};
    const current = asNum(quote?.current, 0);
    const previousClose = asNum(quote?.previousClose, 0);
    const dailyReturn =
      current > 0 && previousClose > 0
        ? (current - previousClose) / previousClose
        : 0;

    totalWeightBps += weightBps;
    weightedReturn += (weightBps / 10000) * dailyReturn;
  });

  if (totalWeightBps <= 0) return 0;
  return weightedReturn;
}

function buildOrderWindowSummary(fundPolicy = {}, now = new Date()) {
  const rebalanceOpenMinutes = timeStringToMinutes(
    FUND_REBALANCE_OPEN_TIME,
    timeStringToMinutes(FUND_REBALANCE_OPEN_TIME),
  );
  const startMinutes = rebalanceOpenMinutes;
  const cutoffMinutes = timeStringToMinutes(
    fundPolicy.fundOrderCutoffTime,
    timeStringToMinutes(DEFAULT_FUND_ORDER_CUTOFF_TIME),
  );
  const kstMinutes = getKstMinutes(now);

  return {
    dateKey: getKstDateKey(now),
    rebalanceOpenMinutes,
    startMinutes,
    cutoffMinutes,
    kstMinutes,
    isRebalanceOpen:
      !isKstWeekend(now) &&
      startMinutes < cutoffMinutes &&
      kstMinutes >= startMinutes &&
      kstMinutes < cutoffMinutes,
    isTradeOpen:
      !isKstWeekend(now) &&
      startMinutes < cutoffMinutes &&
      kstMinutes >= startMinutes &&
      kstMinutes < cutoffMinutes,
    isOpen:
      !isKstWeekend(now) &&
      startMinutes < cutoffMinutes &&
      kstMinutes >= startMinutes &&
      kstMinutes < cutoffMinutes,
  };
}

function clampFundMinHoldingsCount(value) {
  return Math.min(
    DEFAULT_MAX_HOLDINGS,
    Math.max(1, clampInt(value, DEFAULT_FUND_POLICY.fundMinHoldingsCount)),
  );
}

function clampFundMaxSingleWeightBps(value) {
  return Math.min(
    10000,
    Math.max(100, clampInt(value, DEFAULT_FUND_POLICY.fundMaxSingleWeightBps)),
  );
}

async function assertStockFeatureEnabled(classId) {
  const [globalConfig, classSnap] = await Promise.all([
    getGlobalConfig(),
    db.doc(`classes/${classId}`).get(),
  ]);

  const classData = classSnap.exists ? classSnap.data() : {};
  const planType = classData?.planType || "FREE";

  if (!canUseFeature(globalConfig, planType, "stock", "accessible")) {
    throw new HttpsError(
      "permission-denied",
      "현재 요금제에서는 펀드 기능을 사용할 수 없습니다.",
    );
  }

  return { classData, planType };
}

function normalizeFeePresets(rawPresets, legacyFees) {
  if (Array.isArray(rawPresets) && rawPresets.length > 0) {
    return rawPresets
      .map((preset, index) => ({
        id: cleanText(preset?.id, 40) || `preset-${index + 1}`,
        label: cleanText(preset?.label, 40) || `프리셋 ${index + 1}`,
        bps: Math.max(0, clampInt(preset?.bps, 0)),
      }))
      .filter((preset) => Number.isFinite(preset.bps));
  }

  if (Array.isArray(legacyFees) && legacyFees.length > 0) {
    return legacyFees.map((bps, index) => ({
      id: `preset-${index + 1}`,
      label: `프리셋 ${index + 1}`,
      bps: Math.max(0, clampInt(bps, 0)),
    }));
  }

  return DEFAULT_FUND_POLICY.fundFeePresets;
}

async function getFundPolicy(classId) {
  const stockConfigSnap = await db.doc(`classes/${classId}/config/stockMarket`).get();
  const stockConfig = stockConfigSnap.exists ? stockConfigSnap.data() || {} : {};
  const reportCycle = normalizeFundReportCycle(
    stockConfig.fundReportCycleDays,
    stockConfig.fundReportCadence,
    stockConfig.fundReportCadenceLabel || stockConfig.fundReportCycleDays,
  );

  const fundFeePresets = normalizeFeePresets(
    stockConfig.fundFeePresets,
    stockConfig.fundAllowedManagementFeeBpsWeekly,
  );
  const orderTimes = normalizeFundOrderTimes(
    stockConfig.fundOrderCutoffTime,
    stockConfig.fundDailyCutoffTime,
  );

  return {
    fundFeeMode: stockConfig.fundFeeMode === "fixed" ? "fixed" : "preset",
    fundFeePresets,
    fundFixedManagementFeeBpsWeekly: Math.max(
      0,
      clampInt(
        stockConfig.fundFixedManagementFeeBpsWeekly,
        DEFAULT_FUND_POLICY.fundFixedManagementFeeBpsWeekly,
      ),
    ),
    fundFixedManagementFeeLabel:
      cleanText(stockConfig.fundFixedManagementFeeLabel, 40) ||
      DEFAULT_FUND_POLICY.fundFixedManagementFeeLabel,
    fundReportCadence: reportCycle.fundReportCadence,
    fundReportCycleDays: reportCycle.fundReportCycleDays,
    fundReportCadenceLabel: reportCycle.fundReportCadenceLabel,
    fundMinHoldingsCount: clampFundMinHoldingsCount(stockConfig.fundMinHoldingsCount),
    fundMaxSingleWeightBps: clampFundMaxSingleWeightBps(
      stockConfig.fundMaxSingleWeightBps,
    ),
    ...orderTimes,
  };
}

function normalizeHoldings(inputHoldings, fundPolicy) {
  const rows = Array.isArray(inputHoldings) ? inputHoldings : [];
  const holdings = rows
    .map((item) => ({
      symbol: cleanText(item?.symbol, 12).toUpperCase(),
      weightBps: clampInt(item?.weightBps, 0),
    }))
    .filter((item) => item.symbol && item.weightBps > 0);

  if (
    holdings.length < fundPolicy.fundMinHoldingsCount ||
    holdings.length > DEFAULT_MAX_HOLDINGS
  ) {
    throw new HttpsError(
      "invalid-argument",
      `편입 종목은 최소 ${fundPolicy.fundMinHoldingsCount}개 이상, 최대 ${DEFAULT_MAX_HOLDINGS}개까지 등록할 수 있습니다.`,
    );
  }

  const symbolSet = new Set();
  let totalWeightBps = 0;

  holdings.forEach((item) => {
    if (symbolSet.has(item.symbol)) {
      throw new HttpsError(
        "invalid-argument",
        "같은 종목은 한 번만 선택할 수 있습니다.",
      );
    }

    if (item.weightBps > fundPolicy.fundMaxSingleWeightBps) {
      throw new HttpsError(
        "invalid-argument",
        `단일 종목 비중은 최대 ${(fundPolicy.fundMaxSingleWeightBps / 100).toFixed(0)}%까지 허용됩니다.`,
      );
    }

    symbolSet.add(item.symbol);
    totalWeightBps += item.weightBps;
  });

  if (totalWeightBps !== 10000) {
    throw new HttpsError(
      "invalid-argument",
      "편입 비중 합계는 정확히 100%여야 합니다.",
    );
  }

  return holdings;
}

function assertRegisteredFundHoldings(holdings, catalogEntries) {
  const unregisteredSymbols = findUnregisteredHoldingSymbols(holdings, catalogEntries);

  if (unregisteredSymbols.length > 0) {
    throw new HttpsError(
      "invalid-argument",
      `등록되지 않은 종목은 펀드에 편입할 수 없습니다: ${unregisteredSymbols.join(", ")}`,
    );
  }
}

function sanitizeApplicationPayload(application = {}, fundPolicy = DEFAULT_FUND_POLICY) {
  const fundName = cleanText(application?.fundName, 40);
  const summary = cleanText(application?.summary, 120);
  const strategy = cleanLongText(application?.strategy, 2000);
  const minInvestmentUSD = clampInt(application?.minInvestmentUSD, 0);
  const holdings = normalizeHoldings(application?.holdings, fundPolicy);
  const resubmittedFromApplicationId = cleanText(
    application?.resubmittedFromApplicationId,
    120,
  );

  const managementFee = resolveFundManagementFeeSelection(application);
  if (!managementFee) {
    throw new HttpsError(
      "invalid-argument",
      "운용보수는 연 0%, 1%, 2% 중에서 선택해 주세요.",
    );
  }

  if (fundName.length < 2) {
    throw new HttpsError("invalid-argument", "펀드명은 2자 이상이어야 합니다.");
  }

  if (!summary) {
    throw new HttpsError("invalid-argument", "한줄 소개를 입력해 주세요.");
  }

  if (strategy.length < 10) {
    throw new HttpsError(
      "invalid-argument",
      "운용 전략은 10자 이상 입력해 주세요.",
    );
  }

  if (minInvestmentUSD < 10) {
    throw new HttpsError(
      "invalid-argument",
      "최소 가입금액은 10 FIN 이상이어야 합니다.",
    );
  }

  return {
    fundName,
    summary,
    strategy,
    holdings,
    minInvestmentUSD,
    ...managementFee,
    benchmarkSymbol: DEFAULT_BENCHMARK_SYMBOL,
    benchmarkSymbols: DEFAULT_BENCHMARKS,
    reportCadence: fundPolicy.fundReportCadence,
    reportCycleDays: fundPolicy.fundReportCycleDays,
    reportCadenceLabel: fundPolicy.fundReportCadenceLabel,
    minHoldingsCount: fundPolicy.fundMinHoldingsCount,
    maxSingleWeightBps: fundPolicy.fundMaxSingleWeightBps,
    cashWeightBps: 0,
    resubmittedFromApplicationId: resubmittedFromApplicationId || null,
  };
}

exports.submitFundApplication = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { auth, data } = request;
    if (!auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const classId = cleanText(data?.classId, 80);
    if (!classId) {
      throw new HttpsError("invalid-argument", "학급 정보가 필요합니다.");
    }

    await assertStockFeatureEnabled(classId);

    const studentRef = db.doc(`classes/${classId}/students/${auth.uid}`);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) {
      throw new HttpsError(
        "permission-denied",
        "같은 학급 학생만 펀드 신청서를 제출할 수 있습니다.",
      );
    }

    const [studentData, fundPolicy] = await Promise.all([
      Promise.resolve(studentSnap.data() || {}),
      getFundPolicy(classId),
    ]);

    const application = sanitizeApplicationPayload(
      data?.application || {},
      fundPolicy,
    );
    const catalogEntries = await fetchTrackedSymbolsMeta();
    assertRegisteredFundHoldings(application.holdings, catalogEntries);
    const applicationRef = db.collection(`classes/${classId}/fundApplications`).doc();

    await applicationRef.set({
      ...application,
      classId,
      applicantUid: auth.uid,
      applicantName: cleanText(studentData?.name, 40) || auth.uid,
      status: "pending",
      teamMemberUids: [auth.uid],
      submittedAt: FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedBy: null,
      reviewedByName: "",
      reviewNote: "",
      approvedFundId: null,
    });

    return {
      success: true,
      applicationId: applicationRef.id,
      message: "펀드 개설 신청서를 제출했습니다.",
    };
  },
);

exports.reviewFundApplication = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { auth, data } = request;
    if (!auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const classId = cleanText(data?.classId, 80);
    const applicationId = cleanText(data?.applicationId, 120);
    const decision = cleanText(data?.decision, 20);
    const reviewNote = cleanLongText(data?.reviewNote, 500);

    if (!classId || !applicationId) {
      throw new HttpsError("invalid-argument", "필수 정보가 누락되었습니다.");
    }

    if (!["approved", "rejected"].includes(decision)) {
      throw new HttpsError("invalid-argument", "올바르지 않은 심사 상태입니다.");
    }

    assertTeacherOrAdminFromClaims(request, { classId });
    await assertStockFeatureEnabled(classId);

    const reviewerSnap = await db.doc(`classes/${classId}/students/${auth.uid}`).get();
    const reviewerName =
      cleanText(reviewerSnap.data()?.name, 40) || auth.token?.name || auth.uid;

    const applicationRef = db.doc(
      `classes/${classId}/fundApplications/${applicationId}`,
    );
    const catalogEntries = decision === "approved"
      ? await fetchTrackedSymbolsMeta()
      : [];

    return db.runTransaction(async (tx) => {
      const applicationSnap = await tx.get(applicationRef);

      if (!applicationSnap.exists) {
        throw new HttpsError("not-found", "신청서를 찾을 수 없습니다.");
      }

      const applicationData = applicationSnap.data() || {};
      if (applicationData.status !== "pending") {
        throw new HttpsError(
          "failed-precondition",
          "이미 처리된 신청서입니다.",
        );
      }

      const reviewPatch = {
        status: decision,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy: auth.uid,
        reviewedByName: reviewerName,
        reviewNote,
      };

      let fundId = null;

      if (decision === "approved") {
        const holdings = Array.isArray(applicationData.holdings)
          ? applicationData.holdings
          : [];
        assertRegisteredFundHoldings(holdings, catalogEntries);
        const approvalRiskSummary = await calculateActiveFundRiskSafe(
          db,
          { holdings, cashWeightBps: 0 },
          { reader: tx },
        );
        if (
          !approvalRiskSummary
          || buildHoldingsHash(holdings, 0) !== approvalRiskSummary.holdingsHash
        ) {
          throw new HttpsError(
            "aborted",
            "승인 중 편입 구성이 변경되었습니다. 다시 시도해 주세요.",
          );
        }
        reviewPatch.riskSummary = {
          ...approvalRiskSummary,
          calculatedAt: FieldValue.serverTimestamp(),
        };
        const fundRef = db.collection(`classes/${classId}/funds`).doc();
        fundId = fundRef.id;
        const reportCycle = normalizeFundReportCycle(
          applicationData.reportCycleDays,
          applicationData.reportCadence,
          applicationData.reportCadenceLabel,
        );
        const reportDueAt = admin.firestore.Timestamp.fromDate(
          addDays(new Date(), reportCycle.fundReportCycleDays),
        );
        const initialNavDateKey = getKstDateKey();

        tx.set(fundRef, {
          classId,
          applicationId,
          status: "open",
          joinStatus: "open",
          fundName: applicationData.fundName,
          managerUid: applicationData.applicantUid,
          managerName: applicationData.applicantName,
          teamMemberUids: Array.isArray(applicationData.teamMemberUids)
            ? applicationData.teamMemberUids
            : [applicationData.applicantUid],
          summary: applicationData.summary || "",
          strategy: applicationData.strategy || "",
          benchmarkSymbol:
            cleanText(applicationData.benchmarkSymbol, 12) ||
            DEFAULT_BENCHMARK_SYMBOL,
          benchmarkSymbols: Array.isArray(applicationData.benchmarkSymbols)
            ? applicationData.benchmarkSymbols
            : DEFAULT_BENCHMARKS,
          holdingsCurrent: Array.isArray(applicationData.holdings)
            ? applicationData.holdings
            : [],
          cashWeightBps: 0,
          minInvestmentUSD: clampInt(applicationData.minInvestmentUSD, 0),
          managementFeeBpsAnnual:
            applicationData.managementFeeBpsAnnual == null
              ? null
              : clampInt(applicationData.managementFeeBpsAnnual, 0),
          managementFeeBpsWeekly: round4(
            applicationData.managementFeeBpsWeekly,
          ),
          managementFeeLabel: cleanText(applicationData.managementFeeLabel, 40),
          reportCadence: reportCycle.fundReportCadence,
          reportCycleDays: reportCycle.fundReportCycleDays,
          reportCadenceLabel: reportCycle.fundReportCadenceLabel,
          minHoldingsCount: clampFundMinHoldingsCount(
            applicationData.minHoldingsCount,
          ),
          maxSingleWeightBps: clampFundMaxSingleWeightBps(
            applicationData.maxSingleWeightBps,
          ),
          baseNav: BASE_NAV,
          currentNav: BASE_NAV,
          previousNav: BASE_NAV,
          aumUSD: 0,
          unitsOutstanding: 0,
          investorCount: 0,
          reportCount: 0,
          reportOverdue: false,
          lastNavDate: null,
          navWindow30d: [{ dateKey: initialNavDateKey, nav: BASE_NAV }],
          performance30d: {
            returnPct: 0,
            startDate: initialNavDateKey,
            endDate: initialNavDateKey,
            periodDays: 0,
            isFullPeriod: false,
          },
          performanceSummary: buildFundPerformanceSummary({
            history: [{ dateKey: initialNavDateKey, nav: BASE_NAV }],
          }),
          riskSummary: {
            ...approvalRiskSummary,
            calculatedAt: FieldValue.serverTimestamp(),
          },
          lastReportAt: null,
          nextReportDueAt: reportDueAt,
          createdAt: FieldValue.serverTimestamp(),
          approvedAt: FieldValue.serverTimestamp(),
          approvedBy: auth.uid,
          approvedByName: reviewerName,
        });
        tx.set(
          fundRef.collection("navHistory").doc(initialNavDateKey),
          buildFundNavHistoryPayload({
            fundData: {
              fundName: applicationData.fundName,
              benchmarkSymbol:
                cleanText(applicationData.benchmarkSymbol, 12) ||
                DEFAULT_BENCHMARK_SYMBOL,
              holdingsCurrent: Array.isArray(applicationData.holdings)
                ? applicationData.holdings
                : [],
              cashWeightBps: 0,
              baseNav: BASE_NAV,
              unitsOutstanding: 0,
              investorCount: 0,
              lastRebalancedAt: null,
              riskSummary: approvalRiskSummary,
            },
            dateKey: initialNavDateKey,
            nav: BASE_NAV,
            previousNav: BASE_NAV,
            dailyReturn: 0,
            priceSourceDoc: "fund_created",
            snapshotType: "initial",
          }),
          { merge: true },
        );

        reviewPatch.approvedFundId = fundId;
      }

      tx.update(applicationRef, reviewPatch);

      return {
        success: true,
        decision,
        fundId,
        message:
          decision === "approved"
            ? "펀드 개설 신청을 승인했습니다."
            : "펀드 개설 신청을 반려했습니다.",
      };
    });
  },
);

async function loadFundClassContext(classId) {
  const [globalConfig, classSnap, marketConfig] = await Promise.all([
    getGlobalConfig(),
    db.doc(`classes/${classId}`).get(),
    getMarketConfig(null, classId),
  ]);

  const classData = classSnap.exists ? classSnap.data() || {} : {};
  return {
    globalConfig,
    classData,
    planType: classData?.planType || "FREE",
    currencyUnit: marketConfig.currencyUnit || "FIN",
  };
}

function buildTradeTimingErrorMessage(fundPolicy, now = new Date()) {
  const orderWindow = buildOrderWindowSummary(fundPolicy, now);

  if (isKstWeekend(now)) {
    return "주말(KST)에는 펀드 거래를 할 수 없습니다.";
  }

  if (orderWindow.kstMinutes < orderWindow.startMinutes) {
    return `펀드 거래는 주식 시세가 갱신되는 ${FUND_REBALANCE_OPEN_TIME} 이후부터 가능합니다.`;
  }

  return `펀드 거래 마감 시간은 ${fundPolicy.fundOrderCutoffTime}입니다.`;
}

function buildImmediateOrderSuccessMessage({ type, fundName }) {
  if (type === "subscribe") {
    return `${fundName} 가입이 즉시 체결되었습니다.`;
  }

  return `${fundName} 환매가 즉시 체결되었습니다.`;
}

async function rejectFundOrderTransaction({
  tx,
  classId,
  orderRef,
  orderData,
  studentRef,
  positionRef,
  positionData,
  reason,
  logContext,
  nowTs,
}) {
  if (orderData.type === "subscribe") {
    const heldAmountUSD = round4(
      asNum(orderData.heldAmountUSD, orderData.requestedAmountUSD),
    );
    if (heldAmountUSD > 0 && studentRef) {
      tx.update(studentRef, {
        "assets.usdBalance": FieldValue.increment(heldAmountUSD),
      });
    }

    stageActivityLog(
      tx,
      classId,
      {
        studentUid: orderData.studentUid,
        type: "income",
        category: "fund_order_refund",
        amount: heldAmountUSD,
        currency: "USD",
        description: `${orderData.fundName || "펀드"} 가입 주문이 반려되어 환불되었습니다.`,
        relatedDoc: { collection: "fundOrders", id: orderRef.id },
      },
      logContext,
    );
  }

  if (orderData.type === "redeem" && positionRef && positionData) {
    const reservedUnits = round4(asNum(positionData.reservedUnits, 0));
    const requestedUnits = round4(asNum(orderData.requestedUnits, 0));
    const nextReservedUnits = Math.max(0, round4(reservedUnits - requestedUnits));

    tx.set(
      positionRef,
      {
        reservedUnits: nextReservedUnits,
        updatedAt: nowTs,
      },
      { merge: true },
    );
  }

  tx.update(orderRef, {
    status: "rejected",
    rejectionReason: reason,
    processedAt: nowTs,
  });
}

async function executeFundOrder({
  classId,
  orderId,
  batchDateKey,
  nowTs,
  logContext,
}) {
  const orderRef = db.doc(`classes/${classId}/fundOrders/${orderId}`);

  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      return { skipped: true, reason: "not-found" };
    }

    const orderData = orderSnap.data() || {};
    if (
      orderData.status !== "submitted" ||
      orderData.cycleDateKST !== batchDateKey
    ) {
      return { skipped: true, reason: "already-processed" };
    }

    const fundRef = db.doc(`classes/${classId}/funds/${orderData.fundId}`);
    const studentRef = db.doc(`classes/${classId}/students/${orderData.studentUid}`);
    const positionRef = db.doc(
      `classes/${classId}/fundPositions/${getFundPositionId(
        orderData.fundId,
        orderData.studentUid,
      )}`,
    );

    const [fundSnap, studentSnap, positionSnap] = await Promise.all([
      tx.get(fundRef),
      tx.get(studentRef),
      tx.get(positionRef),
    ]);

    if (!fundSnap.exists || !studentSnap.exists) {
      await rejectFundOrderTransaction({
        tx,
        classId,
        orderRef,
        orderData,
        studentRef: studentSnap.exists ? studentRef : null,
        positionRef: positionSnap.exists ? positionRef : null,
        positionData: positionSnap.exists ? positionSnap.data() || {} : null,
        reason: "펀드 또는 학생 정보를 찾을 수 없어 주문을 처리하지 못했습니다.",
        logContext,
        nowTs,
      });
      return {
        rejected: true,
        reason: "펀드 또는 학생 정보를 찾을 수 없어 주문을 처리할 수 없습니다.",
      };
    }

    const fundData = fundSnap.data() || {};
    const positionData = positionSnap.exists ? positionSnap.data() || {} : {};
    const currentNav = getFundNav(fundData);
    const executionNav = getFundOrderExecutionNav(orderData, currentNav);
    const fundName = cleanText(fundData.fundName || orderData.fundName, 60);
    const previousUnitsOutstanding = round4(asNum(fundData.unitsOutstanding, 0));
    const previousInvestorCount = Math.max(0, clampInt(fundData.investorCount, 0));

    if (orderData.type === "subscribe") {
      if (
        fundData.status !== "open" ||
        getJoinStatusForReportState(fundData, false) !== "open"
      ) {
        await rejectFundOrderTransaction({
          tx,
          classId,
          orderRef,
          orderData,
          studentRef,
          positionRef: null,
          positionData: null,
          reason: "현재 이 펀드는 신규 가입을 받을 수 없습니다.",
          logContext,
          nowTs,
        });
        return {
          rejected: true,
          reason: "현재 이 펀드는 가입을 받을 수 없습니다.",
        };
      }

      const heldAmountUSD = round4(
        asNum(orderData.heldAmountUSD, orderData.requestedAmountUSD),
      );
      const issuedUnits = round4(heldAmountUSD / executionNav);
      const previousUnits = round4(asNum(positionData.units, 0));
      const nextUnits = round4(previousUnits + issuedUnits);
      const previousTotalInvestedUSD = round4(asNum(positionData.totalInvestedUSD, 0));
      const nextTotalInvestedUSD = round4(previousTotalInvestedUSD + heldAmountUSD);
      const nextAverageCostNav =
        nextUnits > 0 ? round4(nextTotalInvestedUSD / nextUnits) : executionNav;
      const nextUnitsOutstanding = round4(previousUnitsOutstanding + issuedUnits);
      const nextInvestorCount =
        previousUnits <= FUND_POSITION_EPSILON
          ? previousInvestorCount + 1
          : previousInvestorCount;

      tx.set(
        positionRef,
        {
          classId,
          fundId: orderData.fundId,
          fundName,
          studentUid: orderData.studentUid,
          studentName:
            cleanText(orderData.studentName, 40) ||
            cleanText(studentSnap.data()?.name, 40),
          units: nextUnits,
          reservedUnits: round4(asNum(positionData.reservedUnits, 0)),
          totalInvestedUSD: nextTotalInvestedUSD,
          averageCostNav: nextAverageCostNav,
          joinedAt: positionData.joinedAt || nowTs,
          updatedAt: nowTs,
        },
        { merge: true },
      );

      tx.update(fundRef, {
        unitsOutstanding: nextUnitsOutstanding,
        investorCount: nextInvestorCount,
        aumUSD: computeFundAumUSD(currentNav, nextUnitsOutstanding),
        updatedAt: nowTs,
      });

      tx.update(orderRef, {
        status: "executed",
        processedAt: nowTs,
        executedAt: nowTs,
        executedNav: executionNav,
        executedUnits: issuedUnits,
        executedAmountUSD: heldAmountUSD,
      });

      stageActivityLog(
        tx,
        classId,
        {
          studentUid: orderData.studentUid,
          type: "expense",
          category: "fund_subscribe",
          amount: heldAmountUSD,
          currency: "USD",
          description: `${fundName} 가입 주문이 체결되었습니다. (${issuedUnits.toFixed(4)}좌)`,
          relatedDoc: { collection: "fundOrders", id: orderRef.id },
        },
        logContext,
      );

      return { executed: true };
    }

    const reservedUnits = round4(asNum(positionData.reservedUnits, 0));
    const currentUnits = round4(asNum(positionData.units, 0));
    const requestedUnits = round4(asNum(orderData.requestedUnits, 0));

    if (
      !positionSnap.exists ||
      requestedUnits <= 0 ||
      reservedUnits + FUND_POSITION_EPSILON < requestedUnits ||
      currentUnits + FUND_POSITION_EPSILON < requestedUnits
    ) {
      await rejectFundOrderTransaction({
        tx,
        classId,
        orderRef,
        orderData,
        studentRef,
        positionRef,
        positionData,
        reason: "환매 가능한 좌수가 부족해 주문을 처리하지 못했습니다.",
        logContext,
        nowTs,
      });
      return {
        rejected: true,
        reason: "환매 가능한 보유 수량이 부족해 주문을 처리할 수 없습니다.",
      };
    }

    const payoutUSD = round4(requestedUnits * executionNav);
    const nextReservedUnits = Math.max(0, round4(reservedUnits - requestedUnits));
    const nextUnitsRaw = round4(currentUnits - requestedUnits);
    const nextUnits =
      nextUnitsRaw <= FUND_POSITION_EPSILON ? 0 : nextUnitsRaw;
    const previousTotalInvestedUSD = round4(asNum(positionData.totalInvestedUSD, 0));
    const nextTotalInvestedUSD =
      nextUnits > 0 && currentUnits > 0
        ? round4(previousTotalInvestedUSD * (nextUnits / currentUnits))
        : 0;
    const nextUnitsOutstanding = Math.max(
      0,
      round4(previousUnitsOutstanding - requestedUnits),
    );
    const nextInvestorCount =
      currentUnits > FUND_POSITION_EPSILON && nextUnits <= FUND_POSITION_EPSILON
        ? Math.max(0, previousInvestorCount - 1)
        : previousInvestorCount;

    tx.update(studentRef, {
      "assets.usdBalance": FieldValue.increment(payoutUSD),
    });

    if (nextUnits <= FUND_POSITION_EPSILON && nextReservedUnits <= FUND_POSITION_EPSILON) {
      tx.delete(positionRef);
    } else {
      tx.set(
        positionRef,
        {
          units: nextUnits,
          reservedUnits: nextReservedUnits,
          totalInvestedUSD: nextTotalInvestedUSD,
          averageCostNav:
            nextUnits > 0 ? round4(nextTotalInvestedUSD / nextUnits) : 0,
          updatedAt: nowTs,
        },
        { merge: true },
      );
    }

    tx.update(fundRef, {
      unitsOutstanding: nextUnitsOutstanding,
      investorCount: nextInvestorCount,
      aumUSD: computeFundAumUSD(currentNav, nextUnitsOutstanding),
      updatedAt: nowTs,
    });

    tx.update(orderRef, {
      status: "executed",
      processedAt: nowTs,
      executedAt: nowTs,
      executedNav: executionNav,
      executedUnits: requestedUnits,
      executedAmountUSD: payoutUSD,
    });

    stageActivityLog(
      tx,
      classId,
      {
        studentUid: orderData.studentUid,
        type: "income",
        category: "fund_redeem",
        amount: payoutUSD,
        currency: "USD",
        description: `${fundName} 환매 주문이 체결되었습니다. (${requestedUnits.toFixed(4)}좌)`,
        relatedDoc: { collection: "fundOrders", id: orderRef.id },
      },
      logContext,
    );

    return { executed: true };
  });
}

async function processFundOrdersForClass(classId, batchDateKey = getKstDateKey()) {
  const nowTs = admin.firestore.Timestamp.now();
  const targetOrdersSnap = await db
    .collection(`classes/${classId}/fundOrders`)
    .where("status", "==", "submitted")
    .where("cycleDateKST", "==", batchDateKey)
    .get();
  const targetOrders = targetOrdersSnap.docs;

  if (!targetOrders.length) {
    await db.doc(`classes/${classId}/config/stockMarket`).set(
      {
        fundLastExecutedCycleDateKST: batchDateKey,
        fundLastExecutedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      success: true,
      classId,
      batchDateKey,
      submittedCount: 0,
      executed: 0,
      rejected: 0,
      currencyUnit: "FIN",
    };
  }

  const { globalConfig, currencyUnit, planType } = await loadFundClassContext(classId);
  const logContext = {
    config: globalConfig,
    planType,
    serviceName: "stock",
  };

  let executed = 0;
  let rejected = 0;

  for (const orderDoc of targetOrders) {
    const result = await executeFundOrder({
      classId,
      orderId: orderDoc.id,
      batchDateKey,
      nowTs,
      logContext,
    });

    if (result?.executed) executed += 1;
    if (result?.rejected) rejected += 1;
  }

  await db.doc(`classes/${classId}/config/stockMarket`).set(
    {
      fundLastExecutedCycleDateKST: batchDateKey,
      fundLastExecutedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    success: true,
    classId,
    batchDateKey,
    submittedCount: targetOrders.length,
    executed,
    rejected,
    currencyUnit,
  };
}

exports.submitFundOrder = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { auth, data } = request;
    if (!auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const classId = cleanText(data?.classId, 80);
    const fundId = cleanText(data?.fundId, 120);
    const type = cleanText(data?.type, 20);
    const requestedAmountUSD = round2(asNum(data?.amountUSD, 0));
    const role = cleanText(auth.token?.role, 20);
    const isTeacherOrAdmin = role === "teacher" || role === "admin";
    const canBypassSubscribeTiming = isTeacherOrAdmin && type === "subscribe";
    if (isTeacherOrAdmin) {
      assertTeacherOrAdminFromClaims(request, { classId });
    }

    if (!classId || !fundId || !["subscribe", "redeem"].includes(type)) {
      throw new HttpsError("invalid-argument", "주문 정보가 올바르지 않습니다.");
    }

    if (requestedAmountUSD <= 0) {
      throw new HttpsError("invalid-argument", "주문 금액은 0보다 커야 합니다.");
    }

    if (!canBypassSubscribeTiming && isKstWeekend()) {
      throw new HttpsError(
        "failed-precondition",
        "주말(KST)에는 펀드 주문을 낼 수 없습니다.",
      );
    }

    await assertStockFeatureEnabled(classId);
    const fundPolicy = await getFundPolicy(classId);
    const orderWindow = buildOrderWindowSummary(fundPolicy);
    if (!canBypassSubscribeTiming && !orderWindow.isTradeOpen) {
      throw new HttpsError(
        "failed-precondition",
        buildTradeTimingErrorMessage(fundPolicy),
      );
    }

    const submission = await db.runTransaction(async (tx) => {
      const studentRef = db.doc(`classes/${classId}/students/${auth.uid}`);
      const fundRef = db.doc(`classes/${classId}/funds/${fundId}`);
      const positionRef = db.doc(
        `classes/${classId}/fundPositions/${getFundPositionId(fundId, auth.uid)}`,
      );

      const [studentSnap, fundSnap, positionSnap] = await Promise.all([
        tx.get(studentRef),
        tx.get(fundRef),
        tx.get(positionRef),
      ]);

      if (!studentSnap.exists) {
        throw new HttpsError("not-found", "학생 정보를 찾을 수 없습니다.");
      }

      if (!fundSnap.exists) {
        throw new HttpsError("not-found", "펀드 정보를 찾을 수 없습니다.");
      }

      const studentData = studentSnap.data() || {};
      const fundData = fundSnap.data() || {};
      const positionData = positionSnap.exists ? positionSnap.data() || {} : {};
      const currentNav = getFundNav(fundData);
      const orderRef = db.collection(`classes/${classId}/fundOrders`).doc();
      const studentName =
        cleanText(studentData?.name, 40) || cleanText(auth.token?.name, 40) || auth.uid;

      if (type === "subscribe") {
        if (
          fundData.status !== "open" ||
          getJoinStatusForReportState(fundData, false) !== "open"
        ) {
          throw new HttpsError(
            "failed-precondition",
            "현재 이 펀드는 신규 가입을 받을 수 없습니다.",
          );
        }

        if (requestedAmountUSD < Math.max(10, clampInt(fundData.minInvestmentUSD, 0))) {
          throw new HttpsError(
            "failed-precondition",
            `최소 가입금액은 ${clampInt(fundData.minInvestmentUSD, 0)} FIN입니다.`,
          );
        }

        const balanceUSD = round4(asNum(studentData?.assets?.usdBalance, 0));
        if (balanceUSD < requestedAmountUSD) {
          throw new HttpsError(
            "failed-precondition",
            `FIN 잔액이 부족합니다. (보유: ${balanceUSD.toFixed(2)} FIN)`,
          );
        }

        tx.update(studentRef, {
          "assets.usdBalance": FieldValue.increment(-requestedAmountUSD),
        });

        tx.set(orderRef, {
          classId,
          fundId,
          fundName: cleanText(fundData.fundName, 60),
          studentUid: auth.uid,
          studentName,
          type,
          status: "submitted",
          requestedAmountUSD,
          heldAmountUSD: requestedAmountUSD,
          requestedNav: currentNav,
          cycleDateKST: orderWindow.dateKey,
          submittedAt: FieldValue.serverTimestamp(),
          processedAt: null,
          executedAt: null,
          executedNav: null,
          executedUnits: null,
          executedAmountUSD: null,
          rejectionReason: "",
        });

        return {
          success: true,
          orderId: orderRef.id,
          type,
          fundName: cleanText(fundData.fundName, 60),
          message: `${fundData.fundName} 가입 주문을 접수했습니다.`,
        };
      }

      const currentUnits = round4(asNum(positionData.units, 0));
      const reservedUnits = round4(asNum(positionData.reservedUnits, 0));
      const availableUnits = Math.max(
        0,
        round4(currentUnits - reservedUnits),
      );
      const availableAmountUSD = round4(availableUnits * currentNav);
      if (availableAmountUSD <= 0) {
        throw new HttpsError(
          "failed-precondition",
          "환매 가능한 보유 좌수가 없습니다.",
        );
      }

      if (requestedAmountUSD > availableAmountUSD + 0.01) {
        throw new HttpsError(
          "failed-precondition",
          `환매 가능 금액은 ${availableAmountUSD.toFixed(2)} FIN까지입니다.`,
        );
      }

      const requestedUnits = round4(
        Math.min(availableUnits, requestedAmountUSD / currentNav),
      );
      if (requestedUnits <= FUND_POSITION_EPSILON) {
        throw new HttpsError(
          "failed-precondition",
          "환매 가능한 좌수가 부족합니다.",
        );
      }

      tx.set(
        positionRef,
        {
          classId,
          fundId,
          fundName: cleanText(fundData.fundName, 60),
          studentUid: auth.uid,
          studentName,
          reservedUnits: round4(reservedUnits + requestedUnits),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      tx.set(orderRef, {
        classId,
        fundId,
        fundName: cleanText(fundData.fundName, 60),
        studentUid: auth.uid,
        studentName,
        type,
        status: "submitted",
        requestedAmountUSD: round4(requestedUnits * currentNav),
        requestedUnits,
        requestedNav: currentNav,
        cycleDateKST: orderWindow.dateKey,
        submittedAt: FieldValue.serverTimestamp(),
        processedAt: null,
        executedAt: null,
        executedNav: null,
        executedUnits: null,
        executedAmountUSD: null,
        rejectionReason: "",
      });

      return {
        success: true,
        orderId: orderRef.id,
        type,
        fundName: cleanText(fundData.fundName, 60),
        message: `${fundData.fundName} 환매 주문을 접수했습니다.`,
      };
    });

    const { globalConfig, currencyUnit, planType } = await loadFundClassContext(classId);
    const executionResult = await executeFundOrder({
      classId,
      orderId: submission.orderId,
      batchDateKey: orderWindow.dateKey,
      nowTs: admin.firestore.Timestamp.now(),
      logContext: {
        config: globalConfig,
        planType,
        serviceName: "stock",
      },
    });

    if (executionResult?.executed) {
      return {
        success: true,
        orderId: submission.orderId,
        currencyUnit,
        message: buildImmediateOrderSuccessMessage(submission),
      };
    }

    if (executionResult?.rejected) {
      throw new HttpsError(
        "failed-precondition",
        executionResult.reason || "주문 즉시 체결에 실패했습니다.",
      );
    }

    throw new HttpsError("internal", "주문 즉시 체결 결과를 확인하지 못했습니다.");
  },
);

exports.processFundOrdersManually = onCall(
  { region: "asia-northeast3", timeoutSeconds: 120, memory: "256MiB" },
  async (request) => {
    const { auth, data } = request;
    if (!auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const classId = cleanText(data?.classId, 80);
    if (!classId) {
      throw new HttpsError("invalid-argument", "학급 정보가 필요합니다.");
    }

    assertTeacherOrAdminFromClaims(request, { classId });
    const batchDateKey = cleanText(data?.batchDateKST, 20) || getKstDateKey();
    return processFundOrdersForClass(classId, batchDateKey);
  },
);

exports.updateFundsDailyNav = onSchedule(
  {
    schedule: "45 7 * * 1-6",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3",
    timeoutSeconds: 300,
    memory: "256MiB",
  },
  async () => {
    const { targetNY } = getPrefetchContext();
    const datedSummarySnap = await db
      .collection("stockMarketSummary")
      .doc(`quotes_${targetNY}`)
      .get();
    const fallbackSummarySnap = await db
      .collection("stockMarketSummary")
      .doc("today_quotes_all")
      .get();
    const summarySnap = datedSummarySnap.exists ? datedSummarySnap : fallbackSummarySnap;
    if (!summarySnap.exists) return null;

    const priceMap = summarySnap.data() || {};
    const priceSourceDoc = datedSummarySnap.exists
      ? `quotes_${targetNY}`
      : "today_quotes_all";
    const classesSnap = await db.collection("classes").get();

    for (const classDoc of classesSnap.docs) {
      const fundsSnap = await classDoc.ref.collection("funds").get();
      if (fundsSnap.empty) continue;

      const batch = db.batch();
      const fundsWithHistory = await Promise.all(
        fundsSnap.docs.map(async (fundDoc) => {
          const historySnap = await fundDoc.ref
            .collection("navHistory")
            .orderBy("dateKey", "asc")
            .get();
          return {
            fundDoc,
            history: historySnap.docs.map((historyDoc) => historyDoc.data() || {}),
          };
        }),
      );

      fundsWithHistory.forEach(({ fundDoc, history }) => {
        const fundData = fundDoc.data() || {};
        if (fundData.deletedAt) return;
        const navHistoryRef = fundDoc.ref.collection("navHistory").doc(targetNY);
        if (cleanText(fundData.lastNavDate, 20) === targetNY) {
          const currentNav = getFundNav(fundData);
          const performance = buildFundPerformance30d({
            existingWindow: fundData.navWindow30d,
            dateKey: targetNY,
            nav: currentNav,
          });
          const performanceSummary = buildFundPerformanceSummary({
            history,
            currentPoint: { dateKey: targetNY, nav: currentNav },
            endDate: targetNY,
          });
          batch.update(fundDoc.ref, { ...performance, performanceSummary });
          batch.set(
            navHistoryRef,
            buildFundNavHistoryPayload({
              fundData,
              dateKey: targetNY,
              nav: currentNav,
              previousNav: round4(asNum(fundData.previousNav, currentNav)),
              dailyReturn: round4(asNum(fundData.navReturnRate, 0)),
              priceSourceDoc:
                cleanText(fundData.navPriceSourceDoc, 40) || priceSourceDoc,
              snapshotType: "daily",
            }),
            { merge: true },
          );
          return;
        }

        const previousNav = getFundNav(fundData);
        const dailyReturn = computeWeightedDailyReturn(
          fundData.holdingsCurrent,
          priceMap,
          fundData.cashWeightBps,
        );
        const currentNav = Math.max(0.01, round4(previousNav * (1 + dailyReturn)));
        const performance = buildFundPerformance30d({
          existingWindow: fundData.navWindow30d,
          dateKey: targetNY,
          nav: currentNav,
        });
        const performanceSummary = buildFundPerformanceSummary({
          history,
          currentPoint: { dateKey: targetNY, nav: currentNav },
          endDate: targetNY,
        });

        batch.update(fundDoc.ref, {
          previousNav,
          currentNav,
          lastNavDate: targetNY,
          navReturnRate: round4(dailyReturn),
          navPriceSourceDoc: priceSourceDoc,
          navUpdatedAt: FieldValue.serverTimestamp(),
          aumUSD: computeFundAumUSD(currentNav, fundData.unitsOutstanding),
          ...performance,
          performanceSummary,
        });
        batch.set(
          navHistoryRef,
          buildFundNavHistoryPayload({
            fundData,
            dateKey: targetNY,
            nav: currentNav,
            previousNav,
            dailyReturn,
            priceSourceDoc,
            snapshotType: "daily",
          }),
          { merge: true },
        );
      });

      await batch.commit();
    }

    return null;
  },
);
