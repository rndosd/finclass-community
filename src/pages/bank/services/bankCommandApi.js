import { getFunctions, httpsCallable } from "firebase/functions";

const FUNCTIONS_REGION = "asia-northeast3";

export const createBankClientRequestId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `rid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const callBankFunction = async (functionName, payload) => {
  const functions = getFunctions(undefined, FUNCTIONS_REGION);
  const callable = httpsCallable(functions, functionName);
  const response = await callable(payload);
  return response?.data || {};
};

export const bankCommandApi = {
  transferMoney(payload) {
    return callBankFunction("transferMoney", payload);
  },
  applyDeposit(payload) {
    return callBankFunction("applyDeposit", payload);
  },
  applyLoan(payload) {
    return callBankFunction("applyLoan", payload);
  },
  repayLoan(payload) {
    return callBankFunction("repayLoan", payload);
  },
  processSavingAction(payload) {
    return callBankFunction("processSavingAction", payload);
  },
};
