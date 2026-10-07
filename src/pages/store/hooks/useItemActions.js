import { useState } from "react";
import { functions } from "../../../firebase";
import { httpsCallable } from "firebase/functions";
import { useFeedback } from "../../../contexts/FeedbackContext";

export const useItemActions = () => {
  const [loading, setLoading] = useState(false);
  const { showFeedback } = useFeedback();

  /**
   * 🎒 [사용] 아이템 사용하기 호출
   */
  const executeUseItem = async ({
    classId,
    itemId,
    quantity,
    note,
    targetStudentUid,
  }) => {
    setLoading(true);
    try {
      const callableName = targetStudentUid ? "adminUseItem" : "useItem";
      const callUseItem = httpsCallable(functions, callableName);
      const payload = {
        classId,
        itemId,
        quantity: Number(quantity),
        note,
        ...(targetStudentUid ? { targetStudentUid } : {}),
      };
      const result = await callUseItem(payload);

      return { success: true, data: result.data };
    } catch (error) {
      showFeedback(error?.message || "아이템 사용 처리 중 오류가 발생했습니다.", "error");
      return { success: false, error };
    } finally {
      setLoading(false);
    }
  };

  /**
   * 🎁 [선물] 아이템 선물하기 호출
   */
  const executeGiftItem = async ({
    classId,
    recipientUid,
    itemId,
    quantity,
    message,
  }) => {
    setLoading(true);
    try {
      // 🚀 여기도 마찬가지로 callGiftItem 등으로 변경하세요.
      const callGiftItem = httpsCallable(functions, "giftItem");
      const result = await callGiftItem({
        classId,
        recipientUid,
        itemId,
        quantity: Number(quantity),
        message,
      });

      return { success: true, data: result.data };
    } catch (error) {
      showFeedback(error?.message || "아이템 선물 중 오류가 발생했습니다.", "error");
      return { success: false, error };
    } finally {
      setLoading(false);
    }
  };

  const executeDeleteItem = async ({
    classId,
    targetStudentUid,
    itemId,
    quantity,
    reason,
  }) => {
    setLoading(true);
    try {
      if (!targetStudentUid) {
        throw new Error("삭제할 학생 정보가 없습니다.");
      }

      const callDeleteItem = httpsCallable(functions, "adminDeleteInventoryItem");
      const payload = {
        classId,
        itemId,
        quantity: Number(quantity),
        reason,
        targetStudentUid,
      };
      const result = await callDeleteItem(payload);

      return { success: true, data: result.data };
    } catch (error) {
      showFeedback(
        error?.message || "아이템 삭제 중 오류가 발생했습니다.",
        "error",
      );
      return { success: false, error };
    } finally {
      setLoading(false);
    }
  };

  return { executeUseItem, executeGiftItem, executeDeleteItem, loading };
};

export default useItemActions;
