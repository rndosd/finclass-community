import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  deleteField,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { sortMissionsBySelectedOrder } from "../utils/studentStatusMissions";

const DEFAULT_SETTINGS = {
  selectedMissionIds: [],
  dateFilter: { days: 7 },
  displayLimits: { desktop: 10, mobile: 5 },
};

const qk = (classId) => ["missionViewSettings", classId];

function normalizeSettings(raw) {
  const s = raw || {};
  return {
    selectedMissionIds: Array.isArray(s.selectedMissionIds)
      ? s.selectedMissionIds
      : [],
    dateFilter: s.dateFilter || { days: 7 },
    displayLimits: s.displayLimits || { desktop: 10, mobile: 5 },
  };
}

async function fetchSettings(classId) {
  // 1) 새 위치 우선
  const newRef = doc(db, `classes/${classId}/settings/missionViewSettings`);
  const snap = await getDoc(newRef);
  if (snap.exists()) return normalizeSettings(snap.data());

  // 2) 레거시 폴백: classes/{classId}.missionViewSettings
  const legacyRef = doc(db, `classes/${classId}`);
  const legacySnap = await getDoc(legacyRef);
  const legacy = legacySnap.exists()
    ? legacySnap.data()?.missionViewSettings
    : null;

  return legacy ? normalizeSettings(legacy) : { ...DEFAULT_SETTINGS };
}

async function saveSettings({ classId, uid, nextSettings }) {
  const ref = doc(db, `classes/${classId}/settings/missionViewSettings`);
  await setDoc(
    ref,
    {
      ...nextSettings,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    },
    { merge: true },
  );
  return nextSettings;
}

/**
 * ✅ React Query 버전
 * - settings: query data
 * - saving: mutation pending
 * - 기존 useMissionViewSettings가 제공하던 API를 최대한 동일하게 제공
 */
export const useMissionViewSettingsRQ = () => {
  const { classId, userData } = useUser();
  const { showFeedback } = useFeedback();
  const qc = useQueryClient();

  // --------------------------
  // Query
  // --------------------------
  const query = useQuery({
    queryKey: qk(classId),
    enabled: !!classId,
    queryFn: () => fetchSettings(classId),
    staleTime: 60_000,
    gcTime: Infinity,
    placeholderData: DEFAULT_SETTINGS, // 로딩 전에도 구조 보장
  });

  const settings = query.data || DEFAULT_SETTINGS;

  // --------------------------
  // Realtime sync
  // --------------------------
  useEffect(() => {
    if (!classId) return;

    const settingsRef = doc(db, `classes/${classId}/settings/missionViewSettings`);
    const legacyRef = doc(db, `classes/${classId}`);
    let active = true;

    const setSettings = (next) => {
      if (!active) return;
      qc.setQueryData(qk(classId), next);
    };

    const unsub = onSnapshot(
      settingsRef,
      async (snap) => {
        if (snap.exists()) {
          setSettings(normalizeSettings(snap.data()));
          return;
        }

        // Fallback for classes that still only have legacy field.
        try {
          const legacySnap = await getDoc(legacyRef);
          const legacy = legacySnap.exists()
            ? legacySnap.data()?.missionViewSettings
            : null;
          setSettings(legacy ? normalizeSettings(legacy) : { ...DEFAULT_SETTINGS });
        } catch (err) {
          console.error("[useMissionViewSettingsRQ] legacy fallback error:", err);
          setSettings({ ...DEFAULT_SETTINGS });
        }
      },
      (err) => {
        console.error("[useMissionViewSettingsRQ] snapshot error:", err);
      },
    );

    return () => {
      active = false;
      unsub();
    };
  }, [classId, qc]);

  // --------------------------
  // Mutation (save)
  // --------------------------
  const saveMut = useMutation({
    mutationFn: ({ nextSettings }) => {
      if (!classId || !userData?.uid) {
        const e = new Error("설정을 저장할 수 없습니다.");
        e.code = "invalid-argument";
        throw e;
      }
      return saveSettings({ classId, uid: userData.uid, nextSettings });
    },
    onMutate: async ({ nextSettings }) => {
      // Optimistic update
      await qc.cancelQueries({ queryKey: qk(classId) });
      const prev = qc.getQueryData(qk(classId));
      qc.setQueryData(qk(classId), nextSettings);
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk(classId), ctx.prev);
      showFeedback?.(err?.message || "설정 저장 중 오류가 발생했습니다.", "error");
    },
    onSuccess: (next) => {
      qc.setQueryData(qk(classId), next);
    },
  });

  const saveSettingsSafe = useCallback(
    async (nextSettings) => {
      try {
        await saveMut.mutateAsync({ nextSettings });
        return true;
      } catch {
        return false;
      }
    },
    [saveMut],
  );

  // --------------------------
  // 기존 API 호환 유틸들
  // --------------------------
  const toggleMissionSelection = useCallback(
    async (missionId, selected) => {
      if (!missionId) return;
      const setNext = new Set(settings.selectedMissionIds);
      if (selected) setNext.add(missionId);
      else setNext.delete(missionId);

      const nextSettings = {
        ...settings,
        selectedMissionIds: Array.from(setNext),
      };

      const ok = await saveSettingsSafe(nextSettings);
      if (ok) {
        showFeedback?.(
          selected
            ? "과제가 학생별 현황에 표시됩니다."
            : "과제가 학생별 현황에서 숨겨집니다.",
          "success",
        );
      }
    },
    [settings, saveSettingsSafe, showFeedback],
  );

  const toggleAllMissions = useCallback(
    async (allMissionIds, selectAll) => {
      const nextSettings = {
        ...settings,
        selectedMissionIds:
          Array.isArray(allMissionIds) && selectAll ? [...allMissionIds] : [],
      };

      const ok = await saveSettingsSafe(nextSettings);
      if (ok) {
        showFeedback?.(
          selectAll
            ? "모든 과제가 학생별 현황에 표시됩니다."
            : "모든 과제가 학생별 현황에서 숨겨집니다.",
          "success",
        );
      }
    },
    [settings, saveSettingsSafe, showFeedback],
  );

  const updateDateFilter = useCallback(
    async (days) => {
      const nextSettings = { ...settings, dateFilter: { days } };
      await saveSettingsSafe(nextSettings);
    },
    [settings, saveSettingsSafe],
  );

  const updateDisplayLimits = useCallback(
    async (desktop, mobile) => {
      const nextSettings = { ...settings, displayLimits: { desktop, mobile } };
      await saveSettingsSafe(nextSettings);
    },
    [settings, saveSettingsSafe],
  );

  const isMissionSelected = useCallback(
    (missionId) => settings.selectedMissionIds.includes(missionId),
    [settings.selectedMissionIds],
  );

  const getSelectedMissions = useCallback(
    (allMissions) => {
      if (!Array.isArray(allMissions)) return [];
      return sortMissionsBySelectedOrder(allMissions, settings.selectedMissionIds);
    },
    [settings.selectedMissionIds],
  );

  const pruneSelectedMissionIds = useCallback(
    async (validMissionIds = []) => {
      const validIds = new Set(
        Array.isArray(validMissionIds) ? validMissionIds.filter(Boolean) : [],
      );
      const nextSelectedIds = settings.selectedMissionIds.filter((id) =>
        validIds.has(id),
      );

      if (nextSelectedIds.length === settings.selectedMissionIds.length) {
        return false;
      }

      return saveSettingsSafe({
        ...settings,
        selectedMissionIds: nextSelectedIds,
      });
    },
    [saveSettingsSafe, settings],
  );

  const getDisplayMissions = useCallback(
    (selectedMissions, isMobile = false) => {
      const limit = isMobile
        ? settings.displayLimits.mobile
        : settings.displayLimits.desktop;
      return (selectedMissions || []).slice(0, limit);
    },
    [settings.displayLimits],
  );

  // (선택) 레거시 필드 정리 함수도 필요하면 제공 가능
  const clearLegacyField = useCallback(async () => {
    if (!classId) return false;
    try {
      const legacyRef = doc(db, `classes/${classId}`);
      await updateDoc(legacyRef, { missionViewSettings: deleteField() });
      return true;
    } catch (e) {
      console.error("레거시 필드 삭제 실패:", e);
      return false;
    }
  }, [classId]);

  return useMemo(
    () => ({
      settings,
      loading: query.isLoading,
      updating: saveMut.isPending,

      toggleMissionSelection,
      toggleAllMissions,
      updateDateFilter,
      updateDisplayLimits,

      isMissionSelected,
      getSelectedMissions,
      getDisplayMissions,
      pruneSelectedMissionIds,

      // 기존 훅의 refreshSettings에 대응
      refreshSettings: () => qc.invalidateQueries({ queryKey: qk(classId) }),

      // 필요하면 노출
      clearLegacyField,
    }),
    [
      settings,
      query.isLoading,
      saveMut.isPending,
      toggleMissionSelection,
      toggleAllMissions,
      updateDateFilter,
      updateDisplayLimits,
      isMissionSelected,
      getSelectedMissions,
      getDisplayMissions,
      pruneSelectedMissionIds,
      qc,
      classId,
      clearLegacyField,
    ],
  );
};

export default useMissionViewSettingsRQ;
