import { httpsCallable } from "firebase/functions";
import {
  addDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit as limitFn,
  serverTimestamp,
  writeBatch,
  runTransaction,
} from "firebase/firestore";
import { buildQuizConfig, normalizeQuizQuestion, validateQuizPublication } from "../utils/miniQuizEditor";
import { db, functions } from "../../../firebase";
import {
  createSnapshotTelemetryModeTracker,
  trackFirestorePayload,
} from "../../../utils/firestoreTelemetry";
import {
  hasItemReward,
  hasMoneyReward,
  inferMoneyRewardMode,
  inferPrizeType,
} from "../utils/prizeAnalytics";
import { DEFAULT_ALLOWED_PAYMENT_TYPES } from "../utils/paymentPolicy";

const KOREA_TZ = "Asia/Seoul";

const getArcadeConfigPath = (classId) => `classes/${classId}/arcade/config`;
const getArcadeUsagePath = (classId, userId) =>
  `classes/${classId}/arcade/config/usage/${userId}`;
const getMiniQuizQuestionSetsPath = (classId) =>
  `classes/${classId}/miniQuizQuestionSets`;
const getMiniQuizSetQuestionsPath = (classId, setId) =>
  `classes/${classId}/miniQuizQuestionSets/${setId}/questions`;
const getLottoRoundsPath = (classId) => `classes/${classId}/arcade/config/lottoRounds`;
const getNostalgiaPickRoundsPath = (classId) =>
  `classes/${classId}/arcade/config/nostalgiaPickRounds`;
const getPaperPickBoardPath = (classId) =>
  `classes/${classId}/arcade_metadata/paperpick_board`;

const buildMoneyPrize = ({ id, chance, multiplier, amount, label, color }) => {
  const rewardMode =
    amount != null && multiplier == null ? "amount" : "multiplier";

  return {
    id,
    type: "money",
    moneyEnabled: true,
    itemEnabled: false,
    rewardMode,
    ...(rewardMode === "amount"
      ? { amount: Number(amount) || 0 }
      : { multiplier: Number(multiplier) || 0 }),
    ...(chance != null ? { chance } : {}),
    ...(color ? { color } : {}),
    label,
  };
};

const buildPaperPickSlot = (prize) => {
  const moneyEnabled = hasMoneyReward(prize);
  const itemEnabled = hasItemReward(prize);
  const baseSlot = {
    type: inferPrizeType(prize) || prize.type || "money",
    moneyEnabled,
    itemEnabled,
    itemId: itemEnabled ? prize.itemId || null : null,
    label: prize.label || "보상",
    picked: false,
    userId: null,
  };

  if (!moneyEnabled) {
    return baseSlot;
  }

  const rewardMode = inferMoneyRewardMode(prize) || "multiplier";
  if (rewardMode === "amount") {
    return {
      ...baseSlot,
      rewardMode: "amount",
      amount: Number(prize.amount) || 0,
    };
  }

  return {
    ...baseSlot,
    rewardMode: "multiplier",
    multiplier: Number(prize.multiplier) || 0,
  };
};

export const playScratch = async (classId, { paymentType = "cash" } = {}) => {
  const fn = httpsCallable(functions, "playScratch");
  const payload = { classId, paymentType };
  const result = await fn(payload);
  return result.data;
};

export const playRoulette = async (classId, { paymentType = "cash" } = {}) => {
  const fn = httpsCallable(functions, "playRoulette");
  const payload = { classId, paymentType };
  const result = await fn(payload);
  return result.data;
};

export const buyLottoTicket = async (
  classId,
  { numbers, paymentType = "cash" } = {},
) => {
  const fn = httpsCallable(functions, "buyLottoTicket");
  const payload = { classId, numbers, paymentType };
  const result = await fn(payload);
  return result.data;
};

export const buyNostalgiaPickEntry = async (
  classId,
  { slotNumber, paymentType = "cash" } = {},
) => {
  const fn = httpsCallable(functions, "buyNostalgiaPickEntry");
  const payload = { classId, slotNumber, paymentType };
  const result = await fn(payload);
  return result.data;
};

export const manageNostalgiaPickRound = async (
  classId,
  { action, roundId, round, enabled } = {},
) => {
  const fn = httpsCallable(functions, "manageNostalgiaPickRound");
  const payload = { classId, action };
  if (roundId) payload.roundId = roundId;
  if (round) payload.round = round;
  if (typeof enabled === "boolean") payload.enabled = enabled;
  const result = await fn(payload);
  return result.data;
};

export const createNostalgiaPickRound = async (classId, round) =>
  manageNostalgiaPickRound(classId, { action: "create", round });

export const updateNostalgiaPickRound = async (classId, roundId, round) =>
  manageNostalgiaPickRound(classId, { action: "update", roundId, round });

export const openNostalgiaPickRound = async (classId, roundId) =>
  manageNostalgiaPickRound(classId, { action: "open", roundId });

export const pauseNostalgiaPickRound = async (classId, roundId) =>
  manageNostalgiaPickRound(classId, { action: "pause", roundId });

export const resumeNostalgiaPickRound = async (classId, roundId) =>
  manageNostalgiaPickRound(classId, { action: "resume", roundId });

export const closeNostalgiaPickRound = async (classId, roundId) =>
  manageNostalgiaPickRound(classId, { action: "close", roundId });

export const deleteNostalgiaPickRound = async (classId, roundId) =>
  manageNostalgiaPickRound(classId, { action: "delete", roundId });

export const drawNostalgiaPickRound = async (classId, roundId) =>
  manageNostalgiaPickRound(classId, { action: "draw", roundId });

export const publishNostalgiaPickResults = async (classId, roundId) =>
  manageNostalgiaPickRound(classId, { action: "publish_results", roundId });

export const setNostalgiaPickRoundEnabled = async (classId, { roundId, enabled }) =>
  manageNostalgiaPickRound(classId, {
    action: "set_enabled",
    roundId,
    enabled,
  });

export const refundLottoTicket = async (classId, { roundId, ticketId } = {}) => {
  const fn = httpsCallable(functions, "refundLottoTicket");
  const payload = { classId, roundId, ticketId };
  const result = await fn(payload);
  return result.data;
};

export const drawLotto = async (
  classId,
  { roundId, winningNumbers, bonusNumber } = {},
) => {
  const fn = httpsCallable(functions, "drawLotto");
  const payload = { classId, roundId };
  if (Array.isArray(winningNumbers)) payload.winningNumbers = winningNumbers;
  if (bonusNumber != null && bonusNumber !== "") payload.bonusNumber = bonusNumber;
  const result = await fn(payload);
  return result.data;
};

export const manageLottoRound = async (
  classId,
  { action, roundId, round, enabled } = {},
) => {
  const fn = httpsCallable(functions, "manageLottoRound");
  const payload = { classId, action };
  if (roundId) payload.roundId = roundId;
  if (round) payload.round = round;
  if (typeof enabled === "boolean") payload.enabled = enabled;
  const result = await fn(payload);
  return result.data;
};

export const createLottoRound = async (classId, round) =>
  manageLottoRound(classId, { action: "create", round });

export const updateLottoRound = async (classId, roundId, round) =>
  manageLottoRound(classId, { action: "update", roundId, round });

export const openLottoRound = async (classId, roundId) =>
  manageLottoRound(classId, { action: "open", roundId });

export const pauseLottoRound = async (classId, roundId) =>
  manageLottoRound(classId, { action: "pause", roundId });

export const resumeLottoRound = async (classId, roundId) =>
  manageLottoRound(classId, { action: "resume", roundId });

export const closeLottoRound = async (classId, roundId) =>
  manageLottoRound(classId, { action: "close", roundId });

export const deleteLottoRound = async (classId, roundId) =>
  manageLottoRound(classId, { action: "delete", roundId });

export const publishLottoResults = async (classId, roundId) =>
  manageLottoRound(classId, { action: "publish_results", roundId });

export const setLottoRoundEnabled = async (classId, { roundId, enabled }) =>
  manageLottoRound(classId, {
    action: "set_enabled",
    roundId,
    enabled,
  });

export const playPaperPick = async (
  classId,
  { slotIndex, paymentType = "cash" } = {},
) => {
  const fn = httpsCallable(functions, "playPaperPick");
  const payload = { classId, slotIndex, paymentType };
  const result = await fn(payload);
  return result.data;
};

export const submitMiniQuiz = async (classId, { answers = [], requestId, quizId } = {}) => {
  const fn = httpsCallable(functions, "submitMiniQuiz");
  const result = await fn({ classId, answers, requestId, ...(quizId ? { quizId } : {}) });
  return result.data;
};

export const loadMiniQuizQuestions = async (classId, quizId) => {
  const fn = httpsCallable(functions, "getMiniQuizQuestions");
  const result = await fn({ classId, ...(quizId ? { quizId } : {}) });
  return result.data?.questions || [];
};

export const loadPublishedMiniQuizzes = async (classId) => {
  const result = await httpsCallable(functions, "getMiniQuizQuestions")({ classId, list: true });
  if (!Array.isArray(result.data?.quizzes)) throw new Error("퀴즈 목록 기능 업데이트가 필요합니다. 선생님께 알려 주세요.");
  return result.data.quizzes;
};

export const subscribeMiniQuizQuestionSets = (classId, callback, onError) => {
  if (!classId) {
    callback([]);
    return () => {};
  }

  const ref = collection(db, getMiniQuizQuestionSetsPath(classId));
  const setsQuery = query(ref, orderBy("updatedAt", "desc"));
  return onSnapshot(
    setsQuery, (snap) => {
      callback(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    },
    (error) => {
      console.error("간단퀴즈 문제 세트 구독 실패:", error);
      if (onError) onError(error);
      else callback([]);
    },
  );
};

export const subscribeMiniQuizSetQuestions = (classId, setId, callback) => {
  if (!classId || !setId) {
    callback([]);
    return () => {};
  }

  const ref = collection(db, getMiniQuizSetQuestionsPath(classId, setId));
  const questionsQuery = query(ref, orderBy("order", "asc"));
  const getTelemetryMode = createSnapshotTelemetryModeTracker();
  return onSnapshot(
    questionsQuery, { includeMetadataChanges: true },
    (snap) => {
      const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      trackFirestorePayload({
        classId,
        source: "subscribeMiniQuizSetQuestions",
        sourceGroup: "page",
        pathKey: "classes/{classId}/miniQuizQuestionSets/{setId}/questions",
        mode: getTelemetryMode(snap),
        rows,
        snapshot: snap,
      });
      callback(rows);
    },
    (error) => {
      console.error("간단퀴즈 문제 구독 실패:", error);
      callback([]);
    },
  );
};

export const createMiniQuizQuestionSet = async (classId, setData = {}) => {
  if (!classId) throw new Error("classId가 필요합니다.");
  const now = serverTimestamp();
  const ref = await addDoc(collection(db, getMiniQuizQuestionSetsPath(classId)), {
    title: String(setData.title || "새 문제 세트").trim() || "새 문제 세트",
    difficulty: setData.difficulty || "normal",
    description: String(setData.description || "").trim(),
    visibility: setData.visibility || "private",
    questionCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
};

export const saveMiniQuizQuestionSet = async (classId, setId, setData = {}) => {
  if (!classId || !setId) throw new Error("문제 세트가 필요합니다.");
  await setDoc(
    doc(db, getMiniQuizQuestionSetsPath(classId), setId),
    {
      title: String(setData.title || "문제 세트").trim() || "문제 세트",
      difficulty: setData.difficulty || "normal",
      description: String(setData.description || "").trim(),
      visibility: setData.visibility || "private",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

export const saveMiniQuizSetQuestions = async (classId, setId, questions = []) => {
  if (!classId || !setId) throw new Error("문제 세트가 필요합니다.");

  const collectionRef = collection(db, getMiniQuizSetQuestionsPath(classId, setId));
  const existingSnap = await getDocs(collectionRef);
  const batch = writeBatch(db);

  existingSnap.docs.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });

  questions.forEach((question, index) => {
    const questionRef = question.id
      ? doc(collectionRef, question.id)
      : doc(collectionRef);
    batch.set(questionRef, {
      id: questionRef.id,
      type: question.type || "multiple_choice",
      prompt: String(question.prompt || "").trim(),
      imageUrl: String(question.imageUrl || "").trim(),
      options: Array.isArray(question.options) ? question.options : [],
      correctAnswers: Array.isArray(question.correctAnswers)
        ? question.correctAnswers
        : [],
      explanation: String(question.explanation || "").trim(),
      order: index,
      updatedAt: serverTimestamp(),
    });
  });

  batch.set(
    doc(db, getMiniQuizQuestionSetsPath(classId), setId),
    {
      questionCount: questions.length,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
};

export const deleteMiniQuizQuestionSet = async (classId, setId) => {
  if (!classId || !setId) throw new Error("문제 세트가 필요합니다.");

  const questionsRef = collection(db, getMiniQuizSetQuestionsPath(classId, setId));
  const questionsSnap = await getDocs(questionsRef);
  const batch = writeBatch(db);
  questionsSnap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
  batch.delete(doc(db, getMiniQuizQuestionSetsPath(classId), setId));
  await batch.commit();
};

export const createMiniQuizDraftId = (classId) => {
  if (!classId) throw new Error("학급 정보를 확인해 주세요.");
  return doc(collection(db, getMiniQuizQuestionSetsPath(classId))).id;
};

export const getMiniQuizEditorData = async (classId, setId) => {
  const setSnap = await getDoc(doc(db, getMiniQuizQuestionSetsPath(classId), setId));
  if (!setSnap.exists()) throw new Error("퀴즈를 찾을 수 없습니다. 목록에서 다시 선택해 주세요.");
  const quiz = { id: setSnap.id, ...setSnap.data() };
  if (quiz.draft) return { quiz, questions: quiz.draft.questions || [] };
  const snap = await getDocs(query(collection(db, getMiniQuizSetQuestionsPath(classId, setId)), orderBy("order", "asc")));
  return { quiz, questions: snap.docs.map((item) => ({ id: item.id, ...item.data() })) };
};

// Drafts stay in the teacher-only quiz document. Published question documents are
// untouched until publication, so saving an unfinished edit cannot alter a live quiz.
export const saveMiniQuizEditorDraft = async (classId, setId, draft) => {
  if (!classId || !setId) throw new Error("학급과 퀴즈 정보를 확인해 주세요.");
  if (new TextEncoder().encode(JSON.stringify(draft)).length > 800000) throw new Error("퀴즈 내용이 너무 큽니다. 문제나 해설을 나누어 저장해 주세요.");
  const ref = doc(db, getMiniQuizQuestionSetsPath(classId), setId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    tx.set(ref, {
      ...(!snap.exists() ? { title: draft.title || "제목 없는 퀴즈", visibility: "private", questionCount: 0, createdAt: serverTimestamp() } : {}),
      draft, updatedAt: serverTimestamp(),
    }, { merge: true });
  });
};

export const publishMiniQuiz = async (classId, setId, draft) => {
  if (!classId || !setId) throw new Error("학급과 퀴즈 정보를 확인해 주세요.");
  const error = validateQuizPublication(draft.title, draft.questions, draft.settings);
  if (error) throw new Error(error);
  const ref = doc(db, getMiniQuizQuestionSetsPath(classId), setId);
  const questionsRef = collection(db, getMiniQuizSetQuestionsPath(classId, setId));
  const before = await getDoc(ref);
  const existing = await getDocs(questionsRef);
  if (existing.size + draft.questions.length > 450) throw new Error("문제가 너무 많습니다. 퀴즈를 나누어 주세요.");
  const configRef = doc(db, getArcadeConfigPath(classId));
  const questions = draft.questions.map(normalizeQuizQuestion);
  // Config, answers, metadata, and the previous public state change together.
  await runTransaction(db, async (tx) => {
    const [configSnap, quizSnap] = await Promise.all([tx.get(configRef), tx.get(ref)]);
    if (JSON.stringify(before.data()?.updatedAt) !== JSON.stringify(quizSnap.data()?.updatedAt)) throw new Error("퀴즈가 다른 화면에서 변경되었습니다. 목록에서 다시 열어 주세요.");
    const currentIds = new Set(questions.map((question) => question.id));
    existing.docs.forEach((item) => { if (!currentIds.has(item.id)) tx.delete(item.ref); });
    questions.forEach((question, order) => tx.set(doc(questionsRef, question.id), { ...question, order, updatedAt: serverTimestamp() }));
    tx.set(ref, {
      title: draft.title.trim(), description: draft.description || "", difficulty: draft.difficulty || "normal",
      visibility: "public", questionCount: questions.length, settings: draft.settings, draft: null,
      ...(!quizSnap.exists() ? { createdAt: serverTimestamp() } : {}), updatedAt: serverTimestamp(),
    }, { merge: true });
    tx.set(configRef, { games: { miniQuiz: { ...(configSnap.data()?.games?.miniQuiz || {}), ...buildQuizConfig(draft.settings, setId), selectionMode: "multiple" } } }, { mergeFields: ["games.miniQuiz"] });
  });
};

export const pauseMiniQuiz = async (classId, setId) => {
  if (!classId || !setId) throw new Error("학급과 퀴즈 정보를 확인해 주세요.");
  const configRef = doc(db, getArcadeConfigPath(classId));
  const quizRef = doc(db, getMiniQuizQuestionSetsPath(classId), setId);
  await runTransaction(db, async (tx) => {
    const [configSnap, quizSnap] = await Promise.all([tx.get(configRef), tx.get(quizRef)]);
    if (!quizSnap.exists()) throw new Error("퀴즈를 찾을 수 없습니다.");
    tx.update(quizRef, { visibility: "private", updatedAt: serverTimestamp() });
    if (configSnap.data()?.games?.miniQuiz?.sourceSetId === setId && configSnap.data()?.games?.miniQuiz?.selectionMode !== "multiple") {
      tx.update(configRef, { "games.miniQuiz.enabled": false, "games.miniQuiz.sourceSetVisibility": "private" });
    }
  });
};

export const getArcadeSettings = async (classId) => {
  if (!classId) return getDefaultArcadeSettings();
  const ref = doc(db, getArcadeConfigPath(classId));
  const snap = await getDoc(ref);
  return snap.exists() ? normalizeArcadeSettings(snap.data()) : getDefaultArcadeSettings();
};

export const saveArcadeSettings = async (classId, settings) => {
  if (!classId) throw new Error("classId가 필요합니다.");
  const ref = doc(db, getArcadeConfigPath(classId));
  await setDoc(ref, settings, { merge: true });
};

export const saveMatchPredictionBonusMultipliers = async (
  classId,
  bonusMultipliers = {},
) => {
  if (!classId) throw new Error("classId가 필요합니다.");
  const ref = doc(db, getArcadeConfigPath(classId));
  await setDoc(
    ref,
    {
      games: {
        matchPrediction: {
          bonusMultipliers,
        },
      },
    },
    { mergeFields: ["games.matchPrediction.bonusMultipliers"] },
  );
};

export const subscribeArcadeSettings = (classId, callback) => {
  if (!classId) {
    callback(getDefaultArcadeSettings());
    return () => {};
  }

  const ref = doc(db, getArcadeConfigPath(classId));
  return onSnapshot(
    ref, (snap) => {
      callback(
        snap.exists()
          ? normalizeArcadeSettings(snap.data())
          : getDefaultArcadeSettings(),
      );
    },
    (error) => {
      console.error("아케이드 설정 구독 실패:", error);
      callback(getDefaultArcadeSettings());
    },
  );
};

export const getPaperPickBoard = async (classId) => {
  const boardRef = doc(db, getPaperPickBoardPath(classId));
  const snap = await getDoc(boardRef);
  return snap.exists() ? snap.data() : null;
};

export const subscribePaperPickBoard = (classId, callback) => {
  const boardRef = doc(db, getPaperPickBoardPath(classId));
  return onSnapshot(boardRef, (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
};

export const resetPaperPickBoard = async (classId, { boardSize, prizes }) => {
  try {
    const boardRef = doc(db, getPaperPickBoardPath(classId));
    const size = Number(boardSize);
    const slots = [];

    prizes.forEach((prize) => {
      const count = Number(prize.count) || 0;
      for (let index = 0; index < count; index += 1) {
        slots.push(buildPaperPickSlot(prize));
      }
    });

    const remainingCount = Math.max(size - slots.length, 0);
    for (let index = 0; index < remainingCount; index += 1) {
      slots.push({
        type: "money",
        moneyEnabled: true,
        itemEnabled: false,
        rewardMode: "multiplier",
        multiplier: 0,
        itemId: null,
        label: "꽝",
        picked: false,
        userId: null,
      });
    }

    for (let index = slots.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [slots[index], slots[target]] = [slots[target], slots[index]];
    }

    await setDoc(boardRef, {
      boardSize: size,
      slots,
      updatedAt: serverTimestamp(),
    });

    return { success: true };
  } catch (error) {
    console.error("종이뽑기판 초기화 실패:", error);
    throw error;
  }
};

export const subscribeArcadeUsage = (classId, userId, callback) => {
  if (!classId || !userId) {
    callback(getDefaultUsage());
    return () => {};
  }

  const ref = doc(db, getArcadeUsagePath(classId, userId));
  const getTelemetryMode = createSnapshotTelemetryModeTracker();
  return onSnapshot(ref, { includeMetadataChanges: true },
    (snap) => {
    const rawData = snap.exists() ? snap.data() : null;
    trackFirestorePayload({
      classId,
      source: "subscribeArcadeUsage",
      sourceGroup: "page",
      pathKey: "classes/{classId}/arcade/config/usage/{uid}",
      mode: getTelemetryMode(snap),
      rows: rawData ? [{ id: userId, ...rawData }] : [],
      snapshot: snap,
    });
    callback(rawData ? parseUsageData(rawData) : getDefaultUsage());
  });
};

export const subscribeCurrentLottoRound = (classId, callback) => {
  if (!classId) {
    callback(null);
    return () => {};
  }

  const ref = collection(db, getLottoRoundsPath(classId));
  const activeQuery = query(
    ref,
    where("status", "in", ["open", "paused"]),
    orderBy("createdAt", "desc"),
    limitFn(1),
  );
  const recentQuery = query(
    ref,
    where("status", "in", ["closed", "finished"]),
    orderBy("createdAt", "desc"),
    limitFn(1),
  );

  let latestActive = null;
  let latestRecent = null;
  let activeLoaded = false;
  let recentLoaded = false;
  const getActiveTelemetryMode = createSnapshotTelemetryModeTracker();
  const getRecentTelemetryMode = createSnapshotTelemetryModeTracker();

  const emitCurrentRound = () => {
    if (!activeLoaded || !recentLoaded) return;
    callback(latestActive || latestRecent || null);
  };

  const unsubActive = onSnapshot(
    activeQuery, { includeMetadataChanges: true },
    (snap) => {
      latestActive = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
      trackFirestorePayload({
        classId,
        source: "subscribeCurrentLottoRound.active",
        sourceGroup: "page",
        pathKey: "classes/{classId}/arcade/config/lottoRounds",
        mode: getActiveTelemetryMode(snap),
        snapshot: snap,
      });
      activeLoaded = true;
      emitCurrentRound();
    },
    (error) => {
      console.error("Current lotto active round subscribe error:", error);
      latestActive = null;
      activeLoaded = true;
      emitCurrentRound();
    },
  );

  const unsubRecent = onSnapshot(
    recentQuery, { includeMetadataChanges: true },
    (snap) => {
      latestRecent = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
      trackFirestorePayload({
        classId,
        source: "subscribeCurrentLottoRound.recent",
        sourceGroup: "page",
        pathKey: "classes/{classId}/arcade/config/lottoRounds",
        mode: getRecentTelemetryMode(snap),
        snapshot: snap,
      });
      recentLoaded = true;
      emitCurrentRound();
    },
    (error) => {
      console.error("Current lotto recent round subscribe error:", error);
      latestRecent = null;
      recentLoaded = true;
      emitCurrentRound();
    },
  );

  return () => {
    unsubActive();
    unsubRecent();
  };
};

export const subscribeCurrentLottoRoundLegacy = (classId, callback) => {
  if (!classId) {
    callback(null);
    return () => {};
  }

  const ref = collection(db, getLottoRoundsPath(classId));
  const q = query(
    ref,
    where("status", "in", ["open", "paused", "closed", "finished"]),
    orderBy("createdAt", "desc"),
    limitFn(1),
  );

  return onSnapshot(
    q, (snap) => {
      if (snap.empty) callback(null);
      else callback({ id: snap.docs[0].id, ...snap.docs[0].data() });
    },
    (error) => {
      console.error("현재 로또 회차 구독 실패:", error);
      callback(null);
    },
  );
};

export const subscribeMyLottoTickets = (classId, userId, roundId, callback) => {
  if (!classId || !userId || !roundId) {
    callback([]);
    return () => {};
  }

  const ref = collection(db, `${getLottoRoundsPath(classId)}/${roundId}/tickets`);
  const q = query(ref, where("studentUid", "==", userId), orderBy("purchasedAt", "desc"));
  const getTelemetryMode = createSnapshotTelemetryModeTracker();

  return onSnapshot(
    q, { includeMetadataChanges: true },
    (snap) => {
      const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      trackFirestorePayload({
        classId,
        source: "subscribeMyLottoTickets",
        sourceGroup: "page",
        pathKey: "classes/{classId}/arcade/config/lottoRounds/{roundId}/tickets",
        mode: getTelemetryMode(snap),
        rows,
        snapshot: snap,
      });
      callback(rows);
    },
    (error) => {
      console.error("내 로또 티켓 구독 실패:", error);
      callback([]);
    },
  );
};

export const subscribeLottoRoundTickets = (classId, roundId, callback) => {
  if (!classId || !roundId) {
    callback([]);
    return () => {};
  }

  const ref = collection(db, `${getLottoRoundsPath(classId)}/${roundId}/tickets`);
  const q = query(ref, orderBy("purchasedAt", "desc"));

  return onSnapshot(
    q, (snap) => {
      callback(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    },
    (error) => {
      console.error("Lotto round tickets subscribe error:", error);
      callback([]);
    },
  );
};

export const subscribeAllLottoRounds = (classId, callback) => {
  if (!classId) {
    callback([]);
    return () => {};
  }

  const ref = collection(db, getLottoRoundsPath(classId));
  const q = query(ref, orderBy("createdAt", "desc"));
  const getTelemetryMode = createSnapshotTelemetryModeTracker();

  return onSnapshot(
    q, { includeMetadataChanges: true },
    (snap) => {
      const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      trackFirestorePayload({
        classId,
        source: "subscribeAllLottoRounds",
        sourceGroup: "page",
        pathKey: "classes/{classId}/arcade/config/lottoRounds",
        mode: getTelemetryMode(snap),
        rows,
        snapshot: snap,
      });
      callback(rows);
    },
    (error) => {
      console.error("전체 로또 회차 구독 실패:", error);
      callback([]);
    },
  );
};

export const subscribeCurrentNostalgiaPickRound = (classId, callback) => {
  if (!classId) {
    callback(null);
    return () => {};
  }

  const ref = collection(db, getNostalgiaPickRoundsPath(classId));
  const activeQuery = query(ref, where("status", "in", ["open", "paused"]));
  const recentQuery = query(ref, where("status", "in", ["closed", "finished"]));

  let latestActive = null;
  let latestRecent = null;
  let activeLoaded = false;
  let recentLoaded = false;
  const getActiveTelemetryMode = createSnapshotTelemetryModeTracker();
  const getRecentTelemetryMode = createSnapshotTelemetryModeTracker();

  const pickLatestRound = (snap) => {
    const rounds = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    return rounds.sort((left, right) => {
      const leftTime =
        left.createdAt?.toMillis?.() || new Date(left.createdAt || 0).getTime() || 0;
      const rightTime =
        right.createdAt?.toMillis?.() || new Date(right.createdAt || 0).getTime() || 0;
      return rightTime - leftTime;
    })[0] || null;
  };

  const emitCurrentRound = () => {
    if (!activeLoaded || !recentLoaded) return;
    callback(latestActive || latestRecent || null);
  };

  const unsubActive = onSnapshot(
    activeQuery, { includeMetadataChanges: true },
    (snap) => {
      latestActive = pickLatestRound(snap);
      trackFirestorePayload({
        classId,
        source: "subscribeCurrentNostalgiaPickRound.active",
        sourceGroup: "page",
        pathKey: "classes/{classId}/arcade/config/nostalgiaPickRounds",
        mode: getActiveTelemetryMode(snap),
        snapshot: snap,
      });
      activeLoaded = true;
      emitCurrentRound();
    },
    (error) => {
      console.error("Current nostalgia pick active round subscribe error:", error);
      latestActive = null;
      activeLoaded = true;
      emitCurrentRound();
    },
  );

  const unsubRecent = onSnapshot(
    recentQuery, { includeMetadataChanges: true },
    (snap) => {
      latestRecent = pickLatestRound(snap);
      trackFirestorePayload({
        classId,
        source: "subscribeCurrentNostalgiaPickRound.recent",
        sourceGroup: "page",
        pathKey: "classes/{classId}/arcade/config/nostalgiaPickRounds",
        mode: getRecentTelemetryMode(snap),
        snapshot: snap,
      });
      recentLoaded = true;
      emitCurrentRound();
    },
    (error) => {
      console.error("Current nostalgia pick recent round subscribe error:", error);
      latestRecent = null;
      recentLoaded = true;
      emitCurrentRound();
    },
  );

  return () => {
    unsubActive();
    unsubRecent();
  };
};

export const subscribeAllNostalgiaPickRounds = (classId, callback) => {
  if (!classId) {
    callback([]);
    return () => {};
  }

  const ref = collection(db, getNostalgiaPickRoundsPath(classId));
  const q = query(ref, orderBy("createdAt", "desc"));
  const getTelemetryMode = createSnapshotTelemetryModeTracker();

  return onSnapshot(
    q, { includeMetadataChanges: true },
    (snap) => {
      const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      trackFirestorePayload({
        classId,
        source: "subscribeAllNostalgiaPickRounds",
        sourceGroup: "page",
        pathKey: "classes/{classId}/arcade/config/nostalgiaPickRounds",
        mode: getTelemetryMode(snap),
        rows,
        snapshot: snap,
      });
      callback(rows);
    },
    (error) => {
      console.error("All nostalgia pick rounds subscribe error:", error);
      callback([]);
    },
  );
};

export const subscribeNostalgiaPickRoundEntries = (classId, roundId, callback) => {
  if (!classId || !roundId) {
    callback([]);
    return () => {};
  }

  const ref = collection(
    db,
    `${getNostalgiaPickRoundsPath(classId)}/${roundId}/entries`,
  );
  const q = query(ref, orderBy("slotNumber", "asc"));

  return onSnapshot(
    q, (snap) => {
      callback(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    },
    (error) => {
      console.error("Nostalgia pick entries subscribe error:", error);
      callback([]);
    },
  );
};

function getNowInKst() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: KOREA_TZ }));
}

function toYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getToday() {
  return toYmd(getNowInKst());
}

function getWeekStart() {
  const kstNow = getNowInKst();
  const day = kstNow.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  kstNow.setDate(kstNow.getDate() + diff);
  return toYmd(kstNow);
}

export function getDefaultArcadeSettings() {
  return {
    showProbabilityTable: false,
    games: {
      scratch: {
        enabled: true,
        price: 100,
        feeAmount: 0,
        dailyLimit: 5,
        allowedPaymentTypes: [...DEFAULT_ALLOWED_PAYMENT_TYPES],
        prizes: [
          buildMoneyPrize({ id: 1, multiplier: 0, chance: 40, label: "꽝" }),
          buildMoneyPrize({ id: 2, multiplier: 1, chance: 30, label: "본전" }),
          buildMoneyPrize({ id: 3, multiplier: 2, chance: 20, label: "2배" }),
          buildMoneyPrize({ id: 4, multiplier: 5, chance: 10, label: "5배" }),
        ],
      },
      roulette: {
        enabled: true,
        price: 50,
        feeAmount: 0,
        dailyLimit: 10,
        allowedPaymentTypes: [...DEFAULT_ALLOWED_PAYMENT_TYPES],
        prizes: [
          buildMoneyPrize({
            id: 1,
            multiplier: 0,
            chance: 50,
            label: "꽝",
            color: "#94a3b8",
          }),
          buildMoneyPrize({
            id: 2,
            multiplier: 1,
            chance: 30,
            label: "본전",
            color: "#60a5fa",
          }),
          buildMoneyPrize({
            id: 3,
            multiplier: 2,
            chance: 20,
            label: "2배 보상",
            color: "#34d399",
          }),
        ],
      },
      lotto: {
        enabled: false,
        status: "closed",
        price: 500,
        feeAmount: 0,
        allowedPaymentTypes: [...DEFAULT_ALLOWED_PAYMENT_TYPES],
        maxNumber: 45,
        pickCount: 6,
        useBonus: true,
        prizes: [
          { rank: 1, type: "money", amount: 50000, label: "1등 대박" },
          { rank: 2, type: "money", amount: 10000, label: "2등 아깝다" },
          { rank: 3, type: "money", amount: 5000, label: "3등 축하" },
        ],
      },
      paperpick: {
        enabled: false,
        price: 100,
        feeAmount: 0,
        dailyLimit: 0,
        allowedPaymentTypes: [...DEFAULT_ALLOWED_PAYMENT_TYPES],
        boardSize: 100,
        prizes: [
          {
            id: 1,
            type: "money",
            rewardMode: "multiplier",
            multiplier: 10,
            count: 1,
            label: "1등 보상",
          },
          {
            id: 2,
            type: "money",
            rewardMode: "multiplier",
            multiplier: 5,
            count: 3,
            label: "2등 보상",
          },
        ],
      },
      nostalgiaPick: {
        enabled: false,
        price: 100,
        feeAmount: 0,
        dailyLimit: 0,
        weeklyLimit: 0,
        allowedPaymentTypes: [...DEFAULT_ALLOWED_PAYMENT_TYPES],
        boardSize: 99,
        maxEntriesPerStudent: 3,
        duplicateWinnersAllowed: false,
        prizes: [
          { rank: 1, type: "money", amount: 20, label: "1등" },
          { rank: 2, type: "money", amount: 10, label: "2등" },
          { rank: 3, type: "money", amount: 5, label: "3등" },
        ],
      },
      matchPrediction: {
        enabled: true,
        price: 0,
        feeAmount: 0,
        dailyLimit: 0,
        weeklyLimit: 0,
        allowedPaymentTypes: ["cash"],
        hiddenMatchIds: [],
        bonusMultipliers: {},
        rewardEnabled: true,
        autoPayoutEnabled: true,
        outcomeRewardAmount: 100,
        exactScoreRewardAmount: 300,
      },
      miniQuiz: {
        enabled: false,
        price: 0,
        feeAmount: 0,
        dailyLimit: 1,
        weeklyLimit: 0,
        allowedPaymentTypes: ["cash"],
        questionCount: 3,
        participationReward: 50,
        rewardPerCorrect: 100,
        perfectBonus: 300,
        showCorrectAfterSubmit: true,
        sourceSetId: "",
        questions: [],
      },
    },
  };
}

export function normalizeArcadeSettings(settings = {}) {
  const defaults = getDefaultArcadeSettings();
  const mergedGames = { ...defaults.games, ...(settings.games || {}) };

  return {
    ...defaults,
    ...settings,
    games: {
      scratch: {
        ...defaults.games.scratch,
        ...(mergedGames.scratch || {}),
      },
      roulette: {
        ...defaults.games.roulette,
        ...(mergedGames.roulette || {}),
      },
      lotto: {
        ...defaults.games.lotto,
        ...(mergedGames.lotto || {}),
      },
      paperpick: {
        ...defaults.games.paperpick,
        ...(mergedGames.paperpick || {}),
      },
      nostalgiaPick: {
        ...defaults.games.nostalgiaPick,
        ...(mergedGames.nostalgiaPick || {}),
      },
      matchPrediction: {
        ...defaults.games.matchPrediction,
        ...(mergedGames.matchPrediction || {}),
      },
      miniQuiz: {
        ...defaults.games.miniQuiz,
        ...(mergedGames.miniQuiz || {}),
      },
    },
  };
}

export function getDefaultUsage() {
  return {
    scratch: { daily: 0, weekly: 0 },
    lotto: { daily: 0, weekly: 0 },
    roulette: { daily: 0, weekly: 0 },
    paperpick: { daily: 0, weekly: 0 },
    nostalgiaPick: { daily: 0, weekly: 0 },
    matchPrediction: { daily: 0, weekly: 0 },
    miniQuiz: { daily: 0, weekly: 0 },
  };
}

function parseUsageData(data) {
  const today = getToday();
  const weekStart = getWeekStart();
  const result = {};
  const gameIds = [
    "scratch",
    "lotto",
    "roulette",
    "paperpick",
    "nostalgiaPick",
    "matchPrediction",
    "miniQuiz",
  ];

  for (const gameId of gameIds) {
    const gameUsage = data[gameId] || {};
    const daily = gameUsage[today] || 0;
    const weekly = Object.entries(gameUsage)
      .filter(([date]) => date >= weekStart)
      .reduce((sum, [, count]) => sum + count, 0);
    result[gameId] = { daily, weekly };
  }

  return result;
}
