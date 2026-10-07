import React, { useEffect, useMemo, useState } from "react";
import { Briefcase, CalendarClock, Sparkles, Users } from "lucide-react";

import { Badge, Button, Modal } from "../../../components/ui";

const DAY_OPTIONS = [
  { value: "monday", label: "월요일" },
  { value: "tuesday", label: "화요일" },
  { value: "wednesday", label: "수요일" },
  { value: "thursday", label: "목요일" },
  { value: "friday", label: "금요일" },
];

const INTERVAL_OPTIONS = [1, 2, 3, 4];
const DAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};
const toDateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const addDaysToDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
};

const formatPaymentDateOption = (dateKey) => {
  if (!dateKey) return "미선택";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${dateKey}T00:00:00`));
};

const getNextPaymentDateOptions = (dayOfWeek, time, count = 8) => {
  const targetDay = DAY_INDEX[dayOfWeek] ?? 5;
  const now = new Date();
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cursor.setDate(cursor.getDate() + ((targetDay - cursor.getDay() + 7) % 7));

  const options = [];
  while (options.length < count) {
    const dateKey = toDateKey(cursor);
    const candidate = new Date(`${dateKey}T${time || "15:00"}:00`);
    if (candidate.getTime() > now.getTime()) options.push(dateKey);
    cursor.setDate(cursor.getDate() + 7);
  }
  return options;
};

export default function PayrollAutomationSettingsModal({
  isOpen,
  onClose,
  value,
  onApply,
  isSubmitting = false,
  targetCandidates = [],
  jobOptions = [],
}) {
  const [enabled, setEnabled] = useState(false);
  const [numberOfWeeks, setNumberOfWeeks] = useState(1);
  const [dayOfWeek, setDayOfWeek] = useState("friday");
  const [time, setTime] = useState("15:00");
  const [firstPaymentDate, setFirstPaymentDate] = useState("");
  const [targetMode, setTargetMode] = useState("all_jobs");
  const [selectedJobNames, setSelectedJobNames] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    setEnabled(value?.enabled === true);
    setNumberOfWeeks(Number(value?.numberOfWeeks || 1));
    setDayOfWeek(value?.dayOfWeek || "friday");
    setTime(value?.time || "15:00");
    setFirstPaymentDate(value?.firstPaymentDate || "");
    setTargetMode(value?.targetMode || "all_jobs");
    setSelectedJobNames(
      Array.isArray(value?.selectedJobNames) ? value.selectedJobNames : [],
    );
  }, [isOpen, value]);

  const selectedDayLabel =
    DAY_OPTIONS.find((option) => option.value === dayOfWeek)?.label || "금요일";
  const paymentDateOptions = useMemo(
    () => getNextPaymentDateOptions(dayOfWeek, time),
    [dayOfWeek, time],
  );
  const selectablePaymentDates = paymentDateOptions.includes(firstPaymentDate)
    ? paymentDateOptions
    : firstPaymentDate
      ? [firstPaymentDate, ...paymentDateOptions]
      : paymentDateOptions;
  const selectedJobNameSet = new Set(selectedJobNames);
  const previewTargetCount =
    targetMode === "selected_jobs"
      ? targetCandidates.filter((student) =>
          student.jobs?.some((jobName) => selectedJobNameSet.has(jobName)),
        ).length
      : targetCandidates.length;
  const isTargetSelectionValid =
    !enabled || targetMode !== "selected_jobs" || selectedJobNames.length > 0;
  const payrollPeriodStartDate = firstPaymentDate
    ? addDaysToDateKey(firstPaymentDate, numberOfWeeks * -7)
    : "";
  const payrollPeriodEndDate = firstPaymentDate
    ? addDaysToDateKey(firstPaymentDate, -1)
    : "";

  useEffect(() => {
    if (!isOpen || firstPaymentDate || paymentDateOptions.length === 0) return;
    setFirstPaymentDate(paymentDateOptions[0]);
  }, [firstPaymentDate, isOpen, paymentDateOptions]);

  useEffect(() => {
    if (!isOpen || paymentDateOptions.length === 0) return;
    if (!paymentDateOptions.includes(firstPaymentDate)) {
      setFirstPaymentDate(paymentDateOptions[0]);
    }
  }, [firstPaymentDate, isOpen, paymentDateOptions]);

  const toggleJobName = (jobName) => {
    setSelectedJobNames((current) =>
      current.includes(jobName)
        ? current.filter((name) => name !== jobName)
        : [...current, jobName],
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isTargetSelectionValid) return;
    const applied = await onApply?.({
      enabled,
      numberOfWeeks,
      dayOfWeek,
      time,
      firstPaymentDate,
      targetMode,
      selectedJobNames,
    });
    if (applied !== false) onClose?.();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      closeOnOverlayClick={!isSubmitting}
    >
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-indigo-600 p-3 text-white">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900">
              정기 급여 자동 지급
            </h2>
            <p className="text-sm text-slate-500">
              반복 지급 일정과 다음 지급 대상을 확인합니다.
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body>
        <form
          id="payroll-automation-settings-form"
          onSubmit={handleSubmit}
          className="space-y-5"
        >
          <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <div>
              <p className="text-sm font-black text-slate-900">자동 지급 사용</p>
              <p className="mt-1 text-xs text-slate-500">
                직업이 배정된 학생을 정해진 주기마다 자동 지급합니다.
              </p>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-5 w-5 rounded border-slate-300 accent-indigo-600"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-xs font-black text-slate-500">
              지급 주기
              <select
                value={numberOfWeeks}
                disabled={!enabled}
                onChange={(event) => setNumberOfWeeks(Number(event.target.value))}
                className="block w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {INTERVAL_OPTIONS.map((weeks) => (
                  <option key={weeks} value={weeks}>
                    {weeks}주마다
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-xs font-black text-slate-500">
              지급 요일
              <select
                value={dayOfWeek}
                disabled={!enabled}
                onChange={(event) => setDayOfWeek(event.target.value)}
                className="block w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {DAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-xs font-black text-slate-500">
              지급 시간
              <input
                type="time"
                value={time}
                disabled={!enabled}
                onChange={(event) => setTime(event.target.value)}
                className="block w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </label>

            <label className="space-y-2 text-xs font-black text-slate-500">
              첫 지급일
              <select
                value={firstPaymentDate}
                disabled={!enabled}
                onChange={(event) => setFirstPaymentDate(event.target.value)}
                className="block w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {selectablePaymentDates.map((dateKey) => (
                  <option key={dateKey} value={dateKey}>
                    {formatPaymentDateOption(dateKey)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-sm font-black text-slate-900">지급 대상</p>
              <p className="mt-1 text-xs text-slate-500">
                자동 지급 시점의 직업 배정을 기준으로 대상이 결정됩니다.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setTargetMode("all_jobs")}
                className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
                  targetMode === "all_jobs"
                    ? "border-indigo-300 bg-indigo-50 ring-2 ring-indigo-100"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <Users className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                <span>
                  <span className="block text-sm font-black text-slate-900">
                    직업 배정 학생 전체
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    현재 {targetCandidates.length}명
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTargetMode("selected_jobs")}
                className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
                  targetMode === "selected_jobs"
                    ? "border-indigo-300 bg-indigo-50 ring-2 ring-indigo-100"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <Briefcase className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                <span>
                  <span className="block text-sm font-black text-slate-900">
                    특정 직업의 학생
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    선택 직업 {selectedJobNames.length}개
                  </span>
                </span>
              </button>
            </div>

            {targetMode === "selected_jobs" ? (
              <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                {jobOptions.length > 0 ? (
                  jobOptions.map((jobName) => {
                    const isSelected = selectedJobNameSet.has(jobName);
                    return (
                      <button
                        key={jobName}
                        type="button"
                        onClick={() => toggleJobName(jobName)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                          isSelected
                            ? "border-indigo-500 bg-indigo-600 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200"
                        }`}
                      >
                        {jobName}
                      </button>
                    );
                  })
                ) : (
                  <span className="text-xs font-semibold text-slate-400">
                    선택할 수 있는 직업이 없습니다.
                  </span>
                )}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-900">다음 지급 미리보기</p>
                <p className="mt-1 text-sm font-bold text-indigo-700">
                  {enabled
                    ? `${numberOfWeeks}주마다 ${selectedDayLabel} ${time} · 첫 지급 ${formatPaymentDateOption(firstPaymentDate)}`
                    : "자동 지급을 사용하지 않음"}
                </p>
              </div>
              <Badge tone={enabled ? "indigo" : "slate"}>
                대상 {previewTargetCount}명
              </Badge>
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-500">
              {numberOfWeeks}주분 급여 · {payrollPeriodStartDate} ~ {payrollPeriodEndDate}
            </p>
          </div>

          <div className="flex gap-2 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs font-semibold leading-5 text-amber-800">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            자동 지급은 저장된 일정에 따라 실행되며, 성과급과 인센티브는 포함하지
            않습니다.
          </div>
        </form>
      </Modal.Body>

      <Modal.Footer>
        <div className="flex w-full gap-3">
          <Button
            kind="outline"
            tone="slate"
            fullWidth
            onClick={onClose}
            disabled={isSubmitting}
          >
            취소
          </Button>
          <Button
            type="submit"
            form="payroll-automation-settings-form"
            tone="blue"
            fullWidth
            disabled={!isTargetSelectionValid}
            isLoading={isSubmitting}
          >
            설정 저장
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
