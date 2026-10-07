const admin = require("../firebaseAdminCompat");
const axios = require("axios");
const { defineSecret } = require("firebase-functions/params");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { mustBeTeacherOrTaxAdmin } = require("../utils/permissions");
const {
    STOCK_CATALOG,
    STOCK_CATEGORY_DEFINITIONS,
} = require("../utils/stockCatalog");
const {
    StockCatalogValidationError,
    authorizeStockCatalogActor,
    buildAliasMap,
    buildCatalogSymbol,
    buildFinnhubEvidence,
    categoryMatchesType,
    findCatalogDuplicate,
    normalizeTextList,
    validateTickerInput,
} = require("../utils/stockCatalogRegistration");

const db = admin.firestore();
const finnhubApiKeyParam = defineSecret("FINNHUB_API_KEY");
const aliasMap = buildAliasMap(STOCK_CATALOG);
const categoryById = new Map(STOCK_CATEGORY_DEFINITIONS.map((category) => [category.id, category]));

const assertTeacherRequest = async (request) => {
    try {
        return await authorizeStockCatalogActor({
            uid: request.auth?.uid,
            classId: request.data?.classId,
        }, mustBeTeacherOrTaxAdmin);
    } catch (error) {
        if (error instanceof StockCatalogValidationError) {
            throw new HttpsError(error.code, error.message, error.details);
        }
        throw error;
    }
};

const loadGlobalCategories = async () => {
    const snapshot = await db.collection("stockCategories").get();
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
};

const assertNewTicker = async (ticker) => {
    const suggestedTicker = aliasMap.get(ticker);
    if (suggestedTicker) {
        throw new HttpsError(
            "already-exists",
            `${ticker}는 현재 ${suggestedTicker} 티커로 운영 중입니다.`,
            { ticker, suggestedTicker },
        );
    }
    const duplicate = findCatalogDuplicate(await loadGlobalCategories(), ticker);
    if (duplicate) {
        throw new HttpsError(
            "already-exists",
            `${ticker}는 이미 ${duplicate.categoryName || "전역 카탈로그"}에 등록되어 있습니다.`,
            duplicate,
        );
    }
};

const fetchFinnhubEvidence = async (ticker, apiKey) => {
    try {
        const [quoteResponse, profileResponse, searchResponse] = await Promise.all([
            axios.get("https://finnhub.io/api/v1/quote", {
                params: { symbol: ticker, token: apiKey },
                timeout: 10000,
            }),
            axios.get("https://finnhub.io/api/v1/stock/profile2", {
                params: { symbol: ticker, token: apiKey },
                timeout: 10000,
            }),
            axios.get("https://finnhub.io/api/v1/search", {
                params: { q: ticker, exchange: "US", token: apiKey },
                timeout: 10000,
            }),
        ]);
        return buildFinnhubEvidence({
            ticker,
            quote: quoteResponse.data || {},
            profile: profileResponse.data || {},
            matches: searchResponse.data?.result || [],
        });
    } catch (error) {
        if (error instanceof StockCatalogValidationError) {
            throw new HttpsError(error.code, error.message, error.details);
        }
        const status = error.response?.status;
        console.error("[stockCatalogRegistration] Finnhub validation failed", {
            ticker,
            status,
            message: error.message,
        });
        throw new HttpsError(
            status === 429 ? "resource-exhausted" : "unavailable",
            status === 429
                ? "종목 조회 요청이 많습니다. 잠시 후 다시 시도해주세요."
                : "가격 API에서 종목을 확인하지 못했습니다.",
        );
    }
};

const validateTickerRequest = (request) => {
    try {
        return validateTickerInput(request.data?.ticker);
    } catch (error) {
        throw new HttpsError("invalid-argument", error.message);
    }
};

exports.validateStockCatalogSymbol = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        timeoutSeconds: 30,
        secrets: [finnhubApiKeyParam],
    },
    async (request) => {
        await assertTeacherRequest(request);
        const ticker = validateTickerRequest(request);
        await assertNewTicker(ticker);
        const evidence = await fetchFinnhubEvidence(ticker, finnhubApiKeyParam.value());
        return { success: true, evidence };
    },
);

exports.registerStockCatalogSymbol = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        timeoutSeconds: 60,
        secrets: [finnhubApiKeyParam],
    },
    async (request) => {
        const actor = await assertTeacherRequest(request);
        const ticker = validateTickerRequest(request);
        const categoryId = String(request.data?.categoryId || "").trim();
        const category = categoryById.get(categoryId);
        if (!category) throw new HttpsError("invalid-argument", "주 카테고리를 선택해주세요.");

        await assertNewTicker(ticker);
        const evidence = await fetchFinnhubEvidence(ticker, finnhubApiKeyParam.value());
        if (!categoryMatchesType(category, evidence.securityType)) {
            throw new HttpsError(
                "invalid-argument",
                `${evidence.securityType} 종목은 ${category.type} 카테고리에 등록할 수 없습니다.`,
            );
        }

        const registeredAt = admin.firestore.Timestamp.now();
        const catalogSymbol = {
            ...buildCatalogSymbol({
                evidence,
                category,
                actor,
                explorationKeywords: normalizeTextList(request.data?.explorationKeywords, 2),
            }),
            registeredAt,
        };
        const categoryRef = db.collection("stockCategories").doc(category.id);
        const registrationRef = db.collection("stockCatalogRegistrations").doc(ticker);
        const cacheRef = db.collection("stockMarketCache").doc(ticker);
        const summaryRef = db.collection("stockMarketSummary").doc("today_quotes_all");

        await db.runTransaction(async (transaction) => {
            const [categorySnap, registrationSnap] = await Promise.all([
                transaction.get(categoryRef),
                transaction.get(registrationRef),
            ]);
            if (!categorySnap.exists) {
                throw new HttpsError(
                    "failed-precondition",
                    "전역 카탈로그 분류가 아직 적용되지 않았습니다. 먼저 카탈로그 동기화가 필요합니다.",
                );
            }
            if (registrationSnap.exists) {
                throw new HttpsError("already-exists", `${ticker}는 이미 등록 처리되었습니다.`);
            }
            const currentCategory = categorySnap.data() || {};
            const symbols = Array.isArray(currentCategory.symbols) ? currentCategory.symbols : [];
            if (findCatalogDuplicate([{ id: category.id, ...currentCategory }], ticker)) {
                throw new HttpsError("already-exists", `${ticker}는 이미 등록되어 있습니다.`);
            }

            transaction.update(categoryRef, {
                symbols: [...symbols, catalogSymbol],
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            transaction.set(registrationRef, {
                ...catalogSymbol,
                status: "active",
                apiEvidence: {
                    exchange: evidence.exchange,
                    currency: evidence.currency,
                    country: evidence.country,
                    industry: evidence.industry,
                    currentPriceUSD: evidence.currentPriceUSD,
                    previousCloseUSD: evidence.previousCloseUSD,
                    validatedAt: registeredAt,
                    source: "finnhub",
                },
                registeredByEmail: String(request.auth?.token?.email || "").trim(),
            });
            transaction.set(cacheRef, {
                currentPriceUSD: evidence.currentPriceUSD,
                previousCloseUSD: evidence.previousCloseUSD,
                dailyHighUSD: evidence.dailyHighUSD,
                dailyLowUSD: evidence.dailyLowUSD,
                openPriceUSD: evidence.openPriceUSD,
                changeUSD: evidence.changeUSD,
                changePercent: evidence.changePercent,
                volume: 0,
                lastFetched: registeredAt,
                source: "finnhub",
            }, { merge: true });
            transaction.set(summaryRef, {
                [ticker]: {
                    current: evidence.currentPriceUSD,
                    previousClose: evidence.previousCloseUSD,
                    name: evidence.companyName,
                    lastFetched: registeredAt,
                    source: "finnhub",
                    dailyHighUSD: evidence.dailyHighUSD,
                    dailyLowUSD: evidence.dailyLowUSD,
                    openPriceUSD: evidence.openPriceUSD,
                    changeUSD: evidence.changeUSD,
                    changePercent: evidence.changePercent,
                    volume: 0,
                },
            }, { merge: true });
        });

        return {
            success: true,
            stock: {
                ticker,
                companyName: evidence.companyName,
                securityType: evidence.securityType,
                categoryId: category.id,
                categoryName: category.name,
                defaultVisible: false,
            },
        };
    },
);

exports.__private = {
    assertTeacherRequest,
    fetchFinnhubEvidence,
};
