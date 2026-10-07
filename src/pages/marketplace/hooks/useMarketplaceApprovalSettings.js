import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "../../../firebase";

export default function useMarketplaceApprovalSettings({
  classId,
  userData,
  isMarketplaceAdmin,
  showFeedback,
}) {
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(false);
  const [isSavingAutoApprove, setIsSavingAutoApprove] = useState(false);

  useEffect(() => {
    if (!classId) {
      setAutoApproveEnabled(false);
      return undefined;
    }

    const settingsRef = doc(
      db,
      "classes",
      classId,
      "marketplace_settings",
      "approval",
    );

    return onSnapshot(
      settingsRef,
      (snapshot) => {
        setAutoApproveEnabled(
          snapshot.exists() && snapshot.data()?.autoApproveEnabled === true,
        );
      },
      (error) => {
        console.error("[marketplace approval settings] snapshot error:", error);
        setAutoApproveEnabled(false);
      },
    );
  }, [classId]);

  const updateAutoApprove = useCallback(
    async (nextEnabled) => {
      if (!classId || isSavingAutoApprove) return;

      if (!isMarketplaceAdmin) {
        showFeedback("중고시장 승인 설정 권한이 없습니다.", "error");
        return;
      }

      const normalizedEnabled = Boolean(nextEnabled);
      setIsSavingAutoApprove(true);

      try {
        await setDoc(
          doc(
            db,
            "classes",
            classId,
            "marketplace_settings",
            "approval",
          ),
          {
            autoApproveEnabled: normalizedEnabled,
            updatedAt: serverTimestamp(),
            updatedBy: {
              uid: userData?.uid || null,
              name: userData?.displayName || userData?.name || null,
            },
          },
          { merge: true },
        );

        setAutoApproveEnabled(normalizedEnabled);
        showFeedback(
          normalizedEnabled
            ? "신규 중고거래와 경매가 자동 승인됩니다."
            : "신규 중고거래와 경매가 승인 대기로 등록됩니다.",
          "success",
        );
      } catch (error) {
        console.error("[marketplace approval settings] save error:", error);
        showFeedback("자동승인 설정 저장 중 오류가 발생했습니다.", "error");
      } finally {
        setIsSavingAutoApprove(false);
      }
    },
    [
      classId,
      isMarketplaceAdmin,
      isSavingAutoApprove,
      showFeedback,
      userData?.displayName,
      userData?.name,
      userData?.uid,
    ],
  );

  return {
    autoApproveEnabled,
    isSavingAutoApprove,
    updateAutoApprove,
  };
}
