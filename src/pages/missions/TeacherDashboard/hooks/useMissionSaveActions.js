import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "../../../../contexts/UserContext";
import { useFeedback } from "../../../../contexts/FeedbackContext";

import { addMission, updateMission } from "../../services/missionService";
import { createRepeatingMissions } from "../../services/repeatMissionService";

/**
 * ✅ Mission save actions (Teacher)
 * - create(single/always)
 * - edit
 * - createRepeating
 * 모두 mutation + invalidate 로 통일
 */
export function useMissionSaveActions() {
    const qc = useQueryClient();
    const { classId: ctxClassId } = useUser();
    const { showFeedback } = useFeedback();

    const invalidateMissions = async (classId) => {
        if (!classId) return;
        await qc.invalidateQueries({ queryKey: ["classMissions", classId] });
    };

    /**
     * ✅ create: single/always 공통
     * missionData는 이미 form에서 구성된 최종 데이터라고 가정
     */
    const createMissionMut = useMutation({
        mutationFn: async ({ missionData }) => {
            const classId = missionData?.classId || ctxClassId;
            if (!classId) throw new Error("classId가 없습니다.");

            // addMission은 missionData.classId 필요
            return addMission({ ...missionData, classId });
        },
        onSuccess: async (res, vars) => {
            showFeedback?.(res?.message || "과제가 등록되었습니다.", "success");
            await invalidateMissions(vars?.missionData?.classId || ctxClassId);
        },
        onError: (err) => {
            showFeedback?.(err?.message || "과제 등록 중 오류가 발생했습니다.", "error");
        },
    });

    /**
     * ✅ edit: patch를 얇게 만들어 updateMission으로 전달
     * - updateMission은 (classId, missionId, patch, opts)
     */
    const editMissionMut = useMutation({
        mutationFn: async ({ classId, missionId, patch, opts }) => {
            if (!classId) throw new Error("classId가 없습니다.");
            if (!missionId) throw new Error("missionId가 없습니다.");
            if (!patch || typeof patch !== "object") throw new Error("patch가 없습니다.");

            return updateMission(classId, missionId, patch, opts || {});
        },
        onSuccess: async (_res, vars) => {
            showFeedback?.("과제가 수정되었습니다.", "success");
            await invalidateMissions(vars.classId);
        },
        onError: (err) => {
            showFeedback?.(err?.message || "과제 수정 중 오류가 발생했습니다.", "error");
        },
    });

    /**
     * ✅ createRepeating: Cloud Function 호출
     */
    const createRepeatingMut = useMutation({
        mutationFn: async ({ classId, missionTemplate, repeatConfig }) => {
            if (!classId) throw new Error("classId가 없습니다.");
            if (!missionTemplate) throw new Error("missionTemplate이 없습니다.");
            if (!repeatConfig) throw new Error("repeatConfig가 없습니다.");

            return createRepeatingMissions({ classId, missionTemplate, repeatConfig });
        },
        onSuccess: async (res, vars) => {
            showFeedback?.(
                res?.message || `${res?.created ?? 0}개의 과제가 생성되었습니다.`,
                "success",
            );
            await invalidateMissions(vars.classId);
        },
        onError: (err) => {
            showFeedback?.(
                err?.message || "반복 과제 생성 중 오류가 발생했습니다.",
                "error",
            );
        },
    });

    // ─────────────────────────────────────────────
    // 편의 함수(컴포넌트/submit 훅에서 쓰기 쉽게)
    // ─────────────────────────────────────────────

    const createMission = async (missionData) =>
        createMissionMut.mutateAsync({ missionData });

    const editMission = async ({ classId, missionId, patch, opts }) =>
        editMissionMut.mutateAsync({ classId, missionId, patch, opts });

    const createRepeating = async ({ classId, missionTemplate, repeatConfig }) =>
        createRepeatingMut.mutateAsync({ classId, missionTemplate, repeatConfig });

    const isSaving =
        createMissionMut.isPending ||
        editMissionMut.isPending ||
        createRepeatingMut.isPending;

    return {
        // mutations
        createMissionMut,
        editMissionMut,
        createRepeatingMut,

        // actions
        createMission,
        editMission,
        createRepeating,

        // state
        isSaving,
    };
}

export default useMissionSaveActions;
