"use strict";

const KBO_SUMMARY_DOC = "sportsMatchSummary/kbo_current";
const kstDate = (date) => new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
const normalizeKboMatch = (game) => {
    if (!game.gameId || !/^\d{4}-\d{2}-\d{2}$/.test(game.gameDate)) throw new Error("Invalid KBO game identity or date");
    const start = new Date(game.gameDateTime ? `${game.gameDateTime}${/Z$|[+-]\d{2}:\d{2}$/.test(game.gameDateTime) ? "" : "+09:00"}` : "");
    const ready = Boolean(game.homeTeamCode && game.awayTeamCode && game.homeTeamName && game.awayTeamName &&
        Number.isFinite(start.getTime()) && !game.timeTbd);
    const finished = game.statusCode === "RESULT" && !game.cancel && !game.suspended;
    const validScore = (score) => Number.isInteger(score) && score >= 0;
    if (finished && (!ready || !validScore(game.homeTeamScore) || !validScore(game.awayTeamScore))) {
        throw new Error("KBO final score is missing");
    }
    return {
        id: `kbo_${game.gameId}_${game.homeTeamCode || "TBD"}_${game.awayTeamCode || "TBD"}`, source: "naver", sourceId: game.gameId,
        league: "KBO", season: game.gameDate.slice(0, 4), round: "KBO", group: null,
        status: game.cancel ? "CANCELLED" : game.suspended ? "SUSPENDED" : !ready ? "UNCONFIRMED" : finished ? "FINISHED"
            : ["BEFORE", "READY"].includes(game.statusCode) ? "SCHEDULED" : "IN_PLAY",
        postponed: Boolean(game.cancel || game.suspended),
        startsAtUtc: ready ? start.toISOString() : null, dateEvent: game.gameDate,
        home: { id: game.homeTeamCode || null, name: game.homeTeamName || "대진 미정", badge: null },
        away: { id: game.awayTeamCode || null, name: game.awayTeamName || "대진 미정", badge: null },
        score: { home: finished ? game.homeTeamScore : null, away: finished ? game.awayTeamScore : null },
    };
};

// One small request per date: reject truncated responses instead of silently losing games.
const fetchKboMatches = async ({ now = new Date(), fetchImpl = fetch, extraDates = [] } = {}) => {
    const matches = [];
    const dates = new Set(extraDates);
    for (let offset = -7; offset <= 30; offset += 1) {
        dates.add(kstDate(new Date(now.getTime() + offset * 86400000)));
    }
    const deadline = AbortSignal.timeout(180000);
    for (const date of [...dates].sort()) {
        const url = new URL("https://api-gw.sports.naver.com/schedule/games");
        url.search = new URLSearchParams({ categoryId: "kbo", fromDate: date, toDate: date, pageSize: "100" });
        const response = await fetchImpl(url, { signal: AbortSignal.any([deadline, AbortSignal.timeout(15000)]) });
        if (!response.ok) throw new Error(`KBO source HTTP ${response.status}`);
        const payload = await response.json();
        const games = payload.result?.games;
        if (!payload.success || !Array.isArray(games) || payload.result.gameTotalCount !== games.length) {
            throw new Error(`Incomplete KBO schedule for ${date}`);
        }
        for (const game of games) {
            if (game.categoryId !== "kbo" || game.gameDate !== date) throw new Error("Unexpected KBO schedule scope");
            matches.push(normalizeKboMatch(game));
        }
    }
    if (new Set(matches.map((match) => match.id)).size !== matches.length) throw new Error("Duplicate KBO games");
    return matches;
};

const mergeKboMatches = (stored, incoming, now = new Date()) => {
    const cutoff = kstDate(new Date(now.getTime() - 120 * 86400000));
    const byId = new Map(stored.filter((match) => match.dateEvent >= cutoff).map((match) => [match.id, match]));
    const incomingIds = new Set(incoming.map((match) => match.id));
    const from = kstDate(new Date(now.getTime() - 7 * 86400000));
    const to = kstDate(new Date(now.getTime() + 30 * 86400000));
    for (const [id, match] of byId) {
        if (!incomingIds.has(id) && match.dateEvent >= from && match.dateEvent <= to && match.status !== "FINISHED" && match.status !== "CANCELLED") {
            byId.set(id, { ...match, status: "UNCONFIRMED", postponed: true, score: { home: null, away: null } });
        }
    }
    for (const match of incoming) byId.set(match.id, { ...match, checkedAtUtc: now.toISOString() });
    // Absence is uncertain, never a completed draw. New IDs never inherit old predictions.
    return [...byId.values()].sort((a, b) => String(a.startsAtUtc || a.dateEvent).localeCompare(String(b.startsAtUtc || b.dateEvent)));
};

module.exports = { KBO_SUMMARY_DOC, normalizeKboMatch, fetchKboMatches, mergeKboMatches };
