import { createFinancialRequestId } from "../../../utils/financialRequests";
import { getFunctions, httpsCallable } from "firebase/functions";
import { isBulkRefundSuccessful } from "../utils/storeRefundResult";

const functions = getFunctions(undefined, "asia-northeast3");

const purchaseStoreItemFunction = httpsCallable(functions, "purchaseStoreItem");
const purchaseStoreCartFunction = httpsCallable(functions, "purchaseStoreCart");
const cancelStorePurchaseFunction = httpsCallable(functions, "cancelStorePurchase");
const bulkCancelStorePurchasesFunction = httpsCallable(
  functions,
  "bulkCancelStorePurchases",
);
const getItemPurchaseInfoFunction = httpsCallable(functions, "getItemPurchaseInfo");
const purchaseStoreCartPosFunction = httpsCallable(functions, "purchaseStoreCartPos");

export const buyStoreCart = async (classId, items, clientRequestId = createFinancialRequestId()) => {
  try {
    const result = await purchaseStoreCartFunction({ classId, items, clientRequestId });
    return {
      success: true,
      message: result.data?.message || "장바구니 결제가 완료되었습니다.",
      data: {
        clientRequestId,
        totalCost: result.data?.totalCost,
        totalCostByCurrency: result.data?.totalCostByCurrency,
        taxAmountByCurrency: result.data?.taxAmountByCurrency,
        itemCount: result.data?.itemCount,
        newBalance: result.data?.newBalance,
      },
    };
  } catch (error) {
    console.error("[buyStoreCart] Error:", error);
    return {
      success: false,
      code: error.code,
      details: error.details,
      message: error.message || "장바구니 결제 중 오류가 발생했습니다.",
    };
  }
};

export const buyStoreCartPos = async (
  classId,
  studentUid,
  items,
  options = {},
) => {
  try {
    const {
      isImmediate = true,
      transactionType = "purchase",
      recordAsTaxExpense = false,
      classFundId = "",
      clientRequestId = createFinancialRequestId(),
    } = options || {};

    const result = await purchaseStoreCartPosFunction({
      classId,
      targetStudentUid: studentUid,
      items,
      isImmediate,
      transactionType,
      recordAsTaxExpense,
      classFundId,
      clientRequestId,
    });
    return {
      success: true,
      message: result.data?.message || "POS 결제가 완료되었습니다.",
      data: result.data,
    };
  } catch (error) {
    console.error("[buyStoreCartPos] Error:", error);
    return {
      success: false,
      code: error.code,
      details: error.details,
      message: error.message || "POS 결제 중 오류가 발생했습니다.",
    };
  }
};

export const getItemPurchaseInfo = async (classId, itemId, quantity = 1) => {
  try {
    const result = await getItemPurchaseInfoFunction({ classId, itemId, quantity });
    return { success: true, data: result.data };
  } catch (error) {
    console.error("[getItemPurchaseInfo] Error:", error);
    return {
      success: false,
      message: error.message || "상품 정보 조회 중 오류가 발생했습니다.",
    };
  }
};

export const buyStoreItem = async (classId, itemId, quantity = 1, clientRequestId = createFinancialRequestId()) => {
  try {
    const result = await purchaseStoreItemFunction({ classId, itemId, quantity, clientRequestId });
    return {
      success: true,
      message: result.data?.message,
      data: {
        purchaseId: result.data?.purchaseId,
        totalCost: result.data?.totalCost,
        taxAmount: result.data?.taxAmount,
        currencyType: result.data?.currencyType,
        newBalance: result.data?.newBalance,
      },
    };
  } catch (error) {
    console.error("[buyStoreItem] Error:", error);
    return {
      success: false,
      code: error.code,
      details: error.details,
      message: error.message || "상품 구매 중 오류가 발생했습니다.",
    };
  }
};

export const cancelStorePurchase = async (
  classId,
  studentUid,
  purchaseId,
  reason = "",
) => {
  try {
    const result = await cancelStorePurchaseFunction({
      classId,
      studentUid,
      purchaseId,
      reason,
    });
    return {
      success: true,
      message: result.data?.message || "환불 처리가 완료되었습니다.",
      data: {
        refundAmount: result.data?.refundAmount,
        taxRefundAmount: result.data?.taxRefundAmount,
      },
    };
  } catch (error) {
    console.error("[cancelStorePurchase] Error:", error);
    return {
      success: false,
      message: error.message || "구매 취소 중 오류가 발생했습니다.",
    };
  }
};

export const bulkCancelStorePurchases = async (
  classId,
  purchases,
  reason = "",
) => {
  try {
    const result = await bulkCancelStorePurchasesFunction({
      classId,
      purchases,
      reason,
    });
    return {
      success: isBulkRefundSuccessful(result.data),
      message: result.data?.taxRecordError
        ? `${result.data?.message || "환불 처리 결과"}\n세금 기록을 저장하지 못했습니다. 세금 내역 확인이 필요합니다: ${result.data.taxRecordError}`
        : result.data?.message || `${result.data?.successCount || 0}건 환불이 완료되었습니다.`,
      data: result.data,
    };
  } catch (error) {
    console.error("[bulkCancelStorePurchases] Error:", error);
    return {
      success: false,
      message: error.message || "일괄 환불 처리 중 오류가 발생했습니다.",
    };
  }
};

export const calculateTaxFromTotalPrice = (totalPrice, taxRate) => {
  const total = Number(totalPrice) || 0;
  const rate = Number(taxRate) || 0;

  if (rate === 0) {
    return {
      baseAmount: total,
      taxAmount: 0,
      totalAmount: total,
      taxRate: 0,
    };
  }

  const baseAmount = Math.round(total / (1 + rate / 100));
  const taxAmount = total - baseAmount;

  return {
    baseAmount,
    taxAmount,
    totalAmount: total,
    taxRate: rate,
  };
};
