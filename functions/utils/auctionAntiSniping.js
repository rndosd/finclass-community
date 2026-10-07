"use strict";

const DEFAULT_ANTI_SNIPING_SECONDS = 30;
const MAX_ANTI_SNIPING_SECONDS = 60 * 60;

function normalizeAntiSnipingSeconds(value) {
    if (value === null || value === undefined || value === "") {
        return DEFAULT_ANTI_SNIPING_SECONDS;
    }

    const normalized = Math.floor(Number(value));
    if (!Number.isFinite(normalized)) {
        return DEFAULT_ANTI_SNIPING_SECONDS;
    }

    return Math.max(0, Math.min(MAX_ANTI_SNIPING_SECONDS, normalized));
}

function resolveAuctionBidDeadline({
    nowMs,
    currentEndAtMs,
    antiSnipingSeconds,
}) {
    const safeNowMs = Math.floor(Number(nowMs));
    const safeEndAtMs = Math.floor(Number(currentEndAtMs));
    const extensionSeconds = normalizeAntiSnipingSeconds(antiSnipingSeconds);
    const remainingMs = safeEndAtMs - safeNowMs;

    if (
        !Number.isFinite(safeNowMs) ||
    !Number.isFinite(safeEndAtMs) ||
    extensionSeconds <= 0 ||
    remainingMs <= 0 ||
    remainingMs > extensionSeconds * 1000
    ) {
        return {
            extended: false,
            extensionSeconds,
            endAtMs: safeEndAtMs,
        };
    }

    const nextEndAtMs = safeNowMs + extensionSeconds * 1000;
    return {
        extended: nextEndAtMs > safeEndAtMs,
        extensionSeconds,
        endAtMs: Math.max(safeEndAtMs, nextEndAtMs),
    };
}

module.exports = {
    DEFAULT_ANTI_SNIPING_SECONDS,
    normalizeAntiSnipingSeconds,
    resolveAuctionBidDeadline,
};
