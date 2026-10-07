import { appConfirm } from "../../../utils/appDialogs";
import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Cloud,
  Clock3,
  Eye,
  EyeOff,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Trophy,
  UsersRound,
} from "lucide-react";
import { Button, Modal, Spinner } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  cancelMatchPredictions,
  processMatchPredictionRewards,
  saveMatchPrediction,
  syncWorldCupMatches,
} from "../services/matchPredictionService";

const KOREA_TZ = "Asia/Seoul";
const PREDICTION_CLOSE_OFFSET_MS = 10 * 60 * 1000;
const MATCH_REWARD_RUN_ROLLOUT_START_UTC = "2026-06-15T15:00:00.000Z";
const TABS = [
  { id: "week", label: "경기 일정" },
  { id: "all", label: "전체" },
  { id: "mine", label: "내 예측" },
];

const TEAM_NAME_KO = {
  Algeria: "알제리",
  Argentina: "아르헨티나",
  Australia: "호주",
  Austria: "오스트리아",
  Belgium: "벨기에",
  "Bosnia-Herzegovina": "보스니아",
  Brazil: "브라질",
  Canada: "캐나다",
  "Cape Verde": "카보베르데",
  "Cape Verde Islands": "카보베르데",
  Colombia: "콜롬비아",
  "Congo DR": "콩고민주공화국",
  Croatia: "크로아티아",
  "Czech Republic": "체코",
  Czechia: "체코",
  Curaçao: "퀴라소",
  Ecuador: "에콰도르",
  Egypt: "이집트",
  England: "잉글랜드",
  France: "프랑스",
  Germany: "독일",
  Ghana: "가나",
  Haiti: "아이티",
  Iran: "이란",
  Iraq: "이라크",
  "Ivory Coast": "코트디부아르",
  Japan: "일본",
  Jordan: "요르단",
  Mexico: "멕시코",
  Morocco: "모로코",
  Netherlands: "네덜란드",
  "New Zealand": "뉴질랜드",
  Norway: "노르웨이",
  Panama: "파나마",
  Paraguay: "파라과이",
  Portugal: "포르투갈",
  Qatar: "카타르",
  "Saudi Arabia": "사우디",
  Scotland: "스코틀랜드",
  Senegal: "세네갈",
  "South Africa": "남아공",
  "South Korea": "대한민국",
  Spain: "스페인",
  Sweden: "스웨덴",
  Switzerland: "스위스",
  Tunisia: "튀니지",
  Turkey: "튀르키예",
  "United States": "미국",
  Uruguay: "우루과이",
  USA: "미국",
  Uzbekistan: "우즈베키스탄",
};

const formatTeamName = (name) => TEAM_NAME_KO[name] || name || "-";

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatKstDateKey = (value) => {
  const date = toDate(value);
  if (!date) return "날짜 미정";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const formatKstDateLabel = (value) => {
  const date = toDate(value);
  if (!date) return "날짜 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KOREA_TZ,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
};

const formatKstTimeLabel = (value) => {
  const date = toDate(value);
  if (!date) return "시간 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KOREA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

const formatKstTimeWithLabel = (value) => {
  const time = formatKstTimeLabel(value);
  return time === "시간 미정" ? time : `한국시간 ${time}`;
};

const formatKstDateTimeLabel = (value) => {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KOREA_TZ,
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

const getSyncSourceLabel = (triggeredBy) =>
  triggeredBy === "schedule" ? "자동 갱신" : "수동 갱신";

const getDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getTodayKstDateKey = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const getKstDateObject = (value) => {
  const date = toDate(value);
  if (!date) return null;
  return new Date(date.toLocaleString("en-US", { timeZone: KOREA_TZ }));
};

const getWeekOfMonth = (date) => {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  const firstDayOffset = firstDay === 0 ? 6 : firstDay - 1;
  return Math.floor((date.getDate() + firstDayOffset - 1) / 7) + 1;
};

const getKstWeekMeta = (value) => {
  const kstDate = getKstDateObject(value);
  if (!kstDate) {
    return { key: "unscheduled", label: "날짜 미정" };
  }

  const weekStart = new Date(kstDate);
  const day = weekStart.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  weekStart.setDate(kstDate.getDate() + diff);
  weekStart.setHours(0, 0, 0, 0);

  return {
    key: getDateKey(weekStart),
    label: `${kstDate.getMonth() + 1}월 ${getWeekOfMonth(kstDate)}주차`,
  };
};

const getWeekRange = () => {
  const now = new Date();
  const kstNow = new Date(now.toLocaleString("en-US", { timeZone: KOREA_TZ }));
  const day = kstNow.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(kstNow);
  start.setDate(kstNow.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(kstNow);
  end.setDate(kstNow.getDate() + 31);
  end.setHours(0, 0, 0, 0);
  return { start, end };
};

const getMatchType = (match) => {
  const round = String(match?.round || "").toLowerCase();
  if (
    round.includes("knockout") ||
    round.includes("round_of") ||
    round.includes("last_") ||
    round.includes("quarter") ||
    round.includes("semi") ||
    round.includes("final") ||
    Number(match?.round) >= 4
  ) {
    return "knockout";
  }
  return "group";
};

const getMatchRoundLabel = (match) => {
  const round = String(match?.round || "").toLowerCase();
  const normalizedRound = round.replace(/[\s-]+/g, "_");

  if (normalizedRound.includes("round_of_32") || normalizedRound.includes("last_32")) {
    return "32강";
  }
  if (normalizedRound.includes("round_of_16") || normalizedRound.includes("last_16")) {
    return "16강";
  }
  if (normalizedRound.includes("quarter")) {
    return "8강";
  }
  if (normalizedRound.includes("semi")) {
    return "4강";
  }
  if (normalizedRound.includes("third") || normalizedRound.includes("bronze")) {
    return "3·4위전";
  }
  if (normalizedRound.includes("final")) {
    return "결승";
  }
  if (getMatchType(match) === "knockout") {
    return "토너먼트";
  }
  return match?.league === "KBO" ? "KBO 리그" : "조별리그";
};

const isPredictionOpen = (match) => {
  if (match?.source === "naver" && !(Date.now() - Date.parse(match.checkedAtUtc) < 36 * 3600000)) return false;
  if (match?.postponed || !["SCHEDULED", "TIMED"].includes(match?.status)) return false;
  const startsAt = toDate(match?.startsAtUtc);
  if (!startsAt) return false;
  return startsAt.getTime() - PREDICTION_CLOSE_OFFSET_MS > Date.now();
};

const FINAL_MATCH_STATUSES = new Set(["FINISHED", "AWARDED"]);

const isMatchFinal = (match) =>
  FINAL_MATCH_STATUSES.has(String(match?.status || "").toUpperCase());

const hasFinalScore = (match) =>
  isMatchFinal(match) &&
  match?.score?.home != null && match?.score?.away != null &&
  Number.isFinite(Number(match?.score?.home)) &&
  Number.isFinite(Number(match?.score?.away));

const isRewardRunManagedMatch = (match) => {
  const startsAt = toDate(match?.startsAtUtc);
  if (!startsAt) return false;
  return startsAt.getTime() >= new Date(MATCH_REWARD_RUN_ROLLOUT_START_UTC).getTime();
};

const getOutcomeFromScores = (homeScore, awayScore) => {
  const home = Number(homeScore);
  const away = Number(awayScore);
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
};

const outcomeOptionsFor = (match) => {
  const home = formatTeamName(match?.home?.name);
  const away = formatTeamName(match?.away?.name);
  if (getMatchType(match) === "knockout") {
    return [
      { value: "home", label: `${home} 승` },
      { value: "away", label: `${away} 승` },
    ];
  }
  return [
    { value: "home", label: `${home} 승` },
    { value: "draw", label: "무승부" },
    { value: "away", label: `${away} 승` },
  ];
};

const DEFAULT_SCORE_BY_OUTCOME = {
  home: ["1", "0"],
  draw: ["0", "0"],
  away: ["0", "1"],
};

const MARGIN_OPTIONS = [
  { value: "1", label: "1점 차" },
  { value: "2-3", label: "2~3점 차" },
  { value: "4+", label: "4점 차 이상" },
];
const marginLabel = (margin) => margin === "draw" ? "0점 차" :
  MARGIN_OPTIONS.find((option) => option.value === margin)?.label || "점수 차 선택";
const savedPredictionLabel = (prediction) => prediction?.predictionType === "margin"
  ? marginLabel(prediction.margin)
  : `${prediction?.homeScore}:${prediction?.awayScore}`;

const getInitialOutcome = (match, prediction) => {
  if (prediction?.outcome) return prediction.outcome;
  if (String(match.id).startsWith("kbo_")) return "";
  return outcomeOptionsFor(match).some((option) => option.value === "draw")
    ? "draw"
    : "home";
};

const normalizeBonusMultiplier = (value) => {
  const multiplier = Number(value);
  return Number.isFinite(multiplier) && multiplier > 1 ? multiplier : 1;
};

const getNextBonusMultiplier = (current) => {
  const multiplier = normalizeBonusMultiplier(current);
  if (multiplier < 2) return 2;
  if (multiplier < 3) return 3;
  return 1;
};

const buildPredictionMap = (predictions) =>
  predictions.reduce((acc, prediction) => {
    if (prediction?.matchId) acc[prediction.matchId] = prediction;
    return acc;
  }, {});

const buildStudentMap = (students) =>
  students.reduce((acc, student) => {
    const uid = student?.id || student?.uid;
    if (uid) acc[uid] = student;
    return acc;
  }, {});

const getPredictionRewardTone = (prediction) => {
  const reward = prediction?.reward || {};
  if (reward.status !== "paid" && prediction?.rewardStatus !== "paid") {
    return "pending";
  }
  if (reward.exactScoreCorrect) return "score";
  if (reward.outcomeCorrect) return "outcome";
  return "miss";
};

const getPredictionRewardStatus = (prediction) =>
  prediction?.reward?.status || prediction?.rewardStatus || "";

const buildRewardRunMap = (rewardRuns = []) =>
  rewardRuns.reduce((acc, rewardRun) => {
    const matchId = rewardRun?.matchId || rewardRun?.id;
    if (matchId) acc[matchId] = rewardRun;
    return acc;
  }, {});

const buildMatchRewardSummary = (predictions = [], rewardRun = null) => {
  const totalCount = predictions.length;
  const processedPredictions = predictions.filter((prediction) =>
    ["paid", "no_reward"].includes(getPredictionRewardStatus(prediction)),
  );
  const paidPredictions = predictions.filter(
    (prediction) => getPredictionRewardStatus(prediction) === "paid",
  );
  const rewardRunProcessed = rewardRun?.status === "processed";

  return {
    totalCount: rewardRunProcessed
      ? Number(rewardRun?.predictionCount ?? totalCount)
      : totalCount,
    processedCount: rewardRunProcessed
      ? Number(rewardRun?.evaluatedCount ?? processedPredictions.length)
      : processedPredictions.length,
    paidCount: rewardRunProcessed
      ? Number(rewardRun?.paidCount ?? paidPredictions.length)
      : paidPredictions.length,
    totalPaidAmount: rewardRunProcessed ? Number(rewardRun?.totalPaidAmount || 0) : processedPredictions.reduce(
      (sum, prediction) => sum + Number(prediction?.reward?.totalRewardAmount || 0),
      0,
    ),
    allProcessed:
      rewardRunProcessed || (totalCount > 0 && processedPredictions.length === totalCount),
  };
};

const getBadgeUrl = (badge) => {
  if (!badge) return null;
  if (badge.includes("thesportsdb.com") && !badge.endsWith("/tiny")) {
    return `${badge}/tiny`;
  }
  return badge;
};

const KBO_TEAM_BADGES = {
  LG: "LG", 한화: "HH", SSG: "SK", 삼성: "SS", NC: "NC",
  KT: "KT", 롯데: "LT", KIA: "HT", 두산: "OB", 키움: "WO",
};

const MatchBadge = ({ team }) => {
  const kboCode = KBO_TEAM_BADGES[team?.name];
  const badgeUrl = kboCode
    ? `/images/kbo/emblem_${kboCode}.png`
    : getBadgeUrl(team?.badge);
  const [failedUrl, setFailedUrl] = useState(null);
  return (
    <div className="flex h-12 w-14 shrink-0 items-center justify-center rounded-xl bg-white">
      {badgeUrl && badgeUrl !== failedUrl ? (
        <img
          src={badgeUrl}
          alt={`${formatTeamName(team?.name)} 구단 마크`}
          className="h-11 w-12 object-contain"
          loading="lazy"
          onError={() => setFailedUrl(badgeUrl)}
        />
      ) : (
        <Trophy size={18} className="text-slate-400" />
      )}
    </div>
  );
};

const ScoreStepper = ({ label, value, onChange, disabled }) => {
  const numericValue = Math.max(0, Math.min(99, Number(value) || 0));

  const updateScore = (nextValue) => {
    const clamped = Math.max(0, Math.min(99, nextValue));
    onChange(String(clamped));
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-black text-slate-500">{label}</span>
      <div className="grid h-12 grid-cols-[42px_58px_42px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <Button
          type="button"
          disabled={disabled || numericValue <= 0}
          onClick={() => updateScore(numericValue - 1)}
          className="flex items-center justify-center border-r border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          aria-label={`${label} 점수 낮추기`}
        >
          <Minus size={16} strokeWidth={3} />
        </Button>
        <div className="flex items-center justify-center bg-slate-50 text-2xl font-black tabular-nums text-slate-950">
          {numericValue}
        </div>
        <Button
          type="button"
          disabled={disabled || numericValue >= 99}
          onClick={() => updateScore(numericValue + 1)}
          className="flex items-center justify-center border-l border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          aria-label={`${label} 점수 높이기`}
        >
          <Plus size={16} strokeWidth={3} />
        </Button>
      </div>
    </div>
  );
};

const MatchCard = ({
  match,
  prediction,
  submitted,
  isTeacher,
  hidden,
  bonusMultiplier,
  rewardSummary,
  onSubmit,
  onShowPredictions,
  onToggleHidden,
  onToggleBonus,
  submittingMatchId,
}) => {
  const [outcome, setOutcome] = useState(() => getInitialOutcome(match, prediction));
  const [homeScore, setHomeScore] = useState(
    Number.isFinite(Number(prediction?.homeScore)) ? String(prediction.homeScore) : "0",
  );
  const [awayScore, setAwayScore] = useState(
    Number.isFinite(Number(prediction?.awayScore)) ? String(prediction.awayScore) : "0",
  );
  const [isEditingSubmitted, setIsEditingSubmitted] = useState(false);
  const isKbo = String(match.id).startsWith("kbo_");
  const [margin, setMargin] = useState(prediction?.margin === "draw" ? "1" : prediction?.margin || "1");

  const options = outcomeOptionsFor(match);
  const open = isPredictionOpen(match);
  const isSubmitting = submittingMatchId === match.id;
  const controlsDisabled =
    !open || isSubmitting || (submitted && !isEditingSubmitted);
  const resultAvailable = hasFinalScore(match);
  const rewardFullyProcessed = Boolean(rewardSummary?.allProcessed);
  const startsAt = toDate(match?.startsAtUtc);
  const closeSoon =
    !submitted &&
    open &&
    startsAt &&
    startsAt.getTime() - PREDICTION_CLOSE_OFFSET_MS - Date.now() <=
      60 * 60 * 1000;
  const homeName = formatTeamName(match?.home?.name);
  const awayName = formatTeamName(match?.away?.name);
  const displayHomeScore = resultAvailable ? Number(match.score.home) : homeScore;
  const displayAwayScore = resultAvailable ? Number(match.score.away) : awayScore;
  const displayOutcome = resultAvailable
    ? getOutcomeFromScores(displayHomeScore, displayAwayScore)
    : outcome;
  const selectedHome = displayOutcome === "home";
  const selectedAway = displayOutcome === "away";
  const predictionScoreLabel = submitted && !isEditingSubmitted
    ? savedPredictionLabel(prediction)
    : isKbo ? (outcome ? marginLabel(outcome === "draw" ? "draw" : margin) : "VS") : `${homeScore}:${awayScore}`;
  const isHiddenFromStudents = isTeacher && hidden;
  const normalizedBonusMultiplier = normalizeBonusMultiplier(bonusMultiplier);
  const hasBonus = normalizedBonusMultiplier > 1;
  const roundLabel = getMatchRoundLabel(match);

  useEffect(() => {
    if (!isEditingSubmitted && prediction) {
      setOutcome(prediction.outcome || "home");
      setMargin(prediction.margin === "draw" ? "1" : prediction.margin || "1");
      setHomeScore(
        Number.isFinite(Number(prediction.homeScore))
          ? String(prediction.homeScore)
          : "0",
      );
      setAwayScore(
        Number.isFinite(Number(prediction.awayScore))
          ? String(prediction.awayScore)
          : "0",
      );
    }
  }, [isEditingSubmitted, prediction]);

  const submit = async () => {
    await onSubmit(match, {
      outcome,
      homeScore: Math.max(0, Number(homeScore) || 0),
      awayScore: Math.max(0, Number(awayScore) || 0),
      ...(isKbo ? { margin: outcome === "draw" ? "draw" : margin } : {}),
    });
    setIsEditingSubmitted(false);
  };

  const handleOutcomeSelect = (nextOutcome) => {
    setOutcome(nextOutcome);
    const [nextHomeScore, nextAwayScore] =
      DEFAULT_SCORE_BY_OUTCOME[nextOutcome] || DEFAULT_SCORE_BY_OUTCOME.home;
    setHomeScore(nextHomeScore);
    setAwayScore(nextAwayScore);
  };

  const handleScoreChange = (side, nextValue) => {
    const nextHomeScore = side === "home" ? nextValue : homeScore;
    const nextAwayScore = side === "away" ? nextValue : awayScore;
    const nextOutcome = getOutcomeFromScores(nextHomeScore, nextAwayScore);

    setHomeScore(nextHomeScore);
    setAwayScore(nextAwayScore);
    if (options.some((option) => option.value === nextOutcome)) {
      setOutcome(nextOutcome);
    }
  };

  return (
    <div
      className={`rounded-[22px] border p-4 shadow-[0_12px_36px_-6px_rgba(15,23,42,0.06)] transition ${
        isHiddenFromStudents
          ? "border-slate-200/70 bg-slate-50/80 opacity-60 grayscale-[0.25]"
          : "border-slate-200/90 bg-white"
      }`}
    >
      {hasBonus ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border-2 border-sky-200 bg-gradient-to-r from-cyan-300 via-sky-400 to-blue-500 px-4 py-3 text-white shadow-[0_12px_30px_-14px_rgba(14,165,233,0.65)]">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/90 text-sky-600 shadow-sm">
              <Sparkles size={19} strokeWidth={3} />
            </span>
            <div className="leading-tight">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/75">
                Special Reward
              </p>
              <p className="text-sm font-black">특별 보상 경기</p>
            </div>
          </div>
          <div className="-rotate-2 rounded-xl border-2 border-white/80 bg-white px-3.5 py-2 text-center text-blue-700 shadow-md">
            <span className="block text-[10px] font-black text-sky-500">보상</span>
            <span className="block text-2xl font-black leading-none tabular-nums text-blue-700">
              {normalizedBonusMultiplier}배
            </span>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-3 px-1 text-xs font-bold text-slate-500">
        <span className="inline-flex items-center gap-1.5 text-slate-600">
          <Clock3 size={14} />
          {formatKstTimeWithLabel(match.startsAtUtc)}
        </span>
        <div className="flex items-center gap-2">
          {resultAvailable ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-black text-blue-700 shadow-sm">
              <Trophy size={12} />
              결과 확정
            </span>
          ) : null}
          {submitted ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700 shadow-sm">
              <CheckCircle2 size={12} />
              제출 완료
            </span>
          ) : closeSoon ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-black text-rose-600 shadow-sm">
              <Clock3 size={12} />
              마감 임박
            </span>
          ) : null}
          {isTeacher && hidden ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600 shadow-sm">
              <EyeOff size={12} />
              학생 숨김
            </span>
          ) : null}
          {rewardFullyProcessed ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700 shadow-sm">
              <CheckCircle2 size={12} />
              보상 완료
            </span>
          ) : null}
          <span
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 shadow-sm"
            title={match?.round || roundLabel}
          >
            {roundLabel}
          </span>
        </div>
      </div>

      <div className="grid min-h-[96px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900">
        <div
          className={`flex flex-col items-center justify-center gap-1 px-2 py-3 sm:flex-row sm:gap-3 sm:px-4 transition ${
            selectedHome
              ? "bg-blue-50 text-blue-800"
              : "text-slate-700"
          }`}
        >
          <MatchBadge team={match.home} />
          <div className="min-w-0">
            <span className="block truncate text-base font-black">{homeName}</span>
          </div>
        </div>
        <div className="flex min-w-[84px] flex-col items-center justify-center border-x border-slate-200 bg-white px-3 text-slate-950 sm:min-w-[124px] sm:px-5">
          <span className={`mb-1 rounded-full px-2 py-0.5 text-[10px] font-black ${
            resultAvailable
              ? "bg-blue-50 text-blue-600"
              : "bg-slate-100 text-slate-500"
          }`}
          >
            {match.status === "UNCONFIRMED" ? "일정 확인 중" : match.status === "CANCELLED" ? "경기 취소" : match.status === "SUSPENDED" ? "경기 중단" : resultAvailable ? "실제 결과" : "예상"}
          </span>
          <span className={isKbo && !resultAvailable ? "text-sm font-bold text-center" : "text-4xl font-black tabular-nums tracking-normal"}>
            {isKbo && !resultAvailable ? (outcome === "draw" ? "무승부" : predictionScoreLabel) : `${displayHomeScore}:${displayAwayScore}`}
          </span>
        </div>
        <div
          className={`flex flex-col-reverse items-center justify-center gap-1 px-2 py-3 sm:flex-row sm:gap-3 sm:px-4 transition ${
            selectedAway
              ? "bg-blue-50 text-blue-800"
              : "text-slate-700"
          }`}
        >
          <div className="min-w-0">
            <span className="block truncate text-base font-black">{awayName}</span>
          </div>
          <MatchBadge team={match.away} />
        </div>
      </div>

      {resultAvailable && submitted ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-1 text-xs font-bold text-slate-500">
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 shadow-sm">
            내 예측 {predictionScoreLabel}
          </span>
          {prediction?.reward ? (
            <>
              <span className={`rounded-full px-2.5 py-1 ${
                prediction.reward.outcomeCorrect
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
              }`}
              >
                승무패 {prediction.reward.outcomeCorrect ? "적중" : "미적중"}
              </span>
              <span className={`rounded-full px-2.5 py-1 ${
                prediction.reward.exactScoreCorrect
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
              }`}
              >
                {prediction.predictionType === "margin" ? "점수 차" : "스코어"} {prediction.reward.exactScoreCorrect ? "적중" : "미적중"}
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      <div
        role="group"
        aria-label={`${homeName} 대 ${awayName} 승무패 선택`}
        className={`mt-3 grid gap-2 ${
          options.length === 2 ? "grid-cols-2" : "grid-cols-3"
        }`}
      >
        {options.map((option) => {
          const isSelected = outcome === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              disabled={controlsDisabled}
              aria-pressed={isSelected}
              onClick={() => handleOutcomeSelect(option.value)}
              className={`min-h-12 min-w-0 gap-1.5 rounded-xl border px-2 py-3 text-sm font-semibold transition focus-visible:ring-blue-500 disabled:cursor-not-allowed ${
                isSelected
                  ? "border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600 disabled:opacity-100"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-70"
              }`}
            >
              {isSelected ? <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" /> : null}
              <span>{option.label}</span>
            </Button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
        {isKbo ? (
          <div className="min-w-0 flex-1">
            {!outcome ? (
              <p className="text-sm text-slate-600">승리 팀을 선택한 뒤 점수 차를 골라 주세요.</p>
            ) : outcome === "draw" ? (
              <p className="text-sm text-slate-600">무승부는 0점 차 · 승무패 기본 보상만 지급됩니다.</p>
            ) : (
              <>
                <p className="mb-2 text-xs font-semibold text-slate-600">몇 점 차로 이길까요?</p>
                <div role="group" aria-label={`${homeName} 대 ${awayName} 점수 차 선택`} className="grid grid-cols-3 gap-2">
                  {MARGIN_OPTIONS.map((option) => (
                    <Button key={option.value} aria-pressed={margin === option.value} disabled={controlsDisabled}
                      onClick={() => setMargin(option.value)}
                      className={`min-h-11 rounded-xl border px-2 py-2 text-sm font-semibold focus-visible:ring-blue-500 ${margin === option.value ? "border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600 disabled:opacity-100" : "border-slate-200 bg-white text-slate-600"}`}>
                      {option.label}
                    </Button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">승리 팀과 점수 차를 모두 맞히면 추가 보상을 받아요.</p>
              </>
            )}
          </div>
        ) : <div className="flex items-center gap-3">
          <ScoreStepper
            label={homeName}
            value={homeScore}
            disabled={controlsDisabled}
            onChange={(nextValue) => handleScoreChange("home", nextValue)}
          />
          <span className="pb-3 text-xl font-black text-slate-400">:</span>
          <ScoreStepper
            label={awayName}
            value={awayScore}
            disabled={controlsDisabled}
            onChange={(nextValue) => handleScoreChange("away", nextValue)}
          />
        </div>}
        <div className="flex min-w-[140px] flex-1 justify-end">
          <div className="flex flex-wrap justify-end gap-2">
            {isTeacher ? (
              <>
                <Button
                  size="sm"
                  tone={hasBonus ? "indigo" : "slate"}
                  kind={hasBonus ? "soft" : "outline"}
                  icon={Sparkles}
                  onClick={() =>
                    onToggleBonus?.(
                      match,
                      getNextBonusMultiplier(normalizedBonusMultiplier),
                    )
                  }
                >
                  {hasBonus ? `${normalizedBonusMultiplier}배` : "보너스"}
                </Button>
                <Button
                  size="sm"
                  tone={hidden ? "emerald" : "slate"}
                  kind="outline"
                  icon={hidden ? Eye : EyeOff}
                  onClick={() => onToggleHidden?.(match, !hidden)}
                >
                  {hidden ? "표시" : "숨김"}
                </Button>
                <Button
                  size="sm"
                  tone="slate"
                  kind="outline"
                  icon={UsersRound}
                  onClick={() => onShowPredictions(match)}
                >
                  예측 현황
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              tone={submitted && !isEditingSubmitted ? "slate" : "indigo"}
              icon={submitted && !isEditingSubmitted ? CheckCircle2 : Trophy}
              isLoading={isSubmitting}
              disabled={!open || isSubmitting || !outcome}
              onClick={
                submitted && !isEditingSubmitted
                  ? () => setIsEditingSubmitted(true)
                  : submit
              }
            >
              {submitted && !isEditingSubmitted
                ? "예측 수정"
                : submitted
                  ? "수정 완료"
                  : "예측 제출"}
            </Button>
          </div>
        </div>
      </div>

      {submitted ? (
        <p className="mt-2 px-1 text-xs font-bold text-emerald-700">
          {isEditingSubmitted
            ? "수정 후 다시 저장해야 변경 내용이 반영됩니다."
            : "예측이 제출되었습니다. 한국시간 기준 경기 시작 10분 전까지 수정할 수 있습니다."}
        </p>
      ) : !open ? (
        <p className="mt-2 px-1 text-xs font-bold text-slate-400">
          한국시간 기준 경기 시작 10분 전 예측이 마감되었습니다.
        </p>
      ) : null}
    </div>
  );
};

const getStudentName = (student, fallbackUid) =>
  student?.name ||
  student?.displayName ||
  student?.studentName ||
  student?.nickname ||
  fallbackUid ||
  "이름 없음";

const PredictionListModal = ({
  match,
  predictions,
  studentMap,
  onCancelPredictions,
  isCancelingPredictions = false,
  onClose,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const homeName = formatTeamName(match?.home?.name);
  const awayName = formatTeamName(match?.away?.name);
  const sortedPredictions = [...predictions].sort((left, right) => {
    const leftStudent = studentMap[left.studentUid] || {};
    const rightStudent = studentMap[right.studentUid] || {};
    const leftNumber = Number(leftStudent.studentNumber || 9999);
    const rightNumber = Number(rightStudent.studentNumber || 9999);
    if (leftNumber !== rightNumber) return leftNumber - rightNumber;
    return getStudentName(leftStudent, left.studentUid).localeCompare(
      getStudentName(rightStudent, right.studentUid),
      "ko",
    );
  });
  const [selectedPredictionIds, setSelectedPredictionIds] = useState(() => new Set());
  const cancellablePredictionIds = useMemo(
    () =>
      new Set(
        sortedPredictions
          .filter(
            (prediction) =>
              !["paid", "no_reward"].includes(getPredictionRewardStatus(prediction)),
          )
          .map((prediction) => prediction.id)
          .filter(Boolean),
      ),
    [sortedPredictions],
  );
  const selectedPredictions = sortedPredictions.filter((prediction) =>
    selectedPredictionIds.has(prediction.id),
  );
  const allCancellableSelected =
    cancellablePredictionIds.size > 0 &&
    selectedPredictionIds.size === cancellablePredictionIds.size;

  useEffect(() => {
    setSelectedPredictionIds((prev) => {
      const next = new Set(
        [...prev].filter((predictionId) => cancellablePredictionIds.has(predictionId)),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [cancellablePredictionIds]);

  const togglePredictionSelection = (predictionId) => {
    if (!cancellablePredictionIds.has(predictionId)) return;
    setSelectedPredictionIds((prev) => {
      const next = new Set(prev);
      if (next.has(predictionId)) {
        next.delete(predictionId);
      } else {
        next.add(predictionId);
      }
      return next;
    });
  };

  const toggleAllCancellable = () => {
    setSelectedPredictionIds(
      allCancellableSelected ? new Set() : new Set(cancellablePredictionIds),
    );
  };

  const handleCancelSelected = async () => {
    await onCancelPredictions?.(selectedPredictions);
    setSelectedPredictionIds(new Set());
  };

  if (!match) return null;

  return (
    <Modal isOpen={true} onClose={onClose} size="lg">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <UsersRound size={22} />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-900">예측 현황</h3>
            <p className="mt-1 text-sm font-bold text-slate-500">
              {homeName} vs {awayName}
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body className="bg-slate-50">
        {cancellablePredictionIds.size > 0 ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-black text-slate-700">
              <input
                type="checkbox"
                checked={allCancellableSelected}
                onChange={toggleAllCancellable}
                disabled={isCancelingPredictions}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              선택 가능 예측 전체 선택
            </label>
            <Button
              size="sm"
              tone="red"
              kind="soft"
              icon={Trash2}
              disabled={selectedPredictionIds.size === 0}
              isLoading={isCancelingPredictions}
              onClick={handleCancelSelected}
            >
              선택 예측 {selectedPredictionIds.size}개 취소
            </Button>
          </div>
        ) : null}
        {sortedPredictions.length > 0 ? (
          <div className="space-y-2">
            {sortedPredictions.map((prediction) => {
              const student = studentMap[prediction.studentUid] || {};
              const name = getStudentName(student, prediction.studentUid);
              const tone = getPredictionRewardTone(prediction);
              const nameClass =
                tone === "score"
                  ? "text-emerald-700"
                  : tone === "outcome"
                    ? "text-teal-700"
                    : tone === "miss"
                      ? "text-slate-500"
                      : "text-slate-900";
              const reward = prediction.reward || {};
              const canCancelPrediction = cancellablePredictionIds.has(prediction.id);
              const isSelected = selectedPredictionIds.has(prediction.id);
              const outcomeLabel =
                prediction.outcome === "home"
                  ? `${homeName} 승`
                  : prediction.outcome === "away"
                    ? `${awayName} 승`
                    : "무승부";

              return (
                <div
                  key={prediction.id || `${prediction.studentUid}_${prediction.matchId}`}
                  className={`rounded-2xl border bg-white p-3 shadow-sm ${
                    tone === "score"
                      ? "border-emerald-200 ring-1 ring-emerald-100"
                      : tone === "outcome"
                        ? "border-teal-200 ring-1 ring-teal-100"
                        : "border-slate-200"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!canCancelPrediction || isCancelingPredictions}
                        onChange={() => togglePredictionSelection(prediction.id)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-30"
                        aria-label={`${name} 예측 선택`}
                      />
                      <div className="min-w-0">
                      <p className={`truncate text-sm font-black ${nameClass}`}>
                        {student.studentNumber ? `${student.studentNumber}. ` : ""}
                        {name}
                      </p>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        {outcomeLabel} · {savedPredictionLabel(prediction)}
                      </p>
                    </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5 text-[11px] font-black">
                      {reward.status === "paid" || prediction.rewardStatus === "paid" ? (
                        <>
                          <span
                            className={`rounded-full px-2.5 py-1 ${
                              reward.outcomeCorrect
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            승무패 {reward.outcomeCorrect ? "적중" : "미적중"}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 ${
                              reward.exactScoreCorrect
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {prediction.predictionType === "margin" ? "점수 차" : "스코어"} {reward.exactScoreCorrect ? "적중" : "미적중"}
                          </span>
                          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
                            {formatDisplayMoney(Number(reward.totalRewardAmount || 0))} 지급
                          </span>
                        </>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">
                          예측 결과 전
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-3xl bg-white text-center">
            <UsersRound size={28} className="text-slate-300" />
            <p className="mt-3 text-sm font-black text-slate-700">
              아직 제출된 예측이 없습니다.
            </p>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button tone="slate" kind="ghost" onClick={onClose}>
          닫기
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

const groupMatchesByDate = (matches) =>
  matches.reduce((acc, match) => {
    const key = formatKstDateKey(match.startsAtUtc);
    if (!acc[key]) acc[key] = [];
    acc[key].push(match);
    return acc;
  }, {});

const MatchPredictionModal = ({
  isOpen,
  onClose,
  classId,
  userId,
  isTeacher,
  matches = [],
  predictions = [],
  allPredictions = [],
  rewardRuns = [],
  students = [],
  summaryMeta = {},
  hiddenMatchIds = [],
  bonusMultipliers = {},
  onToggleMatchHidden,
  onSetMatchBonus,
  isLoading = false,
}) => {
  const { showFeedback } = useFeedback();
  const [activeTab, setActiveTab] = useState("week");
  const [activeAllWeekKey, setActiveAllWeekKey] = useState("");
  const [activeDateKey, setActiveDateKey] = useState("");
  const [predictionListMatch, setPredictionListMatch] = useState(null);
  const [submittingMatchId, setSubmittingMatchId] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isProcessingPendingRewards, setIsProcessingPendingRewards] = useState(false);
  const [isCancelingPredictions, setIsCancelingPredictions] = useState(false);
  const [submittedMatchIds, setSubmittedMatchIds] = useState(() => new Set());
  const dateTabRefs = useRef({});
  const weekTabRefs = useRef({});
  const lastSyncedAtLabel = formatKstDateTimeLabel(summaryMeta?.updatedAt);
  const syncSourceLabel = summaryMeta?.updatedAt
    ? getSyncSourceLabel(summaryMeta?.triggeredBy)
    : "";

  const predictionMap = useMemo(() => buildPredictionMap(predictions), [predictions]);
  const hiddenMatchSet = useMemo(
    () => new Set(Array.isArray(hiddenMatchIds) ? hiddenMatchIds : []),
    [hiddenMatchIds],
  );
  const normalizedBonusMultipliers = useMemo(
    () =>
      Object.entries(bonusMultipliers || {}).reduce((acc, [matchId, multiplier]) => {
        const normalized = normalizeBonusMultiplier(multiplier);
        if (normalized > 1) acc[matchId] = normalized;
        return acc;
      }, {}),
    [bonusMultipliers],
  );
  const studentMap = useMemo(() => buildStudentMap(students), [students]);
  const rewardRunMap = useMemo(() => buildRewardRunMap(rewardRuns), [rewardRuns]);
  const allPredictionsByMatch = useMemo(
    () =>
      allPredictions.reduce((acc, prediction) => {
        if (!prediction?.matchId) return acc;
        if (!acc[prediction.matchId]) acc[prediction.matchId] = [];
        acc[prediction.matchId].push(prediction);
        return acc;
      }, {}),
    [allPredictions],
  );
  const rewardSummariesByMatch = useMemo(
    () =>
      matches.reduce((acc, match) => {
        const matchPredictions = allPredictionsByMatch[match.id] || [];
        acc[match.id] = buildMatchRewardSummary(
          matchPredictions,
          rewardRunMap[match.id],
        );
        return acc;
      }, {}),
    [allPredictionsByMatch, matches, rewardRunMap],
  );
  const visibleTabs = useMemo(
    () => (isTeacher ? TABS : TABS.filter((tab) => tab.id === "week")),
    [isTeacher],
  );
  const allWeekOptions = useMemo(() => {
    const weeks = new Map();

    matches.forEach((match) => {
      const weekMeta = getKstWeekMeta(match.startsAtUtc);
      const previous = weeks.get(weekMeta.key);
      weeks.set(weekMeta.key, {
        ...weekMeta,
        count: (previous?.count || 0) + 1,
      });
    });

    return Array.from(weeks.values()).sort((left, right) =>
      left.key.localeCompare(right.key),
    );
  }, [matches]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("week");
    }
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    if (activeTab !== "all" || allWeekOptions.length === 0) return;
    if (!allWeekOptions.some((week) => week.key === activeAllWeekKey)) {
      const todayWeekKey = getKstWeekMeta(new Date()).key;
      const preferredWeek =
        allWeekOptions.find((week) => week.key === todayWeekKey) ||
        allWeekOptions[0];
      setActiveAllWeekKey(preferredWeek.key);
      setActiveDateKey("");
    }
  }, [activeAllWeekKey, activeTab, allWeekOptions]);

  const baseFilteredMatches = useMemo(() => {
    if (!isTeacher) {
      const { start, end } = getWeekRange();
      return matches.filter((match) => {
        if (hiddenMatchSet.has(match.id)) return false;
        const date = toDate(match.startsAtUtc);
        if (!date) return false;
        const kstDate = new Date(
          date.toLocaleString("en-US", { timeZone: KOREA_TZ }),
        );
        return kstDate >= start && kstDate < end;
      });
    }
    if (activeTab === "mine") {
      return matches.filter((match) => predictionMap[match.id]);
    }
    if (activeTab === "week") {
      const { start, end } = getWeekRange();
      return matches.filter((match) => {
        const date = toDate(match.startsAtUtc);
        if (!date) return false;
        const kstDate = new Date(
          date.toLocaleString("en-US", { timeZone: KOREA_TZ }),
        );
        return kstDate >= start && kstDate < end;
      });
    }
    if (activeTab === "all" && activeAllWeekKey) {
      return matches.filter(
        (match) => getKstWeekMeta(match.startsAtUtc).key === activeAllWeekKey,
      );
    }
    return matches;
  }, [activeAllWeekKey, activeTab, hiddenMatchSet, isTeacher, matches, predictionMap]);

  const dateOptions = useMemo(() => {
    const dates = new Map();

    baseFilteredMatches.forEach((match) => {
      const key = formatKstDateKey(match.startsAtUtc);
      const previous = dates.get(key);
      dates.set(key, {
        key,
        label: formatKstDateLabel(match.startsAtUtc),
        count: (previous?.count || 0) + 1,
      });
    });

    return Array.from(dates.values()).sort((left, right) =>
      left.key.localeCompare(right.key),
    );
  }, [baseFilteredMatches]);

  useEffect(() => {
    if (dateOptions.length === 0) {
      setActiveDateKey("");
      return;
    }
    if (!dateOptions.some((date) => date.key === activeDateKey)) {
      const todayKey = getTodayKstDateKey();
      const preferredDate =
        dateOptions.find((date) => date.key === todayKey) ||
        dateOptions[0];
      setActiveDateKey(preferredDate.key);
    }
  }, [activeDateKey, dateOptions]);

  useEffect(() => {
    const selectedDateTab = dateTabRefs.current[activeDateKey];
    if (!selectedDateTab) return undefined;

    const frameId = window.requestAnimationFrame(() => {
      selectedDateTab.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeDateKey]);

  useEffect(() => {
    const selectedWeekTab = weekTabRefs.current[activeAllWeekKey];
    if (!selectedWeekTab) return undefined;

    const frameId = window.requestAnimationFrame(() => {
      selectedWeekTab.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeAllWeekKey]);

  const filteredMatches = useMemo(() => {
    if (!activeDateKey) return baseFilteredMatches;
    return baseFilteredMatches.filter(
      (match) => formatKstDateKey(match.startsAtUtc) === activeDateKey,
    );
  }, [activeDateKey, baseFilteredMatches]);
  const groupedMatches = useMemo(
    () => groupMatchesByDate(filteredMatches),
    [filteredMatches],
  );
  const groupedEntries = Object.entries(groupedMatches).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const pendingRewardMatches = useMemo(
    () =>
      matches.filter(
        (match) =>
          isRewardRunManagedMatch(match) &&
          hasFinalScore(match) &&
          rewardRunMap[match.id]?.status !== "processed",
      ),
    [matches, rewardRunMap],
  );
  const pendingRewardMatchCount = pendingRewardMatches.length;

  const handleSubmit = async (match, draft) => {
    try {
      setSubmittingMatchId(match.id);
      await saveMatchPrediction(classId, userId, match, draft);
      setSubmittedMatchIds((prev) => {
        const next = new Set(prev);
        next.add(match.id);
        return next;
      });
      showFeedback("경기 예측을 저장했습니다.", "success");
    } catch (error) {
      console.error("[matchPrediction] save failed:", error);
      showFeedback(error?.message || "예측 저장 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmittingMatchId(null);
    }
  };

  const handleCancelPredictions = async (selectedPredictions) => {
    if (!selectedPredictions?.length) return;

    const confirmed = (await appConfirm(
      `선택한 ${selectedPredictions.length}명의 예측 제출을 취소할까요?`,
    ));
    if (!confirmed) return;

    try {
      setIsCancelingPredictions(true);
      const result = await cancelMatchPredictions(classId, selectedPredictions);
      showFeedback(`${result?.count || selectedPredictions.length}명의 예측을 취소했습니다.`, "success");
    } catch (error) {
      console.error("[matchPrediction] cancel predictions failed:", error);
      showFeedback(error?.message || "예측 취소 중 오류가 발생했습니다.", "error");
    } finally {
      setIsCancelingPredictions(false);
    }
  };

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      const result = await syncWorldCupMatches();
      showFeedback(
        `최신 일정과 경기 결과 ${result?.count || 0}개를 가져왔습니다.`,
        "success",
      );
    } catch (error) {
      console.error("[matchPrediction] sync failed:", error);
      showFeedback(
        ["functions/internal", "functions/unavailable", "functions/not-found"].includes(error?.code)
          ? "일정 서버에 연결하지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 함수 배포 상태를 확인해 주세요."
          : error?.message || "최신 일정 가져오기 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const handleProcessPendingRewards = async () => {
    try {
      setIsProcessingPendingRewards(true);
      let processedMatches = 0;
      let paidCount = 0;
      let totalPaidAmount = 0;

      for (const match of pendingRewardMatches) {
        const result = await processMatchPredictionRewards(classId, match.id);
        processedMatches += 1;
        paidCount += Number(result?.paidCount || 0);
        totalPaidAmount += Number(result?.totalPaidAmount || 0);
      }

      showFeedback(
        `미처리 보상 처리 완료: ${processedMatches}경기, ${paidCount}명, 총 ${totalPaidAmount} 지급`,
        "success",
      );
    } catch (error) {
      console.error("[matchPrediction] pending reward failed:", error);
      showFeedback(
        error?.message || "미처리 보상 처리 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsProcessingPendingRewards(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <Modal.Header className="border-b border-blue-100 bg-blue-50/70 text-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white px-3 py-1 text-xs font-semibold text-blue-700">
              <CalendarDays size={14} />
              KBO 야구 승부 예측
            </div>
            <h3 className="text-2xl font-black tracking-tight">경기 예측</h3>
            <p className="mt-1 text-sm font-medium text-slate-600">
              한국시간 기준 경기 시작 10분 전까지 제출하고 수정할 수 있습니다.
            </p>
          </div>
          {isTeacher ? (
            <div className="w-full sm:w-auto">
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Button size="sm"
                    tone="blue"
                    kind="soft"
                    icon={RefreshCw}
                    isLoading={isSyncing}
                    onClick={handleSync}
                    className="w-full sm:w-auto"
                  >
                    최신 일정 가져오기
                  </Button>
                  {lastSyncedAtLabel ? (
                    <div className="max-w-[260px] truncate px-1 py-1 text-[11px] font-medium leading-none text-slate-500 sm:text-right">
                      마지막 갱신 {lastSyncedAtLabel} · {syncSourceLabel}
                    </div>
                  ) : null}
                </div>
                <Button size="sm"
                  tone="emerald"
                  kind="soft"
                  icon={Trophy}
                  isLoading={isProcessingPendingRewards}
                  disabled={pendingRewardMatchCount === 0}
                  onClick={handleProcessPendingRewards}
                  className="w-full sm:w-auto"
                >
                  미처리 보상 {pendingRewardMatchCount}경기 처리
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Modal.Header>

      <Modal.Body className="bg-[#eef2f7]">
        {(summaryMeta?.syncStatus === "error" || (summaryMeta?.updatedAt && Date.now() - toDate(summaryMeta.updatedAt)?.getTime() > 36 * 3600000)) && (
          <p role="status" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {summaryMeta.lastError || "일정 갱신이 지연되고 있습니다. 오래된 일정은 예측할 수 없습니다."}
            {isTeacher ? " 최신 일정 가져오기로 다시 시도할 수 있습니다." : " 선생님께 일정 갱신을 요청해 주세요."}
          </p>
        )}
        {isTeacher ? (
          <div className="mb-5 space-y-3">
            <div className="inline-flex flex-wrap gap-1 rounded-2xl bg-slate-100 p-1 shadow-inner">
              {visibleTabs.map((tab) => (
                <Button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setActiveDateKey("");
                  }}
                  className={`rounded-xl px-4 py-2 text-sm font-black transition ${
                    activeTab === tab.id
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:bg-white/60 hover:text-slate-800"
                  }`}
                >
                  {tab.label}
                </Button>
              ))}
            </div>

            {activeTab === "all" && allWeekOptions.length > 0 ? (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {allWeekOptions.map((week) => {
                  const selected = activeAllWeekKey === week.key;

                  return (
                    <Button
                      key={week.key}
                      ref={(node) => {
                        if (node) weekTabRefs.current[week.key] = node;
                      }}
                      type="button"
                      onClick={() => {
                        setActiveAllWeekKey(week.key);
                        setActiveDateKey("");
                      }}
                      className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-black transition ${
                        selected
                          ? "border-indigo-300 bg-indigo-600 text-white shadow-sm shadow-indigo-200"
                          : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600"
                      }`}
                    >
                      {week.label}
                      <span
                        className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                          selected
                            ? "bg-white/20 text-white"
                            : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {week.count}
                      </span>
                    </Button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mb-5 inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 shadow-sm">
            앞으로 30일 경기 일정
          </div>
        )}

        {dateOptions.length > 1 ? (
          <div className="mb-5 -mt-2 flex gap-2 overflow-x-auto pb-1">
            {dateOptions.map((date) => {
              const selected = activeDateKey === date.key;

              return (
                <Button
                  key={date.key}
                  ref={(node) => {
                    if (node) dateTabRefs.current[date.key] = node;
                  }}
                  type="button"
                  onClick={() => setActiveDateKey(date.key)}
                  className={`shrink-0 rounded-2xl border px-3.5 py-2 text-xs font-black transition ${
                    selected
                      ? "border-sky-300 bg-white text-sky-700 shadow-sm ring-2 ring-sky-100"
                      : "border-slate-200 bg-white/70 text-slate-500 hover:border-sky-200 hover:text-sky-600"
                  }`}
                >
                  {date.label}
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                      selected
                        ? "bg-sky-50 text-sky-600"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {date.count}
                  </span>
                </Button>
              );
            })}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex min-h-[280px] items-center justify-center rounded-3xl bg-white">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
              <Spinner size="sm" />
              경기 일정을 불러오는 중입니다.
            </div>
          </div>
        ) : groupedEntries.length > 0 ? (
          <div className="space-y-5">
            {groupedEntries.map(([dateKey, dateMatches]) => (
              <section key={dateKey} className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <div className="h-px flex-1 bg-slate-300/70" />
                  <h4 className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-black text-slate-800 shadow-sm">
                    <CalendarDays size={15} className="text-indigo-500" />
                    {formatKstDateLabel(dateMatches[0]?.startsAtUtc)}
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-500">
                      한국시간
                    </span>
                  </h4>
                  <div className="h-px flex-1 bg-slate-300/70" />
                </div>
                <div className="grid gap-3">
                  {dateMatches.map((match) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      prediction={predictionMap[match.id]}
                      submitted={
                        Boolean(predictionMap[match.id]) ||
                        submittedMatchIds.has(match.id)
                      }
                      isTeacher={isTeacher}
                      hidden={hiddenMatchSet.has(match.id)}
                      bonusMultiplier={normalizedBonusMultipliers[match.id] || 1}
                      rewardSummary={rewardSummariesByMatch[match.id]}
                      submittingMatchId={submittingMatchId}
                      onSubmit={handleSubmit}
                      onShowPredictions={setPredictionListMatch}
                      onToggleHidden={(targetMatch, nextHidden) =>
                        onToggleMatchHidden?.(targetMatch.id, nextHidden)
                      }
                      onToggleBonus={(targetMatch, nextMultiplier) =>
                        onSetMatchBonus?.(targetMatch.id, nextMultiplier)
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[280px] flex-col items-center justify-center rounded-3xl bg-white p-8 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-100 text-slate-500">
              <Cloud size={26} />
            </div>
            <h4 className="text-lg font-black text-slate-800">
              표시할 경기가 없습니다.
            </h4>
            <p className="mt-2 max-w-md text-sm font-semibold leading-6 text-slate-500">
              앞으로 30일의 일정과 경기 결과가 매일 새벽 4시에 갱신됩니다. 선생님이 최신 일정 가져오기로 직접 갱신할 수도 있습니다.
            </p>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer className="bg-white">
        <Button tone="slate" kind="ghost" onClick={onClose}>
          닫기
        </Button>
      </Modal.Footer>

      {predictionListMatch ? (
        <PredictionListModal
          match={predictionListMatch}
          predictions={allPredictionsByMatch[predictionListMatch.id] || []}
          studentMap={studentMap}
          onCancelPredictions={handleCancelPredictions}
          isCancelingPredictions={isCancelingPredictions}
          onClose={() => setPredictionListMatch(null)}
        />
      ) : null}
    </Modal>
  );
};

export default MatchPredictionModal;
