import { confirmMissionAction } from "../../components/MissionActionDialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteMission, updateMission } from "../../services/missionService";
import { useUser } from "../../../../contexts/UserContext";
import { useFeedback } from "../../../../contexts/FeedbackContext";

export function useMissionMutations() {
    const qc = useQueryClient();
    const { classId: ctxClassId } = useUser();
    const { showFeedback } = useFeedback();

    const invalidateMissions = async (classId) => {
        if (!classId) return;
        await qc.invalidateQueries({ queryKey: ["classMissions", classId] });
    };

    // ✅ delete mutation: "조용히 삭제만" 수행 (토스트/인밸리데이트 없음)
    const deleteMissionMut = useMutation({
        mutationFn: async ({ classId, missionId }) => {
            if (!classId || !missionId) throw new Error("classId/missionId가 없습니다.");
            return deleteMission(classId, missionId);
        },
    });

    // update는 단일이라 지금 구조 유지해도 괜찮지만, 원칙적으로는 호출부에서 토스트/인밸리데이트 하는게 더 깔끔
    const updateMissionMut = useMutation({
        mutationFn: async ({ classId, missionId, patch, opts }) => {
            if (!classId || !missionId) throw new Error("classId/missionId가 없습니다.");
            return updateMission(classId, missionId, patch || {}, opts || {});
        },
        onSuccess: async (_res, vars) => {
            showFeedback?.("변경사항이 저장되었습니다.", "success");
            await invalidateMissions(vars.classId);
        },
        onError: (err) => {
            showFeedback?.(err?.message || "저장 중 오류가 발생했습니다.", "error");
        },
    });

    const resolveIds = (missionOrId) => {
        const missionId =
            typeof missionOrId === "string" ? missionOrId : missionOrId?.id;
        const classId =
            ctxClassId || (typeof missionOrId === "object" ? missionOrId?.classId : null);
        return { classId, missionId };
    };

    // ✅ 단일 삭제: confirm 1번 + 삭제 1번 + invalidate 1번 + 토스트 1번
    const deleteOneWithConfirm = async (missionOrId) => {
        const { classId, missionId } = resolveIds(missionOrId);

        if (!classId || !missionId) {
            showFeedback?.("클래스/과제 정보를 찾을 수 없습니다.", "error");
            return false;
        }

        const ok = await confirmMissionAction(
            typeof missionOrId === "object" ? `"${missionOrId.title || "선택한 과제"}" 과제를 삭제할까요?` : "선택한 과제를 삭제할까요?",
        );
        if (!ok) return false;

        try {
            await deleteMissionMut.mutateAsync({ classId, missionId });
            await invalidateMissions(classId);
            showFeedback?.("과제가 삭제되었습니다.", "success");
            return true;
        } catch (err) {
            showFeedback?.(err?.message || "과제 삭제 중 오류가 발생했습니다.", "error");
            return false;
        }
    };

    /**
     * ✅ 일괄 삭제(조용히):
     * - confirm 없음
     * - 토스트 없음
     * - invalidate는 호출자가 1번만 하도록 분리
     * - progress 콜백으로 (done/total) 제공 가능
     */
    const deleteManySilent = async (missionIds = [], opts = {}) => {
        const classId = ctxClassId;
        if (!classId) throw new Error("classId가 없습니다.");
        if (!Array.isArray(missionIds) || missionIds.length === 0) return { ok: 0, fail: 0, failedIds: [] };

        const total = missionIds.length;
        let done = 0;

        const results = await Promise.allSettled(
            missionIds.map(async (missionId) => {
                await deleteMissionMut.mutateAsync({ classId, missionId });
                done += 1;
                opts?.onProgress?.(done, total);
            }),
        );

        const failedIds = [];
        results.forEach((r, idx) => {
            if (r.status === "rejected") failedIds.push(missionIds[idx]);
        });

        return {
            ok: total - failedIds.length,
            fail: failedIds.length,
            failedIds,
        };
    };

    // 상시 studentVisible 토글 (유지)
    const requestToggleAlwaysStudentVisible = async (mission, newValue) => {
        const classId = mission?.classId || ctxClassId;
        const missionId = mission?.id;
        if (!classId || !missionId) {
            showFeedback?.("클래스/과제 정보를 찾을 수 없습니다.", "error");
            return;
        }
        if (mission?.type !== "always") return;

        const patch = {
            availability: {
                ...(mission.availability || {}),
                studentVisible: newValue,
            },
        };

        await updateMissionMut.mutateAsync({ classId, missionId, patch });
    };

    return {
        // mutations
        deleteMissionMut,
        updateMissionMut,

        // invalidate (외부에서 batch 끝나고 1번만)
        invalidateMissions,

        // helpers
        requestDeleteMission: deleteOneWithConfirm,
        deleteOneWithConfirm,
        deleteManySilent,
        requestToggleAlwaysStudentVisible,
    };
}

export default useMissionMutations;
