// src/pages/missions/components/TeacherDashboard/MissionView/modals/components/AdvancedSection.jsx
import React from "react";
import { Button, ToggleSwitch } from "../../../../../components/ui";

const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];

const AdvancedSection = ({
    // progress (challenge)
    isChallenge,
    goalCount,
    intervalDays,
    intervalHours,
    setIsChallenge,
    setGoalCount,
    setIntervalDays,
    setIntervalHours,
    approvalPolicy,

    // repeat
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

    // 편집 모드
    isEdit = false,

    // layout flags
    showRepeat = true,
    showChallenge = true,
}) => {
    const toggleDay = (d) => {
        if (repeatDays.includes(d)) setRepeatDays(repeatDays.filter((x) => x !== d));
        else setRepeatDays([...repeatDays, d].sort());
    };

    return (
        <div className="space-y-6">
            {/* 반복 설정 */}
            {showRepeat && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <h4 className="text-base font-semibold text-gray-900">반복 설정</h4>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-gray-800">반복으로 생성하기</span>
                                    {isEdit && (
                                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">
                                            생성 시에만
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-gray-600">
                                    지정한 기간과 요일에 동일 조건의 과제를 일괄 생성합니다.
                                </p>
                            </div>
                            <ToggleSwitch
                                checked={repeatOn}
                                onChange={setRepeatOn}
                                disabled={isEdit}
                                tone="blue"
                                srLabel="반복 과제"
                            />
                        </div>

                        {repeatOn && !isEdit && (
                            <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
                                {/* 기간 */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <label className="flex items-center text-sm font-medium text-gray-700">
                                            <span className="text-red-500 mr-1">*</span> 시작일
                                        </label>
                                        <input
                                            type="date"
                                            className="w-full px-3 py-2 rounded-xl border border-blue-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm"
                                            value={repeatStartDate}
                                            onChange={(e) => setRepeatStartDate(e.target.value)}
                                            required={repeatOn}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-medium text-gray-700">종료일 (선택)</label>
                                        <input
                                            type="date"
                                            className="w-full px-3 py-2 rounded-xl border border-blue-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm"
                                            value={repeatEndDate}
                                            onChange={(e) => setRepeatEndDate(e.target.value)}
                                            min={repeatStartDate}
                                        />
                                    </div>
                                </div>

                                {/* 요일 */}
                                <div className="space-y-2">
                                    <label className="flex items-center text-sm font-medium text-gray-700">
                                        <span className="text-red-500 mr-1">*</span> 반복 요일
                                    </label>
                                    <div className="grid grid-cols-7 gap-1.5">
                                        {dayLabels.map((label, idx) => {
                                            const d = idx;
                                            const on = repeatDays.includes(d);
                                            const isWeekend = d === 0 || d === 6;
                                            return (
                                                <Button
                                                    type="button"
                                                    key={label}
                                                    onClick={() => toggleDay(d)}
                                                    className={`py-2 px-1 rounded-lg border font-medium text-sm transition-all ${on
                                                            ? isWeekend
                                                                ? "bg-red-50 text-red-700 border-red-300"
                                                                : "bg-blue-50 text-blue-700 border-blue-300"
                                                            : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                                                        }`}
                                                >
                                                    {label}
                                                </Button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* 시간 설정 */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <label className="flex items-center text-sm font-medium text-gray-700">
                                            <span className="text-red-500 mr-1">*</span> 시작 시간
                                        </label>
                                        <input
                                            type="time"
                                            className="w-full px-3 py-2 rounded-xl border border-blue-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm"
                                            value={repeatStartTime || "09:00"}
                                            onChange={(e) => setRepeatStartTime(e.target.value)}
                                            required={repeatOn}
                                        />
                                        <p className="text-xs text-gray-500">
                                            반복되는 모든 날짜에 적용
                                        </p>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <label className="block text-sm font-medium text-gray-700">마감 시간</label>
                                            <label className="inline-flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={repeatNoEndTime}
                                                    onChange={(e) => setRepeatNoEndTime(e.target.checked)}
                                                    className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                                                />
                                                <span>없음</span>
                                            </label>
                                        </div>
                                        <input
                                            type="time"
                                            className="w-full px-3 py-2 rounded-xl border border-blue-200 disabled:bg-gray-100 disabled:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm"
                                            value={repeatNoEndTime ? "" : (repeatEndTime || "18:00")}
                                            onChange={(e) => setRepeatEndTime(e.target.value)}
                                            disabled={repeatNoEndTime}
                                        />
                                        {!repeatNoEndTime && (
                                            <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={repeatEndNextDay}
                                                    onChange={(e) => setRepeatEndNextDay(e.target.checked)}
                                                    className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                                                />
                                                <span>다음날</span>
                                            </label>
                                        )}
                                        {repeatNoEndTime && (
                                            <p className="text-xs text-blue-700">상시 진행</p>
                                        )}
                                    </div>
                                </div>

                                <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                                    <p className="text-xs text-blue-700">
                                        선택한 날짜마다 위 시간으로 과제가 생성됩니다. 각 과제는 독립적으로 수정/삭제 가능합니다.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 챌린지(누적형) */}
            {showChallenge && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                        </svg>
                        <h4 className="text-base font-semibold text-gray-900">과제 종류</h4>
                        <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full font-medium">
                            개발중
                        </span>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-gray-800">챌린지(누적형) 과제</span>
                                </div>
                                <p className="text-xs text-gray-600">
                                    목표 횟수 달성 시 완주로 처리됩니다. 현재 처리:{" "}
                                    <span className="font-medium text-red-600">
                                        {approvalPolicy === "auto" ? "자동(제출 즉시 +1)" : "승인 후(승인 시 +1)"}
                                    </span>
                                </p>
                            </div>
                            <ToggleSwitch
                                checked={isChallenge}
                                onChange={setIsChallenge}
                                tone="rose"
                                srLabel="챌린지 과제"
                            />
                        </div>

                        {isChallenge && (
                            <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="space-y-2">
                                        <label className="block text-sm font-medium text-gray-700">목표 횟수</label>
                                        <input
                                            type="number"
                                            min="1"
                                            className="w-full px-3 py-2 rounded-xl border border-blue-200 focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-colors placeholder-gray-400 text-sm"
                                            placeholder="예) 5회"
                                            value={goalCount}
                                            onChange={(e) => setGoalCount(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-medium text-gray-700">간격(일)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            className="w-full px-3 py-2 rounded-xl border border-blue-200 focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-colors text-sm"
                                            value={intervalDays}
                                            onChange={(e) => setIntervalDays(e.target.value)}
                                            placeholder="0"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-medium text-gray-700">간격(시)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            max="23"
                                            className="w-full px-3 py-2 rounded-xl border border-blue-200 focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-colors text-sm"
                                            value={intervalHours}
                                            onChange={(e) => setIntervalHours(e.target.value)}
                                            placeholder="0"
                                        />
                                    </div>
                                </div>

                                <div className="text-xs text-gray-500">
                                    <p>예) 1일+0시간 → 하루 1회 | 0일+6시간 → 6시간마다 1회</p>
                                </div>

                                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg">
                                    <p className="text-xs text-red-700">
                                        간격은 마지막 <b>{approvalPolicy === "auto" ? "제출 처리" : "승인"}</b> 시각 기준으로 산정됩니다.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdvancedSection;
