"use strict";
const { KBO_SUMMARY_DOC, fetchKboMatches, mergeKboMatches } = require("./kboMatches");

// Dependencies are injected so cache failure and reward retry behavior can be checked without production writes.
const syncKbo = async ({ db, timestamp, processRewards, fetchMatches = fetchKboMatches, now = new Date(), triggeredBy = "schedule" }) => {
    const ref = db.doc(KBO_SUMMARY_DOC);
    const startedAt = now.toISOString();
    let phase = "fetch";
    try {
        const previous = await ref.get();
        const extraDates = [...new Set((previous.data()?.matches || [])
            .filter((match) => !["FINISHED", "CANCELLED"].includes(match.status) &&
                Date.parse(match.dateEvent) >= now.getTime() - 120 * 86400000)
            .map((match) => match.dateEvent))];
        const incoming = await fetchMatches({ now, extraDates });
        const count = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (snap.data()?.syncStartedAt > startedAt) return null;
            const matches = mergeKboMatches(snap.data()?.matches || [], incoming, now);
            tx.set(ref, {
                competitionId: "kbo", competitionName: "KBO 야구", season: String(now.getFullYear()),
                source: "naver", matches, matchCount: matches.length, triggeredBy,
                updatedAt: timestamp(), syncStartedAt: startedAt,
                syncStatus: "settling", lastAttemptAt: timestamp(), lastError: null,
                syncMeta: { schedule: "매일 04:00 (한국 시간)", fetchedCount: incoming.length },
            });
            return matches.length;
        });
        if (count === null) return { ok: true, skipped: true, reason: "newer_sync" };
        phase = "rewards";
        const rewards = await processRewards({ triggeredBy, summaryPath: KBO_SUMMARY_DOC,
            matchIds: new Set(incoming.map((match) => match.id)) });
        if (rewards.results.some((result) => !result.ok)) throw new Error("KBO reward retry required");
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (snap.data()?.syncStartedAt === startedAt) tx.set(ref, { syncStatus: "ok", lastError: null }, { merge: true });
        });
        return { ok: true, count, rewards };
    } catch (error) {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (snap.data()?.syncStartedAt > startedAt) return;
            tx.set(ref, { syncStatus: "error", lastAttemptAt: timestamp(),
                lastError: phase === "fetch" ? "일정 갱신에 실패했습니다. 마지막으로 확인한 일정을 표시합니다."
                    : "일정은 갱신됐지만 일부 보상 처리가 완료되지 않았습니다. 다시 갱신해 주세요.",
            }, { merge: true });
        });
        throw error;
    }
};
module.exports = { syncKbo };
