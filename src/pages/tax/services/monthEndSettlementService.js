import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../../../firebase";
import { getCallableErrorMessage } from "./callableErrorMessage";

const functions = getFunctions(undefined, "asia-northeast3");

const generateDraftCallable = httpsCallable(
  functions,
  "generateMonthEndSettlementDraft",
);
const finalizeDraftCallable = httpsCallable(
  functions,
  "finalizeMonthEndSettlementDraft",
);
const cancelDraftCallable = httpsCallable(
  functions,
  "cancelMonthEndSettlementDraft",
);
const updateManualAdjustmentsCallable = httpsCallable(
  functions,
  "updateMonthEndSettlementManualAdjustments",
);

export const generateMonthEndSettlementDraft = async ({
  classId,
  selectedStudentUids = null,
} = {}) => {
  if (!classId) {
    return { success: false, message: "classId가 필요합니다." };
  }

  try {
    const result = await generateDraftCallable({
      classId,
      ...(Array.isArray(selectedStudentUids) && selectedStudentUids.length > 0
        ? { selectedStudentUids }
        : {}),
    });
    return result?.data || { success: false, message: "미리보기 생성에 실패했습니다." };
  } catch (error) {
    console.error("generateMonthEndSettlementDraft failed:", error);
    return {
      success: false,
      message: getCallableErrorMessage(error, "월말정산 미리보기를 생성하지 못했습니다."),
    };
  }
};

export const finalizeMonthEndSettlementDraft = async ({ classId, draftId } = {}) => {
  if (!classId || !draftId) {
    return { success: false, message: "classId와 draftId가 필요합니다." };
  }

  try {
    const result = await finalizeDraftCallable({ classId, draftId });
    return result?.data || { success: false, message: "정산 확정에 실패했습니다." };
  } catch (error) {
    console.error("finalizeMonthEndSettlementDraft failed:", error);
    return {
      success: false,
      message: getCallableErrorMessage(error, "월말정산을 확정하지 못했습니다."),
    };
  }
};

export const cancelMonthEndSettlementDraft = async ({
  classId,
  draftId,
  reason = "",
} = {}) => {
  if (!classId || !draftId) {
    return { success: false, message: "classId와 draftId가 필요합니다." };
  }

  try {
    const result = await cancelDraftCallable({ classId, draftId, reason });
    return result?.data || { success: false, message: "미리보기 취소에 실패했습니다." };
  } catch (error) {
    console.error("cancelMonthEndSettlementDraft failed:", error);
    return {
      success: false,
      message: getCallableErrorMessage(error, "월말정산 미리보기를 취소하지 못했습니다."),
    };
  }
};

export const updateMonthEndSettlementManualAdjustments = async ({
  classId,
  draftId,
  adjustments = [],
} = {}) => {
  if (!classId || !draftId) {
    return { success: false, message: "classId와 draftId가 필요합니다." };
  }

  try {
    const result = await updateManualAdjustmentsCallable({
      classId,
      draftId,
      adjustments,
    });
    return result?.data || { success: false, message: "수동 공제 저장에 실패했습니다." };
  } catch (error) {
    console.error("updateMonthEndSettlementManualAdjustments failed:", error);
    return {
      success: false,
      message: getCallableErrorMessage(error, "수동 공제를 저장하지 못했습니다."),
    };
  }
};

const serializeDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "string") return value;
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }
  return null;
};

const fetchDraftRows = async (draftRef) => {
  const rowsSnap = await getDocs(collection(draftRef, "studentRows"));
  return rowsSnap.docs
    .map((rowDoc) => ({ id: rowDoc.id, ...(rowDoc.data() || {}) }))
    .sort((a, b) => Number(b.grossIncome || 0) - Number(a.grossIncome || 0));
};

export const fetchMonthEndSettlementDraft = async ({
  classId,
  draftId,
  includeRows = true,
} = {}) => {
  if (!classId || !draftId) {
    return { success: false, message: "classId와 draftId가 필요합니다." };
  }

  try {
    const draftRef = doc(db, "classes", classId, "monthEndSettlementDrafts", draftId);
    const draftSnap = await getDoc(draftRef);
    if (!draftSnap.exists()) {
      return { success: false, message: "미리보기를 찾을 수 없습니다." };
    }
    const draft = draftSnap.data() || {};
    let rows = [];

    if (includeRows) {
      rows = await fetchDraftRows(draftRef);
    }

    return {
      success: true,
      draftId,
      ...draft,
      period: {
        startAt: serializeDate(draft.periodStartAt),
        endAt: serializeDate(draft.periodEndAt),
      },
      rows,
      rowsLoaded: includeRows,
    };
  } catch (error) {
    console.error("fetchMonthEndSettlementDraft failed:", error);
    return {
      success: false,
      message: error?.message || "미리보기를 불러오지 못했습니다.",
    };
  }
};

export const fetchMonthEndSettlementDraftRows = async ({ classId, draftId } = {}) => {
  if (!classId || !draftId) {
    return { success: false, message: "classId와 draftId가 필요합니다." };
  }

  try {
    const draftRef = doc(db, "classes", classId, "monthEndSettlementDrafts", draftId);
    const rows = await fetchDraftRows(draftRef);
    return {
      success: true,
      draftId,
      rows,
      rowsLoaded: true,
    };
  } catch (error) {
    console.error("fetchMonthEndSettlementDraftRows failed:", error);
    return {
      success: false,
      message: error?.message || "미리보기 상세를 불러오지 못했습니다.",
    };
  }
};

export const fetchMonthEndSettlementHistory = async ({ classId, pageSize = 20 } = {}) => {
  if (!classId) {
    return { success: false, message: "classId가 필요합니다." };
  }

  try {
    const historyQuery = query(
      collection(db, "classes", classId, "monthEndSettlementDrafts"),
      orderBy("periodEndAt", "desc"),
      limit(pageSize),
    );
    const snapshot = await getDocs(historyQuery);
    const items = snapshot.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      return {
        id: docSnap.id,
        ...data,
        period: {
          startAt: serializeDate(data.periodStartAt),
          endAt: serializeDate(data.periodEndAt),
        },
        finalizedAt: serializeDate(data.finalizedAt),
        cancelledAt: serializeDate(data.cancelledAt),
        updatedAt: serializeDate(data.updatedAt),
      };
    });

    return { success: true, items };
  } catch (error) {
    console.error("fetchMonthEndSettlementHistory failed:", error);
    return {
      success: false,
      message: error?.message || "정산 내역을 불러오지 못했습니다.",
    };
  }
};
