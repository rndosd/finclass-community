import React from "react";
import { Calendar, RotateCcw } from "lucide-react";
import { getRecentDateRangeInKST, parseDateKeyAsKST } from "../../utils/kstDate";

const fmt = (d) => {
    if (!d) return "";
    const date = d instanceof Date ? d : new Date(d);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
};

/**
 * 재사용 가능한 날짜 범위 필터
 *
 * props:
 * - value: { start: Date, end: Date }         // 필수(제어 컴포넌트)
 * - onChange: (next) => void                  // 필수
 * - minDate?: Date
 * - maxDate?: Date
 * - title?: string                            // "조회 기간" 등
 * - description?: string                      // 서브텍스트
 * - className?: string
 * - showReset?: boolean                       // 초기화 버튼 보일지
 * - onReset?: () => void                      // 초기화 핸들러(없으면 기본 14일)
 * - presets?: Array<{ label: string, days: number }>
 * - rightSlot?: ReactNode                      // 우측에 버튼 그룹 등 꽂기
 * - size?: "sm" | "md"                        // 인풋 크기
 */
const DateRangeFilter = ({
    value,
    onChange,
    minDate,
    maxDate,
    title = "기간 선택",
    description = "최근 활동을 날짜 범위로 필터링합니다",
    className = "",
    showReset = true,
    onReset,
    presets = [
        { label: "7일", days: 7 },
        { label: "14일", days: 14 },
        { label: "30일", days: 30 },
    ],
    rightSlot,
    size = "md",
}) => {
    const inputSize = size === "sm" ? "w-[130px] px-2 py-1.5 text-xs rounded-md" : "w-[170px] px-3 py-2 text-sm rounded-lg";

    const updateStart = (d) => onChange({ ...value, start: d });
    const updateEnd = (d) => onChange({ ...value, end: d });

    const handleReset = () => {
        if (onReset) return onReset();
        const next = getRecentDateRangeInKST({ days: 14 });
        onChange({
            start: parseDateKeyAsKST(next.startDate),
            end: parseDateKeyAsKST(next.endDate, { endOfDay: true }),
        });
    };

    const applyPreset = (days) => {
        const next = getRecentDateRangeInKST({ days });
        onChange({
            start: parseDateKeyAsKST(next.startDate),
            end: parseDateKeyAsKST(next.endDate, { endOfDay: true }),
        });
    };

    return (
        <div
            className={[
                "w-full rounded-2xl border border-slate-200/70 bg-white/70",
                "backdrop-blur-sm shadow-sm p-3 sm:p-4",
                className,
            ].join(" ")}
        >
            {/* 헤더 */}
            {(title || description) && (
                <div className="flex items-center gap-2 mb-3">
                    <div className="p-2 rounded-xl bg-indigo-50 border border-indigo-100">
                        <Calendar className="w-4 h-4 text-indigo-600" />
                    </div>
                    <div>
                        {title && <p className="text-sm font-semibold text-slate-800">{title}</p>}
                        {description && <p className="text-xs text-slate-500">{description}</p>}
                    </div>
                    <div className="ml-auto">{rightSlot}</div>
                </div>
            )}

            {/* 컨트롤 바 */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                {/* 좌: 날짜 인풋 + 프리셋 */}
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="date"
                        aria-label="시작일"
                        value={fmt(value?.start)}
                        min={fmt(minDate)}
                        max={fmt(maxDate)}
                        onChange={(e) => updateStart(new Date(e.target.value))}
                        className={[
                            inputSize,
                            "bg-white border border-slate-300",
                            "focus:outline-none focus:ring-0 focus:border-indigo-500",
                            "disabled:opacity-60",
                        ].join(" ")}
                    />
                    <span className="text-slate-400 font-medium">~</span>
                    <input
                        type="date"
                        aria-label="종료일"
                        value={fmt(value?.end)}
                        min={fmt(minDate)}
                        max={fmt(maxDate)}
                        onChange={(e) => updateEnd(new Date(e.target.value))}
                        className={[
                            inputSize,
                            "bg-white border border-slate-300",
                            "focus:outline-none focus:ring-0 focus:border-indigo-500",
                            "disabled:opacity-60",
                        ].join(" ")}
                    />

                    {/* 프리셋 칩 */}
                    {presets?.length > 0 && (
                        <div className="flex items-center gap-1 ml-1">
                            {presets.map((p) => (
                                <button
                                    key={p.label}
                                    type="button"
                                    onClick={() => applyPreset(p.days)}
                                    className="px-2.5 py-1 text-xs rounded-full border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 active:bg-slate-100"
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* 우: 리셋 */}
                <div className="sm:ml-auto">
                    {showReset && (
                        <button
                            type="button"
                            onClick={handleReset}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 active:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-colors"
                        >
                            <RotateCcw className="w-4 h-4 text-slate-500" />
                            초기화
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DateRangeFilter;
