import { arePlacedSeatsNear, resolveSeatPlacements } from '../utils/freeSeatPlacement';

const SHUFFLE_MODES = ['random', 'pinned_random', 'strategic'];

export const GENDER_SHUFFLE_MODES = {
  ignore: 'ignore',
  grouped: 'grouped',
};

export const GENDER_SEAT_PREFERENCES = {
  none: 'none',
  male: 'male',
  female: 'female',
};

export const AVOID_GROUP_META = [
  { id: 'avoid-red', color: 'red', label: '빨강' },
  { id: 'avoid-blue', color: 'blue', label: '파랑' },
  { id: 'avoid-green', color: 'green', label: '초록' },
  { id: 'avoid-orange', color: 'orange', label: '주황' },
];

export const DEFAULT_AVOID_GROUP_ID = AVOID_GROUP_META[0].id;

export const generateUniqueDeskId = () =>
  `seat-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

export const clone = (value) => JSON.parse(JSON.stringify(value));

export const normalizeGroups = (raw) => (Array.isArray(raw) ? raw : []);

const uniqueStudentIds = (raw) => {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((id) => (id == null ? '' : String(id).trim()))
        .filter(Boolean),
    ),
  );
};

export const normalizeAvoidGroups = (raw) => {
  const source = Array.isArray(raw) ? raw : [];

  const normalized = AVOID_GROUP_META.map((meta, idx) => {
    const candidate = source[idx];
    if (Array.isArray(candidate)) {
      return { ...meta, studentIds: uniqueStudentIds(candidate) };
    }

    if (candidate && typeof candidate === 'object') {
      const ids = Array.isArray(candidate.studentIds)
        ? candidate.studentIds
        : Array.isArray(candidate.students)
          ? candidate.students
          : [];
      return { ...meta, studentIds: uniqueStudentIds(ids) };
    }

    return { ...meta, studentIds: [] };
  });

  const assigned = new Set();
  return normalized.map((group) => ({
    ...group,
    studentIds: group.studentIds.filter((studentId) => {
      if (assigned.has(studentId)) return false;
      assigned.add(studentId);
      return true;
    }),
  }));
};

export const normalizeGenderSeatPreferences = (raw) => {
  if (!raw || typeof raw !== 'object') return {};

  return Object.entries(raw).reduce((acc, [permanentId, preference]) => {
    const key = String(permanentId || '').trim();
    if (!key) return acc;
    if (
      preference === GENDER_SEAT_PREFERENCES.male ||
      preference === GENDER_SEAT_PREFERENCES.female
    ) {
      acc[key] = preference;
    }
    return acc;
  }, {});
};

export const normalizeGender = (value) => {
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

const shuffleArray = (value) => {
  const arr = [...value];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const parseDeskRowCol = (desk) => {
  const rawId = String(desk?.id ?? '');
  const match = rawId.match(/-(\d+)-(\d+)$/);
  if (!match) return null;
  const row = Number(match[1]);
  const col = Number(match[2]);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  return { row, col };
};

const buildGenderPairSlots = (desksToFill, positionByDeskId = null) => {
  if (positionByDeskId) {
    const available = new Set(desksToFill.map((_, index) => index));
    const pairSlots = [];
    while (available.size > 1) {
      let best = null;
      const indices = [...available];
      for (let i = 0; i < indices.length; i += 1) {
        for (let j = i + 1; j < indices.length; j += 1) {
          const a = positionByDeskId.get(desksToFill[indices[i]].desk.id);
          const b = positionByDeskId.get(desksToFill[indices[j]].desk.id);
          if (!a || !b) continue;
          const distance = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
          if (!best || distance < best.distance) best = { first: indices[i], second: indices[j], distance };
        }
      }
      if (!best) break;
      available.delete(best.first);
      available.delete(best.second);
      pairSlots.push({ seatIndices: [best.first, best.second], order: pairSlots.length });
    }
    return { pairSlots, singleSlots: [...available].map((index) => [index]) };
  }
  const byGroup = new Map();
  desksToFill.forEach((seat, index) => {
    const key = String(seat.gi);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push({
      index,
      gi: seat.gi,
      rowCol: parseDeskRowCol(seat?.desk),
    });
  });

  const pairSlots = [];
  const singleSlots = [];
  let pairSlotOrder = 0;

  const pushPairSlot = (seatIndices, meta = {}) => {
    pairSlots.push({
      seatIndices,
      gi: Number.isInteger(meta.gi) ? meta.gi : null,
      row: Number.isInteger(meta.row) ? meta.row : null,
      pairStart: Number.isInteger(meta.pairStart) ? meta.pairStart : null,
      order: pairSlotOrder++,
    });
  };

  const pushFallbackByIndex = (entries) => {
    const sorted = [...entries].sort((a, b) => a.index - b.index);
    for (let i = 0; i < sorted.length; i += 2) {
      if (sorted[i + 1]) {
        pushPairSlot([sorted[i].index, sorted[i + 1].index], {
          gi: sorted[i].gi,
        });
      } else {
        singleSlots.push([sorted[i].index]);
      }
    }
  };

  byGroup.forEach((entries) => {
    const canUseGrid = entries.every((entry) => entry.rowCol);
    if (!canUseGrid) {
      pushFallbackByIndex(entries);
      return;
    }

    const rowMap = new Map();
    entries.forEach((entry) => {
      const row = entry.rowCol.row;
      const col = entry.rowCol.col;
      if (!rowMap.has(row)) rowMap.set(row, new Map());
      rowMap.get(row).set(col, entry.index);
    });

    Array.from(rowMap.keys())
      .sort((a, b) => a - b)
      .forEach((row) => {
        const colMap = rowMap.get(row);
        const cols = Array.from(colMap.keys()).sort((a, b) => a - b);
        const pairStartSet = new Set(cols.map((col) => Math.floor(col / 2) * 2));

        Array.from(pairStartSet)
          .sort((a, b) => a - b)
          .forEach((pairStart) => {
            const left = colMap.get(pairStart);
            const right = colMap.get(pairStart + 1);
            if (left != null && right != null) {
              pushPairSlot([left, right], {
                gi: entries[0]?.gi,
                row,
                pairStart,
              });
            } else if (left != null) {
              singleSlots.push([left]);
            } else if (right != null) {
              singleSlots.push([right]);
            }
          });
      });
  });

  return { pairSlots, singleSlots };
};

const buildGenderGroupedAttempt = (desksToFill, pool, positionByDeskId = null) => {
  const males = shuffleArray(pool.filter((student) => student.gender === 'male'));
  const females = shuffleArray(pool.filter((student) => student.gender === 'female'));

  if (males.length + females.length !== pool.length) {
    throw new Error('성별 정보가 없는 학생이 포함되어 성별끼리 배치를 진행할 수 없습니다.');
  }

  const { pairSlots, singleSlots } = buildGenderPairSlots(desksToFill, positionByDeskId);
  const assignedByIndex = new Array(desksToFill.length);
  let mixedBucketCount = 0;

  const totalMale = males.length;
  const totalFemale = females.length;
  const pairCount = pairSlots.length;
  const singleCount = singleSlots.length;
  const minMaleSingles = Math.max(0, singleCount - totalFemale);
  const maxMaleSingles = Math.min(singleCount, totalMale);

  let bestPlan = null;
  for (let maleSingles = minMaleSingles; maleSingles <= maxMaleSingles; maleSingles += 1) {
    const femaleSingles = singleCount - maleSingles;
    const remainMale = totalMale - maleSingles;
    const remainFemale = totalFemale - femaleSingles;
    if (remainMale < 0 || remainFemale < 0) continue;
    if (remainMale + remainFemale !== pairCount * 2) continue;

    const samePairCount = Math.floor(remainMale / 2) + Math.floor(remainFemale / 2);
    const mixedPairCount = pairCount - samePairCount;
    if (mixedPairCount < 0) continue;

    const score = mixedPairCount * 1000 + Math.abs(remainMale - remainFemale);
    if (!bestPlan || score < bestPlan.score) {
      bestPlan = {
        maleSingles,
        femaleSingles,
        score,
      };
    }
  }

  if (!bestPlan) {
    throw new Error('성별끼리 배치 인원이 좌석 수와 일치하지 않습니다.');
  }

  const singleStudents = [];
  for (let i = 0; i < bestPlan.maleSingles; i += 1) singleStudents.push(males.pop());
  for (let i = 0; i < bestPlan.femaleSingles; i += 1) singleStudents.push(females.pop());

  const shuffledSingles = shuffleArray(singleStudents);
  const shuffledSingleSlots = shuffleArray(singleSlots);
  shuffledSingleSlots.forEach((slot, idx) => {
    assignedByIndex[slot[0]] = shuffledSingles[idx];
  });

  const pairBundles = [];
  while (males.length >= 2) {
    pairBundles.push({
      students: [males.pop(), males.pop()],
      type: 'male',
    });
  }
  while (females.length >= 2) {
    pairBundles.push({
      students: [females.pop(), females.pop()],
      type: 'female',
    });
  }
  while (males.length > 0 && females.length > 0) {
    pairBundles.push({
      students: [males.pop(), females.pop()],
      type: 'mixed',
    });
    mixedBucketCount += 1;
  }

  if (pairBundles.length !== pairCount || males.length > 0 || females.length > 0) {
    throw new Error('성별끼리 배치 인원이 좌석 수와 일치하지 않습니다.');
  }

  const remainingPairBundles = shuffleArray(pairBundles);
  const assignedPairTypeByCoord = new Map();
  const SOFT_GENDER_SPREAD_PROBABILITY = 0.8;

  pairSlots.forEach((slot) => {
    const isSpreadCoord =
      Number.isInteger(slot?.gi) &&
      Number.isInteger(slot?.row) &&
      Number.isInteger(slot?.pairStart);
    const leftCoordKey =
      isSpreadCoord && slot.pairStart >= 2
        ? `${slot.gi}:${slot.row}:${slot.pairStart - 2}`
        : null;
    const leftPairType = leftCoordKey ? assignedPairTypeByCoord.get(leftCoordKey) : null;

    let chosenIndex = Math.floor(Math.random() * remainingPairBundles.length);
    if (
      leftPairType &&
      leftPairType !== 'mixed' &&
      remainingPairBundles.length > 1 &&
      Math.random() < SOFT_GENDER_SPREAD_PROBABILITY
    ) {
      const preferredIndexes = [];
      remainingPairBundles.forEach((bundle, idx) => {
        if (bundle.type !== leftPairType) preferredIndexes.push(idx);
      });
      if (preferredIndexes.length > 0) {
        chosenIndex = preferredIndexes[Math.floor(Math.random() * preferredIndexes.length)];
      }
    }

    const [bundle] = remainingPairBundles.splice(chosenIndex, 1);
    const shuffledStudents = shuffleArray(bundle.students);
    assignedByIndex[slot.seatIndices[0]] = shuffledStudents[0];
    assignedByIndex[slot.seatIndices[1]] = shuffledStudents[1];

    if (isSpreadCoord) {
      const key = `${slot.gi}:${slot.row}:${slot.pairStart}`;
      assignedPairTypeByCoord.set(key, bundle.type);
    }
  });

  if (assignedByIndex.some((student) => !student)) {
    throw new Error('성별끼리 배치 인원이 좌석 수와 일치하지 않습니다.');
  }

  const assignment = assignedByIndex.map((student, idx) => ({
    ...desksToFill[idx],
    studentId: student.uid,
    studentName: student.name,
  }));

  return { assignment, mixedBucketCount };
};

const buildGenderPreferenceAttempt = (
  desksToFill,
  pool,
  genderSeatPreferences,
  useGenderGrouping,
) => {
  const preferences = normalizeGenderSeatPreferences(genderSeatPreferences);
  const preferredSeats = {
    male: [],
    female: [],
  };
  const neutralSeats = [];

  desksToFill.forEach((seat) => {
    const preference = preferences[seat?.desk?.permanentId];
    if (preference === GENDER_SEAT_PREFERENCES.male) {
      preferredSeats.male.push(seat);
      return;
    }
    if (preference === GENDER_SEAT_PREFERENCES.female) {
      preferredSeats.female.push(seat);
      return;
    }
    neutralSeats.push(seat);
  });

  const hasPreferences =
    preferredSeats.male.length > 0 || preferredSeats.female.length > 0;
  if (!hasPreferences) return null;

  const pools = {
    male: shuffleArray(pool.filter((student) => student.gender === 'male')),
    female: shuffleArray(pool.filter((student) => student.gender === 'female')),
  };
  const neutralPool = shuffleArray(pool.filter((student) => !student.gender));

  if (preferredSeats.male.length > pools.male.length) {
    throw new Error('남학생 지정 좌석 수가 현재 남학생 수보다 많습니다.');
  }
  if (preferredSeats.female.length > pools.female.length) {
    throw new Error('여학생 지정 좌석 수가 현재 여학생 수보다 많습니다.');
  }

  const assignment = [];

  ['male', 'female'].forEach((gender) => {
    shuffleArray(preferredSeats[gender]).forEach((seat) => {
      const student = pools[gender].pop();
      assignment.push({
        ...seat,
        studentId: student.uid,
        studentName: student.name,
      });
    });
  });

  const remainingPool = shuffleArray([
    ...pools.male,
    ...pools.female,
    ...neutralPool,
  ]);

  if (neutralSeats.length !== remainingPool.length) {
    throw new Error('성별 지정 좌석을 반영할 수 없습니다. 좌석 수와 학생 수를 확인해 주세요.');
  }

  if (neutralSeats.length === 0) {
    return { assignment, mixedBucketCount: 0 };
  }

  if (useGenderGrouping) {
    const groupedAttempt = buildGenderGroupedAttempt(neutralSeats, remainingPool);
    return {
      assignment: [...assignment, ...groupedAttempt.assignment],
      mixedBucketCount: groupedAttempt.mixedBucketCount,
    };
  }

  const shuffledRemainingSeats = shuffleArray(neutralSeats);
  shuffledRemainingSeats.forEach((seat, idx) => {
    const student = remainingPool[idx];
    assignment.push({
      ...seat,
      studentId: student.uid,
      studentName: student.name,
    });
  });

  return { assignment, mixedBucketCount: 0 };
};

export const createEmptyConstraints = () => ({
  fixedSeats: {},
  avoidGroups: normalizeAvoidGroups([]),
  genderShuffleMode: GENDER_SHUFFLE_MODES.ignore,
  genderSeatPreferences: {},
});

export const normalizeConstraints = (raw) => ({
  fixedSeats:
    raw?.fixedSeats && typeof raw.fixedSeats === 'object'
      ? raw.fixedSeats
      : {},
  avoidGroups: normalizeAvoidGroups(raw?.avoidGroups),
  genderShuffleMode:
    raw?.genderShuffleMode === GENDER_SHUFFLE_MODES.grouped
      ? GENDER_SHUFFLE_MODES.grouped
      : GENDER_SHUFFLE_MODES.ignore,
  genderSeatPreferences: normalizeGenderSeatPreferences(raw?.genderSeatPreferences),
});

export const renumberGroups = (targetGroups) => {
  let count = 1;
  return targetGroups.map((group) => ({
    ...group,
    desks: group.desks.map((desk) =>
      desk.isActive ? { ...desk, number: count++ } : desk,
    ),
  }));
};

const toActiveSeatRows = (targetGroups) =>
  normalizeGroups(targetGroups).flatMap((group, gi) =>
    (group.desks || [])
      .filter((desk) => desk?.isActive)
      .map((desk) => ({
        gi,
        groupId: group.id,
        groupName: group.name,
        permanentId: desk.permanentId,
        deskId: desk.id,
        number: desk.number,
        teamId: desk.teamId || 'none',
        studentId: desk.studentId || null,
        studentName: desk.studentName || null,
      })),
  );

export const resolveFixedSeatsForSource = (sourceGroups, rawFixedSeats) => {
  const rows = toActiveSeatRows(sourceGroups);
  const seatByPermanentId = new Map(rows.map((row) => [row.permanentId, row]));
  const seenStudentIds = new Set();

  const effectiveFixedSeats = {};
  let mismatchCount = 0;
  let missingSeatCount = 0;

  Object.entries(rawFixedSeats || {}).forEach(([permanentId, fixedStudentId]) => {
    const seat = seatByPermanentId.get(permanentId);
    if (!seat) {
      missingSeatCount += 1;
      return;
    }

    if (seat.studentId) {
      if (fixedStudentId && fixedStudentId !== seat.studentId) {
        mismatchCount += 1;
        return;
      }
      if (seenStudentIds.has(seat.studentId)) {
        mismatchCount += 1;
        return;
      }
      effectiveFixedSeats[permanentId] = seat.studentId;
      seenStudentIds.add(seat.studentId);
      return;
    }

    if (fixedStudentId) {
      if (seenStudentIds.has(fixedStudentId)) {
        mismatchCount += 1;
        return;
      }
      effectiveFixedSeats[permanentId] = fixedStudentId;
      seenStudentIds.add(fixedStudentId);
    }
  });

  return {
    effectiveFixedSeats,
    mismatchCount,
    missingSeatCount,
  };
};

export const reconcileFixedSeatsForSave = (targetGroups, rawFixedSeats) => {
  const rows = toActiveSeatRows(targetGroups);
  const seatByPermanentId = new Map(rows.map((row) => [row.permanentId, row]));
  const fixedEntries = Object.entries(rawFixedSeats || {});
  const seenStudentIds = new Set();

  const nextFixedSeats = {};
  let adjustedCount = 0;
  let removedCount = 0;

  fixedEntries.forEach(([permanentId, fixedStudentId]) => {
    const seat = seatByPermanentId.get(permanentId);
    if (!seat || !seat.studentId) {
      removedCount += 1;
      return;
    }

    if (fixedStudentId && fixedStudentId !== seat.studentId) {
      removedCount += 1;
      return;
    }

    if (seenStudentIds.has(seat.studentId)) {
      removedCount += 1;
      return;
    }

    nextFixedSeats[permanentId] = seat.studentId;
    seenStudentIds.add(seat.studentId);
    if (fixedStudentId !== seat.studentId) adjustedCount += 1;
  });

  return { nextFixedSeats, adjustedCount, removedCount };
};

export const reconcileAvoidGroupsForSave = (
  rawAvoidGroups,
  rosterStudents,
  targetGroups,
) => {
  const normalized = normalizeAvoidGroups(rawAvoidGroups);
  const seatStudentIds = toActiveSeatRows(targetGroups)
    .map((row) => row.studentId)
    .filter(Boolean);
  const rosterStudentIds = (rosterStudents || [])
    .map((student) => student?.uid)
    .filter(Boolean);
  const validStudentIds = new Set([...rosterStudentIds, ...seatStudentIds]);

  let removedInvalidCount = 0;
  const globalSeen = new Set();

  const nextAvoidGroups = normalized.map((group) => {
    const nextIds = [];
    group.studentIds.forEach((studentId) => {
      if (!validStudentIds.has(studentId)) {
        removedInvalidCount += 1;
        return;
      }
      if (globalSeen.has(studentId)) return;
      globalSeen.add(studentId);
      nextIds.push(studentId);
    });

    return { ...group, studentIds: nextIds };
  });

  return { nextAvoidGroups, removedInvalidCount };
};

export const reconcileGenderSeatPreferencesForSave = (
  targetGroups,
  rawGenderSeatPreferences,
  rawFixedSeats = {},
) => {
  const preferences = normalizeGenderSeatPreferences(rawGenderSeatPreferences);
  const rows = toActiveSeatRows(targetGroups);
  const activePermanentIds = new Set(rows.map((row) => row.permanentId).filter(Boolean));
  const fixedPermanentIds = new Set(Object.keys(rawFixedSeats || {}));
  const nextGenderSeatPreferences = {};
  let removedInvalidCount = 0;
  let removedPinnedCount = 0;

  Object.entries(preferences).forEach(([permanentId, preference]) => {
    if (!activePermanentIds.has(permanentId)) {
      removedInvalidCount += 1;
      return;
    }
    if (fixedPermanentIds.has(permanentId)) {
      removedPinnedCount += 1;
      return;
    }
    nextGenderSeatPreferences[permanentId] = preference;
  });

  return {
    nextGenderSeatPreferences,
    removedInvalidCount,
    removedPinnedCount,
  };
};

export const runStrategicShuffle = ({
  modeArg,
  sourceGroupsArg,
  groups,
  constraints,
  students,
  genderShuffleModeArg = GENDER_SHUFFLE_MODES.ignore,
  placementDataArg = null,
}) => {
  const mode = SHUFFLE_MODES.includes(modeArg) ? modeArg : 'random';
  const sourceGroups = normalizeGroups(sourceGroupsArg ?? groups);
  const usePins = mode !== 'random';
  const useAvoid = mode === 'strategic';
  const effectiveGenderMode =
    genderShuffleModeArg === GENDER_SHUFFLE_MODES.grouped
      ? GENDER_SHUFFLE_MODES.grouped
      : GENDER_SHUFFLE_MODES.ignore;
  const useGenderGrouping = effectiveGenderMode === GENDER_SHUFFLE_MODES.grouped;

  const rawFixedSeats = usePins ? constraints?.fixedSeats || {} : {};
  const fixedResolution = usePins
    ? resolveFixedSeatsForSource(sourceGroups, rawFixedSeats)
    : { effectiveFixedSeats: {}, mismatchCount: 0, missingSeatCount: 0 };
  const fixedSeats = usePins ? fixedResolution.effectiveFixedSeats : {};
  const avoidGroups = useAvoid
    ? normalizeAvoidGroups(constraints?.avoidGroups).filter(
      (group) => group.studentIds.length > 1,
    )
    : [];
  const genderSeatPreferences = normalizeGenderSeatPreferences(
    constraints?.genderSeatPreferences,
  );

  const activeSeats = sourceGroups
    .flatMap((group, gi) => group.desks.map((desk, di) => ({ gi, di, desk })))
    .filter((item) => item.desk.isActive);
  const positionByDeskId = [1, 2].includes(placementDataArg?.version)
    ? new Map(resolveSeatPlacements(sourceGroups, placementDataArg).map((seat) => [seat.id, seat]))
    : null;

  const desksToFill = usePins
    ? activeSeats.filter((item) => !fixedSeats[item.desk.permanentId])
    : activeSeats;

  if (desksToFill.length === 0) {
    throw new Error('셔플 가능한 좌석이 없습니다.');
  }

  const studentNameById = new Map();
  const studentGenderById = new Map();
  (students || []).forEach((student) => {
    if (!student?.uid) return;
    studentNameById.set(student.uid, student.name || student.displayName || '학생');
    studentGenderById.set(student.uid, normalizeGender(student.gender));
  });
  activeSeats.forEach((item) => {
    if (
      item.desk.studentId &&
      item.desk.studentName &&
      !studentNameById.has(item.desk.studentId)
    ) {
      studentNameById.set(item.desk.studentId, item.desk.studentName);
    }
  });

  const pinnedIds = new Set(usePins ? Object.values(fixedSeats).filter(Boolean) : []);
  const fixedAssignments = usePins
    ? activeSeats
      .filter((item) => fixedSeats[item.desk.permanentId])
      .map((item) => {
        const fixedStudentId = fixedSeats[item.desk.permanentId];
        return {
          ...item,
          studentId: fixedStudentId,
          studentName:
            studentNameById.get(fixedStudentId) || item.desk.studentName || '학생',
        };
      })
    : [];

  const rosterStudents = Array.from(
    new Map(
      (students || [])
        .filter((student) => student?.uid && !pinnedIds.has(student.uid))
        .map((student) => [
          student.uid,
          {
            uid: student.uid,
            name: student.name || student.displayName || '학생',
            gender: normalizeGender(student.gender),
          },
        ]),
    ).values(),
  );

  const seatedStudents = Array.from(
    new Map(
      activeSeats
        .filter(
          (item) => item.desk.studentId && (!usePins || !fixedSeats[item.desk.permanentId]),
        )
        .map((item) => [
          item.desk.studentId,
          {
            uid: item.desk.studentId,
            name: item.desk.studentName || studentNameById.get(item.desk.studentId) || '학생',
            gender: studentGenderById.get(item.desk.studentId) || null,
          },
        ]),
    ).values(),
  );

  let pool = [];
  if (rosterStudents.length === desksToFill.length) {
    pool = rosterStudents;
  } else if (seatedStudents.length === desksToFill.length) {
    pool = seatedStudents;
  } else {
    throw new Error(
      `셔플 인원(${rosterStudents.length})과 셔플 좌석(${desksToFill.length})이 일치하지 않습니다.`,
    );
  }

  let attempts = 0;
  let success = false;
  let finalAssignment = [];
  let mixedGenderBucketCount = 0;
  const maxAttempts = useAvoid ? 500 : 1;

  while (attempts < maxAttempts && !success) {
    attempts += 1;
    let currentAttempt = [];
    let currentMixedBucketCount = 0;

    if (useGenderGrouping) {
      const missingGenderCount = pool.filter((student) => !student.gender).length;
      if (missingGenderCount > 0) {
        throw new Error(
          `성별 미입력 학생 ${missingGenderCount}명이 있어 성별끼리 배치를 진행할 수 없습니다.`,
        );
      }

      const preferenceAttempt = buildGenderPreferenceAttempt(
        desksToFill,
        pool,
        genderSeatPreferences,
        true,
      );
      const groupedAttempt =
        preferenceAttempt || buildGenderGroupedAttempt(desksToFill, pool, positionByDeskId);
      currentAttempt = groupedAttempt.assignment;
      currentMixedBucketCount = groupedAttempt.mixedBucketCount;
    } else {
      const preferenceAttempt = buildGenderPreferenceAttempt(
        desksToFill,
        pool,
        genderSeatPreferences,
        false,
      );
      if (preferenceAttempt) {
        currentAttempt = preferenceAttempt.assignment;
        currentMixedBucketCount = preferenceAttempt.mixedBucketCount;
      } else {
        const shuffled = shuffleArray(pool);
        currentAttempt = desksToFill.map((seat, idx) => ({
          ...seat,
          studentId: shuffled[idx].uid,
          studentName: shuffled[idx].name,
        }));
      }
    }

    const seatsForValidation = usePins
      ? [...fixedAssignments, ...currentAttempt]
      : currentAttempt;

    if (!useAvoid || avoidGroups.length === 0) {
      finalAssignment = currentAttempt;
      mixedGenderBucketCount = currentMixedBucketCount;
      success = true;
      break;
    }

    let isInvalid = false;
    for (const avoidGroup of avoidGroups) {
      const groupIds = new Set(avoidGroup.studentIds.filter(Boolean));
      const members = seatsForValidation.filter((item) => groupIds.has(item.studentId));
      for (let i = 0; i < members.length; i += 1) {
        for (let j = i + 1; j < members.length; j += 1) {
          const a = members[i];
          const b = members[j];
          const aPosition = positionByDeskId?.get(a.desk.id);
          const bPosition = positionByDeskId?.get(b.desk.id);
          const sameClassGroup = positionByDeskId
            ? arePlacedSeatsNear(aPosition, bPosition)
            : a.gi === b.gi;
          const sameTeam =
            a.desk.teamId !== 'none' &&
            b.desk.teamId !== 'none' &&
            a.desk.teamId === b.desk.teamId;
          if (sameClassGroup || sameTeam) {
            isInvalid = true;
            break;
          }
        }
        if (isInvalid) break;
      }
      if (isInvalid) break;
    }

    if (!isInvalid) {
      finalAssignment = currentAttempt;
      mixedGenderBucketCount = currentMixedBucketCount;
      success = true;
    }
  }

  if (!success) {
    throw new Error(
      '조건을 만족하는 배치를 찾지 못했습니다. 번개 그룹 또는 팀 조건을 조정해 주세요.',
    );
  }

  const nextGroups = clone(sourceGroups);

  if (usePins) {
    nextGroups.forEach((group) => {
      group.desks.forEach((desk) => {
        const fixedStudentId = fixedSeats[desk.permanentId];
        if (!fixedStudentId) return;
        desk.studentId = fixedStudentId;
        desk.studentName =
          studentNameById.get(fixedStudentId) || desk.studentName || '학생';
      });
    });
  }

  desksToFill.forEach((seat) => {
    const targetDesk = nextGroups[seat.gi].desks[seat.di];
    targetDesk.studentId = null;
    targetDesk.studentName = null;
  });

  finalAssignment.forEach((seat) => {
    const targetDesk = nextGroups[seat.gi].desks[seat.di];
    targetDesk.studentId = seat.studentId;
    targetDesk.studentName = seat.studentName;
  });

  return {
    attempts,
    nextGroups,
    genderMixedBucketCount: mixedGenderBucketCount,
    genderShuffleMode: effectiveGenderMode,
  };
};
