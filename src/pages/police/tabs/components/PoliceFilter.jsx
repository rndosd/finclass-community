import React from "react";
import { FilterDateInput, FilterSearchInput } from "../../../../components/ui";

const PoliceFilter = ({
  tempFilters = {},
  filters = {},
  setTempFilters,
  onFiltersChange,
  onEnter,
}) => {
  const currentFilters = Object.keys(tempFilters).length > 0 ? tempFilters : filters;
  const update = setTempFilters || onFiltersChange;

  const handleChange = (key, value) => {
    update?.((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <FilterDateInput
            aria-label="경찰 내역 시작일"
            value={currentFilters?.dateStart || ""}
            onChange={(event) => handleChange("dateStart", event.target.value)}
            onEnterApply={onEnter}
            tone="indigo"
          />
        </div>
        <span className="text-slate-400 font-medium">~</span>
        <div className="flex-1">
          <FilterDateInput
            aria-label="경찰 내역 종료일"
            value={currentFilters?.dateEnd || ""}
            onChange={(event) => handleChange("dateEnd", event.target.value)}
            onEnterApply={onEnter}
            tone="indigo"
          />
        </div>
      </div>

      <FilterSearchInput
        aria-label="학생 이름 검색"
        placeholder="검색어를 입력하세요..."
        value={currentFilters?.studentName || ""}
        onChange={(event) => handleChange("studentName", event.target.value)}
        onEnterApply={onEnter}
        tone="indigo"
      />
    </div>
  );
};

export default PoliceFilter;
