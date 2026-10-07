"use strict";

const WINDOW_DAYS = 30;
const MAX_WINDOW_POINTS = 32;
const DAY_MS = 24 * 60 * 60 * 1000;

const parseDateKey = (dateKey) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
    if (!match) return null;
    const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const date = new Date(timestamp);
    if (date.toISOString().slice(0, 10) !== dateKey) return null;
    return timestamp;
};

const normalizePoints = (points) => {
    const byDate = new Map();
    for (const point of Array.isArray(points) ? points : []) {
        const nav = Number(point?.nav);
        if (parseDateKey(point?.dateKey) === null || !Number.isFinite(nav) || nav <= 0) {
            continue;
        }
        byDate.set(point.dateKey, { dateKey: point.dateKey, nav });
    }
    return [...byDate.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
};

function buildFundPerformance30d({ existingWindow = [], dateKey, nav }) {
    const endTimestamp = parseDateKey(dateKey);
    const currentNav = Number(nav);
    if (endTimestamp === null || !Number.isFinite(currentNav) || currentNav <= 0) {
        throw new Error("최근 한 달 펀드 성과 계산 입력값이 올바르지 않습니다.");
    }

    const points = normalizePoints([
        ...existingWindow,
        { dateKey, nav: currentNav },
    ]).filter((point) => parseDateKey(point.dateKey) <= endTimestamp);
    const cutoffTimestamp = endTimestamp - (WINDOW_DAYS * DAY_MS);
    let anchorIndex = -1;

    points.forEach((point, index) => {
        if (parseDateKey(point.dateKey) <= cutoffTimestamp) anchorIndex = index;
    });

    const retained = (anchorIndex >= 0 ? points.slice(anchorIndex) : points)
        .slice(-MAX_WINDOW_POINTS);
    const startPoint = retained[0] || { dateKey, nav: currentNav };
    const periodDays = Math.max(
        0,
        Math.round((endTimestamp - parseDateKey(startPoint.dateKey)) / DAY_MS),
    );
    const returnPct = ((currentNav - startPoint.nav) / startPoint.nav) * 100;

    return {
        navWindow30d: retained,
        performance30d: {
            returnPct: Math.round(returnPct * 10000) / 10000,
            startDate: startPoint.dateKey,
            endDate: dateKey,
            periodDays,
            isFullPeriod: periodDays >= WINDOW_DAYS,
        },
    };
}

module.exports = {
    WINDOW_DAYS,
    buildFundPerformance30d,
};
