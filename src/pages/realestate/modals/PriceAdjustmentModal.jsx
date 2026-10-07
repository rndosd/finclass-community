import { appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  Info,
  Percent,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Button, EmptyState, Modal } from '../../../components/ui/';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { useUser } from '../../../contexts/UserContext';
import { adjustMarketPriceAPI } from '../services/realEstateService';

const ADJUSTMENT_REASONS = [
  {
    id: 'recession',
    label: '경기 침체',
    icon: TrendingDown,
    color: 'text-blue-600',
    description: '경제 불황으로 부동산 수요 감소',
  },
  {
    id: 'boom',
    label: '경기 호황',
    icon: TrendingUp,
    color: 'text-red-600',
    description: '경제 활성화로 부동산 수요 증가',
  },
  {
    id: 'rate_up',
    label: '금리 인상',
    icon: TrendingDown,
    color: 'text-indigo-600',
    description: '대출 이자 부담 증가로 수요 감소',
  },
  {
    id: 'rate_down',
    label: '금리 인하',
    icon: TrendingUp,
    color: 'text-orange-600',
    description: '대출 이자 부담 완화로 수요 증가',
  },
  {
    id: 'bubble_burst',
    label: '버블 붕괴',
    icon: TrendingDown,
    color: 'text-purple-600',
    description: '과열된 시장의 급격한 하락',
  },
  {
    id: 'development',
    label: '개발 호재',
    icon: TrendingUp,
    color: 'text-green-600',
    description: '주변 개발로 가치 상승',
  },
  {
    id: 'custom',
    label: '직접 입력',
    icon: Info,
    color: 'text-slate-600',
    description: '',
  },
];

const RATE_PRESETS = [
  { value: -30, label: '-30%', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: -20, label: '-20%', color: 'bg-blue-50 text-blue-600 border-blue-200' },
  { value: -10, label: '-10%', color: 'bg-slate-50 text-slate-600 border-slate-200' },
  { value: 10, label: '+10%', color: 'bg-slate-50 text-slate-600 border-slate-200' },
  { value: 20, label: '+20%', color: 'bg-red-50 text-red-600 border-red-200' },
  { value: 30, label: '+30%', color: 'bg-red-100 text-red-700 border-red-200' },
];

const getDeskLabel = (desk) => desk?.label || `${desk?.number ?? '-'}번`;

const isDeskActive = (desk) => desk?.isActive !== false;

const parsePriceValue = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const getDeskCurrentPrice = (desk) => {
  const marketPrice = parsePriceValue(desk?.lastPurchasePrice);
  if (marketPrice > 0) return marketPrice;

  const officialPrice = parsePriceValue(desk?.price);
  if (officialPrice > 0) return officialPrice;

  return 0;
};

const isDeskSelectableForAdjustment = (desk, adjustmentMode) => {
  if (!isDeskActive(desk)) return false;
  if (adjustmentMode === 'fixed') return true;
  return getDeskCurrentPrice(desk) > 0;
};

const PriceAdjustmentModal = ({
  isOpen,
  onClose,
  groups,
  classId,
  officialPriceRatio = 70,
  onAdjustmentComplete,
  ...modalProps
}) => {
  const { currencyUnit, formatCurrency } = useUser();
  const { showFeedback } = useFeedback();

  const [selectedReason, setSelectedReason] = useState(null);
  const [customReason, setCustomReason] = useState('');
  const [adjustmentMode, setAdjustmentMode] = useState('rate');
  const [adjustmentRate, setAdjustmentRate] = useState(0);
  const [customRate, setCustomRate] = useState('');
  const [directPrice, setDirectPrice] = useState('');
  const [targetMode, setTargetMode] = useState('all');
  const [selectedDesks, setSelectedDesks] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState(null);

  const allDesks = useMemo(() => {
    const desks = [];
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      (group?.desks || []).forEach((desk) => {
        const currentPrice = getDeskCurrentPrice(desk);
        if (isDeskSelectableForAdjustment(desk, adjustmentMode)) {
          desks.push({
            ...desk,
            groupName: group?.name || '',
            currentPrice,
            label: getDeskLabel(desk),
          });
        }
      });
    });
    return desks;
  }, [adjustmentMode, groups]);

  const allDeskIdSet = useMemo(
    () => new Set(allDesks.map((desk) => desk.id)),
    [allDesks],
  );

  const groupedMiniLayout = useMemo(() => {
    return (Array.isArray(groups) ? groups : [])
      .map((group) => {
        const activeDesks = (group?.desks || [])
          .filter((desk) => isDeskActive(desk))
          .map((desk) => ({
            ...desk,
            label: getDeskLabel(desk),
            currentPrice: getDeskCurrentPrice(desk),
            isSelectable: allDeskIdSet.has(desk.id),
          }));

        return {
          id: group?.id,
          name: group?.name || '분단',
          cols: Math.max(1, Number(group?.cols) || 1),
          activeDesks,
        };
      })
      .filter((group) => group.activeDesks.length > 0);
  }, [allDeskIdSet, groups]);

  const targetDesks = useMemo(() => {
    if (targetMode === 'all') return allDesks;
    return allDesks.filter((desk) => selectedDesks.has(desk.id));
  }, [targetMode, allDesks, selectedDesks]);

  const effectiveRate = customRate !== '' ? Number(customRate) : adjustmentRate;
  const effectiveDirectPrice =
    directPrice === '' ? 0 : Math.max(0, Math.round(Number(directPrice)));
  const isRateMode = adjustmentMode === 'rate';
  const hasValidAdjustment = isRateMode
    ? Number.isFinite(effectiveRate) && effectiveRate !== 0
    : Number.isFinite(effectiveDirectPrice) && effectiveDirectPrice > 0;
  const allSelected = allDesks.length > 0 && selectedDesks.size === allDesks.length;

  useEffect(() => {
    setSelectedDesks((prev) => {
      const next = new Set([...prev].filter((deskId) => allDeskIdSet.has(deskId)));
      return next.size === prev.size ? prev : next;
    });
  }, [allDeskIdSet]);

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
      setDragMode(null);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

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

  const handleDeskMouseDown = (deskId) => {
    if (targetMode !== 'selected' || !allDeskIdSet.has(deskId)) return;
    const mode = selectedDesks.has(deskId) ? 'deselect' : 'select';
    setIsDragging(true);
    setDragMode(mode);
    toggleDeskSelection(deskId, mode);
  };

  const handleDeskMouseEnter = (deskId) => {
    if (targetMode !== 'selected' || !isDragging || !dragMode) return;
    toggleDeskSelection(deskId, dragMode);
  };

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedDesks(new Set());
      return;
    }
    setSelectedDesks(new Set(allDesks.map((desk) => desk.id)));
  };

  const handleClose = () => {
    setSelectedReason(null);
    setCustomReason('');
    setAdjustmentMode('rate');
    setAdjustmentRate(0);
    setCustomRate('');
    setDirectPrice('');
    setTargetMode('all');
    setSelectedDesks(new Set());
    setIsDragging(false);
    setDragMode(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!selectedReason) {
      showFeedback('조정 사유를 선택해 주세요.', 'error');
      return;
    }
    if (selectedReason === 'custom' && !customReason.trim()) {
      showFeedback('사유를 입력해 주세요.', 'error');
      return;
    }
    if (!hasValidAdjustment) {
      showFeedback(
        isRateMode ? '조정 비율을 입력해 주세요.' : '원하는 시세 금액을 입력해 주세요.',
        'error',
      );
      return;
    }
    if (targetDesks.length === 0) {
      showFeedback('조정 대상 자리가 없습니다.', 'error');
      return;
    }

    const reasonText =
      selectedReason === 'custom'
        ? customReason.trim()
        : ADJUSTMENT_REASONS.find((reason) => reason.id === selectedReason)?.label || '사유 없음';

    const confirmed = (await appConfirm(
      isRateMode
        ? `${targetDesks.length}개 자리의 시세를 ${effectiveRate > 0 ? '+' : ''}${effectiveRate}% 조정합니다.\n\n사유: ${reasonText}\n\n계속하시겠습니까?`
        : `${targetDesks.length}개 자리의 시세를 모두 ${formatCurrency(effectiveDirectPrice)}로 맞춥니다.\n\n사유: ${reasonText}\n\n계속하시겠습니까?`,
    ));
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await adjustMarketPriceAPI({
        classId,
        deskIds: targetDesks.map((desk) => desk.id),
        adjustmentRate: isRateMode ? effectiveRate : null,
        targetPrice: isRateMode ? null : effectiveDirectPrice,
        reason: reasonText,
        reasonType: selectedReason,
      });
      showFeedback(
        result.message || `${result.adjustedCount}개 자리 시세 조정 완료`,
        'success',
      );
      onAdjustmentComplete?.();
      handleClose();
    } catch (error) {
      showFeedback(error.message || '시세 조정 중 오류가 발생했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="lg" {...modalProps}>
      <div className="rounded-2xl bg-gradient-to-r from-slate-800 to-slate-700 text-white px-5 py-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-lg">
            <Building2 size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold">땅값 일괄 조정</h2>
            <p className="text-xs md:text-sm text-white/75">경제 이벤트에 따라 부동산 시세를 조정합니다.</p>
          </div>
        </div>
      </div>

      <Modal.Body className="space-y-4 md:space-y-5 px-1 md:px-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-3">
          <label className="text-sm font-bold text-slate-700 block">1. 조정 사유</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
            {ADJUSTMENT_REASONS.map((reason) => {
              const Icon = reason.icon;
              const isSelected = selectedReason === reason.id;
              return (
                <Button
                  key={reason.id}
                  tone="blue"
                  kind={isSelected ? "soft" : "outline"}
                  rounded="xl"
                  onClick={() => setSelectedReason(reason.id)}
                  className="flex items-center justify-start gap-2 p-3 text-left"
                >
                  <Icon size={18} className={reason.color} />
                  <div className="flex-1 min-w-0">
                    <div className={`font-bold text-sm ${isSelected ? 'text-indigo-700' : 'text-slate-700'}`}>
                      {reason.label}
                    </div>
                    {reason.description && (
                      <div className="text-[10px] text-slate-400 truncate">{reason.description}</div>
                    )}
                  </div>
                  {isSelected && <Check size={16} className="text-indigo-600" />}
                </Button>
              );
            })}
          </div>
          {selectedReason === 'custom' && (
            <input
              type="text"
              value={customReason}
              onChange={(event) => setCustomReason(event.target.value)}
              placeholder="사유를 입력해 주세요"
              className="w-full px-4 py-2.5 border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none text-sm"
            />
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-4">
          <label className="text-sm font-bold text-slate-700 block">2. 조정 방식</label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button
              tone="blue"
              kind={isRateMode ? "soft" : "outline"}
              rounded="xl"
              onClick={() => setAdjustmentMode('rate')}
              className="block px-4 py-3 text-left"
            >
              <div className="text-sm font-black text-slate-800">비율로 조정</div>
              <div className="mt-1 text-xs text-slate-500">현재 시세에서 퍼센트만큼 올리거나 내립니다.</div>
            </Button>
            <Button
              tone="blue"
              kind={!isRateMode ? "soft" : "outline"}
              rounded="xl"
              onClick={() => setAdjustmentMode('fixed')}
              className="block px-4 py-3 text-left"
            >
              <div className="text-sm font-black text-slate-800">원하는 금액으로 맞추기</div>
              <div className="mt-1 text-xs text-slate-500">선택한 자리 시세를 모두 같은 금액으로 재설정합니다.</div>
            </Button>
          </div>

          {isRateMode ? (
            <>
              <div className="flex flex-wrap gap-2">
                {RATE_PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    size="sm"
                    tone="blue"
                    kind={adjustmentRate === preset.value && customRate === '' ? "solid" : "outline"}
                    rounded="lg"
                    onClick={() => {
                      setAdjustmentRate(preset.value);
                      setCustomRate('');
                    }}
                    className={adjustmentRate === preset.value && customRate === '' ? "" : preset.color}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <div className="relative w-full sm:max-w-[160px]">
                <input
                  type="number"
                  value={customRate}
                  onChange={(event) => {
                    setCustomRate(event.target.value);
                    setAdjustmentRate(0);
                  }}
                  placeholder="직접 입력"
                  className="w-full px-3 py-2 pr-8 border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none text-sm text-right"
                />
                <Percent size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="relative w-full sm:max-w-[220px]">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={directPrice}
                  onChange={(event) => setDirectPrice(event.target.value)}
                  placeholder="원하는 시세"
                  className="w-full rounded-xl border border-blue-200 px-4 py-3 pr-16 text-right text-sm font-bold text-slate-800 outline-none transition focus:ring-2 focus:ring-blue-500/20"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">
                  {currencyUnit}
                </span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                현재 시세와 상관없이 선택한 자리의 시세를 모두 같은 금액으로 맞춥니다.
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-3">
          <label className="text-sm font-bold text-slate-700 block">
            3. 조정 대상
            <span className="text-xs font-normal text-slate-400 ml-1">
              (시세 정보가 있는 자리만 선택 가능)
            </span>
          </label>

          <div className="flex gap-2">
            {['all', 'selected'].map((mode) => (
              <Button
                key={mode}
                tone="blue"
                kind={targetMode === mode ? "solid" : "outline"}
                fullWidth
                onClick={() => setTargetMode(mode)}
                className="flex-1"
              >
                {mode === 'all' ? `전체 (${allDesks.length}개)` : `선택 (${selectedDesks.size}개)`}
              </Button>
            ))}
          </div>

          {targetMode === 'all' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              조정 가능한 전체 자리 <span className="font-black text-slate-800">{allDesks.length}개</span>가 자동으로 적용됩니다.
            </div>
          )}

          {targetMode === 'selected' && (
            <div className="rounded-xl border border-slate-200 p-3 md:p-4 space-y-3 select-none">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-500">
                  드래그로 빠르게 일괄 선택/해제할 수 있습니다.
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
                  <span className="text-[11px] font-bold text-slate-500">
                    선택 {selectedDesks.size} / {allDesks.length}
                  </span>
                </div>
              </div>

              {groupedMiniLayout.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="조정 가능한 자리가 없습니다"
                  description="시세 정보가 있는 활성 자리가 생기면 일괄 조정할 수 있습니다."
                  size="sm"
                  className="min-h-[150px] border-slate-200 bg-slate-50/80 py-6"
                />
              ) : (
                <div className="max-h-[340px] overflow-auto custom-scrollbar pr-1">
                  <div className="flex flex-nowrap items-start gap-3 min-w-max pb-1">
                    {groupedMiniLayout.map((group) => (
                      <div key={group.id} className="w-[176px] shrink-0">
                        <div className="mb-2 px-3 py-1 rounded-lg bg-indigo-100 border border-indigo-200 text-indigo-700 text-[11px] font-black text-center">
                          {group.name}
                        </div>
                        <div
                          className="grid gap-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200"
                          style={{ gridTemplateColumns: `repeat(${group.cols}, minmax(0, 1fr))` }}
                        >
                          {group.activeDesks.map((desk) => {
                            if (!desk.isSelectable) {
                              return (
                                <div
                                  key={desk.id}
                                  className="h-[54px] rounded-lg border border-dashed border-slate-200 bg-white/50 flex flex-col items-center justify-center text-[10px] text-slate-300"
                                  title={`${desk.label} (조정 불가)`}
                                >
                                  <span className="font-black leading-none">{desk.number ?? '-'}</span>
                                  <span className="leading-none mt-1">-</span>
                                </div>
                              );
                            }

                            const isSelected = selectedDesks.has(desk.id);
                            return (
                              <Button
                                key={desk.id}
                                size="xs"
                                tone="blue"
                                kind={isSelected ? "soft" : "outline"}
                                rounded="lg"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  handleDeskMouseDown(desk.id);
                                }}
                                onMouseEnter={() => handleDeskMouseEnter(desk.id)}
                                className="flex h-[54px] flex-col items-center justify-center px-1 py-1"
                                title={`${desk.label} / ${formatCurrency(desk.currentPrice)}`}
                              >
                                <span className="text-[11px] font-black leading-none">{desk.number ?? '-'}</span>
                                <span className="text-[9px] leading-none mt-1 opacity-70">
                                  {formatCurrency(desk.currentPrice)}
                                </span>
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
          )}
        </section>

        {targetDesks.length > 0 && hasValidAdjustment && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 md:p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-700 space-y-1">
                <p className="font-bold">시세 조정 전 확인 사항</p>
                <p>
                  적용 대상: <span className="font-black">{targetDesks.length}개 자리</span>,{' '}
                  {isRateMode ? (
                    <>
                      조정률: <span className="font-black">{effectiveRate > 0 ? '+' : ''}{effectiveRate}%</span>
                    </>
                  ) : (
                    <>
                      지정 시세: <span className="font-black">{formatCurrency(effectiveDirectPrice)}</span>
                    </>
                  )}
                </p>
                {!isRateMode && (
                  <p>선택한 자리의 현재 시세는 모두 동일한 목표 금액으로 재설정됩니다.</p>
                )}
                <p>변경 사유는 거래 기록과 함께 경제 이벤트 로그에 남습니다.</p>
                <p>공시지가는 시세의 {officialPriceRatio}% 기준으로 함께 재계산됩니다.</p>
              </div>
            </div>
          </section>
        )}
      </Modal.Body>

      <Modal.Footer className="flex flex-col sm:flex-row gap-2 pt-4">
        <Button size="md"
          type="button"
          onClick={handleClose}
          tone="slate"
          kind="soft"
          className="flex-1"
        >
          취소
        </Button>
        <Button size="md"
          onClick={handleSubmit}
          isLoading={loading}
          loadingText="처리 중..."
          disabled={!selectedReason || !hasValidAdjustment || targetDesks.length === 0}
          tone="blue"
          className="flex-1 disabled:opacity-50"
        >
          시세 조정 적용
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default PriceAdjustmentModal;
