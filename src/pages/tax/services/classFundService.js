import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions(undefined, "asia-northeast3");

const createClassFundCallable = httpsCallable(functions, "createClassFund");
const allocateTaxToClassFundsCallable = httpsCallable(
  functions,
  "allocateTaxToClassFunds",
);
const recordClassFundUsageCallable = httpsCallable(
  functions,
  "recordClassFundUsage",
);
const settleClassFundDailyExpensesCallable = httpsCallable(
  functions,
  "settleClassFundDailyExpenses",
);
const updateClassFundCallable = httpsCallable(functions, "updateClassFund");
const archiveClassFundCallable = httpsCallable(functions, "archiveClassFund");
const updateClassFundPensionSettingsCallable = httpsCallable(
  functions,
  "updateClassFundPensionSettings",
);
const transferClassFundsCallable = httpsCallable(functions, "transferClassFunds");
const payoutClassFundCallable = httpsCallable(functions, "payoutClassFund");
const updateClassFundOperatorsCallable = httpsCallable(functions, "updateClassFundOperators");
const cancelClassFundUsageCallable = httpsCallable(
  functions,
  "cancelClassFundUsage",
);

export const createClassFund = async ({
  classId,
  name,
  fundType,
  description,
  allowedChannels,
}) => {
  try {
    const result = await createClassFundCallable({
      classId,
      name,
      fundType,
      description,
      allowedChannels,
    });
    return result?.data || { success: false };
  } catch (error) {
    console.error("[createClassFund] error:", error);
    return {
      success: false,
      message: error?.message || "기금 생성에 실패했습니다.",
    };
  }
};

export const allocateTaxToClassFunds = async ({
  classId,
  allocations,
  description,
}) => {
  try {
    const result = await allocateTaxToClassFundsCallable({
      classId,
      allocations,
      description,
    });
    return result?.data || { success: false };
  } catch (error) {
    console.error("[allocateTaxToClassFunds] error:", error);
    return {
      success: false,
      message: error?.message || "예산 배정에 실패했습니다.",
    };
  }
};

export const recordClassFundUsage = async ({
  classId,
  fundId,
  amount,
  channel,
  description,
}) => {
  try {
    const result = await recordClassFundUsageCallable({
      classId,
      fundId,
      amount,
      channel,
      description,
    });
    return result?.data || { success: false };
  } catch (error) {
    console.error("[recordClassFundUsage] error:", error);
    return {
      success: false,
      message: error?.message || "기금 사용 기록에 실패했습니다.",
    };
  }
};

export const settleClassFundDailyExpenses = async ({ classId, fundId } = {}) => {
  try {
    const result = await settleClassFundDailyExpensesCallable({
      classId,
      fundId,
    });
    return result?.data || { success: false };
  } catch (error) {
    console.error("[settleClassFundDailyExpenses] error:", error);
    return {
      success: false,
      message: error?.message || "기금 사용 정산에 실패했습니다.",
    };
  }
};
export const updateClassFund = async (payload = {}) => {
  try {
    const result = await updateClassFundCallable(payload);
    return result?.data || { success: false };
  } catch (error) {
    console.error("[updateClassFund] error:", error);
    return {
      success: false,
      message: error?.message || "기금 수정에 실패했습니다.",
    };
  }
};

export const transferClassFunds = async (payload = {}) => {
  try {
    const result = await transferClassFundsCallable(payload);
    return result?.data || { success: false };
  } catch (error) {
    console.error("[transferClassFunds] error:", error);
    return {
      success: false,
      message: error?.message || "기금 이체에 실패했습니다.",
    };
  }
};

export const payoutClassFund = async (payload = {}) => {
  try {
    const result = await payoutClassFundCallable(payload);
    return result?.data || { success: false };
  } catch (error) {
    console.error("[payoutClassFund] error:", error);
    return {
      success: false,
      message: error?.message || "기금 지급에 실패했습니다.",
    };
  }
};

export const archiveClassFund = async (payload = {}) => {
  try {
    const result = await archiveClassFundCallable(payload);
    return result?.data || { success: false };
  } catch (error) {
    console.error("[archiveClassFund] error:", error);
    return {
      success: false,
      message: error?.message || "기금 삭제에 실패했습니다.",
    };
  }
};

export const updateClassFundOperators = async (payload = {}) => {
  try {
    const result = await updateClassFundOperatorsCallable(payload);
    return result.data;
  } catch (error) {
    console.error("[updateClassFundOperators] error:", error);
    return { success: false, message: error?.message || "담당자 저장에 실패했습니다." };
  }
};

export const updateClassFundPensionSettings = async (payload = {}) => {
  try {
    const result = await updateClassFundPensionSettingsCallable(payload);
    return result?.data || { success: false };
  } catch (error) {
    console.error("[updateClassFundPensionSettings] error:", error);
    return {
      success: false,
      message: error?.message || "연금 설정 저장에 실패했습니다.",
    };
  }
};

export const cancelClassFundUsage = async (payload = {}) => {
  try {
    const result = await cancelClassFundUsageCallable(payload);
    return result?.data || { success: false };
  } catch (error) {
    console.error("[cancelClassFundUsage] error:", error);
    return {
      success: false,
      message: error?.message || "기금 거래 취소에 실패했습니다.",
    };
  }
};
