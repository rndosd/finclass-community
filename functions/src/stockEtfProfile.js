"use strict";

const admin = require("../firebaseAdminCompat");
const axios = require("axios");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");

const { assertAdminFromClaims } = require("../utils/permissions");
const {
    ensureStockJobIndexBootstrapped,
    getHeldSymbolsAcrossClasses,
} = require("../utils/stockJobIndex");
const { STOCK_CATALOG, STOCK_CATALOG_BY_TICKER } = require("../utils/stockCatalog");
const {
    getEtfDailyRequestLimit,
    mergeEtfProfileData,
    normalizeAlphaVantageEtfProfile,
    parseIsharesHoldingsCsv,
    selectEtfSyncTargets,
} = require("../utils/stockEtfProfile");

const db = admin.firestore();
const alphaVantageApiKeyParam = defineSecret("ALPHA_VANTAGE_API_KEY");

const ETF_CACHE_COLLECTION = "stockEtfProfileCache";
const ETF_SYNC_STATE_COLLECTION = "stockEtfProfileSyncState";
const ALPHA_VANTAGE_API_URL = "https://www.alphavantage.co/query";
const REQUEST_DELAY_MS = 15000;
const RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const LOG_CONTEXT = "STOCK_ETF_PROFILE";

const ISSUER_HOLDINGS_SOURCES = Object.freeze({
    EWY: {
        provider: "ishares",
        holdingsUrl:
            "https://www.ishares.com/us/products/239681/" +
            "ishares-msci-south-korea-etf/latest-holdings.csv",
        pageUrl:
            "https://www.ishares.com/us/products/239681/" +
            "ishares-msci-south-korea-etf",
    },
});

const logger = {
    info: (message, data) =>
        console.info(`[${LOG_CONTEXT}] ${message}`, data || ""),
    warn: (message, data) =>
        console.warn(`[${LOG_CONTEXT}] ${message}`, data || ""),
    error: (message, data) =>
        console.error(`[${LOG_CONTEXT}] ${message}`, data || ""),
};

const sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

const normalizeSymbol = (value) => String(value || "").trim().toUpperCase();

const sanitizeErrorCode = (error) => {
    if (typeof error?.code === "string" && error.code.length <= 80) {
        return error.code;
    }
    const status = Number(error?.response?.status);
    return Number.isFinite(status) ? `http-${status}` : "sync-failed";
};

async function fetchAlphaVantageEtfProfile({ symbol, apiKey, httpClient = axios }) {
    const response = await httpClient.get(ALPHA_VANTAGE_API_URL, {
        params: {
            function: "ETF_PROFILE",
            symbol,
            apikey: apiKey,
        },
        timeout: 15000,
    });
    return normalizeAlphaVantageEtfProfile(response.data, symbol);
}

async function fetchIssuerHoldings({ symbol, httpClient = axios }) {
    const source = ISSUER_HOLDINGS_SOURCES[symbol];
    if (!source) return null;

    const response = await httpClient.get(source.holdingsUrl, {
        responseType: "text",
        timeout: 15000,
        headers: {
            Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
            "User-Agent": "Finclass/1.0 ETF educational data sync",
        },
    });
    return parseIsharesHoldingsCsv(response.data, symbol);
}

async function buildEtfSnapshot({ symbol, apiKey, httpClient = axios }) {
    let primary = null;
    let primaryError = null;

    try {
        primary = await fetchAlphaVantageEtfProfile({
            symbol,
            apiKey,
            httpClient,
        });
    } catch (error) {
        primaryError = error;
    }

    let issuerData = null;
    if (!primary?.holdings?.length && ISSUER_HOLDINGS_SOURCES[symbol]) {
        try {
            issuerData = await fetchIssuerHoldings({ symbol, httpClient });
        } catch (error) {
            logger.warn(`Issuer fallback failed for ${symbol}.`, {
                code: sanitizeErrorCode(error),
            });
        }
    }

    if (!primary && !issuerData) {
        throw primaryError || new Error(`No ETF data source succeeded for ${symbol}.`);
    }

    const base = primary || {
        symbol,
        profile: {},
        holdings: [],
        holdingCount: 0,
        sectorExposures: [],
        dataAsOf: null,
        coverage: "partial",
        sources: [],
    };
    const merged = mergeEtfProfileData(base, issuerData);
    const sourceLinks = merged.sources.map((sourceId) => {
        if (sourceId === "ishares") {
            return {
                id: sourceId,
                url: ISSUER_HOLDINGS_SOURCES[symbol]?.pageUrl || null,
            };
        }
        return {
            id: sourceId,
            url: "https://www.alphavantage.co/documentation/#etf-profile",
        };
    });

    return {
        ...merged,
        sourceLinks,
    };
}

async function fetchSyncStateMap() {
    const snapshot = await db.collection(ETF_SYNC_STATE_COLLECTION).get();
    return new Map(
        snapshot.docs.map((document) => [document.id, document.data() || {}]),
    );
}

async function writeSuccessfulSnapshot({ target, snapshot, attemptedAt }) {
    const cacheRef = db.collection(ETF_CACHE_COLLECTION).doc(target.symbol);
    const stateRef = db.collection(ETF_SYNC_STATE_COLLECTION).doc(target.symbol);
    const batch = db.batch();
    batch.set(
        cacheRef,
        {
            ...snapshot,
            companyName: target.companyName || target.symbol,
            categoryId: target.categoryId || null,
            categoryName: target.categoryName || null,
            refreshTier: target.isCore ? "weekly" : "monthly",
            schemaVersion: 1,
            lastSyncedAt: attemptedAt,
        },
        { merge: true },
    );
    batch.set(
        stateRef,
        {
            symbol: target.symbol,
            status: snapshot.coverage,
            refreshTier: target.isCore ? "weekly" : "monthly",
            lastAttemptAt: attemptedAt,
            lastSuccessfulAt: attemptedAt,
            nextRetryAt: FieldValue.delete(),
            lastErrorCode: FieldValue.delete(),
            consecutiveFailures: 0,
        },
        { merge: true },
    );
    await batch.commit();
}

async function writeFailedAttempt({ target, attemptedAt, error }) {
    const stateRef = db.collection(ETF_SYNC_STATE_COLLECTION).doc(target.symbol);
    const nextRetryAt = Timestamp.fromDate(
        new Date(attemptedAt.toMillis() + RETRY_DELAY_MS),
    );
    await stateRef.set(
        {
            symbol: target.symbol,
            status: "failed",
            refreshTier: target.isCore ? "weekly" : "monthly",
            lastAttemptAt: attemptedAt,
            nextRetryAt,
            lastErrorCode: sanitizeErrorCode(error),
            consecutiveFailures: FieldValue.increment(1),
        },
        { merge: true },
    );
}

function resolveForcedTargets(onlySymbols, heldSymbols) {
    const heldSet = new Set(Array.from(heldSymbols || [], normalizeSymbol));
    return Array.from(new Set(onlySymbols.map(normalizeSymbol).filter(Boolean)))
        .map((symbol) => STOCK_CATALOG_BY_TICKER.get(symbol))
        .filter((item) => item?.type === "ETF")
        .map((item) => ({
            ...item,
            symbol: item.ticker,
            isHeld: heldSet.has(item.ticker),
            isCore: item.defaultVisible !== false || heldSet.has(item.ticker),
        }));
}

async function runStockEtfProfileSync({
    apiKey,
    onlySymbols = null,
    force = false,
    limit = null,
    initiatedBy = "scheduler",
    now = new Date(),
    httpClient = axios,
} = {}) {
    if (!apiKey) {
        throw new Error("ALPHA_VANTAGE_API_KEY is missing.");
    }

    await ensureStockJobIndexBootstrapped({
        source: `syncStockEtfProfiles:${initiatedBy}`,
    });
    const [heldSymbols, stateBySymbol] = await Promise.all([
        getHeldSymbolsAcrossClasses(),
        fetchSyncStateMap(),
    ]);
    const dailyRequestLimit = getEtfDailyRequestLimit(now);
    const requestedLimit = Math.max(1, Number(limit) || dailyRequestLimit);
    const effectiveLimit = Math.min(dailyRequestLimit, requestedLimit);
    const targets = force && Array.isArray(onlySymbols) ?
        resolveForcedTargets(onlySymbols, heldSymbols).slice(0, effectiveLimit) :
        selectEtfSyncTargets({
            catalog: STOCK_CATALOG,
            heldSymbols,
            stateBySymbol,
            now,
            limit: effectiveLimit,
        });

    logger.info("ETF profile sync selected targets.", {
        initiatedBy,
        targetCount: targets.length,
        symbols: targets.map((target) => target.symbol),
    });

    let updated = 0;
    let partial = 0;
    let failed = 0;

    for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        const attemptedAt = Timestamp.now();
        try {
            const snapshot = await buildEtfSnapshot({
                symbol: target.symbol,
                apiKey,
                httpClient,
            });
            await writeSuccessfulSnapshot({ target, snapshot, attemptedAt });
            updated += 1;
            if (snapshot.coverage === "partial") partial += 1;
        } catch (error) {
            failed += 1;
            await writeFailedAttempt({ target, attemptedAt, error });
            logger.error(`ETF profile sync failed for ${target.symbol}.`, {
                code: sanitizeErrorCode(error),
            });
        }

        if (index < targets.length - 1) {
            await sleep(REQUEST_DELAY_MS);
        }
    }

    return {
        initiatedBy,
        selected: targets.length,
        updated,
        partial,
        failed,
    };
}

exports.syncStockEtfProfiles = onSchedule(
    {
        schedule: "20 7 * * *",
        timeZone: "Asia/Seoul",
        region: "asia-northeast3",
        timeoutSeconds: 540,
        memory: "256MiB",
        secrets: [alphaVantageApiKeyParam],
    },
    async () => {
        const result = await runStockEtfProfileSync({
            apiKey: alphaVantageApiKeyParam.value(),
            initiatedBy: "scheduler",
        });
        logger.info("Scheduled ETF profile sync finished.", result);
        return null;
    },
);

exports.rebuildStockEtfProfileCache = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        timeoutSeconds: 540,
        memory: "256MiB",
        secrets: [alphaVantageApiKeyParam],
    },
    async (request) => {
        assertAdminFromClaims(request);
        const onlySymbols = Array.isArray(request.data?.symbols) ?
            request.data.symbols :
            [];
        if (onlySymbols.length === 0) {
            throw new HttpsError(
                "invalid-argument",
                "At least one ETF symbol is required.",
            );
        }
        return runStockEtfProfileSync({
            apiKey: alphaVantageApiKeyParam.value(),
            onlySymbols,
            force: true,
            limit: onlySymbols.length,
            initiatedBy: "admin",
        });
    },
);

exports.__private = {
    buildEtfSnapshot,
    fetchAlphaVantageEtfProfile,
    fetchIssuerHoldings,
    resolveForcedTargets,
    runStockEtfProfileSync,
};
