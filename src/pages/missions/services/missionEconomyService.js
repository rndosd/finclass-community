import { httpsCallable } from "firebase/functions";

import { functions } from "../../../firebase";
import { DEFAULT_MISSION_TOKEN_LABEL } from "../../../utils/missionTokenLabel";

const updateMissionTokenCreditConfigFn = httpsCallable(
  functions,
  "updateMissionTokenCreditConfig",
);
const convertMissionTokenToCreditFn = httpsCallable(
  functions,
  "convertMissionTokenToCredit",
);

function normalizeFunctionsError(error, fallbackMessage) {
  const rawCode = error?.code || "";
  const code = rawCode.startsWith("functions/")
    ? rawCode.replace("functions/", "")
    : rawCode || "unknown";
  const detailMessage =
    typeof error?.details === "string"
      ? error.details
      : error?.details?.message || error?.message;

  const nextError = new Error(
    detailMessage || fallbackMessage || "요청 처리 중 오류가 발생했습니다.",
  );
  nextError.code = code;
  nextError.raw = error;
  return nextError;
}

export async function updateMissionTokenCreditConfig(classId, payload = {}) {
  try {
    const result = await updateMissionTokenCreditConfigFn({
      classId,
      ...payload,
    });

    return {
      success: true,
      data: result?.data || {},
      message: result?.data?.message || "설정을 저장했습니다.",
    };
  } catch (error) {
    throw normalizeFunctionsError(
      error,
      `${DEFAULT_MISSION_TOKEN_LABEL} 전환 설정 저장 중 오류가 발생했습니다.`,
    );
  }
}

export async function convertMissionTokenToCredit(classId, amount) {
  try {
    const result = await convertMissionTokenToCreditFn({
      classId,
      amount,
    });

    return {
      success: true,
      data: result?.data || {},
      message:
        result?.data?.message ||
        `${DEFAULT_MISSION_TOKEN_LABEL}을 신용점수로 전환했습니다.`,
    };
  } catch (error) {
    throw normalizeFunctionsError(
      error,
      `${DEFAULT_MISSION_TOKEN_LABEL} 전환 중 오류가 발생했습니다.`,
    );
  }
}
