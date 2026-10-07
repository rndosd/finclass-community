"use strict";

const US_INDEX_SYMBOLS = Object.freeze(["SPY", "QQQ", "DIA", "IWM"]);
const MAX_INDEX_HISTORY_POINTS = 7;

const isValidDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

const normalizeHistory = (points) => {
    const byDate = new Map();

    for (const point of Array.isArray(points) ? points : []) {
        const close = Number(point?.close);
        if (!isValidDateKey(point?.date) || !Number.isFinite(close) || close <= 0) {
            continue;
        }
        byDate.set(point.date, { date: point.date, close });
    }

    return [...byDate.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-MAX_INDEX_HISTORY_POINTS);
};

const buildUsIndexHistoryDocument = ({
    existingData = {},
    quotes = {},
    marketDate,
    updatedAt,
}) => {
    if (!isValidDateKey(marketDate)) {
        throw new Error(`유효하지 않은 미국장 기준일입니다: ${marketDate}`);
    }

    const historyBySymbol = {};
    let updatedSymbolCount = 0;

    for (const symbol of US_INDEX_SYMBOLS) {
        const existingPoints = normalizeHistory(existingData?.historyBySymbol?.[symbol]);
        const current = Number(quotes?.[symbol]?.current);

        if (Number.isFinite(current) && current > 0) {
            historyBySymbol[symbol] = normalizeHistory([
                ...existingPoints,
                { date: marketDate, close: current },
            ]);
            updatedSymbolCount += 1;
        } else {
            historyBySymbol[symbol] = existingPoints;
        }
    }

    return {
        historyBySymbol,
        symbols: US_INDEX_SYMBOLS,
        maxPoints: MAX_INDEX_HISTORY_POINTS,
        lastMarketDate: updatedSymbolCount > 0
            ? marketDate
            : existingData?.lastMarketDate || null,
        updatedAt,
        source: "finnhub",
        updatedSymbolCount,
    };
};

module.exports = {
    US_INDEX_SYMBOLS,
    MAX_INDEX_HISTORY_POINTS,
    buildUsIndexHistoryDocument,
};
