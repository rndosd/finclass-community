"use strict";

const WEEKLY_STALE_DAYS = 7;
const MONTHLY_STALE_DAYS = 30;
const TOP_HOLDINGS_LIMIT = 25;
const WEEKDAY_REQUEST_LIMIT = 12;
const SUNDAY_REQUEST_LIMIT = 6;

const toNullableNumber = (value) => {
    if (value == null || String(value).trim() === "") return null;
    const parsed = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
};

const ratioToPercent = (value) => {
    const parsed = toNullableNumber(value);
    return parsed == null ? null : parsed * 100;
};

const normalizeSymbol = (value) => String(value || "").trim().toUpperCase();

const parseDateMillis = (value) => {
    if (!value) return null;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.toDate === "function") return value.toDate().getTime();
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
};

const getProviderMessage = (payload) =>
    payload?.Information || payload?.Note || payload?.["Error Message"] || null;

function getEtfDailyRequestLimit(now = new Date()) {
    const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        weekday: "short",
    }).format(now);
    return weekday === "Sun" ? SUNDAY_REQUEST_LIMIT : WEEKDAY_REQUEST_LIMIT;
}

function normalizeAlphaVantageEtfProfile(payload, symbol) {
    const providerMessage = getProviderMessage(payload);
    if (providerMessage) {
        const error = new Error("Alpha Vantage ETF profile request was rejected.");
        error.code = "provider-rejected";
        throw error;
    }

    const normalizedSymbol = normalizeSymbol(symbol);
    const holdings = (Array.isArray(payload?.holdings) ? payload.holdings : [])
        .map((item) => ({
            symbol: normalizeSymbol(item?.symbol) || null,
            name: String(item?.description || item?.name || "").trim() || null,
            sector: String(item?.sector || "").trim() || null,
            assetClass: String(item?.asset_type || item?.assetClass || "").trim() || null,
            weightPercent: ratioToPercent(item?.weight),
        }))
        .filter((item) => item.name || item.symbol)
        .sort((left, right) =>
            (right.weightPercent || 0) - (left.weightPercent || 0),
        );
    const sectors = (Array.isArray(payload?.sectors) ? payload.sectors : [])
        .map((item) => ({
            name: String(item?.sector || item?.name || "").trim() || null,
            weightPercent: ratioToPercent(item?.weight),
        }))
        .filter((item) => item.name)
        .sort((left, right) =>
            (right.weightPercent || 0) - (left.weightPercent || 0),
        );
    const profile = {
        netAssetsUSD: toNullableNumber(payload?.net_assets),
        netExpenseRatioPercent: ratioToPercent(payload?.net_expense_ratio),
        portfolioTurnoverPercent: ratioToPercent(payload?.portfolio_turnover),
        dividendYieldPercent: ratioToPercent(payload?.dividend_yield),
        inceptionDate: String(payload?.inception_date || "").trim() || null,
        leveraged: String(payload?.leveraged || "").trim() || null,
    };
    const hasProfile = Object.values(profile).some((value) => value != null);

    if (!hasProfile && holdings.length === 0 && sectors.length === 0) {
        const error = new Error(`No ETF profile data returned for ${normalizedSymbol}.`);
        error.code = "provider-empty";
        throw error;
    }

    return {
        symbol: normalizedSymbol,
        profile,
        holdings: holdings.slice(0, TOP_HOLDINGS_LIMIT),
        holdingCount: holdings.length,
        sectorExposures: sectors,
        dataAsOf: null,
        coverage: holdings.length > 0 ? "complete" : "partial",
        sources: ["alphavantage"],
    };
}

function splitCsvLine(line) {
    const values = [];
    let current = "";
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"') {
            if (quoted && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (character === "," && !quoted) {
            values.push(current.trim());
            current = "";
        } else {
            current += character;
        }
    }
    values.push(current.trim());
    return values;
}

function parseIsharesHoldingsCsv(csvText, symbol) {
    const lines = String(csvText || "")
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter((line) => line.trim());
    const dateLine = lines.find((line) => line.startsWith("Fund Holdings as of,"));
    const dataAsOf = dateLine ? splitCsvLine(dateLine)[1] || null : null;
    const headerIndex = lines.findIndex((line) => line.startsWith("Ticker,Name,"));
    if (headerIndex < 0) {
        const error = new Error("iShares holdings CSV header was not found.");
        error.code = "issuer-invalid-response";
        throw error;
    }

    const headers = splitCsvLine(lines[headerIndex]);
    const indexByHeader = new Map(headers.map((header, index) => [header, index]));
    const holdings = lines
        .slice(headerIndex + 1)
        .map(splitCsvLine)
        .map((values) => ({
            symbol: normalizeSymbol(values[indexByHeader.get("Ticker")]) || null,
            name: String(values[indexByHeader.get("Name")] || "").trim() || null,
            sector: String(values[indexByHeader.get("Sector")] || "").trim() || null,
            assetClass:
        String(values[indexByHeader.get("Asset Class")] || "").trim() || null,
            weightPercent: toNullableNumber(values[indexByHeader.get("Weight (%)")]),
        }))
        .filter((item) => item.name && item.weightPercent != null)
        .sort((left, right) =>
            (right.weightPercent || 0) - (left.weightPercent || 0),
        );
    if (holdings.length === 0) {
        const error = new Error("iShares holdings CSV contained no holdings.");
        error.code = "issuer-empty";
        throw error;
    }

    const sectorMap = new Map();
    holdings.forEach((item) => {
        if (!item.sector) return;
        sectorMap.set(
            item.sector,
            (sectorMap.get(item.sector) || 0) + (item.weightPercent || 0),
        );
    });

    return {
        symbol: normalizeSymbol(symbol),
        holdings: holdings.slice(0, TOP_HOLDINGS_LIMIT),
        holdingCount: holdings.length,
        sectorExposures: Array.from(sectorMap.entries())
            .map(([name, weightPercent]) => ({ name, weightPercent }))
            .sort((left, right) => right.weightPercent - left.weightPercent),
        dataAsOf,
        coverage: "complete",
        sources: ["ishares"],
    };
}

function mergeEtfProfileData(primary, fallback) {
    if (!fallback) return primary;
    const useFallbackHoldings =
    (!Array.isArray(primary?.holdings) || primary.holdings.length === 0) &&
    Array.isArray(fallback.holdings) && fallback.holdings.length > 0;

    return {
        ...primary,
        holdings: useFallbackHoldings ? fallback.holdings : primary.holdings,
        holdingCount: useFallbackHoldings ? fallback.holdingCount : primary.holdingCount,
        sectorExposures:
      useFallbackHoldings && fallback.sectorExposures?.length > 0
          ? fallback.sectorExposures
          : primary.sectorExposures,
        dataAsOf: useFallbackHoldings ? fallback.dataAsOf : primary.dataAsOf,
        coverage: useFallbackHoldings ? "complete" : primary.coverage,
        sources: Array.from(
            new Set([...(primary?.sources || []), ...(fallback?.sources || [])]),
        ),
    };
}

function selectEtfSyncTargets({
    catalog,
    heldSymbols = [],
    stateBySymbol = new Map(),
    now = new Date(),
    limit = 6,
}) {
    const nowMillis = now.getTime();
    const heldSet = new Set(Array.from(heldSymbols || [], normalizeSymbol));
    const dayMillis = 24 * 60 * 60 * 1000;

    return catalog
        .filter((item) => item?.type === "ETF")
        .map((item) => {
            const symbol = normalizeSymbol(item.ticker);
            const state = stateBySymbol.get(symbol) || {};
            const isHeld = heldSet.has(symbol);
            const isCore = item.defaultVisible !== false || isHeld;
            const staleDays = isCore ? WEEKLY_STALE_DAYS : MONTHLY_STALE_DAYS;
            const lastSuccessMillis = parseDateMillis(state.lastSuccessfulAt);
            const lastAttemptMillis = parseDateMillis(state.lastAttemptAt);
            const retryMillis = parseDateMillis(state.nextRetryAt);
            const isRetryBlocked = retryMillis != null && retryMillis > nowMillis;
            const isRetryDue = state.status === "failed" && !isRetryBlocked;
            const isDue =
        !isRetryBlocked &&
        (lastSuccessMillis == null ||
          nowMillis - lastSuccessMillis >= staleDays * dayMillis);
            return {
                ...item,
                symbol,
                isHeld,
                isCore,
                staleDays,
                isDue,
                isRetryDue,
                lastSuccessMillis,
                lastAttemptMillis,
            };
        })
        .filter((item) => item.isDue)
        .sort((left, right) => {
            if (left.isHeld !== right.isHeld) return left.isHeld ? -1 : 1;
            if (left.isCore !== right.isCore) return left.isCore ? -1 : 1;
            if (left.isRetryDue !== right.isRetryDue) {
                return left.isRetryDue ? -1 : 1;
            }
            const leftNeverAttempted = left.lastAttemptMillis == null;
            const rightNeverAttempted = right.lastAttemptMillis == null;
            if (leftNeverAttempted !== rightNeverAttempted) {
                return leftNeverAttempted ? -1 : 1;
            }
            const leftSuccess = left.lastSuccessMillis ?? Number.NEGATIVE_INFINITY;
            const rightSuccess = right.lastSuccessMillis ?? Number.NEGATIVE_INFINITY;
            if (leftSuccess !== rightSuccess) return leftSuccess - rightSuccess;
            return left.symbol.localeCompare(right.symbol);
        })
        .slice(0, Math.max(0, Number(limit) || 0));
}

module.exports = {
    MONTHLY_STALE_DAYS,
    SUNDAY_REQUEST_LIMIT,
    TOP_HOLDINGS_LIMIT,
    WEEKDAY_REQUEST_LIMIT,
    WEEKLY_STALE_DAYS,
    getEtfDailyRequestLimit,
    mergeEtfProfileData,
    normalizeAlphaVantageEtfProfile,
    parseIsharesHoldingsCsv,
    selectEtfSyncTargets,
};
