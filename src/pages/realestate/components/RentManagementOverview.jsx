import React, { useMemo, useState } from 'react';
import Button from '../../../components/ui/Button';
import RentContractSeatPicker from './RentContractSeatPicker';
import { getRentManagementStatus, matchesRentFilter, RENT_FILTERS } from '../utils/rentManagementStatus';

const RentManagementOverview = ({ groups = [], placementData, formatCurrency, onConfigure,
  selectedIds, onSelectionChange, filter, onFilterChange }) => {
  const [view, setView] = useState('board');
  const [focusedId, setFocusedId] = useState(null);
  const rows = useMemo(() => groups.flatMap((group) => group.desks || [])
    .filter((desk) => desk.isActive !== false)
    .map((desk) => ({ desk, ...getRentManagementStatus(desk) })), [groups]);
  const visible = rows.filter((row) => matchesRentFilter(row, filter));
  const visibleIds = new Set(visible.map((row) => row.desk.id));
  const selected = rows.filter((row) => selectedIds.has(row.desk.id));
  const eligibleSelected = selected.filter((row) => row.desk.studentId);
  const selectableVisibleIds = visible.filter((row) => row.desk.studentId).map((row) => row.desk.id);
  const visibleSelectedCount = selectableVisibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = selectableVisibleIds.length > 0 && visibleSelectedCount === selectableVisibleIds.length;
  const focused = rows.find((row) => row.desk.id === focusedId);
  const label = (desk) => desk.label || `${desk.number ?? '-'}번 자리`;
  const toggle = (id) => {
    setFocusedId(id);
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  };
  const configure = () => onConfigure(eligibleSelected.map((row) => row.desk.id), false);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
        상태
        <select aria-label="임대 현황 상태" value={filter} onChange={(event) => onFilterChange(event.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
          {RENT_FILTERS.map(([id, name]) => <option key={id} value={id}>{name} ({rows.filter((row) => matchesRentFilter(row, id)).length})</option>)}
        </select>
      </label>
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="임대 현황 보기 방식">
        <button type="button" aria-label="배치도 보기" aria-pressed={view === 'board'} onClick={() => setView('board')}
          className={`rounded-md px-3 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-blue-600 ${view === 'board' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>배치도</button>
        <button type="button" aria-label="목록 보기" aria-pressed={view === 'list'} onClick={() => setView('list')}
          className={`rounded-md px-3 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-blue-600 ${view === 'list' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>목록</button>
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <label className="flex cursor-pointer items-center gap-2 text-slate-600">
        <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={allVisibleSelected}
          disabled={!selectableVisibleIds.length}
          ref={(input) => { if (input) input.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected; }}
          onChange={(event) => {
            const next = new Set(selectedIds);
            selectableVisibleIds.forEach((id) => { if (event.target.checked) next.add(id); else next.delete(id); });
            onSelectionChange(next);
          }} />
        현재 조건 전체 선택
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-slate-700">선택 {selected.length}개</span>
        {selected.some((row) => !visibleIds.has(row.desk.id)) && <span className="text-xs text-amber-800">필터 밖 선택 포함</span>}
        {!!selected.length && <button type="button" onClick={() => onSelectionChange(new Set())}
          className="rounded px-2 py-1 text-xs text-slate-500 underline underline-offset-4 hover:text-slate-800 focus-visible:outline focus-visible:outline-blue-600">선택 해제</button>}
      </div>
    </div>
    <p className="text-sm text-slate-600">책상을 누르면 선택과 계약 상세를 확인합니다. 필터에 해당하지 않는 책상은 흐리게 표시됩니다.</p>
    {view === 'board' ? <RentContractSeatPicker groups={groups} placementData={placementData}
      selectableIds={visibleIds} selectedIds={selectedIds} onToggle={toggle}
      getDeskName={(desk) => { const row = rows.find((item) => item.desk.id === desk.id);
        return row.hasContract ? row.tenantName : desk.studentName || '미배정'; }}
      getDeskStatus={(desk) => { const row = rows.find((item) => item.desk.id === desk.id);
        const shortLabel = row.overdue ? '연체' : row.settlement ? '정산' : row.closed ? '종료' :
          row.expired ? '만료' : !row.hasContract ? '없음' : row.rent.isPendingStart ? '예정' :
            row.rent.isContractPaymentPending ? '납부 대기' : '진행 중';
        return { ...row.status, label: shortLabel, priceText: row.overdue ? formatCurrency(row.unpaidRentAmount) : '' }; }} /> :
      <div className="max-h-[340px] overflow-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm"><caption className="sr-only">자리별 임대 계약 현황</caption>
          <thead className="sticky top-0 bg-slate-100"><tr>{['선택', '자리 / 임차인', '상태 / 기간', '주 임대료', '미납 임대료', '보증금 납부 / 반환 필요'].map((name) => <th key={name} className="whitespace-nowrap p-3">{name}</th>)}</tr></thead>
          <tbody>{visible.map((row) => <tr key={row.desk.id} className={selectedIds.has(row.desk.id) ? 'bg-blue-50' : 'bg-white'}>
            <td className="p-3"><input type="checkbox" aria-label={`${label(row.desk)} 선택`} checked={selectedIds.has(row.desk.id)} onChange={() => toggle(row.desk.id)} /></td>
            <td className="p-3"><button type="button" onClick={() => setFocusedId(row.desk.id)} className="text-left font-bold text-blue-700">{label(row.desk)}</button><div>{row.hasContract ? row.tenantName : row.desk.studentName || '미배정'}</div>{row.mismatch && <div className="text-xs text-amber-800">현재 착석: {row.desk.studentName || '없음'}</div>}</td>
            <td className="p-3"><span className={row.overdue ? 'font-bold text-red-700' : 'font-bold'}>{row.status.label}</span><div className="whitespace-nowrap text-xs text-slate-600">{row.period}</div></td>
            <td className="p-3 whitespace-nowrap">{formatCurrency(row.weeklyRent)}</td>
            <td className="p-3 whitespace-nowrap"><span className={row.overdue ? 'font-bold text-red-700' : ''}>{formatCurrency(row.unpaidRentAmount)}</span>{row.overdue && <div className="text-xs text-red-700">{row.rent.overdueDays || 0}일 연체</div>}</td>
            <td className="p-3 whitespace-nowrap">{formatCurrency(row.depositPaid)} / {formatCurrency(row.expired || row.closed || row.returnPending ? row.depositOutstanding : 0)}</td>
          </tr>)}</tbody>
        </table>{!visible.length && <p className="p-6 text-center text-slate-500">해당 조건의 자리가 없습니다.</p>}
      </div>}
    {focused && <section aria-label="선택 자리 임대 상세" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="mb-2 font-bold">{label(focused.desk)} · {focused.status.label}</div>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {[
          ['임차인', focused.hasContract ? focused.tenantName : '계약 없음'],
          ['앉은 학생', focused.desk.studentName || '미배정'], ['소유자', focused.desk.ownerName || '국가'],
          ['계약 기간', focused.period], ['주 임대료', formatCurrency(focused.weeklyRent)],
          ['남은 기간', focused.daysRemaining == null ? '기간 확인 필요' : focused.expired ? '만료' : `${focused.daysRemaining}일`],
          ['미납 임대료', `${formatCurrency(focused.unpaidRentAmount)}${focused.overdue ? ` · ${focused.rent.overdueDays || 0}일 연체` : ''}`],
          ['보증금 납부', formatCurrency(focused.depositPaid)], ['보증금 미납', formatCurrency(focused.depositUnpaid)],
          ['반환 필요 보증금', formatCurrency(focused.expired || focused.closed || focused.returnPending ? focused.depositOutstanding : 0)],
          ['선납 임대료 반환 예상', formatCurrency(focused.prepaidRefund)],
        ].map(([name, value]) => <div key={name}><dt className="text-xs text-slate-500">{name}</dt><dd className="mt-1 font-bold">{value}</dd></div>)}
      </dl>
      {focused.mismatch && <p className="mt-3 text-amber-800">계약 임차인과 앉은 학생이 다릅니다. 기존 임차인의 계약을 먼저 확인하세요.</p>}
    </section>}
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
      <Button disabled={!eligibleSelected.length} onClick={configure}>선택 {eligibleSelected.length}개 계약 관리</Button>
      {selected.length !== eligibleSelected.length && <span className="text-xs text-slate-500">학생이 없는 자리는 계약 설정 대상에서 제외됩니다.</span>}
    </div>
    <p className="text-xs text-slate-500">현황 금액은 현재 기록 기준입니다. 실제 반환금과 처리 가능 여부는 정산 미리보기에서 서버가 확인합니다.</p>
  </div>;
};

export default RentManagementOverview;
