import { confirmMissionAction } from "../../components/MissionActionDialog";
import { useCallback } from "react";
import { useMissionSaveActions } from "./useMissionSaveActions";
import { simulateRepeatingMissions } from "../../services/repeatMissionService";
import { hasRewardRange } from "../../utils/rewardUtils";

export function useMissionSubmit({
  mode = "create",
  classId,
  userData,
  showFeedback,
  form,
  onSuccess,
  onClose,
  mission = null,
}) {
  const isEdit = mode === "edit";

  const { createMission, editMission, createRepeating, isSaving } =
    useMissionSaveActions();

  const buildRewardItem = useCallback((type, minValue, maxValue, isRangeEnabled) => {
    const minAmount = Math.max(0, Number(minValue) || 0);
    const maxCandidate = Math.max(0, Number(maxValue) || 0);
    const maxAmount = isRangeEnabled ? maxCandidate : minAmount;

    if (isRangeEnabled && maxCandidate < minAmount) {
      throw new Error("범위 보상의 최대값은 최소값보다 작을 수 없습니다.");
    }

    if (minAmount <= 0 && maxAmount <= 0) return null;

    const isRange = isRangeEnabled && maxAmount !== minAmount;

    return {
      type,
      amount: isRange ? maxAmount : minAmount,
      minAmount,
      maxAmount: isRange ? maxAmount : minAmount,
      isRange,
    };
  }, []);

  const handleSubmit = useCallback(
    async (event) => {
      event?.preventDefault?.();

      if (isEdit && !mission?.id) {
        showFeedback("수정할 과제 정보를 불러오지 못했습니다.", "error");
        return;
      }

      const {
        title,
        description,
        creditReward,
        cashReward,
        missionTokenReward,
        creditRewardMax,
        cashRewardMax,
        missionTokenRewardMax,
        creditRewardRangeEnabled,
        cashRewardRangeEnabled,
        missionTokenRewardRangeEnabled,
        approvalPolicy,
        requireSubmissionForm,
        allowLateSubmission,
        targetType,
        selectedStudentUids,
        minimumCreditTierId,
        availableCreditTiers,
        repeatOn,
        repeatStartDate,
        repeatEndDate,
        repeatDays,
        repeatStartTime,
        repeatEndTime,
        repeatNoEndTime,
        repeatEndNextDay,
        startAt,
        dueAt,
        noDueDate,
        isActive,
        availabilityMode,
        availabilityDays,
        availabilityStartTime,
        availabilityEndTime,
        maxPerDay,
        availabilityStudentVisible,
        resetForm,
      } = form;

      if (!title.trim()) {
        return showFeedback("과제 제목을 입력해주세요.", "warning");
      }

      if (targetType === "selected" && selectedStudentUids.length === 0) {
        return showFeedback("대상 학생을 선택해주세요.", "warning");
      }

      const isAlways = availabilityMode !== "off";
      const rewards = [
        buildRewardItem(
          "credit",
          creditReward,
          creditRewardMax,
          creditRewardRangeEnabled,
        ),
        buildRewardItem(
          "currency",
          cashReward,
          cashRewardMax,
          cashRewardRangeEnabled,
        ),
        buildRewardItem(
          "missionToken",
          missionTokenReward,
          missionTokenRewardMax,
          missionTokenRewardRangeEnabled,
        ),
      ].filter(Boolean);

      const usesRangeReward = hasRewardRange(rewards);
      if (usesRangeReward && approvalPolicy !== "manual") {
        return showFeedback("범위 보상은 수동 승인 과제에서만 사용할 수 있습니다.", "warning");
      }

      const minimumCreditTier =
        availableCreditTiers.find((tier) => tier.id === minimumCreditTierId) || null;

      const base = {
        classId,
        title: title.trim(),
        description: description.trim(),
        rewards,
        autoApprove: approvalPolicy === "auto",
        requireSubmissionForm: !!requireSubmissionForm,
        ...(targetType === "selected" && {
          targetStudentUids: selectedStudentUids,
        }),
        ...(minimumCreditTier
          ? {
              minCreditTierId: minimumCreditTier.id,
              minCreditTierName: minimumCreditTier.name,
              minCreditTierColor: minimumCreditTier.color || "#64748b",
              minCreditTierMinScore: Number(minimumCreditTier.minScore || 0),
              minCreditTier: {
                id: minimumCreditTier.id,
                name: minimumCreditTier.name,
                color: minimumCreditTier.color || "#64748b",
                minScore: Number(minimumCreditTier.minScore || 0),
              },
            }
          : {}),
      };

      if (repeatOn && !isAlways) {
        if (!repeatStartDate) {
          return showFeedback("반복 시작 날짜를 선택해주세요.", "warning");
        }
        if (!repeatStartTime) {
          return showFeedback("반복 시작 시간을 입력해주세요.", "warning");
        }
        if (!repeatDays.length) {
          return showFeedback("반복 요일을 선택해주세요.", "warning");
        }

        const preview = simulateRepeatingMissions({
          startDate: repeatStartDate,
          endDate: repeatEndDate || null,
          days: repeatDays,
          dayBase: "sun0",
        });

        if (preview && preview.count > 365) {
          return showFeedback("생성될 과제가 너무 많습니다. 최대 365개까지만 허용됩니다.", "warning");
        }

        const ok = await confirmMissionAction(
          `${preview?.count || 0}개의 과제가 생성됩니다. 계속하시겠습니까?`,
        );
        if (!ok) return;

        try {
          const today = new Date().toISOString().slice(0, 10);
          const startDateObj = new Date(`${today}T${repeatStartTime}`);

          let endDateObj = null;
          if (!repeatNoEndTime && repeatEndTime) {
            endDateObj = new Date(`${today}T${repeatEndTime}`);
            if (repeatEndNextDay) {
              endDateObj.setDate(endDateObj.getDate() + 1);
            }
          }

          const missionTemplate = {
            ...base,
            createdBy: userData?.uid,
            createdByName: userData?.name,
            type: "single",
            timeWindow: {
              start: startDateObj,
              end: endDateObj || null,
            },
            ...(endDateObj ? { allowLateSubmission: !!allowLateSubmission } : {}),
          };

          await createRepeating({
            classId,
            missionTemplate,
            repeatConfig: {
              startDate: repeatStartDate,
              endDate: repeatEndDate || null,
              days: repeatDays,
              dayBase: "sun0",
            },
          });

          resetForm();
          onSuccess?.();
          onClose();
        } catch (error) {
          showFeedback(error?.message || "과제 생성 중 오류가 발생했습니다.", "error");
        }

        return;
      }

      try {
        const final = { ...base };

        if (isAlways) {
          final.type = "always";
          final.displayOrder =
            Number(mission?.displayOrder) || Date.now();
          final.isActive = isActive;
          final.availability = {
            daysOfWeek:
              availabilityDays?.length > 0 ? availabilityDays : [1, 2, 3, 4, 5],
            startTime: availabilityStartTime || "09:00",
            endTime: availabilityEndTime || "18:00",
            maxPerDay: maxPerDay ?? 1,
            studentVisible:
              typeof availabilityStudentVisible === "boolean"
                ? availabilityStudentVisible
                : true,
          };
        } else {
          final.type = "single";
          const startDateObj = new Date(startAt);
          let endDateObj = null;

          if (!noDueDate && dueAt) {
            endDateObj = new Date(dueAt);
          }

          final.timeWindow = {
            start: startDateObj,
            end: endDateObj || null,
          };
          if (endDateObj) {
            final.allowLateSubmission = !!allowLateSubmission;
          }
        }

        if (!isEdit) {
          await createMission({
            ...final,
            createdBy: userData?.uid,
            createdByName: userData?.name,
          });
          resetForm();
        } else {
          const patch = {
            title: final.title,
            description: final.description,
            rewards: final.rewards,
            autoApprove: final.autoApprove,
            requireSubmissionForm: final.requireSubmissionForm,
            type: final.type,
            ...(final.type === "single" && final.timeWindow?.end
              ? { allowLateSubmission: !!final.allowLateSubmission }
              : {}),
            minCreditTierId: minimumCreditTier ? minimumCreditTier.id : null,
            minCreditTierName: minimumCreditTier ? minimumCreditTier.name : null,
            minCreditTierColor: minimumCreditTier
              ? minimumCreditTier.color || "#64748b"
              : null,
            minCreditTierMinScore: minimumCreditTier
              ? Number(minimumCreditTier.minScore || 0)
              : null,
            minCreditTier: minimumCreditTier
              ? {
                  id: minimumCreditTier.id,
                  name: minimumCreditTier.name,
                  color: minimumCreditTier.color || "#64748b",
                  minScore: Number(minimumCreditTier.minScore || 0),
                }
              : null,
          };

          if (targetType === "selected") {
            patch.targetStudentUids = selectedStudentUids;
          }

          if (final.type === "always") {
            patch.isActive = final.isActive;
            patch.availability = final.availability;
          } else {
            patch.timeWindow = final.timeWindow;
          }

          await editMission({
            classId,
            missionId: mission.id,
            patch,
            opts: {
              removeAllowLateSubmission:
                final.type !== "single" || !final.timeWindow?.end,
              removeTargetStudentUids: targetType !== "selected",
              removeMinCreditTier: !minimumCreditTier,
            },
          });
        }

        onSuccess?.();
        onClose();
      } catch (error) {
        showFeedback(error?.message || "과제 저장 중 오류가 발생했습니다.", "error");
      }
    },
    [
      isEdit,
      mission?.id,
      mission?.displayOrder,
      classId,
      userData,
      form,
      showFeedback,
      onSuccess,
      onClose,
      createMission,
      editMission,
      createRepeating,
      buildRewardItem,
    ],
  );

  return {
    handleSubmit,
    isSaving,
  };
}

export default useMissionSubmit;
