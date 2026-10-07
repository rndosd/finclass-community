"use strict";

const { HttpsError } = require("firebase-functions/v2/https");
const { roundStockQuantity } = require("./stockQuantity");

const positivePrice = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
};

async function readStockTradePricing({ db, tx = null, symbol, expectedPrice }) {
    const normalizedSymbol = String(symbol || "").trim().toUpperCase();
    // Match the daily price source already displayed by useStockQuotes.
    const ref = db.doc("stockMarketSummary/today_quotes_all");
    const snapshot = tx ? await tx.get(ref) : await ref.get();
    const prices = snapshot.exists ? snapshot.data() || {} : {};
    const price = positivePrice(prices[normalizedSymbol]?.current);
    if (!price) {
        throw new HttpsError("failed-precondition", "거래할 수 있는 시세가 없습니다. 시세 갱신 후 다시 시도해 주세요.");
    }
    if (expectedPrice !== undefined && Math.round(Number(expectedPrice) * 10000) !== Math.round(price * 10000)) {
        throw new HttpsError(
            "failed-precondition",
            "시세가 변경되었습니다. 주문창을 다시 열어 최신 가격을 확인해 주세요.",
            { reason: "stock-price-changed", symbol: normalizedSymbol, priceUSD: price },
        );
    }
    return { price, prices };
}

function valuePortfolioAfterTrade({ portfolioDocs, prices, symbol, quantityDelta }) {
    let value = 0;
    let foundTradedSymbol = false;
    for (const snapshot of portfolioDocs) {
        const holding = snapshot.data() || {};
        const holdingSymbol = String(snapshot.id).trim().toUpperCase();
        const isTradedSymbol = holdingSymbol === symbol;
        foundTradedSymbol ||= isTradedSymbol;
        const quantity = Math.max(0, roundStockQuantity(
            (Number(holding.quantity) || 0) + (isTradedSymbol ? quantityDelta : 0),
        ));
        // A missing quote for a different, retired symbol must not block trading.
        // Retain its recorded price/cost basis until a quote becomes available.
        const price = positivePrice(prices[holdingSymbol]?.current) ||
            positivePrice(holding.currentPriceUSD) ||
            positivePrice(holding.averagePriceUSD) ||
            positivePrice(Number(holding.totalInvestmentUSD) / Number(holding.quantity));
        value += quantity * price;
    }
    if (!foundTradedSymbol && quantityDelta > 0) {
        value += quantityDelta * positivePrice(prices[symbol]?.current);
    }
    return Math.round(value * 10000) / 10000;
}

module.exports = { readStockTradePricing, valuePortfolioAfterTrade };
