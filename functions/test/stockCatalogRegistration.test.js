const test = require("node:test");
const assert = require("node:assert/strict");

const {
    StockCatalogValidationError,
    authorizeStockCatalogActor,
    buildAliasMap,
    buildCatalogSymbol,
    buildFinnhubEvidence,
    categoryMatchesType,
    findCatalogDuplicate,
    inferSecurityType,
    isOtcListing,
    validateTickerInput,
} = require("../utils/stockCatalogRegistration");

const validApiPayload = {
    ticker: "NEW",
    quote: { c: 25.5, pc: 24, h: 26, l: 23.5, o: 24.2, d: 1.5, dp: 6.25 },
    profile: {
        ticker: "NEW",
        name: "New Company",
        exchange: "NASDAQ NMS - GLOBAL MARKET",
        currency: "USD",
        country: "US",
        finnhubIndustry: "Technology",
    },
    matches: [{ symbol: "NEW", type: "Common Stock", description: "New Company" }],
};

test("normalizes dot tickers and rejects unsupported input", () => {
    assert.equal(validateTickerInput(" brk.b "), "BRK-B");
    assert.throws(() => validateTickerInput("bad ticker"), /티커/);
});

test("recognizes ETF search results and OTC listings", () => {
    assert.equal(inferSecurityType({ searchType: "ETP", name: "Example" }), "ETF");
    assert.equal(inferSecurityType({ searchType: "Common Stock", name: "Example Inc" }), "주식");
    assert.equal(isOtcListing({ exchange: "OTC Markets" }), true);
});

test("finds duplicates by current ticker and alias", () => {
    const categories = [{
        id: "finance",
        name: "금융·핀테크",
        symbols: [{ ticker: "XYZ", aliases: ["SQ"] }],
    }];
    assert.equal(findCatalogDuplicate(categories, "XYZ").ticker, "XYZ");
    assert.equal(findCatalogDuplicate(categories, "sq").ticker, "XYZ");
    assert.equal(findCatalogDuplicate(categories, "NEW"), null);
});

test("builds a default-hidden audited symbol", () => {
    const symbol = buildCatalogSymbol({
        evidence: {
            ticker: "NEW",
            companyName: "New Company",
            securityType: "주식",
            exchange: "NASDAQ",
            currency: "USD",
            industry: "Technology",
        },
        category: { id: "software", name: "소프트웨어·인터넷", type: "주식" },
        actor: { uid: "teacher-a", classId: "class-a" },
        explorationKeywords: ["AI·로봇", "AI·로봇", "데이터센터"],
    });
    assert.equal(symbol.defaultVisible, false);
    assert.deepEqual(symbol.explorationKeywords, ["AI·로봇", "데이터센터"]);
    assert.equal(symbol.registeredByUid, "teacher-a");
});

test("requires category and security types to match", () => {
    assert.equal(categoryMatchesType({ type: "ETF" }, "ETF"), true);
    assert.equal(categoryMatchesType({ type: "주식" }, "ETF"), false);
});

test("builds the reviewed alias lookup", () => {
    const aliases = buildAliasMap([{ ticker: "XYZ", aliases: ["SQ"] }]);
    assert.equal(aliases.get("SQ"), "XYZ");
});

test("builds evidence only when ticker, metadata, and a live price agree", () => {
    const evidence = buildFinnhubEvidence(validApiPayload);
    assert.equal(evidence.ticker, "NEW");
    assert.equal(evidence.companyName, "New Company");
    assert.equal(evidence.currentPriceUSD, 25.5);
    assert.equal(evidence.securityType, "주식");
});

test("rejects API results without a usable price", () => {
    assert.throws(
        () => buildFinnhubEvidence({
            ...validApiPayload,
            quote: { c: 0, pc: 0 },
        }),
        (error) => error instanceof StockCatalogValidationError && /유효한 가격/.test(error.message),
    );
});

test("rejects renamed, OTC, and non-USD securities", () => {
    assert.throws(
        () => buildFinnhubEvidence({
            ...validApiPayload,
            profile: { ...validApiPayload.profile, ticker: "NEXT" },
        }),
        (error) => error.details?.suggestedTicker === "NEXT",
    );
    assert.throws(
        () => buildFinnhubEvidence({
            ...validApiPayload,
            profile: { ...validApiPayload.profile, exchange: "OTC Markets" },
        }),
        /OTC/,
    );
    assert.throws(
        () => buildFinnhubEvidence({
            ...validApiPayload,
            profile: { ...validApiPayload.profile, currency: "CAD" },
        }),
        /CAD/,
    );
});

test("requires an authenticated teacher actor for global registration", async () => {
    const authorizationCalls = [];
    const teacherActor = await authorizeStockCatalogActor(
        { uid: "teacher-a", classId: "class-a" },
        async (...args) => authorizationCalls.push(args),
    );
    assert.deepEqual(teacherActor, { uid: "teacher-a", classId: "class-a" });
    assert.deepEqual(authorizationCalls, [["class-a", "teacher-a", { teacherOnly: true }]]);

    await assert.rejects(
        authorizeStockCatalogActor({ uid: "", classId: "class-a" }, async () => {}),
        (error) => error.code === "unauthenticated",
    );
    await assert.rejects(
        authorizeStockCatalogActor(
            { uid: "student-a", classId: "class-a" },
            async () => {
                const error = new Error("교사 권한이 필요합니다.");
                error.code = "permission-denied";
                throw error;
            },
        ),
        (error) => error.code === "permission-denied",
    );
});
