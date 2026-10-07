"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");

const db = admin.firestore();

const DEFAULT_FUND_REPORT_CYCLE_DAYS = 7;
const MIN_FUND_REPORT_CYCLE_DAYS = 1;
const MAX_FUND_REPORT_CYCLE_DAYS = 30;

const asNum = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clampInt = (value, fallback = 0) => Math.round(asNum(value, fallback));

const cleanText = (value, maxLength = 2000) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const cleanLongText = (value, maxLength = 4000) =>
  String(value || "").trim().slice(0, maxLength);

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

  const normalizedLegacyValue = cleanText(legacyCadence, 20);
  const normalizedLegacyLabel = cleanText(legacyLabel, 40);
  const days =
    normalizedLegacyValue === "biweekly" ||
    normalizedLegacyLabel.includes("격주") ||
    normalizedLegacyLabel.includes("2주")
      ? 14
      : DEFAULT_FUND_REPORT_CYCLE_DAYS;

  return {
    fundReportCadence:
      days === 14 ? "biweekly" : normalizedLegacyValue === "weekly" ? "weekly" : "days",
    fundReportCycleDays: days,
    fundReportCadenceLabel: `${days}일`,
  };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isFundReportOverdue(fund = {}, now = new Date()) {
  const nextReportDueAt = fund.nextReportDueAt?.toDate?.() || fund.nextReportDueAt;
  if (!nextReportDueAt) return false;
  return new Date(nextReportDueAt).getTime() <= now.getTime();
}

function getJoinStatusForReportState(fund = {}) {
  const status = cleanText(fund.status, 20);
  const joinStatus = cleanText(fund.joinStatus, 40);

  if (status === "closed") return "closed";
  if (status === "paused" || joinStatus === "paused") return "paused";
  return "open";
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

function sanitizeReportPayload(data = {}) {
  const title = cleanText(data?.title, 80);
  const summary = cleanText(data?.summary, 200);
  const content = cleanLongText(data?.content, 3000);
  const reason = cleanLongText(data?.reason, 1500);
  const nextPlan = cleanLongText(data?.nextPlan, 1500);
  const hasStructuredAnswers = Boolean(reason || nextPlan);

  if (title.length < 2) {
    throw new HttpsError("invalid-argument", "보고서 제목은 2자 이상이어야 합니다.");
  }

  if (summary.length < 5) {
    throw new HttpsError("invalid-argument", "보고서 요약은 5자 이상 입력해 주세요.");
  }

  if (content.length < 20) {
    throw new HttpsError("invalid-argument", "보고서 본문은 20자 이상 입력해 주세요.");
  }

  if (hasStructuredAnswers && reason.length < 5) {
    throw new HttpsError("invalid-argument", "변화한 이유를 5자 이상 입력해 주세요.");
  }

  if (hasStructuredAnswers && nextPlan.length < 5) {
    throw new HttpsError("invalid-argument", "다음 운용 계획을 5자 이상 입력해 주세요.");
  }

  return {
    title,
    summary,
    content,
    reason: hasStructuredAnswers ? reason : null,
    nextPlan: hasStructuredAnswers ? nextPlan : null,
  };
}

function sanitizeReportUpdateTarget(data = {}) {
  const reportId = cleanText(data?.reportId, 120);
  if (!reportId) {
    throw new HttpsError("invalid-argument", "수정할 보고서 정보가 필요합니다.");
  }
  return reportId;
}

exports.submitFundReport = onCall(
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
    const payload = sanitizeReportPayload(data);

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
          "펀드 개설자만 운용 보고서를 제출할 수 있습니다.",
        );
      }

      if (cleanText(fundData.status, 20) === "closed") {
        throw new HttpsError(
          "failed-precondition",
          "운용이 종료된 펀드는 보고서를 제출할 수 없습니다.",
        );
      }

      const reportCycle = normalizeFundReportCycle(
        fundData.reportCycleDays,
        fundData.reportCadence,
        fundData.reportCadenceLabel,
      );
      const nowTs = admin.firestore.Timestamp.now();
      const nowDate = nowTs.toDate();
      const reportRef = db.collection(`classes/${classId}/fundReports`).doc();
      const reportNumber = Math.max(0, clampInt(fundData.reportCount, 0)) + 1;
      const nextReportDueAt = admin.firestore.Timestamp.fromDate(
        addDays(nowDate, reportCycle.fundReportCycleDays),
      );
      const actorName =
        cleanText(actorSnap.data()?.name, 40) ||
        cleanText(auth.token?.name, 40) ||
        auth.uid;

      tx.set(reportRef, {
        classId,
        fundId,
        fundName: cleanText(fundData.fundName, 60),
        managerUid: cleanText(fundData.managerUid, 80) || auth.uid,
        managerName: cleanText(fundData.managerName, 40) || actorName,
        submittedByUid: auth.uid,
        submittedByName: actorName,
        reportNumber,
        title: payload.title,
        summary: payload.summary,
        content: payload.content,
        reason: payload.reason,
        nextPlan: payload.nextPlan,
        reportCycleDays: reportCycle.fundReportCycleDays,
        reportCadenceLabel: reportCycle.fundReportCadenceLabel,
        previousDueAt: fundData.nextReportDueAt || null,
        overdueAtSubmission: isFundReportOverdue(fundData, nowDate),
        submittedAt: nowTs,
        createdAt: nowTs,
        updatedAt: nowTs,
      });

      tx.update(fundRef, {
        reportCadence: reportCycle.fundReportCadence,
        reportCycleDays: reportCycle.fundReportCycleDays,
        reportCadenceLabel: reportCycle.fundReportCadenceLabel,
        reportCount: reportNumber,
        reportOverdue: false,
        lastReportAt: nowTs,
        lastReportId: reportRef.id,
        lastReportTitle: payload.title,
        lastReportSummary: payload.summary,
        nextReportDueAt,
        joinStatus: getJoinStatusForReportState(fundData, false),
        updatedAt: nowTs,
      });

      return {
        success: true,
        reportId: reportRef.id,
        message: `${cleanText(fundData.fundName, 60) || "펀드"} 운용 보고서를 제출했습니다.`,
      };
    });
  },
);
exports.updateFundReport = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { auth, data } = request;
    if (!auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const classId = cleanText(data?.classId, 80);
    const fundId = cleanText(data?.fundId, 120);
    const reportId = sanitizeReportUpdateTarget(data);
    if (!classId || !fundId) {
      throw new HttpsError("invalid-argument", "학급과 펀드 정보가 필요합니다.");
    }

    await assertStockFeatureEnabled(classId);
    const payload = sanitizeReportPayload(data);

    return db.runTransaction(async (tx) => {
      const fundRef = db.doc(`classes/${classId}/funds/${fundId}`);
      const reportRef = db.doc(`classes/${classId}/fundReports/${reportId}`);
      const actorRef = db.doc(`classes/${classId}/students/${auth.uid}`);
      const [fundSnap, reportSnap, actorSnap] = await Promise.all([
        tx.get(fundRef),
        tx.get(reportRef),
        tx.get(actorRef),
      ]);

      if (!fundSnap.exists) {
        throw new HttpsError("not-found", "펀드를 찾을 수 없습니다.");
      }

      if (!reportSnap.exists) {
        throw new HttpsError("not-found", "보고서를 찾을 수 없습니다.");
      }

      const fundData = fundSnap.data() || {};
      const reportData = reportSnap.data() || {};
      const role = cleanText(auth.token?.role, 20);
      const isTeacherOrAdmin = role === "teacher" || role === "admin";

      if (isTeacherOrAdmin) {
        assertTeacherOrAdminFromClaims(request, { classId });
      } else if (cleanText(reportData.submittedByUid, 80) !== auth.uid) {
        throw new HttpsError(
          "permission-denied",
          "보고서를 제출한 사람만 수정할 수 있습니다.",
        );
      }

      if (cleanText(reportData.fundId, 120) !== fundId) {
        throw new HttpsError("failed-precondition", "다른 펀드의 보고서는 수정할 수 없습니다.");
      }

      if (cleanText(fundData.lastReportId, 120) !== reportId) {
        throw new HttpsError(
          "failed-precondition",
          "가장 최근에 제출한 보고서만 수정할 수 있습니다.",
        );
      }

      const nowTs = admin.firestore.Timestamp.now();
      const actorName =
        cleanText(actorSnap.data()?.name, 40) ||
        cleanText(auth.token?.name, 40) ||
        auth.uid;

      tx.update(reportRef, {
        title: payload.title,
        summary: payload.summary,
        content: payload.content,
        reason: payload.reason,
        nextPlan: payload.nextPlan,
        updatedAt: nowTs,
        lastEditedAt: nowTs,
        lastEditedByUid: auth.uid,
        lastEditedByName: actorName,
      });

      tx.update(fundRef, {
        lastReportTitle: payload.title,
        lastReportSummary: payload.summary,
        updatedAt: nowTs,
      });

      return {
        success: true,
        reportId,
        message: `${cleanText(fundData.fundName, 60) || "펀드"} 보고서를 수정했습니다.`,
      };
    });
  },
);
