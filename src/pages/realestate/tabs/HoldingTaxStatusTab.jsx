import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRightCircle,
  Building2,
  CheckCircle2,
  FileText,
  Info,
  Landmark,
  UserRound,
  Wallet,
} from 'lucide-react';
import { Button, EmptyState, InputField, SectionLoader } from '../../../components/ui';
import { useUser } from '../../../contexts/UserContext';
import SeatTradeModal from '../modals/SeatTradeModal';
import {
  formatHoldingDuration,
  formatHoldingWindow,
  getSpotlightTitle,
} from './HoldingTaxStatusTab.utils';
import { useHoldingTaxStatusTabController } from './useHoldingTaxStatusTabController';

const TAB_OPTIONS = [
  { id: 'overview', label: '개요' },
  { id: 'students', label: '학생별 정산' },
];

const HoldingTaxStatusTab = ({ classId, layoutData, configData, students = [] }) => {
  const { formatCurrency, currencyUnit } = useUser();
  const boardViewportRef = useRef(null);
  const [boardViewportWidth, setBoardViewportWidth] = useState(0);
  const [activeTab, setActiveTab] = useState('overview');

  const {
    acquisitionTaxRate,
    capitalGainsTaxRate,
    cutoverKey,
    dueDateKey,
    groups,
    handleApplyMissingRange,
    handleDeskCardClick,
    handleIssueBills,
    handleOpenSelectedDesk,
    hasMissingIssuedRanges,
    holdingTaxCutoverLabel,
    holdingTaxEnabled,
    holdingTaxRate,
    isBillsReady,
    isIssuing,
    isSystemEnabled,
    isTradeModalOpen,
    missingIssuedRangeSummary,
    officialPriceRatio,
    periodEndKey,
    periodStartKey,
    periodValidationMessage,
    rentLimitEnabled,
    rentLimitRate,
    rows,
    saleTemplate,
    saleSpecialTerms,
    selectedDesk,
    selectedDeskId,
    selectedDueDateLabel,
    selectedPeriod,
    setDueDateKey,
    setIsTradeModalOpen,
    setPeriodEndKey,
    setPeriodStartKey,
    spotlightRows,
    summary,
    todayKey,
  } = useHoldingTaxStatusTabController({
    classId,
    layoutData,
    configData,
    students,
    enableBillDetails: activeTab === 'students',
  });
  useEffect(() => {
    if (activeTab !== 'overview') {
      setBoardViewportWidth(0);
      return undefined;
    }

    if (typeof window === 'undefined') return undefined;

    const viewport = boardViewportRef.current;
    if (!viewport) {
      setBoardViewportWidth(0);
      return undefined;
    }

    const updateViewportWidth = () => {
      const nextViewport = boardViewportRef.current;
      if (!nextViewport) return;
      setBoardViewportWidth(nextViewport.clientWidth || 0);
    };

    updateViewportWidth();

    const resizeObserver = new ResizeObserver(() => {
      updateViewportWidth();
    });

    resizeObserver.observe(viewport);
    window.addEventListener('resize', updateViewportWidth);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateViewportWidth);
    };
  }, [activeTab, groups.length]);

  const holdingBoardLayout = useMemo(() => {
    const groupCount = Math.max(groups.length, 1);
    const gap = boardViewportWidth >= 1280 ? 20 : 16;
    const totalCols = groups.reduce(
      (sum, group) => sum + Math.max(1, Number(group?.cols) || 1),
      0,
    );
    const groupShareWidth =
      boardViewportWidth > 0
        ? Math.floor((boardViewportWidth - gap * Math.max(groupCount - 1, 0) - 4) / groupCount)
        : 0;
    const seatWidth =
      totalCols > 0 && boardViewportWidth > 0
        ? Math.max(
            76,
            Math.min(
              boardViewportWidth >= 1500 ? 136 : boardViewportWidth >= 1200 ? 124 : 112,
              Math.floor(
                (boardViewportWidth - gap * Math.max(groupCount - 1, 0) - groupCount * 22) /
                  totalCols,
              ),
            ),
          )
        : 92;

    const getGroupWidth = (group) => {
      const cols = Math.max(1, Number(group?.cols) || 1);
      const minWidth = Math.max(196, cols * 88 + 24);
      const maxSeatWidth =
        boardViewportWidth >= 1500 ? 150 : boardViewportWidth >= 1200 ? 138 : 124;
      const maxWidth = Math.max(240, cols * maxSeatWidth + 30);
      const preferredWidth = Math.max(
        cols * seatWidth + 24,
        groupShareWidth > 0 ? Math.min(groupShareWidth, maxWidth) : 0,
      );

      return Math.min(maxWidth, Math.max(minWidth, preferredWidth));
    };

    return {
      gap,
      getGroupWidth,
    };
  }, [boardViewportWidth, groups]);

  const metricCards = useMemo(
    () => [
      {
        key: 'ownerCount',
        label: '보유 학생 수',
        value: `${summary.ownerCount}명`,
        caption: '현재 부동산을 가진 학생 수',
        icon: UserRound,
        tone: 'border-slate-200 bg-white text-slate-900',
        iconTone: 'bg-slate-100 text-slate-700',
      },
      {
        key: 'taxableCount',
        label: '과세 대상',
        value: `${summary.taxableCount}명`,
        caption: '선택한 기간에 과세가 적용되는 학생',
        icon: Landmark,
        tone: 'border-amber-200 bg-amber-50/70 text-amber-900',
        iconTone: 'bg-amber-100 text-amber-700',
      },
      {
        key: 'totalOfficialPrice',
        label: '공시가 합계',
        value: formatCurrency(summary.totalOfficialPrice),
        caption: `선택 기간 예상 ${formatCurrency(summary.totalExpectedTax)}`,
        icon: Wallet,
        tone: 'border-blue-200 bg-blue-50/70 text-blue-900',
        iconTone: 'bg-blue-100 text-blue-700',
      },
      {
        key: 'issuedCount',
        label: '고지 상태',
        value: `${summary.issuedCount}건`,
        caption:
          summary.overdueCount > 0
            ? `연체 ${summary.overdueCount}건`
            : summary.pendingCount > 0
              ? `납부 대기 ${summary.pendingCount}건`
              : '연체 없음',
        icon:
          summary.overdueCount > 0
            ? AlertCircle
            : summary.pendingCount > 0
              ? FileText
              : CheckCircle2,
        tone:
          summary.overdueCount > 0
            ? 'border-rose-200 bg-rose-50/70 text-rose-900'
            : summary.pendingCount > 0
              ? 'border-amber-200 bg-amber-50/70 text-amber-900'
              : 'border-emerald-200 bg-emerald-50/70 text-emerald-900',
        iconTone:
          summary.overdueCount > 0
            ? 'bg-rose-100 text-rose-700'
            : summary.pendingCount > 0
              ? 'bg-amber-100 text-amber-700'
              : 'bg-emerald-100 text-emerald-700',
      },
    ],
    [formatCurrency, summary],
  );

  return (
    <div className="space-y-4 animate-fadeIn">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-700">보유세 발급 설정</p>
              <p className="text-xs text-slate-500">
                과세 시작일 {holdingTaxCutoverLabel} 이후 구간만 발급할 수 있습니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700">
                <Landmark size={13} /> 보유세율 {holdingTaxRate}%
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-600">
                기간 {selectedPeriod.label}
              </span>
            </div>
          </div>

          {!isSystemEnabled && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              부동산 시스템이 비활성화되어 있습니다. 정책 설정에서 먼저 활성화해 주세요.
            </div>
          )}

          {isSystemEnabled && !holdingTaxEnabled && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
              보유세 기능이 꺼져 있습니다. 정책 설정에서 보유세를 활성화하면 예상 보유세와
              고지서 발급 기능을 사용할 수 있습니다.
            </div>
          )}

          {hasMissingIssuedRanges && (
            <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm shadow-sm md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 font-black text-rose-700">
                  <AlertCircle size={16} /> 아직 발급하지 않은 보유세 기간이 있습니다.
                </div>
                <p className="font-semibold text-rose-900">{missingIssuedRangeSummary}</p>
              </div>
              <Button
                size="sm"
                tone="red"
                kind="soft"
                onClick={handleApplyMissingRange}
              >
                누락 기간으로 채우기
              </Button>
            </div>
          )}

          <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/80 p-4">
            <div className="grid gap-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
              <InputField type="date" label="과세 시작일" value={periodStartKey} min={cutoverKey} max={todayKey} onChange={(event) => setPeriodStartKey(event.target.value)} disabled={!isSystemEnabled || !holdingTaxEnabled} size="lg" tone="slate" className="rounded-2xl font-bold text-slate-900" labelClassName="block text-xs font-black uppercase tracking-[0.18em] text-slate-400" />
              <InputField type="date" label="과세 종료일" value={periodEndKey} min={cutoverKey} max={todayKey} onChange={(event) => setPeriodEndKey(event.target.value)} disabled={!isSystemEnabled || !holdingTaxEnabled} size="lg" tone="slate" className="rounded-2xl font-bold text-slate-900" labelClassName="block text-xs font-black uppercase tracking-[0.18em] text-slate-400" />
              <InputField type="date" label="납부 기한" value={dueDateKey} min={periodEndKey || periodStartKey || cutoverKey} onChange={(event) => setDueDateKey(event.target.value)} disabled={!isSystemEnabled || !holdingTaxEnabled} size="lg" tone="slate" className="rounded-2xl font-bold text-slate-900" labelClassName="block text-xs font-black uppercase tracking-[0.18em] text-slate-400" />
              <Button size="sm"
                type="button"
                onClick={handleIssueBills}
                disabled={
                  !isSystemEnabled ||
                  !holdingTaxEnabled ||
                  Boolean(periodValidationMessage)
                }
                isLoading={isIssuing}
                loadingText={"\uACE0\uC9C0\uC11C \uBC1C\uAE09 \uC911..."}
                icon={FileText}
                tone="slate"
                rounded="lg"
                
              >
                {"\uBCF4\uC720\uC138 \uACE0\uC9C0\uC11C \uBC1C\uAE09"}
              </Button>
            </div>
            {periodValidationMessage ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {periodValidationMessage}
              </div>
            ) : (
              <div className="mt-3 text-sm font-semibold text-slate-500">
                선택 기간 {selectedPeriod.label} · 총 {selectedPeriod.periodDays}일 · 납부 기한 {selectedDueDateLabel}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="flex justify-start">
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
          {TAB_OPTIONS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <Button key={tab.id} size="xs" tone="slate" kind={isActive ? "solid" : "ghost"} rounded="lg"  onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </Button>
            );
          })}
        </div>
      </section>      {activeTab === 'overview' && (
        <section className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-xl font-black tracking-tight text-slate-900">주목할 정산 대상</h3>
              <p className="mt-2 text-sm font-medium text-slate-500">예상 보유세가 큰 학생과 좌석 흐름을 먼저 확인합니다.</p>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
              고지/납부 상세는 학생별 정산 탭에서 확인
            </div>
          </div>

          <div className="p-5">
            <div className="grid gap-3 md:grid-cols-3">
              {spotlightRows.length > 0 ? (
                spotlightRows.map((row, index) => (
                  <div key={row.studentUid} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{getSpotlightTitle(index)}</p>
                        <p className="mt-2 text-xl font-black tracking-tight text-slate-900">{row.studentName}</p>
                      </div>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${row.status.badgeTone}`}>
                        {row.status.label}
                      </span>
                    </div>
                    <div className="mt-4 space-y-2 text-sm font-semibold text-slate-600">
                      <div className="flex items-center justify-between gap-3">
                        <span>예상 보유세</span>
                        <span className="font-black text-slate-900">{formatCurrency(row.expectedTax)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>공시가 합계</span>
                        <span className="font-black text-slate-900">{formatCurrency(row.totalOfficialPrice)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>보유 기간</span>
                        <span className="font-black text-slate-900">{formatHoldingWindow(row.longestHoldingDays, row.shortestHoldingDays)}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={UserRound}
                  title="아직 보유세 대상 학생이 없습니다"
                  description="보유세 대상 자리가 생기면 학생별 정산 목록에 표시됩니다."
                  className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 md:col-span-3"
                />
              )}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'overview' && (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-xl font-black tracking-tight text-slate-900">실물맵으로 보는 보유세</h3>
                <Button size="xs" tone="slate" kind="outline" rounded="full" title={'노란색: 과세 대상, 회색: 과세 없음, 파란색: 정산 대상, 진한 강조: 선택 좌석'} aria-label="상태 안내">
                  <Info size={13} /> 상태 안내
                </Button>
              </div>
              <p className="mt-2 text-sm font-medium text-slate-500">좌석 배치와 소유자를 같이 보면서 정산 대상을 빠르게 확인합니다.</p>
            </div>

            <div ref={boardViewportRef} className="overflow-x-auto p-3 sm:p-4">
              {groups.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="아직 교실 배치 데이터가 없습니다"
                  description="자리 배치가 등록되면 보유세 대상과 정산 정보를 확인할 수 있습니다."
                  className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-14"
                />
              ) : (
                <div className="mx-auto w-full min-w-max">
                  <div className="flex flex-nowrap items-start" style={{ gap: `${holdingBoardLayout.gap}px` }}>
                    {groups.map((group) => (
                      <div key={group.id} className="shrink-0" style={{ width: `${holdingBoardLayout.getGroupWidth(group)}px` }}>
                        <div className="mb-2 inline-flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[10px] font-black tracking-[0.16em] text-indigo-700 shadow-sm">
                          <Building2 size={14} /> {group.name}
                        </div>
                        <div className="grid gap-1.5 rounded-[1.45rem] border border-slate-200 bg-slate-50 p-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, Number(group.cols) || 1)}, minmax(0, 1fr))` }}>
                          {(group.desks || []).map((desk) => {
                            if (!desk.isActive) {
                              return <div key={desk.id} className="min-h-[80px] rounded-xl border border-dashed border-slate-200 bg-white/70" />;
                            }

                            const isSelected = desk.id === selectedDeskId;
                            return (
                              <Button key={desk.id} kind="outline" tone="slate" rounded="xl" onClick={() => handleDeskCardClick(desk)} className={`relative block min-h-[80px] bg-white px-2.5 py-2 text-left ${isSelected ? 'ring-2 ring-slate-900/70 ring-offset-2 ring-offset-white shadow-lg shadow-slate-200' : 'hover:-translate-y-0.5 hover:shadow-md'}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="inline-flex min-w-max whitespace-nowrap rounded-full bg-slate-50 px-2 py-1 text-[10px] font-black tracking-normal text-slate-600 shadow-sm">{desk.number ?? '-'}번</div>
                                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full shadow-sm ${desk.status.accentTone}`} aria-hidden="true" />
                                </div>
                                <div className="mt-3 min-h-[2.2rem] pr-1">
                                  <p className="break-keep text-sm font-black leading-tight tracking-tight text-slate-900">{desk.ownerNameResolved}</p>
                                </div>
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <aside className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm xl:sticky xl:top-4 xl:self-start">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-xl font-black tracking-tight text-slate-900">선택한 자리 정산 패널</h3>
              <p className="mt-2 text-sm font-medium text-slate-500">자리 기준으로 과세 예상치와 보유 흐름을 확인합니다.</p>
            </div>

            {selectedDesk ? (
              <div className="space-y-3 p-5">
                <div className={`rounded-2xl border p-4 ${selectedDesk.status.panelTone}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">선택 자리</p>
                      <h4 className="mt-2 text-2xl font-black tracking-tight text-slate-900">{selectedDesk.number ?? '-'}번 자리</h4>
                      <p className="mt-2 text-sm font-semibold text-slate-600">소유자 {selectedDesk.ownerNameResolved}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">선택 기간 반영 {formatHoldingDuration(selectedDesk.taxableHoldingDays)}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${selectedDesk.status.badgeTone}`}>{selectedDesk.status.label}</span>
                  </div>

                  <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                    <div className="rounded-xl bg-white/80 p-3.5 ring-1 ring-black/5">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">공시가</p>
                      <p className="mt-2 text-xl font-black tracking-tight text-slate-900">{formatCurrency(selectedDesk.officialPrice)}</p>
                    </div>
                    <div className="rounded-xl bg-white/80 p-3.5 ring-1 ring-black/5">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">선택 기간 보유세</p>
                      <p className="mt-2 text-xl font-black tracking-tight text-slate-900">{formatCurrency(selectedDesk.expectedTax)}</p>
                    </div>
                    <div className="rounded-xl bg-white/80 p-3.5 ring-1 ring-black/5">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">보유 시작일</p>
                      <p className="mt-2 text-lg font-black text-slate-900">{selectedDesk.holdingStartedLabel}</p>
                    </div>
                    <div className="rounded-xl bg-white/80 p-3.5 ring-1 ring-black/5">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">현재 보유 기간</p>
                      <p className="mt-2 text-lg font-black text-slate-900">{formatHoldingDuration(selectedDesk.holdingDays)}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                  고지 상태와 납부 상태는 <span className="font-black text-slate-900">학생별 정산</span> 탭에서 확인할 수 있습니다.
                </div>

                <Button fullWidth tone="slate" icon={ArrowRightCircle} onClick={handleOpenSelectedDesk}>
                  자리 상세 보기
                </Button>
              </div>
            ) : (
              <EmptyState
                icon={Landmark}
                title="자리를 선택하면 정산 정보가 표시됩니다"
                description="교실 맵에서 자리를 선택해 보유 기간과 예상 세금을 확인하세요."
                className="px-6 py-16"
              />
            )}
          </aside>
        </section>
      )}

      {activeTab === 'students' && (
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-100 p-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-xl font-black tracking-tight text-slate-900">학생별 정산 표</h3>
              <p className="mt-2 text-sm font-medium text-slate-500">학생별 공시가 합계, 예상 보유세, 고지 상태를 한 번에 비교합니다.</p>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">금액 단위 {currencyUnit}</div>
          </div>

          {!isBillsReady ? (
            <div className="flex items-center justify-center gap-3 px-6 py-16 text-slate-500">
              <SectionLoader
                message={"\uD559\uC0DD\uBCC4 \uC815\uC0B0 \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4."}
                tone="slate"
                size="sm"
                showSkeleton={false}
                minHeightClassName="min-h-[220px]"
              />
            </div>
          ) : (
            <div className="space-y-6 p-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {metricCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div key={card.key} className={`rounded-[1.6rem] border p-4 shadow-sm ${card.tone}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{card.label}</p>
                          <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">{card.value}</p>
                          <p className="mt-2 text-xs font-semibold text-slate-500">{card.caption}</p>
                        </div>
                        <div className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${card.iconTone}`}><Icon size={20} /></div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="overflow-x-auto rounded-[1.5rem] border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                    <tr>
                      <th className="px-5 py-4">순번</th>
                      <th className="px-5 py-4">학생</th>
                      <th className="px-5 py-4 text-right">보유 좌석</th>
                      <th className="px-5 py-4 text-right">공시가 합계</th>
                      <th className="px-5 py-4 text-right">예상 보유세</th>
                      <th className="px-5 py-4">보유 기간</th>
                      <th className="px-5 py-4">고지 상태</th>
                      <th className="px-5 py-4">납부 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={row.studentUid} className="border-t border-slate-100 bg-white transition hover:bg-slate-50/70">
                        <td className="px-5 py-4 font-black text-slate-400">{index + 1}</td>
                        <td className="px-5 py-4 font-black text-slate-900">{row.studentName}</td>
                        <td className="px-5 py-4 text-right font-semibold text-slate-600">{row.deskCount}개</td>
                        <td className="px-5 py-4 text-right font-semibold text-slate-700">{formatCurrency(row.totalOfficialPrice)}</td>
                        <td className="px-5 py-4 text-right font-black text-slate-900">{formatCurrency(row.expectedTax)}</td>
                        <td className="px-5 py-4 font-semibold text-slate-600">{row.deskCount === 0 ? '-' : formatHoldingWindow(row.longestHoldingDays, row.shortestHoldingDays)}</td>
                        <td className="px-5 py-4"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${row.status.badgeTone}`}>{row.status.issueLabel}</span></td>
                        <td className={`px-5 py-4 font-semibold ${row.status.paymentTone}`}>{row.status.paymentLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <SeatTradeModal isOpen={isTradeModalOpen} onClose={() => setIsTradeModalOpen(false)} desk={selectedDesk} classId={classId} acquisitionTaxRate={acquisitionTaxRate} capitalGainsTaxRate={capitalGainsTaxRate} saleTemplate={saleTemplate} saleSpecialTerms={saleSpecialTerms} rentLimitEnabled={rentLimitEnabled} rentLimitRate={rentLimitRate} officialPriceRatio={officialPriceRatio} systemEnabled={isSystemEnabled} />
    </div>
  );
};

export default HoldingTaxStatusTab;
