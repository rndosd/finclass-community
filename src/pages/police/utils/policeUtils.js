// src/pages/police/utils/policeUtils.js - 벌금/상금 최종 정리 버전

import {
  doc,
  increment,
  serverTimestamp,
  collection,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase"; // firebase app에서 export한 functions 인스턴스

/* -------------------------------------------
 * Callable 함수 연결
 * ----------------------------------------- */
// 벌금 관련 (단일은 제거, 다중만 사용)
const refundFineAmountFn = httpsCallable(functions, "refundFineAmount");
const applyMultipleFinesFn = httpsCallable(functions, "applyMultipleFines");
const applyCustomFinesFn = httpsCallable(functions, "applyCustomFines"); // ✅ 새 이름

// 상금 관련 (단일은 제거, 다중만 사용)
const refundRewardAmountFn = httpsCallable(functions, "refundRewardAmount");
const applyMultipleRewardsFn = httpsCallable(functions, "applyMultipleRewards");
const applyCustomRewardsFn = httpsCallable(functions, "applyCustomRewards"); // ✅ 새 이름
const resolvePoliceReportsFn = httpsCallable(functions, "resolvePoliceReports");
const hardDeletePoliceFineHistoryFn = httpsCallable(
  functions,
  "hardDeletePoliceFineHistory",
);
const updatePoliceReasonFn = httpsCallable(functions, "updatePoliceReason");
const updatePoliceSensitivityFn = httpsCallable(
  functions,
  "updatePoliceSensitivity",
);
const reviewPoliceReflectionFn = httpsCallable(
  functions,
  "reviewPoliceReflection",
);

// 공통
const getStudentBalanceFn = httpsCallable(functions, "getStudentBalance");

const resolveRuleAction = (rule) => {
  const amount = Number(rule?.fineAmount || 0);
  if (amount > 0) return "reward";
  if (amount < 0) return "fine";

  const creditChange = Number(rule?.creditChange || 0);
  if (creditChange > 0) return "reward";
  if (creditChange < 0) return "fine";

  const missionTokenChange = Number(rule?.missionTokenChange || 0);
  if (missionTokenChange > 0) return "reward";
  if (missionTokenChange < 0) return "fine";

  return null;
};

/* -------------------------------------------
 * 경로 헬퍼
 * ----------------------------------------- */
export const getPath = (type, classId, studentUid = null, docId = null) => {
  if (!classId) {
    console.error("policeUtils getPath: classId is undefined for type:", type);
    return null;
  }
  switch (type) {
    case "reports":
      return `classes/${classId}/policeReports`;
    case "reportDoc":
      return `classes/${classId}/policeReports/${docId}`;
    case "studentDoc":
      return `classes/${classId}/students/${studentUid}`;
    case "policeFineHistory":
      return `classes/${classId}/policeFineHistory`;
    default:
      console.error(`Unknown path type in policeUtils: ${type}`);
      return null;
  }
};

/* -------------------------------------------
 * 벌금 관련 함수들
 * ----------------------------------------- */

export const applyPenaltyAndLog = async ({
  batch,
  db,
  classId,
  studentUid,
  studentName,
  ruleId,
  reason,
  reportId, // 💡 신고 ID
  originalReportCreatedAt,
  policeRules,
  actorUid,
  actorName,
  // 💡 [추가] 신고자 정보 인자 추가
  reporterName,
  reporterUid,
  reportReason,
}) => {
  if (
    !batch ||
    !db ||
    !classId ||
    !studentUid ||
    !ruleId ||
    !policeRules ||
    !actorUid ||
    !actorName
  ) {
    return {
      success: false,
      message: "벌금 적용을 위한 필수 정보가 부족합니다.",
    };
  }

  const rule = policeRules.find((r) => r.id === ruleId);
  if (!rule)
    return { success: false, message: "규칙 정보를 찾을 수 없습니다." };

  const studentPath = getPath("studentDoc", classId, studentUid);
  const fineHistoryPath = getPath("policeFineHistory", classId);
  if (!studentPath || !fineHistoryPath) {
    return { success: false, message: "데이터 경로 생성에 실패했습니다." };
  }

  const studentRef = doc(db, studentPath);
  const fineRef = doc(collection(db, fineHistoryPath));

  const fineAmountToApply = Math.abs(rule.fineAmount || 0);
  const creditChangeToApply = rule.creditChange || 0;

  try {
    if (fineAmountToApply > 0) {
      // 💡 [수정] 백엔드(Cloud Functions)로 신고 정보까지 실어서 보냅니다.
      const result = await applyMultipleFinesFn({
        fines: [
          {
            studentUid,
            amount: fineAmountToApply,
            description: reason || `'${rule.text}' 벌금 부과`, // 처벌 사유
            relatedDocId: fineRef.id,
            ruleText: rule.text,
            ruleId: rule.id,
            // 🔥 [핵심 추가] 이 필드들이 있어야 백엔드에서 신고 기반으로 인식합니다.
            reporterName: reporterName || null,
            reporterUid: reporterUid || null,
            reportReason: reportReason || null,
          },
        ],
      });

      if (!result.data?.success) {
        return {
          success: false,
          message: result.data?.message || "벌금 차감 실패",
        };
      }
    }

    // 신용점수 로직 (기존과 동일)
    if (creditChangeToApply !== 0) {
      batch.update(studentRef, { creditScore: increment(creditChangeToApply) });
      const creditLogRef = doc(collection(db, `classes/${classId}/students/${studentUid}/creditLogs`));
      batch.set(creditLogRef, {
        amount: creditChangeToApply,
        reason: `'${rule.text}' 위반으로 인한 신용점수 ${creditChangeToApply > 0 ? "상승" : "감점"}`,
        source: "police_rule",
        relatedDocId: fineRef.id,
        timestamp: serverTimestamp(),
        actorUid,
        actorName,
      });
    }

    return { success: true, newFineHistoryId: fineRef.id };
  } catch (error) {
    console.error("벌금 적용 실패:", error);
    return { success: false, message: `벌금 적용 실패: ${error.message}` };
  }
};

export const cancelFineAndRevert = async ({
  db,
  batch,
  classId,
  fineRecord,
  actorUid,
  actorName,
}) => {
  if (
    !batch ||
    !db ||
    !classId ||
    !fineRecord?.id ||
    !fineRecord?.studentUid ||
    !actorUid ||
    !actorName
  ) {
    return {
      success: false,
      message: "벌금 취소를 위한 필수 정보가 부족합니다.",
    };
  }

  const studentPath = getPath("studentDoc", classId, fineRecord.studentUid);
  const fineHistoryCollectionPath = getPath("policeFineHistory", classId);
  if (!studentPath || !fineHistoryCollectionPath) {
    return { success: false, message: "데이터 경로 생성에 실패했습니다." };
  }

  const studentRef = doc(db, studentPath);
  const fineHistoryRef = doc(db, fineHistoryCollectionPath, fineRecord.id);

  const fineAmountToRefund = Math.abs(fineRecord.fineAmountApplied || 0);
  const creditChangeToRevert = -(fineRecord.creditChangeApplied || 0);

  try {
    if (fineAmountToRefund > 0) {
      const result = await refundFineAmountFn({
        studentUid: fineRecord.studentUid,
        amount: fineAmountToRefund,
        description: `'${fineRecord.ruleText}' 벌금 취소 및 환불`,
        relatedDocId: fineRecord.id,
        ruleText: fineRecord.ruleText,
      });
      if (!result.data?.success) {
        return {
          success: false,
          message: result.data?.message || "벌금 환불 실패",
        };
      }
    }

    if (creditChangeToRevert !== 0) {
      batch.update(studentRef, {
        creditScore: increment(creditChangeToRevert),
      });

      const creditLogRef = doc(
        collection(
          db,
          `classes/${classId}/students/${fineRecord.studentUid}/creditLogs`
        )
      );
      batch.set(creditLogRef, {
        amount: creditChangeToRevert,
        reason: `경찰청 벌금 취소로 인한 신용점수 회복`,
        source: "police_cancel",
        relatedDocId: fineRecord.id,
        timestamp: serverTimestamp(),
        actorUid,
        actorName,
      });
    }

    batch.update(fineHistoryRef, {
      status: "cancelled",
      isCancelled: true,
      cancelledAt: serverTimestamp(),
      cancelledByUid: actorUid,
      cancelledByName: actorName,
    });

    return { success: true };
  } catch (error) {
    console.error("벌금 취소 실패:", error);
    return { success: false, message: `벌금 취소 실패: ${error.message}` };
  }
};

export const applyMultiplePenalties = async ({
  db,
  classId,
  penalties,
  policeRules,
  actorUid,
  actorName,
}) => {
  try {
    const fines = penalties
      .map((penalty) => {
        const rule = policeRules.find((r) => r.id === penalty.ruleId);
        return {
          studentUid: penalty.studentUid,
          amount: Math.abs(rule?.fineAmount || 0),
          // 🌟 description뿐만 아니라 reason 필드도 명시적으로 추가
          description: penalty.reason || `'${rule?.text}' 벌금 부과`,
          reason: penalty.reason || "",
          relatedDocId: penalty.fineDocId,
          ruleText: rule?.text,
          ruleId: rule?.id,
          creditChange: Number(rule?.creditChange || 0), // 신용점수도 함께 전달 권장
          dangerLevel: Number(rule?.dangerLevel || 0) || null,
        };
      })
      .filter((f) => f.amount > 0);

    if (fines.length > 0) {
      const result = await applyMultipleFinesFn({ fines });
      return result.data;
    }
    return { success: true };
  } catch (error) {
    console.error("다중 벌금 부과 실패:", error);
    return { success: false, message: error.message };
  }
};

/**
 * ✅ 임의 벌금 부과 (단일/다중 지원) - 새 함수명 적용
 */
export const applyTeacherCustomPenalties = async ({
  uids = [],
  amount,
  creditChange = 0,
  reason = "",
  ruleTitle = "임의 규칙(교사)",
  relatedIds = {},
  sourceType = "custom",
  reportMetaByUid = {},
}) => {
  try {
    if (!Array.isArray(uids) || uids.length === 0) {
      return { success: false, message: "대상 학생을 선택하세요." };
    }
    const amt = Number(amount);

    const fines = uids.map((studentUid) => {
      const reportMeta = reportMetaByUid?.[studentUid] || {};

      return {
      studentUid,
      amount: amt,
      creditChange: Number(creditChange || 0),
      // 🌟 백엔드에서 history 문서의 'reason' 필드로 저장할 수 있도록 매핑
      description: reason,
      reason: reason,
      ruleText: ruleTitle, // 규칙 이름도 교사가 입력한 타이틀로 명시
      relatedDocId: relatedIds[studentUid],
      sourceType,
      reportId: reportMeta.reportId || relatedIds[studentUid] || null,
      reportReason: reportMeta.reportReason || reason || "",
      reporterName: reportMeta.reporterName || null,
      reporterUid: reportMeta.reporterUid || null,
      isSensitive: reportMeta.isSensitive === true,
    };
    });

    // applyCustomFinesFn 호출 시 payload 확인
    const res = await applyCustomFinesFn({ fines, ruleTitle });
    return res.data;
  } catch (error) {
    console.error("임의 벌금 부과 실패:", error);
    return { success: false, message: error.message };
  }
};

/* -------------------------------------------
 * 상금 관련 함수들
 * ----------------------------------------- */

export const applyMultipleRewards = async ({ rewards = [] }) => {
  try {
    if (!Array.isArray(rewards) || rewards.length === 0) {
      return { success: false, message: "지급할 상금 목록이 없습니다." };
    }

    // 🌟 백엔드에서 히스토리에 기록할 수 있도록 필드 매핑 강화
    const formattedRewards = rewards.map(r => ({
      ...r,
      reason: r.reason || r.description || "", // 사유 필드 명시
      description: r.description || r.reason || "상금 지급"
    }));

    const result = await applyMultipleRewardsFn({ rewards: formattedRewards });
    return result.data;
  } catch (error) {
    console.error("다중 상금 지급 실패:", error);
    return { success: false, message: `다중 상금 지급 실패: ${error.message}` };
  }
};

/**
 * ✅ 상금 취소 및 회수 (단일/일괄 통합)
 */
export const refundRewardAmount = async ({
  studentUid,
  amount,
  relatedDocId,
  relatedDocIds, // 👈 일괄 처리를 위한 배열 추가
  ruleText = "",
}) => {
  try {
    const payload = {
      studentUid,
      amount: amount ? Math.abs(Number(amount)) : 0, // NaN 방지
      relatedDocId,
      relatedDocIds, // 👈 배열 전달
      ruleText,
    };

    const result = await refundRewardAmountFn(payload);
    return result.data;
  } catch (error) {
    console.error("상금 회수 실패:", error);
    return { success: false, message: `상금 회수 실패: ${error.message}` };
  }
};

/**
 * ✅ 임의 상금 지급 (단일/다중 지원) - 새 함수명 적용
 */
export const applyTeacherCustomRewards = async ({
  uids = [],
  amount,
  creditChange = 0,
  reason = "",
  ruleTitle = "임의 보상(교사)",
  relatedIds = {},
}) => {
  try {
    if (!Array.isArray(uids) || uids.length === 0) {
      return { success: false, message: "대상 학생을 선택하세요." };
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return { success: false, message: "상금 금액을 입력하세요(양수)." };
    }

    const rewards = uids.map((studentUid) => ({
      studentUid,
      amount: amt,
      creditChange: Number(creditChange || 0),
      // 🌟 핵심 사유를 두 필드 모두에 담아 백엔드 호환성 확보
      description: reason || ruleTitle,
      reason: reason || "",
      ruleText: ruleTitle,
      relatedDocId: relatedIds[studentUid] || null,
    }));

    const res = await applyCustomRewardsFn({ rewards, ruleTitle });
    return res.data;
  } catch (error) {
    console.error("임의 상금 지급 실패:", error);
    return { success: false, message: `임의 상금 지급 실패: ${error.message}` };
  }
};

/* -------------------------------------------
 * 공통 유틸리티
 * ----------------------------------------- */

export const getStudentBalance = async (studentUid) => {
  try {
    const result = await getStudentBalanceFn({ studentUid });
    return result.data;
  } catch (error) {
    console.error("학생 잔고 조회 실패:", error);
    return { success: false, message: `잔고 조회 실패: ${error.message}` };
  }
};

/* -------------------------------------------
 * 선택: 통합 처리 헬퍼
 * ----------------------------------------- */

export const applyRuleBasedPenaltyOrReward = async ({
  studentUids = [],
  ruleId,
  policeRules = [],
  reason = "",
}) => {
  try {
    const rule = policeRules.find((r) => r.id === ruleId);
    if (!rule) {
      return { success: false, message: "규칙 정보를 찾을 수 없습니다." };
    }

    const amount = Number(rule.fineAmount || 0);
    const action = resolveRuleAction(rule);
    if (!action) {
      return {
        success: false,
        message: "금액 또는 신용점수 변화가 있는 규칙만 적용할 수 있습니다.",
      };
    }
    const isReward = action === "reward";

    if (isReward) {
      const rewards = studentUids.map((studentUid) => ({
        studentUid,
        amount: Math.abs(amount),
        description: reason || "규칙 기반 상금",
        ruleText: rule.text,
        creditChange: Number(rule.creditChange || 0),
        missionTokenChange: Number(rule.missionTokenChange || 0),
        dangerLevel: Number(rule?.dangerLevel || 0) || null,
        relatedDocId: null,
      }));
      return await applyMultipleRewards({ rewards });
    } else {
      const fines = studentUids.map((studentUid) => ({
        studentUid,
        amount: Math.abs(amount),
        description: reason || "규칙 기반 벌금",
        ruleText: rule.text,
        creditChange: Number(rule.creditChange || 0),
        missionTokenChange: Number(rule.missionTokenChange || 0),
        dangerLevel: Number(rule?.dangerLevel || 0) || null,
        relatedDocId: null,
      }));
      const result = await applyMultipleFinesFn({ fines });
      return result.data;
    }
  } catch (error) {
    console.error("규칙 기반 처리 실패:", error);
    return { success: false, message: `규칙 기반 처리 실패: ${error.message}` };
  }
};

export const applyTeacherCustomAction = async ({
  uids = [],
  amount,
  creditChange = 0,
  reason = "",
  ruleTitle = "",
  isReward = false,
  relatedIds = {},
  sourceType = "custom",
  reportMetaByUid = {},
}) => {
  const isReportLinkedAction = sourceType === "report";
  const defaultTitle =
    isReward && !isReportLinkedAction ? "임의 보상(교사)" : "임의 규칙(교사)";
  const finalTitle = ruleTitle || defaultTitle;

  if (isReward && !isReportLinkedAction) {
    return await applyTeacherCustomRewards({
      uids,
      amount,
      creditChange,
      reason,
      ruleTitle: finalTitle,
      relatedIds,
    });
  } else {
    return await applyTeacherCustomPenalties({
      uids,
      amount,
      creditChange,
      reason,
      ruleTitle: finalTitle,
      relatedIds,
      sourceType,
      reportMetaByUid,
    });
  }
};

export const resolvePoliceReports = async ({
  reportIds = [],
  decision = "applied",
  rejectReason = "",
  rejectReasonByReportId = {},
}) => {
  try {
    const normalizedIds = Array.isArray(reportIds)
      ? [...new Set(reportIds.map((id) => String(id || "").trim()).filter(Boolean))]
      : [];
    if (normalizedIds.length === 0) {
      return { success: false, message: "처리할 신고가 없습니다." };
    }
    const result = await resolvePoliceReportsFn({
      reportIds: normalizedIds,
      decision,
      rejectReason: String(rejectReason || "").trim(),
      rejectReasonByReportId,
    });
    return result.data;
  } catch (error) {
    console.error("신고 처리 실패:", error);
    return { success: false, message: `신고 처리 실패: ${error.message}` };
  }
};

export const checkIsPoliceAdmin = (userData) => {
  const role = userData?.role;
  return role === "admin" || role === "teacher";
};

/**
 * ✅ 벌금 취소 및 환불 (단일/일괄 통합)
 */
export const refundFineAmount = async ({
  studentUid,
  amount,
  relatedDocId,
  relatedDocIds, // 👈 일괄 처리를 위한 배열 추가
  ruleText = "",
}) => {
  try {
    // 백엔드로 보낼 데이터 구성
    const payload = {
      studentUid,
      amount: amount ? Math.abs(Number(amount)) : 0, // NaN 방지
      relatedDocId,
      relatedDocIds, // 👈 배열 전달
      ruleText,
    };

    const result = await refundFineAmountFn(payload);
    return result.data;
  } catch (error) {
    console.error("벌금 환불 실패:", error);
    return { success: false, message: `벌금 환불 실패: ${error.message}` };
  }
};

export const hardDeletePoliceFineHistory = async ({ classId, recordId }) => {
  try {
    const result = await hardDeletePoliceFineHistoryFn({
      classId,
      recordId,
    });
    return result.data;
  } catch (error) {
    console.error("경찰 기록 삭제 실패:", error);
    return {
      success: false,
      message: `경찰 기록 삭제 실패: ${error.message}`,
    };
  }
};

export const reviewPoliceReflection = async ({
  reflectionId,
  finePercent = 100,
  creditPercent = 100,
  missionTokenPercent = 100,
  teacherComment = "",
}) => {
  try {
    const result = await reviewPoliceReflectionFn({
      reflectionId,
      finePercent,
      creditPercent,
      missionTokenPercent,
      teacherComment,
    });
    return result.data;
  } catch (error) {
    console.error("소명 승인/조정 실패:", error);
    return {
      success: false,
      message: `소명 승인/조정 실패: ${error.message}`,
    };
  }
};

export const updatePoliceReason = async ({
  classId,
  targetType,
  recordId,
  reason,
}) => {
  try {
    const result = await updatePoliceReasonFn({
      classId,
      targetType,
      recordId,
      reason,
    });
    return result.data;
  } catch (error) {
    console.error("경찰 사유 수정 실패:", error);
    return {
      success: false,
      message: `경찰 사유 수정 실패: ${error.message}`,
    };
  }
};

export const updatePoliceSensitivity = async ({
  classId,
  targetType,
  recordIds = [],
  isSensitive,
}) => {
  try {
    const result = await updatePoliceSensitivityFn({
      classId,
      targetType,
      recordIds,
      isSensitive,
    });
    return result.data;
  } catch (error) {
    console.error("경찰 민감도 수정 실패:", error);
    return {
      success: false,
      message: `경찰 민감도 수정 실패: ${error.message}`,
    };
  }
};

export const applyMultipleFines = async ({ fines = [] }) => {
  try {
    if (!Array.isArray(fines) || fines.length === 0) {
      return { success: false, message: "벌금 목록이 없습니다." };
    }
    const result = await applyMultipleFinesFn({ fines });
    return result.data;
  } catch (error) {
    console.error("다중 벌금 부과 실패:", error);
    return { success: false, message: `다중 벌금 부과 실패: ${error.message}` };
  }
};

/**
 * 🚀 [개선본] 신고 목록에서 선택한 항목들을 한 번에 백엔드로 쏘는 함수
 */
export const resolveBulkReportsAndApplyFines = async ({
  classId,
  selectedReports = [], // 드래그로 선택된 신고들
  policeRules = [],
}) => {
  try {
    // 1. 백엔드(applyMultipleFines)가 원하는 'fines' 배열 형태로 포맷팅
    const finesData = selectedReports.map((report) => {
      const rule = policeRules.find((r) => r.id === report.ruleId);
      return {
        studentUid: report.accusedStudentUid,
        amount: Math.abs(rule?.fineAmount || 0),
        ruleText: rule?.text || "규칙 위반",
        ruleId: rule?.id,
        relatedDocId: report.id, // 💡 중요: 신고 ID를 보내서 백엔드가 이 ID로 기록하게 함
        creditChange: rule?.creditChange || 0,
        dangerLevel: Number(rule?.dangerLevel || 0) || null,
        // 🔥 백엔드에서 필요로 하는 신고자 정보 추가
        reporterName: report.reporterName,
        reporterUid: report.reporterUid,
        reportReason: report.reason
      };
    });

    if (finesData.length === 0) return { success: true };

    // 2. 백엔드 함수 딱 한 번 호출!
    // 루프 돌리지 않고 통째로 넘깁니다.
    const result = await applyMultipleFinesFn({
      classId,
      fines: finesData
    });

    return result.data; // { success: true } 혹은 에러 메시지 반환
  } catch (error) {
    console.error("일괄 승인 실패:", error);
    return { success: false, message: error.message };
  }
};
