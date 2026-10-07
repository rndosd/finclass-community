// src/pages/bank/bankadmin/components/BankOverviewFilters.jsx
import React from "react";
import { Button, InputField, SelectField } from "../../../../components/ui";
import { InformationCircleIcon } from "@heroicons/react/24/outline";

export default function BankOverviewFilters({
    qText,
    setQText,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    statusFilter,
    setStatusFilter,
    tab,
    onPreset,
    actions,
}) {
    // ✅ 예금 상태 옵션
    const savingsStatusOptions = [
        { value: 'all', label: '전체 상태' },
        { value: 'open', label: '활성·승인 대기' },
        { value: 'pending', label: '승인 대기' },
        { value: 'active', label: '진행 중' },
        { value: 'claimable', label: '수령 가능' },
        { value: 'completed', label: '수령 완료' },
        { value: 'terminated', label: '중도 해지' },
        { value: 'rejected', label: '승인 거절' },
    ];

    // ✅ 대출 상태 옵션
    const loansStatusOptions = [
        { value: 'all', label: '전체 상태' },
        { value: 'open', label: '미상환·승인 대기' },
        { value: 'pending', label: '승인 대기' },
        { value: 'ongoing', label: '상환 중' },
        { value: 'overdue', label: '연체' },
        { value: 'repaid', label: '상환 완료' },
        { value: 'rejected', label: '승인 거절' },
    ];

    const currentStatusOptions = tab === 'savings' ? savingsStatusOptions : loansStatusOptions;

    return (
        <div className="space-y-3">
            {/* 첫 번째 줄: 검색과 상태 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <InputField
                        label="검색"
                        placeholder="학생/상품명 검색"
                        value={qText}
                        onChange={(e) => setQText(e.target.value)}
                    />
                </div>
                <div>
                    <SelectField
                        label="상태"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        options={currentStatusOptions}
                    />
                </div>
            </div>

            {/* 두 번째 줄: 날짜 범위와 프리셋 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div className="grid grid-cols-2 gap-3 md:col-span-2">
                    <InputField
                        type="date"
                        label="시작 날짜부터"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                    />
                    <InputField
                        type="date"
                        label="시작 날짜까지"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                    />
                </div>
                <div className="flex gap-1">
                    <Button
                        type="button"
                        size="xs"
                        tone="slate"
                        kind="outline"
                        rounded="lg"
                        onClick={() => onPreset("30d")}
                    >
                        30일
                    </Button>
                    <Button
                        type="button"
                        size="xs"
                        tone="slate"
                        kind="outline"
                        rounded="lg"
                        onClick={() => onPreset("60d")}
                    >
                        60일
                    </Button>
                    <Button
                        type="button"
                        size="xs"
                        tone="slate"
                        kind="outline"
                        rounded="lg"
                        onClick={() => onPreset("90d")}
                    >
                        90일
                    </Button>
                </div>
            </div>

            {/* ✅ 날짜 기준 설명 */}
            <div className="flex flex-col gap-3 border-t border-slate-200 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-1 text-xs text-slate-500">
                <InformationCircleIcon className="h-4 w-4 shrink-0" />
                <span>예금/대출이 시작된 날짜 기준 (승인 대기 제외)</span>
              </div>
              {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
            </div>
        </div>
    );
}
