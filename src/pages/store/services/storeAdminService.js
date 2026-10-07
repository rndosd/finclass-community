// src/pages/store/services/storeAdminService.js

import { db } from "../../../firebase";
import { doc, deleteDoc, collection, query, where, limit, getDocs } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions(undefined, "asia-northeast3");
const markStorePurchaseAsRedeemedFunction = httpsCallable(
  functions,
  "markStorePurchaseAsRedeemed",
);
const resetStoreItemTotalPurchasesFunction = httpsCallable(
  functions,
  "resetStoreItemTotalPurchases",
);
const resetAllStoreTotalPurchasesFunction = httpsCallable(
  functions,
  "resetAllStoreTotalPurchases",
);
const rebuildStoreItemLimitSummaryFunction = httpsCallable(
  functions,
  "rebuildStoreItemLimitSummary",
);
const hardDeleteStorePurchaseFunction = httpsCallable(
  functions,
  "hardDeleteStorePurchase",
);

/**
 * 학생의 구매 건을 '지급 완료'로 처리합니다.
 * 실제 데이터 갱신은 Cloud Functions(markStorePurchaseAsRedeemed)에서 수행합니다.
 */
export const markPurchaseAsRedeemed = async ({
  classId,
  studentUid,
  purchaseId,
  adminUid,
}) => {
  if (!classId || !studentUid || !purchaseId || !adminUid) {
    return { success: false, message: "필수 정보가 누락되었습니다." };
  }

  try {
    const result = await markStorePurchaseAsRedeemedFunction({
      classId,
      studentUid,
      purchaseId,
    });

    return {
      success: true,
      message: result?.data?.message || "상품 지급이 완료되었습니다.",
      data: result?.data || null,
    };
  } catch (error) {
    console.error("Error marking purchase as redeemed:", error);
    return {
      success: false,
      message: `지급 완료 처리 중 오류: ${error.message}`,
    };
  }
};

/**
 * 여러 구매 건을 일괄 지급 완료 처리합니다.
 */
export const bulkMarkAsRedeemed = async ({ classId, adminUid, purchases }) => {
  if (!classId || !adminUid || !Array.isArray(purchases) || purchases.length === 0) {
    return { success: false, message: "필수 정보가 누락되었습니다." };
  }

  const results = {
    success: [],
    failed: [],
    total: purchases.length,
  };

  for (const purchase of purchases) {
    try {
      const result = await markPurchaseAsRedeemed({
        classId,
        purchaseId: purchase.purchaseId,
        adminUid,
        studentUid: purchase.studentUid,
      });

      if (result.success) {
        results.success.push(purchase);
      } else {
        results.failed.push({ ...purchase, error: result.message });
      }
    } catch (error) {
      results.failed.push({ ...purchase, error: error.message });
    }
  }

  const successCount = results.success.length;
  const failedCount = results.failed.length;

  if (failedCount === 0) {
    return {
      success: true,
      message: `${successCount}개 항목 모두 지급 완료되었습니다.`,
      results,
    };
  }

  if (successCount === 0) {
    return {
      success: false,
      message: `모든 항목 처리에 실패했습니다. (${failedCount}개 실패)`,
      results,
    };
  }

  return {
    success: true,
    message: `${successCount}개 완료, ${failedCount}개 실패`,
    results,
  };
};

/**
 * 상점 카테고리를 삭제합니다.
 * 연결된 상품이 있으면 삭제를 막습니다.
 */
export const deleteStoreCategory = async ({ classId, categoryId }) => {
  if (!classId || !categoryId) {
    return { success: false, message: "필수 정보가 누락되었습니다." };
  }

  try {
    const itemsRef = collection(db, `classes/${classId}/storeItems`);
    const q = query(itemsRef, where("categoryId", "==", categoryId), limit(1));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      return {
        success: false,
        message:
          "해당 카테고리에 속한 상품이 있어 삭제할 수 없습니다. 먼저 상품을 이동하거나 삭제해 주세요.",
      };
    }

    const categoryDocRef = doc(db, `classes/${classId}/storeCategories`, categoryId);
    await deleteDoc(categoryDocRef);

    return { success: true, message: "카테고리가 성공적으로 삭제되었습니다." };
  } catch (error) {
    console.error("Error deleting category:", error);
    return { success: false, message: "카테고리 삭제 중 오류가 발생했습니다." };
  }
};

export const resetStoreItemTotalPurchases = async ({
  classId,
  itemId,
  studentUids,
}) => {
  if (!classId || !itemId || !Array.isArray(studentUids) || studentUids.length === 0) {
    return { success: false, message: "필수 정보가 누락되었습니다." };
  }

  try {
    const result = await resetStoreItemTotalPurchasesFunction({
      classId,
      itemId,
      studentUids,
    });

    return {
      success: true,
      message:
        result?.data?.message || "선택한 학생의 전체 구매 횟수를 초기화했습니다.",
      data: result?.data || null,
    };
  } catch (error) {
    console.error("Error resetting store item totals:", error);
    return {
      success: false,
      message:
        error?.message || "전체 구매 횟수 초기화 중 오류가 발생했습니다.",
    };
  }
};

export const resetAllStoreTotalPurchases = async ({ classId }) => {
  if (!classId) {
    return { success: false, message: "필수 정보가 누락되었습니다." };
  }

  try {
    const result = await resetAllStoreTotalPurchasesFunction({ classId });

    return {
      success: true,
      message:
        result?.data?.message || "모든 상품의 전체 구매 횟수를 초기화했습니다.",
      data: result?.data || null,
    };
  } catch (error) {
    console.error("Error resetting all store totals:", error);
    return {
      success: false,
      message:
        error?.message || "모든 상품 초기화 중 오류가 발생했습니다.",
    };
  }
};

export const rebuildStoreItemLimitSummary = async ({ classId, itemId }) => {
  if (!classId || !itemId) {
    return {
      success: false,
      message: "\uD074\uB798\uC2A4 ID\uC640 \uC0C1\uD488 ID\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.",
    };
  }

  try {
    const result = await rebuildStoreItemLimitSummaryFunction({ classId, itemId });

    return {
      success: true,
      message:
        result?.data?.message ||
        "\uC0C1\uD488 \uC81C\uD55C \uD604\uD669 \uC694\uC57D\uC744 \uC7AC\uC0DD\uC131\uD588\uC2B5\uB2C8\uB2E4.",
      data: result?.data || null,
    };
  } catch (error) {
    console.error("Error rebuilding store item limit summary:", error);
    return {
      success: false,
      message:
        error?.message ||
        "\uC0C1\uD488 \uC81C\uD55C \uD604\uD669 \uC7AC\uC0DD\uC131 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.",
    };
  }
};

export const hardDeleteStorePurchase = async ({
  classId,
  purchaseId,
  studentUid,
}) => {
  if (!classId || !purchaseId) {
    return { success: false, message: "필수 값이 부족합니다." };
  }

  try {
    const result = await hardDeleteStorePurchaseFunction({
      classId,
      purchaseId,
      studentUid: studentUid || null,
    });

    return {
      success: true,
      message: result?.data?.message || "기록이 삭제되었습니다.",
      data: result?.data || null,
    };
  } catch (error) {
    console.error("Error hard deleting store purchase:", error);
    return {
      success: false,
      message: error?.message || "기록 삭제 중 오류가 발생했습니다.",
    };
  }
};
