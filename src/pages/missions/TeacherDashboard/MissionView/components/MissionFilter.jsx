// src/pages/missions/components/TeacherDashboard/MissionView/components/MissionFilter.jsx
import React from "react";
import { Calendar, RotateCcw, Filter, FileText } from "lucide-react";
import { getRecentDateRangeInKST } from "../../../../../utils/kstDate";
import { Button } from "../../../../../components/ui";

/**
 * MissionFilter 완성본
 * - 날짜 입력창에 기본값(30일 전 ~ 오늘)이 즉시 표시됨
 * - FinClass Modern Tones 디자인 적용
 */
const MissionFilter = ({
  customRange,
  onCustomRangeChange,
  totalCount,
  visibleInStudentViewCount,
}) => {
  // 초기화 핸들러: 다시 '최근 30일' 범위로 리셋
  const handleReset = () => {
    const next = getRecentDateRangeInKST({ days: 30 });
    onCustomRangeChange({ start: next.startDate, end: next.endDate });
  };

  return (
    <div className="mb-6 space-y-2 relative z-10 animate-in fade-in slide-in-from-top-1 duration-300">
      {/* 1. 상단 상태 바 (뱃지 스타일) */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-md text-[11px] font-bold text-slate-500 border border-slate-200">
            <Filter className="w-3 h-3" />
            검색 {totalCount}
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 rounded-md text-[11px] font-bold text-blue-600 border border-blue-100">
            <FileText className="w-3 h-3" />
            표시 {visibleInStudentViewCount}
          </div>
        </div>

        {/* 초기화 버튼 */}
        <Button tone="rose" kind="ghost" size="xs"
          onClick={handleReset}
          className="flex items-center gap-1 transition-colors"
          title="최근 30일 범위로 초기화"
        >
          <RotateCcw className="w-3 h-3" />
          범위 초기화
        </Button>
      </div>

      {/* 2. 날짜 입력 컨트롤 영역 */}
      <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          {/* 시작일 (30일 전 기본값) */}
          <div className="relative flex items-center h-full group">
            <div className="absolute left-3 pointer-events-none text-slate-400 group-focus-within:text-blue-500 transition-colors">
              <Calendar className="w-3.5 h-3.5" />
            </div>
            <input
              type="date"
              value={customRange?.start || ""}
              onChange={(e) =>
                onCustomRangeChange({ ...customRange, start: e.target.value })
              }
              className="w-full h-[40px] bg-slate-50 border-none rounded-xl pl-9 pr-3 text-xs font-black text-slate-700 outline-none focus:ring-1 focus:ring-blue-200 transition-all cursor-pointer"
            />
          </div>

          {/* 종료일 (오늘 날짜 기본값) */}
          <div className="relative flex items-center h-full group">
            <div className="absolute left-3 pointer-events-none text-slate-400 group-focus-within:text-blue-500 transition-colors">
              <Calendar className="w-3.5 h-3.5" />
            </div>
            <input
              type="date"
              value={customRange?.end || ""}
              onChange={(e) =>
                onCustomRangeChange({ ...customRange, end: e.target.value })
              }
              className="w-full h-[40px] bg-slate-50 border-none rounded-xl pl-9 pr-3 text-xs font-black text-slate-700 outline-none focus:ring-1 focus:ring-blue-200 transition-all cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* 하단 캡션 */}
      <div className="px-1 text-[10px] text-slate-400 flex items-center gap-1 font-medium">
        <span>• 최대 60일까지 설정 가능합니다.</span>
      </div>
    </div>
  );
};

export default MissionFilter;
