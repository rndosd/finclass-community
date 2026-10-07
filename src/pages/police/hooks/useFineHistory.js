import { appConfirm } from "../../../utils/appDialogs";
import { useCallback, useMemo, useState } from "react";

import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { applyVisibilityToList } from "../utils/VisibilityResolver";
import {
  applyMultipleFines,
  applyMultipleRewards,
  applyTeacherCustomAction,
  checkIsPoliceAdmin,
  hardDeletePoliceFineHistory,
  refundFineAmount,
  refundRewardAmount,
} from "../utils/policeUtils";
import { resolvePoliceHistoryType } from "../utils/historyRecordType";
import { useReflection } from "./useReflection";
import { resolvePoliceRuleAction } from "../utils/policeRuleUtils";

const MAX_RULE_REPEAT_COUNT = 1000;
const CUSTOM_FINE_MODAL_TAB_RULE = "rule";
const CUSTOM_FINE_MODAL_TAB_CUSTOM = "custom";
const CUSTOM_REPORT_FINE_LABEL = "\uc784\uc758\ubd80\uacfc";
const REPORT_SOURCE_TYPE = "report";

const createInitialFineForm = () => ({
  uids: [],
  ruleId: "",
  reason: "",
  repeatCount: 1,
  customTitle: "",
  customAmount: "",
  customCreditChange: "",
  customReason: "",
  relatedIds: {},
  customSourceType: null,
  customTitleLocked: false,
  reportMetaByUid: {},
});

export const useFineHistory = ({
  classId,
  policeRules = [],
  fineHistoryData = [],
  policeSettings = {},
  reflectionEnabled = true,
  refreshFineHistory,
  refreshReports,
}) => {
  const { userData, hasPermission } = useUser();
  const { showFeedback } = useFeedback();
  const isTeacher = userData?.role === "teacher";
  const canHardDelete =
    isTeacher || userData?.role === "admin";

  const isPoliceAdmin = useMemo(
    () =>
      checkIsPoliceAdmin(userData) || hasPermission("permission_group_police"),
    [userData, hasPermission],
  );
  const canSelectRecords = isPoliceAdmin || canHardDelete;

  const reflectionHandlers = useReflection(classId, {
    enabled: reflectionEnabled,
  });

  const [fineForm, setFineForm] = useState(createInitialFineForm);
  const [showFineForm, setShowFineForm] = useState(false);
  const [fineFormTab, setFineFormTab] = useState(CUSTOM_FINE_MODAL_TAB_RULE);
  const [processingId, setProcessingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  const records = useMemo(() => {
    if (!fineHistoryData?.length) return [];

    const viewer = {
      uid: userData?.uid,
      role: userData?.role,
      isPoliceAdmin,
    };

    return applyVisibilityToList(
      fineHistoryData,
      policeRules,
      viewer,
      policeSettings,
    );
  }, [fineHistoryData, isPoliceAdmin, policeRules, policeSettings, userData]);

  const confirmHardDelete = useCallback(async (count = 1) => {
    const label = count > 1 ? `선택한 ${count}건을` : "이 기록을";
    if (!(await appConfirm(`${label} 삭제하시겠습니까?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return false;
    return (await appConfirm("삭제 후에는 복구할 수 없습니다. 계속하시겠습니까?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}));
  }, []);

  const handleApplyDirectFine = useCallback(
    async ({ ruleId, uids, reason, repeatCount = 1 }) => {
      if (!isPoliceAdmin) {
        throw new Error("권한이 없습니다.");
      }

      const rule = policeRules.find((item) => item.id === ruleId);
      if (!rule) {
        throw new Error("규칙 정보를 찾을 수 없습니다.");
      }

      const amount = Number(rule.fineAmount || 0);
      const action = resolvePoliceRuleAction(rule);
      if (!action) {
        throw new Error(
          "금액 또는 신용점수 변화가 있는 규칙만 적용할 수 있습니다.",
        );
      }

      const isReward = action === "reward";
      const safeRepeatCount = Math.floor(Number(repeatCount || 1));
      if (!Number.isFinite(safeRepeatCount) || safeRepeatCount < 1) {
        throw new Error("x N은 1 이상으로 입력해야 합니다.");
      }
      if (safeRepeatCount > MAX_RULE_REPEAT_COUNT) {
        throw new Error(`x N은 최대 ${MAX_RULE_REPEAT_COUNT}회까지만 적용할 수 있습니다.`);
      }
      const payload = uids.map((uid) => ({
        studentUid: uid,
        amount: Math.abs(amount),
        ruleText: rule.text,
        ruleId: rule.id || "custom",
        description:
          reason || `'${rule.text}' ${isReward ? "상금 지급" : "벌금 부과"}`,
        creditChange: Number(rule.creditChange || 0),
        missionTokenChange: Number(rule.missionTokenChange || 0),
        dangerLevel: Number(rule.dangerLevel || 0) || null,
        quantity: safeRepeatCount,
      }));

      try {
        if (isReward) {
          const result = await applyMultipleRewards({ rewards: payload });
          if (!result.success) throw new Error(result.message);
        } else {
          const result = await applyMultipleFines({ fines: payload });
          if (!result.success) throw new Error(result.message);
        }

        showFeedback("부과 처리가 완료되었습니다.", "success");
        refreshFineHistory?.();
      } catch (error) {
        showFeedback(error.message, "error");
      }
    },
    [isPoliceAdmin, policeRules, refreshFineHistory, showFeedback],
  );

  const handleApplyCustomFine = useCallback(
    async ({
      uids,
      customTitle,
      customAmount,
      customCreditChange,
      customReason,
      relatedIds = {},
      customSourceType = null,
      reportMetaByUid = {},
    }) => {
      if (!isPoliceAdmin) {
        throw new Error("권한이 없습니다.");
      }

      try {
        const amount = Number(customAmount);
        const creditChange = Number(customCreditChange || 0);
        const isReportLinkedAction = customSourceType === REPORT_SOURCE_TYPE;
        if (isReportLinkedAction && (amount > 0 || creditChange > 0)) {
          throw new Error(
            "자유 신고 임의부과는 0 또는 음수만 입력할 수 있습니다.",
          );
        }

        const result = await applyTeacherCustomAction({
          uids,
          amount: Math.abs(amount),
          creditChange,
          reason: customReason,
          ruleTitle: customTitle,
          isReward: !isReportLinkedAction && amount > 0,
          relatedIds,
          sourceType: customSourceType,
          reportMetaByUid,
        });

        if (!result.success) {
          throw new Error(result.message);
        }

        showFeedback("임의 부과가 완료되었습니다.", "success");
        refreshFineHistory?.();
        if (isReportLinkedAction) {
          refreshReports?.();
        }
      } catch (error) {
        showFeedback(error.message, "error");
      }
    },
    [isPoliceAdmin, refreshFineHistory, refreshReports, showFeedback],
  );

  const openFineForm = useCallback((rule = null) => {
    const selectedRuleId =
      typeof rule === "string" ? rule : String(rule?.id || "").trim();

    setFineForm({
      ...createInitialFineForm(),
      ruleId: selectedRuleId,
    });
    setFineFormTab(CUSTOM_FINE_MODAL_TAB_RULE);
    setShowFineForm(true);
  }, []);

  const closeFineForm = useCallback(() => {
    setShowFineForm(false);
    setFineFormTab(CUSTOM_FINE_MODAL_TAB_RULE);
    setFineForm(createInitialFineForm());
  }, []);

  const openCustomFineFromReport = useCallback(
    (report) => {
      const studentUid = String(
        report?.studentUid || report?.accusedStudentUid || "",
      ).trim();
      const reportId = String(report?.id || "").trim();

      if (!studentUid || !reportId) {
        showFeedback(
          "\uc790\uc720 \uc2e0\uace0 \uc815\ubcf4\uac00 \ubd88\uc644\uc804\ud574 \uc784\uc758\ubd80\uacfc\ub97c \uc2dc\uc791\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.",
          "warning",
        );
        return;
      }

      const reportReason = String(
        report?.reason || report?.reportReason || "",
      ).trim();

      setFineForm({
        ...createInitialFineForm(),
        uids: [studentUid],
        customTitle: CUSTOM_REPORT_FINE_LABEL,
        customReason: reportReason,
        relatedIds: {
          [studentUid]: reportId,
        },
        customSourceType: REPORT_SOURCE_TYPE,
        customTitleLocked: true,
        reportMetaByUid: {
          [studentUid]: {
            reportId,
            reportReason,
            studentName:
              report?.studentName ||
              report?.accusedStudentName ||
              null,
            reporterName: report?.reporterName || null,
            reporterUid: report?.reporterUid || null,
            isSensitive: report?.isSensitive === true,
          },
        },
      });
      setFineFormTab(CUSTOM_FINE_MODAL_TAB_CUSTOM);
      setShowFineForm(true);
    },
    [showFeedback],
  );

  const handleCancelFine = useCallback(
    async (record) => {
      if (!isPoliceAdmin || !record?.id) return;
      if (!(await appConfirm(`${record.studentName}님의 내역을 취소하시겠습니까?`))) {
        return;
      }

      setProcessingId(record.id);
      try {
        const actionType = resolvePoliceHistoryType(record);
        const action =
          actionType === "reward" ? refundRewardAmount : refundFineAmount;
        const result = await action({
          relatedDocId: record.id,
        });

        if (!result.success) {
          throw new Error(result.message);
        }

        showFeedback("취소했습니다.", "success");
      } catch (error) {
        showFeedback(error.message, "error");
      } finally {
        setProcessingId(null);
      }
    },
    [isPoliceAdmin, showFeedback],
  );

  const handleBulkCancel = useCallback(
    async (selectedRecords) => {
      if (!isPoliceAdmin || selectedRecords.length === 0) return;

      const count = selectedRecords.length;
      if (!(await appConfirm(`선택한 ${count}건의 내역을 일괄 취소하시겠습니까?`))) {
        return;
      }

      setProcessingId("bulk-cancelling");

      const fineIds = selectedRecords
        .filter((record) => resolvePoliceHistoryType(record) === "fine")
        .map((record) => record.id);
      const rewardIds = selectedRecords
        .filter((record) => resolvePoliceHistoryType(record) === "reward")
        .map((record) => record.id);

      try {
        if (fineIds.length > 0) {
          const result = await refundFineAmount({
            relatedDocIds: fineIds,
          });
          if (!result.success) throw new Error(result.message);
        }

        if (rewardIds.length > 0) {
          const result = await refundRewardAmount({
            relatedDocIds: rewardIds,
          });
          if (!result.success) throw new Error(result.message);
        }

        showFeedback(`${count}건의 내역을 취소했습니다.`, "success");
        setSelectedIds([]);
      } catch (error) {
        console.error("bulk cancel failed:", error);
        showFeedback(
          `취소 중 오류가 발생했습니다: ${error.message}`,
          "error",
        );
      } finally {
        setProcessingId(null);
      }
    },
    [isPoliceAdmin, showFeedback],
  );

  const handleHardDeleteRecord = useCallback(
    async (record) => {
      if (!canHardDelete || !record?.id) return;
      if (!(await confirmHardDelete())) return;

      setProcessingId(`delete-${record.id}`);
      try {
        const result = await hardDeletePoliceFineHistory({
          classId,
          recordId: record.id,
        });

        if (!result?.success) {
          throw new Error(result?.message || "기록 삭제에 실패했습니다.");
        }

        showFeedback(result.message || "기록을 삭제했습니다.", "success");
        setSelectedIds((prev) => prev.filter((id) => id !== record.id));
        refreshFineHistory?.();
      } catch (error) {
        showFeedback(error.message || "기록 삭제에 실패했습니다.", "error");
      } finally {
        setProcessingId(null);
      }
    },
    [canHardDelete, classId, confirmHardDelete, refreshFineHistory, showFeedback],
  );

  const handleBulkHardDelete = useCallback(
    async (selectedRecords = []) => {
      if (!canHardDelete) return;

      const targets = Array.isArray(selectedRecords)
        ? selectedRecords.filter((record) => record?.id)
        : [];

      if (targets.length === 0) return;
      if (!(await confirmHardDelete(targets.length))) return;

      setProcessingId("bulk-delete");
      try {
        const settled = await Promise.allSettled(
          targets.map(async (record) => {
            const result = await hardDeletePoliceFineHistory({
              classId,
              recordId: record.id,
            });

            if (!result?.success) {
              throw new Error(result?.message || "기록 삭제에 실패했습니다.");
            }

            return record.id;
          }),
        );

        const deletedIds = settled
          .filter((item) => item.status === "fulfilled")
          .map((item) => item.value);
        const failedCount = settled.length - deletedIds.length;

        if (deletedIds.length > 0) {
          setSelectedIds((prev) =>
            prev.filter((id) => !deletedIds.includes(id)),
          );
          refreshFineHistory?.();
        }

        if (failedCount === 0) {
          showFeedback(`${deletedIds.length}건을 삭제했습니다.`, "success");
          return;
        }

        showFeedback(
          `${deletedIds.length}건 삭제, ${failedCount}건 실패했습니다.`,
          deletedIds.length > 0 ? "success" : "error",
        );
      } catch (error) {
        showFeedback(error.message || "기록 삭제에 실패했습니다.", "error");
      } finally {
        setProcessingId(null);
      }
    },
    [canHardDelete, classId, confirmHardDelete, refreshFineHistory, showFeedback],
  );

  return {
    records,
    isPoliceAdmin,
    canSelectRecords,
    canHardDelete,
    selectedIds,
    setSelectedIds,
    showFineForm,
    setShowFineForm,
    fineFormTab,
    fineForm,
    setFineForm,
    openFineForm,
    closeFineForm,
    openCustomFineFromReport,
    processingId: processingId || reflectionHandlers.processingId,
    handleCancelFine,
    handleBulkCancel,
    handleHardDeleteRecord,
    handleBulkHardDelete,
    handleApplyDirectFine,
    handleApplyCustomFine,
    ...reflectionHandlers,
  };
};
