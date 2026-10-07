import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useFeedback } from '../../../contexts/FeedbackContext';
import {
  getXlsxImportErrorMessage,
  parseFirstXlsxWorksheet,
  validateXlsxImportFile,
} from '../../../utils/safeXlsxImport';
import ClassroomEditorUI from '../components/editor/ClassroomEditorUI';
import FreeLayoutEditor from '../components/editor/FreeLayoutEditor';
import SeatingShuffleModal from '../components/editor/SeatingShuffleModal';
import TradeHistoryWarningModal from '../components/editor/TradeHistoryWarningModal';
import TeacherReverseViewModal from '../modals/TeacherReverseViewModal';
import { MAX_DESK_DISPLAY_SCALE } from '../utils/freeSeatPlacement';
import {
  AVOID_GROUP_META,
  DEFAULT_AVOID_GROUP_ID,
  GENDER_SEAT_PREFERENCES,
  GENDER_SHUFFLE_MODES,
  clone,
  createEmptyConstraints,
  generateUniqueDeskId,
  normalizeAvoidGroups,
  normalizeConstraints,
  normalizeGender,
  normalizeGenderSeatPreferences,
  normalizeGroups,
  reconcileAvoidGroupsForSave,
  reconcileFixedSeatsForSave,
  reconcileGenderSeatPreferencesForSave,
  renumberGroups,
  resolveFixedSeatsForSource,
  runStrategicShuffle,
} from './classroomLayoutLogic';

const ClassroomLayoutEditor = ({ classId, initialData, configData, students, onSave, onSavePlacement,
  onSaveDeskDisplayScale, onCreateSeat, onSetSeatActive, placementData, saving = false }) => {
  const [groups, setGroups] = useState(() => normalizeGroups(initialData?.groups));
  const [constraints, setConstraints] = useState(() =>
    initialData?.constraints ? normalizeConstraints(initialData.constraints) : createEmptyConstraints(),
  );
  const [isShuffleModalOpen, setIsShuffleModalOpen] = useState(false);
  const [isShuffleDetached, setIsShuffleDetached] = useState(false);
  const [isTeacherViewOpen, setIsTeacherViewOpen] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isFreeLayoutOpen, setIsFreeLayoutOpen] = useState(false);
  const [draftDeskDisplayScale, setDraftDeskDisplayScale] = useState(null);
  const [displayScaleSaving, setDisplayScaleSaving] = useState(false);
  const savedScale = Number(placementData?.deskDisplayScale);
  const savedDeskDisplayScale = Number.isInteger(savedScale) && savedScale >= 80 && savedScale <= MAX_DESK_DISPLAY_SCALE &&
    savedScale % 10 === 0 ? savedScale : 100;
  const deskDisplayScale = draftDeskDisplayScale ?? savedDeskDisplayScale;
  const displayScaleDirty = draftDeskDisplayScale !== null && draftDeskDisplayScale !== savedDeskDisplayScale;
  const [activeTool, setActiveTool] = useState('cursor');
  const [activeGenderTool, setActiveGenderTool] = useState(GENDER_SEAT_PREFERENCES.none);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [selectedSeatIds, setSelectedSeatIds] = useState([]);
  const [activeDragItem, setActiveDragItem] = useState(null);
  const [activeAvoidGroupId, setActiveAvoidGroupId] = useState(DEFAULT_AVOID_GROUP_ID);
  useEffect(() => { setDraftDeskDisplayScale(null); }, [classId]);
  const fileInputRef = useRef(null);
  const displayScaleRequestRef = useRef(null);
  const tradeWarningActionRef = useRef(null);
  const [tradeWarningModal, setTradeWarningModal] = useState({
    isOpen: false,
    title: '거래 이력 자리 변경 경고',
    message: '',
    confirmLabel: '계속 진행',
  });
  const { showFeedback } = useFeedback();

  const seedMarketPrice = Math.max(
    0,
    Math.round(Number(configData?.seedMarketPrice) || 1000),
  );
  const safeOfficialPriceRatio = Number.isFinite(Number(configData?.officialPriceRatio))
    ? Number(configData.officialPriceRatio)
    : 70;
  const seedOfficialPrice = Math.max(
    0,
    Math.floor(seedMarketPrice * (safeOfficialPriceRatio / 100)),
  );

  useEffect(() => {
    if (!initialData || hasChanges) return;
    setGroups(normalizeGroups(initialData.groups));
    setConstraints(normalizeConstraints(initialData.constraints));
    setActiveAvoidGroupId(DEFAULT_AVOID_GROUP_ID);
    setActiveGenderTool(GENDER_SEAT_PREFERENCES.none);
    tradeWarningActionRef.current = null;
    setTradeWarningModal((prev) => ({ ...prev, isOpen: false }));
    setHasChanges(false);
    setSelectedSeatIds([]);
  }, [initialData, hasChanges]);

  const handleCloseShuffle = useCallback(() => {
    setIsShuffleModalOpen(false);
    setIsShuffleDetached(false);
  }, []);

  const handleConfirmShuffle = useCallback(
    (nextGroups) => {
      setGroups(clone(nextGroups));
      setHasChanges(true);
      showFeedback('셔플 결과를 반영했습니다. 최종 저장을 눌러 DB에 저장하세요.', 'info');
    },
    [showFeedback],
  );

  const hasDeskTradeHistory = useCallback((desk) => (
    desk?.hasTradeHistory === true || Boolean(desk?.ownerId)
  ), []);

  const getTradeHistoryDesks = useCallback((desks = []) => (
    desks.filter((desk) => hasDeskTradeHistory(desk))
  ), [hasDeskTradeHistory]);

  const closeTradeWarning = useCallback(() => {
    tradeWarningActionRef.current = null;
    setTradeWarningModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const openTradeWarning = useCallback(({
    title = '거래 이력 자리 변경 경고',
    message,
    confirmLabel = '계속 진행',
    onConfirm,
  }) => {
    tradeWarningActionRef.current = onConfirm;
    setTradeWarningModal({
      isOpen: true,
      title,
      message,
      confirmLabel,
    });
  }, []);

  const handleTradeWarningConfirm = useCallback(() => {
    const pendingAction = tradeWarningActionRef.current;
    tradeWarningActionRef.current = null;
    setTradeWarningModal((prev) => ({ ...prev, isOpen: false }));
    if (typeof pendingAction === 'function') {
      pendingAction();
    }
  }, []);

  const applyGroupResize = useCallback((groupId, rowDelta, colDelta) => {
    setGroups((prev) => {
      const targetGroup = prev.find((group) => group.id === groupId);
      if (!targetGroup) return prev;

      const nextRows = Math.max(1, (targetGroup.rows || 1) + rowDelta);
      const nextCols = Math.max(1, (targetGroup.cols || 1) + colDelta);

      const updated = prev.map((group) => {
        if (group.id !== groupId) return group;

        const deskMap = new Map(group.desks.map((desk) => [desk.id, desk]));
        const nextDesks = [];

        for (let row = 0; row < nextRows; row += 1) {
          for (let col = 0; col < nextCols; col += 1) {
            const deskId = `${group.id}-${row}-${col}`;
            const existing = deskMap.get(deskId);
            if (existing) {
              nextDesks.push(existing);
            } else {
              nextDesks.push({
                id: deskId,
                permanentId: generateUniqueDeskId(),
                number: 0,
                isActive: true,
                studentId: null,
                studentName: null,
                teamId: 'none',
                lastPurchasePrice: seedMarketPrice,
                price: seedOfficialPrice,
                ownerId: null,
                ownerName: null,
                ownerSinceAt: null,
                ownerSource: null,
                ownerUpdatedAt: null,
                rentPaidUntil: null,
                rentContractId: null,
                rentStartAt: null,
                rentLastDateAt: null,
                rentTenantId: null,
                rentTenantName: null,
                rentPaidDays: 0,
                rentPaidAmount: 0,
                isTradeRestricted: false,
                hasTradeHistory: false,
              });
            }
          }
        }

        return { ...group, rows: nextRows, cols: nextCols, desks: nextDesks };
      });

      return renumberGroups(updated);
    });
    setHasChanges(true);
  }, [seedMarketPrice, seedOfficialPrice]);

  const applyDeleteGroup = useCallback((groupId) => {
    setGroups((prev) => renumberGroups(prev.filter((group) => group.id !== groupId)));
    setHasChanges(true);
  }, []);

  const applyDeskPatch = useCallback((deskId, patch) => {
    if (!deskId) return;
    setGroups((prev) =>
      prev.map((group) => ({
        ...group,
        desks: group.desks.map((desk) =>
          desk.id === deskId ? { ...desk, ...patch } : desk,
        ),
      })),
    );
    setHasChanges(true);
  }, []);

  const generateDesks = (groupId, rows, cols) => {
    const desks = [];
    let number = 1;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        desks.push({
          id: `${groupId}-${row}-${col}`,
          permanentId: generateUniqueDeskId(),
          number: number++,
          isActive: true,
          studentId: null,
          studentName: null,
          teamId: 'none',
          lastPurchasePrice: seedMarketPrice,
          price: seedOfficialPrice,
          ownerId: null,
          ownerName: null,
          rentPaidUntil: null,
          rentContractId: null,
          rentStartAt: null,
          rentLastDateAt: null,
          rentTenantId: null,
          rentTenantName: null,
          rentPaidDays: 0,
          rentPaidAmount: 0,
          isTradeRestricted: false,
          hasTradeHistory: false,
        });
      }
    }
    return desks;
  };

  const currentSeat = selectedSeat
    ? groups.flatMap((group) => group.desks).find((desk) => desk.id === selectedSeat.deskId) || null
    : null;

  const assignedIds = new Set(
    groups.flatMap((group) => group.desks).map((desk) => desk.studentId).filter(Boolean),
  );
  const unassignedStudents = (students || []).filter((student) => !assignedIds.has(student.uid));
  const genderStats = useMemo(() => {
    let maleCount = 0;
    let femaleCount = 0;
    let missingCount = 0;
    const genderByStudentId = new Map();

    (students || []).forEach((student) => {
      const gender = normalizeGender(student?.gender);
      if (student?.uid) genderByStudentId.set(student.uid, gender);
      if (gender === 'male') maleCount += 1;
      else if (gender === 'female') femaleCount += 1;
      else missingCount += 1;
    });

    const fixedSeats = resolveFixedSeatsForSource(
      groups,
      constraints?.fixedSeats || {},
    ).effectiveFixedSeats;
    const preferences = normalizeGenderSeatPreferences(
      constraints?.genderSeatPreferences,
    );
    const genderSeatMetaByPermanentId = {};
    let malePinnedCount = 0;
    let femalePinnedCount = 0;
    let malePreferredCount = 0;
    let femalePreferredCount = 0;

    (groups || []).forEach((group) => {
      (group?.desks || []).forEach((desk) => {
        if (!desk?.isActive || !desk?.permanentId) return;

        const fixedStudentId = fixedSeats[desk.permanentId];
        if (fixedStudentId) {
          const gender = genderByStudentId.get(fixedStudentId);
          if (gender === GENDER_SEAT_PREFERENCES.male) malePinnedCount += 1;
          if (gender === GENDER_SEAT_PREFERENCES.female) femalePinnedCount += 1;
          if (
            gender === GENDER_SEAT_PREFERENCES.male ||
            gender === GENDER_SEAT_PREFERENCES.female
          ) {
            genderSeatMetaByPermanentId[desk.permanentId] = {
              gender,
              source: 'pinned',
            };
          }
          return;
        }

        const preference = preferences[desk.permanentId];
        if (preference === GENDER_SEAT_PREFERENCES.male) {
          malePreferredCount += 1;
          genderSeatMetaByPermanentId[desk.permanentId] = {
            gender: preference,
            source: 'preference',
          };
        } else if (preference === GENDER_SEAT_PREFERENCES.female) {
          femalePreferredCount += 1;
          genderSeatMetaByPermanentId[desk.permanentId] = {
            gender: preference,
            source: 'preference',
          };
        }
      });
    });

    return {
      maleCount,
      femaleCount,
      missingCount,
      malePinnedCount,
      femalePinnedCount,
      malePreferredCount,
      femalePreferredCount,
      maleUsedCount: malePinnedCount + malePreferredCount,
      femaleUsedCount: femalePinnedCount + femalePreferredCount,
      genderSeatMetaByPermanentId,
      canUseGroupedMode: missingCount === 0,
    };
  }, [constraints?.fixedSeats, constraints?.genderSeatPreferences, groups, students]);

  useEffect(() => {
    if (!selectedSeat) return;
    const exists = groups.some((group) => group.desks.some((desk) => desk.id === selectedSeat.deskId));
    if (!exists) setSelectedSeat(null);
  }, [groups, selectedSeat]);

  const reconcileFixedSeatsAfterStudentMove = useCallback((nextGroups) => {
    setConstraints((prev) => {
      const base = normalizeConstraints(prev);
      const nextSeatByPermanentId = new Map();
      (nextGroups || []).forEach((group) => {
        (group?.desks || []).forEach((desk) => {
          if (desk?.isActive && desk?.permanentId) {
            nextSeatByPermanentId.set(desk.permanentId, desk);
          }
        });
      });

      const nextFixedSeats = {};
      const seenStudentIds = new Set();
      Object.entries(base.fixedSeats || {}).forEach(([permanentId, fixedStudentId]) => {
        const seat = nextSeatByPermanentId.get(permanentId);
        if (!seat?.studentId || seat.studentId !== fixedStudentId) return;
        if (seenStudentIds.has(fixedStudentId)) return;
        nextFixedSeats[permanentId] = fixedStudentId;
        seenStudentIds.add(fixedStudentId);
      });

      const currentEntries = Object.entries(base.fixedSeats || {});
      const nextEntries = Object.entries(nextFixedSeats);
      const isSame =
        currentEntries.length === nextEntries.length &&
        currentEntries.every(([permanentId, studentId]) => nextFixedSeats[permanentId] === studentId);

      if (isSame) return base;
      return { ...base, fixedSeats: nextFixedSeats };
    });
  }, []);

  const executeStrategicShuffle = useCallback(
    (modeArg, sourceGroupsArg, options = {}) =>
      runStrategicShuffle({
        modeArg,
        sourceGroupsArg,
        groups,
        constraints,
        students,
        placementDataArg: placementData,
        genderShuffleModeArg:
          options?.genderShuffleMode === GENDER_SHUFFLE_MODES.grouped
            ? GENDER_SHUFFLE_MODES.grouped
            : GENDER_SHUFFLE_MODES.ignore,
      }),
    [constraints, groups, placementData, students],
  );

  const handlers = {
    setActiveTool: (tool) => {
      if (/^(none|team[1-6])$/.test(tool) && selectedSeatIds.length > 0) {
        const ids = new Set(selectedSeatIds);
        setGroups((prev) => prev.map((group) => ({ ...group,
          desks: group.desks.map((desk) => ids.has(desk.id) ? { ...desk, teamId: tool } : desk),
        })));
        setHasChanges(true);
        setSelectedSeatIds([]);
      }
      setActiveTool(tool);
      setActiveGenderTool(GENDER_SEAT_PREFERENCES.none);
    },
    setSelectedSeat,
    selectSeatIds: (ids, additive = false) => {
      const nextIds = Array.from(new Set(ids));
      setSelectedSeatIds((current) => additive
        ? Array.from(new Set([...current, ...nextIds])) : nextIds);
    },
    setActiveAvoidGroup: setActiveAvoidGroupId,
    cycleGenderTool: () => {
      setActiveGenderTool((prev) => {
        if (prev === GENDER_SEAT_PREFERENCES.none) return GENDER_SEAT_PREFERENCES.male;
        if (prev === GENDER_SEAT_PREFERENCES.male) return GENDER_SEAT_PREFERENCES.female;
        return GENDER_SEAT_PREFERENCES.none;
      });
      setActiveTool('cursor');
    },

    handleAddGroup: () => {
      const groupId = `g${Date.now()}`;
      const newGroup = {
        id: groupId,
        name: '새 분단',
        rows: 2,
        cols: 2,
        desks: generateDesks(groupId, 2, 2),
        position: { x: 0, y: 0 },
      };
      setGroups(renumberGroups([...groups, newGroup]));
      setHasChanges(true);
      showFeedback('새 분단을 추가했습니다.', 'info');
    },

    updateGroupName: (groupId, name) => {
      setGroups((prev) =>
        prev.map((group) => (group.id === groupId ? { ...group, name: name || group.name } : group)),
      );
      setHasChanges(true);
    },

    updateGroupSize: (groupId, rowDelta, colDelta) => {
      const targetGroup = groups.find((group) => group.id === groupId);
      if (!targetGroup) return;

      const nextRows = Math.max(1, (targetGroup.rows || 1) + rowDelta);
      const nextCols = Math.max(1, (targetGroup.cols || 1) + colDelta);
      const isShrink = nextRows < (targetGroup.rows || 1) || nextCols < (targetGroup.cols || 1);

      if (isShrink) {
        const wouldBeRemoved = (targetGroup.desks || []).filter((desk) => {
          const parts = String(desk?.id || '').split('-');
          const row = Number(parts[parts.length - 2]);
          const col = Number(parts[parts.length - 1]);
          if (!Number.isInteger(row) || !Number.isInteger(col)) return false;
          return row >= nextRows || col >= nextCols;
        });
        const tradeHistoryRemoved = getTradeHistoryDesks(wouldBeRemoved);

        if (tradeHistoryRemoved.length > 0) {
          openTradeWarning({
            message: `축소 대상에 거래 이력이 있는 자리 ${tradeHistoryRemoved.length}개가 포함되어 있습니다. 계속하시겠습니까?`,
            confirmLabel: '축소 진행',
            onConfirm: () => applyGroupResize(groupId, rowDelta, colDelta),
          });
          return;
        }
      }

      applyGroupResize(groupId, rowDelta, colDelta);
    },

    deleteGroup: (groupId) => {
      const targetGroup = groups.find((group) => group.id === groupId);
      const tradeHistoryDesks = getTradeHistoryDesks(targetGroup?.desks || []);
      if (tradeHistoryDesks.length > 0) {
        openTradeWarning({
          message: `삭제 대상 분단에 거래 이력이 있는 자리 ${tradeHistoryDesks.length}개가 있습니다. 정말 삭제하시겠습니까?`,
          confirmLabel: '분단 삭제',
          onConfirm: () => applyDeleteGroup(groupId),
        });
        return;
      }
      applyDeleteGroup(groupId);
    },

    clearAvoidGroups: () => {
      const hasLightning = normalizeAvoidGroups(constraints?.avoidGroups).some(
        (group) => group.studentIds.length > 0,
      );
      if (!hasLightning) {
        showFeedback('초기화할 번개 그룹이 없습니다.', 'info');
        return;
      }

      setConstraints((prev) => ({
        ...normalizeConstraints(prev),
        avoidGroups: normalizeAvoidGroups(prev?.avoidGroups).map((group) => ({
          ...group,
          studentIds: [],
        })),
      }));
      setHasChanges(true);
      showFeedback('번개 그룹을 모두 초기화했습니다.', 'success');
    },

    handleSeatClick: (group, desk, event) => {
      if (!desk?.isActive) return;

      if (activeTool === 'cursor' && event?.shiftKey) {
        setSelectedSeatIds((current) => current.includes(desk.id)
          ? current.filter((id) => id !== desk.id) : [...current, desk.id]);
        return;
      }

      if (activeGenderTool !== GENDER_SEAT_PREFERENCES.none) {
        const fixedSeats = resolveFixedSeatsForSource(
          groups,
          constraints?.fixedSeats || {},
        ).effectiveFixedSeats;
        if (fixedSeats[desk.permanentId]) {
          showFeedback('압정 좌석은 학생 성별 기준으로 자동 적용됩니다.', 'info');
          return;
        }

        const preferences = normalizeGenderSeatPreferences(
          constraints?.genderSeatPreferences,
        );
        const isRemoving = preferences[desk.permanentId] === activeGenderTool;
        const nextPreferences = { ...preferences };

        if (isRemoving) {
          delete nextPreferences[desk.permanentId];
        } else {
          nextPreferences[desk.permanentId] = activeGenderTool;
        }

        const nextMalePreferredCount = Object.values(nextPreferences).filter(
          (value) => value === GENDER_SEAT_PREFERENCES.male,
        ).length;
        const nextFemalePreferredCount = Object.values(nextPreferences).filter(
          (value) => value === GENDER_SEAT_PREFERENCES.female,
        ).length;

        if (
          genderStats.malePinnedCount + nextMalePreferredCount >
          genderStats.maleCount
        ) {
          showFeedback('남학생 수보다 남학생 지정 좌석이 많습니다.', 'warning');
          return;
        }
        if (
          genderStats.femalePinnedCount + nextFemalePreferredCount >
          genderStats.femaleCount
        ) {
          showFeedback('여학생 수보다 여학생 지정 좌석이 많습니다.', 'warning');
          return;
        }

        setConstraints((prev) => ({
          ...normalizeConstraints(prev),
          genderSeatPreferences: nextPreferences,
        }));
        setHasChanges(true);
        return;
      }

      if (activeTool === 'cursor') {
        setSelectedSeat({ groupId: group.id, deskId: desk.id });
        return;
      }

      if (activeTool === 'eraser') {
        const nextGroups = groups.map((g) => ({
          ...g,
          desks: g.desks.map((d) =>
            d.id === desk.id
              ? {
                  ...d,
                  studentId: null,
                  studentName: null,
                }
              : d,
          ),
        }));

        setGroups(nextGroups);
        reconcileFixedSeatsAfterStudentMove(nextGroups);

        setHasChanges(true);
        return;
      }

      if (activeTool === 'pin') {
        if (!desk.studentId) {
          showFeedback('학생이 배치된 자리에서만 압정을 설정할 수 있습니다.', 'warning');
          return;
        }

        const currentFixedSeats = resolveFixedSeatsForSource(
          groups,
          constraints?.fixedSeats || {},
        ).effectiveFixedSeats;
        const isPinnedHere = currentFixedSeats[desk.permanentId] === desk.studentId;

        setConstraints((prev) => {
          const base = normalizeConstraints(prev);
          const effectiveFixedSeats = resolveFixedSeatsForSource(
            groups,
            base.fixedSeats,
          ).effectiveFixedSeats;
          const nextFixed = {};

          Object.entries(effectiveFixedSeats).forEach(([permanentId, fixedStudentId]) => {
            if (fixedStudentId === desk.studentId) return;
            nextFixed[permanentId] = fixedStudentId;
          });

          if (!isPinnedHere) {
            nextFixed[desk.permanentId] = desk.studentId;
          }

          const nextGenderSeatPreferences = normalizeGenderSeatPreferences(
            base.genderSeatPreferences,
          );
          delete nextGenderSeatPreferences[desk.permanentId];

          return {
            ...base,
            fixedSeats: nextFixed,
            genderSeatPreferences: nextGenderSeatPreferences,
          };
        });
        setHasChanges(true);
        return;
      }

      if (activeTool === 'lightning') {
        if (!desk.studentId) {
          showFeedback('학생이 배치된 자리에서만 번개 표시를 설정할 수 있습니다.', 'warning');
          return;
        }

        const activeMeta =
          AVOID_GROUP_META.find((groupMeta) => groupMeta.id === activeAvoidGroupId) || AVOID_GROUP_META[0];
        const currentAvoid = normalizeAvoidGroups(constraints?.avoidGroups);
        const activeGroup = currentAvoid.find((item) => item.id === activeMeta.id);
        const isRemoving = Boolean(activeGroup?.studentIds.includes(desk.studentId));

        setConstraints((prev) => {
          const base = normalizeConstraints(prev);
          const nextAvoid = base.avoidGroups.map((item) => {
            const stripped = item.studentIds.filter((studentId) => studentId !== desk.studentId);
            if (item.id !== activeMeta.id) {
              return { ...item, studentIds: stripped };
            }
            return {
              ...item,
              studentIds: isRemoving ? stripped : [...stripped, desk.studentId],
            };
          });
          return { ...base, avoidGroups: nextAvoid };
        });

        setHasChanges(true);
        showFeedback(
          isRemoving
            ? `${activeMeta.label} 번개 그룹에서 제거했습니다.`
            : `${activeMeta.label} 번개 그룹에 추가했습니다.`,
          'success',
        );
        return;
      }

      const teamIds = new Set(['none', 'team1', 'team2', 'team3', 'team4', 'team5', 'team6']);
      if (teamIds.has(activeTool)) {
        setGroups((prev) =>
          prev.map((g) => ({
            ...g,
            desks: g.desks.map((d) => (d.id === desk.id ? { ...d, teamId: activeTool } : d)),
          })),
        );
        setHasChanges(true);
      }
    },

    updateSelectedDesk: (patch) => {
      if (!selectedSeat?.deskId) return;
      const deskId = selectedSeat.deskId;
      const targetDesk = groups
        .flatMap((group) => group.desks || [])
        .find((desk) => desk.id === deskId);

      if (
        patch &&
        Object.prototype.hasOwnProperty.call(patch, 'isActive') &&
        patch.isActive === false &&
        hasDeskTradeHistory(targetDesk)
      ) {
        openTradeWarning({
          message: '거래 이력이 있는 자리를 비활성화하려고 합니다. 계속하시겠습니까?',
          confirmLabel: '비활성화 진행',
          onConfirm: () => applyDeskPatch(deskId, patch),
        });
        return;
      }

      applyDeskPatch(deskId, patch);
    },

    handleDockStudentClick: (student) => {
      if (!selectedSeat?.deskId || !student?.uid) return;
      const nextGroups = groups.map((group) => ({
        ...group,
        desks: group.desks.map((desk) => {
          if (desk.id === selectedSeat.deskId) {
            return {
              ...desk,
              studentId: student.uid,
              studentName: student.name,
              rentPaidUntil: null,
              rentContractId: null,
              rentStartAt: null,
              rentLastDateAt: null,
              rentTenantId: null,
              rentTenantName: null,
              rentPaidDays: 0,
              rentPaidAmount: 0,
            };
          }
          if (desk.studentId === student.uid) {
            return {
              ...desk,
              studentId: null,
              studentName: null,
              rentPaidUntil: null,
              rentContractId: null,
              rentStartAt: null,
              rentLastDateAt: null,
              rentTenantId: null,
              rentTenantName: null,
              rentPaidDays: 0,
              rentPaidAmount: 0,
            };
          }
          return desk;
        }),
      }));
      setGroups(nextGroups);
      reconcileFixedSeatsAfterStudentMove(nextGroups);
      setHasChanges(true);
    },

    handleDragStart: (event) => {
      const data = event?.active?.data?.current;
      if (!data?.studentId) {
        setActiveDragItem(null);
        return;
      }
      setActiveDragItem(data);
    },

    handleDragEnd: (event) => {
      setActiveDragItem(null);
      const sourceDeskId = event?.active?.data?.current?.deskId;
      const targetDeskId = event?.over?.id;
      if (!sourceDeskId || !targetDeskId || sourceDeskId === targetDeskId) return;

      let sourceData = null;
      let targetData = null;
      groups.forEach((group) => {
        group.desks.forEach((desk) => {
          if (desk.id === sourceDeskId) sourceData = desk;
          if (desk.id === targetDeskId) targetData = desk;
        });
      });
      if (!sourceData || !targetData || !targetData.isActive) return;

      const nextGroups = groups.map((group) => ({
        ...group,
        desks: group.desks.map((desk) => {
          if (desk.id === sourceDeskId) {
            return {
              ...desk,
              studentId: targetData.studentId || null,
              studentName: targetData.studentName || null,
              rentPaidUntil: null,
              rentContractId: null,
              rentStartAt: null,
              rentLastDateAt: null,
              rentTenantId: null,
              rentTenantName: null,
              rentPaidDays: 0,
              rentPaidAmount: 0,
            };
          }
          if (desk.id === targetDeskId) {
            return {
              ...desk,
              studentId: sourceData.studentId || null,
              studentName: sourceData.studentName || null,
              rentPaidUntil: null,
              rentContractId: null,
              rentStartAt: null,
              rentLastDateAt: null,
              rentTenantId: null,
              rentTenantName: null,
              rentPaidDays: 0,
              rentPaidAmount: 0,
            };
          }
          return desk;
        }),
      }));
      setGroups(nextGroups);
      reconcileFixedSeatsAfterStudentMove(nextGroups);
      setHasChanges(true);
    },

    handleAutoNumbering: () => {
      setGroups((prev) => renumberGroups(prev));
      setHasChanges(true);
      showFeedback('좌석 번호를 다시 정렬했습니다.', 'success');
    },

    handleDownloadSample: () => {
      const rows = groups
        .flatMap((group) => group.desks)
        .filter((desk) => desk.isActive)
        .sort((a, b) => a.number - b.number)
        .map((desk) => [desk.number, '']);

      if (rows.length === 0) {
        showFeedback('배치된 자리가 없습니다.', 'error');
        return;
      }

      const worksheet = XLSX.utils.aoa_to_sheet([['번호', '학생이름'], ...rows]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '배치양식');
      XLSX.writeFile(workbook, '자리배치양식.xlsx');
      showFeedback('엑셀 양식을 다운로드했습니다.', 'success');
    },

    handleExcelUpload: (event) => {
      const file = event.target.files?.[0];
      const inputEl = event.target;
      if (!file) return;

      try {
        validateXlsxImportFile(file);
      } catch (error) {
        showFeedback(getXlsxImportErrorMessage(error), 'error');
        inputEl.value = '';
        return;
      }

      const activeDesks = groups.flatMap((group) => group.desks).filter((desk) => desk.isActive);
      const numbers = activeDesks.map((desk) => desk.number);
      if (new Set(numbers).size !== numbers.length) {
        showFeedback('중복된 좌석 번호가 있습니다. 자동 번호 정렬 후 다시 시도해 주세요.', 'warning');
        inputEl.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        try {
          const { rows: data } = parseFirstXlsxWorksheet(
            loadEvent.target.result,
            { file },
          );
          const nextGroups = clone(groups);

          const pick = (row, keys) => {
            for (const key of keys) {
              if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
            }
            return undefined;
          };

          const numberKeys = ['번호', '좌석번호', 'seatNumber', 'number', 'No', 'NO'];
          const nameKeys = ['학생이름', '이름', 'studentName', 'name'];

          data.forEach((row) => {
            const rawNumber = pick(row, numberKeys);
            const rawName = pick(row, nameKeys);
            const seatNumber = parseInt(String(rawNumber ?? '').replace(/[^0-9-]/g, ''), 10);
            const studentName = String(rawName ?? '').trim();
            if (!Number.isFinite(seatNumber) || !studentName) return;

            nextGroups.forEach((group) => {
              group.desks.forEach((desk) => {
                if (!desk.isActive || desk.number !== seatNumber) return;
                const target = (students || []).find((student) => student.name === studentName);
                if (!target) return;
                desk.studentId = target.uid;
                desk.studentName = target.name;
                desk.rentPaidUntil = null;
                desk.rentContractId = null;
                desk.rentStartAt = null;
                desk.rentLastDateAt = null;
                desk.rentTenantId = null;
                desk.rentTenantName = null;
                desk.rentPaidDays = 0;
                desk.rentPaidAmount = 0;
              });
            });
          });

          setGroups(nextGroups);
          reconcileFixedSeatsAfterStudentMove(nextGroups);
          setHasChanges(true);
          showFeedback('엑셀 데이터를 반영했습니다.', 'success');
        } catch (error) {
          console.error('[ClassroomLayoutEditor] excel upload failed:', error);
          showFeedback(getXlsxImportErrorMessage(error), 'error');
        } finally {
          inputEl.value = '';
        }
      };

      reader.onerror = () => {
        showFeedback('파일을 읽지 못했습니다. 다시 시도해 주세요.', 'error');
        inputEl.value = '';
      };

      reader.readAsArrayBuffer(file);
    },

    executeStrategicShuffle,
  };

  const changeDeskDisplayScale = (value) => {
    setDraftDeskDisplayScale(value === savedDeskDisplayScale ? null : value);
  };
  const saveDeskDisplayScale = async (value) => {
    if (!onSaveDeskDisplayScale || displayScaleSaving) return false;
    if (!displayScaleRequestRef.current || displayScaleRequestRef.current.value !== value) {
      displayScaleRequestRef.current = {
        value,
        id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.floor(Math.random() * 100000000)}`,
      };
    }
    setDisplayScaleSaving(true);
    try {
      await onSaveDeskDisplayScale(value, displayScaleRequestRef.current.id);
      displayScaleRequestRef.current = null;
      setDraftDeskDisplayScale(null);
      showFeedback('책상 크기를 교실 보기에 반영했습니다.', 'success');
      return true;
    } catch (error) {
      showFeedback(error.message || '책상 크기를 저장하지 못했습니다.', 'error');
      return false;
    } finally {
      setDisplayScaleSaving(false);
    }
  };

  const saveAssignments = async (includeScale = true) => {
    if (saving || displayScaleSaving) return false;
    if (!hasChanges) {
      if (includeScale && displayScaleDirty) return saveDeskDisplayScale(deskDisplayScale);
      return true;
    }
    const nextDesksByKey = new Map(
      groups
        .flatMap((group) => group?.desks || [])
        .map((desk) => [desk?.permanentId || desk?.id, desk]),
    );
    const unsettledDepositDesk = (initialData?.groups || [])
      .flatMap((group) => group?.desks || [])
      .find((originalDesk) => {
        const paid = Math.max(0, Number(originalDesk?.rentDepositPaidAmount || 0));
        const returned = Math.max(0, Number(originalDesk?.rentDepositReturnedAmount || 0));
        const deducted = Math.max(0, Number(originalDesk?.rentDepositDeductedAmount || 0));
        if (paid - returned - deducted <= 0) return false;
        const nextDesk = nextDesksByKey.get(originalDesk?.permanentId || originalDesk?.id);
        return (
          !nextDesk ||
          nextDesk.studentId !== originalDesk.studentId ||
          nextDesk.rentContractId !== originalDesk.rentContractId
        );
      });
    if (unsettledDepositDesk) {
      showFeedback(
        `${unsettledDepositDesk.label || `${unsettledDepositDesk.number ?? '-'}번 자리`}에 반환할 보증금이 남아 있습니다. 보증금을 먼저 정산한 뒤 자리 배치를 변경해 주세요.`,
        'error',
      );
      return false;
    }

    const normalizedForSave = normalizeConstraints(constraints);
    const fixedReconciled = reconcileFixedSeatsForSave(
      groups,
      normalizedForSave.fixedSeats,
    );
    const avoidReconciled = reconcileAvoidGroupsForSave(
      normalizedForSave.avoidGroups,
      students,
      groups,
    );
    const constraintsForSave = {
      ...normalizedForSave,
      fixedSeats: fixedReconciled.nextFixedSeats,
      avoidGroups: avoidReconciled.nextAvoidGroups,
    };
    const genderReconciled = reconcileGenderSeatPreferencesForSave(
      groups,
      constraintsForSave.genderSeatPreferences,
      constraintsForSave.fixedSeats,
    );
    constraintsForSave.genderSeatPreferences =
      genderReconciled.nextGenderSeatPreferences;

    if (fixedReconciled.adjustedCount > 0 || fixedReconciled.removedCount > 0) {
      showFeedback(
        `최종 저장 시 압정 정보를 현재 좌석 기준으로 정리했습니다 (보정 ${fixedReconciled.adjustedCount} / 제거 ${fixedReconciled.removedCount}).`,
        'info',
      );
    }
    if (avoidReconciled.removedInvalidCount > 0) {
      showFeedback(
        `최종 저장 시 번개 그룹에서 유효하지 않은 학생 ${avoidReconciled.removedInvalidCount}건을 정리했습니다.`,
        'info',
      );
    }
    if (
      genderReconciled.removedInvalidCount > 0 ||
      genderReconciled.removedPinnedCount > 0
    ) {
      showFeedback(
        `성별 지정 좌석 ${genderReconciled.removedInvalidCount + genderReconciled.removedPinnedCount}개를 현재 배치에 맞게 정리했습니다.`,
        'info',
      );
    }

    const ok = await onSave?.({ groups, constraints: constraintsForSave });
    if (ok !== false) {
      setConstraints(constraintsForSave);
      setHasChanges(false);
      if (includeScale && displayScaleDirty) await saveDeskDisplayScale(deskDisplayScale);
    }

    return ok !== false;
  };

  if (isFreeLayoutOpen) {
    return (
      <FreeLayoutEditor
        groups={groups}
        placementData={placementData}
        onSave={onSavePlacement}
        assignmentDirty={hasChanges}
        onSaveAssignments={() => saveAssignments(false)}
        onCreateSeat={onCreateSeat}
        onSetSeatActive={onSetSeatActive}
        onBack={() => setIsFreeLayoutOpen(false)}
        onOpenShuffle={() => {
          setIsFreeLayoutOpen(false);
          setIsShuffleDetached(false);
          setIsShuffleModalOpen(true);
        }}
        saving={saving}
        deskDisplayScale={deskDisplayScale}
        displayScaleDirty={displayScaleDirty}
        displayScaleSaving={displayScaleSaving}
        onDeskDisplayScaleChange={changeDeskDisplayScale}
        onSaveDeskDisplayScale={saveDeskDisplayScale}
      />
    );
  }

  return (
    <div className="h-full bg-slate-50 overflow-hidden flex flex-col">
      <ClassroomEditorUI
        groups={groups}
        placementData={placementData}
        deskDisplayScale={deskDisplayScale}
        displayScaleDirty={displayScaleDirty}
        displayScaleSaving={displayScaleSaving}
        onDeskDisplayScaleChange={changeDeskDisplayScale}
        onEnableDeskPlacement={() => setIsFreeLayoutOpen(true)}
        activeTool={activeTool}
        selectedSeat={selectedSeat}
        selectedSeatIds={selectedSeatIds}
        currentSeat={currentSeat}
        unassignedStudents={unassignedStudents}
        loading={false}
        handlers={handlers}
        hasChanges={hasChanges}
        saving={saving}
        activeDragItem={activeDragItem}
        constraints={constraints}
        avoidGroups={constraints.avoidGroups}
        genderStats={genderStats}
        activeGenderTool={activeGenderTool}
        activeAvoidGroupId={activeAvoidGroupId}
        onSelectAvoidGroup={setActiveAvoidGroupId}
        onClearAvoidGroups={handlers.clearAvoidGroups}
        fileInputRef={fileInputRef}
        onOpenShuffle={() => {
          setIsShuffleDetached(false);
          setIsShuffleModalOpen(true);
        }}
        onOpenTeacherView={() => setIsTeacherViewOpen(true)}
        onSave={saveAssignments}
      />

      <SeatingShuffleModal
        isOpen={isShuffleModalOpen}
        onClose={handleCloseShuffle}
        onShuffle={handlers.executeStrategicShuffle}
        onConfirm={handleConfirmShuffle}
        groups={groups}
        placementData={placementData}
        deskDisplayScale={deskDisplayScale}
        students={students}
        constraints={constraints}
        canUseGenderGroupedMode={genderStats.canUseGroupedMode}
        genderMissingCount={genderStats.missingCount}
        isDetached={isShuffleDetached}
        onToggleDetached={setIsShuffleDetached}
      />

      <TeacherReverseViewModal
        isOpen={isTeacherViewOpen}
        placementData={placementData}
        onClose={() => setIsTeacherViewOpen(false)}
        groups={groups}
      />

      <TradeHistoryWarningModal
        isOpen={tradeWarningModal.isOpen}
        title={tradeWarningModal.title}
        message={tradeWarningModal.message}
        confirmLabel={tradeWarningModal.confirmLabel}
        onClose={closeTradeWarning}
        onConfirm={handleTradeWarningConfirm}
      />
    </div>
  );
};

export default ClassroomLayoutEditor;
