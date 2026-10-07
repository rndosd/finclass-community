"use strict";

const admin = require("../firebaseAdminCompat");
const { FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const { fetchTrackedSymbolsMeta } = require("../utils/prefetchUtils");
const { findUnregisteredHoldingSymbols } = require("../utils/fundStockCatalog");
const { resolveFundManagementFeeSelection } = require("../utils/fundManagementFee");
const { getFundDeletionBlockReason } = require("../utils/fundDeletionPolicy");
const { stageActivityLog } = require("../utils/logUtils");
const { calculateActiveFundRiskSafe } = require("../utils/fundRiskRepository");
const { buildHoldingsHash } = require("../utils/portfolioRisk");

const db = admin.firestore();

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

const DEFAULT_FUND_POLICY = {
  fundFeeMode: "preset",
  fundFeePresets: [
    { id: "free", label: "무료형", bps: 0 },
    { id: "basic", label: "기본형", bps: 5 },
    { id: "growth", label: "성장형", bps: 10 },
    { id: "active", label: "액티브형", bps: 20 },
  ],
  fundFixedManagementFeeBpsWeekly: 10,
  fundFixedManagementFeeLabel: "교사 고정",
  fundReportCadence: DEFAULT_FUND_REPORT_CADENCE,
  fundReportCycleDays: DEFAULT_FUND_REPORT_CYCLE_DAYS,
  fundReportCadenceLabel: "7일",
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

const cleanText = (value, maxLength = 2000) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const cleanLongText = (value, maxLength = 4000) =>
  String(value || "").trim().slice(0, maxLength);

const kstDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function getKstParts(date = new Date()) {
  const parts = kstDateFormatter.formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";

  return {
    weekday: read("weekday"),
    hour: read("hour"),
    minute: read("minute"),
  };
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
  const days = legacy.fundReportCadence === "biweekly" ? 14 : 7;
  return {
    fundReportCadence: legacy.fundReportCadence,
    fundReportCycleDays: days,
    fundReportCadenceLabel: `${days}일`,
  };
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

function timeStringToMinutes(value, fallback = 0) {
  const normalized = normalizeTimeString(value, null);
  if (!normalized) return fallback;
  const [hour, minute] = normalized.split(":").map((part) => Number(part));
  return hour * 60 + minute;
}

function normalizeConfiguredTime(value, fallback, min, max) {
  const normalized = normalizeTimeString(value, fallback);
  const minutes = timeStringToMinutes(normalized, -1);
  const minMinutes = timeStringToMinutes(min, -1);
  const maxMinutes = timeStringToMinutes(max, -1);
  if (minutes < minMinutes || minutes > maxMinutes) {
    return fallback;
  }

  return normalized;
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
    throw new HttpsError("invalid-argument", "펀드 소개를 입력해 주세요.");
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

function buildRebalanceTimingErrorMessage(fundPolicy) {
  return `리밸런싱은 거래 마감 시간인 ${fundPolicy.fundOrderCutoffTime}까지만 가능합니다.`;
}

function buildStrictRebalanceWindowSummary(fundPolicy, now = new Date()) {
  const rebalanceOpenMinutes = timeStringToMinutes(
    FUND_REBALANCE_OPEN_TIME,
    timeStringToMinutes(FUND_REBALANCE_OPEN_TIME),
  );
  const cutoffMinutes = timeStringToMinutes(
    fundPolicy.fundOrderCutoffTime,
    timeStringToMinutes(DEFAULT_FUND_ORDER_CUTOFF_TIME),
  );
  const kstMinutes = getKstMinutes(now);

  return {
    rebalanceOpenMinutes,
    cutoffMinutes,
    kstMinutes,
    isOpen:
      !isKstWeekend(now) &&
      kstMinutes >= rebalanceOpenMinutes &&
      kstMinutes < cutoffMinutes,
  };
}

function buildStrictRebalanceTimingErrorMessage(fundPolicy, now = new Date()) {
  if (isKstWeekend(now)) {
    return "주말에는 리밸런싱을 할 수 없습니다.";
  }

  const rebalanceWindow = buildStrictRebalanceWindowSummary(fundPolicy, now);
  if (rebalanceWindow.kstMinutes < rebalanceWindow.rebalanceOpenMinutes) {
    return `리밸런싱은 주식 시세가 갱신되는 ${FUND_REBALANCE_OPEN_TIME} 이후부터 ${fundPolicy.fundOrderCutoffTime}까지 가능합니다.`;
  }

  return `리밸런싱은 주식 시세가 갱신되는 ${FUND_REBALANCE_OPEN_TIME} 이후부터 ${fundPolicy.fundOrderCutoffTime}까지 가능합니다.`;
}

function sanitizeFundProfilePayload(data = {}) {
  const summary = cleanText(data?.summary, 160);
  const strategy = cleanLongText(data?.strategy, 2000);

  if (summary.length < 5) {
    throw new HttpsError("invalid-argument", "펀드 소개는 5자 이상 입력해 주세요.");
  }

  if (strategy.length < 10) {
    throw new HttpsError("invalid-argument", "운용 전략은 10자 이상 입력해 주세요.");
  }

  return {
    summary,
    strategy,
  };
}

exports.submitFundApplicationV2 = onCall(
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

    const application = sanitizeApplicationPayload(data?.application || {}, fundPolicy);
    const catalogEntries = await fetchTrackedSymbolsMeta();
    assertRegisteredFundHoldings(application.holdings, catalogEntries);
    const riskSummary = await calculateActiveFundRiskSafe(db, {
      holdings: application.holdings,
      cashWeightBps: 0,
    });
    const applicantName = cleanText(studentData?.name, 40) || auth.uid;
    const retryApplicationId = cleanText(application.resubmittedFromApplicationId, 120);

    if (retryApplicationId) {
      const applicationRef = db.doc(
        `classes/${classId}/fundApplications/${retryApplicationId}`,
      );

      await db.runTransaction(async (tx) => {
        const applicationSnap = await tx.get(applicationRef);
        if (!applicationSnap.exists) {
          throw new HttpsError("not-found", "수정할 기존 신청서를 찾을 수 없습니다.");
        }

        const existingData = applicationSnap.data() || {};
        if (existingData.applicantUid !== auth.uid) {
          throw new HttpsError(
            "permission-denied",
            "본인이 제출한 신청서만 수정 후 다시 제출할 수 있습니다.",
          );
        }

        if (existingData.status !== "rejected") {
          throw new HttpsError(
            "failed-precondition",
            "반려된 신청서만 수정 후 다시 제출할 수 있습니다.",
          );
        }

        tx.update(applicationRef, {
          ...application,
          riskSummary: { ...riskSummary, calculatedAt: FieldValue.serverTimestamp() },
          resubmittedFromApplicationId: null,
          classId,
          applicantUid: auth.uid,
          applicantName,
          status: "pending",
          teamMemberUids: [auth.uid],
          submittedAt: FieldValue.serverTimestamp(),
          reviewedAt: null,
          reviewedBy: null,
          reviewedByName: "",
          reviewNote: "",
          approvedFundId: null,
          updatedAt: FieldValue.serverTimestamp(),
          lastResubmittedAt: FieldValue.serverTimestamp(),
          resubmissionCount: FieldValue.increment(1),
        });
      });

      return {
        success: true,
        applicationId: retryApplicationId,
        message: "펀드 신청서를 수정 후 다시 제출했습니다.",
      };
    }

    const applicationRef = db.collection(`classes/${classId}/fundApplications`).doc();

    await applicationRef.set({
      ...application,
      riskSummary: { ...riskSummary, calculatedAt: FieldValue.serverTimestamp() },
      resubmittedFromApplicationId: null,
      classId,
      applicantUid: auth.uid,
      applicantName,
      status: "pending",
      teamMemberUids: [auth.uid],
      submittedAt: FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedBy: null,
      reviewedByName: "",
      reviewNote: "",
      approvedFundId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      resubmissionCount: 0,
    });

    return {
      success: true,
      applicationId: applicationRef.id,
      message: "펀드 개설 신청서를 제출했습니다.",
    };
  },
);
exports.submitFundRebalance = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { auth, data } = request;
    if (!auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const classId = cleanText(data?.classId, 80);
    const fundId = cleanText(data?.fundId, 120);
    const role = cleanText(auth.token?.role, 20);
    const isTeacherOrAdmin = role === "teacher" || role === "admin";
    if (isTeacherOrAdmin) {
      assertTeacherOrAdminFromClaims(request, { classId });
    }
    if (!classId || !fundId) {
      throw new HttpsError("invalid-argument", "학급과 펀드 정보가 필요합니다.");
    }

    if (!isTeacherOrAdmin && isKstWeekend()) {
      throw new HttpsError(
        "failed-precondition",
        "주말에는 리밸런싱할 수 없습니다.",
      );
    }

    await assertStockFeatureEnabled(classId);
    const fundPolicy = await getFundPolicy(classId);
    const rebalanceWindow = buildStrictRebalanceWindowSummary(fundPolicy);

    if (!isTeacherOrAdmin && !rebalanceWindow.isOpen) {
      throw new HttpsError(
        "failed-precondition",
        buildStrictRebalanceTimingErrorMessage(fundPolicy),
      );
    }

    const catalogEntries = await fetchTrackedSymbolsMeta();
    const preliminaryFundSnap = await db.doc(`classes/${classId}/funds/${fundId}`).get();
    if (!preliminaryFundSnap.exists) {
      throw new HttpsError("not-found", "펀드를 찾을 수 없습니다.");
    }
    const preliminaryFundData = preliminaryFundSnap.data() || {};
    const preliminaryPolicy = {
      fundMinHoldingsCount: clampFundMinHoldingsCount(
        preliminaryFundData.minHoldingsCount ?? fundPolicy.fundMinHoldingsCount,
      ),
      fundMaxSingleWeightBps: clampFundMaxSingleWeightBps(
        preliminaryFundData.maxSingleWeightBps ?? fundPolicy.fundMaxSingleWeightBps,
      ),
    };
    const preliminaryHoldings = normalizeHoldings(data?.holdings, preliminaryPolicy);
    assertRegisteredFundHoldings(preliminaryHoldings, catalogEntries);
    return db.runTransaction(async (tx) => {
      const fundRef = db.doc(`classes/${classId}/funds/${fundId}`);
      const actorRef = db.doc(`classes/${classId}/students/${auth.uid}`);
      const [fundSnap, actorSnap] = await Promise.all([tx.get(fundRef), tx.get(actorRef)]);

      if (!fundSnap.exists) {
        throw new HttpsError("not-found", "펀드를 찾을 수 없습니다.");
      }

      const fundData = fundSnap.data() || {};
      const role = cleanText(auth.token?.role, 20);
      const isTeacherOrAdmin = role === "teacher" || role === "admin";

      if (isTeacherOrAdmin) {
        assertTeacherOrAdminFromClaims(request, { classId });
      } else if (fundData.managerUid !== auth.uid) {
        throw new HttpsError(
          "permission-denied",
          "펀드 개설자만 리밸런싱할 수 있습니다.",
        );
      }

      if (cleanText(fundData.status, 20) === "closed") {
        throw new HttpsError(
          "failed-precondition",
          "운용이 종료된 펀드는 리밸런싱할 수 없습니다.",
        );
      }

      const rebalancePolicy = {
        fundMinHoldingsCount: clampFundMinHoldingsCount(
          fundData.minHoldingsCount ?? fundPolicy.fundMinHoldingsCount,
        ),
        fundMaxSingleWeightBps: clampFundMaxSingleWeightBps(
          fundData.maxSingleWeightBps ?? fundPolicy.fundMaxSingleWeightBps,
        ),
      };
      const holdingsCurrent = normalizeHoldings(data?.holdings, rebalancePolicy);
      assertRegisteredFundHoldings(holdingsCurrent, catalogEntries);
      const riskSummary = await calculateActiveFundRiskSafe(
        db,
        { holdings: holdingsCurrent, cashWeightBps: 0 },
        { reader: tx },
      );
      if (buildHoldingsHash(holdingsCurrent, 0) !== riskSummary.holdingsHash) {
        throw new HttpsError("aborted", "편입 구성이 변경되었습니다. 다시 시도해 주세요.");
      }
      const actorName =
        cleanText(actorSnap.data()?.name, 40) ||
        cleanText(auth.token?.name, 40) ||
        auth.uid;

      tx.update(fundRef, {
        holdingsCurrent,
        cashWeightBps: 0,
        updatedAt: FieldValue.serverTimestamp(),
        lastRebalancedAt: FieldValue.serverTimestamp(),
        lastRebalancedBy: auth.uid,
        lastRebalancedByName: actorName,
        riskSummary: { ...riskSummary, calculatedAt: FieldValue.serverTimestamp() },
      });

      return {
        success: true,
        fundId,
        message: `${cleanText(fundData.fundName, 60) || "펀드"} 리밸런싱을 저장했습니다.`,
      };
    });
  },
);

exports.updateFundProfile = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { auth, data } = request;
    if (!auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const classId = cleanText(data?.classId, 80);
    const fundId = cleanText(data?.fundId, 120);
    if (!classId || !fundId) {
      throw new HttpsError("invalid-argument", "학급과 펀드 정보가 필요합니다.");
    }

    await assertStockFeatureEnabled(classId);
    const profile = sanitizeFundProfilePayload(data);

    return db.runTransaction(async (tx) => {
      const fundRef = db.doc(`classes/${classId}/funds/${fundId}`);
      const actorRef = db.doc(`classes/${classId}/students/${auth.uid}`);
      const [fundSnap, actorSnap] = await Promise.all([tx.get(fundRef), tx.get(actorRef)]);

      if (!fundSnap.exists) {
        throw new HttpsError("not-found", "펀드를 찾을 수 없습니다.");
      }

      const fundData = fundSnap.data() || {};
      const role = cleanText(auth.token?.role, 20);
      const isTeacherOrAdmin = role === "teacher" || role === "admin";

      if (isTeacherOrAdmin) {
        assertTeacherOrAdminFromClaims(request, { classId });
      } else if (fundData.managerUid !== auth.uid) {
        throw new HttpsError(
          "permission-denied",
          "펀드 소개는 펀드 개설자만 수정할 수 있습니다.",
        );
      }

      const actorName =
        cleanText(actorSnap.data()?.name, 40) ||
        cleanText(auth.token?.name, 40) ||
        auth.uid;

      tx.update(fundRef, {
        summary: profile.summary,
        strategy: profile.strategy,
        profileUpdatedAt: FieldValue.serverTimestamp(),
        profileUpdatedBy: auth.uid,
        profileUpdatedByName: actorName,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        fundId,
        message: `${cleanText(fundData.fundName, 60) || "펀드"} 소개를 업데이트했습니다.`,
      };
    });
  },
);

exports.deleteFund = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { auth, data } = request;
    if (!auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const classId = cleanText(data?.classId, 80);
    const fundId = cleanText(data?.fundId, 120);
    if (!classId || !fundId) {
      throw new HttpsError("invalid-argument", "학급과 펀드 정보가 필요합니다.");
    }

    assertTeacherOrAdminFromClaims(request, { classId });
    await assertStockFeatureEnabled(classId);

    return db.runTransaction(async (tx) => {
      const fundRef = db.doc(`classes/${classId}/funds/${fundId}`);
      const actorRef = db.doc(`classes/${classId}/students/${auth.uid}`);
      const positionsQuery = db
        .collection(`classes/${classId}/fundPositions`)
        .where("fundId", "==", fundId);
      const submittedOrdersQuery = db
        .collection(`classes/${classId}/fundOrders`)
        .where("fundId", "==", fundId)
        .where("status", "==", "submitted");
      const [fundSnap, actorSnap, positionsSnap, submittedOrdersSnap] =
        await Promise.all([
          tx.get(fundRef),
          tx.get(actorRef),
          tx.get(positionsQuery),
          tx.get(submittedOrdersQuery),
        ]);

      if (!fundSnap.exists) {
        throw new HttpsError("not-found", "펀드를 찾을 수 없습니다.");
      }

      const fundData = fundSnap.data() || {};
      if (fundData.deletedAt) {
        return {
          success: true,
          fundId,
          alreadyDeleted: true,
          message: "이미 삭제된 펀드입니다.",
        };
      }

      const blockReason = getFundDeletionBlockReason({
        fund: fundData,
        positions: positionsSnap.docs.map((docSnap) => docSnap.data() || {}),
        orders: submittedOrdersSnap.docs.map((docSnap) => docSnap.data() || {}),
      });
      if (blockReason) {
        throw new HttpsError("failed-precondition", blockReason);
      }

      const fundName = cleanText(fundData.fundName, 60) || "펀드";
      const actorName =
        cleanText(actorSnap.data()?.name, 40) ||
        cleanText(auth.token?.name, 40) ||
        auth.uid;
      const now = FieldValue.serverTimestamp();

      tx.update(fundRef, {
        status: "closed",
        joinStatus: "closed",
        deletedAt: now,
        deletedBy: auth.uid,
        deletedByName: actorName,
        updatedAt: now,
      });

      if (fundData.managerUid) {
        stageActivityLog(
          tx,
          classId,
          {
            studentUid: fundData.managerUid,
            type: "system",
            category: "fund_deleted",
            amount: 0,
            currency: "FIN",
            description: `${fundName} 펀드가 교사에 의해 삭제되었습니다.`,
            actorUid: auth.uid,
            actorName,
            relatedDoc: { collection: "funds", id: fundId },
          },
          {
            serviceName: "stock",
            actionKey: "fund_deleted",
            forceWrite: true,
          },
        );
      }

      return {
        success: true,
        fundId,
        message: `${fundName} 펀드를 삭제했습니다.`,
      };
    });
  },
);
