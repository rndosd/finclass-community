import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Button,
  SelectField,
  InputField,
  TextAreaField,
  StudentSelector,
  Tabs,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { History, Zap, UserPlus, FileText, Trophy, Lock } from "lucide-react";
import directFineActionAsset from "../../../assets/police/direct-fine-action-v1.webp";
import { buildPoliceRuleOption } from "../utils/ruleOptionLabel";
import { resolvePoliceRuleAction } from "../utils/policeRuleUtils";

const MAX_RULE_REPEAT_COUNT = 1000;
const DEFAULT_MODAL_TAB = "rule";
const CUSTOM_REPORT_SOURCE_TYPE = "report";
const CUSTOM_REPORT_FINE_LABEL = "임의부과";

const formatSignedNumber = (value, formatter = amount => amount.toLocaleString()) => {
  const amount = Number(value || 0);
  if (amount > 0) return `+${formatter(amount)}`;
  return formatter(amount);
};

const toSafeRepeatCount = (value) => {
  const parsed = Math.floor(Number(value || 1));
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, parsed);
};

const buildStudentNameMap = (students = []) =>
  new Map(
    (Array.isArray(students) ? students : [])
      .map((student) => {
        const uid = String(student?.uid || student?.id || "").trim();
        const name = String(student?.name || student?.studentName || "").trim();
        return [uid, name];
      })
      .filter(([uid]) => Boolean(uid)),
  );

export default function FineFormModal({
  isOpen,
  onClose,
  onSubmit,
  onSubmitFine,
  onSubmitReward,
  onApplyCustom,
  fineForm,
  setFineForm,
  allStudents,
  policeRules,
  defaultTab = DEFAULT_MODAL_TAB,
  "data-tour": dataTour,
}) {
  const { formatClassCurrency } = useNumberFormat();
  const { showFeedback } = useFeedback();
  const { isTeacher, isAdmin, hasPermission } = useUser();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState(defaultTab || DEFAULT_MODAL_TAB);

  const canUseCustom =
    isTeacher || isAdmin || hasPermission("permission_group_police");
  const isReportLinkedCustom =
    fineForm?.customSourceType === CUSTOM_REPORT_SOURCE_TYPE;

  const selectedRule = useMemo(
    () =>
      (policeRules || []).find((rule) => rule.id === (fineForm.ruleId || "")),
    [fineForm.ruleId, policeRules],
  );

  const { fineOptions, rewardOptions } = useMemo(() => {
    const toOption = (rule) => ({
      value: rule.id,
      label: `${rule.order ? `${rule.order}. ` : ""}${rule.text} [${formatSignedNumber(
        rule.fineAmount || 0, formatClassCurrency,
      )} / ${formatSignedNumber(rule.creditChange || 0)}점 / ${formatSignedNumber(
        rule.missionTokenChange || 0, formatClassCurrency,
      )}토큰]`,
      searchText: `${rule.order || ""} ${rule.text || ""} ${rule.fineAmount || ""} ${rule.creditChange || ""} ${rule.missionTokenChange || ""}`,
    });

    const fineRules = (policeRules || [])
      .filter((rule) => resolvePoliceRuleAction(rule) === "fine")
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map(toOption);

    const rewardRules = (policeRules || [])
      .filter((rule) => resolvePoliceRuleAction(rule) === "reward")
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map(toOption);

    return {
      fineOptions: fineRules,
      rewardOptions: rewardRules,
    };
  }, [policeRules, formatClassCurrency]);

  const normalizedFineOptions = useMemo(
    () =>
      fineOptions.map((option) => {
        const matchedRule = (
          Array.isArray(policeRules) ? policeRules : []
        ).find((rule) => rule?.id === option.value);
        return buildPoliceRuleOption(
          matchedRule || { id: option.value, text: option.label },
          formatClassCurrency,
        );
      }),
    [fineOptions, policeRules, formatClassCurrency],
  );

  const normalizedRewardOptions = useMemo(
    () =>
      rewardOptions.map((option) => {
        const matchedRule = (
          Array.isArray(policeRules) ? policeRules : []
        ).find((rule) => rule?.id === option.value);
        return buildPoliceRuleOption(
          matchedRule || { id: option.value, text: option.label },
          formatClassCurrency,
        );
      }),
    [policeRules, rewardOptions, formatClassCurrency],
  );

  const lockedTargetNames = useMemo(() => {
    const studentNameMap = buildStudentNameMap(allStudents);
    const selectedUids = Array.isArray(fineForm?.uids) ? fineForm.uids : [];
    const reportMetaByUid = fineForm?.reportMetaByUid || {};

    return selectedUids.map((uid) => {
      const safeUid = String(uid || "").trim();
      const reportMeta = reportMetaByUid[safeUid] || {};
      return studentNameMap.get(safeUid) || reportMeta.studentName || safeUid;
    });
  }, [allStudents, fineForm?.reportMetaByUid, fineForm?.uids]);

  useEffect(() => {
    if (!isOpen) return;
    if (isReportLinkedCustom && canUseCustom) {
      setActiveTab("custom");
      return;
    }
    setActiveTab(defaultTab || DEFAULT_MODAL_TAB);
  }, [canUseCustom, defaultTab, isOpen, isReportLinkedCustom]);

  const handleChange = (field, value) => {
    if (isSubmitting) return;
    if (field === "uids" && isReportLinkedCustom) return;

    if (
      isReportLinkedCustom &&
      (field === "customAmount" || field === "customCreditChange")
    ) {
      const isIntermediateNegativeInput = value === "" || value === "-";
      const parsed = Number(value);

      if (
        !isIntermediateNegativeInput &&
        Number.isFinite(parsed) &&
        parsed > 0
      ) {
        showFeedback(
          "자유 신고 임의부과는 0 또는 음수만 입력할 수 있습니다.",
          "warning",
        );
        return;
      }
    }

    if (field === "repeatCount") {
      if (value === "") {
        setFineForm((prev) => ({
          ...prev,
          [field]: value,
        }));
        return;
      }

      const parsed = Math.floor(Number(value));
      if (Number.isFinite(parsed) && parsed > MAX_RULE_REPEAT_COUNT) {
        showFeedback(
          `x N은 최대 ${MAX_RULE_REPEAT_COUNT}까지만 입력할 수 있습니다.`,
          "warning",
        );
        setFineForm((prev) => ({
          ...prev,
          [field]: String(MAX_RULE_REPEAT_COUNT),
        }));
        return;
      }
    }

    setFineForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleClose = () => {
    if (!isSubmitting) onClose?.();
  };

  const resetRuleForm = () => {
    setFineForm((prev) => ({
      ...prev,
      uids: [],
      ruleId: "",
      reason: "",
      repeatCount: 1,
    }));
  };

  const resetCustomForm = () => {
    setFineForm((prev) => ({
      ...prev,
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
    }));
  };

  const handleSubmitRule = async () => {
    if (isSubmitting) return;

    const uids = fineForm.uids || [];
    const ruleId = fineForm.ruleId;
    const reasonText = (fineForm.reason || "").trim();
    const repeatCount = toSafeRepeatCount(fineForm.repeatCount);

    if (!uids.length || !ruleId) {
      showFeedback("대상 학생과 규칙을 모두 선택해 주세요.", "warning");
      return;
    }

    if (repeatCount > MAX_RULE_REPEAT_COUNT) {
      showFeedback(
        `x N은 최대 ${MAX_RULE_REPEAT_COUNT}까지만 입력할 수 있습니다.`,
        "warning",
      );
      return;
    }

    const action = resolvePoliceRuleAction(selectedRule);
    if (!action) {
      showFeedback("선택한 규칙의 처리 유형을 확인할 수 없습니다.", "warning");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        ruleId,
        uids,
        reason: reasonText,
        repeatCount,
      };

      if (action === "reward" && onSubmitReward) {
        await onSubmitReward(payload);
      } else if (action === "fine" && onSubmitFine) {
        await onSubmitFine(payload);
      } else {
        await onSubmit?.({ ...payload, action });
      }

      resetRuleForm();
      onClose?.();
    } catch (error) {
      showFeedback(
        error?.message || "규칙 적용 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitCustom = async () => {
    if (!canUseCustom || isSubmitting) return;

    const uids = fineForm.uids || [];
    const amount = Number(fineForm.customAmount || 0);
    const creditChange = Number(fineForm.customCreditChange || 0);
    const reasonText = (fineForm.customReason || "").trim();
    const titleText = (fineForm.customTitle || CUSTOM_REPORT_FINE_LABEL).trim();

    if (!uids.length) {
      showFeedback("대상 학생을 1명 이상 선택해 주세요.", "warning");
      return;
    }

    if (isReportLinkedCustom && (amount > 0 || creditChange > 0)) {
      showFeedback(
        "자유 신고 임의부과는 0 또는 음수만 입력할 수 있습니다.",
        "warning",
      );
      return;
    }

    if (!isReportLinkedCustom && !amount) {
      showFeedback("금액 변화는 0이 될 수 없습니다.", "warning");
      return;
    }

    setIsSubmitting(true);
    try {
      await onApplyCustom?.({
        uids,
        customTitle: isReportLinkedCustom
          ? CUSTOM_REPORT_FINE_LABEL
          : titleText,
        customAmount: amount,
        customCreditChange: creditChange,
        customReason: reasonText,
        relatedIds: fineForm.relatedIds || {},
        customSourceType: fineForm.customSourceType || null,
        reportMetaByUid: fineForm.reportMetaByUid || {},
      });

      resetCustomForm();
      onClose?.();
    } catch (error) {
      showFeedback(
        error?.message || "임의부과 처리 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={
        <div className="flex items-center gap-2">
          <img
            src={directFineActionAsset}
            alt=""
            className="h-12 w-12 object-contain"
            aria-hidden="true"
          />
          <span>경찰청 부과/보상</span>
        </div>
      }
      size="lg"
      data-tour={dataTour}
    >
      {!isReportLinkedCustom ? (
        <Tabs ariaLabel="직접 부과 방식" tabs={[{id:"rule",label:"규칙 적용",icon:History},...(canUseCustom?[{id:"custom",label:"임의부과",icon:Zap}]:[])]} activeTab={activeTab} onTabChange={setActiveTab} variant="underline" size="sm" fullWidth className="mb-6" />
      ) : (
        <div className="mb-6 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          자유 신고에서 연결된 임의부과입니다. 대상 학생은 고정되며 다시 선택할
          필요가 없습니다.
        </div>
      )}

      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 font-bold text-slate-700">
            <UserPlus className="h-4 w-4 text-indigo-500" />
            <span>1. 대상 학생</span>
          </div>

          {isReportLinkedCustom ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                <Lock className="h-4 w-4 text-slate-500" />
                <span>자유 신고에서 선택된 대상</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {lockedTargetNames.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700 ring-1 ring-slate-200"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <StudentSelector
              selectedUids={fineForm.uids || []}
              onChange={(uids) => handleChange("uids", uids)}
              multiple
              disabled={isSubmitting}
              allStudents={allStudents}
            />
          )}
        </section>

        {activeTab === "rule" ? (
          <section className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="mb-4 flex items-center gap-2 font-bold text-slate-700">
              <FileText className="h-4 w-4 text-indigo-500" />
              <span>2. 규칙 선택</span>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <label className="ml-1 text-xs font-bold text-rose-600">
                  벌점 규칙
                </label>
                <SelectField
                  value={
                    resolvePoliceRuleAction(selectedRule) === "fine"
                      ? fineForm.ruleId
                      : ""
                  }
                  onChange={(event) =>
                    handleChange("ruleId", event.target.value)
                  }
                  disabled={isSubmitting}
                  options={normalizedFineOptions}
                  placeholder="벌점 규칙 선택"
                  searchable
                  combobox
                  searchPlaceholder="번호 또는 규칙명"
                  className="border-rose-100"
                  dropdownClassName="min-w-[min(92vw,32rem)]"
                />
              </div>

              <div className="space-y-2">
                <label className="ml-1 text-xs font-bold text-blue-600">
                  보상 규칙
                </label>
                <SelectField
                  value={
                    resolvePoliceRuleAction(selectedRule) === "reward"
                      ? fineForm.ruleId
                      : ""
                  }
                  onChange={(event) =>
                    handleChange("ruleId", event.target.value)
                  }
                  disabled={isSubmitting}
                  options={normalizedRewardOptions}
                  placeholder="보상 규칙 선택"
                  searchable
                  combobox
                  searchPlaceholder="번호 또는 규칙명"
                  className="border-blue-100"
                  dropdownClassName="min-w-[min(92vw,32rem)]"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
              <TextAreaField
                label="처리 메모 (선택)"
                value={fineForm.reason || ""}
                onChange={(event) => handleChange("reason", event.target.value)}
                placeholder="처리 사유나 메모가 있으면 입력해 주세요"
                disabled={isSubmitting}
                rows={3}
              />
              <InputField
                label="x N"
                type="number"
                min={1}
                max={MAX_RULE_REPEAT_COUNT}
                step={1}
                value={fineForm.repeatCount ?? 1}
                onChange={(event) =>
                  handleChange("repeatCount", event.target.value)
                }
                placeholder="1"
                disabled={isSubmitting}
              />
            </div>

            <p className="mt-2 text-xs text-slate-500">
              x N을 입력하면 같은 규칙을 같은 대상에게 여러 번 반복 적용합니다.
            </p>
          </section>
        ) : (
          <section className="space-y-4 rounded-2xl border border-rose-100 bg-rose-50/30 p-4">
            <div className="mb-2 flex items-center gap-2 font-bold text-rose-700">
              <Zap className="h-4 w-4" />
              <span>2. 임의부과 입력</span>
            </div>

            <InputField
              label="부과명"
              value={
                isReportLinkedCustom
                  ? CUSTOM_REPORT_FINE_LABEL
                  : fineForm.customTitle || ""
              }
              onChange={(event) =>
                handleChange("customTitle", event.target.value)
              }
              placeholder="예: 추가 지도, 특별 조정"
              disabled={isSubmitting || isReportLinkedCustom}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InputField
                label={isReportLinkedCustom ? "벌금액" : "금액 변화"}
                type="number"
                max={isReportLinkedCustom ? 0 : undefined}
                value={fineForm.customAmount || ""}
                onChange={(event) =>
                  handleChange("customAmount", event.target.value)
                }
                placeholder={
                  isReportLinkedCustom
                    ? "0 또는 음수로 입력"
                    : "벌점/벌금은 음수, 보상은 양수"
                }
                disabled={isSubmitting}
              />
              <InputField
                label="신용 변화"
                type="number"
                max={isReportLinkedCustom ? 0 : undefined}
                value={fineForm.customCreditChange || ""}
                onChange={(event) =>
                  handleChange("customCreditChange", event.target.value)
                }
                placeholder={
                  isReportLinkedCustom
                    ? "0 또는 음수로 입력"
                    : "감점은 음수, 가점은 양수"
                }
                disabled={isSubmitting}
              />
            </div>

            <TextAreaField
              label="부과 사유"
              value={fineForm.customReason || ""}
              onChange={(event) =>
                handleChange("customReason", event.target.value)
              }
              placeholder="부과 사유를 입력해 주세요"
              disabled={isSubmitting}
              rows={3}
            />
          </section>
        )}
      </div>

      <div className="mt-8 flex justify-end gap-3">
        <Button
          onClick={handleClose}
          kind="ghost"
          tone="slate"
          disabled={isSubmitting}
        >
          취소
        </Button>
        <Button
          onClick={activeTab === "rule" ? handleSubmitRule : handleSubmitCustom}
          tone={activeTab === "rule" ? "indigo" : "rose"}
          kind="solid"
          size="lg"
          
          disabled={isSubmitting}
          icon={activeTab === "rule" ? Trophy : Zap}
        >
          {isSubmitting
            ? "처리 중..."
            : activeTab === "rule"
              ? "규칙 적용하기"
              : "임의부과 실행"}
        </Button>
      </div>
    </Modal>
  );
}
