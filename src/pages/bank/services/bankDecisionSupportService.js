import { getFunctions, httpsCallable } from "firebase/functions";

const FUNCTIONS_REGION = "asia-northeast3";

const callDecisionSupportFunction = async (functionName, payload) => {
  const functions = getFunctions(undefined, FUNCTIONS_REGION);
  const callable = httpsCallable(functions, functionName);
  const response = await callable(payload);
  return response?.data || {};
};

export const getBankDepositDecisionContext = ({ classId, forceRefresh = false }) =>
  callDecisionSupportFunction("getBankDepositDecisionContext", {
    classId,
    forceRefresh,
  });

export const previewBankDepositProductDecision = ({
  classId,
  candidate,
  forceRefresh = false,
}) =>
  callDecisionSupportFunction("previewBankDepositProductDecision", {
    classId,
    candidate,
    forceRefresh,
  });
