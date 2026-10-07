import React from "react";
import StudentSelector from "../../../../../components/ui/StudentSelector";
import { useUser } from "../../../../../contexts/UserContext";

const sectionTitleClass = "text-base font-semibold text-gray-900";
const labelClass = "block text-sm font-medium text-gray-700";
const inputClass =
  "w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm transition-colors placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
const compactInputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

const BaseSection = ({
  title,
  description,
  startAt,
  dueAt,
  noDueDate,
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
  selectedStudentUids,
  requireSubmissionForm,
  minimumCreditTierId,
  availableCreditTiers = [],
  setTitle,
  setDescription,
  setStartAt,
  setDueAt,
  setNoDueDate,
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
  setTargetType,
  setSelectedStudentUids,
  setRequireSubmissionForm,
  setMinimumCreditTierId,
  nowLocalMin,
  dueMinLocal,
  currencyUnit,
  repeatOn = false,
  showBasicInfo = true,
  showRewards = true,
  showSchedule = true,
  showApproval = true,
  disableRewardRange = false,
  rangeRewardMaxOnly = false,
}) => {
  const { missionTokenLabel } = useUser();
  const renderRewardField = ({
    label,
    value,
    maxValue,
    isRangeEnabled,
    setValue,
    setMaxValue,
    setRangeEnabled,
    accentClass = "",
  }) => {
    const handleToggleRange = (checked) => {
      setRangeEnabled(checked);

      if (checked) {
        setApprovalPolicy("manual");
        if (!maxValue) setMaxValue(value || "");
        if (rangeRewardMaxOnly) setValue("");
        return;
      }

      if (rangeRewardMaxOnly && maxValue) {
        setValue(maxValue);
      }

      setMaxValue("");
    };

    return (
      <div className={`rounded-xl border border-slate-200 bg-white p-3 ${accentClass}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-medium text-slate-700">
            {label}
          </div>

          <label className="inline-flex shrink-0 items-center">
            <input
              type="checkbox"
              checked={isRangeEnabled}
              disabled={disableRewardRange}
              onChange={(event) => handleToggleRange(event.target.checked)}
              aria-label={`${label} 범위 보상`}
              className="h-3.5 w-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
            />
          </label>
        </div>

        <div className={`mt-3 grid gap-2 ${isRangeEnabled && !rangeRewardMaxOnly ? "grid-cols-2" : "grid-cols-1"}`}>
          {(!isRangeEnabled || !rangeRewardMaxOnly) ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
              <div className="text-[10px] font-semibold text-slate-400">
                {isRangeEnabled ? "최소" : "금액"}
              </div>
              <input
                type="number"
                aria-label={`${label} ${isRangeEnabled ? "최소 보상" : "보상"}`}
                min="0"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="0"
                className="mt-1 w-full border-0 bg-transparent px-0 py-0 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          ) : null}

          {isRangeEnabled ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
              <div className="text-[10px] font-semibold text-slate-400">
                {rangeRewardMaxOnly ? "최대 보상" : "최대"}
              </div>
              <input
                type="number"
                aria-label={`${label} 최대 보상`}
                min="0"
                value={maxValue}
                onChange={(event) => setMaxValue(event.target.value)}
                placeholder="0"
                className="mt-1 w-full border-0 bg-transparent px-0 py-0 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {showBasicInfo ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h4 className={sectionTitleClass}>기본 정보</h4>
          </div>

          <div className="space-y-2">
            <label className={labelClass}>
              <span className="mr-1 text-red-500">*</span>
              과제 제목
            </label>
            <input
              type="text"
              aria-label="과제 제목"
              className={inputClass}
              placeholder="예: 공책 정리, 영어 단어 20개 외우기"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className={labelClass}>과제 설명</label>
            <textarea
              rows={3}
              aria-label="과제 설명"
              className={`${inputClass} resize-none`}
              placeholder="학생에게 보여줄 과제 안내를 입력해 주세요."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="space-y-3">
            <label className={labelClass}>
              과제 대상
              <span className="ml-1 text-xs text-gray-500">
                선택하지 않으면 전체 학생 대상
              </span>
            </label>

            <StudentSelector
              label="특정 학생 선택"
              selectedUids={selectedStudentUids}
              onChange={(uids) => {
                setSelectedStudentUids(uids);
                setTargetType(uids.length > 0 ? "selected" : "all");
              }}
              multiple
              includeTeacher
              enableTierFilter
            />

            <div className="space-y-2">
              <label className={labelClass}>
                최소 신용등급 제한
                <span className="ml-1 text-xs text-gray-500">
                  해당 등급 이상만 수행 가능
                </span>
              </label>
              <select
                aria-label="최소 신용등급 제한"
                value={minimumCreditTierId}
                onChange={(event) => setMinimumCreditTierId(event.target.value)}
                className={inputClass}
              >
                <option value="">제한 없음</option>
                {availableCreditTiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name} 이상
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : null}

      {showSchedule && !repeatOn ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h4 className={sectionTitleClass}>일정 설정</h4>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className={labelClass}>
                <span className="mr-1 text-red-500">*</span>
                시작 시각
              </label>
              <input
                type="datetime-local"
                aria-label="시작 시각"
                min={nowLocalMin}
                className={compactInputClass}
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
                required
              />
              <p className="text-xs text-gray-500">
                시작 1시간 전부터 학생 화면에 표시됩니다.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className={labelClass}>마감 시각</label>
                <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={noDueDate}
                    onChange={(event) => setNoDueDate(event.target.checked)}
                    className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                  />
                  <span>없음</span>
                </label>
              </div>
              <input
                type="datetime-local"
                aria-label="마감 시각"
                min={dueMinLocal}
                disabled={noDueDate}
                className={`${compactInputClass} disabled:bg-gray-100 disabled:text-gray-400`}
                value={noDueDate ? "" : dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
              {noDueDate ? (
                <p className="text-xs text-blue-700">상시 제출 가능</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showRewards ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h4 className={sectionTitleClass}>보상 설정</h4>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {renderRewardField({
              label: "신용점수",
              value: creditReward,
              maxValue: creditRewardMax,
              isRangeEnabled: creditRewardRangeEnabled,
              setValue: setCreditReward,
              setMaxValue: setCreditRewardMax,
              setRangeEnabled: setCreditRewardRangeEnabled,
            })}

            {renderRewardField({
              label: currencyUnit,
              value: cashReward,
              maxValue: cashRewardMax,
              isRangeEnabled: cashRewardRangeEnabled,
              setValue: setCashReward,
              setMaxValue: setCashRewardMax,
              setRangeEnabled: setCashRewardRangeEnabled,
            })}

            {renderRewardField({
              label: missionTokenLabel,
              value: missionTokenReward,
              maxValue: missionTokenRewardMax,
              isRangeEnabled: missionTokenRewardRangeEnabled,
              setValue: setMissionTokenReward,
              setMaxValue: setMissionTokenRewardMax,
              setRangeEnabled: setMissionTokenRewardRangeEnabled,
              accentClass: "bg-indigo-50/20",
            })}
          </div>

          <div className="space-y-1 pl-1 text-[11px] text-slate-400">
            <p>* 체크 시 범위 보상을 설정할 수 있습니다.</p>
            <p>* 범위 보상은 0부터 최대 보상까지 설정됩니다.</p>
            <p>* 자동 승인 과제에서는 범위 보상을 사용할 수 없습니다.</p>
            <p>* {missionTokenLabel}은 상점과 전용 활동에서 사용할 수 있습니다.</p>
          </div>
        </div>
      ) : null}

      {showApproval ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h4 className={sectionTitleClass}>처리 방식</h4>
          </div>

          <div className="space-y-4 rounded-lg bg-gray-50 p-4">
            <div className="space-y-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="approvalPolicy"
                  value="auto"
                  checked={approvalPolicy === "auto"}
                  onChange={() => setApprovalPolicy("auto")}
                  className="mt-0.5 text-blue-500 focus:ring-blue-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">자동 승인</div>
                  <p className="mt-0.5 text-xs text-gray-600">
                    학생이 제출하면 즉시 완료 처리됩니다.
                  </p>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="approvalPolicy"
                  value="manual"
                  checked={approvalPolicy === "manual"}
                  onChange={() => setApprovalPolicy("manual")}
                  className="mt-0.5 text-blue-500 focus:ring-blue-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">수동 승인</div>
                  <p className="mt-0.5 text-xs text-gray-600">
                    교사 확인 후 승인 처리됩니다.
                  </p>
                </div>
              </label>
            </div>

            <div className="my-3 border-t border-gray-200" />

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={requireSubmissionForm}
                onChange={(event) => setRequireSubmissionForm(event.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">제출 내용 작성 요구</div>
                <p className="mt-0.5 text-xs text-gray-600">
                  체크하면 학생이 제출 내용을 입력해야 합니다.
                </p>
              </div>
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default BaseSection;
