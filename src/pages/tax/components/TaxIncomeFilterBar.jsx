import React, { useMemo, useEffect, useState } from 'react';
import { Filter, Calendar, RefreshCw } from 'lucide-react';
import Button from '../../../components/ui/Button';
import InputField from '../../../components/ui/InputField';
import SelectField from '../../../components/ui/SelectField';
import { runFilterApplyOnEnter } from '../../../components/ui/FilterControls';
import { getFilterOptions } from '../constants/taxIncomeConstants';

export default function TaxIncomeFilterBar({
    filter = 'all',
    onFilterChange,
    startDate,
    endDate,
    onDateChange,
    currencyUnit = '화폐',
    onRefresh,
    onEnter, // ✅ 부모의 조회 함수를 호출하기 위한 prop
    className = '',
    showQuickButtons = false,
}) {
    const options = useMemo(() => getFilterOptions(currencyUnit), [currencyUnit]);

    const [localStart, setLocalStart] = useState(startDate || '');
    const [localEnd, setLocalEnd] = useState(endDate || '');

    useEffect(() => setLocalStart(startDate || ''), [startDate]);
    useEffect(() => setLocalEnd(endDate || ''), [endDate]);

    const handleDateChange = (type, value) => {
        if (type === 'start') {
            setLocalStart(value);
            onDateChange?.({ startDate: value, endDate: localEnd });
        } else {
            setLocalEnd(value);
            onDateChange?.({ startDate: localStart, endDate: value });
        }
    };

    // ✅ 엔터 입력 시 달력이 다시 열리는 브라우저 기본 동작 차단
    const handleKeyDown = (e) => {
        runFilterApplyOnEnter(e, onEnter, { blur: true });
    };

    return (
        <div className={`p-5 space-y-5 bg-white ${className}`}>
            <div className="flex flex-wrap items-center gap-6">
                {/* 1) 출처 필터 */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-slate-500">
                        <Filter className="h-4 w-4" />
                        <span className="text-xs font-black uppercase tracking-tight">구분</span>
                    </div>
                    <SelectField
                        value={filter}
                        onChange={(e) => onFilterChange?.(e.target.value)}
                        className="min-w-[120px] rounded-lg bg-slate-50 py-2 text-sm font-bold"
                        options={options.map((opt) => ({ value: opt.key, label: opt.label }))}
                    />
                </div>

                {/* 2) 날짜 기간 설정 */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-slate-500">
                        <Calendar className="h-4 w-4" />
                        <span className="text-xs font-black uppercase tracking-tight">기간 선택</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <InputField
                            type="date"
                            value={localStart}
                            onChange={(e) => handleDateChange('start', e.target.value)}
                            onKeyDown={handleKeyDown}
                            tone="emerald"
                            size="sm"
                            wrapperClassName="space-y-0"
                            className="rounded-lg bg-slate-50 text-sm font-bold"
                        />
                        <span className="text-slate-300 font-bold">~</span>
                        <InputField
                            type="date"
                            value={localEnd}
                            onChange={(e) => handleDateChange('end', e.target.value)}
                            onKeyDown={handleKeyDown}
                            tone="emerald"
                            size="sm"
                            wrapperClassName="space-y-0"
                            className="rounded-lg bg-slate-50 text-sm font-bold"
                        />
                    </div>
                </div>

                {/* 3) 새로고침 버튼 */}
                <div className="flex items-center gap-2 ml-auto">
                    <Button
                        type="button"
                        onClick={onRefresh}
                        icon={RefreshCw}
                        size="xs"
                        tone="blue"
                        kind="soft"
                        rounded="lg"
                    >
                        새로고침
                    </Button>
                </div>
            </div>
        </div>
    );
}
