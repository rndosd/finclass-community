import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions(undefined, "asia-northeast3");
const bulkDeleteStudentLogsFunction = httpsCallable(
  functions,
  "bulkDeleteStudentLogs",
);

export const bulkDeleteStudentLogs = async ({
  classId,
  studentUid,
  creditLogIds = [],
  activityLogIds = [],
}) => {
  try {
    const result = await bulkDeleteStudentLogsFunction({
      classId,
      studentUid,
      creditLogIds,
      activityLogIds,
    });

    return {
      success: true,
      ...result.data,
    };
  } catch (error) {
    console.error("[bulkDeleteStudentLogs] Error:", error);
    return {
      success: false,
      message:
        error.message || "기록 삭제 중 오류가 발생했습니다. 다시 시도해 주세요.",
    };
  }
};
