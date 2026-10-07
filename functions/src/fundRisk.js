"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { FieldValue } = require("firebase-admin/firestore");
const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const {
  areRiskSummariesEquivalent,
  calculateActiveFundRiskSafe,
  calculateFundRiskForConfigSafe,
} = require("../utils/fundRiskRepository");

const db = admin.firestore();

function cleanText(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizePreviewHoldings(value) {
  return (Array.isArray(value) ? value : [])
    .map((holding) => ({
      symbol: cleanText(holding?.symbol, 12).toUpperCase(),
      weightBps: Math.max(0, Math.round(Number(holding?.weightBps) || 0)),
    }))
    .filter((holding) => holding.symbol && holding.weightBps > 0)
    .slice(0, 12);
}

async function assertClassAccess(request, classId) {
  const role = cleanText(request.auth?.token?.role, 20);
  if (role === "teacher" || role === "admin") {
    assertTeacherOrAdminFromClaims(request, { classId });
    return;
  }
  const memberSnap = await db.doc(`classes/${classId}/students/${request.auth.uid}`).get();
  if (!memberSnap.exists) throw new HttpsError("permission-denied", "같은 학급 사용자만 위험도를 확인할 수 있습니다.");
}

exports.previewFundRisk = onCall(
  { region: "asia-northeast3", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const classId = cleanText(request.data?.classId, 80);
    if (!classId) throw new HttpsError("invalid-argument", "학급 정보가 필요합니다.");
    await assertClassAccess(request, classId);

    const holdings = normalizePreviewHoldings(request.data?.holdings);
    if (!holdings.length) throw new HttpsError("invalid-argument", "편입 종목이 필요합니다.");
    return calculateActiveFundRiskSafe(db, { holdings, cashWeightBps: 0 });
  },
);

exports.refreshFundRiskSummariesMonthly = onSchedule(
  {
    schedule: "0 10 2 * *",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const configSnap = await db.doc("riskConfig/active").get();
    if (!configSnap.exists || configSnap.data()?.status !== "active") return null;
    const fixedConfig = configSnap.data() || {};

    const classesSnap = await db.collection("classes").select().get();
    const writer = db.bulkWriter();
    writer.onWriteError((error) => error.failedAttempts < 3);

    for (const classDoc of classesSnap.docs) {
      const fundsSnap = await classDoc.ref.collection("funds").get();
      for (const fundDoc of fundsSnap.docs) {
        const fund = fundDoc.data() || {};
        if (fund.deletedAt || fund.status === "closed") continue;
        const riskSummary = await calculateFundRiskForConfigSafe(
          db,
          fixedConfig,
          {
            holdings: fund.holdingsCurrent,
            cashWeightBps: fund.cashWeightBps,
          },
        );
        if (
          riskSummary.reason === "risk_calculation_failed"
          || areRiskSummariesEquivalent(fund.riskSummary, riskSummary)
        ) {
          continue;
        }
        writer.update(
          fundDoc.ref,
          {
            riskSummary: { ...riskSummary, calculatedAt: FieldValue.serverTimestamp() },
            riskUpdatedAt: FieldValue.serverTimestamp(),
          },
          { lastUpdateTime: fundDoc.updateTime },
        );
      }
    }

    await writer.close();
    return null;
  },
);
