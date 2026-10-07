import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { db } from "../../../firebase";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { getPolicePath } from "../utils/policePathUtils";
import {
  updatePoliceReason as updatePoliceReasonRequest,
  updatePoliceSensitivity as updatePoliceSensitivityRequest,
} from "../utils/policeUtils";

const toSafeOrder = (value, fallback) => {
  const order = Number(value);
  return Number.isFinite(order) ? order : fallback;
};

export const usePoliceMutations = (classId) => {
  const queryClient = useQueryClient();
  const { showFeedback } = useFeedback();

  const deleteRulesWithReorder = async (ruleIds = []) => {
    if (!classId) throw new Error("반 정보를 찾을 수 없습니다.");

    const normalizedRuleIds = [...new Set((ruleIds || []).filter(Boolean))];
    if (normalizedRuleIds.length === 0) {
      throw new Error("삭제할 규칙을 선택해주세요.");
    }

    const rulesPath = getPolicePath("policeRulesCollection", classId);
    if (!rulesPath) throw new Error("규칙 경로를 찾을 수 없습니다.");

    const snapshot = await getDocs(collection(db, rulesPath));
    const selectedIdSet = new Set(normalizedRuleIds);
    const orderedRules = snapshot.docs
      .map((docSnap, index) => ({
        id: docSnap.id,
        order: toSafeOrder(docSnap.data()?.order, index + 1),
      }))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

    const deletableRules = orderedRules.filter((rule) => selectedIdSet.has(rule.id));
    if (deletableRules.length === 0) {
      throw new Error("삭제할 규칙을 찾지 못했습니다.");
    }

    const batch = writeBatch(db);

    deletableRules.forEach((rule) => {
      batch.delete(doc(db, rulesPath, rule.id));
    });

    orderedRules
      .filter((rule) => !selectedIdSet.has(rule.id))
      .forEach((rule, index) => {
        const nextOrder = index + 1;
        if (rule.order === nextOrder) return;

        batch.update(doc(db, rulesPath, rule.id), {
          order: nextOrder,
          updatedAt: serverTimestamp(),
        });
      });

    await batch.commit();
    return { count: deletableRules.length };
  };

  const updateSettingsMutation = useMutation({
    mutationFn: async (payload = {}) => {
      if (!classId) throw new Error("반 정보를 찾을 수 없습니다.");

      const nextSettings =
        payload && typeof payload === "object" && payload.settings
          ? payload.settings
          : payload;
      const settingsRef = doc(db, `classes/${classId}/policeSettings/config`);
      await setDoc(
        settingsRef,
        {
          ...nextSettings,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    },
    onSuccess: () => {
      showFeedback("공개 설정을 저장했습니다.", "success");
      queryClient.invalidateQueries({ queryKey: ["policeSettings", classId] });
    },
    onError: (error) => {
      console.error("공개 설정 저장 오류:", error);
      showFeedback("설정 저장 중 오류가 발생했습니다.", "error");
    },
  });

  const deleteRulesMutation = useMutation({
    mutationFn: async ({ ruleIds = [] }) => deleteRulesWithReorder(ruleIds),
    onSuccess: (result) => {
      const deletedCount = Number(result?.count || 0);
      showFeedback(
        deletedCount > 1
          ? `${deletedCount}개의 규칙을 삭제했습니다.`
          : "규칙을 삭제했습니다.",
        "success",
      );
      queryClient.invalidateQueries({ queryKey: ["policeRules", classId] });
    },
    onError: (error) => {
      console.error("규칙 삭제 오류:", error);
      showFeedback(`삭제 실패: ${error.message}`, "error");
    },
  });

  const reorderRulesMutation = useMutation({
    mutationFn: async (orderUpdates = []) => {
      if (!classId) throw new Error("반 정보를 찾을 수 없습니다.");
      if (!Array.isArray(orderUpdates) || orderUpdates.length === 0) return;

      const rulesPath = getPolicePath("policeRulesCollection", classId);
      if (!rulesPath) throw new Error("규칙 경로를 찾을 수 없습니다.");

      const batch = writeBatch(db);

      orderUpdates.forEach(({ id, order }) => {
        if (!id || typeof order !== "number") return;
        batch.update(doc(db, rulesPath, id), {
          order,
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policeRules", classId] });
    },
    onError: (error) => {
      console.error("규칙 순서 변경 오류:", error);
      showFeedback(`순서 변경 저장 실패: ${error.message}`, "error");
    },
  });

  const updateReasonMutation = useMutation({
    mutationFn: async ({ targetType, recordId, reason }) => {
      if (!classId) throw new Error("학급 정보가 없습니다.");

      const result = await updatePoliceReasonRequest({
        classId,
        targetType,
        recordId,
        reason,
      });

      if (!result?.success) {
        throw new Error(result?.message || "사유를 수정하지 못했습니다.");
      }

      return result;
    },
    onSuccess: () => {
      showFeedback("사유를 수정했습니다.", "success");
      queryClient.invalidateQueries({ queryKey: ["policeReports", classId] });
      queryClient.invalidateQueries({
        queryKey: ["policeFineHistory", classId],
        exact: false,
      });
    },
    onError: (error) => {
      console.error("경찰 사유 수정 실패:", error);
      showFeedback(
        `사유 수정 실패: ${error.message || "다시 시도해 주세요."}`,
        "error",
      );
    },
  });

  const updateSensitivityMutation = useMutation({
    mutationFn: async ({ targetType, recordIds = [], isSensitive }) => {
      if (!classId) throw new Error("학급 정보가 없습니다.");

      const normalizedIds = Array.isArray(recordIds)
        ? [...new Set(recordIds.map((id) => String(id || "").trim()).filter(Boolean))]
        : [];

      if (normalizedIds.length === 0) {
        throw new Error("선택한 항목이 없습니다.");
      }

      const result = await updatePoliceSensitivityRequest({
        classId,
        targetType,
        recordIds: normalizedIds,
        isSensitive,
      });

      if (!result?.success) {
        throw new Error(result?.message || "민감 설정을 수정하지 못했습니다.");
      }

      return result;
    },
    onSuccess: (result, variables) => {
      const count = Number(variables?.recordIds?.length || 0);
      const actionLabel = variables?.isSensitive ? "민감 지정" : "민감 해제";
      showFeedback(
        count > 1
          ? `${count}건을 ${actionLabel}했습니다.`
          : `${actionLabel}했습니다.`,
        "success",
      );
      queryClient.invalidateQueries({ queryKey: ["policeReports", classId] });
      queryClient.invalidateQueries({
        queryKey: ["policeFineHistory", classId],
        exact: false,
      });
    },
    onError: (error) => {
      console.error("경찰 민감 설정 수정 실패:", error);
      showFeedback(
        `민감 설정 수정 실패: ${error.message || "다시 시도해 주세요."}`,
        "error",
      );
    },
  });

  return {
    updateSettings: updateSettingsMutation.mutateAsync,
    isUpdatingSettings: updateSettingsMutation.isPending,
    deleteRule: ({ ruleId }) => deleteRulesMutation.mutate({ ruleIds: [ruleId] }),
    deleteRules: (ruleIds = []) => deleteRulesMutation.mutateAsync({ ruleIds }),
    isDeleting: deleteRulesMutation.isPending,
    reorderRules: reorderRulesMutation.mutateAsync,
    isReordering: reorderRulesMutation.isPending,
    updateReason: updateReasonMutation.mutateAsync,
    isUpdatingReason: updateReasonMutation.isPending,
    updateSensitivity: updateSensitivityMutation.mutateAsync,
    isUpdatingSensitivity: updateSensitivityMutation.isPending,
  };
};
