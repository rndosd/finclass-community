import { getFunctions, httpsCallable } from "firebase/functions";
import { getApp } from "firebase/app";
import { DEFAULT_MISSION_TOKEN_LABEL } from "../../../utils/missionTokenLabel";

const functions = getFunctions(getApp(), "asia-northeast3");
const adjustStudentAssets = httpsCallable(functions, "adjustStudentAssets");

const getAdjustTypeLabel = (adjustType) => {
  if (adjustType === "usdBalance") return "외화(FIN)";
  if (adjustType === "credit") return "신용점수";
  if (adjustType === "missionToken") return DEFAULT_MISSION_TOKEN_LABEL;
  return "자산";
};

/**
 * 교사가 학생 자산/신용/미션토큰을 조정하는 Cloud Function 호출
 * payload:
 *  - increment(common): { classId, mode: "increment", adjustType, studentUids, amount, reason, type }
 *  - increment(per-student): { classId, mode: "increment", adjustType, increments: [{ uid, amount, reason }] }
 *  - absolute : { classId, mode: "absolute", adjustType, adjustments: [{ uid, amount, reason }] }
 */
export const adjustStudentAssetsService = async (payload) => {
  if (!payload?.classId || !payload?.mode) {
    throw new Error("학급 정보 또는 조정 모드가 누락되었습니다.");
  }

  const typeLabel = getAdjustTypeLabel(payload.adjustType);
  console.log(`[Service] ${typeLabel} 조정 요청 시작...`, payload);

  try {
    const result = await adjustStudentAssets(payload);
    if (result.data && result.data.success === false) {
      throw new Error(result.data.message || "처리에 실패했습니다.");
    }
    return result.data;
  } catch (error) {
    console.error(`${typeLabel} 조정 중 서비스 오류:`, error);
    const serviceError = new Error(error?.message || "서버 통신 중 오류가 발생했습니다.");
    serviceError.code = error?.code;
    serviceError.details = error?.details;
    throw serviceError;
  }
};
