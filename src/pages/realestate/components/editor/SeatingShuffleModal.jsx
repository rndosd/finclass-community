import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dices, ExternalLink, MonitorUp, Pin, RotateCcw, X, Zap } from 'lucide-react';
import Button from '../../../../components/ui/Button';
import IconButton from '../../../../components/ui/IconButton';
import Modal from '../../../../components/ui/Modal';
import Spinner from '../../../../components/ui/Spinner';
import { useFeedback } from '../../../../contexts/FeedbackContext';
import PopoutWindow from '../../../../components/ui/PopoutWindow';
import FreeSeatBoard from '../FreeSeatBoard';
import ClassroomDeskVisual from '../ClassroomDeskVisual';
import { resolveSeatPlacements } from '../../utils/freeSeatPlacement';

const SHUFFLE_POPUP_FEATURES = {
  popup: 'yes',
  width: 1600,
  height: 980,
};

const SHUFFLE_POPUP_WINDOW_NAME = 'finclass-seating-shuffle';
const GENDER_SHUFFLE_MODES = {
  ignore: 'ignore',
  grouped: 'grouped',
};
const SHUFFLE_FEEDBACK = {
  random: {
    toast: '완전 랜덤 배치가 완료되었습니다.',
  },
  pinned_random: {
    toast: '압정 유지 랜덤 배치가 완료되었습니다.',
  },
  strategic: {
    toast: '전략적 배치가 완료되었습니다.',
  },
};

const cloneGroups = (value) => JSON.parse(JSON.stringify(value || []));
const normalizeGender = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;

  if (
    raw === 'male' ||
    raw === 'm' ||
    raw === 'man' ||
    raw === 'boy' ||
    raw === '남' ||
    raw === '남자' ||
    raw === '남성'
  ) {
    return 'male';
  }
  if (
    raw === 'female' ||
    raw === 'f' ||
    raw === 'woman' ||
    raw === 'girl' ||
    raw === '여' ||
    raw === '여자' ||
    raw === '여성'
  ) {
    return 'female';
  }
  return null;
};

const SeatingShuffleModal = ({
  isOpen,
  onClose,
  onShuffle,
  onConfirm,
  groups,
  placementData,
  deskDisplayScale = 100,
  students = [],
  canUseGenderGroupedMode = true,
  genderMissingCount = 0,
  isDetached = false,
  onToggleDetached,
}) => {
  const [isShuffling, setIsShuffling] = useState(false);
  const [detachedWindow, setDetachedWindow] = useState(null);
  const [snapshotGroups, setSnapshotGroups] = useState([]);
  const [draftGroups, setDraftGroups] = useState([]);
  const [genderShuffleMode, setGenderShuffleMode] = useState(GENDER_SHUFFLE_MODES.ignore);
  const [shuffleMode, setShuffleMode] = useState('random');
  const shuffleTimer = useRef(null);
  const titleId = useId();
  const { showFeedback } = useFeedback();

  const isDraftChanged = useMemo(
    () => JSON.stringify(snapshotGroups) !== JSON.stringify(draftGroups),
    [snapshotGroups, draftGroups],
  );
  const genderByUid = useMemo(() => {
    const map = new Map();
    (students || []).forEach((student) => {
      if (!student?.uid) return;
      map.set(student.uid, normalizeGender(student.gender));
    });
    return map;
  }, [students]);

  const handlePopoutOpenFail = useCallback(() => {
    onToggleDetached?.(false);
    showFeedback('새 창을 열지 못했습니다. 팝업 차단을 확인해 주세요.', 'warning');
  }, [onToggleDetached, showFeedback]);

  useEffect(() => {
    if (!isDetached) setDetachedWindow(null);
  }, [isDetached]);

  useEffect(() => {
    if (!isOpen) return;
    const base = cloneGroups(groups);
    setSnapshotGroups(base);
    setDraftGroups(base);
    setIsShuffling(false);
    setGenderShuffleMode(GENDER_SHUFFLE_MODES.ignore);
    setShuffleMode('random');
    return () => clearTimeout(shuffleTimer.current);
  }, [groups, isOpen]);

  useEffect(() => {
    if (canUseGenderGroupedMode) return;
    if (genderShuffleMode !== GENDER_SHUFFLE_MODES.grouped) return;
    setGenderShuffleMode(GENDER_SHUFFLE_MODES.ignore);
  }, [canUseGenderGroupedMode, genderShuffleMode]);

  if (!isOpen) return null;

  const handleStartShuffle = (event) => {
    if (isShuffling) return;
    const mode = event.ctrlKey ? 'strategic' : event.shiftKey ? 'pinned_random' : shuffleMode;
    if (genderShuffleMode === GENDER_SHUFFLE_MODES.grouped && !canUseGenderGroupedMode) {
      showFeedback(
        `성별 미입력 학생이 ${genderMissingCount}명 있어 성별끼리 배치를 사용할 수 없습니다.`,
        'warning',
      );
      return;
    }
    const sourceForMode = mode === 'random'
      ? cloneGroups(draftGroups)
      : cloneGroups(snapshotGroups);

    setIsShuffling(true);

    shuffleTimer.current = setTimeout(() => {
      try {
        const result =
          onShuffle?.(mode, sourceForMode, { genderShuffleMode }) || {};
        const feedback = SHUFFLE_FEEDBACK[mode] || SHUFFLE_FEEDBACK.random;
        const nextGroups = Array.isArray(result?.nextGroups) ? result.nextGroups : sourceForMode;

        setDraftGroups(cloneGroups(nextGroups));
        let toastMessage = feedback.toast;
        if (result?.genderShuffleMode === GENDER_SHUFFLE_MODES.grouped) {
          const mixedCount = Number(result?.genderMixedBucketCount || 0);
          toastMessage =
            mixedCount > 0
              ? `${feedback.toast} 성별끼리(짝 기준) 적용, 잔여로 ${mixedCount}쌍은 혼합 배치되었습니다.`
              : `${feedback.toast} 성별끼리(짝 기준) 배치가 적용되었습니다.`;
        }
        showFeedback(toastMessage, 'success');
      } catch (error) {
        showFeedback(error.message, 'error');
      } finally {
        setIsShuffling(false);
      }
    }, 1000);
  };

  const handleResetDraft = () => {
    setDraftGroups(cloneGroups(snapshotGroups));
    showFeedback('초기 배치 상태로 되돌렸습니다.', 'info');
  };

  const handleConfirmDraft = () => {
    onConfirm?.(cloneGroups(draftGroups));
    onClose?.();
  };

  const handleToggleDetached = (event) => {
    event?.stopPropagation?.();

    if (isDetached) {
      setDetachedWindow(null);
      onToggleDetached?.(false);
      return;
    }

    const popup = window.open(
      '',
      SHUFFLE_POPUP_WINDOW_NAME,
      'popup=yes,width=1600,height=980',
    );

    if (!popup) {
      showFeedback('브라우저 팝업 차단으로 새 창을 열 수 없습니다.', 'warning');
      return;
    }

    setDetachedWindow(popup);
    onToggleDetached?.(true);
  };

  const handleClose = () => { if (!isShuffling) onClose?.(); };
  const desks = draftGroups.flatMap((group) => group.desks || []).filter((desk) => desk.isActive !== false);
  const deskById = new Map(desks.map((desk) => [desk.id, desk]));
  const seats = resolveSeatPlacements(draftGroups, placementData).filter((seat) => deskById.has(seat.id));
  const assignedCount = desks.filter((desk) => desk.studentId).length;
  const modes = [
    { id: 'random', label: '전체 랜덤', description: '압정·번개 규칙 없이 모두 섞기', icon: Dices },
    { id: 'pinned_random', label: '압정 유지', description: '고정한 학생을 남기고 섞기', icon: Pin },
    { id: 'strategic', label: '규칙 적용', description: '압정 고정 · 번개 그룹 충돌 피하기', icon: Zap },
  ];
  const panel = (
    <div className={isDetached ? 'flex min-h-screen flex-col bg-white' : 'flex h-[92dvh] flex-col bg-white'}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-blue-100 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 id={titleId} className="flex items-center gap-2 text-xl font-extrabold text-slate-900">
            <Dices size={22} className="shrink-0 text-blue-600" />자리 섞기
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">책상 위치는 그대로, 앉는 학생만 바꿉니다.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" tone="slate" kind="ghost" onClick={handleToggleDetached} disabled={isShuffling}
            title={isDetached ? '원래 창으로 복귀' : '새 창으로 열기'}>
            {isDetached ? <MonitorUp size={16} /> : <ExternalLink size={16} />}
            <span className="hidden sm:inline">{isDetached ? '원래 창으로' : '새 창으로 열기'}</span>
          </Button>
          <IconButton label="자리 섞기 닫기" onClick={handleClose} disabled={isShuffling}><X size={20} /></IconButton>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4 sm:px-6">
        <fieldset disabled={isShuffling}>
          <legend className="mb-2 text-sm font-bold text-slate-800">어떻게 섞을까요?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {modes.map(({id, label, description, icon: Icon}) => (
              <label key={id} className={['flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-3 transition-colors',
                shuffleMode === id ? 'border-blue-400 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700',
                isShuffling ? 'opacity-60' : 'hover:border-blue-300'].join(' ')}>
                <input type="radio" name={titleId + '-mode'} value={id} checked={shuffleMode === id}
                  onChange={() => setShuffleMode(id)} className="mt-1 accent-blue-600" />
                <span className="min-w-0"><span className="flex items-center gap-1.5 text-sm font-bold"><Icon size={15} />{label}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-600">{description}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="my-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <fieldset disabled={isShuffling} className="flex flex-wrap items-center gap-3 text-sm">
              <legend className="sr-only">성별 배치</legend>
              <label className="flex cursor-pointer items-center gap-1.5 text-slate-700"><input type="radio" name={titleId + '-gender'}
                checked={genderShuffleMode === GENDER_SHUFFLE_MODES.ignore} onChange={() => setGenderShuffleMode(GENDER_SHUFFLE_MODES.ignore)} className="accent-blue-600" />성별 무관</label>
              <label className={['flex items-center gap-1.5', canUseGenderGroupedMode ? 'cursor-pointer text-slate-700' : 'text-slate-400'].join(' ')}><input type="radio" name={titleId + '-gender'}
                checked={genderShuffleMode === GENDER_SHUFFLE_MODES.grouped} onChange={() => setGenderShuffleMode(GENDER_SHUFFLE_MODES.grouped)}
                disabled={!canUseGenderGroupedMode} className="accent-blue-600" />같은 성별끼리</label>
            </fieldset>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{canUseGenderGroupedMode
              ? '같은 성별끼리는 가로 짝 기준이며, 남은 학생은 혼합될 수 있어요.'
              : '성별 미입력 ' + genderMissingCount + '명 · 모두 입력하면 같은 성별끼리 배치할 수 있어요.'}</p>
          </div>
          <Button icon={Dices} tone="blue" onClick={handleStartShuffle} disabled={isShuffling || assignedCount < 2}>
            {isShuffling ? '섞는 중…' : isDraftChanged ? '다시 섞기' : '자리 섞기'}
          </Button>
        </div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span>미리보기 · 배정 {assignedCount}명 / 책상 {desks.length}개</span>
          <span role="status">{isDraftChanged ? '새 배치를 확인해 주세요' : '현재 배치'}</span>
        </div>
        <div className="relative" aria-busy={isShuffling}>
          {seats.length > 0 ? <FreeSeatBoard classroomScene fitViewport minFitScale={0.38} frontLabel="교탁 · 교실 앞쪽" seats={seats}
            deskDisplayScale={deskDisplayScale} renderSeat={(seat) => {
              const desk = deskById.get(seat.id);
              const gender = genderShuffleMode === GENDER_SHUFFLE_MODES.grouped && canUseGenderGroupedMode && desk.studentId ? genderByUid.get(desk.studentId) : null;
              return <div className="relative h-full w-full">
                <ClassroomDeskVisual number={desk.number} label={desk.label} studentName={desk.studentName}
                  teamId={desk.teamId} rotation={seat.rotation} view="student" />
                {gender && <span className="pointer-events-none absolute bottom-0 right-0 rounded border border-slate-200 bg-white px-1 font-bold text-slate-700"
                  style={{fontSize: 'calc(9px * var(--desk-type-boost, 1))'}}>{gender === 'male' ? '남' : '여'}</span>}
              </div>;
            }} /> : <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">배치할 책상이 없습니다.</p>}
          {isShuffling && <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/85 backdrop-blur-sm">
            <Spinner size="lg" tone="blue" message="학생 자리를 섞고 있어요" />
          </div>}
        </div>
      </main>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-blue-100 bg-white px-4 py-3 sm:px-6">
        <p className="text-xs leading-relaxed text-slate-600">편집 화면에 적용한 뒤 <strong className="text-slate-800">최종 저장</strong>을 눌러 주세요.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={RotateCcw} size="sm" tone="slate" kind="ghost" onClick={handleResetDraft} disabled={isShuffling || !isDraftChanged}>원래대로</Button>
          <Button size="sm" tone="slate" kind="outline" onClick={handleClose} disabled={isShuffling}>취소</Button>
          <Button size="sm" tone="blue" onClick={handleConfirmDraft} disabled={isShuffling || !isDraftChanged}>편집 화면에 적용</Button>
        </div>
      </footer>
    </div>
  );

  if (isDetached) {
    return (
      <PopoutWindow
        isOpen={isOpen}
        onClose={onClose}
        title="자리 섞기"
        windowName={SHUFFLE_POPUP_WINDOW_NAME}
        features={SHUFFLE_POPUP_FEATURES}
        providedWindow={detachedWindow}
        onOpenFail={handlePopoutOpenFail}
      >
        <div className="min-h-screen bg-slate-100 p-4">{panel}</div>
      </PopoutWindow>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="xl" showDefaultCloseButton={false}
      aria-labelledby={titleId} closeOnOverlayClick={!isShuffling}>
      {panel}
    </Modal>
  );
};

export default SeatingShuffleModal;
