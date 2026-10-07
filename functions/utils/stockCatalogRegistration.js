const TICKER_PATTERN = /^[A-Z0-9-]{1,12}$/;

const normalizeTicker = (value) =>
    String(value || "").trim().toUpperCase().replaceAll(".", "-");

const normalizeTextList = (values, maxItems = 2) =>
    Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => String(value || "").trim())
            .filter(Boolean),
    )).slice(0, maxItems);

const buildAliasMap = (catalog = []) => {
    const aliases = new Map();
    catalog.forEach((stock) => {
        const ticker = normalizeTicker(stock?.ticker);
        (Array.isArray(stock?.aliases) ? stock.aliases : []).forEach((alias) => {
            const normalizedAlias = normalizeTicker(alias);
            if (ticker && normalizedAlias) aliases.set(normalizedAlias, ticker);
        });
    });
    return aliases;
};

const validateTickerInput = (value) => {
    const ticker = normalizeTicker(value);
    if (!TICKER_PATTERN.test(ticker)) {
        throw new Error("티커는 영문 대문자, 숫자, 하이픈으로 1~12자여야 합니다.");
    }
    return ticker;
};

const inferSecurityType = ({ searchType = "", name = "" } = {}) => {
    const normalizedType = String(searchType || "").trim().toUpperCase();
    const normalizedName = String(name || "").trim().toUpperCase();
    if (/ETF|ETP|FUND|TRUST/.test(normalizedType) || /\bETF\b|\bFUND\b/.test(normalizedName)) {
        return "ETF";
    }
    return "주식";
};

const isOtcListing = ({ exchange = "", searchType = "" } = {}) =>
    /OTC|PINK SHEET|GREY MARKET/i.test(`${exchange} ${searchType}`);

const categoryMatchesType = (category, securityType) =>
    Boolean(category) && category.type === securityType;

class StockCatalogValidationError extends Error {
    constructor(message, details = undefined, code = "failed-precondition") {
        super(message);
        this.name = "StockCatalogValidationError";
        this.details = details;
        this.code = code;
    }
}

const authorizeStockCatalogActor = async ({ uid, classId }, authorize) => {
    const normalizedUid = String(uid || "").trim();
    const normalizedClassId = String(classId || "").trim();
    if (!normalizedUid) {
        throw new StockCatalogValidationError("로그인이 필요합니다.", undefined, "unauthenticated");
    }
    if (!normalizedClassId) {
        throw new StockCatalogValidationError(
            "학급 정보가 필요합니다.",
            undefined,
            "invalid-argument",
        );
    }
    await authorize(normalizedClassId, normalizedUid, { teacherOnly: true });
    return { uid: normalizedUid, classId: normalizedClassId };
};

const buildFinnhubEvidence = ({ ticker: tickerValue, quote = {}, profile = {}, matches = [] }) => {
    const ticker = validateTickerInput(tickerValue);
    const exactMatch = (Array.isArray(matches) ? matches : []).find((item) =>
        normalizeTicker(item?.symbol || item?.displaySymbol) === ticker,
    ) || null;
    const resolvedTicker = normalizeTicker(
        profile?.ticker || exactMatch?.symbol || exactMatch?.displaySymbol,
    );
    const currentPriceUSD = Number(quote?.c || 0);
    const previousCloseUSD = Number(quote?.pc || 0);
    const companyName = String(profile?.name || exactMatch?.description || "").trim();
    const exchange = String(profile?.exchange || exactMatch?.exchange || "").trim();
    const currency = String(profile?.currency || "USD").trim().toUpperCase();
    const searchType = String(exactMatch?.type || "").trim();

    if (!resolvedTicker || resolvedTicker !== ticker) {
        throw new StockCatalogValidationError(
            resolvedTicker
                ? `${ticker} 대신 현재 티커 ${resolvedTicker}가 조회됩니다.`
                : `${ticker} 종목 정보를 찾지 못했습니다.`,
            resolvedTicker ? { ticker, suggestedTicker: resolvedTicker } : { ticker },
        );
    }
    if (!companyName || (currentPriceUSD <= 0 && previousCloseUSD <= 0)) {
        throw new StockCatalogValidationError(
            `${ticker}의 종목 정보와 유효한 가격을 함께 확인하지 못했습니다.`,
        );
    }
    if (isOtcListing({ exchange, searchType })) {
        throw new StockCatalogValidationError(
            "OTC 종목은 현재 Finclass 거래 시간과 운영 정책상 등록할 수 없습니다.",
        );
    }
    if (currency && currency !== "USD") {
        throw new StockCatalogValidationError(
            `${currency} 통화 종목은 현재 미국 주식 카탈로그에 등록할 수 없습니다.`,
        );
    }

    return {
        ticker,
        companyName,
        securityType: inferSecurityType({ searchType, name: companyName }),
        exchange,
        currency: currency || "USD",
        country: String(profile?.country || "").trim(),
        industry: String(profile?.finnhubIndustry || "").trim(),
        currentPriceUSD: currentPriceUSD > 0 ? currentPriceUSD : previousCloseUSD,
        previousCloseUSD: previousCloseUSD > 0 ? previousCloseUSD : currentPriceUSD,
        dailyHighUSD: Number(quote?.h || 0) || null,
        dailyLowUSD: Number(quote?.l || 0) || null,
        openPriceUSD: Number(quote?.o || 0) || null,
        changeUSD: Number.isFinite(Number(quote?.d)) ? Number(quote.d) : null,
        changePercent: Number.isFinite(Number(quote?.dp)) ? Number(quote.dp) : null,
        searchType,
    };
};

const findCatalogDuplicate = (categoryDocuments = [], tickerValue = "") => {
    const ticker = normalizeTicker(tickerValue);
    for (const category of categoryDocuments) {
        for (const stock of Array.isArray(category?.symbols) ? category.symbols : []) {
            const currentTicker = normalizeTicker(stock?.ticker || stock?.symbol || stock);
            const aliases = (Array.isArray(stock?.aliases) ? stock.aliases : []).map(normalizeTicker);
            if (currentTicker === ticker || aliases.includes(ticker)) {
                return {
                    ticker: currentTicker,
                    categoryId: category.id || "",
                    categoryName: category.name || "",
                };
            }
        }
    }
    return null;
};

const buildCatalogSymbol = ({ evidence, category, actor, explorationKeywords }) => ({
    ticker: evidence.ticker,
    companyName: evidence.companyName,
    type: evidence.securityType,
    defaultVisible: false,
    aliases: [],
    explorationKeywords: normalizeTextList(explorationKeywords, 2),
    riskTags: [],
    exchange: evidence.exchange,
    currency: evidence.currency,
    industry: evidence.industry,
    categoryId: category.id,
    categoryName: category.name,
    source: "teacher_registration",
    registeredByUid: actor.uid,
    registeredFromClassId: actor.classId,
});

module.exports = {
    StockCatalogValidationError,
    authorizeStockCatalogActor,
    buildAliasMap,
    buildCatalogSymbol,
    buildFinnhubEvidence,
    categoryMatchesType,
    findCatalogDuplicate,
    inferSecurityType,
    isOtcListing,
    normalizeTextList,
    normalizeTicker,
    validateTickerInput,
};
