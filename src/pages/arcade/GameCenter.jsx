import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Settings,
  Ticket,
  Wallet,
  RotateCcw,
  PartyPopper,
  Grid3X3,
  Trophy,
  ClipboardList,
  Brain,
} from "lucide-react";
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useUser } from "../../contexts/UserContext";
import { useFeedback } from "../../contexts/FeedbackContext";
import AppLayout from "../../components/layout/AppLayout";
import {
  AssetBalanceBar,
  Button,
  PageHeader,
  PageLoader,
  Spinner,
} from "../../components/ui";
import {
  getDefaultArcadeSettings,
  normalizeArcadeSettings,
  resetPaperPickBoard,
  saveArcadeSettings,
  saveMatchPredictionBonusMultipliers,
  setNostalgiaPickRoundEnabled,
  setLottoRoundEnabled,
  subscribeAllLottoRounds,
  subscribeAllNostalgiaPickRounds,
  subscribeArcadeSettings,
  subscribeArcadeUsage,
  subscribeCurrentLottoRound,
  subscribeCurrentNostalgiaPickRound,
  subscribeMiniQuizSetQuestions,
  loadMiniQuizQuestions,
  subscribeMyLottoTickets,
} from "./services/arcadeServices";
import arcadePageBackground from "../../assets/arcade/arcade-page-background-v1.png";
import GameCard from "./components/GameCard";
import ScratchCard from "./components/ScratchCard";
import LuckyRoulette from "./components/LuckyRoulette";
import PaperPickBoard from "./components/PaperPickBoard";
import LottoPurchaseModal from "./modals/lotto/LottoPurchaseModal";
import LottoTicketsModal from "./modals/lotto/LottoTicketsModal";
import ArcadeSettingsModal from "./modals/ArcadeSettingsModal";
import ScratchSettingsModal from "./modals/ScratchSettingsModal";
import RouletteSettingsModal from "./modals/RouletteSettingsModal";
import LottoManagementCenter from "./modals/lotto/LottoManagementCenter";
import NostalgiaPickModal from "./modals/NostalgiaPickModal";
import NostalgiaPickManagementCenter from "./modals/NostalgiaPickManagementCenter";
import PickSettingsModal from "./modals/PickSettingsModal";
import MatchPredictionModal from "./modals/MatchPredictionModal";
import MatchPredictionSettingsModal from "./modals/MatchPredictionSettingsModal";
import MiniQuizModal from "./modals/MiniQuizModal";
import {
  getPaymentPolicyMeta,
  isPaymentTypeAllowed,
} from "./utils/paymentPolicy";
import { getArcadeFeeAmount } from "./utils/chargeUtils";
import {
  subscribeClassMatchPredictions,
  subscribeClassMatchRewardRuns,
  subscribeMyMatchPredictions,
  subscribeWorldCupMatches,
} from "./services/matchPredictionService";

const GAMES = [
  {
    id: "scratch",
    name: "스크래치 복권",
    icon: Ticket,
    color: "from-blue-500 to-indigo-600",
    description: "긁자마자 결과를 확인하는 즉시형 복권 게임",
  },
  {
    id: "roulette",
    name: "행운의 룰렛",
    icon: RotateCcw,
    color: "from-emerald-500 to-teal-600",
    description: "룰렛을 돌려 보상이나 아이템을 얻는 게임",
  },
  {
    id: "lotto",
    name: "행운의 복권",
    icon: PartyPopper,
    color: "from-rose-500 to-pink-600",
    description: "번호를 고르고 추첨을 기다리는 행운 게임",
  },
  {
    id: "paperpick",
    name: "종이 뽑기",
    icon: Grid3X3,
    color: "from-purple-500 to-violet-600",
    description: "보드에서 한 칸을 골라 숨겨진 보상을 여는 게임",
  },
  {
    id: "nostalgiaPick",
    name: "추억의 뽑기",
    icon: ClipboardList,
    color: "from-rose-500 to-orange-500",
    description: "번호에 이름을 적고 마감 뒤 추첨을 기다리는 회차형 뽑기",
  },
  {
    id: "matchPrediction",
    name: "경기 예측",
    icon: Trophy,
    color: "from-sky-500 to-blue-700",
    description: "KBO 야구 승부와 점수 차를 예측하는 학급 이벤트",
    freePlayLabel: "예측하기",
  },
  {
    id: "miniQuiz",
    name: "간단퀴즈",
    icon: Brain,
    color: "from-amber-500 to-orange-600",
    description: "짧은 OX, 객관식, 단답형 문제를 풀고 보상을 받는 게임",
    freePlayLabel: "퀴즈 풀기",
  },
];

const isArcadeTicketItem = (data = {}) =>
  data?.functionTag === "arcade_ticket" ||
  (data?.itemType === "ticket" && !data?.functionTag);

const GameCenter = () => {
  const navigate = useNavigate();
  const {
    userData,
    classData,
    classId,
    loading,
    isTeacher,
    currencyUnit,
    formatCurrency,
    studentList,
  } = useUser();
  const { showFeedback } = useFeedback();
  const userId = userData?.uid;

  const [arcadeSettings, setArcadeSettings] = useState(
    getDefaultArcadeSettings(),
  );
  const [arcadeSettingsLoaded, setArcadeSettingsLoaded] = useState(false);
  const [userUsage, setUserUsage] = useState({});
  const [userUsageLoaded, setUserUsageLoaded] = useState(false);
  const [currentLottoRound, setCurrentLottoRound] = useState(null);
  const [allLottoRounds, setAllLottoRounds] = useState([]);
  const [currentNostalgiaPickRound, setCurrentNostalgiaPickRound] =
    useState(null);
  const [allNostalgiaPickRounds, setAllNostalgiaPickRounds] = useState([]);
  const [myTickets, setMyTickets] = useState([]);
  const [storeItems, setStoreItems] = useState([]);
  const [ticketInventoryCount, setTicketInventoryCount] = useState(0);
  const [ticketInventoryLoaded, setTicketInventoryLoaded] = useState(false);
  const [predictionSummary, setPredictionSummary] = useState({ matches: [] });
  const [predictionSummaryLoaded, setPredictionSummaryLoaded] = useState(false);
  const [myMatchPredictions, setMyMatchPredictions] = useState([]);
  const [classMatchPredictions, setClassMatchPredictions] = useState([]);
  const [classMatchRewardRuns, setClassMatchRewardRuns] = useState([]);
  const [miniQuizQuestions, setMiniQuizQuestions] = useState([]);

  const [activeGame, setActiveGame] = useState(null);
  const [paymentType, setPaymentType] = useState("cash");
  const [showSettings, setShowSettings] = useState(false);
  const [editingGame, setEditingGame] = useState(null);
  const [showTicketsModal, setShowTicketsModal] = useState(false);
  const [isResettingPaperPick, setIsResettingPaperPick] = useState(false);
  const [visibilityTogglePending, setVisibilityTogglePending] = useState({});
  const miniQuizSourceSetId = arcadeSettings.games?.miniQuiz?.sourceSetId || "";
  const legacyMiniQuizQuestions = arcadeSettings.games?.miniQuiz?.questions;
  const needsRewardStoreItems =
    isTeacher &&
    ["lotto", "nostalgiaPick", "scratch", "roulette", "paperpick"].includes(
      editingGame,
    );

  useEffect(() => {
    if (!classId || !userId) {
      setArcadeSettings(getDefaultArcadeSettings());
      setArcadeSettingsLoaded(false);
      setUserUsage({});
      setUserUsageLoaded(false);
      setTicketInventoryCount(0);
      setTicketInventoryLoaded(false);
      setPredictionSummary({ matches: [] });
      setPredictionSummaryLoaded(false);
      setMyMatchPredictions([]);
      setClassMatchPredictions([]);
      setClassMatchRewardRuns([]);
      setMiniQuizQuestions([]);
      setCurrentLottoRound(null);
      setAllLottoRounds([]);
      setCurrentNostalgiaPickRound(null);
      setAllNostalgiaPickRounds([]);
      return undefined;
    }

    setArcadeSettingsLoaded(false);
    setUserUsageLoaded(false);
    setTicketInventoryLoaded(false);
    setPredictionSummaryLoaded(false);
    const unsubSettings = subscribeArcadeSettings(classId, (settings) => {
      setArcadeSettings(normalizeArcadeSettings(settings));
      setArcadeSettingsLoaded(true);
    });
    const unsubUsage = subscribeArcadeUsage(classId, userId, (usage) => {
      setUserUsage(usage || {});
      setUserUsageLoaded(true);
    });
    const unsubLotto = subscribeCurrentLottoRound(
      classId,
      setCurrentLottoRound,
    );
    const unsubNostalgiaPick = subscribeCurrentNostalgiaPickRound(
      classId,
      setCurrentNostalgiaPickRound,
    );
    const ticketQuery = query(
      collection(db, "classes", classId, "students", userId, "inventory"),
      where("quantity", ">", 0),
    );
    const unsubTicketInventory = onSnapshot(
      ticketQuery,
      (snap) => {
        const nextCount = snap.docs.reduce(
          (sum, docSnap) =>
            isArcadeTicketItem(docSnap.data())
              ? sum + Math.max(0, Number(docSnap.data()?.quantity || 0))
              : sum,
          0,
        );
        setTicketInventoryCount(nextCount);
        setTicketInventoryLoaded(true);
      },
      (error) => {
        console.error("아케이드 티켓 재고 구독 실패:", error);
        setTicketInventoryCount(0);
        setTicketInventoryLoaded(true);
      },
    );

    return () => {
      unsubSettings();
      unsubUsage();
      unsubLotto();
      unsubNostalgiaPick();
      unsubTicketInventory();
    };
  }, [classId, userId]);

  useEffect(() => {
    if (!classId || !userId || activeGame !== "matchPrediction") {
      setPredictionSummary({ matches: [] });
      setPredictionSummaryLoaded(false);
      setMyMatchPredictions([]);
      setClassMatchPredictions([]);
      setClassMatchRewardRuns([]);
      return undefined;
    }

    setPredictionSummaryLoaded(false);
    const unsubPredictionSummary = subscribeWorldCupMatches((summary) => {
      setPredictionSummary(summary || { matches: [] });
      setPredictionSummaryLoaded(true);
    });
    const unsubMyPredictions = subscribeMyMatchPredictions(
      classId,
      userId,
      setMyMatchPredictions,
    );
    const unsubClassPredictions = isTeacher
      ? subscribeClassMatchPredictions(classId, setClassMatchPredictions)
      : () => {};
    const unsubClassRewardRuns = isTeacher
      ? subscribeClassMatchRewardRuns(classId, setClassMatchRewardRuns)
      : () => {};

    return () => {
      unsubPredictionSummary();
      unsubMyPredictions();
      unsubClassPredictions();
      unsubClassRewardRuns();
    };
  }, [activeGame, classId, isTeacher, userId]);

  useEffect(() => {
    if (!classId || !isTeacher || editingGame !== "lotto") {
      setAllLottoRounds([]);
      return undefined;
    }

    return subscribeAllLottoRounds(classId, setAllLottoRounds);
  }, [classId, editingGame, isTeacher]);

  useEffect(() => {
    if (!classId || !isTeacher || editingGame !== "nostalgiaPick") {
      setAllNostalgiaPickRounds([]);
      return undefined;
    }

    return subscribeAllNostalgiaPickRounds(classId, setAllNostalgiaPickRounds);
  }, [classId, editingGame, isTeacher]);

  useEffect(() => {
    if (!classId || !userId || !showTicketsModal || !currentLottoRound?.id) {
      setMyTickets([]);
      return undefined;
    }

    return subscribeMyLottoTickets(
      classId,
      userId,
      currentLottoRound.id,
      setMyTickets,
    );
  }, [classId, currentLottoRound?.id, showTicketsModal, userId]);

  useEffect(() => {
    if (!classId || !needsRewardStoreItems) {
      setStoreItems([]);
      return undefined;
    }

    let cancelled = false;
    const fetchStoreItems = async () => {
      const storeQuery = query(
        collection(db, "classes", classId, "storeItems"),
        where("isActive", "==", true),
      );
      const snap = await getDocs(storeQuery);
      if (cancelled) return;
      setStoreItems(
        snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
      );
    };

    void fetchStoreItems();

    return () => {
      cancelled = true;
    };
  }, [classId, needsRewardStoreItems]);

  useEffect(() => {
    if (activeGame !== "miniQuiz" || !classId) {
      setMiniQuizQuestions([]);
      return undefined;
    }
    if (!isTeacher) {
      let cancelled = false;
      setMiniQuizQuestions([]);
      loadMiniQuizQuestions(classId)
        .then((rows) => { if (!cancelled) setMiniQuizQuestions(rows); })
        .catch((error) => { if (!cancelled) showFeedback(error?.message || "퀴즈를 불러오지 못했습니다.", "warning"); });
      return () => { cancelled = true; };
    }
    if (!miniQuizSourceSetId) {
      setMiniQuizQuestions(
        activeGame === "miniQuiz" && Array.isArray(legacyMiniQuizQuestions)
          ? legacyMiniQuizQuestions
          : [],
      );
      return undefined;
    }

    return subscribeMiniQuizSetQuestions(
      classId,
      miniQuizSourceSetId,
      setMiniQuizQuestions,
    );
  }, [activeGame, classId, isTeacher, legacyMiniQuizQuestions, miniQuizSourceSetId, showFeedback]);

  const totalTicketCount = ticketInventoryLoaded
    ? ticketInventoryCount
    : Number(userData?.assets?.ticket || 0);
  const showGameCards = isTeacher || arcadeSettingsLoaded;
  const hasPendingVisibilityToggle = (gameId) =>
    Object.prototype.hasOwnProperty.call(visibilityTogglePending, gameId);

  const getGameConfig = (gameId) => {
    if (gameId === "lotto") {
      const globalLottoConfig = arcadeSettings.games?.lotto || {};
      return {
        ...globalLottoConfig,
        ...(currentLottoRound?.settings || {}),
        price: globalLottoConfig.price ?? 500,
        feeAmount: globalLottoConfig.feeAmount ?? 0,
      };
    }

    if (gameId === "nostalgiaPick") {
      const globalConfig = arcadeSettings.games?.nostalgiaPick || {};
      return {
        ...globalConfig,
        ...(currentNostalgiaPickRound?.settings || {}),
        price: globalConfig.price ?? 100,
        feeAmount: globalConfig.feeAmount ?? 0,
        allowedPaymentTypes: globalConfig.allowedPaymentTypes,
        dailyLimit: globalConfig.dailyLimit,
        weeklyLimit: globalConfig.weeklyLimit,
      };
    }

    if (gameId === "miniQuiz" && !isTeacher) {
      const quizConfig = arcadeSettings.games?.miniQuiz || {};
      if (quizConfig.selectionMode === "multiple") return { ...quizConfig, dailyLimit: 0, weeklyLimit: 0 };
      return (quizConfig.sourceSetId && quizConfig.sourceSetVisibility !== "public") ||
        (!quizConfig.sourceSetId && !(quizConfig.questions || []).length)
        ? { ...quizConfig, enabled: false }
        : quizConfig;
    }

    return arcadeSettings.games?.[gameId] || {};
  };

  const getUsageLimitBlockMessage = (gameId) => {
    if (isTeacher) return "";

    const gameConfig = getGameConfig(gameId);
    const gameUsage = userUsage?.[gameId] || {};
    const dailyUsed = Number(gameUsage?.daily || 0);
    const weeklyUsed = Number(gameUsage?.weekly || 0);
    const dailyLimit = Number(gameConfig?.dailyLimit || 0);
    const weeklyLimit = Number(gameConfig?.weeklyLimit || 0);
    const gameName = GAMES.find((game) => game.id === gameId)?.name || "게임";

    if (
      Number.isFinite(dailyLimit) &&
      dailyLimit > 0 &&
      dailyUsed >= dailyLimit
    ) {
      return `오늘 이용 가능 횟수를 모두 사용해서 ${gameName}에 입장할 수 없습니다.`;
    }

    if (
      Number.isFinite(weeklyLimit) &&
      weeklyLimit > 0 &&
      weeklyUsed >= weeklyLimit
    ) {
      return `이번 주 이용 가능 횟수를 모두 사용해서 ${gameName}에 입장할 수 없습니다.`;
    }

    return "";
  };

  const handlePlayGame = (gameId, type = "cash") => {
    if (!arcadeSettingsLoaded && !isTeacher) {
      showFeedback(
        "놀이터 설정을 불러오는 중입니다. 잠시만 기다려 주세요.",
        "info",
      );
      return;
    }

    if (!isTeacher && !userUsageLoaded) {
      showFeedback(
        "입장 정보를 확인하는 중입니다. 잠시 후 다시 시도해 주세요.",
        "info",
      );
      return;
    }

    if (classData?.services?.arcade?.enabled === false && !isTeacher) {
      showFeedback("지금은 놀이터를 이용할 수 없어요.", "warning");
      return;
    }

    const gameConfig = getGameConfig(gameId);
    const usageLimitBlockMessage = getUsageLimitBlockMessage(gameId);
    if (usageLimitBlockMessage) {
      showFeedback(usageLimitBlockMessage, "warning");
      return;
    }

    const isFreeActionGame =
      gameId === "matchPrediction" || gameId === "miniQuiz";
    if (!isFreeActionGame && !isPaymentTypeAllowed(gameConfig?.allowedPaymentTypes, type)) {
      const gameName =
        GAMES.find((game) => game.id === gameId)?.name || "이 게임";
      const policyLabel = getPaymentPolicyMeta(
        gameConfig?.allowedPaymentTypes,
      ).shortLabel;
      const paymentLabel = type === "ticket" ? "티켓" : "현금";

      showFeedback(
        `${gameName}은 ${policyLabel}입니다. ${paymentLabel} 입장은 사용할 수 없습니다.`,
        "warning",
      );
      return;
    }

    const feeAmount = getArcadeFeeAmount(gameConfig?.feeAmount);
    const priceAmount = Math.max(0, Number(gameConfig?.price || 0));
    const userCash = Number(userData?.assets?.cash || 0);
    if (!isTeacher && type === "cash" && !isFreeActionGame) {
      const requiredCash = priceAmount + feeAmount;
      if (userCash < requiredCash) {
        showFeedback("잔액이 부족해서 입장할 수 없습니다.", "warning");
        return;
      }
    }

    if (!isTeacher && type === "ticket") {
      if (!ticketInventoryLoaded) {
        showFeedback(
          "티켓 정보를 확인하는 중입니다. 잠시 후 다시 시도해 주세요.",
          "info",
        );
        return;
      }

      if (totalTicketCount <= 0) {
        showFeedback("보유 티켓이 없어 입장할 수 없습니다.", "warning");
        return;
      }

      if (userCash < feeAmount) {
        showFeedback(
          "수수료를 낼 잔액이 부족해서 입장할 수 없습니다.",
          "warning",
        );
        return;
      }
    }

    if (gameId === "lotto") {
      const lottoStatus = currentLottoRound?.status || null;
      if (lottoStatus !== "open") {
        if (lottoStatus === "paused") {
          showFeedback(
            "현재 행운의 복권 회차는 잠시 일시 정지된 상태입니다.",
            "warning",
          );
          return;
        }
        const message =
          lottoStatus === "closed"
            ? "아직 판매 전인 행운의 복권 회차입니다."
            : lottoStatus === "finished"
              ? "이미 추첨이 끝난 행운의 복권 회차입니다."
              : "현재 진행 중인 행운의 복권 회차가 없습니다.";
        showFeedback(message, "warning");
        return;
      }
    }

    if (gameId === "nostalgiaPick") {
      const nostalgiaStatus = currentNostalgiaPickRound?.status || null;
      if (nostalgiaStatus !== "open") {
        const message =
          nostalgiaStatus === "paused"
            ? "추억의 뽑기가 잠시 정지되었습니다."
            : nostalgiaStatus === "closed"
              ? "추억의 뽑기 응모가 마감되었습니다."
              : nostalgiaStatus === "finished"
                ? "이미 추첨이 끝난 추억의 뽑기입니다."
                : "현재 진행 중인 추억의 뽑기 회차가 없습니다.";
        showFeedback(message, "warning");
        return;
      }
    }

    setPaymentType(type);
    setActiveGame(gameId);
  };

  const handleSaveGameSettings = async (gameId, newConfig) => {
    try {
      const updatedSettings = {
        ...arcadeSettings,
        games: {
          ...arcadeSettings.games,
          [gameId]: {
            ...arcadeSettings.games?.[gameId],
            ...newConfig,
          },
        },
      };

      await saveArcadeSettings(classId, updatedSettings);

      if (gameId === "paperpick") {
        await resetPaperPickBoard(classId, {
          boardSize: newConfig.boardSize,
          prizes: newConfig.prizes,
        });
      }

      setEditingGame(null);
      showFeedback("게임 설정을 저장했습니다.", "success");
    } catch (error) {
      console.error("Game settings save error:", error);
      showFeedback("게임 설정 저장 중 오류가 발생했습니다.", "error");
    }
  };

  const handleResetPaperPickBoard = async () => {
    const currentConfig = arcadeSettings.games?.paperpick;

    if (!classId || !currentConfig) {
      showFeedback("종이뽑기 설정을 먼저 불러와 주세요.", "warning");
      return;
    }

    try {
      setIsResettingPaperPick(true);
      await resetPaperPickBoard(classId, {
        boardSize: currentConfig.boardSize,
        prizes: currentConfig.prizes || [],
      });
      showFeedback(
        "현재 저장된 설정으로 종이뽑기판을 초기화했습니다.",
        "success",
      );
    } catch (error) {
      console.error("Paper pick board reset error:", error);
      showFeedback(
        error?.message || "종이뽑기판 초기화 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsResettingPaperPick(false);
    }
  };

  const handleToggleVisibility = async (gameId, newStatus) => {
    if (hasPendingVisibilityToggle(gameId)) {
      return;
    }

    const prevArcadeSettings = arcadeSettings;
    const prevRound = currentLottoRound;
    const prevNostalgiaRound = currentNostalgiaPickRound;
    try {
      const updatedArcade = {
        ...arcadeSettings,
        games: {
          ...arcadeSettings.games,
          [gameId]: {
            ...arcadeSettings.games?.[gameId],
            enabled: newStatus,
          },
        },
      };
      const updatedRound =
        gameId === "lotto" && currentLottoRound?.id
          ? {
              ...currentLottoRound,
              settings: {
                ...(currentLottoRound.settings || {}),
                enabled: newStatus,
              },
            }
          : currentLottoRound;
      const updatedNostalgiaRound =
        gameId === "nostalgiaPick" && currentNostalgiaPickRound?.id
          ? {
              ...currentNostalgiaPickRound,
              settings: {
                ...(currentNostalgiaPickRound.settings || {}),
                enabled: newStatus,
              },
            }
          : currentNostalgiaPickRound;

      setVisibilityTogglePending((prev) => ({
        ...prev,
        [gameId]: newStatus,
      }));
      setArcadeSettings(updatedArcade);
      if (updatedRound !== currentLottoRound) {
        setCurrentLottoRound(updatedRound);
      }
      if (updatedNostalgiaRound !== currentNostalgiaPickRound) {
        setCurrentNostalgiaPickRound(updatedNostalgiaRound);
      }

      await saveArcadeSettings(classId, updatedArcade);

      if (gameId === "lotto" && currentLottoRound?.id) {
        await setLottoRoundEnabled(classId, {
          roundId: currentLottoRound.id,
          enabled: newStatus,
        });
      }
      if (gameId === "nostalgiaPick" && currentNostalgiaPickRound?.id) {
        await setNostalgiaPickRoundEnabled(classId, {
          roundId: currentNostalgiaPickRound.id,
          enabled: newStatus,
        });
      }

      showFeedback(
        newStatus ? "게임을 다시 공개했습니다." : "게임을 숨김 처리했습니다.",
        "success",
      );
    } catch (error) {
      setArcadeSettings(prevArcadeSettings);
      if (gameId === "lotto") {
        setCurrentLottoRound(prevRound);
      }
      if (gameId === "nostalgiaPick") {
        setCurrentNostalgiaPickRound(prevNostalgiaRound);
      }
      console.error("Toggle visibility error:", error);
      showFeedback("게임 공개 상태를 변경하지 못했습니다.", "error");
    } finally {
      setVisibilityTogglePending((prev) => {
        const next = { ...prev };
        delete next[gameId];
        return next;
      });
    }
  };

  const handleToggleMatchPredictionHidden = async (matchId, shouldHide) => {
    if (!classId || !matchId) return;

    const prevArcadeSettings = arcadeSettings;
    const currentConfig = arcadeSettings.games?.matchPrediction || {};
    const hiddenMatchIds = new Set(
      Array.isArray(currentConfig.hiddenMatchIds)
        ? currentConfig.hiddenMatchIds
        : [],
    );

    if (shouldHide) {
      hiddenMatchIds.add(matchId);
    } else {
      hiddenMatchIds.delete(matchId);
    }

    const updatedArcade = {
      ...arcadeSettings,
      games: {
        ...arcadeSettings.games,
        matchPrediction: {
          ...currentConfig,
          hiddenMatchIds: Array.from(hiddenMatchIds),
        },
      },
    };

    try {
      setArcadeSettings(updatedArcade);
      await saveArcadeSettings(classId, updatedArcade);
      showFeedback(
        shouldHide
          ? "이 경기를 학생 화면에서 숨겼습니다."
          : "이 경기를 학생 화면에 다시 표시했습니다.",
        "success",
      );
    } catch (error) {
      setArcadeSettings(prevArcadeSettings);
      console.error("Match prediction hidden toggle error:", error);
      showFeedback("경기 표시 상태를 변경하지 못했습니다.", "error");
    }
  };

  const handleSetMatchPredictionBonus = async (matchId, multiplier) => {
    if (!classId || !matchId) return;

    const prevArcadeSettings = arcadeSettings;
    const currentConfig = arcadeSettings.games?.matchPrediction || {};
    const bonusMultipliers = {
      ...(currentConfig.bonusMultipliers || {}),
    };
    const normalizedMultiplier = Number(multiplier);

    if (Number.isFinite(normalizedMultiplier) && normalizedMultiplier > 1) {
      bonusMultipliers[matchId] = normalizedMultiplier;
    } else {
      delete bonusMultipliers[matchId];
    }

    const updatedArcade = {
      ...arcadeSettings,
      games: {
        ...arcadeSettings.games,
        matchPrediction: {
          ...currentConfig,
          bonusMultipliers,
        },
      },
    };

    try {
      setArcadeSettings(updatedArcade);
      await saveMatchPredictionBonusMultipliers(classId, bonusMultipliers);
      showFeedback(
        bonusMultipliers[matchId]
          ? `특별 보상 ${bonusMultipliers[matchId]}배를 적용했습니다.`
          : "특별 보상을 해제했습니다.",
        "success",
      );
    } catch (error) {
      setArcadeSettings(prevArcadeSettings);
      console.error("Match prediction bonus update error:", error);
      showFeedback("특별 보상 설정을 변경하지 못했습니다.", "error");
    }
  };

  const handleSaveArcadeGlobalSettings = async (nextSettings) => {
    try {
      await saveArcadeSettings(classId, nextSettings);
      setShowSettings(false);
      showFeedback("놀이터 전체 설정을 저장했습니다.", "success");
    } catch (error) {
      console.error("Arcade global settings save error:", error);
      showFeedback(
        error?.message || "놀이터 전체 설정 저장 중 오류가 발생했습니다.",
        "error",
      );
    }
  };

  const arcadeQuestGuide = useMemo(() => {
    const enabledGameCount = GAMES.filter((game) => {
      const config = arcadeSettings.games?.[game.id] || {};
      return config.enabled !== false;
    }).length;
    const hasTicketStoreItem = storeItems.some(isArcadeTicketItem);
    const hasLottoRound =
      Boolean(currentLottoRound) || allLottoRounds.length > 0;
    const hasNostalgiaRound =
      Boolean(currentNostalgiaPickRound) || allNostalgiaPickRounds.length > 0;
    const hasPredictionMatches = predictionSummary.matches?.length > 0;

    return {
      type: "quest",
      title: "놀이터 도우미",
      launcherTitle: "놀이터 도우미",
      launcherDescription: "게임 공개, 티켓, 라운드, 보상 설정을 체크합니다.",
      subtitle: "학생들이 보상을 쓰고 즐기는 게임형 소비 흐름을 확인합니다.",
      storageKey: classId
        ? `finclass_arcade_quest_${classId}`
        : "finclass_arcade_quest",
      tourKey: "TEACHER_ARCADE_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "arcade-overview",
          title: "놀이터 화면 둘러보기",
          description: "보유 자산, 티켓, 게임 카드 영역을 확인합니다.",
          completed: arcadeSettingsLoaded,
          manualComplete: true,
          objectives: [
            {
              id: "settings-loaded",
              label: "놀이터 설정 불러오기",
              completed: arcadeSettingsLoaded,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="arcade-actions"]',
              title: "놀이터 상태",
              content: "보유 자산, 티켓, 전체 설정 버튼을 확인합니다.",
            },
            {
              target: '[data-tour="arcade-games"]',
              title: "게임 카드",
              content: "학생이 이용할 수 있는 게임 목록을 확인합니다.",
            },
          ],
        },
        {
          id: "enabled-games",
          title: "공개 게임 확인하기",
          description: "학생에게 열어둘 게임을 확인합니다.",
          doneText: `${enabledGameCount}개의 게임이 공개되어 있습니다.`,
          completed: enabledGameCount > 0,
          manualComplete: false,
          objectives: [
            {
              id: "enabled-game-count",
              label: "공개 게임 1개 이상",
              completed: enabledGameCount > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="arcade-games"]',
              title: "게임 공개 상태",
              content: "게임 카드에서 공개 여부와 플레이 조건을 확인합니다.",
            },
          ],
        },
        {
          id: "game-settings",
          title: "게임 설정 열어보기",
          description:
            "게임별 비용, 보상, 공개 여부를 조정하는 위치를 확인합니다.",
          completed: showSettings || Boolean(editingGame),
          manualComplete: true,
          objectives: [
            {
              id: "settings-open",
              label: "전체 설정 또는 게임 설정 열기",
              completed: showSettings || Boolean(editingGame),
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="arcade-actions"]',
              title: "설정",
              content:
                "교사는 상단 설정과 각 게임 카드에서 운영 조건을 조정합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "ticket-flow",
          title: "티켓 흐름 확인하기",
          description:
            "티켓을 보상이나 상점 상품으로 운영할 수 있는지 확인합니다.",
          completed:
            totalTicketCount > 0 || hasTicketStoreItem || showTicketsModal,
          manualComplete: true,
          objectives: [
            {
              id: "ticket-owned",
              label: "보유 티켓 또는 티켓 상품 확인",
              completed: totalTicketCount > 0 || hasTicketStoreItem,
            },
            {
              id: "ticket-modal",
              label: "티켓 상세 열기",
              completed: showTicketsModal,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="arcade-actions"]',
              title: "보유 티켓",
              content: "상단 티켓 표시에서 학생의 티켓 상태를 확인합니다.",
            },
          ],
        },
        {
          id: "lotto-round",
          title: "로또 라운드 확인하기",
          description: "추첨형 게임은 현재 라운드와 과거 라운드를 관리합니다.",
          completed: hasLottoRound,
          manualComplete: true,
          objectives: [
            {
              id: "lotto-round-ready",
              label: "로또 라운드 확인",
              completed: hasLottoRound,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="arcade-games"]',
              title: "로또 카드",
              content: "로또 카드에서 라운드 상태와 참여 흐름을 확인합니다.",
            },
          ],
        },
        {
          id: "nostalgia-round",
          title: "추억의 뽑기 라운드 확인하기",
          description: "마감 후 추첨하는 번호형 활동을 운영할 수 있습니다.",
          completed: hasNostalgiaRound,
          manualComplete: true,
          objectives: [
            {
              id: "nostalgia-round-ready",
              label: "추억의 뽑기 라운드 확인",
              completed: hasNostalgiaRound,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="arcade-games"]',
              title: "추억의 뽑기",
              content: "게임 카드에서 라운드 상태와 참여 흐름을 확인합니다.",
            },
          ],
        },
        {
          id: "prediction-matches",
          title: "경기 예측 데이터 확인하기",
          description: "경기 예측은 경기 목록과 보너스 배율을 함께 관리합니다.",
          completed: hasPredictionMatches,
          manualComplete: true,
          objectives: [
            {
              id: "prediction-ready",
              label: "경기 예측 경기 목록 확인",
              completed: hasPredictionMatches,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="arcade-games"]',
              title: "경기 예측",
              content: "경기 예측 카드에서 예측 가능한 경기를 확인합니다.",
            },
          ],
        },
      ],
    };
  }, [
    allLottoRounds.length,
    allNostalgiaPickRounds.length,
    arcadeSettings.games,
    arcadeSettingsLoaded,
    classId,
    currentLottoRound,
    currentNostalgiaPickRound,
    editingGame,
    predictionSummary.matches,
    showSettings,
    showTicketsModal,
    storeItems,
    totalTicketCount,
  ]);

  if (loading) {
    return (
      <PageLoader
        message={
          "놀이터를 불러오는 중입니다..."
        }
      />
    );
  }

  return (
    <AppLayout
      showSidebar={true}
      showDefaultHeader={false}
      pageGuide={arcadeQuestGuide}
    >
      <div
        className="min-h-screen space-y-6 bg-[#f8f7ff] bg-cover bg-center p-4 sm:p-6 lg:p-8"
        style={{ backgroundImage: `url(${arcadePageBackground})` }}
      >
        <PageHeader
          title="놀이터"
          subtitle="게임과 보상 운영 현황을 확인하고 관리합니다."
          actions={
            <div
              data-tour="arcade-actions"
              className="flex flex-wrap items-center gap-3"
            >
              <AssetBalanceBar
                className="-translate-x-1 sm:-translate-x-2"
                variant="inline"
                items={[
                  {
                    key: "cash",
                    icon: Wallet,
                    tone: "indigo",
                    value: formatCurrency(userData?.assets?.cash || 0),
                    ariaLabel: `보유 현금 ${formatCurrency(userData?.assets?.cash || 0)}`,
                  },
                  {
                    key: "ticket",
                    icon: Ticket,
                    tone: "blue",
                    value: `${totalTicketCount}장`,
                    ariaLabel: `보유 티켓 ${totalTicketCount}장`,
                  },
                ]}
              />
              {isTeacher && (
                <Button
                  size="sm"
                  tone="blue"
                  icon={Settings}
                  onClick={() => setShowSettings(true)}
                >
                  설정
                </Button>
              )}
            </div>
          }
        />

        <div
          data-tour="arcade-games"
          className="mx-auto grid max-w-6xl grid-cols-1 gap-6 sm:grid-cols-2"
        >
          {showGameCards ? (
            GAMES.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                config={getGameConfig(game.id)}
                gameUsage={userUsage?.[game.id] || { daily: 0, weekly: 0 }}
                isTeacher={isTeacher}
                currencyName={currencyUnit}
                userCash={Number(userData?.assets?.cash || 0)}
                userTickets={totalTicketCount}
                usageLoaded={userUsageLoaded}
                ticketInventoryLoaded={ticketInventoryLoaded}
                roundStatus={
                  game.id === "lotto"
                    ? (currentLottoRound?.status ?? null)
                    : game.id === "nostalgiaPick"
                      ? (currentNostalgiaPickRound?.status ?? null)
                      : null
                }
                showProbabilityTable={
                  arcadeSettings.showProbabilityTable === true
                }
                onPlay={(id, paymentType) => id === "miniQuiz" && arcadeSettings.games?.miniQuiz?.selectionMode === "multiple" ? navigate("/arcade/play-quizzes") : handlePlayGame(id, paymentType)}
                onEdit={(id) => id === "miniQuiz" ? navigate("/arcade/quizzes") : setEditingGame(id)}
                onShowTickets={() => setShowTicketsModal(true)}
                onToggleVisibility={handleToggleVisibility}
                isVisibilityUpdating={hasPendingVisibilityToggle(game.id)}
              />
            ))
          ) : (
            <div className="col-span-full flex min-h-[220px] items-center justify-center rounded-3xl border border-slate-200 bg-white/80 text-slate-500 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Spinner size="sm" tone="indigo" />
                {/*
                  <>
                  message="?꾩??대뱶 ?ㅼ젙??遺덈윭?ㅻ뒗 以묒엯?덈떎."
                아케이드 설정을 불러오는 중입니다.
                  </>
                */}
                {
                  "놀이터 설정을 불러오는 중입니다."
                }
              </div>
            </div>
          )}
        </div>
      </div>

      <LottoTicketsModal
        isOpen={showTicketsModal}
        onClose={() => setShowTicketsModal(false)}
        tickets={myTickets}
        roundData={currentLottoRound}
      />

      {activeGame === "matchPrediction" && (
        <MatchPredictionModal
          isOpen={true}
          onClose={() => setActiveGame(null)}
          classId={classId}
          userId={userId}
          isTeacher={isTeacher}
          matches={predictionSummary.matches || []}
          predictions={myMatchPredictions}
          allPredictions={
            isTeacher ? classMatchPredictions : myMatchPredictions
          }
          rewardRuns={isTeacher ? classMatchRewardRuns : []}
          students={studentList || []}
          summaryMeta={predictionSummary}
          hiddenMatchIds={
            arcadeSettings.games?.matchPrediction?.hiddenMatchIds || []
          }
          bonusMultipliers={
            arcadeSettings.games?.matchPrediction?.bonusMultipliers || {}
          }
          onToggleMatchHidden={handleToggleMatchPredictionHidden}
          onSetMatchBonus={handleSetMatchPredictionBonus}
          isLoading={!predictionSummaryLoaded}
        />
      )}

      {activeGame === "miniQuiz" && (
        <MiniQuizModal
          classId={classId}
          settings={getGameConfig("miniQuiz")}
          questions={miniQuizQuestions}
          currencyName={currencyUnit}
          onClose={() => setActiveGame(null)}
        />
      )}

      {activeGame === "roulette" && (
        <LuckyRoulette
          classId={classId}
          allPrizes={arcadeSettings.games?.roulette?.prizes || []}
          price={arcadeSettings.games?.roulette?.price || 50}
          feeAmount={arcadeSettings.games?.roulette?.feeAmount || 0}
          isTicketUsed={paymentType === "ticket"}
          currencyName={currencyUnit}
          onClose={() => setActiveGame(null)}
          onComplete={() => {}}
        />
      )}

      {activeGame === "scratch" && (
        <ScratchCard
          classId={classId}
          price={arcadeSettings.games?.scratch?.price || 100}
          feeAmount={arcadeSettings.games?.scratch?.feeAmount || 0}
          isTeacher={isTeacher}
          isTicketUsed={paymentType === "ticket"}
          currencyName={currencyUnit}
          scratchUsage={userUsage?.scratch || { daily: 0, weekly: 0 }}
          dailyLimit={arcadeSettings.games?.scratch?.dailyLimit}
          onClose={() => setActiveGame(null)}
          onComplete={() => {}}
        />
      )}

      {activeGame === "paperpick" && (
        <PaperPickBoard
          classId={classId}
          price={arcadeSettings.games?.paperpick?.price || 100}
          feeAmount={arcadeSettings.games?.paperpick?.feeAmount || 0}
          isTicketUsed={paymentType === "ticket"}
          currencyName={currencyUnit}
          configuredPrizes={arcadeSettings.games?.paperpick?.prizes || []}
          onClose={() => setActiveGame(null)}
          onComplete={() => {}}
        />
      )}

      {activeGame === "nostalgiaPick" && (
        <NostalgiaPickModal
          isOpen={true}
          classId={classId}
          settings={getGameConfig("nostalgiaPick")}
          roundData={currentNostalgiaPickRound}
          roundStatus={currentNostalgiaPickRound?.status ?? null}
          initialPaymentType={paymentType}
          userTickets={totalTicketCount}
          currencyName={currencyUnit}
          onClose={() => setActiveGame(null)}
        />
      )}

      {activeGame === "lotto" && (
        <LottoPurchaseModal
          isOpen={true}
          classId={classId}
          settings={getGameConfig("lotto")}
          initialPaymentType={paymentType}
          roundStatus={currentLottoRound?.status ?? null}
          userTickets={totalTicketCount}
          currencyName={currencyUnit}
          onClose={() => setActiveGame(null)}
        />
      )}

      {editingGame === "lotto" && (
        <LottoManagementCenter
          allRounds={allLottoRounds}
          storeItems={storeItems}
          currencyName={currencyUnit}
          classId={classId}
          globalSettings={arcadeSettings.games?.lotto}
          onClose={() => setEditingGame(null)}
        />
      )}

      {editingGame === "nostalgiaPick" && (
        <NostalgiaPickManagementCenter
          allRounds={allNostalgiaPickRounds}
          storeItems={storeItems}
          currencyName={currencyUnit}
          classId={classId}
          globalSettings={arcadeSettings.games?.nostalgiaPick}
          onClose={() => setEditingGame(null)}
        />
      )}

      {editingGame === "scratch" && (
        <ScratchSettingsModal
          settings={arcadeSettings.games?.scratch}
          storeItems={storeItems}
          currencyName={currencyUnit}
          onSave={(settings) => handleSaveGameSettings("scratch", settings)}
          onClose={() => setEditingGame(null)}
        />
      )}

      {editingGame === "roulette" && (
        <RouletteSettingsModal
          settings={arcadeSettings.games?.roulette}
          storeItems={storeItems}
          currencyName={currencyUnit}
          onSave={(settings) => handleSaveGameSettings("roulette", settings)}
          onClose={() => setEditingGame(null)}
        />
      )}

      {editingGame === "paperpick" && (
        <PickSettingsModal
          settings={arcadeSettings.games?.paperpick}
          storeItems={storeItems}
          currencyName={currencyUnit}
          onReset={handleResetPaperPickBoard}
          isResetting={isResettingPaperPick}
          onSave={(settings) => handleSaveGameSettings("paperpick", settings)}
          onClose={() => setEditingGame(null)}
        />
      )}

      {editingGame === "matchPrediction" && (
        <MatchPredictionSettingsModal
          settings={arcadeSettings.games?.matchPrediction}
          currencyName={currencyUnit}
          onSave={(settings) =>
            handleSaveGameSettings("matchPrediction", settings)
          }
          onClose={() => setEditingGame(null)}
        />
      )}

      {showSettings && (
        <ArcadeSettingsModal
          settings={arcadeSettings}
          currencyName={currencyUnit}
          classId={classId}
          onSave={handleSaveArcadeGlobalSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </AppLayout>
  );
};

export default GameCenter;
