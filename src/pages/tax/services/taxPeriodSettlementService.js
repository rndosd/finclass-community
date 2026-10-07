import { getFunctions, httpsCallable } from "firebase/functions";
import { getCallableErrorMessage } from "./callableErrorMessage";

const functions = getFunctions(undefined, "asia-northeast3");

const previewCallable = httpsCallable(functions, "previewTaxPeriodSettlement");
const finalizeCallable = httpsCallable(functions, "finalizeTaxPeriodSettlement");
const historyCallable = httpsCallable(
  functions,
  "getTaxPeriodSettlementHistory",
);

const call = async (callable, payload, fallbackMessage) => {
  try {
    const result = await callable(payload);
    return { success: true, ...(result?.data || {}) };
  } catch (error) {
    console.error(fallbackMessage, error);
    return {
      success: false,
      message: getCallableErrorMessage(error, fallbackMessage),
    };
  }
};

export const previewTaxPeriodSettlement = ({
  classId,
  startDateKey,
  endDateKey,
}) =>
  call(
    previewCallable,
    { classId, startDateKey, endDateKey },
    "기간 세입 미리보기를 만들지 못했습니다.",
  );

export const finalizeTaxPeriodSettlement = ({
  classId,
  startDateKey,
  endDateKey,
}) =>
  call(
    finalizeCallable,
    { classId, startDateKey, endDateKey },
    "기간 세입을 확정하지 못했습니다.",
  );


export const getTaxPeriodSettlementHistory = ({ classId, limit = 30 }) =>
  call(
    historyCallable,
    { classId, limit },
    "기간 세입 정산 내역을 불러오지 못했습니다.",
  );
