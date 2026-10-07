import { appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Users,
  Wallet,
} from 'lucide-react';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { useUser } from '../../../contexts/UserContext';
import {
  formatDateKeyInKST,
  parseDateKeyAsKST,
  startOfDayInKST,
} from '../../../utils/kstDate';
import RentContractSeatPicker from '../components/RentContractSeatPicker';
import RentManagementOverview from '../components/RentManagementOverview';
import { createRealEstateClientRequestId, updateRealEstateRentContractsBulkAPI } from '../services/realEstateService';

const OWNERSHIP_FILTERS = [
  { id: 'state', label: '국유지' },
  { id: 'all', label: '전체' },
  { id: 'owned', label: '개인 소유' },
];

const getDeskLabel = (desk) => desk?.label || `${desk?.number ?? '-'}번 자리`;

const matchesOwnershipFilter = (desk, filterMode) => {
  if (filterMode === 'state') return !desk?.ownerId;
  if (filterMode === 'owned') return !!desk?.ownerId;
  return true;
};

const BulkRentContractModal = ({
  isOpen,
  onClose,
  groups,
  placementData,
  classId,
  systemEnabled = true,
  onContractsUpdated,
  initialView = 'overview',
  ...modalProps
}) => {
  const { showFeedback } = useFeedback();
  const { formatCurrency, isTeacher, isAdmin } = useUser();
  const [screen, setScreen] = useState(initialView);
  const [statusFilter, setStatusFilter] = useState('all');
  const [lastResult, setLastResult] = useState('');

  const [contractAction, setContractAction] = useState('set');
  const [weeklyRentInput, setWeeklyRentInput] = useState('');
  const [depositInput, setDepositInput] = useState('0');
  const [startDateInput, setStartDateInput] = useState('');
  const [lastDateInput, setLastDateInput] = useState('');
  const [ownershipFilter, setOwnershipFilter] = useState('state');
  const [targetMode, setTargetMode] = useState('all');
  const [selectedDesks, setSelectedDesks] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [settleExpiredContracts, setSettleExpiredContracts] = useState(false);
  const [allowSystemCoverage, setAllowSystemCoverage] = useState(false);
  const [settlementPreview, setSettlementPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const settlementOperation = useRef(null);
  const currentPreviewKey = useRef('');

  const eligibleDesks = useMemo(() => {
    const desks = [];
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      (group?.desks || []).forEach((desk) => {
        if (desk?.isActive === false || !desk?.studentId) return;
        if (!matchesOwnershipFilter(desk, ownershipFilter)) return;
        desks.push({
          ...desk,
          groupName: group?.name || '',
          label: getDeskLabel(desk),
        });
      });
    });
    return desks;
  }, [groups, ownershipFilter]);

  const allDeskIdSet = useMemo(
    () => new Set(eligibleDesks.map((desk) => desk.id)),
    [eligibleDesks],
  );

  const targetDesks = useMemo(() => {
    if (targetMode === 'all') return eligibleDesks;
    return eligibleDesks.filter((desk) => selectedDesks.has(desk.id));
  }, [eligibleDesks, selectedDesks, targetMode]);

  const selectedCount = targetDesks.length;
  const hasWeeklyRentInput = weeklyRentInput.trim() !== '';
  const normalizedWeeklyRent = contractAction === 'clear' ? 0 : Math.max(0, Math.floor(Number(weeklyRentInput) || 0));
  const normalizedDeposit = Math.max(0, Math.floor(Number(depositInput) || 0));
  const allSelected = eligibleDesks.length > 0 && selectedDesks.size === eligibleDesks.length;
  const configuredDeskCount = targetDesks.filter(
    (desk) => desk?.rentContractId && desk?.rentStartAt && desk?.rentLastDateAt,
  ).length;
  const needsSettlement = contractAction === 'set' && settleExpiredContracts;
  const previewKey = JSON.stringify({ classId, contractAction, settleExpiredContracts, allowSystemCoverage,
    weeklyRentInput, depositInput, startDateInput, lastDateInput, targets: targetDesks });
  currentPreviewKey.current = previewKey;
  const currentPreview = settlementPreview?.key === previewKey ? settlementPreview : null;
  const validConditions = systemEnabled && selectedCount > 0 && (contractAction === 'clear' || (
    hasWeeklyRentInput && Number.isSafeInteger(Number(weeklyRentInput)) && normalizedWeeklyRent > 0 &&
    Number.isSafeInteger(Number(depositInput)) && Number(depositInput) >= 0 &&
    startDateInput && lastDateInput && lastDateInput >= startDateInput
  ));

  useEffect(() => {
    if (screen !== 'settings') return;
    setSelectedDesks((prev) => {
      const next = new Set([...prev].filter((deskId) => allDeskIdSet.has(deskId)));
      return next.size === prev.size ? prev : next;
    });
  }, [allDeskIdSet, screen]);

  const resetState = () => {
    setContractAction('set');
    setWeeklyRentInput('');
    setDepositInput('0');
    setStartDateInput('');
    setLastDateInput('');
    setOwnershipFilter('state');
    setTargetMode('all');
    setSelectedDesks(new Set());
    setSettleExpiredContracts(false);
    setAllowSystemCoverage(false);
    setSettlementPreview(null);
    settlementOperation.current = null;
  };

  const handleClose = () => {
    if (loading || previewLoading) return;
    resetState();
    setScreen(initialView);
    setStatusFilter('all');
    setLastResult('');
    onClose();
  };

  const handleSettingsClose = () => {
    if (loading || previewLoading) return;
    if (initialView === 'settings') handleClose();
    else setScreen('overview');
  };

  const toggleDeskSelection = (deskId, forceMode = null) => {
    if (!allDeskIdSet.has(deskId)) return;

    setSelectedDesks((prev) => {
      const next = new Set(prev);
      const isSelected = next.has(deskId);
      const shouldSelect =
        forceMode === 'select'
          ? true
          : forceMode === 'deselect'
            ? false
            : !isSelected;

      if (shouldSelect) next.add(deskId);
      else next.delete(deskId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedDesks(new Set());
      return;
    }
    setSelectedDesks(new Set(eligibleDesks.map((desk) => desk.id)));
  };

  const handlePreviewSettlement = async () => {
    if (!needsSettlement || !validConditions || loading || previewLoading) return;
    const key = previewKey;
    if (settlementOperation.current?.key !== key) {
      settlementOperation.current = { key, id: createRealEstateClientRequestId() };
    }
    const clientRequestId = settlementOperation.current.id;
    setSettlementPreview(null);
    setPreviewLoading(true);
    try {
      const result = await updateRealEstateRentContractsBulkAPI({ classId,
        deskIds: targetDesks.map((desk) => desk.id), weeklyRent: normalizedWeeklyRent, depositAmount: normalizedDeposit,
        rentStartDateKey: startDateInput, rentLastDateKey: lastDateInput,
        settleExpiredContracts: true, allowSystemCoverage, previewOnly: true, clientRequestId,
      });
      if (currentPreviewKey.current === key) setSettlementPreview({ ...result, key, clientRequestId });
    } catch (error) {
      showFeedback(error.message || '정산 미리보기를 불러오지 못했습니다.', 'error');
    } finally { setPreviewLoading(false); }
  };

  const handleSubmit = async () => {
    if (loading || previewLoading) return;
    if (needsSettlement && !currentPreview?.canApply) {
      showFeedback('정산 미리보기를 먼저 확인하고 처리할 수 없는 자리를 제외해 주세요.', 'warning');
      return;
    }
    if (!systemEnabled) {
      showFeedback('부동산 시스템이 비활성화 상태입니다.', 'warning');
      return;
    }

    if (contractAction === 'set' && (!hasWeeklyRentInput || !Number.isFinite(Number(weeklyRentInput)) || normalizedWeeklyRent <= 0)) {
      showFeedback('주 임대료는 1 이상의 숫자로 입력해 주세요.', 'error');
      return;
    }
    if (contractAction === 'set' && (!Number.isFinite(Number(depositInput)) || Number(depositInput) < 0)) {
      showFeedback('보증금은 0 이상의 숫자로 입력해 주세요.', 'error');
      return;
    }

    if (selectedCount === 0) {
      showFeedback('임대 계약을 적용할 자리를 하나 이상 선택해 주세요.', 'error');
      return;
    }

    let rentStartDateKey = null;
    let rentLastDateKey = null;

    if (normalizedWeeklyRent > 0) {
      const parsedStartDate = startOfDayInKST(parseDateKeyAsKST(startDateInput));
      const parsedLastDate = startOfDayInKST(parseDateKeyAsKST(lastDateInput));

      if (!parsedStartDate || !parsedLastDate) {
        showFeedback('계약 시작일과 마지막 거주일을 모두 입력해 주세요.', 'error');
        return;
      }

      if (parsedLastDate.getTime() < parsedStartDate.getTime()) {
        showFeedback('마지막 거주일은 계약 시작일보다 빠를 수 없습니다.', 'error');
        return;
      }

      rentStartDateKey = formatDateKeyInKST(parsedStartDate);
      rentLastDateKey = formatDateKeyInKST(parsedLastDate);
    }

    const confirmed = (await appConfirm(
      needsSettlement
        ? `${currentPreview.expiredCount}개 만료 계약을 정산하고 ${selectedCount}개 자리에 새 계약을 적용할까요?\n\n보증금 반환 ${formatCurrency(currentPreview.totals.depositRefundAmount)}\n선납 임대료 반환 ${formatCurrency(currentPreview.totals.rentRefundAmount)}\n시스템 보전 ${formatCurrency(currentPreview.totals.systemCoveredAmount)}\n\n반환금 지급과 새 계약 설정이 함께 처리됩니다.`
        : normalizedWeeklyRent > 0
        ? `${selectedCount}개 자리에 주 임대료 ${formatCurrency(normalizedWeeklyRent)}, 보증금 ${formatCurrency(normalizedDeposit)}, ${startDateInput} ~ ${lastDateInput} 계약을 적용할까요?\n\n진행 중인 계약이나 미납·미정산 금액이 있으면 적용되지 않습니다.`
        : `${selectedCount}개 자리의 임대 계약을 해제할까요?\n\n기존 납부 기록은 남아 있고, 현재 계약 정보만 비워집니다.`,
    ));
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await updateRealEstateRentContractsBulkAPI({
        classId,
        deskIds: targetDesks.map((desk) => desk.id),
        weeklyRent: normalizedWeeklyRent,
        depositAmount: normalizedDeposit,
        rentStartDateKey,
        rentLastDateKey,
        ...(needsSettlement ? { settleExpiredContracts: true, allowSystemCoverage,
          previewOnly: false, previewHash: currentPreview.previewHash, clientRequestId: currentPreview.clientRequestId } : {}),
      });
      showFeedback(
        result.message || `${selectedCount}개 자리의 임대 계약을 설정했습니다.`,
        'success',
      );
      onContractsUpdated?.(result);
      setLastResult(result.message || `${selectedCount}개 자리의 임대 계약을 처리했습니다.`);
      resetState();
      setScreen('overview');
    } catch (error) {
      showFeedback(error.message || '임대 계약 일괄 설정 중 오류가 발생했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const footer = (
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          onClick={handleSettingsClose}
          disabled={loading || previewLoading}
          tone="slate"
          kind="soft"
          className="flex-1 rounded-xl py-3 font-bold"
        >
          닫기
        </Button>
        {screen === 'settings' && <Button
          onClick={handleSubmit}
          isLoading={loading}
          loadingText="처리 중..."
          disabled={!validConditions || previewLoading || (needsSettlement && !currentPreview?.canApply)}
          tone={contractAction === 'clear' ? 'rose' : 'blue'}
          className="flex-1 rounded-xl py-3 font-bold disabled:opacity-50"
        >
          {selectedCount}개 자리 {contractAction === 'clear' ? '계약 해제' : needsSettlement ? '정산 후 계약 적용' : '계약 적용'}
        </Button>}
      </div>
  );

  return (
    <>
    {(initialView !== 'settings' || screen === 'overview') && <Modal {...modalProps} isOpen={isOpen}
      onClose={screen === 'overview' ? handleClose : undefined} size="lg" title="임대 관리"
      subtitle="계약 현황을 확인하고 선택한 자리의 계약을 관리하세요."
      footer={<Button onClick={handleClose} disabled={screen === 'settings'} tone="slate" kind="soft" fullWidth>닫기</Button>}
      aria-hidden={screen === 'settings' ? true : undefined} inert={screen === 'settings' ? true : undefined}>
        {lastResult && <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-sm font-bold text-green-800">{lastResult}</p>}
        <RentManagementOverview groups={groups} placementData={placementData}
        formatCurrency={formatCurrency} selectedIds={selectedDesks} onSelectionChange={setSelectedDesks}
        filter={statusFilter} onFilterChange={setStatusFilter}
        onConfigure={(ids, settle) => {
          setOwnershipFilter('all'); setTargetMode('selected'); setSelectedDesks(new Set(ids));
          setContractAction('set'); setSettleExpiredContracts(settle); setSettlementPreview(null);
          setScreen('settings');
        }} />
    </Modal>}
    <Modal {...modalProps} isOpen={isOpen && screen === 'settings'} onClose={handleSettingsClose}
      size="max-w-3xl" title="임대 관리 · 계약 설정"
      subtitle="선택한 자리의 계약 조건과 정산 내용을 확인하세요. 닫으면 현황으로 돌아갑니다." footer={footer}>

      <fieldset disabled={loading || previewLoading} className="grid min-w-0 items-start gap-4 md:grid-cols-2">
        <section className={`min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 ${targetMode === 'selected' ? 'md:col-span-2' : ''}`}>
          <div className="flex items-center gap-2 text-base font-bold text-slate-800">
            <Wallet size={16} className="text-blue-500" />
            1. 계약 내용
          </div>

          <div className="flex gap-2">
            <Button tone="blue" kind={contractAction === 'set' ? 'soft' : 'outline'} aria-pressed={contractAction === 'set'} onClick={() => setContractAction('set')} className="flex-1">계약 설정</Button>
            <Button tone="rose" kind={contractAction === 'clear' ? 'soft' : 'outline'} aria-pressed={contractAction === 'clear'} onClick={() => setContractAction('clear')} className="flex-1">계약 해제</Button>
          </div>
          <div className="grid gap-3 grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-bold text-slate-700">주 임대료</span>
              <input
                type="number"
                min="1"
                disabled={contractAction === 'clear'}
                step="1"
                value={weeklyRentInput}
                onChange={(event) => setWeeklyRentInput(event.target.value)}
                placeholder="예: 10"
                className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-3 text-base font-bold text-slate-800 outline-none transition focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-bold text-slate-700">보증금</span>
              <input
                type="number"
                min="0"
                step="1"
                disabled={contractAction === 'clear'}
                value={depositInput}
                onChange={(event) => setDepositInput(event.target.value)}
                placeholder="없으면 0"
                className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-3 text-base font-bold text-slate-800 outline-none transition focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-bold text-slate-700">임대 시작일</span>
              <div className="relative">
                <input
                  type="date"
                  disabled={contractAction === 'clear'}
                  value={startDateInput}
                  onChange={(event) => setStartDateInput(event.target.value)}
                  className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-3  text-base font-bold text-slate-800 outline-none transition focus:ring-2 focus:ring-blue-500"
                />
                
              </div>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-bold text-slate-700">마지막 거주일</span>
              <div className="relative">
                <input
                  type="date"
                  disabled={contractAction === 'clear'}
                  min={startDateInput || undefined}
                  value={lastDateInput}
                  onChange={(event) => setLastDateInput(event.target.value)}
                  className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-3  text-base font-bold text-slate-800 outline-none transition focus:ring-2 focus:ring-blue-500"
                />
                
              </div>
            </label>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
            {contractAction === 'clear' ? '선택한 자리의 현재 계약 정보를 해제합니다. 기존 납부 기록은 유지됩니다.' : '보증금은 저장할 때 차감되지 않습니다. 임차인이 계약 적용 후 별도로 납부합니다.'}
          </div>
          {contractAction === 'set' && (isTeacher || isAdmin) && (
            <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3 text-sm leading-6 text-slate-700">
              <label className="flex items-start gap-2 font-bold">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-blue-600" checked={settleExpiredContracts}
                  onChange={(event) => { setSettleExpiredContracts(event.target.checked); setAllowSystemCoverage(false); }} />
                만료 계약 정산 후 새 계약 적용
              </label>
              {needsSettlement && <>
                <p>보증금과 남은 선납 임대료를 반환합니다. 미납·진행 중인 계약은 처리하지 않으며, 한 번에 최대 40개 자리까지 가능합니다.</p>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-blue-600" checked={allowSystemCoverage}
                    onChange={(event) => setAllowSystemCoverage(event.target.checked)} />
                  임대인 잔액 부족분의 시스템 보전 허용
                </label>
                <p className="text-slate-600">국유지의 반환금은 국가에서 지급합니다. 개인 소유 자리의 부족분은 위 항목을 선택한 경우에만 시스템이 지급합니다.</p>
              </>}
            </div>
          )}
        </section>

        <section className={`min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 ${targetMode === 'selected' ? 'md:col-span-2' : ''}`}>
          <div className="flex items-center gap-2 text-base font-bold text-slate-800">
            <Users size={16} className="text-blue-500" />
            2. 적용 대상
          </div>

          <div className="flex flex-wrap gap-2">
            {OWNERSHIP_FILTERS.map((filter) => (
              <Button
                key={filter.id}
                size="sm"
                tone="blue"
                kind={ownershipFilter === filter.id ? "soft" : "outline"}
                rounded="xl"
                onClick={() => setOwnershipFilter(filter.id)}
              >
                {filter.label}
              </Button>
            ))}
          </div>

          <div className="flex gap-2">
            {['all', 'selected'].map((mode) => (
              <Button
                key={mode}
                tone="blue"
                kind={targetMode === mode ? "soft" : "outline"}
                fullWidth
                onClick={() => setTargetMode(mode)}
                className="flex-1"
              >
                {mode === 'all'
                  ? `전체 선택 (${eligibleDesks.length})`
                  : `직접 선택 (${selectedDesks.size})`}
              </Button>
            ))}
          </div>

          {targetMode === 'all' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
              현재 필터 기준으로 <span className="font-black text-slate-800">{eligibleDesks.length}개 자리</span>에
              같은 임대 계약을 적용합니다. 학생이 앉아 있는 자리만 대상에 포함됩니다.
            </div>
          )}

          {targetMode === 'selected' && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-3 md:p-4 select-none">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-600">
                  실제 배치의 책상을 눌러 선택하거나 해제하세요. 체크된 자리만 적용됩니다.
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    tone="blue"
                    kind="soft"
                    rounded="lg"
                    onClick={handleSelectAll}
                  >
                    {allSelected ? '전체 해제' : '전체 선택'}
                  </Button>
                  <span className="text-sm font-bold text-slate-600">
                    선택 {selectedDesks.size} / {eligibleDesks.length}
                  </span>
                </div>
              </div>

              <RentContractSeatPicker neutralSelection groups={groups} placementData={placementData}
                selectableIds={allDeskIdSet} selectedIds={selectedDesks}
                onToggle={toggleDeskSelection} />
            </div>
          )}
        </section>

        <section aria-label="적용 미리보기" aria-live="polite" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-slate-500" />
            <div className="space-y-2 text-sm leading-6 text-slate-700">
              <p className="font-bold">적용 미리보기</p>
              <p>
                적용 대상 <span className="font-black">{selectedCount}개 자리</span>
                {configuredDeskCount > 0 && (
                  <>
                    , 현재 계약 있음 <span className="font-black">{configuredDeskCount}개</span>
                  </>
                )}
              </p>
              <p>
                계약 내용:{' '}
                {contractAction === 'clear' ? '선택한 자리의 현재 임대 계약 해제' : !hasWeeklyRentInput ? '임대료와 계약 기간을 입력해 주세요.' : (
                    <>
                      주 임대료 <span className="font-black">{formatCurrency(normalizedWeeklyRent)}</span>
                      , 보증금 <span className="font-bold">{formatCurrency(normalizedDeposit)}</span>
                      {startDateInput && lastDateInput
                        ? (
                          <>
                            , 기간 <span className="font-black">{startDateInput}</span> ~{' '}
                            <span className="font-black">{lastDateInput}</span>
                          </>
                        )
                        : ' , 기간 미입력'}
                    </>
                  )}
              </p>
              <p>{needsSettlement ? '정산 내용을 먼저 확인해 주세요. 처리 불가 자리가 하나라도 있으면 전체 적용이 중단됩니다.' : '만료되고 정산이 끝난 계약은 새 계약으로 설정할 수 있습니다. 진행 중인 계약이나 미납 임대료·미정산 보증금·환급 잔액은 먼저 정산해 주세요.'}</p>
            </div>
          </div>
          {needsSettlement && (
            <div className="mt-4 space-y-3">
              <Button onClick={handlePreviewSettlement} disabled={!validConditions || selectedCount > 40}
                tone="blue" kind="outline" isLoading={previewLoading} loadingText="정산 확인 중...">정산 미리보기 확인</Button>
              {selectedCount > 40 && <p className="text-sm font-bold text-rose-700">정산할 자리를 40개 이하로 선택해 주세요.</p>}
              {!currentPreview && <p className="text-sm text-slate-600">조건이나 대상이 바뀌면 미리보기를 다시 확인해야 합니다.</p>}
              {currentPreview && <>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">보증금 반환 <strong className="block text-base">{formatCurrency(currentPreview.totals.depositRefundAmount)}</strong></div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">선납 임대료 반환 <strong className="block text-base">{formatCurrency(currentPreview.totals.rentRefundAmount)}</strong></div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">시스템 보전 <strong className="block text-base">{formatCurrency(currentPreview.totals.systemCoveredAmount)}</strong></div>
                </div>
                <p role="status" className={`text-sm font-bold ${currentPreview.canApply ? 'text-slate-800' : 'text-rose-700'}`}>
                  {currentPreview.canApply ? `${currentPreview.targetCount}개 자리 적용 가능 · 만료 계약 ${currentPreview.expiredCount}개 정산` : `처리 불가 ${currentPreview.blockedCount}개 · 해당 자리를 제외하거나 안내에 따라 먼저 처리해 주세요.`}
                </p>
                <div className="max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">자리별 정산 내용</caption>
                    <thead className="sticky top-0 bg-slate-100 text-slate-700"><tr>
                      {['자리', '반환금', '미납', '처리 안내'].map((label) => <th key={label} scope="col" className="px-3 py-2">{label}</th>)}
                    </tr></thead>
                    <tbody>{currentPreview.rows.map((row) => <tr key={row.deskId} className="border-t border-slate-100 align-top">
                      <th scope="row" className="whitespace-nowrap px-3 py-2 font-bold">{row.deskLabel}</th>
                      <td className="px-3 py-2 tabular-nums">{formatCurrency(row.depositRefundAmount + row.rentRefundAmount)}
                        {row.systemCoveredAmount > 0 && <span className="block text-xs text-slate-600">보전 {formatCurrency(row.systemCoveredAmount)}</span>}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{formatCurrency(row.unpaidRentAmount)}</td>
                      <td className={`min-w-[160px] px-3 py-2 ${row.canApply ? 'text-slate-600' : 'font-bold text-rose-700'}`}>{row.reason}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
                <p className="text-sm text-slate-600">임대인 출금 {formatCurrency(currentPreview.totals.ownerDebitAmount)} · 국가 반환 {formatCurrency(currentPreview.totals.stateRefundAmount)} · 임대소득세 환급 조정 {formatCurrency(currentPreview.totals.taxRefundAmount)}</p>
              </>}
            </div>
          )}
        </section>
      </fieldset>
    </Modal>
    </>
  );
};

export default BulkRentContractModal;
