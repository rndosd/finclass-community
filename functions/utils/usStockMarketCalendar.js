"use strict";

const US_STOCK_MARKET_HOLIDAYS = new Set([
    "2025-01-01",
    "2025-01-20",
    "2025-02-17",
    "2025-04-18",
    "2025-05-26",
    "2025-06-19",
    "2025-07-04",
    "2025-09-01",
    "2025-11-27",
    "2025-12-25",
    "2026-01-01",
    "2026-01-19",
    "2026-02-16",
    "2026-04-03",
    "2026-05-25",
    "2026-06-19",
    "2026-07-03",
    "2026-09-07",
    "2026-11-26",
    "2026-12-25",
    "2027-01-01",
    "2027-01-18",
    "2027-02-15",
    "2027-03-26",
    "2027-05-31",
    "2027-06-18",
    "2027-07-05",
    "2027-09-06",
    "2027-11-25",
    "2027-12-24",
]);

const formatLocalDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

const isLocalTradingHoliday = (date) => {
    const weekday = date.getDay();
    return (
        weekday === 0 ||
        weekday === 6 ||
        US_STOCK_MARKET_HOLIDAYS.has(formatLocalDateKey(date))
    );
};

const getPriorOrCurrentTradingDateKey = (date) => {
    const candidate = new Date(date.getTime());
    while (isLocalTradingHoliday(candidate)) {
        candidate.setDate(candidate.getDate() - 1);
    }
    return formatLocalDateKey(candidate);
};

const getNextTradingDateKey = (dateKey) => {
    const candidate = new Date(`${dateKey}T12:00:00.000Z`);
    if (Number.isNaN(candidate.getTime())) {
        throw new Error(`Invalid market date: ${dateKey}`);
    }
    do {
        candidate.setUTCDate(candidate.getUTCDate() + 1);
    } while (
        candidate.getUTCDay() === 0 ||
        candidate.getUTCDay() === 6 ||
        US_STOCK_MARKET_HOLIDAYS.has(
            candidate.toISOString().slice(0, 10),
        )
    );
    return candidate.toISOString().slice(0, 10);
};

module.exports = {
    US_STOCK_MARKET_HOLIDAYS,
    getNextTradingDateKey,
    getPriorOrCurrentTradingDateKey,
};
