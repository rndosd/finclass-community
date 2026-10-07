// KST dayKey: 'YYYY-MM-DD'
export const toDayKeyKST = (d = new Date()) => {
    const tzOffset = 9 * 60; // KST +09:00
    const utc = d.getTime() + d.getTimezoneOffset() * 60000;
    const kst = new Date(utc + tzOffset * 60000);
    const y = kst.getFullYear();
    const m = String(kst.getMonth() + 1).padStart(2, "0");
    const day = String(kst.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

export const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
};

// preset → {start,end}
export const getRangeFromMode = (mode, customRange) => {
    const now = new Date();
    const today = toDayKeyKST(now);

    const end = new Date(today + "T23:59:59+09:00");
    if (mode === "today") {
        const start = new Date(today + "T00:00:00+09:00");
        return { start, end };
    }
    if (mode === "7d") {
        const start = addDays(new Date(end), -6);
        start.setHours(0, 0, 0, 0);
        return { start, end };
    }
    if (mode === "14d") {
        const start = addDays(new Date(end), -13);
        start.setHours(0, 0, 0, 0);
        return { start, end };
    }
    if (mode === "30d") {
        const start = addDays(new Date(end), -29);
        start.setHours(0, 0, 0, 0);
        return { start, end };
    }
    if (mode === "custom" && customRange?.start && customRange?.end) {
        return {
            start: new Date(customRange.start),
            end: new Date(customRange.end),
        };
    }
    // default
    return getRangeFromMode("7d");
};
