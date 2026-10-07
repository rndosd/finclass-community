import React, { useEffect } from "react";
import { Modal, Button } from "../../../../components/ui";
import { useUser } from "../../../../contexts/UserContext";
import { useFeedback } from "../../../../contexts/FeedbackContext";

import BaseSection from "./components/BaseSection";
import AdvancedSection from "./components/AdvancedSection";
import AvailabilitySection from "./components/AvailabilitySection";

import { useMissionForm } from "../hooks/useMissionForm";
import { useMissionSubmit } from "../hooks/useMissionSubmit";

function ProcessSection({
  approvalPolicy,
  setApprovalPolicy,
  requireSubmissionForm,
  setRequireSubmissionForm,
  isAlways,
  allowLateSubmission,
  setAllowLateSubmission,
  showLateSubmissionOption,
}) {
  return (
    <div className="space-y-4">
      <h4 className="text-base font-semibold text-gray-900">처리 방식</h4>
      {isAlways ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          상시과제는 자동 승인, 수동 승인, 제출 내용 작성 요구를 모두 사용할 수 있습니다.
        </div>
      ) : null}

      <div className="space-y-4 rounded-lg bg-gray-50 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="approvalPolicy"
              value="auto"
              checked={approvalPolicy === "auto"}
              onChange={() => setApprovalPolicy("auto")}
              className="text-blue-500 focus:ring-blue-500"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">자동 승인</div>
              <p className="text-xs text-gray-500">학생 제출 즉시 완료 처리</p>
            </div>
          </label>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="approvalPolicy"
              value="manual"
              checked={approvalPolicy === "manual"}
              onChange={() => setApprovalPolicy("manual")}
              className="text-blue-500 focus:ring-blue-500"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">수동 승인</div>
              <p className="text-xs text-gray-500">교사 확인 후 완료 처리</p>
            </div>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={requireSubmissionForm}
            onChange={(event) => setRequireSubmissionForm(event.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
          />
          <div>
            <div className="text-sm font-medium text-gray-900">제출 내용 작성 요구</div>
            <p className="mt-0.5 text-xs text-gray-500">
              체크하면 학생이 제출 내용을 작성해야 합니다.
            </p>
          </div>
        </label>

          {showLateSubmissionOption ? (
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={allowLateSubmission}
                onChange={(event) =>
                  setAllowLateSubmission(event.target.checked)
                }
                className="mt-0.5 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
              />
              <div>
                <div className="text-sm font-medium text-gray-900">
                  마감 후 제출 허용
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  마감 뒤에도 제출할 수 있습니다.
                </p>
              </div>
            </label>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const MissionAddModal = ({
  isOpen,
  onClose,
  onSuccess,
  mode = "create",
  mission = null,
}) => {
  const isEdit = mode === "edit";
  const { classId, userData, classData } = useUser();
  const { showFeedback } = useFeedback();

  const form = useMissionForm({
    isOpen,
    isEdit,
    mission,
    classData,
    classId,
  });

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
    setTitle,
    setDescription,
    setCreditReward,
    setCashReward,
    setMissionTokenReward,
    setCreditRewardMax,
    setCashRewardMax,
    setMissionTokenRewardMax,
    setCreditRewardRangeEnabled,
    setCashRewardRangeEnabled,
    setMissionTokenRewardRangeEnabled,
    setApprovalPolicy,
    setRequireSubmissionForm,
    setAllowLateSubmission,
    setTargetType,
    setSelectedStudentUids,
    setMinimumCreditTierId,
    currencyUnit,
    repeatOn,
    setRepeatOn,
    repeatStartDate,
    setRepeatStartDate,
    repeatEndDate,
    setRepeatEndDate,
    repeatDays,
    setRepeatDays,
    repeatStartTime,
    setRepeatStartTime,
    repeatEndTime,
    setRepeatEndTime,
    repeatNoEndTime,
    setRepeatNoEndTime,
    repeatEndNextDay,
    setRepeatEndNextDay,
    availabilityMode,
    setAvailabilityMode,
    isActive,
    setIsActive,
    availabilityDays,
    setAvailabilityDays,
    availabilityStartTime,
    setAvailabilityStartTime,
    availabilityEndTime,
    setAvailabilityEndTime,
    maxPerDay,
    setMaxPerDay,
    availabilityStudentVisible,
    setAvailabilityStudentVisible,
    startAt,
    setStartAt,
    dueAt,
    setDueAt,
    noDueDate,
    setNoDueDate,
    nowLocalMin,
    dueMinLocal,
    resetForm,
  } = form;

  const { handleSubmit, isSaving } = useMissionSubmit({
    mode,
    classId,
    userData,
    showFeedback,
    form,
    onSuccess,
    onClose,
    mission,
  });

  const isAlways = availabilityMode !== "off";
  const showLateSubmissionOption =
    !isAlways && (!repeatOn ? !noDueDate : !repeatNoEndTime);

  useEffect(() => {
    if (!isEdit) {
      setRepeatOn(false);
      setAvailabilityMode("off");
      setIsActive(false);
    }
  }, [isEdit, setAvailabilityMode, setIsActive, setRepeatOn]);

  useEffect(() => {
    if (approvalPolicy !== "auto") return;
    setCreditRewardRangeEnabled(false);
    setCashRewardRangeEnabled(false);
    setMissionTokenRewardRangeEnabled(false);
    setCreditRewardMax("");
    setCashRewardMax("");
    setMissionTokenRewardMax("");
  }, [
    approvalPolicy,
    setCashRewardMax,
    setCashRewardRangeEnabled,
    setCreditRewardMax,
    setCreditRewardRangeEnabled,
    setMissionTokenRewardMax,
    setMissionTokenRewardRangeEnabled,
  ]);

  const handleClose = () => {
    if (isSaving) return;
    if (!isEdit) resetForm();
    onClose();
  };

  const baseCommonProps = {
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
    targetType,
    selectedStudentUids,
    requireSubmissionForm,
    minimumCreditTierId,
    availableCreditTiers,
    setTitle,
    setDescription,
    setCreditReward,
    setCashReward,
    setMissionTokenReward,
    setCreditRewardMax,
    setCashRewardMax,
    setMissionTokenRewardMax,
    setCreditRewardRangeEnabled,
    setCashRewardRangeEnabled,
    setMissionTokenRewardRangeEnabled,
    setApprovalPolicy,
    setRequireSubmissionForm,
    setTargetType,
    setSelectedStudentUids,
    setMinimumCreditTierId,
    currencyUnit,
    disableRewardRange: approvalPolicy === "auto",
    rangeRewardMaxOnly: true,
  };

  const advancedProps = {
    repeatOn,
    repeatStartDate,
    repeatEndDate,
    repeatDays,
    repeatStartTime,
    repeatEndTime,
    repeatNoEndTime,
    repeatEndNextDay,
    setRepeatOn,
    setRepeatStartDate,
    setRepeatEndDate,
    setRepeatDays,
    setRepeatStartTime,
    setRepeatEndTime,
    setRepeatNoEndTime,
    setRepeatEndNextDay,
    isEdit,
  };

  const availabilityProps = {
    isActive,
    setIsActive,
    availabilityDays,
    setAvailabilityDays,
    availabilityStartTime,
    setAvailabilityStartTime,
    availabilityEndTime,
    setAvailabilityEndTime,
    maxPerDay,
    setMaxPerDay,
    availabilityStudentVisible,
    setAvailabilityStudentVisible,
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600">
            <svg
              className="h-5 w-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
          </div>
          <div>
            <span className="block text-lg font-semibold text-gray-900">
              {isEdit ? "과제 수정" : "새 과제 추가"}
            </span>
            <p className="mt-0.5 text-sm text-gray-500">
              {isEdit ? "기존 과제 내용을 수정합니다." : "새 과제를 생성합니다."}
            </p>
          </div>
        </div>
      }
      size="lg"
    >
      <Modal.Body className="p-0">
        <div className="px-4 pb-6 sm:px-6">
          <form
            onSubmit={handleSubmit}
            className="mx-auto grid max-w-6xl grid-cols-1 gap-8 p-0 lg:grid-cols-2"
          >
            <div className="space-y-8">
              <BaseSection
                {...baseCommonProps}
                showBasicInfo
                showRewards
                showSchedule={false}
                showApproval={false}
              />
            </div>

            <div className="space-y-8">
              <div className="space-y-4 rounded-2xl border bg-gray-50 p-4 sm:p-5">
                <div className="grid gap-3 sm:flex sm:items-center sm:gap-8">
                  <label className="flex cursor-pointer select-none items-center gap-2">
                    <input
                      type="checkbox"
                      checked={repeatOn}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setRepeatOn(checked);
                        if (checked) {
                          setAvailabilityMode("off");
                          setIsActive(false);
                        }
                      }}
                      disabled={isSaving}
                      className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-[15px] font-medium text-gray-800">
                      반복형으로 생성
                    </span>
                  </label>

                  <label className="flex cursor-pointer select-none items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isAlways}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        if (checked) {
                          setAvailabilityMode("weekly");
                          setIsActive(true);
                          setAvailabilityStudentVisible(true);
                          setRepeatOn(false);
                        } else {
                          setAvailabilityMode("off");
                          setIsActive(false);
                        }
                      }}
                      disabled={isSaving}
                      className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-[15px] font-medium text-gray-800">
                      상시과제 생성
                    </span>
                  </label>
                </div>

                {repeatOn ? (
                  <div className="mt-3">
                    <AdvancedSection
                      {...advancedProps}
                      showRepeat
                      showChallenge={false}
                    />
                  </div>
                ) : null}

                {!repeatOn && isAlways ? (
                  <div className="mt-3">
                    <AvailabilitySection {...availabilityProps} />
                  </div>
                ) : null}

                {!repeatOn && !isAlways ? (
                  <div className="mt-3">
                    <BaseSection
                      {...baseCommonProps}
                      showBasicInfo={false}
                      showRewards={false}
                      showSchedule
                      showApproval={false}
                      startAt={startAt}
                      dueAt={dueAt}
                      noDueDate={noDueDate}
                      setStartAt={setStartAt}
                      setDueAt={setDueAt}
                      setNoDueDate={setNoDueDate}
                      nowLocalMin={nowLocalMin}
                      dueMinLocal={dueMinLocal}
                    />
                  </div>
                ) : null}
              </div>

              <ProcessSection
                approvalPolicy={approvalPolicy}
                setApprovalPolicy={setApprovalPolicy}
                requireSubmissionForm={requireSubmissionForm}
                setRequireSubmissionForm={setRequireSubmissionForm}
                allowLateSubmission={allowLateSubmission}
                setAllowLateSubmission={setAllowLateSubmission}
                showLateSubmissionOption={showLateSubmissionOption}
                isAlways={isAlways}
              />
            </div>
          </form>
        </div>
      </Modal.Body>

      <Modal.Footer className="rounded-b-2xl bg-gray-50 px-4 py-3 sm:px-6 sm:py-4">
        <div className="grid w-full gap-3 sm:flex sm:items-center sm:justify-between">
          <div className="hidden text-sm text-gray-500 sm:block">
            {isEdit
              ? "변경사항을 저장할까요?"
              : repeatOn
                ? "반복 설정에 따라 여러 개의 과제가 생성됩니다."
                : isAlways
                  ? "상시과제는 설정된 요일과 시간에 반복 노출됩니다."
                  : "과제를 등록할까요?"}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:flex sm:space-x-3">
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={isSaving}
            >
              취소
            </Button>
            <Button tone="blue" kind="solid" size="sm"
              type="submit"
              onClick={handleSubmit}
              isLoading={isSaving}
              disabled={isSaving || !title.trim()}
              
            >
              {isSaving ? "저장 중..." : isEdit ? "과제 수정" : "과제 등록"}
            </Button>
          </div>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default MissionAddModal;
