import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { convertMissionTokenToCredit } from "../services/missionEconomyService";

export function useMissionTokenConversion(classId) {
  const queryClient = useQueryClient();
  const { showFeedback } = useFeedback();
  const { userData, missionTokenLabel } = useUser();
  const uid = userData?.uid || null;

  const [isSubmitting, setIsSubmitting] = useState(false);

  const convert = useCallback(
    async (amount) => {
      if (!classId) {
        const message = "학급 정보가 없어 전환할 수 없습니다.";
        showFeedback?.(message, "error");
        return { success: false, message };
      }

      setIsSubmitting(true);

      try {
        const result = await convertMissionTokenToCredit(classId, amount);
        if (uid) {
          queryClient.invalidateQueries({ queryKey: ["userProfile", classId, uid] });
        }
        showFeedback?.(
          result.message || `${missionTokenLabel}을 신용점수로 전환했습니다.`,
          "success",
        );
        return result;
      } catch (error) {
        const message =
          error?.message || `${missionTokenLabel} 전환 중 오류가 발생했습니다.`;
        showFeedback?.(message, "error");
        return { success: false, message };
      } finally {
        setIsSubmitting(false);
      }
    },
    [classId, missionTokenLabel, queryClient, showFeedback, uid],
  );

  return {
    convertMissionToken: convert,
    isSubmitting,
  };
}

export default useMissionTokenConversion;
