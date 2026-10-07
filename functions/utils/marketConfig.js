// functions/utils/marketConfig.js
const admin = require("../firebaseAdminCompat");
const db = admin.firestore();
const { resolveClassCurrencyUnit } = require("./currencyUnit");

const getFeeOverrideRate = (overrides = {}, uid = null) => {
    if (!uid || !overrides || typeof overrides !== "object") {
        return null;
    }

    const rawOverride = overrides[uid];
    const rawRate =
        rawOverride && typeof rawOverride === "object"
            ? rawOverride.rate
            : rawOverride;
    const parsedRate = Number(rawRate);
    return Number.isFinite(parsedRate) && parsedRate >= 0 ? parsedRate : null;
};

const clampStockMinHoldingDays = (value) => {
    const days = Math.round(Number(value) || 0);
    return Math.min(365, Math.max(0, days));
};

async function getMarketConfig(tx, classId, uid = null) {
    const marketConfigRef = db.doc(`classes/${classId}/config/stockMarket`);
    const marketConfigSnap = tx
        ? await tx.get(marketConfigRef)
        : await marketConfigRef.get();

    // ✅ 클래스 문서에서 currencyUnit 가져오기
    const classRef = db.doc(`classes/${classId}`);
    const classSnap = tx ? await tx.get(classRef) : await classRef.get();

    const marketData = marketConfigSnap.exists
        ? marketConfigSnap.data() || {}
        : {};
    const classData = classSnap.exists ? classSnap.data() || {} : {};

    // 기본값 설정
    const conversionRate =
    typeof marketData.conversionRate === "number" &&
    marketData.conversionRate > 0
        ? marketData.conversionRate
        : 10;
    const defaultExchangeFeeRate =
    typeof marketData.exchangeFeeRate === "number"
        ? marketData.exchangeFeeRate
        : 0.01;
    const exchangeFeeRate =
        getFeeOverrideRate(marketData.exchangeFeeOverrides, uid) ?? defaultExchangeFeeRate;
    const defaultTradeFeeRate =
    typeof marketData.tradeFeeRate === "number"
        ? marketData.tradeFeeRate
        : 0.002;
    const tradeFeeRate =
        getFeeOverrideRate(marketData.tradeFeeOverrides, uid) ?? defaultTradeFeeRate;
    const tradeFeeMinUSD =
    typeof marketData.tradeFeeMinUSD === "number"
        ? marketData.tradeFeeMinUSD
        : 0;
    const stockMinHoldingDays = clampStockMinHoldingDays(
        marketData.stockMinHoldingDays,
    );
    const studentAutoExchangeBuyEnabled =
        marketData.studentAutoExchangeBuyEnabled === true;

    // ✅ classes/{classId}의 currencyUnit 사용
    const currencyUnit = resolveClassCurrencyUnit(classData);

    return {
        conversionRate,
        exchangeFeeRate,
        defaultExchangeFeeRate,
        tradeFeeRate,
        defaultTradeFeeRate,
        tradeFeeMinUSD,
        stockMinHoldingDays,
        studentAutoExchangeBuyEnabled,
        currencyUnit,
    };
}

module.exports = { getMarketConfig };
