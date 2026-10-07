import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../../firebase";

const MARKETPLACE_DEFAULT_FEE_RATE = 5;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const toNumber = (v, fallback = 0) => {
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
};

export default function useMarketplaceFeeSettings({
  classId,
  userData,
  isMarketplaceAdmin,
  showFeedback,
  enabled = true,
}) {
  const [marketFeeRate, setMarketFeeRate] = useState(
    MARKETPLACE_DEFAULT_FEE_RATE
  );
  const [marketFeeEnabled, setMarketFeeEnabled] = useState(true);
  const [isSavingMarketFeeSettings, setIsSavingMarketFeeSettings] =
    useState(false);

  useEffect(() => {
    if (!enabled || !classId) return undefined;

    const settingsRef = doc(
      db,
      "classes",
      classId,
      "marketplace_settings",
      "seller_fee"
    );

    const unsub = onSnapshot(
      settingsRef,
      async (snap) => {
        if (!snap.exists()) {
          try {
            await setDoc(
              settingsRef,
              {
                sellerFeeRate: MARKETPLACE_DEFAULT_FEE_RATE,
                feeEnabled: true,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          } catch (error) {
            // Ignore permission failures; UI falls back to local defaults.
          }
          setMarketFeeRate(MARKETPLACE_DEFAULT_FEE_RATE);
          setMarketFeeEnabled(true);
          return;
        }

        const data = snap.data() || {};
        const rate =
          typeof data.sellerFeeRate === "number"
            ? data.sellerFeeRate
            : MARKETPLACE_DEFAULT_FEE_RATE;
        const enabled =
          typeof data.feeEnabled === "boolean" ? data.feeEnabled : true;

        setMarketFeeRate(rate);
        setMarketFeeEnabled(enabled);
      },
      () => {
        setMarketFeeRate(MARKETPLACE_DEFAULT_FEE_RATE);
        setMarketFeeEnabled(true);
      }
    );

    return () => unsub();
  }, [classId, enabled]);

  const handleSaveMarketFeeSettings = useCallback(async () => {
    if (!classId) return;

    if (!isMarketplaceAdmin) {
      showFeedback("수수료 설정 권한이 없습니다.", "error");
      return;
    }

    const clamped = clamp(toNumber(marketFeeRate, 0), 0, 100);

    setIsSavingMarketFeeSettings(true);
    try {
      const settingsRef = doc(
        db,
        "classes",
        classId,
        "marketplace_settings",
        "seller_fee"
      );

      await setDoc(
        settingsRef,
        {
          sellerFeeRate: clamped,
          feeEnabled: !!marketFeeEnabled,
          updatedAt: serverTimestamp(),
          updatedBy: {
            uid: userData?.uid || null,
            name: userData?.displayName || userData?.name || null,
          },
        },
        { merge: true }
      );

      showFeedback("중고거래 판매 수수료 설정이 저장되었습니다.", "success");
    } catch (error) {
      console.error("Save marketplace fee settings error:", error);
      showFeedback("중고거래 판매 수수료 저장 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSavingMarketFeeSettings(false);
    }
  }, [
    classId,
    isMarketplaceAdmin,
    marketFeeRate,
    marketFeeEnabled,
    userData?.uid,
    userData?.displayName,
    userData?.name,
    showFeedback,
  ]);

  return {
    marketFeeRate,
    setMarketFeeRate,
    marketFeeEnabled,
    setMarketFeeEnabled,
    isSavingMarketFeeSettings,
    handleSaveMarketFeeSettings,
  };
}
