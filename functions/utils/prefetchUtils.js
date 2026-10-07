const admin = require('../firebaseAdminCompat');
const db = admin.firestore();
const {
    US_STOCK_MARKET_HOLIDAYS,
    getPriorOrCurrentTradingDateKey,
} = require('./usStockMarketCalendar');
const { ADVANCED_SECURITIES } = require('./stockCatalog');

function getPrefetchContext(now = new Date()) {
    const nyDate = new Date(
        now.toLocaleString("en-US", { timeZone: "America/New_York" }),
    );
    return { targetNY: getPriorOrCurrentTradingDateKey(nyDate) };
}

async function fetchAllSymbols() {
    const trackedSymbols = await fetchTrackedSymbolsMeta();
    return trackedSymbols.map((item) => item.symbol);
}

async function fetchTrackedSymbolsMeta(options = {}) {
    const {
        excludeIndices = false,
        excludeEtf = false,
    } = options;

    const snap = await db.collection('stockCategories').get();
    const symbolMap = new Map();

    snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const categoryId = String(docSnap.id || '').trim();
        const categoryName = String(data.name || categoryId).trim();
        const normalizedCategoryId = categoryId.toLowerCase();
        const normalizedCategoryName = categoryName.toLowerCase();
        const isIndexCategory =
            normalizedCategoryId === 'indices' ||
            normalizedCategoryName === 'indices';
        const isEtfCategory = /etf/i.test(categoryId) || /etf/i.test(categoryName);

        if ((excludeIndices && isIndexCategory) || (excludeEtf && isEtfCategory)) {
            return;
        }

        if (!Array.isArray(data.symbols)) {
            return;
        }

        data.symbols.forEach((symbol) => {
            const ticker = String(symbol?.ticker || symbol?.symbol || '')
                .trim()
                .toUpperCase();

            if (!ticker || symbolMap.has(ticker)) {
                return;
            }

            symbolMap.set(ticker, {
                symbol: ticker,
                companyName: String(
                    symbol?.companyName || symbol?.name || ticker,
                ).trim() || ticker,
                categoryId,
                categoryName,
                isIndex: isIndexCategory,
                isEtf: isEtfCategory,
            });
        });
    });

    ADVANCED_SECURITIES.forEach((stock) => {
        const isEtf = stock.type === 'ETF';
        if (excludeEtf && isEtf) return;
        const ticker = String(stock.ticker || '').trim().toUpperCase();
        if (!ticker || symbolMap.has(ticker)) return;
        symbolMap.set(ticker, {
            symbol: ticker,
            companyName: stock.companyName || ticker,
            categoryId: isEtf ? 'advanced_etf_pool' : 'advanced_stock_pool',
            categoryName: isEtf ? '심화 ETF 종목 풀' : '심화 주식 종목 풀',
            isIndex: false,
            isEtf,
        });
    });

    return Array.from(symbolMap.values()).sort((left, right) =>
        left.symbol.localeCompare(right.symbol),
    );
}

module.exports = {
    getPrefetchContext,
    fetchAllSymbols,
    fetchTrackedSymbolsMeta,
    US_STOCK_MARKET_HOLIDAYS
};
