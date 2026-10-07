import React from "react";
import { FilterDateInput, FilterSearchInput } from "../../../components/ui";
import { formatDateKeyInKST, getRecentDateRangeInKST } from "../../../utils/kstDate";

const toLocalYMD = (date) => formatDateKeyInKST(date);

export const oneWeekAgo = () => getRecentDateRangeInKST({ days: 7 }).startDate;

export const todayYMD = () => toLocalYMD(new Date());

export default function StoreDateRangeFilter({
  startDate,
  endDate,
  onChangeStart,
  onChangeEnd,
  searchQuery,
  onSearchChange,
  onEnter,
  showSearch = true,
}) {
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <FilterDateInput
            value={startDate}
            onChange={(event) => onChangeStart(event.target.value)}
            onEnterApply={onEnter}
            tone="indigo"
          />
        </div>
        <span className="text-slate-400 font-medium">~</span>
        <div className="flex-1">
          <FilterDateInput
            value={endDate}
            onChange={(event) => onChangeEnd(event.target.value)}
            onEnterApply={onEnter}
            tone="indigo"
          />
        </div>
      </div>

      {showSearch ? (
        <FilterSearchInput
          placeholder="학생 이름 또는 상품명으로 검색..."
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          onEnterApply={onEnter}
          tone="indigo"
        />
      ) : null}
    </div>
  );
}
