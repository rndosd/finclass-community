import { appConfirm } from "../../../utils/appDialogs";
import { createCardDraft } from "../utils/dashboardCardDraft";
import { useEffect, useState, useCallback } from "react";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { arrayMove } from "@dnd-kit/sortable";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  CARD_INFO,
} from "../constants/dashboardCards";
import { useFeedback } from "../../../contexts/FeedbackContext";

export const useDashboardSettings = (classId, { readOnly = false } = {}) => {
  const [settings, setSettings] = useState(DEFAULT_DASHBOARD_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showFeedback } = useFeedback();

  const getSettingsRef = useCallback(
    () => doc(db, `classes/${classId}/displaySettings/dashboard`),
    [classId],
  );

  useEffect(() => {
    if (!classId) {
      setLoading(false);
      return undefined;
    }

    if (readOnly) {
      let cancelled = false;

      const loadSettings = async () => {
        try {
          const docSnap = await getDoc(getSettingsRef());
          if (cancelled) return;

          if (docSnap.exists()) {
            const loadedSettings = docSnap.data();
            const finalSettings = {
              ...DEFAULT_DASHBOARD_SETTINGS,
              ...loadedSettings,
            };

            const allCardKeys = Object.keys(CARD_INFO);
            const currentOrder =
              loadedSettings.cardOrder || DEFAULT_DASHBOARD_SETTINGS.cardOrder;
            const newOrder = [...currentOrder];

            allCardKeys.forEach((key) => {
              if (!newOrder.includes(key)) newOrder.push(key);
            });
            finalSettings.cardOrder = newOrder.filter((key) =>
              allCardKeys.includes(key),
            );

            setSettings(finalSettings);
          } else {
            setSettings(DEFAULT_DASHBOARD_SETTINGS);
          }
          setLoading(false);
        } catch (error) {
          if (cancelled) return;
          console.error("\uB300\uC2DC\uBCF4\uB4DC \uC124\uC815 \uB85C\uB4DC \uC624\uB958:", error);
          setLoading(false);
        }
      };

      void loadSettings();

      return () => {
        cancelled = true;
      };
    }

    const unsubscribe = onSnapshot(
      getSettingsRef(),
      (docSnap) => {
        if (docSnap.exists()) {
          const loadedSettings = docSnap.data();
          const finalSettings = {
            ...DEFAULT_DASHBOARD_SETTINGS,
            ...loadedSettings,
          };

          const allCardKeys = Object.keys(CARD_INFO);
          const currentOrder =
            loadedSettings.cardOrder || DEFAULT_DASHBOARD_SETTINGS.cardOrder;
          const newOrder = [...currentOrder];

          allCardKeys.forEach((key) => {
            if (!newOrder.includes(key)) newOrder.push(key);
          });
          finalSettings.cardOrder = newOrder.filter((key) =>
            allCardKeys.includes(key),
          );

          setSettings(finalSettings);
        } else {
          setSettings(DEFAULT_DASHBOARD_SETTINGS);
        }
        setLoading(false);
      },
      (error) => {
        console.error("설정 로드 실패:", error);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [classId, getSettingsRef, readOnly]);

  const saveSettings = useCallback(
    async (newSettings) => {
      if (!classId || readOnly) return false;
      setSaving(true);
      try {
        await setDoc(getSettingsRef(), newSettings, { merge: true });
        return true;
      } catch (error) {
        showFeedback("설정 저장 실패", "error");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [classId, readOnly, showFeedback, getSettingsRef],
  );

  const applyCardSettings = useCallback(async draft => {
    const patch = createCardDraft(draft);
    const success = await saveSettings(patch);
    if (success) setSettings(previous => ({ ...previous, ...patch }));
    return success;
  }, [saveSettings]);

  const handleToggle = useCallback(
    (cardKey, checked) => {
      if (readOnly) return;
      const settingKey = `show${cardKey.charAt(0).toUpperCase() + cardKey.slice(1)}Card`;
      setSettings((prev) => {
        const newSettings = { ...prev, [settingKey]: checked };
        saveSettings(newSettings);
        return newSettings;
      });
    },
    [readOnly, saveSettings],
  );

  const handleDragEnd = useCallback(
    (event) => {
      if (readOnly) return;
      const { active, over } = event;
      if (active && over && active.id !== over.id) {
        setSettings((prev) => {
          const oldIndex = prev.cardOrder.indexOf(active.id);
          const newIndex = prev.cardOrder.indexOf(over.id);
          const newOrder = arrayMove([...prev.cardOrder], oldIndex, newIndex);
          const newSettings = { ...prev, cardOrder: newOrder };
          saveSettings(newSettings);
          return newSettings;
        });
      }
    },
    [readOnly, saveSettings],
  );

  const resetToDefault = useCallback(async () => {
    if (readOnly || !(await appConfirm("기본값으로 되돌릴까요?"))) return;
    saveSettings(DEFAULT_DASHBOARD_SETTINGS);
    showFeedback("초기화 완료", "success");
  }, [readOnly, saveSettings, showFeedback]);

  // ✨ [추가됨] 현재 설정에 따라 보여질 카드 목록만 반환하는 함수
  const getVisibleCards = useCallback(() => {
    if (!settings || !settings.cardOrder) return [];
    return settings.cardOrder.filter((cardKey) => {
      const settingKey = `show${cardKey.charAt(0).toUpperCase() + cardKey.slice(1)}Card`;
      return settings[settingKey] === true;
    });
  }, [settings]);

  return {
    settings,
    loading,
    saving,
    handleToggle,
    handleDragEnd,
    resetToDefault,
    applyCardSettings,
    getVisibleCards, // ✨ [필수] 외부로 내보내야 대시보드에서 쓸 수 있습니다.
  };
};
