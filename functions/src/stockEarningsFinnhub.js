const admin = require("../firebaseAdminCompat");
const axios = require("axios");

const { Timestamp } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

const { fetchTrackedSymbolsMeta } = require("../utils/prefetchUtils");
const { assertAdminFromClaims } = require("../utils/permissions");
const {
    normalizeAlphaVantageIncomeStatement,
} = require("../utils/stockEarningsFallback");

const db = admin.firestore();

const EARNINGS_CACHE_COLLECTION = "stockEarningsCache";
const MARKET_CACHE_COLLECTION = "stockMarketCache";
const alphaVantageApiKeyParam = defineSecret("ALPHA_VANTAGE_API_KEY");

const SEC_TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const SEC_COMPANYFACTS_URL = (cik) =>
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
const SEC_USER_AGENT =
    process.env.SEC_API_USER_AGENT ||
    "Finclass/1.0 (contact: operator@example.invalid)";
const ALPHA_VANTAGE_API_URL = "https://www.alphavantage.co/query";
const SEC_CIK_OVERRIDES = Object.freeze({
    EA: { cik: 712515, companyName: "ELECTRONIC ARTS INC.", exchange: "Nasdaq" },
    SE: { cik: 1703399, companyName: "Sea Ltd", exchange: "NYSE" },
});

const REQUEST_DELAY_MS = 200;
const ALPHA_VANTAGE_REQUEST_DELAY_MS = 15000;
const REQUEST_TIMEOUT_MS = 15000;
const CACHE_STALE_DAYS = 100;
const PROFILE_MILLION_SCALE = 1_000_000;
const LOG_CONTEXT = "SEC_EARNINGS";

const REVENUE_CONCEPTS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
];
const NET_INCOME_CONCEPTS = ["NetIncomeLoss", "ProfitLoss"];
const OPERATING_INCOME_CONCEPTS = ["OperatingIncomeLoss"];
const EPS_CONCEPTS = [
    "EarningsPerShareDiluted",
    "EarningsPerShareBasicAndDiluted",
    "IncomeLossFromContinuingOperationsPerDilutedShare",
    "EarningsPerShareBasic",
];
const SHARES_CONCEPTS = [
    { namespace: "dei", concept: "EntityCommonStockSharesOutstanding", unit: "shares" },
    { namespace: "us-gaap", concept: "CommonStockSharesOutstanding", unit: "shares" },
    {
        namespace: "us-gaap",
        concept: "WeightedAverageNumberOfDilutedSharesOutstanding",
        unit: "shares",
    },
    {
        namespace: "us-gaap",
        concept: "WeightedAverageNumberOfSharesOutstandingBasic",
        unit: "shares",
    },
];

const logger = {
    info: (message, data) => console.info(`[${LOG_CONTEXT}] ${message}`, data || ""),
    warn: (message, data) => console.warn(`[${LOG_CONTEXT}] ${message}`, data || ""),
    error: (message, data) => console.error(`[${LOG_CONTEXT}] ${message}`, data || ""),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let tickerMapCache = null;

function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getNyDate(now = new Date()) {
    return new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function buildSeasonWindows(year) {
    const endOfFebruary = new Date(Date.UTC(year, 2, 0)).getUTCDate();

    return [
        {
            tag: `${year - 1}-Q4`,
            start: `${year}-01-15`,
            end: `${year}-02-${String(endOfFebruary).padStart(2, "0")}`,
        },
        { tag: `${year}-Q1`, start: `${year}-04-15`, end: `${year}-05-31` },
        { tag: `${year}-Q2`, start: `${year}-07-15`, end: `${year}-08-31` },
        { tag: `${year}-Q3`, start: `${year}-10-15`, end: `${year}-11-30` },
    ];
}

function getActiveSeason(date = getNyDate()) {
    const dateKey = formatDateKey(date);
    const windows = [
        ...buildSeasonWindows(date.getFullYear() - 1),
        ...buildSeasonWindows(date.getFullYear()),
    ];

    return (
        windows.find((window) => dateKey >= window.start && dateKey <= window.end) || null
    );
}

function toMillis(value) {
    if (!value) return null;
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.getTime();
}

function isStaleTimestamp(value, staleDays = CACHE_STALE_DAYS) {
    const millis = toMillis(value);
    if (!millis) return true;
    return Date.now() - millis > staleDays * 24 * 60 * 60 * 1000;
}

function createSecRequester() {
    let requestCount = 0;

    return async (url) => {
        if (requestCount > 0) {
            await sleep(REQUEST_DELAY_MS);
        }

        requestCount += 1;

        const response = await axios.get(url, {
            headers: {
                "User-Agent": SEC_USER_AGENT,
                Accept: "application/json",
            },
            timeout: REQUEST_TIMEOUT_MS,
        });

        return response.data;
    };
}

function toNumber(value) {
    if (value == null) return null;
    if (typeof value === "string" && value.trim() === "") return null;

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function calculatePercentChange(currentValue, previousValue) {
    const current = toNumber(currentValue);
    const previous = toNumber(previousValue);

    if (current == null || previous == null || previous === 0) {
        return null;
    }

    return ((current - previous) / Math.abs(previous)) * 100;
}

function formatCompactCurrency(value) {
    const numericValue = toNumber(value);
    if (numericValue == null) return null;

    const absValue = Math.abs(numericValue);
    if (absValue >= 1_000_000_000) {
        return `$${(numericValue / 1_000_000_000).toFixed(1)}B`;
    }
    if (absValue >= 1_000_000) {
        return `$${(numericValue / 1_000_000).toFixed(1)}M`;
    }
    if (absValue >= 1_000) {
        return `$${(numericValue / 1_000).toFixed(1)}K`;
    }
    return `$${numericValue.toFixed(2)}`;
}

function formatPercent(value) {
    const numericValue = toNumber(value);
    if (numericValue == null) return null;

    const prefix = numericValue > 0 ? "+" : "";
    return `${prefix}${numericValue.toFixed(1)}%`;
}

function resolveQuarterNumber({ period = null, fiscalPeriod = null, frame = null }) {
    const normalizedFiscalPeriod = String(fiscalPeriod || "").trim().toUpperCase();
    const fiscalMatch = normalizedFiscalPeriod.match(/^Q([1-4])$/);
    if (fiscalMatch) {
        return Number(fiscalMatch[1]);
    }

    const normalizedFrame = String(frame || "").trim().toUpperCase();
    const frameMatch = normalizedFrame.match(/Q([1-4])$/);
    if (frameMatch) {
        return Number(frameMatch[1]);
    }

    if (!period) return null;

    const parsed = new Date(`${period}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return null;

    return Math.floor(parsed.getMonth() / 3) + 1;
}

function buildQuarterLabelFromDate({ period = null, fiscalYear = null, fiscalPeriod = null, frame = null }) {
    const quarterNumber = resolveQuarterNumber({ period, fiscalPeriod, frame });
    const year = toNumber(fiscalYear);

    if (year != null && quarterNumber != null) {
        return `${year}년 ${quarterNumber}분기`;
    }

    if (!period) return "-";

    const parsed = new Date(`${period}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return period;

    return `${parsed.getFullYear()}년 ${Math.floor(parsed.getMonth() / 3) + 1}분기`;
}

function buildSummaryHeadline(latestQuarter) {
    const revenueYoY = toNumber(latestQuarter?.revenueYoYPercent);
    const netIncome = toNumber(latestQuarter?.netIncomeUSD);

    if (revenueYoY != null) {
        if (revenueYoY >= 5) {
            return "매출이 전년 동기보다 늘어난 분기예요.";
        }
        if (revenueYoY <= -5) {
            return "매출이 전년 동기보다 줄어든 분기예요.";
        }
    }

    if (netIncome != null && netIncome > 0) {
        return "최근 분기에는 흑자를 기록했어요.";
    }
    if (netIncome != null && netIncome < 0) {
        return "최근 분기에는 적자를 기록했어요.";
    }

    return "최근 분기 실적이 업데이트됐어요.";
}

function buildStudentSummary(quarters = []) {
    const latestQuarter = quarters[0];
    if (!latestQuarter) {
        return {
            headline: "최근 분기 실적이 아직 준비되지 않았어요.",
            bullets: ["최근 1년 분기 실적은 SEC 공시가 들어오면 이 탭에서 바로 볼 수 있어요."],
        };
    }

    const bullets = [];

    if (latestQuarter.actualEPS != null) {
        bullets.push(`희석 EPS는 $${latestQuarter.actualEPS.toFixed(2)}예요.`);
    }

    if (latestQuarter.revenueUSD != null) {
        const revenueYoY = formatPercent(latestQuarter.revenueYoYPercent);
        bullets.push(
            revenueYoY
                ? `매출은 ${formatCompactCurrency(latestQuarter.revenueUSD)}이고 전년 동기 대비 ${revenueYoY}예요.`
                : `매출은 ${formatCompactCurrency(latestQuarter.revenueUSD)}예요.`,
        );
    }

    if (latestQuarter.netIncomeUSD != null) {
        const netIncomeYoY = formatPercent(latestQuarter.netIncomeYoYPercent);
        bullets.push(
            netIncomeYoY
                ? `순이익은 ${formatCompactCurrency(latestQuarter.netIncomeUSD)}이고 전년 동기 대비 ${netIncomeYoY}예요.`
                : `순이익은 ${formatCompactCurrency(latestQuarter.netIncomeUSD)}예요.`,
        );
    }

    return {
        headline: buildSummaryHeadline(latestQuarter),
        bullets: bullets.slice(0, 3),
    };
}

function normalizeCompanyName(name, fallbackCompanyName, symbol) {
    return String(name || fallbackCompanyName || symbol).trim() || symbol;
}

function isQuarterDurationEntry(entry) {
    if (!entry?.start || !entry?.end) return false;

    const start = new Date(`${entry.start}T12:00:00`);
    const end = new Date(`${entry.end}T12:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;

    const durationDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    return durationDays >= 70 && durationDays <= 120;
}

function compareFacts(left, right) {
    const leftFiled = new Date(left?.filed || 0).getTime();
    const rightFiled = new Date(right?.filed || 0).getTime();
    if (leftFiled !== rightFiled) return rightFiled - leftFiled;

    const leftAccn = String(left?.accn || "");
    const rightAccn = String(right?.accn || "");
    return rightAccn.localeCompare(leftAccn);
}

function getConceptUnits(companyFacts, namespace, conceptName, unitName = null) {
    const concept = companyFacts?.facts?.[namespace]?.[conceptName];
    if (!concept?.units) return [];

    if (unitName && Array.isArray(concept.units?.[unitName])) {
        return concept.units[unitName];
    }

    const firstUnit = Object.values(concept.units).find((value) => Array.isArray(value));
    return Array.isArray(firstUnit) ? firstUnit : [];
}

function getMetricEntries(companyFacts, conceptNames, unitName = null) {
    let best = { conceptName: null, entries: [], latestEnd: 0, latestFiled: 0, count: 0 };

    for (const conceptName of conceptNames) {
        const entries = getConceptUnits(companyFacts, "us-gaap", conceptName, unitName);
        if (entries.length > 0) {
            const quarterEntries = entries.filter(isQuarterDurationEntry);
            const candidateEntries = quarterEntries.length > 0 ? quarterEntries : entries;
            const latestEnd = Math.max(
                ...candidateEntries.map((entry) => new Date(`${entry.end || ""}T12:00:00`).getTime() || 0),
            );
            const latestFiled = Math.max(
                ...candidateEntries.map((entry) => new Date(entry.filed || 0).getTime() || 0),
            );

            if (
                latestEnd > best.latestEnd ||
                (latestEnd === best.latestEnd && latestFiled > best.latestFiled) ||
                (
                    latestEnd === best.latestEnd &&
                    latestFiled === best.latestFiled &&
                    candidateEntries.length > best.count
                )
            ) {
                best = {
                    conceptName,
                    entries,
                    latestEnd,
                    latestFiled,
                    count: candidateEntries.length,
                };
            }
        }
    }

    return { conceptName: best.conceptName, entries: best.entries };
}

function selectQuarterMetricMap(entries) {
    const map = new Map();

    entries
        .filter(isQuarterDurationEntry)
        .sort(compareFacts)
        .forEach((entry) => {
            const period = String(entry.end || "").trim();
            if (!period || map.has(period)) {
                return;
            }

            map.set(period, {
                period,
                value: toNumber(entry.val),
                filed: entry.filed || null,
                form: entry.form || null,
                frame: entry.frame || null,
                fy: toNumber(entry.fy),
                fp: entry.fp || null,
            });
        });

    return map;
}

function selectLatestInstantValue(companyFacts) {
    let best = null;

    SHARES_CONCEPTS.forEach(({ namespace, concept, unit }) => {
        const entries = getConceptUnits(companyFacts, namespace, concept, unit);
        entries
            .filter((entry) => entry?.end && toNumber(entry.val) != null)
            .sort(compareFacts)
            .forEach((entry) => {
                if (!best) {
                    best = {
                        concept,
                        namespace,
                        end: entry.end,
                        filed: entry.filed || null,
                        value: toNumber(entry.val),
                    };
                }
            });
    });

    return best;
}

function mergeQuarterData({ revenueEntries = [], netIncomeEntries = [], operatingIncomeEntries = [], epsEntries = [] }) {
    const revenueMap = selectQuarterMetricMap(revenueEntries);
    const netIncomeMap = selectQuarterMetricMap(netIncomeEntries);
    const operatingIncomeMap = selectQuarterMetricMap(operatingIncomeEntries);
    const epsMap = selectQuarterMetricMap(epsEntries);

    const allPeriods = new Set([
        ...revenueMap.keys(),
        ...netIncomeMap.keys(),
        ...operatingIncomeMap.keys(),
        ...epsMap.keys(),
    ]);

    const quarters = Array.from(allPeriods)
        .sort((left, right) => new Date(`${right}T12:00:00`) - new Date(`${left}T12:00:00`))
        .map((period) => {
            const revenue = revenueMap.get(period);
            const netIncome = netIncomeMap.get(period);
            const operatingIncome = operatingIncomeMap.get(period);
            const eps = epsMap.get(period);
            const representative = revenue || netIncome || operatingIncome || eps || {};

            return {
                period,
                year: representative.fy || new Date(`${period}T12:00:00`).getFullYear(),
                quarter: resolveQuarterNumber({
                    period,
                    fiscalPeriod: representative.fp,
                    frame: representative.frame,
                }),
                fiscalPeriod: representative.fp || null,
                frame: representative.frame || null,
                label: buildQuarterLabelFromDate({
                    period,
                    fiscalYear: representative.fy,
                    fiscalPeriod: representative.fp,
                    frame: representative.frame,
                }),
                actualEPS: eps?.value ?? null,
                estimateEPS: null,
                surpriseEPS: null,
                surprisePercent: null,
                revenueUSD: revenue?.value ?? null,
                netIncomeUSD: netIncome?.value ?? null,
                operatingIncomeUSD: operatingIncome?.value ?? null,
                grossIncomeUSD: null,
                unitScale: 1,
                filedAt: representative.filed || null,
                form: representative.form || null,
            };
        })
        .filter(
            (entry) =>
                entry.actualEPS != null ||
                entry.revenueUSD != null ||
                entry.netIncomeUSD != null ||
                entry.operatingIncomeUSD != null,
        )
        .slice(0, 4);

    const latestQuarter = quarters[0] || null;
    const previousQuarter = quarters[1] || null;
    const yearAgoQuarter = quarters[3] || null;

    if (latestQuarter) {
        latestQuarter.revenueQoQPercent = calculatePercentChange(
            latestQuarter.revenueUSD,
            previousQuarter?.revenueUSD,
        );
        latestQuarter.netIncomeQoQPercent = calculatePercentChange(
            latestQuarter.netIncomeUSD,
            previousQuarter?.netIncomeUSD,
        );
        latestQuarter.revenueYoYPercent = calculatePercentChange(
            latestQuarter.revenueUSD,
            yearAgoQuarter?.revenueUSD,
        );
        latestQuarter.netIncomeYoYPercent = calculatePercentChange(
            latestQuarter.netIncomeUSD,
            yearAgoQuarter?.netIncomeUSD,
        );
    }

    return {
        latestQuarter,
        quarters,
        studentSummary: buildStudentSummary(quarters),
    };
}

async function fetchSecTickerMap(requestSec) {
    if (tickerMapCache) {
        return tickerMapCache;
    }

    const response = await requestSec(SEC_TICKER_MAP_URL);
    const dataRows = Array.isArray(response?.data) ? response.data : [];
    const map = new Map();

    dataRows.forEach((row) => {
        if (!Array.isArray(row) || row.length < 4) {
            return;
        }

        const cik = toNumber(row[0]);
        const companyName = String(row[1] || "").trim();
        const ticker = String(row[2] || "").trim().toUpperCase();
        const exchange = String(row[3] || "").trim() || null;

        if (!ticker || cik == null) {
            return;
        }

        map.set(ticker, {
            cik,
            companyName,
            exchange,
        });
    });

    Object.entries(SEC_CIK_OVERRIDES).forEach(([ticker, metadata]) => {
        if (!map.has(ticker)) map.set(ticker, metadata);
    });

    tickerMapCache = map;
    return map;
}

async function fetchAlphaVantageIncomeStatement({ symbol, apiKey, httpClient = axios }) {
    if (!apiKey) return null;

    const response = await httpClient.get(ALPHA_VANTAGE_API_URL, {
        params: {
            function: "INCOME_STATEMENT",
            symbol,
            apikey: apiKey,
        },
        timeout: REQUEST_TIMEOUT_MS,
    });
    return normalizeAlphaVantageIncomeStatement(response.data, symbol);
}

function createAlphaVantageIncomeStatementRequester(apiKey, httpClient = axios) {
    let lastRequestAt = 0;

    return async (symbol) => {
        const remainingDelay = Math.max(
            0,
            ALPHA_VANTAGE_REQUEST_DELAY_MS - (Date.now() - lastRequestAt),
        );
        if (lastRequestAt > 0 && remainingDelay > 0) {
            await sleep(remainingDelay);
        }
        lastRequestAt = Date.now();
        return fetchAlphaVantageIncomeStatement({ symbol, apiKey, httpClient });
    };
}

async function fetchQuotePriceMap() {
    const snapshot = await db.collection(MARKET_CACHE_COLLECTION).get();
    const priceMap = new Map();

    snapshot.forEach((docSnap) => {
        const data = docSnap.data() || {};
        priceMap.set(docSnap.id, {
            currentPriceUSD: toNumber(data.currentPriceUSD),
            previousCloseUSD: toNumber(data.previousCloseUSD),
            lastFetched: data.lastFetched || null,
        });
    });

    return priceMap;
}

function normalizeProfile({ symbolMeta, secMeta, companyFacts, sharesOutstanding, quoteInfo }) {
    const currentPriceUSD =
        quoteInfo?.currentPriceUSD != null
            ? quoteInfo.currentPriceUSD
            : quoteInfo?.previousCloseUSD ?? null;
    const marketCapUSD =
        sharesOutstanding != null && currentPriceUSD != null
            ? sharesOutstanding * currentPriceUSD
            : null;

    return {
        symbol: symbolMeta.symbol,
        companyName: normalizeCompanyName(
            companyFacts?.entityName,
            secMeta?.companyName || symbolMeta.companyName,
            symbolMeta.symbol,
        ),
        exchange: secMeta?.exchange || null,
        industry: null,
        ipoDate: null,
        logoUrl: null,
        websiteUrl: null,
        marketCapMillionsUSD:
            marketCapUSD == null ? null : marketCapUSD / PROFILE_MILLION_SCALE,
        marketCapUSD,
        sharesOutstandingMillions:
            sharesOutstanding == null ? null : sharesOutstanding / PROFILE_MILLION_SCALE,
        sharesOutstanding,
        unitNotes: {
            marketCap: "usd",
            sharesOutstanding: "shares",
        },
    };
}

async function buildSymbolSnapshot({
    symbolMeta,
    secMeta,
    requestSec,
    quotePriceMap,
    requestAlphaVantageIncomeStatement = null,
}) {
    if (!secMeta?.cik) {
        throw new Error(`Missing SEC CIK mapping for ${symbolMeta.symbol}`);
    }

    const companyFacts = await requestSec(SEC_COMPANYFACTS_URL(secMeta.cik));
    const { entries: revenueEntries, conceptName: revenueConcept } = getMetricEntries(
        companyFacts,
        REVENUE_CONCEPTS,
        "USD",
    );
    const { entries: netIncomeEntries, conceptName: netIncomeConcept } = getMetricEntries(
        companyFacts,
        NET_INCOME_CONCEPTS,
        "USD",
    );
    const { entries: operatingIncomeEntries, conceptName: operatingIncomeConcept } =
        getMetricEntries(companyFacts, OPERATING_INCOME_CONCEPTS, "USD");
    const { entries: epsEntries, conceptName: epsConcept } = getMetricEntries(
        companyFacts,
        EPS_CONCEPTS,
        "USD/shares",
    );

    const merged = mergeQuarterData({
        revenueEntries,
        netIncomeEntries,
        operatingIncomeEntries,
        epsEntries,
    });
    let financials = merged;
    let financialSource = "sec";

    if (merged.quarters.length === 0 && requestAlphaVantageIncomeStatement) {
        const fallback = await requestAlphaVantageIncomeStatement(symbolMeta.symbol);
        if (fallback?.periods?.length > 0) {
            financials = {
                latestQuarter: fallback.latestPeriod,
                quarters: fallback.periods,
                studentSummary: {
                    headline: fallback.periodType === "annual"
                        ? "최근 연간 실적을 확인했어요."
                        : "최근 분기 실적을 확인했어요.",
                    bullets: [],
                },
            };
            financialSource = fallback.source;
        }
    }

    const latestSharesOutstanding = selectLatestInstantValue(companyFacts);
    const normalizedProfile = normalizeProfile({
        symbolMeta,
        secMeta,
        companyFacts,
        sharesOutstanding: latestSharesOutstanding?.value ?? null,
        quoteInfo: quotePriceMap.get(symbolMeta.symbol),
    });

    return {
        symbol: symbolMeta.symbol,
        companyName: normalizedProfile.companyName,
        categoryName: symbolMeta.categoryName || null,
        profile: normalizedProfile,
        latestQuarter: financials.latestQuarter,
        quarters: financials.quarters,
        studentSummary: financials.studentSummary,
        metadata: {
            cik: secMeta.cik,
            revenueConcept,
            netIncomeConcept,
            operatingIncomeConcept,
            epsConcept,
            sharesOutstandingConcept: latestSharesOutstanding?.concept || null,
            sharesOutstandingFiledAt: latestSharesOutstanding?.filed || null,
            earningsQuarterCount: financials.quarters.length,
            reportedCurrency: financials.latestQuarter?.reportedCurrency || "USD",
            periodType: financials.latestQuarter?.periodType || "quarterly",
            financialSource,
            isEarningsSeasonPreferred: false,
            marketCapUsesQuoteCache: normalizedProfile.marketCapUSD != null,
        },
        source: financialSource,
    };
}

async function resolveSyncTargets({ trackedSymbols, forceFullSync, currentSeason }) {
    if (forceFullSync || currentSeason) {
        return trackedSymbols;
    }

    const cacheSnapshot = await db.collection(EARNINGS_CACHE_COLLECTION).get();
    const cacheBySymbol = new Map(
        cacheSnapshot.docs.map((docSnap) => [docSnap.id, docSnap.data() || {}]),
    );

    return trackedSymbols.filter((symbolMeta) => {
        const cached = cacheBySymbol.get(symbolMeta.symbol);
        const hasFinancialPeriods = Array.isArray(cached?.quarters) && cached.quarters.length > 0;
        return !cached || !hasFinancialPeriods || isStaleTimestamp(cached.lastSyncedAt);
    });
}

async function syncStockEarningsCacheInternal(options = {}) {
    const {
        forceFullSync = false,
        onlySymbols = null,
        initiatedBy = "scheduler",
        alphaVantageApiKey = null,
    } = options;

    const trackedSymbols = await fetchTrackedSymbolsMeta({
        excludeIndices: true,
        excludeEtf: true,
    });
    const symbolFilter = Array.isArray(onlySymbols)
        ? new Set(
            onlySymbols
                .map((symbol) => String(symbol || "").trim().toUpperCase())
                .filter(Boolean),
        )
        : null;
    const filteredSymbols = symbolFilter
        ? trackedSymbols.filter((symbolMeta) => symbolFilter.has(symbolMeta.symbol))
        : trackedSymbols;
    const currentSeason = getActiveSeason(getNyDate());
    const targets = await resolveSyncTargets({
        trackedSymbols: filteredSymbols,
        forceFullSync,
        currentSeason,
    });

    logger.info("Starting SEC earnings sync.", {
        initiatedBy,
        trackedCount: filteredSymbols.length,
        targetCount: targets.length,
        season: currentSeason?.tag || null,
        forceFullSync,
    });

    if (targets.length === 0) {
        return {
            initiatedBy,
            season: currentSeason?.tag || null,
            updated: 0,
            failed: 0,
            skipped: filteredSymbols.length,
            totalTracked: filteredSymbols.length,
        };
    }

    const requestSec = createSecRequester();
    const [secTickerMap, quotePriceMap] = await Promise.all([
        fetchSecTickerMap(requestSec),
        fetchQuotePriceMap(),
    ]);
    const requestAlphaVantageIncomeStatement = alphaVantageApiKey
        ? createAlphaVantageIncomeStatementRequester(alphaVantageApiKey)
        : null;

    let batch = db.batch();
    let pendingWrites = 0;
    let updated = 0;
    let failed = 0;
    const syncedAt = Timestamp.now();

    for (const symbolMeta of targets) {
        try {
            const secMeta = secTickerMap.get(symbolMeta.symbol);
            const snapshot = await buildSymbolSnapshot({
                symbolMeta,
                secMeta,
                requestSec,
                quotePriceMap,
                requestAlphaVantageIncomeStatement,
            });

            batch.set(
                db.collection(EARNINGS_CACHE_COLLECTION).doc(symbolMeta.symbol),
                {
                    ...snapshot,
                    seasonTag: currentSeason?.tag || null,
                    lastSyncedAt: syncedAt,
                    syncMode:
                        currentSeason || forceFullSync
                            ? "full"
                            : "maintenance",
                },
                { merge: true },
            );
            pendingWrites += 1;
            updated += 1;

            if (pendingWrites >= 100) {
                await batch.commit();
                batch = db.batch();
                pendingWrites = 0;
            }
        } catch (error) {
            failed += 1;
            logger.error(`Failed to sync ${symbolMeta.symbol}.`, {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
            });
        }
    }

    if (pendingWrites > 0) {
        await batch.commit();
    }

    return {
        initiatedBy,
        season: currentSeason?.tag || null,
        updated,
        failed,
        skipped: filteredSymbols.length - targets.length,
        totalTracked: filteredSymbols.length,
    };
}

exports.syncStockEarningsFinnhub = onSchedule(
    {
        schedule: "0 8 * * 6",
        timeZone: "Asia/Seoul",
        region: "asia-northeast3",
        timeoutSeconds: 540,
        memory: "512MiB",
        secrets: [alphaVantageApiKeyParam],
    },
    async () => {
        const result = await syncStockEarningsCacheInternal({
            initiatedBy: "scheduler",
            alphaVantageApiKey: alphaVantageApiKeyParam.value(),
        });

        logger.info("Weekly SEC earnings sync finished.", result);
        return null;
    },
);

exports.rebuildStockEarningsCache = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        timeoutSeconds: 540,
        memory: "512MiB",
        secrets: [alphaVantageApiKeyParam],
    },
    async (request) => {
        assertAdminFromClaims(request);

        try {
            const result = await syncStockEarningsCacheInternal({
                forceFullSync: request.data?.forceFullSync !== false,
                onlySymbols: request.data?.symbols || null,
                initiatedBy: "callable",
                alphaVantageApiKey: alphaVantageApiKeyParam.value(),
            });

            return {
                success: true,
                ...result,
            };
        } catch (error) {
            logger.error("Manual SEC earnings rebuild failed.", error);
            throw new HttpsError(
                "internal",
                `Failed to rebuild stock earnings cache: ${error.message}`,
            );
        }
    },
);
