// src/missions.js

// ================================
// Firebase Admin & Functions v2
// ================================
const admin = require("../firebaseAdminCompat");

// 🚨 [수정 중요] FieldValue를 가장 안전한 경로로 가져옵니다.
// require("firebase-admin/firestore") 방식은 환경에 따라 undefined가 될 수 있어 500 에러의 주원인이 됩니다.
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

// ================================
// External libs
// ================================
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

// ================================
// Permissions
// ================================
const { hasPermission } = require("../utils/permissions");

// ================================
// Log utils (활동/신용점수 로그)
// ================================
const { stageActivityLog, stageCreditLog } = require("../utils/logUtils");
const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { stageTaxIncome } = require("../utils/taxIncome");
const {
  stageActivityTaxCancellation,
  stageTaxPostingLink,
} = require("../utils/taxReversal");
const { getWithholdingPolicy } = require("../utils/taxPolicy");
const { buildIncomeTaxSnapshot } = require("../utils/incomeTaxUtils");
const { assertMissionApprovalVersions } = require("../utils/missionApprovalVersion");
const {
  stageMissionStatePatch,
  readMissionStudentStates,
} = require("../utils/missionStudentState");

// dayjs plugins
dayjs.extend(utc);
dayjs.extend(timezone);

// ================================
/** Config toggles */
// ================================
// 알림 전면 제거(사용 안함)
// const ENABLE_IMMEDIATE_MISSION_NOTI = false;
const ENABLE_REWARD_CLAMP = false; // 보상값 클램프 (요청사항: 비활성 기본)

// ================================
// Common Utils
// ================================
const toDateSafe = (v) => {
  try {
    if (!v) return null;
    return typeof v.toDate === "function" ? v.toDate() : new Date(v);
  } catch {
    return null;
  }
};

const normalize = (n) =>
  ENABLE_REWARD_CLAMP
    ? Math.max(0, Math.floor(Number(n) || 0))
    : Number(n) || 0;

const REWARD_TYPES = ["currency", "credit", "missionToken"];
const DEFAULT_TIER_COLOR = "#64748b";

function buildMissionRewardIncomeTax(classData = {}, grossAmount = 0) {
  return buildIncomeTaxSnapshot({
    sourceKey: "missionReward",
    grossAmount,
    policy: getWithholdingPolicy(classData, "missionReward") || {},
  });
}

function buildRewardPayoutSnapshot(reward = {}, incomeTaxSnapshot = null) {
  return {
    ...reward,
    currency: incomeTaxSnapshot ? incomeTaxSnapshot.netAmount : Number(reward.currency || 0),
    grossCurrency: Number(reward.currency || 0),
    currencyWithheld: Number(incomeTaxSnapshot?.withheldAmount || 0),
    incomeTax: incomeTaxSnapshot?.incomeTax || null,
  };
}

function stageMissionRewardWithholdingTax({
  tx,
  classId,
  studentUid,
  studentName,
  missionId,
  missionTitle,
  actorUid,
  logContext,
  incomeTaxSnapshot,
  classData,
}) {
  if (!(incomeTaxSnapshot?.withheldAmount > 0)) return null;

  return stageTaxIncome(
    tx,
    classId,
    {
      amount: incomeTaxSnapshot.withheldAmount,
      source: "mission_reward_withholding",
      taxType: "income_tax",
      description: `미션 보상 원천징수 - ${missionTitle || "미션"}`,
      studentUid,
      studentName,
      breakdown: {
        baseAmount: incomeTaxSnapshot.grossAmount,
        taxAmount: incomeTaxSnapshot.withheldAmount,
        taxRate: incomeTaxSnapshot.incomeTax.taxRate,
      },
    },
    actorUid,
    {
      ...logContext,
      classData,
      sourceKey: "missionReward",
      detailLines: [
        {
          id: `${missionId}_${studentUid}`,
          amount: incomeTaxSnapshot.withheldAmount,
          source: "mission_reward_withholding",
          taxType: "income_tax",
          description: `미션 보상 원천징수 - ${missionTitle || "미션"}`,
          studentUid,
          studentName,
          relatedDoc: { collection: "missions", id: missionId },
          meta: {
            incomeTax: incomeTaxSnapshot.incomeTax,
          },
        },
      ],
    },
  );
}

const normalizeRewardNumber = (value) => Math.max(0, normalize(value));

function normalizeRewardConfig(type, rawReward = {}) {
  if (!REWARD_TYPES.includes(type)) return null;

  const amount = normalizeRewardNumber(rawReward?.amount);
  const hasRangeFields =
    rawReward?.isRange === true ||
    rawReward?.mode === "range" ||
    rawReward?.minAmount !== undefined ||
    rawReward?.maxAmount !== undefined;

  let minAmount = hasRangeFields
    ? normalizeRewardNumber(rawReward?.minAmount ?? amount)
    : amount;
  let maxAmount = hasRangeFields
    ? normalizeRewardNumber(rawReward?.maxAmount ?? amount)
    : amount;

  if (maxAmount < minAmount) {
    [minAmount, maxAmount] = [maxAmount, minAmount];
  }

  return {
    type,
    amount: hasRangeFields ? maxAmount : amount,
    minAmount,
    maxAmount,
    isRange: hasRangeFields && maxAmount !== minAmount,
  };
}

function getRewardConfigs(mission = {}) {
  const base = {
    currency: normalizeRewardConfig("currency"),
    credit: normalizeRewardConfig("credit"),
    missionToken: normalizeRewardConfig("missionToken"),
  };
  const rewards = mission?.rewards;

  if (Array.isArray(rewards)) {
    rewards.forEach((reward) => {
      const type = reward?.type;
      if (!REWARD_TYPES.includes(type)) return;
      base[type] = normalizeRewardConfig(type, reward);
    });
    return base;
  }

  if (rewards && typeof rewards === "object") {
    base.currency = normalizeRewardConfig("currency", {
      amount: rewards.currency,
    });
    base.credit = normalizeRewardConfig("credit", {
      amount: rewards.credit,
    });
    base.missionToken = normalizeRewardConfig("missionToken", {
      amount: rewards.missionToken ?? rewards.token,
    });
  }

  return base;
}

function missionHasRewardRange(mission = {}) {
  return Object.values(getRewardConfigs(mission)).some(
    (reward) => reward.isRange && reward.maxAmount > 0,
  );
}

function resolveRewardSnapshot(mission, rewardOverride = null, allowReward = true) {
  if (!allowReward) {
    return { currency: 0, credit: 0, missionToken: 0 };
  }

  const configs = getRewardConfigs(mission);
  const override =
    rewardOverride && typeof rewardOverride === "object" ? rewardOverride : {};
  const rewardSnapshot = {};

  REWARD_TYPES.forEach((type) => {
    const config = configs[type];
    if (!config || config.maxAmount <= 0) {
      rewardSnapshot[type] = 0;
      return;
    }

    if (!config.isRange) {
      rewardSnapshot[type] = config.maxAmount;
      return;
    }

    const rawValue = override[type];
    const resolvedValue =
      rawValue === undefined || rawValue === null || rawValue === ""
        ? config.maxAmount
        : normalizeRewardNumber(rawValue);

    if (resolvedValue < config.minAmount || resolvedValue > config.maxAmount) {
      throw new Error(
        `${type} 보상은 ${config.minAmount}~${config.maxAmount} 범위에서만 승인할 수 있습니다.`,
      );
    }

    rewardSnapshot[type] = resolvedValue;
  });

  return rewardSnapshot;
}

function normalizeTierMeta(rawTier = null) {
  if (!rawTier) return null;

  if (typeof rawTier === "string") {
    const value = rawTier.trim();
    if (!value) return null;
    return {
      id: value,
      name: value,
      color: DEFAULT_TIER_COLOR,
      minScore: 0,
    };
  }

  const id = String(rawTier?.id || rawTier?.name || "").trim();
  const name = String(rawTier?.name || rawTier?.id || "").trim();
  if (!id && !name) return null;

  const parsedMinScore = Number(rawTier?.minScore);
  return {
    id: id || name,
    name: name || id,
    color: String(rawTier?.color || DEFAULT_TIER_COLOR),
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
  };
}

function getMissionMinTierRequirement(mission = {}) {
  const tierFromObject = normalizeTierMeta(mission?.minCreditTier);
  if (tierFromObject) return tierFromObject;

  const tierId = String(mission?.minCreditTierId || "").trim();
  if (!tierId) return null;

  const parsedMinScore = Number(mission?.minCreditTierMinScore);
  return {
    id: tierId,
    name: String(mission?.minCreditTierName || tierId).trim(),
    color: String(mission?.minCreditTierColor || DEFAULT_TIER_COLOR),
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
  };
}

function getStudentTierInfo(studentData = {}) {
  return normalizeTierMeta(studentData?.creditTier);
}

function meetsMissionTierRequirement(mission = {}, studentData = {}) {
  const minTier = getMissionMinTierRequirement(mission);
  if (!minTier) return true;

  const studentScore = Number(studentData?.creditScore);
  if (Number.isFinite(studentScore)) {
    return studentScore >= Number(minTier.minScore || 0);
  }

  const studentTier = getStudentTierInfo(studentData);
  if (!studentTier) return false;

  if (studentTier.id && minTier.id && studentTier.id === minTier.id) {
    return true;
  }

  return Number(studentTier.minScore || 0) >= Number(minTier.minScore || 0);
}

function isMissionAssignedToStudent(mission = {}, studentUid, studentData = {}) {
  const resolvedUid = String(studentUid || "").trim();
  if (!resolvedUid) return false;

  const targets = Array.isArray(mission?.targetStudentUids)
    ? mission.targetStudentUids
    : [];

  if (targets.length > 0 && !targets.includes(resolvedUid)) {
    return false;
  }

  return meetsMissionTierRequirement(mission, studentData);
}

function assertMissionEligibility(mission = {}, studentUid, studentData = {}) {
  const resolvedUid = String(studentUid || "").trim();
  if (!resolvedUid) {
    throw new Error("학생 정보가 올바르지 않습니다.");
  }

  const targets = Array.isArray(mission?.targetStudentUids)
    ? mission.targetStudentUids
    : [];
  if (targets.length > 0 && !targets.includes(resolvedUid)) {
    throw new Error("이 미션의 수행 대상 학생이 아닙니다.");
  }

  const minTier = getMissionMinTierRequirement(mission);
  if (minTier && !isMissionAssignedToStudent(mission, resolvedUid, studentData)) {
    throw new Error(
      `${minTier.name || "지정"} 등급 이상 학생만 수행할 수 있는 미션입니다.`,
    );
  }
}

function getSubmittedAtForMission(mission = {}, studentUid, submissionData = null) {
  return toDateSafe(
    submissionData?.submittedAt ||
      submissionData?.createdAt ||
      mission?.completions?.[studentUid]?.submittedAt,
  );
}

// ================================
// Late/Reward 정책 (공통 헬퍼)
// ================================
function computeLate(mission, actionAt = new Date()) {
  const end = toDateSafe(mission?.timeWindow?.end);
  return !!end && actionAt > end;
}

function isLateSubmissionAllowed(mission) {
  return mission?.allowLateSubmission !== false;
}

// 현재 정책: 지각 무보상(필요 시 mission.rewardPolicy?.late 로 확장 가능)
function decideRewardAllowed(mission, wasLate) {
  // 예: const p = mission?.rewardPolicy?.late; if (wasLate && p === 'none') return false;
  return !wasLate;
}

function snapshotReward(mission, allow, rewardOverride = null) {
  return resolveRewardSnapshot(mission, rewardOverride, allow);
}

function hasPositiveReward(snap) {
  return (
    (snap?.currency ?? 0) > 0 ||
    (snap?.credit ?? 0) > 0 ||
    (snap?.missionToken ?? 0) > 0
  );
}

function canMissionUseSubmission(mission) {
  const t = mission?.type;
  const requireForm = !!mission?.requireSubmissionForm;
  return t === "challenge" || requireForm;
}

function assertMissionRequestClass(request, classId) {
  if (request.auth?.token?.role !== "admin" && request.auth?.token?.classId !== classId) {
    throw new HttpsError("permission-denied", "다른 학급의 과제를 처리할 수 없습니다.");
  }
}

/* =====================================================================
 * 3) 일괄 승인
 * ===================================================================== */

exports.approveMissionBatch = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60 },
  async (request) => {
    const uid = request.auth?.uid;
    const role = request.auth?.token?.role;
    const { classId, missionId, items } = request.data || {};

    // 0. 기본 검증
    if (!uid || !classId || !missionId || !Array.isArray(items)) {
      throw new HttpsError("invalid-argument", "필수 정보가 누락되었습니다.");
    }
    if (items.length === 0)
      return { success: true, message: "승인할 대상이 없습니다." };
    if (items.length > 50)
      throw new HttpsError(
        "invalid-argument",
        "최대 50명까지 처리 가능합니다.",
      );
    if (new Set(items.map((item) => item.uid || item.studentUid)).size !== items.length) {
      throw new HttpsError("invalid-argument", "한 학생을 중복하여 승인할 수 없습니다.");
    }

    // 1. 권한 확인 (루프 밖에서 딱 한 번!)
    assertMissionRequestClass(request, classId);
    const isTeacher = role === "teacher" || role === "admin";
    if (!isTeacher && !(await hasPermission(uid, classId, "mission_admin"))) {
      throw new HttpsError("permission-denied", "미션 승인 권한이 없습니다.");
    }

    // 2. 전역 정책 로드 (메모리 캐시 적용됨)
    const globalConfig = await getGlobalConfig();

    const missionRef = db.doc(`classes/${classId}/missions/${missionId}`);
    const classRef = db.doc(`classes/${classId}`);

    // 🌟 [최적화 핵심] 읽어야 할 모든 참조(Ref) 리스트를 미리 만듭니다.
    const submissionRefs = items
      .filter((i) => i.submissionId)
      .map((i) =>
        db.doc(
          `classes/${classId}/missions/${missionId}/submissions/${i.submissionId}`,
        ),
      );
    // 보상을 지급할 학생들의 참조 리스트 (중복 제거)
    const uniqueStudentUids = [
      ...new Set(items.map((i) => i.uid || i.studentUid)),
    ];
    const studentRefs = uniqueStudentUids.map((sUid) =>
      db.doc(`classes/${classId}/students/${sUid}`),
    );

    const results = { success: [], failed: [] };

    await db.runTransaction(async (tx) => {
      // 3. [일괄 읽기] 미션, 학급, 모든 제출물, 모든 학생 정보를 동시에 가져옵니다.
      results.success.length = 0;
      results.failed.length = 0;
      const snaps = await tx.getAll(
        missionRef,
        classRef,
        ...submissionRefs,
        ...studentRefs,
      );

      const missionSnap = snaps[0];
      const classSnap = snaps[1];
      const submissionSnaps = snaps.slice(2, 2 + submissionRefs.length);
      const studentSnaps = snaps.slice(2 + submissionRefs.length);

      if (!missionSnap.exists)
        throw new HttpsError("not-found", "미션을 찾을 수 없습니다.");

      const mission = await readMissionStudentStates(db, missionRef, missionSnap.data(), { tx, studentUids: uniqueStudentUids });
      const classData = classSnap.exists ? classSnap.data() : {};
      // Optional optimistic preconditions used by reviewed assistant approvals.
      // Check inside the same transaction as the reward and completion writes.
      assertMissionApprovalVersions(request.data, missionSnap, classSnap,
        (code, message) => new HttpsError(code, message), mission, uniqueStudentUids);
      const planType = classData.planType || "FREE";
      const currencyUnit = classData.currencyUnit || "단위";
      const serverTime = FieldValue.serverTimestamp();

      const logContext = {
        config: globalConfig,
        planType,
        serviceName: "mission",
      };
      const missionPatch = {}; // Mission 문서의 completions 업데이트를 모을 바구니

      // 데이터 매핑용 Map 생성 (속도 향상)
      const subMap = new Map(
        submissionSnaps.map((s) => [s.id, s.exists ? s.data() : null]),
      );
      const stuMap = new Map(
        studentSnaps.map((s) => [s.id, s.exists ? s.data() : null]),
      );

      // 4. [루프] 이제 메모리에 있는 데이터를 바탕으로 로직 처리 (네트워크 통신 없음)
      for (const item of items) {
        try {
          const studentUid = item.uid || item.studentUid;
          const studentData = stuMap.get(studentUid);
          const subData = item.submissionId
            ? subMap.get(item.submissionId)
            : null;
          const completion = mission.completions?.[studentUid] || {};
          const feedback = (item.feedback ?? "").trim() || null;

          if (!studentUid || !studentData) {
            throw new Error("학생 정보를 찾을 수 없습니다.");
          }

          assertMissionEligibility(mission, studentUid, studentData);
          if (["approved", "late-approved"].includes(completion.status) || completion.rewardGranted === true) {
            throw new Error("이미 승인된 기록입니다. 승인 취소 후 다시 처리해주세요.");
          }
          if (mission.stateStorageVersion === 2 && item.submissionId &&
              (mission.submissionsIndex?.[studentUid] || completion.submissionId) !== item.submissionId) {
            throw new Error("현재 제출물과 일치하지 않습니다.");
          }

          if (item.submissionId) {
            if (!subData) {
              throw new Error("승인할 제출을 찾을 수 없습니다.");
            }
            if (subData.studentUid && subData.studentUid !== studentUid) {
              throw new Error("제출 학생 정보가 올바르지 않습니다.");
            }
            if (!["pending", "late"].includes(subData.status || "pending")) {
              throw new Error("현재 상태에서는 승인할 수 없습니다.");
            }
          } else if (!["pending", "late"].includes(completion.status || "none")) {
            throw new Error("현재 상태에서는 승인할 수 없습니다.");
          }

          // 지각 및 보상 판정
          const submittedAt = getSubmittedAtForMission(mission, studentUid, subData);
          const isLate = submittedAt ? computeLate(mission, submittedAt) : !!completion.late;
          const allowReward = decideRewardAllowed(mission, isLate);
          const reward = snapshotReward(mission, allowReward, item.rewardOverride);
          const hasReward = hasPositiveReward(reward);

          // (1) 제출물(Submission) 상태 업데이트
          if (item.submissionId && subData) {
            tx.update(
              db.doc(
                `classes/${classId}/missions/${missionId}/submissions/${item.submissionId}`,
              ),
              {
                status: isLate ? "late-approved" : "approved",
                approvedAt: serverTime,
                approvedByUid: uid,
                feedback,
              },
            );
            missionPatch[`submissionsIndex.${studentUid}`] = item.submissionId;
          }

          // (2) Mission completions 업데이트 (Patch 객체에 추가)
          missionPatch[`completions.${studentUid}.status`] = isLate
            ? "late-approved"
            : "approved";
          missionPatch[`completions.${studentUid}.approvedAt`] = serverTime;
          missionPatch[`completions.${studentUid}.approverUid`] = uid;
          missionPatch[`completions.${studentUid}.late`] = isLate;
          missionPatch[`completions.${studentUid}.feedback`] = feedback;
          missionPatch[`completions.${studentUid}.rewardGranted`] = hasReward;
          missionPatch[`completions.${studentUid}.rewardSnapshot`] = hasReward
            ? reward
            : null;

          // (3) 보상 지급 및 로그 기록
          if (hasReward) {
            const studentRef = db.doc(
              `classes/${classId}/students/${studentUid}`,
            );
            const updates = {};
            const currencyIncomeTax = buildMissionRewardIncomeTax(
              classData,
              reward.currency,
            );
            const netCurrencyReward = currencyIncomeTax.netAmount;
            const rewardPayoutSnapshot = buildRewardPayoutSnapshot(
              reward,
              currencyIncomeTax,
            );
            missionPatch[`completions.${studentUid}.rewardPayoutSnapshot`] =
              rewardPayoutSnapshot;
            if (reward.currency > 0)
              updates["assets.cash"] = FieldValue.increment(netCurrencyReward);
            if (reward.credit > 0)
              updates["creditScore"] = FieldValue.increment(reward.credit);
            if (reward.missionToken > 0)
              updates["assets.missionToken"] = FieldValue.increment(
                reward.missionToken,
              );

            tx.update(studentRef, updates);

            if (reward.currency > 0) {
              const taxActivityLogId = stageActivityLog(
                tx,
                classId,
                {
                  studentUid,
                  type: "income",
                  category: "mission",
                  amount: netCurrencyReward,
                  description: `'${mission.title}' 일괄 승인 보상`,
                  relatedDoc: { collection: "missions", id: missionId },
                  currency: currencyUnit,
                  grossAmount: currencyIncomeTax.grossAmount,
                  withheldAmount: currencyIncomeTax.withheldAmount,
                  netAmount: currencyIncomeTax.netAmount,
                  incomeTax: currencyIncomeTax.incomeTax,
                },
                logContext,
              );
              const withholdingTaxRecord = stageMissionRewardWithholdingTax({
                tx,
                classId,
                studentUid,
                studentName: studentData.name || null,
                missionId,
                missionTitle: mission.title,
                actorUid: uid,
                logContext,
                classData,
                incomeTaxSnapshot: currencyIncomeTax,
              });
              if (currencyIncomeTax.withheldAmount > 0 && taxActivityLogId) {
                const taxActivityLogRef = db.doc(
                  `classes/${classId}/students/${studentUid}/activityLogs/${taxActivityLogId}`,
                );
                stageTaxPostingLink(tx, taxActivityLogRef, withholdingTaxRecord);
                rewardPayoutSnapshot.taxActivityLogId = taxActivityLogId;
              }
            }
            if (reward.credit > 0) {
              stageCreditLog(
                tx,
                classId,
                {
                  studentUid,
                  delta: reward.credit,
                  reason: `'${mission.title}' 일괄 승인 보상`,
                  relatedDoc: { collection: "missions", id: missionId },
                  source: "mission",
                  issuedByUid: uid,
                },
                logContext,
              );
            }
            if (reward.missionToken > 0) {
              stageActivityLog(
                tx,
                classId,
                {
                  studentUid,
                  type: "income",
                  category: "mission",
                  amount: reward.missionToken,
                  description: `'${mission.title}' 승인 보상 미션토큰 지급`,
                  relatedDoc: { collection: "missions", id: missionId },
                  currency: "mission_token",
                  assetType: "missionToken",
                  missionTokenDelta: reward.missionToken,
                  source: "mission",
                },
                logContext,
              );
            }
          }
          results.success.push(studentUid);
        } catch (e) {
          results.failed.push({
            uid: item.uid || item.studentUid,
            error: e.message,
          });
        }
      }

      // 5. [마지막 일괄 업데이트] Mission 문서를 단 한 번만 업데이트합니다.
      if (Object.keys(missionPatch).length > 0) {
        stageMissionStatePatch(tx, missionRef, mission, missionPatch, FieldValue, db);
      }
    });

    return {
      success: true,
      message: `${results.success.length}명 승인 완료`,
      results,
    };
  },
);
/**
 * [일괄 승인 취소] cancelMissionApprovalBatch
 * 1. tx.getAll()을 통해 미션, 학급 정보를 먼저 읽고 필요한 제출물/학생 Ref를 추출하여 일괄 조회합니다.
 * 2. missionPatch 객체를 사용하여 동일한 Mission 문서에 대한 반복적인 update를 1회로 통합합니다.
 * 3. 최적화된 hasPermission 유틸리티를 적용하였습니다.
 */
exports.cancelMissionApprovalBatch = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60 },
  async (request) => {
    const uid = request.auth?.uid;
    const role = request.auth?.token?.role;
    const { classId, missionId, studentUids } = request.data || {};

    // 0. 기본 검증
    if (!uid || !classId || !missionId || !Array.isArray(studentUids)) {
      throw new HttpsError("invalid-argument", "필수 정보가 누락되었습니다.");
    }
    if (studentUids.length === 0)
      return { success: true, message: "취소할 대상이 없습니다." };
    if (studentUids.length > 50) {
      throw new HttpsError(
        "invalid-argument",
        "한 번에 최대 50명까지 처리 가능합니다.",
      );
    }

    // 1. 권한 확인 (최적화된 유틸리티 사용)
    assertMissionRequestClass(request, classId);
    const isTeacher = role === "teacher" || role === "admin";
    if (!isTeacher && !(await hasPermission(uid, classId, "mission_admin"))) {
      throw new HttpsError("permission-denied", "승인 취소 권한이 없습니다.");
    }

    const globalConfig = await getGlobalConfig();
    const missionRef = db.doc(`classes/${classId}/missions/${missionId}`);
    const classRef = db.doc(`classes/${classId}`);

    const results = { success: [], failed: [] };

    await db.runTransaction(async (tx) => {
      // 2. [1차 일괄 읽기] 미션과 학급 정보를 먼저 읽습니다.
      results.success.length = 0;
      results.failed.length = 0;
      const [missionDoc, classSnap] = await tx.getAll(missionRef, classRef);

      if (!missionDoc.exists) {
        throw new HttpsError("not-found", "미션을 찾을 수 없습니다.");
      }

      const mission = await readMissionStudentStates(db, missionRef, missionDoc.data(), { tx, studentUids: studentUids });
      const classData = classSnap.exists ? classSnap.data() : {};
      const planType = classData.planType || "FREE";
      const currencyUnit = classData.currencyUnit || "단위";
      const submissionsIndex = mission.submissionsIndex || {};
      const logContext = {
        config: globalConfig,
        planType,
        serviceName: "mission",
      };

      // 3. [2차 일괄 읽기 준비] 취소 대상 학생들의 제출물 및 학생 문서를 한꺼번에 읽기 위해 Ref를 모읍니다.
      const subRefs = [];
      const studentRefs = [];
      const taxActivityLogRefs = [];
      const taxActivityLogRefByUid = new Map();
      const validUids = [];

      for (const sUid of new Set(studentUids)) {
        const completion = mission.completions?.[sUid];
        // 승인된 상태인 학생만 선별
        if (
          completion &&
          (completion.status === "approved" ||
            completion.status === "late-approved")
        ) {
          validUids.push(sUid);
          studentRefs.push(db.doc(`classes/${classId}/students/${sUid}`));
          const taxActivityLogId =
            completion?.rewardPayoutSnapshot?.taxActivityLogId;
          if (taxActivityLogId) {
            const taxActivityLogRef = db.doc(
              `classes/${classId}/students/${sUid}/activityLogs/${taxActivityLogId}`,
            );
            taxActivityLogRefs.push(taxActivityLogRef);
            taxActivityLogRefByUid.set(sUid, taxActivityLogRef);
          }
          if (submissionsIndex[sUid]) {
            subRefs.push(
              db.doc(
                `classes/${classId}/missions/${missionId}/submissions/${submissionsIndex[sUid]}`,
              ),
            );
          }
        } else {
          results.failed.push({ uid: sUid, error: "승인 상태가 아닙니다." });
        }
      }

      // 읽을 대상이 없으면 종료
      if (validUids.length === 0) return;

      // 제출물과 학생 데이터를 한 번에 가져옵니다. (네트워크 통신 최적화)
      const snaps = await tx.getAll(
        ...subRefs,
        ...studentRefs,
        ...taxActivityLogRefs,
      );
      const taxActivityLogSnapByPath = new Map(
        snaps
          .filter((snap) => taxActivityLogRefs.some((ref) => ref.path === snap.ref.path))
          .map((snap) => [snap.ref.path, snap]),
      );

      const serverTime = FieldValue.serverTimestamp();
      const missionUpdate = {}; // Mission 문서 업데이트 바구니

      // 4. [루프] 메모리에 로드된 데이터를 바탕으로 처리
      for (const sUid of validUids) {
        try {
          const completion = mission.completions[sUid];
          const wasLate = !!completion.late;

          // (1) 미션 문서 내 completions 롤백 데이터 바구니에 담기
          missionUpdate[`completions.${sUid}.status`] = wasLate
            ? "late"
            : "pending";
          missionUpdate[`completions.${sUid}.approvedAt`] = null;
          missionUpdate[`completions.${sUid}.approverUid`] = null;
          missionUpdate[`completions.${sUid}.rewardGranted`] =
            FieldValue.delete();
          missionUpdate[`completions.${sUid}.rewardSnapshot`] =
            FieldValue.delete();
          missionUpdate[`completions.${sUid}.rewardPayoutSnapshot`] =
            FieldValue.delete();

          // (2) 제출물 문서(Submissions) 롤백
          const subId = submissionsIndex[sUid];
          if (subId) {
            const subRef = db.doc(
              `classes/${classId}/missions/${missionId}/submissions/${subId}`,
            );
            tx.update(subRef, {
              status: wasLate ? "late" : "pending",
              approvedAt: null,
              approvedBy: null,
              approvedByUid: null,
              approvedByName: null,
            });
          }

          // (3) 💰 보상 회수 (지각이 아니었고 보상이 지급되었던 경우)
          if (!wasLate && completion?.rewardGranted) {
            const reward =
              completion?.rewardPayoutSnapshot &&
                hasPositiveReward(completion.rewardPayoutSnapshot)
                ? completion.rewardPayoutSnapshot
                : (
              completion?.rewardSnapshot &&
                hasPositiveReward(completion.rewardSnapshot)
                ? completion.rewardSnapshot
                : snapshotReward(mission, true)
            );
            const { currency, credit, missionToken } = reward;
            const studentRef = db.doc(`classes/${classId}/students/${sUid}`);
            const studentUpdate = {};

            if (currency > 0)
              studentUpdate["assets.cash"] = FieldValue.increment(-currency);
            if (credit > 0)
              studentUpdate["creditScore"] = FieldValue.increment(-credit);
            if (missionToken > 0)
              studentUpdate["assets.missionToken"] = FieldValue.increment(
                -missionToken,
              );

            if (Object.keys(studentUpdate).length > 0) {
              tx.update(studentRef, studentUpdate);
            }

            // 📝 활동 로그 (회수 - expense)
            if (currency > 0) {
              stageActivityLog(
                tx,
                classId,
                {
                  studentUid: sUid,
                  type: "expense",
                  category: "mission_penalty",
                  amount: currency,
                  description: `'${mission.title || "미션"}' 일괄 승인 취소 (회수)`,
                  currency: currencyUnit,
                },
                logContext,
              );
            }

            // 📝 신용 로그 (회수 - 음수 delta)
            if (credit > 0) {
              stageCreditLog(
                tx,
                classId,
                {
                  studentUid: sUid,
                  delta: -credit,
                  reason: `'${mission.title || "미션"}' 일괄 승인 취소 (회수)`,
                  source: "mission",
                  issuedByUid: uid,
                },
                logContext,
              );
            }
            if (missionToken > 0) {
              stageActivityLog(
                tx,
                classId,
                {
                  studentUid: sUid,
                  type: "expense",
                  category: "mission_penalty",
                  amount: missionToken,
                  description: `'${mission.title || "미션"}' 승인 취소 (미션토큰 회수)`,
                  relatedDoc: { collection: "missions", id: missionId },
                  currency: "mission_token",
                  assetType: "missionToken",
                  missionTokenDelta: -missionToken,
                  source: "mission",
                },
                logContext,
              );
            }

            const taxActivityLogRef = taxActivityLogRefByUid.get(sUid);
            const taxActivityLogSnap = taxActivityLogRef
              ? taxActivityLogSnapByPath.get(taxActivityLogRef.path)
              : null;
            if (taxActivityLogSnap?.exists) {
              stageActivityTaxCancellation({
                tx,
                classId,
                activityLogRef: taxActivityLogRef,
                activityLogData: taxActivityLogSnap.data(),
                actorUid: uid,
                reason: "mission_approval_cancelled",
                context: { ...logContext, pageKey: "missions" },
              });
            }
          }

          results.success.push({
            uid: sUid,
            status: wasLate ? "late" : "pending",
          });
        } catch (e) {
          console.error(`학생 ${sUid} 취소 처리 중 오류:`, e);
          results.failed.push({ uid: sUid, error: "처리 중 내부 오류" });
        }
      }

      // 5. [일괄 업데이트] Mission 문서 "막타" 한 번만!
      if (Object.keys(missionUpdate).length > 0) {
        stageMissionStatePatch(tx, missionRef, mission, missionUpdate, FieldValue, db);
      }
    });

    return {
      success: true,
      message: `${results.success.length}명 취소 완료, ${results.failed.length}명 실패`,
      results,
    };
  },
);

/**
 * [자동 승인] processAutoApproveMission
 * 1. 트랜잭션 외부의 별도 배치를 없애고 모든 처리를 하나의 트랜잭션으로 통합했습니다.
 * 2. 미션, 학생, 학급, 기존 제출물(있는 경우)을 getAll로 한 번에 읽습니다.
 * 3. 최적화된 유틸리티(getGlobalConfig 등)를 적용했습니다.
 */
exports.processAutoApproveMission = onCall(
  { region: "asia-northeast3", timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { classId, missionId } = request.data || {};
    const studentUid = request.auth.uid;

    if (!classId || !missionId) {
      throw new HttpsError("invalid-argument", "필수 정보가 누락되었습니다.");
    }

    // 🔒 1. 전역 정책 설정 가져오기 (캐시 처리됨)
    assertMissionRequestClass(request, classId);
    const globalConfig = await getGlobalConfig();

    const missionRef = db.doc(`classes/${classId}/missions/${missionId}`);
    const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
    const classRef = db.doc(`classes/${classId}`);
    const subsCol = db.collection(
      `classes/${classId}/missions/${missionId}/submissions`,
    );

    // 🌟 [최적화] 트랜잭션 시작 전, 대기 중인 제출물(Submission)이 있는지 미리 확인합니다.
    // 이렇게 하면 트랜잭션 내부에서 제출물 문서까지 getAll로 한 번에 처리 가능합니다.
    const pendingSnap = await subsCol
      .where("studentUid", "==", studentUid)
      .where("status", "in", ["pending", "late"])
      .limit(1)
      .get();

    const subDocRef = !pendingSnap.empty ? pendingSnap.docs[0].ref : null;

    await db.runTransaction(async (tx) => {
      // 🔒 2. 모든 정보를 동시에 읽기 (getAll)
      const refs = [missionRef, studentRef, classRef];
      if (subDocRef) refs.push(subDocRef);

      const snaps = await tx.getAll(...refs);
      const [missionDoc, studentDoc, classSnap, subSnap] = snaps;

      if (!missionDoc.exists)
        throw new HttpsError("not-found", "존재하지 않는 미션입니다.");
      if (!studentDoc.exists)
        throw new HttpsError("not-found", "학생 정보를 찾을 수 없습니다.");

      const mission = await readMissionStudentStates(db, missionRef, missionDoc.data(), { tx, studentUids: [studentUid] });
      const studentData = studentDoc.data() || {};
      const classData = classSnap.exists ? classSnap.data() : {};
      const planType = classData.planType || "FREE";
      const currencyUnit = classData.currencyUnit || "단위";
      const logContext = {
        config: globalConfig,
        planType,
        serviceName: "mission",
      };

      // 자동 승인 가능 여부 검증
      if (!mission.autoApprove) {
        throw new HttpsError(
          "permission-denied",
          "이 과제는 자동 승인 대상이 아닙니다.",
        );
      }

      if (missionHasRewardRange(mission)) {
        throw new HttpsError(
          "failed-precondition",
          "범위 보상 미션은 자동 승인할 수 없습니다.",
        );
      }

      // 중복 제출/승인 체크 (멱등성)
      const existing = mission.completions?.[studentUid];
      if (
        existing &&
        (existing.status === "pending" ||
          existing.status === "approved" ||
          existing.status === "late-approved")
      ) {
        throw new HttpsError("already-exists", "이미 제출/완료된 미션입니다.");
      }

      try {
        assertMissionEligibility(mission, studentUid, studentData);
      } catch (error) {
        throw new HttpsError(
          "permission-denied",
          error?.message || "이 미션을 수행할 수 없습니다.",
        );
      }

      // 지각 판정
      const subData = subSnap?.exists ? subSnap.data() : null;
      const submittedAt =
        getSubmittedAtForMission(mission, studentUid, subData) || new Date();
      const isLate = computeLate(mission, submittedAt);

      if (isLate && !isLateSubmissionAllowed(mission)) {
        throw new HttpsError(
          "failed-precondition",
          "마감 후 제출이 허용되지 않은 미션입니다.",
        );
      }

      // 보상 계산 (기존 헬퍼 snapshotReward 활용)
      const allowReward = decideRewardAllowed(mission, isLate);
      const reward = snapshotReward(mission, allowReward);
      const hasReward = hasPositiveReward(reward);
      const currencyIncomeTax = buildMissionRewardIncomeTax(
        classData,
        reward.currency,
      );
      const serverTime = FieldValue.serverTimestamp();
      const rewardPayoutSnapshot = hasReward
        ? buildRewardPayoutSnapshot(reward, currencyIncomeTax)
        : null;

      const missionUpdate = {}; // 업데이트 바구니

      // --- 1) 제출물 문서 동기화 (있는 경우) ---
      if (subDocRef && subSnap && subSnap.exists) {
        tx.update(subDocRef, {
          status: isLate ? "late-approved" : "approved",
          approvedAt: serverTime,
          approvedBy: "system_auto",
          late: subData.late !== undefined ? subData.late : isLate,
        });
        missionUpdate[`submissionsIndex.${studentUid}`] = subSnap.id;
      }

      // --- 2) 미션 문서 completions 업데이트 ---
      missionUpdate[`completions.${studentUid}`] = {
        status: isLate ? "late-approved" : "approved",
        approvedAt: serverTime,
        approverUid: "system_auto",
        late: isLate,
        rewardGranted: hasReward,
        rewardSnapshot: hasReward ? reward : null,
        rewardPayoutSnapshot,
        submittedAt: subData?.submittedAt || serverTime,
      };

      // --- 3) 보상 지급 및 로그 기록 ---
      if (hasReward) {
        const studentUpdate = {};
        const netCurrencyReward = currencyIncomeTax.netAmount;
        if (reward.currency > 0)
          studentUpdate["assets.cash"] = FieldValue.increment(netCurrencyReward);
        if (reward.credit > 0)
          studentUpdate["creditScore"] = FieldValue.increment(reward.credit);
        if (reward.missionToken > 0)
          studentUpdate["assets.missionToken"] = FieldValue.increment(
            reward.missionToken,
          );

        tx.update(studentRef, studentUpdate);

        if (reward.currency > 0) {
          const taxActivityLogId = stageActivityLog(
            tx,
            classId,
            {
              studentUid,
              type: "income",
              category: "mission",
              amount: netCurrencyReward,
              description: `'${mission.title}' 자동 승인 보상`,
              relatedDoc: { collection: "missions", id: missionId },
              currency: currencyUnit,
              grossAmount: currencyIncomeTax.grossAmount,
              withheldAmount: currencyIncomeTax.withheldAmount,
              netAmount: currencyIncomeTax.netAmount,
              incomeTax: currencyIncomeTax.incomeTax,
            },
            logContext,
          );
          const withholdingTaxRecord = stageMissionRewardWithholdingTax({
            tx,
            classId,
            studentUid,
            studentName: studentData.name || null,
            missionId,
            missionTitle: mission.title,
            actorUid: "system_auto",
            logContext,
            classData,
            incomeTaxSnapshot: currencyIncomeTax,
          });
          if (currencyIncomeTax.withheldAmount > 0 && taxActivityLogId) {
            const taxActivityLogRef = db.doc(
              `classes/${classId}/students/${studentUid}/activityLogs/${taxActivityLogId}`,
            );
            stageTaxPostingLink(tx, taxActivityLogRef, withholdingTaxRecord);
            rewardPayoutSnapshot.taxActivityLogId = taxActivityLogId;
          }
        }
        if (reward.credit > 0) {
          stageCreditLog(
            tx,
            classId,
            {
              studentUid,
              delta: reward.credit,
              reason: `'${mission.title}' 자동 승인 보상`,
              relatedDoc: { collection: "missions", id: missionId },
              source: "mission",
              issuedByUid: "system_auto",
            },
            logContext,
          );
        }
      }

      stageMissionStatePatch(tx, missionRef, mission, missionUpdate, FieldValue, db);
    });

    return { success: true, message: "자동 승인 완료되었습니다." };
  },
);

/**
 * [제출 생성/수정] submitMission
 * 1. tx.getAll()을 사용하여 미션과 학급 정보를 동시에 읽습니다.
 * 2. 미션 문서에 대한 여러 번의 tx.set을 하나의 missionPatch 객체로 통합하여 1회 업데이트합니다.
 * 3. 최적화된 getGlobalConfig(캐시 적용)를 사용하여 불필요한 Read를 방지합니다.
 */
exports.submitMission = onCall(
  { region: "asia-northeast3", timeoutSeconds: 30 },
  async (request) => {
    try {
      const auth = request.auth;
      if (!auth)
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

      const {
        classId,
        missionId,
        contentHtml = "",
        studentName = "",
        studentNumber = null,
      } = request.data || {};
      const studentUid = auth.uid;

      if (!classId || !missionId) {
        throw new HttpsError(
          "invalid-argument",
          "classId와 missionId가 필요합니다.",
        );
      }

      // 🔒 1. 전역 정책 설정 가져오기 (최적화된 캐시 버전)
      assertMissionRequestClass(request, classId);
    const globalConfig = await getGlobalConfig();

      const missionRef = db.doc(`classes/${classId}/missions/${missionId}`);
      const classRef = db.doc(`classes/${classId}`);
      const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
      const subsCol = db.collection(
        `classes/${classId}/missions/${missionId}/submissions`,
      );

      await db.runTransaction(async (tx) => {
        // 🔒 2. [최적화] 학급 및 미션 정보 일괄 읽기
        const [missionDoc, classSnap, studentSnap] = await tx.getAll(
          missionRef,
          classRef,
          studentRef,
        );

        if (!missionDoc.exists)
          throw new HttpsError("not-found", "미션을 찾을 수 없습니다.");

        const mission = await readMissionStudentStates(db, missionRef, missionDoc.data(), { tx, studentUids: [studentUid] });
        const planType = classSnap.data()?.planType || "FREE";
        const studentData = studentSnap.exists ? studentSnap.data() : null;

        if (!studentData) {
          throw new HttpsError("not-found", "학생 정보를 찾을 수 없습니다.");
        }

        // 서비스 접근 권한 체크
        if (!canUseFeature(globalConfig, planType, "mission", "accessible")) {
          throw new HttpsError(
            "permission-denied",
            "현재 플랜에서는 미션 기능을 사용할 수 없습니다.",
          );
        }

        if (["approved", "late-approved"].includes(mission.completions?.[studentUid]?.status)) {
          throw new HttpsError("already-exists", "이미 승인된 과제입니다.");
        }

        // 제출 가능 여부 검증 (기존 헬퍼 활용)
        const usesSubmission = canMissionUseSubmission(mission);

        try {
          assertMissionEligibility(mission, studentUid, studentData);
        } catch (error) {
          throw new HttpsError(
            "permission-denied",
            error?.message || "이 미션을 수행할 수 없습니다.",
          );
        }

        const now = new Date();
        const deadline = toDateSafe(mission?.timeWindow?.end);
        const isLate = !!deadline && now > deadline;

        if (isLate && !isLateSubmissionAllowed(mission)) {
          throw new HttpsError(
            "failed-precondition",
            "마감 후 제출이 허용되지 않은 미션입니다.",
          );
        }

        const nextStatus = isLate ? "late" : "pending";
        const serverTimestamp = FieldValue.serverTimestamp();

        // 🔍 [최적화] 기존 제출물 조회 (트랜잭션 내 쿼리)
        const missionPatch = {};

        if (usesSubmission) {
          const q = await tx.get(
            subsCol.where("studentUid", "==", studentUid).limit(1),
          );

          let subId;
          if (!q.empty) {
            const docSnap = q.docs[0];
            subId = docSnap.id;
            tx.update(docSnap.ref, {
              contentHtml,
              studentName: studentName || docSnap.data().studentName || "학생",
              studentNumber:
                typeof studentNumber === "number"
                  ? studentNumber
                  : (docSnap.data().studentNumber ?? null),
              status: nextStatus,
              late: isLate,
              missionTitle: mission.title || "",
              updatedAt: serverTimestamp,
            });
          } else {
            const newSubRef = subsCol.doc();
            subId = newSubRef.id;
            tx.set(newSubRef, {
              classId,
              missionId,
              studentUid,
              studentName: studentName || "학생",
              studentNumber:
                typeof studentNumber === "number" ? studentNumber : null,
              contentHtml,
              status: nextStatus,
              late: isLate,
              missionTitle: mission.title || "",
              submittedAt: serverTimestamp,
              updatedAt: serverTimestamp,
            });
          }

          missionPatch[`submissionsIndex.${studentUid}`] = subId;
          missionPatch[`completions.${studentUid}.submissionId`] = subId;
        } else {
          missionPatch[`submissionsIndex.${studentUid}`] = FieldValue.delete();
          missionPatch[`completions.${studentUid}.submissionId`] =
            FieldValue.delete();
          missionPatch[`completions.${studentUid}.name`] = studentName || "학생";
          missionPatch[`completions.${studentUid}.studentNumber`] =
            typeof studentNumber === "number" ? studentNumber : null;
          missionPatch[`completions.${studentUid}.approvedAt`] = null;
          missionPatch[`completions.${studentUid}.approverUid`] = null;
        }

        missionPatch.updatedAt = serverTimestamp;
        missionPatch[`completions.${studentUid}.status`] = nextStatus;
        missionPatch[`completions.${studentUid}.submittedAt`] =
          serverTimestamp;
        missionPatch[`completions.${studentUid}.late`] = isLate;
        missionPatch[`completions.${studentUid}.updatedAt`] =
          serverTimestamp;

        // 🌟 단 한 번의 tx.update로 미션 문서 수정 완료
        stageMissionStatePatch(tx, missionRef, mission, missionPatch, FieldValue, db);

        // 📝 활동 로그 기록 (amount: 0 필수 포함)
        stageActivityLog(
          tx,
          classId,
          {
            studentUid,
            type: "system",
            category: "mission_submit",
            amount: 0,
            description: `'${mission.title}' 미션 제출 완료`,
            relatedDoc: { collection: "missions", id: missionId },
          },
          { config: globalConfig, planType, serviceName: "mission" },
        );
      });

      return { success: true, message: "제출이 저장되었습니다." };
    } catch (error) {
      console.error(`[submitMission Error] User: ${request.auth?.uid}`, error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "제출 처리 중 오류가 발생했습니다.");
    }
  },
);
/**
 * [반복 미션 생성] createRepeatingMissions
 * 1. 교사 활동 로그 기록 제거 (비용 절감)
 * 2. 최적화된 getGlobalConfig(캐시 적용)를 사용하여 설정 로드 비용 절감
 * 3. Firestore Batch(500개 제한)를 활용한 안정적인 대량 생성
 */
exports.createRepeatingMissions = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth)
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { classId, missionTemplate, repeatConfig } = request.data || {};
    if (!classId || !missionTemplate || !repeatConfig) {
      throw new HttpsError(
        "invalid-argument",
        "필수 파라미터가 누락되었습니다.",
      );
    }

    // 🔒 1. 최적화된 설정 및 학급 정보 로드
    assertMissionRequestClass(request, classId);
    const globalConfig = await getGlobalConfig();
    const classSnap = await db.doc(`classes/${classId}`).get();
    if (!["teacher", "admin"].includes(request.auth.token?.role) && !await hasPermission(request.auth.uid, classId, "mission_admin")) {
      throw new HttpsError("permission-denied", "미션 관리 권한이 필요합니다.");
    }

    if (!classSnap.exists)
      throw new HttpsError("not-found", "학급 정보를 찾을 수 없습니다.");
    const planType = classSnap.data()?.planType || "FREE";

    // 서비스 접근 권한 체크 (유틸리티 활용)
    if (!canUseFeature(globalConfig, planType, "mission", "accessible")) {
      throw new HttpsError(
        "permission-denied",
        "현재 플랜에서는 미션 기능을 사용할 수 없습니다.",
      );
    }

    try {
      // 2. 생성할 날짜 계산 (기존 헬퍼 활용)
      const targetDates = calculateTargetDates(repeatConfig);
      if (targetDates.length === 0)
        throw new HttpsError("invalid-argument", "생성할 날짜가 없습니다.");
      if (targetDates.length > 365)
        throw new HttpsError(
          "invalid-argument",
          "최대 1년치까지만 생성 가능합니다.",
        );

      const batchSize = 500;
      let totalCreated = 0;
      const serverTimestamp = FieldValue.serverTimestamp();

      // 3. [최적화] Firestore Batch를 사용하여 500개 단위로 안전하게 생성
      for (let i = 0; i < targetDates.length; i += batchSize) {
        const batch = db.batch();
        const chunk = targetDates.slice(i, i + batchSize);

        chunk.forEach((date) => {
          const missionRef = db.collection(`classes/${classId}/missions`).doc();
          const timeWindow = {};

          // 시간 계산 (combineDateAndTime 헬퍼 활용)
          const templateStartTime = missionTemplate.timeWindow?.start;
          timeWindow.start = combineDateAndTime(
            date,
            templateStartTime || new Date().setHours(9, 0, 0, 0),
          );

          const templateEndTime = missionTemplate.timeWindow?.end;
          if (templateEndTime) {
            let endDate = combineDateAndTime(date, templateEndTime);
            if (endDate <= timeWindow.start) {
              endDate = new Date(endDate);
              endDate.setDate(endDate.getDate() + 1);
            }
            timeWindow.end = endDate;
          }

          // 최종 데이터 구성
          const missionData = {
            ...missionTemplate,
            classId,
            stateStorageVersion: classSnap.data()?.missionStudentStateVersion === 2 ? 2 : 1,
            type: "single",
            createdAt: serverTimestamp,
            updatedAt: serverTimestamp,
            isRepeating: true,
            autoGenerated: true,
            timeWindow,
            repeatInfo: {
              startDate: repeatConfig.startDate,
              endDate: repeatConfig.endDate || null,
              days: repeatConfig.days,
            },
          };

          delete missionData.completions;
          delete missionData.submissionsIndex;
          delete missionData.studentStateMirrorVersion;
          delete missionData.studentStatePreparedAt;
          delete missionData.stateStorageMigratedAt;
          batch.set(missionRef, missionData);
        });

        // 500개 단위 묶음 실행
        await batch.commit();
        totalCreated += chunk.length;
      }

      // ✨ 교사 활동 로그(logBatch) 부분 삭제 완료

      return {
        success: true,
        created: totalCreated,
        message: `${totalCreated}개의 반복 미션이 성공적으로 생성되었습니다.`,
      };
    } catch (error) {
      console.error("[createRepeatingMissions Error]", error);
      throw new HttpsError("internal", `미션 생성 실패: ${error.message}`);
    }
  },
);

/**
 * [반복 미션 일괄 삭제] deleteRepeatingMissions
 * 1. 보안 강화: 교사 또는 미션 관리자 권한이 있는지 확인합니다.
 * 2. 플랜 체크: 현재 플랜에서 미션 기능을 사용할 수 있는지 확인합니다.
 * 3. 효율적 삭제: 500개 단위 배치를 사용하여 대량의 문서를 안전하게 제거합니다.
 */
exports.deleteRepeatingMissions = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60 },
  async (request) => {
    // 1. 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const uid = request.auth.uid;
    const role = request.auth.token?.role;
    const { classId, repeatInfo } = request.data || {};

    if (!classId || !repeatInfo) {
      throw new HttpsError(
        "invalid-argument",
        "classId와 repeatInfo가 필요합니다.",
      );
    }

    // 2. [추가] 권한 확인 (최적화된 유틸리티 사용)
    const isTeacher = role === "teacher" || role === "admin";
    if (!isTeacher && !(await hasPermission(uid, classId, "mission_admin"))) {
      throw new HttpsError("permission-denied", "미션 삭제 권한이 없습니다.");
    }

    // 3. [추가] 설정 및 플랜 체크
    const globalConfig = await getGlobalConfig();
    const classSnap = await db.doc(`classes/${classId}`).get();
    const planType = classSnap.data()?.planType || "FREE";

    if (!canUseFeature(globalConfig, planType, "mission", "accessible")) {
      throw new HttpsError(
        "permission-denied",
        "현재 플랜에서는 미션 기능을 사용할 수 없습니다.",
      );
    }

    try {
      // 4. 삭제 대상 조회
      const snapshot = await db
        .collection("classes")
        .doc(classId)
        .collection("missions")
        .where("isRepeating", "==", true)
        .where("repeatInfo.startDate", "==", repeatInfo.startDate)
        .get();

      if (snapshot.empty) {
        return {
          success: true,
          deleted: 0,
          message: "삭제할 미션이 없습니다.",
        };
      }

      const batchSize = 500;
      let totalDeleted = 0;
      const docs = snapshot.docs;

      // 5. 500개 단위로 일괄 삭제 진행
      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = db.batch();
        const chunk = docs.slice(i, i + batchSize);

        chunk.forEach((doc) => {
          batch.delete(doc.ref);
        });

        await batch.commit();
        totalDeleted += chunk.length;
      }

      // ✨ 교사 활동 로그 기록 생략 (요청 사항 반영)
      console.log(
        `[Delete] ${totalDeleted} missions removed for class: ${classId}`,
      );

      return {
        success: true,
        deleted: totalDeleted,
        message: `${totalDeleted}개의 반복 미션이 삭제되었습니다.`,
      };
    } catch (error) {
      console.error("반복 미션 삭제 중 오류:", error);
      throw new HttpsError("internal", `미션 삭제 실패: ${error.message}`);
    }
  },
);

// ================================
// 헬퍼 함수들
// ================================
function calculateTargetDates(repeatConfig) {
  const { startDate, endDate, days } = repeatConfig;

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = endDate ? new Date(endDate) : new Date(start);
  if (!endDate) {
    end.setFullYear(start.getFullYear() + 1);
  }
  end.setHours(23, 59, 59, 999);

  const targetDates = [];
  const current = new Date(start);

  while (current <= end) {
    const currentDay = current.getDay(); // 0=일, 1=월, ..., 6=토

    if (days.includes(currentDay)) {
      targetDates.push(new Date(current));
    }

    current.setDate(current.getDate() + 1);
  }

  return targetDates;
}

const KST = "Asia/Seoul";

function toDayjsKST(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return dayjs(v.toDate()).tz(KST);
  if (v instanceof Date) return dayjs(v).tz(KST);
  return dayjs(v).tz(KST);
}

function combineDateAndTime(date, timeSource) {
  const d = toDayjsKST(date);
  const t = toDayjsKST(timeSource);
  if (!d || !t || !d.isValid() || !t.isValid()) return new Date(date);

  return d
    .hour(t.hour())
    .minute(t.minute())
    .second(t.second())
    .millisecond(t.millisecond())
    .toDate();
}

/**
 * [단일 반려] rejectSubmission
 * 1. tx.getAll()을 사용하여 제출물, 미션, 학급 정보를 한 번의 호출로 모두 읽어옵니다.
 * 2. Mission 문서 업데이트를 하나의 객체로 모아 1회만 실행하여 효율성을 높였습니다.
 * 3. 최적화된 hasPermission 유틸리티를 반영하였습니다.
 */
exports.rejectSubmission = onCall(
  { region: "asia-northeast3", timeoutSeconds: 30 },
  async (request) => {
    const callerUid = request.auth?.uid;
    const callerRole = request.auth?.token?.role;
    const {
      classId,
      missionId,
      submissionId,
      revertTo = "rejected",
      reason = "",
    } = request.data || {};

    // 1. 기본 인증 및 파라미터 체크
    if (!callerUid)
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    if (!classId || !missionId || !submissionId) {
      throw new HttpsError("invalid-argument", "필수 정보가 누락되었습니다.");
    }

    // 2. 권한 확인 (최적화된 유틸리티 사용)
    const isTeacher = callerRole === "teacher" || callerRole === "admin";
    if (
      !isTeacher &&
      !(await hasPermission(callerUid, classId, "mission_admin"))
    ) {
      throw new HttpsError("permission-denied", "반려 권한이 없습니다.");
    }

    // 3. 전역 정책 설정 가져오기 (캐시 처리됨)
    assertMissionRequestClass(request, classId);
    const globalConfig = await getGlobalConfig();

    const missionRef = db.doc(`classes/${classId}/missions/${missionId}`);
    const submissionRef = db.doc(
      `classes/${classId}/missions/${missionId}/submissions/${submissionId}`,
    );
    const classRef = db.doc(`classes/${classId}`);

    await db.runTransaction(async (tx) => {
      // 🌟 [최적화] 모든 필수 문서를 한 번에 읽기 (getAll)
      const [subSnap, missionSnap, classSnap] = await tx.getAll(
        submissionRef,
        missionRef,
        classRef,
      );

      if (!subSnap.exists)
        throw new HttpsError("not-found", "제출문서를 찾을 수 없습니다.");

      const subData = subSnap.data();
      const studentUid = subData.studentUid;
      if (!studentUid)
        throw new HttpsError("failed-precondition", "학생 UID가 없습니다.");

      const planType = classSnap.data()?.planType || "FREE";
      const logContext = {
        config: globalConfig,
        planType,
        serviceName: "mission",
      };
      const serverTime = FieldValue.serverTimestamp();

      // 1) 제출물 문서 업데이트
      if (!missionSnap.exists) throw new HttpsError("not-found", "미션을 찾을 수 없습니다.");
      const mData = await readMissionStudentStates(db, missionRef, missionSnap.data(), { tx, studentUids: [studentUid] });
      if (!["pending", "late"].includes(subData.status || "pending") || mData.completions?.[studentUid]?.rewardGranted === true ||
          (mData.stateStorageVersion === 2 && (mData.submissionsIndex?.[studentUid] || mData.completions?.[studentUid]?.submissionId) !== submissionId)) {
        throw new HttpsError("failed-precondition", "현재 승인 대기 중인 제출물만 반려할 수 있습니다.");
      }
      tx.update(submissionRef, {
        status: "rejected",
        rejectReason: reason || "",
        rejectedAt: serverTime,
        reviewerUid: callerUid,
        updatedAt: serverTime,
      });

      // 2) [최적화] 미션 문서 동기화 (바구니에 모아서 한 번에 업데이트)
      const prevCompletion = mData.completions?.[studentUid] || {};
      const nextStatus = revertTo === "rejected" ? "rejected" : "unsubmitted";

      const missionUpdate = {
        [`completions.${studentUid}`]: {
          ...prevCompletion,
          status: nextStatus,
          feedback: reason || prevCompletion.feedback || "",
          submissionId: submissionId,
          updatedAt: serverTime,
          rejectedAt: serverTime,
        },
        [`submissionsIndex.${studentUid}`]: submissionId,
        updatedAt: serverTime,
      };

      // 미션 문서 "막타" 업데이트
      stageMissionStatePatch(tx, missionRef, mData, missionUpdate, FieldValue, db);

      // 3) 활동 로그 기록 (선생님의 반려 활동)
      stageActivityLog(
        tx,
        classId,
        {
          studentUid: callerUid, // 활동 주체 (교사)
          type: "system",
          category: "mission_reject",
          description: `'${mData.title || "미션"}' 과제 반려 (대상: ${subData.studentName || "학생"})`,
          relatedDoc: { collection: "submissions", id: submissionId },
        },
        logContext,
      );
    });

    return { success: true, message: "제출이 반려되었습니다." };
  },
);

/**
 * [일괄 반려] rejectSubmissionBatch
 * 1. tx.getAll()을 사용하여 모든 제출물 문서를 한 번의 호출로 병렬 로드합니다. (속도 대폭 향상)
 * 2. 루프 내부의 개별 await를 제거하여 트랜잭션 점유 시간을 최소화했습니다.
 * 3. 최적화된 hasPermission 유틸리티를 적용하였습니다.
 */
exports.rejectSubmissionBatch = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60 },
  async (request) => {
    const callerUid = request.auth?.uid;
    const callerRole = request.auth?.token?.role;
    const {
      classId,
      missionId,
      submissionIds = [],
      revertTo = "rejected",
      reason = "",
    } = request.data || {};

    // 0. 기본 검증
    if (!callerUid)
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    if (!classId || !missionId || !Array.isArray(submissionIds)) {
      throw new HttpsError("invalid-argument", "필수 정보가 누락되었습니다.");
    }
    if (submissionIds.length === 0)
      return { success: true, message: "반려할 대상이 없습니다." };
    if (submissionIds.length > 50) {
      throw new HttpsError(
        "invalid-argument",
        "최대 50건까지 처리 가능합니다.",
      );
    }

    // 1. 권한 확인 (최적화된 유틸리티 사용)
    const isTeacher = callerRole === "teacher" || callerRole === "admin";
    if (
      !isTeacher &&
      !(await hasPermission(callerUid, classId, "mission_admin"))
    ) {
      throw new HttpsError("permission-denied", "반려 권한이 없습니다.");
    }

    // 2. 전역 정책 설정 가져오기 (캐시 처리됨)
    assertMissionRequestClass(request, classId);
    const globalConfig = await getGlobalConfig();

    const missionRef = db.doc(`classes/${classId}/missions/${missionId}`);
    const classRef = db.doc(`classes/${classId}`);

    // 🌟 [최적화] 읽어야 할 제출물 Reference 리스트 생성
    const subRefs = submissionIds.map((sid) =>
      db.doc(`classes/${classId}/missions/${missionId}/submissions/${sid}`),
    );

    const results = { success: [], failed: [] };

    await db.runTransaction(async (tx) => {
      // 3. [일괄 읽기] 미션, 학급, 모든 제출물 문서를 동시에 가져옵니다.
      results.success.length = 0;
      results.failed.length = 0;
      const snaps = await tx.getAll(missionRef, classRef, ...subRefs);

      const missionSnap = snaps[0];
      const classSnap = snaps[1];
      const submissionSnaps = snaps.slice(2);

      if (!missionSnap.exists)
        throw new HttpsError("not-found", "미션을 찾을 수 없습니다.");

      const missionData = await readMissionStudentStates(db, missionRef, missionSnap.data() || {}, { tx, studentUids: [...new Set(submissionSnaps.filter(s => s.exists).map(s => s.data().studentUid))] });
      const planType = classSnap.data()?.planType || "FREE";
      const nextStatus = revertTo === "rejected" ? "rejected" : "unsubmitted";
      const serverTime = FieldValue.serverTimestamp();

      const logContext = {
        config: globalConfig,
        planType,
        serviceName: "mission",
      };
      const missionUpdate = {}; // Mission 문서 업데이트 바구니

      // 4. [루프] 이미 메모리에 로드된 데이터를 바탕으로 처리 (네트워크 대기 없음)
      submissionSnaps.forEach((sSnap) => {
        if (!sSnap.exists) {
          results.failed.push({ sid: sSnap.id, error: "문서 없음" });
          return;
        }

        const sid = sSnap.id;
        const subData = sSnap.data();
        const studentUid = subData.studentUid;

        if (!studentUid) {
          results.failed.push({ sid, error: "학생 UID 누락" });
          return;
        }
        const completion = missionData.completions?.[studentUid] || {};
        if (!["pending", "late"].includes(subData.status || "pending") || completion.rewardGranted === true ||
            (missionData.stateStorageVersion === 2 && (missionData.submissionsIndex?.[studentUid] || completion.submissionId) !== sid)) {
          results.failed.push({ sid, error: "현재 승인 대기 중인 제출물만 반려할 수 있습니다." });
          return;
        }

        // (1) 제출물 문서 업데이트
        tx.update(sSnap.ref, {
          status: "rejected",
          rejectReason: reason || "",
          rejectedAt: serverTime,
          reviewerUid: callerUid,
          updatedAt: serverTime,
        });

        // (2) 미션 문서 completions 업데이트 내용 바구니에 담기
        // 기존 데이터를 보존하면서 필드 단위로 업데이트
        const prev = missionData.completions?.[studentUid] || {};
        missionUpdate[`completions.${studentUid}`] = {
          ...prev,
          status: nextStatus,
          feedback: reason || prev.feedback || "",
          submissionId: sid,
          updatedAt: serverTime,
          rejectedAt: serverTime,
        };
        missionUpdate[`submissionsIndex.${studentUid}`] = sid;

        results.success.push(sid);
      });

      // 5. [일괄 업데이트] Mission 문서 "막타" 한 번만 실행
      if (Object.keys(missionUpdate).length > 0) {
        missionUpdate.updatedAt = serverTime;
        stageMissionStatePatch(tx, missionRef, missionData, missionUpdate, FieldValue, db);
      }

      // 📝 활동 로그 기록 (선생님의 일괄 반려 활동)
      if (results.success.length > 0) {
        stageActivityLog(
          tx,
          classId,
          {
            studentUid: callerUid,
            type: "system",
            category: "mission_reject_batch",
            description: `'${missionData.title || "미션"}' 과제 ${results.success.length}건 일괄 반려`,
          },
          logContext,
        );
      }
    });

    return {
      success: true,
      message: `${results.success.length}건의 제출이 반려되었습니다.`,
      results,
    };
  },
);

/**
 * [완료형 반려 일괄] rejectMissionCompletionBatch
 * - 제출폼 없는 완료형 미션에서 pending/late 상태를 rejected로 변경합니다.
 * - 제출물이 있는 경우는 rejectSubmissionBatch를 사용해야 합니다.
 */
exports.rejectMissionCompletionBatch = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60 },
  async (request) => {
    const callerUid = request.auth?.uid;
    const callerRole = request.auth?.token?.role;
    const { classId, missionId, studentUids = [], reason = "" } =
      request.data || {};

    if (!callerUid) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    if (!classId || !missionId || !Array.isArray(studentUids)) {
      throw new HttpsError("invalid-argument", "필수 정보가 누락되었습니다.");
    }
    if (studentUids.length === 0) {
      return { success: true, message: "반려할 대상이 없습니다." };
    }
    if (studentUids.length > 50) {
      throw new HttpsError(
        "invalid-argument",
        "최대 50명까지 처리 가능합니다.",
      );
    }

    const isTeacher = callerRole === "teacher" || callerRole === "admin";
    if (
      !isTeacher &&
      !(await hasPermission(callerUid, classId, "mission_admin"))
    ) {
      throw new HttpsError("permission-denied", "반려 권한이 없습니다.");
    }

    assertMissionRequestClass(request, classId);
    const globalConfig = await getGlobalConfig();
    const missionRef = db.doc(`classes/${classId}/missions/${missionId}`);
    const classRef = db.doc(`classes/${classId}`);
    const results = { success: [], failed: [] };

    await db.runTransaction(async (tx) => {
      const [missionSnap, classSnap] = await tx.getAll(missionRef, classRef);
      results.success.length = 0;
      results.failed.length = 0;

      if (!missionSnap.exists) {
        throw new HttpsError("not-found", "미션을 찾을 수 없습니다.");
      }

      const mission = await readMissionStudentStates(db, missionRef, missionSnap.data() || {}, { tx, studentUids });
      const planType = classSnap.data()?.planType || "FREE";
      const serverTime = FieldValue.serverTimestamp();
      const missionUpdate = {};
      const reasonText = (reason || "").trim();
      const submissionsIndex = mission?.submissionsIndex || {};
      const dedupUids = [...new Set(studentUids.filter(Boolean))];

      for (const studentUid of dedupUids) {
        const completion = mission?.completions?.[studentUid] || null;
        if (!completion) {
          results.failed.push({ uid: studentUid, error: "완료 기록이 없습니다." });
          continue;
        }

        const status = completion.status;
        if (!(status === "pending" || status === "late")) {
          results.failed.push({
            uid: studentUid,
            error: "승인 대기 상태가 아닙니다.",
          });
          continue;
        }

        // 제출물이 있는 경우엔 제출물 반려 API 사용
        const hasSubmission =
          !!completion?.submissionId || !!submissionsIndex?.[studentUid];
        if (hasSubmission) {
          results.failed.push({
            uid: studentUid,
            error: "제출물이 있는 미션은 제출물 반려로 처리해야 합니다.",
          });
          continue;
        }

        missionUpdate[`completions.${studentUid}.status`] = "rejected";
        missionUpdate[`completions.${studentUid}.rejectedAt`] = serverTime;
        missionUpdate[`completions.${studentUid}.reviewerUid`] = callerUid;
        missionUpdate[`completions.${studentUid}.updatedAt`] = serverTime;
        if (reasonText) {
          missionUpdate[`completions.${studentUid}.feedback`] = reasonText;
        }
        missionUpdate[`completions.${studentUid}.submissionId`] =
          FieldValue.delete();
        missionUpdate[`submissionsIndex.${studentUid}`] = FieldValue.delete();

        results.success.push(studentUid);
      }

      if (Object.keys(missionUpdate).length > 0) {
        missionUpdate.updatedAt = serverTime;
        stageMissionStatePatch(tx, missionRef, mission, missionUpdate, FieldValue, db);
      }

      if (results.success.length > 0) {
        stageActivityLog(
          tx,
          classId,
          {
            studentUid: callerUid,
            type: "system",
            category: "mission_reject_completion_batch",
            description: `'${mission.title || "미션"}' 완료형 ${results.success.length}건 일괄 반려`,
          },
          {
            config: globalConfig,
            planType,
            serviceName: "mission",
          },
        );
      }
    });

    return {
      success: true,
      message: `완료형 ${results.success.length}건 반려, ${results.failed.length}건 실패`,
      results,
    };
  },
);
