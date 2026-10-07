"use strict";

const admin = require("../firebaseAdminCompat");
const { FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { KBO_SUMMARY_DOC } = require("../utils/kboMatches");
const { syncKbo } = require("../utils/kboSync");
const { validateMargin, isBonusCorrect } = require("../utils/predictionMargin");
const {
    assertTeacherOrAdminFromClaims,
    getAuthContext,
} = require("../utils/permissions");
const { stageActivityLog } = require("../utils/logUtils");

const db = admin.firestore();

const footballDataToken = defineSecret("FOOTBALL_DATA_TOKEN");
const WORLD_CUP_SEASON = "2026";
const WORLD_CUP_SUMMARY_DOC = "sportsMatchSummary/worldcup_2026";
const WORLD_CUP_EXPECTED_MATCH_COUNT = 104;
const WORLD_CUP_FINAL_MATCH_ID = "worldcup_2026_final";
const WORLD_CUP_FINAL_FALLBACK = {
    id: WORLD_CUP_FINAL_MATCH_ID,
    source: "manual-schedule",
    sourceId: null,
    league: "FIFA World Cup",
    season: WORLD_CUP_SEASON,
    round: "FINAL",
    group: null,
    status: "SCHEDULED",
    postponed: false,
    startsAtUtc: "2026-07-19T19:00:00Z",
    dateEvent: "2026-07-19",
    home: {
        id: "760",
        name: "Spain",
        badge: "https://crests.football-data.org/760.svg",
    },
    away: {
        id: "762",
        name: "Argentina",
        badge: "https://crests.football-data.org/762.png",
    },
    score: { home: null, away: null },
    venue: null,
    country: null,
    city: null,
};
const MATCH_REWARD_RUNS_COLLECTION = "matchRewardRuns";
const MATCH_REWARD_RUN_ROLLOUT_START_UTC = "2026-06-15T15:00:00.000Z";
const PREDICTION_CLOSE_OFFSET_MS = 10 * 60 * 1000;
const DEFAULT_OUTCOME_REWARD_AMOUNT = 100;
const DEFAULT_EXACT_SCORE_REWARD_AMOUNT = 300;
const FINAL_MATCH_STATUSES = new Set(["FINISHED", "AWARDED"]);
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

const formatTeamNameKo = (name, fallback = "-") =>
    TEAM_NAME_KO[name] || name || fallback;

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const toNumberOrNull = (value) => {
    if (value == null || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

const normalizeFootballDataMatch = (match = {}) => {
    const sourceId = String(match.id || "").trim();

    return {
        id: sourceId ? `football-data_${sourceId}` : "",
        source: "football-data",
        sourceId,
        league: match.competition?.name || "FIFA World Cup",
        season: String(match.season?.startDate || WORLD_CUP_SEASON).slice(0, 4),
        round: match.stage || match.group || null,
        group: match.group || null,
        status: match.status || null,
        postponed: match.status === "POSTPONED",
        startsAtUtc: match.utcDate || null,
        dateEvent: match.utcDate ? String(match.utcDate).slice(0, 10) : null,
        home: {
            id: match.homeTeam?.id ? String(match.homeTeam.id) : null,
            name: match.homeTeam?.name || "",
            badge: match.homeTeam?.crest || null,
        },
        away: {
            id: match.awayTeam?.id ? String(match.awayTeam.id) : null,
            name: match.awayTeam?.name || "",
            badge: match.awayTeam?.crest || null,
        },
        score: {
            home: toNumberOrNull(match.score?.fullTime?.home),
            away: toNumberOrNull(match.score?.fullTime?.away),
        },
        venue: null,
        country: null,
        city: null,
    };
};

const fetchFootballDataWorldCupMatches = async () => {
    const token = footballDataToken.value();

    if (!token) {
        throw new Error("FOOTBALL_DATA_TOKEN is not configured.");
    }

    const url =
        "https://api.football-data.org/v4/competitions/WC/matches" +
        `?season=${WORLD_CUP_SEASON}`;
    let response = null;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            response = await fetch(url, {
                headers: {
                    "X-Auth-Token": token,
                },
            });
            if (response.ok || response.status < 500) {
                break;
            }
            lastError = new Error(`football-data.org request failed: ${response.status}`);
        } catch (error) {
            lastError = error;
        }

        if (attempt < 3) {
            await sleep(1000 * attempt);
        }
    }

    if (!response) {
        throw lastError || new Error("football-data.org request failed.");
    }

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`football-data.org request failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    const matches = Array.isArray(data?.matches) ? data.matches : [];

    return matches
        .map(normalizeFootballDataMatch)
        .filter((match) => match.id && match.home.name && match.away.name)
        .sort((left, right) =>
            String(left.startsAtUtc || "").localeCompare(String(right.startsAtUtc || "")),
        );
};

const isWorldCupFinal = (match) => String(match?.round || "").toUpperCase() === "FINAL";

// Keep a stable ID for predictions made before the data provider publishes the
// final. When its match later arrives, its live score replaces this fallback.
const ensureWorldCupFinalMatch = (matches = []) => {
    const sourceMatches = Array.isArray(matches) ? matches : [];
    const sourceFinal = sourceMatches.find(isWorldCupFinal);
    const matchesWithoutFinal = sourceMatches.filter((match) => !isWorldCupFinal(match));
    const finalMatch = sourceFinal
        ? {
            ...sourceFinal,
            id: WORLD_CUP_FINAL_MATCH_ID,
            sourceId: sourceFinal.sourceId || sourceFinal.id || null,
        }
        : WORLD_CUP_FINAL_FALLBACK;

    return [...matchesWithoutFinal, finalMatch].sort((left, right) =>
        String(left.startsAtUtc || "").localeCompare(String(right.startsAtUtc || "")),
    );
};

const hasResultUpdate = (match) => {
    const homeScore = toNumberOrNull(match?.score?.home);
    const awayScore = toNumberOrNull(match?.score?.away);
    return isMatchFinal(match) || (homeScore != null && awayScore != null);
};

const mergeWorldCupResults = (storedMatches = [], apiMatches = []) => {
    const resultsByMatchId = new Map(
        apiMatches
            .filter((match) => match?.id && hasResultUpdate(match))
            .map((match) => [match.id, match]),
    );

    return storedMatches.map((storedMatch) => {
        const apiMatch = resultsByMatchId.get(storedMatch?.id);
        if (!apiMatch) return storedMatch;

        return {
            ...storedMatch,
            source: apiMatch.source || storedMatch.source,
            sourceId: apiMatch.sourceId || storedMatch.sourceId,
            status: apiMatch.status || storedMatch.status,
            postponed: Boolean(apiMatch.postponed),
            score: apiMatch.score || storedMatch.score,
        };
    });
};

const parseScore = (value, fieldName) => {
    const score = Number(value);
    if (!Number.isInteger(score) || score < 0 || score > 99) {
        throw new HttpsError("invalid-argument", `${fieldName} must be 0-99.`);
    }
    return score;
};

const getMatchType = (match) => {
    const round = String(match?.round || "").toLowerCase();
    if (
        round.includes("knockout") ||
        round.includes("round_of") ||
        round.includes("last_") ||
        round.includes("quarter") ||
        round.includes("semi") ||
        round.includes("final")
    ) {
        return "knockout";
    }
    return "group";
};

const getPredictionCloseTime = (match) => {
    const startsAt = new Date(match?.startsAtUtc || "");
    if (Number.isNaN(startsAt.getTime())) {
        throw new HttpsError("failed-precondition", "Match start time is not available.");
    }
    return new Date(startsAt.getTime() - PREDICTION_CLOSE_OFFSET_MS);
};

const readWorldCupMatch = async (matchId) => {
    const summarySnap = await db.doc(String(matchId).startsWith("kbo_") ? KBO_SUMMARY_DOC : WORLD_CUP_SUMMARY_DOC).get();
    if (!summarySnap.exists) {
        throw new HttpsError("failed-precondition", "World Cup schedule is not synced yet.");
    }

    const matches = Array.isArray(summarySnap.data()?.matches)
        ? summarySnap.data().matches
        : [];
    const match = matches.find((item) => item?.id === matchId);

    if (!match) {
        throw new HttpsError("not-found", "Match was not found.");
    }

    return match;
};

const getMatchOutcome = (homeScore, awayScore) => {
    if (homeScore > awayScore) return "home";
    if (homeScore < awayScore) return "away";
    return "draw";
};

const isMatchFinal = (match) =>
    FINAL_MATCH_STATUSES.has(String(match?.status || "").toUpperCase());

const isRewardRunManagedMatch = (match) => {
    const startsAt = new Date(match?.startsAtUtc || "");
    if (Number.isNaN(startsAt.getTime())) return false;
    return startsAt.getTime() >= new Date(MATCH_REWARD_RUN_ROLLOUT_START_UTC).getTime();
};

const getFinalMatchResult = (match) => {
    const homeScore = toNumberOrNull(match?.score?.home);
    const awayScore = toNumberOrNull(match?.score?.away);

    if (!isMatchFinal(match) || homeScore == null || awayScore == null) {
        throw new HttpsError(
            "failed-precondition",
            "Match result is not available yet.",
        );
    }

    return {
        homeScore,
        awayScore,
        outcome: getMatchOutcome(homeScore, awayScore),
        status: match.status || null,
    };
};

const normalizeRewardAmount = (value, fallback) => {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
        return fallback;
    }
    return Math.floor(amount);
};

const normalizeRewardMultiplier = (value) => {
    const multiplier = Number(value);
    if (!Number.isFinite(multiplier) || multiplier <= 1) {
        return 1;
    }
    return Math.min(10, Math.round(multiplier * 10) / 10);
};

const readMatchPredictionRewardConfig = async (
    classId,
    {
        outcomeRewardAmount,
        exactScoreRewardAmount,
    } = {},
) => {
    const configSnap = await db.doc(`classes/${classId}/arcade/config`).get();
    const matchPredictionConfig =
        configSnap.exists ? configSnap.data()?.games?.matchPrediction || {} : {};

    return {
        rewardEnabled: matchPredictionConfig.rewardEnabled !== false,
        autoPayoutEnabled: matchPredictionConfig.autoPayoutEnabled !== false,
        bonusMultipliers:
            matchPredictionConfig.bonusMultipliers &&
                typeof matchPredictionConfig.bonusMultipliers === "object"
                ? matchPredictionConfig.bonusMultipliers
                : {},
        outcomeRewardAmount: normalizeRewardAmount(
            outcomeRewardAmount ?? matchPredictionConfig.outcomeRewardAmount,
            DEFAULT_OUTCOME_REWARD_AMOUNT,
        ),
        exactScoreRewardAmount: normalizeRewardAmount(
            exactScoreRewardAmount ?? matchPredictionConfig.exactScoreRewardAmount,
            DEFAULT_EXACT_SCORE_REWARD_AMOUNT,
        ),
    };
};

const buildRewardDescription = (match, rewardBreakdown) => {
    const homeName = formatTeamNameKo(match?.home?.name, "홈팀");
    const awayName = formatTeamNameKo(match?.away?.name, "원정팀");
    const labels = [];
    if (rewardBreakdown.outcomeRewardAmount > 0) labels.push("승무패");
    if (rewardBreakdown.exactScoreRewardAmount > 0) labels.push(rewardBreakdown.predictionType === "margin" ? "점수 차" : "스코어");
    const multiplier = normalizeRewardMultiplier(rewardBreakdown.rewardMultiplier);
    const multiplierLabel = multiplier > 1 ? `, 특별 보상 ${multiplier}배` : "";
    return `경기 예측 보상 (${homeName} vs ${awayName}, ${labels.join(" + ")}${multiplierLabel})`;
};

const getMatchRewardRunRef = (classId, matchId) =>
    db.doc(`classes/${classId}/arcade/config/${MATCH_REWARD_RUNS_COLLECTION}/${matchId}`);

const isProcessedRewardStatus = (status) =>
    ["paid", "no_reward"].includes(String(status || ""));

const buildMatchRewardRunPayload = ({
    classId,
    match,
    actorUid,
    rewardConfig,
    rewardMultiplier,
    result,
    counters,
    predictionCount = 0,
    status = "processed",
    reason = null,
}) => ({
    classId,
    matchId: match.id,
    status,
    reason,
    source: match.source || null,
    sourceId: match.sourceId || match.id,
    matchStartsAtUtc: match.startsAtUtc || null,
    homeTeamName: match.home?.name || "",
    awayTeamName: match.away?.name || "",
    actualResult: result
        ? {
            homeScore: result.homeScore,
            awayScore: result.awayScore,
            outcome: result.outcome,
            status: result.status,
        }
        : null,
    rewardConfig: {
        rewardEnabled: rewardConfig?.rewardEnabled !== false,
        outcomeRewardAmount: Number(rewardConfig?.outcomeRewardAmount || 0),
        exactScoreRewardAmount: Number(rewardConfig?.exactScoreRewardAmount || 0),
    },
    rewardMultiplier: normalizeRewardMultiplier(rewardMultiplier),
    predictionCount,
    evaluatedCount: Number(counters?.evaluatedCount || 0),
    alreadyPaidCount: Number(counters?.alreadyPaidCount || 0),
    alreadyProcessedCount: Number(counters?.alreadyProcessedCount || 0),
    paidCount: Number(counters?.paidCount || 0),
    noRewardCount: Number(counters?.noRewardCount || 0),
    outcomeCorrectCount: Number(counters?.outcomeCorrectCount || 0),
    exactScoreCorrectCount: Number(counters?.exactScoreCorrectCount || 0),
    totalPaidAmount: Number(counters?.totalPaidAmount || 0),
    processedBy: actorUid,
    processedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
});

const processMatchPredictionRewardsCore = async ({
    classId,
    match,
    actorUid = "system",
    outcomeRewardAmount,
    exactScoreRewardAmount,
    requireAutoPayout = false,
    dryRun = false,
} = {}) => {
    if (!classId || !match?.id) {
        throw new HttpsError("invalid-argument", "classId and match are required.");
    }

    const result = getFinalMatchResult(match);
    const rewardConfig = await readMatchPredictionRewardConfig(classId, {
        outcomeRewardAmount,
        exactScoreRewardAmount,
    });
    const rewardMultiplier = normalizeRewardMultiplier(
        rewardConfig.bonusMultipliers?.[match.id],
    );

    if (!rewardConfig.rewardEnabled) {
        return {
            ok: true,
            skipped: true,
            reason: "reward_disabled",
            classId,
            matchId: match.id,
            evaluatedCount: 0,
            paidCount: 0,
            totalPaidAmount: 0,
        };
    }

    if (requireAutoPayout && !rewardConfig.autoPayoutEnabled) {
        return {
            ok: true,
            skipped: true,
            reason: "auto_payout_disabled",
            classId,
            matchId: match.id,
            evaluatedCount: 0,
            paidCount: 0,
            totalPaidAmount: 0,
        };
    }

    const predictionsPath = `classes/${classId}/arcade/config/matchPredictions`;
    const predictionSnap = await db
        .collection(predictionsPath)
        .where("matchId", "==", match.id)
        .get();

    const counters = {
        evaluatedCount: 0,
        alreadyPaidCount: 0,
        alreadyProcessedCount: 0,
        paidCount: 0,
        noRewardCount: 0,
        outcomeCorrectCount: 0,
        exactScoreCorrectCount: 0,
        totalPaidAmount: 0,
    };

    if (predictionSnap.empty) {
        if (!dryRun) {
            await getMatchRewardRunRef(classId, match.id).set(
                buildMatchRewardRunPayload({
                    classId,
                    match,
                    actorUid,
                    rewardConfig,
                    rewardMultiplier,
                    result,
                    counters,
                    predictionCount: 0,
                }),
                { merge: true },
            );
        }

        return {
            ok: true,
            classId,
            matchId: match.id,
            rewardRunStatus: "processed",
            evaluatedCount: 0,
            alreadyPaidCount: 0,
            alreadyProcessedCount: 0,
            paidCount: 0,
            noRewardCount: 0,
            totalPaidAmount: 0,
            outcomeCorrectCount: 0,
            exactScoreCorrectCount: 0,
        };
    }

    const predictionRefs = predictionSnap.docs.map((docSnap) => docSnap.ref);

    if (dryRun) {
        predictionSnap.docs.forEach((docSnap) => {
            const prediction = docSnap.data() || {};
            const outcomeCorrect = prediction.outcome === result.outcome;
            const exactScoreCorrect = isBonusCorrect(prediction, result);
            const outcomeAmount = outcomeCorrect
                ? Math.floor(rewardConfig.outcomeRewardAmount * rewardMultiplier)
                : 0;
            const exactScoreAmount = exactScoreCorrect
                ? Math.floor(rewardConfig.exactScoreRewardAmount * rewardMultiplier)
                : 0;
            const totalRewardAmount = outcomeAmount + exactScoreAmount;

            counters.evaluatedCount += 1;
            counters.outcomeCorrectCount += outcomeCorrect ? 1 : 0;
            counters.exactScoreCorrectCount += exactScoreCorrect ? 1 : 0;
            counters.paidCount += totalRewardAmount > 0 ? 1 : 0;
            counters.noRewardCount += totalRewardAmount > 0 ? 0 : 1;
            counters.totalPaidAmount += totalRewardAmount;
        });

        return {
            ok: true,
            dryRun: true,
            classId,
            matchId: match.id,
            rewardConfig,
            rewardMultiplier,
            result,
            ...counters,
        };
    }

    await db.runTransaction(async (tx) => {
        const currentSnaps = await Promise.all(
            predictionRefs.map((ref) => tx.get(ref)),
        );

        currentSnaps.forEach((predictionDoc) => {
            if (!predictionDoc.exists) return;

            const prediction = predictionDoc.data() || {};
            const studentUid = prediction.studentUid;
            if (!studentUid) return;

            counters.evaluatedCount += 1;

            const currentRewardStatus =
                prediction.reward?.status || prediction.rewardStatus;
            if (isProcessedRewardStatus(currentRewardStatus)) {
                counters.alreadyProcessedCount += 1;
                if (currentRewardStatus === "paid") {
                    counters.alreadyPaidCount += 1;
                }
                return;
            }

            const outcomeCorrect = prediction.outcome === result.outcome;
            const exactScoreCorrect = isBonusCorrect(prediction, result);
            const outcomeAmount = outcomeCorrect
                ? Math.floor(rewardConfig.outcomeRewardAmount * rewardMultiplier)
                : 0;
            const exactScoreAmount = exactScoreCorrect
                ? Math.floor(rewardConfig.exactScoreRewardAmount * rewardMultiplier)
                : 0;
            const totalRewardAmount = outcomeAmount + exactScoreAmount;
            const rewardBreakdown = {
                predictionType: prediction.predictionType || "exactScore",
                outcomeCorrect,
                exactScoreCorrect,
                outcomeRewardAmount: outcomeAmount,
                exactScoreRewardAmount: exactScoreAmount,
                rewardMultiplier,
                totalRewardAmount,
            };

            counters.outcomeCorrectCount += outcomeCorrect ? 1 : 0;
            counters.exactScoreCorrectCount += exactScoreCorrect ? 1 : 0;
            counters.totalPaidAmount += totalRewardAmount;

            const rewardPatch = {
                actualResult: {
                    homeScore: result.homeScore,
                    awayScore: result.awayScore,
                    outcome: result.outcome,
                    status: result.status,
                },
                reward: {
                    status: totalRewardAmount > 0 ? "paid" : "no_reward",
                    ...rewardBreakdown,
                    evaluatedAt: FieldValue.serverTimestamp(),
                    processedBy: actorUid,
                },
                rewardStatus: totalRewardAmount > 0 ? "paid" : "no_reward",
                rewardProcessedAt: FieldValue.serverTimestamp(),
                rewardProcessedBy: actorUid,
            };

            if (totalRewardAmount > 0) {
                counters.paidCount += 1;
                tx.set(
                    db.doc(`classes/${classId}/students/${studentUid}`),
                    {
                        assets: {
                            cash: FieldValue.increment(totalRewardAmount),
                        },
                        lastUpdated: FieldValue.serverTimestamp(),
                    },
                    { merge: true },
                );
                rewardPatch.reward.paidAt = FieldValue.serverTimestamp();
                stageActivityLog(tx, classId, {
                    studentUid,
                    type: "income",
                    category: "reward",
                    subCategory: "match_prediction",
                    amount: totalRewardAmount,
                    description: buildRewardDescription(match, rewardBreakdown),
                    currency: "class_currency",
                    relatedDoc: {
                        collection: "matchPredictions",
                        id: predictionDoc.id,
                    },
                    matchId: match.id,
                    rewardBreakdown,
                }, {
                    serviceName: "arcade",
                    actionKey: "match_prediction_reward",
                    forceWrite: true,
                });
            } else {
                counters.noRewardCount += 1;
            }

            tx.set(predictionDoc.ref, rewardPatch, { merge: true });
        });

        tx.set(
            getMatchRewardRunRef(classId, match.id),
            buildMatchRewardRunPayload({
                classId,
                match,
                actorUid,
                rewardConfig,
                rewardMultiplier,
                result,
                counters,
                predictionCount: predictionSnap.size,
            }),
            { merge: true },
        );
    });

    return {
        ok: true,
        classId,
        matchId: match.id,
        rewardRunStatus: "processed",
        rewardConfig,
        rewardMultiplier,
        result,
        ...counters,
    };
};

const processFinishedWorldCupRewardsCore = async ({ triggeredBy = "schedule", summaryPath = WORLD_CUP_SUMMARY_DOC, matchIds = null } = {}) => {
    const summarySnap = await db.doc(summaryPath).get();
    if (!summarySnap.exists) {
        return { ok: true, processedMatches: 0, processedClasses: 0, results: [] };
    }

    const matches = Array.isArray(summarySnap.data()?.matches)
        ? summarySnap.data().matches
        : [];
    const finishedMatches = matches.filter((match) => {
        if (matchIds && !matchIds.has(match.id)) return false;
        const homeScore = toNumberOrNull(match?.score?.home);
        const awayScore = toNumberOrNull(match?.score?.away);
        return (
            match?.id &&
            isRewardRunManagedMatch(match) &&
            isMatchFinal(match) &&
            homeScore != null &&
            awayScore != null
        );
    });
    const results = [];

    for (const match of finishedMatches) {
        const predictionSnap = await db
            .collectionGroup("matchPredictions")
            .where("matchId", "==", match.id)
            .get();
        const classIds = new Set(
            predictionSnap.docs
                .map((docSnap) => docSnap.data()?.classId)
                .filter(Boolean),
        );

        for (const classId of classIds) {
            try {
                const processResult = await processMatchPredictionRewardsCore({
                    classId,
                    match,
                    actorUid: triggeredBy,
                    requireAutoPayout: true,
                });
                results.push(processResult);
            } catch (error) {
                console.error("[sportsMatches] auto reward processing failed:", {
                    classId,
                    matchId: match.id,
                    error,
                });
                results.push({
                    ok: false,
                    classId,
                    matchId: match.id,
                    error: error?.message || "Failed to process rewards.",
                });
            }
        }
    }

    return {
        ok: true,
        processedMatches: finishedMatches.length,
        processedClasses: results.length,
        totalPaidAmount: results.reduce(
            (sum, result) => sum + Number(result.totalPaidAmount || 0),
            0,
        ),
        results,
    };
};

const processPendingMatchPredictionRewardsCore = async ({
    classId,
    actorUid = "manual",
} = {}) => {
    const summaries = await Promise.all([WORLD_CUP_SUMMARY_DOC, KBO_SUMMARY_DOC].map((path) => db.doc(path).get()));
    if (!summaries.some((snap) => snap.exists)) {
        throw new HttpsError(
            "failed-precondition",
            "Match schedule is not synced yet.",
        );
    }

    const matches = summaries.flatMap((snap) => Array.isArray(snap.data()?.matches) ? snap.data().matches : []);
    const finishedMatches = matches.filter((match) => {
        const homeScore = toNumberOrNull(match?.score?.home);
        const awayScore = toNumberOrNull(match?.score?.away);
        return (
            match?.id &&
            isRewardRunManagedMatch(match) &&
            isMatchFinal(match) &&
            homeScore != null &&
            awayScore != null
        );
    });
    const rewardRunsSnap = await db
        .collection(`classes/${classId}/arcade/config/${MATCH_REWARD_RUNS_COLLECTION}`)
        .get();
    const rewardRunsByMatch = new Map(
        rewardRunsSnap.docs.map((docSnap) => [docSnap.id, docSnap.data() || {}]),
    );
    const results = [];

    for (const match of finishedMatches) {
        const rewardRun = rewardRunsByMatch.get(match.id);
        if (rewardRun?.status === "processed") {
            results.push({
                ok: true,
                skipped: true,
                reason: "already_processed",
                classId,
                matchId: match.id,
                paidCount: Number(rewardRun.paidCount || 0),
                totalPaidAmount: Number(rewardRun.totalPaidAmount || 0),
            });
            continue;
        }

        try {
            const processResult = await processMatchPredictionRewardsCore({
                classId,
                match,
                actorUid,
            });
            results.push(processResult);
        } catch (error) {
            console.error("[sportsMatches] pending reward processing failed:", {
                classId,
                matchId: match.id,
                error,
            });
            await getMatchRewardRunRef(classId, match.id).set(
                {
                    classId,
                    matchId: match.id,
                    status: "failed",
                    error: error?.message || "Failed to process rewards.",
                    processedBy: actorUid,
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
            results.push({
                ok: false,
                classId,
                matchId: match.id,
                error: error?.message || "Failed to process rewards.",
            });
        }
    }

    const processedResults = results.filter(
        (result) => result.ok && !result.skipped && result.rewardRunStatus === "processed",
    );
    const skippedAlreadyProcessed = results.filter(
        (result) => result.reason === "already_processed",
    );

    return {
        ok: true,
        classId,
        finishedMatchCount: finishedMatches.length,
        processedMatches: processedResults.length,
        skippedAlreadyProcessed: skippedAlreadyProcessed.length,
        failedMatches: results.filter((result) => result.ok === false).length,
        paidCount: processedResults.reduce(
            (sum, result) => sum + Number(result.paidCount || 0),
            0,
        ),
        totalPaidAmount: processedResults.reduce(
            (sum, result) => sum + Number(result.totalPaidAmount || 0),
            0,
        ),
        results,
    };
};

const assertPredictionClassAccess = async (request, classId) => {
    const ctx = getAuthContext(request);

    if (ctx.role === "admin") return ctx;

    if (ctx.classId && ctx.classId !== classId) {
        throw new HttpsError("permission-denied", "Cannot submit for another class.");
    }

    const studentSnap = await db.doc(`classes/${classId}/students/${ctx.uid}`).get();
    if (!studentSnap.exists && ctx.role !== "teacher") {
        throw new HttpsError("permission-denied", "Class access is required.");
    }

    return ctx;
};

const writeWorldCupSummary = async (
    matches,
    {
        triggeredBy = "schedule",
        syncMeta = {},
        source = "football-data",
    } = {},
) => {
    const sourceWarnings = [
        ...(Array.isArray(syncMeta.warnings) ? syncMeta.warnings : []),
    ];

    if (matches.length < WORLD_CUP_EXPECTED_MATCH_COUNT) {
        sourceWarnings.push(
            `Collected ${matches.length} matches; FIFA World Cup 2026 has ${WORLD_CUP_EXPECTED_MATCH_COUNT} matches.`,
        );
    }

    await db.doc(WORLD_CUP_SUMMARY_DOC).set(
        {
            competitionId: "worldcup_2026",
            competitionName: "FIFA World Cup 2026",
            season: WORLD_CUP_SEASON,
            source,
            sourceCompetitionCode: "WC",
            freeTierLimited: matches.length < WORLD_CUP_EXPECTED_MATCH_COUNT,
            matchCount: matches.length,
            matches,
            syncMeta: {
                ...syncMeta,
                expectedMatchCount: WORLD_CUP_EXPECTED_MATCH_COUNT,
                sourceWarnings,
            },
            triggeredBy,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );

    return {
        ok: true,
        count: matches.length,
        freeTierLimited: matches.length < WORLD_CUP_EXPECTED_MATCH_COUNT,
        warnings: sourceWarnings,
    };
};

const syncWorldCupMatchesCore = async ({ triggeredBy = "manual" } = {}) => {
    const summarySnap = await db.doc(WORLD_CUP_SUMMARY_DOC).get();
    if (!summarySnap.exists) {
        throw new Error("World Cup schedule is not initialized yet.");
    }

    const storedMatches = Array.isArray(summarySnap.data()?.matches)
        ? summarySnap.data().matches
        : [];
    const apiMatches = ensureWorldCupFinalMatch(await fetchFootballDataWorldCupMatches());
    const matches = mergeWorldCupResults(storedMatches, apiMatches);
    const syncResult = await writeWorldCupSummary(matches, {
        triggeredBy,
        source: "football-data",
        syncMeta: {
            expectedMatchCount: WORLD_CUP_EXPECTED_MATCH_COUNT,
            mode: "results-only",
        },
    });
    const rewardResult = await processFinishedWorldCupRewardsCore({ triggeredBy });

    return {
        ...syncResult,
        rewards: rewardResult,
    };
};

const syncKboMatchesCore = async ({ triggeredBy = "schedule" } = {}) => {
    return syncKbo({
        db, triggeredBy, timestamp: () => FieldValue.serverTimestamp(),
        processRewards: processFinishedWorldCupRewardsCore,
    });
};

exports.syncKboMatchesDaily = onSchedule({
    schedule: "0 4 * * *", timeZone: "Asia/Seoul", region: "asia-northeast3",
    timeoutSeconds: 540, memory: "256MiB", maxInstances: 1, retryCount: 2,
}, () => syncKboMatchesCore());

exports.syncKboMatches = onCall({
    region: "asia-northeast3", timeoutSeconds: 540, memory: "256MiB", maxInstances: 1,
}, async (request) => {
    assertTeacherOrAdminFromClaims(request, { requireClassForTeacher: false });
    return syncKboMatchesCore({ triggeredBy: request.auth.uid });
});

exports.syncWorldCupMatches = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 300,
        memory: "256MiB",
        secrets: [footballDataToken],
    },
    async (request) => {
        assertTeacherOrAdminFromClaims(request, { requireClassForTeacher: false });

        try {
            return await syncWorldCupMatchesCore({ triggeredBy: request.auth.uid });
        } catch (error) {
            console.error("[sportsMatches] syncWorldCupMatches failed:", error);
            throw new HttpsError(
                "internal",
                error?.message || "Failed to sync World Cup matches.",
            );
        }
    },
);
exports.saveMatchPrediction = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 60,
        memory: "256MiB",
    },
    async (request) => {
        const {
            classId,
            matchId,
            outcome,
            homeScore,
            awayScore,
            margin,
        } = request.data || {};

        if (!classId || !matchId) {
            throw new HttpsError("invalid-argument", "classId and matchId are required.");
        }

        const ctx = await assertPredictionClassAccess(request, classId);
        const match = await readWorldCupMatch(matchId);
        const closeAt = getPredictionCloseTime(match);

        if (match.source === "naver" && !(Date.now() - Date.parse(match.checkedAtUtc) < 36 * 3600000)) {
            throw new HttpsError("failed-precondition", "경기 일정 갱신이 필요합니다. 선생님께 알려 주세요.");
        }

        if (match.postponed || !["SCHEDULED", "TIMED"].includes(match.status) || Date.now() >= closeAt.getTime()) {
            throw new HttpsError(
                "failed-precondition",
                "Prediction is closed 10 minutes before kickoff.",
            );
        }

        const validOutcomes = getMatchType(match) === "knockout"
            ? ["home", "away"]
            : ["home", "draw", "away"];
        if (!validOutcomes.includes(outcome)) {
            throw new HttpsError("invalid-argument", "Invalid prediction outcome.");
        }

        const isMarginPrediction = String(match.id).startsWith("kbo_");
        if (isMarginPrediction && !validateMargin(outcome, margin)) {
            throw new HttpsError("invalid-argument", "승부와 점수 차를 선택해 주세요. 무승부의 점수 차는 0입니다.");
        }
        const normalizedHomeScore = isMarginPrediction ? null : parseScore(homeScore, "homeScore");
        const normalizedAwayScore = isMarginPrediction ? null : parseScore(awayScore, "awayScore");
        const predictionId = `${ctx.uid}_${match.id}`;
        const ref = db.doc(`classes/${classId}/arcade/config/matchPredictions/${predictionId}`);
        const existingPrediction = await ref.get();
        const payload = {
            classId,
            studentUid: ctx.uid,
            matchId: match.id,
            source: match.source || null,
            sourceId: match.sourceId || match.id,
            outcome,
            homeScore: normalizedHomeScore,
            awayScore: normalizedAwayScore,
            predictionType: isMarginPrediction ? "margin" : "exactScore",
            margin: isMarginPrediction ? margin : null,
            matchStartsAtUtc: match.startsAtUtc || null,
            predictionClosesAtUtc: closeAt.toISOString(),
            homeTeamName: match.home?.name || "",
            awayTeamName: match.away?.name || "",
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (!existingPrediction.exists) {
            payload.submittedAt = FieldValue.serverTimestamp();
        }

        await ref.set(payload, { merge: true });

        return {
            ok: true,
            matchId: match.id,
            predictionClosesAtUtc: closeAt.toISOString(),
        };
    },
);

exports.processMatchPredictionRewards = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 300,
        memory: "256MiB",
    },
    async (request) => {
        const {
            classId,
            matchId,
            outcomeRewardAmount,
            exactScoreRewardAmount,
            dryRun = false,
        } = request.data || {};

        if (!classId || !matchId) {
            throw new HttpsError("invalid-argument", "classId and matchId are required.");
        }

        const ctx = assertTeacherOrAdminFromClaims(request, { classId });
        const match = await readWorldCupMatch(matchId);

        try {
            return await processMatchPredictionRewardsCore({
                classId,
                match,
                actorUid: ctx.uid,
                outcomeRewardAmount,
                exactScoreRewardAmount,
                dryRun,
            });
        } catch (error) {
            if (error instanceof HttpsError) throw error;
            console.error("[sportsMatches] processMatchPredictionRewards failed:", error);
            throw new HttpsError(
                "internal",
                error?.message || "Failed to process match prediction rewards.",
            );
        }
    },
);
exports.processPendingMatchPredictionRewards = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 300,
        memory: "256MiB",
    },
    async (request) => {
        const { classId } = request.data || {};

        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        const ctx = assertTeacherOrAdminFromClaims(request, { classId });

        try {
            return await processPendingMatchPredictionRewardsCore({
                classId,
                actorUid: ctx.uid,
            });
        } catch (error) {
            if (error instanceof HttpsError) throw error;
            console.error("[sportsMatches] processPendingMatchPredictionRewards failed:", error);
            throw new HttpsError(
                "internal",
                error?.message || "Failed to process pending match prediction rewards.",
            );
        }
    },
);
