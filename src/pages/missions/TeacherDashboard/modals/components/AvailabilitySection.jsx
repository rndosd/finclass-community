// src/pages/missions/components/TeacherDashboard/modals/components/AvailabilitySection.jsx
import React, { useEffect } from "react";
import { Button } from "../../../../../components/ui";

const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];

const AvailabilitySection = ({
  // 👉 상시 기능 on/off (사용 안 함, 호환성 유지용)
  isActive = true,
  setIsActive,
  // 👉 학생 공개 여부 (실제 사용)
  availabilityStudentVisible = true,
  setAvailabilityStudentVisible,
  // 👉 요일
  availabilityDays = [],
  setAvailabilityDays,
  // 👉 시간대
  availabilityStartTime,
  setAvailabilityStartTime,
  availabilityEndTime,
  setAvailabilityEndTime,
  // 👉 1일 최대 횟수
  maxPerDay,
  setMaxPerDay,
}) => {
  // 기본값 월~금
  useEffect(() => {
    if (!availabilityDays?.length && setAvailabilityDays) {
      setAvailabilityDays([1, 2, 3, 4, 5]);
    }
  }, [availabilityDays, setAvailabilityDays]);

  const toggleDay = (d) => {
    if (!setAvailabilityDays) return;
    if (availabilityDays.includes(d)) {
      setAvailabilityDays(availabilityDays.filter((x) => x !== d));
    } else {
      setAvailabilityDays([...availabilityDays, d].sort());
    }
  };

  const handleVisibleToggle = () => {
    if (typeof setAvailabilityStudentVisible === "function") {
      setAvailabilityStudentVisible(!availabilityStudentVisible);
    }
  };

  return (
    <div className="space-y-4">
      {/* 0. 학생에게 표시 토글 */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-100 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-gray-800">
            학생에게 이 상시 과제 공개
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            끄면 교사 화면에는 남아 있고, 학생 앱에는 보이지 않습니다.
          </p>
        </div>
        <Button
          type="button"
          onClick={handleVisibleToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            availabilityStudentVisible ? "bg-emerald-500" : "bg-gray-300"
          }`}
          title={
            availabilityStudentVisible ? "학생에게 공개됨" : "학생에게 숨김"
          }
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              availabilityStudentVisible ? "translate-x-5" : "translate-x-1"
            }`}
          />
        </Button>
      </div>

      <div className="bg-gray-50 rounded-lg p-4 space-y-4">
        {/* 1. 요일 선택 */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-800">과제가 열릴 요일</p>
          <div className="grid grid-cols-7 gap-1.5">
            {dayLabels.map((label, idx) => {
              const on = availabilityDays.includes(idx);
              return (
                <Button
                  key={label}
                  type="button"
                  onClick={() => toggleDay(idx)}
                  className={`py-1.5 rounded-md text-sm border transition ${
                    on
                      ? "bg-blue-50 text-blue-700 border-blue-300"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-400">
            선택한 요일에만 학생들에게 과제가 표시됩니다.
          </p>
        </div>

        {/* 2. 시간대 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-gray-600">시작 시간</label>
            <input
              type="time"
              value={availabilityStartTime || ""}
              onChange={(e) => setAvailabilityStartTime?.(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-blue-200 text-sm focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-600">마감 시간</label>
            <input
              type="time"
              value={availabilityEndTime || ""}
              onChange={(e) => setAvailabilityEndTime?.(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-blue-200 text-sm focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* 3. 하루 제출 허용 개수 */}
        <div className="space-y-1">
          <label className="text-xs text-gray-600">하루 제출 허용 개수</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={maxPerDay ?? 1}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMaxPerDay?.(!v || v < 1 ? 1 : v);
              }}
              className="w-20 px-2 py-1 rounded border border-blue-200 text-sm"
            />
            <span className="text-xs text-gray-500">회까지</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AvailabilitySection;
