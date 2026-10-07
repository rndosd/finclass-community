import React from 'react';

/**
 * 요일 선택 버튼 그룹
 * @param {string[]} selectedDays - 선택된 요일 배열
 * @param {(day: string) => void} onToggle - 요일 클릭 시 실행할 콜백
 */
const DayPicker = ({ selectedDays, onToggle }) => {
    const weekdays = ['월', '화', '수', '목', '금', '토', '일'];

    return (
        <div className="flex flex-wrap gap-2">
            {weekdays.map(day => {
                const isSelected = selectedDays.includes(day);
                return (
                    <button
                        key={day}
                        type="button"
                        className={`px-3 py-1 rounded-full text-sm border transition ${isSelected
                                ? 'bg-indigo-500 text-white border-indigo-500'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                            }`}
                        onClick={() => onToggle(day)}
                    >
                        {day}
                    </button>
                );
            })}
        </div>
    );
};

export default DayPicker;
