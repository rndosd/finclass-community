import React, { Fragment } from "react";
import { Listbox, Transition } from "@headlessui/react";
import {
  FunnelIcon,
  CheckCircleIcon,
  ChevronUpDownIcon,
  CalendarIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { Button, InputField } from "../../../components/ui";

const STATUS_OPTIONS = [
  { key: "pending", label: "승인대기" },
  { key: "active", label: "진행중" },
  { key: "completed", label: "수령완료" },
  { key: "terminated", label: "중도해지" },
  { key: "cancelled_request", label: "신청취소" },
  { key: "rejected", label: "승인거절" },
];

export default function DepositHistoryFilterBar({
  selectedStatuses = [],
  onStatusChange, // 🚀 부모의 setSelectedStatuses를 그대로 받습니다.
  onClearFilters,
  startDate,
  endDate,
  onChangeStartDate,
  onChangeEndDate,
  filteredCount,
  totalCount,
}) {
  const hasActiveFilters = selectedStatuses.length > 0 || startDate || endDate;

  return (
    <div className="mb-6 space-y-3 relative z-50">
      {/* 1. 상단 정보 및 초기화 */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-slate-500 font-bold text-[11px]">
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 rounded-md">
            <FunnelIcon className="w-3 h-3" />
            검색 {filteredCount} / 전체 {totalCount}
          </div>
        </div>

        {hasActiveFilters && (
          <Button
            icon={ArrowPathIcon}
            size="xs"
            tone="red"
            kind="ghost"
            rounded="lg"
            onClick={onClearFilters}
          >
            필터 초기화
          </Button>
        )}
      </div>

      {/* 2. 필터 입력 영역 */}
      <div className="grid grid-cols-12 gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-sm overflow-visible">
        {/* 상태 필터 (Listbox) */}
        <div className="col-span-12 sm:col-span-4 relative">
          <Listbox value={selectedStatuses} onChange={onStatusChange} multiple>
            <div className="relative h-full">
              <Listbox.Button className="relative w-full h-full min-h-[38px] cursor-pointer rounded-lg bg-slate-50 py-2 pl-3 pr-10 text-left text-xs font-black text-slate-700 hover:bg-slate-100 transition-colors border-none">
                <span className="block truncate">
                  {selectedStatuses.length > 0
                    ? `상태 ${selectedStatuses.length}개 선택`
                    : "모든 상태 보기"}
                </span>
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                  <ChevronUpDownIcon className="h-4 w-4 text-slate-400" />
                </span>
              </Listbox.Button>

              <Transition
                as={Fragment}
                leave="transition ease-in duration-100"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                <Listbox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-xl bg-white py-1 text-xs shadow-2xl border border-slate-200 z-[100] focus:outline-none">
                  {STATUS_OPTIONS.map((option) => (
                    <Listbox.Option
                      key={option.key}
                      value={option.key}
                      className={({ active }) =>
                        `relative cursor-pointer select-none py-2.5 pl-10 pr-4 transition-colors ${
                          active ? "bg-blue-50 text-blue-700" : "text-slate-700"
                        }`
                      }
                    >
                      {({ selected }) => (
                        <>
                          <span
                            className={`block truncate ${selected ? "font-black text-blue-600" : "font-medium"}`}
                          >
                            {option.label}
                          </span>
                          {selected && (
                            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600">
                              <CheckCircleIcon className="h-4 w-4" />
                            </span>
                          )}
                        </>
                      )}
                    </Listbox.Option>
                  ))}
                </Listbox.Options>
              </Transition>
            </div>
          </Listbox>
        </div>

        {/* 날짜 필터 (그리드) */}
        <div className="col-span-12 sm:col-span-8 grid grid-cols-2 gap-2">
          <div className="relative flex items-center h-full">
            <div className="absolute left-3 pointer-events-none">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <InputField
              type="date"
              value={startDate || ""}
              onChange={(e) => onChangeStartDate(e.target.value)}
              tone="blue"
              size="sm"
              wrapperClassName="w-full space-y-0"
              className="h-full min-h-[38px] border-none bg-slate-50 pl-9 pr-2 text-xs font-black text-slate-700"
            />
          </div>
          <div className="relative flex items-center h-full">
            <div className="absolute left-3 pointer-events-none">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <InputField
              type="date"
              value={endDate || ""}
              onChange={(e) => onChangeEndDate(e.target.value)}
              tone="blue"
              size="sm"
              wrapperClassName="w-full space-y-0"
              className="h-full min-h-[38px] border-none bg-slate-50 pl-9 pr-2 text-xs font-black text-slate-700"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
