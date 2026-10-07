import { appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Archive, Gavel, Landmark, ShieldAlert, Trash2 } from 'lucide-react';
import { BulkActionFloatingBar, Button, EmptyState, InputField, Modal, SectionLoader, SelectField } from '../../../components/ui';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { useUser } from '../../../contexts/UserContext';
import { db } from '../../../firebase';
import { formatDateKeyInKST, toDate } from '../../../utils/kstDate';
import { combineKstDateAndTime, splitKstDateTime } from '../../store/utils/timeSale';
import RentContractSeatPicker from '../components/RentContractSeatPicker';
import RealEstateAuctionCard from '../components/RealEstateAuctionCard';
import { updateAuctionStateAPI } from '../services/realEstateService';
import { toViewerLayoutGroups } from '../utils/deskSummary';

const SUBTABS = [
  { id: 'public', label: '공공 경매', icon: Landmark },
  { id: 'foreclosure', label: '압류 경매', icon: ShieldAlert },
];

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_AUCTION_DURATION_DAYS = 3;
const ACTIVE_AUCTION_STATUSES = new Set(['queued', 'active', 'awaiting_payment']);
const ENDED_AUCTION_STATUSES = new Set(['settled', 'cancelled', 'ended_no_bid']);
const AUCTION_VIEW_FILTERS = [
  { id: 'live', label: '운영 중' },
  { id: 'active', label: '진행 중' },
  { id: 'queued', label: '시작 대기' },
  { id: 'awaiting_payment', label: '결제 대기' },
  { id: 'ended', label: '종료 기록' },
];

const toDateTimeParts = (value) => {
  const parts = splitKstDateTime(value);
  return {
    date: parts.date || formatDateKeyInKST(new Date()),
    time: parts.time || '09:00',
  };
};

const createDefaultEndSchedule = ({ durationDays = DEFAULT_AUCTION_DURATION_DAYS } = {}) => {
  const endAt = new Date(Date.now() + durationDays * ONE_DAY_MS);
  const end = toDateTimeParts(endAt);
  return {
    endDate: end.date,
    endTime: end.time,
  };
};

const sortByCreatedAtDesc = (items) => [...items].sort((left, right) => {
  const leftTime = toDate(left?.createdAt)?.getTime() || 0;
  const rightTime = toDate(right?.createdAt)?.getTime() || 0;
  return rightTime - leftTime;
});
const getAuctionDeadlineMs = (auction) => {
  const status = String(auction?.status || '');
  const target = status === 'awaiting_payment'
    ? auction?.paymentDueAt
    : status === 'queued'
      ? auction?.scheduledStartAt
      : auction?.endAt;
  return toDate(target)?.getTime() || Number.MAX_SAFE_INTEGER;
};

const sortAuctionCardsByUrgency = (items) => [...items].sort((left, right) => {
  const priority = { active: 0, awaiting_payment: 1, queued: 2 };
  const leftPriority = priority[String(left?.status || '')] ?? 3;
  const rightPriority = priority[String(right?.status || '')] ?? 3;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return getAuctionDeadlineMs(left) - getAuctionDeadlineMs(right);
});

const getMinimumBid = (auction) => {
  const currentBid = Number(auction?.currentBid || 0);
  const bidStep = Math.max(1, Number(auction?.bidStep || 1));
  const startPrice = Math.max(1, Number(auction?.startPrice || 1));
  return currentBid > 0 ? currentBid + bidStep : startPrice;
};

const isArchivedAuctionRecord = (auction) => Boolean(auction?.archivedAt || auction?.isArchived);
const isEndedAuctionRecord = (auction) => ENDED_AUCTION_STATUSES.has(String(auction?.status || ''));

const canDeleteAuctionRecord = (auction) => {
  const status = String(auction?.status || '');
  const bidCount = Number(auction?.bidCount || 0);
  return auction?.source === 'public'
    && ['cancelled', 'ended_no_bid'].includes(status)
    && bidCount === 0
    && !auction?.winnerUid
    && !auction?.settlement;
};

const matchesAuctionView = (auction, view) => {
  const status = String(auction?.status || '');

  if (view === 'active') return status === 'active';
  if (view === 'queued') return status === 'queued';
  if (view === 'awaiting_payment') return status === 'awaiting_payment';
  if (view === 'ended') return ENDED_AUCTION_STATUSES.has(status);
  return ACTIVE_AUCTION_STATUSES.has(status);
};

const DeskSelect = ({ label, value, onChange, desks, disabled, groups, placementData }) => (
  <div className="space-y-2 sm:col-span-2">
  <p className="text-sm font-bold text-slate-800">{label}</p>
  <RentContractSeatPicker groups={groups} placementData={placementData} neutralSelection
    selectionLabel={label} selectableIds={new Set(disabled ? [] : desks.map(desk => desk.id))}
    selectedIds={new Set(value ? [value] : [])} onToggle={onChange} />
  <SelectField
    label={label}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    disabled={disabled}
    placeholder="자리를 선택해 주세요"
    className="rounded-2xl font-semibold text-slate-900"
    labelClassName="block text-xs font-black uppercase tracking-[0.18em] text-slate-400"
    options={desks.map((desk) => ({
      value: desk.id,
      label: desk.label || `${desk.number ?? '-'}번 자리`,
    }))}
  />
  <p className="text-xs text-slate-500">흐리게 표시된 책상은 경매 대상이 아닙니다.</p>
  </div>
);

const NumberField = ({ label, value, onChange, disabled, formatCurrency, min = 1 }) => (
 <div>
  <InputField
    type="number"
    min={min}
    label={label}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    disabled={disabled}
    size="lg"
    tone="slate"
    className="rounded-2xl font-semibold text-slate-900"
    labelClassName="block text-xs font-black uppercase tracking-[0.18em] text-slate-400"
  />
  <p className="mt-1 text-xs text-slate-600">{Number(value) > 0 ? formatCurrency(Number(value)) : '1 이상 입력해 주세요'}</p>
 </div>
);

const CompactDateTimeFieldGroup = ({
  title,
  dateValue,
  timeValue,
  onDateChange,
  onTimeChange,
  disabled,
  minDate,
  helperText = '',
  tone = 'slate',
}) => {
  const accentClass = tone === 'rose' ? 'text-rose-700' : 'text-slate-700';
  const inputValue = dateValue && timeValue ? `${dateValue}T${timeValue}` : '';
  const minValue = minDate ? `${minDate}T00:00` : undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className={`text-sm font-medium ${accentClass}`}>{title}</p>
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-slate-500">{"\uB0A0\uC9DC\uC640 \uC2DC\uAC04"}</label>
        <InputField
          aria-label={title}
          type="datetime-local"
          value={inputValue}
          min={minValue}
          onChange={(event) => {
            const nextValue = String(event.target.value || '');
            if (!nextValue) {
              onDateChange('');
              onTimeChange('');
              return;
            }

            const [nextDate = '', nextTime = ''] = nextValue.split('T');
            onDateChange(nextDate);
            onTimeChange(nextTime.slice(0, 5));
          }}
          disabled={disabled}
          tone="slate"
          size="md"
          wrapperClassName="space-y-0"
          className="rounded-lg font-medium text-slate-900"
        />
        <div className="hidden">
          <label className="text-[11px] text-slate-500">날짜</label>
          <input
            type="date"
            value={dateValue}
            min={minDate}
            onChange={(event) => onDateChange(event.target.value)}
            disabled={disabled}
            className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-slate-300 disabled:bg-slate-100 disabled:text-slate-400"
          />
        </div>
        <div className="hidden">
          <label className="text-[11px] text-slate-500">시간</label>
          <input
            type="time"
            value={timeValue}
            onChange={(event) => onTimeChange(event.target.value)}
            disabled={disabled}
            className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-slate-300 disabled:bg-slate-100 disabled:text-slate-400"
          />
        </div>
      </div>
      {helperText ? (
        <p className="mt-2 text-[11px] font-medium text-slate-500">{helperText}</p>
      ) : null}
    </div>
  );
};

export default function RealEstateAuctionTab({ classId, layoutData, configData }) {
  const { userData, isTeacher, formatCurrency } = useUser();
  const { showFeedback } = useFeedback();
  const publicDefaults = useMemo(() => createDefaultEndSchedule(), []);
  const foreclosureDefaults = useMemo(() => createDefaultEndSchedule(), []);
  const todayDateKey = formatDateKeyInKST(new Date());

  const [activeSubTab, setActiveSubTab] = useState('public');
  const [auctionView, setAuctionView] = useState('live');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedAuctionIds, setSelectedAuctionIds] = useState([]);
  const [auctions, setAuctions] = useState([]);
  const [isReady, setIsReady] = useState(false);
  const [busyAction, setBusyAction] = useState('');

  const [publicStartMode, setPublicStartMode] = useState('now');
  const [foreclosureStartMode, setForeclosureStartMode] = useState('now');
  const [publicDeskId, setPublicDeskId] = useState('');
  const [publicStartPrice, setPublicStartPrice] = useState('');
  const [publicBidStep, setPublicBidStep] = useState('');
  const [publicStartDateKey, setPublicStartDateKey] = useState('');
  const [publicStartTime, setPublicStartTime] = useState('');
  const [publicEndDateKey, setPublicEndDateKey] = useState(publicDefaults.endDate);
  const [publicEndTime, setPublicEndTime] = useState(publicDefaults.endTime);

  const [foreclosureDeskId, setForeclosureDeskId] = useState('');
  const [foreclosureReason, setForeclosureReason] = useState('수동 압류');
  const [foreclosureStartPrice, setForeclosureStartPrice] = useState('');
  const [foreclosureBidStep, setForeclosureBidStep] = useState('');
  const [foreclosureStartDateKey, setForeclosureStartDateKey] = useState('');
  const [foreclosureStartTime, setForeclosureStartTime] = useState('');
  const [foreclosureEndDateKey, setForeclosureEndDateKey] = useState(foreclosureDefaults.endDate);
  const [foreclosureEndTime, setForeclosureEndTime] = useState(foreclosureDefaults.endTime);

  const [bidValues, setBidValues] = useState({});

  const summaryGroups = useMemo(
    () => toViewerLayoutGroups(layoutData?.groups),
    [layoutData?.groups],
  );

  const allDesks = useMemo(() => {
    return summaryGroups.flatMap((group) =>
      (group?.desks || []).filter((desk) => desk?.isActive !== false),
    );
  }, [summaryGroups]);

  const publicCandidates = useMemo(() => {
    return allDesks.filter((desk) => !desk.ownerId && !desk.auctionSummary?.auctionId && !desk.foreclosureInfo?.status);
  }, [allDesks]);

  const foreclosureCandidates = useMemo(() => {
    return allDesks.filter(
      (desk) =>
        desk.ownerId &&
        desk.ownerType !== 'classFund' &&
        !desk.auctionSummary?.auctionId,
    );
  }, [allDesks]);

  const publicSelectedDesk = useMemo(
    () => publicCandidates.find((desk) => desk.id === publicDeskId) || null,
    [publicCandidates, publicDeskId],
  );

  const foreclosureSelectedDesk = useMemo(
    () => foreclosureCandidates.find((desk) => desk.id === foreclosureDeskId) || null,
    [foreclosureCandidates, foreclosureDeskId],
  );

  useEffect(() => {
    setIsReady(false);
    if (!classId) {
      setAuctions([]);
      setIsReady(true);
      return undefined;
    }

    const auctionsRef = collection(db, 'classes', classId, 'real_estate_auctions');
    const unsubscribe = onSnapshot(
      auctionsRef,
      (snapshot) => {
        setAuctions(sortByCreatedAtDesc(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))));
        setIsReady(true);
      },
      (error) => {
        console.error('[RealEstateAuctionTab] auction subscribe failed:', error);
        setAuctions([]);
        setIsReady(true);
      },
    );

    return () => unsubscribe();
  }, [classId]);

  useEffect(() => {
    if (!publicDeskId && publicCandidates[0]) {
      setPublicDeskId(publicCandidates[0].id);
    }
  }, [publicCandidates, publicDeskId]);

  useEffect(() => {
    if (!foreclosureDeskId && foreclosureCandidates[0]) {
      setForeclosureDeskId(foreclosureCandidates[0].id);
    }
  }, [foreclosureCandidates, foreclosureDeskId]);

  useEffect(() => {
    if (!publicSelectedDesk) return;
    const suggestedStart = Math.max(1, Math.round(Number(publicSelectedDesk.lastPurchasePrice || publicSelectedDesk.price || 0)));
    const suggestedStep = Math.max(1, Math.round(suggestedStart * 0.05));
    setPublicStartPrice(String(suggestedStart));
    setPublicBidStep(String(suggestedStep));
  }, [publicSelectedDesk]);

  useEffect(() => {
    if (!foreclosureSelectedDesk) return;
    const base = Math.max(1, Math.round(Number(foreclosureSelectedDesk.lastPurchasePrice || foreclosureSelectedDesk.price || 0)));
    const suggestedStart = Math.max(1, Math.round(base * 0.8));
    const suggestedStep = Math.max(1, Math.round(suggestedStart * 0.05));
    setForeclosureStartPrice(String(suggestedStart));
    setForeclosureBidStep(String(suggestedStep));
  }, [foreclosureSelectedDesk]);

  const availableAuctions = useMemo(
    () => auctions.filter((auction) => !isArchivedAuctionRecord(auction)),
    [auctions],
  );

  const publicAuctions = useMemo(() => availableAuctions.filter((auction) => auction.source === 'public'), [availableAuctions]);
  const foreclosureAuctions = useMemo(() => availableAuctions.filter((auction) => auction.source === 'foreclosure'), [availableAuctions]);
  const baseAuctions = activeSubTab === 'public' ? publicAuctions : foreclosureAuctions;
  const endedAuctionCount = useMemo(
    () => baseAuctions.filter((auction) => !ACTIVE_AUCTION_STATUSES.has(String(auction?.status || ''))).length,
    [baseAuctions],
  );

  const visibleAuctions = useMemo(() => {
    return baseAuctions.filter((auction) => matchesAuctionView(auction, auctionView));
  }, [auctionView, baseAuctions]);
  const displayAuctions = useMemo(
    () => (auctionView === 'live' ? sortAuctionCardsByUrgency(visibleAuctions) : visibleAuctions),
    [auctionView, visibleAuctions],
  );

  const selectedEndedAuctions = useMemo(
    () => visibleAuctions.filter((auction) => isEndedAuctionRecord(auction) && selectedAuctionIds.includes(auction.id)),
    [selectedAuctionIds, visibleAuctions],
  );

  const deletableSelectedAuctions = useMemo(
    () => selectedEndedAuctions.filter((auction) => canDeleteAuctionRecord(auction)),
    [selectedEndedAuctions],
  );

  useEffect(() => {
    if (auctionView !== 'ended') {
      setSelectedAuctionIds([]);
    }
  }, [auctionView]);

  useEffect(() => {
    setSelectedAuctionIds((prev) => {
      if (!prev.length) return prev;
      const allowedIds = new Set(visibleAuctions.filter((auction) => isEndedAuctionRecord(auction)).map((auction) => auction.id));
      const next = prev.filter((id) => allowedIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [visibleAuctions]);

  useEffect(() => {
    setSelectedAuctionIds([]);
  }, [activeSubTab]);

  const combineAuctionDateTime = (dateValue, timeValue, label) => {
    const combined = combineKstDateAndTime(dateValue, timeValue);
    if (!combined) {
      showFeedback(`${label}을 올바르게 입력해 주세요.`, 'warning');
      return null;
    }
    return combined;
  };

  const resolveOptionalAuctionDateTime = (dateValue, timeValue, label) => {
    const hasDate = String(dateValue || '').trim() !== '';
    const hasTime = String(timeValue || '').trim() !== '';

    if (!hasDate && !hasTime) {
      return { value: null, missing: false, invalid: false };
    }

    if (!hasDate || !hasTime) {
      showFeedback(`${label}은 날짜와 시간을 함께 입력해 주세요.`, 'warning');
      return { value: null, missing: true, invalid: false };
    }

    const value = combineAuctionDateTime(dateValue, timeValue, label);
    return { value, missing: false, invalid: !value };
  };

  const runAuctionAction = async (action, payload, successMessage) => {
    if (!classId) return false;
    setBusyAction(action);
    try {
      const result = await updateAuctionStateAPI({ classId, action, payload });
      if (successMessage) {
        showFeedback(successMessage, 'success');
      }
      return result;
    } catch (error) {
      showFeedback(error.message || '부동산 경매 처리 중 오류가 발생했습니다.', 'error');
      return false;
    } finally {
      setBusyAction('');
    }
  };

  const handleCreatePublicAuction = async () => {
    if (!publicSelectedDesk) {
      showFeedback('공공 경매로 등록할 자리를 선택해 주세요.', 'warning');
      return;
    }

    const endAt = combineAuctionDateTime(publicEndDateKey, publicEndTime, '마감 일시');
    if (!endAt) return;

    if (publicStartMode === 'scheduled' && (!publicStartDateKey || !publicStartTime)) {
      showFeedback('예약 시작 날짜와 시간을 입력해 주세요.', 'warning');
      return;
    }
    const startAtResult = resolveOptionalAuctionDateTime(publicStartMode === 'scheduled' ? publicStartDateKey : '', publicStartMode === 'scheduled' ? publicStartTime : '', '시작 일시');
    if (startAtResult.missing || startAtResult.invalid) return;

    const startAt = startAtResult.value;
    if (startAt && startAt.getTime() <= Date.now()) {
      showFeedback('예약 시작 일시는 현재 시각 이후여야 합니다.', 'warning');
      return;
    }

    const minimumEndMs = startAt ? startAt.getTime() : Date.now();
    if (endAt.getTime() <= minimumEndMs) {
      showFeedback(
        startAt
          ? '마감 일시는 시작 일시보다 늦어야 합니다.'
          : '마감 일시는 현재 시각 이후여야 합니다.',
        'warning',
      );
      return;
    }

    const isCreated = await runAuctionAction(
      'create_public',
      {
        deskId: publicDeskId,
        startPrice: Number(publicStartPrice),
        bidStep: Number(publicBidStep),
        startAt: startAt ? startAt.toISOString() : null,
        endAt: endAt.toISOString(),
      },
      '공공 경매를 등록했습니다.',
    );
    if (isCreated) {
      setIsCreateModalOpen(false);
    }
  };

  const handleManualForeclosure = async () => {
    if (!foreclosureSelectedDesk) {
      showFeedback('압류할 자리를 선택해 주세요.', 'warning');
      return;
    }

    if (foreclosureStartMode === 'scheduled' && (!foreclosureStartDateKey || !foreclosureStartTime)) {
      showFeedback('예약 시작 날짜와 시간을 입력해 주세요.', 'warning');
      return;
    }
    const startAtResult = resolveOptionalAuctionDateTime(foreclosureStartMode === 'scheduled' ? foreclosureStartDateKey : '', foreclosureStartMode === 'scheduled' ? foreclosureStartTime : '', '시작 일시');
    if (startAtResult.missing || startAtResult.invalid) return;

    const startAt = startAtResult.value;
    const isScheduled = Boolean(startAt);
    const modeLabel = isScheduled ? '예약 경매' : '즉시 경매';
    const confirmed = (await appConfirm(`선택한 자산을 ${modeLabel} 상태로 전환할까요?`));
    if (!confirmed) return;

    const endAt = combineAuctionDateTime(foreclosureEndDateKey, foreclosureEndTime, '마감 일시');
    if (!endAt) return;

    if (startAt && startAt.getTime() <= Date.now()) {
      showFeedback('예약 시작 일시는 현재 시각 이후여야 합니다.', 'warning');
      return;
    }

    const minimumEndMs = startAt ? startAt.getTime() : Date.now();
    if (endAt.getTime() <= minimumEndMs) {
      showFeedback(
        startAt
          ? '마감 일시는 시작 일시보다 늦어야 합니다.'
          : '마감 일시는 현재 시각 이후여야 합니다.',
        'warning',
      );
      return;
    }

    const isCreated = await runAuctionAction(
      'manual_foreclosure',
      {
        deskId: foreclosureDeskId,
        mode: isScheduled ? 'queue' : 'auction_now',
        reason: foreclosureReason,
        startPrice: Number(foreclosureStartPrice),
        bidStep: Number(foreclosureBidStep),
        startAt: startAt ? startAt.toISOString() : null,
        endAt: endAt.toISOString(),
      },
      `수동 압류를 완료했습니다. (${modeLabel})`,
    );
    if (isCreated) {
      setIsCreateModalOpen(false);
    }
  };

  const handleDeleteAuctionRecord = async (auction) => {
    if (!canDeleteAuctionRecord(auction)) {
      showFeedback('입찰 또는 정산 이력이 있는 경매 기록은 삭제할 수 없습니다.', 'warning');
      return;
    }

    const confirmed = (await appConfirm('테스트용 공공 경매 기록을 완전히 삭제할까요?', {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}));
    if (!confirmed) return;

    await runAuctionAction(
      'delete_record',
      { auctionId: auction.id },
      '공공 경매 테스트 기록을 삭제했습니다.',
    );
  };

  const toggleAuctionSelection = (auctionId) => {
    setSelectedAuctionIds((prev) => (
      prev.includes(auctionId)
        ? prev.filter((id) => id !== auctionId)
        : [...prev, auctionId]
    ));
  };

  const clearAuctionSelection = () => {
    setSelectedAuctionIds([]);
  };

  const runBatchAuctionAction = async ({
    action,
    auctions: targetAuctions,
    busyKey,
    confirmMessage,
    successMessage,
    emptyMessage,
  }) => {
    const targets = Array.isArray(targetAuctions) ? targetAuctions.filter(Boolean) : [];
    if (!targets.length) {
      showFeedback(emptyMessage, 'warning');
      return false;
    }

    const confirmed = (await appConfirm(confirmMessage));
    if (!confirmed) return false;

    setBusyAction(busyKey);
    try {
      for (const auction of targets) {
        await updateAuctionStateAPI({
          classId,
          action,
          payload: { auctionId: auction.id },
        });
      }
      showFeedback(successMessage, 'success');
      setSelectedAuctionIds([]);
      return true;
    } catch (error) {
      showFeedback(error.message || '경매 기록 일괄 처리 중 오류가 발생했습니다.', 'error');
      return false;
    } finally {
      setBusyAction('');
    }
  };

  const handleArchiveSelectedAuctions = async () => runBatchAuctionAction({
    action: 'archive_record',
    auctions: selectedEndedAuctions,
    busyKey: 'bulk-archive',
    confirmMessage: `선택한 ${selectedEndedAuctions.length}건의 종료 기록을 목록에서 숨길까요?`,
    successMessage: `${selectedEndedAuctions.length}건의 경매 기록을 보관했습니다.`,
    emptyMessage: '보관할 종료 기록을 먼저 선택해 주세요.',
  });

  const handleDeleteSelectedAuctions = async () => runBatchAuctionAction({
    action: 'delete_record',
    auctions: deletableSelectedAuctions,
    busyKey: 'bulk-delete',
    confirmMessage: `선택한 테스트용 공공 경매 기록 ${deletableSelectedAuctions.length}건을 완전히 삭제할까요?`,
    successMessage: `${deletableSelectedAuctions.length}건의 테스트 기록을 삭제했습니다.`,
    emptyMessage: '완전히 삭제할 수 있는 테스트 기록을 선택해 주세요.',
  });

  const renderAuctionCard = (auction, variant = 'default', auctionNumber) => {
    const minimumBid = getMinimumBid(auction);
    const isWinner = auction.winnerUid === userData?.uid;
    const bidValue = bidValues[auction.id] ?? String(minimumBid);

    return (
      <RealEstateAuctionCard
        key={auction.id}
        auction={auction}
        formatCurrency={formatCurrency}
        isTeacher={isTeacher}
        isWinner={isWinner}
        minimumBid={minimumBid}
        bidValue={bidValue}
        onBidValueChange={(value) => setBidValues((prev) => ({ ...prev, [auction.id]: value }))}
        onActivate={() => runAuctionAction('activate_queued', { auctionId: auction.id }, '경매를 시작했습니다.')}
        onClose={() => runAuctionAction('close', { auctionId: auction.id }, '경매를 마감했습니다.')}
        onCancel={() => runAuctionAction('cancel', { auctionId: auction.id }, '경매를 취소했습니다.')}
        onPlaceBid={() => runAuctionAction('place_bid', { auctionId: auction.id, bidAmount: Number(bidValue) }, '입찰을 완료했습니다.')}
        onPay={() => runAuctionAction('pay', { auctionId: auction.id }, '낙찰 결제를 완료했습니다.')}
        selectable={isTeacher && isEndedView && isEndedAuctionRecord(auction)}
        selected={selectedAuctionIds.includes(auction.id)}
        onToggleSelect={() => toggleAuctionSelection(auction.id)}
        canDeleteRecord={canDeleteAuctionRecord(auction)}
        onDeleteRecord={() => handleDeleteAuctionRecord(auction)}
        isBusy={busyAction !== ''}
        variant={variant}
        auctionNumber={auctionNumber}
      />
    );
  };

  /* const cards = [];
    { key: 'active', label: '진행 중', value: `${summary.activeCount}건`, tone: 'border-blue-200 bg-blue-50 text-blue-900' },
    { key: 'queued', label: '대기 중', value: `${summary.queuedCount}건`, tone: 'border-slate-200 bg-slate-50 text-slate-900' },
    { key: 'awaiting', label: '결제 대기', value: `${summary.awaitingPaymentCount}건`, tone: 'border-amber-200 bg-amber-50 text-amber-900' },
    { key: 'settled', label: '정산 완료', value: `${summary.settledCount}건`, tone: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  ]; */

  const publicOngoingCount = publicAuctions.filter((auction) => ACTIVE_AUCTION_STATUSES.has(String(auction?.status || ''))).length;
  const foreclosureOngoingCount = foreclosureAuctions.filter((auction) => ACTIVE_AUCTION_STATUSES.has(String(auction?.status || ''))).length;
  const isPublicTab = activeSubTab === 'public';
  const CreatePanelIcon = isPublicTab ? Landmark : ShieldAlert;
  const createPanelTitle = isPublicTab
    ? '\uACF5\uACF5 \uACBD\uB9E4 \uB4F1\uB85D'
    : '\uC555\uB958 \uACBD\uB9E4 \uB4F1\uB85D';
  const createPanelDescription = isPublicTab
    ? '\uAD6D\uAC00 \uC790\uC0B0\uC744 \uC989\uC2DC \uC2DC\uC791 \uB610\uB294 \uC608\uC57D \uC2DC\uC791\uC73C\uB85C \uB4F1\uB85D\uD569\uB2C8\uB2E4.'
    : '\uC555\uB958 \uC790\uC0B0\uC744 \uC989\uC2DC \uACBD\uB9E4 \uB610\uB294 \uC608\uC57D \uACBD\uB9E4\uB85C \uC804\uD658\uD569\uB2C8\uB2E4.';
  const createPanelSummary = isPublicTab
    ? `\uAC00\uB2A5 \uC790\uB9AC ${publicCandidates.length}\uAC1C \u00B7 \uC9C4\uD589/\uB300\uAE30 ${publicOngoingCount}\uAC74`
    : `\uB300\uC0C1 \uC790\uB9AC ${foreclosureCandidates.length}\uAC1C \u00B7 \uC9C4\uD589/\uB300\uAE30 ${foreclosureOngoingCount}\uAC74`;
  /*
  const createPanelTitle = isPublicTab ? '공공 경매 등록' : '압류 경매 등록';
  const createPanelDescription = isPublicTab
    ? '국가 자산을 즉시 시작 또는 예약 시작으로 등록합니다.'
    : '압류 자산을 즉시 경매 또는 예약 경매로 전환합니다.';
  const createPanelSummary = isPublicTab
    ? `가능 자리 ${publicCandidates.length}개 · 진행/대기 ${publicOngoingCount}건`
    : `대상 자리 ${foreclosureCandidates.length}개 · 진행/대기 ${foreclosureOngoingCount}건`;
  */
  const isEndedView = auctionView === 'ended';

  return (
    <div className="space-y-4 animate-fadeIn">
      {!configData?.enabled ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
          부동산 시스템이 비활성화 상태여서 경매 관리가 제한됩니다.
        </div>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className={`shrink-0 rounded-xl p-2 ${isPublicTab ? 'bg-indigo-50 text-indigo-600' : 'bg-rose-50 text-rose-600'}`}>
              <Gavel size={18} />
            </div>
            <div>
              <p className="text-lg font-extrabold text-slate-800">
                {isPublicTab ? '공공 경매' : "\uC555\uB958 \uACBD\uB9E4"}
              </p>
              {auctionView === 'live' ? (
                <div className="mt-1 flex items-center gap-2 text-xs font-bold text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  <span>{visibleAuctions.length}{"\uAC74 \uC9C4\uD589 \uC911"}</span>
                </div>
              ) : (
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {isEndedView ? `${endedAuctionCount}\uAC74\uC758 \uC885\uB8CC \uAE30\uB85D` : "\uC0C1\uD0DC\uBCC4 \uACBD\uB9E4 \uD604\uD669"}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-500">{visibleAuctions.length}{"\uAC74 \uBCF4\uAE30"}</span>
            {isTeacher ? (
              <Button
                icon={CreatePanelIcon}
                tone={isPublicTab ? "slate" : "red"}
                onClick={() => setIsCreateModalOpen(true)}
              >
                {createPanelTitle}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1">
            {SUBTABS.map(({ id, label }) => (
              <Button
                key={id}
                size="sm"
                tone={id === 'public' ? 'indigo' : 'red'}
                kind={activeSubTab === id ? 'soft' : 'ghost'}
                rounded="lg"
                onClick={() => setActiveSubTab(id)}
              >
                {label}
              </Button>
            ))}
          </div>

          <SelectField label="경매 상태" value={auctionView} onChange={event => setAuctionView(event.target.value)} options={AUCTION_VIEW_FILTERS.map(filter => ({value: filter.id, label: `${filter.label} (${baseAuctions.filter(auction => matchesAuctionView(auction, filter.id)).length})`}))} />

        </div>
      </section>

      <Modal
        isOpen={Boolean(isTeacher && isCreateModalOpen)}
        onClose={() => setIsCreateModalOpen(false)}
        title={createPanelTitle}
        size="lg"
      >
        <Modal.Body className="space-y-5">
          <div className={`rounded-2xl border px-4 py-3 ${isPublicTab ? 'border-slate-200 bg-slate-50' : 'border-rose-200 bg-rose-50/70'}`}>
            <p className="text-sm font-semibold text-slate-800">{createPanelDescription}</p>
            <p className={`mt-1 text-xs font-semibold ${isPublicTab ? 'text-slate-500' : 'text-rose-700'}`}>{createPanelSummary}</p>
          </div>

          {activeSubTab === 'public' && (
          <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/70 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <DeskSelect
                label="공공 경매 자리"
                value={publicDeskId}
                onChange={setPublicDeskId}
                desks={publicCandidates}
                groups={summaryGroups} placementData={layoutData}
                disabled={busyAction !== ''}
              />
              <NumberField formatCurrency={formatCurrency} label="시작가" value={publicStartPrice} onChange={setPublicStartPrice} disabled={busyAction !== ''} />
              <NumberField formatCurrency={formatCurrency} label="입찰 단위" value={publicBidStep} onChange={setPublicBidStep} disabled={busyAction !== ''} />
            </div>

            <fieldset className="mt-4 flex gap-4 text-sm"><legend className="mb-2 font-bold">시작 방식</legend>{[['now', '즉시 시작'], ['scheduled', '예약 시작']].map(([mode, label]) => <label key={mode} className="flex items-center gap-2"><input type="radio" name="public-start-mode" checked={publicStartMode === mode} disabled={busyAction !== ''} onChange={() => setPublicStartMode(mode)} />{label}</label>)}</fieldset>
            <div className="mt-3 grid gap-3 rounded-lg bg-gray-50 p-4 md:grid-cols-2">
              <CompactDateTimeFieldGroup
                title="시작 일시 선택"
                dateValue={publicStartMode === 'scheduled' ? publicStartDateKey : ''}
                timeValue={publicStartMode === 'scheduled' ? publicStartTime : ''}
                onDateChange={setPublicStartDateKey}
                onTimeChange={setPublicStartTime}
                disabled={busyAction !== '' || publicStartMode === 'now'}
                minDate={todayDateKey}
                helperText={publicStartMode === 'now' ? '등록하면 즉시 시작합니다.' : '시작 날짜와 시간을 입력해 주세요.'}
              />
              <CompactDateTimeFieldGroup
                title="마감 일시"
                dateValue={publicEndDateKey}
                timeValue={publicEndTime}
                onDateChange={setPublicEndDateKey}
                onTimeChange={setPublicEndTime}
                disabled={busyAction !== ''}
                minDate={todayDateKey}
              />
            </div>

            <p className="hidden mt-2 text-[11px] text-slate-500">
              가능 자리 {publicCandidates.length}개, 진행/대기 중 {publicOngoingCount}건
            </p>

            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700" aria-label="등록 내용 확인">
              <p className="font-bold">{publicSelectedDesk?.label || (`${publicSelectedDesk?.number ?? '-'}번 자리`)} · 시작가 {formatCurrency(Number(publicStartPrice) || 0)} · 입찰 단위 {formatCurrency(Number(publicBidStep) || 0)}</p>
              <p className="mt-1">시작: {publicStartMode === 'now' ? '즉시' : (`${publicStartDateKey} ${publicStartTime}`).trim() || '예약 일시 미입력'} · 마감: {publicEndDateKey} {publicEndTime}</p>
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                icon={Landmark}
                tone="slate"
                onClick={handleCreatePublicAuction}
                disabled={busyAction !== '' || !publicSelectedDesk}
              >
                공공 경매 등록
              </Button>
            </div>
          </div>
        )}

          {activeSubTab === 'foreclosure' && (
          <div className="rounded-[1.6rem] border border-rose-200 bg-rose-50/60 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <DeskSelect
                label="압류 대상 자리"
                value={foreclosureDeskId}
                onChange={setForeclosureDeskId}
                desks={foreclosureCandidates}
                groups={summaryGroups} placementData={layoutData}
                disabled={busyAction !== ''}
              />
              <NumberField formatCurrency={formatCurrency} label="시작가" value={foreclosureStartPrice} onChange={setForeclosureStartPrice} disabled={busyAction !== ''} />
              <NumberField formatCurrency={formatCurrency} label="입찰 단위" value={foreclosureBidStep} onChange={setForeclosureBidStep} disabled={busyAction !== ''} />
            </div>

            <fieldset className="mt-4 flex gap-4 text-sm"><legend className="mb-2 font-bold">시작 방식</legend>{[['now', '즉시 시작'], ['scheduled', '예약 시작']].map(([mode, label]) => <label key={mode} className="flex items-center gap-2"><input type="radio" name="foreclosure-start-mode" checked={foreclosureStartMode === mode} disabled={busyAction !== ''} onChange={() => setForeclosureStartMode(mode)} />{label}</label>)}</fieldset>
            <div className="mt-3 grid gap-3 rounded-lg bg-rose-50/70 p-4 md:grid-cols-2">
              <CompactDateTimeFieldGroup
                title="시작 일시 선택"
                dateValue={foreclosureStartMode === 'scheduled' ? foreclosureStartDateKey : ''}
                timeValue={foreclosureStartMode === 'scheduled' ? foreclosureStartTime : ''}
                onDateChange={setForeclosureStartDateKey}
                onTimeChange={setForeclosureStartTime}
                disabled={busyAction !== '' || foreclosureStartMode === 'now'}
                minDate={todayDateKey}
                helperText={foreclosureStartMode === 'now' ? '등록하면 즉시 시작합니다.' : '시작 날짜와 시간을 입력해 주세요.'}
                tone="rose"
              />
              <CompactDateTimeFieldGroup
                title="마감 일시"
                dateValue={foreclosureEndDateKey}
                timeValue={foreclosureEndTime}
                onDateChange={setForeclosureEndDateKey}
                onTimeChange={setForeclosureEndTime}
                disabled={busyAction !== ''}
                minDate={todayDateKey}
                tone="rose"
              />
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700" aria-label="등록 내용 확인">
              <p className="font-bold">{foreclosureSelectedDesk?.label || (`${foreclosureSelectedDesk?.number ?? '-'}번 자리`)} · 시작가 {formatCurrency(Number(foreclosureStartPrice) || 0)} · 입찰 단위 {formatCurrency(Number(foreclosureBidStep) || 0)}</p>
              <p className="mt-1">시작: {foreclosureStartMode === 'now' ? '즉시' : (`${foreclosureStartDateKey} ${foreclosureStartTime}`).trim() || '예약 일시 미입력'} · 마감: {foreclosureEndDateKey} {foreclosureEndTime}</p>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <InputField
                label="압류 사유"
                value={foreclosureReason}
                onChange={(event) => setForeclosureReason(event.target.value)}
                disabled={busyAction !== ''}
                size="lg"
                tone="slate"
                className="rounded-2xl font-semibold text-slate-900"
                labelClassName="block text-xs font-black uppercase tracking-[0.18em] text-slate-400"
              />
              <Button
                icon={ShieldAlert}
                tone="red"
                onClick={handleManualForeclosure}
                disabled={busyAction !== '' || !foreclosureSelectedDesk}
              >
                수동 압류 실행
              </Button>
            </div>

            <p className="hidden mt-2 text-[11px] text-rose-700">
              비워두면 즉시 경매, 입력하면 예약 경매입니다. 진행/대기 중 {foreclosureOngoingCount}건
            </p>
          </div>
        )}
        </Modal.Body>
      </Modal>

      <section className="space-y-4">
        {!isReady ? (
          <SectionLoader
            message={"\uACBD\uB9E4 \uAE30\uB85D\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4."}
            tone="slate"
            size="sm"
            showSkeleton={false}
            minHeightClassName="min-h-[320px]"
          />
        ) : visibleAuctions.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title={
              isEndedView
                ? '정리할 종료 기록이 없습니다'
                : activeSubTab === 'public'
                  ? '등록된 공공 경매가 없습니다'
                  : '등록된 압류 경매가 없습니다'
            }
            description="경매가 등록되거나 필터 조건이 바뀌면 이곳에 표시됩니다."
            className="min-h-[320px]"
          />
        ) : (
          <>
            {auctionView === 'live' ? (
              <div className="space-y-4">
              <div className={`grid gap-4 ${displayAuctions.length > 1 ? 'xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.85fr)]' : 'grid-cols-1'}`}>
                {renderAuctionCard(displayAuctions[0], 'featured', 1)}
                {displayAuctions.length > 1 ? (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                    {displayAuctions.slice(1, 3).map((auction, index) => renderAuctionCard(auction, 'compact', index + 2))}
                  </div>
                ) : null}
              </div>

              {displayAuctions.length > 3 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {displayAuctions.slice(3).map((auction, index) => renderAuctionCard(auction, 'default', index + 4))}
                </div>
              ) : null}
              </div>
            ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {displayAuctions.map((auction, index) => renderAuctionCard(auction, 'default', index + 1))}
            </div>
            )}
          </>
        )}
      </section>

      {!isReady ? null : !configData?.enabled ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-800">
          경매를 새로 등록하거나 수정하려면 먼저 부동산 시스템을 활성화해야 합니다.
        </div>
      ) : null}

      {!isReady ? null : !isTeacher && visibleAuctions.some((auction) => auction.status === 'awaiting_payment' && auction.winnerUid === userData?.uid) ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-800">
          낙찰 후 결제 대기 중인 경매가 있습니다. 기한 안에 결제를 완료해야 소유권이 이전됩니다.
        </div>
      ) : null}

      {!isReady ? null : activeSubTab === 'foreclosure' && !isTeacher ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-600">
          압류 경매는 교사가 등록한 자산만 진행됩니다. 학생은 진행 중인 경매에 입찰만 참여할 수 있습니다.
        </div>
      ) : null}

      {isTeacher && selectedEndedAuctions.length > 0 ? (
        <BulkActionFloatingBar
          count={selectedEndedAuctions.length}
          tone="indigo"
          icon={Archive}
          eyebrow="경매 기록 정리"
          title="선택한 종료 기록을 한 번에 정리할 수 있습니다"
          subtitle="낙찰 완료 건은 보관 처리로 목록에서 숨기고, 테스트용 취소 기록만 완전히 삭제할 수 있습니다."
          actions={[
            {
              key: 'archive',
              label: `선택 보관 ${selectedEndedAuctions.length}건`,
              onClick: handleArchiveSelectedAuctions,
              icon: Archive,
              tone: 'slate',
              disabled: busyAction === 'bulk-archive' || busyAction === 'bulk-delete',
              isLoading: busyAction === 'bulk-archive',
            },
            ...(deletableSelectedAuctions.length > 0
              ? [
                  {
                    key: 'delete',
                    label: `완전 삭제 ${deletableSelectedAuctions.length}건`,
                    onClick: handleDeleteSelectedAuctions,
                    icon: Trash2,
                    tone: 'rose',
                    kind: 'outline',
                    disabled: busyAction === 'bulk-archive' || busyAction === 'bulk-delete',
                    isLoading: busyAction === 'bulk-delete',
                  },
                ]
              : []),
          ]}
          onClear={clearAuctionSelection}
          clearLabel="선택 해제"
        />
      ) : null}
    </div>
  );
}
